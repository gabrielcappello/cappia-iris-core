// GUARDA: escolher um profissional NAO identifica o paciente.
//
// ── O DEFEITO REAL QUE ORIGINOU ESTE ARQUIVO (2026-08-16) ───────────────
// Conversa real, WhatsApp: o paciente escreveu "pode ser o dr. pablo
// arruda". A interpretadora devolveu, no MESMO turno, o dentista escolhido
// E `nome = "Arruda"` -- o sobrenome do PROFISSIONAL persistido como nome do
// PACIENTE. A ficha foi criada com `nome: "Arruda"`.
//
// A guarda que existia (`guarda-contexto-unificado.ts`) ja cobria isso, mas
// so rodava dentro do SHADOW (`sombra-contexto-unificado.ts`), que apenas
// mede e loga. A rota que de fato atende o paciente nunca a consultava.
// Este modulo leva a mesma regra para a rota real.
//
// ── DETECCAO ESTRUTURAL, NUNCA TEXTUAL ─────────────────────────────────
// O gatilho e a CO-OCORRENCIA de dois campos no mesmo turno: uma escolha de
// profissional e um `nome`. Esta funcao nunca compara `"Arruda"` com
// `"Dr. Pablo Arruda"`.
//
// Comparar exigiria normalizar titulo, primeiro nome e acento -- match de
// palavra, proibido por `docs/00-principios.md`, removido deliberadamente
// deste projeto em 2026-08-09 (`specs/dentista-semantico-v1.md`), e fragil:
// um apelido faria o match falhar e a contaminacao passar em silencio.
//
// ── DESCARTAR, NAO PERGUNTAR (diferenca em relacao a guarda do shadow) ──
// A guarda do shadow BLOQUEIA o turno e devolve uma pergunta
// (`confirmacao_nome`) para o paciente esclarecer. Aqui o nome e apenas
// DESCARTADO, e o fluxo segue.
//
// Motivo: perguntar exige um desfecho conversacional proprio, que a rota
// atual nao tem -- o Core teria de interromper o fluxo e a redatora precisaria
// saber redigir essa pergunta. Descartar e a correcao MINIMA que impede o
// dado errado de entrar na ficha.
//
// CUSTO ACEITO E DECLARADO: se o paciente disser, no mesmo turno, "quero com
// o Dr. Pablo, e meu nome e Gabriel", o nome legitimo tambem e descartado --
// a Iris volta a pedir o nome no passo de cadastro, que ja existe. Um turno
// a mais e melhor que uma ficha com o nome errado, e o cadastro nunca fica
// incompleto em silencio: `calcularCadastroFaltante` continua exigindo o
// campo.
//
// NAO ha refinamento (por exemplo, aceitar o nome quando vier CPF junto):
// seria regra inventada antes da evidencia.

import type { AlteracoesDados } from './tipos.ts';

/**
 * Remove `nome` quando o mesmo turno IDENTIFICA um profissional real.
 *
 * `dentistasCandidatos`, conforme `specs/dentista-semantico-v1.md`:
 *   - `null` -- o paciente nao mencionou profissional nenhum;
 *   - `[]`   -- mencionou alguem que NAO EXISTE na clinica;
 *   - `[id]` ou varios -- identificou profissional(is) real(is).
 *
 * A guarda dispara SO no terceiro caso.
 *
 * ── POR QUE `[]` NAO DISPARA (defeito medido em 2026-08-16) ────────────
 * A primeira versao desta funcao tratava qualquer lista, inclusive vazia,
 * como "houve mencao a profissional". Isso apagou um nome legitimo numa
 * conversa real: o paciente escreveu "gabriel cappello cpf ... data ...", a
 * IA devolveu `dentistas_candidatos: []` -- porque "Cappello" e um sobrenome
 * e ela procurou um profissional com esse nome, sem encontrar -- e o nome do
 * PACIENTE foi descartado. Ele teve de repetir os dados, e a Iris pediu de
 * novo sem explicar.
 *
 * O erro de raciocinio: `[]` significa exatamente que NENHUM profissional foi
 * identificado. Nao existe profissional escolhido cujo nome possa ter
 * contaminado o campo -- e o gatilho da contaminacao e justamente a
 * coexistencia de uma escolha REAL com um nome.
 *
 * Como sobrenome de paciente e comum, `[]` acontece com frequencia: nao era
 * caso raro, era o caso normal.
 *
 * Funcao pura. Nao le banco, nao chama IA, nao compara texto.
 */
export function descartarNomeDeEscolhaDeDentista(
  alteracoes: AlteracoesDados,
  dentistasCandidatos: readonly string[] | null
): { alteracoes: AlteracoesDados; descartou: boolean } {
  const identificouProfissional = dentistasCandidatos !== null && dentistasCandidatos.length > 0;
  const trouxeNome = alteracoes.nome !== undefined;

  if (!identificouProfissional || !trouxeNome) {
    return { alteracoes, descartou: false };
  }

  const { nome: _descartado, ...resto } = alteracoes;
  return { alteracoes: resto, descartou: true };
}
