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

Fase de preparação: estrutura e decisões já aprovadas documentadas. **Nenhum código
implementado ainda.** `src/` está vazia.

## Por onde começar

Ver `00-INICIO.md` para a ordem de leitura obrigatória.

## Regras de processo

Ver `AGENTS.md` antes de propor ou implementar qualquer coisa neste repositório.
