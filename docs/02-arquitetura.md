# Arquitetura

> **SUPERADO em 2026-08-12 por `docs/07-arquitetura-v2.md`**, aprovado pelo Gabriel na
> mesma data. Especificamente, o princípio *"um controlador determinístico decide o próximo
> passo a partir do estado; a IA somente interpreta e redige"* foi substituído por *"a Iris
> é a autoridade semântica; o Core é a autoridade factual e operacional"*.
>
> Este arquivo é preservado como **registro histórico**, sem edição do conteúdo original —
> ele descreve a arquitetura que o código ainda implementa hoje, e continua sendo a
> referência correta para entender o código atual enquanto a migração da V2 não avança.
>
> Duas decisões deste documento **permanecem integralmente válidas** na V2: a IA nunca
> acessa banco, calendário, credenciais ou ferramentas; e não se usa Agent autônomo com
> tools.

> Decisões já aprovadas por Gabriel. Este documento não adiciona nada além do que foi
> decidido — mudanças aqui exigem aprovação nova.

## Decisões aprovadas

- **Iris Core próprio, em TypeScript.**
- **Execução inicial em Supabase Edge Function.**
- **Supabase/Postgres é a fonte oficial do estado** da conversa.
- **Um controlador determinístico decide o próximo passo** a partir do estado.
- **A IA somente interpreta a mensagem do paciente e redige respostas.**
- **A IA não acessa banco, calendário, credenciais ou ferramentas.** Toda ação real
  passa pelo controlador determinístico e pelos serviços de domínio.
- **Não usar Agent autônomo com tools.**
- **O n8n não será o cérebro da conversa.**

## O que isso implica (consequência direta das decisões acima, não decisão nova)

- Qualquer chamada a banco, calendário, ou execução de efeito real (criar/alterar
  agendamento, cadastro) é feita pelo controlador ou pelos serviços de domínio — nunca
  diretamente pela IA nem exposta a ela como ferramenta que ela escolhe chamar.

## Papel do n8n (decidido em 28/07/2026)

Na primeira implementação, o n8n pode permanecer somente para:

- receber e enviar mensagens do WhatsApp;
- áudio;
- lembretes e automações separadas.

**O n8n não decide estado, disponibilidade, cadastro, confirmação ou criação de
agendamento.** Toda essa lógica vive no controlador determinístico (Iris Core), nunca em
nós de workflow.

## Não decidido ainda nesta etapa

- Runtime exato além de "Supabase Edge Function" (ex.: bibliotecas, estrutura interna do
  TypeScript) — fica para quando a primeira implementação for aprovada.
