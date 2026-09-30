/**
 * Módulo de Exportação em PDF e Impressão Vetorial
 * Fornece duas abordagens robustas:
 * 1. Impressão nativa do navegador (window.print com CSS @media print vetorial de altíssima definição)
 * 2. Download direto de arquivo .PDF usando html2pdf
 */

export class PdfExporter {
  /**
   * Dispara a impressão vetorial nativa do navegador
   */
  static printVector() {
    window.print();
  }

  /**
   * Gera e baixa diretamente o arquivo PDF com fidelidade visual
   * @param {HTMLElement} elementToExport 
   * @param {string} filename 
   */
  static async downloadPdf(elementToExport, filename = 'relatorio_medicao_desempenho.pdf') {
    if (!elementToExport) {
      alert('Elemento do relatório não encontrado para exportação.');
      return;
    }

    // Verifica se a biblioteca html2pdf está carregada
    if (typeof window.html2pdf === 'function') {
      const opt = {
        margin: [10, 12, 10, 12],
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2.5,
          useCORS: true,
          letterRendering: true,
          logging: false
        },
        jsPDF: {
          unit: 'mm',
          format: 'a4',
          orientation: 'portrait'
        }
      };

      try {
        await window.html2pdf().set(opt).from(elementToExport).save();
      } catch (err) {
        console.warn('Falha no html2pdf, acionando impressão nativa do navegador:', err);
        window.print();
      }
    } else {
      // Fallback elegante para impressão nativa
      window.print();
    }
  }
}
