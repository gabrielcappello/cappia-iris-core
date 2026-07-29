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
