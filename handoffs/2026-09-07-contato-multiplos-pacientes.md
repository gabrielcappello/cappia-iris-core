# Handoff — implementação de `specs/contato-multiplos-pacientes-v1.md`

**Data:** 2026-09-07 (6ª rodada, após 5ª revisão do Codex)
**Branch:** `feat/contato-multiplos-pacientes` (a partir de `main`)
**Estado:** **escopo funcional da spec fechado e aprovado na 5ª revisão** (código
de produção **congelado**). 6ª rodada mexeu **apenas** nas migrations. Aguardando
revisão final do Codex.
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

### 5ª rodada — 2 bloqueadores da 4ª revisão

| # | Bloqueador | Como ficou |
|---|---|---|
| 1 | Cadastro novo com número próprio perde dados acumulados em turnos anteriores | A segunda limpeza (`limparSnapshotDoPacienteAnterior` **dentro** de `decidirCadastroPacienteNumeroProprio`, que rodava **incondicionalmente** após criar o paciente e só preservava o que o turno atual emitiu) agora só roda quando ela ainda é **devida**: `limparPacienteAnterior = selecaoGravada !== null && !fluxoOutraPessoaJaAbertoAntesDoTurno`. Depois que o fluxo "outra pessoa" abriu, o `dados` acumulado (nome, cpf, nascimento, procedimento, data — que chegam em turnos diferentes) é da **própria pessoa nova** e **não** é apagado. A limpeza "upfront" também ganhou a guarda `!fluxoOutraPessoaJaAbertoAntesDoTurno` (novo ctx computado em `decidir`: campo em `dados` **e não** emitido neste turno) — só desacopla do paciente anterior **uma vez**, no turno em que o fluxo abre. Teste novo **realmente multi-turno**: `numero_proprio` com nome, nascimento, cpf, procedimento e data chegando em turnos separados → `reserva_criada` **sem repetir** procedimento/data/cadastro; `persistirPaciente` chamada **uma** vez (o INSERT), no contato de destino. |
| 2 | O plano A/B/C não era executável (arquivo único; Fase A mantinha a UNIQUE de telefone) | A migration foi **fisicamente dividida em dois arquivos** (`..._fase_a.sql` aditiva, `..._fase_c.sql` destrutiva). O arquivo único `20260907120000_..._v1.sql` foi **removido**. Deixado explícito: a **UNIQUE `(clinica_id, telefone_normalizado)` só sai na Fase C**, então **entre B e C a criação de dependente com telefone duplicado ainda não funciona** — a feature só fica pronta com a Fase C; nada regride no intervalo. Sequência A → B → C em janela controlada, **sem teste entre B e C**. *(A 6ª rodada endereçou o restante — ver abaixo.)* |

### 6ª rodada — 3 bloqueadores operacionais de migration (5ª revisão)

**Código de produção NÃO tocado** (aprovado na 5ª revisão). Só migrations + handoff.

| # | Bloqueador | Como ficou |
|---|---|---|
| 1 | A CLI (`supabase db push`) aplica **todas** as pendentes — não dá para parar após a Fase A | A Fase C **saiu de `src/supabase/migrations/`** para `src/supabase/migrations-pendentes-fase-c/` (fora do path escaneado pela CLI). Sequência real: `db push` aplica **só a Fase A**; depois do deploy B, um **comando único não-interativo** promove a Fase C — `git mv src/supabase/migrations-pendentes-fase-c/*.sql src/supabase/migrations/` — e um novo `db push` a aplica como **única** pendente. Sem seleção manual arriscada. |
| 2 | Entre A e B a v114 ainda insere paciente sem `contato_id` | A **Fase C repete o backfill** imediatamente antes do `SET NOT NULL`: `INSERT` das linhas de contato que faltarem + `UPDATE` dos pacientes órfãos, e uma **guarda `RAISE` que aborta a transação se restar algum `contato_id IS NULL`**. |
| 3 | O rollback da Fase C não era executável ("colar o `CREATE OR REPLACE`") | Rollbacks agora são **arquivos dedicados, diretamente executáveis**: `src/supabase/rollbacks/20260907120000_..._v1_fase_a_rollback.sql` e `src/supabase/migrations-pendentes-fase-c/20260907130000_..._v1_fase_c_rollback.sql`. O da Fase C **contém a definição COMPLETA da RPC de 6 params** (corpo idêntico ao de `20260809120000_...`), na ordem correta (UNIQUEs de telefone → FK de `estado_conversa` → `DROP NOT NULL` → RPC de 6 → drop da de 9). Os blocos comentados de rollback no rodapé das migrations foram substituídos por um ponteiro para esses arquivos. |

