-- Testes de 20260809120000_iris_nova_persistencia_paciente_v1.sql
--
-- NAO EXECUTADO nesta rodada: nenhuma migration foi aplicada em banco real
-- ou dev. Este arquivo fica versionado para revisao estatica e para execucao
-- futura, quando a migration for aplicada, seguindo o mesmo padrao de
-- 20260730_iris_nova_interpretacao_v1_constraints.sql: cria dados
-- sinteticos, remove tudo ao final, usa somente dados de teste (nunca dados
-- reais ou de outra clinica).
--
-- Projeto-alvo: bcmuqautblvjdqzhjfbw (dev). O corpo da funcao e identico no
-- operacional, mas este script cria e apaga linhas -- rodar em banco com
-- WhatsApp ativo exigiria autorizacao explicita e separada.
--
-- OBSERVACAO SOBRE O NOME DO TESTE 2: "a RPC permite campos cadastrais ainda
-- ausentes quando chamada tecnicamente" NAO significa que nome seja o unico
-- dado obrigatorio do cadastro. No produto Brasil V1 continuam obrigatorios
-- antes da CONCLUSAO do cadastro: nome, CPF e data de nascimento
-- (specs/novo-agendamento.md secao 12). A RPC aceita documento e
-- data_nascimento nulos porque a obrigatoriedade pertence ao CONTROLADOR
-- (Core), nunca a camada de persistencia -- que apenas nao duplica a regra.
--
-- OBSERVACAO SOBRE ERROS: os testes abaixo distinguem dois regimes. Erros
-- PREVISTOS pelo contrato voltam tipados em `motivo` e sem excecao
-- (clinica_id_ausente, telefone_normalizado_ausente, nome_ausente,
-- cpf_ja_cadastrado). Violacoes estruturais fora do contrato da RPC
-- (testes 15 e 16, INSERT direto na tabela) continuam levantando excecao --
-- falha fechado. Nenhum teste afirma que "nenhum erro bruto chega ao
-- chamador": unique_violation inesperada e re-levantada de proposito.
--
-- CONCORRENCIA: este script roda em uma unica sessao (um unico bloco
-- `do $$ ... $$`, uma unica transacao). Ele NAO prova exclusao mutua entre
-- sessoes simultaneas. A serializacao real decorre do indice unico
-- (clinica_id, telefone_normalizado) usado pelo ON CONFLICT e do indice
-- unico (clinica_id, documento) -- garantias do proprio PostgreSQL, nao
-- testadas aqui a nivel de script de sessao unica.
--
-- LIMPEZA: em caso de falha, o `raise exception` do rodape desfaz a
-- transacao inteira e nada fica no banco. Em caso de sucesso, a limpeza
-- explicita no fim do bloco remove os dados sinteticos.
--
-- Cobertura:
--   1. criacao completa -> sucesso, paciente_id novo, campos gravados
--   2. RPC permite campos cadastrais ainda ausentes quando chamada
--      tecnicamente (so nome) -> sucesso (ver observacao acima)
--   3. p_nome nulo em telefone inedito -> nome_ausente, nenhuma linha criada
--   4. p_nome so com espacos -> nome_ausente, nenhuma linha criada
--   5. p_nome nulo sobre paciente EXISTENTE -> nome_ausente, linha intacta
--   6. atualizacao com nome + documento novo -> mesmo paciente_id
--   7. parcialidade: nome + so email -> documento e nascimento preservados
--   8. correcao de nome -> nome novo gravado (sobrescrita esperada)
--   9. cpf_ja_cadastrado -> nenhuma escrita, nenhuma linha nova
--  10. isolamento por clinica: mesmo documento em clinicas diferentes -> ok
--  11. p_clinica_id nulo -> clinica_id_ausente
--  12. p_telefone_normalizado nulo -> telefone_normalizado_ausente
--  13. p_telefone_normalizado vazio -> telefone_normalizado_ausente
--  14. multiplos documento NULL na mesma clinica nao conflitam
--  15. INSERT direto (fora da RPC) com nome nulo -> not_null_violation
--  16. INSERT direto (fora da RPC) com clinica_id nulo -> not_null_violation
--  17. PUBLIC, anon e authenticated sem EXECUTE; service_role com EXECUTE
--  18. constraint pacientes_clinica_id_documento_key existe e e UNIQUE
--  19. pacientes.clinica_id e NOT NULL

