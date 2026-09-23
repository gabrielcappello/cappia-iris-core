// Dubles de ClienteRedatorPosConsulta para testes de unidade.
import type { ClienteRedatorPosConsulta, EntradaRedatorPosConsulta } from './cliente-modelo-redator-pos-consulta-openai.ts';

export class ClienteRedatorPosConsultaFalso implements ClienteRedatorPosConsulta {
  readonly chamadas: EntradaRedatorPosConsulta[] = [];
  private readonly resposta: string;

  constructor(resposta: string) {
    this.resposta = resposta;
  }

  async redigir(entrada: EntradaRedatorPosConsulta): Promise<string> {
    await Promise.resolve();
    this.chamadas.push(entrada);
    return this.resposta;
  }
}

export class ClienteRedatorPosConsultaFalhoFalso implements ClienteRedatorPosConsulta {
  async redigir(): Promise<string> {
    await Promise.resolve();
    throw new Error('falha simulada de rede');
  }
}
