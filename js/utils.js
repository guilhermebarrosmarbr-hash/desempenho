// ==============================================================================
// utils.js — Utilitários Globais e Sanitização de HTML
// ==============================================================================

(function(global) {
    /**
     * Sanitiza strings contra Cross-Site Scripting (XSS) ao interpolar dados
     * dinâmicos de bancos, APIs ou formulários em templates HTML.
     *
     * @param {*} str - Valor a ser sanitizado
     * @returns {string} String com caracteres perigosos escapados
     */
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Retorna a competência atual formatada como MM/YYYY (ex: 10/2026).
     */
    function getCurrentCompetence() {
        const d = new Date();
        const mes = String(d.getMonth() + 1).padStart(2, '0');
        const ano = d.getFullYear();
        return `${mes}/${ano}`;
    }

    global.escapeHtml = escapeHtml;
    global.getCurrentCompetence = getCurrentCompetence;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { escapeHtml, getCurrentCompetence };
    }
})(typeof window !== 'undefined' ? window : globalThis);
