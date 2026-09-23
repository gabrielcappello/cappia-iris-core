# Pós-consulta conversacional v1

**Status:** aprovada explicitamente pelo Gabriel em 2026-09-15. Autoriza o Code a
implementar em branch própria. Não autoriza integração, alteração do Supabase vivo,
alteração ou desligamento de workflow, deploy nem publicação.

## Emendas posteriores à aprovação (revisão final do Codex, 2026-09-20)

Duas decisões posteriores **superam** os trechos indicados. O texto original abaixo
foi mantido para rastreabilidade; onde houver conflito, valem estas emendas.

**Emenda 1 — nenhum modo envia Google sem satisfação positiva confirmada** (decisão do
Gabriel; bloqueador 1 da revisão final). Supera as seções **2.2**, **6.2** e o critério
de aceite **9.2**. O modo `google` deixa de enviar o convite direto: passa a
**perguntar primeiro**, exatamente como `ambos` (seção 6.3), e só convida ao Google
após resposta `positiva` confirmada; `nao_positiva` e `incerta` não recebem link. A
**primeira** mensagem nunca contém link em nenhum modo. `satisfacao` continua sem
nunca enviar link. Garantido em três camadas: Core (o objetivo de convite direto foi
removido), RPCs (recusam convite fora de `positiva` + modo com Google) e esquema (três
CHECKs na tabela de jornadas).

**Emenda 2 — janela máxima de idade do agendamento** (bloqueador 2 da revisão final).
Acrescenta à seção **3** a condição: o agendamento foi concluído há **menos de 48
horas** (`concluido_em`); sem `concluido_em`, está fora da janela. Aplica-se ao
pré-filtro de candidatos, à elegibilidade autoritativa da Edge Function e à RPC de
iniciar jornada (jornada nova e reclaim). O valor de 48 horas é **decisão de produto a
confirmar pelo Gabriel** antes de aplicar a migration; não altera o prazo configurável
da clínica (sempre menor que a janela). Materializa a intenção já registrada na
seção 3 de não enviar retroativamente as pendências antigas.

**Emenda 3 — nenhuma jornada prende o telefone** (sexta e sétima revisões do Codex). Toda jornada termina:
uma entrega pendente com lease vencido é recuperada (mesma entrega, até 3 tentativas) ou encerrada sem mensagem
quando irrecuperável — fora da janela de 48 h, tentativas esgotadas, vínculo agendamento/paciente/telefone rompido
(inclusive mudança de clínica) ou automação da clínica desligada (essa clínica não recebe mensagem, mas a pendência
é encerrada em silêncio); uma jornada `aguardando_satisfacao` sem resposta por **7 dias** é encerrada em silêncio
(`abandonada_sem_resposta`), sem convite ao Google, e uma resposta posterior segue pelo fluxo normal. A entrega é
"ao menos uma vez".

**Aderência:** esta especificação segue `docs/00-principios.md`. A IA compreende a
linguagem e redige; o Core mantém estado, autoriza efeitos e garante idempotência. O
fluxo antigo de envio determinístico de avaliação Google deve ser removido do caminho
ativo quando esta frente for publicada, em vez de receber novas camadas corretivas.

## 1. Objetivo

Substituir o pós-consulta determinístico atual por uma jornada em que a Iris possa:

1. conversar naturalmente para compreender a experiência do paciente;
2. fazer um convite cordial, neutro e opcional para avaliação no Google;
3. combinar as duas ações e, nesse modo, enviar o convite somente quando compreender
   que o paciente ficou satisfeito.

Não haverá frase obrigatória. A clínica poderá orientar tom e estilo, mas a Iris redige
cada mensagem com base no contexto e nos fatos autorizados.

## 2. Configuração no painel

O painel oferece quatro valores operacionais:

- `nenhum`: pós-consulta desligado;
- `satisfacao`: **Acompanhamento pós-consulta**;
- `google`: **Avaliação no Google**;
- `ambos`: **Acompanhamento + Google**.

### 2.1 Acompanhamento pós-consulta

A Iris inicia uma conversa para compreender como foi a experiência. Não envia o link
do Google nesse modo.

### 2.2 Avaliação no Google

> **SUPERADA pela Emenda 1** (topo deste documento): o modo `google` pergunta primeiro e
> só convida após satisfação positiva confirmada.

