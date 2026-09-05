// Visao efetiva do cadastro: o que a clinica sabe sobre este paciente AGORA,
// combinando a ficha ja persistida com o que ele disse nesta conversa.
//
// Contrato fechado pelo Gabriel em 2026-08-09 (subetapa "integracao do Core
// com paciente"):
//
//   - `pacientes` e a fonte oficial do cadastro PERSISTIDO;
//   - `estado_conversa.dados` e o que foi informado/corrigido NESTA conversa;
//   - o que veio da conversa PREVALECE sobre a ficha enquanto o turno corre;
//   - o cadastro oficial NUNCA e copiado para `estado_conversa.dados`;
//   - nenhuma segunda fonte persistida, nenhuma escrita.
//
// POR QUE UMA VISAO EM MEMORIA, E NAO UMA SEMEADURA DO SNAPSHOT: `informar`
// sobre um campo que JA existe em `dados` e descartado em silencio por
// `calcularNovosDados` (aplicar-dados.ts, ramo `camposPreservados`). Se a
// ficha oficial fosse escrita dentro de `dados`, a primeira correcao
// explicita do paciente que a IA classificasse como `informar` seria engolida
// -- o dado antigo venceria calado a pessoa. Este projeto ja foi mordido por
// esse mesmo mecanismo (foi o que obrigou o Core a decidir
// `informar`/`corrigir` deterministicamente em `aplicarAceitacaoDeOferta`).
// Compondo em memoria, a precedencia fica explicita e nada e descartado.
//
// PII: esta funcao produz VALORES cadastrais e por isso e uso exclusivo do
// servidor. Ela alimenta somente `derivarCamposCadastraisPreenchidos`, que
// extrai PRESENCA e descarta os valores. Nenhum valor daqui atravessa a
// fronteira do modelo (specs/interpretacao-ia.md, "Entrada e PII").

import { CAMPOS_CADASTRAIS_INTERPRETACAO } from './interpretacao-tipos.ts';
import type { CampoCadastralInterpretacao } from './interpretacao-tipos.ts';
import type { CadastroPaciente } from './tipos.ts';

/**
 * Compoe a visao efetiva. Puro: nao le banco, nao escreve, nao muta as
 * entradas.
 *
 * Campo so conta como presente quando tem conteudo real -- `undefined`,
 * string vazia e string so de espacos sao tratados como ausentes nos DOIS
 * lados. Sem isso, um campo apagado da conversa (que preAplicar pode deixar
 * como string vazia) "venceria" a ficha oficial com nada dentro.
 */
export function comporVisaoEfetivaCadastro(
  cadastroOficial: CadastroPaciente | undefined,
  dadosConversa: Partial<Record<string, string>> | undefined
): CadastroPaciente {
  const efetiva: CadastroPaciente = {};

  for (const campo of CAMPOS_CADASTRAIS_INTERPRETACAO) {
    // Ordem de precedencia: a conversa primeiro, a ficha como retaguarda.
    const daConversa = normalizar(dadosConversa?.[campo]);
    if (daConversa !== undefined) {
      efetiva[campo] = daConversa;
      continue;
    }
    const daFicha = normalizar(cadastroOficial?.[campo]);
    if (daFicha !== undefined) efetiva[campo] = daFicha;
  }

  return efetiva;
}

function normalizar(valor: string | undefined): string | undefined {
  if (typeof valor !== 'string') return undefined;
  const limpo = valor.trim();
  return limpo === '' ? undefined : limpo;
}

/**
 * Campos cadastrais OBRIGATORIOS que ainda faltam, na ordem canonica
 * (specs/cadastro-conversacional-v1.md secao 2).
 *
 * Brasil V1: `nome`, `cpf` e `data_nascimento` sao sempre obrigatorios;
 * `email` so quando a clinica exige (`clinicas.automatizacoes.solicitar_email`).
 *
 * Opera sobre a VISAO EFETIVA, entao campo ja conhecido nunca e pedido de
 * novo -- venha ele da ficha persistida ou desta conversa. Os tres cenarios
 * saem daqui como consequencia, sem regra propria:
 *
 * - paciente existente completo -> `[]` -> o cadastro nao interrompe o
 *   agendamento;
 * - paciente existente incompleto -> so o que falta;
 * - paciente novo -> so o que falta.
 *
 * "Faltante" significa AUSENTE, e so isso. Valor invalido nunca chega a
 * `dados` (validar-cadastro.ts), entao nao existe um terceiro estado
 * "preenchido porem invalido" para tratar aqui.
 */
export function calcularCadastroFaltante(
  visaoEfetiva: CadastroPaciente,
  exigirEmail: boolean
): CampoCadastralInterpretacao[] {
  const obrigatorios: CampoCadastralInterpretacao[] = exigirEmail
    ? ['nome', 'cpf', 'data_nascimento', 'email']
    : ['nome', 'cpf', 'data_nascimento'];

  return obrigatorios.filter((campo) => normalizar(visaoEfetiva[campo]) === undefined);
}
