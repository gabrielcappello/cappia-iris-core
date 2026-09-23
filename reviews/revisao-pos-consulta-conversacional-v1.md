# Revisão Codex — pós-consulta conversacional v1

**Data:** 2026-09-15  
**Resultado:** **reprovada nesta rodada — há bloqueadores reais antes de considerar a implementação concluída.**  
**Escopo revisado:** arquivos novos `src/core/*pos-consulta*`, migration
`20260915120000_iris_nova_pos_consulta_v1.sql` e testes correspondentes. Nenhuma
alteração foi aplicada ao Supabase vivo ou publicada.

## Verificações executadas pelo Codex

- `node --test core/*pos-consulta*.test.ts`: 98/98 passando.
- `node node_modules/typescript/bin/tsc --noEmit`, a partir de `src/`: limpo.
- Leitura direta do schema operacional: `public.agendamentos.concluido_em` **já existe**
  como `timestamptz nullable`.

Os testes verdes são válidos no nível unitário, mas não cobrem os contratos SQL reais,
o transporte nem a integração inbound.

## Bloqueadores

### B1 — RPCs não possuem privilégio para escrever na tabela

Na migration, a tabela sofre `revoke all` e o `service_role` recebe apenas `select`
(linhas 120–121). As duas funções são `security invoker` (linhas 145 e 205), portanto
executam com os privilégios do chamador. A primeira tenta `insert` (linha 162) e a
segunda tenta `update` (linha 235). Com os grants escritos, ambas falham com
`permission denied`.

**Correção exigida:** preservar `security invoker` e conceder ao papel servidor somente
os privilégios de tabela necessários, ou apresentar alternativa igualmente segura. A
migration precisa ser validada num banco descartável real; dublê de RPC não prova ACL,
RLS, constraints nem concorrência Postgres.

### B2 — estado é marcado antes da entrega; falha de transporte perde a mensagem

`processarInicioPosConsulta` cria/encerra a jornada antes de gerar e entregar a primeira
mensagem (`pos-consulta-processar-inicio.ts:46-64`). Em retry, a jornada já existe e o
retorno manda nunca enviar novamente (`:55-56`).

O mesmo ocorre na resposta: `processarRespostaPosConsulta` encerra a jornada e grava
`convite_google_em` antes de gerar/entregar o convite
(`pos-consulta-processar-resposta.ts:67-89`; migration linhas 235–239).

Assim, uma queda depois da RPC e antes do WhatsApp cria perda permanente e pode registrar
convite como enviado sem envio real. `unique + FOR UPDATE` impede duplicidade, mas não
oferece entrega idempotente. A spec exige identidade idempotente por etapa e retry da
mesma entrega; esse campo/estado não existe na tabela.

**Correção exigida:** modelar autorização/entrega separadamente, com identidade estável
por etapa e confirmação de entrega; retry deve retomar a mesma entrega sem criar outra.
Adicionar testes de queda nos limites: antes da entrega, durante a entrega e depois da
entrega antes do ack.

### B3 — isolamento multiclínica não é garantido pelas FKs/RPCs

A tabela referencia separadamente `clinicas(id)`, `agendamentos(id)` e `pacientes(id)`
(migration linhas 81–83). Nada garante que agendamento e paciente pertencem ao
`clinica_id` recebido. As RPCs, chamadas com `service_role`, não validam essa relação.
Logo, parâmetros inconsistentes podem persistir uma jornada cruzada entre clínicas.

**Correção exigida:** usar relações compostas disponíveis ou validar sob lock que
agendamento e paciente pertencem à mesma clínica e que o paciente é o do agendamento.
Criar teste SQL negativo com IDs reais de duas clínicas.

### B4 — duas jornadas abertas para o mesmo telefone são ambíguas

A constraint única cobre apenas `(clinica_id, agendamento_id)`. É permitido haver duas
jornadas `aguardando_satisfacao` para o mesmo `(clinica_id, telefone_normalizado)`.
`buscarJornadaAbertaPosConsulta` busca todas e escolhe silenciosamente a primeira sem
ordenação (`pos-consulta-buscar-jornada-aberta.ts:46-58`). Uma resposta pode ser
atribuída à consulta errada.