A Iris envia diretamente a todos os pacientes elegíveis um convite cordial, neutro e
opcional para avaliar a clínica, acompanhado do link configurado. Não pede nota
específica, conteúdo específico nem oferece incentivo.

### 2.3 Acompanhamento + Google

A Iris primeiro pergunta como foi a experiência. Somente quando compreender a resposta
como positiva, agradece e convida cordialmente o paciente a avaliar a clínica no
Google, incluindo o link configurado.

Se a resposta for não positiva ou incerta, o link não é enviado nesta versão.

### 2.4 Campos configuráveis

Permanecem:

- ativação e modo;
- tempo após a conclusão da consulta;
- link de avaliação no Google, obrigatório nos modos `google` e `ambos`.

O campo de mensagem fixa deixa de orientar o comportamento novo. Em seu lugar, o
painel apresenta **Orientações para a Iris (opcional)**, destinado a tom, estilo e
observações da clínica. Esse campo não é template, não exige placeholders e não pode
alterar as regras operacionais desta especificação.

## 3. Elegibilidade

Uma jornada só pode começar quando, simultaneamente:

- o agendamento pertence à clínica derivada da instância autenticada;
- o status do agendamento é `concluido`;
- existe telefone utilizável;
- o pós-consulta está ativo;
- o prazo configurado já passou;
- nos modos que usam Google, existe link válido configurado;
- ainda não existe jornada iniciada para o mesmo agendamento;
- o agendamento foi concluído dentro da janela máxima de idade (Emenda 2: 48 horas).

Os registros atualmente acumulados são dados de teste e não precisam ser preservados
como fila real. A ativação do fluxo novo pode começar limpa, sem enviar retroativamente
as 90 pendências legadas identificadas durante a auditoria.

## 4. Divisão de responsabilidades

### 4.1 Iris

A Iris:

- compreende a resposta do paciente no contexto da pergunta de pós-consulta;
- produz uma classificação estruturada mínima: `positiva`, `nao_positiva` ou `incerta`;
- redige a pergunta, o agradecimento e o convite com linguagem natural;
- respeita o idioma, o nome da Iris e a personalidade configurada da clínica;
- não inventa fatos, não promete providências e não afirma que a equipe foi alertada.

Não devem ser criadas listas de palavras, notas, regex ou frases fixas para substituir
a compreensão semântica da Iris.

### 4.2 Core

O Core:

- decide se o agendamento é elegível;
- fornece à Iris apenas os fatos necessários;
- persiste o modo e a etapa da jornada;
- valida a classificação estruturada;
- autoriza o envio do link conforme o modo;
- garante isolamento por clínica, correlação e idempotência;
- nunca entrega à IA acesso direto ao banco, WhatsApp, credenciais ou ferramentas.

### 4.3 Transporte

O transporte:

- inicia jornadas elegíveis;
- entrega mensagens autorizadas;
- correlaciona a resposta recebida com uma jornada aberta;
- repete uma entrega sem criar um novo efeito;
- não decide satisfação nem conteúdo da resposta.

## 5. Estado mínimo da jornada

O pós-consulta não deve reutilizar o estado operacional de agendamento como se fosse
estado conversacional, nem usar o único booleano legado `pos_consulta_enviado` para
representar etapas diferentes.

Deve existir estado próprio por clínica e agendamento, com unicidade para impedir duas
jornadas para a mesma consulta. No mínimo, ele registra:

- clínica e agendamento;
- modo capturado no início da jornada;
- etapa atual;
- instante de início;
- instante do convite Google, quando houver;
- identidade idempotente da entrega por etapa;
- timestamps de auditoria.

Etapas mínimas:

- `aguardando_inicio`;
- `aguardando_satisfacao`;
- `encerrada`.

O modo é capturado ao iniciar. Uma alteração posterior na configuração da clínica não
reescreve silenciosamente uma jornada já aberta.

## 6. Comportamento por modo

### 6.1 `satisfacao`

1. Inicia uma jornada elegível.
2. A Iris pergunta naturalmente como foi a experiência.
3. A resposta é compreendida no contexto dessa jornada.
4. A Iris pode reconhecer e responder naturalmente, mas não envia Google.
5. A jornada é encerrada.

### 6.2 `google`

> **SUPERADA pela Emenda 1** (topo deste documento): o comportamento vigente do modo
> `google` é o da seção 6.3 (`ambos`).

1. Inicia uma jornada elegível.
2. O Core autoriza o convite e fornece o link como fato.
3. A Iris redige convite cordial, neutro e opcional.
4. O transporte envia uma única vez.
5. A jornada é encerrada.

