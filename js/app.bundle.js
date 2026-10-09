/**
 * SISTEMA DE MEDIÇÃO DE DESEMPENHO E FATURAMENTO - MAR BRASIL
 * Versão Consolidada com Gestão de Contratos, Níveis de Técnicos, Cálculos Dinâmicos
 * e Preparação para Envio de Relatórios por WhatsApp (Evolution API / Cloudflare Worker)
 * Princípios de Clean Code: Responsabilidade Única, Funções Puras, Sem Dependências Desnecessárias.
 */

(function () {
  'use strict';

  /* ==========================================================================
     1. CONSTANTES E HELPERS DE TELEFONE, COMPETÊNCIA E FORMATAÇÃO
     ========================================================================== */
  const SENDER_PHONE = '5513991498882'; // Remetente institucional fixo (nunca pode ser destinatário)

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

  /** Normaliza qualquer formato de telefone para 55 + DDD + número (12 ou 13 dígitos) */
  function normalizePhone(phoneStr) {
    if (!phoneStr) return '';
    let cleaned = String(phoneStr).replace(/\D/g, '');
    if (!cleaned) return '';
    if (cleaned.startsWith('0')) cleaned = cleaned.substring(1);
    if ((cleaned.length === 10 || cleaned.length === 11) && !cleaned.startsWith('55')) {
      cleaned = '55' + cleaned;
    }
    return cleaned;
  }

  /** Valida número de telefone para WhatsApp com regras estritas */
  function validatePhone(phoneStr) {
    const norm = normalizePhone(phoneStr);
    if (!norm) {
      return { valid: false, error: 'Telefone não informado' };
    }
    if (norm.length !== 12 && norm.length !== 13) {
      return { valid: false, error: 'Telefone deve ter DDD + 8 ou 9 dígitos (ex: (13) 99999-9999)' };
    }
    if (!norm.startsWith('55')) {
      return { valid: false, error: 'Código de país deve ser 55 (Brasil)' };
    }
    if (norm === SENDER_PHONE) {
      return { valid: false, error: 'O telefone do técnico não pode ser igual ao número remetente (+55 13 99149-8882)' };
    }
    return { valid: true, normalized: norm };
  }

  /** Formata telefone para exibição amigável: +55 (13) 99999-9999 */
  function formatPhoneDisplay(phoneStr) {
    const norm = normalizePhone(phoneStr);
    if (!norm || norm.length < 12) return phoneStr || '—';
    const ddd = norm.substring(2, 4);
    const rest = norm.substring(4);
    if (rest.length === 9) {
      return `+55 (${ddd}) ${rest.substring(0, 5)}-${rest.substring(5)}`;
    } else if (rest.length === 8) {
      return `+55 (${ddd}) ${rest.substring(0, 4)}-${rest.substring(4)}`;
    }
    return norm;
  }

  /** Mascara telefone para exibição de segurança: +55 (13) •••••-9999 */
  function maskPhoneDisplay(phoneStr) {
    const norm = normalizePhone(phoneStr);
    if (!norm || norm.length < 12) return '—';
    const ddd = norm.substring(2, 4);
    const rest = norm.substring(4);
    const last4 = rest.slice(-4);
    return `+55 (${ddd}) •••••-${last4}`;
  }

  /** Detecta automaticamente competência (MM/AAAA) a partir do nome do arquivo */
  function detectCompetenceFromFilename(filename) {
    if (!filename) return null;
    const upper = filename.toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const months = [
      { name: 'JANEIRO', mm: '01' },
      { name: 'FEVEREIRO', mm: '02' },
      { name: 'MARCO', mm: '03' },
      { name: 'ABRIL', mm: '04' },
      { name: 'MAIO', mm: '05' },
      { name: 'JUNHO', mm: '06' },
      { name: 'JULHO', mm: '07' },
      { name: 'AGOSTO', mm: '08' },
      { name: 'SETEMBRO', mm: '09' },
      { name: 'OUTUBRO', mm: '10' },
      { name: 'NOVEMBRO', mm: '11' },
      { name: 'DEZEMBRO', mm: '12' }
    ];

    const yearMatch = upper.match(/20\d{2}/);
    const year = yearMatch ? yearMatch[0] : '2026';

    for (const m of months) {
      if (upper.includes(m.name)) {
        return `${m.mm}/${year}`;
      }
    }

    const numericMatch = upper.match(/(0[1-9]|1[0-2])[_\-\.](20\d{2})/);
    if (numericMatch) {
      return `${numericMatch[1]}/${numericMatch[2]}`;
    }

    return null;
  }

  /** Gera nome de arquivo padronizado para PDF (sem espaços, acentos ou barras) */
  function getPdfFilename(sectorCode, competence) {
    const cleanSector = String(sectorCode || 'SETOR')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

    const cleanComp = String(competence || '08/2026').replace('/', '-');
    return `Relatorio_Produtividade_${cleanSector}_${cleanComp}.pdf`;
  }

  /* ==========================================================================
     2. TABELA DE NÍVEIS DOS TÉCNICOS & REGRAS (MAR BRASIL)
     ========================================================================== */
  const TECH_LEVELS = {
    LVL_1: { id: 'LVL_1', label: 'Nível 01', value: 6000.0, description: 'STS 36693/22 - Setor 01' },
    LVL_2: { id: 'LVL_2', label: 'Nível 02', value: 5250.0, description: 'SMSU PSP 6029/25 & STS 36693/22 - Setor 04' },
    LVL_3: { id: 'LVL_3', label: 'Nível 03', value: 4250.0, description: 'CRSN PSP 6018/25 & STS 36693/22 - Setores 02, 03, 05, 06' }
  };

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
        return real > 0 ? 1.0 : 0.0;
      }
      return Math.min(1.0, Math.max(0.0, real / prev));
    }

    static computeExcedenteQty(mensalRealizada, semestralRealizada) {
      const soma = (Number(mensalRealizada) || 0) + (Number(semestralRealizada) || 0);
      return soma > 500 ? (soma - 500) : 0;
    }

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
        contractValue = 0.0,
        pmocMensal = { prevista: 0, realizada: 0, peso: 0.05 },
        pmocSemestral = { prevista: 0, realizada: 0, peso: 0.50 },
        corretiva = { prevista: 0, realizada: 0, peso: 0.40 },
        epi = { prevista: 0, realizada: 0, peso: 0.05 },
        excedente = { quantidade: 0, tarifa: 10.75, unitario: 3.50 },
        incentivoVeicular = { metaPerformance: 0.0, baseValue: 1000.0, reconhecido: 0 }
      } = params;

      const perfMensal = this.computePerformance(pmocMensal.prevista, pmocMensal.realizada);
      const perfSemestral = this.computePerformance(pmocSemestral.prevista, pmocSemestral.realizada);
      const perfCorretiva = this.computePerformance(corretiva.prevista, corretiva.realizada);
      const perfEPI = this.computePerformance(epi.prevista, epi.realizada);

      const baseMensal = contractValue * (Number(pmocMensal.peso) || 0.05);
      const baseSemestral = contractValue * (Number(pmocSemestral.peso) || 0.50);
      const baseCorretiva = contractValue * (Number(corretiva.peso) || 0.40);
      const baseEPI = contractValue * (Number(epi.peso) || 0.05);

      const recMensal = baseMensal * perfMensal;
      const recSemestral = baseSemestral * perfSemestral;
      const recCorretiva = baseCorretiva * perfCorretiva;
      const recEPI = baseEPI * perfEPI;

      const qtdExcedente = Number(excedente.quantidade) || 0;
      const unitExcedente = Number(excedente.unitario) || 0;
      const recExcedente = qtdExcedente * unitExcedente;

      const subtotal = recMensal + recSemestral + recCorretiva + recEPI + recExcedente;
      const recIncentivo = Number(incentivoVeicular.reconhecido) || 0;
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
              valorBase: Formatter.currency(baseMensal, true),
              valorReconhecido: Formatter.currency(recMensal, true)
            },
            {
              item: 'PMOC SEMESTRAL',
              performance: Formatter.percentage(perfSemestral),
              peso: Formatter.percentage(pmocSemestral.peso),
              valorBase: Formatter.currency(baseSemestral, true),
              valorReconhecido: Formatter.currency(recSemestral, true)
            },
            {
              item: 'CORRETIVA',
              performance: Formatter.percentage(perfCorretiva),
              peso: Formatter.percentage(corretiva.peso),
              valorBase: Formatter.currency(baseCorretiva, true),
              valorReconhecido: Formatter.currency(recCorretiva, true)
            },
            {
              item: 'EPI',
              performance: Formatter.percentage(perfEPI),
              peso: Formatter.percentage(epi.peso),
              valorBase: Formatter.currency(baseEPI, true),
              valorReconhecido: Formatter.currency(recEPI, true)
            },
            {
              item: 'EXCEDENTE',
              performance: `${qtdExcedente}`,
              peso: Formatter.currency(excedente.tarifa),
              valorBase: Formatter.currency(unitExcedente),
              valorReconhecido: Formatter.currency(recExcedente, true)
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
  function sanitizeMojibake(obj) {
    if (typeof obj === 'string') {
      return obj
        .replace(/\u00C3\u00A7/g, 'ç').replace(/\u00C3\u0087/g, 'Ç')
        .replace(/\u00C3\u00A3/g, 'ã').replace(/\u00C3\u0083/g, 'Ã')
        .replace(/\u00C3\u00A9/g, 'é').replace(/\u00C3\u0089/g, 'É')
        .replace(/\u00C3\u00AA/g, 'ê').replace(/\u00C3\u008A/g, 'Ê')
        .replace(/\u00C3\u00AD/g, 'í').replace(/\u00C3\u008D/g, 'Í')
        .replace(/\u00C3\u00B3/g, 'ó').replace(/\u00C3\u0093/g, 'Ó')
        .replace(/\u00C3\u00B4/g, 'ô').replace(/\u00C3\u0094/g, 'Ô')
        .replace(/\u00C3\u00BA/g, 'ú').replace(/\u00C3\u009A/g, 'Ú')
        .replace(/\u00C3\u00A1/g, 'á').replace(/\u00C3\u0081/g, 'Á')
        .replace(/\u00C3\u00A0/g, 'à').replace(/\u00C3\u0080/g, 'À')
        .replace(/\u00E2\u0080\u0094/g, '—').replace(/\u00E2\u0080\u0093/g, '–')
        .replace(/\u00E2\u0080\u00A2/g, '•').replace(/\u00C2\u00B7/g, '·')
        .replace(/\u00E2\u009C\u0085/g, '✅').replace(/\u00E2\u009A\u00A1/g, '⚡')
        .replace(/\u00E2\u008C\u0080/g, '❌').replace(/\u00E2\u008F\u00B3/g, '⏳')
        .replace(/\u00E2\u009A\u00A0/g, '⚠️');
    }
    if (Array.isArray(obj)) return obj.map(sanitizeMojibake);
    if (obj && typeof obj === 'object') {
      const res = {};
      for (const k of Object.keys(obj)) res[k] = sanitizeMojibake(obj[k]);
      return res;
    }
    return obj;
  }
  const STORAGE_KEY = 'MAR_BRASIL_PMOC_CONFIG_V3';

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
        let stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) {
          // Migra da V2 se existir
          const v2 = localStorage.getItem('MAR_BRASIL_PMOC_CONFIG_V2');
          if (v2) stored = v2;
        }
        if (stored) {
          let parsed = JSON.parse(stored);
          if (parsed && Array.isArray(parsed.contracts) && Array.isArray(parsed.technicians)) {
            parsed = sanitizeMojibake(parsed);
            this.save(parsed);
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

    static getTechnician(technicians, techId) {
      if (!techId) return null;
      return technicians.find(t => t.id === techId) || null;
    }

    /**
     * Resolve dados do setor e devolve o técnico COMPLETO (com objeto technician e id),
     * preservando technicianName e todos os campos anteriores.
     */
    static resolveSectorInfo(config, setorStr) {
      if (!setorStr) {
        return {
          company: config.company || 'Mar Brasil',
          contract: null,
          sector: null,
          clientName: '—',
          clientFullName: 'Aguardando seleção de contrato',
          technicianId: null,
          technician: null,
          technicianName: '—',
          sectorDisplayName: '—',
          techLevel: TECH_LEVELS.LVL_3,
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
              const techId = sec.technicianId || contract.technicianId;
              const techObj = this.getTechnician(config.technicians, techId);
              const techName = techObj ? techObj.name : 'Não Definido';

              return {
                company: contract.company || config.company || 'Mar Brasil',
                contract,
                sector: sec,
                clientName: contract.clientName,
                clientFullName: contract.clientFullName,
                technicianId: techId,
                technician: techObj,
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
          let mainTech = null;
          if (contract.technicianId) {
            mainTech = this.getTechnician(config.technicians, contract.technicianId);
            techSummary = mainTech ? mainTech.name : 'Equipe Técnica Especializada';
          } else if (contract.sectors && contract.sectors.length > 0) {
            techSummary = `${contract.sectors.length} Setores • Múltiplos Técnicos`;
          }

          return {
            company: contract.company || config.company || 'Mar Brasil',
            contract,
            sector: null,
            clientName: contract.clientName,
            clientFullName: contract.clientFullName,
            technicianId: contract.technicianId || null,
            technician: mainTech,
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
        technicianId: null,
        technician: null,
        technicianName: 'Técnico Responsável',
        sectorDisplayName: setorStr,
        techLevel: detectedLevel,
        isConsolidated: false
      };
    }
  }

  /* ==========================================================================
     5. DADOS DE DEMONSTRAÇÃO E ESTADO ZERADO (MAR BRASIL)
     ========================================================================== */
  const EMPTY_REPORT_DATA = {
    contractBadge: 'MAR BRASIL — SISTEMA LIMPO',
    contractTitle: 'Medição de Desempenho - Mar Brasil',
    contractSubtitle: 'Sistema limpo. Faça o upload de uma nova planilha de medição ou selecione um contrato para emitir o relatório.',
    periodLabel: 'VALORES - MAR BRASIL 08/2026',
    company: 'Mar Brasil',
    clientName: '—',
    clientFullName: 'Aguardando importação de planilha ou seleção de contrato',
    technicianName: '—',
    contractValue: 0.0,
    pmocMensal: { prevista: 0, realizada: 0, peso: 0.05 },
    pmocSemestral: { prevista: 0, realizada: 0, peso: 0.50 },
    corretiva: { prevista: 0, realizada: 0, peso: 0.40 },
    epi: { prevista: 0, realizada: 0, peso: 0.05 },
    excedente: { quantidade: 0, tarifa: 10.75, unitario: 3.50 },
    incentivoVeicular: { metaPerformance: 0.0, baseValue: 1000.0, reconhecido: 0.0 }
  };

  const DEFAULT_REPORT_DATA = {
    contractBadge: 'AGUARDANDO DADOS',
    contractTitle: 'Medição de Desempenho - Mar Brasil',
    contractSubtitle: 'Carregue uma planilha ou sincronize com o Auvo para visualizar os dados de desempenho.',
    periodLabel: 'VALORES - MAR BRASIL',
    company: 'Mar Brasil',
    clientName: '',
    clientFullName: '',
    technicianName: 'Técnico Responsável',
    contractValue: 0,
    pmocMensal: { prevista: 0, realizada: 0, peso: 0.05 },
    pmocSemestral: { prevista: 0, realizada: 0, peso: 0.50 },
    corretiva: { prevista: 0, realizada: 0, peso: 0.40 },
    epi: { prevista: 0, realizada: 0, peso: 0.05 },
    excedente: { quantidade: 0, tarifa: 10.75, unitario: 3.50 },
    incentivoVeicular: { metaPerformance: 0, baseValue: 1000.0, reconhecido: 0.0 }
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
        else if (/epi.*prev/.test(norm)) map.epiPrevista = index;
        else if (/epi.*(real|entreg)/.test(norm)) map.epiRealizada = index;
      });
      return map;
    }

    static resolveColumnMap(headers) {
      const byName = this.mapHeadersByName(headers);
      const required = ['setor', 'mensalPrevista', 'mensalRealizada', 'semestralPrevista', 'semestralRealizada'];
      const isComplete = required.every(k => byName[k] !== undefined);
      return isComplete ? byName : { ...this.POSITIONAL_MAP, ...byName };
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

        const hasEpiPrev = columnMap.epiPrevista !== undefined && row[columnMap.epiPrevista] !== '';
        const hasEpiReal = columnMap.epiRealizada !== undefined && row[columnMap.epiRealizada] !== '';

        rows.push({
          id: `row-${r}`,
          setor,
          equipamentosAtivos:  this.parseNumber(row[columnMap.equipamentosAtivos]),
          mensalPrevista:      this.parseNumber(row[columnMap.mensalPrevista]),
          mensalRealizada:     this.parseNumber(row[columnMap.mensalRealizada]),
          semestralPrevista:   this.parseNumber(row[columnMap.semestralPrevista]),
          semestralRealizada:  this.parseNumber(row[columnMap.semestralRealizada]),
          corretivasPrevista:  this.parseNumber(row[columnMap.corretivasPrevista]),
          corretivasRealizada: this.parseNumber(row[columnMap.corretivasRealizada]),
          epiPrevista:         hasEpiPrev ? this.parseNumber(row[columnMap.epiPrevista]) : null,
          epiRealizada:        hasEpiReal ? this.parseNumber(row[columnMap.epiRealizada]) : null,
          epiFromSpreadsheet:  hasEpiPrev || hasEpiReal
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
      const circumference = 2 * Math.PI * radius;
      const clampedPct = Math.min(100, Math.max(0, percentage));
      const offset = circumference * (1 - clampedPct / 100);

      const svgRaw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160">
        <circle cx="80" cy="80" r="${radius}" stroke="#ffedd5" fill="none" stroke-width="18" />
        <circle cx="80" cy="80" r="${radius}" stroke="#f97316" fill="none" stroke-width="18" stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 80 80)" stroke-linecap="butt" />
        <text x="80" y="90" font-family="Inter, sans-serif" font-weight="800" font-size="34px" fill="#0f172a" text-anchor="middle">${clampedPct}%</text>
      </svg>`;
      const svgBase64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgRaw)));

      return `
        <div class="gauge-card">
          <div class="gauge-svg-container">
            <img src="${svgBase64}" style="width: 100%; height: 100%; display: block;" />
          </div>
          <div class="gauge-info">
            <h3 class="gauge-title">${title}</h3>
            <p class="gauge-subtitle">${desc}</p>
          </div>
        </div>
      `;
    }

    static renderCubeLogo() {
      const svgRaw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
        <polygon points="50,12 85,32 50,52 15,32" fill="#f59e0b" />
        <polygon points="50,22 75,36 50,50 25,36" fill="#fbbf24" />
        <polygon points="15,32 50,52 50,90 15,70" fill="#ea580c" />
        <polygon points="25,40 45,52 45,82 25,65" fill="#f97316" />
        <polygon points="50,52 85,32 85,70 50,90" fill="#c2410c" />
        <polygon points="55,52 75,40 75,65 55,82" fill="#ea580c" />
        <polygon points="50,42 64,50 50,58 36,50" fill="#fef3c7" opacity="0.9" />
      </svg>`;
      const svgBase64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgRaw)));
      return `<img src="${svgBase64}" class="brand-cube-logo" style="width: 100%; height: 100%; display: block;" />`;
    }

    static renderReport(container, data, computed) {
      if (!container) return;
      const { gauges, table } = computed;

      const techBadgeHtml = data.technicianName && data.technicianName !== '—' ? `
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
                <span class="contract-badge">${data.contractBadge || 'MAR BRASIL'}</span>
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
              <span class="financial-label">${data.periodLabel || 'VALORES - MAR BRASIL 08/2026'}</span>
              <span class="financial-total-base" title="Valor base do nível do técnico">${Formatter.currency(data.contractValue || 0, false)}</span>
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
      this.waConfig = this.loadWaConfig();
      this.waHistory = this.loadWaHistory();
      const _now = new Date();
      const _mes = String(_now.getMonth() + 1).padStart(2, '0');
      const _ano = _now.getFullYear();
      this.competence = `${_mes}/${_ano}`; // Competência = mês atual
      this.sectorEpiMap = {};     // Mapeamento de EPI por setor { [setor]: { prevista, realizada, peso, isCustom } }
      this.state = JSON.parse(JSON.stringify(DEFAULT_REPORT_DATA));
      
      // Iniciar com estado vazio - aguardando planilha ou sincronização Auvo
      this.spreadsheetData = {
        rows: [],
        groups: {}
      };

      this.initElements();
      this.initEvents();
      this.initModalEvents();
      this.initWhatsAppEvents();
      this.populateContractSelect();
      this.onSectorChange();

      // Iniciar com badge oculto
      if (this.fileBadge) this.fileBadge.style.display = 'none';
      if (this.fileInfoNotice) this.fileInfoNotice.style.display = 'none';
    }

    initElements() {
      this.reportContainer = document.getElementById('reportContainer');
      
      // Botões Navbar
      this.btnOpenConfigModal = document.getElementById('btnOpenConfigModal');
      this.btnOpenTechsModalDirect = document.getElementById('btnOpenTechsModalDirect');
      this.btnDownloadTemplate = document.getElementById('btnDownloadTemplate');
      this.btnLoadSample = document.getElementById('btnLoadSample');
      this.btnPrint = document.getElementById('btnPrint');
      this.btnQuickPrint = document.getElementById('btnQuickPrint');
      this.btnDownloadPdf = document.getElementById('btnDownloadPdf');
      this.btnClearData = document.getElementById('btnClearData');
      this.btnSyncAuvo = document.getElementById('btnSyncAuvo');

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
      this.inputCompetence = document.getElementById('inputCompetence');
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
      this.epiSectorBadge = document.getElementById('epiSectorBadge');

      this.inputExcedenteQtd = document.getElementById('inputExcedenteQtd');
      this.inputExcedenteTarifa = document.getElementById('inputExcedenteTarifa');
      this.inputExcedenteUnit = document.getElementById('inputExcedenteUnit');

      this.inputIncentivoMeta = document.getElementById('inputIncentivoMeta');
      this.inputIncentivoBase = document.getElementById('inputIncentivoBase');
      this.inputIncentivoRec = document.getElementById('inputIncentivoRec');

      // Elementos do Modal de Contratos & Técnicos
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

      // Elementos WhatsApp - Navbar e Toolbar
      this.btnOpenWhatsAppModal = document.getElementById('btnOpenWhatsAppModal');
      this.btnOpenWhatsAppConfigDirect = document.getElementById('btnOpenWhatsAppConfigDirect');
      this.btnSendCurrentSector = document.getElementById('btnSendCurrentSector');
      
      // Modais WhatsApp
      this.whatsAppModal = document.getElementById('whatsAppModal');
      this.whatsAppConfirmModal = document.getElementById('whatsAppConfirmModal');
      this.whatsAppConfigModal = document.getElementById('whatsAppConfigModal');
      
      // Elementos UI WhatsApp Modal 2 (Principal)
      this.waCompetenceBadge = document.getElementById('waCompetenceBadge');
      this.btnOpenWhatsAppConfig = document.getElementById('btnOpenWhatsAppConfig');
      this.btnCloseWhatsAppModal = document.getElementById('btnCloseWhatsAppModal');
      this.btnCloseWhatsAppModalBottom = document.getElementById('btnCloseWhatsAppModalBottom');
      this.chkTestMode = document.getElementById('chkTestMode');
      this.testModeInputs = document.getElementById('testModeInputs');
      this.inputTestPhone = document.getElementById('inputTestPhone');
      
      this.btnSelectAllValid = document.getElementById('btnSelectAllValid');
      this.btnDeselectAll = document.getElementById('btnDeselectAll');
      this.chkSelectAllHeader = document.getElementById('chkSelectAllHeader');
      this.waTableBody = document.getElementById('waTableBody');
      
      this.waProgressContainer = document.getElementById('waProgressContainer');
      this.waProgressBar = document.getElementById('waProgressBar');
      this.waProgressPercent = document.getElementById('waProgressPercent');
      this.waProgressLabel = document.getElementById('waProgressLabel');
      this.waLogBox = document.getElementById('waLogBox');
      
      this.btnRetryFailed = document.getElementById('btnRetryFailed');
      this.retryFailedCount = document.getElementById('retryFailedCount');
      this.waSelectedCountText = document.getElementById('waSelectedCountText');
      this.btnStartBatchSend = document.getElementById('btnStartBatchSend');
      
      // Elementos UI WhatsApp Confirm Modal 3
      this.btnCloseWhatsAppConfirm = document.getElementById('btnCloseWhatsAppConfirm');
      this.waConfirmTestAlert = document.getElementById('waConfirmTestAlert');
      this.waConfirmTestTarget = document.getElementById('waConfirmTestTarget');
      this.waConfirmItemCount = document.getElementById('waConfirmItemCount');
      this.waConfirmList = document.getElementById('waConfirmList');
      this.waEstimatedTime = document.getElementById('waEstimatedTime');
      this.btnCancelWhatsAppConfirm = document.getElementById('btnCancelWhatsAppConfirm');
      this.btnExecuteWhatsAppSend = document.getElementById('btnExecuteWhatsAppSend');

      // Elementos UI WhatsApp Config Modal 4
      this.btnCloseWhatsAppConfig = document.getElementById('btnCloseWhatsAppConfig');
      this.inputWorkerUrl = document.getElementById('inputWorkerUrl');
      this.inputWorkerToken = document.getElementById('inputWorkerToken');
      this.inputCaptionTemplate = document.getElementById('inputCaptionTemplate');
      this.btnTestWorkerConnection = document.getElementById('btnTestWorkerConnection');
      this.workerStatusBadge = document.getElementById('workerStatusBadge');
      this.btnCancelWhatsAppConfig = document.getElementById('btnCancelWhatsAppConfig');
      this.btnSaveWhatsAppConfig = document.getElementById('btnSaveWhatsAppConfig');
      this.btnRestoreDefaultWaConfig = document.getElementById('btnRestoreDefaultWaConfig');
    }

    initEvents() {
      if (this.btnOpenTechsModalDirect) {
        this.btnOpenTechsModalDirect.addEventListener('click', () => {
          if (this.configModal) {
            this.renderTechniciansList();
            this.configModal.classList.add('active');
            if (this.tabBtnTechs) this.tabBtnTechs.click();
          }
        });
      }
      this.btnClearData.addEventListener('click', () => this.clearSpreadsheetData());
      if (this.btnSyncAuvo) this.btnSyncAuvo.addEventListener('click', () => this.syncAuvoData());
      
      this.btnPrint.addEventListener('click', () => window.print());
      this.btnQuickPrint.addEventListener('click', () => window.print());



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

      // Alteração na Competência (MM/AAAA)
      if (this.inputCompetence) {
        this.inputCompetence.addEventListener('input', () => {
          this.competence = this.inputCompetence.value.trim() || '08/2026';
          if (this.inputPeriodLabel) {
            this.inputPeriodLabel.value = `VALORES - MAR BRASIL ${this.competence}`;
          }
          this.syncStateFromInputs(false);
        });
      }

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
          input.addEventListener('input', () => {
            // Se o usuário mexer no EPI, salvar no mapa do setor atual
            if ((input === this.inputEpiPrevista || input === this.inputEpiRealizada) && this.state.sectorCode) {
              this.sectorEpiMap[this.state.sectorCode] = {
                prevista: parseInt(this.inputEpiPrevista.value, 10) || 0,
                realizada: parseInt(this.inputEpiRealizada.value, 10) || 0,
                peso: (parseFloat(this.inputEpiPeso.value) || 5) / 100,
                isCustom: true
              };
              if (this.epiSectorBadge) {
                this.epiSectorBadge.textContent = ' (personalizado)';
                this.epiSectorBadge.style.color = '#0284c7';
              }
            }
            this.syncStateFromInputs(true);
          });
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

      // Formulário Técnico com Validação e Normalização de Telefone
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
        const rawPhone = this.formTechPhone.value.trim();
        const notes = this.formTechNotes.value.trim();

        if (!name) {
          alert('Por favor, informe o nome do técnico ou empresa parceira.');
          return;
        }

        let normalizedPhone = '';
        if (rawPhone) {
          const valResult = validatePhone(rawPhone);
          if (!valResult.valid) {
            alert(`Telefone inválido: ${valResult.error}`);
            return;
          }
          normalizedPhone = valResult.normalized;
        }

        const existingIdx = this.config.technicians.findIndex(t => t.id === id);
        if (existingIdx >= 0) {
          this.config.technicians[existingIdx].name = name;
          this.config.technicians[existingIdx].phone = normalizedPhone;
          this.config.technicians[existingIdx].notes = notes;
        } else {
          this.config.technicians.push({ id, name, phone: normalizedPhone, notes });
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
        const phoneFormatted = t.phone ? ` (${formatPhoneDisplay(t.phone)})` : '';
        opt.textContent = `${t.name}${phoneFormatted}`;
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
            <th>Telefone WhatsApp</th>
            <th style="text-align: right;">Ações</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;

      const tbody = table.querySelector('tbody');
      this.config.technicians.forEach(tech => {
        const tr = document.createElement('tr');
        const phoneFormatted = formatPhoneDisplay(tech.phone);
        const phoneBadge = tech.phone 
          ? `<span style="font-family: monospace; color: #16a34a; font-weight: 600;">📱 ${phoneFormatted}</span>`
          : `<span style="color: #94a3b8; font-style: italic;">Sem WhatsApp</span>`;

        tr.innerHTML = `
          <td><strong>${tech.name}</strong></td>
          <td style="color: #64748b; font-size: 11.5px;">${tech.notes || '—'}</td>
          <td>${phoneBadge}</td>
          <td style="text-align: right;">
            <button type="button" class="btn-icon" data-action="edit-tech" data-id="${tech.id}">✏️</button>
            <button type="button" class="btn-icon danger" data-action="delete-tech" data-id="${tech.id}">🗑️</button>
          </td>
        `;

        tr.querySelector('[data-action="edit-tech"]').addEventListener('click', () => {
          this.formTechId.value = tech.id;
          this.formTechName.value = tech.name;
          this.formTechPhone.value = tech.phone ? formatPhoneDisplay(tech.phone) : '';
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

      const hasSpreadsheet = this.spreadsheetData && this.spreadsheetData.rows && this.spreadsheetData.rows.length > 0;

      if (!hasSpreadsheet) {
        const optCleared = document.createElement('option');
        optCleared.value = 'CLEARED';
        optCleared.textContent = '⚪ Sistema Limpo (Aguardando Planilha)';
        this.contractSectorSelect.appendChild(optCleared);
      } else {
        const optDefault = document.createElement('option');
        optDefault.value = 'PRINT_DEFAULT';
        optDefault.textContent = '⭐ Consolidado Geral (Todos os Contratos)';
        this.contractSectorSelect.appendChild(optDefault);
      }

      const optGroupContracts = document.createElement('optgroup');
      optGroupContracts.label = '── Contratos Cadastrados ──';
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

      if (hasSpreadsheet) {
        const optGroupSectors = document.createElement('optgroup');
        optGroupSectors.label = '── Setores Individuais da Planilha ──';
        this.spreadsheetData.rows.forEach((row, idx) => {
          const opt = document.createElement('option');
          opt.value = `ROW_${idx}`;
          if (row.isAuvo) {
            opt.textContent = `${row.setor}  ·  ${row.techName || 'Sem Técnico'} (${row.equipamentosAtivos} equip.)`;
          } else {
            const resolved = ContractStore.resolveSectorInfo(this.config, row.setor);
            const levelLabel = resolved.techLevel ? resolved.techLevel.label : 'Nível 03';
            opt.textContent = `${row.setor}  ·  ${resolved.technicianName} [${levelLabel}] (${row.equipamentosAtivos} equip.)`;
          }
          optGroupSectors.appendChild(opt);
        });
        this.contractSectorSelect.appendChild(optGroupSectors);
      }
    }

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

    /**
     * FUNÇÃO PURA (Seção 5):
     * Constrói o estado completo de um setor individual sem mexer no DOM.
     * Retorna o mesmo objeto `state` utilizado pela renderização.
     */
    buildStateForRow(row, overrides = {}) {
      const resolved = ContractStore.resolveSectorInfo(this.config, row.setor);
      const comp = overrides.competence || this.competence || '08/2026';

      // Resolução de EPI: overrides > mapa específico do setor > planilha > padrão
      const defaultEpi = { prevista: 22, realizada: 9, peso: 0.05, isDefault: true };
      let sectorEpi = defaultEpi;

      if (overrides.epi) {
        sectorEpi = { ...overrides.epi, isCustom: true };
      } else if (this.sectorEpiMap && this.sectorEpiMap[row.setor]) {
        sectorEpi = { ...this.sectorEpiMap[row.setor], isCustom: true };
      } else if (row.epiFromSpreadsheet && row.epiPrevista !== null) {
        sectorEpi = {
          prevista: row.epiPrevista,
          realizada: row.epiRealizada || 0,
          peso: 0.05,
          isSpreadsheet: true
        };
      }

      const pmocMensal = {
        prevista: overrides.mensalPrevista !== undefined ? overrides.mensalPrevista : row.mensalPrevista,
        realizada: overrides.mensalRealizada !== undefined ? overrides.mensalRealizada : row.mensalRealizada,
        peso: overrides.mensalPeso !== undefined ? overrides.mensalPeso : 0.05
      };

      const pmocSemestral = {
        prevista: overrides.semestralPrevista !== undefined ? overrides.semestralPrevista : row.semestralPrevista,
        realizada: overrides.semestralRealizada !== undefined ? overrides.semestralRealizada : row.semestralRealizada,
        peso: overrides.semestralPeso !== undefined ? overrides.semestralPeso : 0.50
      };

      const corretiva = {
        prevista: overrides.corretivaPrevista !== undefined ? overrides.corretivaPrevista : row.corretivasPrevista,
        realizada: overrides.corretivaRealizada !== undefined ? overrides.corretivaRealizada : row.corretivasRealizada,
        peso: overrides.corretivaPeso !== undefined ? overrides.corretivaPeso : 0.40
      };

      const epi = {
        prevista: sectorEpi.prevista !== undefined ? sectorEpi.prevista : 22,
        realizada: sectorEpi.realizada !== undefined ? sectorEpi.realizada : 9,
        peso: sectorEpi.peso !== undefined ? sectorEpi.peso : 0.05,
        isDefault: !!sectorEpi.isDefault,
        isCustom: !!sectorEpi.isCustom,
        isSpreadsheet: !!sectorEpi.isSpreadsheet
      };

      const qtdExcedente = overrides.excedenteQtd !== undefined
        ? overrides.excedenteQtd
        : MeasurementCalculator.computeExcedenteQty(pmocMensal.realizada, pmocSemestral.realizada);

      const excedente = {
        quantidade: qtdExcedente,
        tarifa: overrides.excedenteTarifa !== undefined ? overrides.excedenteTarifa : 10.75,
        unitario: overrides.excedenteUnit !== undefined ? overrides.excedenteUnit : 3.50
      };

      const perfM = MeasurementCalculator.computePerformance(pmocMensal.prevista, pmocMensal.realizada);
      const perfS = MeasurementCalculator.computePerformance(pmocSemestral.prevista, pmocSemestral.realizada);
      const perfC = MeasurementCalculator.computePerformance(corretiva.prevista, corretiva.realizada);
      const perfE = MeasurementCalculator.computePerformance(epi.prevista, epi.realizada);

      const incentivoVeicular = overrides.incentivoVeicular
        ? overrides.incentivoVeicular
        : MeasurementCalculator.computeIncentivo(perfM, perfS, perfC, perfE, 1000.0);

      const contractValue = overrides.contractValue !== undefined
        ? overrides.contractValue
        : (resolved.techLevel ? resolved.techLevel.value : 4250.0);

      // Auvo-specific row (each represents a technician/sector)
      if (row.isAuvo) {
        return {
          contractBadge: `TÉCNICO: ${row.techName ? row.techName.toUpperCase() : 'SEM TÉCNICO'}`,
          contractTitle: `Relatório de Produtividade Individual`,
          contractSubtitle: `Período: ${comp} (Sincronizado via Auvo API)`,
          periodLabel: `PRODUTIVIDADE - ${row.techName ? row.techName.toUpperCase() : 'SEM TÉCNICO'} - ${comp}`,
          company: 'Integração Auvo Dashboard',
          clientName: 'Atribuição Direta',
          clientFullName: '',
          technicianId: row.techId,
          technician: null,
          technicianName: row.techName || 'Sem Técnico',
          sectorDisplayName: row.setor,
          sectorCode: row.setor,
          contractValue: 0,
          pmocMensal: {
            prevista: row.mensalPrevista || 0,
            realizada: row.mensalRealizada || 0,
            peso: 0.05
          },
          pmocSemestral: {
            prevista: row.semestralPrevista || 0,
            realizada: row.semestralRealizada || 0,
            peso: 0.50
          },
          corretiva: {
            prevista: row.corretivasPrevista || 0,
            realizada: row.corretivasRealizada || 0,
            peso: 0.40
          },
          epi: { prevista: 22, realizada: 22, peso: 0.05, isDefault: true },
          excedente: { quantidade: 0, tarifa: 10.75, unitario: 3.50 },
          incentivoVeicular: 0,
          isAuvo: true
        };
      }

      // Default handling (non‑Auvo rows)
      return {
        contractBadge: overrides.contractBadge || (resolved.contract ? `${resolved.contract.code} • ${resolved.sectorDisplayName}` : `SETOR: ${row.setor}`),
        contractTitle: overrides.contractTitle || `Medição de Desempenho - ${resolved.company || 'Mar Brasil'}`,
        contractSubtitle: overrides.contractSubtitle || (resolved.contract ? resolved.contract.description : DEFAULT_REPORT_DATA.contractSubtitle),
        periodLabel: overrides.periodLabel || `VALORES - MAR BRASIL ${comp}`,
        company: resolved.company || 'Mar Brasil',
        clientName: resolved.clientName,
        clientFullName: resolved.clientFullName,
        technicianId: resolved.technicianId,
        technician: resolved.technician,
        technicianName: resolved.technicianName,
        sectorDisplayName: resolved.sectorDisplayName,
        sectorCode: row.setor,
        contractValue,
        pmocMensal,
        pmocSemestral,
        corretiva,
        epi,
        excedente,
        incentivoVeicular
      };
    }

    onSectorChange() {
      const val = this.contractSectorSelect.value;

      if (val === 'CLEARED') {
        this.state = JSON.parse(JSON.stringify(EMPTY_REPORT_DATA));
        this.state.periodLabel = `VALORES - MAR BRASIL ${this.competence}`;
        this.updateSidebarInfo('Mar Brasil', '—', '—', 'Sistema Limpo');
        this.syncInputsFromState();
        this.updateQuickStats({ equipamentos: 0, mensalPrev: 0, mensalReal: 0, semestralPrev: 0, semestralReal: 0, corretivaPrev: 0, corretivaReal: 0 });
        this.update();
        return;
      }

      if (this.btnSendCurrentSector) this.btnSendCurrentSector.style.display = 'none';
      if (val === 'PRINT_DEFAULT') {
        const totals = this.computeGlobalTotals();
        if (totals) {
          this.state = JSON.parse(JSON.stringify(DEFAULT_REPORT_DATA));
          this.state.contractBadge = 'CONSOLIDADO GERAL — MAR BRASIL';
          this.state.contractTitle = 'Medição de Desempenho - Mar Brasil';
          this.state.contractSubtitle = DEFAULT_REPORT_DATA.contractSubtitle;
          this.state.periodLabel = `VALORES - MAR BRASIL ${this.competence}`;

          this.state.pmocMensal.prevista      = totals.mensalPrevista;
          this.state.pmocMensal.realizada     = totals.mensalRealizada;
          this.state.pmocSemestral.prevista   = totals.semestralPrevista;
          this.state.pmocSemestral.realizada  = totals.semestralRealizada;
          this.state.corretiva.prevista       = totals.corretivasPrevista;
          this.state.corretiva.realizada      = totals.corretivasRealizada;
          this.state.technicianName           = `${this.spreadsheetData.rows.length} Setores · Todos os Contratos`;
          this.state.contractValue            = 6000.0;
          this.state.sectorCode               = 'CONSOLIDADO_GERAL';
          
          this.state.excedente.quantidade = MeasurementCalculator.computeExcedenteQty(totals.mensalRealizada, totals.semestralRealizada);

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
          this.state = JSON.parse(JSON.stringify(EMPTY_REPORT_DATA));
          this.state.periodLabel = `VALORES - MAR BRASIL ${this.competence}`;
          this.updateSidebarInfo('Mar Brasil', '—', '—', 'Sistema Limpo');
          this.syncInputsFromState();
          this.updateQuickStats({ equipamentos: 0, mensalPrev: 0, mensalReal: 0, semestralPrev: 0, semestralReal: 0, corretivaPrev: 0, corretivaReal: 0 });
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
          this.state.periodLabel = `VALORES - MAR BRASIL ${this.competence}`;
          this.state.sectorCode = contract.code;

          const techLevel = resolveTechLevelBySector(contract.code + ' ' + (contract.clientName || ''));
          this.state.contractValue = techLevel.value;

          let techName = contract.technicianId 
            ? ContractStore.getTechName(this.config.technicians, contract.technicianId)
            : `${contract.sectors ? contract.sectors.length : 0} Setores • Equipe Especializada`;

          this.state.technicianName = techName;

          this.updateSidebarInfo(contract.company || 'Mar Brasil', contract.clientName, techName, 'Consolidado do Contrato');

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

            this.state.excedente.quantidade = MeasurementCalculator.computeExcedenteQty(totals.mensalRealizada, totals.semestralRealizada);

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
          } else {
            this.state.pmocMensal.prevista = 0;
            this.state.pmocMensal.realizada = 0;
            this.state.pmocSemestral.prevista = 0;
            this.state.pmocSemestral.realizada = 0;
            this.state.corretiva.prevista = 0;
            this.state.corretiva.realizada = 0;
            this.state.epi.prevista = 0;
            this.state.epi.realizada = 0;
            this.state.excedente.quantidade = 0;
            this.state.incentivoVeicular = { metaPerformance: 0.0, baseValue: 1000.0, reconhecido: 0.0 };
            this.updateQuickStats({ equipamentos: 0, mensalPrev: 0, mensalReal: 0, semestralPrev: 0, semestralReal: 0, corretivaPrev: 0, corretivaReal: 0 });
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
          if (this.btnSendCurrentSector) this.btnSendCurrentSector.style.display = 'inline-block';
          // Uso da função pura buildStateForRow (Seção 5)
          this.state = this.buildStateForRow(row);

          this.updateSidebarInfo(
            this.state.company || 'Mar Brasil',
            this.state.clientName,
            this.state.technicianName,
            this.state.sectorDisplayName
          );

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
        if (this.btnOpenWhatsAppModal) this.btnOpenWhatsAppModal.disabled = false;

        // Detecção de competência pelo nome do arquivo
        const detectedComp = detectCompetenceFromFilename(file.name);
        if (detectedComp) {
          this.competence = detectedComp;
          if (this.inputCompetence) this.inputCompetence.value = detectedComp;
          if (this.inputPeriodLabel) this.inputPeriodLabel.value = `VALORES - MAR BRASIL ${detectedComp}`;
        }

        this.populateContractSelect();
        this.contractSectorSelect.value = 'PRINT_DEFAULT';
        this.onSectorChange();
      } catch (err) {
        alert(`Erro ao ler planilha: ${err.message}`);
        console.error(err);
      }
    }

    updateQuickStats(stats) {
      const perfMensal = stats.mensalPrev > 0 ? Math.round((stats.mensalReal / stats.mensalPrev) * 100) : 0;
      const perfSemestral = stats.semestralPrev > 0 ? Math.round((stats.semestralReal / stats.semestralPrev) * 100) : 0;
      const perfCorretiva = stats.corretivaPrev > 0 ? Math.round((stats.corretivaReal / stats.corretivaPrev) * 100) : 0;

      this.pillEquipamentos.textContent = `${stats.equipamentos} ativos`;
      this.pillMensal.textContent = `${stats.mensalReal} / ${stats.mensalPrev} (${perfMensal}%)`;
      this.pillSemestral.textContent = `${stats.semestralReal} / ${stats.semestralPrev} (${perfSemestral}%)`;
      this.pillCorretivas.textContent = `${stats.corretivaReal} / ${stats.corretivaPrev} (${perfCorretiva}%)`;
    }

    syncInputsFromState() {
      if (this.inputContractBadge) this.inputContractBadge.value = this.state.contractBadge;
      if (this.inputCompetence) this.inputCompetence.value = this.competence;
      if (this.inputPeriodLabel) this.inputPeriodLabel.value = this.state.periodLabel;
      if (this.inputContractValue) this.inputContractValue.value = Number(this.state.contractValue || 0).toFixed(2);

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

      if (this.epiSectorBadge) {
        if (this.state.epi && this.state.epi.isCustom) {
          this.epiSectorBadge.textContent = ' (personalizado)';
          this.epiSectorBadge.style.color = '#0284c7';
        } else if (this.state.epi && this.state.epi.isSpreadsheet) {
          this.epiSectorBadge.textContent = ' (planilha)';
          this.epiSectorBadge.style.color = '#16a34a';
        } else {
          this.epiSectorBadge.textContent = ' (padrão)';
          this.epiSectorBadge.style.color = '#64748b';
        }
      }

      if (this.inputExcedenteQtd) this.inputExcedenteQtd.value = this.state.excedente.quantidade;
      if (this.inputExcedenteTarifa) this.inputExcedenteTarifa.value = this.state.excedente.tarifa;
      if (this.inputExcedenteUnit) this.inputExcedenteUnit.value = this.state.excedente.unitario;

      if (this.inputIncentivoMeta) this.inputIncentivoMeta.value = Math.round(this.state.incentivoVeicular.metaPerformance * 100);
      if (this.inputIncentivoBase) this.inputIncentivoBase.value = this.state.incentivoVeicular.baseValue;
      if (this.inputIncentivoRec) this.inputIncentivoRec.value = Number(this.state.incentivoVeicular.reconhecido || 0).toFixed(2);
    }

    syncStateFromInputs(autoRecomputeIncentive = false) {
      if (this.inputContractBadge) this.state.contractBadge = this.inputContractBadge.value || 'CONTRATO STS 36693/22';
      if (this.inputCompetence) this.competence = this.inputCompetence.value.trim() || '08/2026';
      if (this.inputPeriodLabel) this.state.periodLabel = this.inputPeriodLabel.value || `VALORES - MAR BRASIL ${this.competence}`;
      
      const parsedVal = parseFloat(this.inputContractValue.value) || 0.0;
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
        if (this.inputIncentivoRec) this.inputIncentivoRec.value = Number(inc.reconhecido || 0).toFixed(2);
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
      this.competence = '08/2026';
      this.spreadsheetData = {
        rows: JSON.parse(JSON.stringify(SAMPLE_SPREADSHEET_ROWS)),
        groups: ExcelParser.groupRowsByContract(SAMPLE_SPREADSHEET_ROWS)
      };
      this.state = JSON.parse(JSON.stringify(DEFAULT_REPORT_DATA));
      this.state.periodLabel = `VALORES - MAR BRASIL ${this.competence}`;

      if (this.fileBadge) this.fileBadge.style.display = 'inline-block';
      if (this.fileInfoNotice) this.fileInfoNotice.style.display = 'block';
      if (this.activeFileName) this.activeFileName.textContent = 'Dados do Print de Exemplo (15 setores)';
      if (this.btnOpenWhatsAppModal) this.btnOpenWhatsAppModal.disabled = false;

      this.populateContractSelect();
      this.contractSectorSelect.value = 'PRINT_DEFAULT';
      this.onSectorChange();

      // Feedback visual interativo no botão
      if (this.btnLoadSample) {
        const origText = this.btnLoadSample.innerHTML;
        this.btnLoadSample.innerHTML = '✅ Dados Carregados!';
        setTimeout(() => {
          if (this.btnLoadSample) this.btnLoadSample.innerHTML = origText;
        }, 1200);
      }
    }

    clearSpreadsheetData() {
      this.spreadsheetData = { rows: [], groups: {} };
      this.sectorEpiMap = {};

      this.fileBadge.style.display = 'none';
      this.fileInfoNotice.style.display = 'none';
      this.activeFileName.textContent = '';
      this.fileInput.value = '';

      this.state = JSON.parse(JSON.stringify(EMPTY_REPORT_DATA));
      this.state.periodLabel = `VALORES - MAR BRASIL ${this.competence}`;

      this.populateContractSelect();
      this.contractSectorSelect.value = 'CLEARED';
      this.onSectorChange();

      if (this.btnClearData) {
        const origText = this.btnClearData.innerHTML;
        this.btnClearData.innerHTML = '🗑️ Dados Zerados!';
        setTimeout(() => {
          if (this.btnClearData) this.btnClearData.innerHTML = origText;
        }, 1200);
      }
    }

    async syncAuvoData() {
      if (!window.AuvoService) return;
      const originalText = this.btnSyncAuvo.innerHTML;
      this.btnSyncAuvo.innerHTML = '⏳ Sincronizando...';
      this.btnSyncAuvo.disabled = true;

      try {
        const [mes, ano] = this.competence.split('/');
        const startDate = `${ano}-${mes}-01`;
        const lastDay = new Date(ano, mes, 0).getDate();
        const endDate = `${ano}-${mes}-${lastDay}`;
        
        const auvoResult = await window.AuvoService.syncDashboard(startDate, endDate);
        
        this.spreadsheetData = {
          rows: auvoResult.rows.map(row => ({
            ...row,
            isAuvo: true
          })),
          groups: {}
        };
        
        this.fileBadge.style.display = 'inline-block';
        this.fileInfoNotice.style.display = 'block';
        this.activeFileName.textContent = `Auvo Dashboard: ${auvoResult.rows.length} Setores`;

        
        this.populateContractSelect();
        if (this.contractSectorSelect.options.length > 0) {
           this.contractSectorSelect.value = 'ROW_0';
        }
        this.onSectorChange();
        
        this.btnSyncAuvo.innerHTML = '✅ Auvo Sincronizado!';
      } catch (err) {
        alert(err.message);
        this.btnSyncAuvo.innerHTML = '❌ Falha na Sincronização';
      }
      
      setTimeout(() => {
        if (this.btnSyncAuvo) {
          this.btnSyncAuvo.innerHTML = originalText;
          this.btnSyncAuvo.disabled = false;
        }
      }, 3000);
    }

    /* ==========================================================================
       WHATSAPP INTEGRATION & WORKER API
       ========================================================================== */
    loadWaConfig() {
      const DEFAULT_URL = 'https://pmoc-whatsapp-proxy.guilherme-barrosmarbr.workers.dev';
      const DEFAULT_TOKEN = 'marbrasilpmoc2025';
      const saved = localStorage.getItem('MAR_BRASIL_PMOC_WA_CONFIG_V1');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed && typeof parsed === 'object') {
            if (!parsed.workerUrl || parsed.workerUrl.includes('pmoc-worker.guilhermebarros.workers.dev')) {
              parsed.workerUrl = DEFAULT_URL;
            }
            if (!parsed.accessToken) {
              parsed.accessToken = DEFAULT_TOKEN;
            }
            return parsed;
          }
        } catch (e) {
          console.error('Erro ao ler WA Config', e);
        }
      }
      return {
        workerUrl: DEFAULT_URL,
        accessToken: DEFAULT_TOKEN,
        captionTemplate: 'Olá, {tecnico}! Segue o relatório de produtividade de {competencia} do {setor}.\nQualquer dúvida, responda esta mensagem. — Mar Brasil'
      };
    }

    saveWaConfig(config) {
      this.waConfig = config;
      localStorage.setItem('MAR_BRASIL_PMOC_WA_CONFIG_V1', JSON.stringify(config));
    }

    loadWaHistory() {
      const saved = localStorage.getItem('MAR_BRASIL_PMOC_ENVIOS_V1');
      if (saved) {
        try { return JSON.parse(saved); } catch(e) {}
      }
      return [];
    }

    recordWaHistory(item) {
      this.waHistory.push({
        ...item,
        date: new Date().toISOString()
      });
      localStorage.setItem('MAR_BRASIL_PMOC_ENVIOS_V1', JSON.stringify(this.waHistory));
    }

    initWhatsAppEvents() {
      const closeModals = () => {
        if (this.whatsAppModal) this.whatsAppModal.classList.remove('active');
        if (this.whatsAppConfirmModal) this.whatsAppConfirmModal.classList.remove('active');
        if (this.whatsAppConfigModal) this.whatsAppConfigModal.classList.remove('active');
      };

      if (this.btnCloseWhatsAppModal) this.btnCloseWhatsAppModal.addEventListener('click', closeModals);
      if (this.btnCloseWhatsAppModalBottom) this.btnCloseWhatsAppModalBottom.addEventListener('click', closeModals);
      if (this.btnCloseWhatsAppConfirm) this.btnCloseWhatsAppConfirm.addEventListener('click', closeModals);
      if (this.btnCancelWhatsAppConfirm) this.btnCancelWhatsAppConfirm.addEventListener('click', closeModals);
      if (this.btnCloseWhatsAppConfig) this.btnCloseWhatsAppConfig.addEventListener('click', closeModals);
      if (this.btnCancelWhatsAppConfig) this.btnCancelWhatsAppConfig.addEventListener('click', closeModals);

      [this.whatsAppModal, this.whatsAppConfirmModal, this.whatsAppConfigModal].forEach(m => {
        if (m) {
          m.addEventListener('click', (e) => {
            if (e.target === m) m.classList.remove('active');
          });
        }
      });

      if (this.btnOpenWhatsAppModal) {
        this.btnOpenWhatsAppModal.addEventListener('click', () => this.openWhatsAppModal());
      }
      if (this.btnSendCurrentSector) {
        this.btnSendCurrentSector.addEventListener('click', () => {
          this.openWhatsAppModal(true);
        });
      }

      const openConfigHandler = () => {
        if (this.inputWorkerUrl) this.inputWorkerUrl.value = this.waConfig.workerUrl || '';
        if (this.inputWorkerToken) this.inputWorkerToken.value = this.waConfig.accessToken || '';
        if (this.inputCaptionTemplate) this.inputCaptionTemplate.value = this.waConfig.captionTemplate || '';
        if (this.workerStatusBadge) this.workerStatusBadge.textContent = '';
        if (this.whatsAppConfigModal) this.whatsAppConfigModal.classList.add('active');
      };

      if (this.btnOpenWhatsAppConfig) {
        this.btnOpenWhatsAppConfig.addEventListener('click', openConfigHandler);
      }
      if (this.btnOpenWhatsAppConfigDirect) {
        this.btnOpenWhatsAppConfigDirect.addEventListener('click', openConfigHandler);
      }

      if (this.btnRestoreDefaultWaConfig) {
        this.btnRestoreDefaultWaConfig.addEventListener('click', () => {
          if (this.inputWorkerUrl) this.inputWorkerUrl.value = 'https://pmoc-whatsapp-proxy.guilherme-barrosmarbr.workers.dev';
          if (this.inputWorkerToken) this.inputWorkerToken.value = 'marbrasilpmoc2025';
          if (this.workerStatusBadge) {
            this.workerStatusBadge.textContent = 'Valores padrão preenchidos!';
            this.workerStatusBadge.style.color = '#0284c7';
          }
        });
      }

      if (this.btnSaveWhatsAppConfig) {
        this.btnSaveWhatsAppConfig.addEventListener('click', () => {
          const cfg = {
            workerUrl: this.inputWorkerUrl ? this.inputWorkerUrl.value.trim().replace(/\/$/, '') : '',
            accessToken: this.inputWorkerToken ? this.inputWorkerToken.value.trim() : '',
            captionTemplate: this.inputCaptionTemplate ? this.inputCaptionTemplate.value.trim() : ''
          };
          this.saveWaConfig(cfg);
          if (this.whatsAppConfigModal) this.whatsAppConfigModal.classList.remove('active');
          this.logWaEvent('Configurações do WhatsApp salvas com sucesso.', 'info');
          alert('Configurações do WhatsApp salvas com sucesso!');
        });
      }

      if (this.chkTestMode) {
        this.chkTestMode.addEventListener('change', (e) => {
          if (this.testModeInputs) {
            this.testModeInputs.style.display = e.target.checked ? 'flex' : 'none';
          }
        });
      }

      if (this.chkSelectAllHeader) {
        this.chkSelectAllHeader.addEventListener('change', (e) => {
          const isChecked = e.target.checked;
          const boxes = this.waTableBody.querySelectorAll('.wa-row-checkbox:not(:disabled)');
          boxes.forEach(b => b.checked = isChecked);
          this.updateWhatsAppSelectionCount();
        });
      }

      if (this.btnSelectAllValid) {
        this.btnSelectAllValid.addEventListener('click', () => {
          if (this.chkSelectAllHeader) this.chkSelectAllHeader.checked = true;
          const boxes = this.waTableBody.querySelectorAll('.wa-row-checkbox:not(:disabled)');
          boxes.forEach(b => b.checked = true);
          this.updateWhatsAppSelectionCount();
        });
      }

      if (this.btnDeselectAll) {
        this.btnDeselectAll.addEventListener('click', () => {
          if (this.chkSelectAllHeader) this.chkSelectAllHeader.checked = false;
          const boxes = this.waTableBody.querySelectorAll('.wa-row-checkbox');
          boxes.forEach(b => b.checked = false);
          this.updateWhatsAppSelectionCount();
        });
      }

      if (this.waTableBody) {
        this.waTableBody.addEventListener('change', (e) => {
          if (e.target.classList.contains('wa-row-checkbox')) {
            this.updateWhatsAppSelectionCount();
          }
        });
      }

      if (this.btnStartBatchSend) {
        this.btnStartBatchSend.addEventListener('click', () => this.showConfirmModal());
      }

      if (this.btnExecuteWhatsAppSend) {
        this.btnExecuteWhatsAppSend.addEventListener('click', () => this.startBatchSend());
      }

      if (this.btnRetryFailed) {
        this.btnRetryFailed.addEventListener('click', () => this.retryFailedSends());
      }

      if (this.btnTestWorkerConnection) {
        this.btnTestWorkerConnection.addEventListener('click', async () => {
          const url = this.inputWorkerUrl ? this.inputWorkerUrl.value.trim().replace(/\/$/, '') : '';
          const token = this.inputWorkerToken ? this.inputWorkerToken.value.trim() : '';
          if (!url || !token) {
            if (this.workerStatusBadge) {
              this.workerStatusBadge.textContent = '❌ Preencha URL e Token';
              this.workerStatusBadge.style.color = '#dc2626';
            }
            return;
          }
          this.btnTestWorkerConnection.disabled = true;
          this.btnTestWorkerConnection.textContent = '⏳ Testando...';
          try {
            const res = await fetch(`${url}/status`, {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
              const data = await res.json();
              if (this.workerStatusBadge) {
                this.workerStatusBadge.textContent = '✅ Conectado à Evolution API';
                this.workerStatusBadge.style.color = '#16a34a';
              }
            } else {
              if (this.workerStatusBadge) {
                this.workerStatusBadge.textContent = `❌ Erro HTTP ${res.status}`;
                this.workerStatusBadge.style.color = '#dc2626';
              }
            }
          } catch(e) {
            if (this.workerStatusBadge) {
              this.workerStatusBadge.textContent = '❌ Falha na conexão (Verifique a URL)';
              this.workerStatusBadge.style.color = '#dc2626';
            }
          } finally {
            this.btnTestWorkerConnection.disabled = false;
            this.btnTestWorkerConnection.textContent = '⚡ Testar Conexão com Worker';
          }
        });
      }
    }

    logWaEvent(msg, type = 'info') {
      if (!this.waLogBox) return;
      const entry = document.createElement('div');
      entry.className = `wa-log-entry log-${type}`;
      const time = new Date().toLocaleTimeString();
      entry.textContent = `[${time}] ${msg}`;
      this.waLogBox.appendChild(entry);
      this.waLogBox.scrollTop = this.waLogBox.scrollHeight;
    }

    openTechEdit(techId) {
      if (this.whatsAppModal) this.whatsAppModal.classList.remove('active');
      if (this.configModal) {
        this.renderTechniciansList();
        this.configModal.classList.add('active');
        if (this.tabBtnTechs) this.tabBtnTechs.click();
      }
      if (techId) {
        const tech = this.config.technicians.find(t => t.id === techId);
        if (tech) {
          this.formTechId.value = tech.id;
          this.formTechName.value = tech.name;
          this.formTechPhone.value = tech.phone ? formatPhoneDisplay(tech.phone) : '';
          this.formTechNotes.value = tech.notes || '';
          this.techFormBox.classList.add('active');
          setTimeout(() => {
            if (this.formTechPhone) {
              this.formTechPhone.focus();
              this.formTechPhone.select();
            }
          }, 150);
          return;
        }
      }
      this.formTechId.value = '';
      this.formTechName.value = '';
      this.formTechPhone.value = '';
      this.formTechNotes.value = '';
      this.techFormBox.classList.add('active');
      setTimeout(() => {
        if (this.formTechName) this.formTechName.focus();
      }, 150);
    }
    openWhatsAppModal(singleSectorMode = false) {
      if (this.waCompetenceBadge) {
        this.waCompetenceBadge.textContent = `Competência: ${this.competence}`;
      }
      if (this.waTableBody) {
        this.waTableBody.innerHTML = '';
      }
      this.waQueue = [];

      if (!this.spreadsheetData || !this.spreadsheetData.rows || this.spreadsheetData.rows.length === 0) {
        if (this.waTableBody) {
          this.waTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 32px 16px; color: #64748b; font-size: 13px;">
            ⚠️ Nenhuma planilha de medição carregada no momento.<br><br>
            Arraste um arquivo Excel na barra lateral ou clique no botão superior <strong>"⚡ Dados do Print"</strong> para preencher os setores.<br><br>
            <button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById('btnOpenWhatsAppConfig').click()">
              ⚙️ Configurar Conexão do Worker Agora
            </button>
          </td></tr>`;
        }
        if (this.whatsAppModal) this.whatsAppModal.classList.add('active');
        return;
      }

      let currentSectorCode = null;
      if (singleSectorMode && this.contractSectorSelect.value.startsWith('ROW_')) {
        const idx = parseInt(this.contractSectorSelect.value.replace('ROW_', ''), 10);
        if (this.spreadsheetData.rows[idx]) {
          currentSectorCode = this.spreadsheetData.rows[idx].setor;
        }
      }

      this.spreadsheetData.rows.forEach((row, idx) => {
        const resolved = ContractStore.resolveSectorInfo(this.config, row.setor);
        const tech = resolved.technician;
        const state = this.buildStateForRow(row);
        
        let phoneValid = false;
        let phoneDisplay = '<span style="color:#ef4444; font-weight:600;">Sem telefone</span>';
        if (tech && tech.phone) {
          const val = validatePhone(tech.phone);
          if (val.valid) {
            phoneValid = true;
            phoneDisplay = `<span style="color:#166534; font-weight:600;">📱 ${formatPhoneDisplay(val.normalized)}</span> <button type="button" class="btn btn-outline btn-xs" style="font-size:10px; padding:2px 5px; margin-left:4px;" onclick="window.appInstance.openTechEdit('${tech.id}')" title="Alterar telefone deste técnico">✏️</button>`;
          } else {
            phoneDisplay = `<span style="color:#ef4444;" title="${val.error}">${val.error}</span> <button type="button" class="btn btn-outline btn-xs" style="font-size:10px; padding:2px 5px; margin-left:4px;" onclick="window.appInstance.openTechEdit('${tech.id}')" title="Corrigir telefone">✏️ Corrigir</button>`;
          }
        } else if (tech) {
          phoneDisplay = `<span style="color:#ef4444; font-weight:600;">Sem telefone</span> <button type="button" class="btn btn-primary btn-xs" style="font-size:10px; padding:2px 6px; margin-left:4px;" onclick="window.appInstance.openTechEdit('${tech.id}')" title="Cadastrar telefone para este técnico">+ Cadastrar</button>`;
        } else {
          phoneDisplay = '<span style="color:#ef4444; font-weight:600;">Sem técnico vinculado</span>';
        }

        const perfM = MeasurementCalculator.computePerformance(state.pmocMensal.prevista, state.pmocMensal.realizada);
        const perfS = MeasurementCalculator.computePerformance(state.pmocSemestral.prevista, state.pmocSemestral.realizada);
        const perfC = MeasurementCalculator.computePerformance(state.corretiva.prevista, state.corretiva.realizada);
        
        const historyHits = this.waHistory.filter(h => h.setor === row.setor && h.competencia === this.competence && h.status === 'success');
        let statusHtml = `<span class="badge-status status-pending" id="status-badge-${idx}">Pendente</span>`;
        if (historyHits.length > 0) {
          statusHtml = `<span class="badge-status status-success" id="status-badge-${idx}">Enviado (${historyHits.length}x)</span>`;
        }

        const isChecked = singleSectorMode ? (row.setor === currentSectorCode && phoneValid) : phoneValid;

        const tr = document.createElement('tr');
        if (!phoneValid) tr.className = 'wa-row-disabled';
        tr.innerHTML = `
          <td>
            <input type="checkbox" class="wa-row-checkbox" data-idx="${idx}" ${!phoneValid ? 'disabled' : ''} ${isChecked ? 'checked' : ''} />
          </td>
          <td style="font-weight: 600;">${row.setor}</td>
          <td>
             ${resolved.technicianName}
             ${!tech ? '<br><button type="button" class="btn btn-sm btn-outline" style="font-size:10px; padding:2px 4px; margin-top:2px;" onclick="document.getElementById(\'btnOpenConfigModal\').click()">Vincular</button>' : ''}
          </td>
          <td>${phoneDisplay}</td>
          <td style="font-family: monospace;">${Math.round(perfM * 100)}% / ${Math.round(perfS * 100)}% / ${Math.round(perfC * 100)}%</td>
          <td>${state.epi.prevista} / ${state.epi.realizada}</td>
          <td id="status-cell-${idx}">${statusHtml}</td>
          <td style="text-align: right;">
             <button type="button" class="btn btn-outline btn-sm" title="Baixar PDF" onclick="MeasurementApp.downloadSector(${idx})" style="padding:4px 8px; font-size:12px;">📄 PDF</button>
          </td>
        `;
        this.waTableBody.appendChild(tr);
      });

      this.updateWhatsAppSelectionCount();
      if (this.waLogBox) {
        this.waLogBox.style.display = 'none';
        this.waLogBox.innerHTML = '';
      }
      if (this.waProgressContainer) {
        this.waProgressContainer.style.display = 'none';
      }
      if (this.whatsAppModal) {
        this.whatsAppModal.classList.add('active');
      }

      if (singleSectorMode && currentSectorCode) {
        this.showConfirmModal();
      }
    }

    updateWhatsAppSelectionCount() {
      if (!this.waTableBody) return;
      const boxes = this.waTableBody.querySelectorAll('.wa-row-checkbox:checked');
      const count = boxes.length;
      if (this.waSelectedCountText) {
        this.waSelectedCountText.textContent = `${count} setores selecionados`;
      }
      
      if (this.btnStartBatchSend) {
        if (count > 0) {
          this.btnStartBatchSend.disabled = false;
          this.btnStartBatchSend.textContent = `📲 Enviar Selecionados (${count})`;
        } else {
          this.btnStartBatchSend.disabled = true;
          this.btnStartBatchSend.textContent = '📲 Enviar Selecionados (0)';
        }
      }
    }

    showConfirmModal() {
      const boxes = this.waTableBody.querySelectorAll('.wa-row-checkbox:checked');
      if (boxes.length === 0) return;

      this.waConfirmList.innerHTML = '';
      this.waQueue = [];

      const isTestMode = this.chkTestMode ? this.chkTestMode.checked : false;
      const testPhone = isTestMode ? validatePhone(this.inputTestPhone ? this.inputTestPhone.value : '') : null;

      if (isTestMode && (!testPhone || !testPhone.valid)) {
        alert('Modo teste ativo, mas o telefone de teste é inválido. Corrija o telefone no banner de teste.');
        return;
      }

      if (isTestMode) {
        if (this.waConfirmTestAlert) this.waConfirmTestAlert.style.display = 'block';
        if (this.waConfirmTestTarget) this.waConfirmTestTarget.textContent = formatPhoneDisplay(testPhone.normalized);
      } else {
        if (this.waConfirmTestAlert) this.waConfirmTestAlert.style.display = 'none';
      }

      boxes.forEach(box => {
        const idx = parseInt(box.dataset.idx, 10);
        const row = this.spreadsheetData.rows[idx];
        const resolved = ContractStore.resolveSectorInfo(this.config, row.setor);
        const phone = resolved.technician && resolved.technician.phone ? validatePhone(resolved.technician.phone).normalized : '';
        const masked = maskPhoneDisplay(phone);
        
        const historyHits = this.waHistory.filter(h => h.setor === row.setor && h.competencia === this.competence && h.status === 'success');
        let alertBadge = '';
        if (historyHits.length > 0) {
          alertBadge = '<span class="badge" style="background:#fee2e2; color:#991b1b; font-size:10px; padding: 2px 6px; border-radius: 4px; margin-left: 6px;">⚠️ Já enviado</span>';
        }

        const div = document.createElement('div');
        div.className = 'wa-confirm-item';
        div.innerHTML = `
          <div>
            <strong>${row.setor}</strong> <span>→ ${resolved.technicianName}</span>
            ${alertBadge}
          </div>
          <div style="font-family: monospace; color: #475569;">
            ${isTestMode ? formatPhoneDisplay(testPhone.normalized) : masked}
          </div>
        `;
        this.waConfirmList.appendChild(div);
        
        this.waQueue.push({ idx, row, resolved, phone, testPhone: testPhone ? testPhone.normalized : null });
      });

      if (this.waConfirmItemCount) this.waConfirmItemCount.textContent = this.waQueue.length;
      const minSecs = this.waQueue.length * 4;
      const maxSecs = this.waQueue.length * 10;
      if (this.waEstimatedTime) this.waEstimatedTime.textContent = `${minSecs} a ${maxSecs} segundos`;

      if (this.whatsAppConfirmModal) this.whatsAppConfirmModal.classList.add('active');
    }

    async startBatchSend() {
      if (this.whatsAppConfirmModal) this.whatsAppConfirmModal.classList.remove('active');
      if (this.waLogBox) {
        this.waLogBox.style.display = 'block';
        this.waLogBox.innerHTML = '';
      }
      if (this.waProgressContainer) this.waProgressContainer.style.display = 'block';
      if (this.btnStartBatchSend) {
        this.btnStartBatchSend.disabled = true;
        this.btnStartBatchSend.textContent = '⏳ Processando...';
      }
      if (this.btnCloseWhatsAppModal) this.btnCloseWhatsAppModal.style.display = 'none';
      if (this.btnCloseWhatsAppModalBottom) this.btnCloseWhatsAppModalBottom.style.display = 'none';

      const isTestMode = this.chkTestMode ? this.chkTestMode.checked : false;
      this.logWaEvent(`🚀 INICIANDO LOTE: ${this.waQueue.length} relatórios (Modo Teste: ${isTestMode ? 'SIM' : 'NÃO'}).`, 'info');

      for (let i = 0; i < this.waQueue.length; i++) {
        const item = this.waQueue[i];
        const percent = Math.round((i / this.waQueue.length) * 100);
        if (this.waProgressBar) this.waProgressBar.style.width = `${percent}%`;
        if (this.waProgressPercent) this.waProgressPercent.textContent = `${percent}%`;
        if (this.waProgressLabel) this.waProgressLabel.textContent = `Processando ${item.row.setor} (${i+1}/${this.waQueue.length})...`;

        await this.processSingleWaItem(item, isTestMode);

        if (i < this.waQueue.length - 1) {
          const delay = Math.floor(Math.random() * (10000 - 4000 + 1)) + 4000;
          this.logWaEvent(`⏱️ Aguardando ${(delay/1000).toFixed(1)}s por segurança anti-bloqueio...`, 'info');
          await new Promise(r => setTimeout(r, delay));
        }
      }

      if (this.waProgressBar) this.waProgressBar.style.width = '100%';
      if (this.waProgressPercent) this.waProgressPercent.textContent = '100%';
      if (this.waProgressLabel) this.waProgressLabel.textContent = '✅ Envio em Lote Concluído';
      
      if (this.btnStartBatchSend) {
        this.btnStartBatchSend.disabled = false;
        this.btnStartBatchSend.textContent = `📲 Enviar Selecionados (${this.waQueue.length})`;
      }
      if (this.btnCloseWhatsAppModal) this.btnCloseWhatsAppModal.style.display = 'block';
      if (this.btnCloseWhatsAppModalBottom) this.btnCloseWhatsAppModalBottom.style.display = 'block';
      this.logWaEvent('🏁 Processamento finalizado.', 'info');
    }

    async processSingleWaItem(item, isTestMode) {
      const { idx, row, resolved, phone, testPhone } = item;
      const targetPhone = isTestMode ? testPhone : phone;
      const badge = document.getElementById(`status-badge-${idx}`);
      
      if (badge) {
        badge.className = 'badge-status status-generating';
        badge.textContent = 'Gerando PDF...';
      }

      try {
        const state = this.buildStateForRow(row);
        const blob = await MeasurementApp.generatePdfBlobForState(state);
        
        if (badge) {
          badge.className = 'badge-status status-sending';
          badge.textContent = 'Enviando...';
        }

        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const dataUrl = reader.result;
            const b64 = dataUrl.split(',')[1];
            resolve(b64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        const template = this.waConfig.captionTemplate || 'Relatório de produtividade {competencia}';
        const caption = template
          .replace(/{tecnico}/g, resolved.technicianName)
          .replace(/{competencia}/g, this.competence)
          .replace(/{setor}/g, row.setor);

        const finalCaption = isTestMode ? `[TESTE]\n${caption}` : caption;
        const pdfFileName = getPdfFilename(row.setor, this.competence);

        const url = this.waConfig.workerUrl ? this.waConfig.workerUrl.trim().replace(/\/$/, '') : null;
        const token = this.waConfig.accessToken;

        let success = false;
        let messageId = null;

        if (url && token) {
          const res = await fetch(`${url}/send`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              phone: targetPhone,
              base64Data: base64,
              fileName: pdfFileName,
              caption: finalCaption
            })
          });

          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          const data = await res.json();
          messageId = data.messageId || 'sim-id';
          success = true;
        } else {
          this.logWaEvent(`⚠️ Simulação local ativa (Worker não configurado). Enviando ${pdfFileName} para ${targetPhone}...`, 'info');
          await new Promise(r => setTimeout(r, 1000));
          success = true;
          messageId = 'sim-local-id';
        }

        if (success) {
          if (badge) {
            badge.className = 'badge-status status-success';
            badge.textContent = '✅ Enviado';
          }
          this.logWaEvent(`✅ Sucesso: ${row.setor} -> ${targetPhone}`, 'success');
          this.recordWaHistory({
            setor: row.setor,
            competencia: this.competence,
            technicianName: resolved.technicianName,
            phone: targetPhone,
            status: 'success',
            messageId
          });
        }
      } catch(err) {
        if (badge) {
          badge.className = 'badge-status status-error';
          badge.textContent = `❌ Erro: ${err.message}`;
        }
        this.logWaEvent(`❌ Erro ${row.setor} -> ${targetPhone}: ${err.message}`, 'error');
        this.recordWaHistory({
          setor: row.setor,
          competencia: this.competence,
          technicianName: resolved.technicianName,
          phone: targetPhone,
          status: 'error',
          error: err.message
        });
      }
    }

    retryFailedSends() {
      const failed = this.waHistory.filter(h => h.competencia === this.competence && h.status === 'error');
      if (failed.length === 0) {
        alert('Não há envios com falha nesta competência.');
        return;
      }
      failed.forEach(f => {
        const idx = this.spreadsheetData.rows.findIndex(r => r.setor === f.setor);
        if (idx !== -1) {
          const cb = this.waTableBody.querySelector(`input[data-idx="${idx}"]`);
          if (cb && !cb.disabled) cb.checked = true;
        }
      });
      this.updateWhatsAppSelectionCount();
      this.showConfirmModal();
    }

    static downloadSector(idx) {
      if (window.appInstance && window.appInstance.spreadsheetData && window.appInstance.spreadsheetData.rows[idx]) {
        const row = window.appInstance.spreadsheetData.rows[idx];
        const state = window.appInstance.buildStateForRow(row);
        MeasurementApp.generatePdfBlobForState(state).then(blob => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = getPdfFilename(row.setor, window.appInstance.competence);
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        });
      }
    }

    update() {
      const computed = MeasurementCalculator.calculate(this.state);
      ReportRenderer.renderReport(this.reportContainer, this.state, computed);
    }

    /* ==========================================================================
       9. GERAÇÃO DE PDFS (EXTRAÇÃO PURA - SEÇÃO 5)
       ========================================================================== */
    /**
     * Gera o Blob do PDF a partir de um elemento HTML usando as opções contratuais:
     * margem [10, 12, 10, 12], JPEG 0.98, scale 2.2, formato A4 retrato.
     */
    static async generatePdfBlob(element) {
      if (typeof window.html2pdf !== 'function') {
        throw new Error('Biblioteca html2pdf não carregada.');
      }
      const opt = {
        margin: [10, 12, 10, 12],
        filename: 'relatorio.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2.2, useCORS: true, letterRendering: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };
      return window.html2pdf().set(opt).from(element).outputPdf('blob');
    }

    /**
     * Renderiza o relatório em container invisível fora da tela e gera o Blob PDF
     * sem alterar a UI visível ao usuário.
     */
    static async generatePdfBlobForState(state) {
      const offscreenWrapper = document.createElement('div');
      offscreenWrapper.className = 'offscreen-pdf-renderer';
      offscreenWrapper.style.position = 'fixed';
      offscreenWrapper.style.left = '-10000px';
      offscreenWrapper.style.top = '0';
      offscreenWrapper.style.width = '794px';
      offscreenWrapper.style.zIndex = '-9999';
      offscreenWrapper.style.pointerEvents = 'none';

      document.body.appendChild(offscreenWrapper);

      try {
        const computed = MeasurementCalculator.calculate(state);
        ReportRenderer.renderReport(offscreenWrapper, state, computed);
        const paper = offscreenWrapper.querySelector('.report-paper');
        if (!paper) throw new Error('Falha ao renderizar relatório offscreen.');
        const blob = await MeasurementApp.generatePdfBlob(paper);
        return blob;
      } finally {
        if (offscreenWrapper.parentNode) {
          offscreenWrapper.parentNode.removeChild(offscreenWrapper);
        }
      }
    }
  }

  // Inicialização segura
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { window.appInstance = new MeasurementApp(); });
  } else {
    window.appInstance = new MeasurementApp();
  }

})();
