// Formato brasileiro canonico aprovado em 20260729_iris_nova_identificacao_v1_correcao.sql:
// prefixo 55 + 10 ou 11 digitos nacionais (12 ou 13 digitos no total), somente digitos.
const TELEFONE_BR_REGEX = /^55[0-9]{10,11}$/;

export function telefoneNormalizadoValido(telefone: string): boolean {
  return typeof telefone === 'string' && TELEFONE_BR_REGEX.test(telefone);
}
