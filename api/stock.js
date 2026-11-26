/**
 * api/stock.js
 * Backend Serverless para Integração com API Auvo v2 (Módulo 11 — Estoque)
 * 
 * Funcionalidades:
 * - Autenticação segura na Auvo (chaves no backend, nunca expostas no front)
 * - Cache de token com renovação automática antes da expiração
 * - GET: consulta produtos do Auvo (com paginação, filtros, categorias e usuários)
 * - POST: aciona sincronização completa de todos os produtos do Auvo
 * - Rate limit: respeita o limite documentado de 400 req/minuto
 * - Mecanismo de retry com backoff exponencial
 */

const https = require('https');

// Credenciais da Auvo (armazenadas com segurança no backend)
const AUVO_CONFIG = {
  apiKey: process.env.AUVO_API_KEY || '0R0GL0AE2Ughz4C1f6uhTL5s5rbg6HMq',
  apiToken: process.env.AUVO_API_TOKEN || 't3BB4Jwz30jtf38RloxT4GB60ruWfQN',
  baseUrl: 'api.auvo.com.br'
};

// Cache em memória para o ciclo do processo
let tokenCache = {
  token: null,
  expiration: null
};

let syncEmProgresso = false;
let ultimaSincronizacao = null; // { timestamp, total, duracaoMs, status, error }
let cacheProdutosMemoria = {
  produtos: [],
  categorias: [],
  usuarios: [],
  timestamp: null
};

function httpsRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : null;
          resolve({ status: res.statusCode, headers: res.headers, data: parsed, raw: body });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: body });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout na requisição HTTPS'));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

/**
 * Autentica ou reaproveita o Bearer Token da Auvo
 */
async function obterTokenAuvo(forcarRenovacao = false) {
  const agora = Date.now();
  if (!forcarRenovacao && tokenCache.token && tokenCache.expiration && (tokenCache.expiration - agora > 5 * 60 * 1000)) {
    return tokenCache.token;
  }

  const payload = JSON.stringify({
    apiKey: AUVO_CONFIG.apiKey,
    apiToken: AUVO_CONFIG.apiToken
  });

  const res = await httpsRequest({
    hostname: AUVO_CONFIG.baseUrl,
    port: 443,
    path: '/v2/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    },
    timeout: 15000
  }, payload);

  if (res.status !== 200 || !res.data || !res.data.result || !res.data.result.accessToken) {
    throw new Error(`Falha na autenticação Auvo: HTTP ${res.status} - ${res.raw || 'Sem resposta válida'}`);
  }

  tokenCache.token = res.data.result.accessToken;
  // Expiração: padrão 4 horas na Auvo; se vier data de expiração, calcula ms
  if (res.data.result.expiration) {
    tokenCache.expiration = new Date(res.data.result.expiration.replace(' ', 'T')).getTime();
  } else {
    tokenCache.expiration = agora + (3 * 3600 * 1000); // 3 horas de segurança
  }

  return tokenCache.token;
}

/**
 * Chamada autenticada com retry contra 401 e rate-limit
 */
async function chamarApiAuvo(path, method = 'GET', postData = null, retries = 2) {
  let token = await obterTokenAuvo();
  let tentativa = 0;

  while (tentativa <= retries) {
    try {
      const options = {
        hostname: AUVO_CONFIG.baseUrl,
        port: 443,
        path: '/v2' + path,
        method: method,
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        timeout: 25000
      };

      if (postData) {
        options.headers['Content-Length'] = Buffer.byteLength(postData);
      }

      const res = await httpsRequest(options, postData);

      // Se token expirou (401), renova uma vez e repete
      if (res.status === 401 && tentativa < retries) {
        token = await obterTokenAuvo(true);
        tentativa++;
        continue;
      }

      // Se bateu em rate limit (429), aguarda com backoff exponencial
      if (res.status === 429 && tentativa < retries) {
        const esperaMs = 1500 * Math.pow(2, tentativa);
        await new Promise(r => setTimeout(r, esperaMs));
        tentativa++;
        continue;
      }

      return res;
    } catch (err) {
      tentativa++;
      if (tentativa > retries) throw err;
      await new Promise(r => setTimeout(r, 1000 * tentativa));
    }
  }
}

