# P6 — Teste controlado (Clear Dent, telefone único autorizado) — resultado (2026-09-23)

Autorizado pelo Gabriel: teste controlado na Clear Dent, só com o telefone de teste já autorizado e fixtures
sintéticas; sem ativar Disparo A nem legado; sem RPC ampla de candidatos; destino confirmado programaticamente antes
de cada envio; cenários um por vez, parando para respostas reais no WhatsApp; limpeza e restauração ao final.

## Antes de começar
- O arquivo local com o telefone autorizado tinha sido apagado na higiene do E2E anterior (correto). Reconfirmado com
  Gabriel e extraído de uma execução real recente do Íris Oficial (leitura), validado por igualdade de dígitos contra
  o número que ele informou — nunca reimpresso em texto aberto depois disso.
- Acesso ao banco estava bloqueado (conector MCP desconectado + token do cofre expirado, como já esperado). Gabriel
  gerou um token novo; salvo pelo mesmo script de entrada oculta já validado (`salvar-token-supabase.ps1`), sem
  aparecer em tela. Revogar depois deste portão, como o anterior.
- Config original da Clear Dent registrada antes de qualquer alteração: `pos_consulta_tipo: "google"`, demais chaves
  inalteradas — restaurada byte-a-byte ao final (conferido).

## Cenários executados (todos com guarda de destino antes de cada envio real)
| # | Resultado |
|---|---|
| T1 | OK — 1ª entrega (pergunta, sem link), Evolution confirmou, jornada `aguardando_satisfacao` |
| T2 | OK — resposta positiva processada automaticamente pelo Íris Oficial (já ativo); 2º envio só aqui, com link; jornada `encerrada`, convite gravado |
| T3 | OK — resposta negativa → agradecimento sem link; jornada `encerrada`, `classificacao: nao_positiva`, sem convite |
| T4 | OK — recuperação nas DUAS etapas (`aguardando_inicio` e `finalizando`) via a Edge Function real, com lease forçado no passado; mesma `entrega_id`, tentativa 2 nas duas; envio real guardado nos dois pontos; confirma normalmente |
| T5 | OK — 4/4 abandonos silenciosos: automação desligada, vínculo inválido (paciente trocado), fora da janela de 48h, 3 tentativas esgotadas. Nenhuma mensagem enviada em nenhum; jornada `encerrada` com o motivo certo; telefone liberado |
| T6 | OK — jornada `aguardando_satisfacao` com `atualizada_em` forçada a 8 dias; RPC de expiração encerrou em silêncio (`abandonada_sem_resposta`), sem convite |
| T7 | OK — 4/4: sem cabeçalho, só publishable key, segredo errado, só o segredo sem JWT → 401 em todas |
| T8 | OK — modo Google: pergunta de satisfação primeiro (sem link); resposta positiva → link só depois; jornada `encerrada`, convite gravado |

**Contagem de envios reais pelo Evolution:** 6 (T1, T2, T3, T4×2, T8×2 — 7 no total, todos ao telefone autorizado,
conferido por leitura do destino antes de cada chamada). T5, T6 e T7 não enviam mensagem por desenho.

## Divergências/ocorrências durante o teste (nenhuma chegou a enviar fora do autorizado)
1. Meu script de setup reutilizável forçava `pos_consulta_tipo` de volta para `"ambos"` sempre que chamado — isso
   sobrescreveu por engano o modo `"google"` que eu tinha acabado de configurar para o T8. Percebido e corrigido antes
   do envio (a mensagem do T8 só saiu depois da correção, já no modo certo).
2. Um erro de coluna gerada (`telefone_normalizado`) no primeiro `insert` do sub-caso "vínculo" do T5 interrompeu o
   script antes de qualquer envio; a fixture ficou com uma entrega pendente (não enviada) por alguns instantes até eu
   retomar manualmente o mesmo fluxo com o `insert` corrigido — sem efeito no resultado final.
3. Gabriel abriu o painel de configuração da clínica (produto real) e viu que "Satisfação" e "Satisfação + Google"
   aparecem como "Em construção", travadas para a clínica escolher. A alteração não chegou a salvar; a config de
   teste no banco não foi afetada. Registrado como observação de produto (não é bug deste portão — ver memória
   `project_painel_pos_consulta_modos_travados`), não foi corrigido aqui.
4. Feedback do Gabriel sobre o tom do convite ao Google ("mais persuasivo, não condicional") — registrado como
   frente futura (memória `feedback_convite_google_mais_persuasivo`), não implementado.
5. Decisão sobre a frente de **inconformidade** (registrada, repassada por Codex): quando a resposta indicar
   insatisfação, a Iris deverá entender o ocorrido conversando o quanto for necessário e registrar o caso na aba
   **Exceções** do painel, categoria "Inconformidade do paciente". **Não implementada nesta entrega** — documentada em
   `reviews/runbook-aplicacao-pos-consulta-2026-09-20.md` (seção "Riscos que continuam abertos"). Comportamento atual
   (testado no T3): encerramento simples, sem registro em Exceções.

## Limpeza e restauração (confirmado por leitura)
- Config da Clear Dent: restaurada, **idêntica byte-a-byte** ao valor salvo antes do teste.
- Fixtures sintéticas (9 agendamentos marcados `TESTE-P6-POS-CONSULTA*`): todas apagadas.
- Jornadas de teste: todas apagadas (0 restantes na tabela).
- Paciente descartável criado para o sub-caso de vínculo: apagado.
- Telefone/instância: removidos do disco (`.tel`, `.instancia`); varredura confirma nenhum arquivo do scratchpad
  contém os dígitos do telefone em texto aberto.

## O que NÃO foi feito (por desenho)
- Nenhuma chamada à RPC ampla de candidatos (`cappia_pos_consulta_candidatos`).
- Disparo A: não tocado, continua inativo/gatilho desabilitado (mesmo estado do P5).
- Legado Google: não tocado, continua inativo.
- Nenhum envio para qualquer número diferente do telefone autorizado.

## Estado final
Banco: 0 jornadas, 0 fixtures, config da Clear Dent igual à de antes do teste. n8n: sem alteração. Edge Functions:
sem alteração (mesmas versões do P4). **P6 concluído. Não avancei ao P7/P8** — aguardo autorização para a revisão
final do Codex com o pacote sanitizado (P7).
