// Dubles de ClienteClassificadorPosConsulta para testes de unidade -- nunca
// acessa rede real. Mesmo espirito de teste-cliente-modelo-falso.ts.
import type {
  ClassificacaoSatisfacaoIA,
  ClienteClassificadorPosConsulta,
  EntradaClassificadorPosConsulta,
} from './cliente-modelo-classificador-pos-consulta-openai.ts';

/** Devolve sempre a mesma classificacao configurada. */
export class ClienteClassificadorPosConsultaFalso implements ClienteClassificadorPosConsulta {
  readonly chamadas: EntradaClassificadorPosConsulta[] = [];
  private readonly resposta: ClassificacaoSatisfacaoIA;

  constructor(resposta: ClassificacaoSatisfacaoIA) {
    this.resposta = resposta;
  }

  async classificar(entrada: EntradaClassificadorPosConsulta): Promise<ClassificacaoSatisfacaoIA> {
    await Promise.resolve();
    this.chamadas.push(entrada);
    return this.resposta;
  }
}

/** Sempre lanca -- prova que uma falha do classificador degrada para 'incerta'. */
export class ClienteClassificadorPosConsultaFalhoFalso implements ClienteClassificadorPosConsulta {
  async classificar(): Promise<ClassificacaoSatisfacaoIA> {
    await Promise.resolve();
    throw new Error('falha simulada de rede');
  }
}

/** Prova que a validacao de entrada barra antes de qualquer chamada a IA. */
export class ClienteClassificadorPosConsultaNuncaDeveSerChamado implements ClienteClassificadorPosConsulta {
  async classificar(): Promise<ClassificacaoSatisfacaoIA> {
    throw new Error('ClienteClassificadorPosConsultaNuncaDeveSerChamado: nao deveria ter sido chamado');
  }
}
