/**
 * api/contracts.js
 * Backend Serverless — Módulo 12: Contratos (Auvo)
 *
 * Funcionalidades:
 * - GET /customergroups: lista grupos de clientes (= contratos)
 * - GET /customergroups/{id}/clients: unidades de cada contrato
 * - GET /customers/{id}: detalhe da unidade (endereço + equipamentos)
 * - GET /equipments: equipamentos vinculados
 * - Cache em memória com sincronização periódica (15 min)
 * - Dados locais de contrato (meta, valores, situação) persistidos em Supabase
 * - Snapshots mensais de contagem de máquinas
 */

const https = require('https');

// ─── Credenciais ─────────────────────────────────────────────────────────────
const AUVO_API_KEY   = process.env.AUVO_API_KEY;
const AUVO_API_TOKEN = process.env.AUVO_API_TOKEN;
const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!AUVO_API_KEY || !AUVO_API_TOKEN) {
  throw new Error('Credenciais da Auvo não configuradas. Defina AUVO_API_KEY e AUVO_API_TOKEN.');
}

const AUVO_BASE = 'api.auvo.com.br';

// ─── Cache em Memória ─────────────────────────────────────────────────────────
let tokenCache = { token: null, expiration: null };
let syncEmProgresso = false;
let ultimaSincronizacao = null;
let cacheContratos = {
  grupos: [],           // customergroups raw
  clientes: {},         // { groupId: [customers] }
  equipamentos: [],     // todos os equipamentos
  timestamp: null
};

// ─── Helpers HTTP ─────────────────────────────────────────────────────────────
function httpsRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: raw ? JSON.parse(raw) : null, raw }); }
        catch { resolve({ status: res.statusCode, data: null, raw }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout HTTPS')); });
    if (body) req.write(body);
    req.end();
  });
}

// ─── Autenticação Auvo ────────────────────────────────────────────────────────
async function getToken(force = false) {
  const now = Date.now();
  if (!force && tokenCache.token && tokenCache.expiration && (tokenCache.expiration - now > 5 * 60000)) {
    return tokenCache.token;
  }
  const payload = JSON.stringify({ apiKey: AUVO_API_KEY, apiToken: AUVO_API_TOKEN });
  const res = await httpsRequest({
    hostname: AUVO_BASE, port: 443, path: '/v2/login', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    timeout: 15000
  }, payload);

  if (res.status !== 200 || !res.data?.result?.accessToken) {
    throw new Error(`Auth Auvo falhou: HTTP ${res.status}`);
  }
  tokenCache.token = res.data.result.accessToken;
  tokenCache.expiration = res.data.result.expiration
    ? new Date(res.data.result.expiration.replace(' ', 'T')).getTime()
    : now + 3 * 3600000;
  return tokenCache.token;
}

