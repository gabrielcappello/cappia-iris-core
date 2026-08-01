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
5. `specs/` — especificações de comportamento do novo agendamento, já canônicas.
6. `tests/cenarios-obrigatorios.md` — índice oficial de aceite dos cenários obrigatórios.

## O que este repositório NÃO é

- Não é o lugar da Iris antiga. Nada da Iris antiga (workflows, prompts, Agent, Simple
  Memory, overrides, gates, JSONs do n8n, backups, dados de teste) foi copiado para cá.
- Não é a fonte técnica viva dos sistemas já existentes (Supabase atual, painel, etc.) —
  esses continuam sendo sua própria fonte.
- Não é autorização para implementar código. Ver `AGENTS.md` para o processo obrigatório
  antes de qualquer implementação.

## Estado desta etapa

Fase documental avançada, com implementação parcial.

- As especificações canônicas do novo agendamento estão avançadas; Persistência v1 e
  Disponibilidade v1 estão publicadas.
- `src/` **contém** base TypeScript parcial (identificação e interpretação), testes e
  migrations aplicadas em etapas anteriores.
- A implementação end-to-end da Iris Nova **ainda não está autorizada**.
- Não presumir que o código atual está correto: ele precisa ser auditado contra as specs
  vigentes antes de ser reutilizado. Existe uma divergência conhecida de PII no contrato
  de interpretação (`specs/interpretacao-ia.md`) que precisa ser corrigida antes de
  qualquer tráfego real.
- A próxima fase depende do fechamento documental e de nova revisão.

Precisão sobre o que já foi alterado e por quê:

- o **projeto Supabase próprio da Iris Nova** já recebeu as migrations aplicadas em
  etapas anteriores (ver acima) — isso é trabalho autorizado deste projeto, não uma
  exceção à regra;
- a **rodada documental atual** (esta canonicalização) não alterou nenhum sistema
  externo — só editou os arquivos Markdown listados no commit correspondente;
- a Iris antiga, os workflows de produção, a Evolution API, o painel, credenciais e
  calendários **nunca foram alterados a partir deste repositório**, em nenhuma etapa;
- nenhum código existente aqui deve ser presumido correto ou pronto para reutilização
  sem auditoria contra a spec vigente;
- a implementação end-to-end da Iris Nova continua sem autorização.

## Contexto histórico (referência, não fonte técnica)

O histórico completo da Iris antiga e da decisão de encerrá-la está em
`cappia-estado/HANDOFF-iris-br.md`, seção "Sessão 28/07/2026". Este repositório não
depende desse histórico para funcionar, mas ele explica o porquê das decisões
registradas em `docs/04-decisoes-canonicas.md`.
