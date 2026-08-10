# Handoff técnico — 2026-08-10 (troca de telefone / CPF em outro número)

Arquivo NÃO commitado. Escrito para dar contexto à próxima sessão. Decisão de
commitar (ou não) fica com o Gabriel.

**NADA foi commitado, feito push ou deployado nesta etapa.** As duas migrations
FORAM aplicadas nos dois bancos (ver §2).

---

## 0. ATUALIZAÇÃO — o bloqueio foi resolvido

> Este handoff foi escrito quando a etapa estava travada. **O bloqueio da §3 foi
> diagnosticado e corrigido.** O caso normal agora funciona ponta a ponta com a
> IA real: **3/3** no runner, com controle A/B válido.
>
> **Causa real** (a hipótese registrada na §3 estava errada — a união de eventos
> não era o problema): `SCHEMA_PORTATIL_APROVADO`, em `cliente-modelo-openai.ts`,
> é o único schema enviado à OpenAI, e seu enum estava preso em
> `['aceitar_opcao']`. Com `strict: true`, o modelo estava **estruturalmente
> proibido** de emitir o evento novo — e, proibido do certo, forçava o errado
> (uma recusa saiu como `aceitar_opcao`). Mesma classe do bug de
> `historico_recente`. O teste que deveria ter pego isso **congelava a lista à
> mão**, então abençoava o enum defasado; agora ele asserta contra
> `TIPOS_EVENTO_CANDIDATO_PERMITIDOS`.
>
> **Contrato final** (escolhido por medição A/B de três alternativas, 6/6):
> um único evento novo `aceitar_troca_telefone`, com a **mesma forma** de
> `aceitar_opcao`; a recusa vem de `natureza_mensagem === 'negacao'`; e a
> **negação vence o evento** (medido: os dois chegaram juntos numa recusa).
> Detalhe completo em `specs/cpf-outro-telefone-v1.md` §2 e em
> `src/eval/diagnostico-contrato-eventos.ts`.
>
> **A §3 e a §4 abaixo ficam como registro histórico do que estava quebrado** —
> não descrevem mais o estado atual. A §5 (paridade Core/Edge, nada commitado)
> continua valendo.

---

## 1. Situação em uma frase

~~A etapa não está pronta para produção~~ — **superado, ver §0.** A camada
determinística e o contrato de interpretação estão implementados e provados
contra a IA real; falta revisão independente, commit e deploy.

---

## 2. O que foi feito e está PROVADO

### Etapa anterior (fechada nesta mesma sessão)

Correção de `cappia_persistir_paciente` no operacional
(`20260810182322_iris_nova_persistir_paciente_coluna_fonte_legado.sql`, aplicada
como versão remota `20260810182512`). A função gravava direto em
`telefone_normalizado`, que ali é `GENERATED ALWAYS` — paciente novo **nunca**
teria sido persistido em produção. Provado por par A/B com `EXPLAIN` (forma
antiga falha `428C9`, nova planeja limpo) e por prova comportamental com
transação abortada (round-trip do telefone exato, linha real intacta,
impressão `33af46e6436f61bd825b23b62dc851cd` idêntica ao baseline).

### Esta etapa

- **Spec fechada**: `specs/cpf-outro-telefone-v1.md`.
- **Migrations aplicadas nos DOIS bancos**
  (`20260810185921_iris_nova_trocar_telefone_paciente_v1.sql` e a irmã
  `_legado`): coluna aditiva `pacientes.telefone_alterado_em` e a RPC nova
  `cappia_trocar_telefone_paciente`. **Corpos diferentes de propósito** — o dev
  grava `telefone_normalizado`, o operacional grava `telefone` e deixa a coluna
  generated derivar. Contrato observável idêntico.
- **Adaptador** `src/core/trocar-telefone-paciente.ts`, no padrão de
  `persistir-paciente.ts`: vocabulário fechado, falha fechado, nunca vaza
  `error.message` nem PII.
- **Marcador** `troca_telefone_pendente` como quarta variante do
  `contexto_horarios` (não preserva `proposta_pendente` junto, por decisão).
- **Evento** `responder_troca_telefone` com `resposta: 'sim' | 'nao'`, em união
  discriminada, validado nos **dois** validadores do sistema.
- **Decisões** `troca_telefone_pendente` e `troca_telefone_recusada`; o antigo
  `cpf_ja_cadastrado` sobrou só para os desfechos técnicos terminais.
- **Gate dos dois lados**: a resposta só é honrada quando o marcador oficial
  estava presente — evento sem pergunta pendente nunca autoriza nada.

**Provas de banco (transação abortada, nada persistiu), nos dois projetos:**

| caso | dev | operacional |
|---|---|---|
| troca aceita: id correto, só telefone muda, `telefone_alterado_em` preenchido | ok | ok |
| round-trip do telefone (`telefone` → generated) | n/a | `11900000099` → `5511900000099` |
| CPF inexistente → `cpf_nao_encontrado`, zero escrita | ok | ok |
| telefone de outra ficha (§7) → `telefone_de_outro_paciente`, **zero escrita** | ok | ok |

Depois das provas: operacional de volta a 1 paciente com impressão idêntica ao
baseline; dev de volta a 0 clínicas / 0 pacientes.

**Suíte:** 1061 testes, 1056 passam, 0 falham, 5 skipped. **Typecheck limpo.**
21 testes novos (11 de fluxo, 6 do adaptador, e os de contexto/extrator/cliente).

---

## 3. O BLOQUEIO — leia antes de qualquer coisa

`src/eval/teste-real-troca-telefone.ts`, contra a OpenAI real:

