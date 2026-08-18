# Handoff — Commit transacional V2 (contrato + cancelamento + criação)

**Data:** 2026-08-15
**Estado:** cancelamento **commitado localmente**; criação **validada, não commitada**.
**Bloqueio atual:** revisão do Codex pendente (sem tokens, retorno estimado ~20/08/2026).

---

## 1. O que buscamos — o problema de origem

A RPC de efeito que existia (`cappia_cancelar_agendamento_v2` e
`cappia_reservar_agendamento`) **executa o efeito e nada mais**: não conhece
`versao_inicial` e não grava estado conversacional.

Consequência real: dois turnos do mesmo paciente iniciados sobre o mesmo snapshot
**chegam a chamar a RPC**, e só depois um perde o CAS conversacional. Um commit
posterior **não desfaz** efeito já executado — dois agendamentos criados, ou cancelar
seguido de remarcar. A dupla execução é **possível, não garantida**; é justamente por
não ser determinística que não pode ficar ao acaso.

**A solução:** uma RPC por operação que faz, **numa única transação**, nesta ordem:

1. valida `versao_inicial` contra `estado_conversa.atualizado_em`, **com lock**;
2. valida a **autorização persistida** em `aguardando_resposta`;
3. executa o efeito;
4. grava o estado final.

Base normativa: `specs/contexto-conversacional-unificado-v2.md` §14.3, §14.4, §14.9.

---

## 2. Decisões canônicas desta etapa (não relitigar)

**Um único campo `operacao`.** Uma implementação anterior inventou
`operacao_confirmada`, que a spec não define. A RPC lê
`aguardando_resposta ->> 'operacao'` — o campo duplicado faria toda autorização
divergir. Os valores aceitos vêm do **contexto** (`tipo` da pergunta), não de um
segundo campo.

**A autoridade é `aguardando_resposta` da linha travada, nunca
`contexto_horarios.proposta_pendente`.** `proposta_pendente` carrega só
`{data, horario}` — prova **quando**, jamais **o quê**. Confirmar a *criação* de um
horário e o *cancelamento* de um agendamento no mesmo horário produzem o par idêntico.

**Na criação, `proposta_pendente` é conferida — mas como CONTEÚDO, não autorização.**
Quem autoriza é `operacao: 'criar'`; a proposta responde *o que* se cria. Sem essa
conferência, um "sim" poderia criar algo diferente do proposto.

**Não há idempotência de retry.** A repetição idêntica carrega a `versao_inicial`
antiga e sai em `turno_obsoleto`. O ramo `ja_cancelado` atende **outra coisa**: turno
novo, autorização própria e válida, alvo já cancelado. (Corrigido após o Codex apontar
que o comentário original alegava cobrir retry após timeout — alegação falsa.)

**Predicado da linha autoritativa inclui `paciente_id`.** Sem ele, `p_paciente_id` era
parâmetro não verificado: o par (conversa do paciente A, paciente/agendamento de A2 na
mesma clínica) executaria na ficha errada com autorização alheia. Achado do Codex,
corrigido, e ambos os testes foram **reexecutados** sobre a versão corrigida.

**`agendamento_id` na criação é recusado inclusive como JSON `null`** — checagem é
`v_pergunta ? 'agendamento_id'` (presença da chave). Com `->>`, chave-com-null e
chave-ausente seriam indistinguíveis.

**Criação não chama `cappia_reservar_agendamento`** (decisão do Gabriel): reutiliza só
os três resolvedores e incorpora lock/conflito/INSERT. Motivo: aquela função devolve
`sqlerrm` em `detalhe`, que pode carregar PII.

---

## 3. O que está pronto

### 3.1 Cancelamento — COMMITADO LOCALMENTE (2 commits na `main`, sem push)

- `df61c5c` — feat: define contrato estruturado v2 (11 arquivos)
- `8c08db5` — feat: add commit transacional v2 de cancelamento (14 arquivos)

Validado no dev `bcmuqautblvjdqzhjfbw`, duas rodadas (a segunda sobre a versão
corrigida com `paciente_id`): sessão única + A×B concorrente, zero resíduos.

### 3.2 Criação — VALIDADA, NÃO COMMITADA (5 arquivos untracked)

```
src/supabase/migrations/20260815122000_iris_nova_commit_turno_v2_criar.sql
src/supabase/rollbacks/20260815122000_iris_nova_commit_turno_v2_criar_rollback.sql
src/supabase/tests/20260815122000_iris_nova_commit_turno_v2_criar_fixtures.sql
src/supabase/tests/20260815122000_iris_nova_commit_turno_v2_criar_axb_fixtures.sql
src/supabase/tests/executar-teste-axb-commit-v2-criar.mjs
```

