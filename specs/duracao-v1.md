# Duração v1

**Status:** especificação canônica aprovada para o primeiro fluxo de novo agendamento.
Este documento define contrato lógico e comportamento; não autoriza implementação,
alteração de banco, criação de tabelas, migration, schema físico ou alteração do painel.

Esta especificação complementa `novo-agendamento.md`, `procedimentos-v1.md`,
`dentistas-vinculos-v1.md`, `eventos-conversacionais-v1.md` e
`controlador-conversacional-v1.md`. Permanecem fixas as decisões de
`../docs/02-arquitetura.md` e `../docs/04-decisoes-canonicas.md`: a IA interpreta
somente a mensagem atual e nunca decide; o Core determinístico resolve;
Supabase/Postgres é a fonte oficial.

## 0. Revisão de 30/08/2026 — a duração passou a pertencer ao dentista

Decisão do Gabriel, aprovada após um caso real de produção (v91, turno de
30/08/2026 21:40:06 UTC, confirmado nos logs da Edge Function).

**O que era:** a duração pertencia a `clinica_id + procedimento_id` e valia igual
para todos os dentistas aptos.

**O que motivou a revisão:** uma clínica real tinha três dentistas ativos com
durações legítimas e diferentes para a **mesma** Consulta/Avaliação —

| Dentista | modo | duração |
|---|---|---|
| Diego Perez | `auto` | 60 |
| Diego Ramoz | `procedimento` | 30 |
| Pablo Arruda | `procedimento` | 30 |

Como as três caíam na mesma chave, o resolvedor — corretamente, pelo contrato
antigo — devolvia `duracao_conflitante`. O paciente escolheu o Diego Perez, pediu
avaliação para segunda-feira, e recebeu *"tivemos uma instabilidade técnica"*. A
clínica inteira ficou impedida de agendar aquele procedimento.

**O que passa a valer:** a duração pertence ao **dentista escolhido**. Diferenças
entre profissionais são configuração válida, nunca defeito.

As seções 1, 4 e 7 abaixo foram revisadas por esta decisão.

## 1. Fonte oficial

```
clinica_id + dentista_id + procedimento_id = duracao_min
```

A duração:

- pertence ao **dentista escolhido**, para aquele procedimento, naquela clínica;
- **pode legitimamente diferir entre dentistas** da mesma clínica;
- é resolvida usando **exclusivamente** a configuração do dentista já escolhido —
  a de outro profissional nunca é consultada, comparada nem usada como fallback;
- não é uma duração global compartilhada entre clínicas.

Como o valor é obtido, por modo de configuração do dentista:

| Modo do dentista | Origem da duração |
|---|---|
| `auto` | a **duração padrão daquele dentista** |
| `procedimento` | o **tempo daquele procedimento naquele dentista** |

Dentista e vínculo continuam necessários para comprovar aptidão e isolamento
(`dentistas-vinculos-v1.md`) — e agora **também determinam o valor da duração**.

O `dentista_id` é obrigatório na resolução: sem ele, a resolução voltaria a
comparar profissionais diferentes entre si, e por isso ela falha alto em vez de
adivinhar.

## 2. Validação

A duração válida deve:

- ser expressa em minutos;
- ser numérica;
- ser inteira;
- ter mínimo de 10 minutos;
- ter máximo de 240 minutos;
- ser múltipla de 10 minutos.

O painel deverá impedir futuramente: vazio; valor não numérico; fração; zero;
negativo; valor inferior a 10; valor superior a 240; valor que não seja múltiplo de 10.

O Core também deverá validar o valor recebido da fonte oficial e falhar fechado diante
de inconsistência — a validação do painel não dispensa a validação do Core.

**Não arredondar, truncar ou corrigir automaticamente**, em nenhuma camada.

## 3. Valores iniciais

Cada clínica nasce com os tempos pré-configurados definidos pelo produto para o
catálogo-base da Iris Nova.

Esses valores:

- seguem blocos de 10 minutos;
- pertencem à configuração da clínica;
- podem ser alterados pela clínica dentro das regras válidas (seção 2);
- não são obtidos automaticamente do catálogo global legado;
- não autorizam migração automática de tempos antigos.

O catálogo-base e seus valores exatos permanecem como artefato pendente separado
(seção 13).

## 4. Duração por dentista — o que existe e o que continua não existindo

**Revisado em 30/08/2026** (ver seção 0). A duração individual por dentista, que
esta seção antes proibia, **é agora a regra canônica**: a chave é
`clinica_id + dentista_id + procedimento_id`, e o valor sai do modo configurado
para aquele dentista (`auto` → duração padrão dele; `procedimento` → tempo daquele
procedimento nele).

**Duração diferente entre dentistas é válida e esperada.**

Continuam NÃO existindo:

