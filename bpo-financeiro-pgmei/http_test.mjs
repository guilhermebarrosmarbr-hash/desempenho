const BASE = 'http://localhost:3000';

const cases = [
  ['GET / (raiz do painel)', '/', {}],
  ['GET /app.js (static)', '/app.js', {}],
  ['GET /styles.css (static)', '/styles.css', {}],
  ['GET /api/prestadores SEM token', '/api/prestadores', {}],
  ['GET /api/prestadores COM token', '/api/prestadores', { 'X-Api-Token': 'pmoc-admin-2025' }],
  ['GET /api/lotes COM token', '/api/lotes', { 'X-Api-Token': 'pmoc-admin-2025' }],
  ['GET /api/prestadores TOKEN ERRADO', '/api/prestadores', { 'X-Api-Token': 'errado' }],
];

for (const [label, path, headers] of cases) {
  try {
    const res = await fetch(BASE + path, { headers });
    const body = await res.text();
    console.log(`${label} => ${res.status} (${body.length} bytes)`);
  } catch (err) {
    console.log(`${label} => ERRO DE CONEXAO: ${err.message}`);
  }
}