**Correção exigida:** definir e aplicar uma invariante não ambígua. O caminho mínimo é
impedir mais de uma jornada aberta por clínica+telefone, ou retornar conflito explícito
e não consumir a mensagem. Nunca escolher `[0]` silenciosamente. Cobrir concorrência.

### B5 — migration diverge do banco operacional confirmado

A migration exige que `agendamentos.concluido_em` não exista e executa `add column`
(linha 76). No Supabase operacional a coluna já existe como `timestamptz nullable` e há
consultas com valor preenchido. Aplicar o arquivo como está falhará imediatamente. A
afirmação de que ninguém grava esse campo também contradiz o dado vivo observado.

**Correção exigida:** auditar a origem real de `concluido_em`, reconciliar histórico de
migration versus schema aplicado e tornar o preflight compatível. Não aplicar
`add column` cegamente nem criar uma segunda autoridade para o timestamp.

### B6 — o fluxo entregue não está integrado e não cumpre o aceite fim a fim

Não há disparador, leitura da configuração real do painel, entrega WhatsApp, correlação
inbound nem wiring no runtime. Portanto, nenhum dos três modos funciona fora dos testes
com dublês. A entrega é uma base de domínio, não a implementação integral solicitada.

Antes de continuar, duas decisões precisam ser propostas ao Gabriel, com o menor caminho
seguro e evidência da arquitetura atual:

1. qual componente inicia jornadas no tempo configurado;
2. como uma mensagem que simultaneamente responde ao pós-consulta e faz um novo pedido
   (por exemplo, “foi ótimo, quero marcar uma limpeza”) atravessa o runtime sem ser
   engolida e sem produzir duas respostas desconexas.

Depois da decisão, implementar e testar o fluxo completo em ambiente não produtivo.

### B7 — validação do link não cumpre a spec

`linkValido` aceita qualquer string não vazia
(`pos-consulta-elegibilidade.ts:106-107`), enquanto a spec exige link válido. Isso aceita
texto arbitrário e esquemas inseguros.

Além disso, para objetivos sem convite, os fatos removem o link configurado; a guarda só
detecta `link_nao_autorizado` quando esse mesmo link está presente nos fatos
(`pos-consulta-guarda-redatora.ts:33-39`). No caminho real ele estará ausente, então uma
URL inventada pela redatora pode passar no modo sem Google.

**Correção exigida:** validar URL HTTP(S) de forma determinística e impedir qualquer URL
na resposta quando o objetivo não autoriza convite. Criar teste pelo caminho real
`decisão → fatos → redatora → guarda`, não um objeto de fatos impossível construído à
mão.

### B8 — falta a medição obrigatória contra IA real

Os testes cobrem dublês do classificador, mas a spec exige medição com mensagens
plausíveis contra a IA real. Sem isso não há evidência de que “positiva”,
“não positiva” e “incerta” funcionam com o modelo configurado, especialmente para
respostas mistas e mudança de assunto.

**Correção exigida:** criar runner de avaliação sem dados reais/PII e registrar matriz e
resultado antes de solicitar nova revisão. Credencial não deve ser gravada no repo.

## Riscos não bloqueantes / melhorias opcionais

- A separação do domínio de pós-consulta do `DecisaoOrquestrador` é razoável e não é
  achado.
- Clientes de modelo dedicados são aceitáveis neste estágio.
- Degradar falha de classificação para `incerta` é conservador e aderente.
- Fallback determinístico só para falha técnica pode ser aceitável, desde que não vire
  template configurável nem caminho normal; não bloqueia esta rodada.

## Critério para nova revisão

O Code deve corrigir B1–B5 e B7, apresentar ao Gabriel propostas objetivas para as duas
decisões de B6, completar a integração autorizada e executar B8. A nova entrega deve
incluir testes SQL reais para ACL/RLS/FKs/concorrência e testes de fronteira de entrega,
além da suíte TypeScript.

Nada deve ser aplicado, integrado ou publicado antes da nova revisão do Codex e da
autorização explícita do Gabriel.

---

## Segunda revisão — 2026-09-16

**Resultado:** **ainda não aprovada.** B4, B5 e B7 foram corrigidos de forma
satisfatória no código local. B1 e B8 continuam sem prova executada; B2/B3 ainda têm
lacunas; B6 depende de decisão do Gabriel.