// ─── Chamada Auvo com retry ───────────────────────────────────────────────────
async function auvo(path, method = 'GET', body = null, retries = 2) {
  let token = await getToken();
  for (let t = 0; t <= retries; t++) {
    try {
      const opts = {
        hostname: AUVO_BASE, port: 443, path: '/v2' + path, method,
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        timeout: 25000
      };
      if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);
      const res = await httpsRequest(opts, body);
      if (res.status === 401 && t < retries) { token = await getToken(true); continue; }
      if (res.status === 429 && t < retries) { await sleep(1500 * Math.pow(2, t)); continue; }
      return res;
    } catch (err) {
      if (t >= retries) throw err;
      await sleep(1000 * (t + 1));
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Paginação genérica ───────────────────────────────────────────────────────
async function fetchAllPages(basePath, pageSize = 100) {
  const items = [];
  let page = 1;
  while (true) {
    const sep = basePath.includes('?') ? '&' : '?';
    const res = await auvo(`${basePath}${sep}page=${page}&pageSize=${pageSize}`);
    if (res.status !== 200 || !res.data?.result) break;

    const result = res.data.result;
    // Suporta entityList (padrão) e lista direta
    const batch = Array.isArray(result.entityList) ? result.entityList
      : Array.isArray(result) ? result
      : Array.isArray(result.pagedSearchReturnData) ? result.pagedSearchReturnData
      : null;

    if (!batch || batch.length === 0) break;
    items.push(...batch);

    // Verifica se há mais páginas
    const totalPages = result.pageInformation?.totalPages || result.totalPages || null;
    if (totalPages && page >= totalPages) break;
    if (batch.length < pageSize) break;
    page++;
    await sleep(150); // Respeita rate limit 400 req/min
  }
  return items;
}

// ─── Supabase helper ──────────────────────────────────────────────────────────
async function supabaseQuery(table, method, body = null, filters = '') {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}${filters}`);
  const opts = {
    hostname: url.hostname, port: 443,
    path: url.pathname + url.search,
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : ''
    },
    timeout: 15000
  };
  const payload = body ? JSON.stringify(body) : null;
  if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
  const res = await httpsRequest(opts, payload);
  return res;
}

// ─── Sincronização Completa ───────────────────────────────────────────────────
async function sincronizarCompleto() {
  if (syncEmProgresso) return { status: 'already_running' };
  syncEmProgresso = true;
  const inicio = Date.now();

  try {
    // 1. Grupos de clientes (= contratos)
    const grupos = await fetchAllPages('/customergroups');

    // 2. Para cada grupo, buscar seus clientes (unidades)
    const clientesPorGrupo = {};
    for (const grupo of grupos) {
      try {
        const res = await auvo(`/customergroups/${grupo.id}/clients?pageSize=200`);
        if (res.status === 200 && res.data?.result) {
          const result = res.data.result;
          const lista = Array.isArray(result) ? result
            : Array.isArray(result.entityList) ? result.entityList
            : [];
          clientesPorGrupo[grupo.id] = lista;
        } else {
          clientesPorGrupo[grupo.id] = [];
        }
        await sleep(150);
      } catch {
        clientesPorGrupo[grupo.id] = [];
      }
    }

    // 3. Equipamentos (todas as páginas)
    const equipamentos = await fetchAllPages('/equipments');

    // 4. Atualiza cache
    cacheContratos = {
      grupos,
      clientes: clientesPorGrupo,
      equipamentos,
      timestamp: new Date().toISOString()
    };

    // 5. Snapshot mensal
    const anoMes = new Date().toISOString().slice(0, 7); // "YYYY-MM"
    const totalMaquinas = equipamentos.length;
    if (SUPABASE_URL && SUPABASE_KEY) {
      try {
        await supabaseQuery('auvo_contract_snapshots', 'POST', {
          ano_mes: anoMes,
          total_equipamentos: totalMaquinas,
          grupos_count: grupos.length,
          created_at: new Date().toISOString()
        });
      } catch { /* snapshot opcional */ }
    }

    ultimaSincronizacao = {
      timestamp: new Date().toISOString(),
      duracaoMs: Date.now() - inicio,
      grupos: grupos.length,
      equipamentos: equipamentos.length,
      status: 'success'
    };
    return { status: 'success', ...ultimaSincronizacao };

  } catch (err) {
    ultimaSincronizacao = {
      timestamp: new Date().toISOString(),
      duracaoMs: Date.now() - inicio,
      status: 'error',
      error: err.message
    };
    throw err;
  } finally {
    syncEmProgresso = false;
  }
}

// ─── Monta visão consolidada de contratos ─────────────────────────────────────
function montarContratosConsolidados(localData = []) {
  const equipsPorCliente = {};
  for (const eq of cacheContratos.equipamentos) {
    const cid = String(eq.associatedCustomerId || eq.customerId || eq.clientId || '');
    if (!cid) continue;
    if (!equipsPorCliente[cid]) equipsPorCliente[cid] = [];
    equipsPorCliente[cid].push(eq);
  }

  return cacheContratos.grupos.map(grupo => {
    const local = localData.find(l => String(l.auvo_group_id) === String(grupo.id)) || {};
    const unidades = cacheContratos.clientes[grupo.id] || [];

    // Contagem de equipamentos por unidade
    let totalEquips = 0;
    let totalEquipsAtivos = 0;
    let equipsAtivosUnidadesAtivas = 0;
    let unidadesAtivas = 0;
    const unidadesEnriquecidas = unidades.map(u => {
      const equips = equipsPorCliente[String(u.id || u.clientId)] || [];
      const equipsAtivos = equips.filter(eq => eq.active !== false).length;
      totalEquips += equips.length;
      totalEquipsAtivos += equipsAtivos;
      const ativo = u.active !== false && u.deleted !== true;
      if (ativo) {
        unidadesAtivas++;
        equipsAtivosUnidadesAtivas += equipsAtivos;
      }
      return {
        auvoId: u.id || u.clientId,
        nome: u.description || u.name || u.legalName || u.companyName || u.tradeName || 'Sem nome',
        endereco: formatarEndereco(u),
        ativo,
        auvoUrl: `https://app.auvo.com.br/gerenciarClientes/cliente/${u.id || u.clientId}`,
        equipamentos: equips.map(eq => ({
          auvoId: eq.id,
          nome: eq.name || eq.description || 'Sem nome',
          identificacao: eq.identifier || eq.serialNumber || eq.identification || null,
          ativo: eq.active !== false,
          customerId: eq.associatedCustomerId || eq.customerId || eq.clientId
        }))
      };
    });

    // Situação automática
    let situacao = local.situacao_manual || inferirSituacao(unidadesAtivas, unidades.length);
    const situacaoInferida = !local.situacao_manual;

    return {
      auvoId: grupo.id,
      nome: local.nome_exibicao || grupo.name || grupo.description || `Grupo ${grupo.id}`,
      referencia: local.referencia || null,
      responsavel: local.responsavel || null,
      observacoes: local.observacoes || null,
      dataInicio: local.data_inicio || null,
      dataFim: local.data_fim || null,
      situacao,
      situacaoInferida,
      situacaoManual: local.situacao_manual || null,
      maquinasContratadas: local.maquinas_contratadas || null,
      unidades: unidadesEnriquecidas,
      totalUnidades: unidades.length,
      unidadesAtivas,
      totalEquipamentos: totalEquipsAtivos,
      totalEquipamentosGeral: totalEquips,
      equipsAtivosUnidadesAtivas,
      hasLocalData: Object.keys(local).length > 1
    };
  });
}

