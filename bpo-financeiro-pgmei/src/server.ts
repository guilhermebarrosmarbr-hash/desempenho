import express from 'express';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
import { DatabaseStore } from './storage/db.js';
import { PgmeiAdapter } from './crawler/pgmeiAdapter.js';
import { QueueManager } from './crawler/queueManager.js';
import { processarListaCnpj } from './utils/cnpj.js';
import {
  PORT,
  HOST,
  PUBLIC_DIR,
  DATA_DIR,
  resolveApiToken,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS
} from './config.js';
import { requireApiToken } from './middleware/auth.js';
import { createRateLimiter } from './middleware/rateLimit.js';
import { createIndexHtmlHandler } from './middleware/injectToken.js';

export const app = express();
export const apiToken = resolveApiToken();

const rateLimiter = createRateLimiter({
  maxRequests: RATE_LIMIT_MAX_REQUESTS,
  windowMs: RATE_LIMIT_WINDOW_MS
});

app.use(express.json());

// Injeta o token dinâmico no index.html servido ao navegador
app.use(createIndexHtmlHandler(apiToken));
app.use(express.static(PUBLIC_DIR));

const db = new DatabaseStore(DATA_DIR);
const adapter = new PgmeiAdapter();
const queue = new QueueManager(db, adapter);

// Rate limiter nas rotas /api
app.use('/api', rateLimiter);

// Autenticação por token em /api e /screenshots
app.use('/api', requireApiToken(apiToken));
app.use('/screenshots', requireApiToken(apiToken));

// Serve screenshots de evidência
app.use('/screenshots', express.static(db.getScreenshotsDir()));

// --- Endpoints de Prestadores ---
app.get('/api/prestadores', (req, res) => {
  res.json(db.getAllPrestadores());
});

app.post('/api/prestadores', (req, res) => {
  const { cnpj, razaoSocial } = req.body;
  if (!cnpj || !razaoSocial) {
    return res.status(400).json({ erro: 'CNPJ e Razão Social são obrigatórios.' });
  }

  const { validos } = processarListaCnpj(cnpj);
  if (validos.length === 0) {
    return res.status(400).json({ erro: 'CNPJ inválido.' });
  }

  const prestador = db.addPrestador(validos[0], razaoSocial);
  res.status(201).json(prestador);
});

app.delete('/api/prestadores/:id', (req, res) => {
  const ok = db.deletePrestador(req.params.id);
  if (!ok) return res.status(404).json({ erro: 'Prestador não encontrado.' });
  res.json({ mensagem: 'Prestador excluído com sucesso.' });
});

// 1. Iniciar novo lote de consultas (por IDs de prestadores ou todos os cadastrados)
app.post('/api/lotes', async (req, res) => {
  try {
    const { prestadorIds, ano } = req.body;
    if (!ano) {
      return res.status(400).json({ erro: 'Ano é obrigatório.' });
    }

    let prestadores = db.getAllPrestadores();
    if (prestadorIds && Array.isArray(prestadorIds) && prestadorIds.length > 0) {
      prestadores = prestadores.filter(p => prestadorIds.includes(p.id));
    }

    if (prestadores.length === 0) {
      return res.status(400).json({ erro: 'Nenhum prestador cadastrado selecionado para consulta.' });
    }

    const itens = prestadores.map(p => ({ cnpj: p.cnpj, razaoSocial: p.razaoSocial }));
    const lote = await queue.criarLote(itens, Number(ano));
    return res.status(201).json({ lote });
  } catch (err: any) {
    return res.status(500).json({ erro: err.message });
  }
});

// 2. Listar todos os lotes
app.get('/api/lotes', (req, res) => {
  res.json(db.getAllLotes());
});

// 3. Obter status detalhado de um lote
app.get('/api/lotes/:id', (req, res) => {
  const lote = db.getLote(req.params.id);
  if (!lote) return res.status(404).json({ erro: 'Lote não encontrado.' });
  res.json(lote);
});

// 4. Cancelar lote
app.post('/api/lotes/:id/cancelar', (req, res) => {
  queue.cancelarLote(req.params.id);
  res.json({ mensagem: 'Solicitação de cancelamento enviada.' });
});

// 5. Notificar resolução de intervenção humana (CAPTCHA resolvido pelo operador)
app.post('/api/consultas/:id/liberar-humano', (req, res) => {
  queue.resolverIntervencaoHumana(req.params.id);
  res.json({ mensagem: 'Intervenção humana confirmada. Retomando consulta...' });
});

// 6. Consultar histórico por CNPJ e ano
app.get('/api/historico', (req, res) => {
  const { cnpj, ano } = req.query;
  const historico = db.getHistorico({
    cnpj: cnpj ? String(cnpj) : undefined,
    ano: ano ? Number(ano) : undefined
  });
  res.json(historico);
});

// 7. Download de todas as evidências concluídas do lote em ZIP via Streaming
app.get('/api/lotes/:id/download-zip', (req, res) => {
  const lote = db.getLote(req.params.id);
  if (!lote) return res.status(404).json({ erro: 'Lote não encontrado.' });

  const concluidasComPrint = lote.consultas.filter((c: any) => c.status === 'CONCLUIDO' && c.screenshotPath);
  if (concluidasComPrint.length === 0) {
    return res.status(400).json({ erro: 'Nenhuma evidência capturada disponível para download neste lote.' });
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename=EVIDENCIAS_PGMEI_${lote.id}_ANO_${lote.ano}.zip`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', err => res.status(500).send({ error: err.message }));
  archive.pipe(res);

  for (const c of concluidasComPrint) {
    if (c.screenshotPath && fs.existsSync(c.screenshotPath)) {
      archive.file(c.screenshotPath, { name: c.screenshotFilename || path.basename(c.screenshotPath) });
    }
  }

  // Adiciona um relatório JSON resumido no ZIP
  const resumoJson = JSON.stringify(lote, null, 2);
  archive.append(resumoJson, { name: `RELATORIO_${lote.id}.json` });

  archive.finalize();
});

const isMainModule = process.argv[1] && (
  process.argv[1].endsWith('server.ts') || 
  process.argv[1].endsWith('server.js')
);

if (isMainModule) {
  app.listen(PORT, HOST, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 BPO Financeiro - Módulo Consulta MEI (PGMEI) ativo!`);
    console.log(`🌐 Painel Web acessível em: http://${HOST}:${PORT}`);
    console.log(`======================================================\n`);
  });
}