**Sessão única — 20 casos, todos passaram.** Inclui: discriminador de autorização;
`agendamento_id` recusado como JSON null; proposta/dentista/procedimento conferidos
contra a linha travada; paciente divergente da conversa; agendamento completo campo a
campo (nome do procedimento vindo do catálogo); conflito por **sobreposição**
(10:30 sobre 10:00-11:00); e o controle do caso 15 — mesma clínica, mesmo horário,
outro dentista cria e os dois coexistem, provando isolamento **por dentista**.

**A×B — dois cenários, ambos passaram:**

| Cenário | Mecanismo | Resultado |
|---|---|---|
| Mesma conversa | `FOR UPDATE` da linha | A executou; B `turno_obsoleto`; **1** agendamento; `dados.turno='A'` |
| Conversas diferentes, mesmo intervalo | **advisory lock** por (clínica, dentista, dia) | A criou; B (versão própria e válida) `horario_ocupado`; **1** agendamento |

Barreiras confirmadas por `pg_blocking_pids` — nunca por `sleep`.

---

## 4. Estado do banco — NADA APLICADO

Verificado após a última execução no dev `bcmuqautblvjdqzhjfbw`:

- `cappia_commit_turno_v2_cancelar` — **ausente**
- `cappia_commit_turno_v2_criar` — **ausente**
- coluna `estado_conversa.aguardando_resposta` — **ausente**
- zero clínicas/procedimentos sintéticos, zero agendamentos
- as 4 funções da rota V1 — **intactas**

Os testes criam a função temporariamente e removem. **A rota V1 continua sendo a única
operacional.** `udizowyfjnhuhgxkeayk` (produção) nunca foi alvo em nenhuma etapa.

---

## 5. Como reexecutar os testes

Credencial: `C:\Users\Gabriel\.iris-secrets\cappia-iris-core-dev.env` (tem
`DATABASE_URL` apontando para o dev). `pg@8.23.0` já é devDependency.

**A×B (as duas RPCs têm runner próprio):**

```powershell
cd C:\Users\Gabriel\cappia-iris-core\src
node --env-file="C:\Users\Gabriel\.iris-secrets\cappia-iris-core-dev.env" `
  supabase/tests/executar-teste-axb-commit-v2-criar.mjs --aplicar
