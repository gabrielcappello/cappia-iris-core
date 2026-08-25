# Cenários obrigatórios — índice canônico de aceite

**Status:** índice canônico da primeira entrega (novo agendamento). Este documento não
substitui as especificações: ele indexa, identifica e classifica os cenários que elas
já definem.

## Como usar

- **As specs em `../specs/` continuam sendo a fonte detalhada.** Quando este índice e uma
  spec divergirem, a spec prevalece e o índice é corrigido.
- **Esta matriz é o índice oficial de aceite.** Uma etapa de implementação só é
  considerada concluída quando os cenários aplicáveis a ela estiverem **automatizados e
  aprovados**.
- Um identificador nunca é reaproveitado. Cenário removido é marcado como retirado, não
  reciclado.
- Cenários agrupados sob um mesmo identificador compartilham o mesmo mecanismo e a mesma
  asserção essencial; a spec de origem detalha as variações.

## Níveis

| Nível | Significado |
|---|---|
| **U** | unitário — função pura ou módulo isolado, sem banco e sem rede |
| **I** | integração — módulo contra banco real ou dublê fiel, um fluxo por vez |
| **C** | concorrência — duas ou mais execuções simultâneas disputando o mesmo recurso |
| **S** | segurança — isolamento, PII, credenciais, autoridade |
| **E2E** | ponta a ponta — mensagem recebida até resposta enviada |

## Escopo

Novo agendamento (`../docs/06-roadmap.md`, passos 1–9) e a conversa básica ao redor dele.
Cancelamento, remarcação, consulta do próprio agendamento e atualização cadastral isolada
têm contratos parciais de persistência, mas **não** compõem o aceite desta entrega.

---

## 1. Identificação da clínica

Fonte: `novo-agendamento.md` §2, §3 · `docs/03-seguranca.md` · `persistencia-v1.md` §4

| ID | Cenário | Nível | Resultado esperado |
|---|---|---|---|
| CLI-01 | Clínica derivada da instância autenticada | I | `clinica_id` resolvido pelo servidor |
| CLI-02 | `clinica_id` enviado pelo paciente ou pela IA | S | Ignorado; nunca influencia a resolução |
| CLI-03 | Paciente existente por clínica + telefone | I | Localizado; dados conhecidos aproveitados |
| CLI-04 | Paciente inexistente por clínica + telefone | I | Tratado como novo; nenhuma linha criada ainda |
| CLI-05 | Duas clínicas atendidas simultaneamente | C | Nenhuma mistura de estado ou dado |

## 2. Deduplicação de mensagem

Fonte: `interpretacao-ia.md` ("Deduplicação e lease") · `persistencia-v1.md` §18

| ID | Cenário | Nível | Resultado esperado |
|---|---|---|---|
| DED-01 | Mesmo `message_id` entregue novamente | I | Não processa, não responde, não altera estado |
| DED-02 | Dois workers reivindicando a mesma mensagem inexistente | C | Exatamente um vencedor |
| DED-03 | `recebida → processando` | I | Claim emitido pelo servidor |
| DED-04 | `processando` com lease vigente | I | `nao_elegivel` |
| DED-05 | `processando` com lease expirado, marcador nulo | I | `reivindicada_interpretar` |
| DED-06 | `processando` com lease expirado, marcador preenchido | I | `reivindicada_resposta_fixa` |
| DED-07 | `concluida` ou `falhou` | I | `nao_elegivel`; nenhuma reinterpretação automática |
| DED-08 | Mesma chave com clínica ou telefone incompatível | S | `nao_elegivel`; nada substituído |
| DED-09 | Mesmo `message_id` em instâncias diferentes | I | Não se deduplicam entre si |
| DED-10 | Debounce de 3 segundos com mensagens consecutivas | I | Janela reiniciada a cada mensagem; um único turno |

## 3. Interpretação

Fonte: `interpretacao-ia.md` · `novo-agendamento.md` §4, §8

