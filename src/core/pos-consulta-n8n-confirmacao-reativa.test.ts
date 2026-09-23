// Teste do node de Code REAL do patch n8n reativo (D4/E2,
// reviews/revisao-pos-consulta-conversacional-v1.md, quarta e quinta
// revisoes) -- supabase/functions/iris-nova-mensagem/
// n8n-workflow-reativo-confirmacao-pos-consulta.json.
//
// Este arquivo vive em src/core (nao junto do JSON) DE PROPOSITO: assim
// roda automaticamente com `node --test core/**/*.test.ts`, junto do resto
// da suite, em vez de depender de alguem lembrar de rodar um teste
// separado para um asset n8n.
//
// O teste executa o `jsCode` do node 'Classificar resultado Evolution
// (pos-consulta)' EXTRAIDO DIRETO DO JSON (new Function(...)) -- nunca uma
// copia mantida "em sincronia" a mao. Se alguem editar o node no JSON e
// esquecer de manter a garantia de E2, este teste quebra na hora.
//
// E2 (quinta revisao) -- o bug que este teste prova corrigido: a primeira
// versao do node fazia `...$('Chamar Iris Nova').first().json`
// incondicionalmente. Mas 'Chamar Iris Nova' NUNCA executa nos dois
// fallbacks de audio (fora do limite de 5min/15MB; falha ou texto vazio na
// transcricao) -- nesses casos 'Fallback: pedir reenvio' vai direto pra
// 'Enviar resposta Evolution'. Chamar `.first()` num node nao executado
// lanca excecao no n8n de verdade -- quebraria o envio do fallback inteiro.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAMINHO_WORKFLOW = resolve(
  __dirname,
  '../../supabase/functions/iris-nova-mensagem/n8n-workflow-reativo-confirmacao-pos-consulta.json'
);

const workflow = JSON.parse(readFileSync(CAMINHO_WORKFLOW, 'utf8'));
const node = workflow.nodes.find((n: { id: string }) => n.id === 'code-classificar-pos-consulta-d4');
if (!node) {
  throw new Error('node code-classificar-pos-consulta-d4 nao encontrado no workflow -- id mudou?');
}

/**
 * Simula o acessor `$(...)` do n8n para o UNICO node que este jsCode
 * consulta ('Chamar Iris Nova'). `.first()` lanca exatamente como o n8n
 * real lancaria se chamado sobre um node que nao executou -- e o que prova
 * que o guard `isExecuted` no jsCode real esta de fato sendo respeitado,
 * nao so "por sorte nao crasha no mock".
 */
function executarNode(jsonEvolution: unknown, chamarIrisNovaExecutou: boolean, respostaChamarIrisNova?: unknown) {
  const fakeChamarIrisNova = {
    isExecuted: chamarIrisNovaExecutou,
    first: () => {
      if (!chamarIrisNovaExecutou) {
        throw new Error("Referenced node is not part of the input data (simulado -- 'Chamar Iris Nova' nao executou)");
      }
      return { json: respostaChamarIrisNova };
    },
  };
  const fakeDollar = (nomeNode: string) => {
    if (nomeNode !== 'Chamar Iris Nova') {
      throw new Error(`node inesperado referenciado no jsCode: ${nomeNode}`);
    }
    return fakeChamarIrisNova;
  };
  const executar = new Function('$json', '$', node.parameters.jsCode);
  return executar(jsonEvolution, fakeDollar) as { json: Record<string, unknown> };
}

const RESPOSTA_EVOLUTION_SUCESSO = { success: true, data: { key: { id: 'WA-123' } } };
const RESPOSTA_EVOLUTION_FALHA = { success: false, error: 'timeout' };

test('texto normal (sem jornada de pos-consulta aberta): nunca tenta confirmar', () => {
  const resultado = executarNode(RESPOSTA_EVOLUTION_SUCESSO, true, { resposta: 'Oi! Como posso ajudar?' });
  assert.equal(resultado.json.pos_consulta_confirmacao, undefined);
  assert.equal(resultado.json.envio_confirmado, true);
});

