# Comece aqui — Iris Nova

Este repositório é a fonte oficial da **Iris Nova**: um assistente conversacional novo,
separado da Iris antiga (linha `IRIS BR`, encerrada para evolução em 28/07/2026).

Os documentos Markdown deste repositório são a fonte oficial deste projeto. Não devem
existir cópias divergentes em outros lugares (Obsidian, outros repositórios, etc.) — este
repositório também é aberto como vault separado no Obsidian, apontando para os mesmos
arquivos.

## Ordem de leitura obrigatória

1. Este arquivo (`00-INICIO.md`).
2. `README.md` — o que é a Iris Nova, em uma página.
3. `AGENTS.md` — regras de processo para quem (humano ou IA) for trabalhar aqui.
4. `docs/00-principios.md` — princípios fundamentais, canônicos.
5. `docs/01-visao-geral.md`
6. `docs/07-arquitetura-v2.md` — **arquitetura canônica vigente**.
7. `docs/03-seguranca.md`
8. `docs/04-decisoes-canonicas.md`
9. `docs/05-componentes-reutilizaveis.md`
10. `docs/06-roadmap.md`
11. A spec relevante em `specs/`, quando existir.
12. `tests/cenarios-obrigatorios.md` — índice oficial de aceite dos cenários obrigatórios.

`docs/02-arquitetura.md` **não faz parte da leitura obrigatória**: permanece no
repositório apenas como registro histórico, substituído por `docs/07-arquitetura-v2.md`.

## O que este repositório NÃO é

- Não é o lugar da Iris antiga. Nada da Iris antiga (workflows, prompts, Agent, Simple
  Memory, overrides, gates, JSONs do n8n, backups, dados de teste) foi copiado para cá.
- Não é a fonte técnica viva dos sistemas já existentes (Supabase atual, painel, etc.) —
  esses continuam sendo sua própria fonte.
- Não é autorização para implementar código. Ver `AGENTS.md` para o processo obrigatório
  antes de qualquer implementação.

## Estado desta etapa

**A Iris Nova está implementada e publicada em produção, para testes controlados. Ainda
não atende pacientes reais.**

- O fluxo end-to-end (mensagem recebida → interpretação → decisão determinística →
  resposta → persistência do estado) está implementado e publicado na Edge Function
  `iris-nova-mensagem`.
- `src/` contém o Core em TypeScript. A Edge Function tem um subconjunto desses arquivos,
  não todos: **cada arquivo da Edge que possui correspondente no Core deve permanecer em
  paridade com ele.** Nem todo arquivo do Core existe na Edge.
- As especificações em `specs/` continuam sendo a fonte do comportamento aprovado, e
  parte delas descreve etapas ainda não implementadas — a spec é canônica sobre o que foi
  **decidido**, não prova do que está **em produção**.
- Estar em produção não dispensa auditoria: ao reutilizar ou estender código existente,
  conferir contra a spec vigente em vez de presumir aderência.

Precisão sobre o alcance das mudanças feitas a partir daqui:

- o **projeto Supabase da Iris Nova** e a Edge Function `iris-nova-mensagem` são alvos
  legítimos deste repositório — trabalho autorizado do projeto, etapa por etapa;
- a Iris antiga, os workflows de produção não pertencentes a esta frente, a Evolution
  API, o painel, credenciais e calendários **não são alterados a partir deste
  repositório** sem autorização explícita e específica, por ação;
- qualquer deploy, publicação ou alteração de tráfego continua dependendo da aprovação
  explícita do Gabriel (ver `AGENTS.md`).

O estado corrente por frente (o que está publicado, o que aguarda revisão) vive em
`../cappia-estado/HANDOFF-iris-nova.md`, não neste arquivo.

## Contexto histórico (referência, não fonte técnica)

O histórico completo da Iris antiga e da decisão de encerrá-la está em
`cappia-estado/HANDOFF-iris-br.md`, seção "Sessão 28/07/2026". Este repositório não
depende desse histórico para funcionar, mas ele explica o porquê das decisões
registradas em `docs/04-decisoes-canonicas.md`.
