# Handoff — implementação de `specs/contato-multiplos-pacientes-v1.md`

**Data:** 2026-09-07 (3ª rodada, após 2ª revisão do Codex)
**Branch:** `feat/contato-multiplos-pacientes` (a partir de `main`)
**Estado:** **escopo funcional da spec fechado.** Aguardando 3ª revisão do Codex.
Nada aplicado em banco, nenhum push/merge/deploy, nenhuma chamada paga à IA.

## O que foi feito

### 1ª rodada (8 commits) — fundação
migration local · `identificacao.ts` (contato → lista) · `persistir-paciente.ts`
(`contato_id`/`paciente_id`) · contrato da interpretadora (6 campos raiz, schema,
prompt, adaptador OpenAI) · `validarEscolhaPaciente` · `decidirEscolhaPaciente`
+ precedência · paridade Edge · gravação da seleção do `paciente_id` emitido.

### 2ª rodada (`3c2e837`) — requisitos que o Codex apontou como não adiáveis
Ramo `numero_proprio` completo (reuso/criação no contato de destino, seleção
cross-contato revalidada a cada turno) · limpeza na troca · limpar `paciente_id`
ao concluir/desistir · `gravarSelecaoPaciente` com CAS e falha fechada · sombra
V2 · remoção das 2 frases fixas · cabeçalho da migration.

### 3ª rodada (esta) — 4 bloqueadores da 2ª revisão + percurso ponta-a-ponta
| # | Bloqueador | Como ficou |
|---|---|---|
| 1 | Lista do destino montada com `identificacao.pacientes` (contato atual) | `processarMensagem` resolve o contato de destino **antes** da chamada da interpretadora: `pacientesParaEscolha` = lista do destino quando `telefone_novo_paciente` está em `dados` (relido a cada turno via `resolverContatoDeDestino`), senão a do contato atual. A **mesma** lista vai ao payload (`pacientes_do_contato`), ao `validarEscolhaPaciente` e ao `decidir`. Teste 19 reforçado: par A/B sobre o **payload real** — Marta/Joana chegam; um ID do destino é aceito; o ID do Carlos é rejeitado. |
| 2 | `vinculo_novo_paciente = 'dependente'` caía no default `titular` | `decidirConfirmacaoOuReserva` recebe `vinculoParaCriacao` e, no INSERT (`pacienteId === null`), envia **sempre** `vinculo` explícito (`'dependente'` quando o fluxo respondeu "vinculado a este número", senão `'titular'`). Teste novo assere `p_vinculo === 'dependente'` **nos parâmetros reais da RPC**. |
| 3 | Troca limpava o banco mas seguia processando com o `dados` local antigo; limpeza era best-effort | `limparSnapshotDoPacienteAnterior` é **estrito** (propaga erro); `trocarSelecaoPara` só grava a nova seleção **depois** da limpeza ter sucesso — se falhar, a seleção **não muda**. `resolverSelecaoDePaciente` devolve o `dados` **relido do banco** + o `cadastro` da pessoa certa; `decidir` reatribui `dados` e `cadastroFicha` — daí em diante nenhum procedimento/data/horário do paciente anterior é consultado ou reservado. |
| 4 | Troca apagava campos da **nova** pessoa | Listas separadas: `CAMPOS_OPERACIONAIS_LIMPOS_NA_TROCA` (sempre limpos) e `CAMPOS_CADASTRAIS_LIMPOS_NA_TROCA` (limpos **só** os que o turno atual **não** emitiu para o terceiro — `camposCadastraisDoTurno`). Teste novo distingue dado antigo de Carlos (operacional + `email` do snapshot → limpos) de dado novo de Marta (`nome`/`data_nascimento` emitidos no turno → preservados). |
| + | Distinguir "Carlos é o único paciente" de "Carlos foi selecionado de fato" | Nova travessia `selecao_gravada` (valor **bruto** de `estado_conversa.paciente_id`, separado do resolvido) em `ResultadoIdentificacao.conversa` → `decidir` → `resolverSelecaoDePaciente`. `trocarSelecaoPara` só limpa o snapshot quando havia **seleção gravada de verdade**; com `selecao_gravada === null` o `dados` acumulado é do próprio fluxo do terceiro e **não** é apagado (só grava a seleção). Sem isso, cada turno do fluxo `dependente`/`numero_proprio` apagava o cadastro/procedimento que o próprio fluxo acumulou. |
| + | Percurso real ponta-a-ponta | Teste determinístico: Carlos com procedimento/data já em `dados`, `vinculo_novo_paciente: 'dependente'` + cadastro da mãe acumulado, confirma → `reserva_criada`. A RPC `cappia_persistir_paciente` recebe `p_vinculo='dependente'`, `p_contato_id` = contato do Carlos, `p_nome`/`p_documento`/`p_data_nascimento` = **da Marta**; `cappia_reservar_agendamento` recebe `p_paciente_id` = o da Marta recém-criada (≠ o do Carlos), `p_nome`/`p_documento` = da Marta. A ficha do Carlos no banco fica **bit a bit intacta** (`assert.deepEqual`). Seleção volta a `null` ao concluir; `vinculo_novo_paciente` sai de `dados`. |

## Arquivos alterados (3ª rodada)

