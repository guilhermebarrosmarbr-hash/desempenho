/**
 * Gerenciador e Repositório de Contratos, Setores e Técnicos Responsáveis
 * Suporta persistência em localStorage, escalabilidade (CRUD completo) e casamento inteligente de setores.
 */

export const STORAGE_KEY_CONFIG = 'MAR_BRASIL_PMOC_CONFIG_V1';

export const INITIAL_TECHNICIANS = [
  { id: 'tech-gb', name: 'GB Climatização', phone: '', notes: 'Responsável Setor 01 Santos' },
  { id: 'tech-ravtech', name: 'RavTech Climatização', phone: '', notes: 'Responsável Setor 02 Santos' },
  { id: 'tech-rn', name: 'RN Climatização', phone: '', notes: 'Responsável Setor 03 Santos' },
  { id: 'tech-gr', name: 'GR Ar Condicionado', phone: '', notes: 'Responsável Setor 04 Santos' },
  { id: 'tech-cj', name: 'CJ Refrigeração', phone: '', notes: 'Responsável Setor 05 Santos' },
  { id: 'tech-santoar', name: 'Santo Ar', phone: '', notes: 'Responsável Setor 06 Santos' },
  { id: 'tech-jr', name: 'JR Refrigeração', phone: '', notes: 'Responsável Contrato CRSN PSP 6018/25' },
  { id: 'tech-cm2d', name: 'CM2D Refrigeração', phone: '', notes: 'Responsável Contrato SMSU PSP 6029/25' }
];

export const INITIAL_CONTRACTS = [
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
      { id: 'sec-sts-01', code: 'SETOR 01', fullName: 'STS36693/22 - SETOR 01', technicianId: 'tech-gb' },
      { id: 'sec-sts-02', code: 'SETOR 02', fullName: 'STS36693/22 - SETOR 02', technicianId: 'tech-ravtech' },
      { id: 'sec-sts-03', code: 'SETOR 03', fullName: 'STS36693/22 - SETOR 03', technicianId: 'tech-rn' },
      { id: 'sec-sts-04', code: 'SETOR 04', fullName: 'STS36693/22 - SETOR 04', technicianId: 'tech-gr' },
      { id: 'sec-sts-05', code: 'SETOR 05', fullName: 'STS36693/22 - SETOR 05', technicianId: 'tech-cj' },
      { id: 'sec-sts-06', code: 'SETOR 06', fullName: 'STS36693/22 - SETOR 06', technicianId: 'tech-santoar' }
    ]
  },
  {
    id: 'contract-crsn',
    code: 'PSP 6018/25',
    clientName: 'CRSN',
    clientFullName: 'Coordenadoria Regional de Saúde Norte de São Paulo',
    company: 'Mar Brasil',
    description: 'Avaliação objetiva da execução contratual de manutenção (PMOC e correlatos) da Coordenadoria Regional de Saúde Norte de São Paulo realizada pela Mar Brasil, com conversão direta de performance operacional em valor financeiro reconhecido.',
    contractValue: 3500.0,
    technicianId: 'tech-jr',
    sectors: [
      { id: 'sec-crsn-01', code: 'CRSN', fullName: 'PSP6018/25 - CRSN', technicianId: 'tech-jr' }
    ]
  },
  {
    id: 'contract-smsu',
    code: 'PSP 6029/25',
    clientName: 'SMSU',
    clientFullName: 'Secretaria Municipal de Segurança Urbana de São Paulo',
    company: 'Mar Brasil',
    description: 'Avaliação objetiva da execução contratual de manutenção (PMOC e correlatos) da Secretaria Municipal de Segurança Urbana de São Paulo realizada pela Mar Brasil, com conversão direta de performance operacional em valor financeiro reconhecido.',
    contractValue: 2800.0,
    technicianId: 'tech-cm2d',
    sectors: [
      { id: 'sec-smsu-01', code: 'SMSU', fullName: 'PSP6029/25 - SMSU', technicianId: 'tech-cm2d' }
    ]
  }
];

export class ContractStore {
  /**
   * Carrega a configuração completa do localStorage ou inicializa os dados padrão
   * @returns {{ company: string, technicians: Array, contracts: Array }}
   */
  static load() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_CONFIG);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && Array.isArray(parsed.contracts) && Array.isArray(parsed.technicians)) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Erro ao ler configuração do localStorage, usando padrões:', e);
    }

    const initial = {
      company: 'Mar Brasil',
      technicians: JSON.parse(JSON.stringify(INITIAL_TECHNICIANS)),
      contracts: JSON.parse(JSON.stringify(INITIAL_CONTRACTS))
    };
    this.save(initial);
    return initial;
  }

  /**
   * Salva a configuração no localStorage
   * @param {Object} data 
   */
  static save(data) {
    try {
      localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(data));
    } catch (e) {
      console.error('Erro ao salvar no localStorage:', e);
    }
  }

  /**
   * Restaura para as configurações de fábrica (Mar Brasil)
   */
  static resetToDefault() {
    const initial = {
      company: 'Mar Brasil',
      technicians: JSON.parse(JSON.stringify(INITIAL_TECHNICIANS)),
      contracts: JSON.parse(JSON.stringify(INITIAL_CONTRACTS))
    };
    this.save(initial);
    return initial;
  }

  /**
   * Obtém o nome do técnico pelo ID
   * @param {Array} technicians 
   * @param {string} techId 
   * @returns {string}
   */
  static getTechName(technicians, techId) {
    if (!techId) return 'Não Definido';
    const found = technicians.find(t => t.id === techId);
    return found ? found.name : 'Não Definido';
  }

  /**
   * Localiza contrato, setor e técnico com base em uma string de setor da planilha
   * Ex: "STS36693/22 - SETOR 01" ou "PSP6018/25 - CRSN"
   * @param {Object} config 
   * @param {string} setorStr 
   * @returns {Object}
   */
  static resolveSectorInfo(config, setorStr) {
    if (!setorStr) {
      return {
        company: config.company || 'Mar Brasil',
        contract: null,
        sector: null,
        clientName: 'SEDUC Santos',
        clientFullName: 'Secretaria de Educação de Santos',
        technicianName: 'GB Climatização',
        isConsolidated: false
      };
    }

    const cleanStr = setorStr.replace(/\s+/g, ' ').toUpperCase();

    // 1. Tenta casar com setores cadastrados
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
              isConsolidated: false
            };
          }
        }
      }

      // Se for consolidado do contrato
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
          isConsolidated: true
        };
      }
    }

    // Fallback padrão se não encontrar
    return {
      company: config.company || 'Mar Brasil',
      contract: null,
      sector: null,
      clientName: 'Contratante',
      clientFullName: 'Órgão Contratante',
      technicianName: 'Técnico Responsável',
      isConsolidated: false
    };
  }
}
