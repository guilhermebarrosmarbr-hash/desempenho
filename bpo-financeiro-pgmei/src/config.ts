import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

/**
 * Configuração centralizada do Módulo 02.
 *
 * Toda a leitura de `process.env` e todo o cálculo de caminhos de disco
 * acontece aqui, deixando os demais módulos livres de efeitos colaterais
 * de inicialização e fáceis de testar.
 */

/** Diretório raiz do módulo (onde reside o package.json). */
export const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Pasta com os assets estáticos do painel (HTML/CSS/JS). */
export const PUBLIC_DIR = path.join(MODULE_ROOT, 'public');

/** Pasta onde são persistidos lotes, prestadores e evidências. */
export const DATA_DIR = path.join(MODULE_ROOT, 'data');

/** Porta HTTP do painel. */
export const PORT = Number(process.env.PORT) || 3000;

/**
 * Interface de rede do servidor.
 *
 * O padrão é `127.0.0.1` (somente local): o painel manipula dados fiscais
 * sensíveis (CNPJs e capturas do portal PGMEI) e não deve ser exposto em
 * redes corporativas. Use `HOST=0.0.0.0` apenas em ambientes controlados.
 */
export const HOST = process.env.HOST || '127.0.0.1';

/** Marcador substituído pelo token real no HTML servido ao navegador. */
export const TOKEN_PLACEHOLDER = '__PMOC_API_TOKEN__';

/** Caminho do arquivo que persiste o token gerado automaticamente. */
const TOKEN_FILE = path.join(DATA_DIR, '.api-token');

/**
 * Resolve o token de acesso da API.
 *
 * Ordem de precedência:
 * 1. `API_AUTH_TOKEN` (variável de ambiente) — ideal para deploys.
 * 2. Arquivo `data/.api-token` — persistido entre reinícios.
 * 3. Token aleatório gerado na primeira execução.
 *
 * @returns O token em vigor.
 */
export function resolveApiToken(): string {
  const doEnv = process.env.API_AUTH_TOKEN?.trim();
  if (doEnv) return doEnv;

  if (fs.existsSync(TOKEN_FILE)) {
    const salvo = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (salvo) return salvo;
  }

  const gerado = crypto.randomBytes(24).toString('hex');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, gerado, { encoding: 'utf8', mode: 0o600 });
  return gerado;
}

/** Nome do header que carrega o token nas chamadas da API. */
export const TOKEN_HEADER = 'X-Api-Token';

/**
 * Limite de requisições por janela de tempo, aplicado por IP.
 * Protege o crawler contra laços de polling agressivos do painel.
 */
export const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 300;

/** Janela do rate limit, em milissegundos. */
export const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000;
