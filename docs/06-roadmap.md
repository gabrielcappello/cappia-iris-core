# Roadmap — escopo e ordem de implementação

## Escopo completo (todas as partes, independente de ordem)

- Saudação e conversa básica.
- Informações da clínica.
- Novo agendamento.
- Consulta do próprio agendamento.
- Remarcação.
- Cancelamento.
- Atualização cadastral permitida.

**Anamnese não pertence ao atendimento da Iris** — fora de escopo por completo, não só
desta primeira fase.

## Ordem de implementação aprovada

A **primeira implementação** cobre somente o fluxo de **novo agendamento**, nesta ordem:

1. Identificação (clínica pela instância autenticada; paciente pelo telefone).
2. Aproveitamento de dados em qualquer ordem (nunca pedir de novo o que já foi dado).
3. Novo agendamento.
4. Disponibilidade pelo calendário interno da Cappia.
5. Cadastro necessário.
6. Resumo.
7. Confirmação explícita.
8. Criação idempotente.
9. Envio da resposta.

**Consulta do próprio agendamento, remarcação, cancelamento e atualização cadastral
permanecem no escopo do projeto**, mas serão implementados depois, **um por vez**, cada
um com sua própria aprovação — não em paralelo com a primeira implementação nem entre si.

## O que isso implica

- Nenhuma dessas partes futuras (consulta/remarcação/cancelamento/atualização) deve ganhar
  código, estado ou rota "de antemão" durante a implementação do novo agendamento, mesmo
  que pareça conveniente estruturalmente. Ver `AGENTS.md` — não criar funcionalidade sem
  aprovação, mesmo que pareça útil.
