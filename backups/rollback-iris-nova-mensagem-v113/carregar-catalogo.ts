// Carregador minimo: busca no banco somente os dados que os resolvedores de
// procedimento/dentista/duracao ja prontos precisam (CatalogoClinica,
// orquestrador-tipos.ts). Nao decide nada de dominio -- so traduz o schema
// real (clinicas.dentistas jsonb + procedimentos_catalogo, tabela global)
// para o contrato ja aprovado. Mesmo espirito de carregar-disponibilidade.ts
// -- nenhum dos resolvedores e alterado aqui, nenhum deles e reimplementado.
//
// DURACAO POR DENTISTA (regra vigente desde 30/08/2026, decisao do Gabriel):
//
// 1. Este carregador produz a configuracao de duracao por
//    `clinica_id + dentista_id + procedimento_id` -- uma entrada por dentista
//    ATIVO (nunca de um inativo, ver montarDentistas), com o valor efetivo
//    DAQUELE profissional: modo `auto` usa a duracao padrao dele; modo
//    `procedimento` usa o tempo daquele procedimento nele.
//
//    Duracoes diferentes entre dentistas sao configuracao VALIDA (visto na
//    ClearDent, e confirmado como intencional). Cada um resolve exclusivamente
//    a propria; a de um colega nunca e consultada nem comparada.
//
//    Somente contradicoes DENTRO DA MESMA CHAVE -- mesmo dentista, mesmo
//    procedimento, mesma clinica -- produzem `duracao_conflitante`, e nunca
//    sao escolhidas em silencio.
//
//    [REGRA ANTERIOR, REVOGADA -- registro historico] Antes, a chave nao tinha
//    `dentista_id`: os valores de todos os dentistas ativos caiam juntos em
//    `clinica_id + procedimento_id`, e a divergencia legitima entre eles virava
//    `duracao_conflitante`. Isso derrubou uma clinica real em producao (v91):
//    tres profissionais com 60, 30 e 30 minutos para a mesma avaliacao
//    bloqueavam o agendamento daquele procedimento para a clinica inteira.
//    [FIM DO REGISTRO HISTORICO]

import { EntradaInvalidaError } from './erros.ts';
import type { ClienteBancoDados } from './tipos.ts';
import type { CatalogoClinica } from './orquestrador-tipos.ts';
import type { ProcedimentoOficial } from './procedimento-tipos.ts';
import type { DentistaOficial, VinculoDentistaProcedimento } from './dentista-tipos.ts';
import type { ConfiguracaoDuracao } from './duracao-tipos.ts';
import type { LinhaClinica } from './clinica-conhecida.ts';
import { derivarClinicaConhecida } from './clinica-conhecida.ts';
import { derivarPrecosClinica } from './precos-clinica.ts';
import { derivarDentistasDaClinica } from './dentistas-da-clinica.ts';

export interface EntradaCarregarCatalogo {
  clinica_id: string;
}

export type ResultadoCarregarCatalogo =
  | { tipo: 'carregado'; catalogo: CatalogoClinica }
  | { tipo: 'clinica_nao_encontrada' };

export async function carregarCatalogo(
  cliente: ClienteBancoDados,
  entrada: EntradaCarregarCatalogo
): Promise<ResultadoCarregarCatalogo> {
  validarFormaEntrada(entrada);

  const clinica = await buscarClinicaComDentistas(cliente, entrada.clinica_id);
  if (!clinica) return { tipo: 'clinica_nao_encontrada' };

  // As duas leituras do catalogo global vao em PARALELO -- especialidades sao
  // 10 linhas e nao dependem de procedimentos (2026-08-18).
  const [procedimentosCatalogo, especialidades] = await Promise.all([
    buscarProcedimentosCatalogo(cliente),
    buscarEspecialidadesCatalogo(cliente),
  ]);

  const procedimentos = montarProcedimentos(entrada.clinica_id, procedimentosCatalogo);
  const { dentistas, vinculos, configuracoesDuracao } = montarDentistas(
    entrada.clinica_id,
    clinica.dentistas,
    procedimentosCatalogo
  );

  return {
    tipo: 'carregado',
    catalogo: {
      procedimentos,
      dentistas,
      vinculos,
      configuracoesDuracao,
      exigirEmail: derivarExigirEmail(clinica.automatizacoes),
      // `undefined` quando a clinica nao preencheu nada -- fato ausente e
      // melhor que fato vazio: a Iris se cala em vez de anunciar um endereco
      // em branco ou um preco que ninguem liberou.
      ...(derivarClinicaConhecida(clinica.identidade) !== undefined
        ? { clinicaConhecida: derivarClinicaConhecida(clinica.identidade) }
        : {}),
      ...(derivarPrecosClinica(clinica.precios) !== undefined
        ? { precos: derivarPrecosClinica(clinica.precios) }
        : {}),
      // Quem ATENDE, com as especialidades de cada um (2026-08-18). Sai do
      // que ja foi montado neste turno -- nenhuma consulta a mais.
      ...(() => {
        const lista = derivarDentistasDaClinica(
          dentistas,
          vinculos,
          procedimentos.map((p) => {
            const esp = especialidades.get(
              procedimentosCatalogo.find((pc) => pc.id === p.procedimento_id)?.especialidade_id ?? ''
            );
            return esp !== undefined ? { ...p, especialidade: esp } : p;
          })
        );
        return lista !== undefined ? { dentistasDaClinica: lista } : {};
      })(),
    },
  };
}