test('texto com jornada de pos-consulta aberta: confirmacao passa adiante quando o envio e aceito', () => {
  const confirmacao = { agendamento_id: 'ag-1', entrega_id: 'en-1', claim_token: 'tok-1' };
  const resultado = executarNode(RESPOSTA_EVOLUTION_SUCESSO, true, { resposta: 'Que bom! Vou te mandar o link.', pos_consulta_confirmacao: confirmacao });
  assert.deepEqual(resultado.json.pos_consulta_confirmacao, confirmacao);
  assert.equal(resultado.json.envio_confirmado, true);
});

test('texto com jornada aberta, mas Evolution rejeitou o envio: confirmacao presente, envio_confirmado false (IF a jusante barra)', () => {
  const confirmacao = { agendamento_id: 'ag-2', entrega_id: 'en-2', claim_token: 'tok-2' };
  const resultado = executarNode(RESPOSTA_EVOLUTION_FALHA, true, { resposta: 'Obrigado pelo retorno!', pos_consulta_confirmacao: confirmacao });
  assert.deepEqual(resultado.json.pos_consulta_confirmacao, confirmacao);
  assert.equal(resultado.json.envio_confirmado, false);
});

test('audio transcrito, sem jornada aberta: mesmo comportamento do texto normal (Chamar Iris Nova executou via "Montar mensagem transcrita")', () => {
  const resultado = executarNode(RESPOSTA_EVOLUTION_SUCESSO, true, { resposta: 'Entendi, obrigado!' });
  assert.equal(resultado.json.pos_consulta_confirmacao, undefined);
  assert.equal(resultado.json.envio_confirmado, true);
});

test('audio transcrito, COM jornada aberta: confirmacao passa adiante normalmente', () => {
  const confirmacao = { agendamento_id: 'ag-3', entrega_id: 'en-3', claim_token: 'tok-3' };
  const resultado = executarNode(RESPOSTA_EVOLUTION_SUCESSO, true, { resposta: 'Perfeito!', pos_consulta_confirmacao: confirmacao });
  assert.deepEqual(resultado.json.pos_consulta_confirmacao, confirmacao);
  assert.equal(resultado.json.envio_confirmado, true);
});

// E2 -- os dois fallbacks de audio: 'Chamar Iris Nova' NUNCA executa.
test('fallback: audio fora do limite (5min/15MB) -- nao lanca excecao, nunca tenta confirmar', () => {
  const resultado = executarNode(RESPOSTA_EVOLUTION_SUCESSO, false);
  assert.equal(resultado.json.pos_consulta_confirmacao, undefined);
  assert.equal(resultado.json.envio_confirmado, true);
});

test('fallback: falha ou texto vazio na transcricao -- nao lanca excecao, nunca tenta confirmar, mesmo se a Evolution tambem falhar', () => {
  const resultado = executarNode(RESPOSTA_EVOLUTION_FALHA, false);
  assert.equal(resultado.json.pos_consulta_confirmacao, undefined);
  assert.equal(resultado.json.envio_confirmado, false);
  assert.equal(resultado.json.motivo_evolution, 'timeout');
});

test('prova direta do bug de E2: chamar .first() sem guard lancaria -- o jsCode real nunca faz essa chamada quando isExecuted=false', () => {
  // Se o jsCode real regredisse pra `...$('Chamar Iris Nova').first().json`
  // incondicional, este teste (que so passa resposta undefined + isExecuted
  // false) teria estourado a excecao simulada em executarNode acima, e TODOS
  // os testes de fallback logo acima teriam falhado -- essa e a garantia.
  assert.doesNotThrow(() => executarNode(RESPOSTA_EVOLUTION_SUCESSO, false));
});
