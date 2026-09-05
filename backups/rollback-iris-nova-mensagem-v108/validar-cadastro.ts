// Validacao deterministica dos quatro campos cadastrais.
//
// Contrato: specs/cadastro-conversacional-v1.md secao 4; regras de formato
// copiadas de specs/novo-agendamento.md secao 23 ("Validacao de formato"),
// sem ampliar nenhuma delas.
//
// "A interpretadora entende o valor. O Core confere e executa." A IA extrai o
// que o paciente escreveu; este modulo decide se aquilo serve. Nao ha parser
// linguistico aqui -- nenhuma funcao abaixo interpreta texto livre, todas
// recebem um valor que a IA ja isolou e apenas o normalizam e conferem.
//
// FUNCOES PURAS: nao leem relogio (a data de referencia e sempre injetada),
// nao acessam banco, nao lancam. Valor invalido devolve `undefined` -- e o
// chamador simplesmente nao o aplica, entao o campo continua faltante e pode
// ser pedido de novo. Nao existe estado persistido de "invalido"
// (spec secao 4).

import type { CampoCadastralInterpretacao } from './interpretacao-tipos.ts';

/**
 * Ao menos duas letras; nunca so numeros ou simbolos. Espacos normalizados.
 *
 * SOBRENOME NAO E EXIGIDO (decisao do Gabriel, 2026-08-10): muita gente se
 * apresenta so pelo primeiro nome, e recusar isso criaria um obstaculo que a
 * regra canonica nunca pediu.
 */
export function normalizarNome(valor: string): string | undefined {
  const limpo = valor.trim().replace(/\s+/g, ' ');
  if (limpo === '') return undefined;
  // "ao menos duas letras" -- conta letras de fato, incluindo acentuadas.
  // Digitos e simbolos nao contam, entao "123" e "!!!" caem aqui.
  const letras = limpo.match(/\p{L}/gu);
  if (letras === null || letras.length < 2) return undefined;
  return limpo;
}

/**
 * Remove pontuacao, exige 11 digitos, valida os dois digitos verificadores e
 * rejeita sequencias do mesmo digito. Devolve SEMPRE o valor normalizado
 * (somente digitos) -- e ele que e persistido, nunca o texto cru.
 */
export function normalizarCpf(valor: string): string | undefined {
  const digitos = valor.replace(/\D/g, '');
  if (digitos.length !== 11) return undefined;

  // `00000000000`, `11111111111`, ... sao aritmeticamente validos pelos
  // digitos verificadores, entao precisam de recusa explicita.
  if (/^(\d)\1{10}$/.test(digitos)) return undefined;

  if (calcularDigitoVerificador(digitos, 9) !== Number(digitos[9])) return undefined;
  if (calcularDigitoVerificador(digitos, 10) !== Number(digitos[10])) return undefined;

  return digitos;
}

/**
 * Digito verificador de CPF: soma ponderada dos `quantidade` primeiros
 * digitos, com pesos decrescentes a partir de `quantidade + 1`.
 */
function calcularDigitoVerificador(digitos: string, quantidade: number): number {
  let soma = 0;
  for (let i = 0; i < quantidade; i++) {
    soma += Number(digitos[i]) * (quantidade + 1 - i);
  }
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
}

const DATA_ISO_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `YYYY-MM-DD`, data real de calendario e nao futura.
 *
 * A conversao do que o paciente escreveu ("10/05/1985", "10 de maio de 1985")
 * para ISO e feita pela INTERPRETADORA, nao aqui -- e isso que evita um parser
 * de data no Core (spec secao 3).
 *
 * `dataReferencia` (YYYY-MM-DD) vem do `instante_atual` ja injetado no
 * orquestrador: este modulo nunca chama Date.now(), mesmo principio de
 * resolverTemporal e resolverDisponibilidade. Ausente, a checagem de futuro e
 * PULADA -- as demais continuam valendo.
 */
export function normalizarDataNascimento(valor: string, dataReferencia?: string): string | undefined {
  const limpo = valor.trim();
  const partes = DATA_ISO_REGEX.exec(limpo);
  if (partes === null) return undefined;

  const ano = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);

  // Data REAL: 2025-02-30 casa com o regex mas nao existe. Reconstruir em UTC
  // e comparar os tres componentes rejeita overflow silencioso do Date.
  const reconstruida = new Date(Date.UTC(ano, mes - 1, dia));
  if (
    reconstruida.getUTCFullYear() !== ano ||
    reconstruida.getUTCMonth() !== mes - 1 ||
    reconstruida.getUTCDate() !== dia
  ) {
    return undefined;
  }

  // Comparacao lexicografica de ISO equivale a comparacao cronologica --
  // nenhum fuso, nenhuma aritmetica de data.
  if (typeof dataReferencia === 'string' && DATA_ISO_REGEX.test(dataReferencia) && limpo > dataReferencia) {
    return undefined;
  }

  return limpo;
}

/**
 * Somente as seis checagens estruturais de specs/novo-agendamento.md secao 23.
 * NUNCA verifica se o endereco existe de fato.
 */
export function normalizarEmail(valor: string): string | undefined {
  const limpo = valor.trim();
  if (limpo === '') return undefined;
  if (/\s/.test(limpo)) return undefined;

  const partes = limpo.split('@');
  if (partes.length !== 2) return undefined;

  const [local, dominio] = partes;
  if (local === '' || dominio === '') return undefined;

  const rotulos = dominio.split('.');
  if (rotulos.length < 2) return undefined;
  if (rotulos.some((rotulo) => rotulo === '')) return undefined;

  return limpo;
}

/**
 * Ponto unico de entrada, por campo. Devolve o valor NORMALIZADO quando
 * valido, `undefined` quando nao -- nunca lanca.
 *
 * `switch` exaustivo sobre o vocabulario fechado: um campo cadastral novo
 * deixa de compilar aqui em vez de passar sem validacao.
 */
export function normalizarCampoCadastral(
  campo: CampoCadastralInterpretacao,
  valor: string,
  dataReferencia?: string
): string | undefined {
  switch (campo) {
    case 'nome':
      return normalizarNome(valor);
    case 'cpf':
      return normalizarCpf(valor);
    case 'data_nascimento':
      return normalizarDataNascimento(valor, dataReferencia);
    case 'email':
      return normalizarEmail(valor);
  }
}
