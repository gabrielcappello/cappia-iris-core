// Dublês de ClienteModeloEstruturado para testes — deterministicos, sem
// chamar nenhum servico real de IA.
import type { ClienteModeloEstruturado, EntradaInterpretacao } from './interpretacao-tipos.ts';

export interface ChamadaModeloFalso {
  instrucoes: string;
  schema: object;
  payload: EntradaInterpretacao;
}

/**
 * `eventos_candidatos` passou a ser campo raiz OBRIGATORIO em 2026-08-09
 * (specs/eventos-conversacionais-v1.md, fatia minima). O modelo real SEMPRE o
 * devolve -- o schema estrito o exige --, entao um dublê que o preenche
 * quando a fixture nao se importa com eventos e MAIS fiel a producao, nao
 * menos: evita reescrever ~100 fixtures para acrescentar `[]` em todas.
 *
 * Fixtures que se importam com eventos declaram o campo, e este completador
 * nao toca nelas. A validacao do campo em si (ausencia, tipo desconhecido,
 * evento repetido) tem testes proprios que chamam `validarSaidaInterpretacao`
 * diretamente, sem passar por aqui.
 */
function completarEventosCandidatos(resposta: unknown): unknown {
  if (resposta === null || typeof resposta !== 'object' || Array.isArray(resposta)) return resposta;
  const objeto = resposta as Record<string, unknown>;
  if (!('natureza_mensagem' in objeto) || 'eventos_candidatos' in objeto) return resposta;
  return { ...objeto, eventos_candidatos: [] };
}

// Devolve respostas pre-definidas, uma por chamada (a ultima e repetida se
// houver mais chamadas do que respostas). Registra cada chamada recebida
// para os testes inspecionarem o payload exatamente como foi enviado
// (ex.: prova de preservacao de ordem das mensagens).
export class ClienteModeloFalso implements ClienteModeloEstruturado {
  private readonly respostas: unknown[];
  private indice = 0;
  readonly chamadas: ChamadaModeloFalso[] = [];

  constructor(respostas: unknown[]) {
    this.respostas = respostas;
  }

  async executar(entrada: ChamadaModeloFalso): Promise<unknown> {
    this.chamadas.push(entrada);
    const resposta = this.respostas[Math.min(this.indice, this.respostas.length - 1)];
    this.indice++;
    return completarEventosCandidatos(resposta);
  }
}

// Usado para provar que a validacao de entrada rejeita ANTES de qualquer
// chamada ao modelo: se executar() for invocado, o teste deve falhar.
export class ClienteModeloNuncaDeveSerChamado implements ClienteModeloEstruturado {
  async executar(): Promise<unknown> {
    throw new Error('ClienteModeloNuncaDeveSerChamado: executar() nao deveria ter sido chamado');
  }
}
