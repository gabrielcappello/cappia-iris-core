# Decisões canônicas — Agenda e Atendimento

> Fonte única destas decisões. Se este arquivo divergir de qualquer outro lugar (Obsidian,
> conversa antiga, memória), este arquivo prevalece. Mudanças aqui exigem aprovação nova
> do Gabriel — não editar por inferência.
>
> Arquitetura técnica: ver `02-arquitetura.md`. Escopo e ordem de implementação: ver
> `06-roadmap.md`. Processo de trabalho: ver `AGENTS.md`.

## Agenda

- A Cappia possui **calendário interno próprio**.
- O calendário interno **deve funcionar sem Google Calendar**.
- **Google Calendar será uma integração opcional**, configurável pela clínica.
- Toda disponibilidade **depende primeiro do procedimento**.
- A partir do procedimento, **identificar quais dentistas ativos realizam** esse
  procedimento.
- A **duração** vem do modo configurado:
  - **modo geral/automático:** duração geral configurada;
  - **modo por procedimento:** duração configurada para o procedimento.
- Consultar **horários de trabalho, bloqueios e compromissos reais**.
- **Apresentar somente horários realmente disponíveis.**

## Atendimento

- **Identificar clínica e paciente desde a primeira mensagem.**
- **A clínica é determinada pela instância autenticada do WhatsApp** (não por dado
  enviado pelo paciente).
- **O paciente é identificado pelo telefone dentro da clínica.**
- **O número cadastrado é suficiente** para consultar, remarcar, cancelar e alterar os
  próprios dados — sem exigir identificação adicional para essas ações.
- **Dados informados podem chegar em qualquer ordem** e devem ser **preservados**.
- **A Iris não deve pedir novamente um dado já informado.**
- **Quando houver um único dentista apto**, seguir diretamente para data ou horário,
  **sem anunciar informação redundante** (não perguntar/confirmar o que já está
  resolvido de forma inequívoca).
- **Quando nenhum dentista estiver configurado para o procedimento**, oferecer
  Consulta/Avaliação.
- **A Consulta/Avaliação somente substitui o procedimento com aceitação do paciente** —
  nunca uma substituição automática/silenciosa.
- **A revalidação do horário antes da criação é técnica** (proteção contra o horário ter
  sido ocupado entre a oferta e a confirmação) **e não exige repetir a pergunta ao
  paciente** — é uma checagem interna, não um novo turno de conversa.

## Escopo completo do atendimento

Ver `06-roadmap.md` para a lista completa de escopo e a ordem em que cada parte será
implementada. **Anamnese não pertence ao atendimento da Iris.**
