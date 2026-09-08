-- Testes da RPC cappia_persistir_paciente de 9 params (coluna-fonte).
--
-- Cobre a correcao 20260908180000_iris_nova_persistir_paciente_9p_coluna_fonte.sql
-- + o schema resultante das FASES A e C
-- (20260907120000_..._fase_a.sql / 20260907130000_..._fase_c.sql).
--
-- EXECUTAR contra um BRANCH DESCARTAVEL do Supabase de dev, apos aplicar
-- FASE A + FASE C + esta correcao. Toda a bateria roda dentro de uma unica
-- transacao que termina em ROLLBACK -- nada e persistido. Usa somente dados
-- sinteticos (clinica de teste criada aqui, telefones no prefixo sintetico
-- 5599000009xxx).
--
-- Cobertura (pedido da revisao do Codex):
--   1. criar paciente com "numero proprio": INSERT via 9 params num contato
--      novo; grava a coluna FONTE `telefone`, NAO a gerada `telefone_normalizado`;
--   2. criar dependente usando o MESMO numero do titular: 2o INSERT no MESMO
--      contato, vinculo='dependente'. (Ver NOTA sobre o indice legado.)
--   3. atualizar paciente existente: UPDATE por (paciente_id, contato_id);
--   4. rejeitar paciente/contato incompativel: paciente_id de um contato,
--      p_contato_id de outro -> motivo 'paciente_nao_encontrado';
--   5. proteção contra CPF duplicado: 2o paciente com o mesmo documento na
--      mesma clinica -> motivo 'cpf_ja_cadastrado'.
--
-- NOTA (cenario 2 x indice legado): apos a FASE C, o indice UNIQUE bare
-- `pacientes_clinica_telefone_unique` sobre (clinica_id, telefone) AINDA
-- EXISTE (a FASE C so removeu constraints, nao indices bare). Enquanto ele
-- existir, o 2o INSERT do cenario 2 viola a unicidade (clinica_id, telefone)
-- e a RPC re-lanca unique_violation como erro tecnico. O cenario 2 abaixo
-- assere os DOIS estados possiveis e falha com mensagem clara se nenhum
-- casar -- a decisao de remover o indice + tratar cappia_confirmar_acao_
-- pendente e da revisao do Codex (ver o rodape da migration corretiva).

begin;

do $$
declare
  v_clinica        uuid;
  v_contato_carlos uuid;
  v_contato_marta  uuid;
  v_res            jsonb;
  v_carlos_id      uuid;
  v_marta_id       uuid;
  v_dep_id         uuid;
  v_tel_gerado     text;
  v_tel_fonte      text;
  v_indice_legado_existe boolean;
