# E2E controlado — pós-consulta na Clear Dent (registro em andamento)

Autorização: Gabriel, 2026-09-19/20, exclusivamente para teste controlado na Clear Dent, com um único
telefone destino (extraído da execução n8n 167673; nunca registrado por inteiro). Este arquivo é o
registro acumulado para a revisão final do Codex; será completado no passo 10 (evidências sanitizadas,
limpeza e restauração da configuração).

## Estado publicado até aqui

- Migration `iris_nova_pos_consulta_v1` aplicada (versão `20260919204030`).
- Edge Functions: `iris-nova-pos-consulta` v1; `iris-nova-mensagem` v118 (rollback preparado: v117).
- n8n: Disparo A importado **inativo** (`Y6oMf0xBYWVi14Rh`, gatilho também desabilitado); patch de 3 nodes
  aplicado ao `Iris Oficial` pela interface (validado por GET: nodes/conexões originais idênticos; só `position`
  de 5 nodes mudou — aceito por Gabriel como divergência visual). Legado de avaliação Google intocado.
- Configuração da Clear Dent alterada **temporariamente**: `pos_consulta_tipo` `"google"` → `"ambos"`
  (anterior registrado). **RESTAURADA para `"google"` ao final** — ver "Limpeza e restauração".

## S1 — modo `ambos`, resposta positiva — APROVADO funcionalmente

| Etapa | Evidência |
|---|---|
| 1ª entrega | `iniciar` → `entrega_pendente`; destino devolvido == autorizado (conferido em código antes do envio); Evolution HTTP 201 + `key.id`; só então `confirmar` → `confirmada`; jornada `aguardando_satisfacao` |
| Resposta do paciente | execução n8n `168945` (success): Iris Oficial → Chamar Iris Nova (devolveu `resposta` + `pos_consulta_confirmacao`) → Enviar resposta Evolution (success + `key.id`) → Classificar (envio_confirmado) → IF (ramo verdadeiro) → confirmar → `confirmada` |
| Estado final | jornada `encerrada`, classificação `positiva`, `convite_google_em` gravado, sem token/lease; 1 turno auditado `sucesso`, sem `motivo_fallback`; 0 jornadas abertas |
| Formato do link | verificado no payload real: **URL simples**, sem `[texto](url)`, sem `<url>`, sem negrito/itálico Markdown, URL isolada por espaço e sem pontuação colada |

## S2 — modo `ambos`, resposta NEGATIVA — validado (somente leitura)

| Etapa | Evidência |
|---|---|
| 1ª entrega | fixture B; `iniciar` → `entrega_pendente`; destino == autorizado; texto sem link (149 caracteres); procedimento e dentista vindos do agendamento; Evolution HTTP 201 + `key.id`; `confirmar` → `confirmada` (15:35:28Z) |
| Resposta do paciente | 15:37Z (12:37 BRT), relato de insatisfação com dentista e recepção |
| 2ª entrega | execução n8n `169036` (success): mesmo caminho do S1, com os 3 nodes novos; Evolution success + `key.id`; IF verdadeiro; `confirmar` → `confirmada`. Texto: agradece o feedback e lamenta que a experiência com dentista e recepcionista não tenha sido positiva — **sem link, sem menção a Google/avaliação, sem Markdown, sem promessa** |
| Estado final | jornada `encerrada`, classificação `nao_positiva`, `convite_google_em` **não** gravado, sem token/lease; 0 jornadas abertas |
| Turno seguinte (fora da jornada) | execução `169068` (16:01Z): mensagem posterior do mesmo telefone tratada pelo fluxo normal (`pos_consulta_confirmacao` ausente, IF falso, confirmar não executado) — a jornada encerrada não é reaberta |

Observações para a nova frente de inconformidade (comportamento ATUAL, não alterado):
- A 2ª entrega ao relato negativo apenas agradece/lamenta e encerra — nenhuma compreensão do ocorrido, nenhum
  registro durável, nenhum alerta ao responsável.
