import { ConversaNaoEncontradaError, EntradaInvalidaError } from './erros.ts';
import type {
  AcaoAlteracaoDados,
  AlteracoesDados,
  AplicarDadosInput,
  CampoDadosConversa,
  ClienteBancoDados,
  ResultadoAplicarDados,
} from './tipos.ts';

const CAMPOS_PERMITIDOS: readonly CampoDadosConversa[] = [
  'intencao',
  'procedimento_texto',
  'dentista_texto',
  'data_texto',
  'periodo',
  'horario_texto',
  'nome',
  'cpf',
  'data_nascimento',
  'email',
];

const ACOES_PERMITIDAS: readonly AcaoAlteracaoDados[] = ['informar', 'corrigir', 'remover'];
const PERIODOS_PERMITIDOS = ['manha', 'tarde', 'noite'];
const INTENCOES_PERMITIDAS = ['novo_agendamento'];

/**
 * Aproveitamento estruturado dos dados ja interpretados (docs/06-roadmap.md,
 * item 2). Nao interpreta texto livre, nao chama IA, nao resolve
 * procedimento/dentista/data/horario para registros oficiais. So aplica
 * alteracoes ja estruturadas ao campo estado_conversa.dados, preservando o
 * que nao foi explicitamente informado/corrigido/removido nesta chamada.
 */
export async function aplicarDados(
  cliente: ClienteBancoDados,
  entrada: AplicarDadosInput
): Promise<ResultadoAplicarDados> {
  validarContexto(entrada);
  validarAlteracoes(entrada.alteracoes);

  // Os tres identificadores devem casar simultaneamente na mesma linha —
  // nunca aceitar clinica_id vindo da IA ou do paciente: aqui ele e um
  // parametro do contexto ja identificado pelo Core, nao parte de `alteracoes`.
  const { data: existente, error: erroSelect } = await cliente
    .from('estado_conversa')
    .select('id, dados')
    .eq('id', entrada.conversa_id)
    .eq('clinica_id', entrada.clinica_id)
    .eq('telefone_normalizado', entrada.telefone_normalizado)
    .maybeSingle();

  if (erroSelect) throw new Error(`falha ao buscar estado da conversa: ${erroSelect.message}`);
  if (!existente) throw new ConversaNaoEncontradaError();

  const dadosAtuais = ((existente as { dados: unknown }).dados as Record<string, string>) ?? {};
  const dadosNovos: Record<string, string> = { ...dadosAtuais };

  const camposAdicionados: string[] = [];
  const camposCorrigidos: string[] = [];
  const camposRemovidos: string[] = [];
  const camposPreservados: string[] = [];

  for (const [campo, alteracao] of Object.entries(entrada.alteracoes)) {
    const acao = alteracao.acao as AcaoAlteracaoDados;

    if (acao === 'remover') {
      delete dadosNovos[campo];
      camposRemovidos.push(campo);
      continue;
    }

    if (acao === 'corrigir') {
      // corrigir e um sinal explicito e autoritativo: sempre substitui,
      // preservando todos os demais campos acumulados.
      dadosNovos[campo] = alteracao.valor as string;
      camposCorrigidos.push(campo);
      continue;
    }

    // acao === 'informar'
    const jaExiste = Object.prototype.hasOwnProperty.call(dadosAtuais, campo);
    if (!jaExiste) {
      dadosNovos[campo] = alteracao.valor as string;
      camposAdicionados.push(campo);
    } else {
      // mesmo valor (idempotente) ou valor diferente (nao substituir
      // silenciosamente): em ambos os casos o valor acumulado e preservado.
      camposPreservados.push(campo);
    }
  }

  const { data: atualizado, error: erroUpdate } = await cliente
    .from('estado_conversa')
    .update({ dados: dadosNovos, atualizado_em: new Date().toISOString() })
    .eq('id', entrada.conversa_id)
    .eq('clinica_id', entrada.clinica_id)
    .eq('telefone_normalizado', entrada.telefone_normalizado)
    .select('id, dados')
    .maybeSingle();

  if (erroUpdate) throw new Error(`falha ao atualizar dados da conversa: ${erroUpdate.message}`);
  if (!atualizado) throw new ConversaNaoEncontradaError();

  return {
    conversa_id: (atualizado as { id: string }).id,
    dados: ((atualizado as { dados: unknown }).dados as Record<string, unknown>) ?? {},
    campos_adicionados: camposAdicionados,
    campos_corrigidos: camposCorrigidos,
    campos_removidos: camposRemovidos,
    campos_preservados: camposPreservados,
  };
}

function validarContexto(entrada: AplicarDadosInput): void {
  if (!entrada.conversa_id || entrada.conversa_id.trim() === '') {
    throw new EntradaInvalidaError('conversa_id', 'conversa_id e obrigatorio');
  }
  if (!entrada.clinica_id || entrada.clinica_id.trim() === '') {
    throw new EntradaInvalidaError('clinica_id', 'clinica_id e obrigatorio');
  }
  if (!entrada.telefone_normalizado || entrada.telefone_normalizado.trim() === '') {
    throw new EntradaInvalidaError('telefone_normalizado', 'telefone_normalizado e obrigatorio');
  }
}

// Validacao completa de TODAS as alteracoes antes de qualquer leitura ou
// escrita: se qualquer campo, acao ou valor for invalido, a chamada inteira
// e rejeitada e nada e persistido — e assim que garantimos que valores
// undefined/vazios/acoes invalidas nunca apagam dados silenciosamente.
function validarAlteracoes(alteracoes: AlteracoesDados): void {
  for (const [campo, alteracao] of Object.entries(alteracoes)) {
    if (!CAMPOS_PERMITIDOS.includes(campo as CampoDadosConversa)) {
      throw new EntradaInvalidaError(campo, `campo '${campo}' nao e permitido nesta etapa`);
    }
    if (!alteracao || typeof alteracao !== 'object') {
      throw new EntradaInvalidaError(campo, `alteracao de '${campo}' deve ser um objeto com acao`);
    }

    const { acao, valor } = alteracao;
    if (!ACOES_PERMITIDAS.includes(acao as AcaoAlteracaoDados)) {
      throw new EntradaInvalidaError(campo, `acao '${String(acao)}' nao e permitida para '${campo}'`);
    }

    if (acao === 'informar' || acao === 'corrigir') {
      if (valor === undefined || valor === null || (typeof valor === 'string' && valor.trim() === '')) {
        throw new EntradaInvalidaError(campo, `valor de '${campo}' e obrigatorio para a acao '${acao}'`);
      }
      if (campo === 'periodo' && !PERIODOS_PERMITIDOS.includes(valor)) {
        throw new EntradaInvalidaError(campo, `periodo '${valor}' invalido`);
      }
      if (campo === 'intencao' && !INTENCOES_PERMITIDAS.includes(valor)) {
        throw new EntradaInvalidaError(campo, `intencao '${valor}' invalida`);
      }
    }
  }
}
