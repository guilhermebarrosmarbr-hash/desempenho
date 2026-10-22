import { Request, Response, NextFunction } from 'express';
import { TOKEN_HEADER } from '../config.js';

/**
 * Middleware de autenticação por token.
 *
 * O token pode ser enviado de duas formas:
 * - Header `X-Api-Token` (usado pelas chamadas `fetch` do painel).
 * - Query string `?token=` (necessário para `<img src>` e `<a download>`,
 *   que não permitem cabeçalhos customizados).
 *
 * @param tokenEsperado Token válido para o ambiente atual.
 * @returns Middleware Express que interrompe a requisição com 401 quando inválida.
 */
export function requireApiToken(tokenEsperado: string) {
  return function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    const doHeader = req.header(TOKEN_HEADER);
    const daQuery = typeof req.query.token === 'string' ? req.query.token : undefined;
    const recebido = doHeader || daQuery;

    if (!recebido) {
      res.status(401).json({
        erro: 'Não autorizado. Envie o header X-Api-Token ou o parâmetro ?token=.'
      });
      return;
    }

    if (recebido !== tokenEsperado) {
      res.status(401).json({ erro: 'Token de acesso inválido.' });
      return;
    }

    next();
  };
}