- No turno seguinte (`169068`, teste feito pelo próprio Gabriel), o fluxo principal respondeu que a opinião
  "fica registrada". **Correção (Gabriel, 2026-09-20):** a frase não é falsa — a mensagem do paciente fica
  registrada no WhatsApp da clínica e nas conversas auditadas. O que falta é o registro em **nível de alerta**
  (inconformidade estruturada, visível na aba Exceções, com aviso privado ao responsável). Ponto para a spec:
  a Iris só deve afirmar **encaminhamento/alerta** quando o alerta tiver sido entregue; antes disso, não sugerir
  que alguém da clínica vai agir. Também sugeriu agendar um procedimento logo após a reclamação (ignorou o
  contexto emocional). A Iris reconheceu a insatisfação e as pessoas citadas nos dois testes; o que falta é o
  objetivo/regra sobre o que fazer com isso.

## Ajustes solicitados por Gabriel para a revisão final (NÃO implementados; registrados a pedido)

1. **Convite ao Google mais caloroso.** Explicar que a avaliação ajuda outras pessoas a conhecerem a clínica;
   manter o caráter opcional; variar livremente a redação; **nunca usar frase fixa**.
   - Observado no S1: o convite saiu correto e opcional, mas seco e sem o motivo da avaliação.
   - Onde atuar: `pos-consulta-redator-instrucoes.ts` (objetivos `convidar_avaliacao_google` e
     `agradecer_e_convidar_avaliacao_google`).
   - **Fallback (resolvido pela decisão de 2026-09-20, abaixo):** `pos-consulta-gerar-resposta-fallback.ts`
     contém frases fixas por desenho. Fica permitido **exclusivamente** para falha técnica ou resposta
     insegura; a conversa normal segue livre, orientada por objetivos, fatos autorizados e limites.
2. **Nome do profissional vem do agendamento, sem inventar título ou nome.**
   - Proveniência no S1: o "Dr. Teste" da 1ª mensagem veio de um valor cosmético que o **script de teste**
     enviou (`dentista_nome_exibido`), não do agendamento fixture (`Dr. Teste Sintetico`) nem de invenção da
     IA. Desvio do script, corrigido a partir do S2 (o script agora lê procedimento/dentista do próprio
     agendamento, como a RPC de candidatos faria) e ganhou trava que bloqueia o envio se o texto citar
     título/nome ausente do agendamento.
   - Lacuna no produto: as instruções dizem "se souber, pode mencionar"; não há regra explícita contra
     acrescentar título/nome nem guarda que valide isso no texto gerado.
3. **Link em URL simples no WhatsApp.** Confirmado no S1 (ver tabela). Recomendação: tornar explícita a regra
   nas instruções ("URL pura, sem Markdown") e acrescentar à guarda a rejeição de `[..](..)`/`<..>`.

## Mudança de requisito — NOVA FRENTE: tratamento de inconformidade (decisão de Gabriel, 2026-09-20)

**Status: registrada; exige spec (a cargo do Codex) e aprovação do Gabriel ANTES de qualquer implementação.
Nada disto foi implementado nem será improvisado durante o E2E atual.**

**Regra do Google MANTIDA (decisão de Gabriel, não reinterpretar):** o link de avaliação só é enviado quando a
satisfação é classificada como **positiva**. Respostas negativas ou incertas **não recebem link**. Ninguém é
impedido de avaliar espontaneamente. O alerta do Codex sobre a política do Google contra solicitação seletiva de
avaliações fica registrado **apenas como risco conhecido**; o fluxo do Google não é alterado.

Escopo da nova frente (exclusivamente inconformidade):

1. Ao identificar insatisfação, a Iris acolhe (empatia, sem se defender/minimizar/culpar/admitir fatos não
   confirmados) e avalia se já compreendeu o ocorrido.
2. Decide inteligentemente se precisa perguntar mais ou menos; **uma pergunta por vez**, natural, sem roteiro
   fixo, sem interrogatório, sem repetição; se o relato já está claro, não pergunta o desnecessário.
3. Se o paciente não quiser continuar, respeita e registra o que já foi informado.
4. **Registro durável imediato** de toda inconformidade, mesmo se a conversa for abandonada; atualizado com os
   novos detalhes **sem duplicidade** (mesmo registro).
5. Ao concluir: resumo objetivo, confirmado com o paciente; informa o encaminhamento ao responsável **somente
   quando registro e mecanismo de encaminhamento estiverem tecnicamente garantidos**.
6. Não promete prazo, solução, retorno, reembolso ou providência não autorizada.
7. Registro mínimo: clínica, paciente, consulta; relato original; resumo da Iris; pessoas/áreas citadas;
   perguntas feitas e informações obtidas; data e estado; situação (novo / em acompanhamento / resolvido);
   histórico de encaminhamento e confirmação de entrega.
