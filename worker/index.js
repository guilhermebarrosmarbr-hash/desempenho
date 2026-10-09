/**
 * Cloudflare Worker para Proxy da Evolution API (WhatsApp) e Auvo API
 * Repositório: relatorio-medicao-pmoc
 */

class AuvoClient {
  constructor(baseUrl, timeoutMs = 15000, maxConcurrency = 3) {
    this.baseUrl = (baseUrl || 'http://92.113.38.123:9000').replace(/\/$/, '');
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

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const clientToken = authHeader.split(' ')[1];
      if (clientToken !== env.FRONTEND_ACCESS_TOKEN) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Invalid Token' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const url = new URL(request.url);

      if (request.method === 'GET' && url.pathname === '/status') {
        return new Response(JSON.stringify({ status: 'ok', message: 'Worker Running (Evolution & Auvo)' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Auvo Proxy - Contracts
      if (request.method === 'GET' && url.pathname === '/auvo/contracts') {
        const auvo = new AuvoClient(env.AUVO_API_URL);
        const data = await auvo.getContracts();
        return new Response(JSON.stringify(data), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Auvo Proxy - Dashboard (All or Single)
      if (request.method === 'GET' && url.pathname.startsWith('/auvo/dashboard')) {
        const auvo = new AuvoClient(env.AUVO_API_URL);
        const startDate = url.searchParams.get('start_date');
        const endDate = url.searchParams.get('end_date');
        
        if (!startDate || !endDate) {
          return new Response(JSON.stringify({ error: 'Missing start_date or end_date' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const pathParts = url.pathname.split('/');
        const target = pathParts[pathParts.length - 1]; // "all" or ID

        if (target === 'all') {
          // Hardcoded exclusions as requested in the prompt, or they could be passed via query
          const excludeParam = url.searchParams.get('exclude');
          let exclude = [144297, 161437, 161438, 161578, 166291, 166292, 146168];
          if (excludeParam) {
            exclude = excludeParam.split(',').map(Number);
          }
          const data = await auvo.getDashboardAll(startDate, endDate, exclude);
          return new Response(JSON.stringify(data), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        } else {
          // Single contract
          const data = await auvo.fetchWithRetry(`/api/dashboard/${target}?start_date=${startDate}&end_date=${endDate}`);
          return new Response(JSON.stringify(data), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }

      // WhatsApp Evolution API
      if (request.method === 'POST' && url.pathname === '/send') {
        const payload = await request.json();
        const { phone, base64Data, fileName, caption } = payload;
        if (!phone || !base64Data || !fileName) {
          return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        const cleanPhone = phone.replace(/\D/g, '');
        const remoteJid = cleanPhone.length > 10 ? `${cleanPhone}@s.whatsapp.net` : cleanPhone;
        const evoUrl = `${env.EVOLUTION_API_URL}/message/sendMedia/${env.EVOLUTION_INSTANCE_NAME}`;
        const evoPayload = { number: remoteJid, mediatype: 'document', mimetype: 'application/pdf', caption: caption || '', media: base64Data, fileName: fileName };
        
        const evoResponse = await fetch(evoUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': env.EVOLUTION_API_KEY, 'ngrok-skip-browser-warning': 'true' },
          body: JSON.stringify(evoPayload),
        });

        const evoResultText = await evoResponse.text();
        let evoResult;
        try { evoResult = JSON.parse(evoResultText); } catch (e) { evoResult = evoResultText; }

        if (!evoResponse.ok) {
          throw new Error(`Evolution API Error: ${evoResponse.status} - ${typeof evoResult === 'object' ? JSON.stringify(evoResult) : evoResult}`);
        }

        return new Response(JSON.stringify({ success: true, messageId: evoResult.key?.id || 'unknown' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } catch (err) {
      console.error('Worker Error:', err);
      return new Response(JSON.stringify({ error: 'Internal Server Error', details: err.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  },
};
