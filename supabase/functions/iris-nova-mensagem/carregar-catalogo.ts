// Carregador minimo: busca no banco somente os dados que os resolvedores de
// procedimento/dentista/duracao ja prontos precisam (CatalogoClinica,
// orquestrador-tipos.ts). Nao decide nada de dominio -- so traduz o schema
// real (clinicas.dentistas jsonb + procedimentos_catalogo, tabela global)
// para o contrato ja aprovado. Mesmo espirito de carregar-disponibilidade.ts
// -- nenhum dos resolvedores e alterado aqui, nenhum deles e reimplementado.
//
// Duas simplificacoes deliberadas, por causa do schema real (nao inventadas
// aqui, apenas o reflexo honesto do que existe hoje):
//
// 1. procedimentos_catalogo nao tem eh_consulta_avaliacao -- nao ha fonte
//    real pra esse dado ainda, entao todo procedimento carrega `false`.
//    Nunca escolhe Consulta/Avaliacao por conta propria (isso permanece
//    responsabilidade do controlador, nao deste carregador).
// 2. resolverDuracao (nao alterado) exige UMA duracao por clinica+
//    procedimento; a duracao real hoje pode variar por dentista (visto na
//    ClearDent). Este carregador nao escolhe qual delas vale -- projeta o
//    valor efetivo de cada dentista ATIVO (nunca de um inativo, ver
//    montarDentistas) como uma configuracao, e deixa o proprio
//    resolverDuracao (que ja detecta conflito) decidir se e consistente ou
//    nao. Divergencia real entre dentistas ativos vira `duracao_conflitante`,
//    nunca escolhida em silencio.

import { EntradaInvalidaError } from './erros.ts';
import type { ClienteBancoDados } from './tipos.ts';
import type { CatalogoClinica } from './orquestrador-tipos.ts';
import type { AliasProcedimento, ProcedimentoOficial } from './procedimento-tipos.ts';
import type { DentistaOficial, VinculoDentistaProcedimento } from './dentista-tipos.ts';
import type { ConfiguracaoDuracao } from './duracao-tipos.ts';

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

  const procedimentosCatalogo = await buscarProcedimentosCatalogo(cliente);

  const { procedimentos, aliasesProcedimento } = montarProcedimentos(entrada.clinica_id, procedimentosCatalogo);
  const { dentistas, vinculos, configuracoesDuracao } = montarDentistas(
    entrada.clinica_id,
    clinica.dentistas,
    procedimentosCatalogo
  );

  return {
    tipo: 'carregado',
    catalogo: { procedimentos, aliasesProcedimento, dentistas, vinculos, configuracoesDuracao },
  };
}

// --- Clinica (clinicas.dentistas, jsonb) ---

interface ClinicaCarregada {
  dentistas: unknown;
}

async function buscarClinicaComDentistas(
  cliente: ClienteBancoDados,
  clinicaId: string
): Promise<ClinicaCarregada | null> {
  const { data, error } = await cliente.from('clinicas').select('dentistas').eq('id', clinicaId).maybeSingle();
  if (error) throw new Error(`falha ao buscar clinica: ${error.message}`);
  if (!data) return null;
  return { dentistas: (data as Record<string, unknown>).dentistas };
}

// --- Catalogo global de procedimentos (procedimentos_catalogo, sem clinica_id) ---

interface ProcedimentoCatalogoRow {
  id: string;
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
    .select('id, nome_pt, nome_es, nome_en, nome_fr, nome_de, nome_it, nome_ru, nome_ar, tempo_padrao, ativo');
  if (error) throw new Error(`falha ao buscar procedimentos_catalogo: ${error.message}`);

  const resultado: ProcedimentoCatalogoRow[] = [];
  for (const linha of data ?? []) {
    const l = linha as Record<string, unknown>;
    if (typeof l.id !== 'string' || typeof l.nome_pt !== 'string') continue; // linha sem identidade minima: ignorada, nunca inventada.
    resultado.push({
      id: l.id,
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

// Sinonimos informais que pacientes usam no dia a dia, alem dos 8 nomes
// oficiais do catalogo -- mecanismo de alias ja existente (AliasProcedimento),
// so mais uma fonte de texto por procedimento_id. Escopo minimo, decidido
// por Gabriel em 2026-08-05: comecar so por "limpeza" -> cleaning. Herda
// `ativo` do proprio procedimento no catalogo (mesma regra dos 8 nomes
// oficiais): se "cleaning" for desativado, "limpeza" tambem fica inativa.
const SINONIMOS_INFORMAIS: Readonly<Record<string, readonly string[]>> = {
  cleaning: ['limpeza'],
};

function montarProcedimentos(
  clinicaId: string,
  linhas: readonly ProcedimentoCatalogoRow[]
): { procedimentos: ProcedimentoOficial[]; aliasesProcedimento: AliasProcedimento[] } {
  const procedimentos: ProcedimentoOficial[] = [];
  const aliasesProcedimento: AliasProcedimento[] = [];

  for (const linha of linhas) {
    procedimentos.push({
      procedimento_id: linha.id,
      clinica_id: clinicaId,
      nome_pt: linha.nome_pt,
      ativo: linha.ativo,
      // procedimentos_catalogo nao tem esse dado hoje -- ver nota de topo.
      eh_consulta_avaliacao: false,
    });

    // As 8 colunas de nome multilingue sao os aliases reais: e exatamente
    // como cappia__resolver_procedimento (legado, ja em producao) resolve
    // texto -> procedimento_id hoje. Nunca duplicado: nomes identicos entre
    // idiomas geram o mesmo texto de alias mais de uma vez, o que o
        // resolvedor novo ja trata como aliases equivalentes (mesmo destino).
    for (const nome of [
      linha.nome_pt,
      linha.nome_es,
      linha.nome_en,
      linha.nome_fr,
      linha.nome_de,
      linha.nome_it,
      linha.nome_ru,
      linha.nome_ar,
    ]) {
      if (typeof nome === 'string' && nome.trim() !== '') {
        aliasesProcedimento.push({ clinica_id: clinicaId, procedimento_id: linha.id, texto: nome, ativo: linha.ativo });
      }
    }

    for (const sinonimo of SINONIMOS_INFORMAIS[linha.id] ?? []) {
      aliasesProcedimento.push({ clinica_id: clinicaId, procedimento_id: linha.id, texto: sinonimo, ativo: linha.ativo });
    }
  }

  return { procedimentos, aliasesProcedimento };
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
    // Mesmo par que cappia__resolver_dentista (legado) ja aceita como
    // entrada valida hoje: "Titulo Nome" (completo) OU so "Nome" (curto).
    const nomeCompleto = [titulo, nome].filter((parte) => parte !== '').join(' ');

    const ativo = registro.ativo === true;
    dentistas.push({
      dentista_id: dentistaId,
      clinica_id: clinicaId,
      nome_exibido: nomeCompleto !== '' ? nomeCompleto : nome,
      nome_completo_resolucao: nomeCompleto,
      nome_curto_resolucao: nome !== '' ? nome : null,
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

      if (duracao !== null) {
        configuracoesDuracao.push({ clinica_id: clinicaId, procedimento_id: procedimentoId, duracao_min: duracao });
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