## Arquivos alterados

### 3ª rodada
`src/core/tipos.ts` (`+ selecao_gravada`) · `src/core/identificacao.ts` (popula
`selecao_gravada`) · `src/core/orquestrador.ts` (gate `selecao_gravada`) ·
teste da frente (teste 19 A/B + 3 testes) · Edge (paridade).

### 4ª rodada (`5b53891`)
| Arquivo | Mudança |
|---|---|
| `src/core/orquestrador.ts` | `ResultadoSelecaoPaciente` ganha `contatoDoSelecionado`/`telefoneDoSelecionado`, populados em cada ramo (A/B2/B3-reuso/D/`decidirCadastroPacienteNumeroProprio`). `decidir` recebe `contatoDaListaDeEscolha`/`telefoneDaListaDeEscolha` e repassa a identidade efetiva a `decidirConfirmacaoOuReserva` e `aplicarCorrecaoCadastro`. `camposCadastraisDoTurno` → `camposEmitidosNoTurno` (cadastral + operacional); nova const `CAMPOS_LIMPAVEIS_NA_TROCA`. Limpeza "upfront" do snapshot quando `atendimento_para_terceiro` no 1º turno destaca de um paciente não-gravado. `catch {}` da limpeza da seleção ao concluir **removido**. |
| `src/core/orquestrador-contato-multiplos-pacientes.test.ts` | +4 testes. |
| `supabase/functions/iris-nova-mensagem/orquestrador.ts` | paridade — cópia byte a byte. |

### 5ª rodada
| Arquivo | Mudança |
|---|---|
| `src/core/orquestrador.ts` | `decidirCadastroPacienteNumeroProprio` recebe `limparPacienteAnterior: boolean` — a limpeza pós-criação só roda quando ainda devida (`selecaoGravada !== null && !fluxoOutraPessoaJaAbertoAntesDoTurno`). `resolverSelecaoDePaciente` recebe `fluxoOutraPessoaJaAbertoAntesDoTurno`; a limpeza "upfront" ganhou a mesma guarda. `decidir` computa `fluxoOutraPessoaJaAbertoAntesDoTurno` (campo em `dados` **e não** emitido neste turno). |
| `src/core/orquestrador-contato-multiplos-pacientes.test.ts` | +1 teste (multi-turno real "número próprio", cadastro + operacional em turnos separados → `reserva_criada` sem repetição). **26 testes** no arquivo. |
| `src/supabase/migrations/20260907120000_..._v1.sql` | **removido** — substituído por Fase A + Fase C. |
| `supabase/functions/iris-nova-mensagem/orquestrador.ts` | paridade — cópia byte a byte. |

### 6ª rodada — só migrations
| Arquivo | Mudança |
|---|---|
| `src/supabase/migrations/20260907120000_..._v1_fase_a.sql` | **atualizado** — cabeçalho descreve o esquema de dois diretórios; bloco de rollback comentado no rodapé substituído por ponteiro para o arquivo dedicado. |
| `src/supabase/rollbacks/20260907120000_..._v1_fase_a_rollback.sql` | **novo** — rollback da Fase A, diretamente executável. |
| `src/supabase/migrations-pendentes-fase-c/20260907130000_..._v1_fase_c.sql` | **movido** de `migrations/` para cá (fora do path da CLI) + **re-backfill + guarda `RAISE`** antes do `SET NOT NULL`; rollback comentado substituído por ponteiro. |
| `src/supabase/migrations-pendentes-fase-c/20260907130000_..._v1_fase_c_rollback.sql` | **novo** — rollback da Fase C, diretamente executável, **com a RPC de 6 params completa**. |

## Verificação

- **Código de produção da 6ª rodada:** nenhuma mudança (congelado após a
  aprovação da 5ª revisão). Os números abaixo são os da 5ª rodada, inalterados.
