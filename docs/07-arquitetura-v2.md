# Arquitetura V2 — a Iris é a autoridade semântica; o Core é a autoridade factual

> **Status: APROVADO pelo Gabriel em 2026-08-12.** Este documento passa a ser o canônico
> de arquitetura e **substitui `docs/02-arquitetura.md`**, que fica preservado como
> registro histórico.
>
> **Nenhuma mudança de comportamento ao paciente foi implementada.** Etapas 0 e 1
> concluídas e aprovadas (registros dentro da seção 10) — ambas somente em `src/eval/`,
> zero linha de produção alterada. **Etapa 2 (despachante-sombra) deployada e validada em
> produção em 2026-08-13** — decide em paralelo, só para medição; nunca executa
> capacidade, nunca altera estado, nunca muda a resposta. **A Etapa 3 (corte real de
> comportamento) não está autorizada.**
>
> Escrito em 2026-08-12, a partir da auditoria arquitetural e da auditoria de medições
> feitas na mesma data.

---

## 0. O princípio central

**A Iris é a autoridade semântica. O Core é a autoridade factual e operacional.**

A Iris decide **o que** fazer. O Core decide **se e como** aquilo pode ser feito
corretamente.

Isto substitui o princípio vigente em `docs/02-arquitetura.md`:

> ~~"Um controlador determinístico decide o próximo passo a partir do estado. A IA
> somente interpreta a mensagem do paciente e redige respostas."~~

### Por que isto não é uma ruptura com os princípios do projeto

`docs/00-principios.md` (canônico, aprovado em 2026-08-08) já estabelece, como **primeiro
princípio**:

> *"Isso realmente pertence ao Core ou é algo que a IA consegue compreender naturalmente?"
> Se a IA puder compreender naturalmente, o Core não deve recriar essa inteligência através
> de regras, aliases, listas, heurísticas ou **estados intermediários**."*

Esse princípio já foi aplicado três vezes, sempre com o mesmo resultado: resolução de
procedimento por alias (~1.300 linhas removidas), guarda lexical da redatora (removida
por completo), interpretadora cega por turno (resolvida dando contexto à IA, não regra ao
Core).

A V2 é **a quarta aplicação do mesmo princípio**, à única camada onde ele nunca foi
aplicado: a decisão de qual fluxo a conversa deve seguir. Hoje essa decisão é tomada por
`decidirPorNatureza` + roteamento por estado persistido — exatamente a forma de
"heurística sobre estado intermediário" que o princípio nº 1 manda devolver à IA.

Em outras palavras: a V2 não introduz uma filosofia nova. Ela remove a última exceção à
filosofia que já é canônica.

---

## 1. Responsabilidades da Iris

A Iris (as duas camadas de IA — compreensão e redação) é responsável por:

- **compreender** a mensagem atual no contexto da conversa;
- **decidir o que o paciente quer** — em linguagem, não em campos de formulário;
- **decidir se precisa de uma capacidade do Core** ou se consegue responder sozinha;
- **escolher qual capacidade** precisa, quando precisa;
- **fornecer os parâmetros** que ela entendeu da conversa (procedimento, data mencionada,
  horário mencionado, qual agendamento, etc.);
- **conversar normalmente** quando nenhuma operação determinística for necessária;
- **decidir como continuar a conversa** depois de receber os fatos do Core.

A Iris **nunca**:

- acessa banco, calendário, credenciais ou rede;
- executa efeito real;
- inventa um fato operacional (horário, data, disponibilidade, confirmação);
- decide se uma operação é *permitida* — isso é do Core.

## 2. Responsabilidades do Core

O Core é responsável por **executar capacidades determinísticas** e ser a fonte de verdade
operacional:

