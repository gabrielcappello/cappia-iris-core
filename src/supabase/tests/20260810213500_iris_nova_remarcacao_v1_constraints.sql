-- Testes de 20260810213500_iris_nova_remarcacao_v1.sql
-- (cappia_remarcar_agendamento_v2).
--
-- NAO EXECUTADO nesta rodada: nenhuma migration foi aplicada em banco real
-- ou dev. Este arquivo fica versionado para revisao estatica e para execucao
-- futura, quando a migration for aplicada -- mesmo padrao de
-- 20260809120000_iris_nova_persistencia_paciente_v1_constraints.sql: cria
-- dados sinteticos, remove tudo ao final, usa somente dados de teste (nunca
-- dados reais ou de outra clinica).
--
-- Projeto-alvo: bcmuqautblvjdqzhjfbw (dev). O corpo da funcao e IDENTICO no
-- operacional (ver bloco PARIDADE das duas migrations), mas este script cria
-- e apaga linhas -- rodar em banco com WhatsApp ativo exigiria autorizacao
-- explicita e separada.
--
-- Base normativa: specs/remarcacao-operacional-v1.md secao 7, testes 11 a 20.
--
-- CONCORRENCIA (teste 18 da spec): este script roda em UMA UNICA SESSAO (um
-- unico bloco `do $$ ... $$`, uma unica transacao). Ele NAO prova exclusao
-- mutua entre sessoes simultaneas -- `SELECT ... FOR UPDATE` so bloqueia
-- entre transacoes diferentes, e dentro de uma unica transacao nunca ha
-- espera. O que este script prova e a metade VERIFICAVEL em sessao unica: o
-- caminho de replay (teste 17) e o backstop do indice unico parcial, que sao
-- exatamente o que uma execucao concorrente perdedora encontraria ao ser
-- liberada. A serializacao real decorre do FOR UPDATE e do indice unico --
-- garantias do proprio PostgreSQL, nao testadas a nivel de script de sessao
-- unica. Declarado aqui para que o verde NUNCA seja lido como prova de
-- concorrencia real (docs/00-principios.md, principio do teste isolado).
--
-- LIMPEZA: em caso de falha, o `raise exception` do rodape desfaz a
-- transacao inteira e nada fica no banco. Em caso de sucesso, a limpeza
-- explicita no fim do bloco remove os dados sinteticos.
--
-- Cobertura:
--   11. agendamento de OUTRA CLINICA        -> agendamento_nao_encontrado
--   12. agendamento de OUTRO PACIENTE       -> agendamento_nao_encontrado
--   13. status 'cancelado'                  -> nao_confirmado
--   14. horario novo ocupado por TERCEIRO   -> horario_ocupado, zero escrita
--   15. horario novo IGUAL ao proprio       -> sucesso (contrato da RPC)
--   16. sucesso normal                      -> antigo remarcado, novo
--                                              confirmado, remarcado_de
--                                              preenchido, cadastrais copiados
--   17. segunda chamada identica            -> ja_remarcado, MESMO sucessor
--   19. 'remarcado' SEM sucessora           -> nao_confirmado
--   20. duracao <= 0                        -> duracao_invalida
--       horario '24:00'                     -> horario_invalido
--       data nula                           -> data_invalida
--   21. invariantes do Core (id nulo)       -> EXCECAO, nunca motivo
--   22. nome/documento/telefone copiados da linha antiga
--   23. dentista_nome NAO copiado quando o dentista muda

do $$
declare
  v_clinica_a   uuid := gen_random_uuid();
  v_clinica_b   uuid := gen_random_uuid();
  v_paciente_a  uuid := gen_random_uuid();
  v_paciente_b  uuid := gen_random_uuid();
  v_dentista    uuid := gen_random_uuid();
  v_dentista_2  uuid := gen_random_uuid();
  v_proc        text := 'teste_remarcacao_proc';

  v_ag          uuid;
  v_ag_outro    uuid;
  v_terceiro    uuid;
  v_novo        uuid;
  v_r           jsonb;
  v_r2          jsonb;
  v_status      text;
  v_conta       int;
  v_txt         text;
