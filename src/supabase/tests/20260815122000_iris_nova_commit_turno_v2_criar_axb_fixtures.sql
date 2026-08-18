-- Fixtures do teste CONCORRENTE A×B de
-- 20260815122000_iris_nova_commit_turno_v2_criar.sql
--
-- Projeto-alvo: cappia-iris-core-dev (bcmuqautblvjdqzhjfbw). PROIBIDO em
-- udizowyfjnhuhgxkeayk (projeto operacional).
--
-- STATUS: EXECUTADO E APROVADO em 2026-08-15, no projeto dev
-- bcmuqautblvjdqzhjfbw. Os DOIS cenarios passaram, com as duas barreiras
-- confirmadas por pg_blocking_pids (linha da conversa no cenario 1, advisory
-- lock no cenario 2). Limpeza completa, zero residuos. Producao intocada.
--
-- ── DOIS CENARIOS, DOIS LOCKS DIFERENTES ────────────────────────────────
-- A criacao tem DUAS formas de concorrencia, e elas sao protegidas por
-- mecanismos distintos. Testar so a primeira deixaria o advisory lock -- que
-- e o unico mecanismo novo em relacao ao cancelamento -- sem prova nenhuma.
--
--   CENARIO 1 -- MESMA CONVERSA: dois turnos do mesmo paciente partindo da
--   MESMA `versao_inicial`. Quem separa e o `FOR UPDATE` da linha de
--   `estado_conversa` (passo 1). Espelha o A×B do cancelamento. Criterio da
--   spec v2 secao 14.9: EXATAMENTE UMA linha nova em `agendamentos` -- nao
--   duas, nao zero -- e B devolve turno obsoleto.
--
--   CENARIO 2 -- CONVERSAS DIFERENTES, MESMO INTERVALO: dois PACIENTES
--   distintos, cada um com sua conversa e sua versao valida, disputando o
--   mesmo dentista no mesmo horario. O lock da conversa NAO os separa (sao
--   linhas diferentes) -- quem decide e o advisory lock por (clinica,
--   dentista, dia) seguido da checagem de conflito por tsrange. Um cria, o
--   outro recebe `horario_ocupado`.
--
-- ── SEM ROLLBACK PROTEGENDO ─────────────────────────────────────────────
-- Como no A×B do cancelamento, a sessao A precisa COMMITAR: B so observa o
-- efeito depois. A limpeza e responsabilidade EXPLICITA do runner (DELETE por
-- marcador, terceira conexao, `finally`).
--
-- ── MARCADOR UNICO POR EXECUCAO ─────────────────────────────────────────
-- Todo dado sintetico carrega o sufixo $1 (uuid gerado pelo runner) nas
-- colunas de texto, e a limpeza apaga EXATAMENTE esse marcador. Telefones e
-- documentos sao CONSTANTES e so com digitos -- nunca derivados do marcador,
-- que contem a-f e violaria `pacientes_telefone_formato` (`^[0-9]+$`). A
-- clinica exclusiva por execucao ja garante a nao-colisao.
--
-- O id do procedimento tambem carrega o marcador porque
-- `procedimentos_catalogo` NAO tem clinica_id (catalogo global) -- sem isso,
-- duas execucoes simultaneas colidiriam na primary key.

-- ── CATALOGO (global: precisa do marcador no id) ────────────────────────
insert into procedimentos_catalogo (id, tempo_padrao, ativo, nome_pt, nome_es,
                                    nome_en, nome_fr, nome_de, nome_it, nome_ru, nome_ar)
  values ('teste-axb-criar-' || $1::text, 60, true, 'Consulta / Avaliacao', 'Consulta',
          'Consultation', 'Consultation', 'Beratung', 'Consulto', 'Konsultaciya', 'Istisharat');

-- ── UMA clinica, UM dentista: e o que faz os dois pacientes do cenario 2
--    disputarem exatamente o mesmo recurso.
insert into clinicas (provider, instancia_whatsapp, dentistas)
  values ('evolution', 'teste-axb-criar-clinica-' || $1::text,
          jsonb_build_array(jsonb_build_object(
            'id', $2::text, 'nome', 'Diego Ramoz', 'titulo', 'Dr.', 'ativo', true,
            'procedimentos', jsonb_build_array(jsonb_build_object(
              'id', 'teste-axb-criar-' || $1::text,
              'nome', 'Consulta / Avaliacao', 'ativo', true)))));

-- ── DOIS pacientes da MESMA clinica ─────────────────────────────────────
insert into pacientes (clinica_id, telefone_normalizado, nome)
  select id, '5511900000001', 'Teste AxB Um ' || $1::text
    from clinicas where instancia_whatsapp = 'teste-axb-criar-clinica-' || $1::text;

insert into pacientes (clinica_id, telefone_normalizado, nome)
  select id, '5511900000002', 'Teste AxB Dois ' || $1::text
    from clinicas where instancia_whatsapp = 'teste-axb-criar-clinica-' || $1::text;

-- ── UMA conversa por paciente, ambas com autorizacao VALIDA e a MESMA
--    proposta pendente (mesmo dentista, mesma data, mesmo horario).
--    `aguardando_resposta` ja nasce autorizada: os dois lados de cada
--    cenario tem autorizacao legitima -- so o lock decide.
insert into estado_conversa (clinica_id, paciente_id, telefone_normalizado, estado, dados,
                             contexto_horarios, aguardando_resposta)
  select c.id, p.id, p.telefone_normalizado, 'aguardando_confirmacao',
         jsonb_build_object('dentista_id', $2::text,
                            'procedimento_id', 'teste-axb-criar-' || $1::text),
         jsonb_build_object('proposta_pendente',
           jsonb_build_object('data', to_char($3::date, 'YYYY-MM-DD'), 'horario', '10:00')),
         jsonb_build_object('tipo', 'confirmacao', 'operacao', 'criar')
    from clinicas c
    join pacientes p on p.clinica_id = c.id
   where c.instancia_whatsapp = 'teste-axb-criar-clinica-' || $1::text;
