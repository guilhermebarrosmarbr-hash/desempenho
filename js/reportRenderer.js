/**
 * Módulo de Renderização do Relatório Visual em SVG e HTML
 * Responsável por renderizar com exatidão estética as cores, donuts, técnico responsável e tabela do documento.
 */

export class ReportRenderer {
  /**
   * Constrói o elemento SVG de um gráfico Donut com indicador de progresso
   * @param {number} percentage - percentual de 0 a 100
   * @param {string} title - título do indicador
   * @param {string} desc - texto descritivo
   * @returns {string} HTML/SVG markup
   */
  static renderDonut(percentage, title, desc) {
    const radius = 58;
    const circumference = 2 * Math.PI * radius; // ~364.424
    const clampedPct = Math.min(100, Math.max(0, percentage));
    const offset = circumference * (1 - clampedPct / 100);

    return `
      <div class="gauge-card">
        <div class="gauge-svg-container">
          <svg class="gauge-svg" viewBox="0 0 160 160">
            <!-- Círculo de Fundo (Pêssego Claro) -->
            <circle
              cx="80"
              cy="80"
              r="${radius}"
              class="gauge-track"
            />
            <!-- Arco de Progresso (Laranja Vibrante) -->
            <circle
              cx="80"
              cy="80"
              r="${radius}"
              class="gauge-progress"
              stroke-dasharray="${circumference.toFixed(2)}"
              stroke-dashoffset="${offset.toFixed(2)}"
              transform="rotate(-90 80 80)"
            />
            <!-- Texto Central -->
            <text x="80" y="88" class="gauge-value" text-anchor="middle">
              ${clampedPct}%
            </text>
          </svg>
        </div>
        <div class="gauge-info">
          <h3 class="gauge-title">${title}</h3>
          <p class="gauge-subtitle">${desc}</p>
        </div>
      </div>
    `;
  }

  /**
   * Renderiza o logo do cubo isométrico em 3D em SVG puro
   * @returns {string} SVG string
   */
  static renderCubeLogo() {
    return `
      <svg class="brand-cube-logo" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
        <!-- Face Superior (Amarelo / Âmbar Dourado) -->
        <polygon points="50,12 85,32 50,52 15,32" fill="#f59e0b" />
        <polygon points="50,22 75,36 50,50 25,36" fill="#fbbf24" />
        
        <!-- Face Esquerda (Laranja Vibrante) -->
        <polygon points="15,32 50,52 50,90 15,70" fill="#ea580c" />
        <polygon points="25,40 45,52 45,82 25,65" fill="#f97316" />
        
        <!-- Face Direita (Laranja Intenso / Terracota) -->
        <polygon points="50,52 85,32 85,70 50,90" fill="#c2410c" />
        <polygon points="55,52 75,40 75,65 55,82" fill="#ea580c" />
        
        <!-- Cubo interno em recorte -->
        <polygon points="50,42 64,50 50,58 36,50" fill="#fef3c7" opacity="0.9" />
      </svg>
    `;
  }

  /**
   * Atualiza todo o relatório visual na tela
   * @param {HTMLElement} container 
   * @param {Object} data 
   * @param {Object} computed 
   */
  static renderReport(container, data, computed) {
    if (!container) return;

    const { gauges, table } = computed;
    const techDisplay = data.technicianName ? `
      <span class="technician-badge">
        <span class="badge-icon">👷</span>
        <span class="badge-label">Responsável Técnico:</span>
        <strong class="badge-name">${data.technicianName}</strong>
      </span>
    ` : '';

    container.innerHTML = `
      <div class="report-paper">
        <!-- Topo: Badges, Título, Subtítulo e Logo -->
        <header class="report-header">
          <div class="header-left">
            <div class="badges-row">
              <span class="contract-badge" id="reportContractBadge">${data.contractBadge || 'CONTRATO STS 36693/22'}</span>
              ${techDisplay}
            </div>
            
            <h1 class="report-title" id="reportTitle">${data.contractTitle || 'Medição de Desempenho - Mar Brasil'}</h1>
            <p class="report-subtitle" id="reportSubtitle">
              ${data.contractSubtitle || 'Avaliação objetiva da execução contratual de manutenção (PMOC e correlatos) da SEDUC Santos realizada pela Mar Brasil, com conversão direta de performance operacional em valor financeiro reconhecido.'}
            </p>
          </div>
          <div class="header-right">
            ${this.renderCubeLogo()}
          </div>
        </header>

        <!-- Grade dos 4 Donut Gauges -->
        <section class="gauges-grid">
          ${this.renderDonut(
            gauges.pmocMensal.percentage,
            'PMOC Mensal',
            gauges.pmocMensal.ratioText
          )}
          ${this.renderDonut(
            gauges.pmocSemestral.percentage,
            'PMOC Semestral',
            gauges.pmocSemestral.ratioText
          )}
          ${this.renderDonut(
            gauges.corretiva.percentage,
            'Manutenção Corretiva',
            gauges.corretiva.ratioText
          )}
          ${this.renderDonut(
            gauges.epi.percentage,
            'EPI',
            gauges.epi.ratioText
          )}
        </section>

        <!-- Linha Divisória Tracejada -->
        <hr class="report-divider" />

        <!-- Tabela Financeira -->
        <section class="financial-section">
          <div class="financial-header">
            <span class="financial-label">${data.periodLabel || 'VALORES - MAR BRASIL 06/2026'}</span>
            <span class="financial-total-base">${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(data.contractValue || 6000)}</span>
          </div>

          <table class="report-table">
            <tbody>
              ${table.rows.map((row, idx) => `
                <tr class="table-row ${idx % 2 === 1 ? 'row-alt' : ''}">
                  <td class="col-item">${row.item}</td>
                  <td class="col-perf">${row.performance}</td>
                  <td class="col-peso">${row.peso}</td>
                  <td class="col-base">${row.valorBase}</td>
                  <td class="col-rec">${row.valorReconhecido}</td>
                </tr>
              `).join('')}

              <!-- Subtotal -->
              <tr class="table-row row-subtotal">
                <td class="col-item font-bold" colspan="4">SUBTOTAL</td>
                <td class="col-rec font-bold">${table.subtotal}</td>
              </tr>

              <!-- Incentivo Veicular -->
              <tr class="table-row">
                <td class="col-item">INCENTIVO VEICULAR</td>
                <td class="col-perf">${table.incentivoVeicular.performance}</td>
                <td class="col-peso"></td>
                <td class="col-base">${table.incentivoVeicular.valorBase}</td>
                <td class="col-rec">${table.incentivoVeicular.valorReconhecido}</td>
              </tr>

              <!-- Total -->
              <tr class="table-row row-total">
                <td class="col-item font-black" colspan="4">TOTAL</td>
                <td class="col-rec font-black">${table.total}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    `;
  }
}
