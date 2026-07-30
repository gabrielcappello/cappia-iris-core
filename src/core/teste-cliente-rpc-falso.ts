// Dublê de ClienteRpc para testes de unidade — nunca acessa rede ou banco
// real. Cada RPC configurada recebe uma resposta fixa (repetida em toda
// chamada) ou uma sequencia de respostas (uma por chamada, na ordem). Todas
// as chamadas ficam registradas em `chamadas` para permitir asserts sobre
// numero de chamadas e parametros enviados (ex.: provar que nao ha releitura
// nem retry apos autorizacao_invalida/conflito_concorrente).
import type { ClienteRpc } from './mensagens-recebidas-tipos.ts';

export interface ChamadaRpc {
  nome: string;
  parametros: Record<string, unknown>;
}

export type RespostaRpc = { data: unknown; error: { message: string } | null };

export class ClienteRpcFalso implements ClienteRpc {
  readonly chamadas: ChamadaRpc[] = [];
  private readonly respostas: Map<string, RespostaRpc[]>;

  constructor(respostas: Record<string, RespostaRpc | RespostaRpc[]>) {
    this.respostas = new Map(
      Object.entries(respostas).map(([nome, resposta]) => [nome, Array.isArray(resposta) ? [...resposta] : [resposta]])
    );
  }

  async rpc(nome: string, parametros: Record<string, unknown>): Promise<RespostaRpc> {
    // yield explicito, mesmo padrao de ClienteFalso: reproduz I/O assincrono real.
    await Promise.resolve();
    this.chamadas.push({ nome, parametros });

    const fila = this.respostas.get(nome);
    if (!fila || fila.length === 0) {
      throw new Error(`ClienteRpcFalso: nenhuma resposta configurada para '${nome}'`);
    }
    // Resposta unica configurada: repete em toda chamada (caso comum dos
    // testes). Sequencia com mais de um item: consome uma por chamada.
    return fila.length > 1 ? fila.shift()! : fila[0];
  }
}