| Arquivo | Mudança |
|---|---|
| `src/core/tipos.ts` | `+ selecao_gravada: string \| null` em `ResultadoIdentificacao.conversa`. |
| `src/core/identificacao.ts` | popula `selecao_gravada: conversa.paciente_id` (valor bruto). |
| `src/core/orquestrador.ts` | `decidir` recebe `selecaoGravada`; `resolverSelecaoDePaciente` recebe `selecaoGravada` no ctx; `trocarSelecaoPara` gateado por `selecao_gravada` real. (As mudanças #1–#4 já vinham da 2ª rodada; esta rodada fechou o gate.) |
| `src/core/orquestrador-contato-multiplos-pacientes.test.ts` | teste 19 reforçado (par A/B sobre payload real); +3 testes (`dependente`→`p_vinculo`; troca preserva cadastro do terceiro; percurso ponta-a-ponta). **21 testes no total** no arquivo. |
| `supabase/functions/iris-nova-mensagem/{tipos,identificacao,orquestrador}.ts` | paridade — cópia byte a byte das mudanças acima. |

## Verificação

- **Testes (suite completa):** `node --test "core/**/*.test.ts"` —
  **1781 pass / 0 fail / 7 skip** (1788 testes; os 7 skip são `AGUARDA_MIGRATION`).
- **Runner focado da frente:** `node --test core/orquestrador-contato-multiplos-pacientes.test.ts`
  — **21 testes, 21 pass, 0 fail** (a versão anterior do handoff dizia "25";
  o número real é 21).
- **Typecheck:** `npm run typecheck` (de `src/`, `tsc --noEmit`) —
  **327 erros no total; 324 já existiam em `d6bab4b` (baseline da 2ª rodada)**.
  Delta = **+3**, todos no arquivo de teste da frente e da **mesma classe
  pré-existente** `ClienteFalso não é atribuível a ClienteBancoDados`
  (origem: `teste-cliente-falso.ts` sem `insert` no `from()` — limitação de
  tipagem do dublê que já afeta `aplicar-dados.test.ts` e todos os
  `eval/teste-real-*.ts`). **0 erro novo em arquivo de produção** (Core ou Edge).
  O `node --test` roda com strip-types e não é afetado.
- **Paridade Core/Edge:** varredura de todos os arquivos com par —
  único divergente `cliente-modelo-redator-openai.ts`, que **já divergia em `main`**
  (não tocado nesta frente).

## O que continua pendente (NÃO são requisitos funcionais da spec)

1. **Aplicar a migration.** Candidata local. Antes de aplicar: rodar num
   **branch descartável** do Supabase de dev, conferir o backfill contra dados
   reais, e autorização explícita do Gabriel por ação.
2. **Testes de integração** (`identificacao.integration.test.ts`,
   `persistir-paciente` contra banco real): `AGUARDA_MIGRATION` força skip até o
   schema novo estar em dev.
3. **Medição curta com a IA real** dos casos que dependem de correlação semântica
   ("minha mãe Marta" → `paciente_id`; `atendimento_para_terceiro` /
   `outra_pessoa_alem_das_listadas` / `vinculo_novo_paciente` a partir de
   linguagem natural). O contrato (tipos/schema/prompt/validação) está pronto;
   falta a evidência de que o modelo real emite os campos como esperado.
4. **`ClienteFalso.from` sem `insert`** (tipagem do dublê). Pré-existente,
   fora do escopo desta frente; some ao adicionar `insert` ao dublê, o que
   toca todos os arquivos de teste — assunto para outra frente.

## Nota de desenho (para o Codex avaliar)

- **`selecao_gravada` vs. paciente resolvido.** `resolverPacienteSelecionado`
  resolve o único paciente do contato mesmo sem seleção escrita (fallback (c),
  comportamento normal). No fluxo "outra pessoa"/`dependente`, esse fallback
  faria a troca "de Carlos para o terceiro" limpar o snapshot que é do PRÓPRIO
  fluxo do terceiro. A distinção nova: só uma seleção **gravada** em
  `estado_conversa.paciente_id` conta como "paciente anterior" com snapshot a
  limpar. Aditivo, um campo, sem estado novo.
- O sinal de "pergunta de vínculo/telefone pendente" continua **sem marcador
  dedicado** no payload: a interpretadora emite `vinculo_novo_paciente` /
  `telefone_novo_paciente` do conteúdo da mensagem (vocabulário fechado) e eles
  **persistem em `dados`** entre turnos — mesmo mecanismo de `intencao`. Se a
  medição com IA real mostrar falta de contexto, um marcador no payload é a
  extensão aditiva natural.

## Para o Codex revisar

- Bloqueador 1: a lista do destino resolvida antes da interpretadora chega
  igual ao payload, ao `validarEscolhaPaciente` e ao `decidir`? Par A/B do
  teste 19 cobre o payload real.
- Bloqueador 2: `p_vinculo='dependente'` no INSERT real da RPC.
- Bloqueador 3: nada do paciente anterior é consultado/reservado após a troca;
  limpeza estrita (se falha, seleção não muda).
- Bloqueador 4 + gate `selecao_gravada`: campos do terceiro emitidos no turno
  são preservados; só o snapshot do anterior (quando havia seleção gravada) é
  limpo.
- Percurso ponta-a-ponta: reserva usa exclusivamente `paciente_id`/cadastro/
  contato do terceiro; ficha do Carlos intacta.
- As pendências acima: confirmar que são de execução (banco/IA/tipagem de
  dublê), não de spec.
