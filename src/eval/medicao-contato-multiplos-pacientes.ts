// Runner ISOLADO, avulso: MEDICAO da interpretadora real (gpt-5.6-luna) para
// a frente specs/contato-multiplos-pacientes-v1.md. NAO altera prompt,
// contrato, schema nem nenhum modulo de producao -- so os IMPORTA e os
// EXERCITA pelo mesmo caminho que producao usa (construirEntradaMinimizada
// + extrairAlteracoes -> cliente-modelo-openai.ts).
//
// O QUE REUTILIZA INTEGRALMENTE (nada novo, nenhuma camada):
//   - criarClienteModeloOpenAI, MODELO_IRIS_NOVA e os tres tempos aprovados,
//     de ../core/cliente-modelo-openai.ts -- MESMO cliente da producao;
//   - construirEntradaMinimizada + extrairAlteracoes de
//     ../core/interpretacao-extrator.ts -- MESMO caminho da producao,
//     com o PROMPT COMPLETO (INSTRUCOES_EXTRATOR) e o schema portatil real,
//     ja incluindo `pacientes_do_contato` no corpo HTTP;
//   - o padrao de `fetchInspetor` de
//     src/eval/inspecao-payload-agendamentos-ativos.ts -- wrapper de `fetch`
//     que CAPTURA o corpo real da requisicao (nunca headers, nunca
//     Authorization) e delega ao `fetch` real;
//   - chave via `process.env.OPENAI_API_KEY` (cofre .iris-secrets/openai.env),
//     carregada exclusivamente por `node --env-file`. Este arquivo nunca
//     abre/le/imprime/edita nada em .iris-secrets, nunca imprime a chave nem
//     o header Authorization.
//
// GUARDA DE CONTRATO (antes de qualquer chamada de rede paga): para cada caso
// que declara `pacientes_do_contato`, o `fetchInspetor` confirma que a chave
// chegou ao corpo HTTP REAL (string do role=user). Se estiver ausente, a
// requisicao e ABORTADA antes de sair para a rede e o caso e reprovado como
// `contrato_pacientes_do_contato_ausente` -- nenhuma chamada paga acontece
// nesse caso.
//
// LIMITE DE ORCAMENTO: no maximo UMA chamada de rede por caso e no maximo
// TOTAL_CASOS chamadas na execucao inteira (contador global + guarda). O
// adaptador nao tem retry para as categorias de erro estrutural; para as
// repetiveis, o limite global corta antes de uma segunda chamada.
//
// Sem argumentos: DRY-RUN -- lista os 6 casos, valida a montagem local do
// payload e a presenca de `pacientes_do_contato` no EntradaInterpretacao,
// e encerra. Nenhuma rede, nenhum custo, a chave nem e consultada.
//
// Execucao real (exige nova autorizacao explicita a cada vez):
//   node --experimental-strip-types \
//     --env-file="C:\Users\Gabriel\.iris-secrets\openai.env" \
//     src/eval/medicao-contato-multiplos-pacientes.ts --execute
//
// Codigo de saida 0 somente quando TODOS os casos APROVARAM. Qualquer
// reprovacao (ou erro) sai com codigo != 0. Nunca repete a execucao.

import { pathToFileURL } from 'node:url';
import {
  criarClienteModeloOpenAI,
  ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
  MODELO_IRIS_NOVA,
  PRAZO_TOTAL_MS_APROVADO,
  TIMEOUT_POR_TENTATIVA_MS_APROVADO,
} from '../core/cliente-modelo-openai.ts';
import { construirEntradaMinimizada, extrairAlteracoes } from '../core/interpretacao-extrator.ts';
import type { SaidaInterpretacao, SnapshotOficialConversa } from '../core/interpretacao-tipos.ts';

// --- IDs sinteticos fixos (nenhum dado real; UUID v4 validos) ---
const ID_CARLOS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_MARTA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type PacienteDoContato = { paciente_id: string; nome: string; vinculo: 'titular' | 'dependente' };

interface Caso {
  id: string;
  descricao: string;
  mensagens: string[];
  snapshot: SnapshotOficialConversa;
  pacientesDoContato?: PacienteDoContato[];
  /** Avaliacao do resultado da interpretadora real. Retorna null se APROVOU, ou o motivo da reprovacao. */
  avaliar: (saida: SaidaInterpretacao) => string | null;
}

// Le o valor `informar`/`corrigir` de uma alteracao no contrato interno
// devolvido pelo adaptador (`alteracoes[campo] = { acao, valor }`).
function lerAlteracao(saida: SaidaInterpretacao, campo: string): { acao: string; valor?: string } | undefined {
  return (saida.alteracoes as Record<string, { acao: string; valor?: string } | undefined>)[campo];
}
function valorInformado(saida: SaidaInterpretacao, campo: string): string | undefined {
  const a = lerAlteracao(saida, campo);
  return a !== undefined && a.acao !== 'remover' ? a.valor : undefined;
}

