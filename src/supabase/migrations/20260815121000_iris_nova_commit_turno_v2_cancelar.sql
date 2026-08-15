-- Iris Nova - commit autoritativo do turno V2: CANCELAR.
--
-- Projeto-alvo: cappia-iris-core-dev (bcmuqautblvjdqzhjfbw) -- ambiente
-- isolado de desenvolvimento e testes da Iris Nova. PROIBIDO aplicar em
-- udizowyfjnhuhgxkeayk, que tem migration irma propria em
-- src/supabase/migrations-legado/.
--
-- Base normativa: specs/contexto-conversacional-unificado-v2.md secao 14.3
-- (RPC transacional autoritativa) e 14.4 (os tres desfechos), aprovada pelo
-- Gabriel e revisada pelo Codex em 2026-08-15.
--
-- DEPENDE de 20260815120000_iris_nova_aguardando_resposta.sql (coluna
-- `estado_conversa.aguardando_resposta`). Aplicar NESTA ORDEM.
--
-- ESTA E A PRIMEIRA DAS TRES RPCs DE COMMIT V2. `criar` e `remarcar` NAO
-- existem ainda e NAO devem ser derivadas deste arquivo antes da revisao
-- desta -- as duas tem advisory lock e checagem de conflito por tsrange, que
-- cancelar nao tem.
--
-- ── POR QUE ESTA FUNCAO EXISTE, SE JA HA cappia_cancelar_agendamento_v2 ──
-- A v2 do cancelamento executa o efeito e NADA MAIS -- nao conhece
-- `versao_inicial` e nao grava estado conversacional. Na rota V2 isso e
-- insuficiente: dois turnos do mesmo paciente iniciados sobre o mesmo
-- snapshot CHEGAM A CHAMAR a RPC, e so depois um perde o CAS conversacional
-- (spec v2 secao 14.3). Um commit posterior nao desfaz efeito ja executado.
-- Por isso a versao precisa ser validada DENTRO da mesma transacao que
-- executa o efeito.
--
-- `cappia_cancelar_agendamento_v2` NAO e alterada, NAO e removida e NAO perde
-- grants -- ela continua servindo a rota V1, que permanece vigente ate o
-- corte. As duas rotas nunca rodam no mesmo turno.
--
-- ── ORDEM LOGICA DENTRO DA TRANSACAO (spec v2 secao 14.3) ────────────────
--   1. valida `versao_inicial` contra estado_conversa.atualizado_em, COM LOCK;
--   2. valida a AUTORIZACAO em `aguardando_resposta` da linha travada:
--      tipo='confirmacao', operacao='cancelar' e agendamento_id = alvo;
--   3. busca fresca do agendamento e executa o cancelamento;
--   4. grava o estado final completo + aguardando_resposta.
--
-- A ordem NAO e negociavel: validar a versao DEPOIS do efeito reintroduziria
-- exatamente a janela que esta funcao existe para fechar.
--
-- ── POR QUE NAO `contexto_horarios.proposta_pendente` ───────────────────
-- `proposta_pendente` carrega apenas `{data, horario}`. Isso prova QUANDO,
-- nunca O QUE foi confirmado: confirmar a CRIACAO de um agendamento no dia
-- 20 as 10:00 e confirmar o CANCELAMENTO de um agendamento no dia 20 as
-- 10:00 produzem exatamente o mesmo par. Usa-lo como autorizacao permitiria
-- que um "sim" destinado a uma operacao autorizasse OUTRA -- confusao entre
-- criar, remarcar e cancelar. Por isso a rota V2 NUNCA usa
-- `proposta_pendente` como autorizacao de efeito.
--
-- A autoridade e `estado_conversa.aguardando_resposta` DA LINHA TRAVADA, que
-- carrega `tipo`, `operacao` e `agendamento_id` (PerguntaPendente,
-- src/core/contexto-unificado-tipos.ts; spec v2 secao 14.3). Os tres juntos
-- identificam sem ambiguidade QUAL operacao sobre QUAL agendamento foi posta
-- em confirmacao. Nunca vem por parametro: aceitar a autorizacao do chamador
-- tornaria a validacao circular -- ele afirmaria justamente o que precisa
-- provar.
--
-- `contexto_horarios` continua sendo GRAVADO por esta funcao, mas nunca LIDO
-- como autorizacao -- e NAO vem por parametro: os ramos que concluem o efeito
-- gravam NULL LITERAL. Ver o bloco seguinte.
--
-- ── contexto_horarios = NULL LITERAL, SEM PARAMETRO ─────────────────────
-- `contexto_horarios` e o snapshot da proposta em aberto (proposta_pendente,
-- opcoes oferecidas). Um cancelamento CONCLUIDO encerra o fluxo: nao ha
-- proposta em aberto depois dele, entao o unico valor correto e NULL --
-- exatamente como `aguardando_resposta`, e pela mesma razao (spec v2 secao
-- 14.4).
--
-- Sendo predefinido, nao pode ser parametro: aceitar o valor do chamador
-- permitiria um cancelamento concluido terminar com proposta pendente
-- gravada, e o turno seguinte leria um horario em aberto que ninguem ofereceu
-- -- exatamente a confusao que a autorizacao explicita existe para evitar.
--
-- Recusa e turno obsoleto continuam nao gravando NADA, nem este campo.
--
-- ── VERSAO DIVERGENTE => NENHUM EFEITO ───────────────────────────────────
-- `turno_obsoleto` e desfecho de PRIMEIRA CLASSE, distinto de `conflito` e de
-- falha tecnica. Devolve sem executar nada e sem gravar nada. O adaptador TS
-- traduz isso em HTTP 409 (spec v2 secao 14.7), que o n8n nao reprocessa
-- (verificado por Gabriel em 2026-08-15, workflow ativo).
--
-- ── SO O RAMO QUE CONCLUI O EFEITO GRAVA O ESTADO FINAL ─────────────────
-- (spec v2 secao 14.4). A REGRA e predefinida -- uma confirmacao bem-sucedida
-- encerra o fluxo e nao deixa pergunta nem proposta em aberto -- mas quem a
-- aplica e o ramo que efetivamente concluiu. Esse ramo grava
-- `aguardando_resposta = NULL` e `contexto_horarios = NULL` **literais**,
-- jamais um parametro: nao existe entrada capaz de fazer um cancelamento
-- concluido terminar com pergunta ou proposta pendente. Recusa e turno
-- obsoleto NAO gravam nada.
--
-- ── RECUSA NAO ESCREVE (spec v2 secao 14.4) ──────────────────────────────
-- Quando a autorizacao nao confere ou o agendamento nao e cancelavel, esta
-- funcao NAO altera nada -- nem efeito, nem estado. O turno segue pelo
-- caminho comum sem efeito, que redige com o motivo factual e faz o UPDATE
-- estrito da proxima pergunta. Um so mecanismo, sem caminho especial.
--
-- ── `ja_cancelado`: NOVA AUTORIZACAO SOBRE AGENDAMENTO JA CANCELADO ─────
-- ESTE RAMO NAO E RETENTATIVA DE CHAMADA. A repeticao IDENTICA de uma
-- chamada ja concluida carrega a `versao_inicial` ANTIGA, e o passo 1 a
-- compara com `atualizado_em`, que a propria execucao anterior avancou: o
-- retorno e `turno_obsoleto`/`versao_divergente`, e a execucao NUNCA chega
-- aqui. Isso e o CAS funcionando como desenhado -- nao ha idempotencia de
-- retry nesta funcao, e nenhuma deve ser acrescentada.
--
-- O caso que ALCANCA este ramo e outro: um turno NOVO, com versao vigente e
-- autorizacao propria e valida, cujo alvo ja esta cancelado -- por exemplo o
-- paciente confirmando de novo o cancelamento de algo que ja foi cancelado
-- (por outro turno, pela recepcao ou pelo painel). Devolve SUCESSO, nunca
-- erro: o estado que o paciente pediu ja e o estado do mundo, e responder
-- "falhou" seria factualmente errado.
--
-- Preservado de cappia_cancelar_agendamento_v2, mas SO alcancavel apos a
-- versao conferir E a autorizacao em `aguardando_resposta` validar. Ordem
-- inversa faria um turno sem autoridade -- ou confirmando outra operacao --
-- receber "sucesso" de um cancelamento que outro turno executou, e a Iris
-- diria ao paciente que cancelou algo que ele nao confirmou neste turno.
--
-- ── TIMESTAMP ESTRITAMENTE CRESCENTE, GARANTIDO AQUI ────────────────────
-- `atualizado_em` e a VERSAO usada por todo o CAS do sistema. Um valor menor
-- ou igual ao vigente quebraria a deteccao de obsolescencia do proximo turno.
-- A funcao NAO confia no timestamp do chamador: calcula
-- `greatest(now(), versao_vigente + 1 microssegundo)`, mesma garantia de
-- `proximoTimestamp` em aplicar-dados.ts e contexto-horarios.ts, agora
-- imposta no unico lugar que pode garanti-la sob concorrencia -- dentro da
-- transacao, com a linha travada.
--
-- PREFLIGHT (obrigatorio, read-only, imediatamente antes de aplicar):
--   -- a coluna da migration anterior deve existir:
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='estado_conversa'
--      and column_name='aguardando_resposta';         -- deve retornar 1 linha
--   -- a funcao nova nao pode existir ainda (CREATE FUNCTION falha se existir):
--   select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname='cappia_commit_turno_v2_cancelar';
--                                                      -- VAZIO
--   -- a funcao da rota V1 deve continuar existindo, intocada:
--   select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname='cappia_cancelar_agendamento_v2';
--                                                      -- deve retornar 1 linha
--
-- CREATE FUNCTION, NAO CREATE OR REPLACE: colisao de nome falha
-- explicitamente. `OR REPLACE` sobrescreveria em silencio um corpo diferente
-- ja em uso -- inaceitavel para uma funcao que executa efeito real.
--
-- NAO APLICADA DE FORMA PERSISTENTE em nenhum projeto.
--
-- VALIDADA em 2026-08-15 no projeto dev bcmuqautblvjdqzhjfbw. Os dois testes
-- abaixo rodaram DUAS vezes: na primeira rodada aprovaram uma versao SEM o
-- vinculo `paciente_id` no passo 1; o Codex identificou esse furo de
-- isolamento, o predicado foi corrigido e AMBOS FORAM REEXECUTADOS sobre a
-- versao corrigida -- que e a deste arquivo. O registro abaixo se refere a
-- REVALIDACAO, nao a rodada anterior.
--
-- O furo (fechado): sem `and paciente_id = p_paciente_id`, o par (conversa do
-- paciente A, `p_paciente_id` e agendamento do paciente A2, MESMA clinica)
-- era aceito no passo 1 -- a autorizacao gravada na conversa de A seria lida
-- e a busca do passo 3 cancelaria o agendamento de A2. Efeito na ficha
-- errada, com autorizacao alheia. Coberto agora pelo caso 8b.
--
-- Os dois testes, ambos aprovados, ambos sem deixar residuo:
--
--   1. SESSAO UNICA (tests/..._cancelar_fixtures.sql) -- carregada dentro de
--      uma transacao encerrada em ROLLBACK. Compilou; discriminador de
--      autorizacao (tipo/operacao/agendamento_id) com efeito comprovado;
--      isolamento multiclinica e por paciente; CASO 8b -- paciente divergente
--      da conversa, mesma clinica, exigindo turno_obsoleto/
--      conversa_nao_encontrada e nenhum efeito (a prova direta do predicado
--      novo); estado final com os dois campos NULL e `dados` direto do
--      parametro; `p_dados` invalido falhando fechado; repeticao identica em
--      turno_obsoleto.
--   2. CONCORRENCIA A×B (tests/executar-teste-axb-commit-v2-cancelar.mjs) --
--      duas sessoes reais, mesma conversa, MESMA versao_inicial, ambas com
--      autorizacao valida. A executou; B esperou no lock e, apos o commit de
--      A, recebeu turno_obsoleto. UM efeito, UMA gravacao. Reexecutado apos a
--      correcao para confirmar que o predicado novo NAO alterou a
--      concorrencia -- as fixtures A×B ja gravam `paciente_id` da propria
--      conversa, entao o vinculo confere. Aqui a funcao foi criada
--      temporariamente e REMOVIDA na limpeza (o teste exige DDL real, porque
--      DDL em transacao nao e visivel a outra sessao).
--
-- Em nenhum dos dois a funcao ficou no banco: a verificacao final de cada um
-- acusou funcao e coluna inexistentes. udizowyfjnhuhgxkeayk (operacional)
-- nunca foi alvo.
--
-- A aplicacao definitiva -- no dev ou em qualquer outro projeto -- continua
-- NAO AUTORIZADA e depende de decisao explicita do Gabriel.

