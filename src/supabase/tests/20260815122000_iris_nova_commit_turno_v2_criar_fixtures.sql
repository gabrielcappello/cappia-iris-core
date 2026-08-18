-- Fixtures e assertivas de 20260815122000_iris_nova_commit_turno_v2_criar.sql
--
-- Projeto-alvo: cappia-iris-core-dev (bcmuqautblvjdqzhjfbw). PROIBIDO em
-- udizowyfjnhuhgxkeayk (projeto operacional, WhatsApp ativo).
--
-- STATUS: EXECUTADO E APROVADO em 2026-08-15, no projeto dev
-- bcmuqautblvjdqzhjfbw -- 20 casos, todos passaram, ROLLBACK executado e
-- verificacao posterior com zero residuos. Producao intocada.
--
-- Dois defeitos DO PROPRIO TESTE foram corrigidos antes da aprovacao (a RPC
-- nao foi alterada em nenhum deles):
--   1. o caso 15 usava outra clinica E outro dentista -- duas variaveis ao
--      mesmo tempo, entao nao provava por qual delas o conflito e isolado.
--      Passou a usar um SEGUNDO DENTISTA DA MESMA CLINICA, com clinica, dia
--      e horario constantes;
--   2. o caso 14 nao restaurava `dados` apos o caso 11 -- a RPC grava
--      `dados = p_dados` do turno que concluiu (comportamento correto), o
--      que apagava dentista_id/procedimento_id e fazia o caso recusar por
--      `dentista_divergente` antes de chegar a checagem de conflito.
--
-- ── ESTE ARQUIVO NAO CONTEM COPIA DA FUNCAO ─────────────────────────────
-- So cria dados sinteticos e faz assertivas. A funcao sob teste e carregada
-- do ARQUIVO REAL da migration, na MESMA transacao, antes deste arquivo --
-- mesma disciplina ja aprovada no teste de cancelamento. Nem BEGIN nem
-- ROLLBACK aparecem aqui: a transacao e controlada por quem executa.
--
-- ── O QUE ESTE TESTE PROVA, E O QUE NAO PROVA ───────────────────────────
-- PROVA: que a migration real compila; que a autorizacao (`confirmacao` +
-- `criar`, SEM agendamento_id) tem efeito; que o conteudo e conferido contra
-- a linha travada (proposta, dentista, procedimento); que o conflito por
-- intervalo recusa; e que o agendamento nasce COMPLETO.
--
-- NAO PROVA concorrencia -- nem a da mesma conversa, nem a de duas conversas
-- disputando o mesmo intervalo (o advisory lock). As duas exigem duas
-- sessoes e ficam no teste A×B proprio.
--
-- ── AUTOSSUFICIENTE ─────────────────────────────────────────────────────
-- Toda clinica, paciente, conversa, dentista e procedimento e criado aqui.
-- Nenhuma linha preexistente e lida, travada ou alterada.
--
-- O dentista vive em `clinicas.dentistas` (jsonb) e o procedimento em
-- `procedimentos_catalogo` -- e assim que os tres resolvedores reaproveitados
-- os encontram. `procedimentos_catalogo` NAO tem clinica_id (catalogo
-- global), entao o id sintetico usa prefixo proprio para nao colidir.

do $teste$
declare
  clinica_a    uuid;
  clinica_b    uuid;
  paciente_a   uuid;
  paciente_a2  uuid;   -- outro paciente da MESMA clinica A
  paciente_b   uuid;
  conversa_a   uuid;
  conversa_a2  uuid;   -- conversa do 2o paciente da clinica A (caso 15)
  conversa_b   uuid;
  dentista_a   uuid := gen_random_uuid();
  -- SEGUNDO dentista da MESMA clinica A -- existe so para o caso 15, que
  -- precisa variar o dentista mantendo clinica e horario constantes.
  dentista_a2  uuid := gen_random_uuid();
  dentista_b   uuid := gen_random_uuid();
  ag_conflito  uuid;
  versao       timestamptz;
  r            jsonb;
  n            int;
  fin          record;
  data_alvo    date := current_date + 7;