| ID | Cenário | Nível | Resultado esperado |
|---|---|---|---|
| INT-01 | Dados informados em qualquer ordem | U | Todos aproveitados; nenhum perdido |
| INT-02 | Campo ausente na nova mensagem | U | Valor anterior preservado |
| INT-03 | Correção explícita | U | Valor substituído |
| INT-04 | Dúvida real | U | Campo omitido; nunca adivinhado |
| INT-05 | Saída estrutural inválida | U | Rejeitada integralmente; sem aplicação parcial |
| INT-06 | `periodo` ou `intencao` fora do domínio | U | Rejeitado antes de qualquer persistência |
| INT-07 | Valor vazio em `informar` ou `corrigir` | U | Entrada inválida; nunca tratada como remoção |
| INT-08 | Campo repetido no contrato portátil | U | Rejeitado; nunca aplicado silenciosamente |
| INT-09 | Datas relativas preservadas como texto | U | IA nunca calcula ou normaliza data |
| INT-10 | Entrada acima do limite | U | Modelo não é chamado |
| INT-11 | **`dados_atuais` sem valores cadastrais** | **S** | Somente campos operacionais; nunca nome, CPF, nascimento ou e-mail |
| INT-12 | `campos_cadastrais_preenchidos` indica apenas presença | S | Nenhum valor cadastral no payload |
| INT-13 | Payload sem `clinica_id`, telefone, IDs, agenda, credenciais | S | Nenhum desses campos enviado ao modelo |
| INT-14 | `mensagens_atuais` sem histórico de turnos anteriores | S | Somente a janela atual |
| INT-15 | Persistência condicional com claim e CAS válidos | I | Exatamente uma persistência |
| INT-16 | CAS inválido | C | `conflito_concorrente`; nenhuma alteração |
| INT-17 | Saída vazia, idempotente ou só conflito | I | Marcador gravado; estado pode permanecer igual |
| INT-18 | Reclaim com marcador preenchido | I | Sem nova chamada ao modelo; resposta fixa |
| INT-19 | Rollback conjunto em qualquer falha | I | Nunca persistência parcial |
| INT-20 | Primeira resposta do modelo truncada; segunda completa | U | Uma única repetição; somente a segunda saída é aceita |
| INT-21 | Primeira resposta truncada; segunda falha tecnicamente por qualquer categoria (truncada de novo, timeout, indisponibilidade, etc.) | I | HTTP 200 com resposta determinística; paciente nunca fica sem resposta; log preserva a categoria real da segunda falha e sinaliza a primeira separadamente |
| INT-22 | Resposta truncada contém fragmento de ação | S | Fragmento integralmente descartado; nenhum efeito ou persistência parcial |
| INT-23 | Repetição após truncamento | I | Mesmo snapshot; no máximo uma ação operacional, sem duplicidade |

> INT-11 e INT-12 têm divergência conhecida no código atual, registrada em
> `interpretacao-ia.md` ("Divergência conhecida no código"). **Bloqueadores antes de
> qualquer tráfego real.**

