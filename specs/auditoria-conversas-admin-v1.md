# Auditoria de conversas no painel admin — v1

**Status:** especificação **aprovada pelo Gabriel em 05/09/2026 para início de
implementação** (ver seção "Aprovação", ao final). Aprovação cobre código,
migration local/dev e testes — **não** cobre migration em produção, deploy
ou publicação, que continuam exigindo revisão do código contra esta spec e
autorização explícita e posterior do Gabriel.

## Para quem revisa isto sem contexto prévio

Este documento pede uma **revisão de arquitetura, segurança e aderência** à
especificação proposta — o papel que `AGENTS.md` (raiz do repositório
`cappia-iris-core`) atribui ao Codex no processo do projeto ("Processo
obrigatório", passo 3).

**O que ler antes, nesta ordem** (todos em `cappia-iris-core`, salvo indicação
contrária):

1. `docs/00-principios.md` — os 4 princípios que toda spec deve seguir; esta
   declara aderência a eles logo abaixo.
2. `docs/03-seguranca.md` — isolamento por `clinica_id`, e a regra de logs
   técnicos sem PII (este documento propõe uma tabela operacional, não um log
   técnico — a distinção importa e é discutida na seção 5).
3. `src/core/historico-conversa.ts` — o mecanismo hoje existente que esta spec
   **não altera**: a janela de 12h/10 pares que a Iris usa para dar contexto à
   IA de interpretação e à redatora.
4. `supabase/functions/iris-nova-mensagem/index.ts`, a partir da linha ~308 —
   o ponto exato do turno onde `gravarHistoricoConversa` é chamada, e logo a
   seguir onde a Edge Function já grava efeitos "ao lado" da resposta ao
   paciente (`compararComSombraCapacidadeV2` via `EdgeRuntime.waitUntil`) — o
   padrão que esta spec propõe reaproveitar, não inventar.
5. `iris-portal-v2/src/app/admin/page.tsx` e
   `iris-portal-v2/src/app/api/admin/clinicas/route.ts` — o painel
   administrativo Cappia já existente (lista de clínicas), protegido por
   sessão + `is_admin = true` checado no servidor. Esta spec adiciona uma tela
   dentro dele, reaproveitando a mesma checagem de acesso.

**Contexto mínimo do sistema, para quem nunca viu este projeto:** a Iris Nova
é um assistente de WhatsApp para clínicas odontológicas (`cappia-iris-core`,
Edge Function `iris-nova-mensagem`). O painel (`iris-portal-v2`,
`painel.cappia.app`) é a interface web da Cappia e das clínicas. Hoje, o único
lugar onde o texto de uma conversa entre paciente e Iris existe fisicamente no
banco é `estado_conversa.historico_conversa` — os últimos 10 pares
(mensagem do paciente + resposta da Iris), e cada par só é **lido** pela IA
enquanto tiver menos de 12 horas (`VALIDADE_HISTORICO_MS`,
`historico-conversa.ts`). Passado esse tempo, o par continua fisicamente na
coluna até ser empurrado para fora pelo corte de 10 pares — mas nada hoje o
lê nem o expõe para revisão humana.

## Objetivo

O Gabriel quer revisar conversas reais de clínicas em teste, do painel
`/admin`, para achar bugs e avaliar a qualidade da conversa — sem entrar no
painel de cada clínica (`/dashboard`) e sem depender da janela de 12h que a
Iris usa para decidir o próximo passo.

## Aderência a `docs/00-principios.md`

- **Responsabilidade correta.** Nenhuma regra nova de interpretação ou decisão
  de conversa. Isto é puramente registro de auditoria, gravado depois que a
  resposta ao paciente já foi decidida — a mesma fronteira que
  `gravarHistoricoConversa` já respeita hoje.
- **Remoção / não-duplicação de mecanismo.** Não estende
  `historico_conversa` nem `mensagens_recebidas`. Reaproveita o ponto de
  gravação e o padrão de efeito paralelo (`EdgeRuntime.waitUntil`) que já
  existem e já são testados em produção — não inventa um mecanismo novo de
  "gravar depois da resposta", só um destino novo para o mesmo evento.
- **Teste isolado.** A tabela nova nunca é lida pelo Core nem pela IA — os
  cenários de teste (seção 6) provam isso explicitamente: apagar ou corromper
  a tabela de auditoria não pode mudar nenhuma decisão do turno.
- **Testes realistas.** Cenário de origem: o próprio Gabriel, revisando
  conversas de teste reais de clínicas (Cleardent e a segunda clínica de
  teste hoje cadastrada), sem hipótese sintética.

## 1. O que muda

### 1.1 Tabela nova, só de auditoria — nunca lida pelo fluxo de decisão

Uma tabela nova, `conversas_auditoria` (nome fechado, ver seção 2), gravada
**uma vez por turno**, no mesmo ponto onde `gravarHistoricoConversa` já é
chamada hoje (`supabase/functions/iris-nova-mensagem/index.ts:308`) — mas
com escopo diferente na gravação de falha, ver seção 1.2:

| Campo | Tipo | Observação |
|---|---|---|
| `id` | uuid | chave própria |
| `clinica_id` | uuid, FK `clinicas(id)`, **nullable** | nulo somente quando `resultado_turno = 'clinica_nao_encontrada'` (a clínica nunca foi resolvida) — em todo outro caso dentro do escopo (seção 1.2), preenchido pela consulta best-effort descrita ali |
| `telefone_normalizado` | text, **NOT NULL** | **Correção sobre a v1 desta spec (revisão do Codex, 05/09):** `validarPayload` já garante `telefone_normalizado` como string não vazia antes de qualquer chamada a `processarMensagem` (`index.ts:55-56`) — nenhum erro dentro do escopo de gravação (seção 1.2) pode ocorrer sem ele já estar disponível. Diferente de `clinica_id`, nunca é nulo nesta tabela |
| `mensagem_paciente` | text | texto exatamente como chegou — mesma política de "sem sanitização nesta v1" já decidida para `historico_conversa` (seção 0.1 de `specs/historico-conversacional-v1.md`). Sempre presente: só é gravada uma linha depois do payload já ter sido parseado com sucesso (ver 1.2) |
| `resposta_iris` | text, **nullable** | a resposta final produzida (sucesso, ou texto fixo de um fallback determinístico como o de resposta truncada) — nulo quando o desfecho é um erro técnico sem texto de conversa (`clinica_nao_encontrada`, `entrada_invalida`, `erro_interno`) |
| `motivo_fallback` | text, **nullable** | preenchido só quando `resultado_turno = 'sucesso'` **e** a resposta não veio da redação normal: valores possíveis `redator_nao_configurado`, `falha_redatora`, ou o `motivo` devolvido pela guarda (`resultadoGuarda.motivo`, `gerar-resposta-conversacional.ts`) — nunca inferido, sempre o valor real que o código já produz internamente como telemetria |
| `resultado_turno` | text, vocabulário fechado | ver lista exata abaixo; nunca inferido pela ausência de outro campo |
| `criado_em` | timestamptz, default `now()` | usado para a retenção (seção 3) |

**Vocabulário fechado de `resultado_turno`** (mapeado 1:1 ao código de
`supabase/functions/iris-nova-mensagem/index.ts`, sem "etc."): `'sucesso'`,
`'clinica_nao_encontrada'` (`ClinicaNaoEncontradaError`),
`'entrada_invalida'` (`EntradaInvalidaError`),
`'resposta_truncada_apos_retry'` (mesmo nome que o próprio código já usa no
log em `tratarErroDoTurno`, linha ~121 — cobre tanto a 1ª tentativa truncada
seguida de 2ª também truncada quanto a 1ª truncada seguida de 2ª falhando
por qualquer outra categoria; **corrigido nesta rodada**: o nome anterior,
`resposta_truncada_dupla`, sugeria só o primeiro caso), `'erro_interno'`
(qualquer exceção não coberta pelos ramos anteriores).

**Nunca lida por `orquestrador.ts`, por nenhuma IA, nem por
`historico-conversa.ts`.** É gravada e existe exclusivamente para leitura
humana via `/admin`.

### 1.2 Gravação: efeito paralelo, nunca bloqueante — escopo corrigido

**Correção sobre a v1 desta spec (revisão do Codex, 05/09):** gravar só no
ponto de sucesso deixaria de fora os turnos de falha, que são exatamente o
que mais importa investigar — mas capturar **todo** tráfego HTTP (incluindo
o que nunca chega a ser uma conversa válida) tem o problema oposto: gravaria
tráfego não confiável (nenhuma instância autenticada, nenhum
`telefone_normalizado` validado), e no caso de `configuracao_ausente`
(Supabase/env ausente) a própria gravação seria tecnicamente impossível — a
credencial que gravaria a linha é o mesmo dado que está faltando.

**Escopo corrigido, dois pontos de gravação, ambos como efeito paralelo
via `EdgeRuntime.waitUntil`, nunca bloqueando a resposta:**

1. **Sucesso** — o ponto já descrito (linha ~308), com
   `resultado_turno = 'sucesso'` e `motivo_fallback` conforme a tabela acima.
2. **Falha, somente dentro do `try` de `processarMensagem`** (`index.ts`,
   a partir da linha ~223) — ou seja, **somente depois que**: o método é
   `POST`; o payload foi parseado com sucesso por `validarPayload`; as
   variáveis de ambiente (`OPENAI_API_KEY`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `INSTANCIA_WHATSAPP_AUTORIZADA`) estão
   presentes; e `payload.instancia_whatsapp` bateu com a instância
   autorizada. **Nunca gravado:** `metodo_nao_permitido`,
   `payload_invalido` (e as variações de `validarPayload`:
   `payload_deve_ser_objeto`, `payload_contem_propriedade_nao_permitida`,
   `provider_invalido`, `instancia_whatsapp_invalido`,
   `telefone_normalizado_invalido`, `mensagem_invalida`),
   `configuracao_ausente`, `instancia_nao_autorizada` — nenhum desses
   representa uma conversa (o remetente não foi sequer autenticado como
   instância válida), e não seria possível compor uma linha útil para a
   tela de auditoria a partir deles.

   Dentro desse escopo, grava o que houver disponível: `telefone_normalizado`
   sempre (garantido por `validarPayload`, ver seção 1.1), `mensagem_paciente`
   sempre (o payload já foi parseado neste ponto), `resposta_iris` como o
   texto fixo devolvido quando houver (caso de resposta truncada) ou `null`
   para os demais, e `resultado_turno` conforme o vocabulário fechado acima.

**Resolução de `clinica_id` na gravação de falha (correção sobre a v1 desta
spec, revisão do Codex, 05/09):** quando `processarMensagem` lança, o
`handler` não tem mais acesso a nenhum `clinica_id` já resolvido
internamente pelo Core (o erro interrompe o fluxo antes de devolvê-lo). Para
que falhas de uma clínica real ainda apareçam na tela por clínica, a
gravação de falha faz, ela mesma, em segundo plano, a mesma consulta que
`identificacao.ts` já faz (`buscarClinica`, mesmo arquivo): `select id from
clinicas where provider = :provider and instancia_whatsapp =
:instancia_whatsapp`, usando os valores já disponíveis do `payload` (que
neste ponto do escopo já passou por `validarPayload` e pela checagem de
instância autorizada). Encontrando a clínica, preenche `clinica_id`; não
encontrando (só pode ocorrer aqui se a clínica foi removida entre a
checagem de instância e a falha — janela estreita) ou se o próprio
`resultado_turno` já é `'clinica_nao_encontrada'`, permanece `null` — e
essa linha específica não aparece no fluxo "clínica → conversas" (seção 2).
Esta consulta extra é, ela mesma, parte do efeito paralelo via
`EdgeRuntime.waitUntil` — nunca aguardada antes do `return` do handler,
nunca toca `orquestrador.ts` nem qualquer módulo do Core, e sua falha
(timeout, erro de rede) é absorvida em silêncio como o resto da gravação.

**Diferença deliberada em relação a `gravarHistoricoConversa`:** esta escrita
é um `INSERT` simples, sem CAS — cada turno gera uma linha nova e
independente, nunca um `UPDATE` sobre uma linha existente. Não há "estado
anterior" para encadear, porque a tabela não é lida por ninguém que precise de
uma sequência coerente por CAS — é puramente um apêndice cronológico.

### 1.2.1 O que esta gravação prova, e o que ela NÃO prova

**Correção sobre a v1 desta spec (revisão do Codex, 05/09):** o ponto de
gravação de sucesso confirma que a Edge Function **produziu** uma resposta e
a devolveu no corpo HTTP ao n8n — não confirma que o paciente a recebeu no
WhatsApp. A entrega real depende do n8n encaminhar e da Evolution API
entregar, nenhum dos dois observado por esta spec. A tela em `/admin` deve
rotular a coluna como "resposta produzida/devolvida ao n8n" (ou
equivalente), nunca "resposta entregue" ou "enviada ao paciente". Rastrear
confirmação de entrega real está **fora de escopo desta v1** — não é
ampliado nem presumido aqui.

### 1.2.2 Garantia de gravação: best-effort, não exactly-once

**Correção sobre a v1 desta spec (revisão do Codex, 05/09):** gravação em
segundo plano (`EdgeRuntime.waitUntil`, sem retry, sem confirmação) pode
perder um registro pontual — mesma garantia (ou ausência dela) que
`compararComSombraCapacidadeV2` já assume hoje em produção para a
sombra V2. Esta spec **não promete** captura de 100% dos turnos, e a tela em
`/admin` deve deixar isso explícito (ex.: nota de rodapé "registro
best-effort; a ausência de um turno aqui não prova que ele não ocorreu").
Garantir ausência absoluta de perda exigiria outro compromisso de
persistência (escrita síncrona antes do `return`, fila com confirmação,
etc.) — **decisão separada, não incluída nesta v1**, e que trocaria o
trade-off atual (nunca atrasar nem arriscar o atendimento) por outro. Não
deve ser adicionada sem aprovação explícita do Gabriel, por trocar essa
garantia.

### 1.3 O que NÃO muda

- `estado_conversa.historico_conversa` continua exatamente como está: 10
  pares, 12h de validade **de leitura**, sem nenhuma alteração de schema, de
  janela, de tamanho.
- `orquestrador.ts`, `historico-conversa.ts`, `interpretacao-instrucoes.ts`,
  `redator-instrucoes.ts` — nenhuma linha muda. A Iris continua decidindo com
  exatamente o mesmo contexto de hoje.
- `mensagens_recebidas` não é tocada. A retenção de 7 dias do conteúdo bruto
  que essa tabela deveria ter (`persistencia-v1.md`, `P4`/`P4I`) continua fora
  de escopo — é um projeto maior, ainda não implementado, e esta spec não
  depende dele nem o antecipa.
- Nenhum cliente/app de clínica (`/dashboard`, `/dentista`, `/assistente`)
  ganha acesso a essa tabela nova — só o `/admin`.

## 2. Tela nova em `/admin`

Dentro de `iris-portal-v2/src/app/admin/`, uma coluna ou botão "Conversas" na
linha de cada clínica (mesma tabela que já lista `teste 1` e `Cleardent`
hoje). **Fluxo fechado nesta entrega (Gabriel, 05/09):** clínica selecionada
→ lista de conversas por `telefone_normalizado` (uma entrada por telefone
distinto, com data do turno mais recente) → ao abrir uma, as mensagens
daquele telefone em ordem cronológica (mais antiga primeiro, como uma
conversa real se lê), com paginação. Cada linha mostra `mensagem_paciente`,
`resposta_iris` (rotulada "resposta produzida/devolvida ao n8n", nunca
"enviada" nem "entregue" — ver seção 1.2.1) e `resultado_turno` quando
diferente de `'sucesso'`, para o turno de falha ficar visualmente distinto
do turno normal.

**Correção sobre a v1 desta spec (revisão do Codex, 05/09):** com a
resolução best-effort de `clinica_id` (seção 1.2), a grande maioria das
linhas de falha tem `clinica_id` preenchido e aparece normalmente no fluxo
"clínica → conversas por telefone". Ficam sem `clinica_id`, e portanto **sem
tela** nesta v1: linhas com `resultado_turno = 'clinica_nao_encontrada'`
(nunca existiu clínica para aquele `provider`/`instancia_whatsapp`), e o
caso residual, estreito, de uma clínica ter sido removida entre a checagem
de instância e o momento da falha. Essas linhas continuam gravadas na
tabela (consultáveis via SQL/Supabase Studio se necessário), mas **não
aparecem** em nenhuma tela do `/admin` nesta versão — uma tela global de
falhas sem clínica fica deliberadamente fora de escopo, decisão do Gabriel,
05/09.

**Rota de API nova**, mesmo padrão de `api/admin/clinicas/route.ts`: checa
sessão + `is_admin = true` no servidor **antes** de qualquer consulta.
**Precisão sobre "posse" (revisão do Codex, 05/09):** diferente das rotas de
`/dashboard`/`/dentista`/`/assistente`, onde a checagem é "este usuário é
dono/vinculado a esta clínica", aqui o modelo é outro — o Gabriel é
administrador global e seleciona qual clínica quer ver, não é dono de cada
uma. A ordem correta é: (1) autorização administrativa (`is_admin = true`)
decidida primeiro, sem depender da clínica pedida; (2) só então a consulta é
executada, sempre filtrada pelo `clinica_id` selecionado — nunca a rota
devolve todas as clínicas de uma vez nem aceita filtro vindo do cliente sem
essa ordem.

Nome da tabela: `conversas_auditoria` (fechado, Gabriel 05/09).

## 3. Retenção — fechada nesta entrega

**Decisão (Gabriel, 05/09): 7 dias**, mesmo prazo já aprovado para conteúdo
bruto em `persistencia-v1.md` §19 — ainda que fisicamente seja uma tabela
independente, sem relação de schema ou de código com `mensagens_recebidas`.
Os 30 dias aprovados para artefatos técnicos de outra frente (`P4I.20`) não
se aplicam aqui: aquele prazo é de uma classe de dado diferente
(metadados técnicos de composição), e usá-lo aqui só por analogia não seria
justificado.

Limpeza: idempotente, por lote, a partir de `criado_em`. **Correção sobre a
v1 desta spec (revisão do Codex, 05/09):** a frase "nunca apaga durante
processamento ativo" não se aplica a esta tabela — ela é independente do
processamento do turno (gravada depois, nunca lida por ele) e não tem
"estado ativo" análogo ao de uma continuação ou claim em andamento. A regra
correta e suficiente aqui é a genérica de `persistencia-v1.md`: limpeza por
lote, idempotente, a partir da idade em `criado_em`, sem exceção baseada em
estado. Esta seção trata só da tabela `conversas_auditoria` — não altera nem
reduz a retenção de nenhuma outra cópia existente no sistema
(`historico_conversa`, `mensagens_recebidas`).

**Mecanismo fechado (Gabriel, 05/09): Supabase Cron / `pg_cron`.**
Confirmado disponível no projeto operacional `udizowyfjnhuhgxkeayk`
(`list_extensions`: `pg_cron`, versão `1.6.4`, **não habilitado hoje** —
`installed_version: null`). A implementação:

1. Habilita a extensão `pg_cron` (`create extension if not exists pg_cron`)
   como parte da mesma migration que cria `conversas_auditoria` — nunca uma
   etapa manual separada, para que o rollback da migration também reverta
   a habilitação (quando nenhuma outra rotina do projeto já depender dela;
   a checagem dessa dependência é preflight obrigatório antes de aplicar).
2. Cria um job SQL **nomeado** (ex.: `conversas_auditoria_limpeza_diaria`),
   agendado via `cron.schedule`, rodando **diariamente** — suficiente para
   uma janela de 7 dias, sem necessidade de granularidade menor.
3. O job executa exatamente `DELETE FROM conversas_auditoria WHERE
   criado_em < now() - interval '7 days'`, idempotente, por lote.
   **Fechado nesta correção (Gabriel, 05/09): sem alternativa de `UPDATE`
   para "irrecuperável"** — mantê-la contradiria `telefone_normalizado
   NOT NULL` (um `UPDATE` de anonimização precisaria zerar esse campo ou
   violar a constraint) e não há motivo, nesta tabela, para preservar a
   linha em vez de apagá-la: ela não é referenciada por nenhuma FK, não
   tem histórico de status a auditar, e sua única função é leitura humana
   temporária.
4. O job é **removível no rollback** da mesma migration
   (`cron.unschedule('conversas_auditoria_limpeza_diaria')`), simétrico à
   criação.
5. **Antes de considerar a implementação pronta**, verificação real
   obrigatória (não presumida do SQL escrito): consultar `cron.job` e
   confirmar que o job aparece cadastrado com o nome e agendamento
   corretos, e executar manualmente uma rodada de limpeza contra dado de
   teste, confirmando que remove o que deveria e preserva o que não deveria
   (cenário 9 da seção 6).

## 4. Segurança e isolamento

- **Isolamento por `clinica_id` obrigatório** em toda leitura, mesma regra de
  `docs/03-seguranca.md` e de toda tabela existente do projeto.
- **RLS ativa, sem policies** — mesmo padrão de `estado_conversa` e
  `mensagens_recebidas`: só `service_role` acessa, nunca `anon`/`authenticated`
  diretamente.
- **Modelo de acesso é administrativo global, nunca "posse".** Correção
  sobre a v1 desta spec (revisão do Codex, 05/09): a rota nunca aceita
  `clinica_id` vindo do cliente sem primeiro confirmar `is_admin = true` do
  usuário da sessão — essa checagem é sempre a primeira, independente de
  qual clínica foi pedida (ver seção 2). Não existe aqui o conceito de "este
  usuário é dono desta clínica" que as rotas de `/dashboard` usam.
- **Resposta HTTP sem cache.** Correção sobre a v1 desta spec (revisão do
  Codex, 05/09): a rota de API que devolve texto literal de conversa
  responde sempre com `Cache-Control: private, no-store` — nunca cacheada
  por CDN, proxy ou navegador, mesma disciplina que dado sensível de
  paciente já exige em outras rotas do projeto.
- **Esta tabela é dado operacional gravado no banco, não log técnico** — a
  proibição de PII em log (`docs/03-seguranca.md`) foi escrita para logs
  técnicos (stdout, `console.log`, correlator HMAC), não para uma tabela de
  produto com RLS e controle de acesso equivalente ao resto do banco de
  pacientes. **Decidido (Gabriel, 05/09):** texto literal, sem sanitização,
  restrito ao administrador — mesma política que `historico_conversa` já
  usa hoje. Nenhum campo recebe máscara ou tratamento adicional de PII
  nesta v1.

## 5. O que este documento NÃO decide

- Se o painel de cada clínica (`/dashboard`) deveria, no futuro, ganhar acesso
  às próprias conversas — fora de escopo desta v1, que é só `/admin`.
- Uso desta tabela como base permanente/acervo para melhoria de produto da
  Iris (treinamento, análise agregada, etc.) — reter 7 dias para auditoria
  pontual não cria, por si só, esse acervo; seria decisão separada, com
  motivação e prazo próprios.
- Rastreamento de confirmação de entrega real ao paciente (WhatsApp/n8n/
  Evolution) — ver seção 1.2.1.

## 6. Testes exigidos antes de considerar pronto

1. **Isolamento do fluxo de decisão** (princípio do teste isolado): simular um
   turno completo com a tabela de auditoria ausente/falhando na escrita — a
   decisão do Core, a resposta da Iris e `historico_conversa` devem ser
   idênticas ao mesmo turno com a tabela funcionando. Nenhuma divergência.
2. **Nunca bloqueia nem atrasa a resposta**, nos dois pontos de gravação
   (sucesso e falha): a chamada via `EdgeRuntime.waitUntil` não pode ser
   aguardada antes do `return` do handler — mesmo teste de not-awaited já
   aplicado a `compararComSombraCapacidadeV2`.
3. **Cobertura de falha dentro do escopo, par A/B por causa** (princípio do
   teste isolado): para cada ramo de `tratarErroDoTurno`
   (`clinica_nao_encontrada`, `entrada_invalida`,
   `resposta_truncada_apos_retry`, `erro_interno`), uma linha é gravada com
   o `resultado_turno` correto — provado causa a causa, nunca um teste
   genérico que só confirma "alguma coisa foi gravada". Inclui o caso
   `resposta_truncada_apos_retry` (`INT-21`, `tests/cenarios-obrigatorios.md`)
   nas suas duas variantes (1ª e 2ª tentativa truncadas; 1ª truncada e 2ª
   falhando por outra categoria), onde `resposta_iris` deve conter o texto
   fixo determinístico realmente devolvido.
4. **Exclusão do que está fora de escopo:** `metodo_nao_permitido`,
   qualquer variação de `payload_invalido`, `configuracao_ausente` e
   `instancia_nao_autorizada` **nunca geram linha** na tabela — teste
   negativo explícito, não só ausência de teste positivo.
5. **`motivo_fallback` correto em sucesso não-padrão:** turno com
   `redator_nao_configurado`, com `falha_redatora`, e com reprovação da
   guarda geram `resultado_turno = 'sucesso'` e `motivo_fallback` com o
   valor real correspondente — nunca `null` nesses três casos.
6. **`telefone_normalizado` sempre presente; `clinica_id` resolvido por
   consulta best-effort:** `telefone_normalizado` nunca é nulo em nenhuma
   linha, sucesso ou falha (garantido por `validarPayload` antes de
   qualquer gravação). `clinica_id`: `'clinica_nao_encontrada'` → nulo;
   `'entrada_invalida'`, `'resposta_truncada_apos_retry'`, `'erro_interno'`
   com clínica real existente para o `provider`/`instancia_whatsapp` do
   payload → preenchido pela consulta best-effort descrita na seção 1.2,
   mesmo quando `processarMensagem` falhou antes de resolver `clinica_id`
   internamente.
7. **Isolamento multiclínica:** duas clínicas conversando ao mesmo tempo nunca
   misturam linhas na tabela nova; a rota de `/admin` nunca devolve conversa
   de uma clínica ao consultar outra.
8. **Acesso administrativo, não de posse:** usuário sem `is_admin = true`
   recebe 403 na rota nova, mesmo com sessão válida de dono de clínica; um
   admin autenticado consegue consultar qualquer `clinica_id` selecionado,
   sem precisar ser dono dela.
9. **Retenção — 7 dias, job `pg_cron` real, não simulado:** `select * from
   cron.job where jobname = 'conversas_auditoria_limpeza_diaria'` confirma
   o job cadastrado, com agendamento diário; executar o job manualmente
   contra dado de teste apaga (`DELETE`) conversa mais velha que 7 dias,
   preserva a mais recente, e rodar duas vezes seguidas produz o
   mesmo resultado sem efeito colateral (idempotência). Rollback da
   migration confirmado removendo o job (`cron.unschedule`) sem deixar
   resíduo em `cron.job`.
10. **Sem cache na resposta:** a rota de API responde com
    `Cache-Control: private, no-store` — testado explicitamente, não
    presumido do framework.
11. **Rótulo da tela nunca afirma entrega:** teste de UI/snapshot garante
    que a coluna de resposta é rotulada como produzida/devolvida ao n8n,
    nunca como "enviada" ou "entregue" (seção 1.2.1).
12. **Linhas fora do fluxo de tela não quebram nada:** uma linha com
    `clinica_id = null` (`resultado_turno = 'clinica_nao_encontrada'`, ou o
    caso residual de clínica removida entre a checagem de instância e a
    falha) não aparece em nenhuma tela do `/admin` nesta v1 e não causa erro
    na listagem de conversas por clínica — ela simplesmente não é retornada
    por nenhuma consulta filtrada por `clinica_id`.

## Aprovação

**Aprovada pelo Gabriel em 05/09/2026, para início de implementação.**
Aprovação inclui explicitamente: retenção de 7 dias (seção 3); texto
literal, sem sanitização (seção 4); acesso exclusivo de administrador
(`is_admin = true`, seção 4); nome da tabela `conversas_auditoria` (seção
1.1).

Duas rodadas de revisão do Codex incorporadas antes desta aprovação:

- **Primeira rodada:** cobertura de turnos de falha (achado principal —
  gravar só sucesso deixava de fora justamente os casos de bug real);
  distinção entre "resposta produzida" e "resposta entregue" (seção 1.2.1);
  garantia best-effort declarada, não exactly-once (seção 1.2.2); retenção
  fechada em 7 dias em vez de deixada em aberto; modelo de acesso
  administrativo global em vez de "posse".
- **Segunda rodada:** escopo de gravação de falha restrito a depois de
  POST válido + payload parseado + instância autorizada — tráfego anterior
  a isso nunca vira linha, mesmo em erro (seção 1.2); `telefone_normalizado`
  corrigido para `NOT NULL`, sempre presente inclusive em falha (seção 1.1);
  `clinica_id` em linha de falha resolvido por consulta best-effort
  (`provider` + `instancia_whatsapp`, mesma consulta de
  `identificacao.ts::buscarClinica`), em segundo plano, nunca tocando o
  Core nem atrasando a resposta (seção 1.2); mecanismo de limpeza fechado
  como Supabase Cron/`pg_cron` — disponível no projeto operacional mas não
  habilitado hoje —, com job SQL nomeado, diário, criado pela migration e
  removível no rollback (seção 3).

**Esta aprovação autoriza o início da implementação (código, migration
local/dev, testes) — não autoriza migration em produção, deploy ou
publicação.** Essas ações continuam dependendo de: revisão do código
resultante contra esta spec (papel do Codex, `AGENTS.md` "Processo
obrigatório", passo 3) e autorização explícita e posterior do Gabriel, por
ação, mesma disciplina de todo o resto do projeto.