8. Alerta **privado** ao responsável configurado pela clínica, com confirmação de entrega e idempotência;
   caso incompleto = "relato preliminar", atualizado depois.
9. Painel — **AJUSTE DE DECISÃO (Gabriel, 2026-09-20): NÃO criar área separada "Feedbacks dos pacientes".**
   Todo registro de insatisfação fica na **aba existente "Exceções"**, com tipo/categoria **"Inconformidade do
   paciente"**. Nessa categoria mostrar: paciente e consulta relacionados; data do relato; relato original;
   resumo preparado pela Iris; pessoas ou setores mencionados; situação (novo, em acompanhamento ou
   resolvido); responsável interno; histórico de encaminhamento e providências. A interface deve permitir
   **filtrar** as inconformidades **sem misturá-las visualmente com erros técnicos**.
10. Conversa normal livre (objetivos + fatos autorizados + limites); fallback fixo só para falha técnica ou
    resposta insegura.

Entregas esperadas para aprovação (a preparar depois do E2E, não agora): proposta de spec, estados da jornada,
modelo de dados, interface do painel e mecanismo de alerta.

**Efeito sobre o E2E em curso:** o comportamento atual para resposta negativa/incerta (agradecer sem link,
encerrar) é o que está implementado e é o que o S2/S3 validam; ele será substituído pela nova frente, não por
ajuste durante o teste.

## Preparação do S3 (pedido do Codex/Gabriel, 2026-09-20)

**Contexto do paciente de teste (fato real, não é invenção nem erro da Iris):** o paciente usado nos testes é o
próprio Gabriel e possui **plano de tratamento real** — canal do dente 12 indicado pelo Dr. Pablo e restauração
marcada para 28/09. A Iris costuma mencionar essas pendências corretamente (ela as lê de `tratamentos_pendentes`
do registro do paciente, não do histórico da conversa). Nenhum dado do plano de tratamento foi alterado.

**Resposta do S3 (definida pelo Codex):** "Foi ótimo! Aliás, quero marcar uma limpeza. Não estou falando do canal
agora; quero saber sobre a limpeza." (mensagem digitada por Gabriel, não pelo script).
**Critério:** o pedido explícito de limpeza não pode ser engolido nem substituído pelo canal pendente. A Iris pode
mencionar a pendência se for relevante, mas deve respeitar que o assunto solicitado agora é a limpeza. A
satisfação positiva continua elegível ao convite do Google somente conforme a regra vigente.

**Memória conversacional limpa antes do S3 (a pedido de Gabriel):**
- O que a Iris usa como memória é `estado_conversa.historico_conversa` (até 10 pares; validade de leitura 12h).
  Havia 4 pares (3 dentro de 12h) — incluindo o relato negativo do S2 e o turno "fica registrada".
- Feito: backup da linha inteira (arquivo local `backup-estado_conversa-pre-s3.json`, fora do repositório) e
  `historico_conversa = null` **somente** nessa linha, com CAS sobre `atualizado_em`. `estado`, `paciente_id`,
  `ultima_troca` e `aguardando_resposta` inalterados; `conversas_auditoria` **intacta** (a evidência do S1/S2 e
  o turno 169068 permanecem auditados). Restauração de `estado_conversa` continua prevista no passo 8.
- Efeito no que o S3 mede: o cenário misto agora é avaliado sem o contexto do relato negativo do S2.

**Regra adicional para a nova frente de inconformidade (Codex, 2026-09-20):**
- Enquanto a inconformidade estiver **aberta**, não retomar plano de tratamento nem oferecer agendamento.
- Depois que o paciente indicar **claramente** que terminou o relato, encerrar o assunto com cuidado.
- Só então voltar a outras pendências, **preferencialmente perguntando se ele deseja tratar de mais alguma coisa**,
  em vez de oferecer imediatamente um procedimento.
- Evidência do problema atual: no turno `169068` o fluxo principal ofereceu agendamento logo após a reclamação.

## S3 — modo `ambos`, mensagem mista (positiva + pedido de limpeza) — validado (somente leitura)

