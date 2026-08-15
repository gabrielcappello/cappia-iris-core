-- Fixtures do teste CONCORRENTE A×B de
-- 20260815121000_iris_nova_commit_turno_v2_cancelar.sql
--
-- Projeto-alvo: cappia-iris-core-dev (bcmuqautblvjdqzhjfbw). PROIBIDO em
-- udizowyfjnhuhgxkeayk (projeto operacional).
--
-- STATUS: EXECUTADO E APROVADO em 2026-08-15, no projeto dev
-- bcmuqautblvjdqzhjfbw -- e REEXECUTADO apos o vinculo
-- `estado_conversa.paciente_id = p_paciente_id` entrar no passo 1 da RPC, para
-- confirmar que o predicado novo nao alterou a concorrencia. Passou
-- integralmente nas duas rodadas: estas fixtures ja gravam `paciente_id` da
-- propria conversa (insert de estado_conversa abaixo) e o runner le
-- `e.paciente_id` dela, entao o vinculo confere por construcao. Todas as
-- assertivas passaram, a limpeza removeu os dados sinteticos e o DDL
-- temporario, e a verificacao final acusou zero residuos. Producao
-- (udizowyfjnhuhgxkeayk) intocada.
--
-- CORRECAO NECESSARIA ANTES DA EXECUCAO VALIDA -- o telefone era derivado do
-- marcador (uuid), e uuid contem a-f: violava
-- `pacientes_telefone_formato` (`^[0-9]+$`). Passou a ser constante e so com
-- digitos (ver o comentario no insert de pacientes). A clinica exclusiva por
-- execucao ja garante a nao-colisao.
--
-- ── DIFERENCA CRITICA PARA O TESTE DE SESSAO UNICA ──────────────────────
-- Aqui NAO HA ROLLBACK protegendo a limpeza. A sessao A precisa COMMITAR de
-- verdade: B so observa a versao avancada depois do commit de A. Se A desse
-- rollback, B acordaria, leria `atualizado_em` INALTERADO, o CAS conferiria
-- e B EXECUTARIA -- o teste provaria o contrario do que existe para provar.
--
-- Consequencia: a limpeza e responsabilidade EXPLICITA do runner, via DELETE
-- em terceira conexao, e nao uma garantia automatica da transacao.
--
-- ── MARCADOR UNICO POR EXECUCAO ─────────────────────────────────────────
-- Todo dado sintetico carrega o sufixo `:marcador` (um uuid gerado pelo
-- runner a cada execucao) nas colunas de texto. A limpeza apaga EXATAMENTE
-- esse marcador -- nunca um LIKE amplo, que poderia alcancar residuo de
-- outra execucao ou dado real. Se duas execucoes rodarem em paralelo, uma
-- nunca apaga os dados da outra.
--
-- Este arquivo e parametrizado por $1 (o marcador) e devolve os ids criados.
-- Executado pelo runner numa transacao propria que COMMITA -- as duas
-- sessoes precisam enxergar os mesmos dados.

insert into clinicas (provider, instancia_whatsapp)
  values ('evolution', 'teste-axb-clinica-' || $1::text);

-- TELEFONE CONSTANTE, SO DIGITOS. Nao pode ser derivado do marcador: o uuid
-- contem a-f e hifens, e `pacientes_telefone_formato` exige `^[0-9]+$` --
-- qualquer derivacao dele violaria o CHECK. A unicidade e por
-- (clinica_id, telefone_normalizado), e a clinica ja e exclusiva desta
-- execucao, entao um valor fixo nunca colide com outra execucao.
insert into pacientes (clinica_id, telefone_normalizado, nome)
  select id, '5511900000001', 'Teste AxB ' || $1::text
    from clinicas where instancia_whatsapp = 'teste-axb-clinica-' || $1::text;

insert into estado_conversa (clinica_id, paciente_id, telefone_normalizado, estado, dados, aguardando_resposta)
  select c.id, p.id, p.telefone_normalizado, 'aguardando_confirmacao',
         jsonb_build_object('origem', 'teste-axb', 'marcador', $1::text),
         null
    from clinicas c
    join pacientes p on p.clinica_id = c.id
   where c.instancia_whatsapp = 'teste-axb-clinica-' || $1::text;

insert into agendamentos (clinica_id, paciente_id, data, horario, procedimento_id, status, nome)
  select c.id, p.id, current_date + 7, '10:00', 'teste-proc', 'confirmado', 'Teste AxB ' || $1::text
    from clinicas c
    join pacientes p on p.clinica_id = c.id
   where c.instancia_whatsapp = 'teste-axb-clinica-' || $1::text;

-- A AUTORIZACAO -- valida, e a MESMA para as duas sessoes. E exatamente o
-- ponto do teste: A e B tem autorizacao legitima e identica, disputando a
-- mesma conversa a partir da mesma `versao_inicial`. So o lock decide.
update estado_conversa e
   set aguardando_resposta = jsonb_build_object(
         'tipo', 'confirmacao',
         'operacao', 'cancelar',
         'agendamento_id', a.id::text)
  from clinicas c
  join agendamentos a on a.clinica_id = c.id
 where e.clinica_id = c.id
   and c.instancia_whatsapp = 'teste-axb-clinica-' || $1::text;