const CASOS: readonly Caso[] = Object.freeze([
  {
    id: '1_terceiro_sem_id_contato_so_carlos',
    descricao: '"quero marcar uma avaliacao para minha mae", contato so com Carlos',
    mensagens: ['quero marcar uma avaliacao para minha mae'],
    snapshot: {},
    // Contato so com o titular -> o Core NAO envia pacientes_do_contato (so
    // manda quando ha MAIS DE UM). Este caso mede o sinal do turno sem a
    // lista, exatamente como producao faria.
    pacientesDoContato: undefined,
    avaliar: (s) => {
      const problemas: string[] = [];
      if (s.atendimento_para_terceiro !== true) problemas.push('atendimento_para_terceiro deveria ser true');
      if (s.outra_pessoa_alem_das_listadas !== false) problemas.push('outra_pessoa_alem_das_listadas deveria ser false');
      if (valorInformado(s, 'paciente_id') !== undefined) problemas.push('paciente_id nao deveria ser emitido');
      return problemas.length ? problemas.join('; ') : null;
    },
  },
  {
    id: '2_terceiro_com_id_da_marta',
    descricao: 'contato com Carlos e Marta, "e para a Marta"',
    mensagens: ['e para a Marta'],
    snapshot: {},
    pacientesDoContato: [
      { paciente_id: ID_CARLOS, nome: 'Carlos', vinculo: 'titular' },
      { paciente_id: ID_MARTA, nome: 'Marta', vinculo: 'dependente' },
    ],
    avaliar: (s) => {
      const problemas: string[] = [];
      if (s.atendimento_para_terceiro !== true) problemas.push('atendimento_para_terceiro deveria ser true');
      const pid = valorInformado(s, 'paciente_id');
      if (pid !== ID_MARTA) problemas.push(`paciente_id deveria ser o exato da Marta (recebido: ${pid ?? 'ausente'})`);
      return problemas.length ? problemas.join('; ') : null;
    },
  },
  {
    id: '3_outra_pessoa_alem_das_listadas',
    descricao: 'contato com Carlos e Marta, "nao e para nenhum deles, e outra pessoa"',
    mensagens: ['nao e para nenhum deles, e outra pessoa'],
    snapshot: {},
    pacientesDoContato: [
      { paciente_id: ID_CARLOS, nome: 'Carlos', vinculo: 'titular' },
      { paciente_id: ID_MARTA, nome: 'Marta', vinculo: 'dependente' },
    ],
    avaliar: (s) => {
      const problemas: string[] = [];
      if (s.outra_pessoa_alem_das_listadas !== true) problemas.push('outra_pessoa_alem_das_listadas deveria ser true');
      if (valorInformado(s, 'paciente_id') !== undefined) problemas.push('paciente_id nao deveria ser emitido');
      return problemas.length ? problemas.join('; ') : null;
    },
  },
  {
    id: '4_vinculo_dependente',
    descricao: 'resposta a pergunta de vinculo: "quero adicionar no meu numero"',
    mensagens: ['quero adicionar no meu numero'],
    snapshot: {},
    avaliar: (s) => {
      const v = valorInformado(s, 'vinculo_novo_paciente');
      if (v !== 'dependente') return `vinculo_novo_paciente deveria ser 'dependente' (recebido: ${v ?? 'ausente'})`;
      const tel = valorInformado(s, 'telefone_novo_paciente');
      if (tel !== undefined) return `telefone_novo_paciente nao deveria ser emitido (recebido: ${tel})`;
      return null;
    },
  },
  {
    id: '5_vinculo_numero_proprio_com_telefone',
    descricao: 'resposta a pergunta de vinculo: "ela tem numero proprio, e 5521987654321"',
    mensagens: ['ela tem numero proprio, e 5521987654321'],
    snapshot: {},
    avaliar: (s) => {
      const problemas: string[] = [];
      const v = valorInformado(s, 'vinculo_novo_paciente');
      if (v !== 'numero_proprio') problemas.push(`vinculo_novo_paciente deveria ser 'numero_proprio' (recebido: ${v ?? 'ausente'})`);
      const tel = valorInformado(s, 'telefone_novo_paciente');
      // Aceita o numero normalizado (so digitos, formato BR) OU com o + de E.164.
      const telNorm = tel !== undefined ? tel.replace(/[^\d]/g, '') : undefined;
      if (telNorm !== '5521987654321') {
        problemas.push(`telefone_novo_paciente deveria conter 5521987654321 (recebido: ${tel ?? 'ausente'})`);
      }
      return problemas.length ? problemas.join('; ') : null;
    },
  },
  {
    id: '6_falso_positivo_para_mim',
    descricao: 'falso positivo: "quero marcar para mim"',
    mensagens: ['quero marcar para mim'],
    snapshot: {},
    pacientesDoContato: [
      { paciente_id: ID_CARLOS, nome: 'Carlos', vinculo: 'titular' },
      { paciente_id: ID_MARTA, nome: 'Marta', vinculo: 'dependente' },
    ],
    avaliar: (s) => {
      const problemas: string[] = [];
      if (s.atendimento_para_terceiro !== false) problemas.push('atendimento_para_terceiro deveria ser false');
      if (s.outra_pessoa_alem_das_listadas !== false) problemas.push('outra_pessoa_alem_das_listadas deveria ser false');
      if (valorInformado(s, 'paciente_id') !== undefined) problemas.push('paciente_id nao deveria ser emitido');
      if (valorInformado(s, 'vinculo_novo_paciente') !== undefined) problemas.push('vinculo_novo_paciente nao deveria ser emitido');
      if (valorInformado(s, 'telefone_novo_paciente') !== undefined) problemas.push('telefone_novo_paciente nao deveria ser emitido');
      return problemas.length ? problemas.join('; ') : null;
    },
  },
]);

