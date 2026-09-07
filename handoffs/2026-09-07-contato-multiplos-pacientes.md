# Handoff — implementação de `specs/contato-multiplos-pacientes-v1.md`

**Data:** 2026-09-07 (2ª rodada, após revisão do Codex)
**Branch:** `feat/contato-multiplos-pacientes` (a partir de `main`, 11 commits)
**Estado:** **escopo funcional da spec fechado.** Aguardando nova revisão do Codex.
Nada aplicado em banco, nenhum push/merge/deploy, nenhuma chamada paga à IA.

## O que foi feito

### 1ª rodada (8 commits) — fundação
migration local · `identificacao.ts` (contato → lista) · `persistir-paciente.ts`
(`contato_id`/`paciente_id`) · contrato da interpretadora (5 campos, schema,
prompt, adaptador OpenAI) · `validarEscolhaPaciente` · `decidirEscolhaPaciente`
+ precedência · paridade Edge · gravação da seleção do `paciente_id` emitido.

### 2ª rodada (`3c2e837`) — requisitos que o Codex apontou como não adiáveis
| # | Requisito | Como ficou |
|---|---|---|
| 1 | Ramo `numero_proprio` completo | `resolverSelecaoDePaciente` consome `vinculo_novo_paciente`/`telefone_novo_paciente` persistidos; a cada turno relê o telefone e **resolve de novo o contato de destino** (`resolverContatoDeDestino`, sem criar); destino com 1 → reutiliza · >1 → `aguardando_escolha_paciente` sobre a lista **do destino** · 0 → coleta cadastro e cria com o contato de destino (`decidirCadastroPacienteNumeroProprio`); nova decisão `pedir_telefone_paciente_novo`; **nunca INSERT antes da busca**. Sem coluna nova. |
| 2 | Limpeza na troca | Ao trocar a seleção, limpa em `dados` os campos cadastrais + operacionais do paciente anterior no **mesmo processo** (`limparCamposDeEstadoConcluido` + `gravarSelecaoPaciente`). |
| 3 | Limpar `paciente_id` ao concluir/desistir | `concluiuOuDesistiuDeFluxo`: reserva/remarcação/cancelamento criado + desistência → `gravarSelecaoPaciente(..., null)` (agora usado em produção) + `vinculo_novo_paciente`/`telefone_novo_paciente` saem de `dados`. |
| 4 | Seleção cross-contato | `identificarConversa` aceita a seleção que aponta para paciente do contato **de destino** (resolvido relendo `telefone_novo_paciente` de `dados`). `resolverPacienteSelecionado` deixa de descartar a Marta. |
| 5 | `gravarSelecaoPaciente` não continua em silêncio | CAS próprio (lê `atualizado_em`, condiciona o UPDATE, relê+retenta 5×); **falha fechada** (`ConversaNaoEncontradaError`) quando 0 linhas por motivo que não é corrida; idempotente. Sem camada nova. |
| 6 | Sombra V2 | `aguardando_escolha_paciente`/`pedir_vinculo_paciente_novo`/`pedir_telefone_paciente_novo` → `'nenhuma_apenas_conversar'`. |
| 7 | Sem frase fixa nova | Removidas as 2 frases; as 3 decisões reusam a rede genérica **já existente** (mesma frase de `mensagem_nao_compreendida`). A redatora escreve o texto real (`redator-instrucoes.ts`). |
| 8 | Testes 15, 16, 18, 19 + limpeza pós-conclusão | 8 novos em `core/orquestrador-contato-multiplos-pacientes.test.ts` (25 no total). |
| 9 | Cabeçalho da migration | Corrigido: **candidata local compatível com o schema verificado, pendente de teste em branch descartável e de autorização explícita**. Sem "migration irmã", não aplicada. |

## Verificação

- **Testes:** `node --test "core/**/*.test.ts"` — **1777 pass / 0 fail / 7 skip**
  (main baseline: 1756 pass / 0 fail / 7 skip → **+21 passando, 0 regressão**).
- **Typecheck:** `tsc --noEmit` — **5 erros pré-existentes em `main`, inalterados**
  (0 novo em arquivo de produção). Dois deles ("lacks ending return" em
  `gerar-resposta-paciente.ts` e `sombra-capacidade-v2.ts`) são o quirk conhecido
  do TS com `switch` exaustivo sem `default` — os `case`s novos estão cobertos.
- **Paridade Core/Edge:** byte a byte em TODOS os arquivos com par. Único
  divergente: `cliente-modelo-redator-openai.ts`, que **já divergia em `main`**
  (não tocado nesta frente).

## O que continua pendente (NÃO são requisitos funcionais da spec)

1. **Aplicar a migration.** É candidata local. Antes de aplicar: rodar num
   **branch descartável** do Supabase de dev, conferir o backfill contra dados
   reais, e autorização explícita do Gabriel por ação.
2. **Testes de integração** (`identificacao.integration.test.ts`,
   `persistir-paciente` contra banco real): `AGUARDA_MIGRATION` força skip até o
   schema novo estar em dev.
3. **Medição curta com a IA real** dos casos que dependem de correlação semântica
   ("minha mãe Marta" → `paciente_id`; `atendimento_para_terceiro`/
   `outra_pessoa_alem_das_listadas`/`vinculo_novo_paciente` a partir de linguagem
   natural). O contrato (tipos/schema/prompt/validação) está pronto; falta a
   evidência de que o modelo real emite os campos como esperado.

## Nota de desenho (para o Codex avaliar)

- O sinal de que uma **pergunta de vínculo/telefone está pendente** NÃO vai ao
  payload do modelo como marcador dedicado. A interpretadora emite
  `vinculo_novo_paciente`/`telefone_novo_paciente` a partir do conteúdo da
  mensagem (vocabulário fechado), e esses campos **persistem em `dados`** entre
  turnos — mesmo mecanismo de `intencao`. Não há `aguardando_resposta`
  estruturado para essas decisões (`declarar-pergunta-pendente.ts` cai no
  `default: null`). Se a medição com IA real mostrar que falta contexto, um
  marcador no payload é a extensão aditiva natural — não foi feito porque a spec
  não o exige e o padrão de `intencao` já cobre o caso normal.

## Para o Codex revisar

- Ramo `numero_proprio`: reuso vs. criação no contato de destino; a seleção
  cross-contato e sua revalidação a cada turno; nenhum INSERT antes da busca.
- Limpezas: na troca (mesmo processo) e ao concluir/desistir.
- `gravarSelecaoPaciente`: CAS, falha fechada, idempotência — sem camada nova.
- Ponto 7: a rede genérica reusada é aceitável, ou as decisões de escolha de
  paciente precisam de outro tratamento de fallback?
- As 3 pendências acima: confirmar que são de execução (banco/IA), não de spec.
