// Dublê de ClienteBancoDados para testes de unidade — nunca acessa rede ou
// banco real. Implementa apenas o subconjunto de comportamento usado por
// identificacao.ts: select/eq/maybeSingle e upsert com onConflict +
// ignoreDuplicates, reproduzindo a semantica do PostgREST (0 linhas
// retornadas quando ignoreDuplicates encontra conflito).
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

export class ClienteFalso implements ClienteBancoDados {
  private readonly tabelas: TabelasFalsas;

  constructor(tabelas: TabelasFalsas) {
    this.tabelas = tabelas;
  }

  from(nome: string) {
    const linhas = this.tabelas[nome as keyof TabelasFalsas];
    if (!linhas) {
      throw new Error(`tabela falsa desconhecida: ${nome}`);
    }
    return {
      select: (_colunas: string): ConsultaEncadeavel => new ConsultaFalsa(linhas, null, null),
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
    };
  }
}
