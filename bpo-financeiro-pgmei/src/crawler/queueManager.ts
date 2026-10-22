import { DatabaseStore } from '../storage/db.js';
import { PgmeiAdapter } from '../crawler/pgmeiAdapter.js';
import { LoteConsultas, ConsultaResultado } from '../types.js';
import { interpretarResumoDas } from '../utils/interpretador.js';
import { formatarCnpj } from '../utils/cnpj.js';

export class QueueManager {
  private db: DatabaseStore;
  private adapter: PgmeiAdapter;
  private isProcessing: boolean = false;
  private cancelFlags: Set<string> = new Set();
  private humanInterventionWaiters: Map<string, () => void> = new Map();

  constructor(db: DatabaseStore, adapter: PgmeiAdapter) {
    this.db = db;
    this.adapter = adapter;
  }

  public async criarLote(itens: { cnpj: string; razaoSocial?: string }[], ano: number): Promise<LoteConsultas> {
    const loteId = `LOTE_${Date.now()}`;
    const consultas: ConsultaResultado[] = itens.map((item, idx) => ({
      id: `CONS_${Date.now()}_${idx}`,
      loteId,
      cnpjSolicitado: item.cnpj,
      cnpjFormatado: formatarCnpj(item.cnpj),
      nomeContribuinte: item.razaoSocial,
      anoSolicitado: ano,
      dataHoraInicio: new Date().toISOString(),
      status: 'NA_FILA',
      linhasApuracao: [],
      requerIntervencao: false,
      tentativas: 0
    }));

    const lote: LoteConsultas = {
      id: loteId,
      dataHoraCriacao: new Date().toISOString(),
      ano,
      status: 'CRIADO',
      totalConsultas: consultas.length,
      concluidas: 0,
      falhas: 0,
      consultas
    };

    this.db.saveLote(lote);

    // Inicia o processamento em background fora da requisição HTTP
    setImmediate(() => this.processarProximoDaFila(loteId));

    return lote;
  }

  public cancelarLote(loteId: string) {
    this.cancelFlags.add(loteId);
    const lote = this.db.getLote(loteId);
    if (lote) {
      lote.status = 'CANCELADO';
      for (const c of lote.consultas) {
        if (c.status === 'NA_FILA' || c.status === 'EM_PROCESSAMENTO' || c.status === 'AGUARDANDO_VERIFICACAO_HUMANA') {
          c.status = 'CANCELADO';
        }
      }
      this.db.saveLote(lote);
    }
  }

  public resolverIntervencaoHumana(consultaId: string) {
    const resolver = this.humanInterventionWaiters.get(consultaId);
    if (resolver) {
      resolver();
      this.humanInterventionWaiters.delete(consultaId);
    }
  }

