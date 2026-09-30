/**
 * Dados de Demonstração e Estrutura Padrão extraídos da Mar Brasil e planilhas oficiais.
 */

export const DEFAULT_REPORT_DATA = {
  contractBadge: 'CONTRATO STS 36693/22',
  contractTitle: 'Medição de Desempenho - Mar Brasil',
  contractSubtitle: 'Avaliação objetiva da execução contratual de manutenção (PMOC e correlatos) da SEDUC Santos realizada pela Mar Brasil, com conversão direta de performance operacional em valor financeiro reconhecido.',
  periodLabel: 'VALORES - MAR BRASIL 06/2026',
  company: 'Mar Brasil',
  clientName: 'SEDUC Santos',
  clientFullName: 'Secretaria de Educação de Santos',
  technicianName: 'GB Climatização (Setor 01)',
  contractValue: 6000.0,
  pmocMensal: {
    prevista: 402,
    realizada: 211,
    peso: 0.05
  },
  pmocSemestral: {
    prevista: 80,
    realizada: 0,
    peso: 0.40
  },
  corretiva: {
    prevista: 0,
    realizada: 0,
    peso: 0.40
  },
  epi: {
    prevista: 22,
    realizada: 9,
    peso: 0.10
  },
  instDesins: {
    performance: 1.0,
    peso: 0.05
  },
  excedente: {
    quantidade: 0,
    tarifa: 10.75,
    unitario: 3.50
  },
  incentivoVeicular: {
    metaPerformance: 0.59,
    baseValue: 1000.0,
    reconhecido: 0
  }
};

/**
 * Linhas extraídas fielmente da planilha do Excel com os 3 contratos ativos
 */
export const SAMPLE_SPREADSHEET_ROWS = [
  {
    setor: 'PSP6018/25 - CRSN',
    equipamentosAtivos: 135,
    mensalPrevista: 112,
    mensalRealizada: 112,
    semestralPrevista: 23,
    semestralRealizada: 23,
    corretivasPrevista: 0,
    corretivasRealizada: 0
  },
  {
    setor: 'PSP6029/25 - SMSU',
    equipamentosAtivos: 64,
    mensalPrevista: 53,
    mensalRealizada: 50,
    semestralPrevista: 11,
    semestralRealizada: 8,
    corretivasPrevista: 0,
    corretivasRealizada: 0
  },
  {
    setor: 'STS36693/22 - SETOR 01',
    equipamentosAtivos: 495,
    mensalPrevista: 412,
    mensalRealizada: 342,
    semestralPrevista: 83,
    semestralRealizada: 80,
    corretivasPrevista: 1,
    corretivasRealizada: 3
  },
  {
    setor: 'STS36693/22 - SETOR 02',
    equipamentosAtivos: 503,
    mensalPrevista: 419,
    mensalRealizada: 418,
    semestralPrevista: 84,
    semestralRealizada: 0,
    corretivasPrevista: 5,
    corretivasRealizada: 7
  },
  {
    setor: 'STS36693/22 - SETOR 03',
    equipamentosAtivos: 490,
    mensalPrevista: 408,
    mensalRealizada: 399,
    semestralPrevista: 82,
    semestralRealizada: 54,
    corretivasPrevista: 9,
    corretivasRealizada: 17
  },
  {
    setor: 'STS36693/22 - SETOR 04',
    equipamentosAtivos: 519,
    mensalPrevista: 432,
    mensalRealizada: 424,
    semestralPrevista: 87,
    semestralRealizada: 20,
    corretivasPrevista: 2,
    corretivasRealizada: 7
  },
  {
    setor: 'STS36693/22 - SETOR 05',
    equipamentosAtivos: 495,
    mensalPrevista: 412,
    mensalRealizada: 411,
    semestralPrevista: 83,
    semestralRealizada: 82,
    corretivasPrevista: 3,
    corretivasRealizada: 4
  },
  {
    setor: 'STS36693/22 - SETOR 06',
    equipamentosAtivos: 189,
    mensalPrevista: 157,
    mensalRealizada: 158,
    semestralPrevista: 32,
    semestralRealizada: 31,
    corretivasPrevista: 0,
    corretivasRealizada: 0
  }
];
