# AGENTS.md — cappia-iris-core

Identifique primeiro que você está no repositório da **Iris Nova**, projeto separado da
Iris antiga (`IRIS BR`, encerrada para evolução — ver `cappia-estado/HANDOFF-iris-br.md`
para histórico, não como fonte técnica deste repositório).

## Ordem de leitura obrigatória (antes de agir)

1. `00-INICIO.md`
2. `README.md`
3. `docs/01-visao-geral.md` → `docs/06-roadmap.md`, nesta ordem
4. A spec relevante em `specs/`, quando existir
5. `tests/cenarios-obrigatorios.md`, quando existir

## Processo obrigatório (não pular etapas)

1. **Gabriel define e aprova o comportamento** antes de qualquer especificação ser
   considerada canônica.
2. **Code (Claude) implementa depois da aprovação** — nunca antes.
3. **Codex revisa arquitetura, segurança e aderência** à especificação aprovada.
4. **Não implementar sem aprovação explícita**, etapa por etapa — ver
   `docs/06-roadmap.md` para a ordem aprovada.

## Regras que não podem ser violadas por iniciativa própria

- **Não criar funcionalidades, fallbacks ou proteções extras sem aprovação.** Se parecer
  necessário, perguntar antes, não implementar e justificar depois.
- **Não presumir por suposição.** Se uma decisão não estiver documentada em
  `docs/04-decisoes-canonicas.md`, é uma dúvida a ser levantada para o Gabriel, não uma
  lacuna a ser preenchida por inferência.
- **Nada da Iris antiga é reutilizado automaticamente.** A lista do que pode ser
  *considerado* para reutilização está em `docs/05-componentes-reutilizaveis.md` — cada
  item precisa de auditoria específica e autorização do Gabriel antes de entrar aqui,
  mesmo estando na lista.
- **A IA (modelo de linguagem) dentro da Iris Nova nunca acessa banco, calendário,
  credenciais ou ferramentas diretamente** — essa é uma decisão arquitetural fixa, não um
  detalhe de implementação a ser reconsiderado.
- **Nenhum sistema existente é alterado a partir deste repositório** sem autorização
  explícita, específica, por ação: Iris atual, workflows existentes, Supabase atual,
  produção, Evolution, painel, credenciais, calendários.

## Onde vive cada tipo de conteúdo

- `docs/` — decisões arquiteturais e de produto já aprovadas (fonte canônica).
- `specs/` — comportamento detalhado por área, aprovado antes de virar código.
- `tests/` — cenários obrigatórios de validação.
- `reviews/` — revisões (Codex ou outras) sobre este projeto.
- `handoffs/` — registros de encerramento de etapa desta frente.
- `src/` — código. Vazio até a primeira implementação aprovada.
