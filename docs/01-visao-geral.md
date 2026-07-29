# Visão geral

## O que é a Iris Nova

Assistente conversacional de agendamento odontológico via WhatsApp para as clínicas
Cappia. Atende o paciente, identifica a clínica pela instância autenticada, interpreta a
mensagem, mantém o estado da conversa no banco, e decide o próximo passo por código
determinístico — nunca por julgamento livre de um modelo de linguagem.

## Por que um projeto novo, em vez de continuar evoluindo a Iris antiga

A linha anterior (`IRIS BR`) era um Agent autônomo com ferramentas livres, rodando
inteiramente dentro do n8n. Ao longo de aproximadamente dois meses, cada comportamento
incorreto do Agent foi corrigido com uma camada nova por cima (uma camada determinística
de override pós-Agent chegou a 51KB de código; gates para evitar mensagem duplicada;
pré-busca de estado técnico; modo manual) — sem eliminar a causa raiz: a decisão de qual
ferramenta chamar, a cada turno, era julgamento livre do modelo, não uma regra fixa.

Em 28/07/2026, mesmo depois de construir e ativar em produção uma reescrita
determinística completa (que chegou a substituir o Agent), um bug real de produção foi
encontrado (parser de saída estruturada sem tolerância, derrubando a conversa em
silêncio). A correção funcionou, mas a decisão tomada foi: em vez de continuar corrigindo
a base acumulada, encerrar essa linha e recomeçar com uma base nova e limpa, aplicando
diretamente as lições já aprendidas.

Histórico completo: `cappia-estado/HANDOFF-iris-br.md`, seção "Sessão 28/07/2026" —
referência histórica, não fonte técnica deste projeto.

## Princípio central

A IA interpreta linguagem; não decide fluxo. Todo o resto — estado, decisão de próximo
passo, execução de ações reais (criar agendamento, alterar cadastro) — é código
determinístico, testável e auditável.

## Escopo

Ver `docs/06-roadmap.md` para o escopo completo e a ordem de implementação aprovada.
