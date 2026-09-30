/**
 * Módulo de Ingestão e Processamento de Planilhas Excel (.xlsx, .xls, .csv)
 * Utiliza SheetJS (xlsx.full.min.js) de forma resiliente e compatível.
 */

export class ExcelParser {
  /**
   * Normaliza uma string de cabeçalho removendo acentos e pontuações
   * @param {string} str 
   * @returns {string}
   */
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

  /**
   * Converte valor bruto da célula para número puro
   * @param {any} val 
   * @returns {number}
   */
  static parseNumber(val) {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    
    // Se for string com formato monetário ou percentual (ex: "R$ 1.500,00" ou "52%")
    const cleaned = String(val)
      .replace(/[R$\s%]/g, '')
      .replace(/\./g, '')
      .replace(',', '.');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }

  /**
   * Identifica as colunas chaves da planilha com suporte a variações de digitação
   * @param {Array<string>} headers 
   * @returns {Object} mapeamento de chave padronizada para o índice da coluna
   */
  static mapHeaders(headers) {
    const map = {};
    headers.forEach((h, index) => {
      const norm = this.normalizeHeader(h);
      
      if (/^(setor|contrato|unidade|local|descricao)/.test(norm)) {
        map.setor = index;
      } else if (/equipamento.*ativo|ativos/.test(norm)) {
        map.equipamentosAtivos = index;
      } else if (/mensal.*prev/.test(norm)) {
        map.mensalPrevista = index;
      } else if (/mensal.*real/.test(norm)) {
        map.mensalRealizada = index;
      } else if (/semestral.*prev/.test(norm)) {
        map.semestralPrevista = index;
      } else if (/semestral.*real/.test(norm)) {
        map.semestralRealizada = index;
      } else if (/corretiv.*prev/.test(norm)) {
        map.corretivasPrevista = index;
      } else if (/corretiv.*real/.test(norm)) {
        map.corretivasRealizada = index;
      } else if (/epi.*prev|epi.*program/.test(norm)) {
        map.epiPrevista = index;
      } else if (/epi.*real|epi.*entreg/.test(norm)) {
        map.epiRealizada = index;
      }
    });

    return map;
  }

