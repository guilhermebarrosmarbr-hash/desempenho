import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app, apiToken } from '../src/server.js';

test('Auth Middleware: rejeita requisições sem token com 401', async () => {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };

  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/prestadores`);
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.ok(data.erro);
  } finally {
    server.close();
  }
});

test('Auth Middleware: permite requisição com X-Api-Token válido retornando 200', async () => {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };

  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/prestadores`, {
      headers: {
        'X-Api-Token': apiToken
      }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data));
  } finally {
    server.close();
  }
});
