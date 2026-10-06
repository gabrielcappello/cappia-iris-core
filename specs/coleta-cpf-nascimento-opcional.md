# CPF e nascimento configuráveis

Escopo aprovado pelo Gabriel em 05/10/2026. Implementação local; publicação não realizada.

O painel salva `clinicas.automatizacoes.solicitar_cpf` e reutiliza `solicitar_nascimento`.
Somente `false` desliga cada exigência; ausência preserva o padrão ligado. Nome e
telefone permanecem obrigatórios. E-mail mantém a regra atual independente.

O core carrega as mesmas chaves, pede apenas campos habilitados e faltantes e permite
cadastro/reserva sem documento quando sua coleta está desligada. Documento ausente vai
como `null`, nunca valor inventado. Dados conhecidos permanecem preservados. Dados
fornecidos continuam validados; CPF válido continua acionando proteção contra duplicidade.
Campos opcionais rejeitados não entram na lista de correções obrigatórias da redatora.
Sem CPF, não é possível reconhecer pelo documento alguém que chega de outro telefone.

Aderência aos princípios: remove exigências fixas; usa a configuração existente, sem
nova tabela, parser linguístico, workflow ou mecanismo de identidade.

Base: conteúdo da Edge `iris-nova-mensagem`, versão 123, consultada em produção em
05/10/2026. A branch main local não reproduzia integralmente essa Edge. A implementação
foi testada sobre uma cópia isolada da versão publicada e depois somente o delta desta
tarefa foi aplicado à branch fix/coleta-cpf-nascimento baseada em main. Os 206 testes
também passaram nessa branch limpa. Alterações não relacionadas da produção não entram
neste commit. Antes do deploy, aplicar este delta sobre a versão ativa, preservando-a.

Arquivos funcionais desta tarefa (Core e suas cópias da Edge): cadastro-paciente.ts,
carregar-catalogo.ts, orquestrador-tipos.ts, orquestrador.ts, reservar-agendamento.ts.
Testes: orquestrador-cadastro.test.ts. Painel: src/app/dashboard/page.tsx no
repositório portal-iris-principal. O core original e suas alterações em andamento
permanecem intocados.

Banco verificado apenas por leitura: pacientes.documento e agendamentos.documento
aceitam null; cappia_persistir_paciente e cappia_reservar_agendamento já suportam
documento ausente. Não há migration necessária para esta mudança.

Publicação futura: conferir novamente a versão ativa da Edge; aplicar somente o delta
destes arquivos sobre a versão ativa; publicar Core/Edge e painel de forma coordenada.
Não alterar cadastro manual de pacientes, autenticação, n8n nem Evolution.
