# Segurança

> Este documento reúne apenas as decisões de segurança que já foram explicitamente
> aprovadas (extraídas de `02-arquitetura.md` e `04-decisoes-canonicas.md`). Uma política
> de segurança mais ampla e dedicada **ainda não foi formalizada como decisão canônica**
> para este projeto — ver "Pendente de decisão" abaixo. Não presumir itens além dos
> listados aqui.

## Decisões de segurança já aprovadas

- **A IA não acessa banco, calendário, credenciais ou ferramentas** — nenhuma ação real
  é exposta a ela como algo que decide chamar; tudo passa pelo controlador
  determinístico.
- **A clínica é determinada pela instância autenticada do WhatsApp** — nunca por um
  identificador de clínica enviado pelo próprio paciente/usuário na mensagem.
- **O paciente é identificado pelo telefone dentro da clínica** — identificação
  determinística, não por dado alegado na conversa.
- **Não usar Agent autônomo com tools** — reduz a superfície de decisão livre do modelo,
  que é onde boa parte dos problemas de segurança de sistemas com IA generativa tendem a
  aparecer (seleção incorreta de ferramenta, injeção de instrução via mensagem do
  usuário).
- **Confirmação explícita antes de gravação** e **idempotência por ação** — aprovadas em
  `06-roadmap.md` (passos 7 e 8 da primeira implementação, "Confirmação explícita" e
  "Criação idempotente"). Válidas hoje para o fluxo de **novo agendamento**, que é o único
  já detalhado; a extensão desse mesmo princípio para remarcação, cancelamento e
  atualização cadastral precisa ser confirmada quando essas specs forem escritas — não
  presumir estendida antes disso.

## Pendente de decisão (não implementar por suposição)

Uma sessão anterior (28/07/2026, antes deste repositório existir) levantou uma lista mais
ampla de práticas de segurança (isolamento por `clinica_id` em toda consulta, permissões
mínimas por serviço, validação de toda saída do modelo, mascaramento de dados pessoais em
log, auditoria de transições, proteção contra prompt injection) — baseada em documentação
pública de OpenAI, Anthropic, OWASP e NIST. **Essa lista não foi formalmente aprovada como
decisão canônica deste repositório.** Fica como pauta para uma aprovação específica antes
da primeira implementação, não como decisão já valendo.
