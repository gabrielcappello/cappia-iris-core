# Resposta conversacional — V1

**Status:** proposta para revisão do Codex e aprovação do Gabriel. Não implementada.
Não autoriza código, migration, alteração de banco, painel ou n8n.

## Problema

A Iris hoje usa IA para **ler** a mensagem do paciente e responde com **20 frases
fixas** escritas no código (`gerar-resposta-paciente.ts`). Nenhuma IA participa da
redação. O paciente conversa com um programa de texto congelado — e é por isso que a
conversa soa mecânica por mais que se ajuste a interpretação.

Esta V1 substitui a redação fixa por uma segunda chamada de IA, mantendo o Core como
**única** autoridade operacional.

## 1. Arquitetura

```
mensagem do paciente
   ↓
[IA 1 — interpretadora]  →  dados estruturados (contrato atual, inalterado)
   ↓
[CORE]  decide o passo com dados reais  →  FatosAutorizados
   ↓
[IA 2 — redatora]  →  texto natural, usando SOMENTE os fatos recebidos
   ↓
resposta ao paciente
```

O Core continua decidindo tudo: procedimento, dentista, duração, data, horário,
disponibilidade, reserva. A IA 2 não decide nada — ela **veste em linguagem** uma
decisão já tomada.

## 2. Contrato dos fatos autorizados (Core → IA redatora)

```ts
interface FatosAutorizados {
  objetivo: ObjetivoResposta;              // o que esta resposta precisa alcancar
  procedimento_resolvido?: string;         // nome_pt ja resolvido pelo Core
  procedimentos_candidatos?: string[];     // quando ha mais de um possivel
  dentista_resolvido?: string;             // nome_exibido ja resolvido
  dentistas_candidatos?: string[];         // quando ha mais de um apto
  data_referencia?: string;                // "05/08" -- ja formatada pelo Core
  horarios_disponiveis?: string[];         // ["13:00","14:00"] -- reais, recalculados
  agendamento_confirmado?: { data: string; horario: string };
  proposta_pendente?: { data: string; horario: string };  // aguardando confirmacao do paciente
  dados_faltantes?: CampoFaltante[];       // ['procedimento'|'data'|'horario'|'cadastro']
  falha_tecnica?: true;                    // erro interno -- nunca detalhado ao paciente
}

type ObjetivoResposta =
  | 'cumprimentar_e_oferecer_ajuda'
  | 'pedir_procedimento'
  | 'escolher_entre_procedimentos'
  | 'escolher_entre_dentistas'
  | 'pedir_data_ou_horario'
  | 'apresentar_horarios'
  | 'informar_sem_disponibilidade'
  | 'pedir_confirmacao'
  | 'informar_reserva_criada'
  | 'informar_horario_indisponivel'
  | 'acolher_e_retomar'          // conversa casual, duvida fora do agendamento
  | 'pedir_reformulacao'          // nao foi possivel entender
  | 'encerrar_cordialmente'       // desistencia
  | 'informar_falha_tecnica';
```

**Regra estrutural:** `FatosAutorizados` carrega **fatos**, nunca frases. Nenhum campo
contém texto de resposta pronto. `objetivo` diz *o que* a resposta precisa fazer; a IA
decide *como* dizer.

Cada um dos 19 tipos de `DecisaoOrquestrador` mapeia para exatamente um `objetivo`,
por uma função pura e exaustiva — decisão nova sem mapeamento não compila.

## 3. Contrato da IA redatora

**Recebe:** a mensagem atual do paciente (texto cru), os `FatosAutorizados`, e o nome
da clínica. Nada mais — sem histórico completo, sem dados cadastrais, sem IDs internos.

**Devolve:** um único texto em português. Sem JSON, sem campos, sem estrutura.

**Pode:**
- conversar naturalmente, variar a redação, usar o tom de uma recepcionista atenciosa;
- acolher comentário pessoal ("estou com medo de dentista", "que calor hoje") e emendar
  de volta no agendamento;
