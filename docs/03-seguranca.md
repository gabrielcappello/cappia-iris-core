# Segurança

> Mínimo aprovado para esta etapa. Não é uma política ampliada — deliberadamente curto.

## Decisões de segurança já aprovadas

- **A clínica é derivada da instância autenticada** do WhatsApp — nunca de um
  identificador enviado pelo próprio paciente/usuário na mensagem.
- **Isolamento por `clinica_id`** em toda consulta e ação.
- **Secrets somente no servidor** — nunca em prompt, mensagem, log ou qualquer lugar
  acessível ao cliente/IA.
- **A IA não acessa banco, calendário ou credenciais** — nenhuma ação real é exposta a
  ela como algo que decide chamar; tudo passa pelo controlador determinístico.
- **Deduplicação de mensagem.**
- **Confirmação explícita e idempotência no novo agendamento** — passos 7 e 8 de
  `06-roadmap.md` ("Confirmação explícita" e "Criação idempotente").
- **Logs sem chaves e com dados pessoais mascarados.**

Qualquer item de segurança além desta lista fica para decisão específica futura, quando
for necessário — não presumir.
