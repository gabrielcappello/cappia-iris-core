# Handoff — implementação de `specs/contato-multiplos-pacientes-v1.md`

**Data:** 2026-09-07 (4ª rodada, após 3ª revisão do Codex)
**Branch:** `feat/contato-multiplos-pacientes` (a partir de `main`) · último commit `5b53891`
**Estado:** **escopo funcional da spec fechado.** Aguardando 4ª revisão do Codex.
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

### 4ª rodada (`5b53891`) — 3 bloqueadores da 3ª revisão

| # | Bloqueador | Como ficou |
|---|---|---|
| 1 | Paciente com número próprio ainda usa contato/telefone do Carlos no fim do fluxo | `resolverSelecaoDePaciente` passa a devolver **`contatoDoSelecionado` + `telefoneDoSelecionado`** — a identidade EFETIVA do paciente escolhido (do contato de **destino** no ramo "número próprio", da conversa caso contrário). `decidir` encaminha esses valores a `decidirConfirmacaoOuReserva` **e** a `aplicarCorrecaoCadastro`. Efeito: UPDATE cadastral de uma Marta existente vai por `(paciente_id, contato_id DELA)` — antes a RPC recusaria como `paciente_nao_encontrado`; a reserva recebe o telefone DELA, nunca o do Carlos. Teste E2E novo: "número próprio" + paciente **existente** no destino + correção cadastral + reserva, conferindo `p_contato_id`/`p_telefone_normalizado`/`p_documento` da `persistir` e `p_paciente_id`/`p_telefone` da `reservar`. |
| 2 | `selecao_gravada === null` não prova que `dados` é da pessoa nova | No **primeiro turno** com `atendimento_para_terceiro` e um paciente resolvido (mesmo só pelo fallback "único paciente"), o snapshot anterior é limpo **agora** — mesmo que o desfecho do turno seja só `pedir_vinculo_paciente_novo`. Preserva o que o turno emitiu para o terceiro, **cadastral E operacional** (`camposEmitidosNoTurno` = união dos dois conjuntos; `limparSnapshotDoPacienteAnterior` recebe essa união). Limpeza **estrita**: se falha, propaga e a seleção não muda. Testes novos: multi-turno (Carlos tinha procedimento/data próprios → "é para minha mãe" → o snapshot dele sai já nesse turno) e preservação do que o turno emitiu para a mãe (`periodo` + `nome`). |
| 3 | Falha ao limpar a seleção após concluir era silenciada (`catch {}`) | `catch` vazio **removido** de `finalizar`. `gravarSelecaoPaciente(..., null)` já tem o CAS próprio (lê `atualizado_em`, condiciona o UPDATE, relê+retenta até 5×, **falha fechada** com `ConflitoConcorrenteError` / `ConversaNaoEncontradaError`) — a exceção agora **propaga**, mesma disciplina de `limparSnapshotDoPacienteAnterior`. Sem camada nem fallback novo. Teste novo de **falha** da limpeza (dublê que faz o UPDATE de `paciente_id: null` retornar erro): a exceção propaga e a seleção **não** fica zerada (uma dependente do mesmo contato não sobrevive como interlocutora silenciosa). |

## Arquivos alterados

### 3ª rodada
`src/core/tipos.ts` (`+ selecao_gravada`) · `src/core/identificacao.ts` (popula
`selecao_gravada`) · `src/core/orquestrador.ts` (gate `selecao_gravada`) ·
teste da frente (teste 19 A/B + 3 testes) · Edge (paridade).

### 4ª rodada (`5b53891`)
| Arquivo | Mudança |
|---|---|
| `src/core/orquestrador.ts` | `ResultadoSelecaoPaciente` ganha `contatoDoSelecionado`/`telefoneDoSelecionado`, populados em cada ramo (A/B2/B3-reuso/D/`decidirCadastroPacienteNumeroProprio`). `decidir` recebe `contatoDaListaDeEscolha`/`telefoneDaListaDeEscolha` e repassa a identidade efetiva a `decidirConfirmacaoOuReserva` e `aplicarCorrecaoCadastro`. `camposCadastraisDoTurno` → `camposEmitidosNoTurno` (cadastral + operacional); nova const `CAMPOS_LIMPAVEIS_NA_TROCA`. Limpeza "upfront" do snapshot quando `atendimento_para_terceiro` no 1º turno destaca de um paciente não-gravado. `catch {}` da limpeza da seleção ao concluir **removido**. |
| `src/core/orquestrador-contato-multiplos-pacientes.test.ts` | +4 testes (E2E número próprio c/ paciente existente + correção + reserva; multi-turno snapshot do Carlos sai no 1º turno; preservação do que o turno emitiu para a mãe; falha da limpeza da seleção ao concluir). **25 testes** no arquivo. |
| `supabase/functions/iris-nova-mensagem/orquestrador.ts` | paridade — cópia byte a byte. |

## Verificação

- **Testes (suite completa):** `node --test "core/**/*.test.ts"` —
  **1785 pass / 0 fail / 7 skip** (1792 testes; os 7 skip são `AGUARDA_MIGRATION`).
- **Runner focado da frente:** `node --test core/orquestrador-contato-multiplos-pacientes.test.ts`
  — **25 testes, 25 pass, 0 fail**.
