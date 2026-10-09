/**
 * Integração com API Auvo Dashboard
 * Substitui a dependência de planilhas.
 * Agrupa por Contrato (uma linha por contrato = um setor/técnico).
 *
 * Regras de contagem:
 *  - PREVISTA: número de equipamentos agendados (t.equipmentsId)
 *  - REALIZADA: número de questionários com equipamento válido preenchido
 *  - Técnico: primeiro colaborador listado na API (responsável principal)
 */

class AuvoClient {
  constructor(baseUrl, timeoutMs = 15000, maxConcurrency = 3) {
    // Se estiver rodando em um servidor web (ex: Vercel, Github Pages), usa o proxy nativo da Vercel
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
      this.baseUrl = window.location.origin + '/proxy-auvo';
    } else {
      // Se estiver no arquivo local, usa o proxy.js
      this.baseUrl = (baseUrl || 'http://localhost:9001').replace(/\/$/, '');
    }
    this.timeoutMs = timeoutMs;
    this.maxConcurrency = maxConcurrency;
  }

  async fetchWithRetry(path, retries = 3) {
    const url = `${this.baseUrl}${path}`;
    let attempt = 0;
    while (attempt < retries) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`Auvo API Error: HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        attempt++;
        if (attempt >= retries) throw err;
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
      }
    }
  }

  async getContracts() {
    return this.fetchWithRetry('/api/contracts');
  }

  async getDashboardAll(startDate, endDate, excludeContracts = []) {
    const contracts = await this.getContracts();
    const validContracts = contracts.filter(c => !excludeContracts.includes(c.id));

    const results = [];
    for (let i = 0; i < validContracts.length; i += this.maxConcurrency) {
      const chunk = validContracts.slice(i, i + this.maxConcurrency);
      const promises = chunk.map(c =>
        this.fetchWithRetry(`/api/dashboard/${c.id}?start_date=${startDate}&end_date=${endDate}`)
          .then(data => ({ contractId: c.id, contractName: c.name, data, success: true }))
          .catch(error => ({ contractId: c.id, contractName: c.name, error: error.message, success: false }))
      );
      results.push(...(await Promise.all(promises)));
    }
    return results;
  }
}

class AuvoService {
  constructor() {
    this.client = new AuvoClient('http://localhost:9001', 15000, 3);
  }

  async syncDashboard(startDate, endDate) {
    // IDs excluídos conforme configuração
    const exclude = [144297, 161437, 161438, 161578, 166291, 166292, 146168];
    const rawData = await this.client.getDashboardAll(startDate, endDate, exclude);
    return this.parseAuvoData(rawData, startDate, endDate);
  }

  /**
   * Converte array JSON (string ou objeto) com segurança
   */
  _parseJsonArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch (e) { return []; }
    }
    return [];
  }

  /**
   * Conta equipamentos agendados em uma tarefa (previsto).
   * Usa equipmentsId (lista de IDs de equipamentos da visita).
   */
  _countPrevisto(task) {
    const ids = this._parseJsonArray(task.equipmentsId);
    return ids.length;
  }

  /**
   * Conta equipamentos efetivamente atendidos em uma tarefa (realizado).
   * Usa questionnaires com questionnaireEquipamentId != 0, mas APENAS se a tarefa estiver finalizada.
   */
  _countRealizado(task) {
    const isFinished = task.taskStatus === 5 || ([1, 2, 3, 4, 6].includes(task.taskStatus) && !!task.signatureName);
    if (!isFinished) return 0;

    const qs = this._parseJsonArray(task.questionnaires);
    return qs.filter(q => q.questionnaireEquipamentId && q.questionnaireEquipamentId !== 0).length;
  }

  /**
   * Retorna lista de datas (YYYY-MM-DD) dos feriados nacionais do Brasil.
   */
  _getBrazilianHolidays(year) {
    const holidays = [
      year+'-01-01', year+'-04-21', year+'-05-01', year+'-09-07',
      year+'-10-12', year+'-11-02', year+'-11-15', year+'-12-25'
    ];
    let a = year % 19; let b = Math.floor(year / 100); let c = year % 100;
    let d = Math.floor(b / 4); let e = b % 4; let f = Math.floor((b + 8) / 25);
    let g = Math.floor((b - f + 1) / 3); let h = (19 * a + b - d - g + 15) % 30;
    let i = Math.floor(c / 4); let k = c % 4; let l = (32 + 2 * e + 2 * i - h - k) % 7;
    let m = Math.floor((a + 11 * h + 22 * l) / 451);
    let month = Math.floor((h + l - 7 * m + 114) / 31);
    let day = ((h + l - 7 * m + 114) % 31) + 1;
    const easter = new Date(Date.UTC(year, month - 1, day));
    const addDays = (date, days) => {
      const r = new Date(date);
      r.setUTCDate(r.getUTCDate() + days);
      return r.toISOString().split('T')[0];
    };
    holidays.push(addDays(easter, -47)); // Carnaval
    holidays.push(addDays(easter, -2));  // Sexta-feira Santa
    holidays.push(addDays(easter, 60));  // Corpus Christi
    return holidays;
  }

  /**
   * Conta dias úteis ignorando finais de semana e feriados.
   */
  _countBusinessDays(startDateStr, endDateStr) {
    const start = new Date(startDateStr + 'T00:00:00Z');
    const end = new Date(endDateStr + 'T23:59:59Z');
    if (start > end) return 0;
    
    const startYear = start.getUTCFullYear();
    const endYear = end.getUTCFullYear();
    const holidays = new Set(this._getBrazilianHolidays(startYear));
    if (endYear !== startYear) {
      this._getBrazilianHolidays(endYear).forEach(h => holidays.add(h));
    }
    
    let bdays = 0;
    let d = new Date(start);
    while (d <= end) {
      const dow = d.getUTCDay();
      const iso = d.toISOString().split('T')[0];
      if (dow !== 0 && dow !== 6 && !holidays.has(iso)) {
        bdays++;
      }
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return bdays;
  }

  /**
   * Processa a resposta do Auvo baseando-se nas regras de negócio.
   * Agrupa por CONTRATO (uma linha = um contrato = um setor/técnico).
   * Exclui contratos B2B.
   */
  parseAuvoData(apiResults, startDateStr, endDateStr) {
    const CATEGORIES = {
      MENSAL:    [175648, 225658, 212644, 221008, 75657],
      SEMESTRAL: [175652, 225657, 212645, 221009, 183425],
      CORRETIVA: [175644, 225659, 212646, 221006, 75652],
      EPI:       [95888]
    };

    const startDateTime = new Date(startDateStr + 'T00:00:00Z').getTime();
    const endDateTime   = new Date(endDateStr   + 'T23:59:59Z').getTime();

    let totalEquipamentosAtivos = 0;
    const rows = [];

    apiResults.forEach(result => {
      if (!result.success || !result.data) return;

      const contractName = result.contractName || '';

      // Exclui contratos B2B
      if (contractName.toUpperCase().includes('B2B')) return;

      const data = result.data;

      // Técnico principal = primeiro colaborador listado na API, mas prioriza quem tem nome de empresa terceirizada
      let primaryTechId = null;
      let primaryTechName = 'Sem Técnico';
      
      if (data.collaborators && data.collaborators.length > 0) {
        const companyWords = ['CLIMATIZA', 'REFRIGERA', 'AR CONDICIONADO', 'CM2D', 'SANTO AR'];
        const companyCollab = data.collaborators.find(c => companyWords.some(w => c.userName.toUpperCase().includes(w)));
        
        if (companyCollab) {
          primaryTechId = companyCollab.userId;
          primaryTechName = companyCollab.userName;
        } else {
          primaryTechId = data.collaborators[0].userId;
          primaryTechName = data.collaborators[0].userName;
        }
      }

      // Total de equipamentos ativos no contrato
      let ativos = 0;
      (data.schools || []).forEach(school => {
        ativos += (school.metrics && school.metrics.ativos) ? school.metrics.ativos : 0;
      });
      totalEquipamentosAtivos += ativos;

      // Deduplicação de taskIDs
      const seenTaskIds = new Set();

      // A Prevista de PMOC é uma proporção fixa do total de equipamentos ativos do contrato.
      // Mensal = Math.floor(ativos * 5/6), Semestral = Math.ceil(ativos * 1/6)
      let mensalPrevista = Math.floor(ativos * (5 / 6));
      let semestralPrevista = Math.ceil(ativos * (1 / 6));
      
      // A Prevista de EPI é a quantidade de dias úteis no período
      let epiPrevista = this._countBusinessDays(startDateStr, endDateStr);
      let epiRealizada = 0;
      
      let mensalRealizada = 0;
      let semestralRealizada = 0;
      let corretivasPrevista = 0, corretivasRealizada = 0;

      // Processa tarefas de cada escola
      (data.schools || []).forEach(school => {
        (school.tasks || []).forEach(task => {
          if (!task.taskID || seenTaskIds.has(task.taskID)) return;
          seenTaskIds.add(task.taskID);

          // Classificação
          const orient = (task.orientation || '').toLowerCase();
          let type = null;
          if (CATEGORIES.MENSAL.includes(task.taskType)    || orient.includes('preventiva mensal')    || orient === 'mensal')    type = 'MENSAL';
          else if (CATEGORIES.SEMESTRAL.includes(task.taskType) || orient.includes('preventiva semestral') || orient === 'semestral') type = 'SEMESTRAL';
          else if (CATEGORIES.CORRETIVA.includes(task.taskType) || orient.includes('corretiva'))                                     type = 'CORRETIVA';
          else if (CATEGORIES.EPI.includes(task.taskType)       || orient.includes('epi') || orient.includes('revisão de epi'))      type = 'EPI';
          if (!type) return;

          if (type === 'MENSAL' || type === 'SEMESTRAL') {
            // Realizado = equipamentos com questionário preenchido
            const real = this._countRealizado(task);

            if (type === 'MENSAL') {
              mensalRealizada   += real;
            } else {
              semestralRealizada += real;
            }
          } else if (type === 'CORRETIVA') {
            // Corretiva: previsto e realizado só são contados se a tarefa foi finalizada (business rule do painel)
            const isFinished = task.taskStatus === 5 || ([1, 2, 3, 4, 6].includes(task.taskStatus) && !!task.signatureName);
            if (isFinished) {
              corretivasPrevista  += 1;
              corretivasRealizada += 1;
            }
          } else if (type === 'EPI') {
            // EPI: contabilizado apenas para o técnico responsável pelo contrato
            const taskUserId = task.idUserTo || task.userId;
            if (taskUserId === primaryTechId) {
              const isFinished = task.taskStatus === 5 || ([1, 2, 3, 4, 6].includes(task.taskStatus) && !!task.signatureName);
              if (isFinished) epiRealizada += 1;
            }
          }
        });
      });

      // Também processa tasks root (nível do contrato) para não perder nada
      (data.tasks || []).forEach(task => {
        if (!task.taskID || seenTaskIds.has(task.taskID)) return;
        seenTaskIds.add(task.taskID);

        const orient = (task.orientation || '').toLowerCase();
        let type = null;
        if (CATEGORIES.MENSAL.includes(task.taskType)    || orient.includes('preventiva mensal')    || orient === 'mensal')    type = 'MENSAL';
        else if (CATEGORIES.SEMESTRAL.includes(task.taskType) || orient.includes('preventiva semestral') || orient === 'semestral') type = 'SEMESTRAL';
        else if (CATEGORIES.CORRETIVA.includes(task.taskType) || orient.includes('corretiva'))                                     type = 'CORRETIVA';
        else if (CATEGORIES.EPI.includes(task.taskType)       || orient.includes('epi') || orient.includes('revisão de epi'))      type = 'EPI';
        if (!type) return;

        if (type === 'MENSAL' || type === 'SEMESTRAL') {
          const real = this._countRealizado(task);
          if (type === 'MENSAL') { mensalRealizada += real; }
          else                   { semestralRealizada += real; }
        } else if (type === 'CORRETIVA') {
          // Corretiva: previsto e realizado só são contados se a tarefa foi finalizada (business rule do painel)
          const isFinished = task.taskStatus === 5 || ([1, 2, 3, 4, 6].includes(task.taskStatus) && !!task.signatureName);
          if (isFinished) {
            corretivasPrevista  += 1;
            corretivasRealizada += 1;
          }
        } else if (type === 'EPI') {
          // EPI: contabilizado apenas para o técnico responsável pelo contrato
          const taskUserId = task.idUserTo || task.userId;
          if (taskUserId === primaryTechId) {
            const isFinished = task.taskStatus === 5 || ([1, 2, 3, 4, 6].includes(task.taskStatus) && !!task.signatureName);
            if (isFinished) epiRealizada += 1;
          }
        }
      });

      rows.push({
        setor:               contractName,
        equipamentosAtivos:  ativos,
        mensalPrevista,
        mensalRealizada,
        semestralPrevista,
        semestralRealizada,
        corretivasPrevista,
        corretivasRealizada,
        epiPrevista,
        epiRealizada,
        techId:   primaryTechId,
        techName: primaryTechName,
        isAuvo:   true
      });
    });

    return { totalEquipamentosAtivos, rows };
  }
}

window.AuvoService = new AuvoService();
