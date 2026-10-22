// ==============================================================================
// utils.js — Utilitários BPO Financeiro e Sanitização de HTML
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

    global.escapeHtml = escapeHtml;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { escapeHtml };
    }
})(typeof window !== 'undefined' ? window : globalThis);
