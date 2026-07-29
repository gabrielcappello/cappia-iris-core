// Erros controlados do modulo de identificacao. Nunca incluir telefone ou
// outro dado pessoal na mensagem (docs/03-seguranca.md: dados pessoais
// mascarados em qualquer saida/log).

export class EntradaInvalidaError extends Error {
  campo: string;

  constructor(campo: string, message: string) {
    super(message);
    this.name = 'EntradaInvalidaError';
    this.campo = campo;
  }
}

export class ClinicaNaoEncontradaError extends Error {
  provider: string;
  instanciaWhatsapp: string;

  constructor(provider: string, instanciaWhatsapp: string) {
    super('clinica nao encontrada para o provider e instancia informados');
    this.name = 'ClinicaNaoEncontradaError';
    this.provider = provider;
    this.instanciaWhatsapp = instanciaWhatsapp;
  }
}

export class ConversaNaoEncontradaError extends Error {
  constructor() {
    super('estado_conversa nao encontrado para conversa_id + clinica_id + telefone_normalizado informados');
    this.name = 'ConversaNaoEncontradaError';
  }
}

export class ConflitoConcorrenteError extends Error {
  tentativas: number;

  constructor(tentativas: number) {
    super(`nao foi possivel aplicar as alteracoes apos ${tentativas} tentativas por conflito de concorrencia`);
    this.name = 'ConflitoConcorrenteError';
    this.tentativas = tentativas;
  }
}

// Erro controlado para saida de interpretacao (IA) invalida. `codigo` e
// `caminho` sao construidos SOMENTE a partir de nomes de campo/indices
// fixos, nunca de valores — nunca incluir mensagem do paciente, CPF, nome,
// e-mail, nascimento, conteudo bruto do modelo ou valores acumulados.
export class InterpretacaoInvalidaError extends Error {
  codigo: string;
  caminho: string;

  constructor(codigo: string, caminho: string) {
    super(`interpretacao invalida: ${codigo} em ${caminho}`);
    this.name = 'InterpretacaoInvalidaError';
    this.codigo = codigo;
    this.caminho = caminho;
  }
}
