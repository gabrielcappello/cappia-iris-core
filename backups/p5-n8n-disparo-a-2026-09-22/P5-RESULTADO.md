# P5 — Atualização do Disparo A no n8n (2026-09-22/23) — resultado

Autorizado pelo Gabriel: atualizar **somente** o workflow inativo "Iris Nova - Pós-Consulta (Disparo A)" com o JSON
versionado. Ele deve permanecer inativo, com gatilho desabilitado e sem execução. Iris Oficial e legado preservados,
sem alteração. Conduzido pela interface, um passo por vez. **Não avancei ao P6.**

## Decisão prévia confirmada
`provider` fixo como `"evolution"` nos dois nós que chamam a `iris-nova-pos-consulta` (não usar `$env.IRIS_NOVA_PROVIDER`
— a licença do n8n bloqueia a leitura de variáveis pela API, e o texto fixo já é o que está em produção).

## O que foi feito (workflow `Y6oMf0xBYWVi14Rh`)
1. **Nó "Chamar iris-nova-pos-consulta (iniciar)" → "(iniciar ou recuperar)"**: renomeado; autenticação trocada de
   Header Auth para a Custom Auth "Iris Nova Pos-Consulta (chamada interna)" (mesma credencial do P1); corpo JSON
   atualizado (`acao` vem do candidato via `$json.acao_edge`); "On Error" = Continue; sem retry automático (removido
   o retry herdado da cópia, que não deveria estar aqui).
2. **Nó "Chamar iris-nova-pos-consulta (confirmar)"**: mesma troca de credencial; corpo JSON atualizado com os nomes
   corretos dos nós anteriores do Disparo A; "On Error" = Continue; 3 tentativas / 2000 ms (mantidas, corretas).
3. **Nó novo "Encerrar jornadas sem resposta (RPC cappia_pos_consulta_encerrar_sem_resposta)"**: criado, corpo
   `{p_limit: 200}`, credencial REST (service_role) existente, "On Error" = Continue, ligado em **paralelo** à saída
   do gatilho (mesmo nível de "Buscar candidatos", não em série com ela — corrigido depois de uma ligação errada
   intermediária, ver Ocorrências abaixo).
4. **Nó "Ha entrega pendente?"**: validação de tipo mantida em Strict (ver Divergências).
5. **Gatilho "A cada 15 minutos"**: mantido **desabilitado** durante todo o processo.

## Método usado
A troca direta de credencial pelo campo "Custom Auth" ficou travada na interface (ver Ocorrências). Para não criar
credenciais duplicadas, os dois nós de chamada à Edge Function foram recriados **copiando** (Ctrl+C/Ctrl+V) o nó já
configurado e testado do workflow **Iris Oficial** (mesma credencial, já validada no P4), depois renomeados e com o
corpo/URL ajustados para o Disparo A. O Iris Oficial foi só lido/copiado, nunca editado.

## Verificação final (GET, somente leitura; backup em `Y6oMf0xBYWVi14Rh-DEPOIS-P5.json`, SHA-256 registrado)
| Item | Resultado |
|---|---|
| `active` | **false** |
| Gatilho `disabled` | **true** |
| Execuções | **0** |
| Nós | 10 (9 originais − 1 renomeado + 1 novo = confere) |
| Grafo | Gatilho → Buscar candidatos + Encerrar jornadas (paralelo); Buscar candidatos → iniciar ou recuperar → Há entrega pendente? → Enviar via Evolution → Classificar → Evolution aceitou → confirmar. Únicos nós sem saída: confirmar e Encerrar jornadas (esperado) |
| Credenciais em uso | Só nomes conferidos (nunca valores): Custom Auth "Iris Nova Pos-Consulta (chamada interna)" nos dois nós de chamada à Edge; REST/Evolution são as credenciais reais já em produção |
| Iris Oficial | Inalterado (não verificado de novo neste registro; só lido/copiado) |
| Legado Google | Não tocado neste portão |

## Divergências encontradas e decisão
1. **`provider` fixo, não `$env.IRIS_NOVA_PROVIDER`** — decisão já aprovada antes de começar.
2. **Validação Strict/Loose do nó "Há entrega pendente?"**: o JSON aprovado pede Loose; a interface desta instância
   do n8n **não expõe** esse controle (nenhum ícone de engrenagem aparece, mesmo com a tradução do Chrome desligada).
   Mantido em Strict. Sem efeito prático aqui: a condição compara dois textos (`$json.resultado` == `"entrega_pendente"`),
   e Strict/Loose só mudam o comportamento quando os tipos comparados são diferentes.
3. **Nomes de credencial só cosméticos**, sem efeito: "Buscar candidatos" e "Encerrar jornadas..." usam a credencial
   real "Header Auth account 2" (não "Supabase REST (service_role)", nome documentado); "Enviar via Evolution" usa
   "evolution_cloudfy" (não "evolutionApi"). São as credenciais reais já em produção — não alteradas.
4. **Referência inerte a credencial antiga**: os dois nós de chamada à Edge Function mantêm, além da Custom Auth
   ativa, uma referência não usada a "Supabase Edge Functions (publishable key)" (herdada da cópia). Mesmo padrão
   aceito no P1 para o nó de confirmação do Iris Oficial — sem efeito, porque a autenticação em uso é a Custom Auth.
5. **Nota "Setup necessário"**: texto não atualizado para refletir a credencial Custom Auth (documentação apenas,
   sem efeito funcional). Não alterado.

## Ocorrências durante a execução (nada delas chegou a rodar ou enviar mensagem)
- O campo de seleção de credencial "Custom Auth" ficou travado (cursor de proibido) em nós editados diretamente,
  mesmo após F5 e com a tradução do Chrome desligada — contornado com a cópia de nó do Iris Oficial (acima).
- Uma ligação intermediária errada: "Encerrar jornadas sem resposta" ficou temporariamente ligado à saída de
  "Buscar candidatos" em vez de diretamente ao gatilho — identificado por leitura da API, corrigido antes de
  qualquer execução ou publicação.
- O botão "Publish" apareceu inativo (opções "Publish"/"Unpublish" ambas desabilitadas no menu). Confirmado por
  leitura repetida da API que as edições **já eram salvas automaticamente** a cada mudança (versionId/updatedAt
  mudando), sem precisar de publicação explícita — o workflow segue inativo.

## Estado final
Workflow inativo, gatilho desabilitado, 0 execuções, nenhuma mensagem enviada, nenhuma jornada tocada. Iris Oficial e
legado Google preservados. Nada mais foi alterado no n8n. **P5 concluído. Não avancei ao P6** — aguardo nova
autorização para o teste controlado (Clear Dent, telefone único autorizado, 8 casos T1–T8).