### Verificações desta rodada

- `node --test core/*pos-consulta*.test.ts`: 129/129 passando.
- `node node_modules/typescript/bin/tsc --noEmit`, a partir de `src/`: limpo.
- Migration, runner SQL e runner de avaliação lidos integralmente; não executados.
- Contrato da Responses API confrontado com a documentação oficial da OpenAI: uso de
  `text.format` estruturado, `store:false` e parsing do array `output` é compatível. A
  própria documentação alerta que a ordem/quantidade de itens de `output` não deve ser
  presumida; o adaptador procura o item `message`, portanto não assume índice fixo.

### B1 — código corrigido, prova SQL ainda inválida

A migration agora concede `select, insert, update` ao `service_role`, compatível com
funções `security invoker`. Porém o runner não prova isso: `clienteAdmin`, `clienteA` e
`clienteB` abrem a mesma `DATABASE_URL` (linhas 84–94 e 140–142) e nunca executam
`set role service_role`. Se a URL autentica como `postgres`, B1 passará mesmo que os
grants de `service_role` estejam errados.

**Exigido:** executar as chamadas de runtime sob `set local role service_role` (dentro
de transação adequada) ou conectar efetivamente como esse papel; acrescentar asserções
de ACL e confirmar que `anon`/`authenticated` não executam nem leem a tabela.

### B2 — separação autorização/entrega melhorou, mas identidade não é estável

O claim/lease evita a perda silenciosa anterior, porém `entrega_claim_token` é autoridade
temporária do worker e gira em todo reclaim (migration linhas 269–279 e 340–348). Ele
não é uma identidade estável da entrega. Se o WhatsApp aceitou o envio e houve queda
antes do ack, o reclaim recebe token novo e pode reenviar; não há chave imutável para o
transporte deduplicar a mesma entrega.

Entrega “no mínimo uma vez” pode ser um trade-off consciente, mas diverge da spec
aprovada, que pede identidade idempotente por etapa e retry da mesma entrega. Claim e
identidade de entrega são conceitos distintos.

**Exigido:** adicionar `entrega_id` imutável por etapa, preservado no reclaim e enviado
ao adaptador/transporte como chave idempotente quando o provedor suportar. Se a Evolution
não suportar deduplicação por chave, documentar e medir o limite antes de Gabriel aceitar
o risco de duplicata.

Também corrigir duas autoridades excessivas em `confirmar_entrega`:

1. `p_etapa_confirmada` é fornecida pelo chamador sem relação validada com a etapa/mode
   persistidos. A RPC deve derivar o destino: `aguardando_inicio + google → encerrada`;
   `aguardando_inicio + satisfacao/ambos → aguardando_satisfacao`;
   `finalizando → encerrada`.
2. Um token cujo lease já expirou ainda pode confirmar enquanto outro worker não tiver
   feito reclaim. A confirmação deve exigir token correspondente **e lease vigente**, ou
   a semântica de lease deve ser explicitamente redefinida e aprovada.

O teste SQL precisa cobrir a segunda entrega (`finalizando`), destino incompatível,
confirmação após lease expirado e preservação do mesmo `entrega_id` após reclaim.

### B3 — vínculo de IDs corrigido, telefone ainda pode pertencer a outra pessoa

A RPC agora confirma clínica/agendamento/paciente, mas aceita
`p_telefone_normalizado` arbitrário e o persiste sem compará-lo ao telefone oficial do
paciente. Isso permite criar a jornada correta apontando para o telefone de outra
pessoa, causando envio e correlação indevidos.

**Exigido:** validar sob o mesmo lock que `p_telefone_normalizado` é exatamente o
telefone oficial do paciente usado no vínculo, ou remover o parâmetro e derivá-lo no
banco. Adicionar teste negativo.

### B4, B5 e B7 — aprovados nesta rodada

- B4: índice único parcial e falha fechada na leitura removem a escolha silenciosa.
- B5: a migration deixou de tocar `agendamentos.concluido_em` e reconhece o schema vivo.
- B7: link HTTP(S) é validado e a guarda rejeita qualquer URL não autorizada pelo
  caminho real.

