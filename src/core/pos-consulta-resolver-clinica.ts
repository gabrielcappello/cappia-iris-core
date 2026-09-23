// Resolve `clinica_id` a partir de provider+instancia_whatsapp -- MESMO
// mecanismo de `buscarClinica` (identificacao.ts), extraido/duplicado aqui
// deliberadamente: aquele arquivo tambem resolve paciente e estado_conversa
// (dominio de agendamento, sem uso nesta frente), e a Edge Function
// iris-nova-pos-consulta (Disparo A) e "um fluxo novo e minimo" por decisao
// do Gabriel (2026-09-16) -- nao deve arrastar dependencias de outro
// dominio so para reusar uma funcao privada de 10 linhas. Mesma disciplina
// de duplicacao deliberada ja aplicada a `diaDaSemanaCivil` no projeto.
//
// docs/03-seguranca.md: "a clinica e derivada da instancia autenticada do
// WhatsApp -- nunca de um identificador enviado pelo proprio paciente/
// usuario". Este modulo E o ponto que faz essa derivacao -- nenhum
// `clinica_id` deve atravessar por fora dele nesta Edge Function.

import { ClinicaNaoEncontradaError, EntradaInvalidaError } from './erros.ts';
import type { ClienteBancoDados } from './tipos.ts';

export interface EntradaResolverClinica {
  provider: string;
  instancia_whatsapp: string;
}

export async function resolverClinicaPorInstancia(
  cliente: ClienteBancoDados,
  entrada: EntradaResolverClinica
): Promise<{ clinica_id: string }> {
  if (!entrada.provider || entrada.provider.trim() === '') {
    throw new EntradaInvalidaError('provider', 'provider e obrigatorio');
  }
  if (!entrada.instancia_whatsapp || entrada.instancia_whatsapp.trim() === '') {
    throw new EntradaInvalidaError('instancia_whatsapp', 'instancia_whatsapp e obrigatorio');
  }

  const { data, error } = await cliente
    .from('clinicas')
    .select('id')
    .eq('provider', entrada.provider)
    .eq('instancia_whatsapp', entrada.instancia_whatsapp)
    .maybeSingle();

  if (error) throw new Error(`falha ao buscar clinica: ${error.message}`);
  const clinica = data as { id: string } | null;
  if (clinica === null) {
    throw new ClinicaNaoEncontradaError(entrada.provider, entrada.instancia_whatsapp);
  }

  return { clinica_id: clinica.id };
}