begin
  -- ── CATALOGO SINTETICO ────────────────────────────────────────────────
  insert into procedimentos_catalogo (id, tempo_padrao, ativo, nome_pt, nome_es,
                                      nome_en, nome_fr, nome_de, nome_it, nome_ru, nome_ar)
    values ('teste-criar-proc', 60, true, 'Consulta / Avaliacao', 'Consulta', 'Consultation',
            'Consultation', 'Beratung', 'Consulto', 'Konsultaciya', 'Istisharat');

  -- ── CLINICAS, COM O DENTISTA NO JSONB ─────────────────────────────────
  -- Clinica A com DOIS dentistas: o segundo e o controle do caso 15.
  insert into clinicas (provider, instancia_whatsapp, dentistas)
    values ('evolution', 'teste-criar-clinica-a',
            jsonb_build_array(
              jsonb_build_object(
                'id', dentista_a::text, 'nome', 'Diego Ramoz', 'titulo', 'Dr.', 'ativo', true,
                'procedimentos', jsonb_build_array(
                  jsonb_build_object('id', 'teste-criar-proc', 'nome', 'Consulta / Avaliacao', 'ativo', true))),
              jsonb_build_object(
                'id', dentista_a2::text, 'nome', 'Carlos Turiak', 'titulo', 'Dr.', 'ativo', true,
                'procedimentos', jsonb_build_array(
                  jsonb_build_object('id', 'teste-criar-proc', 'nome', 'Consulta / Avaliacao', 'ativo', true)))))
    returning id into clinica_a;

  insert into clinicas (provider, instancia_whatsapp, dentistas)
    values ('evolution', 'teste-criar-clinica-b',
            jsonb_build_array(jsonb_build_object(
              'id', dentista_b::text, 'nome', 'Vanesa Vocaro', 'titulo', 'Dra.', 'ativo', true,
              'procedimentos', jsonb_build_array(
                jsonb_build_object('id', 'teste-criar-proc', 'nome', 'Consulta / Avaliacao', 'ativo', true)))))
    returning id into clinica_b;

  insert into pacientes (clinica_id, telefone_normalizado, nome)
    values (clinica_a, '5511900000001', 'Teste Paciente A') returning id into paciente_a;
  insert into pacientes (clinica_id, telefone_normalizado, nome)
    values (clinica_a, '5511900000002', 'Teste Paciente A2') returning id into paciente_a2;
  insert into pacientes (clinica_id, telefone_normalizado, nome)
    values (clinica_b, '5511900000003', 'Teste Paciente B') returning id into paciente_b;

  -- `dados` ja carrega dentista_id e procedimento_id resolvidos pela
  -- interpretadora -- e contra eles que o conteudo recebido e conferido.
  insert into estado_conversa (clinica_id, paciente_id, telefone_normalizado, estado, dados,
                               contexto_horarios)
    values (clinica_a, paciente_a, '5511900000001', 'aguardando_confirmacao',
            jsonb_build_object('dentista_id', dentista_a::text,
                               'procedimento_id', 'teste-criar-proc'),
            jsonb_build_object('proposta_pendente',
              jsonb_build_object('data', to_char(data_alvo, 'YYYY-MM-DD'), 'horario', '10:00')))
    returning id into conversa_a;

  insert into estado_conversa (clinica_id, paciente_id, telefone_normalizado, estado, dados,
                               contexto_horarios)
    values (clinica_b, paciente_b, '5511900000003', 'aguardando_confirmacao',
            jsonb_build_object('dentista_id', dentista_b::text,
                               'procedimento_id', 'teste-criar-proc'),
            jsonb_build_object('proposta_pendente',
              jsonb_build_object('data', to_char(data_alvo, 'YYYY-MM-DD'), 'horario', '10:00')))
    returning id into conversa_b;

  raise notice 'OK caso0: migration real carregada (compilou) e fixtures criadas';

  -- ══ CASO 1: sem autorizacao nenhuma ══════════════════════════════════
  select atualizado_em into versao from estado_conversa where id = conversa_a;
  r := cappia_commit_turno_v2_criar(
         clinica_a, paciente_a, conversa_a, '5511900000001', versao, data_alvo, '10:00',
         dentista_a, 'teste-criar-proc', 'Teste Paciente A', '12345678901',
         '{"turno":"c1"}'::jsonb);
  if r ->> 'resultado' is distinct from 'recusado'
     or r ->> 'motivo' is distinct from 'confirmacao_ausente' then
    raise exception 'FALHA caso1: esperado recusado/confirmacao_ausente, veio %', r;
  end if;
  select count(*) into n from agendamentos where clinica_id = clinica_a;
  if n <> 0 then
    raise exception 'FALHA caso1: criou agendamento sem autorizacao (n=%)', n;
  end if;
  raise notice 'OK caso1: sem aguardando_resposta -> recusado, nenhum agendamento';

  -- ══ CASO 2: pergunta existe, mas nao e confirmacao ═══════════════════
  update estado_conversa
     set aguardando_resposta = jsonb_build_object('tipo', 'escolha_horario')
   where id = conversa_a;
  select atualizado_em into versao from estado_conversa where id = conversa_a;
  r := cappia_commit_turno_v2_criar(
         clinica_a, paciente_a, conversa_a, '5511900000001', versao, data_alvo, '10:00',
         dentista_a, 'teste-criar-proc', 'Teste Paciente A', '12345678901',
         '{"turno":"c2"}'::jsonb);
  if r ->> 'resultado' is distinct from 'recusado'
     or r ->> 'motivo' is distinct from 'pergunta_nao_e_confirmacao' then
    raise exception 'FALHA caso2: esperado recusado/pergunta_nao_e_confirmacao, veio %', r;
  end if;
  raise notice 'OK caso2: escolha_horario nao autoriza efeito -> recusado';

  -- ══ CASO 3 (discriminador): confirmacao de CANCELAR nao autoriza criar ═
  update estado_conversa
     set aguardando_resposta = jsonb_build_object(
           'tipo', 'confirmacao', 'operacao', 'cancelar',
           'agendamento_id', gen_random_uuid()::text)
   where id = conversa_a;
  select atualizado_em into versao from estado_conversa where id = conversa_a;
  r := cappia_commit_turno_v2_criar(
         clinica_a, paciente_a, conversa_a, '5511900000001', versao, data_alvo, '10:00',
         dentista_a, 'teste-criar-proc', 'Teste Paciente A', '12345678901',
         '{"turno":"c3"}'::jsonb);
  if r ->> 'resultado' is distinct from 'recusado'
     or r ->> 'motivo' is distinct from 'operacao_divergente' then
    raise exception 'FALHA caso3: esperado recusado/operacao_divergente, veio %', r;
  end if;
  raise notice 'OK caso3: confirmacao de cancelar NAO autoriza criar -> recusado';

  -- ══ CASO 4: agendamento_id PRESENTE e recusado ═══════════════════════
  update estado_conversa
     set aguardando_resposta = jsonb_build_object(
           'tipo', 'confirmacao', 'operacao', 'criar',
           'agendamento_id', gen_random_uuid()::text)
   where id = conversa_a;
  select atualizado_em into versao from estado_conversa where id = conversa_a;
  r := cappia_commit_turno_v2_criar(
         clinica_a, paciente_a, conversa_a, '5511900000001', versao, data_alvo, '10:00',
         dentista_a, 'teste-criar-proc', 'Teste Paciente A', '12345678901',
         '{"turno":"c4"}'::jsonb);
  if r ->> 'resultado' is distinct from 'recusado'
     or r ->> 'motivo' is distinct from 'alvo_indevido' then
    raise exception 'FALHA caso4: esperado recusado/alvo_indevido, veio %', r;
  end if;
  raise notice 'OK caso4: confirmacao de criar COM agendamento_id -> recusado';

  -- ══ CASO 4b: agendamento_id com valor JSON null TAMBEM e recusado ════
  -- A checagem e `? 'agendamento_id'` (presenca da CHAVE), nao `->>`. Com
  -- `->>` este caso passaria: chave-com-null e chave-ausente devolvem ambos
  -- SQL NULL. E o caso que separa as duas implementacoes.
  update estado_conversa
     set aguardando_resposta = jsonb_build_object('tipo', 'confirmacao', 'operacao', 'criar')
                               || '{"agendamento_id": null}'::jsonb
   where id = conversa_a;
  select atualizado_em into versao from estado_conversa where id = conversa_a;
  r := cappia_commit_turno_v2_criar(
         clinica_a, paciente_a, conversa_a, '5511900000001', versao, data_alvo, '10:00',
         dentista_a, 'teste-criar-proc', 'Teste Paciente A', '12345678901',
         '{"turno":"c4b"}'::jsonb);
  if r ->> 'resultado' is distinct from 'recusado'
     or r ->> 'motivo' is distinct from 'alvo_indevido' then
    raise exception 'FALHA caso4b: chave com JSON null deveria ser recusada, veio %', r;
  end if;
  raise notice 'OK caso4b: agendamento_id com valor JSON null -> recusado (presenca da chave)';

  -- ── AUTORIZACAO VALIDA a partir daqui ─────────────────────────────────
  update estado_conversa
     set aguardando_resposta = jsonb_build_object('tipo', 'confirmacao', 'operacao', 'criar')
   where id = conversa_a;

  -- ══ CASO 5: versao divergente ════════════════════════════════════════
  r := cappia_commit_turno_v2_criar(
         clinica_a, paciente_a, conversa_a, '5511900000001',
         timestamptz '1999-01-01 00:00:00+00', data_alvo, '10:00',
         dentista_a, 'teste-criar-proc', 'Teste Paciente A', '12345678901',
         '{"turno":"c5"}'::jsonb);
  if r ->> 'resultado' is distinct from 'turno_obsoleto'
     or r ->> 'motivo' is distinct from 'versao_divergente' then
    raise exception 'FALHA caso5: esperado turno_obsoleto/versao_divergente, veio %', r;
  end if;
  select count(*) into n from agendamentos where clinica_id = clinica_a;
  if n <> 0 then
    raise exception 'FALHA caso5: versao divergente criou agendamento (n=%)', n;
  end if;
  raise notice 'OK caso5: versao divergente -> turno_obsoleto, nenhum efeito';

  -- ══ CASO 6: horario divergente da proposta pendente ══════════════════
  select atualizado_em into versao from estado_conversa where id = conversa_a;
  r := cappia_commit_turno_v2_criar(
         clinica_a, paciente_a, conversa_a, '5511900000001', versao, data_alvo, '15:00',
         dentista_a, 'teste-criar-proc', 'Teste Paciente A', '12345678901',
         '{"turno":"c6"}'::jsonb);
  if r ->> 'resultado' is distinct from 'recusado'
     or r ->> 'motivo' is distinct from 'proposta_divergente' then
    raise exception 'FALHA caso6: esperado recusado/proposta_divergente, veio %', r;
  end if;
  raise notice 'OK caso6: horario diferente do proposto -> recusado';

  -- ══ CASO 7: dentista divergente de `dados` ═══════════════════════════
  r := cappia_commit_turno_v2_criar(
         clinica_a, paciente_a, conversa_a, '5511900000001', versao, data_alvo, '10:00',
         dentista_b, 'teste-criar-proc', 'Teste Paciente A', '12345678901',
         '{"turno":"c7"}'::jsonb);
  if r ->> 'resultado' is distinct from 'recusado'
     or r ->> 'motivo' is distinct from 'dentista_divergente' then
    raise exception 'FALHA caso7: esperado recusado/dentista_divergente, veio %', r;
  end if;
  raise notice 'OK caso7: dentista diferente do persistido -> recusado';

  -- ══ CASO 8: procedimento divergente de `dados` ═══════════════════════
  r := cappia_commit_turno_v2_criar(
         clinica_a, paciente_a, conversa_a, '5511900000001', versao, data_alvo, '10:00',
         dentista_a, 'outro-proc', 'Teste Paciente A', '12345678901',
         '{"turno":"c8"}'::jsonb);
  if r ->> 'resultado' is distinct from 'recusado'
     or r ->> 'motivo' is distinct from 'procedimento_divergente' then
    raise exception 'FALHA caso8: esperado recusado/procedimento_divergente, veio %', r;
  end if;
  raise notice 'OK caso8: procedimento diferente do persistido -> recusado';

  -- ══ CASO 9: conversa de outra clinica e inalcancavel ═════════════════
  select atualizado_em into versao from estado_conversa where id = conversa_b;
  r := cappia_commit_turno_v2_criar(
         clinica_a, paciente_a, conversa_b, '5511900000001', versao, data_alvo, '10:00',
         dentista_a, 'teste-criar-proc', 'Teste Paciente A', '12345678901',
         '{"turno":"c9"}'::jsonb);
  if r ->> 'resultado' is distinct from 'turno_obsoleto'
     or r ->> 'motivo' is distinct from 'conversa_nao_encontrada' then
    raise exception 'FALHA caso9: esperado turno_obsoleto/conversa_nao_encontrada, veio %', r;
  end if;
  raise notice 'OK caso9: conversa de outra clinica -> inalcancavel';

  -- ══ CASO 9b: paciente divergente da conversa (MESMA clinica) ═════════
  -- Espelha o caso 8b do cancelamento: sem `and paciente_id = p_paciente_id`
  -- no predicado do passo 1, este par seria aceito e o agendamento nasceria
  -- na ficha de OUTRO paciente, com a autorizacao gravada nesta conversa.
  select atualizado_em into versao from estado_conversa where id = conversa_a;
  r := cappia_commit_turno_v2_criar(
         clinica_a, paciente_a2, conversa_a, '5511900000001', versao, data_alvo, '10:00',
         dentista_a, 'teste-criar-proc', 'Teste Paciente A2', '12345678902',
         '{"turno":"c9b"}'::jsonb);
  if r ->> 'resultado' is distinct from 'turno_obsoleto'
     or r ->> 'motivo' is distinct from 'conversa_nao_encontrada' then
    raise exception 'FALHA caso9b: esperado turno_obsoleto/conversa_nao_encontrada, veio %', r;
  end if;
  select count(*) into n from agendamentos where paciente_id = paciente_a2;
  if n <> 0 then
    raise exception 'FALHA caso9b: criou agendamento para OUTRO paciente (n=%)', n;
  end if;
  raise notice 'OK caso9b: paciente divergente da conversa -> turno_obsoleto, nenhum efeito';

  -- ══ CASO 10: nome e documento sao obrigatorios (falha fechado) ═══════
  begin
    r := cappia_commit_turno_v2_criar(
           clinica_a, paciente_a, conversa_a, '5511900000001', versao, data_alvo, '10:00',
           dentista_a, 'teste-criar-proc', '   ', '12345678901', '{"turno":"c10a"}'::jsonb);
    raise exception 'FALHA caso10a: nome vazio nao falhou fechado (veio %)', r;
  exception when check_violation then
    raise notice 'OK caso10a: nome vazio -> check_violation';
  end;

  begin
    r := cappia_commit_turno_v2_criar(
           clinica_a, paciente_a, conversa_a, '5511900000001', versao, data_alvo, '10:00',
           dentista_a, 'teste-criar-proc', 'Teste Paciente A', null, '{"turno":"c10b"}'::jsonb);
    raise exception 'FALHA caso10b: documento nulo nao falhou fechado (veio %)', r;
  exception when check_violation then
    raise notice 'OK caso10b: documento nulo -> check_violation';
  end;

  begin
    r := cappia_commit_turno_v2_criar(
           clinica_a, paciente_a, conversa_a, '5511900000001', versao, data_alvo, '10:00',
           dentista_a, 'teste-criar-proc', 'Teste Paciente A', '12345678901', '[]'::jsonb);
    raise exception 'FALHA caso10c: p_dados array nao falhou fechado (veio %)', r;
  exception when check_violation then
    raise notice 'OK caso10c: p_dados array -> check_violation';
  end;

  -- ══ CASO 11: SUCESSO -- o lado certo do discriminador ════════════════
  select atualizado_em into versao from estado_conversa where id = conversa_a;
  r := cappia_commit_turno_v2_criar(
         clinica_a, paciente_a, conversa_a, '5511900000001', versao, data_alvo, '10:00',
         dentista_a, 'teste-criar-proc', 'Teste Paciente A', '12345678901',
         '{"turno":"c11"}'::jsonb);
  if r ->> 'resultado' is distinct from 'executado' then
    raise exception 'FALHA caso11: esperado executado, veio %', r;
  end if;
  select count(*) into n from agendamentos where clinica_id = clinica_a;
  if n <> 1 then
    raise exception 'FALHA caso11: esperado EXATAMENTE 1 agendamento, veio %', n;
  end if;
  raise notice 'OK caso11: autorizacao completa -> executado, exatamente 1 agendamento';

  -- ══ CASO 12: o agendamento nasceu COMPLETO ═══════════════════════════
  -- nome/documento do parametro; telefone normalizado; procedimento com o
  -- NOME DO CATALOGO (nao do chamador); dentista e duracao dos resolvedores.
  select a.nome, a.documento, a.telefone, a.procedimento, a.procedimento_id,
         a.dentista_id, a.dentista_nome, a.duracao_min, a.status, a.data, a.horario
    into fin
    from agendamentos a where a.clinica_id = clinica_a;

  if fin.nome is distinct from 'Teste Paciente A'
     or fin.documento is distinct from '12345678901' then
    raise exception 'FALHA caso12: nome/documento nao gravados (nome=%, doc=%)', fin.nome, fin.documento;
  end if;
  if fin.telefone is distinct from '5511900000001' then
    raise exception 'FALHA caso12: telefone normalizado nao gravado (%)', fin.telefone;
  end if;
  if fin.procedimento is distinct from 'Consulta / Avaliacao' then
    raise exception 'FALHA caso12: nome do procedimento nao veio do catalogo (%)', fin.procedimento;
  end if;
  if fin.dentista_id is distinct from dentista_a
     or fin.dentista_nome is distinct from 'Dr. Diego Ramoz' then
    raise exception 'FALHA caso12: dentista nao resolvido (id=%, nome=%)', fin.dentista_id, fin.dentista_nome;
  end if;
  if fin.duracao_min is distinct from 60 then
    raise exception 'FALHA caso12: duracao nao resolvida (%)', fin.duracao_min;
  end if;
  if fin.status is distinct from 'confirmado'
     or fin.data is distinct from data_alvo
     or fin.horario is distinct from '10:00' then
    raise exception 'FALHA caso12: status/data/horario incorretos';
  end if;
  raise notice 'OK caso12: agendamento completo (nome, documento, telefone, procedimento, dentista, duracao)';

  -- ══ CASO 13: estado final conforme a spec 14.4 ═══════════════════════
  select e.aguardando_resposta is null as ar_nulo,
         e.contexto_horarios is null as ch_nulo,
         e.dados ->> 'turno' as turno,
         (e.atualizado_em > versao) as avancou
    into fin
    from estado_conversa e where e.id = conversa_a;
  if not fin.ar_nulo then
    raise exception 'FALHA caso13: aguardando_resposta nao foi zerado';
  end if;
  if not fin.ch_nulo then
    raise exception 'FALHA caso13: contexto_horarios nao foi zerado';
  end if;
  if fin.turno is distinct from 'c11' then
    raise exception 'FALHA caso13: dados nao veio do parametro deste turno (%)', fin.turno;
  end if;
  if not fin.avancou then
    raise exception 'FALHA caso13: versao nao avancou';
  end if;
  raise notice 'OK caso13: aguardando_resposta e contexto_horarios NULL; dados do turno; versao avancou';

  -- ══ CASO 14: CONFLITO POR INTERVALO -- sobreposicao, nao igualdade ═══
  -- O agendamento do caso 11 ocupa 10:00-11:00. Uma nova proposta as 10:30
  -- para o MESMO dentista sobrepoe, e precisa ser RECUSADA (nao falha).
  --
  -- `dados` PRECISA ser restaurado junto: o caso 11 gravou
  -- `dados = {"turno":"c11"}` -- comportamento CORRETO da RPC, que grava o
  -- parametro do turno que concluiu --, e isso apagou dentista_id/
  -- procedimento_id. Sem recoloca-los, o passo 3 recusaria por
  -- `dentista_divergente` e este caso nunca chegaria a checagem de conflito.
  update estado_conversa
     set aguardando_resposta = jsonb_build_object('tipo', 'confirmacao', 'operacao', 'criar'),
         dados               = jsonb_build_object('dentista_id', dentista_a::text,
                                                  'procedimento_id', 'teste-criar-proc'),
         contexto_horarios   = jsonb_build_object('proposta_pendente',
           jsonb_build_object('data', to_char(data_alvo, 'YYYY-MM-DD'), 'horario', '10:30'))
   where id = conversa_a;
  select atualizado_em into versao from estado_conversa where id = conversa_a;
  r := cappia_commit_turno_v2_criar(
         clinica_a, paciente_a, conversa_a, '5511900000001', versao, data_alvo, '10:30',
         dentista_a, 'teste-criar-proc', 'Teste Paciente A', '12345678901',
         '{"turno":"c14"}'::jsonb);
  if r ->> 'resultado' is distinct from 'recusado'
     or r ->> 'motivo' is distinct from 'horario_ocupado' then
    raise exception 'FALHA caso14: esperado recusado/horario_ocupado, veio %', r;
  end if;
  select count(*) into n from agendamentos where clinica_id = clinica_a;
  if n <> 1 then
    raise exception 'FALHA caso14: conflito criou agendamento (n=%)', n;
  end if;
  raise notice 'OK caso14: 10:30 sobre 10:00-11:00 -> horario_ocupado (sobreposicao, nao igualdade)';

  -- ══ CASO 15 (CONTROLE do 14): mesma clinica, mesmo horario, OUTRO
  --    dentista -- nao conflita ═══════════════════════════════════════
  -- Par de controle do caso 14, variando UMA SO coisa: o dentista. Mesma
  -- clinica (clinica_a), mesmo dia, e o horario EXATO ja ocupado por
  -- dentista_a (10:00). Se este caso usasse outra clinica, duas variaveis
  -- mudariam ao mesmo tempo e o resultado nao provaria por qual delas o
  -- conflito e isolado -- poderia ser por clinica, nao por dentista.
  --
  -- O advisory lock e a chave de conflito sao (clinica, dentista, dia): com
  -- a clinica constante, so o dentista explica a diferenca entre 14 e 15.
  --
  -- Usa paciente_a2, que ja existe na clinica_a e ainda nao tem conversa.
  insert into estado_conversa (clinica_id, paciente_id, telefone_normalizado, estado, dados,
                               contexto_horarios, aguardando_resposta)
    values (clinica_a, paciente_a2, '5511900000002', 'aguardando_confirmacao',
            jsonb_build_object('dentista_id', dentista_a2::text,
                               'procedimento_id', 'teste-criar-proc'),
            jsonb_build_object('proposta_pendente',
              jsonb_build_object('data', to_char(data_alvo, 'YYYY-MM-DD'), 'horario', '10:00')),
            jsonb_build_object('tipo', 'confirmacao', 'operacao', 'criar'))
    returning id into conversa_a2;

  -- Pre-condicao explicita: o horario 10:00 deste dia ESTA ocupado -- mas
  -- por dentista_a. Sem isso o caso passaria por vacuidade.
  select count(*) into n
    from agendamentos
   where clinica_id = clinica_a and dentista_id = dentista_a
     and data = data_alvo and horario = '10:00' and status = 'confirmado';
  if n <> 1 then
    raise exception 'FALHA caso15: pre-condicao violada -- 10:00 deveria estar ocupado por dentista_a (n=%)', n;
  end if;

  select atualizado_em into versao from estado_conversa where id = conversa_a2;
  r := cappia_commit_turno_v2_criar(
         clinica_a, paciente_a2, conversa_a2, '5511900000002', versao, data_alvo, '10:00',
         dentista_a2, 'teste-criar-proc', 'Teste Paciente A2', '12345678902',
         '{"turno":"c15"}'::jsonb);
  if r ->> 'resultado' is distinct from 'executado' then
    raise exception 'FALHA caso15: mesma clinica/horario com OUTRO dentista deveria criar, veio %', r;
  end if;

  -- O par 14/15 so prova o isolamento se os DOIS agendamentos coexistirem no
  -- mesmo horario e mesma clinica, um por dentista.
  select count(*) into n
    from agendamentos
   where clinica_id = clinica_a and data = data_alvo and horario = '10:00'
     and status = 'confirmado';
  if n <> 2 then
    raise exception 'FALHA caso15: esperados 2 agendamentos as 10:00 na mesma clinica (um por dentista), veio %', n;
  end if;
  raise notice 'OK caso15: mesma clinica e horario, outro dentista -> executado; 2 agendamentos coexistem (conflito e por DENTISTA)';

  raise notice '=== TODOS OS CASOS PASSARAM ===';
end;
$teste$;