- **Testes (suite completa):** `node --test "core/**/*.test.ts"` —
  **1786 pass / 0 fail / 7 skip** (1793 testes; os 7 skip são `AGUARDA_MIGRATION`).
- **Runner focado da frente:** `node --test core/orquestrador-contato-multiplos-pacientes.test.ts`
  — **26 testes, 26 pass, 0 fail**.
- **Typecheck:** `npm run typecheck` (de `src/`, `tsc --noEmit`) —
  **17 erros non-test, todos pré-existentes em `main`** (0 nos arquivos de
  produção desta frente). Os erros no arquivo de teste da frente são da
  **mesma classe pré-existente** `ClienteFalso não é atribuível a
  ClienteBancoDados` (origem: `teste-cliente-falso.ts` sem `insert` no
  `from()`, que já afeta `aplicar-dados.test.ts` e todos os
  `eval/teste-real-*.ts`). O `node --test` roda com strip-types e não é afetado.
- **Paridade Core/Edge:** varredura de todos os arquivos com par —
  único divergente `cliente-modelo-redator-openai.ts`, que **já divergia em `main`**
  (não tocado nesta frente).

## Caminho mínimo de deploy/rollback (NÃO executar — duas migrations físicas)

**Incompatibilidade real:** o modelo novo **derruba** o que a v114 (código em
produção hoje) usa —
- `DROP FUNCTION cappia_persistir_paciente(uuid,text,text,text,date,text)` (a de 6 params);
- `DROP CONSTRAINT` das UNIQUEs de telefone de `pacientes`
  (`pacientes_id_clinica_telefone_key`, `pacientes_clinica_id_telefone_normalizado_key`).
  A RPC de 6 params faz `INSERT ... ON CONFLICT (clinica_id, telefone_normalizado)`,
  que **exige** essa UNIQUE — removê-la quebra a v114;
- troca a FK `estado_conversa_paciente_clinica_telefone_fk` pela forma sem telefone.

Como não dá para aplicar "partes" de um arquivo único com segurança, **e a
CLI Supabase (≥ 2.111.0) não tem opção de parar após a primeira migration
pendente** (`supabase db push` aplica todas as pendentes em
`src/supabase/migrations/`), a migration foi **dividida em dois arquivos, em
diretórios diferentes**:

| Arquivo | Diretório | Papel |
|---|---|---|
| `20260907120000_..._v1_fase_a.sql` | `src/supabase/migrations/` (já no path que a CLI escaneia) | **Fase A — aditiva.** `contatos_whatsapp`; `pacientes.contato_id` (NULLABLE) + `vinculo`; backfill + guarda `RAISE`; `pacientes_id_clinica_key`; FK `pacientes_contato_clinica_fk`; índice `pacientes_contato_id_idx`; RPC de **9 params `CREATE OR REPLACE` AO LADO** da de 6 (nenhum `DROP`). Não remove nada — a v114 continua íntegra. |
| `20260907130000_..._v1_fase_c.sql` + seu rollback | `src/supabase/migrations-pendentes-fase-c/` (**fora** do path da CLI) | **Fase C — destrutiva.** Re-backfill + guarda `RAISE` antes do `SET NOT NULL`; troca a FK de `estado_conversa`; `SET NOT NULL` em `contato_id`; `DROP` das UNIQUEs de telefone de `pacientes`; `DROP FUNCTION` da RPC de 6 params. |

Rollbacks — **arquivos dedicados, diretamente executáveis** (nada a colar):
- `src/supabase/rollbacks/20260907120000_..._v1_fase_a_rollback.sql`;
- `src/supabase/migrations-pendentes-fase-c/20260907130000_..._v1_fase_c_rollback.sql`
  (acompanha a migration da Fase C; **contém a definição COMPLETA da RPC de
  6 params**).

### Sequência obrigatória: A → B → C (janela controlada, sem seleção manual)

1. **Fase A** — `supabase db push`. A Fase C nem está no diretório escaneado,
   então **só a Fase A é aplicada**. A v114 continua funcionando; **nada
   regride**. *Rollback:* aplicar
   `src/supabase/rollbacks/20260907120000_..._v1_fase_a_rollback.sql`
   (executável; nenhuma linha da v114 tocada — reversível sem downtime).

