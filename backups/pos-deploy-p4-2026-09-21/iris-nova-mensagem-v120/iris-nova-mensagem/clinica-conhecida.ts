// Os dados da PROPRIA CLINICA, como fato autorizado para a redatora.
//
// ── POR QUE ESTE ARQUIVO EXISTE (2026-08-17) ────────────────────────────
// A Iris nao sabia para quem trabalhava. Num teste real:
//
//   Paciente: "qual e a clinica? fica onde"
//   Iris:     "Somos a recepcao virtual da clinica odontologica."
//
// Nao era evasiva nem falha do modelo: a Edge Function so lia
// `fuso_horario`, `dentistas` e `automatizacoes` da tabela `clinicas` --
// nome, endereco e telefone NUNCA saiam do banco. O campo `nomeClinica`
// existia em tres camadas do contrato e era repassado adiante, mas ninguem
// jamais o preenchia: caminho morto do mesmo tipo que `historico_recente`
// em 2026-08-08.
//
// Como a instrucao da redatora diz que "ausencia de fato nao e fato", ela
// acertou ao nao inventar. O defeito era a falta do dado.
//
// ── MULTICLINICA ────────────────────────────────────────────────────────
// Tudo aqui sai da LINHA da clinica do turno. Nenhum valor e embutido no
// codigo, nenhuma clinica e tratada como caso especial: uma clinica criada
// amanha funciona sem configuracao nenhuma. O painel e a fonte da verdade
// -- este modulo so le o que a clinica preencheu la.
//
// Campo vazio simplesmente NAO VIRA FATO (`ausente, nunca vazio`, a mesma
// disciplina do resto do Core): a redatora nunca recebe `endereco: ""` e
// portanto nunca anuncia um endereco em branco.

/** Dados da clinica que a redatora pode usar ao falar com o paciente. */
export interface ClinicaConhecida {
  nome?: string;
  /** Endereco ja montado para leitura humana (rua, sala, bairro, cidade/UF). */
  endereco?: string;
  /** Ponto de referencia informado pela clinica ("em frente ao banco X"). */
  referencia?: string;
  /** Link do mapa -- e o que a Iris manda quando o paciente nao sabe chegar. */
  maps_link?: string;
  telefone?: string;
  email?: string;
  /** Horario de atendimento em texto ("Seg a sex, 07:00 as 19:00"). */
  horario_funcionamento?: string;
}

/** A linha de `clinicas`, como chega do banco. Campos ausentes/nulos sao normais. */
export interface LinhaClinica {
  nome?: unknown;
  endereco?: unknown;
  bairro?: unknown;
  cidade?: unknown;
  estado?: unknown;
  cep?: unknown;
  sala?: unknown;
  referencia?: unknown;
  maps_link?: unknown;
  telefone?: unknown;
  email_clinica?: unknown;
  horario_funcionamento?: unknown;
}

/** Texto util e aparado, ou `undefined`. Nunca devolve string vazia. */
function texto(valor: unknown): string | undefined {
  if (typeof valor !== 'string') return undefined;
  const limpo = valor.trim();
  return limpo === '' ? undefined : limpo;
}

/**
 * Monta o endereco em UMA linha legivel, na ordem que um humano diria.
 *
 * Cada parte so entra se estiver preenchida -- uma clinica que so informou a
 * rua recebe "Rua X", nunca "Rua X, , , /". O CEP fica de fora de proposito:
 * nao ajuda o paciente a chegar, e o link do mapa ja resolve a navegacao.
 */
function montarEndereco(linha: LinhaClinica): string | undefined {
  const rua = texto(linha.endereco);
  if (rua === undefined) return undefined;

  const sala = texto(linha.sala);
  const bairro = texto(linha.bairro);
  const cidade = texto(linha.cidade);
  const estado = texto(linha.estado);

  const partes = [rua];
  if (sala !== undefined) partes.push(`sala ${sala}`);
  if (bairro !== undefined) partes.push(bairro);
  if (cidade !== undefined) partes.push(estado !== undefined ? `${cidade} - ${estado}` : cidade);
  else if (estado !== undefined) partes.push(estado);

  return partes.join(', ');
}

interface FaixaHorario {
  inicio?: unknown;
  fim?: unknown;
  ativo?: unknown;
}

/** "07:00 as 19:00" quando as duas pontas existem; senao `undefined`. */
function faixa(valor: unknown): string | undefined {
  if (valor === null || typeof valor !== 'object') return undefined;
  const f = valor as FaixaHorario;
  const inicio = texto(f.inicio);
  const fim = texto(f.fim);
  if (inicio === undefined || fim === undefined) return undefined;
  return `${inicio} as ${fim}`;
}

/**
 * Descreve o horario de funcionamento em texto corrido.
 *
 * A estrutura no banco e `{seg_sex, sabado, domingo, almoco}`, onde sabado e
 * domingo tem `ativo`. Um dia com `ativo: false` NAO e mencionado -- dizer
 * "sabado fechado" seria correto, mas a redatora ja sabe nao oferecer o que
 * nao existe, e o texto fica mais curto e natural sem isso.
 *
 * O horario de ALMOCO fica de fora: quem manda na disponibilidade real e a
 * agenda do dentista (o Core ja calcula os horarios livres). Anunciar almoco
 * aqui abriria espaco para a Iris contradizer os horarios que ela mesma
 * oferece.
 */
function montarHorarioFuncionamento(valor: unknown): string | undefined {
  if (valor === null || typeof valor !== 'object') return undefined;
  const h = valor as Record<string, unknown>;

  const partes: string[] = [];

  const semana = faixa(h.seg_sex);
  if (semana !== undefined) partes.push(`Segunda a sexta, ${semana}`);

  for (const [chave, rotulo] of [['sabado', 'Sabado'], ['domingo', 'Domingo']] as const) {
    const dia = h[chave];
    if (dia === null || typeof dia !== 'object') continue;
    if ((dia as FaixaHorario).ativo !== true) continue;
    const intervalo = faixa(dia);
    if (intervalo !== undefined) partes.push(`${rotulo}, ${intervalo}`);
  }

  return partes.length > 0 ? partes.join('; ') : undefined;
}

/**
 * Deriva os dados da clinica a partir da linha do banco.
 *
 * Devolve `undefined` quando NADA util foi preenchido -- assim o chamador
 * nunca anexa um fato vazio, e a Iris de uma clinica sem cadastro se comporta
 * exatamente como antes desta mudanca.
 */
export function derivarClinicaConhecida(linha: LinhaClinica | null | undefined): ClinicaConhecida | undefined {
  if (linha === null || linha === undefined) return undefined;

  const dados: ClinicaConhecida = {};

  const nome = texto(linha.nome);
  if (nome !== undefined) dados.nome = nome;

  const endereco = montarEndereco(linha);
  if (endereco !== undefined) dados.endereco = endereco;

  const referencia = texto(linha.referencia);
  if (referencia !== undefined) dados.referencia = referencia;

  const maps = texto(linha.maps_link);
  if (maps !== undefined) dados.maps_link = maps;

  const telefone = texto(linha.telefone);
  if (telefone !== undefined) dados.telefone = telefone;

  const email = texto(linha.email_clinica);
  if (email !== undefined) dados.email = email;

  const horario = montarHorarioFuncionamento(linha.horario_funcionamento);
  if (horario !== undefined) dados.horario_funcionamento = horario;

  return Object.keys(dados).length > 0 ? dados : undefined;
}
