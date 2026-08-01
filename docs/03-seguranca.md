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
- **Logs técnicos sem PII e sem credenciais.** Log técnico não contém mensagem bruta,
  CPF, telefone, nome, data de nascimento ou e-mail — **nem mesmo parcialmente
  mascarados**. Usar identificadores técnicos opacos; para correlação por telefone, usar
  o correlator HMAC definido em `../specs/persistencia-v1.md` §20. Máscara parcial só
  pode existir em interface autorizada ao usuário, nunca em log técnico. Credenciais e
  secrets nunca entram em log, em nenhuma forma.

Qualquer item de segurança além desta lista fica para decisão específica futura, quando
for necessário — não presumir.