function inferirSituacao(unidadesAtivas, totalUnidades) {
  if (totalUnidades === 0) return 'a_revisar';
  if (unidadesAtivas === 0) return 'inativo';
  return 'ativo';
}

function formatarEndereco(u) {
  const partes = [u.address, u.addressNumber, u.neighborhood, u.city, u.state].filter(Boolean);
  return partes.length > 0 ? partes.join(', ') : null;
}

// ─── Handler Principal ────────────────────────────────────────────────────────
async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const url = new URL(req.url, 'http://localhost');
    const action = url.searchParams.get('action') || 'list';

    // ── POST: sincronizar ──────────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'sync') {
      try {
        const result = await sincronizarCompleto();
        return res.status(200).json({ success: true, ...result });
      } catch (err) {
        return res.status(500).json({ success: false, error: err.message, lastSync: ultimaSincronizacao });
      }
    }

    // ── POST: salvar metadados locais do contrato ──────────────────────────────
    if (req.method === 'POST' && action === 'save_contract') {
      if (!SUPABASE_URL || !SUPABASE_KEY) {
        return res.status(503).json({ success: false, error: 'Supabase não configurado. Dados locais não disponíveis.' });
      }
      let body = '';
      await new Promise(resolve => { req.on('data', c => body += c); req.on('end', resolve); });
      const data = JSON.parse(body);
      const sbRes = await supabaseQuery('auvo_contracts', 'POST', {
        auvo_group_id: data.auvoId,
        nome_exibicao: data.nomeExibicao,
        referencia: data.referencia,
        responsavel: data.responsavel,
        observacoes: data.observacoes,
        data_inicio: data.dataInicio || null,
        data_fim: data.dataFim || null,
        situacao_manual: data.situacaoManual || null,
        maquinas_contratadas: data.maquinasContratadas || null,
        updated_at: new Date().toISOString()
      });
      return res.status(200).json({ success: sbRes && sbRes.status < 300 });
    }

    // ── POST: salvar valor de equipamento ─────────────────────────────────────
    if (req.method === 'POST' && action === 'save_equip_value') {
      if (!SUPABASE_URL || !SUPABASE_KEY) {
        return res.status(503).json({ success: false, error: 'Supabase não configurado.' });
      }
      let body = '';
      await new Promise(resolve => { req.on('data', c => body += c); req.on('end', resolve); });
      const data = JSON.parse(body);
      const sbRes = await supabaseQuery('auvo_contract_equipment_values', 'POST', {
        auvo_group_id: data.auvoGroupId,
        auvo_equipment_id: data.auvoEquipId,
        valor: data.valor !== '' && data.valor !== null ? parseFloat(data.valor) : null,
        incluido_contrato: data.incluidoContrato !== false,
        updated_at: new Date().toISOString(),
        updated_by: data.updatedBy || 'sistema'
      });
      return res.status(200).json({ success: sbRes && sbRes.status < 300 });
    }

    // ── GET: status ───────────────────────────────────────────────────────────
    if (action === 'status') {
      return res.status(200).json({
        isSyncing: syncEmProgresso,
        lastSync: ultimaSincronizacao,
        totalGrupos: cacheContratos.grupos.length,
        totalEquipamentos: cacheContratos.equipamentos.length
      });
    }

    // ── GET: contrato individual ──────────────────────────────────────────────
    if (action === 'contrato') {
      const grupoId = url.searchParams.get('id');
      if (!grupoId) return res.status(400).json({ success: false, error: 'Parâmetro id obrigatório.' });

      if (cacheContratos.grupos.length === 0) {
        try { await sincronizarCompleto(); } catch { /* usa cache vazio */ }
      }

      let localData = [];
      let valores = [];
      if (SUPABASE_URL && SUPABASE_KEY) {
        try {
          const r1 = await supabaseQuery('auvo_contracts', 'GET', null, `?auvo_group_id=eq.${grupoId}`);
          if (r1?.status === 200 && r1.data) localData = Array.isArray(r1.data) ? r1.data : [r1.data];
          const r2 = await supabaseQuery('auvo_contract_equipment_values', 'GET', null, `?auvo_group_id=eq.${grupoId}`);
          if (r2?.status === 200 && r2.data) valores = Array.isArray(r2.data) ? r2.data : [];
        } catch { /* sem Supabase, retorna sem dados locais */ }
      }

      const todos = montarContratosConsolidados(localData);
      const contrato = todos.find(c => String(c.auvoId) === String(grupoId));
      if (!contrato) return res.status(404).json({ success: false, error: 'Contrato não encontrado.' });

      // Injeta valores nos equipamentos
      const valorMap = {};
      for (const v of valores) valorMap[String(v.auvo_equipment_id)] = v;
      contrato.unidades = contrato.unidades.map(u => ({
        ...u,
        equipamentos: u.equipamentos.map(eq => {
          const v = valorMap[String(eq.auvoId)];
          return {
            ...eq,
            valor: v ? v.valor : undefined,
            incluidoContrato: v ? v.incluido_contrato : true,
            valorPendente: !v
          };
        })
      }));

      // Calcula subtotais e total (apenas equipamentos ativos e incluídos no contrato)
      let totalContrato = 0;
      let totalIncompleto = false;
      contrato.unidades = contrato.unidades.map(u => {
        let subtotal = 0;
        let subtotalIncompleto = false;
        u.equipamentos.forEach(eq => {
          if (eq.ativo && eq.incluidoContrato !== false) {
            if (eq.valor === null || eq.valor === undefined) {
              subtotalIncompleto = true;
              totalIncompleto = true;
            } else {
              subtotal += eq.valor;
              totalContrato += eq.valor;
            }
          }
        });
        return { ...u, subtotal, subtotalIncompleto };
      });
      contrato.totalValor = totalContrato;
      contrato.totalValorIncompleto = totalIncompleto;

      // Snapshot do mês anterior
      let snapMesAnterior = null;
      if (SUPABASE_URL && SUPABASE_KEY) {
        try {
          const mesAnt = getMesAnterior();
          const r3 = await supabaseQuery('auvo_contract_snapshots', 'GET', null, `?ano_mes=eq.${mesAnt}&order=created_at.desc&limit=1`);
          if (r3?.status === 200 && Array.isArray(r3.data) && r3.data.length > 0) {
            snapMesAnterior = r3.data[0];
          }
        } catch { /* opcional */ }
      }

      return res.status(200).json({
        success: true,
        contrato,
        snapMesAnterior,
        lastSync: ultimaSincronizacao
      });
    }

    // ── GET: lista de contratos ───────────────────────────────────────────────
    if (cacheContratos.grupos.length === 0 && !syncEmProgresso) {
      try { await sincronizarCompleto(); } catch { /* usa cache */ }
    }

    // Carrega metadados locais
    let localData = [];
    if (SUPABASE_URL && SUPABASE_KEY) {
      try {
        const r = await supabaseQuery('auvo_contracts', 'GET', null, '');
        if (r?.status === 200 && r.data) localData = Array.isArray(r.data) ? r.data : [];
      } catch { /* sem Supabase */ }
    }

    let contratos = montarContratosConsolidados(localData);

    // Filtros
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const status = url.searchParams.get('status') || 'ativo';

    if (q) {
      contratos = contratos.filter(c =>
        c.nome.toLowerCase().includes(q) ||
        (c.referencia && c.referencia.toLowerCase().includes(q))
      );
    }
    if (status !== 'todos') {
      contratos = contratos.filter(c => c.situacao === status);
    }

    // KPIs
    const todos = montarContratosConsolidados(localData);
    const kpis = {
      contratosAtivos: todos.filter(c => c.situacao === 'ativo').length,
      unidadesAtivas: todos.reduce((s, c) => s + c.unidadesAtivas, 0),
      maquinasAtendimento: todos.filter(c => c.situacao === 'ativo').reduce((s, c) => s + c.equipsAtivosUnidadesAtivas, 0),
      totalContratos: todos.length
    };

    return res.status(200).json({
      success: true,
      kpis,
      total: contratos.length,
      contratos: contratos.map(c => ({
        auvoId: c.auvoId,
        nome: c.nome,
        referencia: c.referencia,
        situacao: c.situacao,
        situacaoInferida: c.situacaoInferida,
        totalUnidades: c.totalUnidades,
        unidadesAtivas: c.unidadesAtivas,
        totalEquipamentos: c.totalEquipamentos,
        totalEquipamentosGeral: c.totalEquipamentosGeral,
        maquinasContratadas: c.maquinasContratadas,
        hasLocalData: c.hasLocalData
      })),
      lastSync: ultimaSincronizacao
    });

  } catch (err) {
    console.error('Erro na API de contratos:', err);
    return res.status(500).json({ success: false, error: err.message, lastSync: ultimaSincronizacao });
  }
}

function getMesAnterior() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

module.exports = handler;
module.exports.default = handler;
