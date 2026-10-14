import { chromium, Browser, BrowserContext, Page } from 'playwright';
import path from 'path';
import { LinhaApuracao } from '../types.js';
import { normalizarSituacao } from '../utils/interpretador.js';

export interface PgmeiNavigationResult {
  sucesso: boolean;
  cnpjIdentificado?: string;
  nomeContribuinte?: string;
  anoConfirmado?: number;
  linhasApuracao: LinhaApuracao[];
  screenshotPath?: string;
  screenshotFilename?: string;
  urlFinal?: string;
  requerIntervencao: boolean;
  codigoErro?: string;
  mensagemErro?: string;
}

export class PgmeiAdapter {
  private browser: Browser | null = null;
  private readonly portalUrl = 'https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/pgmei.app/Identificacao';

  /**
   * Garante a inicialização de uma instância do navegador Chromium visível por padrão
   */
  public async getBrowser(headless: boolean = false): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await chromium.launch({
        headless,
        args: [
          '--start-maximized',
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox'
        ]
      });
    }
    return this.browser;
  }

  public async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Executa a consulta completa de um CNPJ para um ano específico
   */
  public async consultarCnpj(
    cnpjLimpo: string,
    ano: number,
    screenshotsDir: string,
    consultaId: string,
    headless: boolean = false,
    razaoSocial?: string,
    onWaitingHuman?: (page: Page, context: BrowserContext) => Promise<void>
  ): Promise<PgmeiNavigationResult> {
    const browser = await this.getBrowser(headless);
    const context = await browser.newContext({
      viewport: null, // usa tamanho real da janela
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      locale: 'pt-BR'
    });

    const page = await context.newPage();
    page.setDefaultTimeout(35000);

    try {
      console.log(`[PGMEI] Navegando até o portal para CNPJ ${cnpjLimpo}...`);
      await page.goto(this.portalUrl, { waitUntil: 'domcontentloaded' });

      // 1. Preenchimento do CNPJ
      // Localiza input de CNPJ por label, placeholder ou name
      const inputCnpj = page.locator('input#cnpj, input[name="cnpj"], input[placeholder*="CNPJ"]').first();
      await inputCnpj.waitFor({ state: 'visible', timeout: 15000 });
      await inputCnpj.fill(cnpjLimpo);

      // 2. Clique em "Continuar"
      const btnContinuar = page.locator('button:has-text("Continuar"), input[value="Continuar"], button[type="submit"]').first();
      await btnContinuar.click();

      // 3. Verifica se apareceu desafio do hCaptcha ou erro de CNPJ inválido
      // Aguarda navegação ou exibição de erro
      await page.waitForTimeout(2000);

      // Detecção de CAPTCHA visual / bloqueio
      const temCaptcha = await page.locator('iframe[src*="hcaptcha"], div[class*="h-captcha"]').isVisible().catch(() => false);
      const urlAtual = page.url();

      if (temCaptcha && urlAtual.includes('Identificacao')) {
        console.warn(`[PGMEI] Desafio hCaptcha detectado para ${cnpjLimpo}! Aguardando intervenção humana...`);
        if (onWaitingHuman) {
          await onWaitingHuman(page, context);
        } else {
          // Aguarda até 90 segundos para o operador resolver
          await page.waitForNavigation({ timeout: 90000 }).catch(() => null);
        }
      }

      // Verifica mensagens de erro na identificação (ex: "CNPJ inválido", "Não optante")
      const mensagemErroElement = page.locator('.alert-danger, .mensagem-erro, span[id*="msgErro"]').first();
      if (await mensagemErroElement.isVisible().catch(() => false)) {
        const txtErro = (await mensagemErroElement.innerText()).trim();
        await context.close();
        return {
          sucesso: false,
          linhasApuracao: [],
          requerIntervencao: false,
          codigoErro: 'ERRO_IDENTIFICACAO',
          mensagemErro: txtErro || 'Erro retornado pelo portal na identificação do CNPJ.'
        };
      }

      // 4. Aguardar a identificação do contribuinte e localizar opção "Emitir Guia de Pagamento (DAS)"
      const linkEmitirGuia = page.locator('a:has-text("Emitir Guia de Pagamento (DAS)"), button:has-text("Emitir Guia de Pagamento (DAS)"), a[href*="Emissao"]').first();
      await linkEmitirGuia.waitFor({ state: 'visible', timeout: 25000 });

      // Extrai nome / CNPJ identificado se disponível no cabeçalho
      const textoHeader = await page.locator('body').innerText();
      const matchCnpj = textoHeader.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
      const cnpjIdentificado = matchCnpj ? matchCnpj[1] : undefined;

      await linkEmitirGuia.click();

      // 5. Selecionar o ano-calendário e confirmar
      const selectAno = page.locator('select#ano, select[name="ano"], select').first();
      await selectAno.waitFor({ state: 'visible', timeout: 15000 });

      // Seleciona o valor do ano
      await selectAno.selectOption(String(ano));

      const btnOkAno = page.locator('button:has-text("OK"), button:has-text("Continuar"), input[value="OK"]').first();
      await btnOkAno.click();

      // 6. Aguardar tabela de períodos de apuração
      const tabelaApuracao = page.locator('table.table, table[class*="grid"], table').first();
      await tabelaApuracao.waitFor({ state: 'visible', timeout: 25000 });

      // Espera garantir que o DOM renderizou completamente as linhas
      await page.waitForTimeout(1500);

      // 7. Extração estruturada dos dados da tabela
      const linhasApuracao: LinhaApuracao[] = await page.evaluate(() => {
        const rows: any[] = [];
        const table = document.querySelector('table');
        if (!table) return rows;

        const trs = table.querySelectorAll('tbody tr');
        trs.forEach(tr => {
          const tds = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim());
          if (tds.length >= 4) {
            // Layout típico PGMEI: [Periodo, Apurado, Situacao/Beneficio, Principal, Multa, Juros, Total, Data Vencimento, Data Acolhimento]
            rows.push({
              periodo: tds[0] || '',
              apurado: tds[1] || '',
              situacaoTextoOriginal: tds[2] || '',
              principal: tds[3] || '',
              multa: tds[4] || '',
              juros: tds[5] || '',
              total: tds[6] || '',
              dataVencimento: tds[7] || '',
              dataAcolhimento: tds[8] || ''
            });
          }
        });
        return rows;
      });

      // Mapeia normalização de situação em cada linha
      const linhasMapeadas: LinhaApuracao[] = linhasApuracao.map(l => ({
        ...l,
        situacao: normalizarSituacao(l.situacaoTextoOriginal)
      }));

      // 8. Nome do arquivo seguro de evidência no formato: razaosocial-cnpj
      const sanitize = (str: string) => str.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').toLowerCase();
      const nomeBase = razaoSocial ? sanitize(razaoSocial) : (cnpjIdentificado ? sanitize(cnpjIdentificado) : 'prestador');
      const filename = `${nomeBase}-${cnpjLimpo}_${ano}.png`;
      const fullPath = path.join(screenshotsDir, filename);

      // Captura de tela completa da página de apuração
      await page.screenshot({ path: fullPath, fullPage: true });
      console.log(`[PGMEI] Evidência salva com sucesso em: ${fullPath}`);

      const urlFinal = page.url();
      await context.close();

      return {
        sucesso: true,
        cnpjIdentificado,
        anoConfirmado: ano,
        linhasApuracao: linhasMapeadas,
        screenshotPath: fullPath,
        screenshotFilename: filename,
        urlFinal,
        requerIntervencao: false
      };

    } catch (err: any) {
      console.error(`[PGMEI] Erro ao consultar ${cnpjLimpo}:`, err.message);

      // Tenta tirar print de erro se a página ainda estiver viva
      let erroScreenshot: string | undefined;
      try {
        const filenameErr = `ERRO_${cnpjLimpo}_${Date.now()}.png`;
        const pathErr = path.join(screenshotsDir, filenameErr);
        await page.screenshot({ path: pathErr, fullPage: true });
        erroScreenshot = filenameErr;
      } catch (_) {}

      await context.close().catch(() => null);

      return {
        sucesso: false,
        linhasApuracao: [],
        screenshotFilename: erroScreenshot,
        requerIntervencao: false,
        codigoErro: 'FALHA_NAVEGACAO',
        mensagemErro: err.message || 'Falha inesperada durante a navegação no portal PGMEI.'
      };
    }
  }
}