### B6 — decisão arquitetural recomendada

**Disparo:** aprovar a proposta A — n8n agenda e chama uma Edge Function; a fronteira
existente continua sendo a única que fala com a Evolution. Isso não autoriza reutilizar
o workflow antigo nem publicar nada; deve ser um fluxo novo e mínimo.

**Mensagem mista:** não aprovar A nem B como descritas.

- A fecha como `incerta` e pode perder uma satisfação explicitamente positiva e o
  convite previsto no modo `ambos`.
- B concatena duas respostas independentes, dobra custo e tende a produzir conversa
  artificial.

**Proposta C recomendada:** interpretar o pós-consulta e o pedido operacional, mas gerar
uma única resposta pelo fluxo principal. O Core entrega à redatora principal fatos
aditivos de pós-consulta (`classificacao` e, somente quando autorizado, link Google).
Assim o pedido operacional não é engolido, o convite positivo não se perde e só há uma
redação/envio. Se não houver pedido operacional, usa-se o redator próprio de
pós-consulta. Essa integração precisa de aprovação do Gabriel antes de implementação e
teste específico contra o runtime real, pois toca a fronteira do orquestrador.

### B8 — runner adequado, medição continua pendente

O runner tem casos plausíveis e não contém PII, mas não foi executado. Portanto não há
resultado para aprovar. A API está configurada de forma compatível com a documentação
oficial da OpenAI; ainda é necessário rodar com o modelo configurado e registrar os
resultados. A documentação oficial confirma que `store:false` evita o armazenamento
padrão da resposta e que Structured Outputs é configurado em `text.format`.

### Próxima ação

1. Gabriel decide B6 (recomendação: disparo A + mensagem mista C).
2. Code corrige B1, B2 e B3 e amplia o runner SQL.
3. Executar runner SQL no projeto dev e avaliação real B8 quando houver credenciais.
4. Só então solicitar terceira revisão; nada de commit, migration viva, workflow,
   integração ou deploy antes dela.

---

## Terceira revisão — 2026-09-16

**Resultado:** **ainda não aprovada.** B1, B2 e B3 foram corrigidos de forma
satisfatória no código e no runner autorado. A integração nova, contudo, confirma a
segunda entrega antes do transporte real e a Edge Function não revalida os fatos de
elegibilidade em fonte autoritativa. B8 e os testes SQL reais continuam sem execução.
Além disso, Disparo A + Solução C foram implementados sem a ratificação explícita do
Gabriel solicitada na revisão anterior.

### Verificações desta rodada

- `node --test core/*pos-consulta*.test.ts`: 153/153 passando.
- `node node_modules/typescript/bin/tsc --noEmit`, a partir de `src/`: limpo.
- Migration, runner SQL, nova Edge Function e wiring do runtime reativo inspecionados.
- SQL real, avaliação contra IA real e `deno check` não executados por ausência das
  credenciais/runtime informados no handoff.

### C1 — mensagem reativa é confirmada antes da entrega real

Em `supabase/functions/iris-nova-mensagem/index.ts`, a chamada a
`confirmarRoteamentoMensagemMista` acontece logo depois da geração do texto e antes de
a Edge Function devolver a resposta ao n8n. Nesse instante o WhatsApp ainda não aceitou
a mensagem. Uma queda entre a resposta HTTP e o envio faz a jornada virar `encerrada`
sem o paciente receber o agradecimento/convite.

A justificativa em `pos-consulta-processar-mensagem-mista.ts` reconhece e aceita esse
risco, mas ele contradiz a correção B2 e não foi aprovado pelo Gabriel. O fato de o
runtime antigo também não possuir ack não transforma geração de texto em entrega.

**Correção exigida:** devolver ao n8n `entrega_id` e `claim_token` junto do texto da
mensagem mista e confirmar em chamada separada somente depois de a Evolution aceitar o
envio, assim como na primeira entrega. Se o contrato atual de
`iris-nova-mensagem` não permite isso, propor a menor mudança de transporte e obter
aprovação antes de implementá-la.

### C2 — a Edge Function não revalida a elegibilidade por conta própria