const TOTAL_CASOS = CASOS.length;

// --- Montagem local do payload (mesma funcao da producao) ---
function montarEntrada(caso: Caso) {
  return construirEntradaMinimizada(
    caso.mensagens,
    caso.snapshot,
    undefined, // horariosOferecidos
    undefined, // propostaPendente
    undefined, // historicoRecente
    undefined, // procedimentosDisponiveis
    undefined, // dentistasDisponiveis
    undefined, // ofertaProcedimentoPendente
    undefined, // cadastroPaciente
    undefined, // trocaTelefonePendente
    undefined, // agendamentosAtivos
    undefined, // agendamentosDoPaciente
    undefined, // tratamentosPendentes
    caso.pacientesDoContato // pacientesDoContato
  );
}

// --- DRY-RUN: nenhuma rede, nenhum custo, a chave nem e consultada ---
function rodarDryRun(): number {
  console.log('=== medicao-contato-multiplos-pacientes: DRY RUN (nenhuma chamada de API) ===');
  console.log(`modelo (execucao real): ${MODELO_IRIS_NOVA}`);
  console.log(`total de casos: ${TOTAL_CASOS}`);
  console.log(`timeout/tentativa: ${TIMEOUT_POR_TENTATIVA_MS_APROVADO}ms  prazo total: ${PRAZO_TOTAL_MS_APROVADO}ms  espera: ${ESPERA_ENTRE_TENTATIVAS_MS_APROVADO}ms`);
  console.log('');

  let falhaLocal = false;
  for (const caso of CASOS) {
    const entrada = montarEntrada(caso);
    const temLista = caso.pacientesDoContato !== undefined;
    const listaNoPayload = 'pacientes_do_contato' in entrada;
    if (temLista !== listaNoPayload) {
      falhaLocal = true;
      console.error(`[${caso.id}] FALHA LOCAL: pacientes_do_contato ${temLista ? 'esperado' : 'nao esperado'} no payload, mas ${listaNoPayload ? 'presente' : 'ausente'}`);
    }
    console.log(`[${caso.id}] ${caso.descricao}`);
    console.log(`  mensagens: ${JSON.stringify(caso.mensagens)}`);
    console.log(`  pacientes_do_contato no payload: ${listaNoPayload}${temLista ? ` (${caso.pacientesDoContato!.length} itens)` : ''}`);
    console.log('');
  }

  console.log('--- confirmacao desta execucao ---');
  console.log('modo: dry-run (nenhum argumento --execute)');
  console.log('chamadas reais: 0    tokens: 0    custo: US$ 0,00');
  console.log('arquivo de segredo (.iris-secrets/openai.env): NAO acessado');
  console.log('');
  console.log('Para execucao real (nova autorizacao explicita a cada vez):');
  console.log('  node --experimental-strip-types --env-file="C:\\Users\\Gabriel\\.iris-secrets\\openai.env" src/eval/medicao-contato-multiplos-pacientes.ts --execute');
  return falhaLocal ? 1 : 0;
}

// --- EXECUCAO REAL ---
const CODIGO_CONTRATO_AUSENTE = 'contrato_pacientes_do_contato_ausente_no_corpo_http';
const CODIGO_LIMITE_GLOBAL = 'limite_global_de_chamadas_atingido';