- `geral_dentista` e `especifica_vinculo` como enums de modo;
- duração por **vínculo** dentista–procedimento (o vínculo comprova aptidão, não
  carrega duração);
- precedência entre fontes ou fallback entre modos — cada dentista tem uma origem
  única de duração, definida pelo seu próprio modo;
- fallback para a duração de **outro** profissional: se o dentista escolhido não
  tem configuração, o resultado é `nao_configurada`, nunca "usa a do colega";
- campo ou enum preventivo de modo além dos já existentes.

## 5. Resolução determinística

Fluxo:

1. obter `clinica_id` da instância autenticada;
2. validar procedimento oficial, ativo e pertencente à clínica;
3. validar dentista oficial, ativo e pertencente à clínica;
4. validar vínculo oficial e ativo entre ambos;
5. carregar a configuração exata **daquele dentista** para o procedimento, naquela
   clínica (`clinica_id + dentista_id + procedimento_id`) — a configuração de
   outro profissional nunca entra nesta etapa;
6. validar formato, intervalo e múltiplo de 10 (seção 2);
7. retornar `duracao_min` ou falha fechada.

Proibido, sem exceção:

- duração de **outro** dentista que não o escolhido (a do escolhido é a fonte);
- duração do vínculo;
- duração global compartilhada entre clínicas;
- tempo legado;
- resolução por nome;
- duração de outra clínica;
- snapshot histórico como configuração;
- fallback de 60 minutos;
- média;
- aproximação;
- arredondamento;
- decisão da IA.

## 6. Falha excepcional

Falha de duração representa inconsistência técnica ou administrativa excepcional —
configuração inexistente, dado corrompido, formato incompatível, procedimento sem
configuração na clínica, violação de isolamento ou leitura inconsistente. Não é um
caminho normal do atendimento, já que o painel deve bloquear os valores inválidos na
origem.

Nesses casos:

- não inventar duração;
- não consultar disponibilidade;
- não usar 60 minutos;
- não usar valores legados;
- não mudar o procedimento;
- não oferecer Consulta/Avaliação por esse motivo;
- não reclassificar dentistas aptos como não aptos;
- não buscar configuração em outra clínica;
- falhar fechado.

Os motivos internos permanecem distintos para auditoria, no mesmo padrão de
`dentistas-vinculos-v1.md` §4. A resposta ao paciente está definida em
`atendimento-v1.md` §5 ("Falha definitiva"): informar que não foi possível continuar
agora, sem detalhar o motivo interno. A camada de atendimento não corrige, não inventa e
não substitui duração — ela apenas comunica, dentro dos fatos autorizados pelo
controlador, o que o Core já decidiu. A decisão operacional (falhar fechado, sem
Consulta/Avaliação, sem reclassificar aptidão) continua sendo exclusivamente do Core.

## 7. Qualquer profissional

**Revisado em 30/08/2026** (ver seção 0). Cada dentista apto recebe **a sua
própria** duração — elas podem diferir entre si legitimamente.

A disponibilidade recebe uma combinação por profissional:

- `clinica_id`;
- `procedimento_id`;
- `dentista_id`;
- vínculo oficial ativo;
- a `duracao_min` **daquele dentista**.

Quando o paciente aceita qualquer profissional, cada agenda é calculada
separadamente **com a duração do respectivo dentista** — nunca com um valor único
aplicado a todos. Trocar de dentista exige recalcular a duração antes de qualquer
consulta de disponibilidade.

A consulta permanece individual porque cada dentista possui agenda própria **e**
porque a duração é dele.

Nenhuma disponibilidade pode ser consultada sem duração válida. A disponibilidade não
pode inventar, alterar ou buscar a duração em outra fonte.

## 8. Estado e invalidação

Separar logicamente três coisas distintas:

- **configuração oficial vigente** — o que a clínica tem salvo hoje;
- **duração usada para calcular a opção** — o valor que produziu os horários
  apresentados;
- **snapshot aplicado ao agendamento** — o valor que valeu para um agendamento
  específico.

Invalidar duração e derivados quando houver mudança **efetiva** em:

- `clinica_id`;
- `procedimento_id`;
- valor oficial da duração;
- status do procedimento;
- `dentista_id` ou seu status, quando afetar a aptidão;
- vínculo ou seu status;
- isolamento das entidades.

**Não invalidar apenas por mudança superficial do texto** quando as identidades
oficiais permanecerem iguais.

Invalidar em cascata: disponibilidade → opções → escolha → resumo → confirmação.

## 9. Revalidação

Antes da criação:

- comparar a duração utilizada para calcular a opção com a configuração oficial
  vigente;
- se permanecer igual, seguir para a revalidação da disponibilidade;
- se tiver mudado, não criar;
- invalidar os derivados;
- recalcular duração e disponibilidade;
- exigir nova escolha, resumo e confirmação;
- nunca substituir silenciosamente a duração.