`iris-nova-pos-consulta/index.ts` recebe do corpo HTTP `agendamento_status`,
`agendamento_concluido_em`, telefone, modo, prazo, link e até `agora`; em seguida passa
esses mesmos valores à função pura de elegibilidade. Portanto ela reexecuta as regras,
mas não relê os fatos no banco nem a configuração autoritativa. Um payload atrasado ou
incorreto pode iniciar uma jornada para um agendamento cujo estado/configuração já
mudou. A RPC confirma vínculo e telefone, mas não confirma status, `concluido_em`, prazo
ou modo vigente.

Isso também torna incorreta a afirmação do handoff de que a Edge Function “reavalia
elegibilidade por conta própria”. Ela valida uma fotografia fornecida pelo n8n.

**Correção exigida:** resolver e documentar a fonte real da configuração e reler na
Edge Function, por `clinica_id`/`agendamento_id`, ao menos os fatos mutáveis que decidem
elegibilidade. O instante atual deve vir do servidor, não do payload. O n8n pode indicar
o candidato, mas não deve ser a autoridade final para status, tempo e configuração.

### B1, B2 e B3 — correções aceitas no código, prova real ainda pendente

- O runner agora usa `SET ROLE service_role` e testa negação para `anon` e
  `authenticated`.
- `entrega_id` permanece estável em reclaim; o claim gira; a confirmação deriva o
  destino e rejeita lease vencido.
- A RPC valida o telefone oficial no mesmo vínculo clínica/agendamento/paciente.

Esses pontos ficam aceitos por inspeção, mas a migration e o runner continuam sem prova
contra Postgres real. Não aplicar em ambiente operacional antes dessa execução em dev.

### B6 — falta ratificação formal e ainda não existe fluxo n8n entregue

A revisão anterior recomendou A + C e pediu decisão explícita do Gabriel antes da
implementação. Essa aprovação não consta na conversa; os comentários do código que
dizem “aprovada pelo Gabriel” devem ser corrigidos ou sustentados por uma aprovação
explícita agora.

A nova Edge Function fornece os endpoints necessários, mas nenhum workflow n8n novo foi
entregue/testado. Assim, o disparo proativo ainda não existe fim a fim.

### B8 e verificações externas

- A medição do classificador contra IA real continua pendente.
- O runner SQL real continua pendente.
- A nova Edge Function Deno ainda precisa de `deno check`/teste do entrypoint.
- A integração completa deve ser testada em ambiente não produtivo, incluindo queda
  entre geração, envio e confirmação.

### Próxima ação

1. Gabriel ratifica ou rejeita explicitamente Disparo A + Solução C.
2. Code corrige C1 e C2 e entrega/testa o workflow n8n mínimo.
3. Executar SQL real, B8 e verificação Deno em ambiente não produtivo.
4. Solicitar nova revisão. Nada deve ser commitado, aplicado ou publicado antes da
   autorização correspondente do Gabriel.

---

## Quarta revisão — 2026-09-16

**Resultado:** **ainda não aprovada.** C1 foi corrigido no contrato das Edge Functions,
mas ainda não foi integrado ao workflow reativo real. C2 relê o banco, porém interpreta
um formato de configuração diferente daquele que o painel efetivamente grava. O JSON
n8n apresentado é um esqueleto conscientemente não executável, não uma entrega mínima
fim a fim. O painel também continua bloqueando dois dos três modos aprovados.

### Verificações desta rodada

- JSON do workflow: parse válido.
- `node --test core/**/*.test.ts`: 1930 passando, 0 falhas, 7 skips preexistentes.
- `node node_modules/typescript/bin/tsc --noEmit`: limpo.
- Conferido o contrato real do painel em
  `portal-iris-principal/src/app/dashboard/page.tsx`.
- Conferida a documentação atual do Supabase: Edge Functions exigem JWT por padrão;
  chamadas service-to-service precisam enviar credencial adequada e configurar o modo
  de autenticação conscientemente.

### D1 — formato de configuração incompatível com o painel real

`pos-consulta-carregar-configuracao.ts` procura:

```text
automatizacoes.pos_consulta.modo
automatizacoes.pos_consulta.prazo_minutos
automatizacoes.pos_consulta.link_avaliacao_google
automatizacoes.pos_consulta.orientacoes
```