```

**Sessão única:** compor `BEGIN` + migration da coluna (com `IF NOT EXISTS`) +
migration da RPC + fixtures + `ROLLBACK`, e executar como uma chamada só.

Os runners recusam conectar se a URL não for do dev (validação por hostname/username,
nunca `includes`) — coberto por `identidade-conexao.test.mjs`, 16 testes locais.

---

## 5-B. Sessão 2026-08-16 — a anotação da pergunta (pendência 3 da spec v2)

**Foi feito com o Codex indisponível** (sem tokens até ~20/08). Decisão do
Gabriel: seguir em vez de aguardar parado.

**O problema:** a Iris não tem registro do que ela mesma perguntou. Quando o
paciente responde "o primeiro" ou "pode ser", ela deduz do texto. Funciona na
maioria das vezes — e falha justamente nas respostas curtas, que são as mais
comuns.

**O que ficou pronto (3 de 4 pontas):**

| Ponta | Estado | Onde |
|---|---|---|
| Ler a anotação | ✅ | `aguardando-resposta.ts` (novo), `identificacao.ts` |
| Derivar da decisão | ✅ | `declarar-pergunta-pendente.ts` (novo) |
| Gravar no banco | ✅ | `contexto-horarios.ts`, `orquestrador.ts` |
| Entregar à IA | ⬜ | é a troca dos 4 marcadores — ver abaixo |

25 testes novos, suíte 1389, typecheck limpo. **Nada mudou para o paciente.**

**Duas decisões de desenho tomadas sem o Codex:**

1. **Leitura com três situações, não duas** (`ausente` / `presente` /
   `invalido`). Converter dado corrompido em `null` afirmaria "não há
   pergunta em aberto" — afirmação factual que o dado corrompido não
   autoriza. O tipo obriga o chamador a distinguir.
2. **A anotação é derivada da DECISÃO do Core, não declarada pela redatora**
   — divergindo do desenho da spec §14.5. Razões: quem sabe o que foi
   perguntado é quem decidiu perguntar; elimina a divergência texto↔declaração
   que a própria spec admite não resolver; e não mexe no contrato da redatora.
   **O Codex pode discordar** — se discordar, o custo é refazer essa peça, e o
   formato gravado é o mesmo, então nada mais quebra.

### Os quatro marcadores antigos — a troca que falta

Hoje a pergunta pendente chega à IA por **quatro marcadores separados** em
`contexto_horarios`, criados um a cada problema real entre 05/08 e 11/08:
`horarios_oferecidos`, `proposta_pendente`, `oferta_procedimento_pendente`,
`troca_telefone_pendente`. Nenhum cobre escolha de dentista.

A anotação substitui os quatro por um campo único, com vocabulário fechado.
**Não foi feita a troca** — ela muda o que chega à interpretadora, e as
instruções do prompt são escritas em torno dos nomes dos quatro.

**Medição feita antes de decidir** (rodada 3 em `prova-resultado-iris.ts`,
gpt-5.6-luna, 15 casos × 2): os quatro casos positivos passaram 2/2 cada.
Detalhe completo no cabeçalho daquele arquivo.

**A falha aparente (1/2) NÃO é risco:** "ok" solto sem proposta produziu
`confirmar`, mas a proteção não vive no prompt — vive no Core.
`decidirComHorarioEscolhido` só é alcançada quando já existem `opcao`,
`procedimento_id` e `dentista_id`. Um "sim" da IA sem proposta não encontra o
que reservar. Verificação determinística, independente do modelo.

**Troca de telefone:** mais simples do que parecia. O gate já é do Core
(`respostaTrocaTelefone` só é não-nulo com o marcador presente). Na troca,
passa a ler `aguardando_resposta.tipo === 'troca_telefone'`. Uma condição,
mesmo lugar.

**Conclusão:** a troca se sustenta na evidência. Nenhum bloqueador.

## 6. Pendências, em ordem

**O caminho até o Luna** (o objetivo de fundo — o contrato v2 existe porque o
modelo novo trabalha melhor com ele):

1. **Troca dos quatro marcadores pela anotação** — próximo passo real. Medida
   e sem bloqueador (§5-B). Envolve: reescrever as quatro regras do prompt da
   interpretadora, apontar o gate de troca de telefone para o campo novo, e
   remedir. **É a mesma decisão que a troca de modelo** — as instruções atuais
   foram calibradas para o `gpt-4.1-mini`, e as medições do Luna usaram o
   contrato novo.
2. **Teste integrado turno a turno** — a spec chama de "pré-requisito
   explícito, não recomendação". Depende de 1: turno 1 grava a anotação →
   turno 2 lê e resolve a resposta curta. **É o ponto em que a diferença
   aparece na conversa.**
3. **Medição maior do Luna** — as rodadas atuais são N=2, triagem, não
   estabilidade.

**Em paralelo, dependendo do Codex:**

4. **Revisão do Codex** — a RPC de criação **e** as duas decisões de desenho
   de §5-B.
5. **Commit local da criação** — após a revisão.
6. **`remarcar`** — a terceira RPC. **Não derivar de `criar` nem de
   `cancelar`**: precisa liberar o horário antigo E reivindicar o novo na
   mesma transação, o que muda o conjunto de locks.
7. **Teste cruzado da spec §14.9** (A confirma cancelamento, B confirma
   remarcação do mesmo agendamento — só um efeito ocorre). Depende de 6.
8. **Aplicação em banco** — nunca autorizada até aqui; decisão explícita do
   Gabriel.

---

## 7. Armadilhas já encontradas (não repetir)

- **`pg` converte `timestamptz` para `Date`** (milissegundos), e a RPC calcula
  `versão + 1µs`. Ler sempre `atualizado_em::text` e comparar avanço **no SQL**.
- **Telefone sintético não pode derivar de UUID** — contém `a-f` e viola
  `pacientes_telefone_formato` (`^[0-9]+$`).
- **Statements de fixture usam quantidades diferentes de parâmetros** — o protocolo
  estendido exige correspondência exata.
- **A RPC grava `dados = p_dados` do turno que concluiu** (correto), o que apaga
  `dentista_id`/`procedimento_id`. Testes encadeados precisam **restaurar `dados`**
  entre casos, senão recusam por `dentista_divergente`.
- **Teste que varia duas coisas ao mesmo tempo não prova nenhuma** — foi o defeito do
  caso 15 original (mudava clínica *e* dentista).
- **A proteção pode não estar onde o comentário sugere.** Li "gate de
  autorização" no comentário de `troca_telefone_pendente` e concluí que
  removê-lo abriria buraco de segurança. Ao ler a função, o efeito é o oposto:
  falha fechada (`return null` sem o marcador). Ler o comentário não substitui
  ler o código.
- **Teste automático não pega erro de compreensão.** Os 1389 testes não chamam
  a IA. Trocar o contrato da interpretadora sem medir contra o modelo real
  deixaria tudo verde com a Iris deixando de entender "pode ser". Medir antes,
  sempre.
- **Falha intermitente pré-existente** (~1 em 4 rodadas da suíte):
  `historicoConversa exatamente no limite da janela` monta o histórico com
  idade exata e compara com `Date.now()`. 1ms de atraso e sai da janela.
  Verificado em `main` limpa — não é regressão. Não corrigido.
- **`git stash` para testar sem as próprias mudanças é arriscado** — o comando
  estourou o tempo antes do `pop` e o trabalho ficou fora do working tree até
  eu restaurar. Testar em cópia, não no repositório vivo.
