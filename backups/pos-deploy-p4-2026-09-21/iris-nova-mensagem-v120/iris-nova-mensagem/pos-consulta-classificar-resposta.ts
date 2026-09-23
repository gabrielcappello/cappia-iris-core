// Wrapper fino que classifica a resposta do paciente e NUNCA propaga
// excecao -- qualquer falha (rede, timeout, saida invalida, cliente ausente)
// degrada para 'incerta' (specs/pos-consulta-conversacional-v1.md secao 6:
// 'incerta' e a leitura conservadora, nunca aciona envio de link). Mesmo
// papel que `clienteRedator: null` tem em gerar-resposta-conversacional.ts:
// ausencia de configuracao nunca e tratada como erro fatal do turno.

import { INSTRUCOES_CLASSIFICADOR_POS_CONSULTA } from './pos-consulta-classificacao-instrucoes.ts';
import type {
  ClassificacaoSatisfacaoIA,
  ClienteClassificadorPosConsulta,
} from './cliente-modelo-classificador-pos-consulta-openai.ts';

export interface EntradaClassificarRespostaPosConsulta {
  mensagemPaciente: string;
}

/**
 * `cliente: null` cobre configuracao ausente, mesma disciplina de
 * `clienteRedator: null` em gerar-resposta-conversacional.ts.
 */
export async function classificarRespostaPosConsulta(
  cliente: ClienteClassificadorPosConsulta | null,
  entrada: EntradaClassificarRespostaPosConsulta
): Promise<ClassificacaoSatisfacaoIA> {
  if (cliente === null) return 'incerta';

  try {
    return await cliente.classificar({
      instrucoes: INSTRUCOES_CLASSIFICADOR_POS_CONSULTA,
      mensagemPaciente: entrada.mensagemPaciente,
    });
  } catch {
    return 'incerta';
  }
}
