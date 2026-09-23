import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  CABECALHO_SEGREDO_INTERNO_POS_CONSULTA,
  VARIAVEL_SEGREDO_INTERNO_POS_CONSULTA,
} from './pos-consulta-autenticacao-interna.ts';

// Revisao final do Codex, bloqueador 3: TODA chamada do n8n a
// iris-nova-pos-consulta leva a autenticacao interna dedicada (alem da
// publishable key). Os tres artefatos n8n versionados sao verificados aqui.

interface NodeN8n {
  name: string;
  type: string;
  notes?: string;
  parameters: Record<string, unknown> & {
    url?: string;
    genericAuthType?: string;
    authentication?: string;
    headerParameters?: { parameters?: { name: string; value: string }[] };
    content?: string;
  };
  credentials?: Record<string, { id: string; name: string }>;
}

const CREDENCIAL_INTERNA = 'Iris Nova Pos-Consulta (chamada interna)';
const ARQUIVOS = [
  { arquivo: 'iris-nova-pos-consulta/n8n-workflow-pos-consulta-iniciar.json', chamadas: 2, rotulo: 'Disparo A (iniciar + confirmar)' },
  { arquivo: 'iris-nova-mensagem/n8n-patch-3-nodes-para-colar-no-editor.json', chamadas: 1, rotulo: 'patch de 3 nodes do Iris Oficial (confirmar)' },
  { arquivo: 'iris-nova-mensagem/n8n-workflow-reativo-confirmacao-pos-consulta.json', chamadas: 1, rotulo: 'workflow reativo completo (confirmar)' },
] as const;

function carregar(arquivo: string): { bruto: string; nodes: NodeN8n[] } {
  const bruto = readFileSync(new URL(`../../supabase/functions/${arquivo}`, import.meta.url), 'utf8');
  const json = JSON.parse(bruto) as { nodes: NodeN8n[] };
  return { bruto, nodes: json.nodes };
}

const chamadasPosConsulta = (nodes: NodeN8n[]) =>
  nodes.filter((n) => /httpRequest/.test(n.type) && String(n.parameters.url ?? '').includes('/functions/v1/iris-nova-pos-consulta'));

for (const { arquivo, chamadas, rotulo } of ARQUIVOS) {
  test(`${rotulo}: ${chamadas} chamada(s) a iris-nova-pos-consulta, todas com a credencial Custom Auth interna`, () => {
    const { nodes } = carregar(arquivo);
    const nodesChamada = chamadasPosConsulta(nodes);
    assert.equal(nodesChamada.length, chamadas);
    for (const node of nodesChamada) {
      assert.equal(node.parameters.authentication, 'genericCredentialType', node.name);
      assert.equal(node.parameters.genericAuthType, 'httpCustomAuth', node.name);
      assert.equal(node.credentials?.httpCustomAuth?.name, CREDENCIAL_INTERNA, node.name);
      // Nunca a credencial antiga (so a publishable key): ela nao autoriza mais sozinha.
      assert.equal(node.credentials?.httpHeaderAuth, undefined, `${node.name}: nao deve mais usar so o Header Auth da publishable key`);
    }
  });

  test(`${rotulo}: nenhum segredo ou chave literal nos nodes que chamam a funcao`, () => {
    const { nodes } = carregar(arquivo);
    for (const node of chamadasPosConsulta(nodes)) {
      const serializado = JSON.stringify(node);
      assert.doesNotMatch(serializado, /sbp_[A-Za-z0-9]{10,}/, `${node.name}: token sbp_`);
      assert.doesNotMatch(serializado, /sb_(secret|publishable)_[A-Za-z0-9_-]{10,}/, `${node.name}: chave sb_*`);
      assert.doesNotMatch(serializado, /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/, `${node.name}: JWT literal`);
      // O cabecalho do segredo nunca aparece como parametro com valor no JSON:
      // ele vive so DENTRO da credencial.
      const cabecalhos = node.parameters.headerParameters?.parameters ?? [];
      assert.ok(
        !cabecalhos.some((h) => h.name.toLowerCase() === CABECALHO_SEGREDO_INTERNO_POS_CONSULTA),
        `${node.name}: o segredo interno nao pode ser um parametro literal do node`
      );
      assert.ok(!cabecalhos.some((h) => h.name.toLowerCase() === 'authorization'), `${node.name}: Authorization vive na credencial, nao no node`);
    }
  });

  test(`${rotulo}: cada node documenta que a publishable key sozinha nao autoriza`, () => {
    const { nodes } = carregar(arquivo);
    for (const node of chamadasPosConsulta(nodes)) {
      assert.match(node.notes ?? '', new RegExp(CABECALHO_SEGREDO_INTERNO_POS_CONSULTA), node.name);
      assert.match(node.notes ?? '', /publishable key sozinha NAO autoriza/i, node.name);
    }
  });
}

test('a nota de setup do Disparo A descreve a credencial Custom Auth, o secret da funcao e a ordem segura de publicacao', () => {
  const { nodes } = carregar('iris-nova-pos-consulta/n8n-workflow-pos-consulta-iniciar.json');
  const setup = nodes.find((n) => /Setup necessario/.test(String(n.parameters.content ?? '')));
  assert.ok(setup, 'nota de setup existe');
  const texto = String(setup.parameters.content);
  assert.ok(texto.includes(CREDENCIAL_INTERNA));
  assert.ok(texto.includes('Custom Auth'));
  assert.ok(texto.includes(CABECALHO_SEGREDO_INTERNO_POS_CONSULTA));
  assert.ok(texto.includes(VARIAVEL_SEGREDO_INTERNO_POS_CONSULTA));
  assert.match(texto, /Ordem segura de publicacao/);
  assert.match(texto, /Sem os 7 itens acima/);
});

test('o JSON do Disparo A nunca declara active:true (a ativacao recorrente segue bloqueada)', () => {
  const bruto = JSON.parse(readFileSync(new URL('../../supabase/functions/iris-nova-pos-consulta/n8n-workflow-pos-consulta-iniciar.json', import.meta.url), 'utf8')) as {
    active?: boolean;
  };
  assert.notEqual(bruto.active, true);
});