begin
  -- clinica sintetica
  insert into public.clinicas (provider, instancia_whatsapp)
  values ('evolution', 'teste-9p-coluna-fonte') returning id into v_clinica;

  -- contato do Carlos (numero proprio) -- criado explicitamente, como o Core faz
  insert into public.contatos_whatsapp (clinica_id, telefone_normalizado)
  values (v_clinica, '5599000009111') returning id into v_contato_carlos;

  -- ── CENARIO 1: criar paciente com numero proprio (INSERT via 9 params) ──
  v_res := public.cappia_persistir_paciente(
    v_clinica, v_contato_carlos, '5599000009111', 'Carlos Teste 9p',
    'titular', null, '52998224725', '1980-03-03'::date, null
  );
  if coalesce((v_res->>'sucesso')::boolean, false) is not true then
    raise exception 'FALHA cenario1: INSERT titular retornou %', v_res;
  end if;
  v_carlos_id := (v_res->>'paciente_id')::uuid;

  select telefone, telefone_normalizado into v_tel_fonte, v_tel_gerado
  from public.pacientes where id = v_carlos_id;
  if v_tel_fonte <> '99000009111' then
    raise exception 'FALHA cenario1: coluna FONTE telefone deveria ser 99000009111, veio %', v_tel_fonte;
  end if;
  if v_tel_gerado <> '5599000009111' then
    raise exception 'FALHA cenario1: coluna GERADA telefone_normalizado deveria ser 5599000009111, veio %', v_tel_gerado;
  end if;
  if (select contato_id from public.pacientes where id = v_carlos_id) <> v_contato_carlos then
    raise exception 'FALHA cenario1: contato_id nao gravado corretamente';
  end if;
  if (select vinculo from public.pacientes where id = v_carlos_id) <> 'titular' then
    raise exception 'FALHA cenario1: vinculo deveria ser titular';
  end if;
  raise notice 'OK cenario1: paciente criado via 9 params na coluna FONTE (telefone=%, gerado=%)', v_tel_fonte, v_tel_gerado;

  -- ── CENARIO 2: criar dependente com o MESMO numero do titular ──────────
  select exists(
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'pacientes_clinica_telefone_unique' and c.relkind = 'i'
  ) into v_indice_legado_existe;

  begin
    v_res := public.cappia_persistir_paciente(
      v_clinica, v_contato_carlos, '5599000009111', 'Marta Teste 9p',
      'dependente', null, '11144477735', '1950-07-07'::date, null
    );
    -- chegou aqui SEM excecao: so e valido se o indice legado ja tiver sido removido
    if v_indice_legado_existe then
      raise exception 'FALHA cenario2: INSERT do dependente passou, mas o indice pacientes_clinica_telefone_unique ainda existe -- inesperado';
    end if;
    if coalesce((v_res->>'sucesso')::boolean, false) is not true then
      raise exception 'FALHA cenario2: INSERT dependente retornou %', v_res;
    end if;
    v_dep_id := (v_res->>'paciente_id')::uuid;
    if (select vinculo from public.pacientes where id = v_dep_id) <> 'dependente' then
      raise exception 'FALHA cenario2: vinculo deveria ser dependente';
    end if;
    if (select contato_id from public.pacientes where id = v_dep_id) <> v_contato_carlos then
      raise exception 'FALHA cenario2: dependente deveria ter o MESMO contato_id do titular';
    end if;
    raise notice 'OK cenario2: dependente criado no mesmo contato/telefone do titular (indice legado ja removido)';
  exception when unique_violation then
    if not v_indice_legado_existe then
      raise exception 'FALHA cenario2: unique_violation mas o indice legado NAO existe -- outra unicidade barrou';
    end if;
    raise notice 'ESPERADO cenario2 (estado atual): unique_violation por pacientes_clinica_telefone_unique -- a feature dependente-no-mesmo-numero so funciona apos a decisao sobre esse indice (ver migration corretiva, rodape)';
  end;

  -- ── CENARIO 3: atualizar paciente existente (UPDATE por (id, contato_id)) ──
  v_res := public.cappia_persistir_paciente(
    v_clinica, v_contato_carlos, '5599000009111', 'Carlos Teste 9p Atualizado',
    'titular', v_carlos_id, '52998224725', '1980-03-03'::date, 'carlos9p@exemplo.test'
  );
  if coalesce((v_res->>'sucesso')::boolean, false) is not true then
    raise exception 'FALHA cenario3: UPDATE retornou %', v_res;
  end if;
  if (v_res->>'paciente_id')::uuid <> v_carlos_id then
    raise exception 'FALHA cenario3: UPDATE deveria devolver o mesmo paciente_id';
  end if;
  if (select nome from public.pacientes where id = v_carlos_id) <> 'Carlos Teste 9p Atualizado' then
    raise exception 'FALHA cenario3: nome nao atualizado';
  end if;
  if (select email from public.pacientes where id = v_carlos_id) <> 'carlos9p@exemplo.test' then
    raise exception 'FALHA cenario3: email nao atualizado';
  end if;
  -- telefone NAO e tocado no UPDATE
  if (select telefone from public.pacientes where id = v_carlos_id) <> '99000009111' then
    raise exception 'FALHA cenario3: UPDATE nao pode mexer no telefone';
  end if;
  raise notice 'OK cenario3: UPDATE por (paciente_id, contato_id) atualizou nome/email, telefone intacto';

  -- ── CENARIO 4: rejeitar paciente/contato incompativel ─────────────────
  -- contato da Marta (outro telefone), sem paciente ligado a ele
  insert into public.contatos_whatsapp (clinica_id, telefone_normalizado)
  values (v_clinica, '5599000009222') returning id into v_contato_marta;

  v_res := public.cappia_persistir_paciente(
    v_clinica, v_contato_marta, '5599000009222', 'Carlos via contato errado',
    'titular', v_carlos_id, null, null, null   -- paciente_id do Carlos, mas contato da Marta
  );
  if v_res->>'motivo' <> 'paciente_nao_encontrado' then
    raise exception 'FALHA cenario4: esperado motivo paciente_nao_encontrado, veio %', v_res;
  end if;
  -- e a ficha do Carlos nao foi tocada
  if (select nome from public.pacientes where id = v_carlos_id) <> 'Carlos Teste 9p Atualizado' then
    raise exception 'FALHA cenario4: UPDATE com contato errado nao pode ter alterado a ficha';
  end if;
  raise notice 'OK cenario4: paciente_id de um contato + p_contato_id de outro -> paciente_nao_encontrado, ficha intacta';

  -- ── CENARIO 5: proteção contra CPF duplicado ─────────────────────────
  -- Carlos tem documento 52998224725. Um novo paciente no contato da Marta
  -- com o MESMO documento na MESMA clinica deve bater na UNIQUE
  -- pacientes_clinica_id_documento_key -> motivo cpf_ja_cadastrado.
  v_res := public.cappia_persistir_paciente(
    v_clinica, v_contato_marta, '5599000009222', 'Marta com CPF do Carlos',
    'titular', null, '52998224725', null, null
  );
  if v_res->>'motivo' <> 'cpf_ja_cadastrado' then
    raise exception 'FALHA cenario5: esperado motivo cpf_ja_cadastrado, veio %', v_res;
  end if;
  raise notice 'OK cenario5: CPF duplicado na mesma clinica -> cpf_ja_cadastrado (protecao preservada)';

  raise notice '=== TODOS OS CENARIOS EXECUTADOS (cenario2 conforme estado do indice legado) ===';
end $$;

-- Nada persiste: a bateria inteira e desfeita.
rollback;
