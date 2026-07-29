// Dublês de ClienteModeloEstruturado para testes — deterministicos, sem
// chamar nenhum servico real de IA.
import type { ClienteModeloEstruturado, EntradaInterpretacao } from './interpretacao-tipos.ts';

export interface ChamadaModeloFalso {
  instrucoes: string;
  schema: object;
  payload: EntradaInterpretacao;
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
    return resposta;
  }
}

// Usado para provar que a validacao de entrada rejeita ANTES de qualquer
// chamada ao modelo: se executar() for invocado, o teste deve falhar.
export class ClienteModeloNuncaDeveSerChamado implements ClienteModeloEstruturado {
  async executar(): Promise<unknown> {
    throw new Error('ClienteModeloNuncaDeveSerChamado: executar() nao deveria ter sido chamado');
  }
}
