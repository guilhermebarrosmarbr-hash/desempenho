import { SituacaoDas, LinhaApuracao } from '../types.js';

/**
 * Normaliza o texto de situação retornado pelo portal PGMEI.
 *
 * Conforme o manual do PGMEI e regras de negócio:
 * - "Liquidado": pagamento integral do valor apurado.
 * - "Devedor": período vencido sem pagamento integral.
 * - "A Vencer": período ainda não vencido.
 * - "Dívida Ativa": situação que exige análise.
 * - "Não Optante": condição distinta de inadimplência.
 * - "Apurado = Sim" NÃO comprova pagamento.
 */
export function normalizarSituacao(texto: string): SituacaoDas {
  if (!texto) return 'Indeterminada';
  const limpo = texto.trim();

  if (/liquidado/i.test(limpo)) return 'Liquidado';
  if (/devedor/i.test(limpo)) return 'Devedor';
  if (/a vencer/i.test(limpo)) return 'A Vencer';
  if (/d[ií]vida\s+ativa/i.test(limpo)) return 'Dívida Ativa';
  if (/n[aã]o\s+optante/i.test(limpo)) return 'Não Optante';

  return 'Outro';
}

/**
 * Gera um resumo interpretado do ano consultado baseado nas linhas apuradas.
 *
 * Atenção: Conforme o manual do PGMEI, a coluna "Situação" pode estar ausente em anos anteriores.
 * Não podemos prometer regularidade fiscal completa, apenas sintetizar os períodos analisados.
 */
export function interpretarResumoDas(linhas: LinhaApuracao[], ano: number): string {
  if (!linhas || linhas.length === 0) {
    return `Nenhum período de apuração encontrado para o ano ${ano}.`;
  }

  const temColunaSituacao = linhas.some(l => l.situacao !== 'Indeterminada');

  if (!temColunaSituacao) {
    return `Coluna 'Situação' não disponibilizada pelo portal para o ano ${ano}. Consulte o print para conferência das competências.`;
  }

  const devedores = linhas.filter(l => l.situacao === 'Devedor');
  const dividaAtiva = linhas.filter(l => l.situacao === 'Dívida Ativa');
  const liquidados = linhas.filter(l => l.situacao === 'Liquidado');
  const aVencer = linhas.filter(l => l.situacao === 'A Vencer');
  const naoOptante = linhas.filter(l => l.situacao === 'Não Optante');

  const partes: string[] = [];

  if (devedores.length > 0) {
    partes.push(`⚠️ ${devedores.length} período(s) DEVEDOR(ES) em aberto (${devedores.map(d => d.periodo).join(', ')}).`);
  }

  if (dividaAtiva.length > 0) {
    partes.push(`🚨 ${dividaAtiva.length} período(s) em DÍVIDA ATIVA.`);
  }

  if (naoOptante.length > 0) {
    partes.push(`ℹ️ ${naoOptante.length} período(s) como NÃO OPTANTE.`);
  }

  if (devedores.length === 0 && dividaAtiva.length === 0) {
    if (liquidados.length > 0 || aVencer.length > 0) {
      partes.push(`✅ Sem períodos vencidos em aberto no ano ${ano} (${liquidados.length} liquidado(s), ${aVencer.length} a vencer).`);
    } else {
      partes.push(`Sem débitos pendentes identificados para ${ano}.`);
    }
  }

  return partes.join(' ');
}
