-- PREFLIGHT SOMENTE-LEITURA do banco OPERACIONAL para a migration
-- 20260919204030_iris_nova_pos_consulta_v1.sql.
--
-- ESTADO: ESCRITO, AINDA NAO EXECUTADO. Escopo autorizado pelo Gabriel
-- (2026-09-19): so METADADOS de schema. Ver o relatorio de preflight entregue
-- ao Codex para o que ja foi verificado por outro canal (documento OpenAPI do
-- PostgREST) e o que so este arquivo consegue verificar.
--
-- COMO RODAR: SOMENTE por um canal que force leitura (ex.: MCP Supabase
-- `execute_sql` em modo somente-leitura, ou papel de banco read-only). O
-- arquivo abre `begin read only` e termina em `rollback`; mesmo assim, nao
-- rode por um canal que dispense essa protecao.
--
-- O QUE ESTE ARQUIVO NAO FAZ (e nunca deve passar a fazer):
--   * nenhuma leitura de LINHAS de tabelas de negocio (pacientes, conversas,
--     agendamentos, clinicas) -- so catalogos (pg_class, pg_constraint,
--     information_schema, pg_proc, pg_roles, ...);
--   * nenhum DDL/DML, nenhuma chamada de RPC/funcao de negocio;
--   * nenhum EXPLAIN ANALYZE.
-- Funcoes usadas: apenas auxiliares NATIVAS de catalogo (aclexplode, cast
-- regrole/regnamespace, string_agg) -- leem metadados, nao executam codigo do
-- projeto. Se o Gabriel preferir zero funcoes ate nas auxiliares nativas,
-- [P5]/[P6] podem ser trocados por information_schema.table_privileges (menos
-- completo: so mostra papeis visiveis ao papel que consulta).

begin read only;

-- [P1] ALVO DA MIGRATION deve estar AUSENTE (preflight da propria migration).
-- ESPERADO: 0 linhas.
select 'relacao' as tipo, n.nspname as schema, c.relname as nome
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relname like 'pos_consulta_jornadas%'
union all
select 'funcao', n.nspname, p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where p.proname like 'cappia_pos_consulta_%';

-- [P2] COLUNAS de que a migration/RPC/runner dependem: tipo, nulabilidade,
-- default e SE SAO GERADAS (o que o OpenAPI nao revela).
-- ESPERADO (do OpenAPI, ja confirmado): tipos/nulabilidade abaixo; o que falta
-- decidir aqui: is_generated de clinicas.instancia_whatsapp e
-- pacientes.telefone_normalizado.
select table_name, column_name, data_type, udt_name, is_nullable,
       column_default, is_generated, generation_expression
  from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'clinicas'      and column_name in ('id','nome','provider','instancia_whatsapp','whatsapp_instancia','automatizacoes','ativo'))
     or (table_name = 'pacientes'     and column_name in ('id','clinica_id','telefone','telefone_normalizado'))
     or (table_name = 'agendamentos'  and column_name in ('id','clinica_id','paciente_id','status','concluido_em','procedimento','dentista_nome','procedimento_id','data','horario')))
 order by table_name, ordinal_position;

-- [P3] CONSTRAINTS PK / UNIQUE / FK das tres tabelas.
-- ESPERADO: PK em id (uuid) nas tres -- alvo das FKs da migration; e as
-- unicidades que o Core assume (clinicas: provider+instancia_whatsapp;
-- pacientes: clinica_id+telefone_normalizado).
select tc.table_name, tc.constraint_name, tc.constraint_type,
       string_agg(kcu.column_name, ',' order by kcu.ordinal_position) as colunas
  from information_schema.table_constraints tc
  left join information_schema.key_column_usage kcu
    on kcu.constraint_schema = tc.constraint_schema
   and kcu.constraint_name   = tc.constraint_name
   and kcu.table_name        = tc.table_name
 where tc.table_schema = 'public'
   and tc.table_name in ('clinicas','pacientes','agendamentos')
   and tc.constraint_type in ('PRIMARY KEY','UNIQUE','FOREIGN KEY')
 group by tc.table_name, tc.constraint_name, tc.constraint_type
 order by tc.table_name, tc.constraint_type, tc.constraint_name;

-- [P4] INDICES das tres tabelas (conflito de nome/cobertura de chave).
select tablename, indexname, indexdef
  from pg_indexes
 where schemaname = 'public' and tablename in ('clinicas','pacientes','agendamentos')
 order by tablename, indexname;

-- [P5] PRIVILEGIOS de tabela via ACL real (pg_class.relacl; NULL = so o dono).
-- CRITICO para a migration: as RPCs sao `security invoker` e usam
-- `select ... for share of a, p` -- o Postgres exige UPDATE (alem de SELECT)
-- para travar linhas. Portanto service_role precisa de SELECT **e UPDATE** em
-- pacientes e agendamentos, SELECT em clinicas.
select c.relname as tabela,
       case a.grantee when 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee,
       a.privilege_type
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) a
 where n.nspname = 'public' and c.relname in ('clinicas','pacientes','agendamentos')
 order by c.relname, 2, a.privilege_type;

-- (tabelas com relacl NULL: nenhum grant explicito alem do dono)
select c.relname as tabela_sem_acl_explicita
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('clinicas','pacientes','agendamentos') and c.relacl is null;

-- [P6] DEFAULT PRIVILEGES do schema public: o que toda tabela/funcao NOVA
-- herda (define se os `revoke` explicitos da migration sao o que restringe).
select defaclrole::regrole::text as papel_criador,
       defaclnamespace::regnamespace::text as schema,
       defaclobjtype as tipo_objeto, defaclacl::text as acl
  from pg_default_acl
 order by 1, 3;

-- [P7] PAPEIS (service_role deve ter BYPASSRLS; anon/authenticated devem existir).
select rolname, rolbypassrls, rolcanlogin, rolsuper
  from pg_roles
 where rolname in ('anon','authenticated','service_role','postgres','authenticator')
 order by rolname;

-- [P8] ACL do schema public (USAGE para os tres papeis).
select nspname, nspacl::text as acl from pg_namespace where nspname = 'public';

-- [P9] RLS nas tres tabelas (informativo: service_role tem BYPASSRLS).
select c.relname, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('clinicas','pacientes','agendamentos');

-- [P10] Versao do servidor (gen_random_uuid e nativo desde o PG13) e search_path.
select name, setting from pg_settings where name in ('server_version','server_version_num','search_path') order by name;

-- [P11] Extensoes instaladas (informativo).
select extname, extversion from pg_extension order by extname;

-- [P12] Funcoes existentes com nome proximo ao das criadas pela migration
-- (colisao de assinatura). ESPERADO: so a legada pos_consulta_google_candidatos.
select n.nspname as schema, p.proname as funcao, p.pronargs as n_args,
       p.prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where p.proname like '%pos_consulta%' or p.proname like 'cappia_pos%'
 order by 1, 2;

rollback;