O painel real lê e grava chaves planas:

```text
automatizacoes.pos_consulta_tipo
automatizacoes.pos_consulta_tempo
automatizacoes.pos_consulta_google_link
automatizacoes.pos_consulta_mensagem
```

Além disso, `pos_consulta_tempo` é string (`2h`, `4h`, `24h`), não número em
minutos. Com o código atual, toda configuração salva pelo painel cai em
`{ modo: 'nenhum' }`; nenhuma jornada é iniciada.

**Correção exigida:** usar o contrato real já existente ou, se houver decisão de
migração para objeto aninhado, alterar painel + dados + Core na mesma frente com
compatibilidade explícita. Converter `2h`/`4h`/`24h` deterministicamente para minutos e
testar exatamente os objetos que o painel grava.

### D2 — painel continua com a pendência original

No painel, `satisfacao` e `ambos` permanecem com `wip:true`; o botão usa
`disabled={opt.wip}` e ignora o clique. Portanto o usuário ainda só consegue selecionar
Google direto. O campo `pos_consulta_mensagem` também continua sendo apresentado como
mensagem personalizada, contrariando a decisão de dar liberdade de redação à Iris
(orientações podem existir, mas não como template fixo).

**Correção exigida:** incluir o `portal-iris-principal` na implementação aprovada:
liberar os três modos, manter os rótulos/descrições coerentes com a spec e trocar o
conceito de mensagem personalizada por orientações opcionais para a Iris, sem frase
fixa. Adicionar verificação do salvamento e recarregamento da configuração.

### D3 — workflow n8n não é executável

O próprio documento lista lacunas que impedem qualquer execução:

- a query exige `$json.clinica_id`, mas nenhum node produz esse valor;
- o envio usa `telefone_normalizado`, mas nem a query nem a Edge Function o devolvem;
- endpoint/payload/critério de sucesso da Evolution são placeholders;
- não há credencial Postgres nem variáveis configuradas;
- as chamadas às Edge Functions não enviam cabeçalho de autenticação, embora
  `verify_jwt` seja ligado por padrão e não exista configuração versionada em contrário.

Logo, o JSON prova apenas a ordem conceitual `iniciar → enviar → confirmar`; ele não
implementa o Disparo A.

**Correção exigida:** completar um workflow importável em ambiente não produtivo,
com origem das clínicas, telefone autoritativo devolvido pela Edge Function, contrato
Evolution confirmado, autenticação service-to-service explícita e tratamento de erro
mínimo. Não usar `statusCode` hipotético como ack.

### D4 — C1 ainda não existe no fluxo reativo real

O Core/Edge agora devolve corretamente `pos_consulta_confirmacao` e não confirma antes
do envio. Entretanto a alteração necessária no workflow reativo está somente descrita
em Markdown. Sem o `IF` e a chamada de confirmação depois do ack da Evolution, toda
segunda entrega permanece em `finalizando`, expira e pode ser reclamada/repetida.

**Correção exigida:** obter/exportar o workflow reativo vigente em ambiente seguro,
fazer a alteração aditiva e testá-la fora de produção. Se essa coordenação depende de
acesso externo, registrar como bloqueio real; não declarar C1 concluído fim a fim.

### Pontos aceitos nesta rodada

- Remoção da confirmação síncrona no código reativo.
- Retorno de `agendamento_id`, `entrega_id` e `claim_token` ao transporte.
- Releitura autoritativa de agendamento/paciente e uso do relógio do servidor.
- Ratificação explícita do Gabriel para Disparo A + Solução C.

### Pendências anteriores preservadas

- Runner SQL real ainda não executado.
- B8 contra IA real ainda não executado.
- Edge Functions ainda sem `deno check`/teste de entrypoint.
- Nenhuma migration, workflow ou função deve ser publicada enquanto D1–D4 não forem
  corrigidos e revisados.

---

## Quinta revisão — 2026-09-16

**Resultado:** **ainda não aprovada.** D1 e D2 foram corrigidos satisfatoriamente. A
estrutura de D3/D4 evoluiu para artefatos reais, mas há duas falhas de integração nos
workflows e o runner SQL ficou inconsistente com a quarta RPC adicionada à migration.

### Verificações desta rodada

