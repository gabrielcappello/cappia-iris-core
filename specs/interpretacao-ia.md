# Spec — Interpretação pela IA

**Status:** não escrita ainda. Este arquivo é um placeholder.

Esta especificação deve detalhar o contrato exato entre a mensagem do paciente e a saída
estruturada da IA (formato, campos, tolerância de análise), e o contrato de redação da
resposta final — respeitando `../docs/02-arquitetura.md`: a IA só interpreta e redige,
nunca decide o próximo passo nem acessa banco, calendário, credenciais ou ferramentas.

Não preencher por suposição. Escrever somente depois que Gabriel definir e aprovar o
comportamento detalhado (ver processo em `../AGENTS.md`).

## Cláusula registrada

No adaptador OpenAI, o modo estruturado obrigatório deve usar
`text.format.type = 'json_schema'` e `strict = true`; remover ou enfraquecer
`strict` viola o contrato.
