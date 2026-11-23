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
    global.BpoUtils = global.BpoUtils || {};
    global.BpoUtils.escapeHtml = escapeHtml;

    /**
     * Torna qualquer tabela HTML ordenável por clique no cabeçalho (th ou th button.th-sort).
     * @param {HTMLTableElement|string} tableOrSelector 
     */
    function makeTableSortable(tableOrSelector) {
        const table = typeof tableOrSelector === 'string' ? document.querySelector(tableOrSelector) : tableOrSelector;
        if (!table) return;

        const headers = table.querySelectorAll('thead th');
        headers.forEach((th, colIndex) => {
            // Se for coluna de ações ou sem texto, ignora
            const text = th.textContent.trim().toLowerCase();
            if (text === 'ações' || text === 'acao' || text === '') return;

            th.style.cursor = 'pointer';
            th.style.userSelect = 'none';

            // Se ainda não tem botão th-sort interno ou ícone
            let btn = th.querySelector('.th-sort');
            let icon = th.querySelector('.sort-icon');
            if (!btn && !icon) {
                const origHtml = th.innerHTML;
                th.innerHTML = `<span class="th-sort-wrapper" style="display:inline-flex; align-items:center; gap:4px; width:100%; justify-content:${th.style.textAlign || 'inherit'};">${origHtml} <span class="sort-icon" style="font-size:0.7rem; color:#64748b;">⇅</span></span>`;
                icon = th.querySelector('.sort-icon');
            }

            th.onclick = function(e) {
                // Alterna direção
                const currentDir = th.getAttribute('data-sort-dir') || 'none';
                const newDir = currentDir === 'asc' ? 'desc' : 'asc';

                // Limpa outros cabeçalhos desta tabela
                headers.forEach(h => {
                    h.removeAttribute('data-sort-dir');
                    const ic = h.querySelector('.sort-icon');
                    if (ic) ic.textContent = '⇅';
                    const wrp = h.querySelector('.th-sort-wrapper');
                    if (wrp) wrp.style.color = '';
                });

                th.setAttribute('data-sort-dir', newDir);
                if (icon) icon.textContent = newDir === 'asc' ? '▲' : '▼';
                const wrp = th.querySelector('.th-sort-wrapper');
                if (wrp) wrp.style.color = '#38bdf8';

                // Ordena linhas do tbody
                const tbody = table.querySelector('tbody');
                if (!tbody) return;
                const rows = Array.from(tbody.querySelectorAll('tr'));
                if (rows.length <= 1) return;

                // Não ordena se for linha de mensagem vazia
                if (rows[0].querySelector('td[colspan]')) return;

                rows.sort((rowA, rowB) => {
                    const cellA = rowA.children[colIndex];
                    const cellB = rowB.children[colIndex];
                    if (!cellA || !cellB) return 0;

                    let rawA = cellA.innerText.trim();
                    let rawB = cellB.innerText.trim();

                    // Tenta comparar valores monetários (R$ ...)
                    if (rawA.includes('R$') || rawB.includes('R$')) {
                        const numA = parseFloat(rawA.replace(/[^\d,-]/g, '').replace(',', '.')) || 0;
                        const numB = parseFloat(rawB.replace(/[^\d,-]/g, '').replace(',', '.')) || 0;
                        return newDir === 'asc' ? numA - numB : numB - numA;
                    }

                    // Tenta comparar percentuais (X%)
                    if (rawA.endsWith('%') || rawB.endsWith('%')) {
                        const numA = parseFloat(rawA.replace('%', '').replace(',', '.')) || 0;
                        const numB = parseFloat(rawB.replace('%', '').replace(',', '.')) || 0;
                        return newDir === 'asc' ? numA - numB : numB - numA;
                    }

                    // Tenta comparar datas (DD/MM/AAAA ou AAAA-MM-DD)
                    const dateMatchA = rawA.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
                    const dateMatchB = rawB.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
                    if (dateMatchA && dateMatchB) {
                        const valA = `${dateMatchA[3]}-${dateMatchA[2]}-${dateMatchA[1]}`;
                        const valB = `${dateMatchB[3]}-${dateMatchB[2]}-${dateMatchB[1]}`;
                        return newDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
                    }

                    // Tenta número puro (ex: dias de atraso, número de documento numérico)
                    const cleanNumA = rawA.replace(/\s*dias?.*$/i, '').trim();
                    const cleanNumB = rawB.replace(/\s*dias?.*$/i, '').trim();
                    if (/^-?\d+(\.\d+)?$/.test(cleanNumA) && /^-?\d+(\.\d+)?$/.test(cleanNumB)) {
                        return newDir === 'asc' ? Number(cleanNumA) - Number(cleanNumB) : Number(cleanNumB) - Number(cleanNumA);
                    }

                    // Comparação alfabética padrão (case-insensitive)
                    return newDir === 'asc' 
                        ? rawA.localeCompare(rawB, 'pt-BR', { numeric: true, sensitivity: 'base' })
                        : rawB.localeCompare(rawA, 'pt-BR', { numeric: true, sensitivity: 'base' });
                });

                // Reanexa linhas ordenadas
                rows.forEach(r => tbody.appendChild(r));
            };
        });
    }

    global.BpoUtils.makeTableSortable = makeTableSortable;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { escapeHtml, makeTableSortable, BpoUtils: { escapeHtml, makeTableSortable } };
    }
})(typeof window !== 'undefined' ? window : globalThis);