create function public.cappia_commit_turno_v2_cancelar(
  p_clinica_id           uuid,
  p_paciente_id          uuid,
  p_conversa_id          uuid,
  p_telefone_normalizado text,
  p_versao_inicial       timestamptz,
  p_agendamento_id       uuid,
  p_dados                jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_estado        estado_conversa%rowtype;
  v_ag            agendamentos%rowtype;
  v_pergunta      jsonb;
  v_tipo          text;
  v_operacao      text;
  v_alvo          text;
  v_novo_ts       timestamptz;
begin
  -- ── INVARIANTES DO CORE ────────────────────────────────────────────────
  -- Chegar aqui sem um destes e bug interno, nunca situacao do paciente:
  -- falha fechado, vira ErroRpcTecnico no adaptador e NUNCA entra no
  -- vocabulario conversacional. Mesma disciplina das RPCs anteriores.
  if p_clinica_id is null or p_paciente_id is null or p_conversa_id is null
     or p_agendamento_id is null or p_versao_inicial is null then
    raise exception 'identificador obrigatorio ausente' using errcode = 'check_violation';
  end if;
  if btrim(coalesce(p_telefone_normalizado, '')) = '' then
    raise exception 'telefone_normalizado ausente' using errcode = 'check_violation';
  end if;

  -- `p_dados` E OBRIGATORIO E PRECISA SER UM OBJETO JSON. O Core sempre monta
  -- o estado conversacional completo do turno -- chegar aqui com null, com um
  -- jsonb escalar ou com um array e bug interno, nunca situacao do paciente.
  -- Falha fechado, junto das demais invariantes.
  --
  -- Isto e o que permite o UPDATE gravar `dados = p_dados` DIRETO, sem
  -- coalesce: um coalesce silenciaria a ausencia preservando o valor do turno
  -- ANTERIOR, e o cancelamento terminaria com estado conversacional obsoleto
  -- gravado como se fosse o atual.
  --
  -- `jsonb_typeof` cobre o escalar e o array; `is null` cobre o SQL NULL. O
  -- literal JSON `null` tem jsonb_typeof = 'null' e tambem e recusado aqui.
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    raise exception 'dados ausente ou nao e objeto jsonb' using errcode = 'check_violation';
  end if;

  -- ── 1. VALIDAR A VERSAO INICIAL, COM LOCK ──────────────────────────────
  -- FOR UPDATE serializa turnos concorrentes DA MESMA CONVERSA neste ponto:
  -- o segundo turno espera aqui e, ao prosseguir, le `atualizado_em` JA
  -- avancado pelo primeiro -- entao a comparacao abaixo falha e ele sai sem
  -- efeito. E isto, e nao o CAS de um UPDATE final, que impede dupla
  -- execucao.
  --
  -- O predicado inclui clinica_id, telefone_normalizado E paciente_id:
  -- conversa de outra clinica e INALCANCAVEL por construcao (mesma disciplina
  -- de isolamento multiclinica das RPCs anteriores).
  --
  -- `paciente_id` NAO E REDUNDANTE. Sem ele, `p_paciente_id` seria um
  -- parametro NAO VERIFICADO contra a linha autoritativa: bastaria combinar a
  -- conversa de um paciente com o paciente_id de OUTRO, da mesma clinica,
  -- para o passo 1 aceitar. A busca do agendamento (passo 3) filtra por
  -- `p_paciente_id`, entao o par (conversa de A, paciente/agendamento de B)
  -- localizaria e cancelaria o agendamento de B usando a autorizacao gravada
  -- na conversa de A -- o efeito cairia na ficha errada. Amarrar o paciente a
  -- conversa aqui fecha isso antes de qualquer leitura de autorizacao.
  select * into v_estado
    from estado_conversa
   where id = p_conversa_id
     and clinica_id = p_clinica_id
     and telefone_normalizado = p_telefone_normalizado
     and paciente_id = p_paciente_id
   for update;

  if not found then
    return jsonb_build_object('resultado', 'turno_obsoleto', 'motivo', 'conversa_nao_encontrada');
  end if;

  -- Comparacao por igualdade estrita do timestamp, mesmo criterio ja usado
  -- pelo CAS de aplicar-dados.ts e gravarContextoHorarios. Divergiu = outro
  -- turno avancou o estado desde que este leu: ABORTA ANTES DE TUDO.
  if v_estado.atualizado_em is distinct from p_versao_inicial then
    return jsonb_build_object('resultado', 'turno_obsoleto', 'motivo', 'versao_divergente');
  end if;

  -- ── 2. VALIDAR A AUTORIZACAO PERSISTIDA ────────────────────────────────
  -- A pergunta de confirmacao precisa ter sido feita, ser DE CANCELAMENTO, e
  -- ser sobre ESTE agendamento. Ver o bloco "POR QUE NAO
  -- contexto_horarios.proposta_pendente" no cabecalho: sao os tres campos
  -- juntos (`tipo`, `operacao`, `agendamento_id`) que tornam a autorizacao
  -- inequivoca.
  --
  -- A fonte e `v_estado` -- a linha TRAVADA no passo 1 --, nunca um
  -- parametro.
  --
  -- ESTE PASSO VEM ANTES DA BUSCA DO AGENDAMENTO E ANTES DO RAMO
  -- `ja_cancelado`: um turno sem autorizacao valida nao deve nem localizar o
  -- alvo, muito menos receber "sucesso" porque outro turno ja cancelou.
  v_pergunta := v_estado.aguardando_resposta;

  if v_pergunta is null or jsonb_typeof(v_pergunta) <> 'object' then
    return jsonb_build_object('resultado', 'recusado', 'motivo', 'confirmacao_ausente');
  end if;

  v_tipo     := v_pergunta ->> 'tipo';
  v_operacao := v_pergunta ->> 'operacao';
  v_alvo     := v_pergunta ->> 'agendamento_id';

  if v_tipo is distinct from 'confirmacao' then
    return jsonb_build_object('resultado', 'recusado', 'motivo', 'pergunta_nao_e_confirmacao');
  end if;

  -- E AQUI que criar/remarcar/cancelar deixam de se confundir: a autorizacao
  -- so vale para a operacao que foi de fato posta em confirmacao.
  if v_operacao is distinct from 'cancelar' then
    return jsonb_build_object('resultado', 'recusado', 'motivo', 'operacao_divergente');
  end if;

  if v_alvo is null or btrim(v_alvo) = '' then
    return jsonb_build_object('resultado', 'recusado', 'motivo', 'alvo_ausente');
  end if;

  -- Comparacao textual do UUID: `->>` devolve text, e o alvo persistido tem a
  -- forma canonica gravada pelo Core. Divergiu = a confirmacao era sobre
  -- OUTRO agendamento.
  if v_alvo is distinct from p_agendamento_id::text then
    return jsonb_build_object('resultado', 'recusado', 'motivo', 'alvo_divergente');
  end if;

  -- ── 3. BUSCA FRESCA DO AGENDAMENTO, E TRAVA ────────────────────────────
  -- So depois de a autorizacao conferir. Predicado com clinica_id E
  -- paciente_id: agendamento de outra clinica ou de OUTRO PACIENTE e
  -- inalcancavel. Os tres casos (inexistente / outra clinica / outro
  -- paciente) devolvem o MESMO motivo de proposito -- distinguir revelaria a
  -- existencia de ficha alheia.
  select * into v_ag
    from agendamentos
   where id = p_agendamento_id
     and clinica_id = p_clinica_id
     and paciente_id = p_paciente_id
   for update;

  if not found then
    return jsonb_build_object('resultado', 'recusado', 'motivo', 'agendamento_nao_encontrado');
  end if;

  -- ── 4. TIMESTAMP ESTRITAMENTE CRESCENTE ────────────────────────────────
  -- Calculado aqui, com a linha travada, e nunca recebido do chamador. Ver o
  -- bloco "TIMESTAMP ESTRITAMENTE CRESCENTE" no cabecalho.
  v_novo_ts := greatest(now(), v_estado.atualizado_em + interval '1 microsecond');

  -- ── 5. ALVO JA CANCELADO -- APOS VERSAO E AUTORIZACAO VALIDADAS ────────
  -- NAO e retentativa: a repeticao identica de uma chamada ja concluida sai
  -- em `turno_obsoleto` no passo 1 e nunca chega aqui (ver o bloco
  -- "`ja_cancelado`" no cabecalho). Este ramo atende o turno NOVO, com
  -- autorizacao propria e valida, cujo alvo ja esta cancelado.
  --
  -- Devolve SUCESSO, nunca erro: o estado que o paciente pediu ja e o estado
  -- do mundo. Mesma forma de `ja_cancelado` em
  -- cappia_cancelar_agendamento_v2.
  --
  -- O estado conversacional E GRAVADO tambem aqui: este turno tem autoridade
  -- (versao conferiu) e a autorizacao era deste cancelamento, entao o fluxo
  -- encerra -- e `aguardando_resposta`/`contexto_horarios` precisam refletir
  -- isso, ambos com NULL literal.
  if v_ag.status = 'cancelado' then
    update estado_conversa
       set dados               = p_dados,
           aguardando_resposta = null,
           contexto_horarios   = null,
           atualizado_em       = v_novo_ts
     where id = p_conversa_id;

    return jsonb_build_object(
      'resultado', 'executado', 'ja_cancelado', true,
      'agendamento_id', p_agendamento_id, 'atualizado_em', v_novo_ts);
  end if;

  -- ── 6. SO AGENDAMENTO CONFIRMADO E CANCELAVEL ──────────────────────────
  -- 'remarcado' nao e cancelavel: a linha ativa e a sucessora, com ciclo de
  -- vida proprio. 'concluido'/'faltou' tambem nao -- o atendimento ja
  -- aconteceu, e reescrever isso seria falsear historico clinico.
  if v_ag.status <> 'confirmado' then
    return jsonb_build_object('resultado', 'recusado', 'motivo', 'nao_confirmado');
  end if;

  -- ── 7. EXECUTAR ────────────────────────────────────────────────────────
  -- SEM advisory lock e SEM checagem de conflito por tsrange, ao contrario da
  -- reserva e da remarcacao: cancelar LIBERA um horario, nunca reivindica um.
  -- Nao ha concorrencia de destino a proteger.
  begin
    update agendamentos
       set status = 'cancelado'
     where id = p_agendamento_id;
  exception
    when others then
      -- NUNCA devolve sqlerrm (pode conter SQL, detalhe de linha ou PII).
      return jsonb_build_object('resultado', 'falha', 'motivo', 'erro_atualizacao');
  end;

  -- ── 8. GRAVAR O ESTADO FINAL, NA MESMA TRANSACAO ───────────────────────
  -- Este e o ramo que EFETIVAMENTE CONCLUIU o efeito -- e por isso grava
  -- `aguardando_resposta = NULL` e `contexto_horarios = NULL` LITERAIS (spec
  -- v2 secao 14.4). Nao ha parametro para nenhum dos dois de proposito:
  -- nenhuma entrada pode fazer um cancelamento concluido terminar com
  -- pergunta ou proposta pendente. `dados` vem por parametro e ja foi
  -- validado como objeto jsonb nas invariantes -- por isso sem coalesce.
  --
  -- Sem CAS no WHERE: a linha ja esta travada desde o passo 1 e a versao ja
  -- foi conferida contra `p_versao_inicial`. Repetir a condicao aqui nao
  -- acrescentaria garantia -- o lock e que segura.
  update estado_conversa
     set dados               = p_dados,
         aguardando_resposta = null,
         contexto_horarios   = null,
         atualizado_em       = v_novo_ts
   where id = p_conversa_id;

  return jsonb_build_object(
    'resultado', 'executado', 'agendamento_id', p_agendamento_id,
    'status', 'cancelado', 'atualizado_em', v_novo_ts);
end;
$$;

-- Privilegios minimos: revoga o EXECUTE publico padrao do Postgres e concede
-- so a service_role -- mesmo padrao das funcoes anteriores da Iris Nova.
-- NENHUM grant de cappia_cancelar_agendamento_v2 e alterado aqui.
revoke all on function public.cappia_commit_turno_v2_cancelar(
  uuid, uuid, uuid, text, timestamptz, uuid, jsonb) from public;
revoke all on function public.cappia_commit_turno_v2_cancelar(
  uuid, uuid, uuid, text, timestamptz, uuid, jsonb) from anon;
revoke all on function public.cappia_commit_turno_v2_cancelar(
  uuid, uuid, uuid, text, timestamptz, uuid, jsonb) from authenticated;
grant execute on function public.cappia_commit_turno_v2_cancelar(
  uuid, uuid, uuid, text, timestamptz, uuid, jsonb) to service_role;