async function rodarExecucaoReal(): Promise<number> {
  const chaveApi = process.env.OPENAI_API_KEY;
  if (typeof chaveApi !== 'string' || chaveApi.trim() === '') {
    console.error('OPENAI_API_KEY ausente. Execute com --env-file apontando para .iris-secrets/openai.env. Encerrando sem nenhuma chamada.');
    return 1;
  }
  console.log('=== medicao-contato-multiplos-pacientes: EXECUCAO REAL ===');
  console.log(`modelo: ${MODELO_IRIS_NOVA}`);
  console.log('OPENAI_API_KEY: presente (valor nunca exibido)');
  console.log(`limite global de chamadas: ${TOTAL_CASOS} (uma por caso)`);
  console.log('');

  let chamadasGlobais = 0;
  let aprovados = 0;
  let reprovados = 0;

  for (const caso of CASOS) {
    const entrada = montarEntrada(caso);
    const esperaLista = caso.pacientesDoContato !== undefined;

    // fetchInspetor: captura o corpo HTTP real (nunca headers/Authorization),
    // aplica a GUARDA DE CONTRATO e o LIMITE GLOBAL antes de deixar a
    // requisicao sair, e delega ao fetch real.
    const fetchInspetor: typeof fetch = async (url, opcoes) => {
      if (chamadasGlobais >= TOTAL_CASOS) {
        throw new Error(CODIGO_LIMITE_GLOBAL);
      }
      const corpoBruto = String((opcoes as RequestInit | undefined)?.body ?? '');
      let contratoOk = true;
      try {
        const corpo = JSON.parse(corpoBruto) as { input?: Array<{ role: string; content: string }> };
        const conteudoUsuario = corpo.input?.find((i) => i.role === 'user')?.content ?? '';
        const parseado = JSON.parse(conteudoUsuario) as Record<string, unknown>;
        const listaNoCorpo = 'pacientes_do_contato' in parseado;
        if (esperaLista && !listaNoCorpo) contratoOk = false;
      } catch {
        contratoOk = false;
      }
      if (!contratoOk) {
        throw new Error(CODIGO_CONTRATO_AUSENTE);
      }
      chamadasGlobais += 1;
      return fetch(url, opcoes);
    };

    const cliente = criarClienteModeloOpenAI({
      chaveApi,
      modelo: MODELO_IRIS_NOVA,
      timeoutPorTentativaMs: TIMEOUT_POR_TENTATIVA_MS_APROVADO,
      prazoTotalMs: PRAZO_TOTAL_MS_APROVADO,
      esperaEntreTentativasMs: ESPERA_ENTRE_TENTATIVAS_MS_APROVADO,
      fetch: fetchInspetor,
    });

    const inicio = Date.now();
    try {
      const saida = await extrairAlteracoes(cliente, entrada);
      const duracaoMs = Date.now() - inicio;
      const motivo = caso.avaliar(saida);

      // Evidencia sanitizada: so campos do contrato (sinteticos), nunca
      // corpo bruto, chave ou headers.
      const evidencia = {
        caso: caso.id,
        aprovado: motivo === null,
        atendimento_para_terceiro: saida.atendimento_para_terceiro,
        outra_pessoa_alem_das_listadas: saida.outra_pessoa_alem_das_listadas,
        paciente_id: valorInformado(saida, 'paciente_id') ?? null,
        vinculo_novo_paciente: valorInformado(saida, 'vinculo_novo_paciente') ?? null,
        telefone_novo_paciente: valorInformado(saida, 'telefone_novo_paciente') ?? null,
        natureza_mensagem: saida.natureza_mensagem,
        duracao_ms: duracaoMs,
        motivo_reprovacao: motivo,
      };
      console.log(JSON.stringify(evidencia));
      if (motivo === null) aprovados += 1;
      else reprovados += 1;
    } catch (erro) {
      const duracaoMs = Date.now() - inicio;
      const codigo =
        erro instanceof Error && (erro.message === CODIGO_CONTRATO_AUSENTE || erro.message === CODIGO_LIMITE_GLOBAL)
          ? erro.message
          : erro instanceof Error && erro.name === 'ErroClienteModeloOpenAI'
            ? `ErroClienteModeloOpenAI:${(erro as { categoria?: string }).categoria ?? '?'}:${(erro as { codigo?: string }).codigo ?? '?'}`
            : 'erro_nao_classificado';
      console.log(JSON.stringify({ caso: caso.id, aprovado: false, erro: codigo, duracao_ms: duracaoMs }));
      reprovados += 1;
      if (codigo === CODIGO_LIMITE_GLOBAL) break;
    }
  }

  console.log('');
  console.log(`--- resumo: ${aprovados}/${TOTAL_CASOS} aprovados, ${reprovados} reprovados ---`);
  console.log(`chamadas de rede realizadas: ${chamadasGlobais} (limite: ${TOTAL_CASOS})`);
  return aprovados === TOTAL_CASOS ? 0 : 1;
}

async function main(): Promise<void> {
  const execute = process.argv.slice(2).includes('--execute');
  process.exitCode = execute ? await rodarExecucaoReal() : rodarDryRun();
}

const ehExecucaoDireta = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (ehExecucaoDireta) {
  void main();
}
