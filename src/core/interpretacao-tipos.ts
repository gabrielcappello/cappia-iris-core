import type { AlteracoesDados, ResultadoAplicarDados } from './tipos.ts';

// Entrada do extrator: somente a janela de mensagens e os dados ja
// acumulados e permitidos. Nunca telefone, clinica_id, paciente_id,
// conversa_id, historico, agendamentos ou registros clinicos.
export interface EntradaInterpretacao {
  mensagens_atuais: string[];
  dados_atuais: Record<string, string>;
}

// Saida exata esperada do modelo: somente `alteracoes`, no mesmo formato
// que aplicarDados ja aceita.
export interface SaidaInterpretacao {
  alteracoes: AlteracoesDados;
}

// Dependencia injetavel de modelo estruturado. Nenhum provedor concreto
// (OpenAI/Anthropic/etc.) e escolhido aqui — o adaptador real e etapa
// futura, ainda nao aprovada.
export interface ClienteModeloEstruturado {
  executar(entrada: { instrucoes: string; schema: object; payload: EntradaInterpretacao }): Promise<unknown>;
}

export interface Conflito {
  campo: string;
  valor_atual: string;
  valor_informado: string;
}

export interface ResultadoPreAplicacao {
  alteracoes_aplicaveis: AlteracoesDados;
  conflitos: Conflito[];
}

export interface ResultadoInterpretacao {
  alteracoes_interpretadas: AlteracoesDados;
  alteracoes_aplicaveis: AlteracoesDados;
  conflitos: Conflito[];
  aplicacao: ResultadoAplicarDados | null;
}
