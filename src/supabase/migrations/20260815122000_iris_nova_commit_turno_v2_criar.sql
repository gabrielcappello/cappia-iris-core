-- Iris Nova - commit autoritativo do turno V2: CRIAR.
--
-- Projeto-alvo: cappia-iris-core-dev (bcmuqautblvjdqzhjfbw) -- ambiente
-- isolado de desenvolvimento e testes da Iris Nova. PROIBIDO aplicar em
-- udizowyfjnhuhgxkeayk.
--
-- Base normativa: specs/contexto-conversacional-unificado-v2.md secoes 14.3
-- (RPC transacional autoritativa), 14.4 (os tres desfechos) e 14.9 (testes
-- exigidos). Desenho aprovado pelo Gabriel em 2026-08-15.
--
-- DEPENDE de 20260815120000_iris_nova_aguardando_resposta.sql (coluna
-- `estado_conversa.aguardando_resposta`) e das tres funcoes resolvedoras de
-- 20260804150000_iris_nova_reaproveitamento_agendamento_v1.sql. Aplicar
-- NESTA ORDEM.
--
-- SEGUNDA DAS TRES RPCs DE COMMIT V2. `remarcar` NAO existe e NAO deve ser
-- derivada deste arquivo: ela precisa liberar o horario antigo E reivindicar
-- o novo na mesma transacao, o que muda o conjunto de locks.
--
-- ── O QUE MUDA EM RELACAO A cappia_commit_turno_v2_cancelar ─────────────
-- A espinha e a MESMA (versao -> autorizacao -> efeito -> estado, na mesma
-- transacao, com a linha da conversa travada). Tres diferencas de fundo:
--
--   1. CRIAR REIVINDICA UM HORARIO; cancelar libera. Por isso aqui existem
--      advisory lock por (clinica, dentista, dia) e checagem de conflito por
--      tsrange -- que cancelar deliberadamente nao tem.
--   2. NAO HA ALVO PREVIO. `agendamento_id` e PROIBIDO na autorizacao (uma
--      criacao nao referencia agendamento existente), ao contrario de
--      cancelar, onde e obrigatorio.
--   3. NAO HA RAMO DE REPLAY. Cancelar tem `ja_cancelado` porque "ja esta
--      cancelado" e observavel. "Ja foi criado" NAO e: descobrir se alguma
--      linha existente corresponde a ESTA intencao exigiria inferencia, que
--      e exatamente o que a arquitetura proibe. Se a versao confere e a
--      autorizacao vale, esta funcao cria ou recusa -- nunca "reconhece".
--
-- ── POR QUE NAO CHAMA cappia_reservar_agendamento ───────────────────────
-- Decisao do Gabriel (2026-08-15): reutilizar somente os TRES RESOLVEDORES
-- (`cappia__resolver_dentista`, `cappia__resolver_procedimento`,
-- `cappia__resolver_duracao`), e incorporar lock, conflito e INSERT aqui.
--
-- Motivo: `cappia_reservar_agendamento` devolve `sqlerrm` no ramo de erro
-- ('detalhe'), e sqlerrm pode carregar SQL, detalhe de linha ou PII. Chamar
-- exigiria filtrar o retorno alheio a cada campo -- mais fragil do que
-- possuir o INSERT. A LOGICA de lock e conflito abaixo e a MESMA daquela
-- funcao, sem reescrita: mesmo hash de advisory lock, mesmo predicado de
-- tsrange, mesma janela `data between ini-1 and fim`.
--
-- `cappia_reservar_agendamento` NAO e alterada, NAO e removida e NAO perde
-- grants -- continua servindo a rota V1 ate o corte.
--
-- ── ORDEM LOGICA DENTRO DA TRANSACAO (spec v2 secao 14.3) ───────────────
--   1. valida `versao_inicial` contra estado_conversa.atualizado_em, COM LOCK
--      (predicado inclui paciente_id -- ver abaixo);
--   2. valida a AUTORIZACAO em `aguardando_resposta` da linha travada:
--      tipo='confirmacao', operacao='criar' e AUSENCIA de agendamento_id;
--   3. valida o CONTEUDO recebido contra a propria linha travada:
--      data/horario contra `contexto_horarios.proposta_pendente`,
--      dentista/procedimento contra `dados`;
--   4. resolve dentista/procedimento/duracao (funcoes reaproveitadas);
--   5. advisory lock por (clinica, dentista, dia) e checagem de conflito;
--   6. INSERT do agendamento;
--   7. grava o estado final completo.
--
-- A ordem NAO e negociavel: validar a versao DEPOIS do efeito reintroduziria
-- a janela que esta funcao existe para fechar.
--
-- ── PREDICADO DA LINHA AUTORITATIVA INCLUI paciente_id ──────────────────
-- Mesma correcao ja aplicada em cappia_commit_turno_v2_cancelar apos revisao
-- do Codex. Sem `and paciente_id = p_paciente_id`, `p_paciente_id` seria um
-- parametro NAO VERIFICADO contra a linha travada, e o agendamento poderia
-- ser criado na ficha de OUTRO paciente da mesma clinica usando a
-- autorizacao gravada nesta conversa.
--
-- ── AUTORIZACAO: `agendamento_id` E PROIBIDO, INCLUSIVE COMO JSON null ───
-- A checagem e `v_pergunta ? 'agendamento_id'` -- presenca da CHAVE, nao do
-- valor. `->>` devolveria NULL tanto para chave ausente quanto para
-- `"agendamento_id": null`, e os dois casos NAO sao equivalentes: a chave
-- presente com null indica que quem gravou a autorizacao tinha um alvo em
-- mente. Uma confirmacao de CRIACAO que carrega alvo nao e a pergunta que
-- esta funcao esta autorizada a executar.
--
-- ── CONTEUDO VALIDADO CONTRA A LINHA TRAVADA (decisao do Gabriel) ───────
-- Os dados do agendamento chegam por parametro (o Core ja os resolveu), MAS
-- sao conferidos contra o que esta persistido na linha travada:
--
--   - `p_data`/`p_horario` contra `contexto_horarios.proposta_pendente` --
--     e a proposta que o paciente de fato viu antes de dizer "sim";
--   - `p_dentista_id`/`p_procedimento_id` contra `dados`.
--
-- Isto NAO transforma `proposta_pendente` em autorizacao (spec v2 secao
-- 14.3 continua valendo: quem autoriza e `aguardando_resposta.operacao`).
-- `proposta_pendente` responde O QUE se cria, nunca SE pode criar. Sem esta
-- conferencia, um "sim" dado a uma proposta poderia criar um agendamento
-- diferente do proposto -- o parametro afirmaria sozinho o que precisa ser
-- provado.
--
-- ── AGENDAMENTO COMPLETO: nome e documento sao OBRIGATORIOS ────────────
-- Correcao preservada por decisao explicita do Gabriel. `agendamentos.nome`
-- e `documento` sao preenchidos a partir dos parametros; `telefone` chega JA
-- NORMALIZADO (mesma forma de `estado_conversa.telefone_normalizado`); o
-- NOME DO PROCEDIMENTO vem do resolvedor (`nome_pt`), nunca do chamador --
-- assim a linha nunca guarda um rotulo que diverge do catalogo.
--
-- ── VERSAO DIVERGENTE => NENHUM EFEITO ─────────────────────────────────
-- `turno_obsoleto` e desfecho de PRIMEIRA CLASSE. Devolve sem executar e sem
-- gravar. O adaptador TS traduz em HTTP 409 (spec v2 secao 14.7).
--
-- ── horario_ocupado E RECUSA, NAO FALHA ────────────────────────────────
-- E situacao real do paciente, com resposta conversacional legitima ("esse
-- horario acabou de ser ocupado"), nao erro tecnico. Falha tecnica e so
-- `erro_insercao`, e NUNCA devolve sqlerrm.
--
-- ── SO O RAMO QUE CONCLUI O EFEITO GRAVA O ESTADO FINAL ────────────────
-- (spec v2 secao 14.4). Grava `aguardando_resposta = NULL` e
-- `contexto_horarios = NULL` LITERAIS: uma criacao concluida encerra o fluxo
-- e nao deixa pergunta nem proposta em aberto. Recusa e turno obsoleto NAO
-- gravam nada.
--
-- ── TIMESTAMP ESTRITAMENTE CRESCENTE, GARANTIDO AQUI ───────────────────
-- `greatest(now(), versao_vigente + 1 microssegundo)`, calculado dentro da
-- transacao com a linha travada -- nunca recebido do chamador.
--
-- PREFLIGHT (obrigatorio, read-only, imediatamente antes de aplicar):
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='estado_conversa'
--      and column_name='aguardando_resposta';          -- deve retornar 1 linha
--   select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname='cappia_commit_turno_v2_criar';
--                                                       -- VAZIO
--   select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public'
--      and p.proname in ('cappia__resolver_dentista','cappia__resolver_procedimento',
--                        'cappia__resolver_duracao','cappia_reservar_agendamento');
--                                                       -- deve retornar 4 linhas
--
-- CREATE FUNCTION, NAO CREATE OR REPLACE: colisao de nome falha
-- explicitamente.
--
-- NAO APLICADA DE FORMA PERSISTENTE em nenhum projeto.
--
-- VALIDADA em 2026-08-15 no projeto dev bcmuqautblvjdqzhjfbw, por dois
-- testes, ambos aprovados, ambos sem deixar residuo:
--
--   1. SESSAO UNICA (tests/..._criar_fixtures.sql, 20 casos) -- carregada
--      dentro de transacao encerrada em ROLLBACK. Compilou; discriminador de
--      autorizacao; `agendamento_id` recusado INCLUSIVE como JSON null
--      (caso 4b); proposta/dentista/procedimento conferidos contra a linha
--      travada; paciente divergente da conversa (caso 9b); nome/documento/
--      p_dados falhando fechado; agendamento COMPLETO campo a campo (caso
--      12, com o nome do procedimento vindo do catalogo); conflito por
--      SOBREPOSICAO -- 10:30 sobre 10:00-11:00 (caso 14) -- e o controle do
--      caso 15: mesma clinica, mesmo horario, OUTRO dentista cria
--      normalmente e os dois agendamentos coexistem, provando que o conflito
--      e isolado por DENTISTA.
--   2. CONCORRENCIA A×B (tests/executar-teste-axb-commit-v2-criar.mjs), com
--      os DOIS cenarios de concorrencia da criacao:
--      - mesma conversa, mesma versao_inicial: A executou, B recebeu
--        turno_obsoleto/versao_divergente, EXATAMENTE 1 agendamento criado e
--        UMA gravacao de estado (spec v2 secao 14.9);
--      - conversas diferentes disputando o mesmo intervalo: B tinha versao
--        PROPRIA e valida, entao nao foi barrado pelo CAS -- esperou no
--        ADVISORY LOCK (barreira confirmada por pg_blocking_pids) e recebeu
--        recusado/horario_ocupado. 1 agendamento no intervalo disputado, e a
--        recusa de B nao gravou estado.
--
-- Em nenhum dos dois a funcao ficou no banco: a verificacao final acusou
-- funcao e coluna inexistentes, zero clinicas/procedimentos sinteticos e as
-- 4 funcoes da rota V1 intactas. udizowyfjnhuhgxkeayk (operacional) nunca
-- foi alvo.
--
-- A aplicacao definitiva continua NAO AUTORIZADA e depende de decisao
-- explicita do Gabriel. A REVISAO DO CODEX desta peca esta PENDENTE.

create function public.cappia_commit_turno_v2_criar(
  p_clinica_id           uuid,
  p_paciente_id          uuid,
  p_conversa_id          uuid,
  p_telefone_normalizado text,
  p_versao_inicial       timestamptz,
  p_data                 date,
  p_horario              text,
  p_dentista_id          uuid,
  p_procedimento_id      text,
  p_nome                 text,
  p_documento            text,
  p_dados                jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_estado     estado_conversa%rowtype;
  v_pergunta   jsonb;
  v_proposta   jsonb;
  v_tipo       text;
  v_operacao   text;
  v_dent       jsonb;
  v_did        uuid;
  v_dnome      text;
  v_proc       jsonb;
  v_proc_id    text;
  v_proc_nome  text;
  v_dur        int;
  v_ini        timestamp;
  v_fim        timestamp;
  v_dia        timestamp;
  v_novo_id    uuid;
  v_novo_ts    timestamptz;
begin
  -- ── INVARIANTES DO CORE ────────────────────────────────────────────────
  -- Chegar aqui sem um destes e bug interno, nunca situacao do paciente:
  -- falha fechado, vira ErroRpcTecnico no adaptador e NUNCA entra no
  -- vocabulario conversacional.
  if p_clinica_id is null or p_paciente_id is null or p_conversa_id is null
     or p_versao_inicial is null or p_data is null then
    raise exception 'identificador obrigatorio ausente' using errcode = 'check_violation';
  end if;
  if btrim(coalesce(p_telefone_normalizado, '')) = '' then
    raise exception 'telefone_normalizado ausente' using errcode = 'check_violation';
  end if;
  if p_horario is null or p_horario !~ '^[0-9]{1,2}:[0-9]{2}$'
     or split_part(p_horario, ':', 1)::int > 23
     or split_part(p_horario, ':', 2)::int > 59 then
    raise exception 'horario ausente ou malformado' using errcode = 'check_violation';
  end if;

  -- AGENDAMENTO COMPLETO: sem nome e documento a linha nasce incompleta e a
  -- clinica nao consegue atender. E invariante do Core -- o cadastro ja foi
  -- coletado antes de qualquer confirmacao.
  if btrim(coalesce(p_nome, '')) = '' then
    raise exception 'nome do paciente ausente' using errcode = 'check_violation';
  end if;
  if btrim(coalesce(p_documento, '')) = '' then
    raise exception 'documento do paciente ausente' using errcode = 'check_violation';
  end if;

  -- `p_dados` obrigatorio e objeto -- permite gravar `dados = p_dados` DIRETO,
  -- sem coalesce (que silenciaria a ausencia preservando o turno anterior).
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    raise exception 'dados ausente ou nao e objeto jsonb' using errcode = 'check_violation';
  end if;

  -- ── 1. VALIDAR A VERSAO INICIAL, COM LOCK ──────────────────────────────
  -- FOR UPDATE serializa turnos concorrentes DA MESMA CONVERSA: o segundo
  -- espera aqui e, ao prosseguir, le `atualizado_em` JA avancado pelo
  -- primeiro -- entao a comparacao abaixo falha e ele sai sem efeito.
  --
  -- O predicado inclui clinica_id, telefone_normalizado E paciente_id (ver o
  -- bloco "PREDICADO DA LINHA AUTORITATIVA" no cabecalho).
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

  if v_estado.atualizado_em is distinct from p_versao_inicial then
    return jsonb_build_object('resultado', 'turno_obsoleto', 'motivo', 'versao_divergente');
  end if;

  -- ── 2. VALIDAR A AUTORIZACAO PERSISTIDA ────────────────────────────────
  -- A fonte e `v_estado` -- a linha TRAVADA no passo 1 --, nunca um
  -- parametro: aceitar a autorizacao do chamador tornaria a validacao
  -- circular.
  v_pergunta := v_estado.aguardando_resposta;

  if v_pergunta is null or jsonb_typeof(v_pergunta) <> 'object' then
    return jsonb_build_object('resultado', 'recusado', 'motivo', 'confirmacao_ausente');
  end if;

  v_tipo     := v_pergunta ->> 'tipo';
  v_operacao := v_pergunta ->> 'operacao';

  if v_tipo is distinct from 'confirmacao' then
    return jsonb_build_object('resultado', 'recusado', 'motivo', 'pergunta_nao_e_confirmacao');
  end if;

  -- E AQUI que criar/remarcar/cancelar deixam de se confundir.
  if v_operacao is distinct from 'criar' then
    return jsonb_build_object('resultado', 'recusado', 'motivo', 'operacao_divergente');
  end if;

  -- PRESENCA DA CHAVE, nao do valor (`?`, nao `->>`): `"agendamento_id": null`
  -- tambem e recusado. Ver o bloco correspondente no cabecalho.
  if v_pergunta ? 'agendamento_id' then
    return jsonb_build_object('resultado', 'recusado', 'motivo', 'alvo_indevido');
  end if;

  -- ── 3. VALIDAR O CONTEUDO CONTRA A LINHA TRAVADA ───────────────────────
  -- `proposta_pendente` NAO autoriza (isso e `operacao`); ela responde O QUE
  -- se cria. Sem esta conferencia, um "sim" dado a uma proposta poderia
  -- criar agendamento diferente do proposto.
  v_proposta := v_estado.contexto_horarios -> 'proposta_pendente';

  if v_proposta is null or jsonb_typeof(v_proposta) <> 'object' then
    return jsonb_build_object('resultado', 'recusado', 'motivo', 'proposta_ausente');
  end if;

  if (v_proposta ->> 'data') is distinct from to_char(p_data, 'YYYY-MM-DD')
     or (v_proposta ->> 'horario') is distinct from p_horario then
    return jsonb_build_object('resultado', 'recusado', 'motivo', 'proposta_divergente');
  end if;

  -- Dentista e procedimento contra `dados` -- os dois campos que a
  -- interpretadora ja resolveu semanticamente e o Core persistiu.
  if p_dentista_id is null
     or (v_estado.dados ->> 'dentista_id') is distinct from p_dentista_id::text then
    return jsonb_build_object('resultado', 'recusado', 'motivo', 'dentista_divergente');
  end if;

  if p_procedimento_id is null or btrim(p_procedimento_id) = ''
     or (v_estado.dados ->> 'procedimento_id') is distinct from p_procedimento_id then
    return jsonb_build_object('resultado', 'recusado', 'motivo', 'procedimento_divergente');
  end if;

  -- ── 4. RESOLVEDORES REAPROVEITADOS ─────────────────────────────────────
  -- As tres funcoes de 20260804150000 (auditadas e ja em uso pela rota V1).
  -- Nenhuma logica de resolucao e reescrita aqui.
  v_dent := public.cappia__resolver_dentista(p_clinica_id, p_dentista_id, null);
  if not (v_dent ->> 'ok')::boolean then
    return jsonb_build_object('resultado', 'recusado', 'motivo', v_dent ->> 'motivo');
  end if;
  v_did   := (v_dent ->> 'dentista_id')::uuid;
  v_dnome := v_dent ->> 'dentista_nome';

  v_proc := public.cappia__resolver_procedimento(p_clinica_id, v_did, p_procedimento_id, null);
  if not (v_proc ->> 'ok')::boolean then
    return jsonb_build_object('resultado', 'recusado', 'motivo', v_proc ->> 'motivo');
  end if;
  v_proc_id := v_proc ->> 'procedimento_id';
  -- NOME DO PROCEDIMENTO VEM DO RESOLVEDOR, nunca do chamador: a linha nunca
  -- guarda rotulo divergente do catalogo.
  v_proc_nome := v_proc ->> 'nome_pt';

  v_dur := public.cappia__resolver_duracao(p_clinica_id, v_did, v_proc_id);
  v_ini := p_data + p_horario::time;
  v_fim := v_ini + make_interval(mins => v_dur);

  -- ── 5. ADVISORY LOCK POR (CLINICA, DENTISTA, DIA) ──────────────────────
  -- MESMO hash de cappia_reservar_agendamento, sem reescrita. Este lock --
  -- e nao o da conversa -- e o que serializa PACIENTES DIFERENTES disputando
  -- o mesmo horario do mesmo dentista. O laco cobre agendamentos que cruzam
  -- meia-noite. Sendo `xact`, e liberado no fim da transacao.
  --
  -- ORDEM DOS LOCKS: conversa (passo 1) e SO ENTAO dia/dentista. A ordem e
  -- fixa e nunca deve ser invertida -- duas RPCs adquirindo os mesmos locks
  -- em ordens opostas poderiam se travar em ciclo.
  for v_dia in select generate_series(date_trunc('day', v_ini),
                                      date_trunc('day', v_fim - interval '1 microsecond'),
                                      interval '1 day') loop
    perform pg_advisory_xact_lock(
      hashtextextended(p_clinica_id::text || ':' || v_did::text || ':' || v_dia::text, 0));
  end loop;

  -- ── 6. CONFLITO POR INTERVALO ──────────────────────────────────────────
  -- Sobreposicao de tsrange com `[)`, nao igualdade de horario: um
  -- agendamento de 60min as 10:00 conflita com 10:30. Mesmo predicado de
  -- cappia_reservar_agendamento. `data between ini-1 and fim` e filtro de
  -- indice; quem decide e o `&&`.
  if exists (
    select 1 from agendamentos a
     where a.clinica_id = p_clinica_id
       and a.dentista_id = v_did
       and a.status = 'confirmado'
       and a.horario ~ '^[0-9]{1,2}:[0-9]{2}$'
       and a.data between v_ini::date - 1 and v_fim::date
       and tsrange(a.data + a.horario::time,
                   a.data + a.horario::time + make_interval(mins => coalesce(a.duracao_min, 60)), '[)')
           && tsrange(v_ini, v_fim, '[)')
  ) then
    -- RECUSA, nao falha: situacao real do paciente.
    return jsonb_build_object('resultado', 'recusado', 'motivo', 'horario_ocupado');
  end if;

  -- ── 7. TIMESTAMP ESTRITAMENTE CRESCENTE ────────────────────────────────
  v_novo_ts := greatest(now(), v_estado.atualizado_em + interval '1 microsecond');

  -- ── 8. INSERT ──────────────────────────────────────────────────────────
  -- `telefone` recebe `p_telefone_normalizado` -- ja normalizado, mesma forma
  -- de estado_conversa.telefone_normalizado. Colunas de calendario ficam
  -- nulas (a Iris Nova nao integra GCal nesta etapa), mesma premissa ja
  -- registrada na migration de reaproveitamento.
  begin
    insert into agendamentos (
      clinica_id, paciente_id, data, horario, nome, documento, telefone,
      procedimento, procedimento_id, status, dentista_nome, dentista_id,
      duracao_min, gcal_cleanup_pendente)
    values (
      p_clinica_id, p_paciente_id, p_data, p_horario, p_nome, p_documento,
      p_telefone_normalizado, v_proc_nome, v_proc_id, 'confirmado', v_dnome,
      v_did, v_dur, false)
    returning id into v_novo_id;
  exception
    when others then
      -- NUNCA devolve sqlerrm (pode conter SQL, detalhe de linha ou PII).
      return jsonb_build_object('resultado', 'falha', 'motivo', 'erro_insercao');
  end;

  -- ── 9. GRAVAR O ESTADO FINAL, NA MESMA TRANSACAO ───────────────────────
  -- Ramo que EFETIVAMENTE CONCLUIU o efeito -- por isso grava
  -- `aguardando_resposta = NULL` e `contexto_horarios = NULL` LITERAIS.
  -- Sem CAS no WHERE: a linha esta travada desde o passo 1 e a versao ja foi
  -- conferida.
  update estado_conversa
     set dados               = p_dados,
         aguardando_resposta = null,
         contexto_horarios   = null,
         atualizado_em       = v_novo_ts
   where id = p_conversa_id;

  return jsonb_build_object(
    'resultado', 'executado', 'agendamento_id', v_novo_id,
    'data', p_data, 'horario', p_horario, 'dentista_id', v_did,
    'duracao_min', v_dur, 'atualizado_em', v_novo_ts);
end;
$$;

-- Privilegios minimos: revoga o EXECUTE publico padrao e concede so a
-- service_role. NENHUM grant de cappia_reservar_agendamento e alterado aqui.
revoke all on function public.cappia_commit_turno_v2_criar(
  uuid, uuid, uuid, text, timestamptz, date, text, uuid, text, text, text, jsonb) from public;
revoke all on function public.cappia_commit_turno_v2_criar(
  uuid, uuid, uuid, text, timestamptz, date, text, uuid, text, text, text, jsonb) from anon;
revoke all on function public.cappia_commit_turno_v2_criar(
  uuid, uuid, uuid, text, timestamptz, date, text, uuid, text, text, text, jsonb) from authenticated;
grant execute on function public.cappia_commit_turno_v2_criar(
  uuid, uuid, uuid, text, timestamptz, date, text, uuid, text, text, text, jsonb) to service_role;