### 6.3 `ambos`

1. Inicia uma jornada elegível.
2. A Iris pergunta naturalmente como foi a experiência.
3. A Iris classifica a resposta:
   - `positiva`: o Core autoriza convite com o link; a Iris agradece e redige o convite;
   - `nao_positiva`: não envia link e encerra esta automação;
   - `incerta`: não envia link e encerra esta automação.
4. O convite, quando autorizado, é enviado uma única vez.

Ausência de resposta não autoriza convite no modo `ambos`.

## 7. Fora do escopo desta versão

- alertar equipe sobre insatisfação;
- tratar urgência clínica;
- encaminhar dúvida ou reclamação;
- criar tickets, tarefas ou notificações;
- insistir quando não houver resposta;
- pedir nota numérica;
- analisar ou responder avaliações publicadas no Google;
- importar histórico legado de pós-consulta;
- mudar outros fluxos da Iris, agenda ou lembretes.

Esses itens são frentes independentes e não devem gerar código, estado ou abstrações de
antecipação nesta entrega.

## 8. Segurança e consistência

- Toda leitura e escrita inclui `clinica_id` derivado da origem autenticada.
- Uma resposta só pode ser correlacionada a jornada aberta da mesma clínica e telefone.
- Uma jornada não pode capturar resposta destinada a outro atendimento por mera
  coincidência de texto; a implementação deve usar o contexto conversacional e a
  jornada aberta.
- Cada etapa de envio possui chave idempotente produzida pelo Core.
- Execuções concorrentes produzem no máximo um envio por etapa.
- Logs técnicos não contêm mensagem bruta, telefone, nome ou outro PII.
- O workflow determinístico antigo não pode permanecer concorrendo com o fluxo novo no
  momento do corte.
- Nenhuma alteração ou publicação em produção ocorre sem autorização explícita do
  Gabriel após revisão do Codex.

## 9. Critérios obrigatórios de aceite

1. `satisfacao` pergunta sobre a experiência e nunca envia link Google.
2. ~~`google` envia convite neutro com o link a paciente elegível, sem frase fixa.~~
   **Superado pela Emenda 1:** `google` pergunta primeiro e só envia o link após
   resposta positiva confirmada; nenhuma primeira mensagem contém link.
3. `ambos` não envia link na primeira mensagem.
4. `ambos` envia link após resposta claramente positiva.
5. `ambos` não envia link após resposta negativa, incerta ou ausência de resposta.
6. Uma mesma resposta não produz dois convites.
7. Duas execuções concorrentes não produzem duas primeiras mensagens.
8. Alterar a configuração após iniciar uma jornada não muda o modo capturado.
9. Clínica A nunca lê, classifica ou envia jornada da clínica B.
10. Orientações da clínica influenciam a redação, mas não mudam elegibilidade nem
    autorização de efeito.
11. Nenhum texto de template é necessário para o fluxo funcionar.
12. O fluxo antigo não explica o resultado dos testes do mecanismo novo.

Os testes conversacionais devem usar respostas plausíveis, por exemplo: satisfação
clara, insatisfação clara, resposta ambígua e mudança de assunto. A classificação deve
ser medida contra a IA real além dos testes determinísticos do Core.

## 10. Decisão consciente sobre a política do Google

O modo `ambos` envia o convite somente após resposta positiva por decisão explícita de
produto do Gabriel. Foi informado e aceito que essa seleção pode contrariar a política
do Google contra solicitação seletiva de avaliações positivas. Esta especificação não
deve esconder nem reinterpretar essa decisão.

## 11. Sequência de implementação e revisão

Após aprovação explícita desta especificação:

1. criar branch própria para a frente;
2. Code audita o ponto de integração real antes de escrever o fluxo;
3. implementar e testar sem alterar produção;
4. desativação/substituição do workflow antigo deve ser preparada, não executada;
5. Codex revisa arquitetura, segurança, concorrência, testes e aderência;
6. Gabriel decide se autoriza integração e publicação;
7. somente após autorização, executar o corte e verificar por WhatsApp com consulta de
   teste nova.

## 12. Aprovação

Gabriel aprovou explicitamente esta especificação em 2026-09-15 e autorizou o Code a
implementá-la em branch própria. A aprovação não autoriza deploy, mudança no Supabase
vivo, desligamento de workflow nem publicação.
