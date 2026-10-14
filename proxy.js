/**
 * Proxy Local CORS para API do Auvo (porta 9001 → 92.113.38.123:9000)
 * Necessário para rodar o sistema via file:// com sincronização Auvo.
 *
 * Como usar: node proxy.js
 * Ou pelo:   abrir_sistema.bat (recomendado)
 */

const http = require('http');

const AUVO_HOST = '92.113.38.123';
const AUVO_PORT = 9000;
const PROXY_PORT = 9001;
const REQUEST_TIMEOUT_MS = 20000; // 20 segundos

http.createServer((req, res) => {
  // CORS — libera qualquer origem (necessário para file://)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const options = {
    hostname: AUVO_HOST,
    port:     AUVO_PORT,
    path:     req.url,
    method:   req.method,
    headers:  { ...req.headers, host: `${AUVO_HOST}:${AUVO_PORT}` },
    timeout:  REQUEST_TIMEOUT_MS
  };

  console.log(`[${new Date().toLocaleTimeString()}] → ${req.method} ${req.url}`);

  const proxyReq = http.request(options, (proxyRes) => {
    // Remove headers conflitantes antes de repassar
    const headers = { ...proxyRes.headers };
    delete headers['access-control-allow-origin'];
    delete headers['transfer-encoding'];

    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res, { end: true });

    console.log(`[${new Date().toLocaleTimeString()}] ← ${proxyRes.statusCode} ${req.url}`);
  });

  proxyReq.on('timeout', () => {
    console.error(`[TIMEOUT] ${req.url}`);
    proxyReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504);
      res.end(JSON.stringify({ error: 'Gateway Timeout', message: 'Servidor Auvo demorou demais para responder.' }));
    }
  });

  proxyReq.on('error', (err) => {
    console.error(`[ERRO] ${req.url} — ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502);
      res.end(JSON.stringify({ error: 'Bad Gateway', message: err.message }));
    }
  });

  // Encaminha o body da requisição (para POST/PUT)
  req.pipe(proxyReq, { end: true });

}).listen(PROXY_PORT, '127.0.0.1', () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  ✅ Proxy Local CORS ativo na porta ' + PROXY_PORT + '             ║');
  console.log('║  → Redirecionando para API Auvo: ' + AUVO_HOST + ':' + AUVO_PORT + ' ║');
  console.log('║                                                      ║');
  console.log('║  ⚠️  Mantenha esta janela aberta enquanto usa o       ║');
  console.log('║     sistema para sincronização com o Auvo funcionar. ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
});
