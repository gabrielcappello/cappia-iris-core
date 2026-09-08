-- Teste de ACEITE da RPC cappia_persistir_paciente de 9 params (coluna-fonte).
--
-- Cobre a correcao 20260908180000_iris_nova_persistir_paciente_9p_coluna_fonte.sql
-- + o schema resultante das FASES A e C
-- (20260907120000_..._fase_a.sql / 20260907130000_..._fase_c.sql).
--
-- EXECUTAR contra um BRANCH DESCARTAVEL do Supabase de dev, apos aplicar
-- FASE A + FASE C + esta correcao. Toda a bateria roda dentro de UMA
-- transacao que termina em ROLLBACK -- nada e persistido. Usa somente dados
-- sinteticos (clinica de teste criada aqui, telefones no prefixo sintetico
-- 5599000009xxx).
--
-- ── PRE-CONDICAO: estado-alvo APROVADO, nao estado atual ─────────────────
-- A feature "dependente / outra pessoa no mesmo numero" so funciona sem o
-- indice UNIQUE bare `pacientes_clinica_telefone_unique` sobre
-- (clinica_id, telefone) -- que a FASE C nao removeu (so removia
-- constraints) e cuja remocao em producao depende da decisao sobre
-- `cappia_confirmar_acao_pendente` (ver handoff, secao "8ª rodada", dois
-- caminhos). Este TESTE DE ACEITE exercita o estado-alvo: dropa o indice no
-- inicio da transacao (revertido pelo ROLLBACK final -- nada persiste) e
-- entao EXIGE titular E dependente criados com sucesso no mesmo
-- contato/telefone. unique_violation NAO e resultado aceito em nenhum
-- cenario: se qualquer cenario falhar, a bateria aborta com mensagem clara.
--
-- Cobertura (pedido da revisao do Codex):
--   1. criar paciente com "numero proprio": INSERT via 9 params num contato
--      novo; grava a coluna FONTE `telefone`, NAO a gerada `telefone_normalizado`;
--   2. criar dependente usando o MESMO numero do titular: 2o INSERT no MESMO
--      contato, vinculo='dependente' -- EXIGE sucesso;
--   3. atualizar paciente existente: UPDATE por (paciente_id, contato_id);
--   4. rejeitar paciente/contato incompativel: paciente_id de um contato,
--      p_contato_id de outro -> motivo 'paciente_nao_encontrado';
--   5. proteção contra CPF duplicado: 2o paciente com o mesmo documento na
--      mesma clinica -> motivo 'cpf_ja_cadastrado'.

begin;

-- ── PRE-CONDICAO do estado-alvo: sem o indice legado de telefone ─────────
-- (revertido pelo ROLLBACK final -- este teste NUNCA altera o schema
-- persistido). Confirma que ele existe antes de dropar; se ja nao existir
-- num futuro branch, apenas segue.
do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'pacientes_clinica_telefone_unique' and c.relkind = 'i'
  ) then
    execute 'drop index public.pacientes_clinica_telefone_unique';
    raise notice 'pre-condicao: indice pacientes_clinica_telefone_unique removido (so nesta transacao)';
  else
    raise notice 'pre-condicao: indice pacientes_clinica_telefone_unique ja nao existia';
  end if;
end $$;

do $$
declare
  v_clinica        uuid;
  v_contato_carlos uuid;
  v_contato_marta  uuid;
  v_res            jsonb;
  v_carlos_id      uuid;
  v_dep_id         uuid;
  v_tel_gerado     text;
  v_tel_fonte      text;
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

  -- ── CENARIO 2: criar dependente com o MESMO numero do titular (EXIGE sucesso) ──
  v_res := public.cappia_persistir_paciente(
    v_clinica, v_contato_carlos, '5599000009111', 'Marta Teste 9p',
    'dependente', null, '11144477735', '1950-07-07'::date, null
  );
  if coalesce((v_res->>'sucesso')::boolean, false) is not true then
    raise exception 'FALHA cenario2: INSERT do dependente NAO teve sucesso -- retornou %', v_res;
  end if;
  v_dep_id := (v_res->>'paciente_id')::uuid;
  if v_dep_id = v_carlos_id then
    raise exception 'FALHA cenario2: dependente reaproveitou o id do titular (deveria ser paciente novo)';
  end if;
  if (select vinculo from public.pacientes where id = v_dep_id) <> 'dependente' then
    raise exception 'FALHA cenario2: vinculo do dependente deveria ser dependente';
  end if;
  if (select contato_id from public.pacientes where id = v_dep_id) <> v_contato_carlos then
    raise exception 'FALHA cenario2: dependente deveria ter o MESMO contato_id do titular';
  end if;
  if (select telefone from public.pacientes where id = v_dep_id) <> '99000009111' then
    raise exception 'FALHA cenario2: dependente deveria ter o MESMO telefone (coluna-fonte) do titular';
  end if;
  -- os dois coexistem, mesmo contato, mesmo telefone
  if (select count(*) from public.pacientes where contato_id = v_contato_carlos) <> 2 then
    raise exception 'FALHA cenario2: o contato deveria ter EXATAMENTE 2 pacientes (titular + dependente)';
  end if;
  raise notice 'OK cenario2: titular E dependente criados no mesmo contato/telefone (ids % e %)', v_carlos_id, v_dep_id;

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
  -- e o dependente nao foi afetado pelo UPDATE do titular
  if (select nome from public.pacientes where id = v_dep_id) <> 'Marta Teste 9p' then
    raise exception 'FALHA cenario3: UPDATE do titular nao pode ter mexido no dependente';
  end if;
  raise notice 'OK cenario3: UPDATE por (paciente_id, contato_id) atualizou nome/email do titular; telefone e dependente intactos';

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

  raise notice '=== TODOS OS 5 CENARIOS PASSARAM ===';
end $$;

-- Nada persiste: a bateria inteira (inclusive o DROP INDEX da pre-condicao)
-- e desfeita.
rollback;