```
FALHOU "pode sim, atualiza pro meu número"   resposta=-  nat=resposta
FALHOU "não, deixa como está"                resposta=-  nat=negacao
ok     "por que vocês precisam disso?"       resposta=-  nat=duvida
--- resumo --- 1/3
```

**A interpretadora não emite `responder_troca_telefone` em nenhum caso.** O
único caso "ok" passou porque o esperado ali era justamente a ausência.

**O controle A/B é vacuoso e não deve ser lido como aprovação.** Ele diz
"TEVE EFEITO: true" apenas porque compara ausência com ausência — os dois lados
**não diferem**, então pelo princípio do teste isolado ele não prova nada. Está
marcado como OK por um defeito do próprio runner, não por evidência.

**Uma coisa foi corrigida e não é mais o problema:** a primeira execução também
reprovava com `eventos_candidatos_invalido`. Causa: usei `oneOf` no schema de
Structured Outputs; o modo estrito documenta `anyOf`. Trocado para `anyOf`, o
erro sumiu. Restou só a não-emissão.

**Hipóteses ainda NÃO investigadas** (parei aqui por instrução explícita do
Gabriel de não aumentar escopo):

1. `anyOf` em `items` de array pode não ser bem suportado pelo modo estrito, e
   o modelo simplesmente evita emitir qualquer evento dessa forma;
2. a instrução nova pode estar competindo com a regra vizinha de `confirmacao`;
3. `gpt-4.1-mini` pode precisar de um formato de evento uniforme (a mesma forma
   para os dois tipos), como era antes desta etapa.

A hipótese 1 é a mais provável, porque `aceitar_opcao` funcionava com um schema
de forma única e passou a conviver com uma união a partir daqui. **Vale
verificar se `aceitar_opcao` continua sendo emitido** — se ele também parou, a
união é a causa e a correção é voltar a uma forma única de evento.

---

## 4. RISCO se isso for deployado como está

Não deployei. Se alguém deployar sem resolver §3, o comportamento **piora** em
relação ao que está em produção hoje:

- hoje: conflito de CPF → mensagem única encaminhando à recepção, fim;
- com este código: conflito de CPF → a Iris **pergunta**, o paciente responde,
  o evento não é emitido, e a mesma pergunta é re-derivada **a cada turno**.
  Loop sem saída.

**Reversão mínima, se você quiser deployar outra coisa antes disso:** em
`src/core/orquestrador.ts`, no ramo `persistencia.tipo === 'cpf_ja_cadastrado'`,
voltar a devolver `{ tipo: 'cpf_ja_cadastrado' }` em vez de
`{ tipo: 'troca_telefone_pendente' }`. Uma linha. O resto do código fica inerte
(a RPC e a coluna são aditivas e não atrapalham).

---

## 5. Estado dos artefatos

- **Commits:** nenhum. Working tree tem as mudanças todas.
- **Push:** nenhum.
- **Deploy:** nenhum. Edge Function segue na v16.
- **Paridade Core/Edge:** **11 arquivos divergentes** (`cliente-modelo-openai`,
  `contexto-horarios`, `fatos-autorizados`, `gerar-resposta-paciente`,
  `interpretacao-extrator`, `interpretacao-instrucoes`, `interpretacao-tipos`,
  `interpretar-e-aplicar`, `orquestrador-tipos`, `orquestrador`, `tipos`) mais
  `trocar-telefone-paciente.ts` **ausente** na pasta da Edge. **Não sincronizei
  de propósito** — sincronizar só faz sentido junto do deploy, e o deploy está
  bloqueado por §3.
- **Bancos:** as duas migrations desta etapa **estão aplicadas** nos dois
  projetos. São aditivas (coluna nullable + função nova sem chamador em
  produção), então não afetam o comportamento atual da Edge v16.

---

## 6. Escopo que o Gabriel cortou explicitamente (2026-08-10)

Só o caso normal: paciente trocou de número, informa o mesmo CPF, a Iris oferece
atualizar para o telefone atual do WhatsApp, e com confirmação atualiza e segue o
agendamento. **Não investir mais em cenários raros.**

Já implementados e provados, mas que **não devem receber mais esforço**:
`telefone_de_outro_paciente` (§7 detectada e parada) e `cpf_nao_encontrado`.
Ambos são retornos tipados de 3 linhas que apenas encaminham à recepção — ficam
como estão.

Colunas deliberadamente **não** criadas, com evidência de banco na spec §5:
`telefone_alterado_origem` (seria constante `'iris'`, sem consumidor, e mentiria
quando o painel escrevesse direto), referência autorizadora (depende de
`P4`/`P4I`, não implementadas) e natureza da alteração (constante enquanto §7
não abrir). `persistencia-v1.md` §6 fica **parcialmente atendida**, registrado.

---

## 7. Próximo passo recomendado

Um só: **descobrir por que o evento não é emitido** (§3), começando por
verificar se `aceitar_opcao` ainda é emitido — `src/eval/teste-real-oferta-pendente.ts`
responde isso em uma execução. Se ele também parou, a união discriminada de
eventos é a causa e a saída é voltar à forma única.

Enquanto isso não fechar, a etapa não está encerrada e nada deve ser deployado.

---

## 8. Ritual de encerramento NÃO executado

`cappia-estado/ESTADO.md`, `HANDOFF-*` e o painel do Obsidian **não** foram
atualizados. Motivo: a etapa não está encerrada (§3), e o Gabriel pediu
explicitamente para não abrir novas frentes. Fica registrado aqui para não
virar divergência silenciosa — é decisão dele quando rodar.