| Etapa | Evidência |
|---|---|
| 1ª entrega | fixture C; `iniciar` → `entrega_pendente`; destino == autorizado (conferido antes do envio); 139 caracteres, sem link; profissional vindo do agendamento; Evolution HTTP 201 + `key.id`; `confirmar` → `confirmada` (16:38:27Z) |
| Resposta do paciente | "Foi ótimo! Aliás, quero marcar uma limpeza. Não estou falando do canal agora; quero saber sobre a limpeza." (digitada por Gabriel) |
| 2ª entrega | execução n8n `169136` (success): mesmo caminho dos 3 nodes novos; Evolution success + `key.id`; IF verdadeiro; `confirmar` → `confirmada` |
| Texto entregue | 1 mensagem: agradecimento pela satisfação + convite opcional ao Google com **URL simples** (sem `[..](..)`, sem `<..>`, sem negrito/itálico Markdown, URL isolada, sem pontuação colada) + pergunta "Para a limpeza, qual desses profissionais você prefere?" com 3 profissionais |
| Critério do Codex | **Atendido:** o pedido de limpeza não foi engolido (a Iris seguiu para a limpeza e pediu o profissional) e o canal pendente **não** substituiu nem foi mencionado |
| Estado final | jornada `encerrada`, classificação `positiva`, `convite_google_em` gravado, sem token/lease; 1 turno auditado `sucesso`, sem `motivo_fallback`; 0 jornadas abertas |

**Origem dos nomes "Diego Perez", "Diego Ramoz" e "Pablo Arruda" (verificado em leitura):** vieram dos fatos
autorizados da clínica, **não** foram inventados pelo redator. O cadastro `clinicas.dentistas` da Clear Dent tem
exatamente três profissionais, todos `ativo: true` e com `titulo: "Dr."`: Diego Perez, Diego Ramoz e Pablo Arruda.
O Core monta `nome_exibido = titulo + nome` (`carregar-catalogo.ts`, `montarDentistas`) e entrega a lista como
`dentistas_candidatos` (objetivo `escolher_entre_dentistas`, `fatos-autorizados.ts`). O "Dr. Teste Sintético" das
fixtures **não** está nesse cadastro e, corretamente, não foi oferecido. (Nota histórica: em 2026-08-18 Pablo Arruda
estava `ativo: false`; hoje está `true`.)

Observação de formato: a lista de profissionais saiu com marcadores `* ` em texto simples (sem negrito). Para a
spec: definir explicitamente a regra de formatação de listas no WhatsApp.

## Melhoria geral aprovada para especificação: respostas em mais de uma mensagem (Gabriel/Codex, 2026-09-20)

**Status: registrada; especificar antes de implementar; NÃO alterar durante este E2E.** É uma melhoria **geral da
Iris**, não uma exceção da pós-consulta.

- **Motivo (S3):** a resposta cobriu os dois objetivos, mas numa mensagem só. O encerramento da satisfação + convite
  ao Google deveriam ser a **primeira** mensagem; a pergunta sobre o profissional da limpeza, uma **segunda**
  mensagem (mudança clara de assunto).
- **Requisitos:** saída **estruturada** com mensagens **ordenadas** e **finalidade identificável** (ex.: encerramento
  da pós-consulta, convite ao Google, pergunta operacional); a Iris **decide** quando a separação melhora a conversa;
  **não** é quebra fixa de texto (nada de dividir por regex/tamanho); **não** é exceção só da pós-consulta;
  normalmente **no máximo duas** mensagens; evitar fragmentação e spam; envio **sequencial**; **confirmação e retry
  por entrega**, sem duplicar a anterior.
- **Impacto técnico a tratar na spec:** hoje o contrato reativo devolve **um** `resposta` e **um**
  `pos_consulta_confirmacao`; o n8n envia uma vez e confirma uma vez. Várias mensagens exigem identidade e
  confirmação por mensagem (a semântica `entrega_id` estável / `claim_token` rotativo por entrega), ordenação
  garantida e definição do que acontece se a 1ª foi confirmada e a 2ª falhou (retry só da 2ª).

## Limpeza e restauração (passo 8) — concluída em 2026-09-20

Feita com trava em cada passo (qualquer divergência interromperia sem improvisar). Export bruto local feito antes
de apagar (fora do repositório).