// --- Clinica (clinicas.dentistas, jsonb) ---

interface ClinicaCarregada {
  dentistas: unknown;
  automatizacoes: unknown;
  /**
   * Dados de identidade/localizacao da clinica e tabela de precos
   * (2026-08-17). Somados ao MESMO select que ja existia -- nenhuma consulta
   * nova, nenhuma coluna criada: todas ja eram preenchidas pelo painel, que
   * e a fonte da verdade. Ate aqui a Iris nunca as lia, e por isso nao sabia
   * dizer o nome nem o endereco da clinica onde trabalha.
   */
  identidade: LinhaClinica;
  precios: unknown;
}

async function buscarClinicaComDentistas(
  cliente: ClienteBancoDados,
  clinicaId: string
): Promise<ClinicaCarregada | null> {
  // `automatizacoes` entrou em 2026-08-10 (specs/cadastro-conversacional-v1.md
  // secao 2): e de onde sai `solicitar_email`. Somado ao SELECT que ja existia
  // -- nenhuma consulta nova, nenhuma coluna nova.
  const { data, error } = await cliente
    .from('clinicas')
    .select(
      'dentistas, automatizacoes, ' +
        // Identidade/localizacao -- o que a Iris usa para dizer quem e e onde
        // fica, e para mandar o mapa a quem nao sabe chegar.
        'nome, endereco, bairro, cidade, estado, cep, sala, referencia, maps_link, ' +
        'telefone, email_clinica, horario_funcionamento, ' +
        // Precos: o filtro de consentimento (`mostrar_valor`) e aplicado no
        // Core, nunca aqui -- este ponto so LE a coluna.
        'precios'
    )
    .eq('id', clinicaId)
    .maybeSingle();
  if (error) throw new Error(`falha ao buscar clinica: ${error.message}`);
  if (!data) return null;
  const linha = data as Record<string, unknown>;
  return {
    dentistas: linha.dentistas,
    automatizacoes: linha.automatizacoes,
    identidade: linha as LinhaClinica,
    precios: linha.precios,
  };
}

/**
 * `clinicas.automatizacoes.solicitar_email` -- a MESMA chave que o pipeline
 * legado ja usa (cappia_confirmar_acao_pendente). Nao existe coluna
 * `exigir_email`, por decisao do Gabriel: criar outra representacao da mesma
 * regra de produto seria duplicacao.
 *
 * FALHA PARA `false` de proposito: ausente, malformada ou nao-booleana
 * significa "e-mail nao exigido". A obrigacao precisa ser AFIRMATIVA -- uma
 * clinica nunca passa a exigir e-mail por causa de um jsonb corrompido.
 */
function derivarExigirEmail(automatizacoes: unknown): boolean {
  if (automatizacoes === null || typeof automatizacoes !== 'object' || Array.isArray(automatizacoes)) {
    return false;
  }
  return (automatizacoes as Record<string, unknown>).solicitar_email === true;
}

// --- Catalogo global de procedimentos (procedimentos_catalogo, sem clinica_id) ---

interface ProcedimentoCatalogoRow {
  id: string;
  especialidade_id: string | null;
  nome_pt: string;
  nome_es: string | null;
  nome_en: string | null;
  nome_fr: string | null;
  nome_de: string | null;
  nome_it: string | null;
  nome_ru: string | null;
  nome_ar: string | null;
  tempo_padrao: number | null;
  ativo: boolean;
}

