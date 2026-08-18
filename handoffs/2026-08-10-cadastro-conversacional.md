# Handoff técnico — 2026-08-10

Arquivo NÃO commitado. Escrito só para dar contexto à próxima sessão sem
precisar reabrir esta janela pesada. Decisão de commitar (ou não) fica com
o Gabriel.

## 1. Estado atual do projeto

- **Último commit:** `c710797` — "feat: cadastro conversacional -- coleta de
  dados faltantes ate a reserva"
- **SHA:** `c71079747e91a95861b5d2b79c5a8512b8ee1a56` (local `main` = `origin/main`, confirmado)
- **Versão da Edge Function (`iris-nova-mensagem`, projeto `udizowyfjnhuhgxkeayk`):**
  **16**, status **ACTIVE**
- **Status do deploy:** publicado nesta sessão; bundle conferido por
  `get_edge_function` — símbolos do fluxo novo presentes
  (`calcularCadastroFaltante`, `persistirPaciente`, `normalizarCpf`,
  `cadastroDivergeDaFicha`, `descartarCadastroInvalido`), texto fixo antigo
  ("Pode me passar seu nome completo?") com **zero ocorrências**
- **Estado das migrations:** nenhuma nova nesta rodada. As de persistência de
  paciente (`cappia_persistir_paciente` + colunas cadastrais + constraints)
  já estão aplicadas nos dois projetos desde a etapa anterior
  (`bcmuqautblvjdqzhjfbw` versão `20260810010551`, `udizowyfjnhuhgxkeayk`
  versão `20260810014716`)
- **Paridade Core/Edge:** 0 arquivos divergentes, confirmado depois do deploy

## 2. O que foi concluído nesta etapa (cadastro-conversacional-v1)

- Cálculo determinístico de `dados_faltantes` sobre a visão efetiva
  (ficha persistida + conversa) — `cadastro-paciente.ts`
- Extração dos 4 campos cadastrais ativada na instrução da interpretadora
  (`nome`, `cpf`, `data_nascimento`, `email`) — campos já eram emitíveis nos
  schemas, faltava só instrução
- Validação determinística (`validar-cadastro.ts`): CPF (dígitos
  verificadores + rejeita sequência repetida), nome (sem exigir sobrenome),
  data de nascimento (real, não futura), e-mail (estrutural)
- `clinicas.automatizacoes.solicitar_email` lido no `carregar-catalogo.ts`,
  sem coluna nova
- `cadastro_necessario` itemizado (`campos_faltantes`), dispara também para
  paciente existente incompleto
- `contexto_horarios` preservado (não mais limpo) durante a coleta
- `persistirPaciente` chamado e encadeado à reserva **no mesmo
  processamento** — não existe decisão `cadastro_concluido`
- `cpf_ja_cadastrado` como desfecho conversacional simples e terminal
- Motivos estruturais da RPC tratados como invariante do Core: falham
  fechado via `ErroRpcTecnico`, nunca viram decisão conversacional
- Spec `specs/cadastro-conversacional-v1.md` fechada
- 45 testes novos (suíte: 1033, 1028 passam), typecheck limpo
- Runner real de extração: 6/6. Regressões: procedimento semântico 11/11,
  `dentistas_candidatos` 5/5
- Commit `c710797`, push, deploy Edge v16 ACTIVE

## 3. O que falta para concluir o fluxo de NOVO AGENDAMENTO

Único item real confirmado, sem contar cancelamento/remarcação/funcionalidade nova:

- **Protocolo de CPF em outro telefone / telefone pertencente a outro
  paciente** (`specs/persistencia-v1.md` §6 e §7). Hoje `cpf_ja_cadastrado`
  só **para** o fluxo com um desfecho simples ("esse CPF já consta em outro
  contato, vou pedir para a recepção ajudar"). A resolução completa
  (relacionar quem é o dono do CPF, decidir se atualiza telefone, protocolo
  de conversa para isso) não existe. Enquanto isso não for implementado, um
  paciente real que trocou de número de telefone fica sempre bloqueado nesse
  desfecho.

Fora isso, o caminho feliz completo (procedimento → dentista → data/horário →
confirmação → cadastro quando falta → persistência → reserva) está
implementado e testado de ponta a ponta.

## 4. Dívidas técnicas abertas (já conhecidas e confirmadas)

1. **`reservar-agendamento.ts` não envia `p_nome`/`p_documento`/`p_tipo_documento`**
   à RPC `cappia_reservar_agendamento`, mesmo ela aceitando esses parâmetros e
   o Core agora ter esses dados disponíveis (paciente já persistido antes da
   reserva). Consequência: `agendamentos.nome`/`agendamentos.documento`
   (colunas de snapshot desnormalizado) ficam sempre vazias nos agendamentos
   criados pelo Core novo. Achado de auditoria de etapa anterior, ainda não
   corrigido.
2. **Intermitência medida no evento diagnóstico `aceitar_opcao`** para a
   frase "na verdade quero uma limpeza" (documentada no próprio runner
   `teste-real-oferta-pendente.ts`): pré-existente a esta etapa, protegida no
   produto pela precedência do `procedimento_id` explícito sobre a oferta
   (confirmado em 4 execuções: `procedimento_id` sempre correto mesmo quando
   o evento veio espúrio). Não bloqueia nada, mas segue sem estabilizar.
3. **`estado_conversa.paciente_id` fica nulo até o turno seguinte** quando um
   paciente é persistido no meio do processamento — a reserva usa o
   `paciente_id` devolvido pela RPC diretamente, então nada depende disso no
   turno atual, mas é um estado transitório que existe e está só documentado
   na spec (§6), não resolvido.

## 5. Pendências fora do escopo (não tratar sem pedido explícito)

- **Grants de `anon`** no banco operacional (`udizowyfjnhuhgxkeayk`):
  `SELECT/INSERT/UPDATE/DELETE` completos em `pacientes`, hoje neutralizados
  por RLS ativa sem policy. Postura frágil, registrada, não corrigida.
- **`MANIFESTO.md`** (`src/supabase/migrations/MANIFESTO.md`) desatualizado —
  não cobre as migrations de `20260805` em diante.
- **CHECK de telefone divergente**: existe em `bcmuqautblvjdqzhjfbw`
  (`pacientes_telefone_formato`), não existe em `udizowyfjnhuhgxkeayk`.
  Divergência registrada, não corrigida.

## 6. Próxima etapa recomendada

Implementar o **protocolo de CPF em outro telefone / telefone de outro
paciente** (`specs/persistencia-v1.md` §6 e §7) — é o único item que falta
para fechar de verdade o `cpf_ja_cadastrado` (hoje só para, não resolve) e o
último bloqueio confirmado para considerar o fluxo de NOVO AGENDAMENTO
completo.

## 7. Arquivos canônicos para a próxima sessão ler primeiro

1. `handoffs/2026-08-10-cadastro-conversacional.md` (este arquivo)
2. `specs/cadastro-conversacional-v1.md` — spec recém-fechada, contrato do
   fluxo de coleta
3. `specs/persistencia-v1.md` — contrato do paciente; §6/§7 são a próxima
   etapa
4. `specs/novo-agendamento.md` — regras canônicas gerais do fluxo (§12, §23)
5. `docs/04-decisoes-canonicas.md` e `docs/00-principios.md`
6. `src/core/orquestrador.ts` — fluxo principal, função
   `decidirConfirmacaoOuReserva`
7. `src/core/cadastro-paciente.ts`, `persistir-paciente.ts`,
   `validar-cadastro.ts` — peças construídas nesta etapa
