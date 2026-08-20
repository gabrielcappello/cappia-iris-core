# Revisão pedida: RPC transacional V2 de CRIAÇÃO de agendamento

Repositório: `gabrielcappello/cappia-iris-core` (branch `main`, atualizado).
Commit a revisar: **`1880089`** — *"wip: RPC transacional V2 de CRIACAO +
medicao em sombra (AGUARDA REVISAO)"*.

**Nada está aplicado em produção.** Consultei o banco operacional hoje: nenhuma
função `commit_turno` existe lá. A rota V1 continua sendo a única que atende.
Os testes criam a função no ambiente de dev, medem e removem, sem resíduo.
Esta revisão decide se o código pode ser aplicado — não conserta algo no ar.

---

## O problema que a RPC resolve

As RPCs de efeito atuais (`cappia_reservar_agendamento`,
`cappia_cancelar_agendamento_v2`) executam o efeito e nada mais: não conhecem
`versao_inicial` nem gravam estado conversacional.

Consequência: **dois turnos sobre o mesmo snapshot chegam a chamar a RPC**, e
só depois um deles perde o CAS. Um commit posterior não desfaz efeito já
executado — o agendamento duplicado já existe.

A solução é uma RPC por operação que faz tudo numa **única transação**:

1. valida `versao_inicial` contra `estado_conversa.atualizado_em`, **com lock**
2. valida a **autorização persistida** em `aguardando_resposta` da linha travada
3. resolve dentista / duração / procedimento
4. advisory lock por (clínica, dentista, dia) + checagem de conflito
5. `INSERT` do agendamento
6. grava o estado final — **só o ramo que concluiu o efeito grava**

Arquivo principal: `src/supabase/migrations/20260815122000_iris_nova_commit_turno_v2_criar.sql`
(434 linhas, comentários explicando cada decisão).

---

## O que eu gostaria que fosse revisado

### 1. O predicado da linha autoritativa (prioridade máxima)

Na revisão anterior você encontrou aqui um furo real: faltava
`and paciente_id = p_paciente_id`. Sem ele, uma conversa de um paciente com
`p_paciente_id` de outro na mesma clínica executaria na ficha errada.

Foi corrigido (linhas 250-258) e os testes refeitos. **Confirme que a correção
está completa** e que não há outro caminho que alcance a linha sem o predicado
inteiro (`clinica_id`, `telefone_normalizado`, `paciente_id`).

### 2. O conjunto de locks

`FOR UPDATE` na linha de `estado_conversa` + `pg_advisory_xact_lock` por
(clínica, dentista, dia), linha 358.

Perguntas: a ordem de aquisição pode gerar deadlock entre dois turnos de
pacientes diferentes com o mesmo dentista no mesmo dia? O advisory lock é
`xact`, então solta no fim da transação — isso é suficiente para o INSERT da
linha 391?

O comentário afirma que a lógica de lock e conflito é **idêntica** à da função
existente ("mesmo hash de advisory lock, mesmo predicado"), sem reescrita.
Vale conferir se é verdade — se divergir, dois caminhos concorrentes usariam
locks diferentes e a exclusão mútua se perde.

### 3. Versão divergente não pode deixar efeito

Comentário na linha 104: "VERSAO DIVERGENTE => NENHUM EFEITO". Confirme que
**todo** caminho de saída por versão divergente sai antes de qualquer escrita,
sem exceção.

### 4. O rollback

`20260815122000_..._criar_rollback.sql` (53 linhas). Ele desfaz de verdade, e é
seguro rodar se a função nunca chegou a ser aplicada?

### 5. Uma decisão que quero contestada

Está registrado como canônico que **`remarcar` não deve ser derivado de
criar + cancelar**, porque muda o conjunto de locks. É a próxima operação da
fila, então se você discordar, é agora que importa.

---

## O que já foi testado (não precisa repetir, só confiar ou contestar)

- 20 casos em sessão única
- Teste A×B concorrente com dois cenários — `FOR UPDATE` da conversa e
  advisory lock por clínica/dentista/dia; barreiras confirmadas por
  `pg_blocking_pids`
- Caso de controle: dentistas diferentes → os dois agendamentos coexistem,
  provando que o conflito não é falso positivo
- Zero resíduo verificado no dev após cada rodada

Script: `src/supabase/tests/executar-teste-axb-commit-v2-criar.mjs`

---

## O que acontece depois da sua revisão

1. Aplicar os ajustes que você apontar
2. Implementar `remarcar` (ver item 5 acima)
3. Teste cruzado da spec §14.9 — A cancela × B remarca o mesmo agendamento,
   só um efeito pode ocorrer; depende de `remarcar` existir
4. **Só então** aplicar em banco, com autorização explícita do Gabriel

---

## Se quiser mais contexto

`handoffs/2026-08-15-commit-transacional-v2.md` — decisões canônicas e
armadilhas já encontradas durante a construção.

O que mais me interessa é o item 1 e o item 2: um erro ali executa efeito na
ficha errada ou permite agendamento duplicado, e nenhum dos dois aparece em
teste feliz.
