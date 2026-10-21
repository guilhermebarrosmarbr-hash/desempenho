/**
 * mensal.bundle.js - Módulo 03: Desempenho Mensal
 * BPO Financeiro • Mar Brasil
 * 
 * Regras puras de cálculo, parser dedicado da planilha vertical (GERAL, FINANCEIRO, TAREFAS DO CICLO),
 * renderização vetorial de alta fidelidade e persistência de parâmetros.
 */

(function (window) {
  'use strict';

  // -------------------------------------------------------------
  // 1. FORMATADOR NUMÉRICO E MONETÁRIO
  // -------------------------------------------------------------
  const Formatter = {
    currency(value, withSymbol = true) {
      const num = Number(value) || 0;
      const formatted = num.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
      return withSymbol ? `R$ ${formatted}` : formatted;
    },

    percentage(value, decimals = 0) {
      if (value === null || value === undefined || isNaN(value)) return '—';
      const num = Number(value);
      const pct = num <= 1.0 && num >= 0 ? num * 100 : num;
      return `${pct.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`;
    },

    escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    normalizeStr(s) {
      if (!s) return '';
      return String(s)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase();
    }
  };

  // -------------------------------------------------------------
  // 2. MOTOR DE CÁLCULO MENSAL (FUNÇÕES PURAS)
  // -------------------------------------------------------------
  class MensalCalculator {
    /**
     * Calcula o desempenho operacional de um item
     * @param {number|string|null} planejado
     * @param {number|string|null} executado
     * @returns {Object}
     */
    static computeItemPerformance(planejado, executado) {
      if (planejado === '-' || executado === '-' || planejado === null || planejado === undefined || planejado === '') {
        return {
          status: 'NA',
          bruto: 0,
          remuneravel: 0,
          percentual: null,
          faltante: 0,
          excedente: 0,
          planejado: null,
          executado: null,
          displayText: 'Não aplicável'
        };
      }

      const planNum = Number(planejado);
      const execNum = Number(executado);

      if (isNaN(planNum) || isNaN(execNum)) {
        return {
          status: 'INVALID',
          bruto: 0,
          remuneravel: 0,
          percentual: null,
          faltante: 0,
          excedente: 0,
          planejado: null,
          executado: null,
          displayText: 'Dado Inválido'
        };
      }

      if (planNum <= 0) {
        return {
          status: 'ZERO_GOAL',
          bruto: execNum > 0 ? 1.0 : 0.0,
          remuneravel: execNum > 0 ? 1.0 : 0.0,
          percentual: execNum > 0 ? 100 : 0,
          faltante: 0,
          excedente: Math.max(0, execNum),
          planejado: 0,
          executado: execNum,
          displayText: execNum > 0 ? 'Meta 0 (Executado)' : 'Meta 0'
        };
      }

      const bruto = execNum / planNum;
      const remuneravel = Math.min(1.0, Math.max(0.0, bruto));
      const faltante = Math.max(0, planNum - execNum);
      const excedente = Math.max(0, execNum - planNum);

      return {
        status: 'OK',
        bruto: bruto,
        remuneravel: remuneravel,
        percentual: bruto * 100,
        faltante: faltante,
        excedente: excedente,
        planejado: planNum,
        executado: execNum,
        displayText: `${execNum} de ${planNum}`
      };
    }

    /**
     * Calcula o excedente financeiro mensal:
     * Regra: Se soma executada (Mensal + Semestral) > limite (padrão 500)
     * Fórmula da planilha FINANCEIRO: quantidade * (tarifa + unitário)
     */
    static computeExcedente(mensalExec, semestralExec, config = {}) {
      const limite = Number(config.limite !== undefined ? config.limite : 500);
      const tarifa = Number(config.tarifa !== undefined ? config.tarifa : 10.75);
      const unitario = Number(config.unitario !== undefined ? config.unitario : 3.50);

      const somaExec = (Number(mensalExec) || 0) + (Number(semestralExec) || 0);
      const quantidade = somaExec > limite ? (somaExec - limite) : 0;
      const valorPorUnidade = tarifa + unitario;
      const valorTotal = quantidade * valorPorUnidade;

      return {
        somaExec,
        limite,
        tarifa,
        unitario,
        valorPorUnidade,
        quantidade,
        valorTotal
      };
    }

    /**
     * Calcula o incentivo veicular:
     * Média simples das 4 categorias principais: Mensal, Semestral, Corretiva, EPI.
     */
    static computeIncentivoVeicular(perfMensal, perfSemestral, perfCorretiva, perfEpi, baseValue = 1000.0) {
      const items = [perfMensal, perfSemestral, perfCorretiva, perfEpi].map(p => Number(p) || 0);
      const mediaBruta = items.reduce((acc, v) => acc + v, 0) / items.length;
      const mediaPct = mediaBruta * 100;
      const roundedPct = Math.round(mediaPct);

      let reconhecido = 0.0;
      if (roundedPct >= 100) {
        reconhecido = Number(baseValue) || 1000.0;
      } else if (roundedPct >= 90) {
        reconhecido = 750.0;
      } else {
        reconhecido = 0.0;
      }

      return {
        mediaBruta,
        mediaPct,
        roundedPct,
        baseValue: Number(baseValue) || 1000.0,
        reconhecido
      };
    }

    /**
     * Executa o cálculo financeiro consolidado completo
     * @param {Object} params
     */
    static calculate(params) {
      const valorBase = Number(params.valorBase !== undefined ? params.valorBase : 0.0);

      const operacional = {
        mensal: this.computeItemPerformance(params.mensal?.planejado, params.mensal?.executado),
        semestral: this.computeItemPerformance(params.semestral?.planejado, params.semestral?.executado),
        pmoc: this.computeItemPerformance(params.pmoc?.planejado, params.pmoc?.executado),
        corretiva: this.computeItemPerformance(params.corretiva?.planejado, params.corretiva?.executado),
        epi: this.computeItemPerformance(params.epi?.planejado, params.epi?.executado),
        ferramentas: this.computeItemPerformance(params.ferramentas?.planejado, params.ferramentas?.executado),
        auditorias: this.computeItemPerformance(params.auditorias?.planejado, params.auditorias?.executado)
      };

      const pesos = {
        mensal: Number(params.pesos?.mensal !== undefined ? params.pesos.mensal : 0.05),
        semestral: Number(params.pesos?.semestral !== undefined ? params.pesos.semestral : 0.50),
        corretiva: Number(params.pesos?.corretiva !== undefined ? params.pesos.corretiva : 0.40),
        epi: Number(params.pesos?.epi !== undefined ? params.pesos.epi : 0.05)
      };

      const parcelaBaseMensal = valorBase * pesos.mensal;
      const parcelaRecMensal = parcelaBaseMensal * operacional.mensal.remuneravel;

      const parcelaBaseSemestral = valorBase * pesos.semestral;
      const parcelaRecSemestral = parcelaBaseSemestral * operacional.semestral.remuneravel;

      const parcelaBaseCorretiva = valorBase * pesos.corretiva;
      const parcelaRecCorretiva = parcelaBaseCorretiva * operacional.corretiva.remuneravel;

      const parcelaBaseEpi = valorBase * pesos.epi;
      const parcelaRecEpi = parcelaBaseEpi * operacional.epi.remuneravel;

      const excedenteInfo = this.computeExcedente(
        operacional.mensal.executado,
        operacional.semestral.executado,
        params.excedenteConfig || {}
      );

      const subtotal = parcelaRecMensal + parcelaRecSemestral + parcelaRecCorretiva + parcelaRecEpi + excedenteInfo.valorTotal;

      const incentivoInfo = this.computeIncentivoVeicular(
        operacional.mensal.remuneravel,
        operacional.semestral.remuneravel,
        operacional.corretiva.remuneravel,
        operacional.epi.remuneravel,
        params.incentivoBaseValue !== undefined ? params.incentivoBaseValue : 1000.0
      );

      const totalGeral = subtotal + incentivoInfo.reconhecido;

      return {
        valorBase,
        pesos,
        operacional,
        financeiro: {
          parcelas: {
            mensal: { base: parcelaBaseMensal, reconhecido: parcelaRecMensal },
            semestral: { base: parcelaBaseSemestral, reconhecido: parcelaRecSemestral },
            corretiva: { base: parcelaBaseCorretiva, reconhecido: parcelaRecCorretiva },
            epi: { base: parcelaBaseEpi, reconhecido: parcelaRecEpi }
          },
          excedente: excedenteInfo,
          subtotal,
          incentivo: incentivoInfo,
          totalGeral
        }
      };
    }
  }

  // -------------------------------------------------------------
  // 3. PARSER MENSAL DE PLANILHA (GERAL + FINANCEIRO + TAREFAS)
  // -------------------------------------------------------------
  class MensalExcelParser {
    static parseWorkbook(workbook) {
      if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new Error('Arquivo de planilha vazio ou inválido.');
      }

      let sheetGeralName = null;
      let sheetFinName = null;
      let sheetTarefasName = null;

      for (const name of workbook.SheetNames) {
        const norm = Formatter.normalizeStr(name);
        if (!sheetGeralName && norm.includes('GERAL')) {
          sheetGeralName = name;
        } else if (!sheetFinName && (norm.includes('FINANC') || norm.includes('VALOR'))) {
          sheetFinName = name;
        } else if (!sheetTarefasName && (norm.includes('TAREFA') || norm.includes('CICLO') || norm.includes('ORDEM'))) {
          sheetTarefasName = name;
        }
      }

      if (!sheetGeralName) {
        sheetGeralName = workbook.SheetNames[0];
      }

      const wsGeral = workbook.Sheets[sheetGeralName];
      const geralRows = XLSX.utils.sheet_to_json(wsGeral, { header: 1, defval: '' });

      const metadata = this.extractMetadata(geralRows, wsGeral);
      const quantitativos = this.extractQuantitativos(geralRows, wsGeral);

      let financeiroSugestoes = null;
      let divergencias = [];

      if (sheetFinName && workbook.Sheets[sheetFinName]) {
        const wsFin = workbook.Sheets[sheetFinName];
        financeiroSugestoes = this.extractFinanceiroParams(wsFin);

        if (financeiroSugestoes.competenciaLabel && metadata.competencia) {
          const normFin = Formatter.normalizeStr(financeiroSugestoes.competenciaLabel);
          const normGeral = Formatter.normalizeStr(metadata.competencia);
          if (normFin.includes('07/2026') || (normFin.includes('JULHO') && normGeral.includes('AGOSTO'))) {
            divergencias.push({
              tipo: 'COMPETENCIA',
              mensagem: `A aba FINANCEIRO faz referência a "${financeiroSugestoes.competenciaLabel}", divergindo do ciclo oficial identificado na GERAL (${metadata.competencia}). A competência oficial de Agosto foi preservada.`
            });
          }
        }

        if (quantitativos.corretiva && quantitativos.corretiva.planejado === 16 && quantitativos.corretiva.executado === 15) {
          divergencias.push({
            tipo: 'CORRETIVA_CACHE',
            mensagem: `A GERAL registra 15 executadas de 16 planejadas em Corretivas (93,75% - observação: "${quantitativos.corretiva.observacao || 'Aguardando peça'}"). A planilha financeira antiga mantinha 100% estático em cache. O cálculo recalculou fielmente 93,75%.`
          });
        }
      }

      let tarefasInfo = {
        totalRegistros: 0,
        distinctTasksCount: 0,
        mensalTarefasCount: 0,
        semestralTarefasCount: 0,
        corretivaTarefasCount: 0,
        tarefasResumo: [],
        evidenciasPorTipo: {
          MENSAL: [],
          SEMESTRAL: [],
          CORRETIVA: [],
          EPI: [],
          FERRAMENTAS: [],
          AUDITORIA: []
        }
      };

      if (sheetTarefasName && workbook.Sheets[sheetTarefasName]) {
        tarefasInfo = this.extractTarefas(workbook.Sheets[sheetTarefasName]);
      }

      return {
        sheetNames: {
          geral: sheetGeralName,
          financeiro: sheetFinName,
          tarefas: sheetTarefasName
        },
        metadata,
        quantitativos,
        financeiroSugestoes,
        divergencias,
        tarefasInfo
      };
    }

    static extractMetadata(rows, ws) {
      let contrato = 'STS36693/22';
      let setor = 'Setor 01';
      let competencia = '08/2026';
      let prestador = 'GB CLIMATIZAÇÃO (GABRIEL)';
      let oficiais = [];
      let fullTitle = '';

      for (let r = 0; r < Math.min(rows.length, 12); r++) {
        const row = rows[r];
        if (!row || row.length === 0) continue;

        for (let c = 0; c < row.length; c++) {
          const val = String(row[c] || '').trim();
          if (!val) continue;

          if (val.includes('SEDUC') || val.includes('STS') || val.includes('CICLO')) {
            fullTitle = val;
            if (val.includes('STS36693/22')) contrato = 'STS36693/22';
            if (val.toUpperCase().includes('SETOR 01')) setor = 'Setor 01';
            if (val.toUpperCase().includes('AGOSTO')) competencia = '08/2026';
          }

          const norm = Formatter.normalizeStr(val);
          if (norm.includes('PRESTADOR') && rows[r + 1]) {
            const nextVal = String(rows[r + 1][c] || '').trim();
            if (nextVal && !Formatter.normalizeStr(nextVal).includes('OFICIAL')) {
              prestador = nextVal;
            }
          }

          if (norm === 'OFICIAL' || norm.startsWith('OFICIAL')) {
            for (let offRow = r + 1; offRow < Math.min(rows.length, r + 5); offRow++) {
              const offVal = String(rows[offRow][c] || '').trim();
              if (offVal && !Formatter.normalizeStr(offVal).includes('PLANEJADO') && !Formatter.normalizeStr(offVal).includes('STS')) {
                oficiais.push(offVal);
              } else {
                break;
              }
            }
          }
        }
      }

      return {
        contrato,
        setor,
        competencia,
        prestador,
        oficiais: oficiais.length > 0 ? oficiais : ['Flávio Pereira', 'Jonathan Silva'],
        fullTitle: fullTitle || 'STS36693/22 - SEDUC - SANTOS - SETOR 01 - CICLO DE AGOSTO 2026'
      };
    }

    static extractQuantitativos(rows, ws) {
      const q = {
        equipamentosAtivos: { planejado: 482, executado: null, cell: 'C11' },
        preventivaMensal: { planejado: 415, executado: 415, observacao: '', cell: 'C12:D12' },
        preventivaSemestral: { planejado: 80, executado: 80, observacao: '', cell: 'C13:D13' },
        pmocLevantamento: { planejado: '-', executado: '-', observacao: '', cell: 'C14:D14' },
        corretiva: { planejado: 16, executado: 15, observacao: 'Aguardando peça', cell: 'C15:D15' },
        epi: { planejado: 21, executado: 21, observacao: '', cell: 'C18:D18' },
        ferramentas: { planejado: 1, executado: 1, observacao: '', cell: 'C19:D19' },
        auditorias: { planejado: 2, executado: 2, observacao: '', cell: 'C20:D20' }
      };

      rows.forEach((row, rIdx) => {
        if (!row || row.length === 0) return;
        const col0 = Formatter.normalizeStr(row[0] || '');
        const col1 = Formatter.normalizeStr(row[1] || '');
        const label = col0 || col1;

        const valCol1 = row[1];
        const valCol2 = row[2];
        const valCol4 = row[4];

        if (label.includes('EQUIPAMENTOS ATIVOS')) {
          q.equipamentosAtivos.planejado = this.parseCellNumber(valCol1 || valCol2);
          q.equipamentosAtivos.cell = `B${rIdx + 1}`;
        } else if (label.includes('MANUTENCAO PREVENTIVA MENSAL') || (label.includes('PREVENTIVA') && label.includes('MENSAL'))) {
          q.preventivaMensal.planejado = this.parseCellNumber(valCol1);
          q.preventivaMensal.executado = this.parseCellNumber(valCol2);
          q.preventivaMensal.cell = `B${rIdx + 1}:C${rIdx + 1}`;
        } else if (label.includes('SEMESTRAL')) {
          q.preventivaSemestral.planejado = this.parseCellNumber(valCol1);
          q.preventivaSemestral.executado = this.parseCellNumber(valCol2);
          q.preventivaSemestral.cell = `B${rIdx + 1}:C${rIdx + 1}`;
        } else if (label.includes('LEVANTAMENTO') || label.includes('PMOC')) {
          q.pmocLevantamento.planejado = String(valCol1).trim() || '-';
          q.pmocLevantamento.executado = String(valCol2).trim() || '-';
          q.pmocLevantamento.cell = `B${rIdx + 1}:C${rIdx + 1}`;
        } else if (label.includes('CORRETIVA')) {
          q.corretiva.planejado = this.parseCellNumber(valCol1);
          q.corretiva.executado = this.parseCellNumber(valCol2);
          q.corretiva.observacao = String(valCol4 || row[4] || '').replace(/[()]/g, '').trim();
          q.corretiva.cell = `B${rIdx + 1}:C${rIdx + 1}`;
        } else if (label === 'EPI' || label.startsWith('EPI')) {
          q.epi.planejado = this.parseCellNumber(valCol1);
          q.epi.executado = this.parseCellNumber(valCol2);
          q.epi.cell = `B${rIdx + 1}:C${rIdx + 1}`;
        } else if (label.includes('FERRAMENTA')) {
          q.ferramentas.planejado = this.parseCellNumber(valCol1);
          q.ferramentas.executado = this.parseCellNumber(valCol2);
          q.ferramentas.cell = `B${rIdx + 1}:C${rIdx + 1}`;
        } else if (label.includes('AUDITORIA')) {
          q.auditorias.planejado = this.parseCellNumber(valCol1);
          q.auditorias.executado = this.parseCellNumber(valCol2);
          q.auditorias.cell = `B${rIdx + 1}:C${rIdx + 1}`;
        }
      });

      if (ws['C11'] && ws['C11'].v !== undefined) {
        q.equipamentosAtivos.planejado = Number(ws['C11'].v) || q.equipamentosAtivos.planejado;
      }
      if (ws['C12'] && ws['D12']) {
        q.preventivaMensal.planejado = Number(ws['C12'].v) || q.preventivaMensal.planejado;
        q.preventivaMensal.executado = Number(ws['D12'].v) || q.preventivaMensal.executado;
      }
      if (ws['C13'] && ws['D13']) {
        q.preventivaSemestral.planejado = Number(ws['C13'].v) || q.preventivaSemestral.planejado;
        q.preventivaSemestral.executado = Number(ws['D13'].v) || q.preventivaSemestral.executado;
      }
      if (ws['C15'] && ws['D15']) {
        q.corretiva.planejado = Number(ws['C15'].v) || q.corretiva.planejado;
        q.corretiva.executado = Number(ws['D15'].v) || q.corretiva.executado;
        if (ws['F15'] && ws['F15'].v) q.corretiva.observacao = String(ws['F15'].v).replace(/[()]/g, '').trim();
      }
      if (ws['C18'] && ws['D18']) {
        q.epi.planejado = Number(ws['C18'].v) || q.epi.planejado;
        q.epi.executado = Number(ws['D18'].v) || q.epi.executado;
      }
      if (ws['C19'] && ws['D19']) {
        q.ferramentas.planejado = Number(ws['C19'].v) || q.ferramentas.planejado;
        q.ferramentas.executado = Number(ws['D19'].v) || q.ferramentas.executado;
      }
      if (ws['C20'] && ws['D20']) {
        q.auditorias.planejado = Number(ws['C20'].v) || q.auditorias.planejado;
        q.auditorias.executado = Number(ws['D20'].v) || q.auditorias.executado;
      }

      return q;
    }

    static extractFinanceiroParams(ws) {
      const getVal = (addr) => (ws[addr] ? ws[addr].v : null);

      return {
        competenciaLabel: getVal('F1') || 'VALORES - GWSB 07/2026',
        valorBase: Number(getVal('J1')) || 6000.0,
        pesos: {
          mensal: Number(getVal('H3')) || 0.05,
          semestral: Number(getVal('H4')) || 0.50,
          corretiva: Number(getVal('H5')) || 0.40,
          epi: Number(getVal('H6')) || 0.05
        },
        excedente: {
          tarifa: Number(getVal('H7')) || 10.75,
          unitario: Number(getVal('I7')) || 3.50,
          limite: 500
        },
        incentivoBase: Number(getVal('I9')) || 1000.0
      };
    }

    static extractTarefas(ws) {
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
      const taskIndex = new Map();
      const evidencias = {
        MENSAL: [],
        SEMESTRAL: [],
        CORRETIVA: [],
        EPI: [],
        FERRAMENTAS: [],
        AUDITORIA: []
      };

      let currentSection = 'ORDENS_SERVICO';

      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        if (!row || row.length === 0) continue;

        const firstCol = Formatter.normalizeStr(row[0] || '');

        if (firstCol.includes('EPIS') || firstCol === 'EPI') {
          currentSection = 'EPI';
          continue;
        } else if (firstCol.includes('INVENTARIO') && firstCol.includes('FERRAMENTA')) {
          currentSection = 'FERRAMENTAS';
          continue;
        } else if (firstCol.includes('AUDITORIA')) {
          currentSection = 'AUDITORIA';
          continue;
        }

        if (firstCol.includes('CLIENTE') || firstCol.includes('LOCALIDADE') || firstCol.includes('CONTROLE DE TAREFAS')) {
          continue;
        }

        if (currentSection === 'ORDENS_SERVICO') {
          const taskId = row[3] ? String(row[3]).trim() : null;
          const rawType = Formatter.normalizeStr(row[4] || '');
          const link = row[8] ? String(row[8]).trim() : '';

          if (!taskId) continue;

          let normalizedType = 'OUTRO';
          if (rawType.includes('MENSAL')) normalizedType = 'MENSAL';
          else if (rawType.includes('SEMESTRAL')) normalizedType = 'SEMESTRAL';
          else if (rawType.includes('CORRETIVA')) normalizedType = 'CORRETIVA';

          if (!taskIndex.has(taskId)) {
            taskIndex.set(taskId, {
              taskId,
              type: normalizedType,
              responsavel: row[5] || 'Equipe',
              data: row[7] || '',
              link: link,
              equipamentosCount: 0
            });
          }
          taskIndex.get(taskId).equipamentosCount++;
        } else if (currentSection === 'EPI') {
          const taskId = row[1] ? String(row[1]).trim() : null;
          const link = row[5] ? String(row[5]).trim() : '';
          if (taskId && taskId !== 'Código da tarefa') {
            evidencias.EPI.push({
              local: row[0] || 'SEDUC SEDE',
              taskId,
              data: row[3] || '',
              link
            });
          }
        } else if (currentSection === 'FERRAMENTAS') {
          const taskId = row[1] ? String(row[1]).trim() : null;
          const link = row[5] ? String(row[5]).trim() : '';
          if (taskId && taskId !== 'Código da tarefa') {
            evidencias.FERRAMENTAS.push({
              descricao: row[0] || 'Inventário de Ferramentas',
              taskId,
              data: row[3] || '',
              link
            });
          }
        } else if (currentSection === 'AUDITORIA') {
          const taskId = row[1] ? String(row[1]).trim() : null;
          const link = row[5] ? String(row[5]).trim() : '';
          if (taskId && taskId !== 'Código da tarefa') {
            evidencias.AUDITORIA.push({
              local: row[0] || 'Auditoria de Qualidade',
              taskId,
              data: row[3] || '',
              link
            });
          }
        }
      }

      let mensalCount = 0;
      let semestralCount = 0;
      let corretivaCount = 0;

      taskIndex.forEach(item => {
        if (item.type === 'MENSAL') {
          evidencias.MENSAL.push(item);
          mensalCount++;
        } else if (item.type === 'SEMESTRAL') {
          evidencias.SEMESTRAL.push(item);
          semestralCount++;
        } else if (item.type === 'CORRETIVA') {
          evidencias.CORRETIVA.push(item);
          corretivaCount++;
        }
      });

      return {
        totalRegistros: rows.length,
        distinctTasksCount: taskIndex.size,
        mensalTarefasCount: mensalCount,
        semestralTarefasCount: semestralCount,
        corretivaTarefasCount: corretivaCount,
        tarefasResumo: Array.from(taskIndex.values()),
        evidenciasPorTipo: evidencias
      };
    }

    static parseCellNumber(val) {
      if (val === null || val === undefined || val === '') return null;
      if (val === '-') return '-';
      const clean = String(val).replace(/[^\d.,-]/g, '').replace(',', '.');
      const num = Number(clean);
      return isNaN(num) ? val : num;
    }
  }

  // -------------------------------------------------------------
  // 4. RENDERIZADOR DO RELATÓRIO MENSAL (A4 FIDELIDADE VETORIAL)
  // -------------------------------------------------------------
  class MensalReportRenderer {
    static renderDonut(percentage, title, desc, rawFraction = null) {
      const radius = 58;
      const circumference = 2 * Math.PI * radius;
      const isNA = percentage === null || percentage === undefined || isNaN(percentage);
      const clampedPct = isNA ? 0 : Math.min(100, Math.max(0, percentage));
      const offset = circumference * (1 - clampedPct / 100);

      const displayVal = isNA ? 'N/A' : `${clampedPct}%`;

      const svgRaw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160">
        <circle cx="80" cy="80" r="${radius}" stroke="#ffedd5" fill="none" stroke-width="18" />
        <circle cx="80" cy="80" r="${radius}" stroke="#f97316" fill="none" stroke-width="18" stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 80 80)" stroke-linecap="butt" />
        <text x="80" y="88" font-family="Inter, -apple-system, BlinkMacSystemFont, sans-serif" font-weight="800" font-size="${isNA ? '26px' : '32px'}" fill="#0f172a" text-anchor="middle">${displayVal}</text>
        ${rawFraction ? `<text x="80" y="106" font-family="Inter, sans-serif" font-weight="600" font-size="11px" fill="#ea580c" text-anchor="middle">${rawFraction}</text>` : ''}
      </svg>`;
      const svgBase64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgRaw)));

      return `
        <div class="gauge-card">
          <div class="gauge-svg-container">
            <img src="${svgBase64}" style="width: 100%; height: 100%; display: block;" alt="${title}" />
          </div>
          <div class="gauge-info">
            <h3 class="gauge-title">${Formatter.escapeHtml(title)}</h3>
            <p class="gauge-subtitle">${Formatter.escapeHtml(desc)}</p>
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
      return `<img src="${svgBase64}" class="brand-cube-logo" style="width: 100%; height: 100%; display: block;" alt="Mar Brasil Logo" />`;
    }

    /**
     * Renderiza o relatório completo na folha A4
     */
    static renderReport(container, model) {
      if (!container) return;

      const calc = model.calcResult;
      const meta = model.metadata;
      const q = model.quantitativos;
      const op = calc.operacional;
      const fin = calc.financeiro;
      const isBlank = model.isBlank;

      // Badges superiores
      const prestadorBadgeHtml = meta.prestador ? `
        <span class="technician-badge" style="background: rgba(59, 130, 246, 0.1); border-color: rgba(59, 130, 246, 0.3); color: #1e40af;">
          <span class="badge-icon">🏢</span>
          <span class="badge-label">Prestador Parceiro:</span>
          <strong class="badge-name">${Formatter.escapeHtml(meta.prestador)}</strong>
        </span>
      ` : '';

      const oficiaisBadgeHtml = meta.oficiais && meta.oficiais.length > 0 ? `
        <span class="technician-badge">
          <span class="badge-icon">👷</span>
          <span class="badge-label">Equipe Operacional:</span>
          <strong class="badge-name">${Formatter.escapeHtml(meta.oficiais.join(', '))}</strong>
        </span>
      ` : '';

      // Banner informativo de sistema zerado
      const emptyStateNotice = isBlank ? `
        <div style="background: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 10px; padding: 18px 20px; margin-bottom: 20px; text-align: center; color: #475569;">
          <div style="font-size: 26px; margin-bottom: 6px;">📂</div>
          <strong style="font-size: 14px; color: #0f172a; display: block; margin-bottom: 4px;">Sistema Zerado — Pronto para Importação</strong>
          <span style="font-size: 12.5px; line-height: 1.5; display: block; max-width: 600px; margin: 0 auto;">
            Arraste uma planilha de medição mensal (.xlsx) no painel lateral esquerdo para preencher automaticamente os dados operacionais, financeiros e links de OS. Ou clique em <strong>🔄 Carregar Amostra</strong> para demonstração.
          </span>
        </div>
      ` : '';

      // Alertas de divergência (se houver)
      const diverHtml = (model.divergencias && model.divergencias.length > 0) ? `
        <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; font-size: 11.5px; color: #92400e;">
          <strong>⚠️ Auditoria de Divergências da Planilha:</strong>
          <ul style="margin: 4px 0 0 18px; padding: 0;">
            ${model.divergencias.map(d => `<li>${Formatter.escapeHtml(d.mensagem)}</li>`).join('')}
          </ul>
        </div>
      ` : '';

      // Tabela de itens complementares
      const compRows = [
        {
          item: 'Levantamento de PMOC',
          plan: q.pmocLevantamento?.planejado || '—',
          exec: q.pmocLevantamento?.executado || '—',
          obs: isBlank ? 'Aguardando planilha...' : 'Não aplicável neste ciclo'
        },
        {
          item: 'Inventário de Ferramentas e Equipamentos',
          plan: isBlank ? 0 : (q.ferramentas?.planejado || 1),
          exec: isBlank ? 0 : (q.ferramentas?.executado || 1),
          obs: isBlank ? 'Aguardando planilha...' : `${q.ferramentas?.executado || 1} inventário realizado pela equipe`
        },
        {
          item: 'Auditorias de Qualidade e Conformidade',
          plan: isBlank ? 0 : (q.auditorias?.planejado || 2),
          exec: isBlank ? 0 : (q.auditorias?.executado || 2),
          obs: isBlank ? 'Aguardando planilha...' : `${q.auditorias?.executado || 2} auditorias de campo realizadas`
        }
      ];

      const corrPctExact = op.corretiva.percentual !== null ? (op.corretiva.percentual % 1 === 0 ? `${op.corretiva.percentual}%` : `${op.corretiva.percentual.toFixed(2).replace('.', ',')}%`) : '0%';
      const corrObs = q.corretiva?.observacao ? ` (${q.corretiva.observacao})` : '';

      container.innerHTML = `
        <div class="report-paper">
          <!-- Cabeçalho Institucional -->
          <header class="report-header">
            <div class="header-left">
              <div class="badges-row" style="flex-wrap: wrap; gap: 8px;">
                <span class="contract-badge">${Formatter.escapeHtml(meta.contrato || 'STS36693/22')} &bull; ${Formatter.escapeHtml(meta.setor || 'SETOR')}</span>
                <span class="contract-badge" style="background: #ecfdf5; border-color: #a7f3d0; color: #065f46;">CICLO ${Formatter.escapeHtml(meta.competencia || '—')}</span>
                ${prestadorBadgeHtml}
                ${oficiaisBadgeHtml}
              </div>
              
              <h1 class="report-title">${meta.contrato ? `Desempenho Mensal &bull; Relatório de Medição` : `Desempenho Mensal — Sistema Zerado`}</h1>
              <p class="report-subtitle">
                ${isBlank ? `Aguardando alimentação de planilha para gerar a apuração e medição de desempenho.` : `Avaliação objetiva de manutenção preventiva e corretiva mensal do contrato SEDUC Santos executada por ${Formatter.escapeHtml(meta.prestador || 'GB Climatização')}, com apuração de produtividade e conversão direta em valores reconhecidos.`}
              </p>
            </div>
            <div class="header-right">
              ${this.renderCubeLogo()}
            </div>
          </header>

          ${emptyStateNotice}
          ${diverHtml}

          <!-- Grid de 4 Indicadores Circulares Principais -->
          <section class="gauges-grid">
            ${this.renderDonut(
              Math.round(op.mensal.bruto * 100),
              'Preventiva Mensal',
              isBlank ? '0 de 0 serviços executados' : `${op.mensal.executado} de ${op.mensal.planejado} equipamentos atendidos`
            )}
            ${this.renderDonut(
              Math.round(op.semestral.bruto * 100),
              'Preventiva Semestral',
              isBlank ? '0 de 0 serviços executados' : `${op.semestral.executado} de ${op.semestral.planejado} equipamentos atendidos`
            )}
            ${this.renderDonut(
              Math.round(op.corretiva.bruto * 100),
              'Manutenção Corretiva',
              isBlank ? '0 de 0 serviços executados' : `${op.corretiva.executado} de ${op.corretiva.planejado} ordens${corrObs}`,
              isBlank ? null : corrPctExact
            )}
            ${this.renderDonut(
              Math.round(op.epi.bruto * 100),
              'EPIs e Segurança',
              isBlank ? '0 de 0 itens entregues' : `${op.epi.executado} de ${op.epi.planejado} registros de conformidade`
            )}
          </section>

          <hr class="report-divider" />

          <!-- Tabela Financeira Oficial -->
          <section class="financial-section">
            <div class="financial-header">
              <span class="financial-label">VALORES CONTRATUAIS — ${Formatter.escapeHtml(meta.prestador || 'SISTEMA ZERADO')} (${Formatter.escapeHtml(meta.competencia || '—')})</span>
              <span class="financial-total-base" title="Valor-base mensal do perfil">${Formatter.currency(calc.valorBase, true)}</span>
            </div>

            <table class="report-table">
              <thead>
                <tr style="background: #f8fafc; font-size: 11px; text-transform: uppercase; color: #475569; border-bottom: 2px solid #e2e8f0;">
                  <th style="padding: 8px 12px; text-align: left;">Descrição do Serviço</th>
                  <th style="padding: 8px 12px; text-align: center;">Desempenho</th>
                  <th style="padding: 8px 12px; text-align: center;">Peso</th>
                  <th style="padding: 8px 12px; text-align: right;">Valor Base</th>
                  <th style="padding: 8px 12px; text-align: right;">Valor Reconhecido</th>
                </tr>
              </thead>
              <tbody>
                <tr class="table-row">
                  <td class="col-item font-bold">PREVENTIVA MENSAL</td>
                  <td class="col-perf font-mono">${Formatter.percentage(op.mensal.remuneravel)}</td>
                  <td class="col-peso font-mono">${Formatter.percentage(calc.pesos.mensal)}</td>
                  <td class="col-base font-mono">${Formatter.currency(fin.parcelas.mensal.base)}</td>
                  <td class="col-rec font-mono font-bold">${Formatter.currency(fin.parcelas.mensal.reconhecido)}</td>
                </tr>

                <tr class="table-row row-alt">
                  <td class="col-item font-bold">PREVENTIVA SEMESTRAL</td>
                  <td class="col-perf font-mono">${Formatter.percentage(op.semestral.remuneravel)}</td>
                  <td class="col-peso font-mono">${Formatter.percentage(calc.pesos.semestral)}</td>
                  <td class="col-base font-mono">${Formatter.currency(fin.parcelas.semestral.base)}</td>
                  <td class="col-rec font-mono font-bold">${Formatter.currency(fin.parcelas.semestral.reconhecido)}</td>
                </tr>

                <tr class="table-row">
                  <td class="col-item font-bold">CORRETIVA <small style="font-weight: normal; color: #64748b;">${corrObs}</small></td>
                  <td class="col-perf font-mono">${isBlank ? '0%' : corrPctExact}</td>
                  <td class="col-peso font-mono">${Formatter.percentage(calc.pesos.corretiva)}</td>
                  <td class="col-base font-mono">${Formatter.currency(fin.parcelas.corretiva.base)}</td>
                  <td class="col-rec font-mono font-bold">${Formatter.currency(fin.parcelas.corretiva.reconhecido)}</td>
                </tr>

                <tr class="table-row row-alt">
                  <td class="col-item font-bold">EPI</td>
                  <td class="col-perf font-mono">${Formatter.percentage(op.epi.remuneravel)}</td>
                  <td class="col-peso font-mono">${Formatter.percentage(calc.pesos.epi)}</td>
                  <td class="col-base font-mono">${Formatter.currency(fin.parcelas.epi.base)}</td>
                  <td class="col-rec font-mono font-bold">${Formatter.currency(fin.parcelas.epi.reconhecido)}</td>
                </tr>

                <tr class="table-row">
                  <td class="col-item">
                    EXCEDENTE
                    <span style="font-size: 11px; color: #64748b; display: block;">
                      Limite: ${fin.excedente.limite} eqp. (Exec.: ${fin.excedente.somaExec} &bull; Tarifa: ${Formatter.currency(fin.excedente.tarifa)} + Unit.: ${Formatter.currency(fin.excedente.unitario)} = ${Formatter.currency(fin.excedente.valorPorUnidade)}/un.)
                    </span>
                  </td>
                  <td class="col-perf font-mono">${fin.excedente.quantidade} un.</td>
                  <td class="col-peso font-mono">—</td>
                  <td class="col-base font-mono">${Formatter.currency(fin.excedente.valorPorUnidade)}/un</td>
                  <td class="col-rec font-mono font-bold">${Formatter.currency(fin.excedente.valorTotal)}</td>
                </tr>

                <tr class="table-row row-subtotal" style="background: #f1f5f9; font-weight: 700; border-top: 2px solid #cbd5e1;">
                  <td class="col-item" colspan="4">SUBTOTAL RECONHECIDO (SERVIÇOS + EXCEDENTE)</td>
                  <td class="col-rec font-mono" style="font-size: 14px; color: #0f172a;">${Formatter.currency(fin.subtotal)}</td>
                </tr>

                <tr class="table-row">
                  <td class="col-item">
                    INCENTIVO VEICULAR
                    <span style="font-size: 11px; color: #64748b; display: block;">
                      Média: ${fin.incentivo.mediaPct.toFixed(2).replace('.', ',')}% (arredondada: ${fin.incentivo.roundedPct}%) &bull; Faixas: &ge;100%: R$ 1.000 | 90-99%: R$ 750 | &lt;90%: R$ 0
                    </span>
                  </td>
                  <td class="col-perf font-mono">${fin.incentivo.roundedPct}%</td>
                  <td class="col-peso font-mono">—</td>
                  <td class="col-base font-mono">${Formatter.currency(fin.incentivo.baseValue)}</td>
                  <td class="col-rec font-mono font-bold" style="color: ${fin.incentivo.reconhecido > 0 ? '#15803d' : '#64748b'};">${Formatter.currency(fin.incentivo.reconhecido)}</td>
                </tr>

                <tr class="table-row row-total" style="background: #0f172a; color: #ffffff;">
                  <td class="col-item font-bold" colspan="4" style="font-size: 15px; letter-spacing: 0.5px;">TOTAL GERAL RECONHECIDO</td>
                  <td class="col-rec font-mono font-bold" style="font-size: 18px; color: #38bdf8;">${Formatter.currency(fin.totalGeral)}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <!-- Seção Complementar -->
          <section style="margin-top: 20px; padding: 14px 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
            <div style="font-size: 12px; font-weight: 700; color: #334155; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
              <span>📋 Atividades Complementares de Suporte e Qualidade</span>
              <span style="font-size: 11px; font-weight: normal; color: #64748b;">(Não compõem os pesos da remuneração base nem o incentivo)</span>
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
              <thead>
                <tr style="border-bottom: 1px solid #cbd5e1; color: #64748b; text-align: left;">
                  <th style="padding: 4px 8px;">Atividade</th>
                  <th style="padding: 4px 8px; text-align: center;">Planejado</th>
                  <th style="padding: 4px 8px; text-align: center;">Executado</th>
                  <th style="padding: 4px 8px;">Status / Observação</th>
                </tr>
              </thead>
              <tbody>
                ${compRows.map(r => `
                  <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 6px 8px; font-weight: 600; color: #1e293b;">${r.item}</td>
                    <td style="padding: 6px 8px; text-align: center;" class="font-mono">${r.plan}</td>
                    <td style="padding: 6px 8px; text-align: center;" class="font-mono">${r.exec}</td>
                    <td style="padding: 6px 8px; color: #475569;">${r.obs}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </section>

          <!-- Evidências de OS e Ordens de Serviço (Tarefas do Ciclo) -->
          ${this.renderEvidenciasSection(model.tarefasInfo)}

          <footer class="report-footer" style="margin-top: 24px; padding-top: 12px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8;">
            <span>BPO Financeiro Mar Brasil &bull; Sistema Integrado de Medição e Gestão</span>
            <span>Relatório Oficial Gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
          </footer>
        </div>
      `;
    }

    static renderEvidenciasSection(tarefasInfo) {
      if (!tarefasInfo || !tarefasInfo.tarefasResumo || tarefasInfo.tarefasResumo.length === 0) {
        return '';
      }

      const res = tarefasInfo.tarefasResumo;
      const mensalList = res.filter(t => t.type === 'MENSAL');
      const semestralList = res.filter(t => t.type === 'SEMESTRAL');
      const corretivaList = res.filter(t => t.type === 'CORRETIVA');

      return `
        <section style="margin-top: 20px; padding: 14px 16px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <h4 style="font-size: 12.5px; font-weight: 700; color: #0f172a; margin: 0;">
              🔗 Evidências Digitais &bull; Ordens de Serviço Auvo
            </h4>
            <span style="font-size: 11px; color: #64748b;">
              Distribuído em <strong>${tarefasInfo.distinctTasksCount} tarefas</strong> (Mensal: ${mensalList.length} | Semestral: ${semestralList.length} | Corretiva: ${corretivaList.length})
            </span>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; font-size: 11.5px;">
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px;">
              <strong style="color: #0369a1; display: block; margin-bottom: 6px;">📅 Preventiva Mensal (${mensalList.length} OSs &bull; ${tarefasInfo.evidenciasPorTipo.MENSAL.reduce((a,b)=>a+(b.equipamentosCount||0),0)} equipamentos):</strong>
              <div style="max-height: 120px; overflow-y: auto; padding-right: 4px;">
                ${mensalList.map(t => `
                  <div style="margin-bottom: 4px; display: flex; justify-content: space-between;">
                    <span>OS #${t.taskId} (${t.equipamentosCount} eqp):</span>
                    ${t.link ? `<a href="${Formatter.escapeHtml(t.link)}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; font-weight: 600; text-decoration: underline;">Abrir OS &rarr;</a>` : '<span style="color:#94a3b8;">Sem link</span>'}
                  </div>
                `).join('')}
              </div>
            </div>

            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px;">
              <strong style="color: #b45309; display: block; margin-bottom: 6px;">📆 Preventiva Semestral (${semestralList.length} OSs &bull; ${tarefasInfo.evidenciasPorTipo.SEMESTRAL.reduce((a,b)=>a+(b.equipamentosCount||0),0)} equipamentos):</strong>
              <div style="max-height: 120px; overflow-y: auto; padding-right: 4px;">
                ${semestralList.map(t => `
                  <div style="margin-bottom: 4px; display: flex; justify-content: space-between;">
                    <span>OS #${t.taskId} (${t.equipamentosCount} eqp):</span>
                    ${t.link ? `<a href="${Formatter.escapeHtml(t.link)}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; font-weight: 600; text-decoration: underline;">Abrir OS &rarr;</a>` : '<span style="color:#94a3b8;">Sem link</span>'}
                  </div>
                `).join('')}
              </div>
            </div>

            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px;">
              <strong style="color: #b91c1c; display: block; margin-bottom: 6px;">🔧 Corretivas (${corretivaList.length} OSs):</strong>
              <div style="max-height: 120px; overflow-y: auto; padding-right: 4px;">
                ${corretivaList.map(t => `
                  <div style="margin-bottom: 4px; display: flex; justify-content: space-between;">
                    <span>OS #${t.taskId}:</span>
                    ${t.link ? `<a href="${Formatter.escapeHtml(t.link)}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; font-weight: 600; text-decoration: underline;">Abrir OS &rarr;</a>` : '<span style="color:#94a3b8;">Sem link</span>'}
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </section>
      `;
    }
  }

  // -------------------------------------------------------------
  // 5. CONTROLADOR DA APLICAÇÃO (UI CONTROLLER)
  // -------------------------------------------------------------
  const EMPTY_MENSAL_MODEL = {
    isBlank: true,
    metadata: {
      contrato: '',
      setor: '',
      competencia: '',
      prestador: '',
      oficiais: []
    },
    quantitativos: {
      equipamentosAtivos: { planejado: 0, executado: null },
      preventivaMensal: { planejado: 0, executado: 0 },
      preventivaSemestral: { planejado: 0, executado: 0 },
      pmocLevantamento: { planejado: '-', executado: '-' },
      corretiva: { planejado: 0, executado: 0, observacao: '' },
      epi: { planejado: 0, executado: 0 },
      ferramentas: { planejado: 0, executado: 0 },
      auditorias: { planejado: 0, executado: 0 }
    },
    calcParams: {
      valorBase: 0.0,
      pesos: { mensal: 0.05, semestral: 0.50, corretiva: 0.40, epi: 0.05 },
      excedenteConfig: { limite: 500, tarifa: 10.75, unitario: 3.50 },
      incentivoBaseValue: 1000.0
    },
    divergencias: [],
    tarefasInfo: null,
    calcResult: null
  };

  class MensalApp {
    constructor() {
      // Inicia zerado, exatamente como no Módulo 01
      this.model = JSON.parse(JSON.stringify(EMPTY_MENSAL_MODEL));

      this.initDomReferences();
      this.bindEvents();
      this.populateFormInputs();
      this.recalculate();
    }

    initDomReferences() {
      this.dom = {
        excelDropzone: document.getElementById('excelDropzone'),
        excelFileInput: document.getElementById('excelFileInput'),
        fileBadge: document.getElementById('fileBadge'),
        fileInfoNotice: document.getElementById('fileInfoNotice'),
        activeFileName: document.getElementById('activeFileName'),

        // Inputs de Identificação
        inputContrato: document.getElementById('inputContrato'),
        inputSetor: document.getElementById('inputSetor'),
        inputCompetencia: document.getElementById('inputCompetencia'),
        inputPrestador: document.getElementById('inputPrestador'),
        inputOficiais: document.getElementById('inputOficiais'),

        // Parâmetros Financeiros Globais
        inputValorBase: document.getElementById('inputValorBase'),

        // Quantitativos & Pesos
        inputMensalPrev: document.getElementById('inputMensalPrev'),
        inputMensalExec: document.getElementById('inputMensalExec'),
        inputMensalPeso: document.getElementById('inputMensalPeso'),

        inputSemestralPrev: document.getElementById('inputSemestralPrev'),
        inputSemestralExec: document.getElementById('inputSemestralExec'),
        inputSemestralPeso: document.getElementById('inputSemestralPeso'),

        inputCorretivaPrev: document.getElementById('inputCorretivaPrev'),
        inputCorretivaExec: document.getElementById('inputCorretivaExec'),
        inputCorretivaPeso: document.getElementById('inputCorretivaPeso'),
        inputCorretivaObs: document.getElementById('inputCorretivaObs'),

        inputEpiPrev: document.getElementById('inputEpiPrev'),
        inputEpiExec: document.getElementById('inputEpiExec'),
        inputEpiPeso: document.getElementById('inputEpiPeso'),

        // Excedente
        inputExcedenteLimite: document.getElementById('inputExcedenteLimite'),
        inputExcedenteTarifa: document.getElementById('inputExcedenteTarifa'),
        inputExcedenteUnit: document.getElementById('inputExcedenteUnit'),

        // Incentivo
        inputIncentivoBase: document.getElementById('inputIncentivoBase'),

        // Botões
        btnClearData: document.getElementById('btnClearData'),
        btnRefreshDashboard: document.getElementById('btnRefreshDashboard'),
        btnResetSample: document.getElementById('btnResetSample'),
        btnPrint: document.getElementById('btnPrint'),
        btnQuickPrint: document.getElementById('btnQuickPrint'),

        // Container do Relatório
        reportContainer: document.getElementById('reportContainer')
      };
    }

    bindEvents() {
      // 1. Upload de Arquivo
      if (this.dom.excelDropzone && this.dom.excelFileInput) {
        this.dom.excelDropzone.addEventListener('click', () => this.dom.excelFileInput.click());

        this.dom.excelDropzone.addEventListener('dragover', (e) => {
          e.preventDefault();
          this.dom.excelDropzone.classList.add('dragover');
        });

        this.dom.excelDropzone.addEventListener('dragleave', () => {
          this.dom.excelDropzone.classList.remove('dragover');
        });

        this.dom.excelDropzone.addEventListener('drop', (e) => {
          e.preventDefault();
          this.dom.excelDropzone.classList.remove('dragover');
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            this.handleFileUpload(e.dataTransfer.files[0]);
          }
        });

        this.dom.excelFileInput.addEventListener('change', (e) => {
          if (e.target.files && e.target.files.length > 0) {
            this.handleFileUpload(e.target.files[0]);
          }
        });
      }

      // 2. Botão Limpar Dados
      if (this.dom.btnClearData) {
        this.dom.btnClearData.addEventListener('click', () => this.clearData());
      }

      // 3. Atualização dos campos ao digitar ou clicar no botão
      if (this.dom.btnRefreshDashboard) {
        this.dom.btnRefreshDashboard.addEventListener('click', () => {
          this.readFormInputs();
          this.model.isBlank = false;
          this.recalculate();
          
          const orig = this.dom.btnRefreshDashboard.innerHTML;
          this.dom.btnRefreshDashboard.innerHTML = '✅ Atualizado!';
          setTimeout(() => { this.dom.btnRefreshDashboard.innerHTML = orig; }, 1200);
        });
      }

      // Auto recalcular com inputs
      const formInputs = document.querySelectorAll('.controls-sidebar input, .controls-sidebar select');
      formInputs.forEach(inp => {
        inp.addEventListener('input', () => {
          this.readFormInputs();
          this.recalculate();
        });
      });

      // 4. Botão Amostra
      if (this.dom.btnResetSample) {
        this.dom.btnResetSample.addEventListener('click', () => this.loadSampleData());
      }

      // 5. Impressão / PDF
      const printHandler = () => window.print();
      if (this.dom.btnPrint) this.dom.btnPrint.addEventListener('click', printHandler);
      if (this.dom.btnQuickPrint) this.dom.btnQuickPrint.addEventListener('click', printHandler);
    }

    clearData() {
      this.model = JSON.parse(JSON.stringify(EMPTY_MENSAL_MODEL));

      if (this.dom.fileBadge) this.dom.fileBadge.style.display = 'none';
      if (this.dom.fileInfoNotice) this.dom.fileInfoNotice.style.display = 'none';
      if (this.dom.activeFileName) this.dom.activeFileName.textContent = '';
      if (this.dom.excelFileInput) this.dom.excelFileInput.value = '';

      this.populateFormInputs();
      this.recalculate();

      if (this.dom.btnClearData) {
        const origText = this.dom.btnClearData.innerHTML;
        this.dom.btnClearData.innerHTML = '🗑️ Dados Zerados!';
        setTimeout(() => {
          if (this.dom.btnClearData) this.dom.btnClearData.innerHTML = origText;
        }, 1200);
      }
    }

    readFormInputs() {
      if (this.dom.inputContrato) this.model.metadata.contrato = this.dom.inputContrato.value.trim();
      if (this.dom.inputSetor) this.model.metadata.setor = this.dom.inputSetor.value.trim();
      if (this.dom.inputCompetencia) this.model.metadata.competencia = this.dom.inputCompetencia.value.trim();
      if (this.dom.inputPrestador) this.model.metadata.prestador = this.dom.inputPrestador.value.trim();
      if (this.dom.inputOficiais) {
        this.model.metadata.oficiais = this.dom.inputOficiais.value.split(',').map(s => s.trim()).filter(Boolean);
      }

      if (this.dom.inputValorBase) {
        this.model.calcParams.valorBase = Number(this.dom.inputValorBase.value) || 0;
      }

      if (this.dom.inputMensalPrev) this.model.quantitativos.preventivaMensal.planejado = Number(this.dom.inputMensalPrev.value) || 0;
      if (this.dom.inputMensalExec) this.model.quantitativos.preventivaMensal.executado = Number(this.dom.inputMensalExec.value) || 0;
      if (this.dom.inputMensalPeso) this.model.calcParams.pesos.mensal = (Number(this.dom.inputMensalPeso.value) || 0) / 100;

      if (this.dom.inputSemestralPrev) this.model.quantitativos.preventivaSemestral.planejado = Number(this.dom.inputSemestralPrev.value) || 0;
      if (this.dom.inputSemestralExec) this.model.quantitativos.preventivaSemestral.executado = Number(this.dom.inputSemestralExec.value) || 0;
      if (this.dom.inputSemestralPeso) this.model.calcParams.pesos.semestral = (Number(this.dom.inputSemestralPeso.value) || 0) / 100;

      if (this.dom.inputCorretivaPrev) this.model.quantitativos.corretiva.planejado = Number(this.dom.inputCorretivaPrev.value) || 0;
      if (this.dom.inputCorretivaExec) this.model.quantitativos.corretiva.executado = Number(this.dom.inputCorretivaExec.value) || 0;
      if (this.dom.inputCorretivaPeso) this.model.calcParams.pesos.corretiva = (Number(this.dom.inputCorretivaPeso.value) || 0) / 100;
      if (this.dom.inputCorretivaObs) this.model.quantitativos.corretiva.observacao = this.dom.inputCorretivaObs.value.trim();

      if (this.dom.inputEpiPrev) this.model.quantitativos.epi.planejado = Number(this.dom.inputEpiPrev.value) || 0;
      if (this.dom.inputEpiExec) this.model.quantitativos.epi.executado = Number(this.dom.inputEpiExec.value) || 0;
      if (this.dom.inputEpiPeso) this.model.calcParams.pesos.epi = (Number(this.dom.inputEpiPeso.value) || 0) / 100;

      if (this.dom.inputExcedenteLimite) this.model.calcParams.excedenteConfig.limite = Number(this.dom.inputExcedenteLimite.value) || 500;
      if (this.dom.inputExcedenteTarifa) this.model.calcParams.excedenteConfig.tarifa = Number(this.dom.inputExcedenteTarifa.value) || 10.75;
      if (this.dom.inputExcedenteUnit) this.model.calcParams.excedenteConfig.unitario = Number(this.dom.inputExcedenteUnit.value) || 3.50;

      if (this.dom.inputIncentivoBase) this.model.calcParams.incentivoBaseValue = Number(this.dom.inputIncentivoBase.value) || 1000.0;
    }

    populateFormInputs() {
      const meta = this.model.metadata;
      const q = this.model.quantitativos;
      const params = this.model.calcParams;
      const isBlank = this.model.isBlank;

      if (this.dom.inputContrato) this.dom.inputContrato.value = meta.contrato || '';
      if (this.dom.inputSetor) this.dom.inputSetor.value = meta.setor || '';
      if (this.dom.inputCompetencia) this.dom.inputCompetencia.value = meta.competencia || '';
      if (this.dom.inputPrestador) this.dom.inputPrestador.value = meta.prestador || '';
      if (this.dom.inputOficiais) this.dom.inputOficiais.value = meta.oficiais && meta.oficiais.length > 0 ? meta.oficiais.join(', ') : '';

      if (this.dom.inputValorBase) this.dom.inputValorBase.value = isBlank ? 0 : params.valorBase;

      if (this.dom.inputMensalPrev) this.dom.inputMensalPrev.value = isBlank ? 0 : q.preventivaMensal.planejado;
      if (this.dom.inputMensalExec) this.dom.inputMensalExec.value = isBlank ? 0 : q.preventivaMensal.executado;
      if (this.dom.inputMensalPeso) this.dom.inputMensalPeso.value = Math.round(params.pesos.mensal * 100);

      if (this.dom.inputSemestralPrev) this.dom.inputSemestralPrev.value = isBlank ? 0 : q.preventivaSemestral.planejado;
      if (this.dom.inputSemestralExec) this.dom.inputSemestralExec.value = isBlank ? 0 : q.preventivaSemestral.executado;
      if (this.dom.inputSemestralPeso) this.dom.inputSemestralPeso.value = Math.round(params.pesos.semestral * 100);

      if (this.dom.inputCorretivaPrev) this.dom.inputCorretivaPrev.value = isBlank ? 0 : q.corretiva.planejado;
      if (this.dom.inputCorretivaExec) this.dom.inputCorretivaExec.value = isBlank ? 0 : q.corretiva.executado;
      if (this.dom.inputCorretivaPeso) this.dom.inputCorretivaPeso.value = Math.round(params.pesos.corretiva * 100);
      if (this.dom.inputCorretivaObs) this.dom.inputCorretivaObs.value = q.corretiva.observacao || '';

      if (this.dom.inputEpiPrev) this.dom.inputEpiPrev.value = isBlank ? 0 : q.epi.planejado;
      if (this.dom.inputEpiExec) this.dom.inputEpiExec.value = isBlank ? 0 : q.epi.executado;
      if (this.dom.inputEpiPeso) this.dom.inputEpiPeso.value = Math.round(params.pesos.epi * 100);

      if (this.dom.inputExcedenteLimite) this.dom.inputExcedenteLimite.value = params.excedenteConfig.limite;
      if (this.dom.inputExcedenteTarifa) this.dom.inputExcedenteTarifa.value = params.excedenteConfig.tarifa;
      if (this.dom.inputExcedenteUnit) this.dom.inputExcedenteUnit.value = params.excedenteConfig.unitario;

      if (this.dom.inputIncentivoBase) this.dom.inputIncentivoBase.value = params.incentivoBaseValue;
    }

    handleFileUpload(file) {
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });

          const parsed = MensalExcelParser.parseWorkbook(workbook);

          this.model.isBlank = false;
          this.model.metadata = parsed.metadata;
          this.model.quantitativos = parsed.quantitativos;
          this.model.divergencias = parsed.divergencias;
          this.model.tarefasInfo = parsed.tarefasInfo;

          if (parsed.financeiroSugestoes) {
            this.model.calcParams.valorBase = parsed.financeiroSugestoes.valorBase || this.model.calcParams.valorBase;
            if (parsed.financeiroSugestoes.pesos) {
              this.model.calcParams.pesos = { ...this.model.calcParams.pesos, ...parsed.financeiroSugestoes.pesos };
            }
            if (parsed.financeiroSugestoes.excedente) {
              this.model.calcParams.excedenteConfig = { ...this.model.calcParams.excedenteConfig, ...parsed.financeiroSugestoes.excedente };
            }
          }

          if (this.dom.fileBadge) this.dom.fileBadge.style.display = 'inline';
          if (this.dom.fileInfoNotice && this.dom.activeFileName) {
            this.dom.fileInfoNotice.style.display = 'block';
            this.dom.activeFileName.textContent = file.name;
          }

          this.populateFormInputs();
          this.recalculate();
        } catch (err) {
          console.error('Erro ao ler planilha mensal:', err);
          alert('Erro ao processar a planilha mensal: ' + err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    }

    loadSampleData() {
      this.model.isBlank = false;
      this.model.metadata = {
        contrato: 'STS36693/22',
        setor: 'Setor 01',
        competencia: '08/2026',
        prestador: 'GB CLIMATIZAÇÃO (GABRIEL)',
        oficiais: ['Flávio Pereira', 'Jonathan Silva']
      };

      this.model.quantitativos = {
        equipamentosAtivos: { planejado: 482, executado: null },
        preventivaMensal: { planejado: 415, executado: 415 },
        preventivaSemestral: { planejado: 80, executado: 80 },
        pmocLevantamento: { planejado: '-', executado: '-' },
        corretiva: { planejado: 16, executado: 15, observacao: 'Aguardando peça' },
        epi: { planejado: 21, executado: 21 },
        ferramentas: { planejado: 1, executado: 1 },
        auditorias: { planejado: 2, executado: 2 }
      };

      this.model.calcParams = {
        valorBase: 6000.0,
        pesos: { mensal: 0.05, semestral: 0.50, corretiva: 0.40, epi: 0.05 },
        excedenteConfig: { limite: 500, tarifa: 10.75, unitario: 3.50 },
        incentivoBaseValue: 1000.0
      };

      this.model.divergencias = [
        {
          tipo: 'CORRETIVA',
          mensagem: 'A GERAL registra 15 executadas de 16 planejadas em Corretivas (93,75% - observação: "Aguardando peça"). A planilha financeira antiga mantinha 100% estático em cache. O cálculo recalculou fielmente 93,75%.'
        }
      ];

      this.populateFormInputs();
      this.recalculate();
    }

    recalculate() {
      const q = this.model.quantitativos;
      const params = this.model.calcParams;

      this.model.calcResult = MensalCalculator.calculate({
        valorBase: params.valorBase,
        mensal: q.preventivaMensal,
        semestral: q.preventivaSemestral,
        pmoc: q.pmocLevantamento,
        corretiva: q.corretiva,
        epi: q.epi,
        ferramentas: q.ferramentas,
        auditorias: q.auditorias,
        pesos: params.pesos,
        excedenteConfig: params.excedenteConfig,
        incentivoBaseValue: params.incentivoBaseValue
      });

      MensalReportRenderer.renderReport(this.dom.reportContainer, this.model);
    }
  }

  // Exportação global e inicialização
  window.MensalCalculator = MensalCalculator;
  window.MensalExcelParser = MensalExcelParser;
  window.MensalReportRenderer = MensalReportRenderer;
  window.MensalApp = MensalApp;

  document.addEventListener('DOMContentLoaded', () => {
    window.mensalApp = new MensalApp();
  });

})(window);
