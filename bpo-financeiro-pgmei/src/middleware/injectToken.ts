import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { PUBLIC_DIR, TOKEN_PLACEHOLDER } from '../config.js';

/**
 * Substitui o marcador `__PMOC_API_TOKEN__` pelo token real no HTML do painel.
 *
 * Isso permite que o painel (servido pelo próprio backend) se autentique
 * automaticamente, sem exigir que o operador cole o token em toda sessão,
 * mantendo o token fora do código-fonte versionado.
 */

/** Cache do HTML processado, indexado pelo caminho do arquivo. */
const cache = new Map<string, { conteudo: string; geradoEm: number }>();

/** Validade do cache em milissegundos (1 minuto). */
const TTL_CACHE_MS = 60_000;

/**
 * Lê o HTML do disco, injeta o token e devolve o conteúdo pronto.
 *
 * @param caminhoArquivo Caminho absoluto do HTML.
 * @param token Token a ser injetado.
 * @returns O HTML com o token substituído.
 */
function carregarHtmlComToken(caminhoArquivo: string, token: string): string {
  const agora = Date.now();
  const emCache = cache.get(caminhoArquivo);

  if (emCache && agora - emCache.geradoEm < TTL_CACHE_MS) {
    return emCache.conteudo;
  }

  const bruto = fs.readFileSync(caminhoArquivo, 'utf8');
  const conteudo = bruto.replaceAll(TOKEN_PLACEHOLDER, token);
  cache.set(caminhoArquivo, { conteudo, geradoEm: agora });
  return conteudo;
}

/**
 * Cria o middleware que serve o index.html com o token injetado.
 *
 * @param token Token a ser injetado no HTML.
 * @returns Middleware Express que intercepta a raiz do painel.
 */
export function createIndexHtmlHandler(token: string) {
  const indexPath = path.join(PUBLIC_DIR, 'index.html');

  return function indexHtmlHandler(req: Request, res: Response, next: NextFunction): void {
    if (req.path !== '/' && req.path !== '/index.html') {
      next();
      return;
    }

    try {
      const html = carregarHtmlComToken(indexPath, token);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.send(html);
    } catch (err) {
      next(err);
    }
  };
}
