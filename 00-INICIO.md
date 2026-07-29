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
4. `docs/01-visao-geral.md` até `docs/06-roadmap.md`, nesta ordem.
5. `specs/` — especificações de comportamento (ainda não detalhadas nesta etapa).
6. `tests/cenarios-obrigatorios.md` — cenários de teste obrigatórios (ainda não
   detalhados nesta etapa).

## O que este repositório NÃO é

- Não é o lugar da Iris antiga. Nada da Iris antiga (workflows, prompts, Agent, Simple
  Memory, overrides, gates, JSONs do n8n, backups, dados de teste) foi copiado para cá.
- Não é a fonte técnica viva de nada ainda — `src/` está vazia nesta etapa. A fonte técnica
  viva de sistemas já existentes (Supabase, painel, etc.) continua sendo esses próprios
  sistemas.
- Não é autorização para implementar código. Ver `AGENTS.md` para o processo obrigatório
  antes de qualquer implementação.

## Estado desta etapa

Repositório recém-criado, estrutura e decisões já aprovadas documentadas. Nenhum código
escrito. Nenhum sistema existente (Iris atual, workflows, Supabase atual, produção,
Evolution, painel, credenciais, calendários) foi alterado para criar este repositório.

## Contexto histórico (referência, não fonte técnica)

O histórico completo da Iris antiga e da decisão de encerrá-la está em
`cappia-estado/HANDOFF-iris-br.md`, seção "Sessão 28/07/2026". Este repositório não
depende desse histórico para funcionar, mas ele explica o porquê das decisões
registradas em `docs/04-decisoes-canonicas.md`.