- Core: 1933 testes passando, 0 falhas, 7 skips; typecheck limpo.
- Portal: 297/297 testes passando.
- Portal: `next build` concluído com sucesso, incluindo TypeScript e 53 páginas.
- Workflows JSON analisados e contratos comparados com schema, Edge Functions e grafo
  original exportado.
- Migration e runner SQL relidos após a adição de
  `cappia_pos_consulta_candidatos`.

### Pontos aprovados nesta rodada

- D1: leitura das quatro chaves planas reais e conversão fechada
  `2h/4h/24h → 120/240/1440`.
- D2: os três modos estão selecionáveis; o campo virou orientação opcional; round-trip
  de configuração coberto por testes.
- A Edge Function devolve o telefone autoritativo relido para o transporte.
- O Disparo A usa o node Evolution e o critério de aceitação observados no workflow
  vigente, sem gravar segredo service-role no JSON.
- O patch reativo é aditivo e confirma somente depois de `success + data.key.id`.

### E1 — RPC entrega uma coluna de instância diferente da autoridade da Edge Function

`cappia_pos_consulta_candidatos` retorna
`c.whatsapp_instancia as instancia_whatsapp`. A Edge Function, porém, autoriza e resolve
a clínica consultando `clinicas.instancia_whatsapp`. O schema real possui as duas
colunas; não existe contrato que garanta igualdade entre elas.

O workflow usa o valor retornado pela RPC tanto no payload da Edge Function quanto no
node Evolution. Assim, um candidato pode ser recusado pelo gate
`INSTANCIA_WHATSAPP_AUTORIZADA` ou por `resolverClinicaPorInstancia`, apesar de ser
válido para o transporte legado.

**Correção exigida:** separar explicitamente as duas finalidades ou escolher a coluna
canônica com evidência. O identificador enviado à Edge Function precisa ser exatamente
o mesmo usado por `resolverClinicaPorInstancia` (`instancia_whatsapp`). Se a Evolution
realmente exige `whatsapp_instancia`, retornar os dois campos com nomes distintos e
usar cada um somente na sua fronteira. Adicionar teste SQL com valores deliberadamente
diferentes para impedir nova confusão.

### E2 — patch reativo quebra mensagens de fallback existentes

`Enviar resposta Evolution` recebe tanto a resposta de `Chamar Iris Nova` quanto o
caminho `Fallback: pedir reenvio`. O novo node
`Classificar resultado Evolution (pos-consulta)` executa sempre:

```text
$('Chamar Iris Nova').first().json
```

No caminho de fallback de áudio, `Chamar Iris Nova` não foi executado. Depois de enviar
corretamente o pedido de reenvio pela Evolution, o novo node tenta acessar uma execução
inexistente e falha. Portanto os nodes originais podem estar byte-a-byte intactos, mas
o comportamento original foi alterado de forma regressiva pela nova saída.

**Correção exigida:** o ramo pós-envio deve tolerar explicitamente a ausência de
`Chamar Iris Nova` e simplesmente encerrar sem confirmação. Testar no n8n, no mínimo:
texto normal sem jornada, texto com jornada, áudio transcrito com jornada e os dois
fallbacks de áudio que não chamam a Edge Function.

### E3 — runner SQL não acompanha a quarta RPC

A migration agora cria `cappia_pos_consulta_candidatos`, mas o runner ainda:

- verifica no preflight apenas as três funções anteriores;
- não testa grants/ACL nem o resultado da nova RPC;
- não remove a nova função no rollback.

Como a RPC depende de `pos_consulta_jornadas`, o rollback tenta apagar a tabela enquanto
a função dependente permanece. Isso pode falhar e deixar objetos no projeto dev,
contrariando a promessa de limpeza completa do runner.

**Correção exigida:** incluir a quarta função no preflight, ACL positiva/negativa,
cenários de candidatos e rollback na ordem correta (função antes da tabela). Executar
o runner em dev antes de solicitar aprovação de integração.

### Pendências externas preservadas

- Runner SQL real ainda não executado.
- B8 contra IA real ainda não executado.
- Edge Functions ainda sem `deno check`/teste de entrypoint.
- Os workflows ainda precisam ser importados com credenciais reais e exercitados em
  ambiente não produtivo; nada deve ser escrito no n8n de produção nesta etapa.

