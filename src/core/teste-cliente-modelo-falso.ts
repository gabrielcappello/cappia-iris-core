// Dublês de ClienteModeloEstruturado para testes — deterministicos, sem
// chamar nenhum servico real de IA.
import type { ClienteModeloEstruturado, EntradaInterpretacao } from './interpretacao-tipos.ts';

export interface ChamadaModeloFalso {
  instrucoes: string;
  schema: object;
  payload: EntradaInterpretacao;
}

/**
 * `eventos_candidatos`, `dentistas_candidatos`, `atendimento_para_terceiro` e
 * `outra_pessoa_alem_das_listadas` sao campos raiz OBRIGATORIOS
 * (specs/eventos-conversacionais-v1.md; specs/contato-multiplos-pacientes-v1.md
 * secao 4.5). O modelo real SEMPRE os devolve -- o schema estrito os exige --,
 * entao um dublê que os preenche quando a fixture nao se importa e MAIS fiel a
 * producao, nao menos: evita reescrever ~100 fixtures.
 *
 * Fixtures que se importam declaram o campo, e este completador nao toca
 * nelas. A validacao do campo em si tem testes proprios que chamam
 * `validarSaidaInterpretacao` diretamente, sem passar por aqui.
 */
export function completarEventosCandidatos(resposta: unknown): unknown {
  if (resposta === null || typeof resposta !== 'object' || Array.isArray(resposta)) return resposta;
  const objeto = resposta as Record<string, unknown>;
  if (!('natureza_mensagem' in objeto)) return resposta;
  return {
    ...objeto,
    ...('eventos_candidatos' in objeto ? {} : { eventos_candidatos: [] }),
    // `null` = o paciente nao mencionou profissional -- o default correto
    // para toda fixture que nao trata de dentista.
    ...('dentistas_candidatos' in objeto ? {} : { dentistas_candidatos: null }),
    // `false` = o turno nao trata de paciente do contato -- o default para
    // toda fixture que nao se importa.
    ...('atendimento_para_terceiro' in objeto ? {} : { atendimento_para_terceiro: false }),
    ...('outra_pessoa_alem_das_listadas' in objeto ? {} : { outra_pessoa_alem_das_listadas: false }),
  };
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