| Item | Resultado |
|---|---|
| Jornadas das 3 fixtures | 3 apagadas (todas `encerrada`); tabela `pos_consulta_jornadas` com 0 linhas |
| Agendamentos fixture A/B/C | 3 apagados (por id, na Clear Dent, `dentista_nome = 'Dr. Teste Sintetico'`); agendamentos da clínica 136 → 133 (os 133 pré-existentes intocados) |
| `conversas_auditoria` do teste | 4 apagadas (as do E2E, posteriores a t0); as 12 anteriores preservadas (baseline 24 → 12 explicado pelo job de retenção; ver "Reconciliação") |
| `mensagens_fila` | nenhuma linha criada pelo teste (0) |
| `estado_conversa` | restaurado do backup original; linha **idêntica** ao backup (comparação campo a campo) |
| `pos_consulta_tipo` | `"ambos"` → `"google"`; `automatizacoes` **idêntica** ao backup original |
| Paciente e plano de tratamento | intocados |
| Estrutura nova | **mantida**: migration, tabela `pos_consulta_jornadas`, 4 RPCs `cappia_pos_consulta_*`, Edge Functions publicadas |
| n8n | Disparo A **inativo** (gatilho desabilitado, 0 execuções); Iris Oficial ativo (com os 3 nodes do patch); legado Google **DESATIVADO (despublicado) por Gabriel após a contenção, confirmado por GET em 20/09 19:56Z** (ver "Esclarecimentos pós-E2E e contenção do legado") |

Evidência sanitizada (sem telefone, sem texto de paciente, nome mascarado):
`e2e-pos-consulta-clear-dent-2026-09-20.evidencia-sanitizada.json`. Prova de destino único:
- 3 primeiras entregas por script guardado, todas para o telefone autorizado (Evolution 201 + `key.id`);
- 4 turnos reativos, cada um correlacionado 1:1 a uma execução do Iris Oficial **cujo remetente é o autorizado** e
  cuja resposta da Evolution foi para o autorizado (`remoteJid`);
- **as únicas 4 execuções do Iris Oficial desde o início do teste foram essas**;
- Disparo A: **0** execuções; RPC ampla de candidatos: **não executada**.

**Observações posteriores (legado, auditorias, token, telefone em arquivos):** ver a seção seguinte
"Esclarecimentos pós-E2E e contenção do legado", que **substitui** as observações anteriores deste bloco
(inclusive "77 execuções" e "revogar dois tokens").

## Esclarecimentos pós-E2E e contenção do legado (2026-09-20)

Somente leitura, exceto a contenção pedida por Gabriel. Nada do legado foi corrigido, o Disparo A não foi ativado.

### 1. Contenção: desativar SOMENTE o workflow legado "Pos-Consulta - Avaliacao Google" (`h8HxxQK7T6et4tYP`)

Autorizada por Gabriel: sem excluir nem modificar nodes; sem tocar Iris Oficial nem Disparo A; sem corrigir o
legado; sem ativar o novo. O legado fica desativado até a correção da janela máxima e a revisão final do Codex.

- **Tentativa pela API do n8n:** `POST /workflows/h8HxxQK7T6et4tYP/deactivate` → **HTTP 403 Forbidden** (mesma
  limitação de escopo da chave já registrada no PUT). Uma única tentativa, sem sondas adicionais.
- **Releitura por GET logo depois:** legado ainda `active = true` (nodes, conexões e settings idênticos, hash
  `700d8465f4b1`); **Iris Oficial idêntico** (hash completo `c77dda6ce9ff`, `versionId 4c68af00…`, ativo); **Disparo
  A idêntico e inativo** (hash `2d9dd110944d`, gatilho desabilitado).