  private async processarProximoDaFila(loteId: string) {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const lote = this.db.getLote(loteId);
      if (!lote || this.cancelFlags.has(loteId)) {
        this.isProcessing = false;
        return;
      }

      lote.status = 'EM_ANDAMENTO';
      this.db.saveLote(lote);

      for (const consulta of lote.consultas) {
        // Verifica cancelamento
        if (this.cancelFlags.has(loteId)) {
          consulta.status = 'CANCELADO';
          this.db.updateConsulta(loteId, consulta);
          continue;
        }

        if (consulta.status !== 'NA_FILA') continue;

        consulta.status = 'EM_PROCESSAMENTO';
        consulta.tentativas++;
        this.db.updateConsulta(loteId, consulta);

        console.log(`[Queue] Iniciando processamento do CNPJ ${consulta.cnpjSolicitado} (Ano ${consulta.anoSolicitado})...`);

        const resultado = await this.adapter.consultarCnpj(
          consulta.cnpjSolicitado,
          consulta.anoSolicitado,
          this.db.getScreenshotsDir(),
          consulta.id,
          false, // Headless false para permitir intervenção do operador
          consulta.nomeContribuinte,
          async (page, context) => {
            // Callback quando CAPTCHA surge
            consulta.status = 'AGUARDANDO_VERIFICACAO_HUMANA';
            consulta.requerIntervencao = true;
            this.db.updateConsulta(loteId, consulta);

            console.warn(`[Queue] CNPJ ${consulta.cnpjSolicitado} aguardando operador no navegador...`);

            // Aguarda o operador clicar em "Verifiquei e liberei" no painel ou resolver direto
            await new Promise<void>((resolve) => {
              this.humanInterventionWaiters.set(consulta.id, resolve);
              // Timeout máximo de 3 minutos para intervenção humana
              setTimeout(resolve, 180000);
            });

            consulta.requerIntervencao = false;
            consulta.status = 'EM_PROCESSAMENTO';
            this.db.updateConsulta(loteId, consulta);
          }
        );

        consulta.dataHoraFim = new Date().toISOString();

        if (resultado.sucesso) {
          consulta.status = 'CONCLUIDO';
          consulta.cnpjIdentificado = resultado.cnpjIdentificado;
          consulta.anoConfirmado = resultado.anoConfirmado;
          consulta.linhasApuracao = resultado.linhasApuracao;
          consulta.screenshotPath = resultado.screenshotPath;
          consulta.screenshotFilename = resultado.screenshotFilename;
          consulta.urlOrigem = resultado.urlFinal;
          consulta.resumoSituacao = interpretarResumoDas(resultado.linhasApuracao, consulta.anoSolicitado);
        } else {
          consulta.status = 'FALHOU';
          consulta.codigoErro = resultado.codigoErro;
          consulta.mensagemErro = resultado.mensagemErro;
          consulta.screenshotFilename = resultado.screenshotFilename;
        }

        this.db.updateConsulta(loteId, consulta);
        console.log(`[Queue] Finalizado CNPJ ${consulta.cnpjSolicitado}: ${consulta.status}`);
      }

      // ── RETRY AUTOMÁTICO ──────────────────────────────────────────────────────
      // Após processar todos os itens, tenta novamente os que falharam (1 vez).
      if (!this.cancelFlags.has(loteId)) {
        const loteAtualizado = this.db.getLote(loteId)!;
        const falhos = loteAtualizado.consultas.filter(c => c.status === 'FALHOU');

        if (falhos.length > 0) {
          console.log(`[Queue] Iniciando retry de ${falhos.length} consulta(s) que falharam...`);

          for (const consulta of falhos) {
            if (this.cancelFlags.has(loteId)) break;

            console.log(`[Queue] [RETRY] CNPJ ${consulta.cnpjSolicitado} (tentativa ${consulta.tentativas + 1})...`);
            consulta.status = 'EM_PROCESSAMENTO';
            consulta.tentativas++;
            consulta.mensagemErro = undefined;
            consulta.codigoErro = undefined;
            this.db.updateConsulta(loteId, consulta);

            const resultado = await this.adapter.consultarCnpj(
              consulta.cnpjSolicitado,
              consulta.anoSolicitado,
              this.db.getScreenshotsDir(),
              consulta.id,
              false,
              consulta.nomeContribuinte,
              async (page, context) => {
                consulta.status = 'AGUARDANDO_VERIFICACAO_HUMANA';
                consulta.requerIntervencao = true;
                this.db.updateConsulta(loteId, consulta);
                console.warn(`[Queue][RETRY] CNPJ ${consulta.cnpjSolicitado} aguardando operador...`);
                await new Promise<void>((resolve) => {
                  this.humanInterventionWaiters.set(consulta.id, resolve);
                  setTimeout(resolve, 180000);
                });
                consulta.requerIntervencao = false;
                consulta.status = 'EM_PROCESSAMENTO';
                this.db.updateConsulta(loteId, consulta);
              }
            );

            consulta.dataHoraFim = new Date().toISOString();

            if (resultado.sucesso) {
              consulta.status = 'CONCLUIDO';
              consulta.cnpjIdentificado = resultado.cnpjIdentificado;
              consulta.anoConfirmado = resultado.anoConfirmado;
              consulta.linhasApuracao = resultado.linhasApuracao;
              consulta.screenshotPath = resultado.screenshotPath;
              consulta.screenshotFilename = resultado.screenshotFilename;
              consulta.urlOrigem = resultado.urlFinal;
              consulta.resumoSituacao = interpretarResumoDas(resultado.linhasApuracao, consulta.anoSolicitado);
            } else {
              consulta.status = 'FALHOU';
              consulta.codigoErro = resultado.codigoErro;
              consulta.mensagemErro = resultado.mensagemErro;
              consulta.screenshotFilename = resultado.screenshotFilename;
            }

            this.db.updateConsulta(loteId, consulta);
            console.log(`[Queue] [RETRY] Finalizado CNPJ ${consulta.cnpjSolicitado}: ${consulta.status}`);
          }
        }
      }
      // ─────────────────────────────────────────────────────────────────────────

    } finally {
      this.isProcessing = false;
    }
  }
}
