// Dublê de ClienteBancoDados para testes de unidade — nunca acessa rede ou
// banco real. Implementa apenas o subconjunto de comportamento usado por
// identificacao.ts: select/eq/is/maybeSingle, upsert com onConflict +
// ignoreDuplicates, e update com filtro (incluindo IS NULL), reproduzindo a
// semantica do PostgREST (0 linhas afetadas quando o WHERE nao casa mais
// nenhuma linha).
import type { ClienteBancoDados, ConsultaEncadeavel } from './tipos.ts';

export interface TabelasFalsas {
  clinicas: Record<string, unknown>[];
  pacientes: Record<string, unknown>[];
  estado_conversa: Record<string, unknown>[];
  mensagens_recebidas: Record<string, unknown>[];
  horarios_bloqueados: Record<string, unknown>[];
  agendamentos: Record<string, unknown>[];
  procedimentos_catalogo: Record<string, unknown>[];
}

export function criarTabelasFalsasVazias(): TabelasFalsas {
  return {
    clinicas: [],
    pacientes: [],
    estado_conversa: [],
    mensagens_recebidas: [],
    horarios_bloqueados: [],
    agendamentos: [],
    procedimentos_catalogo: [],
  };
}

class ConsultaFalsa implements ConsultaEncadeavel {
  private readonly todasLinhas: Record<string, unknown>[];
  private readonly linhasFiltradas: Record<string, unknown>[] | null;
  private readonly erro: { message: string } | null;

  constructor(
    todasLinhas: Record<string, unknown>[],
    linhasFiltradas: Record<string, unknown>[] | null,
    erro: { message: string } | null
  ) {
    this.todasLinhas = todasLinhas;
    this.linhasFiltradas = linhasFiltradas;
    this.erro = erro;
  }

  eq(coluna: string, valor: unknown): ConsultaEncadeavel {
    const base = this.linhasFiltradas ?? this.todasLinhas;
    return new ConsultaFalsa(
      this.todasLinhas,
      base.filter((linha) => linha[coluna] === valor),
      this.erro
    );
  }

  is(coluna: string, valor: null): ConsultaEncadeavel {
    return this.eq(coluna, valor);
  }

  // Comparacao com `>=` de string, mesma semantica do PostgREST para uma
  // coluna `date` em YYYY-MM-DD (ordem lexicografica == ordem cronologica).
  // Linha com valor nulo/ausente NUNCA passa -- em SQL, `null >= x` e NULL,
  // que o WHERE descarta.
  gte(coluna: string, valor: unknown): ConsultaEncadeavel {
    const base = this.linhasFiltradas ?? this.todasLinhas;
    return new ConsultaFalsa(
      this.todasLinhas,
      base.filter((linha) => {
        const atual = linha[coluna];
        if (atual === null || atual === undefined) return false;
        return (atual as string | number) >= (valor as string | number);
      }),
      this.erro
    );
  }

  not(coluna: string, operador: string, valor: unknown): ConsultaEncadeavel {
    if (operador !== 'is' || valor !== null) {
      throw new Error(`ConsultaFalsa.not: combinacao nao suportada (${operador}, ${String(valor)})`);
    }
    const base = this.linhasFiltradas ?? this.todasLinhas;
    return new ConsultaFalsa(
      this.todasLinhas,
      base.filter((linha) => linha[coluna] !== null && linha[coluna] !== undefined),
      this.erro
    );
  }

  select(_colunas: string): ConsultaEncadeavel {
    return this;
  }

  async maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }> {
    // yield explicito: garante que chamadas concorrentes (Promise.all)
    // realmente se intercalem no event loop, como aconteceria com I/O real.
    await Promise.resolve();
    if (this.erro) return { data: null, error: this.erro };
    const linhas = this.linhasFiltradas ?? this.todasLinhas;
    if (linhas.length > 1) {
      return { data: null, error: { message: 'mais de uma linha encontrada' } };
    }
    return { data: linhas[0] ?? null, error: null };
  }

  // Torna a consulta aguardavel diretamente (await consulta), mesmo
  // protocolo do PostgrestFilterBuilder real -- nunca um metodo nomeado.
  then<TResult1 = { data: Record<string, unknown>[]; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: Record<string, unknown>[] | null; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): PromiseLike<TResult1 | TResult2> {
    const resultado = (async () => {
      await Promise.resolve();
      if (this.erro) return { data: null, error: this.erro };
      return { data: this.linhasFiltradas ?? this.todasLinhas, error: null };
    })();
    return resultado.then(onfulfilled, onrejected);
  }
}

// 'eq' cobre .eq() e .is(coluna, null); 'not_null' cobre .not(coluna, 'is', null)
// -- a unica combinacao de .not() usada hoje (ver ConsultaEncadeavel.not em tipos.ts).
type Filtro =
  | { tipo: 'eq'; coluna: string; valor: unknown }
  | { tipo: 'not_null'; coluna: string }
  | { tipo: 'gte'; coluna: string; valor: unknown };

function filtroCasa(linha: Record<string, unknown>, filtro: Filtro): boolean {
  if (filtro.tipo === 'eq') return linha[filtro.coluna] === filtro.valor;
  if (filtro.tipo === 'gte') {
    const atual = linha[filtro.coluna];
    if (atual === null || atual === undefined) return false;
    return (atual as string | number) >= (filtro.valor as string | number);
  }
  return linha[filtro.coluna] !== null && linha[filtro.coluna] !== undefined;
}