Uma operação idempotente já concluída retorna o resultado e o snapshot existentes, sem
alteração retroativa.

## 10. Snapshot e remarcação

O agendamento preserva `duracao_min` como snapshot histórico. Mudanças futuras na
configuração não alteram agendamentos existentes.

Na futura remarcação:

- preservar o snapshot histórico anterior;
- carregar a duração oficial vigente;
- calcular o novo slot com essa duração;
- registrar um novo snapshot aplicado ao resultado remarcado.

Remarcação não é implementada nem especificada nesta rodada.

Se a clínica salvar um valor tecnicamente permitido, mas inadequado para sua operação,
isso é responsabilidade da configuração da clínica. A Iris não avalia se o tempo é
clinicamente ideal, não corrige o valor, não o substitui por tempo recomendado, não
inventa fallback, não muda o procedimento e não tenta compensar a configuração.

## 11. Isolamento multiclínica

A configuração de duração pertence ao dentista, dentro da clínica; procedimento,
dentista e vínculo pertencem à mesma clínica; nenhuma duração cruza clínicas; ausência de configuração em
uma clínica nunca consulta outra; IDs externos não são autoridade; nenhuma informação
administrativa de outra clínica pode ser revelada.

## 12. Testes obrigatórios

Duração válida configurada resolve normalmente; dois dentistas aptos podem ter
durações **diferentes** para o mesmo procedimento, e cada um resolve exclusivamente a
própria — a diferença entre profissionais nunca gera conflito (revisado em 30/08/2026);
duas configurações contraditórias para o **mesmo** dentista e o mesmo procedimento
continuam falhando como `duracao_conflitante`; duração ausente para o dentista escolhido
falha fechado, sem usar a de outro profissional; duração zero, negativa, fracionada,
não numérica, abaixo de 10, acima de 240 ou não múltipla de 10 falham fechado sem
correção automática; falha de duração não oferece Consulta/Avaliação; falha de duração
não reclassifica dentistas aptos como não aptos; falha de duração não consulta
disponibilidade; nenhuma configuração de outra clínica nem de outro profissional é
consultada; troca de dentista com o mesmo procedimento **invalida e recalcula** o valor
da duração (ela é do dentista); troca de procedimento invalida a duração; alteração do valor oficial após opções apresentadas invalida derivados;
revalidação antes da criação detecta mudança e impede a criação; snapshot histórico
permanece inalterado após mudança de configuração; mudança superficial de texto com
identidade oficial idêntica não invalida.

## 13. Pendências

Não resolvidas por esta especificação, não decididas por inferência:

1. Catálogo-base da Iris Nova — quais procedimentos e quais durações iniciais em
   blocos de 10 minutos. Artefato separado, ainda não definido.
2. Regra de transição para clínicas já configuradas no sistema legado — os valores
   antigos não são autoridade e não migram automaticamente, mas o procedimento de
   entrada dessas clínicas não está definido.
3. Implementação da validação no painel (`iris-portal-v2`) — repositório e sistema
   distintos; escopo, responsável e prazo fora desta especificação.
4. Onde a configuração de duração vive fisicamente — schema fora de escopo.
5. Resposta conversacional para falha de duração — **deixou de ser pendência**: definida
   em `atendimento-v1.md` §5, canônica vigente.

## 14. Invariantes

- Duração é sempre `clinica_id + dentista_id + procedimento_id` (revisado em
  30/08/2026); nunca por vínculo, nunca global entre clínicas.
- Dentistas aptos do mesmo procedimento na mesma clínica **podem ter durações
  diferentes** — isso é configuração válida, nunca defeito.
- A resolução usa exclusivamente a configuração do dentista escolhido; a de outro
  profissional nunca é consultada nem serve de fallback.
- **Conflito existe somente entre valores contraditórios do mesmo dentista e do
  mesmo procedimento** — nunca entre profissionais diferentes.
- Dentista comprova aptidão e isolamento **e determina o valor da duração**; o
  vínculo comprova aptidão e isolamento, e não altera o valor.
- Duração válida é inteira, em minutos, de 10 a 240, múltipla de 10.
- Nenhum arredondamento, truncamento ou correção automática, em nenhuma camada.
- Nenhum fallback de qualquer natureza — nem 60 minutos, nem legado, nem outra
  clínica, nem snapshot histórico como configuração.
- Falha de duração falha fechado, sem oferecer Consulta/Avaliação e sem reclassificar
  aptidão.
- Configuração vigente, duração usada no cálculo e snapshot do agendamento são três
  conceitos distintos.
- Snapshot histórico nunca é alterado retroativamente.
- Não existe campo, enum ou estrutura preventiva de modo de duração nesta versão.
- Esta especificação não cria código, tabela, coluna, RPC, migration ou alteração de
  painel.