do $$
declare
  v_clinica_a uuid;
  v_clinica_b uuid;
  v_r         jsonb;
  v_pid       uuid;
  v_pid_a     uuid;
  v_antes     bigint;
  v_depois    bigint;
  v_excecao   boolean;
  v_falhas    text[] := array[]::text[];
begin
  -- ── setup: duas clinicas sinteticas ─────────────────────────────────────
  insert into clinicas (provider, instancia_whatsapp)
  values ('teste_persist_paciente', 'inst_teste_a') returning id into v_clinica_a;
  insert into clinicas (provider, instancia_whatsapp)
  values ('teste_persist_paciente', 'inst_teste_b') returning id into v_clinica_b;

  -- ── 1. criacao completa ─────────────────────────────────────────────────
  v_r := cappia_persistir_paciente(
    v_clinica_a, '5521999990001', 'Paciente Um', '11144477735', date '1990-04-12', 'um@example.com');
  if coalesce((v_r->>'sucesso')::boolean, false) is not true then
    v_falhas := v_falhas || format('1: esperava sucesso, veio %s', v_r);
  end if;
  v_pid := nullif(v_r->>'paciente_id','')::uuid;
  if v_pid is null then
    v_falhas := v_falhas || '1: paciente_id ausente no retorno';
  end if;
  if not exists (
    select 1 from pacientes
     where id = v_pid and nome = 'Paciente Um' and documento = '11144477735'
       and data_nascimento = date '1990-04-12' and email = 'um@example.com'
  ) then
    v_falhas := v_falhas || '1: campos nao gravados como enviados';
  end if;

  -- ── 2. RPC permite campos cadastrais ainda ausentes quando chamada
  --       tecnicamente (NAO afirma que nome e o unico obrigatorio) ─────────
  v_r := cappia_persistir_paciente(v_clinica_a, '5521999990002', 'Paciente Dois');
  if coalesce((v_r->>'sucesso')::boolean, false) is not true then
    v_falhas := v_falhas || format('2: esperava sucesso, veio %s', v_r);
  end if;
  if not exists (
    select 1 from pacientes
     where id = (v_r->>'paciente_id')::uuid
       and documento is null and data_nascimento is null and email is null
  ) then
    v_falhas := v_falhas || '2: campos opcionais deveriam ficar nulos';
  end if;

  -- ── 3. p_nome nulo em telefone inedito ──────────────────────────────────
  select count(*) into v_antes from pacientes;
  v_r := cappia_persistir_paciente(v_clinica_a, '5521999990003', null, '52998224725');
  if v_r->>'motivo' is distinct from 'nome_ausente' then
    v_falhas := v_falhas || format('3: esperava nome_ausente, veio %s', v_r);
  end if;
  select count(*) into v_depois from pacientes;
  if v_depois <> v_antes then
    v_falhas := v_falhas || '3: nao deveria ter criado linha';
  end if;

  -- ── 4. p_nome so com espacos ────────────────────────────────────────────
  select count(*) into v_antes from pacientes;
  v_r := cappia_persistir_paciente(v_clinica_a, '5521999990004', '    ');
  if v_r->>'motivo' is distinct from 'nome_ausente' then
    v_falhas := v_falhas || format('4: esperava nome_ausente, veio %s', v_r);
  end if;
  select count(*) into v_depois from pacientes;
  if v_depois <> v_antes then
    v_falhas := v_falhas || '4: nao deveria ter criado linha';
  end if;

  -- ── 5. p_nome nulo sobre paciente EXISTENTE -> linha intacta ────────────
  v_r := cappia_persistir_paciente(v_clinica_a, '5521999990001', null, '99999999999');
  if v_r->>'motivo' is distinct from 'nome_ausente' then
    v_falhas := v_falhas || format('5: esperava nome_ausente, veio %s', v_r);
  end if;
  if not exists (
    select 1 from pacientes
     where id = v_pid and nome = 'Paciente Um' and documento = '11144477735'
  ) then
    v_falhas := v_falhas || '5: linha existente foi alterada';
  end if;

  -- ── 6. atualizacao com nome + documento novo -> mesmo paciente_id ───────
  v_r := cappia_persistir_paciente(
    v_clinica_a, '5521999990002', 'Paciente Dois', '52998224725', date '1985-01-30', null);
  if (v_r->>'paciente_id')::uuid is null
     or not exists (select 1 from pacientes where id = (v_r->>'paciente_id')::uuid
                      and telefone_normalizado = '5521999990002') then
    v_falhas := v_falhas || format('6: paciente_id inesperado, veio %s', v_r);
  end if;
  v_pid_a := (v_r->>'paciente_id')::uuid;
  if not exists (
    select 1 from pacientes
     where id = v_pid_a and documento = '52998224725' and data_nascimento = date '1985-01-30'
  ) then
    v_falhas := v_falhas || '6: documento/nascimento nao gravados';
  end if;
  if (select count(*) from pacientes where clinica_id = v_clinica_a
        and telefone_normalizado = '5521999990002') <> 1 then
    v_falhas := v_falhas || '6: deveria ter atualizado, nao criado segunda linha';
  end if;

  -- ── 7. parcialidade: nome + so email -> nada apagado ────────────────────
  v_r := cappia_persistir_paciente(
    v_clinica_a, '5521999990002', 'Paciente Dois', null, null, 'dois@example.com');
  if not exists (
    select 1 from pacientes
     where id = v_pid_a and documento = '52998224725'
       and data_nascimento = date '1985-01-30' and email = 'dois@example.com'
  ) then
    v_falhas := v_falhas || '7: campo ausente apagou valor existente';
  end if;

  -- ── 8. correcao de nome -> sobrescrita esperada ─────────────────────────
  v_r := cappia_persistir_paciente(v_clinica_a, '5521999990002', 'Paciente Dois Corrigido');
  if not exists (
    select 1 from pacientes where id = v_pid_a and nome = 'Paciente Dois Corrigido'
  ) then
    v_falhas := v_falhas || '8: nome enviado deveria sobrescrever';
  end if;

  -- ── 9. cpf_ja_cadastrado: mesmo documento, outro telefone, mesma clinica ─
  select count(*) into v_antes from pacientes;
  v_r := cappia_persistir_paciente(
    v_clinica_a, '5521999990009', 'Paciente Nove', '11144477735');
  if v_r->>'motivo' is distinct from 'cpf_ja_cadastrado' then
    v_falhas := v_falhas || format('9: esperava cpf_ja_cadastrado, veio %s', v_r);
  end if;
  select count(*) into v_depois from pacientes;
  if v_depois <> v_antes then
    v_falhas := v_falhas || '9: nao deveria ter criado linha';
  end if;
  if not exists (
    select 1 from pacientes where id = v_pid and documento = '11144477735'
  ) then
    v_falhas := v_falhas || '9: dono original do CPF foi alterado';
  end if;

  -- ── 10. isolamento por clinica: mesmo documento, clinica diferente ──────
  v_r := cappia_persistir_paciente(
    v_clinica_b, '5521999990001', 'Mesmo CPF Outra Clinica', '11144477735');
  if coalesce((v_r->>'sucesso')::boolean, false) is not true then
    v_falhas := v_falhas || format('10: mesmo CPF em outra clinica deveria passar, veio %s', v_r);
  end if;

  -- ── 11. p_clinica_id nulo ───────────────────────────────────────────────
  v_r := cappia_persistir_paciente(null, '5521999990011', 'Sem Clinica');
  if v_r->>'motivo' is distinct from 'clinica_id_ausente' then
    v_falhas := v_falhas || format('11: esperava clinica_id_ausente, veio %s', v_r);
  end if;

  -- ── 12. p_telefone_normalizado nulo ─────────────────────────────────────
  v_r := cappia_persistir_paciente(v_clinica_a, null, 'Sem Telefone');
  if v_r->>'motivo' is distinct from 'telefone_normalizado_ausente' then
    v_falhas := v_falhas || format('12: esperava telefone_normalizado_ausente, veio %s', v_r);
  end if;

  -- ── 13. p_telefone_normalizado vazio ────────────────────────────────────
  v_r := cappia_persistir_paciente(v_clinica_a, '   ', 'Telefone Vazio');
  if v_r->>'motivo' is distinct from 'telefone_normalizado_ausente' then
    v_falhas := v_falhas || format('13: esperava telefone_normalizado_ausente, veio %s', v_r);
  end if;

  -- ── 14. multiplos documento NULL na mesma clinica nao conflitam ─────────
  --       (prova que UNIQUE comum basta, sem indice parcial)
  v_r := cappia_persistir_paciente(v_clinica_a, '5521999990014', 'Sem CPF Um');
  if coalesce((v_r->>'sucesso')::boolean, false) is not true then
    v_falhas := v_falhas || format('14: primeiro NULL falhou, veio %s', v_r);
  end if;
  v_r := cappia_persistir_paciente(v_clinica_a, '5521999990015', 'Sem CPF Dois');
  if coalesce((v_r->>'sucesso')::boolean, false) is not true then
    v_falhas := v_falhas || format('14: segundo documento NULL conflitou, veio %s', v_r);
  end if;

  -- ── 15. INSERT direto fora da RPC com nome nulo -> excecao ──────────────
  v_excecao := false;
  begin
    insert into pacientes (clinica_id, telefone_normalizado, nome)
    values (v_clinica_a, '5521999990016', null);
  exception when not_null_violation then
    v_excecao := true;
  end;
  if not v_excecao then
    v_falhas := v_falhas || '15: nome nulo deveria falhar por NOT NULL na tabela';
  end if;

  -- ── 16. INSERT direto fora da RPC com clinica_id nulo -> excecao ────────
  v_excecao := false;
  begin
    insert into pacientes (clinica_id, telefone_normalizado, nome)
    values (null, '5521999990017', 'Sem Clinica Direto');
  exception when not_null_violation then
    v_excecao := true;
  end;
  if not v_excecao then
    v_falhas := v_falhas || '16: clinica_id nulo deveria falhar por NOT NULL na tabela';
  end if;

  -- ── 17. grants da funcao ────────────────────────────────────────────────
  if has_function_privilege('public', 'public.cappia_persistir_paciente(uuid, text, text, text, date, text)', 'EXECUTE') then
    v_falhas := v_falhas || '17: PUBLIC nao deveria ter EXECUTE';
  end if;
  if has_function_privilege('anon', 'public.cappia_persistir_paciente(uuid, text, text, text, date, text)', 'EXECUTE') then
    v_falhas := v_falhas || '17: anon nao deveria ter EXECUTE';
  end if;
  if has_function_privilege('authenticated', 'public.cappia_persistir_paciente(uuid, text, text, text, date, text)', 'EXECUTE') then
    v_falhas := v_falhas || '17: authenticated nao deveria ter EXECUTE';
  end if;
  if not has_function_privilege('service_role', 'public.cappia_persistir_paciente(uuid, text, text, text, date, text)', 'EXECUTE') then
    v_falhas := v_falhas || '17: service_role deveria ter EXECUTE';
  end if;

  -- ── 18. constraint de CPF unico por clinica ─────────────────────────────
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.pacientes'::regclass
       and conname = 'pacientes_clinica_id_documento_key'
       and contype = 'u'
  ) then
    v_falhas := v_falhas || '18: pacientes_clinica_id_documento_key ausente ou nao-UNIQUE';
  end if;

  -- ── 19. clinica_id NOT NULL ─────────────────────────────────────────────
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='pacientes'
       and column_name='clinica_id' and is_nullable='YES'
  ) then
    v_falhas := v_falhas || '19: clinica_id deveria ser NOT NULL';
  end if;

  -- ── limpeza (so alcancada quando nao ha excecao) ────────────────────────
  delete from pacientes where clinica_id in (v_clinica_a, v_clinica_b);
  delete from clinicas where id in (v_clinica_a, v_clinica_b);

  if array_length(v_falhas, 1) is not null then
    raise exception 'FALHARAM % teste(s): %', array_length(v_falhas,1), array_to_string(v_falhas, ' | ');
  end if;

  raise notice 'TODOS OS TESTES PASSARAM';
end $$;
