# AGENTS.md — cappia-iris-core

Identifique primeiro que você está no repositório da **Iris Nova**, projeto separado da
Iris antiga (`IRIS BR`, encerrada para evolução — ver `cappia-estado/HANDOFF-iris-br.md`
para histórico, não como fonte técnica deste repositório).

## Ordem de leitura obrigatória (antes de agir)

1. `00-INICIO.md`
2. `README.md`
3. **`docs/00-principios.md`** — princípios fundamentais, canônicos. Vêm antes de
   qualquer regra específica e orientam toda decisão de arquitetura.
4. `docs/01-visao-geral.md` → `docs/06-roadmap.md`, nesta ordem
5. A spec relevante em `specs/`, quando existir
6. `tests/cenarios-obrigatorios.md`, quando existir

## Processo obrigatório (não pular etapas)

1. **Gabriel define e aprova a especificação** antes de qualquer coisa ser considerada
   canônica.
2. **Code (Claude) implementa depois da aprovação** — nunca antes.
3. **Codex revisa arquitetura, segurança e aderência** à especificação aprovada.
4. **Gabriel aprova a entrega e autoriza integração/publicação.** A revisão do Codex, por
   si só, não é autorização para integrar ou publicar — o ciclo só fecha com o Gabriel
   aprovando o resultado depois da revisão.

Isso vale etapa por etapa — ver `docs/06-roadmap.md` para a ordem aprovada. Não pular
para a etapa seguinte sem essa aprovação final na etapa atual.

## Simplicidade e prioridade de entrega

A Iris Nova deve seguir o **menor caminho seguro** até um fluxo real funcionando.

Regras obrigatórias:

- **Bloquear o avanço somente quando houver risco comprovado de:**
  - o fluxo não funcionar;
  - corrupção ou perda de dados;
  - falha de segurança;
  - violação multiclínica;
  - duplicidade relevante;
  - impossibilidade de rollback seguro na etapa atual.
- **Adiar** melhorias opcionais, catálogos completos, casos raros, proteções futuras e
  refinamentos não essenciais.
- Entre duas soluções suficientemente seguras, **adotar a mais simples**.
- **Não criar nova taxonomia, documento, camada, fallback, gate ou decisão sem bloqueio
  técnico real e comprovado.**
- Se uma regra já existe em fonte canônica, **referenciá-la; não reescrevê-la** em outro
  documento.
- **Não interromper a implementação por lacunas que possam ser resolvidas de forma
  aditiva** antes da ativação do fluxo.
- Revisões de Code e Codex devem **distinguir explicitamente**: bloqueador real; risco
  não bloqueante; melhoria opcional. **Melhoria opcional nunca vira bloqueador.**
- **Prioridade atual — demonstrar o fluxo mínimo:** mensagem recebida → interpretação →
  decisão determinística → resposta → persistência do estado.
- Nenhuma ampliação de escopo precede esse fluxo mínimo sem aprovação explícita do
  Gabriel.
- Ao perceber excesso de burocracia ou complexidade, Code e Codex devem **parar e
  alertar antes de criar novos artefatos** — inclusive quando a instrução anterior
  apontar nessa direção.

**Relação com as demais seções deste arquivo:** esta seção calibra *quando* levantar uma
dúvida, nunca dispensa a aprovação do Gabriel. "Não presumir por suposição" (seção
seguinte) continua valendo integralmente para o que é **decisão** — nome definitivo,
contrato, autoridade, identidade de dados. O que esta seção adia é o que é **cobertura**:
catálogo exaustivo, caso raro, proteção futura. Na dúvida entre as duas leituras,
perguntar ao Gabriel em uma linha, e seguir.

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
- `src/` — código. Contém base parcial já escrita (identificação e interpretação), com
  testes e migrations de etapas anteriores. **Não presumir que esse código está correto ou
  alinhado às specs atuais** — auditar contra a spec vigente antes de reutilizar ou
  estender. A implementação end-to-end ainda não está autorizada.
