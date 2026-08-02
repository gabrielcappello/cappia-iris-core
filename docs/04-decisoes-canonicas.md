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
- A **duração** é configurada pela clínica para o procedimento (`clinica_id` +
  `procedimento_id`), e é **a mesma para todos os dentistas aptos** daquela clínica.
  Valor válido: inteiro, de 10 a 240 minutos, múltiplo de 10. Duração individual por
  dentista ou por vínculo está **fora da v1** (ver `../specs/duracao-v1.md`).
- Consultar **horários de trabalho, bloqueios e compromissos reais**.
- **Apresentar somente horários realmente disponíveis.**

## Atendimento

- **Identificar clínica e paciente desde a primeira mensagem.**
- **A clínica é determinada pela instância autenticada do WhatsApp** (não por dado
  enviado pelo paciente).
- **O paciente é identificado pelo telefone dentro da clínica.**
- **Se não existir paciente para a combinação clínica + telefone, tratá-lo como paciente
  novo.** Os dados necessários ao cadastro serão solicitados **somente depois de existir
  horário disponível escolhido** — nunca antes disso.
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

## Composição do novo agendamento (01/08/2026)

Decisões que fecham a documentação necessária antes de implementar a composição
determinística dos quatro componentes já publicados (procedimento, dentistas e
vínculos, duração, disponibilidade). Detalhe completo:
`../specs/composicao-novo-agendamento-v1.md`.

- **Resolução temporal terá um resolvedor puro e separado**, futuro, que converte
  fatos temporais já interpretados (texto) em fatos temporais oficiais (data civil,
  minuto local, período, restrição `inicio_ate`/`termino_ate`, intenção
  `data_especifica`/`proxima_disponibilidade`). Essa lógica **não pertence ao
  controlador**.
- **Configuração da clínica tem um contrato mínimo fechado** nesta rodada: `clinica_id`,
  `fuso` e `exigir_email`. Nenhum schema físico, tabela ou migration é criado por esta
  decisão.
- **A busca de próxima disponibilidade é continuável e paginada.** O gerador de
  disponibilidade continua estritamente diário; o controlador solicita snapshots
  sucessivos por data; fim de uma página técnica nunca significa ausência definitiva;
  só o encerramento explícito do protocolo (ausência estrutural de agenda, falha
  técnica ou configuração inválida) pode significar fim da busca — nunca um horizonte
  silencioso de dias.
- **Consulta/Avaliação terá um seletor puro e específico**, futuro, que escolhe pelo
  marcador oficial `eh_consulta_avaliacao`, exigindo exatamente um procedimento ativo
  correspondente na clínica. Zero ou vários correspondentes são erro estrutural. Nunca
  usa nome ou alias; não altera o resolvedor textual de procedimento já publicado.
- **Ordem cadastral fixa**: nome, CPF, data de nascimento, e-mail (somente quando a
  clínica exigir). Campo já presente e válido nunca é solicitado de novo.
- **Repetição idempotente — replay completo somente com resultado da composição
  registrado.** Só então o comando original, a versão recebida e a versão proposta são
  recuperados — sem reaplicar alterações, sem reavaliar eventos e sem executar nenhum
  componente novamente. Interpretação persistida e resultado da composição registrado
  são marcadores distintos; o primeiro nunca autoriza, por si só, replay.
- **Queda intermediária (interpretação persistida, sem resultado da composição
  registrado) preserva integralmente o contrato vigente de `interpretacao-ia.md`.** A
  composição **não é retomada**: não reconstrói eventos candidatos nem conflitos de
  valor (ambos permanecem transitórios, nunca persistidos), não chama a IA novamente,
  produz somente a resposta fixa já aprovada e aguarda nova mensagem do paciente.
  Persistência recuperável da interpretação completa (eventos candidatos e conflitos)
  poderá ser avaliada em spec própria futura; **não faz parte desta v1**.

## Escopo completo do atendimento

Ver `06-roadmap.md` para a lista completa de escopo e a ordem em que cada parte será
implementada. **Anamnese não pertence ao atendimento da Iris.**
