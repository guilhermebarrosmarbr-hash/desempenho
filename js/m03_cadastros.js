/**
 * m03_cadastros.js - Módulo 03: Cadastros Locais e Gestão
 * Técnicos (com nível 01-03, valor por nível, incentivo veicular),
 * Contratos, Setores por Contrato e Tipos de Tarefas com Pesos.
 */
(function(window) {
  'use strict';

  const STORAGE_KEYS = {
    TECNICOS: 'm03_tecnicos_v2',
    CONTRATOS: 'm03_contratos_v1',
    SETORES: 'm03_setores_v1',
    TAREFAS: 'm03_tarefas_v1',
    FATURAMENTOS: 'm03_faturamentos_v1' // { `${competencia}_${tecnicoId}`: { apurado: true, data: ..., total: ... } }
  };

  // Valores padrão dos níveis de técnicos (conforme regra de negócio):
  // Nível 01: R$ 6.000,00 | Nível 02: R$ 5.250,00 | Nível 03: R$ 4.250,00
  const NIVEIS_PADRAO = {
    '1': 6000,
    '2': 5250,
    '3': 4250
  };

  // Dados semente iniciais caso o storage esteja vazio
  const SEED_DATA = {
    contratos: [
      { id: 'cnt-1', codigo: 'STS36693/22', nome: 'SEDUC SANTOS - Climatização PMOC' }
    ],
    setores: [
      { id: 'set-1', contratoId: 'cnt-1', nome: 'Setor 01' },
      { id: 'set-2', contratoId: 'cnt-1', nome: 'Setor 02' }
    ],
    tarefas: [
      { id: 'tar-1', nome: 'MENSAL', peso: 5 },
      { id: 'tar-2', nome: 'SEMESTRAL', peso: 50 },
      { id: 'tar-3', nome: 'CORRETIVA', peso: 40 },
      { id: 'tar-4', nome: 'EPI', peso: 5 }
    ],
    tecnicos: [
      {
        id: 'tec-1',
        nome: 'Flávio Pereira',
        nivel: '1',
        valorContrato: 6000,
        hasIncentivoVeicular: true,
        contratoId: 'cnt-1',
        setorId: 'set-1'
      },
      {
        id: 'tec-2',
        nome: 'Jonathan Silva',
        nivel: '1',
        valorContrato: 6000,
        hasIncentivoVeicular: true,
        contratoId: 'cnt-1',
        setorId: 'set-1'
      }
    ]
  };

  function loadJson(key, defaultVal) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : defaultVal;
    } catch (e) {
      console.warn('Falha ao ler localStorage:', key, e);
      return defaultVal;
    }
  }

  function saveJson(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      console.error('Falha ao salvar localStorage:', key, e);
    }
  }

  const M03Cadastros = {
    init() {
      if (!localStorage.getItem(STORAGE_KEYS.CONTRATOS)) {
        saveJson(STORAGE_KEYS.CONTRATOS, SEED_DATA.contratos);
      }
      if (!localStorage.getItem(STORAGE_KEYS.SETORES)) {
        saveJson(STORAGE_KEYS.SETORES, SEED_DATA.setores);
      }
      if (!localStorage.getItem(STORAGE_KEYS.TAREFAS)) {
        saveJson(STORAGE_KEYS.TAREFAS, SEED_DATA.tarefas);
      }
      if (!localStorage.getItem(STORAGE_KEYS.TECNICOS)) {
        saveJson(STORAGE_KEYS.TECNICOS, SEED_DATA.tecnicos);
      }
    },

    // --- CONTRATOS ---
    getContratos() {
      this.init();
      return loadJson(STORAGE_KEYS.CONTRATOS, []);
    },
    saveContrato(contrato) {
      const lista = this.getContratos();
      if (!contrato.id) {
        contrato.id = 'cnt-' + Date.now();
        lista.push(contrato);
      } else {
        const idx = lista.findIndex(c => c.id === contrato.id);
        if (idx >= 0) lista[idx] = contrato;
        else lista.push(contrato);
      }
      saveJson(STORAGE_KEYS.CONTRATOS, lista);
      return contrato;
    },
    deleteContrato(id) {
      const lista = this.getContratos().filter(c => c.id !== id);
      saveJson(STORAGE_KEYS.CONTRATOS, lista);
      // remover setores associados
      const setores = this.getSetores().filter(s => s.contratoId !== id);
      saveJson(STORAGE_KEYS.SETORES, setores);
    },

    // --- SETORES ---
    getSetores(contratoId = null) {
      this.init();
      const todos = loadJson(STORAGE_KEYS.SETORES, []);
      if (contratoId) {
        return todos.filter(s => s.contratoId === contratoId);
      }
      return todos;
    },
    saveSetor(setor) {
      const lista = this.getSetores();
      if (!setor.id) {
        setor.id = 'set-' + Date.now();
        lista.push(setor);
      } else {
        const idx = lista.findIndex(s => s.id === setor.id);
        if (idx >= 0) lista[idx] = setor;
        else lista.push(setor);
      }
      saveJson(STORAGE_KEYS.SETORES, lista);
      return setor;
    },
    deleteSetor(id) {
      const lista = this.getSetores().filter(s => s.id !== id);
      saveJson(STORAGE_KEYS.SETORES, lista);
    },

    // --- TIPOS DE TAREFAS ---
    getTarefas() {
      this.init();
      return loadJson(STORAGE_KEYS.TAREFAS, []);
    },
    saveTarefa(tarefa) {
      const lista = this.getTarefas();
      if (!tarefa.id) {
        tarefa.id = 'tar-' + Date.now();
        lista.push(tarefa);
      } else {
        const idx = lista.findIndex(t => t.id === tarefa.id);
        if (idx >= 0) lista[idx] = tarefa;
        else lista.push(tarefa);
      }
      saveJson(STORAGE_KEYS.TAREFAS, lista);
      return tarefa;
    },
    deleteTarefa(id) {
      const lista = this.getTarefas().filter(t => t.id !== id);
      saveJson(STORAGE_KEYS.TAREFAS, lista);
    },

    // --- TÉCNICOS ---
    getTecnicos() {
      this.init();
      return loadJson(STORAGE_KEYS.TECNICOS, []);
    },
    saveTecnico(tec) {
      const lista = this.getTecnicos();
      if (!tec.id) {
        tec.id = 'tec-' + Date.now();
        lista.push(tec);
      } else {
        const idx = lista.findIndex(t => t.id === tec.id);
        if (idx >= 0) lista[idx] = tec;
        else lista.push(tec);
      }
      saveJson(STORAGE_KEYS.TECNICOS, lista);
      return tec;
    },
    deleteTecnico(id) {
      const lista = this.getTecnicos().filter(t => t.id !== id);
      saveJson(STORAGE_KEYS.TECNICOS, lista);
    },
    getValorPadraoNivel(nivel) {
      return NIVEIS_PADRAO[String(nivel)] || 6000;
    },

    // --- FATURAMENTOS / APURAÇÃO DO CICLO ---
    getFaturamento(competencia, tecnicoId) {
      const store = loadJson(STORAGE_KEYS.FATURAMENTOS, {});
      const key = `${competencia}_${tecnicoId}`;
      return store[key] || null;
    },
    setFaturamento(competencia, tecnicoId, dados) {
      const store = loadJson(STORAGE_KEYS.FATURAMENTOS, {});
      const key = `${competencia}_${tecnicoId}`;
      store[key] = {
        ...dados,
        competencia,
        tecnicoId,
        updatedAt: new Date().toISOString()
      };
      saveJson(STORAGE_KEYS.FATURAMENTOS, store);
      
      // Persistência assíncrona no Supabase (se configurado)
      if (window.BpoSupabase && window.BpoSupabase.isConfigured()) {
        try {
          const tec = this.getTecnicos().find(t => t.id === tecnicoId);
          const payload = {
            idempotency_key: `fat_m03_${competencia}_${tecnicoId}`,
            competence_month: competencia,
            prestador_nome: tec ? tec.nome : 'Técnico',
            categoria: 'PMOC_MENSAL',
            total_apurado: dados.totalGeral || 0.0,
            report_data: {
              tecnico: tec,
              dados: dados,
              updatedAt: new Date().toISOString()
            }
          };
          window.BpoSupabase.request('monthly_performance_reports', {
            method: 'POST',
            body: JSON.stringify(payload)
          }).catch(err => {
            console.warn('Persistência Supabase Módulo 03:', err.message);
          });
        } catch (e) {
          console.warn('Erro ao disparar gravação Supabase:', e);
        }
      }
    },
    removerFaturamento(competencia, tecnicoId) {
      const store = loadJson(STORAGE_KEYS.FATURAMENTOS, {});
      const key = `${competencia}_${tecnicoId}`;
      delete store[key];
      saveJson(STORAGE_KEYS.FATURAMENTOS, store);

      // Exclusão no Supabase (se configurado)
      if (window.BpoSupabase && window.BpoSupabase.isConfigured()) {
        try {
          const idKey = `fat_m03_${competencia}_${tecnicoId}`;
          window.BpoSupabase.request(`monthly_performance_reports?idempotency_key=eq.${idKey}`, {
            method: 'DELETE'
          }).catch(err => {
            console.warn('Exclusão Supabase Módulo 03:', err.message);
          });
        } catch (e) {
          console.warn('Erro ao disparar exclusão Supabase:', e);
        }
      }
    },
    listarFaturamentos(competencia) {
      const store = loadJson(STORAGE_KEYS.FATURAMENTOS, {});
      const res = {};
      Object.keys(store).forEach(k => {
        if (k.startsWith(`${competencia}_`)) {
          const tecId = k.replace(`${competencia}_`, '');
          res[tecId] = store[k];
        }
      });
      return res;
    }
  };

  M03Cadastros.init();
  window.M03Cadastros = M03Cadastros;
})(window);