begin
  -- ── CENARIO ────────────────────────────────────────────────────────────
  insert into clinicas (id, provider, instancia_whatsapp, dentistas, fuso_horario)
  values
    (v_clinica_a, 'teste_remarcacao', 'inst_teste_remarcacao_a',
      jsonb_build_array(
        jsonb_build_object('id', v_dentista,   'nome', 'Ana',  'titulo', 'Dra.', 'ativo', true,
                           'modo', 'auto', 'dur', 60, 'inicio', '08:00', 'fim', '18:00'),
        jsonb_build_object('id', v_dentista_2, 'nome', 'Bruno','titulo', 'Dr.',  'ativo', true,
                           'modo', 'auto', 'dur', 60, 'inicio', '08:00', 'fim', '18:00')),
      'America/Sao_Paulo'),
    (v_clinica_b, 'teste_remarcacao', 'inst_teste_remarcacao_b', '[]'::jsonb, 'America/Sao_Paulo');

  insert into procedimentos_catalogo (id, tempo_padrao, ativo, nome_pt, nome_es, nome_en, nome_fr, nome_de, nome_it, nome_ru, nome_ar)
  values (v_proc, 60, true, 'Teste', 'Teste', 'Test', 'Test', 'Test', 'Test', 'Test', 'Test');

  insert into pacientes (id, clinica_id, telefone_normalizado, nome)
  values (v_paciente_a, v_clinica_a, '5511900000001', 'Paciente A'),
         (v_paciente_b, v_clinica_a, '5511900000002', 'Paciente B');

  -- Agendamento base do paciente A (com dados cadastrais para provar copia).
  insert into agendamentos (clinica_id, paciente_id, data, horario, nome, documento,
                            telefone, procedimento, procedimento_id, status,
                            dentista_nome, dentista_id, duracao_min, tipo_documento)
  values (v_clinica_a, v_paciente_a, current_date + 10, '14:00', 'Paciente A', '11122233344',
          '5511900000001', 'Teste', v_proc, 'confirmado',
          'Dra. Ana', v_dentista, 60, 'cpf')
  returning id into v_ag;

  -- ── 11. OUTRA CLINICA ──────────────────────────────────────────────────
  v_r := public.cappia_remarcar_agendamento_v2(
    v_clinica_b, v_paciente_a, v_ag, v_dentista, v_proc, 60, current_date + 11, '10:00');
  if v_r->>'motivo' is distinct from 'agendamento_nao_encontrado' then
    raise exception 'T11 falhou: %', v_r;
  end if;

  -- ── 12. OUTRO PACIENTE ─────────────────────────────────────────────────
  v_r := public.cappia_remarcar_agendamento_v2(
    v_clinica_a, v_paciente_b, v_ag, v_dentista, v_proc, 60, current_date + 11, '10:00');
  if v_r->>'motivo' is distinct from 'agendamento_nao_encontrado' then
    raise exception 'T12 falhou: %', v_r;
  end if;

  -- ── 20. VALIDACAO DE FORMA ─────────────────────────────────────────────
  v_r := public.cappia_remarcar_agendamento_v2(
    v_clinica_a, v_paciente_a, v_ag, v_dentista, v_proc, 0, current_date + 11, '10:00');
  if v_r->>'motivo' is distinct from 'duracao_invalida' then
    raise exception 'T20a falhou: %', v_r;
  end if;

  v_r := public.cappia_remarcar_agendamento_v2(
    v_clinica_a, v_paciente_a, v_ag, v_dentista, v_proc, 60, current_date + 11, '24:00');
  if v_r->>'motivo' is distinct from 'horario_invalido' then
    raise exception 'T20b falhou (24:00 nunca vira 00:00 do dia seguinte): %', v_r;
  end if;

  v_r := public.cappia_remarcar_agendamento_v2(
    v_clinica_a, v_paciente_a, v_ag, v_dentista, v_proc, 60, null, '10:00');
  if v_r->>'motivo' is distinct from 'data_invalida' then
    raise exception 'T20c falhou: %', v_r;
  end if;

  -- ── 21. INVARIANTES DO CORE: EXCECAO, nunca motivo conversacional ──────
  begin
    v_r := public.cappia_remarcar_agendamento_v2(
      v_clinica_a, v_paciente_a, v_ag, null, v_proc, 60, current_date + 11, '10:00');
    raise exception 'T21 falhou: dentista_id nulo deveria levantar excecao, devolveu %', v_r;
  exception
    when check_violation then null; -- esperado
  end;

  -- ── 14. HORARIO OCUPADO POR TERCEIRO ───────────────────────────────────
  insert into agendamentos (clinica_id, paciente_id, data, horario, procedimento_id,
                            status, dentista_id, duracao_min)
  values (v_clinica_a, v_paciente_b, current_date + 11, '10:00', v_proc,
          'confirmado', v_dentista, 60)
  returning id into v_terceiro;

  v_r := public.cappia_remarcar_agendamento_v2(
    v_clinica_a, v_paciente_a, v_ag, v_dentista, v_proc, 60, current_date + 11, '10:00');
  if v_r->>'motivo' is distinct from 'horario_ocupado' then
    raise exception 'T14 falhou: %', v_r;
  end if;

  -- ZERO ESCRITA: o antigo continua confirmado e nenhuma linha nova nasceu.
  select status into v_status from agendamentos where id = v_ag;
  if v_status is distinct from 'confirmado' then
    raise exception 'T14 falhou: antigo mudou de status apos conflito (%)', v_status;
  end if;
  select count(*) into v_conta from agendamentos where remarcado_de = v_ag;
  if v_conta <> 0 then
    raise exception 'T14 falhou: linha nova criada apesar do conflito';
  end if;

  -- ── 15. HORARIO IGUAL AO PROPRIO -> SUCESSO ────────────────────────────
  -- Prova a guarda `a.id <> p_agendamento_id`: sem ela o agendamento
  -- conflitaria consigo mesmo. NAO E ALCANCAVEL PELO FLUXO na v1 (a
  -- disponibilidade nunca oferece horario que sobreponha o proprio
  -- agendamento -- spec secao 10.1). Teste de CONTRATO DA RPC, nunca prova
  -- de comportamento de producao.
  v_r := public.cappia_remarcar_agendamento_v2(
    v_clinica_a, v_paciente_a, v_ag, v_dentista, v_proc, 60, current_date + 10, '14:00');
  if (v_r->>'sucesso')::boolean is not true then
    raise exception 'T15 falhou (agendamento conflitou consigo mesmo): %', v_r;
  end if;
  v_novo := (v_r->>'agendamento_id')::uuid;

  -- ── 16 + 22. EFEITOS DA TROCA ──────────────────────────────────────────
  select status into v_status from agendamentos where id = v_ag;
  if v_status is distinct from 'remarcado' then
    raise exception 'T16 falhou: antigo nao virou remarcado (%)', v_status;
  end if;

  select status into v_status from agendamentos where id = v_novo;
  if v_status is distinct from 'confirmado' then
    raise exception 'T16 falhou: novo nao nasceu confirmado (%)', v_status;
  end if;

  select remarcado_de into v_txt from agendamentos where id = v_novo;
  if v_txt is distinct from v_ag::text then
    raise exception 'T16 falhou: vinculo remarcado_de ausente ou errado (%)', v_txt;
  end if;

  -- Cadastrais copiados da linha antiga.
  select nome || '|' || documento || '|' || telefone || '|' || tipo_documento
    into v_txt from agendamentos where id = v_novo;
  if v_txt is distinct from 'Paciente A|11122233344|5511900000001|cpf' then
    raise exception 'T22 falhou: cadastrais nao copiados (%)', v_txt;
  end if;

  -- Mesmo dentista => dentista_nome copiado.
  select dentista_nome into v_txt from agendamentos where id = v_novo;
  if v_txt is distinct from 'Dra. Ana' then
    raise exception 'T22 falhou: dentista_nome nao copiado (%)', v_txt;
  end if;

  -- ── 17. REPLAY: segunda chamada identica ───────────────────────────────
  v_r2 := public.cappia_remarcar_agendamento_v2(
    v_clinica_a, v_paciente_a, v_ag, v_dentista, v_proc, 60, current_date + 10, '14:00');
  if (v_r2->>'sucesso')::boolean is not true then
    raise exception 'T17 falhou: replay devolveu erro em vez de sucesso: %', v_r2;
  end if;
  if (v_r2->>'ja_remarcado')::boolean is not true then
    raise exception 'T17 falhou: replay sem marcador ja_remarcado: %', v_r2;
  end if;
  if (v_r2->>'agendamento_id')::uuid <> v_novo then
    raise exception 'T17 falhou: replay devolveu OUTRO sucessor (% vs %)',
      v_r2->>'agendamento_id', v_novo;
  end if;
  -- Nenhuma linha nova nasceu na segunda chamada.
  select count(*) into v_conta from agendamentos where remarcado_de = v_ag;
  if v_conta <> 1 then
    raise exception 'T17 falhou: replay criou linha nova (% sucessoras)', v_conta;
  end if;

  -- ── 23. DENTISTA DIFERENTE -> dentista_nome NAO copiado ────────────────
  v_r := public.cappia_remarcar_agendamento_v2(
    v_clinica_a, v_paciente_a, v_novo, v_dentista_2, v_proc, 60, current_date + 12, '09:00');
  if (v_r->>'sucesso')::boolean is not true then
    raise exception 'T23 falhou: %', v_r;
  end if;
  select dentista_nome into v_txt from agendamentos where id = (v_r->>'agendamento_id')::uuid;
  if v_txt is not null then
    raise exception 'T23 falhou: dentista_nome da linha antiga copiado para outro dentista (%)', v_txt;
  end if;

  -- ── 13. STATUS 'cancelado' -> nao_confirmado ───────────────────────────
  insert into agendamentos (clinica_id, paciente_id, data, horario, procedimento_id,
                            status, dentista_id, duracao_min)
  values (v_clinica_a, v_paciente_a, current_date + 20, '10:00', v_proc,
          'cancelado', v_dentista, 60)
  returning id into v_ag_outro;

  v_r := public.cappia_remarcar_agendamento_v2(
    v_clinica_a, v_paciente_a, v_ag_outro, v_dentista, v_proc, 60, current_date + 21, '10:00');
  if v_r->>'motivo' is distinct from 'nao_confirmado' then
    raise exception 'T13 falhou: %', v_r;
  end if;

  -- ── 19. 'remarcado' SEM sucessora -> nao_confirmado ────────────────────
  -- Estado so alcancavel por intervencao manual; nunca remarca de novo sobre
  -- estado inconsistente.
  update agendamentos set status = 'remarcado' where id = v_ag_outro;
  v_r := public.cappia_remarcar_agendamento_v2(
    v_clinica_a, v_paciente_a, v_ag_outro, v_dentista, v_proc, 60, current_date + 21, '10:00');
  if v_r->>'motivo' is distinct from 'nao_confirmado' then
    raise exception 'T19 falhou: %', v_r;
  end if;

  -- ── LIMPEZA ────────────────────────────────────────────────────────────
  -- Ordem importa: remarcado_de tem FK para a propria tabela.
  delete from agendamentos where clinica_id in (v_clinica_a, v_clinica_b);
  delete from pacientes   where clinica_id in (v_clinica_a, v_clinica_b);
  delete from clinicas    where id in (v_clinica_a, v_clinica_b);
  delete from procedimentos_catalogo where id = v_proc;

  raise notice 'TODOS OS TESTES DE cappia_remarcar_agendamento_v2 PASSARAM';
end;
$$;