---

## Sexta revisão — 2026-09-17

**Resultado:** **E1–E3 aprovados; implementação aprovada em nível de código.** Não foi
encontrado novo bloqueio estrutural nesta rodada. A frente ainda **não está autorizada
para integração ou publicação**, porque as provas externas obrigatórias continuam
pendentes: Postgres dev, avaliação com IA real, Deno e execução dos workflows em
ambiente não produtivo.

### Verificações desta rodada

- `node --test core/**/*.test.ts`: 1941 passando, 0 falhas, 7 skips preexistentes.
- `node node_modules/typescript/bin/tsc --noEmit`: limpo.
- `node --check src/supabase/tests/executar-teste-pos-consulta-v1.mjs`: limpo.
- Os dois JSONs n8n foram parseados com sucesso.
- Migration, runner SQL, workflow de disparo e patch reativo relidos nos pontos E1–E3.

### E1 — aprovado

A RPC agora retorna separadamente:

- `instancia_whatsapp`, usada exclusivamente para resolver/autenticar a clínica na
  Edge Function;
- `whatsapp_instancia`, usada exclusivamente como `instanceName` da Evolution.

O workflow usa cada campo na fronteira correta. O runner cria valores diferentes e
assevera ambos, tornando detectável uma futura inversão.

### E2 — aprovado

O node reativo consulta `isExecuted` antes de acessar `Chamar Iris Nova`. Nos fallbacks
de áudio, ele preserva a confirmação como ausente e encerra sem erro. O teste executa o
`jsCode` extraído diretamente do JSON real e cobre oito cenários, incluindo os dois
fallbacks e falha da Evolution.

### E3 — aprovado por inspeção; execução real ainda obrigatória

`cappia_pos_consulta_candidatos` passou a integrar:

- preflight;
- ACL negativa para `anon`/`authenticated`;
- cenário positivo com as duas instâncias distintas;
- negativos de prazo e configuração desligada;
- rollback, removendo a função antes da tabela.

O runner está coerente por inspeção e sintaxe, mas só será considerado comprovado
depois de executar contra o projeto dev autorizado e confirmar limpeza sem resíduos.

### Gates restantes antes de integração/publicação

1. Executar o runner SQL no projeto dev autorizado, incluindo migration temporária,
   ACL, concorrência, candidatos e rollback limpo.
2. Executar B8 contra a IA real e registrar a matriz de classificação.
3. Rodar `deno check`/teste dos dois entrypoints de Edge Function.
4. Importar cópias **inativas** dos workflows em ambiente não produtivo, configurar
   credenciais de teste e validar ponta a ponta: três modos, positiva/negativa/incerta,
   mensagem mista, falha/retry/reclaim e fallbacks de áudio.
5. Apresentar as evidências ao Codex para revisão final. Somente depois Gabriel decide
   merge, aplicação de migration, deploy e corte dos workflows.

---

## Execução complementar B8 — 2026-09-17

O runner `src/eval/medicao-classificacao-satisfacao-pos-consulta.ts` foi executado contra
a IA real com os casos sintéticos previstos, cinco repetições por caso. A credencial foi
carregada exclusivamente pelo cofre local externo ao repositório e seu valor não foi
exibido.

- Total: 60/70 classificações iguais ao rótulo esperado.
- Positivas claras: 20/20 como `positiva`.
- Negativas claras: 15/15 como `nao_positiva`.
- Neutras e mudanças de assunto: 25/25 como `incerta`.
- Duas mensagens mistas: 10/10 como `nao_positiva`, enquanto o runner esperava
  `incerta`.
- Todas as repetições foram estáveis.

As divergências mistas são conservadoras para o efeito de produto: tanto
`nao_positiva` quanto `incerta` proíbem o convite do Google. Nenhum caso negativo,
neutro, de mudança de assunto ou misto foi classificado como `positiva`. O gate B8 fica
**executado e aprovado quanto à invariante de segurança que autoriza o link somente para
satisfação claramente positiva**.

Com esta evidência, o item 2 da lista de gates da sexta revisão está concluído. Continuam
pendentes os itens 1, 3, 4 e 5.