class AtualizacaoFalsa implements ConsultaEncadeavel {
  private readonly linhas: Record<string, unknown>[];
  private readonly valores: Record<string, unknown>;
  private readonly filtros: Filtro[];

  constructor(linhas: Record<string, unknown>[], valores: Record<string, unknown>, filtros: Filtro[]) {
    this.linhas = linhas;
    this.valores = valores;
    this.filtros = filtros;
  }

  eq(coluna: string, valor: unknown): ConsultaEncadeavel {
    return new AtualizacaoFalsa(this.linhas, this.valores, [...this.filtros, { tipo: 'eq', coluna, valor }]);
  }

  is(coluna: string, valor: null): ConsultaEncadeavel {
    return this.eq(coluna, valor);
  }

  gte(coluna: string, valor: unknown): ConsultaEncadeavel {
    return new AtualizacaoFalsa(this.linhas, this.valores, [...this.filtros, { tipo: 'gte', coluna, valor }]);
  }

  not(coluna: string, operador: string, valor: unknown): ConsultaEncadeavel {
    if (operador !== 'is' || valor !== null) {
      throw new Error(`AtualizacaoFalsa.not: combinacao nao suportada (${operador}, ${String(valor)})`);
    }
    return new AtualizacaoFalsa(this.linhas, this.valores, [...this.filtros, { tipo: 'not_null', coluna }]);
  }

  select(_colunas: string): ConsultaEncadeavel {
    return this;
  }

  async maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }> {
    // yield explicito, igual ConsultaFalsa — mas a checagem do WHERE e a
    // mutacao abaixo acontecem em um unico trecho sincrono apos o yield,
    // reproduzindo a atomicidade de um UPDATE real: nenhuma outra chamada
    // "concorrente" consegue intercalar entre o find e o Object.assign.
    await Promise.resolve();
    const alvo = this.linhas.find((linha) => this.filtros.every((f) => filtroCasa(linha, f)));
    if (!alvo) return { data: null, error: null };
    Object.assign(alvo, this.valores);
    return { data: alvo, error: null };
  }

  // Nunca exercitado pelos fluxos reais de update (sempre terminam em
  // maybeSingle) -- existe so para satisfazer o contrato de ConsultaEncadeavel
  // (aguardavel diretamente, mesmo protocolo do PostgrestFilterBuilder real).
  then<TResult1 = { data: Record<string, unknown>[]; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: Record<string, unknown>[] | null; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): PromiseLike<TResult1 | TResult2> {
    const resultado = (async () => {
      await Promise.resolve();
      return { data: this.linhas.filter((linha) => this.filtros.every((f) => filtroCasa(linha, f))), error: null };
    })();
    return resultado.then(onfulfilled, onrejected);
  }
}

export class ClienteFalso implements ClienteBancoDados {
  private readonly tabelas: TabelasFalsas;
  // instrumentacao para testes: numero de vezes que .update()/.select()
  // foram chamados, por tabela — usada para provar que um vinculo ja
  // existente nunca dispara uma tentativa de atualizacao, e que contexto
  // invalido rejeita antes de qualquer leitura ou escrita no banco.
  readonly estatisticas: { chamadasUpdate: Record<string, number>; chamadasSelect: Record<string, number> } = {
    chamadasUpdate: {},
    chamadasSelect: {},
  };

  constructor(tabelas: TabelasFalsas) {
    this.tabelas = tabelas;
  }

  from(nome: string) {
    const linhas = this.tabelas[nome as keyof TabelasFalsas];
    if (!linhas) {
      throw new Error(`tabela falsa desconhecida: ${nome}`);
    }
    return {
      select: (_colunas: string): ConsultaEncadeavel => {
        this.estatisticas.chamadasSelect[nome] = (this.estatisticas.chamadasSelect[nome] ?? 0) + 1;
        return new ConsultaFalsa(linhas, null, null);
      },
      upsert: (
        valores: Record<string, unknown>,
        opcoes: { onConflict: string; ignoreDuplicates: boolean }
      ): ConsultaEncadeavel => {
        const colunasConflito = opcoes.onConflict.split(',');
        const existente = linhas.find((linha) => colunasConflito.every((coluna) => linha[coluna] === valores[coluna]));
        if (existente) {
          if (opcoes.ignoreDuplicates) {
            return new ConsultaFalsa(linhas, [], null);
          }
          return new ConsultaFalsa(linhas, [], { message: 'conflito de unicidade' });
        }
        // `estado_conversa.atualizado_em` e `not null default now()` no
        // schema real -- o dublê precisa aplicar o mesmo default no insert,
        // senao a linha volta sem o campo e a validacao de identificacao
        // (que exige atualizado_em) falharia so aqui, nunca em producao.
        const padroes = nome === 'estado_conversa' ? { atualizado_em: new Date().toISOString() } : {};
        const nova = { id: crypto.randomUUID(), ...padroes, ...valores };
        linhas.push(nova);
        return new ConsultaFalsa(linhas, [nova], null);
      },
      update: (valores: Record<string, unknown>): ConsultaEncadeavel => {
        this.estatisticas.chamadasUpdate[nome] = (this.estatisticas.chamadasUpdate[nome] ?? 0) + 1;
        return new AtualizacaoFalsa(linhas, valores, []);
      },
    };
  }
}