/**
 * Busca todas as categorias de produtos da Auvo
 */
async function carregarCategoriasAuvo() {
  const res = await chamarApiAuvo('/productcategories?pageSize=100');
  if (res.status === 200 && res.data && res.data.result && Array.isArray(res.data.result.entityList)) {
    return res.data.result.entityList;
  }
  return [];
}

/**
 * Busca todos os usuários/técnicos da Auvo para mapear employeesStock
 */
async function carregarUsuariosAuvo() {
  const res = await chamarApiAuvo('/users?pageSize=100');
  if (res.status === 200 && res.data && res.data.result && Array.isArray(res.data.result.entityList)) {
    return res.data.result.entityList;
  }
  return [];
}

/**
 * Sincronização completa de produtos percorrendo todas as páginas
 */
async function executarSincronizacaoCompleta() {
  if (syncEmProgresso) {
    return { status: 'already_running', message: 'Sincronização já está em andamento.' };
  }

  syncEmProgresso = true;
  const inicioMs = Date.now();
  let totalProcessado = 0;
  let totalPaginas = 0;
  const todosProdutos = [];

  try {
    // 1. Busca categorias e colaboradores em paralelo
    const [categorias, usuarios] = await Promise.all([
      carregarCategoriasAuvo().catch(() => []),
      carregarUsuariosAuvo().catch(() => [])
    ]);

    const catMap = new Map();
    categorias.forEach(c => catMap.set(c.id, c.description || c.name || ''));

    const userMap = new Map();
    usuarios.forEach(u => userMap.set(u.userID || u.id, u.name || u.login || 'Colaborador'));

    // 2. Itera sobre todas as páginas de produtos
    let paginaAtual = 1;
    const tamanhoPagina = 100;
    let temMaisPaginas = true;

    while (temMaisPaginas) {
      const res = await chamarApiAuvo(`/products?page=${paginaAtual}&pageSize=${tamanhoPagina}`);
      if (res.status !== 200 || !res.data || !res.data.result) {
        throw new Error(`Erro ao buscar página ${paginaAtual} de produtos: HTTP ${res.status}`);
      }

      const entityList = res.data.result.entityList || [];
      const meta = res.data.result.pagedSearchReturnData || {};

      for (const p of entityList) {
        // Mapeia os dados do produto preservando integridade
        const catNome = catMap.get(p.categoryId) || (p.categoryName || 'Não informada');
        
        // Mapeia estoque por colaborador enriquecido com nome do técnico
        const empStockMapeado = (p.employeesStock || []).map(es => ({
          userId: es.userId,
          userName: userMap.get(es.userId) || `ID #${es.userId}`,
          amount: es.amount,
          lastMovement: es.lastStockMovement || null
        }));

        todosProdutos.push({
          id: p.id || p.code,
          code: p.code ? String(p.code) : (p.externalId || 'Não informado'),
          name: p.name || 'Não informado',
          description: p.description || p.name || 'Não informado',
          categoryId: p.categoryId || null,
          categoryName: catNome,
          totalStock: typeof p.totalStock === 'number' ? p.totalStock : null,
          minimumStock: typeof p.minimumStock === 'number' ? p.minimumStock : null,
          active: p.active !== false,
          unitaryValue: p.unitaryValue || null,
          unitaryCost: p.unitaryCost || null,
          imageUrl: p.imageUrl || null,
          employeesStock: empStockMapeado,
          externalId: p.externalId || null
        });
      }

      totalPaginas++;
      totalProcessado += entityList.length;

      // Verifica fim da paginação com segurança
      if (entityList.length < tamanhoPagina || (meta.totalItems && totalProcessado >= meta.totalItems)) {
        temMaisPaginas = false;
      } else {
        paginaAtual++;
        // Pequena pausa (100ms) para respeitar os 400 req/min (max 6.6 req/s)
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // Salva no cache consolidado
    cacheProdutosMemoria = {
      produtos: todosProdutos,
      categorias: categorias,
      usuarios: usuarios,
      timestamp: new Date().toISOString()
    };

    ultimaSincronizacao = {
      status: 'success',
      timestamp: new Date().toISOString(),
      total: totalProcessado,
      paginas: totalPaginas,
      duracaoMs: Date.now() - inicioMs,
      error: null
    };

    return {
      success: true,
      total: totalProcessado,
      paginas: totalPaginas,
      duracaoMs: ultimaSincronizacao.duracaoMs,
      timestamp: ultimaSincronizacao.timestamp
    };

  } catch (err) {
    ultimaSincronizacao = {
      status: 'error',
      timestamp: ultimaSincronizacao ? ultimaSincronizacao.timestamp : null, // Mantém último timestamp válido
      error: err.message,
      duracaoMs: Date.now() - inicioMs
    };
    throw err;
  } finally {
    syncEmProgresso = false;
  }
}

/**
 * Handler HTTP principal da API
 */
async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const action = url.searchParams.get('action') || 'list';

  try {
    // Ação 1: Aciona Sincronização Completa
    if (req.method === 'POST' || action === 'sync') {
      const syncResult = await executarSincronizacaoCompleta();
      return res.status(200).json({
        success: true,
        data: syncResult,
        productsCount: cacheProdutosMemoria.produtos.length
      });
    }

    // Ação 2: Status da sincronização
    if (action === 'status') {
      return res.status(200).json({
        isSyncing: syncEmProgresso,
        lastSync: ultimaSincronizacao,
        totalCached: cacheProdutosMemoria.produtos.length
      });
    }

    // Ação 3: Listagem de produtos (se cache vazio, executa 1ª sincronização automática)
    if (cacheProdutosMemoria.produtos.length === 0 && !syncEmProgresso) {
      try {
        await executarSincronizacaoCompleta();
      } catch (e) {
        console.warn('Erro na carga inicial de produtos Auvo:', e.message);
      }
    }

    // Filtros e busca no backend
    let lista = cacheProdutosMemoria.produtos;
    const q = (url.searchParams.get('q') || '').toLowerCase().trim();
    const cat = url.searchParams.get('category');
    const status = url.searchParams.get('status'); // 'active', 'inactive', 'all'
    const belowMin = url.searchParams.get('below_minimum') === 'true';

    if (q) {
      lista = lista.filter(p => 
        (p.name && p.name.toLowerCase().includes(q)) || 
        (p.code && p.code.toLowerCase().includes(q)) ||
        (p.description && p.description.toLowerCase().includes(q)) ||
        (p.externalId && p.externalId.toLowerCase().includes(q))
      );
    }

    if (cat && cat !== 'all') {
      lista = lista.filter(p => String(p.categoryId) === String(cat));
    }

    if (status && status !== 'all') {
      const isAtivo = status === 'active';
      lista = lista.filter(p => p.active === isAtivo);
    }

    if (belowMin) {
      lista = lista.filter(p => p.minimumStock !== null && p.totalStock !== null && p.totalStock < p.minimumStock);
    }

    return res.status(200).json({
      success: true,
      total: lista.length,
      totalGeral: cacheProdutosMemoria.produtos.length,
      categorias: cacheProdutosMemoria.categorias,
      lastSync: ultimaSincronizacao,
      products: lista
    });

  } catch (err) {
    console.error('Erro na API de estoque:', err);
    return res.status(500).json({
      success: false,
      error: err.message,
      lastSync: ultimaSincronizacao,
      cachedProducts: cacheProdutosMemoria.produtos.length
    });
  }
}

// Compatibilidade CommonJS e ES Module para Vercel Serverless
module.exports = handler;
module.exports.default = handler;
