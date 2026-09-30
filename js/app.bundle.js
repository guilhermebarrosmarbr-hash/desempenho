/**
 * SISTEMA DE MEDIÇÃO DE DESEMPENHO E FATURAMENTO - MAR BRASIL
 * Versão Consolidada com Gestão de Contratos, Níveis de Técnicos e Cálculos Dinâmicos
 * Princípios de Clean Code: Responsabilidade Única, Funções Puras, Sem Dependências Desnecessárias.
 */

(function () {
  'use strict';

  /* ==========================================================================
     1. FORMATAÇÃO E HELPERS MATEMÁTICOS
     ========================================================================== */
  const Formatter = {
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

    percentage(value, isDecimal = true) {
      if (value === null || value === undefined || isNaN(value)) return '0%';
      const pct = isDecimal ? Math.round(value * 100) : Math.round(value);
      return `${pct}%`;
    },

    integer(value) {
      return new Intl.NumberFormat('pt-BR').format(Math.round(value || 0));
    }
  };

  /* ==========================================================================
     2. TABELA DE NÍVEIS DOS TÉCNICOS & REGRAS (MAR BRASIL)
     ========================================================================== */
  const TECH_LEVELS = {
    LVL_1: { id: 'LVL_1', label: 'Nível 01', value: 6000.0, description: 'STS 36693/22 - Setor 01' },
    LVL_2: { id: 'LVL_2', label: 'Nível 02', value: 5250.0, description: 'SMSU PSP 6029/25 & STS 36693/22 - Setor 04' },
    LVL_3: { id: 'LVL_3', label: 'Nível 03', value: 4250.0, description: 'CRSN PSP 6018/25 & STS 36693/22 - Setores 02, 03, 05, 06' }
  };

  /**
   * Identifica o nível do técnico com base no setor e contrato:
   * - Nível 01 (R$ 6.000,00): Setor 01 do STS 36693/22
   * - Nível 02 (R$ 5.250,00): SMSU PSP 6029/25 e Setor 04 do STS 36693/22
   * - Nível 03 (R$ 4.250,00): CRSN PSP 6018/25 e Setores 02, 03, 05 e 06 do STS 36693/22
   */
  function resolveTechLevelBySector(setorStr) {
    const norm = (setorStr || '').toUpperCase();

    // STS Setor 01 -> Nível 01
    if (norm.includes('SETOR 01') || norm.includes('SETOR 1')) {
      return TECH_LEVELS.LVL_1;
    }

    // SMSU ou STS Setor 04 -> Nível 02
    if (norm.includes('SMSU') || norm.includes('6029') || norm.includes('SETOR 04') || norm.includes('SETOR 4')) {
      return TECH_LEVELS.LVL_2;
    }

    // CRSN ou STS Setores 02, 03, 05, 06 -> Nível 03
    if (
      norm.includes('CRSN') || norm.includes('6018') ||
      norm.includes('SETOR 02') || norm.includes('SETOR 2') ||
      norm.includes('SETOR 03') || norm.includes('SETOR 3') ||
      norm.includes('SETOR 05') || norm.includes('SETOR 5') ||
      norm.includes('SETOR 06') || norm.includes('SETOR 6')
    ) {
      return TECH_LEVELS.LVL_3;
    }

    return TECH_LEVELS.LVL_3;
  }

  /* ==========================================================================
     3. REGRAS DE NEGÓCIO E CÁLCULO DA MEDIÇÃO
     ========================================================================== */
  class MeasurementCalculator {
    static computePerformance(prevista, realizada) {
      const prev = Number(prevista) || 0;
      const real = Number(realizada) || 0;

      if (prev <= 0) {
        return real >= 0 ? 1.0 : 0.0;
      }
      return Math.min(1.0, Math.max(0.0, real / prev));
    }

    /**
     * Regra do Excedente (Ponto 05):
     * Preenchido somente se a soma das preventivas mensais e semestrais for > 500.
     * Caso contrário, é zerado.
     */
    static computeExcedenteQty(mensalRealizada, semestralRealizada) {
      const soma = (Number(mensalRealizada) || 0) + (Number(semestralRealizada) || 0);
      return soma > 500 ? (soma - 500) : 0;
    }

    /**
     * Regra do Incentivo Veicular (Ponto 02):
     * Média da produtividade dos itens do técnico (Mensal, Semestral, Corretiva e EPI).
     * - Média 100%: Incentivo de 100% (R$ 1.000,00)
     * - Média 90% a 99%: R$ 750,00
     * - Média < 90%: R$ 0,00
     */
    static computeIncentivo(perfMensal, perfSemestral, perfCorretiva, perfEPI, baseValue = 1000.0) {
      const items = [perfMensal, perfSemestral, perfCorretiva, perfEPI];
      const avg = items.reduce((acc, val) => acc + val, 0) / items.length;
      const avgPct = Math.round(avg * 100);

      let reconhecido = 0.0;
      if (avgPct >= 100) {
        reconhecido = baseValue;
      } else if (avgPct >= 90) {
        reconhecido = 750.0;
      } else {
        reconhecido = 0.0;
      }

      return {
        metaPerformance: avg,
        baseValue: baseValue,
        reconhecido: reconhecido
      };
    }

    static calculate(params) {
      const {
        contractValue = 4250.0, // Nível do Técnico (canto superior direito)
        pmocMensal = { prevista: 402, realizada: 211, peso: 0.05 },
        pmocSemestral = { prevista: 80, realizada: 0, peso: 0.50 },
        corretiva = { prevista: 0, realizada: 0, peso: 0.40 },
        epi = { prevista: 22, realizada: 9, peso: 0.05 },
        excedente = { quantidade: 0, tarifa: 10.75, unitario: 3.50 },
        incentivoVeicular = { metaPerformance: 0.59, baseValue: 1000.0, reconhecido: 0 }
      } = params;

      // 1. Desempenho Operacional (0 a 1)
      const perfMensal = this.computePerformance(pmocMensal.prevista, pmocMensal.realizada);
      const perfSemestral = this.computePerformance(pmocSemestral.prevista, pmocSemestral.realizada);
      const perfCorretiva = this.computePerformance(corretiva.prevista, corretiva.realizada);
      const perfEPI = this.computePerformance(epi.prevista, epi.realizada);

      // 2. Valores Base (calculados a partir do Nível do Técnico)
      const baseMensal = contractValue * (Number(pmocMensal.peso) || 0.05);
      const baseSemestral = contractValue * (Number(pmocSemestral.peso) || 0.50);
      const baseCorretiva = contractValue * (Number(corretiva.peso) || 0.40);
      const baseEPI = contractValue * (Number(epi.peso) || 0.05);

      // 3. Valores Reconhecidos
      const recMensal = baseMensal * perfMensal;
      const recSemestral = baseSemestral * perfSemestral;
      const recCorretiva = baseCorretiva * perfCorretiva;
      const recEPI = baseEPI * perfEPI;

      // 4. Excedente
      const qtdExcedente = Number(excedente.quantidade) || 0;
      const unitExcedente = Number(excedente.unitario) || 0;
      const recExcedente = qtdExcedente * unitExcedente;

      // 5. Subtotal (sem Inst/Desins que foi removida)
      const subtotal = recMensal + recSemestral + recCorretiva + recEPI + recExcedente;

      // 6. Incentivo Veicular
      const recIncentivo = Number(incentivoVeicular.reconhecido) || 0;

      // 7. Total Final
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
          total
        }
      };
    }
  }

  /* ==========================================================================
     4. REPOSITÓRIO E GESTÃO DE CONTRATOS E TÉCNICOS (MAR BRASIL)
     ========================================================================== */
  const STORAGE_KEY = 'MAR_BRASIL_PMOC_CONFIG_V2';

  const INITIAL_TECHNICIANS = [
    { id: 'tech-gb', name: 'GB Climatização', phone: '', notes: 'Responsável Setor 01 Santos (Nível 01)' },
    { id: 'tech-ravtech', name: 'RavTech Climatização', phone: '', notes: 'Responsável Setor 02 Santos (Nível 03)' },
    { id: 'tech-rn', name: 'RN Climatização', phone: '', notes: 'Responsável Setor 03 Santos (Nível 03)' },
    { id: 'tech-gr', name: 'GR Ar Condicionado', phone: '', notes: 'Responsável Setor 04 Santos (Nível 02)' },
    { id: 'tech-cj', name: 'CJ Refrigeração', phone: '', notes: 'Responsável Setor 05 Santos (Nível 03)' },
    { id: 'tech-santoar', name: 'Santo Ar', phone: '', notes: 'Responsável Setor 06 Santos (Nível 03)' },
    { id: 'tech-jr', name: 'JR Refrigeração', phone: '', notes: 'Responsável Contrato CRSN PSP 6018/25 (Nível 03)' },
    { id: 'tech-cm2d', name: 'CM2D Refrigeração', phone: '', notes: 'Responsável Contrato SMSU PSP 6029/25 (Nível 02)' }
  ];

  const INITIAL_CONTRACTS = [
    {
      id: 'contract-sts',
      code: 'STS 36693/22',
      clientName: 'SEDUC Santos',
      clientFullName: 'Secretaria de Educação de Santos',
      company: 'Mar Brasil',
      description: 'Avaliação objetiva da execução contratual de manutenção (PMOC e correlatos) da SEDUC Santos realizada pela Mar Brasil, com conversão direta de performance operacional em valor financeiro reconhecido.',
      contractValue: 6000.0,
      technicianId: '',
      sectors: [
        { id: 'sec-sts-01', code: 'SETOR 01', fullName: 'STS36693/22 - SETOR 01', technicianId: 'tech-gb', techLevel: 'LVL_1' },
        { id: 'sec-sts-02', code: 'SETOR 02', fullName: 'STS36693/22 - SETOR 02', technicianId: 'tech-ravtech', techLevel: 'LVL_3' },
        { id: 'sec-sts-03', code: 'SETOR 03', fullName: 'STS36693/22 - SETOR 03', technicianId: 'tech-rn', techLevel: 'LVL_3' },
        { id: 'sec-sts-04', code: 'SETOR 04', fullName: 'STS36693/22 - SETOR 04', technicianId: 'tech-gr', techLevel: 'LVL_2' },
        { id: 'sec-sts-05', code: 'SETOR 05', fullName: 'STS36693/22 - SETOR 05', technicianId: 'tech-cj', techLevel: 'LVL_3' },
        { id: 'sec-sts-06', code: 'SETOR 06', fullName: 'STS36693/22 - SETOR 06', technicianId: 'tech-santoar', techLevel: 'LVL_3' }
      ]
    },
    {
      id: 'contract-crsn',
      code: 'PSP 6018/25',
      clientName: 'CRSN',
      clientFullName: 'Coordenadoria Regional de Saúde Norte de São Paulo',
      company: 'Mar Brasil',
      description: 'Avaliação objetiva da execução contratual de manutenção (PMOC e correlatos) da Coordenadoria Regional de Saúde Norte de São Paulo realizada pela Mar Brasil, com conversão direta de performance operacional em valor financeiro reconhecido.',
      contractValue: 4250.0,
      technicianId: 'tech-jr',
      techLevel: 'LVL_3',
      sectors: [
        { id: 'sec-crsn-01', code: 'CRSN', fullName: 'PSP6018/25 - CRSN', technicianId: 'tech-jr', techLevel: 'LVL_3' }
      ]
    },
    {
      id: 'contract-smsu',
      code: 'PSP 6029/25',
      clientName: 'SMSU',
      clientFullName: 'Secretaria Municipal de Segurança Urbana de São Paulo',
      company: 'Mar Brasil',
      description: 'Avaliação objetiva da execução contratual de manutenção (PMOC e correlatos) da Secretaria Municipal de Segurança Urbana de São Paulo realizada pela Mar Brasil, com conversão direta de performance operacional em valor financeiro reconhecido.',
      contractValue: 5250.0,
      technicianId: 'tech-cm2d',
      techLevel: 'LVL_2',
      sectors: [
        { id: 'sec-smsu-01', code: 'SMSU', fullName: 'PSP6029/25 - SMSU', technicianId: 'tech-cm2d', techLevel: 'LVL_2' }
      ]
    }
  ];

  class ContractStore {
    static load() {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && Array.isArray(parsed.contracts) && Array.isArray(parsed.technicians)) {
            return parsed;
          }
        }
      } catch (e) {
        console.warn('Erro ao carregar do localStorage:', e);
      }

      const initial = {
        company: 'Mar Brasil',
        technicians: JSON.parse(JSON.stringify(INITIAL_TECHNICIANS)),
        contracts: JSON.parse(JSON.stringify(INITIAL_CONTRACTS))
      };
      this.save(initial);
      return initial;
    }

    static save(data) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (e) {
        console.error('Erro ao salvar no localStorage:', e);
      }
    }

    static resetToDefault() {
      const initial = {
        company: 'Mar Brasil',
        technicians: JSON.parse(JSON.stringify(INITIAL_TECHNICIANS)),
        contracts: JSON.parse(JSON.stringify(INITIAL_CONTRACTS))
      };
      this.save(initial);
      return initial;
    }

    static getTechName(technicians, techId) {
      if (!techId) return 'Não Definido';
      const found = technicians.find(t => t.id === techId);
      return found ? found.name : 'Não Definido';
    }

    static resolveSectorInfo(config, setorStr) {
      if (!setorStr) {
        return {
          company: config.company || 'Mar Brasil',
          contract: null,
          sector: null,
          clientName: 'SEDUC Santos',
          clientFullName: 'Secretaria de Educação de Santos',
          technicianName: 'GB Climatização',
          sectorDisplayName: 'Setor 01',
          techLevel: TECH_LEVELS.LVL_1,
          isConsolidated: false
        };
      }

      const cleanStr = setorStr.replace(/\s+/g, ' ').toUpperCase();
      const detectedLevel = resolveTechLevelBySector(cleanStr);

      for (const contract of config.contracts) {
        if (contract.sectors && contract.sectors.length > 0) {
          for (const sec of contract.sectors) {
            const secCode = (sec.code || '').toUpperCase();
            const secFull = (sec.fullName || '').toUpperCase();

            if (
              cleanStr.includes(secCode) ||
              cleanStr.includes(secFull) ||
              (secFull && cleanStr.replace(/[^A-Z0-9]/g, '').includes(secFull.replace(/[^A-Z0-9]/g, '')))
            ) {
              const techName = this.getTechName(config.technicians, sec.technicianId || contract.technicianId);
              return {
                company: contract.company || config.company || 'Mar Brasil',
                contract,
                sector: sec,
                clientName: contract.clientName,
                clientFullName: contract.clientFullName,
                technicianName: techName,
                sectorDisplayName: sec.code || sec.fullName,
                techLevel: sec.techLevel ? (TECH_LEVELS[sec.techLevel] || detectedLevel) : detectedLevel,
                isConsolidated: false
              };
            }
          }
        }

        const contractCode = contract.code.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const strCode = cleanStr.replace(/[^A-Z0-9]/g, '');
        if (strCode.includes(contractCode)) {
          let techSummary = 'Equipe Técnica Especializada';
          if (contract.technicianId) {
            techSummary = this.getTechName(config.technicians, contract.technicianId);
          } else if (contract.sectors && contract.sectors.length > 0) {
            techSummary = `${contract.sectors.length} Setores • Múltiplos Técnicos`;
          }

          return {
            company: contract.company || config.company || 'Mar Brasil',
            contract,
            sector: null,
            clientName: contract.clientName,
            clientFullName: contract.clientFullName,
            technicianName: techSummary,
            sectorDisplayName: 'Consolidado Geral',
            techLevel: detectedLevel,
            isConsolidated: true
          };
        }
      }

      return {
        company: config.company || 'Mar Brasil',
        contract: null,
        sector: null,
        clientName: 'Contratante',
        clientFullName: 'Órgão Contratante',
        technicianName: 'Técnico Responsável',
        sectorDisplayName: setorStr,
        techLevel: detectedLevel,
        isConsolidated: false
      };
    }
  }

  /* ==========================================================================
     5. DADOS DE DEMONSTRAÇÃO DO PRINT (MAR BRASIL)
     ========================================================================== */
  const DEFAULT_REPORT_DATA = {
    contractBadge: 'CONTRATO STS 36693/22',
    contractTitle: 'Medição de Desempenho - Mar Brasil',
    contractSubtitle: 'Avaliação objetiva da execução contratual de manutenção (PMOC e correlatos) da SEDUC Santos realizada pela Mar Brasil, com conversão direta de performance operacional em valor financeiro reconhecido.',
    periodLabel: 'VALORES - MAR BRASIL 06/2026',
    company: 'Mar Brasil',
    clientName: 'SEDUC Santos',
    clientFullName: 'Secretaria de Educação de Santos',
    technicianName: 'GB Climatização (Setor 01)',
    contractValue: 6000.0, // Nível 01
    pmocMensal: { prevista: 402, realizada: 211, peso: 0.05 },
    pmocSemestral: { prevista: 80, realizada: 0, peso: 0.50 },
    corretiva: { prevista: 0, realizada: 0, peso: 0.40 },
    epi: { prevista: 22, realizada: 9, peso: 0.05 },
    excedente: { quantidade: 0, tarifa: 10.75, unitario: 3.50 },
    incentivoVeicular: { metaPerformance: 0.59, baseValue: 1000.0, reconhecido: 0 }
  };

  const SAMPLE_SPREADSHEET_ROWS = [
    { setor: 'PSP6018/25 - CRSN', equipamentosAtivos: 135, mensalPrevista: 112, mensalRealizada: 112, semestralPrevista: 23, semestralRealizada: 23, corretivasPrevista: 0, corretivasRealizada: 0 },
    { setor: 'PSP6029/25 - SMSU', equipamentosAtivos: 64, mensalPrevista: 53, mensalRealizada: 50, semestralPrevista: 11, semestralRealizada: 8, corretivasPrevista: 0, corretivasRealizada: 0 },
    { setor: 'STS36693/22 - SETOR 01', equipamentosAtivos: 495, mensalPrevista: 412, mensalRealizada: 342, semestralPrevista: 83, semestralRealizada: 80, corretivasPrevista: 1, corretivasRealizada: 3 },
    { setor: 'STS36693/22 - SETOR 02', equipamentosAtivos: 503, mensalPrevista: 419, mensalRealizada: 418, semestralPrevista: 84, semestralRealizada: 0, corretivasPrevista: 5, corretivasRealizada: 7 },
    { setor: 'STS36693/22 - SETOR 03', equipamentosAtivos: 490, mensalPrevista: 408, mensalRealizada: 399, semestralPrevista: 82, semestralRealizada: 54, corretivasPrevista: 9, corretivasRealizada: 17 },
    { setor: 'STS36693/22 - SETOR 04', equipamentosAtivos: 519, mensalPrevista: 432, mensalRealizada: 424, semestralPrevista: 87, semestralRealizada: 20, corretivasPrevista: 2, corretivasRealizada: 7 },
    { setor: 'STS36693/22 - SETOR 05', equipamentosAtivos: 495, mensalPrevista: 412, mensalRealizada: 411, semestralPrevista: 83, semestralRealizada: 82, corretivasPrevista: 3, corretivasRealizada: 4 },
    { setor: 'STS36693/22 - SETOR 06', equipamentosAtivos: 189, mensalPrevista: 157, mensalRealizada: 158, semestralPrevista: 32, semestralRealizada: 31, corretivasPrevista: 0, corretivasRealizada: 0 }
  ];

  /* ==========================================================================
     6. PARSER E EXPORTADOR DE EXCEL
     ========================================================================== */
  class ExcelParser {
    static normalizeHeader(str) {
      if (!str) return '';
      return String(str)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    static parseNumber(val) {
      if (val === null || val === undefined || val === '') return 0;
      if (typeof val === 'number') return isNaN(val) ? 0 : val;
      const cleaned = String(val)
        .replace(/[R$\s%]/g, '')
        .replace(/\./g, '')
        .replace(',', '.');
      const num = parseFloat(cleaned);
      return isNaN(num) ? 0 : num;
    }

    /**
     * Mapeamento posicional fixo da planilha (colunas A a N):
     * A(0)=Setor | B(1)=Equipamentos Ativos
     * C(2)=Mensal Prev | D(3)=Mensal Real | E(4)=% [ignorado] | F(5)=Faltam [ignorado]
     * G(6)=Semestral Prev | H(7)=Semestral Real | I(8)=% [ignorado] | J(9)=Faltam [ignorado]
     * K(10)=Corretivas Prev | L(11)=Corretivas Real | M(12)=% [ignorado] | N(13)=Faltam [ignorado]
     * EPI: sempre manual — não consta na planilha.
     */
    static POSITIONAL_MAP = {
      setor: 0,
      equipamentosAtivos: 1,
      mensalPrevista: 2,
      mensalRealizada: 3,
      semestralPrevista: 6,
      semestralRealizada: 7,
      corretivasPrevista: 10,
      corretivasRealizada: 11
    };

    static mapHeadersByName(headers) {
      const map = {};
      headers.forEach((h, index) => {
        const norm = this.normalizeHeader(h);
        if (/^(setor|contrato|unidade|local|posto)/.test(norm)) map.setor = index;
        else if (/equipamento.*ativo|ativos/.test(norm)) map.equipamentosAtivos = index;
        else if (/mensal.*prev/.test(norm)) map.mensalPrevista = index;
        else if (/mensal.*real/.test(norm)) map.mensalRealizada = index;
        else if (/semestral.*prev/.test(norm)) map.semestralPrevista = index;
        else if (/semestral.*real/.test(norm)) map.semestralRealizada = index;
        else if (/corretiv.*prev/.test(norm)) map.corretivasPrevista = index;
        else if (/corretiv.*real/.test(norm)) map.corretivasRealizada = index;
      });
      return map;
    }

    static resolveColumnMap(headers) {
      const byName = this.mapHeadersByName(headers);
      const required = ['setor', 'mensalPrevista', 'mensalRealizada', 'semestralPrevista', 'semestralRealizada'];
      const isComplete = required.every(k => byName[k] !== undefined);
      return isComplete ? byName : { ...this.POSITIONAL_MAP };
    }

    static async parseWorkbook(dataBuffer) {
      if (!window.XLSX) {
        throw new Error('Biblioteca XLSX não carregada no navegador.');
      }

      const workbook = window.XLSX.read(dataBuffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      let rawMatrix = window.XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

      if (!rawMatrix || rawMatrix.length === 0) {
        throw new Error('A planilha está vazia.');
      }

      if (rawMatrix.length > 0 && rawMatrix[0].length <= 2 && String(rawMatrix[0][0]).includes(';')) {
        rawMatrix = rawMatrix.map(r => (typeof r[0] === 'string' ? r[0].split(';').map(c => c.trim()) : r));
      }

      let headerRowIdx = 0;
      for (let i = 0; i < Math.min(rawMatrix.length, 10); i++) {
        const rowStr = rawMatrix[i].map(c => this.normalizeHeader(c)).join(' ');
        if (rowStr.includes('setor') || rowStr.includes('mensal') || rowStr.includes('equipamento')) {
          headerRowIdx = i;
          break;
        }
      }

      const headerRow = rawMatrix[headerRowIdx];
      const columnMap = this.resolveColumnMap(headerRow);
      const rows = [];

      for (let r = headerRowIdx + 1; r < rawMatrix.length; r++) {
        const row = rawMatrix[r];
        if (!row || row.length === 0) continue;

        const setor = String(row[columnMap.setor] ?? '').trim();
        if (!setor) continue;

        rows.push({
          id: `row-${r}`,
          setor,
          equipamentosAtivos:  this.parseNumber(row[columnMap.equipamentosAtivos]),
          mensalPrevista:      this.parseNumber(row[columnMap.mensalPrevista]),
          mensalRealizada:     this.parseNumber(row[columnMap.mensalRealizada]),
          semestralPrevista:   this.parseNumber(row[columnMap.semestralPrevista]),
          semestralRealizada:  this.parseNumber(row[columnMap.semestralRealizada]),
          corretivasPrevista:  this.parseNumber(row[columnMap.corretivasPrevista]),
          corretivasRealizada: this.parseNumber(row[columnMap.corretivasRealizada])
        });
      }

      const groups = this.groupRowsByContract(rows);
      return { sheetNames: workbook.SheetNames, rows, groups };
    }

    static groupRowsByContract(rows) {
      const groups = {};
      rows.forEach(row => {
        let contractCode = row.setor;
        if (row.setor.includes('-')) {
          contractCode = row.setor.split('-')[0].trim();
        } else if (row.setor.includes('/')) {
          contractCode = row.setor.split(' ')[0].trim();
        }

        if (!groups[contractCode]) {
          groups[contractCode] = {
            contractCode,
            label: `Consolidado ${contractCode}`,
            items: [],
            totals: {
              equipamentosAtivos: 0,
              mensalPrevista: 0,
              mensalRealizada: 0,
              semestralPrevista: 0,
              semestralRealizada: 0,
              corretivasPrevista: 0,
              corretivasRealizada: 0
            }
          };
        }

        groups[contractCode].items.push(row);
        groups[contractCode].totals.equipamentosAtivos += row.equipamentosAtivos;
        groups[contractCode].totals.mensalPrevista += row.mensalPrevista;
        groups[contractCode].totals.mensalRealizada += row.mensalRealizada;
        groups[contractCode].totals.semestralPrevista += row.semestralPrevista;
        groups[contractCode].totals.semestralRealizada += row.semestralRealizada;
        groups[contractCode].totals.corretivasPrevista += row.corretivasPrevista;
        groups[contractCode].totals.corretivasRealizada += row.corretivasRealizada;
      });
      return groups;
    }

    static downloadTemplate() {
      if (!window.XLSX) {
        alert('Carregando biblioteca XLSX...');
        return;
      }

      const headers = [
        'SETOR', 'EQUIPAMENTOS ATIVOS', 'MENSAL - PREVISTA', 'MENSAL - REALIZADA',
        'MENSAL - CONCLUÍDA', 'MENSAL - FALTAM', 'SEMESTRAL - PREVISTA', 'SEMESTRAL - REALIZADA',
        'SEMESTRAL - CONCLUÍDA', 'SEMESTRAL - FALTAM', 'CORRETIVAS - PREV.', 'CORRETIVAS - REALIZ.',
        'CORRETIVAS - CONCLUÍDA', 'CORRETIVAS - FALTAM'
      ];

      const sampleRows = [
        ['PSP6018/25 - CRSN', 135, 112, 112, '100%', 0, 23, 23, '100%', 0, 0, 0, '0%', 0],
        ['PSP6029/25 - SMSU', 64, 53, 50, '94%', 3, 11, 8, '73%', 3, 0, 0, '0%', 0],
        ['STS36693/22 - SETOR 01', 495, 412, 342, '83%', 70, 83, 80, '96%', 3, 1, 3, '100%', 0],
        ['STS36693/22 - SETOR 02', 503, 419, 418, '100%', 1, 84, 0, '0%', 84, 5, 7, '100%', 0],
        ['STS36693/22 - SETOR 03', 490, 408, 399, '98%', 9, 82, 54, '66%', 28, 9, 17, '100%', 0],
        ['STS36693/22 - SETOR 04', 519, 432, 424, '98%', 8, 87, 20, '23%', 67, 2, 7, '100%', 0],
        ['STS36693/22 - SETOR 05', 495, 412, 411, '100%', 1, 83, 82, '99%', 1, 3, 4, '100%', 0],
        ['STS36693/22 - SETOR 06', 189, 157, 158, '100%', 0, 32, 31, '97%', 1, 0, 0, '0%', 0]
      ];

      const data = [headers, ...sampleRows];
      const ws = window.XLSX.utils.aoa_to_sheet(data);
      const wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, 'Medicao_PMOC');
      window.XLSX.writeFile(wb, 'planilha_medicao_pmoc_modelo.xlsx');
    }
  }

  /* ==========================================================================
     7. RENDERIZADOR VISUAL DO RELATÓRIO (DONUTS SVG + TABELA + TÉCNICO)
     ========================================================================== */
  class ReportRenderer {
    static renderDonut(percentage, title, desc) {
      const radius = 58;
      const circumference = 2 * Math.PI * radius; // ~364.42
      const clampedPct = Math.min(100, Math.max(0, percentage));
      const offset = circumference * (1 - clampedPct / 100);

      return `
        <div class="gauge-card">
          <div class="gauge-svg-container">
            <svg class="gauge-svg" viewBox="0 0 160 160">
              <circle cx="80" cy="80" r="${radius}" class="gauge-track" />
              <circle
                cx="80"
                cy="80"
                r="${radius}"
                class="gauge-progress"
                stroke-dasharray="${circumference.toFixed(2)}"
                stroke-dashoffset="${offset.toFixed(2)}"
                transform="rotate(-90 80 80)"
              />
              <text x="80" y="88" class="gauge-value" text-anchor="middle">
                ${clampedPct}%
              </text>
            </svg>
          </div>
          <div class="gauge-info">
            <h3 class="gauge-title">${title}</h3>
            <p class="gauge-subtitle">${desc}</p>
          </div>
        </div>
      `;
    }

    static renderCubeLogo() {
      return `
        <svg class="brand-cube-logo" viewBox="0 0 100 100" fill="none">
          <polygon points="50,12 85,32 50,52 15,32" fill="#f59e0b" />
          <polygon points="50,22 75,36 50,50 25,36" fill="#fbbf24" />
          <polygon points="15,32 50,52 50,90 15,70" fill="#ea580c" />
          <polygon points="25,40 45,52 45,82 25,65" fill="#f97316" />
          <polygon points="50,52 85,32 85,70 50,90" fill="#c2410c" />
          <polygon points="55,52 75,40 75,65 55,82" fill="#ea580c" />
          <polygon points="50,42 64,50 50,58 36,50" fill="#fef3c7" opacity="0.9" />
        </svg>
      `;
    }

    static renderReport(container, data, computed) {
      if (!container) return;
      const { gauges, table } = computed;

      const techBadgeHtml = data.technicianName ? `
        <span class="technician-badge">
          <span class="badge-icon">👷</span>
          <span class="badge-label">Responsável Técnico:</span>
          <strong class="badge-name">${data.technicianName}</strong>
        </span>
      ` : '';

      container.innerHTML = `
        <div class="report-paper">
          <header class="report-header">
            <div class="header-left">
              <div class="badges-row">
                <span class="contract-badge">${data.contractBadge || 'CONTRATO STS 36693/22'}</span>
                ${techBadgeHtml}
              </div>
              
              <h1 class="report-title">${data.contractTitle || 'Medição de Desempenho - Mar Brasil'}</h1>
              <p class="report-subtitle">
                ${data.contractSubtitle || 'Avaliação objetiva da execução contratual de manutenção (PMOC e correlatos) da SEDUC Santos realizada pela Mar Brasil, com conversão direta de performance operacional em valor financeiro reconhecido.'}
              </p>
            </div>
            <div class="header-right">
              ${this.renderCubeLogo()}
            </div>
          </header>

          <section class="gauges-grid">
            ${this.renderDonut(gauges.pmocMensal.percentage, 'PMOC Mensal', gauges.pmocMensal.ratioText)}
            ${this.renderDonut(gauges.pmocSemestral.percentage, 'PMOC Semestral', gauges.pmocSemestral.ratioText)}
            ${this.renderDonut(gauges.corretiva.percentage, 'Manutenção Corretiva', gauges.corretiva.ratioText)}
            ${this.renderDonut(gauges.epi.percentage, 'EPI', gauges.epi.ratioText)}
          </section>

          <hr class="report-divider" />

          <section class="financial-section">
            <div class="financial-header">
              <span class="financial-label">${data.periodLabel || 'VALORES - MAR BRASIL 06/2026'}</span>
              <span class="financial-total-base" title="Valor base do nível do técnico">${Formatter.currency(data.contractValue || 4250.0)}</span>
            </div>

            <table class="report-table">
              <tbody>
                ${table.rows.map((row, idx) => `
                  <tr class="table-row ${idx % 2 === 1 ? 'row-alt' : ''}">
                    <td class="col-item">${row.item}</td>
                    <td class="col-perf">${row.performance}</td>
                    <td class="col-peso">${row.peso}</td>
                    <td class="col-base">${row.valorBase}</td>
                    <td class="col-rec">${row.valorReconhecido}</td>
                  </tr>
                `).join('')}

                <tr class="table-row row-subtotal">
                  <td class="col-item font-bold" colspan="4">SUBTOTAL</td>
                  <td class="col-rec font-bold">${table.subtotal}</td>
                </tr>

                <tr class="table-row">
                  <td class="col-item">INCENTIVO VEICULAR</td>
                  <td class="col-perf">${table.incentivoVeicular.performance}</td>
                  <td class="col-peso"></td>
                  <td class="col-base">${table.incentivoVeicular.valorBase}</td>
                  <td class="col-rec">${table.incentivoVeicular.valorReconhecido}</td>
                </tr>

                <tr class="table-row row-total">
                  <td class="col-item font-black" colspan="4">TOTAL</td>
                  <td class="col-rec font-black">${table.total}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>
      `;
    }
  }

  /* ==========================================================================
     8. CONTROLADOR PRINCIPAL DA APLICAÇÃO (UI, EVENTOS E MODAL ESCALÁVEL)
     ========================================================================== */
  class MeasurementApp {
    constructor() {
      this.config = ContractStore.load();
      this.state = JSON.parse(JSON.stringify(DEFAULT_REPORT_DATA));
      
      this.spreadsheetData = {
        rows: SAMPLE_SPREADSHEET_ROWS,
        groups: ExcelParser.groupRowsByContract(SAMPLE_SPREADSHEET_ROWS)
      };

      this.initElements();
      this.initEvents();
      this.initModalEvents();
      this.populateContractSelect();
      this.onSectorChange();
    }

    initElements() {
      this.reportContainer = document.getElementById('reportContainer');
      
      // Botões Navbar
      this.btnOpenConfigModal = document.getElementById('btnOpenConfigModal');
      this.btnDownloadTemplate = document.getElementById('btnDownloadTemplate');
      this.btnLoadSample = document.getElementById('btnLoadSample');
      this.btnPrint = document.getElementById('btnPrint');
      this.btnQuickPrint = document.getElementById('btnQuickPrint');
      this.btnDownloadPdf = document.getElementById('btnDownloadPdf');
      this.btnClearData = document.getElementById('btnClearData');

      // Dropzone & Arquivo
      this.dropzone = document.getElementById('excelDropzone');
      this.fileInput = document.getElementById('excelFileInput');
      this.fileBadge = document.getElementById('fileBadge');
      this.fileInfoNotice = document.getElementById('fileInfoNotice');
      this.activeFileName = document.getElementById('activeFileName');

      // Seletor & Box Informativo da Sidebar
      this.contractSectorSelect = document.getElementById('contractSectorSelect');
      this.sidebarCompany = document.getElementById('sidebarCompany');
      this.sidebarClient = document.getElementById('sidebarClient');
      this.sidebarTech = document.getElementById('sidebarTech');
      this.sidebarSector = document.getElementById('sidebarSector');

      // Pílulas de Estatísticas Rápidas
      this.pillEquipamentos = document.getElementById('pillEquipamentos');
      this.pillMensal = document.getElementById('pillMensal');
      this.pillSemestral = document.getElementById('pillSemestral');
      this.pillCorretivas = document.getElementById('pillCorretivas');

      // Inputs de Parâmetros
      this.inputContractBadge = document.getElementById('inputContractBadge');
      this.inputPeriodLabel = document.getElementById('inputPeriodLabel');
      this.selectTechLevel = document.getElementById('selectTechLevel');
      this.inputContractValue = document.getElementById('inputContractValue');

      // Tarefas Operacionais Editáveis
      this.inputMensalPrevista = document.getElementById('inputMensalPrevista');
      this.inputMensalRealizada = document.getElementById('inputMensalRealizada');
      this.inputMensalPeso = document.getElementById('inputMensalPeso');

      this.inputSemestralPrevista = document.getElementById('inputSemestralPrevista');
      this.inputSemestralRealizada = document.getElementById('inputSemestralRealizada');
      this.inputSemestralPeso = document.getElementById('inputSemestralPeso');

      this.inputCorretivaPrevista = document.getElementById('inputCorretivaPrevista');
      this.inputCorretivaRealizada = document.getElementById('inputCorretivaRealizada');
      this.inputCorretivaPeso = document.getElementById('inputCorretivaPeso');

      this.inputEpiPrevista = document.getElementById('inputEpiPrevista');
      this.inputEpiRealizada = document.getElementById('inputEpiRealizada');
      this.inputEpiPeso = document.getElementById('inputEpiPeso');

      this.inputExcedenteQtd = document.getElementById('inputExcedenteQtd');
      this.inputExcedenteTarifa = document.getElementById('inputExcedenteTarifa');
      this.inputExcedenteUnit = document.getElementById('inputExcedenteUnit');

      this.inputIncentivoMeta = document.getElementById('inputIncentivoMeta');
      this.inputIncentivoBase = document.getElementById('inputIncentivoBase');
      this.inputIncentivoRec = document.getElementById('inputIncentivoRec');

      // Elementos do Modal
      this.configModal = document.getElementById('configModal');
      this.btnCloseConfigModal = document.getElementById('btnCloseConfigModal');
      this.btnCloseConfigModalBottom = document.getElementById('btnCloseConfigModalBottom');
      this.btnResetConfig = document.getElementById('btnResetConfig');

      this.tabBtnContracts = document.getElementById('tabBtnContracts');
      this.tabBtnTechs = document.getElementById('tabBtnTechs');
      this.paneContracts = document.getElementById('paneContracts');
      this.paneTechs = document.getElementById('paneTechs');

      this.contractsListContainer = document.getElementById('contractsListContainer');
      this.techniciansListContainer = document.getElementById('techniciansListContainer');

      // Formulários da Modal
      this.btnShowAddContract = document.getElementById('btnShowAddContract');
      this.contractFormBox = document.getElementById('contractFormBox');
      this.btnCancelContractForm = document.getElementById('btnCancelContractForm');
      this.btnSaveContractForm = document.getElementById('btnSaveContractForm');
      this.formContractId = document.getElementById('formContractId');
      this.formContractCode = document.getElementById('formContractCode');
      this.formClientName = document.getElementById('formClientName');
      this.formClientFullName = document.getElementById('formClientFullName');
      this.formContractValue = document.getElementById('formContractValue');
      this.formContractDesc = document.getElementById('formContractDesc');
      this.formContractTech = document.getElementById('formContractTech');

      this.btnShowAddTech = document.getElementById('btnShowAddTech');
      this.techFormBox = document.getElementById('techFormBox');
      this.btnCancelTechForm = document.getElementById('btnCancelTechForm');
      this.btnSaveTechForm = document.getElementById('btnSaveTechForm');
      this.formTechId = document.getElementById('formTechId');
      this.formTechName = document.getElementById('formTechName');
      this.formTechPhone = document.getElementById('formTechPhone');
      this.formTechNotes = document.getElementById('formTechNotes');
    }

    initEvents() {
      this.btnDownloadTemplate.addEventListener('click', () => ExcelParser.downloadTemplate());
      this.btnLoadSample.addEventListener('click', () => this.loadDefaultSample());
      this.btnClearData.addEventListener('click', () => this.clearSpreadsheetData());
      this.btnPrint.addEventListener('click', () => window.print());
      this.btnQuickPrint.addEventListener('click', () => window.print());
      
      this.btnDownloadPdf.addEventListener('click', () => {
        const paper = document.querySelector('.report-paper');
        const filename = `relatorio_medicao_${(this.state.contractBadge || 'MAR_BRASIL').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
        if (typeof window.html2pdf === 'function') {
          const opt = {
            margin: [10, 12, 10, 12],
            filename: filename,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2.2, useCORS: true, letterRendering: true, logging: false },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
          };
          window.html2pdf().set(opt).from(paper).save().catch(() => window.print());
        } else {
          window.print();
        }
      });

      // Drag & Drop
      this.dropzone.addEventListener('click', () => this.fileInput.click());
      this.dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        this.dropzone.classList.add('dragover');
      });
      this.dropzone.addEventListener('dragleave', () => this.dropzone.classList.remove('dragover'));
      this.dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        this.dropzone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          this.processExcelFile(e.dataTransfer.files[0]);
        }
      });

      this.fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.processExcelFile(e.target.files[0]);
        }
      });

      this.contractSectorSelect.addEventListener('change', () => this.onSectorChange());

      // Mudança no Nível do Técnico
      if (this.selectTechLevel) {
        this.selectTechLevel.addEventListener('change', () => {
          const selected = this.selectTechLevel.value;
          if (selected === 'LVL_1') {
            this.inputContractValue.value = '6000.00';
          } else if (selected === 'LVL_2') {
            this.inputContractValue.value = '5250.00';
          } else if (selected === 'LVL_3') {
            this.inputContractValue.value = '4250.00';
          }
          this.syncStateFromInputs(false);
        });
      }

      // Recomputação automática de excedente ao alterar tarefas mensais e semestrais
      const triggerExcedenteUpdate = () => {
        const mReal = parseInt(this.inputMensalRealizada.value, 10) || 0;
        const sReal = parseInt(this.inputSemestralRealizada.value, 10) || 0;
        this.inputExcedenteQtd.value = MeasurementCalculator.computeExcedenteQty(mReal, sReal);
        this.syncStateFromInputs(true);
      };

      if (this.inputMensalRealizada) this.inputMensalRealizada.addEventListener('input', triggerExcedenteUpdate);
      if (this.inputSemestralRealizada) this.inputSemestralRealizada.addEventListener('input', triggerExcedenteUpdate);

      // Recomputação de incentivo veicular em tarefas operacionais
      const operationalInputs = [
        this.inputMensalPrevista, this.inputSemestralPrevista,
        this.inputCorretivaPrevista, this.inputCorretivaRealizada,
        this.inputEpiPrevista, this.inputEpiRealizada
      ];

      operationalInputs.forEach(input => {
        if (input) {
          input.addEventListener('input', () => this.syncStateFromInputs(true));
        }
      });

      // Inputs reativos gerais
      const reactiveInputs = [
        this.inputContractBadge, this.inputPeriodLabel, this.inputContractValue,
        this.inputMensalPeso, this.inputSemestralPeso, this.inputCorretivaPeso,
        this.inputEpiPeso,
        this.inputExcedenteQtd, this.inputExcedenteTarifa, this.inputExcedenteUnit,
        this.inputIncentivoMeta, this.inputIncentivoBase, this.inputIncentivoRec
      ];

      reactiveInputs.forEach(input => {
        if (input) {
          input.addEventListener('input', () => this.syncStateFromInputs(false));
        }
      });
    }

    /* ==========================================================================
       GESTÃO DO MODAL DE CONFIGURAÇÃO ESCALÁVEL
       ========================================================================== */
    initModalEvents() {
      this.btnOpenConfigModal.addEventListener('click', () => {
        this.renderContractsList();
        this.renderTechniciansList();
        this.configModal.classList.add('active');
      });

      const closeModal = () => {
        this.configModal.classList.remove('active');
        this.contractFormBox.classList.remove('active');
        this.techFormBox.classList.remove('active');
        this.populateContractSelect();
        this.onSectorChange();
      };

      this.btnCloseConfigModal.addEventListener('click', closeModal);
      this.btnCloseConfigModalBottom.addEventListener('click', closeModal);
      this.configModal.addEventListener('click', (e) => {
        if (e.target === this.configModal) closeModal();
      });

      this.tabBtnContracts.addEventListener('click', () => {
        this.tabBtnContracts.classList.add('active');
        this.tabBtnTechs.classList.remove('active');
        this.paneContracts.classList.add('active');
        this.paneTechs.classList.remove('active');
      });

      this.tabBtnTechs.addEventListener('click', () => {
        this.tabBtnTechs.classList.add('active');
        this.tabBtnContracts.classList.remove('active');
        this.paneTechs.classList.add('active');
        this.paneContracts.classList.remove('active');
      });

      this.btnResetConfig.addEventListener('click', () => {
        if (confirm('Deseja restaurar os contratos e técnicos padrão da Mar Brasil?')) {
          this.config = ContractStore.resetToDefault();
          this.renderContractsList();
          this.renderTechniciansList();
          alert('Configurações restauradas com sucesso!');
        }
      });

      // Formulário Contrato
      this.btnShowAddContract.addEventListener('click', () => {
        this.formContractId.value = '';
        this.formContractCode.value = '';
        this.formClientName.value = '';
        this.formClientFullName.value = '';
        this.formContractValue.value = '4250.00';
        this.formContractDesc.value = 'Avaliação objetiva da execução contratual de manutenção (PMOC e correlatos) realizada pela Mar Brasil.';
        this.populateTechSelectOptions(this.formContractTech);
        this.contractFormBox.classList.add('active');
      });

      this.btnCancelContractForm.addEventListener('click', () => {
        this.contractFormBox.classList.remove('active');
      });

      this.btnSaveContractForm.addEventListener('click', () => {
        const id = this.formContractId.value || `contract-${Date.now()}`;
        const code = this.formContractCode.value.trim();
        const clientName = this.formClientName.value.trim();
        const clientFullName = this.formClientFullName.value.trim();
        const contractValue = parseFloat(this.formContractValue.value) || 4250.0;
        const description = this.formContractDesc.value.trim();
        const technicianId = this.formContractTech.value;

        if (!code || !clientName) {
          alert('Por favor, preencha o código do contrato e o nome do órgão/cliente.');
          return;
        }

        const existingIdx = this.config.contracts.findIndex(c => c.id === id);
        if (existingIdx >= 0) {
          this.config.contracts[existingIdx].code = code;
          this.config.contracts[existingIdx].clientName = clientName;
          this.config.contracts[existingIdx].clientFullName = clientFullName;
          this.config.contracts[existingIdx].contractValue = contractValue;
          this.config.contracts[existingIdx].description = description;
          this.config.contracts[existingIdx].technicianId = technicianId;
        } else {
          this.config.contracts.push({
            id,
            code,
            clientName,
            clientFullName,
            company: 'Mar Brasil',
            description,
            contractValue,
            technicianId,
            sectors: []
          });
        }

        ContractStore.save(this.config);
        this.contractFormBox.classList.remove('active');
        this.renderContractsList();
      });

      // Formulário Técnico
      this.btnShowAddTech.addEventListener('click', () => {
        this.formTechId.value = '';
        this.formTechName.value = '';
        this.formTechPhone.value = '';
        this.formTechNotes.value = '';
        this.techFormBox.classList.add('active');
      });

      this.btnCancelTechForm.addEventListener('click', () => {
        this.techFormBox.classList.remove('active');
      });

      this.btnSaveTechForm.addEventListener('click', () => {
        const id = this.formTechId.value || `tech-${Date.now()}`;
        const name = this.formTechName.value.trim();
        const phone = this.formTechPhone.value.trim();
        const notes = this.formTechNotes.value.trim();

        if (!name) {
          alert('Por favor, informe o nome do técnico ou empresa parceira.');
          return;
        }

        const existingIdx = this.config.technicians.findIndex(t => t.id === id);
        if (existingIdx >= 0) {
          this.config.technicians[existingIdx].name = name;
          this.config.technicians[existingIdx].phone = phone;
          this.config.technicians[existingIdx].notes = notes;
        } else {
          this.config.technicians.push({ id, name, phone, notes });
        }

        ContractStore.save(this.config);
        this.techFormBox.classList.remove('active');
        this.renderTechniciansList();
      });
    }

    populateTechSelectOptions(selectEl, selectedId = '') {
      selectEl.innerHTML = '<option value="">-- Selecione o Técnico --</option>';
      this.config.technicians.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.name;
        if (t.id === selectedId) opt.selected = true;
        selectEl.appendChild(opt);
      });
    }

    renderContractsList() {
      this.contractsListContainer.innerHTML = '';

      this.config.contracts.forEach(contract => {
        const card = document.createElement('div');
        card.className = 'contract-card-item';

        let defaultTechLabel = '';
        if (contract.technicianId) {
          defaultTechLabel = ` • Técnico Geral: <strong>${ContractStore.getTechName(this.config.technicians, contract.technicianId)}</strong>`;
        }

        card.innerHTML = `
          <div class="contract-card-top">
            <div>
              <span class="contract-code-badge">${contract.code}</span>
              <span style="font-weight: 700; color: #1e293b; margin-left: 6px;">${contract.clientName}</span>
              <div class="contract-client-label">${contract.clientFullName || ''}${defaultTechLabel}</div>
              <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Valor Base: ${Formatter.currency(contract.contractValue)}</div>
            </div>
            <div class="contract-actions">
              <button type="button" class="btn-icon" data-action="edit-contract" data-id="${contract.id}" title="Editar Contrato">✏️ Editar</button>
              <button type="button" class="btn-icon danger" data-action="delete-contract" data-id="${contract.id}" title="Excluir Contrato">🗑️</button>
            </div>
          </div>
        `;

        if (contract.sectors && contract.sectors.length > 0) {
          const sectorsBox = document.createElement('div');
          sectorsBox.className = 'sectors-accordion';
          sectorsBox.innerHTML = `
            <div style="font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px;">
              Distribuição de Subsetores e Técnicos Responsáveis (${contract.sectors.length} setores):
            </div>
            <div class="sectors-grid" id="grid-${contract.id}"></div>
          `;

          const grid = sectorsBox.querySelector(`#grid-${contract.id}`);
          contract.sectors.forEach(sec => {
            const secRow = document.createElement('div');
            secRow.className = 'sector-item-row';
            secRow.innerHTML = `
              <span class="sector-name">${sec.code || sec.fullName}</span>
              <select class="sector-tech-select" data-contract-id="${contract.id}" data-sector-id="${sec.id}"></select>
            `;
            const secSelect = secRow.querySelector('select');
            this.populateTechSelectOptions(secSelect, sec.technicianId);

            secSelect.addEventListener('change', (e) => {
              sec.technicianId = e.target.value;
              ContractStore.save(this.config);
            });

            grid.appendChild(secRow);
          });

          card.appendChild(sectorsBox);
        }

        card.querySelector('[data-action="edit-contract"]').addEventListener('click', () => {
          this.formContractId.value = contract.id;
          this.formContractCode.value = contract.code;
          this.formClientName.value = contract.clientName;
          this.formClientFullName.value = contract.clientFullName || '';
          this.formContractValue.value = contract.contractValue || 4250;
          this.formContractDesc.value = contract.description || '';
          this.populateTechSelectOptions(this.formContractTech, contract.technicianId);
          this.contractFormBox.classList.add('active');
          this.contractFormBox.scrollIntoView({ behavior: 'smooth' });
        });

        card.querySelector('[data-action="delete-contract"]').addEventListener('click', () => {
          if (confirm(`Excluir o contrato ${contract.code}?`)) {
            this.config.contracts = this.config.contracts.filter(c => c.id !== contract.id);
            ContractStore.save(this.config);
            this.renderContractsList();
          }
        });

        this.contractsListContainer.appendChild(card);
      });
    }

    renderTechniciansList() {
      this.techniciansListContainer.innerHTML = '';

      const table = document.createElement('table');
      table.className = 'tech-table';
      table.innerHTML = `
        <thead>
          <tr>
            <th>Nome do Técnico / Empresa</th>
            <th>Atribuição / Setores</th>
            <th>Telefone / Contato</th>
            <th style="text-align: right;">Ações</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;

      const tbody = table.querySelector('tbody');
      this.config.technicians.forEach(tech => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${tech.name}</strong></td>
          <td style="color: #64748b; font-size: 11.5px;">${tech.notes || '—'}</td>
          <td style="color: #475569;">${tech.phone || '—'}</td>
          <td style="text-align: right;">
            <button type="button" class="btn-icon" data-action="edit-tech" data-id="${tech.id}">✏️</button>
            <button type="button" class="btn-icon danger" data-action="delete-tech" data-id="${tech.id}">🗑️</button>
          </td>
        `;

        tr.querySelector('[data-action="edit-tech"]').addEventListener('click', () => {
          this.formTechId.value = tech.id;
          this.formTechName.value = tech.name;
          this.formTechPhone.value = tech.phone || '';
          this.formTechNotes.value = tech.notes || '';
          this.techFormBox.classList.add('active');
          this.techFormBox.scrollIntoView({ behavior: 'smooth' });
        });

        tr.querySelector('[data-action="delete-tech"]').addEventListener('click', () => {
          if (confirm(`Excluir o técnico ${tech.name}?`)) {
            this.config.technicians = this.config.technicians.filter(t => t.id !== tech.id);
            ContractStore.save(this.config);
            this.renderTechniciansList();
          }
        });

        tbody.appendChild(tr);
      });

      this.techniciansListContainer.appendChild(table);
    }

    /* ==========================================================================
       POPULAÇÃO DO SELECTOR DE CONTRATOS & SETORES
       ========================================================================== */
    populateContractSelect() {
      this.contractSectorSelect.innerHTML = '';

      // 1. Consolidado Geral (todos os contratos e setores)
      const optDefault = document.createElement('option');
      optDefault.value = 'PRINT_DEFAULT';
      optDefault.textContent = '⭐ Consolidado Geral (Todos os Contratos)';
      this.contractSectorSelect.appendChild(optDefault);

      // 2. Consolidado por Contrato
      const optGroupContracts = document.createElement('optgroup');
      optGroupContracts.label = '── Consolidado por Contrato ──';
      this.config.contracts.forEach(contract => {
        const techText = contract.technicianId
          ? ` — ${ContractStore.getTechName(this.config.technicians, contract.technicianId)}`
          : contract.sectors && contract.sectors.length > 0
            ? ` — ${contract.sectors.length} Setores`
            : '';
        const opt = document.createElement('option');
        opt.value = `CONTRACT_${contract.id}`;
        opt.textContent = `${contract.code} · ${contract.clientName}${techText}`;
        optGroupContracts.appendChild(opt);
      });
      this.contractSectorSelect.appendChild(optGroupContracts);

      // 3. Setores Individuais (apenas se houver planilha carregada)
      if (this.spreadsheetData && this.spreadsheetData.rows && this.spreadsheetData.rows.length > 0) {
        const optGroupSectors = document.createElement('optgroup');
        optGroupSectors.label = '── Setores Individuais ──';
        this.spreadsheetData.rows.forEach((row, idx) => {
          const resolved = ContractStore.resolveSectorInfo(this.config, row.setor);
          const levelLabel = resolved.techLevel ? resolved.techLevel.label : 'Nível 03';
          const opt = document.createElement('option');
          opt.value = `ROW_${idx}`;
          opt.textContent = `${row.setor}  ·  ${resolved.technicianName} [${levelLabel}] (${row.equipamentosAtivos} equip.)`;
          optGroupSectors.appendChild(opt);
        });
        this.contractSectorSelect.appendChild(optGroupSectors);
      }
    }

    /** Agrega todas as linhas da planilha em um único consolidado. */
    computeGlobalTotals() {
      const zero = { equipamentosAtivos: 0, mensalPrevista: 0, mensalRealizada: 0, semestralPrevista: 0, semestralRealizada: 0, corretivasPrevista: 0, corretivasRealizada: 0 };
      if (!this.spreadsheetData || !this.spreadsheetData.rows || this.spreadsheetData.rows.length === 0) return null;
      return this.spreadsheetData.rows.reduce((acc, row) => {
        acc.equipamentosAtivos  += row.equipamentosAtivos;
        acc.mensalPrevista      += row.mensalPrevista;
        acc.mensalRealizada     += row.mensalRealizada;
        acc.semestralPrevista   += row.semestralPrevista;
        acc.semestralRealizada  += row.semestralRealizada;
        acc.corretivasPrevista  += row.corretivasPrevista;
        acc.corretivasRealizada += row.corretivasRealizada;
        return acc;
      }, { ...zero });
    }

    onSectorChange() {
      const val = this.contractSectorSelect.value;

      if (val === 'PRINT_DEFAULT') {
        this.state = JSON.parse(JSON.stringify(DEFAULT_REPORT_DATA));
        this.state.contractBadge = 'CONSOLIDADO GERAL — MAR BRASIL';
        this.state.contractTitle = 'Medição de Desempenho - Mar Brasil';
        this.state.contractSubtitle = DEFAULT_REPORT_DATA.contractSubtitle;
        this.state.periodLabel = 'VALORES - MAR BRASIL 06/2026';

        const totals = this.computeGlobalTotals();
        if (totals) {
          // Planilha carregada: usa dados reais agregados de todos os contratos
          this.state.pmocMensal.prevista      = totals.mensalPrevista;
          this.state.pmocMensal.realizada     = totals.mensalRealizada;
          this.state.pmocSemestral.prevista   = totals.semestralPrevista;
          this.state.pmocSemestral.realizada  = totals.semestralRealizada;
          this.state.corretiva.prevista       = totals.corretivasPrevista;
          this.state.corretiva.realizada      = totals.corretivasRealizada;
          this.state.technicianName           = `${this.spreadsheetData.rows.length} Setores · Todos os Contratos`;
          
          // Excedente calculado para o consolidado
          this.state.excedente.quantidade = MeasurementCalculator.computeExcedenteQty(totals.mensalRealizada, totals.semestralRealizada);

          // Incentivo calculado pela média
          const perfM = MeasurementCalculator.computePerformance(totals.mensalPrevista, totals.mensalRealizada);
          const perfS = MeasurementCalculator.computePerformance(totals.semestralPrevista, totals.semestralRealizada);
          const perfC = MeasurementCalculator.computePerformance(totals.corretivasPrevista, totals.corretivasRealizada);
          const perfE = MeasurementCalculator.computePerformance(this.state.epi.prevista, this.state.epi.realizada);
          this.state.incentivoVeicular = MeasurementCalculator.computeIncentivo(perfM, perfS, perfC, perfE, 1000.0);

          this.updateSidebarInfo('Mar Brasil', 'Todos os Contratos', 'Múltiplos Contratos', 'Consolidado Geral');
          this.syncInputsFromState();
          this.updateQuickStats({
            equipamentos: totals.equipamentosAtivos,
            mensalPrev:   totals.mensalPrevista,
            mensalReal:   totals.mensalRealizada,
            semestralPrev: totals.semestralPrevista,
            semestralReal: totals.semestralRealizada,
            corretivaPrev: totals.corretivasPrevista,
            corretivaReal: totals.corretivasRealizada
          });
        } else {
          // Sem planilha: usa dados de demonstração
          this.state.technicianName = 'Múltiplos Setores • Equipe Especializada';
          this.state.excedente.quantidade = MeasurementCalculator.computeExcedenteQty(this.state.pmocMensal.realizada, this.state.pmocSemestral.realizada);
          this.updateSidebarInfo('Mar Brasil', 'SEDUC Santos', 'Múltiplos Setores (Santos)', 'Dados de Demonstração');
          this.syncInputsFromState();
          this.updateQuickStats({ equipamentos: 402, mensalPrev: 402, mensalReal: 211, semestralPrev: 80, semestralReal: 0, corretivaPrev: 0, corretivaReal: 0 });
        }
        this.update();
        return;
      }

      if (val.startsWith('CONTRACT_')) {
        const contractId = val.replace('CONTRACT_', '');
        const contract = this.config.contracts.find(c => c.id === contractId);
        if (contract) {
          this.state.contractBadge = `CONTRATO ${contract.code}`;
          this.state.contractTitle = `Medição de Desempenho - ${contract.company || 'Mar Brasil'}`;
          this.state.contractSubtitle = contract.description;
          this.state.periodLabel = `VALORES - MAR BRASIL 06/2026`;

          // Nível representativo do contrato
          const techLevel = resolveTechLevelBySector(contract.code + ' ' + (contract.clientName || ''));
          this.state.contractValue = techLevel.value;

          let techName = contract.technicianId 
            ? ContractStore.getTechName(this.config.technicians, contract.technicianId)
            : `${contract.sectors ? contract.sectors.length : 0} Setores • Equipe Especializada`;

          this.state.technicianName = techName;

          this.updateSidebarInfo(contract.company || 'Mar Brasil', contract.clientName, techName, 'Consolidado do Contrato');

          // Busca dados agregados filtrando apenas as linhas deste contrato
          const contractNorm = contract.code.toUpperCase().replace(/[^A-Z0-9]/g, '');
          const clientNorm = (contract.clientName || '').toUpperCase();
          const contractRows = (this.spreadsheetData.rows || []).filter(row => {
            const rowNorm = row.setor.toUpperCase().replace(/[^A-Z0-9]/g, '');
            return rowNorm.includes(contractNorm) || (clientNorm && row.setor.toUpperCase().includes(clientNorm));
          });

          if (contractRows.length > 0) {
            const totals = contractRows.reduce((acc, row) => {
              acc.equipamentosAtivos  += row.equipamentosAtivos;
              acc.mensalPrevista      += row.mensalPrevista;
              acc.mensalRealizada     += row.mensalRealizada;
              acc.semestralPrevista   += row.semestralPrevista;
              acc.semestralRealizada  += row.semestralRealizada;
              acc.corretivasPrevista  += row.corretivasPrevista;
              acc.corretivasRealizada += row.corretivasRealizada;
              return acc;
            }, { equipamentosAtivos:0, mensalPrevista:0, mensalRealizada:0, semestralPrevista:0, semestralRealizada:0, corretivasPrevista:0, corretivasRealizada:0 });

            this.state.pmocMensal.prevista      = totals.mensalPrevista;
            this.state.pmocMensal.realizada     = totals.mensalRealizada;
            this.state.pmocSemestral.prevista   = totals.semestralPrevista;
            this.state.pmocSemestral.realizada  = totals.semestralRealizada;
            this.state.corretiva.prevista       = totals.corretivasPrevista;
            this.state.corretiva.realizada      = totals.corretivasRealizada;

            // Excedente calculado para o contrato
            this.state.excedente.quantidade = MeasurementCalculator.computeExcedenteQty(totals.mensalRealizada, totals.semestralRealizada);

            // Incentivo calculado pela média
            const perfM = MeasurementCalculator.computePerformance(totals.mensalPrevista, totals.mensalRealizada);
            const perfS = MeasurementCalculator.computePerformance(totals.semestralPrevista, totals.semestralRealizada);
            const perfC = MeasurementCalculator.computePerformance(totals.corretivasPrevista, totals.corretivasRealizada);
            const perfE = MeasurementCalculator.computePerformance(this.state.epi.prevista, this.state.epi.realizada);
            this.state.incentivoVeicular = MeasurementCalculator.computeIncentivo(perfM, perfS, perfC, perfE, 1000.0);

            this.updateQuickStats({
              equipamentos:  totals.equipamentosAtivos,
              mensalPrev:    totals.mensalPrevista,
              mensalReal:    totals.mensalRealizada,
              semestralPrev: totals.semestralPrevista,
              semestralReal: totals.semestralRealizada,
              corretivaPrev: totals.corretivasPrevista,
              corretivaReal: totals.corretivasRealizada
            });
          }

          this.syncInputsFromState();
          this.update();
        }
        return;
      }

      if (val.startsWith('ROW_')) {
        const idx = parseInt(val.replace('ROW_', ''), 10);
        const row = this.spreadsheetData.rows[idx];
        if (row) {
          const resolved = ContractStore.resolveSectorInfo(this.config, row.setor);

          this.state.contractBadge = resolved.contract ? `${resolved.contract.code} • ${resolved.sectorDisplayName}` : `SETOR: ${row.setor}`;
          this.state.contractTitle = `Medição de Desempenho - ${resolved.company || 'Mar Brasil'}`;
          this.state.contractSubtitle = resolved.contract ? resolved.contract.description : DEFAULT_REPORT_DATA.contractSubtitle;
          this.state.periodLabel = `VALORES - MAR BRASIL 06/2026`;
          
          // Valor do nível do técnico atribuído ao setor
          this.state.contractValue = resolved.techLevel ? resolved.techLevel.value : 4250.0;
          this.state.technicianName = resolved.technicianName;

          this.state.pmocMensal.prevista = row.mensalPrevista;
          this.state.pmocMensal.realizada = row.mensalRealizada;
          this.state.pmocSemestral.prevista = row.semestralPrevista;
          this.state.pmocSemestral.realizada = row.semestralRealizada;
          this.state.corretiva.prevista = row.corretivasPrevista;
          this.state.corretiva.realizada = row.corretivasRealizada;

          // Regra do Excedente (Ponto 05): mensal + semestral > 500
          this.state.excedente.quantidade = MeasurementCalculator.computeExcedenteQty(row.mensalRealizada, row.semestralRealizada);

          // Regra do Incentivo Veicular (Ponto 02): média das 4 produtividades
          const perfM = MeasurementCalculator.computePerformance(row.mensalPrevista, row.mensalRealizada);
          const perfS = MeasurementCalculator.computePerformance(row.semestralPrevista, row.semestralRealizada);
          const perfC = MeasurementCalculator.computePerformance(row.corretivasPrevista, row.corretivasRealizada);
          const perfE = MeasurementCalculator.computePerformance(this.state.epi.prevista, this.state.epi.realizada);
          this.state.incentivoVeicular = MeasurementCalculator.computeIncentivo(perfM, perfS, perfC, perfE, 1000.0);

          this.updateSidebarInfo(resolved.company || 'Mar Brasil', resolved.clientName, resolved.technicianName, resolved.sectorDisplayName);

          this.syncInputsFromState();
          this.updateQuickStats({
            equipamentos: row.equipamentosAtivos,
            mensalPrev: row.mensalPrevista,
            mensalReal: row.mensalRealizada,
            semestralPrev: row.semestralPrevista,
            semestralReal: row.semestralRealizada,
            corretivaPrev: row.corretivasPrevista,
            corretivaReal: row.corretivasRealizada
          });
          this.update();
        }
      }
    }

    updateSidebarInfo(company, client, tech, sector) {
      if (this.sidebarCompany) this.sidebarCompany.textContent = company;
      if (this.sidebarClient) this.sidebarClient.textContent = client;
      if (this.sidebarTech) this.sidebarTech.textContent = tech;
      if (this.sidebarSector) this.sidebarSector.textContent = sector;
    }

    async processExcelFile(file) {
      try {
        const buffer = await file.arrayBuffer();
        const parsed = await ExcelParser.parseWorkbook(buffer);

        this.spreadsheetData = parsed;
        this.fileBadge.style.display = 'inline-block';
        this.fileInfoNotice.style.display = 'block';
        this.activeFileName.textContent = `${file.name} (${parsed.rows.length} setores encontrados)`;

        this.populateContractSelect();
        this.onSectorChange();
      } catch (err) {
        alert(`Erro ao ler planilha: ${err.message}`);
        console.error(err);
      }
    }

    updateQuickStats(stats) {
      const perfMensal = stats.mensalPrev > 0 ? Math.round((stats.mensalReal / stats.mensalPrev) * 100) : 100;
      const perfSemestral = stats.semestralPrev > 0 ? Math.round((stats.semestralReal / stats.semestralPrev) * 100) : 0;
      const perfCorretiva = stats.corretivaPrev > 0 ? Math.round((stats.corretivaReal / stats.corretivaPrev) * 100) : 100;

      this.pillEquipamentos.textContent = `${stats.equipamentos} ativos`;
      this.pillMensal.textContent = `${stats.mensalReal} / ${stats.mensalPrev} (${perfMensal}%)`;
      this.pillSemestral.textContent = `${stats.semestralReal} / ${stats.semestralPrev} (${perfSemestral}%)`;
      this.pillCorretivas.textContent = `${stats.corretivaReal} / ${stats.corretivaPrev} (${perfCorretiva}%)`;
    }

    syncInputsFromState() {
      if (this.inputContractBadge) this.inputContractBadge.value = this.state.contractBadge;
      if (this.inputPeriodLabel) this.inputPeriodLabel.value = this.state.periodLabel;
      if (this.inputContractValue) this.inputContractValue.value = this.state.contractValue;

      if (this.selectTechLevel) {
        const val = Number(this.state.contractValue);
        if (Math.abs(val - 6000) < 1) this.selectTechLevel.value = 'LVL_1';
        else if (Math.abs(val - 5250) < 1) this.selectTechLevel.value = 'LVL_2';
        else if (Math.abs(val - 4250) < 1) this.selectTechLevel.value = 'LVL_3';
        else this.selectTechLevel.value = 'CUSTOM';
      }

      if (this.inputMensalPrevista) this.inputMensalPrevista.value = this.state.pmocMensal.prevista;
      if (this.inputMensalRealizada) this.inputMensalRealizada.value = this.state.pmocMensal.realizada;
      if (this.inputMensalPeso) this.inputMensalPeso.value = Math.round((this.state.pmocMensal.peso || 0.05) * 100);

      if (this.inputSemestralPrevista) this.inputSemestralPrevista.value = this.state.pmocSemestral.prevista;
      if (this.inputSemestralRealizada) this.inputSemestralRealizada.value = this.state.pmocSemestral.realizada;
      if (this.inputSemestralPeso) this.inputSemestralPeso.value = Math.round((this.state.pmocSemestral.peso || 0.50) * 100);

      if (this.inputCorretivaPrevista) this.inputCorretivaPrevista.value = this.state.corretiva.prevista;
      if (this.inputCorretivaRealizada) this.inputCorretivaRealizada.value = this.state.corretiva.realizada;
      if (this.inputCorretivaPeso) this.inputCorretivaPeso.value = Math.round((this.state.corretiva.peso || 0.40) * 100);

      if (this.inputEpiPrevista) this.inputEpiPrevista.value = this.state.epi.prevista;
      if (this.inputEpiRealizada) this.inputEpiRealizada.value = this.state.epi.realizada;
      if (this.inputEpiPeso) this.inputEpiPeso.value = Math.round((this.state.epi.peso || 0.05) * 100);

      if (this.inputExcedenteQtd) this.inputExcedenteQtd.value = this.state.excedente.quantidade;
      if (this.inputExcedenteTarifa) this.inputExcedenteTarifa.value = this.state.excedente.tarifa;
      if (this.inputExcedenteUnit) this.inputExcedenteUnit.value = this.state.excedente.unitario;

      if (this.inputIncentivoMeta) this.inputIncentivoMeta.value = Math.round(this.state.incentivoVeicular.metaPerformance * 100);
      if (this.inputIncentivoBase) this.inputIncentivoBase.value = this.state.incentivoVeicular.baseValue;
      if (this.inputIncentivoRec) this.inputIncentivoRec.value = this.state.incentivoVeicular.reconhecido;
    }

    syncStateFromInputs(autoRecomputeIncentive = false) {
      if (this.inputContractBadge) this.state.contractBadge = this.inputContractBadge.value || 'CONTRATO STS 36693/22';
      if (this.inputPeriodLabel) this.state.periodLabel = this.inputPeriodLabel.value || 'VALORES - MAR BRASIL 06/2026';
      
      const parsedVal = parseFloat(this.inputContractValue.value) || 4250.0;
      this.state.contractValue = parsedVal;

      if (this.selectTechLevel) {
        if (Math.abs(parsedVal - 6000) < 1) this.selectTechLevel.value = 'LVL_1';
        else if (Math.abs(parsedVal - 5250) < 1) this.selectTechLevel.value = 'LVL_2';
        else if (Math.abs(parsedVal - 4250) < 1) this.selectTechLevel.value = 'LVL_3';
        else this.selectTechLevel.value = 'CUSTOM';
      }

      if (this.inputMensalPrevista) this.state.pmocMensal.prevista = parseInt(this.inputMensalPrevista.value, 10) || 0;
      if (this.inputMensalRealizada) this.state.pmocMensal.realizada = parseInt(this.inputMensalRealizada.value, 10) || 0;
      if (this.inputMensalPeso) this.state.pmocMensal.peso = (parseFloat(this.inputMensalPeso.value) || 5) / 100;

      if (this.inputSemestralPrevista) this.state.pmocSemestral.prevista = parseInt(this.inputSemestralPrevista.value, 10) || 0;
      if (this.inputSemestralRealizada) this.state.pmocSemestral.realizada = parseInt(this.inputSemestralRealizada.value, 10) || 0;
      if (this.inputSemestralPeso) this.state.pmocSemestral.peso = (parseFloat(this.inputSemestralPeso.value) || 50) / 100;

      if (this.inputCorretivaPrevista) this.state.corretiva.prevista = parseInt(this.inputCorretivaPrevista.value, 10) || 0;
      if (this.inputCorretivaRealizada) this.state.corretiva.realizada = parseInt(this.inputCorretivaRealizada.value, 10) || 0;
      if (this.inputCorretivaPeso) this.state.corretiva.peso = (parseFloat(this.inputCorretivaPeso.value) || 40) / 100;

      if (this.inputEpiPrevista) this.state.epi.prevista = parseInt(this.inputEpiPrevista.value, 10) || 0;
      if (this.inputEpiRealizada) this.state.epi.realizada = parseInt(this.inputEpiRealizada.value, 10) || 0;
      if (this.inputEpiPeso) this.state.epi.peso = (parseFloat(this.inputEpiPeso.value) || 5) / 100;

      if (this.inputExcedenteQtd) this.state.excedente.quantidade = parseInt(this.inputExcedenteQtd.value, 10) || 0;
      if (this.inputExcedenteTarifa) this.state.excedente.tarifa = parseFloat(this.inputExcedenteTarifa.value) || 10.75;
      if (this.inputExcedenteUnit) this.state.excedente.unitario = parseFloat(this.inputExcedenteUnit.value) || 3.50;

      if (autoRecomputeIncentive) {
        const perfM = MeasurementCalculator.computePerformance(this.state.pmocMensal.prevista, this.state.pmocMensal.realizada);
        const perfS = MeasurementCalculator.computePerformance(this.state.pmocSemestral.prevista, this.state.pmocSemestral.realizada);
        const perfC = MeasurementCalculator.computePerformance(this.state.corretiva.prevista, this.state.corretiva.realizada);
        const perfE = MeasurementCalculator.computePerformance(this.state.epi.prevista, this.state.epi.realizada);
        const baseVal = parseFloat(this.inputIncentivoBase.value) || 1000.0;
        const inc = MeasurementCalculator.computeIncentivo(perfM, perfS, perfC, perfE, baseVal);
        this.state.incentivoVeicular = inc;
        if (this.inputIncentivoMeta) this.inputIncentivoMeta.value = Math.round(inc.metaPerformance * 100);
        if (this.inputIncentivoRec) this.inputIncentivoRec.value = inc.reconhecido;
      } else {
        if (this.inputIncentivoMeta) this.state.incentivoVeicular.metaPerformance = (parseFloat(this.inputIncentivoMeta.value) || 0) / 100;
        if (this.inputIncentivoBase) this.state.incentivoVeicular.baseValue = parseFloat(this.inputIncentivoBase.value) || 1000.0;
        if (this.inputIncentivoRec) this.state.incentivoVeicular.reconhecido = parseFloat(this.inputIncentivoRec.value) || 0;
      }

      this.updateQuickStats({
        equipamentos: this.state.pmocMensal.prevista,
        mensalPrev: this.state.pmocMensal.prevista,
        mensalReal: this.state.pmocMensal.realizada,
        semestralPrev: this.state.pmocSemestral.prevista,
        semestralReal: this.state.pmocSemestral.realizada,
        corretivaPrev: this.state.corretiva.prevista,
        corretivaReal: this.state.corretiva.realizada
      });

      this.update();
    }

    loadDefaultSample() {
      this.state = JSON.parse(JSON.stringify(DEFAULT_REPORT_DATA));
      this.contractSectorSelect.value = 'PRINT_DEFAULT';
      this.syncInputsFromState();
      this.updateSidebarInfo('Mar Brasil', 'SEDUC Santos', 'GB Climatização', 'Setor 01');
      this.updateQuickStats({
        equipamentos: 402,
        mensalPrev: 402,
        mensalReal: 211,
        semestralPrev: 80,
        semestralReal: 0,
        corretivaPrev: 0,
        corretivaReal: 0
      });
      this.update();
    }

    clearSpreadsheetData() {
      // Reseta os dados da planilha para o estado vazio
      this.spreadsheetData = { rows: [], groups: {} };

      // Oculta indicadores de arquivo
      this.fileBadge.style.display = 'none';
      this.fileInfoNotice.style.display = 'none';
      this.activeFileName.textContent = '';
      this.fileInput.value = '';

      // Volta para o Consolidado Geral e re-renderiza
      this.populateContractSelect();
      this.contractSectorSelect.value = 'PRINT_DEFAULT';
      this.onSectorChange();
    }

    update() {
      const computed = MeasurementCalculator.calculate(this.state);
      ReportRenderer.renderReport(this.reportContainer, this.state, computed);
    }
  }

  // Inicialização segura
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new MeasurementApp());
  } else {
    new MeasurementApp();
  }

})();
