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

    // =========================================================================
    // MOTOR FISCAL OFICIAL COMPARTILHADO (BpoFiscalUtils)
    // Calcula com exatidão matemática os tributos oficiais e líquido de cada nota
    // tanto no Lucro Presumido (com segregação e fórmulas da planilha)
    // quanto no Simples Nacional (com RBT12 real das 12 competências anteriores).
    // =========================================================================
    const BpoFiscalUtils = global.BpoFiscalUtils || {};

    BpoFiscalUtils.extrairTaxDetails = BpoFiscalUtils.extrairTaxDetails || function(doc) {
        if (!doc) return null;
        if (doc.tax_details && typeof doc.tax_details === 'object') {
            return doc.tax_details;
        }
        if (doc.description && typeof doc.description === 'string') {
            const match = doc.description.match(/<!--bpo_tax_details:(.*?)-->/);
            if (match) {
                try {
                    return JSON.parse(match[1]);
                } catch (e) {}
            }
        }
        return null;
    };

    BpoFiscalUtils.limparDescricao = BpoFiscalUtils.limparDescricao || function(rawDesc) {
        if (!rawDesc) return '';
        return rawDesc.replace(/\s*<!--bpo_tax_details:.*?-->/g, '').trim();
    };

    BpoFiscalUtils.anexarTaxDetailsNaDescricao = BpoFiscalUtils.anexarTaxDetailsNaDescricao || function(descricaoLimpa, taxDetails) {
        const limpa = BpoFiscalUtils.limparDescricao(descricaoLimpa);
        if (!taxDetails) return limpa;
        const serialized = JSON.stringify(taxDetails);
        return limpa ? `${limpa}\n<!--bpo_tax_details:${serialized}-->` : `<!--bpo_tax_details:${serialized}-->`;
    };

    BpoFiscalUtils.calcularFaturamentoTotalDoc = BpoFiscalUtils.calcularFaturamentoTotalDoc || function(doc, taxDetails) {
        const bCents = global.BpoMoney ? global.BpoMoney.toCents(doc.gross_amount) : 0n;
        const td = taxDetails || doc.tax_details || BpoFiscalUtils.extrairTaxDetails(doc);
        const dCents = (td && td.desconto != null)
            ? (global.BpoMoney ? global.BpoMoney.toCents(td.desconto) : 0n)
            : (doc.discounts && global.BpoMoney ? global.BpoMoney.toCents(doc.discounts) : 0n);
        const eCents = (td && td.extras != null && global.BpoMoney)
            ? global.BpoMoney.toCents(td.extras)
            : 0n;
        const iptuCents = (td && td.iptu_valor != null && global.BpoMoney)
            ? global.BpoMoney.toCents(td.iptu_valor)
            : 0n;
        const totalBruto = bCents + eCents + iptuCents;
        return totalBruto > dCents ? (totalBruto - dCents) : 0n;
    };

    /**
     * Calcula a apuração fiscal oficial completa de uma nota conforme regras do Módulo de Impostos.
     * Retorna centavos BigInt e componentes discriminados.
     */
    BpoFiscalUtils.calcularTributosELiquidoOficial = function(doc, empresa, contextoCompetencia) {
        if (!doc) {
            return {
                faturadoCents: 0n,
                tributosCents: 0n,
                liquidoCents: 0n,
                pisCents: 0n,
                cofinsCents: 0n,
                issCents: 0n,
                irpjCents: 0n,
                csllCents: 0n,
                retencaoExibicaoCents: 0n,
                aliquotaEfetivaStr: '0,00%'
            };
        }

        const td = doc.tax_details || BpoFiscalUtils.extrairTaxDetails(doc) || {};
        const fatTotalCents = BpoFiscalUtils.calcularFaturamentoTotalDoc(doc, td);
        const fatTotalNum = Number(fatTotalCents) / 100;
        const retCents = global.BpoMoney ? global.BpoMoney.toCents(doc.retentions) : 0n;
        const isLP = empresa && empresa.tax_regime === 'lucro_presumido';
        const isLocacao = (doc.document_type === 'locacao') || !!(td && td.is_locacao);
        const itemType = (td && td.item_type) || 'servico';
        const issRetido = !!(td && td.iss_retained);

        let tributosCents = 0n;
        let retencaoExibicaoCents = 0n;
        let pisCents = 0n;
        let cofinsCents = 0n;
        let issCents = 0n;
        let irpjCents = 0n;
        let csllCents = 0n;

        if (isLP) {
            const aliqIss = (td && td.iss_aliq !== undefined && td.iss_aliq !== null) ? Number(td.iss_aliq) : 3.0;

            pisCents = (td && td.pis_valor !== undefined && td.pis_valor !== null && global.BpoMoney)
                ? global.BpoMoney.toCents(td.pis_valor)
                : BigInt(Math.round(fatTotalNum * 0.0065 * 100));

            cofinsCents = (td && td.cofins_valor !== undefined && td.cofins_valor !== null && global.BpoMoney)
                ? global.BpoMoney.toCents(td.cofins_valor)
                : BigInt(Math.round(fatTotalNum * 0.03 * 100));

            if (itemType === 'produto') {
                issCents = (td && td.iss_valor !== undefined && td.iss_valor !== null && global.BpoMoney)
                    ? global.BpoMoney.toCents(td.iss_valor)
                    : BigInt(Math.round(fatTotalNum * (aliqIss / 100) * 100));
            } else if (itemType === 'servico' && !isLocacao) {
                issCents = BigInt(Math.round(fatTotalNum * (aliqIss / 100) * 100));
            } else {
                issCents = 0n;
            }

            const aliqIrpjSugerida = contextoCompetencia
                ? (itemType === 'produto' ? contextoCompetencia.aliqIrpjProdPlanilha : contextoCompetencia.aliqIrpjServPlanilha)
                : (itemType === 'produto' ? 0.012 : 0.048);
            const aliqCsllSugerida = contextoCompetencia
                ? (itemType === 'produto' ? contextoCompetencia.aliqCsllProdPlanilha : contextoCompetencia.aliqCsllServPlanilha)
                : (itemType === 'produto' ? 0.0108 : 0.0288);

            let irpjBrutoCents = (td && td.irpj_valor !== undefined && td.irpj_valor !== null && String(td.irpj_valor).trim() !== '' && global.BpoMoney)
                ? global.BpoMoney.toCents(td.irpj_valor)
                : BigInt(Math.round(fatTotalNum * (aliqIrpjSugerida || 0.048) * 100));

            csllCents = (td && td.csll_valor !== undefined && td.csll_valor !== null && String(td.csll_valor).trim() !== '' && global.BpoMoney)
                ? global.BpoMoney.toCents(td.csll_valor)
                : BigInt(Math.round(fatTotalNum * (aliqCsllSugerida || 0.0288) * 100));

            let irrfDocCents = 0n;
            if (td && td.has_irrf) {
                const aliqIrrf = (td.irrf_aliq !== undefined && td.irrf_aliq !== null)
                    ? Number(td.irrf_aliq)
                    : (itemType === 'produto' ? 1.2 : 4.8);
                irrfDocCents = BigInt(Math.round(fatTotalNum * (aliqIrrf / 100) * 100));
            } else if (retCents > 0n && !issRetido) {
                irrfDocCents = retCents;
            } else if (retCents > 0n && issRetido) {
                irrfDocCents = retCents > issCents ? (retCents - issCents) : 0n;
            }

            irpjCents = irpjBrutoCents > irrfDocCents ? (irpjBrutoCents - irrfDocCents) : 0n;
            retencaoExibicaoCents = irrfDocCents;

            // Total de tributos oficial do Módulo de Impostos
            tributosCents = pisCents + cofinsCents + issCents + irpjCents + csllCents + retencaoExibicaoCents;
            const deducoesTotais = tributosCents;
            const liquidoCents = fatTotalCents > deducoesTotais ? (fatTotalCents - deducoesTotais) : 0n;

            const cargaStr = fatTotalCents > 0n
                ? `${(Number(tributosCents) / Number(fatTotalCents) * 100).toFixed(2)}%`
                : '0,00%';

            return {
                faturadoCents: fatTotalCents,
                tributosCents,
                liquidoCents,
                pisCents,
                cofinsCents,
                issCents,
                irpjCents,
                csllCents,
                retencaoExibicaoCents,
                aliquotaEfetivaStr: cargaStr
            };

        } else {
            // Simples Nacional: DAS oficial por RBT12
            const anexoKey = (td && td.das_anexo) ? td.das_anexo : 'anexo_iii';
            const issIsento = isLocacao || !!(td && td.iss_isento_simples);
            const rbt12Real = contextoCompetencia && contextoCompetencia.rbt12 ? contextoCompetencia.rbt12 : 0;
            const rbt12Num = rbt12Real > 0 
                ? rbt12Real 
                : ((td && td.das_rbt12 && global.BpoMoney) ? Number(global.BpoMoney.toCents(td.das_rbt12)) / 100 : 180000);

            let aliqDasEfetiva = 0.06;
            let compSN = {};
            if (global.BpoTaxEngine) {
                const previaSN = global.BpoTaxEngine.apurarSimplesNacional(rbt12Num, fatTotalNum, anexoKey, {
                    issIsento: issIsento
                });
                aliqDasEfetiva = previaSN.aliquotaEfetivaNumero || 0.06;
                compSN = previaSN.componentes || {};
            }

            irpjCents = BigInt(Math.round((compSN.irpj || 0) * 100));
            csllCents = BigInt(Math.round((compSN.csll || 0) * 100));
            cofinsCents = BigInt(Math.round((compSN.cofins || 0) * 100));
            pisCents = BigInt(Math.round((compSN.pis || 0) * 100));
            issCents = issIsento ? 0n : BigInt(Math.round((compSN.iss || 0) * 100));

            retencaoExibicaoCents = retCents;
            tributosCents = BigInt(Math.round(fatTotalNum * aliqDasEfetiva * 100));

            const deducoesTotais = tributosCents + retencaoExibicaoCents;
            const liquidoCents = fatTotalCents > deducoesTotais ? (fatTotalCents - deducoesTotais) : 0n;

            const cargaStr = fatTotalCents > 0n
                ? `${(Number(tributosCents) / Number(fatTotalCents) * 100).toFixed(2)}%`
                : '0,00%';

            return {
                faturadoCents: fatTotalCents,
                tributosCents,
                liquidoCents,
                pisCents,
                cofinsCents,
                issCents,
                irpjCents,
                csllCents,
                retencaoExibicaoCents,
                aliquotaEfetivaStr: cargaStr
            };
        }
    };

    global.BpoFiscalUtils = BpoFiscalUtils;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { escapeHtml, makeTableSortable, BpoUtils: { escapeHtml, makeTableSortable }, BpoFiscalUtils };
    }
})(typeof window !== 'undefined' ? window : globalThis);
