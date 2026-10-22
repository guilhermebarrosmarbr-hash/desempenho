import { Request, Response, NextFunction } from 'express';

/**
 * Middleware de rate limiting por IP, usando janela deslizante simples
 * (fixed window com contador).
 *
 * Objetivo: impedir que um loop de polling defeituoso no painel ou um
 * script externo sobrecarregue o servidor e o crawler do PGMEI.
 */
export interface RateLimiterOptions {
  /** Máximo de requisições permitidas por janela. */
  maxRequests: number;
  /** Duração da janela em milissegundos. */
  windowMs: number;
}

interface WindowState {
  contador: number;
  reiniciaEm: number;
}

/**
 * Cria um middleware de rate limiting.
 *
 * @param options Limite por janela e duração da janela.
 * @returns Middleware Express que responde 429 ao exceder o limite.
 */
export function createRateLimiter(options: RateLimiterOptions) {
  const { maxRequests, windowMs } = options;
  const janelas = new Map<string, WindowState>();

  // Evita crescimento indefinido do Map removendo janelas expiradas.
  const temporizadorLimpeza = setInterval(() => {
    const agora = Date.now();
    for (const [chave, estado] of janelas) {
      if (estado.reiniciaEm <= agora) janelas.delete(chave);
    }
  }, windowMs);
  temporizadorLimpeza.unref?.();

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const chave = req.ip || req.socket.remoteAddress || 'desconhecido';
    const agora = Date.now();

    let estado = janelas.get(chave);
    if (!estado || estado.reiniciaEm <= agora) {
      estado = { contador: 0, reiniciaEm: agora + windowMs };
      janelas.set(chave, estado);
    }

    estado.contador++;

    const restantes = Math.max(0, maxRequests - estado.contador);
    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(restantes));

    if (estado.contador > maxRequests) {
      res.setHeader('Retry-After', String(Math.ceil((estado.reiniciaEm - agora) / 1000)));
      res.status(429).json({
        erro: 'Muitas requisições. Aguarde alguns instantes antes de tentar novamente.'
      });
      return;
    }

    next();
  };
}
