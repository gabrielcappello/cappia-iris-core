# Mapa do Supabase — 2026-08-18

Levantado com consultas ao banco e cruzamento com o código dos dois
repositórios (`iris-portal-v2`, `cappia-iris-core`). Tudo aqui é dado lido,
não suposição.

## 1. Quantos projetos existem, e para que serve cada um

| Projeto | Ref | Tabelas | Papel |
|---|---|---|---|
| gabrielcappello's Project | `udizowyfjnhuhgxkeayk` | 36 | **PRODUÇÃO** — painel, Iris e WhatsApp |
| cappia-iris-core-dev | `bcmuqautblvjdqzhjfbw` | 7 | Teste isolado (RPCs transacionais) |

**Não estamos usando os dois em produção.** O painel referencia
`udizowyfjnhuhgxkeayk` em 17 pontos do código e nenhum ponto referencia o
dev. O `bcmuqautblvjdqzhjfbw` só é tocado por testes manuais (as provas de
concorrência A×B das RPCs V2).

O nome "core iris" para o dev confunde: ele não é o novo, é o laboratório.
O operacional é o de nome genérico.

## 2. Tabelas em uso (31 de 36)

Contagem = arquivos que citam a tabela.

### Núcleo do atendimento
| Tabela | Painel | Core | Linhas |
|---|---|---|---|
| `clinicas` | 20 | 40 | 2 |
| `agendamentos` | 15 | 62 | 1 |
| `pacientes` | 19 | 25 | 1 |
| `estado_conversa` | 0 | 59 | 1 |
| `horarios_bloqueados` | 2 | 4 | 0 |

`estado_conversa` é exclusiva do Core (memória da conversa); o painel não a lê.

### Catálogo global (sem clinica_id)
`procedimentos_catalogo` (46), `especialidades_catalogo` (10),
`paises_config` (83), `anamnese_perfis` (4).

### Odontograma
`odontograma_dentes` (32), `odontograma_achados_catalogo` (19),
`odontograma_observacoes` (2), `odontograma_consultas` (0),
`odontograma_periodontal` (0) — só painel.

### Financeiro
`financeiro_orcamentos` (7), `financeiro_orcamento_itens` (13),
`planos_tratamento` (3), `financeiro_lancamentos` (0) — só painel.

### Fila / mensageria / legado n8n
`mensagens_fila` (12), `acoes_pendentes` (3), `acoes_outbox` (0),
`comandos_remarcacao` (0), `remarcacoes_pendentes` (0),
`conversas_manuais` (0), `mensagens_manuais` (0), `n8n_chat_histories` (0),
`whatsapp_presenca` (2), `clinicas_eventos_conexao` (0),
`lembretes_envios` (2).

### Acesso
`usuarios` (2), `password_resets` (6).

## 3. Tabelas SEM uso — candidatas a remoção (5)

Nenhuma menção em `iris-portal-v2/src`, `cappia-iris-core/src` ou
`supabase/functions`:

| Tabela | Linhas | Observação |
|---|---|---|
| `cilindros_upa_tanks` | 8 | **Outro produto** (gás/cilindros), não é odontologia |
| `cilindros_upa_readings` | 3 | idem |
| `cilindros_upa_relatorios` | 2 | idem |
| `_backup_dentistas_20260813` | 1 | Backup pontual |
| `_backup_tempos_cappia_20260714` | 3 | Backup pontual |

As três `cilindros_upa_*` não têm relação com a Cappia — parecem de outro
projeto que compartilhou o banco. As duas `_backup_*` também aparecem no
advisor de segurança (RLS desabilitada).

**Antes de apagar**: confirmar com Gabriel se `cilindros_upa_*` pertence a
outro produto ativo.

## 4. Funções: 56, com duas duplicadas

`cappia_outbox_reivindicar_google_calendar` e
`cappia_outbox_reivindicar_notificacao` existem em **duas versões cada**
— uma com `p_acao_id uuid`, outra sem argumento. Sobrecarga por assinatura:
qual roda depende de como o chamador chama. Risco real de o n8n chamar uma
achando que chama a outra.

### Pares v1/v2 coexistindo
- `cappia_cancelar_agendamento` / `_v2`
- `cappia_remarcar_agendamento` / `_v2`
- `cappia__resolver_duracao` / `_v2`
- `registrar_achado_odontograma` / `registrar_observacao_odontograma`
- `resolver_achado_odontograma` / `resolver_observacao_odontograma`

Os pares achado/observação são renomeação (a tabela foi renomeada de
`eventos` para `observacoes`); as duas versões continuam no banco.

### Sem uso no código (provável n8n)
`cappia_avancar_agendamento`, `cappia_confirmar_criacao_canonica`,
`cappia_confirmar_remarcacao_canonica` — não aparecem em nenhum repositório.
Confirmar no n8n antes de mexer.

## 5. Segurança — o que o advisor aponta

**4 tabelas com RLS DESABILITADA** (expostas à chave anon):
`n8n_chat_histories`, `clinicas_eventos_conexao`,
`_backup_tempos_cappia_20260714`, `_backup_dentistas_20260813`.

**22 tabelas com RLS habilitada e ZERO políticas.** Inclui `pacientes`,
`agendamentos`, `clinicas`, `usuarios`, `financeiro_*`. Na prática o acesso
funciona porque o painel usa a service key pelo servidor
(`/api/secure/*`) — mas é a service key que protege, não o RLS.

**2 funções SECURITY DEFINER executáveis por `anon`**:
`atualizar_cor_dentista` e `buscar_agendamentos_confirmados_dentista_dia`.
Qualquer um com a chave pública pode chamá-las.

**19 funções com `search_path` mutável** — vetor conhecido de escalonamento
em `SECURITY DEFINER`.

## 6. O que NÃO é problema

- Não há colunas duplicadas entre tabelas.
- Os dois projetos não estão sendo usados em paralelo por engano.
- O catálogo global (`procedimentos_catalogo`, `especialidades_catalogo`)
  é compartilhado por decisão, não por acidente.

## 7. Ordem sugerida

1. **Confirmar `cilindros_upa_*`** com Gabriel — se for de outro produto,
   decidir se sai daqui.
2. **Resolver as sobrecargas duplicadas** do outbox — risco de a chamada
   errada rodar.
3. **RLS/segurança** — as 4 sem RLS e as 2 funções abertas ao `anon` são
   as mais expostas.
4. **v1/v2 e backups** — limpeza, só depois de confirmar quem chama o quê
   no n8n.