2. **Deploy B** — código Core/Edge desta branch. A partir daqui o código novo
   chama **só** a RPC de 9 params e assume `contato_id`.
   **A funcionalidade "dependente / outra pessoa com o mesmo número" AINDA NÃO
   funciona entre B e C:** o INSERT de um segundo paciente com o telefone do
   titular colide com a UNIQUE `(clinica_id, telefone_normalizado)` que só a
   Fase C remove. **Nada regride** nesse intervalo — a feature é nova.
   *Rollback da fase B:* redeploy da v114 (a Fase A é retrocompatível — a RPC
   de 6 params e as UNIQUEs ainda existem).

3. **Fase C** — promover o arquivo para o path da CLI com **um comando único e
   não-interativo** e aplicar, **imediatamente após B, SEM TESTE ENTRE B E C**
   (o teste da sequência inteira já foi feito no branch descartável):
   ```
   git mv src/supabase/migrations-pendentes-fase-c/*.sql src/supabase/migrations/
   supabase db push
   ```
   Nesse momento a Fase C é a **única** migration pendente — não há seleção
   manual. O rollback da Fase C (`..._fase_c_rollback.sql`, mover junto para
   `src/supabase/rollbacks/`) é **diretamente executável** e recria a RPC de
   6 params por inteiro. **Válido apenas enquanto nenhum dado novo do modelo
   multi-paciente existir** (nenhum dependente com telefone duplicado, nenhuma
   seleção cross-contato gravada) — depois disso haverá linhas que violam as
   UNIQUEs recriadas, e o rollback deixa de ser seguro.

**Entre A e B a v114 ainda insere paciente sem `contato_id`** (a RPC de 6
params não preenche a coluna). Por isso a **Fase C repete o backfill** —
`INSERT` dos contatos que faltarem + `UPDATE` dos pacientes órfãos — e roda
uma **guarda `RAISE` que aborta se restar algum `contato_id IS NULL`**,
imediatamente antes do `SET NOT NULL`.

**Pré-condição já verificada (spec seção 2.2):** os pacientes atuais têm
`telefone_normalizado`.

**Nada disso foi executado.** Os arquivos são candidatos locais; a aplicação
depende de autorização explícita por ação e de teste prévio da sequência
A→B→C num branch descartável do Supabase de dev.

## O que continua pendente (NÃO são requisitos funcionais da spec)

1. **Aplicar as migrations (Fase A e Fase C).** Candidatas locais. Antes de
   aplicar: rodar a sequência A → B → C num **branch descartável** do Supabase
   de dev, conferir o backfill contra dados reais, e autorização explícita do
   Gabriel por ação. Fase C só depois do deploy B, sem teste entre B e C.
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

## Para o Codex revisar (6ª rodada — só migrations)

- **Bloqueador 1** (seleção manual arriscada): a Fase C está em
  `src/supabase/migrations-pendentes-fase-c/`, **fora** do path que
  `supabase db push` escaneia. `db push` aplica só a Fase A. Depois do deploy
  B, `git mv src/supabase/migrations-pendentes-fase-c/*.sql
  src/supabase/migrations/` + `db push` — Fase C é a única pendente. Um comando
  não-interativo, sem seleção.
- **Bloqueador 2** (v114 insere sem `contato_id` entre A e B): a Fase C
  **repete o backfill** (INSERT dos contatos faltantes + UPDATE dos órfãos) e
  roda uma **guarda `RAISE` que aborta se restar `contato_id IS NULL`**,
  imediatamente antes do `SET NOT NULL`.
- **Bloqueador 3** (rollback da Fase C não-executável): rollbacks são
  **arquivos dedicados diretamente executáveis**
  (`src/supabase/rollbacks/..._fase_a_rollback.sql`,
  `src/supabase/migrations-pendentes-fase-c/..._fase_c_rollback.sql`). O da
  Fase C tem a **RPC de 6 params por inteiro** e a ordem correta (UNIQUEs de
  telefone → FK de `estado_conversa` → `DROP NOT NULL` → recria RPC de 6 →
  drop da de 9).
- Código de produção **não foi tocado** nesta rodada (aprovado na 5ª revisão).
- As pendências abaixo: confirmar que são de execução (banco/IA/tipagem de
  dublê), não de spec.