- **Typecheck:** `npm run typecheck` (de `src/`, `tsc --noEmit`) —
  **329 erros no total; 17 non-test, todos pré-existentes em `main`** (0 nos
  arquivos de produção desta frente). Os erros no arquivo de teste da frente
  (+2 vs. 3ª rodada) são da **mesma classe pré-existente** `ClienteFalso não é
  atribuível a ClienteBancoDados` (origem: `teste-cliente-falso.ts` sem `insert`
  no `from()`, que já afeta `aplicar-dados.test.ts` e todos os
  `eval/teste-real-*.ts`). O `node --test` roda com strip-types e não é afetado.
- **Paridade Core/Edge:** varredura de todos os arquivos com par —
  único divergente `cliente-modelo-redator-openai.ts`, que **já divergia em `main`**
  (não tocado nesta frente).

## Caminho mínimo de deploy/rollback (NÃO executar — sequência reversível fechada)

**Incompatibilidade real:** a migration atual **derruba** o que a v114 (código
em produção hoje) usa —
- `DROP FUNCTION cappia_persistir_paciente(uuid,text,text,text,date,text)` (a de 6 params);
- `DROP CONSTRAINT` das UNIQUEs de telefone de `pacientes`
  (`pacientes_id_clinica_telefone_key`, `pacientes_clinica_id_telefone_normalizado_key`);
- troca a FK `estado_conversa_paciente_clinica_telefone_fk` pela forma sem telefone.

Portanto **código antigo + schema novo NÃO coexistem**: no instante em que a
migration entra, qualquer chamada da v114 a `cappia_persistir_paciente` (assinatura
antiga) falha com *function does not exist*. Não há como fazer "migra e depois
faz deploy com calma".

### Sequência mínima reversível (3 passos, cada um revertível sozinho)

1. **Migration aditiva primeiro (fase A) — schema tolera as DUAS versões de código.**
   Aplicar só a parte que NÃO remove nada:
   - `CREATE TABLE contatos_whatsapp` + backfill (passos 1–3);
   - `ADD COLUMN pacientes.contato_id` (NULLABLE) `+ vinculo` (passos 1b);
   - `ADD CONSTRAINT pacientes_id_clinica_key` + FK `pacientes_contato_clinica_fk` (passos 4, 1c);
   - `CREATE OR REPLACE FUNCTION cappia_persistir_paciente(...9 params...)` **sem** o
     `DROP` da de 6 params — as duas coexistem como overloads.
   - **NÃO** aplicar ainda: passo 5 (troca da FK de `estado_conversa`), passo 6
     (drop das UNIQUEs de telefone, `SET NOT NULL` em `contato_id`), nem o
     `DROP FUNCTION` da de 6 params.
   *Rollback da fase A:* `DROP` da função de 9 params, `DROP` das 2 constraints
   novas, `DROP COLUMN contato_id, vinculo`, `DROP TABLE contatos_whatsapp`.
   Nenhuma linha da v114 tocada — reversível sem downtime.

2. **Deploy do código desta branch (fase B).** Core/Edge desta frente só chamam a
   assinatura de 9 params e já assumem `contato_id`. Com a fase A aplicada, o
   código novo funciona; o antigo (se precisar de rollback de código) também,
   porque a função de 6 params ainda existe e as UNIQUEs de telefone continuam lá.
   *Rollback da fase B:* redeploy da v114. Sem migration reversa — a fase A é
   retrocompatível.

3. **Migration destrutiva por último (fase C), só depois da fase B estável.**
   Aplicar o restante: `DROP FUNCTION` da de 6 params, passo 5 (FK de
   `estado_conversa`), passo 6 (drop das UNIQUEs de telefone + `SET NOT NULL`),
   índice `pacientes_contato_id_idx`.
   *Rollback da fase C:* o bloco `-- ROLLBACK` no rodapé da migration
   (recriar a de 6 params a partir de `20260809120000_...`, recriar as UNIQUEs
   de telefone, reverter a FK de `estado_conversa`). **Só é seguro enquanto
   nenhum paciente novo tiver nascido com `contato_id` de outro telefone e
   nenhuma seleção cross-contato tiver sido gravada** — depois disso a fase C
   é ponto sem retorno e o rollback é o da fase A+B (redeploy v114 exige
   reverter fase C antes).

**Pré-condição já verificada (spec seção 2.2):** os pacientes atuais têm
`telefone_normalizado` — o backfill não encontra `contato_id` nulo. O `RAISE`
de guarda no passo 3 cobre o caso futuro.

**Nada disso foi executado.** A migration segue como um único arquivo
`20260907120000_...sql`; a divisão em fases A/C acima é o **plano**, não uma
segunda migration criada. A execução depende de autorização explícita por ação
e de teste prévio num branch descartável do Supabase de dev.

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

## Para o Codex revisar (4ª rodada)

- Bloqueador 1: `contatoDoSelecionado`/`telefoneDoSelecionado` chegam a
  `decidirConfirmacaoOuReserva` **e** a `aplicarCorrecaoCadastro`; no ramo
  "número próprio" são os do contato de destino. Teste E2E confere os params
  reais das duas RPCs.
- Bloqueador 2: no 1º turno `atendimento_para_terceiro`, o snapshot do
  paciente anterior sai já nesse turno (mesmo com desfecho
  `pedir_vinculo_paciente_novo`); o que o turno emitiu para o terceiro
  (cadastral + operacional) é preservado. Limpeza estrita.
- Bloqueador 3: `catch {}` removido; `gravarSelecaoPaciente(..., null)`
  propaga (CAS próprio, falha fechada). Teste de falha da limpeza cobre isso.
- Sequência de deploy/rollback fases A/B/C acima: confirmar que é reversível
  e que a fase A é retrocompatível com a v114.
- As pendências abaixo: confirmar que são de execução (banco/IA/tipagem de
  dublê), não de spec.
