/**
 * Cloudflare Worker para Proxy da Evolution API (WhatsApp)
 * Repositório: relatorio-medicao-pmoc
 *
 * Funcionalidades:
 * - Oculta a URL base da Evolution API e a API Key real.
 * - Autentica as chamadas do front-end validando um Token configurado em Secrets.
 * - Recebe o arquivo PDF em Base64 e despacha via /message/sendMedia da Evolution API.
 *
 * Secrets necessários (wrangler secret put <NOME>):
 *   - FRONTEND_ACCESS_TOKEN  : Token que o usuário insere no painel (ex: "marbrasilpmoc2025")
 *   - EVOLUTION_API_URL      : URL base da Evolution API (ex: "https://xxxx.ngrok-free.dev")
 *   - EVOLUTION_INSTANCE_NAME: Nome da instância (ex: "mar-brasil-oficial")
 *   - EVOLUTION_API_KEY      : API Key da Evolution API (ex: "minha_chave_secreta_123")
 */

export default {
  async fetch(request, env, ctx) {
    // 1. Configurar CORS
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // 2. Verificar Autenticação (Bearer Token)
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const clientToken = authHeader.split(' ')[1];
      if (clientToken !== env.FRONTEND_ACCESS_TOKEN) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Invalid Token' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const url = new URL(request.url);

      // 3. Rota GET /status - teste de conectividade
      if (request.method === 'GET' && url.pathname === '/status') {
        return new Response(JSON.stringify({ status: 'ok', message: 'Evolution Proxy Worker Running' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 4. Rota POST /send - envia PDF via Evolution API
      if (request.method === 'POST' && url.pathname === '/send') {
        const payload = await request.json();
        const { phone, base64Data, fileName, caption } = payload;

        if (!phone || !base64Data || !fileName) {
          return new Response(JSON.stringify({ error: 'Missing required fields: phone, base64Data, fileName' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Limpar telefone e montar JID WhatsApp
        const cleanPhone = phone.replace(/\D/g, '');
        const remoteJid = cleanPhone.length > 10 ? `${cleanPhone}@s.whatsapp.net` : cleanPhone;

        const evoUrl = `${env.EVOLUTION_API_URL}/message/sendMedia/${env.EVOLUTION_INSTANCE_NAME}`;

        const evoPayload = {
          number: remoteJid,
          mediatype: 'document',
          mimetype: 'application/pdf',
          caption: caption || '',
          media: base64Data,
          fileName: fileName,
        };

        const evoResponse = await fetch(evoUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': env.EVOLUTION_API_KEY,
            'ngrok-skip-browser-warning': 'true',
          },
          body: JSON.stringify(evoPayload),
        });

        const evoResultText = await evoResponse.text();
        let evoResult;
        try {
          evoResult = JSON.parse(evoResultText);
        } catch (e) {
          evoResult = evoResultText; // Not JSON, keep as text
        }

        if (!evoResponse.ok) {
          const errorDetails = typeof evoResult === 'object' ? JSON.stringify(evoResult) : evoResult;
          throw new Error(`Evolution API Error: ${evoResponse.status} - ${errorDetails}`);
        }

        return new Response(JSON.stringify({ success: true, messageId: evoResult.key?.id || 'unknown' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 5. Rota não encontrada
      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (err) {
      console.error('Worker Error:', err);
      return new Response(JSON.stringify({ error: 'Internal Server Error', details: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
};