async function buscarProcedimentosCatalogo(cliente: ClienteBancoDados): Promise<ProcedimentoCatalogoRow[]> {
  const { data, error } = await cliente
    .from('procedimentos_catalogo')
    .select(
      'id, nome_pt, nome_es, nome_en, nome_fr, nome_de, nome_it, nome_ru, nome_ar, tempo_padrao, ativo, ' +
        // 2026-08-18: de onde sai a especialidade de cada dentista. Somado ao
        // MESMO select -- nenhuma consulta nova por turno.
        'especialidade_id'
    );
  if (error) throw new Error(`falha ao buscar procedimentos_catalogo: ${error.message}`);

  const resultado: ProcedimentoCatalogoRow[] = [];
  for (const linha of data ?? []) {
    const l = linha as Record<string, unknown>;
    if (typeof l.id !== 'string' || typeof l.nome_pt !== 'string') continue; // linha sem identidade minima: ignorada, nunca inventada.
    resultado.push({
      id: l.id,
      especialidade_id: typeof l.especialidade_id === 'string' ? l.especialidade_id : null,
      nome_pt: l.nome_pt,
      nome_es: typeof l.nome_es === 'string' ? l.nome_es : null,
      nome_en: typeof l.nome_en === 'string' ? l.nome_en : null,
      nome_fr: typeof l.nome_fr === 'string' ? l.nome_fr : null,
      nome_de: typeof l.nome_de === 'string' ? l.nome_de : null,
      nome_it: typeof l.nome_it === 'string' ? l.nome_it : null,
      nome_ru: typeof l.nome_ru === 'string' ? l.nome_ru : null,
      nome_ar: typeof l.nome_ar === 'string' ? l.nome_ar : null,
      tempo_padrao: typeof l.tempo_padrao === 'number' ? l.tempo_padrao : null,
      ativo: l.ativo === true,
    });
  }
  return resultado;
}

/**
 * Nomes das especialidades (`especialidades_catalogo`, tabela GLOBAL, sem
 * clinica_id -- mesma natureza de `procedimentos_catalogo`).
 *
 * Existe porque `procedimentos_catalogo.especialidade_id` guarda um id em
 * ingles (`general`, `endodontics`); o paciente precisa ouvir "Clinico
 * Geral", "Endodontia". Sao 10 linhas, lidas em paralelo com os
 * procedimentos.
 *
 * Falha de leitura NAO derruba o turno: sem os nomes, os dentistas aparecem
 * sem especialidade -- que e exatamente o comportamento de quando nao ha
 * vinculo. Um atendimento inteiro nunca deve cair por causa de um rotulo.
 */
async function buscarEspecialidadesCatalogo(
  cliente: ClienteBancoDados
): Promise<ReadonlyMap<string, string>> {
  const mapa = new Map<string, string>();
  try {
    const { data, error } = await cliente
      .from('especialidades_catalogo')
      .select('id, nome_pt, ativo');
    if (error) return mapa;
    for (const linha of data ?? []) {
      const l = linha as Record<string, unknown>;
      if (l.ativo !== true) continue;
      if (typeof l.id !== 'string' || typeof l.nome_pt !== 'string') continue;
      if (l.nome_pt.trim() === '') continue;
      mapa.set(l.id, l.nome_pt);
    }
  } catch {
    // Ver comentario acima: rotulo ausente nunca derruba o atendimento.
  }
  return mapa;
}

// REMOVIDO em 2026-08-08 (specs/procedimento-semantico-v1.md):
// `SINONIMOS_INFORMAIS` e o loop que transformava os 8 nomes multilingues em
// `AliasProcedimento`. Toda essa maquinaria existia para o Core casar TEXTO
// do paciente contra o catalogo -- uma lista que crescia a cada forma nova de
// falar e que, mesmo assim, nunca cobriria "quero que o dentista de uma
// olhada". Quem entende linguagem agora e a IA interpretadora, que recebe
// `{procedimento_id, nome_pt}` e devolve o id canonico.
//
// `nome_pt` continua sendo carregado -- deixou de ser chave de match e passou
// a ser o texto que a IA LE para compreender o pedido. As outras 7 colunas de
// nome (es/en/fr/de/it/ru/ar) nao sao mais lidas: existiam apenas como fonte
// de alias.

function montarProcedimentos(
  clinicaId: string,
  linhas: readonly ProcedimentoCatalogoRow[]
): ProcedimentoOficial[] {
  return linhas.map((linha) => ({
    procedimento_id: linha.id,
    clinica_id: clinicaId,
    nome_pt: linha.nome_pt,
    ativo: linha.ativo,
  }));
}

// --- Dentistas (clinicas.dentistas[i]) ---

