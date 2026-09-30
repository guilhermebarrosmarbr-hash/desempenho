/**
 * Módulo de Cálculos e Formatação Financeira e Operacional
 * Princípios de Clean Code: funções puras, responsabilidade única, sem efeitos colaterais.
 */

export const Formatter = {
  /**
   * Formata número em moeda Real Brasileiro (R$ 1.234,56 ou R$ - se zero quando indicado)
   * @param {number} value 
   * @param {boolean} showDashForZero 
   * @returns {string}
   */
  currency(value, showDashForZero = false) {
    if (showDashForZero && (!value || Math.abs(value) < 0.001)) {
      return 'R$ -';
    }
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value || 0);
  },

  /**
   * Formata percentual (ex: 52%)
   * @param {number} value - valor entre 0 e 1, ou 0 e 100
   * @param {boolean} isDecimal - se true, espera 0 a 1; se false, espera 0 a 100
   * @returns {string}
   */
  percentage(value, isDecimal = true) {
    if (value === null || value === undefined || isNaN(value)) return '0%';
    const pct = isDecimal ? Math.round(value * 100) : Math.round(value);
    return `${pct}%`;
  },

  /**
   * Formata números inteiros com separador de milhar
   * @param {number} value 
   * @returns {string}
   */
  integer(value) {
    return new Intl.NumberFormat('pt-BR').format(Math.round(value || 0));
  }
};

export class MeasurementCalculator {
  /**
   * Calcula a performance operacional (0 a 1)
   * Regra: Se prevista for 0 e realizada for 0, considera 100% de conformidade (1.0).
   * Se prevista for 0 e realizada > 0, considera 100% (1.0).
   * @param {number} prevista 
   * @param {number} realizada 
   * @returns {number} performance entre 0 e 1
   */
  static computePerformance(prevista, realizada) {
    const prev = Number(prevista) || 0;
    const real = Number(realizada) || 0;

    if (prev <= 0) {
      return real >= 0 ? 1.0 : 0.0;
    }
    return Math.min(1.0, Math.max(0.0, real / prev));
  }

  /**
   * Realiza todos os cálculos consolidados da medição com base nos parâmetros
   * @param {Object} params 
   * @returns {Object} Dados computados para os gráficos e tabela
   */
  static calculate(params) {
    const {
      contractValue = 6000.0,
      pmocMensal = { prevista: 402, realizada: 211, peso: 0.05 },
      pmocSemestral = { prevista: 80, realizada: 0, peso: 0.40 },
      corretiva = { prevista: 0, realizada: 0, peso: 0.40 },
      epi = { prevista: 22, realizada: 9, peso: 0.10 },
      instDesins = { performance: 1.0, peso: 0.05 },
      excedente = { quantidade: 0, tarifa: 10.75, unitario: 3.50 },
      incentivoVeicular = { metaPerformance: 0.59, baseValue: 1000.0, reconhecido: 0 }
    } = params;

    // 1. Performance de cada indicador
    const perfMensal = this.computePerformance(pmocMensal.prevista, pmocMensal.realizada);
    const perfSemestral = this.computePerformance(pmocSemestral.prevista, pmocSemestral.realizada);
    const perfCorretiva = this.computePerformance(corretiva.prevista, corretiva.realizada);
    const perfEPI = this.computePerformance(epi.prevista, epi.realizada);
    const perfInstDesins = Number(instDesins.performance) || 1.0;

    // 2. Valores Base contratuais
    const baseMensal = contractValue * pmocMensal.peso;
    const baseSemestral = contractValue * pmocSemestral.peso;
    const baseCorretiva = contractValue * corretiva.peso;
    const baseEPI = contractValue * epi.peso;
    const baseInstDesins = contractValue * instDesins.peso;

    // 3. Valores Financeiros Reconhecidos
    const recMensal = baseMensal * perfMensal;
    const recSemestral = baseSemestral * perfSemestral;
    const recCorretiva = baseCorretiva * perfCorretiva;
    const recEPI = baseEPI * perfEPI;
    const recInstDesins = baseInstDesins * perfInstDesins;
    
    // Excedente
    const qtdExcedente = Number(excedente.quantidade) || 0;
    const unitExcedente = Number(excedente.unitario) || 0;
    const recExcedente = qtdExcedente * unitExcedente;

    // Subtotal
    const subtotal = recMensal + recSemestral + recCorretiva + recEPI + recInstDesins + recExcedente;

    // Incentivo Veicular
    const recIncentivo = Number(incentivoVeicular.reconhecido) || 0;

    // Total Geral
    const total = subtotal + recIncentivo;

    return {
      gauges: {
        pmocMensal: {
          percentage: Math.round(perfMensal * 100),
          ratioText: `${pmocMensal.realizada} de ${pmocMensal.prevista} serviços executados`,
          perf: perfMensal
        },
        pmocSemestral: {
          percentage: Math.round(perfSemestral * 100),
          ratioText: `${pmocSemestral.realizada} de ${pmocSemestral.prevista} serviços executados`,
          perf: perfSemestral
        },
        corretiva: {
          percentage: Math.round(perfCorretiva * 100),
          ratioText: `${corretiva.realizada} de ${corretiva.prevista} serviços executados`,
          perf: perfCorretiva
        },
        epi: {
          percentage: Math.round(perfEPI * 100),
          ratioText: `${epi.realizada} de ${epi.prevista} itens entregues`,
          perf: perfEPI
        }
      },
      table: {
        rows: [
          {
            item: 'PMOC MENSAL',
            performance: Formatter.percentage(perfMensal),
            peso: Formatter.percentage(pmocMensal.peso),
            valorBase: Formatter.currency(baseMensal),
            valorReconhecido: Formatter.currency(recMensal, true)
          },
          {
            item: 'PMOC SEMESTRAL',
            performance: Formatter.percentage(perfSemestral),
            peso: Formatter.percentage(pmocSemestral.peso),
            valorBase: Formatter.currency(baseSemestral),
            valorReconhecido: Formatter.currency(recSemestral, true)
          },
          {
            item: 'CORRETIVA',
            performance: Formatter.percentage(perfCorretiva),
            peso: Formatter.percentage(corretiva.peso),
            valorBase: Formatter.currency(baseCorretiva),
            valorReconhecido: Formatter.currency(recCorretiva, true)
          },
          {
            item: 'EPI',
            performance: Formatter.percentage(perfEPI),
            peso: Formatter.percentage(epi.peso),
            valorBase: Formatter.currency(baseEPI),
            valorReconhecido: Formatter.currency(recEPI, true)
          },
          {
            item: 'INST/DESINS',
            performance: Formatter.percentage(perfInstDesins),
            peso: Formatter.percentage(instDesins.peso),
            valorBase: Formatter.currency(baseInstDesins),
            valorReconhecido: Formatter.currency(recInstDesins, true)
          },
          {
            item: 'EXCEDENTE',
            performance: `${qtdExcedente}`,
            peso: Formatter.currency(excedente.tarifa),
            valorBase: Formatter.currency(unitExcedente),
            valorReconhecido: Formatter.currency(recExcedente, false)
          }
        ],
        subtotal: Formatter.currency(subtotal),
        incentivoVeicular: {
          performance: Formatter.percentage(incentivoVeicular.metaPerformance),
          peso: '',
          valorBase: Formatter.currency(incentivoVeicular.baseValue),
          valorReconhecido: Formatter.currency(recIncentivo, true)
        },
        total: Formatter.currency(total)
      },
      raw: {
        contractValue,
        subtotal,
        total,
        perfMensal,
        perfSemestral,
        perfCorretiva,
        perfEPI
      }
    };
  }
}