**Cenários obrigatórios `INT-P4I-01` a `INT-P4I-14`** — decisão arquitetural `D2`,
CAS de `aplicar_interpretacao_condicional` sob `estado_conversa.versao`, especificação
documental em `interpretacao-ia.md` ("Operação de aplicação da interpretação sob CAS
por `estado_conversa.versao` (`P4I`)"), não implementada. Cobrem CAS com duas
transações concorrentes, alteração efetiva com invalidação atômica de derivados
(`ITC-29`), caminho sem alteração efetiva concorrente com checkpoint de composição,
marcador já preenchido com precedência sobre versão divergente, conflito de versão
com marcador ainda nulo, claim inválido, lease expirado, queda entre avanço de versão
e marcação da interpretação, continuação de composição tornada obsoleta por
interpretação concorrente fora da transição legítima (`ITC-40`/`ITC-41`),
concorrência com resultado final da composição, isolamento multiclínica, alteração
fora da allowlist canônica única, escrita legada por `atualizado_em` impedida após a
ativação da `P4I`, e validação de `versao_contrato_dados`. **Documentais, futuros,
não executáveis — nenhum somado à suíte oficial** (permanece 730 testes, 725
aprovados, 5 pulados, 0 falhas).

## 4. Eventos candidatos

Fonte: `eventos-conversacionais-v1.md`

| ID | Cenário | Nível | Resultado esperado |
|---|---|---|---|
| EVT-01 | Candidato nunca é decisão aceita | U | `DecisaoControlador` só é produzida pelo Core |
| EVT-02 | `eventos_candidatos: []` | U | Saída válida; nenhuma inferência livre |
| EVT-03 | Evento repetido ou tipo desconhecido | U | Saída estrutural inválida |
| EVT-04 | `referencia_textual` só em `aceitar_opcao` | U | Nunca resolvida para ID pela IA |
| EVT-05 | Referência ambígua entre opções | U | `solicitar_esclarecimento`; nenhuma escolha registrada |
| EVT-06 | Candidato incompatível com o estado | U | Ignorado; nunca convertido em outro evento |
| EVT-07 | Candidato ignorado em mensagem futura | U | Não reaproveitado |
| EVT-08 | `confirmar_resumo` com alteração invalidante | U | Recusado, mesmo com texto explícito |
| EVT-09 | Ausência de `confidence` na saída | U | Nenhum score em nenhum nível |

## 5. Controlador e transições

Fonte: `controlador-conversacional-v1.md` · `novo-agendamento.md` §19

| ID | Cenário | Nível | Resultado esperado |
|---|---|---|---|
| CTR-01 | Seis estados canônicos | U | Nenhum estado fora do conjunto aprovado |
| CTR-02 | Transições aprovadas com pré-condição | U | Nenhuma transição sem condição satisfeita |
| CTR-03 | Alterações avaliadas antes dos eventos | U | Ordem fixa respeitada |
| CTR-04 | `confirmar_resumo` junto com alteração invalidante | U | Invalida contexto; nunca entra em `executando` |
| CTR-05 | Correção cadastral em `aguardando_confirmacao` | U | Escolha preservada; resumo e confirmação invalidados |
| CTR-06 | Alteração de procedimento | U | Invalida dentistas, duração, opções, escolha, resumo |
| CTR-07 | Alteração de dentista | U | Invalida opções e escolha; **duração permanece** |
| CTR-08 | Alteração de data, período ou horário | U | Invalida derivados temporais; preserva procedimento |
| CTR-09 | `desistir` explícito | U | Encerra ação; preserva cadastro; volta a `atendimento` |
| CTR-10 | Candidatos incompatíveis na mesma mensagem | U | Esclarecimento; nunca escolha silenciosa |
| CTR-11 | `solicitar_nova_opcao` + `aceitar_qualquer_profissional` | U | Sinal composto: remove preferência, recalcula entre todos os aptos, um por vez |
| CTR-12 | `aceitar_qualquer_profissional` isolado em `aguardando_escolha` | U | Ignorado |
| CTR-13 | Estado `executando` com qualquer candidato | U | Nenhuma nova transição iniciada |
| CTR-14 | Estado `concluido` com nova confirmação | U | Retorna o resultado existente; nada criado |
| CTR-15 | Queda após interpretação persistida | I | Sem nova chamada ao modelo; sem reconstrução de conflitos |

## 6. Procedimento

Fonte: `procedimentos-v1.md` · `novo-agendamento.md` §5

| ID | Cenário | Nível | Resultado esperado |
|---|---|---|---|
| PRO-01 | Aliases distintos para o mesmo procedimento | U | Mesmo `procedimento_id` |
| PRO-02 | Normalização fechada (4 transformações) | U | Nenhuma transformação adicional |
| PRO-03 | Texto sem correspondência | U | Não resolvido |
| PRO-04 | Procedimento inativo com alias correspondente | U | Não resolvido; existência não revelada |
| PRO-05 | Alias duplicado na mesma clínica | U | Erro de catálogo; runtime nunca escolhe nem pergunta |
| PRO-06 | Mesmo alias em clínicas diferentes | S | IDs distintos; sem conflito |
| PRO-07 | Consulta/Avaliação por pedido direto | U | Resolve normalmente |
| PRO-08 | Unicidade de `eh_consulta_avaliacao` por clínica | U | No máximo um por clínica |
| PRO-09 | **Catálogo nunca enviado à IA** | S | Payload sem lista de procedimentos; IA nunca retorna `procedimento_id` |

## 7. Dentistas e vínculos

Fonte: `dentistas-vinculos-v1.md` · `novo-agendamento.md` §6

| ID | Cenário | Nível | Resultado esperado |
|---|---|---|---|
| DEN-01 | Exatamente um apto | U | Segue direto; nenhuma pergunta de preferência |
| DEN-02 | Vários aptos sem preferência | U | Pergunta feita |
| DEN-03 | Zero aptos | U | Avalia fallback conforme §12 |
| DEN-04 | Dentista, procedimento ou vínculo inativo | U | Sem aptidão; três eixos independentes |
| DEN-05 | Dentista inexistente, inativo ou sem vínculo | U | Mesmo tratamento ao paciente; motivo distinto na auditoria |
| DEN-06 | Colisão entre entradas de resolução | U | Erro de configuração; nunca desempate por ID/ordem/status |
| DEN-07 | "Dra. Ana" e "Ana" | U | Entradas diferentes; nenhuma resolve a outra |
| DEN-08 | Vínculo cruzando clínicas | S | Inválido |
| DEN-09 | Ausência de preferência | U | Nunca equivale a "qualquer profissional" |
| DEN-10 | Consulta/Avaliação sem dentista apto | U | Não reoferece; não cria ciclo; não consulta disponibilidade |

## 8. Duração

Fonte: `duracao-v1.md` · `novo-agendamento.md` §7

| ID | Cenário | Nível | Resultado esperado |
|---|---|---|---|
| DUR-01 | Duração configurada válida | U | Resolve normalmente |
| DUR-02 | Dois dentistas aptos, mesmo procedimento | U | Mesma duração para ambos |
| DUR-03 | Duração ausente na clínica | U | Falha fechada |
| DUR-04 | Zero, negativa, fracionada, não numérica, <10, >240, não múltipla de 10 | U | Falha fechada; nenhuma correção automática |
| DUR-05 | Falha de duração | U | Não oferece Consulta/Avaliação, não reclassifica aptidão, não consulta disponibilidade |
| DUR-06 | Configuração de outra clínica | S | Nunca consultada |
| DUR-07 | Troca de dentista, mesmo procedimento | U | Duração preservada |
| DUR-08 | Alteração do valor oficial após opções apresentadas | I | Derivados invalidados |
| DUR-09 | Snapshot histórico após mudança de configuração | I | Inalterado |

## 9. Disponibilidade

Fonte: `disponibilidade.md`

| ID | Cenário | Nível | Resultado esperado |
|---|---|---|---|
| DIS-01 | Intervalo menor que a duração | U | Nenhuma opção |
| DIS-02 | Intervalo igual à duração | U | Somente o início |
| DIS-03 | Intervalo curto (≤120) | U | Início e último início possível |
| DIS-04 | Intervalo amplo (>120) | U | Grade hora a hora com ajuste do fim |
| DIS-05 | Seis exemplos canônicos de 08:00–12:00 | U | Conforme tabela da §6 |
| DIS-06 | Caso degenerado 08:00–11:00 com D150 | U | 08:00 e 08:30; início real preservado |
| DIS-07 | Minutos quebrados 08:10 / 08:20 / 08:30 / 08:40 | U | Grade retorna à hora cheia; não se propagam |
| DIS-08 | 15:10–18:00 com D40 | U | 15:10, 16:00, 17:20 |
| DIS-09 | Durações 10, 20, 40, 60, 90, 120, 150, 240 | U | Passo hora a hora independente da duração |
| DIS-10 | Adjacência no começo e no fim | U | Válida; `[início, fim)` semiaberto |
| DIS-11 | Horário exato livre fora da grade | U | Oferecido |
| DIS-12 | Horário exato ocupado | U | Anterior e/ou posterior mais próximos |
| DIS-13 | Fronteiras de período 12:00 / 12:10 / 18:00 | U | Manhã / tarde / noite |
| DIS-14 | "Antes das 11h" e "preciso terminar até 11h" | U | Intenções distintas |
| DIS-15 | Período solicitado: todas as opções | U | Sem cap, paginação ou truncamento |
| DIS-16 | **Data específica sem disponibilidade** | U | Informa e pergunta; **não avança sozinho** |
| DIS-17 | **Próxima disponibilidade** | U | Avança cronologicamente até a primeira data real |
| DIS-18 | Várias semanas sem disponibilidade | U | Não é resultado final de indisponibilidade |
| DIS-19 | Dentista específico | U | Sem troca silenciosa |
| DIS-20 | Qualquer profissional | U | Um dentista por vez; listas nunca misturadas |
| DIS-21 | Google ausente, válido, inválido, ou válido que passa a falhar | I | Agenda Cappia nunca bloqueada; nada inventado |
| DIS-22 | Horário passado | U | Nunca oferecido |

## 10. Escolha e versões

Fonte: `controlador-conversacional-v1.md` §9, §10 · `persistencia-v1.md` §17

| ID | Cenário | Nível | Resultado esperado |
|---|---|---|---|
| ESC-01 | Escolha resolve exatamente uma opção vigente | U | Registrada com dentista, data, horário e duração |
| ESC-02 | Nova apresentação de opções | U | Nova versão lógica; anterior invalidada |
| ESC-03 | Nova escolha | U | Invalida resumo e confirmação anteriores |
| ESC-04 | Opção obsoleta | U | Recusada; nunca promovida |
| ESC-05 | Opção não é reserva nem agendamento | U | Nenhum efeito operacional antes da confirmação |

## 11. Cadastro

Fonte: `novo-agendamento.md` §12 · `persistencia-v1.md` §5

| ID | Cenário | Nível | Resultado esperado |
|---|---|---|---|
| CAD-01 | Cadastro pedido só após horário escolhido | U | Nunca antes |
| CAD-02 | Somente dados obrigatórios faltantes | U | Nada já conhecido é pedido de novo |
| CAD-03 | Validação de nome, nascimento e e-mail | U | Conforme regras da §12 |
| CAD-04 | Validação de CPF | U | 11 dígitos, verificadores válidos, sequências repetidas rejeitadas |
| CAD-05 | E-mail só quando a clínica exige | U | Opcional caso contrário |
| CAD-06 | Atualização parcial | I | Só campos vazios ou corrigidos; nenhum dado apagado |
| CAD-07 | Conflito concorrente de atualização | C | CAS recalcula; dado do painel nunca sobrescrito |

## 12. Confirmação

Fonte: `eventos-conversacionais-v1.md` §5 · `novo-agendamento.md` §13

| ID | Cenário | Nível | Resultado esperado |
|---|---|---|---|
| CNF-01 | Resumo apresentado antes da criação | U | Sempre |
| CNF-02 | Dez gates de `autorizar_confirmacao_resumo` | U | Todos simultâneos |
| CNF-03 | Resposta ambígua | U | Não autoriza criação |
| CNF-04 | Correção após o resumo | U | Novo resumo e nova confirmação |
| CNF-05 | Confirmação vinculada, nunca booleana | I | Mensagem, versão da escolha, versão do resumo, ação e instante |
| CNF-06 | Versão da escolha diferente da usada no resumo | U | Confirmação recusada |

## 13. Criação

Fonte: `novo-agendamento.md` §14, §15 · `persistencia-v1.md` §8, §9, §23

| ID | Cenário | Nível | Resultado esperado |
|---|---|---|---|
| CRI-01 | Criação após confirmação válida | I | Um paciente, um agendamento, um resultado |
| CRI-02 | Revalidação antes da criação | I | Interna; sem novo turno de conversa |
| CRI-03 | Horário ocupado na revalidação | I | Não cria; volta a `aguardando_escolha` |
| CRI-04 | Paciente novo e primeiro agendamento | I | Mesma transação; nenhum paciente órfão |
| CRI-05 | Snapshots de nome capturados na criação | I | Das fontes oficiais; nunca do texto do paciente |
| CRI-06 | `fim = início + duração` | I | Sempre coerente |
| CRI-07 | Sucesso anunciado só após resultado oficial | E2E | Nunca antes |

## 14. Persistência

Fonte: `persistencia-v1.md`

| ID | Cenário | Nível | Resultado esperado |
|---|---|---|---|
| PER-01 | Cinco entidades lógicas | I | Nenhuma entidade extra para opção, histórico ou remarcação |
| PER-02 | CPF não nulo único na clínica | I | Segundo cadastro rejeitado |
| PER-03 | Mesmo CPF em clínicas diferentes | S | Ambos válidos |
| PER-04 | CPF existente com outro telefone | I | Localiza pelo CPF; não cria segundo paciente |
| PER-05 | Paciente aceita atualizar telefone | I | Substituição integral; histórico preservado |
| PER-06 | Paciente recusa atualizar telefone | I | Telefone anterior mantido; agendamento segue |
| PER-07 | Novo telefone pertence a outro paciente | I | Transferência excepcional; sem fusão; sem mover agendamentos |
| PER-08 | Cadastro anterior após transferência | I | Sem telefone oficial; ressalva técnica registrada; histórico intacto |
| PER-09 | Snapshot após renomear procedimento ou dentista | I | Inalterado |
| PER-10 † | Snapshots na remarcação | I | Antigo mantém os seus; novo captura frescos |
| PER-11 | Transições de status a partir de `confirmado` | I | Quatro destinos; nenhuma saída de terminal |
| PER-12 | `concluido → faltou` e `faltou → concluido` | I | Rejeitados; nunca tratados como idempotentes |
| PER-13 | Status terminal sem autoria | I | Rejeitado |
| PER-14 | Autoria por dentista, equipe, painel e Iris | I | "Quem" e "de onde" distintos; Iris exige referência da operação |
| PER-15 † | Cancelamento | I | Libera slot; preserva dados; registra autoria |
| PER-16 † | Cancelamento sobre outro status terminal | I | Rejeitado |
| PER-17 † | Remarcação completa | I | Antigo `remarcado`, novo `confirmado`, atômico |
| PER-18 † | Rollback integral da remarcação | I | Antigo intacto; novo inexistente; sem liberação parcial |
| PER-19 | Histórico sem tabela duplicada | I | Derivado dos próprios agendamentos |
| PER-20 | Nenhuma exclusão em operação normal | I | Nenhum `DELETE` no caminho do Core |

## 15. Idempotência

Fonte: `persistencia-v1.md` §21 · `novo-agendamento.md` §15

| ID | Cenário | Nível | Resultado esperado |
|---|---|---|---|
| IDE-01 | Mesma confirmação repetida | I | Retorna o resultado existente |
| IDE-02 | Mesma ação com outro `message_id` | I | Mesma chave; no máximo um efeito |
| IDE-03 | Nova ação legítima semelhante | I | Nova identidade; cria normalmente |
| IDE-04 | Mesmo paciente, dois horários no mesmo dia | I | Ambos criados |
| IDE-05 | Mesmo paciente, procedimentos diferentes | I | Ambos criados |
| IDE-06 | Chave nunca é paciente + dentista + data + horário | U | Identidade derivada da decisão autorizadora |
| IDE-07 | Chave produzida pelo Core | S | Nenhum componente vindo da IA |
| IDE-08 † | Cancelamento repetido | I | Mesmo resultado; autoria e instante intocados |
| IDE-09 † | Remarcação repetida | I | Retorna o novo já criado; sem terceiro registro |
| IDE-10 | `concluida` sem efeito | I | Impossível |

### † Cobertura futura — cancelamento e remarcação

Os sete cenários marcados com **†** acima (PER-10, PER-15, PER-16, PER-17, PER-18,
IDE-08, IDE-09) testam os contratos de cancelamento e remarcação já definidos em
`persistencia-v1.md` §11, §13, §14 e §21.

- **Cobertura futura, não aplicável ao aceite da primeira entrega do novo agendamento.**
  O fluxo de novo agendamento nunca produz `cancelado` nem `remarcado` — só
  `confirmado`. Esses sete cenários exercitam operações que só existem quando
  cancelamento e remarcação forem especificados como fluxos conversacionais próprios
  (`../docs/06-roadmap.md`).
- **Não bloqueiam o encerramento desta etapa.** A ausência de automação desses sete
  cenários não impede considerar concluída a implementação do novo agendamento.
- **Serão ativados quando as specs de cancelamento e remarcação forem aprovadas** —
  `atendimento-v1.md` §9 já registra que a redação completa desses fluxos está fora do
  escopo desta v1.
- **Os contratos lógicos da Persistência v1 continuam válidos hoje** — nada nesta nota
  reabre ou enfraquece `persistencia-v1.md` §13/§14. A marcação é sobre **quando** o
  cenário é automatizado, não sobre a validade do contrato que ele testa.
- **A presença desses IDs na matriz não autoriza implementação antecipada** de
  cancelamento ou remarcação. Ver `../docs/06-roadmap.md`: cada fluxo posterior é
  implementado um por vez, com aprovação própria.

Os IDs são preservados; nenhum cenário foi removido.

## 16. Concorrência

Fonte: `persistencia-v1.md` §22, §23 · `interpretacao-ia.md`

| ID | Cenário | Nível | Resultado esperado |
|---|---|---|---|
| CNC-01 | Duas confirmações concorrentes | C | Abertura única; um efeito |
| CNC-02 | Dois cadastros concorrentes com o mesmo CPF | C | Um paciente; perdedor entra no protocolo conversacional |
| CNC-03 | Dois `message_id` sobre o mesmo snapshot | C | Um CAS vence; o outro recebe conflito |
| CNC-04 | Duas retomadas simultâneas | C | Um único vencedor por CAS |
| CNC-05 | Reclaim entre pré-verificação e persistência | C | Worker antigo não grava |

## 17. Sobreposição

Fonte: `persistencia-v1.md` §11 · `disponibilidade.md` §3

| ID | Cenário | Nível | Resultado esperado |
|---|---|---|---|
| SOB-01 | Dois pacientes, mesmo dentista e intervalo | C | Um cria; o outro invalida e recalcula |
| SOB-02 | Dois dentistas no mesmo horário | I | Ambos criam |
| SOB-03 | Sobreposição parcial | I | Rejeitada |
| SOB-04 | Intervalo inteiramente contido | I | Rejeitado |
| SOB-05 | Adjacência nas duas bordas | I | Permitida |
| SOB-06 | Horário ocupado entre oferta e confirmação | C | Falha definitiva; nova escolha exigida |
| SOB-07 | Somente `confirmado` bloqueia | I | `cancelado` e `remarcado` liberam |
| SOB-08 | Histórico não bloqueia agenda futura | I | `concluido` e `faltou` não impedem reaproveitamento |

## 18. Retenção

Fonte: `persistencia-v1.md` §19

| ID | Cenário | Nível | Resultado esperado |
|---|---|---|---|
| RET-01 | Conteúdo bruto antes de 7 dias | I | Disponível |
| RET-02 | Conteúdo bruto após 7 dias | I | Removido ou irrecuperável |
| RET-03 | Linha e identificadores após a remoção | I | Preservados |
| RET-04 | Reentrega tardia após a expiração | I | Continua deduplicada |
| RET-05 | Mensagem expirada ainda em `processando` | I | Conteúdo removido; inelegível para nova interpretação |
| RET-06 | Limpeza repetida | I | Idempotente; nenhuma alteração indevida |
| RET-07 | Fatos operacionais | I | Nunca apagados pela retenção |

## 19. Logs

Fonte: `persistencia-v1.md` §20 · `docs/03-seguranca.md`

| ID | Cenário | Nível | Resultado esperado |
|---|---|---|---|
| LOG-01 | Nenhuma mensagem bruta em log | S | Nunca |
| LOG-02 | Nenhum CPF, telefone, nome, nascimento ou e-mail | S | Nem mesmo parcialmente mascarados |
| LOG-03 | Nenhuma credencial ou token completo de claim | S | Nunca |
| LOG-04 | Nenhum payload integral | S | Somente metadados estruturais |
| LOG-05 | Correlator HMAC estável na mesma clínica | S | Mesmo valor para a mesma versão de chave |
| LOG-06 | Correlator distinto entre clínicas | S | `clinica_id` na entrada do HMAC |
| LOG-07 | Rotação de versão da chave | S | Novo correlator; nenhum dígito exposto |
| LOG-08 | Erros do fluxo de interpretação | S | Sem PII e sem texto do paciente |

## 20. Retomada

Fonte: `persistencia-v1.md` §22, §24

| ID | Cenário | Nível | Resultado esperado |
|---|---|---|---|
| RTM-01 | Abertura única da operação | C | Um vencedor; estado `iniciada` |
| RTM-02 | Retomada antes de 5 minutos | C | Rejeitada |
| RTM-03 | Retomada depois de 5 minutos | I | Mesma identidade; claim rotacionado |
| RTM-04 | Efeito já existente na retomada | I | Reconhece e retorna o resultado |
| RTM-05 | Efeito inexistente na retomada | I | Continua a mesma operação |
| RTM-06 | Queda entre abertura e efeito | I | Permanece `iniciada` |
| RTM-07 | Queda durante a transação de efeito | I | Rollback integral; permanece `iniciada` |
| RTM-08 | Erro transitório | I | Mantém `iniciada` |
| RTM-09 | Erro definitivo | I | `falhou`, só após rollback assegurado |
| RTM-10 | Retomada sem nova mensagem do paciente | I | Conversa não fica presa; nenhuma operação nova criada |

## 21. Multiclínica

Fonte: `persistencia-v1.md` §4 · `docs/03-seguranca.md`

| ID | Cenário | Nível | Resultado esperado |
|---|---|---|---|
| MUL-01 | Identificador de outra clínica | S | Tratado como inexistente, nunca como acesso negado |
| MUL-02 | Referência cruzada entre clínicas | S | Rejeitada |
| MUL-03 | Mesmo telefone em clínicas diferentes | S | Sem conflito |
| MUL-04 | Mesmo CPF em clínicas diferentes | S | Sem conflito |
| MUL-05 | Isolamento de dados, conversas e claims | S | Nenhum vazamento entre clínicas |
| MUL-06 | RLS não é a única proteção do servidor | S | Isolamento também por origem, predicado e estrutura |

## 22. Atendimento e redação

Fonte: `atendimento-v1.md` §8

| ID | Cenário | Nível | Resultado esperado |
|---|---|---|---|
| ATD-01 | Nenhum fato inventado | U | Toda entidade citada está nos fatos autorizados |
| ATD-02 | Nenhuma autoridade operacional | U | A camada não decide, não escolhe, não executa |
| ATD-03 | Nenhuma confirmação falsa | E2E | Sucesso só após resultado oficial |
| ATD-04 | Dentista único | U | Sem pergunta de preferência e sem anúncio redundante |
| ATD-05 | Vários aptos | U | Pergunta feita; silêncio não vira "qualquer profissional" |
| ATD-06 | Nenhum dentista apto | U | Fallback só nas quatro condições; nunca reoferecido |
| ATD-07 | Procedimento não reconhecido | S | Catálogo nunca listado nem sugerido |
| ATD-08 | Catálogo inválido | U | Nenhuma escolha pedida ao paciente |
| ATD-09 | Falhas diferenciadas | U | Transitória, definitiva e em andamento não se confundem |
| ATD-10 | Correções preservam o que continua válido | U | Cadastral mantém escolha; operacional exige nova escolha |
| ATD-11 | Conversa básica | U | Não avança etapa nem coleta dado |
| ATD-12 | Informação da clínica | U | Nunca inventada sem fato autorizado |
| ATD-13 | Nenhum identificador interno no texto | S | Sem IDs, versões ou JSON operacional |
| ATD-14 | Idioma | U | Sempre português do Brasil |

---

## Cobertura fora desta matriz

Estes cenários pertencem a especificações canônicas, mas **não compõem o aceite da
primeira entrega**, por dependerem de contratos ainda não escritos:

- transporte e Edge Function: janela máxima, quantidade máxima de mensagens por turno,
  limites de payload, entrada autenticada, envio idempotente ou outbox, política de
  resposta (o debounce de 3 segundos **já está decidido** e é coberto por DED-10);
- cancelamento, remarcação, consulta do próprio agendamento e atualização cadastral
  isolada como fluxos conversacionais completos;
- painel e apps: identidades de usuário, autenticação e compatibilidade com as mesmas
  invariantes de persistência;
- auditoria do legado (`disponibilidade.md` §19, `persistencia-v1.md` §28);
- integração entre o resolvedor temporal (já publicado e implementado) e a composição
  determinística (ainda apenas especificada) — cenários `ITC-01` a `ITC-53`, índice
  completo em `../specs/integracao-temporal-composicao-v1.md` §21; nenhum implementado
  nesta rodada, mesma disciplina de não duplicação já aplicada aos cenários `COMP-*`
  (`composicao-novo-agendamento-v1.md` §22) e `TMP-*`
  (`resolvedor-temporal-v1.md` §27);
- persistência física e idempotência concreta da composição (`P4`, especificação
  documental, não implementada) — cenários `P4T-01` a `P4T-23`, índice completo em
  `../specs/persistencia-fisica-composicao-v1.md` §17; cobrem deduplicação simultânea e
  pós-conclusão, payload divergente, conflito de versão, atomicidade das duas
  transações, quedas e retomadas, replay sem máquina, concorrência válida divergente,
  isolamento multiclínica, continuação superada, logs sem PII e o ciclo de retenção de
  30 dias. Nenhum implementado nesta rodada; **nenhum soma à suíte oficial atual** —
  são contagens em domínios diferentes, mesma disciplina dos demais prefixos acima;
- implementação técnica da persistência da composição (`P4I`, especificação técnica
  documental, não implementada) — cenários `P4IT-01` a `P4IT-30`, índice completo em
  `../specs/implementacao-persistencia-composicao-v1.md` §24.2, que também converte os
  `P4T-01` a `P4T-23` acima em matriz de implementação futura (camada, fixture, ação,
  concorrência ou falha simulada, resultado esperado e invariante provada) **sem
  renumerar nenhum deles**. `P4IT-01` a `P4IT-13` cobrem criação concorrente do estado
  inicial, lease no limite, worker antigo com token rotacionado, FK cruzada entre
  clínicas, tentativa de mutação de resultado, limpeza concorrente, versão de contrato
  JSONB desconhecida, falha injetada em cada etapa da transação final, aplicação e
  rollback **da parcela aditiva** da migration em ambiente descartável — nunca da
  troca da constraint de deduplicação, coberta à parte por `P4IT-14`/`P4IT-15`/
  `P4IT-29`/`P4IT-30` —, resultado antes e depois de 30 dias, deduplicação
  sem replay completo e proibição de recomposição após a expiração do payload
  (`P4I-R1`). `P4IT-14` a `P4IT-26` cobrem a substituição controlada da constraint de
  deduplicação, o backfill comprovável das linhas existentes (canal, fingerprint
  ausente, conversa não derivável), o bloqueio de promoção por linha incompatível, o
  reclaim da mensagem com e sem interpretação persistida, o worker antigo perdendo
  autoridade após a rotação do token, e a correlação `requisicao_id` → efeito
  (preparatória compatível, classe incompatível, tentativa de troca na
  reapresentação). `P4IT-27` a `P4IT-30`, acrescentados nesta rodada, cobrem o
  enforcement físico da coorte contratual (`versao_contrato_registro` e o `CHECK`
  condicional que a impõe): linha histórica com campos legitimamente nulos convivendo
  com mensagem `P4I` nova sempre completa; promoção de linha histórica exigindo
  backfill integral, nunca parcial; e a distinção entre rollback compatível da
  constraint antiga (nenhuma linha depende de `canal` para se distinguir) e rollback
  incompatível bloqueado (existe tráfego real que só a chave nova distingue, caso em
  que o rollback estrutural é proibido e a reversão é só operacional, por flag).
  Nenhum implementado nesta rodada; **nenhum soma à suíte oficial atual** — mesma
  disciplina de não duplicação e de contagem separada aplicada
  a todos os prefixos acima.
