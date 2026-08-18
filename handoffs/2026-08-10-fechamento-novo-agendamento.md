# Handoff — 2026-08-10 (fechamento: novo agendamento)

## 1. Estado atual

- **Commit:** `633e66f34654668d91ae78106485941e32dfb9f1` — "feat: troca de
  telefone quando CPF ja pertence a outro cadastro".
- **SHA:** igual ao commit acima (HEAD).
- **Edge Function** `iris-nova-mensagem` (projeto operacional
  `udizowyfjnhuhgxkeayk`): **versão 17, status ACTIVE**, `verify_jwt: true`.
- **main = origin/main:** confirmado (`git rev-parse main` e
  `git rev-parse origin/main` idênticos; push já refletido, sem commits
  pendentes de envio).
- **Paridade Core/Edge:** confirmada — diff 0 nos 11 arquivos do Core
  sincronizados (`cliente-modelo-openai.ts`, `contexto-horarios.ts`,
  `fatos-autorizados.ts`, `gerar-resposta-paciente.ts`,
  `interpretacao-extrator.ts`, `interpretacao-instrucoes.ts`,
  `interpretacao-tipos.ts`, `interpretar-e-aplicar.ts`,
  `orquestrador-tipos.ts`, `orquestrador.ts`, `tipos.ts`) mais
  `trocar-telefone-paciente.ts`.

## 2. O que está definitivamente concluído

- **Persistência de paciente** — `cappia_persistir_paciente` corrigida no
  operacional (gravava em `telefone_normalizado`, coluna `GENERATED ALWAYS`;
  bloqueava todo paciente novo em produção). Corrigida para gravar na coluna
  fonte (`telefone`), provado com par A/B de `EXPLAIN` e transação abortada.
- **Cadastro conversacional** — coleta de dados faltantes até a reserva
  (fechado em sessão anterior, commit `c710797`, não tocado nesta sessão).
- **Troca de telefone por CPF (`persistencia-v1.md` §6)** — implementada,
  testada (suíte, SQL nos dois bancos, IA real) e deployada.

**Principais decisões canônicas adotadas:**
- CPF já cadastrado com outro telefone → Iris **pergunta** se deve atualizar;
  aceite atualiza e segue a reserva; recusa mantém o cadastro como está e
  encerra sem escrita. Revoga a regra antiga de `persistencia-v1.md` §6
  (recusa deixava o agendamento seguir normalmente).
- `pacientes.telefone_alterado_em` como única coluna de auditoria aditiva —
  `telefone_alterado_origem` e "natureza da alteração" descartadas por falta
  de consumidor real, com evidência de banco registrada em
  `specs/cpf-outro-telefone-v1.md`.
- Contrato de interpretação **forma única**: um só evento
  `aceitar_troca_telefone` (mesma forma de `aceitar_opcao`, sem união
  discriminada); a recusa é **derivada** de `natureza_mensagem`, nunca
  emitida como evento próprio. Escolhido por medição A/B/C contra a IA real
  (6/6 vs. 4/6 vs. 3/6).
- Sinais incompatíveis: **negação vence o evento**; **dúvida nunca
  autoriza** (nem aceita nem recusa) — ambos os guards adicionados após
  evidência medida de falso-aceite.
- §7 (`telefone_de_outro_paciente`) é **detectada e parada**, nunca
  resolvida — RPC devolve o motivo, Core encaminha à recepção, decisão
  deliberada de escopo.
- Os dois bancos (dev/operacional) têm **corpos SQL diferentes de
  propósito** para a mesma RPC nova, pelo mesmo motivo já estabelecido na
  Etapa 1: schemas físicos divergentes, contrato observável idêntico.

## 3. O que NÃO está concluído

- **`persistencia-v1.md` §7** (telefone atual da conversa já pertence a
  outro paciente da clínica) — apenas detectado e encaminhado à recepção,
  nunca resolvido pela Iris. Fora de escopo por decisão explícita, não por
  limitação técnica.
- **Cancelamento** de agendamento — não iniciado.
- **Remarcação** de agendamento — não iniciado.

## 4. Pendências técnicas conhecidas

(somente as já registradas em sessões anteriores; nenhuma nova aberta aqui)

- Grants de `anon` em `pacientes` no banco operacional — neutralizados hoje
  só por RLS sem policies, não removidos.
- `MANIFESTO.md` desatualizado — não cobre migrations a partir de
  2026-08-05.
- Descompasso sistemático nome-do-arquivo-local × versão-remota em todos os
  arquivos de `migrations-legado/` — padrão pré-existente, não específico
  das migrations desta sessão.
- `pacientes_telefone_formato` (CHECK) existe no dev, não existe no
  operacional.
- `reservar-agendamento.ts` não envia `p_nome`/`p_documento` para a RPC.
- `estado_conversa.paciente_id` fica nulo até o turno seguinte quando um
  paciente é persistido no meio do processamento — comportamento
  documentado, não é bug.

## 5. Próxima recomendação

A próxima etapa recomendada é **cancelamento ou remarcação de agendamento**.
§7 já está com o único desfecho seguro que a spec pede (detectar e
encaminhar à recepção, zero risco de escrita incorreta ou loop), e o Gabriel
despriorizou §7 explicitamente várias vezes nesta sessão por ser cenário
raro. Cancelamento/remarcação são frentes genuinamente novas do fluxo de
agendamento, sem bloqueio técnico pendente, e dão continuidade natural ao
que já foi fechado (novo agendamento) sem reabrir nenhuma decisão já
tomada.

## 6. Leitura mínima para a próxima sessão

- `docs/00-principios.md`
- `docs/04-decisoes-canonicas.md`
- `specs/persistencia-v1.md`
- `specs/cpf-outro-telefone-v1.md`
- Este handoff (`handoffs/2026-08-10-fechamento-novo-agendamento.md`)

## 7. Confirmação

Não existe trabalho parcialmente implementado nesta frente. Tudo que foi
tocado nesta sessão (correção de `cappia_persistir_paciente`, cadastro
conversacional herdado, troca de telefone por CPF) foi finalizado, testado
e está commitado/deployado. §7 é, por design, detecção-e-parada — não é uma
implementação inacabada.
