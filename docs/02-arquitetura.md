# Arquitetura (registro histórico — SEM AUTORIDADE VIGENTE)

> ## ⚠️ Este documento é registro histórico. Não é fonte normativa.
>
> - **Não possui autoridade normativa vigente.** Nada aqui vale como regra a ser
>   seguida ou citada como decisão em vigor.
> - **Foi substituído por `docs/07-arquitetura-v2.md`** (aprovado pelo Gabriel em
>   2026-08-12), que é a **arquitetura canônica vigente** e a única fonte normativa de
>   arquitetura deste projeto.
> - **Não deve orientar implementação nova.** Ao implementar, revisar ou especificar
>   qualquer coisa, use `docs/07-arquitetura-v2.md`. Este arquivo saiu da ordem de
>   leitura obrigatória (ver `AGENTS.md`).
> - **O conteúdo abaixo permanece intacto apenas para explicar a arquitetura anterior** —
>   por que ela foi adotada e o que a V2 substituiu. É contexto histórico, não instrução.
>
> Em caso de divergência entre este documento e `docs/07-arquitetura-v2.md`, prevalece
> `docs/07-arquitetura-v2.md`, sempre — inclusive onde este texto parecer mais específico
> ou mais detalhado.
>
> O que a V2 preservou ou substituiu do que está abaixo está registrado na própria
> `docs/07-arquitetura-v2.md`; não o deduza deste arquivo.

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
