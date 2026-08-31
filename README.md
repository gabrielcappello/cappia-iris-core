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

## Arquitetura

Fonte canônica: `docs/07-arquitetura-v2.md`. Ela substitui `docs/02-arquitetura.md`, que
permanece no repositório apenas como registro histórico.

## Estado atual

**Implementada e publicada em produção, para testes controlados.** Ainda não atende
pacientes reais.

- O fluxo end-to-end está publicado na Edge Function `iris-nova-mensagem`.
- `src/` contém o Core. A Edge Function tem um subconjunto desses arquivos, não todos:
  **cada arquivo da Edge que possui correspondente no Core deve permanecer em paridade
  com ele.**
- As specs em `specs/` são a fonte do comportamento aprovado; parte delas ainda descreve
  etapas não implementadas. Spec aprovada não é prova de que algo está em produção.
- Estar em produção não dispensa auditoria contra a spec vigente antes de reutilizar ou
  estender código existente.

O estado corrente por frente vive em `../cappia-estado/HANDOFF-iris-nova.md`.

## Por onde começar

Ver `00-INICIO.md` para a ordem de leitura obrigatória.

## Regras de processo

Ver `AGENTS.md` antes de propor ou implementar qualquer coisa neste repositório.