function montarDentistas(
  clinicaId: string,
  dentistasBrutos: unknown,
  procedimentosCatalogo: readonly ProcedimentoCatalogoRow[]
): {
  dentistas: DentistaOficial[];
  vinculos: VinculoDentistaProcedimento[];
  configuracoesDuracao: ConfiguracaoDuracao[];
} {
  const dentistas: DentistaOficial[] = [];
  const vinculos: VinculoDentistaProcedimento[] = [];
  const configuracoesDuracao: ConfiguracaoDuracao[] = [];

  if (!Array.isArray(dentistasBrutos)) {
    return { dentistas, vinculos, configuracoesDuracao };
  }

  for (const bruto of dentistasBrutos) {
    if (bruto === null || typeof bruto !== 'object') continue; // registro sem forma minima: ignorado, nunca inventado.
    const registro = bruto as Record<string, unknown>;

    const dentistaId = typeof registro.id === 'string' ? registro.id : null;
    if (!dentistaId) continue;

    const nome = typeof registro.nome === 'string' ? registro.nome.trim() : '';
    const titulo = typeof registro.titulo === 'string' ? registro.titulo.trim() : '';
    const nomeCompleto = [titulo, nome].filter((parte) => parte !== '').join(' ');

    // REMOVIDO em 2026-08-09 (specs/dentista-semantico-v1.md):
    // `nome_completo_resolucao` e `nome_curto_resolucao`. Existiam so como
    // chave de match textual em resolverPorPreferencia, que nao existe mais.
    // `nome_exibido` continua sendo montado igual -- deixou de ser chave e
    // passou a ser o texto que a IA LE em `dentistas_disponiveis`.
    const ativo = registro.ativo === true;
    dentistas.push({
      dentista_id: dentistaId,
      clinica_id: clinicaId,
      nome_exibido: nomeCompleto !== '' ? nomeCompleto : nome,
      ativo,
    });

    // Dentista inativo continua listado acima (resolverDentista ja decide o
    // que fazer com ele) -- mas nunca projeta vinculo nem duracao: um valor
    // divergente de um dentista inativo nao pode gerar duracao_conflitante
    // e bloquear um dentista realmente ativo (achado do Codex).
    if (!ativo) continue;

    const modo = typeof registro.modo === 'string' ? registro.modo : 'auto';
    const duracaoAuto = typeof registro.dur === 'number' ? registro.dur : null;
    const procedimentosDoDentista = Array.isArray(registro.procedimentos) ? registro.procedimentos : [];

    for (const item of procedimentosDoDentista) {
      if (item === null || typeof item !== 'object') continue;
      const p = item as Record<string, unknown>;
      const procedimentoId = typeof p.id === 'string' ? p.id : null;
      if (!procedimentoId || p.ativo !== true) continue;

      vinculos.push({ clinica_id: clinicaId, dentista_id: dentistaId, procedimento_id: procedimentoId, ativo: true });

      // Mesma regra de coalescencia que cappia__resolver_duracao (legado, ja
      // em producao) usa hoje: modo 'procedimento' usa o tempo do proprio
      // item; qualquer outro modo usa a duracao unica do dentista; sem
      // nenhum dos dois, cai pro tempo_padrao do catalogo. Nunca inventado
      // aqui -- e o mesmo caminho ja validado no teste integrado da branch.
      const tempoItem = typeof p.tempo === 'number' ? p.tempo : null;
      const tempoPadrao = procedimentosCatalogo.find((c) => c.id === procedimentoId)?.tempo_padrao ?? null;
      const duracao = modo === 'procedimento' ? (tempoItem ?? tempoPadrao) : (duracaoAuto ?? tempoPadrao);

      // `dentista_id` viaja junto desde 2026-08-30: sem ele, esta lista
      // empilhava as duracoes de TODOS os profissionais sob a mesma chave
      // `(clinica_id, procedimento_id)`, e duracoes legitimamente diferentes
      // entre dentistas viravam `duracao_conflitante` -- caso real de
      // producao (v91). Ver `ConfiguracaoDuracao` em duracao-tipos.ts.
      //
      // A regra de coalescencia acima NAO mudou: cada dentista continua
      // produzindo exatamente a mesma duracao que produzia; o que muda e que
      // agora ela fica identificada como DELE.
      if (duracao !== null) {
        configuracoesDuracao.push({
          clinica_id: clinicaId,
          dentista_id: dentistaId,
          procedimento_id: procedimentoId,
          duracao_min: duracao,
        });
      }
    }
  }

  return { dentistas, vinculos, configuracoesDuracao };
}

// --- Validacao de forma da entrada ---

const CHAVES_ENTRADA = ['clinica_id'] as const;

function validarFormaEntrada(entrada: unknown): asserts entrada is EntradaCarregarCatalogo {
  if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw new EntradaInvalidaError('entrada', 'entrada deve ser um objeto');
  }
  const chaves = Object.keys(entrada as Record<string, unknown>);
  const esperadas: readonly string[] = CHAVES_ENTRADA;
  if (chaves.length !== esperadas.length || !esperadas.every((chave) => chaves.includes(chave))) {
    throw new EntradaInvalidaError('entrada', 'entrada contem propriedade nao permitida');
  }
  const { clinica_id } = entrada as Record<string, unknown>;
  if (typeof clinica_id !== 'string' || clinica_id.trim() === '') {
    throw new EntradaInvalidaError('clinica_id', 'clinica_id deve ser uma string nao vazia');
  }
}
