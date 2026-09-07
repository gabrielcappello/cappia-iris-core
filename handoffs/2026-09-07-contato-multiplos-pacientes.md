# Handoff — implementação de `specs/contato-multiplos-pacientes-v1.md`

**Data:** 2026-09-07
**Branch:** `feat/contato-multiplos-pacientes` (a partir de `main`, 8 commits)
**Estado:** implementação local completa. **Aguardando revisão do Codex.**
Nada aplicado em banco, nenhum push/merge/deploy, nenhuma chamada paga à IA.

## O que foi feito (8 camadas, 1 commit cada)

| Commit | Camada |
|---|---|
| `3d2801a` | Migration local (arquivo, NÃO aplicada) |
| `322cff5` | `identificacao.ts` — resolve contato → lista de pacientes; seleção mutável |
| `c3e7069` | `persistir-paciente.ts` — `contato_id` obrigatório + `paciente_id` opcional |
| `67881a9` | Contrato da interpretadora (tipos, schema, prompt, validação, adaptador OpenAI) |
| `fbea7b6` | `interpretar-e-aplicar.ts` — `validarEscolhaPaciente` + campos de turno |
| `99b2364` | `orquestrador.ts` — `decidirEscolhaPaciente`, precedência, `contato_id` na persistência |
| `8863e1f` | Paridade Core/Edge (15 arquivos) + fallback determinístico |
| `d64720f` | Gravação da seleção do `paciente_id` emitido + 9 testes de aceite |

## Verificação

- **Testes:** `node --test "core/**/*.test.ts"` — **1769 pass / 0 fail / 7 skip**
  (main baseline: 1756 pass / 0 fail / 7 skip → **+13 passando, 0 regressão**).
- **Typecheck:** `tsc --noEmit` — **0 erro novo em arquivo de produção**
  (5 erros pré-existentes em `main`, inalterados; ~316 em `.test.ts`/`eval`
  também pré-existentes — o `typecheck` já falhava em `main` por isso).
- **Paridade Core/Edge:** verificada byte a byte em TODOS os arquivos com par.
  Único divergente é `cliente-modelo-redator-openai.ts`, que **já divergia em
  `main`** (não tocado nesta frente).

## Pendências deliberadas (marcadas com TODO no código)

1. **Migration não aplicada.** `src/supabase/migrations/20260907120000_iris_nova_contato_multiplos_pacientes_v1.sql`
   é arquivo local. Ordem da transição na seção 2.2 da spec. Cobre os dois
   nomes de constraint (local e produção auto-gerado) via `DO/EXCEPTION`.
   Rollback comentado no fim do arquivo.
2. **Testes de integração `identificacao.integration.test.ts`:** `AGUARDA_MIGRATION = true`
   força skip até o schema novo estar em dev. Reativar removendo essa flag.
3. **Testes de aceite que exigem IA real** (spec seção 8, itens que dependem de
   correlação semântica "minha mãe Marta" → `paciente_id`): ficam para uma
   medição curta com a OpenAI real, separada. Os 9 determinísticos estão em
   `core/orquestrador-contato-multiplos-pacientes.test.ts`.
4. **Testes de aceite que exigem banco real** (backfill não altera comportamento,
   FK composta rejeita cross-clínica): ficam para depois da migration aplicada.
5. **Limpeza de `dados` acumulados na TROCA de paciente** (spec seção 4.4,
   "Troca de seleção nunca transporta dado acumulado"): a gravação da seleção
   está feita, mas a limpeza dos campos operacionais/cadastrais acumulados no
   `estado_conversa.dados` do paciente anterior **no momento da troca** ficou
   como TODO (o teste 15 da spec depende disso). Ver comentário em
   `orquestrador.ts`, função `decidir`, bloco "ESCOLHA DE PACIENTE".
6. **Ramo "número próprio" completo** (spec seção 4.5, passo 4): a decisão
   `pedir_vinculo_paciente_novo` existe e a pergunta é feita; a resolução do
   contato de destino a partir de `telefone_novo_paciente` (reusar cadastro
   existente vs. criar), e os campos `vinculo_novo_paciente`/`telefone_novo_paciente`
   persistindo entre turnos, **têm o contrato de dados pronto** (tipos, schema,
   prompt, validação) mas **o fluxo de orquestração que os consome ainda não
   foi escrito** — `decidirEscolhaPaciente` para em `pedir_vinculo_paciente_novo`.
   Testes 16 e 18 da spec dependem disso.

## Para o Codex revisar

- Aderência à spec aprovada (seções 1–9).
- Segurança: `validarEscolhaPaciente` (gate contra `paciente_id` de outro
  contato/clínica), FK composta na migration, `revoke all` em `contatos_whatsapp`.
- Precedência de aplicação (seção 4.4): `atendimento_para_terceiro` barra
  correção de cadastro e persistência sobre o paciente selecionado antes do turno.
- Paridade Core/Edge.
- As 6 pendências acima: confirmar que são adiáveis (não bloqueadores) para
  esta rodada, ou apontar quais precisam entrar antes.