- **Executada por Gabriel pela interface do n8n** (ação **"Despublicar"**; a interface confirmou "Fluxo de trabalho
  despublicado com sucesso" e passou a mostrar o botão "Publicar"). Uma primeira tentativa manual não se refletiu na
  API: releitura às 19:33Z ainda com `active = true` e execuções às 19:00, 19:15 e 19:30Z (todas com erro).
- **CONFIRMADO por GET (somente leitura), 2026-09-20 19:56:35Z:**
  - **Legado `h8HxxQK7T6et4tYP`: `active = false`.** Nodes, conexões e settings **idênticos** (hash `700d8465f4b1`;
    nada excluído nem modificado; o gatilho segue configurado, mas o workflow está despublicado).
  - **Iris Oficial: `active = true`**, workflow completo **idêntico** (hash `c77dda6ce9ff`, `versionId 4c68af00…`).
  - **Disparo A: `active = false`**, gatilho desabilitado, 0 execuções, workflow completo **idêntico** (hash
    `2d9dd110944d`).
- **Última execução registrada do legado: `169360`, 19:45:42Z (erro).** Não é possível afirmar se foi antes ou depois
  da despublicação. **Confirmação posterior (somente leitura, 20:02:30Z):** **não houve execução no ciclo esperado
  das 20:00:42Z**; a última execução permaneceu sendo a `169360` (19:45:42Z); legado `active = false`, Iris Oficial
  `active = true` e Disparo A `active = false`. O legado permanece **desativado** até a correção da janela máxima e a
  revisão final do Codex; a reativação só deve ocorrer depois disso.

### 2. Auditoria das execuções do legado (80 execuções, somente leitura, dados mascarados)

| Período | Execuções | Sucesso | Falha | Candidatos por execução |
|---|---|---|---|---|
| A. Antes da mudança temporária (até 01:37Z de 20/09) | 15 | 0 | 15 | 20 |
| B. Config `"ambos"` (01:45Z–17:00Z) | 62 | 62 | 0 | 0 |
| C. Depois da restauração para `"google"` (17:15Z–17:45Z) | 3 | 0 | 3 | 20 |
| **Total** | **80** | 62 | **18** | |

- **80 execuções auditadas** (o "77" anterior era um retrato anterior à restauração; +3 depois dela).
- Os 62 "sucessos" são execuções em que a RPC devolveu **zero candidatos** (a Clear Dent estava fora do filtro pelo
  `"ambos"`); "sucesso" ali não significa envio.
- **18 falhas reais**, todas idênticas: Evolution `400 Bad Request`, `exists: false` — o número **não tem
  WhatsApp**. É **sempre o mesmo número** (identificador por hash `51692127`) e **sempre o primeiro da fila**
  (18/18): o node de envio falha nele e o lote inteiro para a cada 15 min; os outros 19 itens nunca são tentados
  (bloqueio de cabeça de fila; o registro nunca é marcado como enviado, então repete indefinidamente).
- **Nenhum envio concluído:** o node `Evolution Enviar Texto` nunca terminou sem erro e os nodes de classificação/
  marcação nunca chegaram a existir em nenhuma execução desde t0. Nenhuma execução mencionou o telefone autorizado
  nem as fixtures.
- **Fila:** o lote é sempre o mesmo (1 conjunto entre as 18 execuções): 20 linhas de agendamento, **12 telefones
  distintos** (até 4 agendamentos por telefone), 1 clínica (Clear Dent), 1 instância, agendamentos de **24/08 a
  31/08**. `MODO_SIMULACAO = false`, `LOTE_LIMITE = 20`; instância Evolution `open`; clínica `conectado`.
- **RISCO:** o legado **não tem janela máxima de idade** (mesmo defeito do bloqueio da ativação recorrente da nova
  RPC). Se o bloqueio (número inválido na cabeça da fila) desaparecer — número corrigido, removido ou marcado —, o
  legado passa a enviar **pedidos reais de avaliação do Google à fila histórica**, em lotes de 20 a cada 15 min.
  Isso já era assim antes do teste.
- **Efeito da restauração:** entre 01:37Z e ~17:10Z a mudança temporária para `"ambos"` tirou a Clear Dent do filtro
  do legado (0 candidatos); ao restaurar `"google"` (estado original, conforme o plano) o legado voltou a tentar a
  fila e a falhar (3 falhas, 17:15–17:45Z).

### 3. Reconciliação das auditorias (baseline 24 × 12 preservadas)

- **Unidade:** 1 linha de `conversas_auditoria` = 1 turno auditado. **24** = linhas da clínica+telefone em t0
  (baseline); **12** = linhas do telefone anteriores a t0 que existem hoje; **4** = linhas criadas depois de t0 (o
  E2E), apagadas na limpeza.
- **Causa da diferença de 12:** job de retenção do banco (pg_cron, job 1, diário 03:00 UTC:
  `delete … where criado_em < now() - interval '7 days'`). Em 20/09 03:00Z rodou com `DELETE 14` (tabela inteira),
  antes de qualquer turno do teste; corte 13/09 03:00Z; a linha mais antiga que restou é de 15/09. Que 12 dos 14
  sejam deste telefone é inferência (24 − 12), não verificável por linha.
- **Prova por contabilidade:** `n_tup_del = 77` = 73 (soma dos 15 registros do job desde 06/09) + 4 (minha limpeza).
  A limpeza usou 4 IDs explícitos com `criado_em >= t0`, clínica e telefone, e devolveu exatamente 4 (horários
  14:26:52, 15:37:13, 16:02:02 e 16:49:58Z de 20/09; hashes de resposta `bfbbf0a3`, `1e9372e6`, `0fea2b10`,
  `3cadd253`). Sobreviventes: 12 linhas, hash da lista de IDs `2da950db5a65`, hash de conteúdo `5f090e66de7c`.
- **Limite da prova:** não existe lista de IDs anterior ao teste (o baseline guardou só a contagem); por isso a
  prova é contábil, não uma comparação de IDs antes/depois. Falha de processo minha: o preflight mostrou 12 e eu não
  cruzei com o baseline de 24 antes de apagar (a trava por IDs protegeu a limpeza).
- **Consequência:** a retenção de 7 dias também expira as 12 preservadas (15/09 em 22/09; 19/09 em 26/09). O pacote
  sanitizado é a evidência durável.

### 4. Token Supabase (um token exposto, não dois)

- **Um único token** esteve exposto (impressão digital `8bc8e2`, igual ao que estava no cofre): como texto de
  usuário nesta sessão (19/09 21:06:51Z, transcrição linhas 4038 e 4040), no log da extensão do VS Code
  (`Claude VSCode.log`) e no cofre (intencional). Não encontrado em histórico do PowerShell, repositório, scratchpad,
  `~/.supabase` nem `~/.claude`. O cofre foi gravado às 21:05:26Z, 85 s antes da mensagem no chat; não se sabe como o
  valor foi submetido ao chat. Esse mesmo token foi o usado no deploy.
- **ENCERRADO (Gabriel, 20/09):** os **dois tokens temporários** criados em 19/09 (o do cofre criado às 20:54:27Z e o
  que o sobrescreveu às 21:05:26Z, o exposto) foram **revogados por ele** na conta Supabase. Confirmação técnica do
  exposto: `GET /v1/projects` com ele → **HTTP 401**. O valor exposto ainda consta na transcrição e no log da
  extensão, agora sem efeito. Consequência prática: acessos ao banco por essa credencial deixam de funcionar; novos
  passos precisam de nova credencial.

### 5. Telefone real em quatro arquivos versionados

Todos versionados (commitados em HEAD da branch `feat/pos-consulta-conversacional`; os commits também estão em
`origin/main`, GitHub `gabrielcappello/cappia-iris-core`):
- `specs/plano-tratamento-vs-remarcacao-v1.md` (commit `b6f908f`, 03/09)
- `src/core/auditoria-conversas.test.ts` (commit `d275b38`, 05/09; **modificação local não commitada** de 19/09,
  de 13 para 15 ocorrências do mesmo valor)
- `src/eval/teste-real-snapshot-legado.ts` (commit `810f029`, 12/08)
- `supabase/functions/iris-nova-mensagem/auditoria-conversas.test.ts` (commit `d275b38`, 05/09; idem, **modificação
  local não commitada**, 13 → 15)

Nenhum arquivo criado por este E2E contém o telefone. **Não alterado**: decisão pendente de Gabriel/Codex sobre
substituir por número fictício.

## Bloqueios já conhecidos para a ativação recorrente (inalterados)

- A RPC `cappia_pos_consulta_candidatos` não tem janela máxima de idade e alcançaria hoje 90 agendamentos
  históricos da Clear Dent (24/08–09/09). Também não replica os filtros da RPC legada: `pos_consulta_enviado =
  false`, telefone do agendamento não nulo, `whatsapp_status = 'conectado'`, link Google preenchido.
- Disparo A permanece inativo (gatilho desabilitado) até correção e revisão.
- O workflow **legado** do Google permanece **desativado** (contenção de 20/09) até a correção da janela máxima de
  idade e a revisão final do Codex; ele tem o mesmo defeito (sem janela máxima) e hoje só não envia porque a
  fila trava num número inválido.
