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
}

export function criarTabelasFalsasVazias(): TabelasFalsas {
  return { clinicas: [], pacientes: [], estado_conversa: [] };
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
}

type Filtro = { coluna: string; valor: unknown };

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
    return new AtualizacaoFalsa(this.linhas, this.valores, [...this.filtros, { coluna, valor }]);
  }

  is(coluna: string, valor: null): ConsultaEncadeavel {
    return this.eq(coluna, valor);
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
    const alvo = this.linhas.find((linha) => this.filtros.every((f) => linha[f.coluna] === f.valor));
    if (!alvo) return { data: null, error: null };
    Object.assign(alvo, this.valores);
    return { data: alvo, error: null };
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
        const nova = { id: crypto.randomUUID(), ...valores };
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