- resolver datas e horários (calendário civil, fuso, precedência);
- consultar disponibilidade real;
- consultar agendamentos do paciente;
- identificar entidades reais (clínica, paciente, dentista, procedimento) contra o banco;
- validar dados (CPF, data de nascimento, e-mail, telefone);
- criar, remarcar e cancelar agendamentos;
- garantir locks, concorrência, idempotência, integridade e isolamento por clínica;
- devolver **fatos**, sempre — nunca uma decisão de conversa.

O Core **nunca**:

- decide o significado da mensagem do paciente;
- decide qual fluxo a conversa deve seguir;
- reinterpreta ou sobrepõe a decisão semântica da Iris;
- usa estado persistido de turnos anteriores para decidir *o que o paciente quer agora*.

### A fronteira, em uma frase

> Se a pergunta é **"o que o paciente quer?"** → Iris.
> Se a pergunta é **"isso é verdade / isso é possível / isso pode ser executado?"** → Core.

O Core continua podendo **recusar**. Recusar não é decidir o significado: a Iris pede
"reserve 10:00"; o Core responde "10:00 está ocupado" — fato, não interpretação. A Iris
decide o que dizer sobre isso.

## 3. Fluxo completo da conversa

```
Paciente
   │
   ▼
[transporte]  n8n → Edge Function            (nenhuma decisão, só entrega)
   │
   ▼
[Core]  carrega contexto factual              identificação, histórico, estado
   │                                          da clínica/paciente/conversa
   ▼
[IRIS — compreensão]  decide:
   ├── conversar direto ─────────────────────────────────┐
   └── solicitar capacidade + parâmetros                  │
   │                                                      │
   ▼                                                      │
[Core]  valida → executa → devolve FATOS                  │
   │    (ou recusa, com o motivo factual)                 │
   ▼                                                      │
[IRIS — redação]  ◄───────────────────────────────────────┘
   │  redige a resposta, restrita aos fatos autorizados
   ▼
[guarda]  verifica objetivamente o que é verificável
   │
   ▼
Paciente
```

Duas passagens de IA por turno, como hoje. A diferença não é o número de chamadas: é
**quem escolhe o caminho** entre elas.

## 4. O que é uma capacidade (Capability)

Uma **capacidade** é uma operação determinística, nomeada, que o Core sabe executar e a
Iris pode solicitar.

Uma capacidade:

- tem um **nome fechado** (vocabulário finito, nunca texto livre);
- recebe **parâmetros explícitos**, vindos da compreensão da Iris;
- é **determinística**: mesmos parâmetros, mesmo estado do mundo → mesmo resultado;
- devolve **fato**, nunca decisão de conversa;
- **valida por conta própria** — nunca confia que a Iris mandou algo coerente;
- pode **recusar**, com motivo factual.

Uma capacidade **não é**:

