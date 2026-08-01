# cappia-iris-core

Núcleo da **Iris Nova** — assistente conversacional de agendamento odontológico via
WhatsApp, para as clínicas Cappia.

## O que é

Um assistente conversacional **híbrido, orientado a tarefas**: a IA interpreta a
mensagem do paciente e redige a resposta final; um controlador determinístico decide o
próximo passo a partir de um estado explícito guardado no banco. A IA nunca acessa banco,
calendário, credenciais ou ferramentas diretamente, e nunca decide livremente qual ação
tomar.

Este projeto substitui a linha anterior da Iris (`IRIS BR`, um Agent autônomo com
ferramentas livres rodando inteiramente dentro do n8n), encerrada para evolução em
28/07/2026 após acúmulo de correções e patches ao longo de dois meses. Ver
`docs/01-visao-geral.md` para o raciocínio completo.

## Arquitetura, em uma frase

Supabase/Postgres como fonte de estado → controlador determinístico decide o próximo
passo → serviços de domínio auditados executam a ação → IA só interpreta e redige.
Detalhe completo: `docs/02-arquitetura.md`.

## Estado atual

Fase documental avançada, implementação parcial.

- As especificações canônicas do novo agendamento estão avançadas — incluindo
  Persistência v1 e Disponibilidade v1, ambas publicadas.
- Já existe base TypeScript parcial em `src/` (identificação e interpretação), com testes
  e migrations aplicadas em etapas anteriores.
- **A implementação end-to-end da Iris Nova ainda não está autorizada.**
- O código existente **não deve ser presumido correto**: precisa ser auditado contra as
  specs vigentes antes de ser reutilizado. Há uma divergência conhecida de PII no contrato
  de interpretação, registrada em `specs/interpretacao-ia.md`, que precisa ser corrigida
  antes de qualquer tráfego real.
- A próxima fase depende do fechamento documental e de nova revisão.

## Por onde começar

Ver `00-INICIO.md` para a ordem de leitura obrigatória.

## Regras de processo

Ver `AGENTS.md` antes de propor ou implementar qualquer coisa neste repositório.
