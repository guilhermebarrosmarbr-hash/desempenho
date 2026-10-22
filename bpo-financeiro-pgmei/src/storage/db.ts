import fs from 'fs';
import path from 'path';
import { LoteConsultas, ConsultaResultado, Prestador } from '../types.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || '';

async function syncToSupabase(table: string, payload: any) {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error(`[DB-Sync] Erro ao sincronizar com Supabase (${table}): HTTP ${response.status} - ${errText}`);
    }
  } catch (err: any) {
    console.error(`[DB-Sync] Falha na requisição para o Supabase (${table}):`, err.message);
  }
}

async function deleteFromSupabase(table: string, id: string) {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error(`[DB-Sync] Erro ao deletar no Supabase (${table}): HTTP ${response.status} - ${errText}`);
    }
  } catch (err: any) {
    console.error(`[DB-Sync] Falha ao deletar no Supabase (${table}):`, err.message);
  }
}

export class DatabaseStore {
  private dataDir: string;
  private dbFile: string;
  private prestadoresFile: string;
  private screenshotsDir: string;
  private lotes: Map<string, LoteConsultas> = new Map();
  private prestadores: Map<string, Prestador> = new Map();

  constructor(baseDir?: string) {
    this.dataDir = baseDir || path.resolve(process.cwd(), 'data');
    this.screenshotsDir = path.join(this.dataDir, 'screenshots');
    this.dbFile = path.join(this.dataDir, 'database.json');
    this.prestadoresFile = path.join(this.dataDir, 'prestadores.json');

    this.ensureDirs();
    this.load();
  }

  private ensureDirs() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    if (!fs.existsSync(this.screenshotsDir)) {
      fs.mkdirSync(this.screenshotsDir, { recursive: true });
    }
  }

  private load() {
    if (fs.existsSync(this.dbFile)) {
      try {
        const raw = fs.readFileSync(this.dbFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const lote of parsed) {
            this.lotes.set(lote.id, lote);
          }
        }
      } catch (err) {
        console.error('[DB] Erro ao carregar banco JSON:', err);
      }
    }

    if (fs.existsSync(this.prestadoresFile)) {
      try {
        const raw = fs.readFileSync(this.prestadoresFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const p of parsed) {
            this.prestadores.set(p.id, p);
          }
        }
      } catch (err) {
        console.error('[DB] Erro ao carregar prestadores.json:', err);
      }
    }
  }

  public save() {
    try {
      const data = Array.from(this.lotes.values());
      const tempFile = `${this.dbFile}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tempFile, this.dbFile);
    } catch (err) {
      console.error('[DB] Erro ao salvar banco:', err);
    }
  }

  public savePrestadores() {
    try {
      const data = Array.from(this.prestadores.values());
      const tempFile = `${this.prestadoresFile}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tempFile, this.prestadoresFile);
    } catch (err) {
      console.error('[DB] Erro ao salvar prestadores:', err);
    }
  }

  public getPrestadorByCnpj(cnpj: string): Prestador | undefined {
    const limpo = cnpj.replace(/\D/g, '');
    return Array.from(this.prestadores.values()).find(p => p.cnpj.replace(/\D/g, '') === limpo);
  }

  public getAllPrestadores(): Prestador[] {
    return Array.from(this.prestadores.values()).sort((a, b) => a.razaoSocial.localeCompare(b.razaoSocial));
  }

  public addPrestador(cnpj: string, razaoSocial: string): Prestador {
    const limpo = cnpj.replace(/\D/g, '').padStart(14, '0');
    // Se já existir, atualiza a Razão Social
    const existente = this.getPrestadorByCnpj(limpo);
    if (existente) {
      existente.razaoSocial = razaoSocial.trim();
      this.savePrestadores();
      syncToSupabase('mei_providers', {
        id: existente.id,
        razao_social: existente.razaoSocial,
        cnpj: existente.cnpj,
        ativo: true,
        updated_at: new Date().toISOString()
      });
      return existente;
    }

    const novo: Prestador = {
      id: `PREST_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      cnpj: limpo,
      razaoSocial: razaoSocial.trim(),
      dataCadastro: new Date().toISOString()
    };
    this.prestadores.set(novo.id, novo);
    this.savePrestadores();
    syncToSupabase('mei_providers', {
      id: novo.id,
      razao_social: novo.razaoSocial,
      cnpj: novo.cnpj,
      ativo: true,
      updated_at: new Date().toISOString()
    });
    return novo;
  }

  public deletePrestador(id: string): boolean {
    const deleted = this.prestadores.delete(id);
    if (deleted) {
      this.savePrestadores();
      deleteFromSupabase('mei_providers', id);
    }
    return deleted;
  }

  public getScreenshotsDir(): string {
    return this.screenshotsDir;
  }

  public saveLote(lote: LoteConsultas) {
    this.lotes.set(lote.id, lote);
    this.save();

    // Sincroniza lote no Supabase
    syncToSupabase('mei_query_batches', {
      id: lote.id,
      ano: lote.ano,
      status: lote.status,
      total_consultas: lote.totalConsultas,
      concluidas: lote.concluidas,
      falhas: lote.falhas,
      consultas: lote.consultas,
      updated_at: new Date().toISOString()
    });
  }

  public getLote(id: string): LoteConsultas | undefined {
    return this.lotes.get(id);
  }

  public getAllLotes(): LoteConsultas[] {
    return Array.from(this.lotes.values()).sort(
      (a, b) => new Date(b.dataHoraCriacao).getTime() - new Date(a.dataHoraCriacao).getTime()
    );
  }

  public updateConsulta(loteId: string, consulta: ConsultaResultado) {
    const lote = this.lotes.get(loteId);
    if (!lote) return;

    const idx = lote.consultas.findIndex(c => c.id === consulta.id);
    if (idx !== -1) {
      lote.consultas[idx] = consulta;
    } else {
      lote.consultas.push(consulta);
    }

    // Recalcula totais
    lote.concluidas = lote.consultas.filter(c => c.status === 'CONCLUIDO').length;
    lote.falhas = lote.consultas.filter(c => c.status === 'FALHOU').length;

    this.save();
  }

  public getHistorico(filtro?: { cnpj?: string; ano?: number }): ConsultaResultado[] {
    const todos: ConsultaResultado[] = [];
    for (const lote of this.lotes.values()) {
      for (const c of lote.consultas) {
        let match = true;
        if (filtro?.cnpj && !c.cnpjSolicitado.includes(filtro.cnpj.replace(/\D/g, ''))) {
          match = false;
        }
        if (filtro?.ano && c.anoSolicitado !== filtro.ano) {
          match = false;
        }
        if (match) {
          todos.push(c);
        }
      }
    }
    return todos.sort((a, b) => new Date(b.dataHoraInicio).getTime() - new Date(a.dataHoraInicio).getTime());
  }
}