  /**
   * Faz o parse do arquivo binário (File ou ArrayBuffer) para linhas estruturadas
   * @param {ArrayBuffer|Uint8Array} dataBuffer 
   * @returns {Promise<{ sheetNames: string[], rows: Array<Object>, groups: Object }>}
   */
  static async parseWorkbook(dataBuffer) {
    if (!window.XLSX) {
      throw new Error('Biblioteca SheetJS (XLSX) não encontrada.');
    }

    const workbook = window.XLSX.read(dataBuffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    // Converte para matriz de linhas
    let rawMatrix = window.XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    
    if (!rawMatrix || rawMatrix.length === 0) {
      throw new Error('A planilha fornecida está vazia.');
    }

    // Compatibilidade com CSV regional brasileiro (delimitador ;)
    if (rawMatrix.length > 0 && rawMatrix[0].length <= 2 && String(rawMatrix[0][0]).includes(';')) {
      rawMatrix = rawMatrix.map(r => (typeof r[0] === 'string' ? r[0].split(';').map(c => c.trim()) : r));
    }

    // Localiza a linha de cabeçalho (primeira linha que contenha texto chave como SETOR ou MENSAL)
    let headerRowIdx = 0;
    for (let i = 0; i < Math.min(rawMatrix.length, 10); i++) {
      const rowStr = rawMatrix[i].map(c => this.normalizeHeader(c)).join(' ');
      if (rowStr.includes('setor') || rowStr.includes('mensal') || rowStr.includes('equipamento')) {
        headerRowIdx = i;
        break;
      }
    }

    const headerRow = rawMatrix[headerRowIdx];
    const columnMap = this.mapHeaders(headerRow);

    const rows = [];
    for (let r = headerRowIdx + 1; r < rawMatrix.length; r++) {
      const row = rawMatrix[r];
      if (!row || row.length === 0) continue;

      const setor = columnMap.setor !== undefined ? String(row[columnMap.setor] || '').trim() : '';
      if (!setor) continue; // Pula linhas em branco

      const parsedRow = {
        id: `row-${r}`,
        setor,
        equipamentosAtivos: columnMap.equipamentosAtivos !== undefined ? this.parseNumber(row[columnMap.equipamentosAtivos]) : 0,
        mensalPrevista: columnMap.mensalPrevista !== undefined ? this.parseNumber(row[columnMap.mensalPrevista]) : 0,
        mensalRealizada: columnMap.mensalRealizada !== undefined ? this.parseNumber(row[columnMap.mensalRealizada]) : 0,
        semestralPrevista: columnMap.semestralPrevista !== undefined ? this.parseNumber(row[columnMap.semestralPrevista]) : 0,
        semestralRealizada: columnMap.semestralRealizada !== undefined ? this.parseNumber(row[columnMap.semestralRealizada]) : 0,
        corretivasPrevista: columnMap.corretivasPrevista !== undefined ? this.parseNumber(row[columnMap.corretivasPrevista]) : 0,
        corretivasRealizada: columnMap.corretivasRealizada !== undefined ? this.parseNumber(row[columnMap.corretivasRealizada]) : 0,
        epiPrevista: columnMap.epiPrevista !== undefined ? this.parseNumber(row[columnMap.epiPrevista]) : null,
        epiRealizada: columnMap.epiRealizada !== undefined ? this.parseNumber(row[columnMap.epiRealizada]) : null
      };

      rows.push(parsedRow);
    }

    // Agrupamento automático por prefixo de Contrato (ex: STS36693/22 ou PSP6018/25)
    const groups = this.groupRowsByContract(rows);

    return {
      sheetNames: workbook.SheetNames,
      rows,
      groups
    };
  }

  /**
   * Agrupa setores pelo código do contrato e gera totais consolidados
   * @param {Array<Object>} rows 
   * @returns {Object}
   */
  static groupRowsByContract(rows) {
    const groups = {};

    rows.forEach(row => {
      // Extrai o contrato antes do traço ou primeiro delimitador
      let contractCode = row.setor;
      if (row.setor.includes('-')) {
        contractCode = row.setor.split('-')[0].trim();
      } else if (row.setor.includes('/')) {
        const parts = row.setor.split(' ');
        contractCode = parts[0].trim();
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
            corretivasRealizada: 0,
            epiPrevista: 0,
            epiRealizada: 0
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
      if (row.epiPrevista !== null) groups[contractCode].totals.epiPrevista += row.epiPrevista;
      if (row.epiRealizada !== null) groups[contractCode].totals.epiRealizada += row.epiRealizada;
    });

    return groups;
  }

  /**
   * Gera e faz o download de uma planilha modelo formatada
   */
  static downloadTemplate() {
    if (!window.XLSX) {
      alert('Biblioteca SheetJS ainda não está pronta.');
      return;
    }

    const headers = [
      'SETOR',
      'EQUIPAMENTOS ATIVOS',
      'MENSAL - PREVISTA',
      'MENSAL - REALIZADA',
      'MENSAL - CONCLUÍDA',
      'MENSAL - FALTAM',
      'SEMESTRAL - PREVISTA',
      'SEMESTRAL - REALIZADA',
      'SEMESTRAL - CONCLUÍDA',
      'SEMESTRAL - FALTAM',
      'CORRETIVAS - PREV.',
      'CORRETIVAS - REALIZ.',
      'CORRETIVAS - CONCLUÍDA',
      'CORRETIVAS - FALTAM'
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

    // Ajusta largura das colunas
    ws['!cols'] = [
      { wch: 25 },
      { wch: 20 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 16 },
      { wch: 20 },
      { wch: 20 },
      { wch: 20 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 20 },
      { wch: 18 }
    ];

    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Medicao_PMOC');
    window.XLSX.writeFile(wb, 'planilha_medicao_pmoc_modelo.xlsx');
  }
}