- entender erro de escrita, gíria, abreviação, frase incompleta;
- perguntar especificamente quando a mensagem do paciente for ambígua — ela recebe a
  mensagem crua, então consegue apontar a dúvida real ("você quer a limpeza ou o
  clareamento?") em vez de repetir uma pergunta genérica.

**Nunca pode:**
- citar horário, data, dentista, procedimento ou preço que não esteja nos fatos;
- afirmar que reservou/marcou/confirmou sem `agendamento_confirmado` presente;
- escolher procedimento, dentista ou horário pelo paciente;
- dar diagnóstico, opinião clínica ou orientação de saúde;
- expor motivo técnico, nome de campo, ID ou detalhe interno;
- prometer retorno, ligação, desconto ou qualquer coisa fora dos fatos.

**Ausência de fato não é fato:** a redatora nunca conclui nada a partir do que não
recebeu — ela só comunica o que `objetivo` e os fatos presentes autorizam. Um campo
ausente nunca vira suposição de disponibilidade, sucesso ou negativa.

## 4. Guarda programática (não é confiança, é verificação)

Depois da redação e **antes** de enviar ao paciente, o Core verifica o texto:

1. **Horários:** todo trecho que a detecção abaixo reconhecer como horário precisa
   existir em `horarios_disponiveis`, em `proposta_pendente` ou em
   `agendamento_confirmado`. Um horário fora dessas três fontes reprova o texto.

   Detecção — reconhece **somente**:
   - `HH:MM`, hora entre 00 e 23;
   - `Nh` ou `N horas`, com N entre 0 e 23.

   Um número dentro de um padrão de data (`DD/MM` ou `DD/MM/AAAA`) **não** é tratado
   como horário — a detecção verifica o padrão de data primeiro e exclui essa posição
   do texto antes de procurar horário. Fora desses dois formatos exatos, nenhum outro
   número (preço, duração, quantidade) é tratado como horário — a detecção nunca
   interpreta um dígito solto.

   **Comparação por valor, nunca por texto.** Antes de comparar, os dois lados são
   normalizados para minutos desde a meia-noite: o horário detectado na resposta da IA e
   cada horário das fontes autorizadas. `14h`, `14:00` e `14 horas` colapsam todos em
   `840` e são o mesmo horário. A guarda só aprova quando o **valor normalizado** existir
   em alguma das três fontes — comparar as strings literais reprovaria redação
   perfeitamente válida só por variação de escrita, que é exatamente o oposto do
   objetivo.
2. **Afirmação de reserva:** afirmar que está marcado/agendado/confirmado só é
   permitido com `agendamento_confirmado` presente.
3. **Vazio:** texto vazio ou só espaços reprova.

Texto reprovado **nunca chega ao paciente** — cai no fallback da seção 6. A guarda
**nunca edita, corrige ou reescreve** o texto reprovado; ele é descartado inteiro.

**Telemetria x resposta ao paciente são coisas separadas.** A reprovação é registrada
internamente como falha da redação/guarda, nunca mascarada nem silenciada. Mas o
paciente recebe o **fallback determinístico normal do estado** — os fatos do Core
estavam corretos, só a redação falhou. A mensagem de "problema técnico" fica reservada
aos estados que são de fato falha operacional (seção 6); nunca é usada para vestir um
erro de redação.

Isso torna a regra "nunca inventar horário" **verificável por programa**, não uma
esperança depositada no modelo.

## 5. Confirmação por significado

Regra do Gabriel: quando o Core está aguardando confirmação de uma **proposta
concreta**, qualquer concordância semanticamente clara vale — "ok", "fechado",
"concordo", "isso", "pode confirmar", "esse mesmo". Sem repertório fechado.

Fora desse contexto, "ok" solto **não** confirma agendamento.

**Persistência.** A proposta pendente viaja no mesmo jsonb que já guarda o contexto de
horários oferecidos (`estado_conversa.contexto_horarios`, coluna já escrita e ainda não
aplicada em nenhum projeto):

```ts
interface ContextoHorarios {
  horarios?: string[];                                    // agora OPCIONAL
  proposta_pendente?: { data: string; horario: string };
  criado_em: string;
}
```

`horarios` passa a ser opcional porque uma proposta pendente existe **sem** lista de
horários: quando o Core propõe um horário específico, não há mais opções em aberto.

**Validação** (mantém o regime "falha aberta" já usado — valor malformado vira `null`,
nunca lança):
- aceita quando existir **pelo menos um** dos dois: `horarios` válido e não vazio, ou
  `proposta_pendente` válida;
- se `horarios` estiver presente, continua sendo array não vazio de strings;
- um snapshot sem nenhum dos dois é inválido — vira `null`, nunca um objeto vazio.

**Envio à IA interpretadora:**
- `horarios_oferecidos` é enviado **somente** quando `horarios` existir e tiver
  elementos — nunca `[]`, nunca `null`. Lista ausente se representa pela ausência da
  chave;
- `proposta_pendente` é enviado no mesmo payload, como campo adicional — não uma segunda
  chamada.

**Ciclo de vida.** A ação `AcaoContextoHorarios` ganha um quarto tipo:

```ts
| { tipo: 'propor'; data: string; horario: string }
```

- decisão `aguardando_confirmacao` → **`propor`**. Substitui o snapshot **por inteiro**
  por `{ proposta_pendente: { data, horario }, criado_em }`. Não preserva `horarios`
  antigos, não faz merge — a lista anterior deixou de valer no instante em que virou uma
  proposta concreta;
- as demais decisões seguem a tabela já definida (`substituir` / `preservar` / `limpar`),
  sem alteração;
- gravação pelo mesmo mecanismo de CAS já implementado, com o mesmo comportamento em
  falha: abandona, não relê, não faz retry;
- nenhuma migration nova: os dois campos cabem dentro da coluna jsonb já prevista.

## 6. Falha da chamada de redação

A IA redatora pode falhar (timeout, erro de rede, texto reprovado pela guarda). Nesse
caso, o Core cai no texto fixo de `gerar-resposta-paciente.ts`, que **permanece no
código como paraquedas** — nunca mais como caminho normal.

Dos 9 estados que hoje não têm texto fixo, 3 são conversa normal, não falha — usar o
mesmo fallback de falha técnica ali apresentaria um problema que não existiu. Cada um
recebe frase própria, determinística, a partir do mesmo estado/fatos do Core:

| Estado | Fallback |
|---|---|
| `aguardando_escolha_dentista` | pergunta qual dentista o paciente prefere |
| `cadastro_necessario` | informa que precisa completar o cadastro antes de confirmar |
| `sem_dentista_disponivel` | informa que não encontrou profissional apto e oferece Consulta/Avaliação |

Os 6 estados restantes (falha real: catálogo, configuração, reserva) usam uma única
frase honesta de falha técnica, distinta de "não entendi" — erro do sistema nunca é
apresentado como confusão do paciente.

**A Iris nunca fica calada:** ou o texto natural, ou um dos fallbacks acima. Nunca
`null`.

**Compatibilidade com a implementação parada de `contexto_horarios`.** A migration e o
código escritos em 2026-08-05 (não aplicados, não deployados) definiram
`aguardando_confirmacao` como decisão que **limpa** o snapshot. Esta spec exige o
oposto: essa decisão usa `propor`. É a única mudança de ciclo de vida necessária —
coluna, CAS, leitura, envio à interpretadora e todo o resto da implementação são
reaproveitados sem alteração.

Pontos concretos a alterar em `contexto-horarios.ts`:
- mover `case 'aguardando_confirmacao'` do bloco `limpar` para a nova ação `propor`;
- **reescrever o comentário de bloco imediatamente abaixo do `switch`** (hoje nas linhas
  76–82), que afirma explicitamente o comportamento contrário — *"`aguardando_confirmacao`
  NAO aparece aqui de proposito... gravar snapshot seria duplicar um dado que ela ja
  tem. 'esse mesmo' continua funcionando por esse caminho, sem snapshot."* Esse
  raciocínio foi invalidado pela evidência: a interpretadora recebe `dados_atuais`, mas
  não sabe que aquele horário é uma **proposta aguardando resposta**, e é exatamente
  essa diferença que faz "esse mesmo" falhar hoje. Comentário desatualizado que afirma
  o oposto do código é pior que nenhum comentário;
- ajustar o teste correspondente em `contexto-horarios.test.ts` (uma asserção).

## 7. Cenários obrigatórios de teste

**Determinísticos (sem IA):**
- mapeamento `DecisaoOrquestrador` → `objetivo`, um caso por tipo, exaustivo;
- `FatosAutorizados` nunca contém frase pronta, ID interno, telefone ou dado cadastral;
- guarda reprova horário fora de `horarios_disponiveis`/`proposta_pendente`/
  `agendamento_confirmado`; aprova horário vindo de qualquer uma das três;
- guarda normaliza antes de comparar: com `["14:00"]` autorizado, as redações "14h",
  "14:00" e "14 horas" são **todas aprovadas**; "15h" é reprovada;
- guarda não reprova números dentro de `DD/MM` ou `DD/MM/AAAA`;
- guarda reprova "está marcado" sem `agendamento_confirmado`;
- texto reprovado nunca é editado — é descartado inteiro e cai no fallback;
- reprovação da guarda produz **fallback determinístico do estado**, nunca a mensagem
  de "problema técnico", e registra a falha internamente;
- falha da redatora cai no fallback correspondente e nunca devolve `null`;
- os 3 estados de conversa normal (`aguardando_escolha_dentista`, `cadastro_necessario`,
  `sem_dentista_disponivel`) nunca caem no texto de falha técnica;
- ação `propor` substitui o snapshot por inteiro: um snapshot com `horarios` prévios,
  após `aguardando_confirmacao`, fica **só** com `proposta_pendente` — sem merge, sem
  `horarios` sobrando;
- validação aceita snapshot só com `horarios`, só com `proposta_pendente`, e rejeita
  (vira `null`) um sem nenhum dos dois ou com `horarios: []`;
- `horarios_oferecidos` nunca é enviado como `[]` — com snapshot que só tem
  `proposta_pendente`, a chave fica ausente do payload;
- CAS obsoleto não ressuscita snapshot apagado (teste já existente, reaproveitado).

**Contra a IA real (script avulso, mesmo padrão dos anteriores):**
- "quero limpeza e clareamento" → pergunta **qual dos dois**, nunca repete pergunta
  genérica, nunca escolhe;
- "estou com medo de dentista" → acolhe sem opinar clinicamente **e** retoma o
  agendamento;
- "que calor hoje" → responde naturalmente e retoma;
- "ok"/"fechado"/"esse mesmo" com `proposta_pendente` presente → confirma; mesmas
  palavras sem `proposta_pendente` → não confirma;
- escrita torta ("qero limpsa amanha d manha") → entende;
- **negativo:** com `horarios_disponiveis: ["14:00"]`, a resposta nunca cita 15:00;
- **negativo:** sem `agendamento_confirmado`, a resposta nunca diz que está marcado;
- **negativo:** "estou com dor de dente, o que pode ser?" → nunca diagnostica;
- **negativo:** "dia 15" sem `proposta_pendente`/`horarios_disponiveis` nunca é lido
  como horário 15:00.

## 8. Frases fixas substituídas

As **20** de `gerar-resposta-paciente.ts` deixam de ser o que o paciente vê e passam a
paraquedas de falha técnica. As **3** novas desta spec (seção 6) cobrem os estados de
conversa normal que hoje respondem `null`. O arquivo não é apagado; ganha as 3 frases
novas.

## 9. Fora desta V1

- cancelamento e remarcação — fazem parte das funções da Iris e entram em etapa
  própria, fora desta V1 por decisão do Gabriel;
- qualquer mudança em disponibilidade, reserva, RPC, painel ou banco;
- histórico completo de mensagens no payload;
- ferramentas/function-calling para a IA redatora — ela nunca executa nada;
- listas de respostas prontas de qualquer tipo.

## 10. O que a guarda cobre e o que não cobre

Este é o primeiro ponto do sistema em que um texto **não escrito por nós** chega ao
paciente.

A guarda da seção 4 cobre o objetivo e é verificável por programa: horário inventado,
afirmação falsa de reserva e texto vazio nunca passam. O que ela não cobre é tom e
adequação — isso se avalia lendo conversas, não por asserção automática.
