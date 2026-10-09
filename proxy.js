const http = require('http');

http.createServer((req, res) => {
  // Configurações de CORS para permitir que o arquivo local (file:///) acesse a API
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,Authorization');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const targetUrl = 'http://92.113.38.123:9000' + req.url;
  
  http.get(targetUrl, (proxyRes) => {
    // Repassa os headers (removendo headers problemáticos)
    const headers = { ...proxyRes.headers };
    delete headers['access-control-allow-origin'];
    
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res, {
      end: true
    });
  }).on('error', (err) => {
    res.writeHead(500);
    res.end(err.message);
  });
}).listen(9001, () => {
  console.log('✅ Proxy Local CORS rodando na porta 9001 (Redirecionando para API Auvo 9000)');
});
