# Componentes reutilizáveis

> **Regra fixa: nada desta lista é reutilizado automaticamente.** Cada item só entra no
> projeto após auditoria específica **e** autorização explícita do Gabriel, item por item,
> quando for necessário — nunca antecipadamente e nunca em lote.

## Itens que podem ser *considerados* para reutilização

- Painel (`iris-portal-v2`).
- Autenticação.
- Infraestrutura Supabase/Postgres.
- Transporte do WhatsApp.
- Catálogo de procedimentos.
- Tempos configurados (duração por procedimento/modo).
- Fórmula de cálculo dos horários.

## O que isso explicitamente não inclui

Nada além da lista acima. Em particular — e isto é uma constatação, não uma decisão nova
— as RPCs específicas construídas na sessão de 28/07/2026 na linha `IRIS BR`
(`cappia_avancar_agendamento` e helpers relacionados) **não estão nesta lista**. Elas
continuam vivas no Postgres, testadas, mas não são consideradas pré-aprovadas para reuso
aqui — se algum dia fizer sentido auditar essa RPC especificamente, é uma decisão à parte,
não coberta por "infraestrutura Supabase/Postgres" de forma genérica.

## Também explicitamente fora, por instrução direta

Nunca copiar ou reutilizar, em nenhuma circunstância, sem que isso seja uma decisão nova
e específica:

- Workflows antigos do n8n.
- Prompts antigos.
- O Agent e suas ferramentas.
- Simple Memory (memória de buffer do LangChain).
- JSONs de workflow do n8n.
- Gates (ex.: gate de confirmação assumida).
- Overrides (ex.: a camada determinística pós-Agent).
- Nodes corretivos em geral.
- Backups da Iris antiga.
- Dados de clínicas, dentistas, pacientes ou agendamentos de teste da Iris antiga.
- Regras que foram criadas especificamente para corrigir comportamentos da Iris antiga.
