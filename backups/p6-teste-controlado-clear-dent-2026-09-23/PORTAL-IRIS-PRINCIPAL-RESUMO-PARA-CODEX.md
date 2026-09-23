# portal-iris-principal — liberar os 3 modos do pós-consulta (para revisão final do Codex)

## Atualização — 2 bloqueadores do P7 corrigidos (2026-09-23)
1. **`lerEstadoPosConsulta`**: `posAtivo` agora usa `ehModoValido(tipoBruto)` — só `satisfacao`/`google`/`ambos`
   ativam; ausente, vazio, `"nenhum"` ou qualquer valor fora do vocabulário fechado caem em desligado. O teste que
   antes esperava `posAtivo: true` para um valor inválido foi corrigido para esperar `false`; adicionados 2 testes
   novos (`"nenhum"` e vazio → desligado). 299 testes agora (eram 297).
2. **`auto.google_review_desc`** atualizado nos 8 idiomas: deixa explícito que a Iris pergunta primeiro sobre a
   experiência e só envia o convite do Google se a resposta for positiva (comportamento real, confirmado no T8 do
   P6 com mensagem real no WhatsApp — antes o texto sugeria convite direto).
- **Não mexido:** Core, banco, migrations, Edge Functions, n8n — nenhum arquivo fora de `portal-iris-principal`.
- **Reconfirmado:** Disparo A segue `active: false`, gatilho desabilitado (leitura via API depois desta correção).
- `npm test`: **299/299**. `npm run build`: **sucesso** (mesmas 53 rotas, sem erro de TypeScript). Não publicado.


Alterações já existentes, **não publicadas**, encontradas como *working tree* sujo em `main` do repositório
`portal-iris-principal` (não é parte do `cappia-iris-core`). Incluídas agora no pacote final do pós-consulta
conversacional a pedido do Gabriel, antes do P7/P8. **Não publicadas nesta sessão** — só testadas e buildadas.

## O que muda
1. **Libera "Satisfação" e "Satisfação + Google"** no painel de automações da clínica (`AutomacoesSection`,
   `src/app/dashboard/page.tsx`). Antes, só "Avaliação Google" era selecionável; as outras duas apareciam
   desabilitadas com o rótulo "🚧 Em construção — ainda não avisa ninguém automaticamente" (`wip: true` no código).
   Isso ficou **desatualizado**: o backend (`cappia-iris-core`) já suporta os três modos há tempo, e o P6 (teste
   controlado de 2026-09-23) validou os três com mensagens reais no WhatsApp. Sem essa liberação, nenhuma clínica
   consegue escolher "satisfacao" ou "ambos" pela interface — só a equipe, direto no banco (como fizemos no teste).
2. **Extrai a leitura/escrita da configuração** para um módulo novo e testado (`src/lib/pos-consulta-automatizacoes.ts`,
   `lerEstadoPosConsulta` / `construirAutomatizacoesComPosConsulta`), com 7 testes (`node --test`) cobrindo o ciclo
   salvar → reler para os três modos, os três prazos, a preservação de chaves não relacionadas, o caso desligado
   (grava `'nenhum'`, nunca reativa sozinho) e entradas ausentes/corrompidas (cai em defaults seguros, nunca lança).
   Isso resolve o item já citado no runbook do pós-consulta: "copy do painel para o modo 'Avaliação no Google' não
   atualizada" — o problema raiz não era só o texto, era o painel travando a escolha do modo.
3. **Campo de texto passa a ser orientação de tom, não mensagem literal com placeholders.** Antes: rótulo "Mensagem
   personalizada (opcional)", placeholder com `{nome}/{clinica}/{link}` — um contrato que **o backend nunca leu
   assim** (a Iris usa esse campo como `orientacoes_clinica`, e o próprio `pos-consulta-redator-instrucoes.ts`
   instrui: "use como referência de TOM e ESTILO -- nunca como um roteiro fixo"). O texto do painel agora diz isso
   explicitamente ("A Iris usa isso como referência de tom e estilo... nunca copia ao pé da letra"), nas 8 línguas do
   `translations.ts`. O campo também passou a aparecer nos três modos (antes só aparecia dentro do bloco do modo
   "google").
4. Nenhuma mudança na tabela `agendamentos`/`clinicas`/migrations, nenhuma mudança em Edge Function, nenhuma mudança
   no n8n. É só o painel front-end lendo/escrevendo o mesmo `automatizacoes.pos_consulta_*` já usado pelo backend.

## Diff
- `src/app/dashboard/page.tsx`: 40 linhas (+20/-20) — ver `portal-iris-principal-diff-modificados.patch`.
- `src/lib/i18n/translations.ts`: 48 linhas (+24/-24), as 8 línguas do produto — mesmo patch.
- `src/lib/pos-consulta-automatizacoes.ts` (novo, 65 linhas) e `.test.ts` (novo, 93 linhas, 7 testes) — anexados
  inteiros neste pacote.

## Verificação (rodada agora, nesta sessão; nada publicado)
| Comando | Resultado |
|---|---|
| `npm test` (`node --test src/**/*.test.ts`) | **297/297 passando**, 0 falha (inclui os 7 novos testes do pós-consulta) |
| `npm run build` (`next build`) | **Sucesso** — compilação, TypeScript e as 53 páginas/rotas geradas sem erro, incluindo `/dashboard/excecoes` (já existe, sem relação com este pacote) |
| `eslint` nos 4 arquivos alterados/novos | 3 erros + 10 avisos — **confirmado, por comparação com o HEAD publicado (`git stash`), que são os MESMOS 13 problemas pré-existentes, em linhas fora deste diff**; a mudança em si não introduz nenhum problema novo |

## Não feito (por desenho, fora do pedido)
- **Não publicado/deployado.** Fica como *working tree* local até nova autorização.
- Não mexe na frente de inconformidade (aba Exceções) — só liberou os modos e corrigiu o contrato do campo de texto.
- Não ativa o Disparo A nem qualquer automação recorrente.