- uma "intenção" acumulada em estado;
- um passo de máquina de estados;
- uma ferramenta que a IA chama sozinha contra o mundo externo (a IA **solicita**; o Core
  decide se executa — a proibição de `docs/02-arquitetura.md` de "Agent autônomo com
  tools" **permanece integralmente válida**).

O conjunto exato de capacidades e a assinatura de cada uma **não são decididos por este
documento** — ver seção 11.

## 5. Como a Iris solicita capacidades

A camada de compreensão devolve, por turno, uma decisão explícita: **qual capacidade** (ou
nenhuma) e **com quais parâmetros**.

Três invariantes, independentes da forma final do contrato:

1. **Vocabulário fechado.** Nome de capacidade fora do vocabulário → o Core recusa a
   solicitação inteira. Nunca "melhor esforço", nunca aproximação.
2. **Decisão do turno, nunca estado acumulado.** A capacidade solicitada vale para *esta*
   mensagem. Nenhuma capacidade "fica ligada" para os turnos seguintes. Isto é o oposto
   direto do `dados.intencao` grudento de hoje, e é o que elimina estruturalmente a classe
   de bug do incidente de 2026-08-12 ("obrigado" reentrando em disponibilidade).
3. **Parâmetro é proposta, nunca autorização.** Tudo que a Iris envia é conferido pelo
   Core contra o banco antes de qualquer efeito. A Iris propor `agendamento_id: X` não
   autoriza tocar em X — o Core confere dono, status e clínica, exatamente como já faz
   hoje.

## 6. Como o Core responde

O Core devolve um **resultado factual** com dois desfechos possíveis:

- **executado** — com os fatos produzidos (horários encontrados, agendamento criado, dados
  do agendamento consultado, cadastro faltante identificado, etc.);
- **recusado** — com um motivo factual de vocabulário fechado (`horario_ocupado`,
  `agendamento_nao_encontrado`, `procedimento_inativo`, `cadastro_incompleto`, ...).

Nos dois casos o retorno é **fato, não texto** — quem escreve é a redatora. O Core nunca
devolve frase pronta para o paciente. (O fallback determinístico atual, em
`gerar-resposta-paciente.ts`, permanece como rede de segurança para quando a redatora
falha ou é reprovada pela guarda — ele não é "o Core falando com o paciente", é o
last-resort que já existe e já é canônico em `specs/resposta-conversacional-v1.md`.)

## 7. Como a Iris continua a conversa

Depois do resultado, a camada de redação:

- recebe os fatos autorizados daquele turno;
- redige a resposta em linguagem natural;
- passa pela guarda, que verifica **apenas o objetivamente verificável** (ex.: um horário
  citado existe nos fatos autorizados?) — a guarda **nunca** volta a interpretar
  linguagem, conforme o caso nº 2 de `docs/00-principios.md`.

Esta camada é a que **menos muda** na V2: `fatos-autorizados.ts`,
`guarda-resposta-redatora.ts`, `redator-instrucoes.ts` e
`gerar-resposta-conversacional.ts` já implementam exatamente "a Iris continua a conversa a
partir de fatos autorizados". Muda a origem dos fatos, não o mecanismo.

## 8. Componentes que permanecem

Permanecem **sem mudança de responsabilidade** (no máximo, mudança de assinatura):

| Área | Arquivos |
|---|---|
| Identificação | `identificacao.ts`, `telefone.ts` |
| Catálogo e entidades | `carregar-catalogo.ts`, `resolver-dentista.ts`, `resolver-duracao.ts` |
| Tempo e disponibilidade | `resolver-temporal.ts`, `montar-fatos-temporais.ts`, `carregar-disponibilidade.ts`, `resolver-disponibilidade.ts`, `gerar-opcoes.ts`, `intervalo.ts` |
| Agendamentos | `reservar-agendamento.ts`, `remarcar-agendamento.ts`, `cancelar-agendamento.ts`, `buscar-agendamento-ativo.ts` |
| Paciente | `persistir-paciente.ts`, `trocar-telefone-paciente.ts`, `cadastro-paciente.ts`, `validar-cadastro.ts` |
| Redação | `fatos-autorizados.ts`, `gerar-resposta-conversacional.ts`, `guarda-resposta-redatora.ts`, `redator-instrucoes.ts`, `cliente-modelo-redator-openai.ts`, `gerar-resposta-paciente.ts` |
| Memória | `historico-conversa.ts` |
| RPCs SQL | `cappia_reservar_agendamento`, `cappia_remarcar_agendamento_v2`, `cappia_cancelar_agendamento_v2`, `cappia_persistir_paciente` |

**Nenhuma migration é necessária.** Nenhuma RPC muda. Nenhuma capacidade de execução
precisa ser reescrita.

## 9. Componentes que perdem autoridade semântica

| Componente | Hoje | Na V2 |
|---|---|---|
| `decidirPorNatureza` (`orquestrador.ts`) | Decide se a classificação da IA "vale", com base em `dados.procedimento_id` | **Extinto** |
| `procedimentoAusente` (`orquestrador.ts`) | Critério que faz o Core ignorar dúvida/saudação em fluxo aberto | **Extinto** |
| `if (dados.intencao === ...)` (`orquestrador.ts`) | Roteia remarcação/cancelamento por estado persistido grudento | Substituído por capacidade solicitada no turno |
| Fallback implícito para `decidir()` | "Nada bateu, então é novo agendamento" | **Extinto** — nunca mais decisão por eliminação |
| `DECISOES_COM_CONTEXTO_DE_AGENDAMENTO` | Anexa agendamento automaticamente em 3 decisões | Substituído por capacidade de consulta, solicitada |
| `natureza_mensagem` | Gatilho de roteamento | No máximo metadado de tom para a redatora |
| `dados.intencao` | Estado acumulado, "grudento" (`aplicar-dados.ts`) | Extinto como estado; vira decisão do turno |
| `camposParaLimparAoConcluir` | Limpeza defensiva de estado operacional | Provavelmente desnecessário — sem intenção acumulada, não há o que limpar |
| `estado_conversa.dados` | "O que o Core lê para decidir o fluxo" | "Parâmetros conhecidos que a Iris está reunindo" |

## 10. Estratégia de migração incremental

Cinco etapas, cada uma com aprovação própria. **Nenhuma começa sem que a anterior esteja
medida e fechada.**

**Etapa 0 — Fundação de medição.** `cliente-modelo-openai.ts` hoje **ignora o schema do
chamador** e sempre envia `SCHEMA_PORTATIL_APROVADO`. Enquanto isso for verdade, nenhum
contrato novo pode ser medido honestamente. Esta etapa é pré-requisito de todas as outras.

> **CONCLUÍDA em 2026-08-12 — com desvio deliberado, registrado abaixo.**
>
> A leitura completa do cliente de produção mostrou que o acoplamento é **quádruplo**, não
> único: schema ignorado (~461), payload montado campo a campo com chaves fixas
> (~391-454), instrução que exige uma frase estrutural específica sob pena de exceção
> (~980), e resposta convertida para uma forma fixa que recusa qualquer chave raiz nova
> (~708). Torná-lo genérico seria reescrever o caminho por onde passa **toda mensagem de
> produção** — risco alto, para uma etapa cujo objetivo é apenas *medir*.
>
> Caminho menor adotado: **um instrumento de medição separado**, usado só por
> `src/eval/`, sem tocar em uma linha de produção.
>
> - `src/eval/cliente-medicao-openai.ts` — fiel onde importa (mesmo modelo, endpoint,
>   transporte system+user, `strict: true`, `max_output_tokens`), genérico onde precisa
>   (schema, instrução e payload passam intactos).
> - `src/eval/validacao-cliente-medicao.ts` — **prova** a fidelidade por par A/B: o mesmo
>   cliente reproduziu **0/20** no contrato de extração (idêntico ao histórico obtido com
>   o cliente de produção) e **20/20** no contrato de capacidade. A diferença é do
>   contrato, nunca do instrumento.
>
> **Dívida transferida para a Etapa 2:** quando o contrato novo for para produção, o
> cliente de produção precisará honrar o schema do chamador. A Etapa 0 não resolveu isso —
> apenas deixou de precisar disso para medir.

**Etapa 1 — Contrato de capacidade, medido.** Definir o vocabulário de capacidades e medir
contra a IA real, no padrão já usado nas quatro frentes fechadas: casos positivos,
controles negativos, repetições, conversa multi-turno **com** estado em andamento (a
lacuna explícita da sonda de 2026-08-12). Nenhuma linha de produção alterada nesta etapa.

> **CONCLUÍDA e APROVADA em 2026-08-12.** Nenhuma linha de produção alterada. Runners:
> `src/eval/medicao-capacidade-multiturno.ts` e
> `src/eval/medicao-ambiguidade-cancela-isso.ts`, ambos pelo instrumento da Etapa 0.
>
> **Vocabulário medido** (6 capacidades): `consultar_agendamento_do_paciente`,
> `consultar_disponibilidade`, `criar_agendamento`, `remarcar_agendamento`,
> `cancelar_agendamento`, `nenhuma_apenas_conversar`. Contrato **mínimo**: nenhuma regra
> por capacidade, nenhum exemplo de frase, nenhuma instrução sobre "fluxo em andamento".
> Todas as mensagens de teste vêm de conversas **reais** de WhatsApp (2026-08-07 e
> 2026-08-12), inclusive com os erros de digitação originais.
>
> **Resultado — 16 casos × 4 repetições × 3 execuções:**
>
> | execução | decisões aceitáveis | violações graves |
> |---|---|---|
> | 1 | 55/64 | 4 (caso 4e) |
> | 2 | 55/64 | 5 (4e + 1 de variância) |
> | 3 | 56/64 | 4 (caso 4e) |
>
> **Os três casos que motivaram a V2 passaram 12/12, sem nenhuma regra de prompt:**
> `"obrigado"` após reserva → não reentra em disponibilidade; `"esse horário é para qual
> dia?"` em fluxo aberto → responde a pergunta em vez de sequestrá-la; `"meu agendamento
> de amanhã está confirmado?"` → consulta em vez de disponibilidade.
>
> **A continuidade do fluxo também se manteve** (`"Avaliação né"` → disponibilidade;
> `"10hrs fica bem"` e `"sim pode confirmar"` → criar), e o caso difícil documentado em
> `specs/remarcacao-conversacional-v1.md` passou: paciente **com** agendamento pedindo
> `"queria marcar uma limpeza também"` nunca virou remarcação.
>
> **Comparação direta com o contrato de produção** (`"cancela isso"`, 8 repetições por
> célula, mesmo instrumento):
>
> | contexto | extração (produção hoje) | capacidade (V2) |
> |---|---|---|
> | A — fluxo aberto, sem agendamento (nunca cancelar) | 4/8 falsos positivos | **0/8** |
> | B — fluxo aberto + agendamento (nunca cancelar) | 4/8 falsos positivos | **8/8 falsos positivos** |
> | C — agendamento, sem fluxo (deve cancelar) | **3/8 acertos** | **8/8** |
> | **total correto** | **11/24** | **16/24** |
>
> O contrato de capacidade é melhor no conjunto e erra de forma **concentrada e
> previsível**; o contrato atual erra ~50% espalhado, inclusive falhando em reconhecer
> cancelamento legítimo em 5 de 8 tentativas.

**Etapa 2 — Despachante novo, em paralelo.** Introduzir o despacho por capacidade
**convivendo** com o roteamento atual, comparando as duas decisões sem trocar o
comportamento visível ao paciente. É o par A/B exigido pelo princípio do teste isolado
(`docs/00-principios.md`).

> **CÓDIGO PRONTO em 2026-08-13, AINDA NÃO DEPLOYADO.** Autorizada em shadow mode: a
> decisão V2 nunca executa capacidade, nunca altera estado, nunca muda a resposta — só é
> comparada com a decisão real e registrada, sem PII, para medição.
>
> Arquivos: `orquestrador-tipos.ts` (tipo `ContextoSombraCapacidadeV2`, campo opcional
> `contexto_sombra_v2` em `ResultadoOrquestrador`), `orquestrador.ts` (helper
> `montarContextoSombraV2` dentro de `finalizar` — só monta dado já calculado, zero rede,
> zero decisão), `sombra-capacidade-v2.ts` (**novo** — cliente isolado + comparador +
> logger, garantidamente nunca lança, 18 testes cobrindo cada falha possível),
> `index.ts` (único ponto de conexão real: depois de `gravarHistoricoConversa`, nunca
> `await`ado antes do `return`, via `EdgeRuntime.waitUntil`).
>
> **Investigação encerrada sobre `EdgeRuntime.waitUntil`:** o `deno check` local não
> reconhece esse global — testado em três formas (import `jsr:` direto, referência
> triple-slash, e o `deno.json` com import map **exatamente como o próprio
> `supabase functions new` gera hoje**, reproduzido do zero para o teste). Confirmado por
> fonte primária que a única PR encontrada sobre esse import (`supabase/cli#4591`) resolve
> regras de lint (`no-import-prefix`, `no-unversioned-import`), nunca esse erro de
> type-checking; a documentação oficial de ambiente de desenvolvimento não cobre o caso.
> **Decisão: essa lacuna do `deno check` local não é tratada como bloqueio de código** —
> o guard (`typeof EdgeRuntime !== "undefined"`) é seguro em runtime mesmo que o global não
> exista (confirmado via `deno run --no-check`), e o pior cenário se `waitUntil` não
> funcionar como esperado em produção é log-sombra incompleto, nunca efeito no paciente.
> Só um ambiente real resolve essa dúvida — ver próximos passos.

> **DEPLOYADO e VALIDADO em produção em 2026-08-13**, projeto operacional
> `udizowyfjnhuhgxkeayk` (clínica de teste "cleardent", instância WhatsApp real
> `CAPPIA-IRIS-976154375`), `iris-nova-mensagem` v22 → v23. Commits `39ff797` (docs +
> instrumentos de medição) e `84109ca` (código do despachante-sombra).
>
> **Mecanismo de shadow mode validado com evidência real, não só teste local:**
> mensagem real de paciente às 2026-08-13T12:46 UTC (09:46 BRT) gerou, nos logs do
> projeto:
>
> - `edge_logs`: pipeline real completo (catálogo, disponibilidade,
>   `POST /rpc/cappia_reservar_agendamento`, `PATCH estado_conversa` de limpeza) —
>   todos `200`, terminando em `12:46:35.861Z`, sem nenhuma alteração de comportamento.
> - `function_logs`: linha `sombra_v2 estado=ok decisao_atual=reserva_criada
>   capacidade_atual=criar_agendamento capacidade_v2=consultar_agendamento_do_paciente
>   certeza_v2=alta concordou=false duracao_ms=1213`, registrada em `12:46:37.274Z` —
>   **depois** do pipeline real já ter terminado, confirmando que `EdgeRuntime.waitUntil`
>   manteve o isolado vivo para a chamada-sombra em segundo plano, sem atrasar nem
>   influenciar a resposta ao paciente. Sem PII: só rótulos estruturais.
>
> **Os cinco pontos exigidos pela autorização do Gabriel (2026-08-13) confirmados:**
> `EdgeRuntime.waitUntil` executa no runtime real; a chamada V2 em shadow ocorre; a
> resposta ao paciente continua sendo produzida normalmente; uma falha/divergência da
> sombra não interfere no atendimento; os logs mostram decisão atual × capacidade V2 sem
> PII. **O mecanismo de shadow mode está validado — este é o objetivo da Etapa 2.**
>
> **Primeira divergência observada:** atual `criar_agendamento` × V2
> `consultar_agendamento_do_paciente`, certeza alta. **Nenhuma ação foi tomada sobre
> ela** — decisão do Gabriel, 2026-08-13: uma única divergência não permite concluir se
> a causa é contexto insuficiente enviado à V2, contrato de capacidade, prompt, ou um
> comportamento da V2 melhor que o atual; isso é exatamente o tipo de dado que a Etapa 2
> foi desenhada para acumular antes da Etapa 3, não para corrigir a cada ocorrência. O
> contrato, o prompt e o Core permanecem intocados por causa deste caso.

**Etapa 3 — Corte, capacidade por capacidade.** Trocar o roteamento real de uma capacidade
por vez, na ordem de menor risco: **consulta** (somente leitura, falso positivo não executa
nada) → **novo agendamento** → **remarcação** → **cancelamento** (maior risco: efeito
destrutivo). Cada corte com deploy e verificação real próprios.

**Etapa 4 — Remoção.** Só depois de todas as capacidades cortadas: remover
`decidirPorNatureza`, `procedimentoAusente`, o fallback implícito e o modelo grudento de
`dados.intencao`. Aplicação direta do princípio da remoção.

**Regra de reversibilidade:** até a Etapa 4, o roteamento antigo permanece no código e o
sistema pode voltar a ele sem migration nem perda de dado.

---

## 11. Ambiguidade conhecida, deliberadamente NÃO resolvida

**O caso 4e — `"cancela isso"` com fluxo novo em andamento E agendamento antigo
coexistindo.** Medido 12/12 (três execuções, sempre 4/4) e 8/8 no experimento dedicado: o
contrato de capacidade sempre resolve o "isso" para o agendamento existente, quando o
paciente quer abandonar o agendamento em construção.

**Decisão do Gabriel, 2026-08-12: não corrigir agora, e NÃO criar regra específica para
essa frase.** Os motivos, registrados para não serem relitigados:

1. **O Core já protege o efeito destrutivo.** `decidirCancelamento` exige confirmação
   explícita antes de executar (`specs/cancelamento-conversacional-v1.md` §4, três
   condições simultâneas). Uma escolha errada de capacidade faz a Iris **perguntar**
   *"confirma que quer cancelar sua consulta de 13/08?"* — nunca cancelar. O impacto é de
   conversa, não de dado. Isto é exatamente o "Core decide SE e COMO" da seção 0
   funcionando como projetado.
2. **Cancelamento é a última capacidade a migrar** (Etapa 3). Há tempo de sobra para
   tratar a ambiguidade no momento certo, com medição própria.
3. **Não contaminar o contrato geral por um único caso.** Acrescentar prosa ao contrato
   para resolver uma frase é exatamente o padrão que `docs/00-principios.md` manda evitar
   — e que já foi medido como contraproducente duas vezes nesta base
   (`specs/cancelamento-conversacional-v1.md`: as duas variantes com instrução explícita
   pioraram o resultado; `specs/consulta-agendamento-conversacional-v1.md`: a regra de
   relevância derrubou saudação de 11/15 para 0/15).

**Fica pendente para a migração da capacidade de cancelamento (Etapa 3, último corte).**
Nenhuma direção de solução está escolhida.

## 11.1 Limites da medição da Etapa 1

O que foi medido não cobre — e nenhuma conclusão deve ser estendida a:

- **extração de parâmetros.** Mediu-se somente a *escolha da capacidade*. Qual
  procedimento, qual data, qual agendamento — tudo isso é pergunta separada, deliberadamente
  fora, para que uma falha não se confunda com a outra.
- **conversas longas.** O histórico usado tem 1 turno anterior. Nada foi medido com
  conversas de muitos turnos, nem com histórico próximo do limite de 10 pares.
- **entradas adversariais.** Só mensagens plausíveis de pacientes reais
  (`docs/00-principios.md`, princípio dos testes realistas).
- **vocabulário maior que 6 capacidades.** Acrescentar capacidades pode mudar o
  comportamento e exige remedição.
- **variação de modelo.** Tudo em `gpt-4.1-mini-2025-04-14`. Nenhuma conclusão vale para
  outro modelo sem remedir.

**Alerta sobre linhas de base históricas.** Os números de
`specs/cancelamento-conversacional-v1.md` (0/8 falsos positivos no contexto A; 6/8 acertos
no contexto com agendamento) **não reproduziram** nesta medição — obtivemos 4/8 e 3/8. As
causas possíveis não foram isoladas: o payload replicado não é idêntico (`dentista_id`
omitido em `dados_atuais`) e pode haver deriva do modelo desde 2026-08-11. **Não usar os
números daquela spec como linha de base sem remedir.** Isso também levanta a hipótese —
não confirmada — de que a produção atual tenha risco de falso positivo de cancelamento
maior do que se acreditava; o gate de confirmação continua sendo o que impede o efeito.

**Uma expectativa do medidor estava errada, não o modelo.** O caso `"Un instante quanto?"`
foi marcado como devendo ser `nenhuma_apenas_conversar` e o modelo escolheu
`consultar_disponibilidade` 12/12 — mas a Iris acabara de prometer verificar horários, e
ir buscá-los é defensável, provavelmente melhor. Registrado como definição de caso
imprecisa, nunca como falha do contrato.

## 12. O que este documento NÃO decide

Deliberadamente em aberto, para não fixar por escrito o que ainda não foi medido:

- a **assinatura** de cada capacidade (quais parâmetros, com que forma);
- a **forma física** do contrato (campo raiz, chamada separada, dois estágios);
- se a decisão de capacidade e a extração de parâmetros ocorrem na **mesma** chamada de IA
  ou em duas;
- como o **estado parcial** (paciente informando dados aos poucos) é representado sem
  reintroduzir estado grudento;
- se `natureza_mensagem` sobrevive ou é removida;
- como resolver a ambiguidade do caso 4e (seção 11).

Cada um destes exige medição própria antes de virar decisão.

**Fechado pela Etapa 1** (deixou esta lista): o **conjunto** de 6 capacidades, validado por
medição; e o **comportamento em conversa multi-turno com fluxo aberto**, que era a lacuna
declarada da sonda de turno único.

---

## Evidência que sustenta esta proposta

**A auditoria arquitetural (2026-08-12)** mapeou o ponto exato da inversão:
`decidirPorNatureza` (`orquestrador.ts:926-954`) descarta a classificação semântica da IA
quando `dados.procedimento_id` está presente — estado de turnos anteriores prevalecendo
sobre o significado da mensagem atual.

**A auditoria de medições (2026-08-12)** verificou o principal argumento contrário. As
medições históricas (0/20, 1/20, 3/20) foram reproduzidas e confirmadas — mas elas mediam
a IA preenchendo um **campo de extração** (`alteracoes.intencao`, ao lado de CPF e data de
nascimento). Com o mesmo modelo (`gpt-4.1-mini-2025-04-14`), as mesmas 9 frases e as
mesmas 4 repetições, mudando **somente o contrato** para uma decisão de capacidade:

| contrato | consultas reconhecidas | falsos positivos |
|---|---|---|
| extração (`alteracoes.intencao`) | 0/20 | 0/16 |
| extração + 1 regra semântica | 0/20 | 0/16 |
| extração, nome ancorado (`meus_agendamentos`) | 2/20 | 0/16 |
| **decisão de capacidade** | **20/20** | **0/16** |

A barreira era o contrato, nunca a compreensão. **Ressalva explícita:** a sonda testou
turno único, sem histórico e sem fluxo em andamento — ela não prova o comportamento
multi-turno, que é justamente o objeto da Etapa 1.

---

## Relação com os documentos existentes

- `docs/00-principios.md` — **permanece canônico e inalterado.** A V2 é a aplicação do
  princípio nº 1 à camada de roteamento.
- `docs/02-arquitetura.md` — **será substituído** por este documento **se e quando** for
  aprovado. Até lá, continua vigente.
- `docs/03-seguranca.md` — inalterado. A IA continua sem acesso a banco, credenciais e
  ferramentas; continua proibido Agent autônomo.
- `specs/*-conversacional-v1.md` (novo agendamento, remarcação, cancelamento, consulta) —
  a parte **operacional** permanece válida (o que o Core executa e valida). A parte de
  **roteamento** (como o fluxo é acionado) será revista capacidade por capacidade, na
  Etapa 3.

---

## Aprovação

Este documento não tem efeito até ser aprovado explicitamente pelo Gabriel. Aprovação
significa: o princípio da seção 0 passa a valer, `docs/02-arquitetura.md` é substituído, e
a Etapa 0 da seção 10 fica autorizada a começar — **somente ela**.
