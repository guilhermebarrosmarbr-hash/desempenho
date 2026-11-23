// ==============================================================================
// inadimplencia.js — Lógica do Módulo 09 (Controle de Inadimplência)
// BPO Financeiro Mar Brasil
// ==============================================================================

// Utilitários de metadados fiscais (compatibilidade com schemas sem coluna tax_details dedicada)
window.BpoFiscalUtils = window.BpoFiscalUtils || {
    extrairTaxDetails: function(doc) {
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
    },
    limparDescricao: function(rawDesc) {
        if (!rawDesc) return '';
        return rawDesc.replace(/\s*<!--bpo_tax_details:.*?-->/g, '').trim();
    },
    anexarTaxDetailsNaDescricao: function(descricaoLimpa, taxDetails) {
        const limpa = window.BpoFiscalUtils.limparDescricao(descricaoLimpa);
        if (!taxDetails) return limpa;
        const serialized = JSON.stringify(taxDetails);
        return limpa ? `${limpa}\n<!--bpo_tax_details:${serialized}-->` : `<!--bpo_tax_details:${serialized}-->`;
    },
    serializarTaxDetails: function(rawDesc, taxDetails) {
        const limpa = window.BpoFiscalUtils.limparDescricao(rawDesc);
        if (!taxDetails) return limpa;
        const serialized = JSON.stringify(taxDetails);
        return limpa ? `${limpa}\n<!--bpo_tax_details:${serialized}-->` : `<!--bpo_tax_details:${serialized}-->`;
    },
    calcularFaturamentoTotalDoc: function(doc, taxDetails) {
        const bCents = window.BpoMoney.toCents(doc.gross_amount);
        const td = taxDetails || doc.tax_details || window.BpoFiscalUtils.extrairTaxDetails(doc);
        const dCents = (td && td.desconto)
            ? window.BpoMoney.toCents(td.desconto)
            : (doc.discounts ? window.BpoMoney.toCents(doc.discounts) : 0n);
        const eCents = (td && td.extras)
            ? window.BpoMoney.toCents(td.extras)
            : 0n;
        const iptuCents = (td && td.iptu_valor)
            ? window.BpoMoney.toCents(td.iptu_valor)
            : 0n;
        const totalBruto = bCents + eCents + iptuCents;
        return totalBruto > dCents ? (totalBruto - dCents) : 0n;
    }
};

(function() {
    let empresas = [];
    let empresaAtivaId = 'all'; // Padrão: "Todas as empresas"
    let companiesMap = new Map();
    let contratosMap = new Map();
    let billingDocs = [];
    let manualDelinquencies = [];
    let receiptsByDocMap = new Map();

    // Elementos DOM principais
    const selectEmpresa = document.getElementById('selectEmpresa');
    const containerTabelasEmpresas = document.getElementById('containerTabelasEmpresas');
    const estadoVazioGeral = document.getElementById('estadoVazioGeral');
    const loadingIndicator = document.getElementById('loadingIndicator');

    // Cards de Métricas
    const valInadimplenciaTotal = document.getElementById('valInadimplenciaTotal');
    const cardEmpresa1 = document.getElementById('cardEmpresa1');
    const lblCardEmpresa1 = document.getElementById('lblCardEmpresa1');
    const valCardEmpresa1 = document.getElementById('valCardEmpresa1');
    const cardEmpresa2 = document.getElementById('cardEmpresa2');
    const lblCardEmpresa2 = document.getElementById('lblCardEmpresa2');
    const valCardEmpresa2 = document.getElementById('valCardEmpresa2');
    const cardEmpresa3 = document.getElementById('cardEmpresa3');
    const lblCardEmpresa3 = document.getElementById('lblCardEmpresa3');
    const valCardEmpresa3 = document.getElementById('valCardEmpresa3');

    // Modais e formulários
    const btnNovaPendenciaManual = document.getElementById('btnNovaPendenciaManual');
    const modalPendenciaManual = document.getElementById('modalPendenciaManual');
    const formPendenciaManual = document.getElementById('formPendenciaManual');
    const modalEditarInadimplencia = document.getElementById('modalEditarInadimplencia');
    const formEditarInadimplencia = document.getElementById('formEditarInadimplencia');

    const STORAGE_KEY_MANUAL_DELINQUENCIES = 'bpo_manual_delinquencies';

    // =========================================================================
    // UTILITÁRIOS DE DATA E DIAS DE ATRASO
    // =========================================================================

    function parseIsoDate(dateStr) {
        if (!dateStr) return null;
        const parts = String(dateStr).slice(0, 10).split('-');
        if (parts.length !== 3) return null;
        return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    }

    function formatarDataBR(dateStr) {
        if (!dateStr) return '-';
        const parts = String(dateStr).slice(0, 10).split('-');
        if (parts.length !== 3) return dateStr;
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }

    /**
     * Calcula a diferença em dias corridos entre a data atual e a data de vencimento.
     * Vencimento hoje => diff = 0 (não é atraso).
     * Vencimento ontem => diff = 1.
     */
    function calcularDiasAtraso(dueDateStr) {
        const due = parseIsoDate(dueDateStr);
        if (!due) return 0;
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const diffMs = today.getTime() - due.getTime();
        return Math.floor(diffMs / (1000 * 60 * 60 * 24));
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // =========================================================================
    // PERSISTÊNCIA LOCAL COM SUPABASE FALLBACK PARA PENDÊNCIAS MANUAIS
    // =========================================================================

    function getStorageManualDelinquencies() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_MANUAL_DELINQUENCIES);
            if (!raw) return [];
            return JSON.parse(raw);
        } catch (e) {
            console.warn('Erro ao ler pendências manuais locais:', e);
            return [];
        }
    }

    function setStorageManualDelinquencies(items) {
        try {
            localStorage.setItem(STORAGE_KEY_MANUAL_DELINQUENCIES, JSON.stringify(items));
        } catch (e) {
            console.warn('Erro ao salvar pendências manuais locais:', e);
        }
    }

    async function carregarPendenciasManuais() {
        try {
            // Tenta consultar no Supabase
            const res = await window.BpoSupabase.request('manual_delinquencies?order=due_date.asc', { method: 'GET' });
            if (Array.isArray(res)) {
                manualDelinquencies = res;
                setStorageManualDelinquencies(res);
                return;
            }
        } catch (e) {
            // Se tabela não existir no Supabase, usa armazenamento isolado local
            console.info('Usando armazenamento local para pendências manuais (tabela remota opcional):', e.message || e);
        }
        manualDelinquencies = getStorageManualDelinquencies();
    }

    async function salvarPendenciaManualNoBanco(item) {
        let salvoNoBanco = false;
        try {
            if (item.id && !item.id.startsWith('local_')) {
                await window.BpoSupabase.request(`manual_delinquencies?id=eq.${item.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify(item)
                });
                salvoNoBanco = true;
            } else {
                const res = await window.BpoSupabase.request('manual_delinquencies', {
                    method: 'POST',
                    body: JSON.stringify(item)
                });
                if (res && res[0]) {
                    item.id = res[0].id;
                }
                salvoNoBanco = true;
            }
        } catch (e) {
            console.warn('Não foi possível persistir no Supabase, persistindo localmente:', e.message || e);
        }

        // Atualiza cache local
        let locais = getStorageManualDelinquencies();
        const idx = locais.findIndex(m => m.id === item.id);
        if (idx >= 0) {
            locais[idx] = item;
        } else {
            locais.push(item);
        }
        setStorageManualDelinquencies(locais);
        manualDelinquencies = locais;
        return item;
    }

    async function excluirPendenciaManualNoBanco(id) {
        try {
            if (!id.startsWith('local_')) {
                await window.BpoSupabase.request(`manual_delinquencies?id=eq.${id}`, { method: 'DELETE' });
            }
        } catch (e) {
            console.warn('Aviso ao excluir pendência manual no Supabase:', e);
        }
        let locais = getStorageManualDelinquencies().filter(m => m.id !== id);
        setStorageManualDelinquencies(locais);
        manualDelinquencies = locais;
    }

    // =========================================================================
    // CÁLCULO DE VALOR LÍQUIDO DOS IMPOSTOS
    // =========================================================================

    function calcularValorLiquidoImpostosDoc(doc, empresa) {
        if (!doc) return null;
        try {
            const taxDetails = doc.tax_details || (window.BpoFiscalUtils && window.BpoFiscalUtils.extrairTaxDetails(doc));
            const itemType = (taxDetails && taxDetails.item_type) || 'servico';
            const isLocacao = (doc.document_type === 'locacao') || !!(taxDetails && taxDetails.is_locacao);
            const isLP = empresa && empresa.tax_regime === 'lucro_presumido';

            // Faturamento Total = Bruto + Extras + IPTU - Desconto
            const fatTotalCents = window.BpoFiscalUtils && window.BpoFiscalUtils.calcularFaturamentoTotalDoc
                ? window.BpoFiscalUtils.calcularFaturamentoTotalDoc(doc, taxDetails)
                : window.BpoMoney.toCents(doc.gross_amount);

            const fatTotalNum = Number(fatTotalCents) / 100;
            const retCents = window.BpoMoney.toCents(doc.retentions);

            if (isLP) {
                const aliqIss = (taxDetails && taxDetails.iss_aliq != null) ? Number(taxDetails.iss_aliq) : 3.0;
                const issRetido = !!(taxDetails && taxDetails.iss_retained);

                const pisCents = (taxDetails && taxDetails.pis_valor != null)
                    ? window.BpoMoney.toCents(taxDetails.pis_valor)
                    : BigInt(Math.round(fatTotalNum * 0.0065 * 100));

                const cofinsCents = (taxDetails && taxDetails.cofins_valor != null)
                    ? window.BpoMoney.toCents(taxDetails.cofins_valor)
                    : BigInt(Math.round(fatTotalNum * 0.03 * 100));

                let issCents = 0n;
                if (!isLocacao) {
                    issCents = (taxDetails && taxDetails.iss_valor != null)
                        ? window.BpoMoney.toCents(taxDetails.iss_valor)
                        : BigInt(Math.round(fatTotalNum * (aliqIss / 100) * 100));
                }

                const L_m = 1250000 / 3;
                let irpjBrutoCents;
                let csllCents;

                if (taxDetails && taxDetails.irpj_valor !== undefined && taxDetails.irpj_valor !== null && String(taxDetails.irpj_valor).trim() !== '') {
                    irpjBrutoCents = window.BpoMoney.toCents(taxDetails.irpj_valor);
                } else {
                    let aliqIrpj;
                    if (itemType === 'produto') {
                        const base = Math.max(0, ((fatTotalNum - L_m) * 0.088) + (100000 / 3));
                        aliqIrpj = fatTotalNum > 0 ? ((base * 0.15 + Math.max(0, (base - 20000) * 0.10)) / fatTotalNum) : 0.012;
                    } else {
                        const base = Math.max(0, ((fatTotalNum - L_m) * 0.352) + (400000 / 3));
                        aliqIrpj = fatTotalNum > 0 ? ((base * 0.15 + Math.max(0, (base - 20000) * 0.10)) / fatTotalNum) : 0.048;
                    }
                    irpjBrutoCents = BigInt(Math.round(fatTotalNum * aliqIrpj * 100));
                }

                if (taxDetails && taxDetails.csll_valor !== undefined && taxDetails.csll_valor !== null && String(taxDetails.csll_valor).trim() !== '') {
                    csllCents = window.BpoMoney.toCents(taxDetails.csll_valor);
                } else {
                    let aliqCsll;
                    if (itemType === 'produto') {
                        const base = Math.max(0, ((fatTotalNum - L_m) * 0.132) + (150000 / 3));
                        aliqCsll = fatTotalNum > 0 ? ((base * 0.09) / fatTotalNum) : 0.0108;
                    } else {
                        const base = Math.max(0, ((fatTotalNum - L_m) * 0.352) + (400000 / 3));
                        aliqCsll = fatTotalNum > 0 ? ((base * 0.09) / fatTotalNum) : 0.0288;
                    }
                    csllCents = BigInt(Math.round(fatTotalNum * aliqCsll * 100));
                }

                let irrfDocCents = 0n;
                if (taxDetails && taxDetails.has_irrf) {
                    const aliqIrrf = (taxDetails.irrf_aliq != null) ? Number(taxDetails.irrf_aliq) : (itemType === 'produto' ? 1.2 : 4.8);
                    irrfDocCents = BigInt(Math.round(fatTotalNum * (aliqIrrf / 100) * 100));
                } else if (retCents > 0n && !issRetido) {
                    irrfDocCents = retCents;
                } else if (retCents > 0n && issRetido) {
                    irrfDocCents = retCents > issCents ? (retCents - issCents) : 0n;
                }

                const irpjLiqCents = irpjBrutoCents > irrfDocCents ? (irpjBrutoCents - irrfDocCents) : 0n;
                const tributosCents = pisCents + cofinsCents + issCents + irpjLiqCents + csllCents + irrfDocCents;
                return fatTotalCents > tributosCents ? (fatTotalCents - tributosCents) : 0n;

            } else {
                // Simples Nacional: DAS estimado + retenções
                const anexoKey = (taxDetails && taxDetails.das_anexo) ? taxDetails.das_anexo : 'anexo_iii';
                const issIsento = isLocacao || !!(taxDetails && taxDetails.iss_isento_simples);
                let aliqDasEfetiva = 0.06;
                if (window.BpoTaxEngine && window.BpoTaxEngine.apurarSimplesNacional) {
                    const previaSN = window.BpoTaxEngine.apurarSimplesNacional(180000, fatTotalNum, anexoKey, { issIsento });
                    aliqDasEfetiva = previaSN.aliquotaEfetivaNumero || 0.06;
                }
                const tributosCents = BigInt(Math.round(fatTotalNum * aliqDasEfetiva * 100));
                const deducoes = tributosCents + retCents;
                return fatTotalCents > deducoes ? (fatTotalCents - deducoes) : 0n;
            }
        } catch (e) {
            console.warn('Erro ao calcular valor líquido de impostos:', e);
            return null;
        }
    }

    // =========================================================================
    // CARREGAMENTO DOS DADOS DO SISTEMA
    // =========================================================================

    async function carregarDadosInadimplencia() {
        if (loadingIndicator) loadingIndicator.style.display = 'block';
        if (containerTabelasEmpresas) containerTabelasEmpresas.style.display = 'none';
        if (estadoVazioGeral) estadoVazioGeral.style.display = 'none';

        try {
            // 1. Carrega Empresas
            empresas = await window.BpoSupabase.request('companies?order=name.asc', { method: 'GET' }) || [];
            companiesMap.clear();
            empresas.forEach(emp => companiesMap.set(emp.id, emp));

            // Popula seletor de empresas (com 'Todas as empresas' selecionado por padrão)
            const valorAtual = selectEmpresa.value || 'all';
            selectEmpresa.innerHTML = '<option value="all">Todas as empresas</option>';
            empresas.forEach(emp => {
                const opt = document.createElement('option');
                opt.value = emp.id;
                opt.textContent = emp.name;
                selectEmpresa.appendChild(opt);
            });
            selectEmpresa.value = valorAtual;

            // 2. Carrega Contratos
            try {
                const contratos = await window.BpoSupabase.request('contracts?order=name.asc', { method: 'GET' }) || [];
                contratosMap.clear();
                contratos.forEach(c => contratosMap.set(c.id, c));
            } catch (e) {
                console.warn('Aviso ao carregar contratos:', e);
            }

            // 3. Carrega Lançamentos de Faturamento não cancelados
            billingDocs = await window.BpoSupabase.request('billing_documents?status=neq.cancelled&order=due_date.asc', { method: 'GET' }) || [];

            // 4. Carrega Recebimentos para mapear pagamentos parciais / totais
            receiptsByDocMap.clear();
            try {
                const recs = await window.BpoSupabase.request('receipts?order=receipt_date.asc', { method: 'GET' }) || [];
                recs.forEach(r => {
                    let docRelacionadoId = r.external_id || null;
                    if (!docRelacionadoId && r.notes) {
                        const m = r.notes.match(/\[doc_id:\s*([a-f0-9\-]+)\]/i);
                        if (m) docRelacionadoId = m[1];
                    }
                    if (docRelacionadoId) {
                        if (!receiptsByDocMap.has(docRelacionadoId)) {
                            receiptsByDocMap.set(docRelacionadoId, []);
                        }
                        receiptsByDocMap.get(docRelacionadoId).push(r);
                    }
                });
            } catch (e) {
                console.warn('Aviso ao carregar receipts:', e);
            }

            // 5. Carrega Pendências Manuais
            await carregarPendenciasManuais();

            // 6. Processa e Renderiza Tabelas e Métricas
            processarERenderizar();

        } catch (err) {
            console.error('Erro ao carregar dados de inadimplência:', err);
            alert('Erro ao carregar dados de inadimplência: ' + (err.message || err));
        } finally {
            if (loadingIndicator) loadingIndicator.style.display = 'none';
        }
    }

    // =========================================================================
    // FILTRAGEM, PROCESSAMENTO E REGRA DE INADIMPLÊNCIA
    // =========================================================================

    function extrairPendenciasInadimplentes() {
        const pendencias = [];

        // 1. Origem: Faturamento (billing_documents)
        billingDocs.forEach(d => {
            // Ignora cancelados
            if (d.status === 'cancelled') return;

            // Precisa de data de vencimento válida
            if (!d.due_date) return;

            // Dias de atraso (dias corridos)
            const diasAtraso = calcularDiasAtraso(d.due_date);
            // Vencimento hoje (diasAtraso <= 0) ainda NÃO está atrasado
            if (diasAtraso <= 0) return;

            // Verifica pagamentos totais / parciais já realizados
            const docRecs = receiptsByDocMap.get(d.id) || [];
            const totalRecebidoCents = docRecs.reduce((acc, r) => acc + window.BpoMoney.toCents(r.gross_amount), 0n);
            const liqEsperadoCents = window.BpoMoney.toCents(d.net_amount);

            // Verifica se está pago ou sem saldo
            let statusEfetivo = d.status;
            const taxDetails = window.BpoFiscalUtils.extrairTaxDetails(d);
            const ultDataRec = (docRecs.length > 0)
                ? docRecs[docRecs.length - 1].receipt_date
                : (taxDetails && taxDetails.payment_date ? taxDetails.payment_date : d.payment_date);

            if (totalRecebidoCents >= liqEsperadoCents && liqEsperadoCents > 0n) {
                statusEfetivo = 'paid';
            } else if (ultDataRec && d.status === 'paid') {
                statusEfetivo = 'paid';
            }

            // Se quitado, não aparece na inadimplência
            if (statusEfetivo === 'paid') return;

            // Saldo devedor: se houve pagamento parcial, deduz o que já foi recebido
            const brutoTotalCents = window.BpoFiscalUtils.calcularFaturamentoTotalDoc(d, taxDetails);
            let valorTotalBrutoDevidoCents = brutoTotalCents;
            if (totalRecebidoCents > 0n) {
                valorTotalBrutoDevidoCents = brutoTotalCents > totalRecebidoCents ? (brutoTotalCents - totalRecebidoCents) : 0n;
            }

            // Se por qualquer arredondamento não houver saldo devedor, não entra
            if (valorTotalBrutoDevidoCents <= 0n) return;

            // Identificação do Contrato vinculado e Número do Documento (NFS-e)
            const ctr = contratosMap.get(d.contract_id);
            let nomeContrato = ctr ? (ctr.code ? `${ctr.code} — ${ctr.name}` : ctr.name) : 'Avulso';
            const numDocumento = d.document_number || '-';

            // Valor Líquido registrado/apurado no módulo de impostos
            const emp = companiesMap.get(d.company_id);
            const liquidoImpostosCents = calcularValorLiquidoImpostosDoc(d, emp);
            let liquidoDevidoCents = null;
            if (liquidoImpostosCents !== null) {
                if (totalRecebidoCents > 0n) {
                    liquidoDevidoCents = liquidoImpostosCents > totalRecebidoCents ? (liquidoImpostosCents - totalRecebidoCents) : 0n;
                } else {
                    liquidoDevidoCents = liquidoImpostosCents;
                }
            }

            pendencias.push({
                origem: 'faturamento',
                id: d.id,
                company_id: d.company_id,
                contrato_nome: nomeContrato,
                numero_documento: numDocumento,
                contract_id: d.contract_id,
                issue_date: d.issue_date,
                due_date: d.due_date,
                dias_atraso: diasAtraso,
                valor_total_cents: valorTotalBrutoDevidoCents,
                valor_liquido_cents: liquidoDevidoCents,
                observacoes: (taxDetails && taxDetails.inadimplencia_obs) ? taxDetails.inadimplencia_obs : '',
                raw_doc: d
            });
        });

        // 2. Origem: Pendências Manuais (persistidas exclusivamente na inadimplência)
        manualDelinquencies.forEach(m => {
            if (!m.due_date) return;
            const diasAtraso = calcularDiasAtraso(m.due_date);
            if (diasAtraso <= 0) return; // apenas vencidos

            const brutoCents = window.BpoMoney.toCents(m.gross_amount);
            if (brutoCents <= 0n) return;

            let liqCents = null;
            if (m.net_amount !== null && m.net_amount !== undefined && String(m.net_amount).trim() !== '') {
                liqCents = window.BpoMoney.toCents(m.net_amount);
            }

            pendencias.push({
                origem: 'manual',
                id: m.id,
                company_id: m.company_id,
                contrato_nome: m.contract_name || 'Pendência Manual',
                numero_documento: m.document_number || '-',
                contract_id: null,
                issue_date: m.issue_date,
                due_date: m.due_date,
                dias_atraso: diasAtraso,
                valor_total_cents: brutoCents,
                valor_liquido_cents: liqCents,
                observacoes: m.notes || '',
                raw_manual: m
            });
        });

        // Ordenação estável: Vencimento crescente (mais antigas primeiro) + ID
        pendencias.sort((a, b) => {
            const cmp = (a.due_date || '').localeCompare(b.due_date || '');
            if (cmp !== 0) return cmp;
            return String(a.id).localeCompare(String(b.id));
        });

        return pendencias;
    }

    // =========================================================================
    // RENDERIZAÇÃO DE MÉTRICAS E TABELAS
    // =========================================================================

    function processarERenderizar() {
        const todasPendencias = extrairPendenciasInadimplentes();

        // 1. ATUALIZAÇÃO DOS CARDS NO TOPO (VISÃO GERAL INDEPENDENTE DO FILTRO)
        atualizarCardsSuperiores(todasPendencias);

        // 2. FILTRAGEM POR EMPRESA
        let pendenciasFiltradas = todasPendencias;
        if (empresaAtivaId !== 'all') {
            pendenciasFiltradas = todasPendencias.filter(p => p.company_id === empresaAtivaId);
        }

        // 3. RENDERIZAÇÃO DAS TABELAS INDEPENDENTES
        renderizarTabelasPorEmpresa(pendenciasFiltradas);
    }

    function atualizarCardsSuperiores(todasPendencias) {
        // Card 1: Inadimplência Total (todas as empresas)
        let somaTotalGeralCents = 0n;
        const totalPorEmpresaMap = new Map();

        todasPendencias.forEach(p => {
            somaTotalGeralCents += p.valor_total_cents;
            const atual = totalPorEmpresaMap.get(p.company_id) || 0n;
            totalPorEmpresaMap.set(p.company_id, atual + p.valor_total_cents);
        });

        if (valInadimplenciaTotal) {
            valInadimplenciaTotal.textContent = window.BpoMoney.formatBRL(somaTotalGeralCents);
        }

        // Cards 2, 3 e 4: Identifica as 3 empresas principais (Mar Brasil, DZM, Ybox ou as 3 primeiras)
        // Preferência por ordem conhecida: Mar Brasil, D.Z.M, YBOX
        let emp1 = empresas.find(e => e.name.toLowerCase().includes('mar brasil')) || empresas[0];
        let emp2 = empresas.find(e => e.name.toLowerCase().includes('d.z.m') || e.name.toLowerCase().includes('dzm')) || empresas[1];
        let emp3 = empresas.find(e => e.name.toLowerCase().includes('ybox')) || empresas[2];

        // Se houver repetição ou empresas genéricas
        const empIdsUsados = new Set();
        const top3 = [];
        [emp1, emp2, emp3].forEach(e => {
            if (e && !empIdsUsados.has(e.id)) {
                empIdsUsados.add(e.id);
                top3.push(e);
            }
        });
        empresas.forEach(e => {
            if (top3.length < 3 && !empIdsUsados.has(e.id)) {
                empIdsUsados.add(e.id);
                top3.push(e);
            }
        });

        // Configura Card Empresa 1
        if (top3[0]) {
            if (cardEmpresa1) cardEmpresa1.style.display = 'block';
            if (lblCardEmpresa1) lblCardEmpresa1.textContent = top3[0].name;
            if (valCardEmpresa1) {
                const totalEmp = totalPorEmpresaMap.get(top3[0].id) || 0n;
                valCardEmpresa1.textContent = window.BpoMoney.formatBRL(totalEmp);
            }
        } else if (cardEmpresa1) {
            cardEmpresa1.style.display = 'none';
        }

        // Configura Card Empresa 2
        if (top3[1]) {
            if (cardEmpresa2) cardEmpresa2.style.display = 'block';
            if (lblCardEmpresa2) lblCardEmpresa2.textContent = top3[1].name;
            if (valCardEmpresa2) {
                const totalEmp = totalPorEmpresaMap.get(top3[1].id) || 0n;
                valCardEmpresa2.textContent = window.BpoMoney.formatBRL(totalEmp);
            }
        } else if (cardEmpresa2) {
            cardEmpresa2.style.display = 'none';
        }

        // Configura Card Empresa 3
        if (top3[2]) {
            if (cardEmpresa3) cardEmpresa3.style.display = 'block';
            if (lblCardEmpresa3) lblCardEmpresa3.textContent = top3[2].name;
            if (valCardEmpresa3) {
                const totalEmp = totalPorEmpresaMap.get(top3[2].id) || 0n;
                valCardEmpresa3.textContent = window.BpoMoney.formatBRL(totalEmp);
            }
        } else if (cardEmpresa3) {
            cardEmpresa3.style.display = 'none';
        }
    }

    function renderizarTabelasPorEmpresa(pendencias) {
        if (!containerTabelasEmpresas) return;
        containerTabelasEmpresas.innerHTML = '';

        // Determina a lista de empresas a exibir
        let empresasParaExibir = [];
        if (empresaAtivaId === 'all') {
            // "Empresas sem pendências não precisam ter tabelas vazias na visão geral."
            const empresasComPendenciasIds = new Set(pendencias.map(p => p.company_id));
            empresasParaExibir = empresas.filter(e => empresasComPendenciasIds.has(e.id));
        } else {
            const empSel = companiesMap.get(empresaAtivaId);
            if (empSel) empresasParaExibir = [empSel];
        }

        // Se não houver pendências para exibir
        if (empresasParaExibir.length === 0 || pendencias.length === 0) {
            if (estadoVazioGeral) {
                estadoVazioGeral.style.display = 'block';
                if (empresaAtivaId !== 'all') {
                    const emp = companiesMap.get(empresaAtivaId);
                    const nome = emp ? emp.name : 'empresa selecionada';
                    estadoVazioGeral.innerHTML = `
                        <div style="font-size: 2.5rem; margin-bottom: 12px;">🎉</div>
                        <h3 style="color: #fff; margin-bottom: 6px;">Nenhuma inadimplência encontrada</h3>
                        <p style="color: var(--text-secondary);">A empresa <strong>${escapeHtml(nome)}</strong> está em dia com todos os recebimentos e vencimentos.</p>
                    `;
                } else {
                    estadoVazioGeral.innerHTML = `
                        <div style="font-size: 2.5rem; margin-bottom: 12px;">🎉</div>
                        <h3 style="color: #fff; margin-bottom: 6px;">Excelente! Nenhuma inadimplência registrada</h3>
                        <p style="color: var(--text-secondary);">Não há faturamentos vencidos nem pendências manuais pendentes de pagamento no sistema.</p>
                    `;
                }
            }
            containerTabelasEmpresas.style.display = 'none';
            return;
        }

        if (estadoVazioGeral) estadoVazioGeral.style.display = 'none';
        containerTabelasEmpresas.style.display = 'block';

        // Renderiza uma tabela independente para cada empresa
        empresasParaExibir.forEach(emp => {
            const itensEmpresa = pendencias.filter(p => p.company_id === emp.id);

            // Se estiver em modo empresa selecionada e não houver pendências
            if (itensEmpresa.length === 0) {
                const emptyCard = document.createElement('div');
                emptyCard.className = 'finance-card';
                emptyCard.innerHTML = `
                    <div class="card-header">
                        <div>
                            <h2 class="card-title">🏢 ${escapeHtml(emp.name)}</h2>
                            <p class="card-subtitle">Controle de pendências e faturamentos vencidos</p>
                        </div>
                    </div>
                    <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
                        <p>Nenhuma pendência financeira vencida para esta empresa.</p>
                    </div>
                `;
                containerTabelasEmpresas.appendChild(emptyCard);
                return;
            }

            // Totais da empresa
            let totalBrutoCents = 0n;
            let totalLiquidoCents = 0n;
            let temLiquidoIncompleto = false;

            const linhasHtml = itensEmpresa.map(p => {
                totalBrutoCents += p.valor_total_cents;
                if (p.valor_liquido_cents !== null && p.valor_liquido_cents !== undefined) {
                    totalLiquidoCents += p.valor_liquido_cents;
                } else {
                    temLiquidoIncompleto = true;
                }

                // Tag Manual discreta
                const tagManual = p.origem === 'manual'
                    ? `<span style="font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; background: rgba(147, 51, 234, 0.2); color: #c084fc; border: 1px solid rgba(147, 51, 234, 0.4); margin-left: 6px;">Manual</span>`
                    : '';

                // Coluna Valor Líquido
                const liqTxt = (p.valor_liquido_cents !== null && p.valor_liquido_cents !== undefined)
                    ? `<span style="color: #38bdf8; font-weight: 600;">${window.BpoMoney.formatBRL(p.valor_liquido_cents)}</span>`
                    : `<span style="color: var(--text-muted); font-style: italic;" title="Valor líquido ainda não calculado no módulo de Impostos">Não disponível</span>`;

                // Badge de dias de atraso
                let badgeAtraso = `<span style="color: #ef4444; font-weight: 700; background: rgba(239,68,68,0.15); padding: 3px 8px; border-radius: 6px;">${p.dias_atraso} dia${p.dias_atraso > 1 ? 's' : ''}</span>`;
                if (p.dias_atraso > 60) {
                    badgeAtraso = `<span style="color: #dc2626; font-weight: 800; background: rgba(220,38,38,0.25); border: 1px solid rgba(220,38,38,0.4); padding: 3px 8px; border-radius: 6px;">⚠️ ${p.dias_atraso} dias</span>`;
                }

                const obsIcon = p.observacoes
                    ? `<span title="${escapeHtml(p.observacoes)}" style="cursor: help; margin-left: 6px;">💬</span>`
                    : '';

                return `
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.15s ease;">
                        <td style="text-align: center; font-weight: 700; color: #38bdf8;">
                            ${escapeHtml(p.numero_documento)}
                        </td>
                        <td style="font-weight: 600; color: #fff;">
                            ${escapeHtml(p.contrato_nome)} ${tagManual} ${obsIcon}
                        </td>
                        <td style="text-align: center; color: var(--text-secondary);">${formatarDataBR(p.issue_date)}</td>
                        <td style="text-align: center; color: #fbbf24; font-weight: 600;">${formatarDataBR(p.due_date)}</td>
                        <td style="text-align: center;">${badgeAtraso}</td>
                        <td style="text-align: right; font-weight: 700; color: #f8fafc;">${window.BpoMoney.formatBRL(p.valor_total_cents)}</td>
                        <td style="text-align: right;">${liqTxt}</td>
                        <td style="text-align: center; white-space: nowrap;">
                            <button class="btn btn-secondary btn-sm" onclick="window.abrirModalEditarInadimplencia('${p.origem}', '${p.id}')" style="padding: 4px 8px; font-size: 0.78rem;">
                                ✏️ Editar
                            </button>
                            <button class="btn btn-secondary btn-sm" disabled style="padding: 4px 8px; font-size: 0.78rem; opacity: 0.55; cursor: not-allowed; margin-left: 4px;" title="Integração de régua de cobrança em breve">
                                📩 Cobrar <span style="font-size: 0.65rem; background: rgba(255,255,255,0.1); padding: 1px 4px; border-radius: 3px;">Em breve</span>
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');

            // Rodapé de Totalização
            let footerLiquidoTxt = window.BpoMoney.formatBRL(totalLiquidoCents);
            if (temLiquidoIncompleto) {
                footerLiquidoTxt += ` <span style="font-size: 0.68rem; color: #f59e0b; display: block;" title="Alguns lançamentos estão sem valor líquido disponível">*Incompleto</span>`;
            }

            const secaoCard = document.createElement('section');
            secaoCard.className = 'finance-card';
            secaoCard.style.marginBottom = '32px';

            secaoCard.innerHTML = `
                <div class="card-header">
                    <div>
                        <h2 class="card-title" style="display: flex; align-items: center; gap: 8px;">
                            <span>🏢 ${escapeHtml(emp.name)}</span>
                            <span style="font-size: 0.78rem; font-weight: normal; color: var(--text-muted); background: rgba(255,255,255,0.06); padding: 2px 8px; border-radius: 12px;">
                                ${itensEmpresa.length} pendência${itensEmpresa.length > 1 ? 's' : ''}
                            </span>
                        </h2>
                        <p class="card-subtitle">Listagem de faturamentos vencidos e pendências da empresa</p>
                    </div>
                </div>

                <div class="table-responsive" style="overflow-x: auto; width: 100%;">
                    <table class="table-custom tabela-inadimplencia-empresa" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                        <thead>
                            <tr style="background: #111827; color: #9ca3af; text-transform: uppercase; font-size: 0.72rem; letter-spacing: 0.05em;">
                                <th style="padding: 10px; text-align: center; border-bottom: 2px solid rgba(255,255,255,0.1);">NFS-e / Doc</th>
                                <th style="padding: 10px; text-align: left; border-bottom: 2px solid rgba(255,255,255,0.1);">Contrato</th>
                                <th style="padding: 10px; text-align: center; border-bottom: 2px solid rgba(255,255,255,0.1);">Data de Emissão</th>
                                <th style="padding: 10px; text-align: center; border-bottom: 2px solid rgba(255,255,255,0.1);">Vencimento</th>
                                <th style="padding: 10px; text-align: center; border-bottom: 2px solid rgba(255,255,255,0.1);">Dias de Atraso</th>
                                <th style="padding: 10px; text-align: right; border-bottom: 2px solid rgba(255,255,255,0.1);">Valor Total</th>
                                <th style="padding: 10px; text-align: right; border-bottom: 2px solid rgba(255,255,255,0.1);">Valor Líquido</th>
                                <th style="padding: 10px; text-align: center; border-bottom: 2px solid rgba(255,255,255,0.1);">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${linhasHtml}
                        </tbody>
                        <tfoot>
                            <tr style="background: rgba(15, 23, 42, 0.95); font-weight: 700; border-top: 2px solid rgba(255,255,255,0.15);">
                                <td colspan="5" style="padding: 12px 10px; text-align: right; text-transform: uppercase; font-size: 0.78rem; color: #94a3b8; letter-spacing: 0.05em;">
                                    Total:
                                </td>
                                <td style="padding: 12px 10px; text-align: right; color: #f8fafc; font-size: 0.95rem;">
                                    ${window.BpoMoney.formatBRL(totalBrutoCents)}
                                </td>
                                <td style="padding: 12px 10px; text-align: right; color: #38bdf8; font-size: 0.95rem;">
                                    ${footerLiquidoTxt}
                                </td>
                                <td style="padding: 12px 10px;"></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            `;

            containerTabelasEmpresas.appendChild(secaoCard);
            const tabelaEl = secaoCard.querySelector('.tabela-inadimplencia-empresa');
            if (tabelaEl && window.BpoUtils && window.BpoUtils.makeTableSortable) {
                window.BpoUtils.makeTableSortable(tabelaEl);
            }
        });
    }

    // =========================================================================
    // MODAL: ADICIONAR PENDÊNCIA MANUAL (REQUISITO 7)
    // =========================================================================

    function abrirModalNovaPendenciaManual() {
        if (!formPendenciaManual) return;
        formPendenciaManual.reset();

        // Popula select de empresa
        const sel = document.getElementById('manualEmpresa');
        if (sel) {
            sel.innerHTML = '<option value="">Selecione uma empresa...</option>';
            empresas.forEach(emp => {
                const opt = document.createElement('option');
                opt.value = emp.id;
                opt.textContent = emp.name;
                sel.appendChild(opt);
            });
            if (empresaAtivaId !== 'all') {
                sel.value = empresaAtivaId;
            }
        }

        // Sugere data de emissão hoje
        const todayIso = new Date().toISOString().slice(0, 10);
        document.getElementById('manualDataEmissao').value = todayIso;

        if (modalPendenciaManual) modalPendenciaManual.style.display = 'flex';
    }

    async function salvarPendenciaManualSubmit(e) {
        e.preventDefault();
        const companyId = document.getElementById('manualEmpresa').value;
        const contratoNome = document.getElementById('manualContrato').value.trim();
        const dataEmissao = document.getElementById('manualDataEmissao').value;
        const dataVencimento = document.getElementById('manualDataVencimento').value;
        const valorTotalStr = document.getElementById('manualValorTotal').value.trim();
        const valorLiquidoStr = document.getElementById('manualValorLiquido').value.trim();
        const observacoes = document.getElementById('manualObservacoes').value.trim();

        if (!companyId) {
            alert('Selecione a empresa da pendência.');
            return;
        }
        if (!contratoNome) {
            alert('Informe o contrato ou identificação da pendência.');
            return;
        }
        if (!dataVencimento) {
            alert('Informe a data de vencimento.');
            return;
        }

        // "Para aparecer como inadimplente, a pendência precisa ter vencimento anterior à data atual."
        const dias = calcularDiasAtraso(dataVencimento);
        if (dias <= 0) {
            alert('Atenção: A data de vencimento deve ser anterior à data de hoje para constar como inadimplência.');
            return;
        }

        const brutoCents = window.BpoMoney.toCents(valorTotalStr);
        if (brutoCents <= 0n) {
            alert('Informe um valor total válido e maior que zero.');
            return;
        }

        let liquidoDecimal = null;
        if (valorLiquidoStr) {
            const liqCents = window.BpoMoney.toCents(valorLiquidoStr);
            liquidoDecimal = window.BpoMoney.toDecimalString(liqCents);
        }

        const novoItem = {
            id: 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            company_id: companyId,
            contract_name: contratoNome,
            issue_date: dataEmissao || dataVencimento,
            due_date: dataVencimento,
            gross_amount: window.BpoMoney.toDecimalString(brutoCents),
            net_amount: liquidoDecimal,
            notes: observacoes,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        try {
            await salvarPendenciaManualNoBanco(novoItem);
            if (modalPendenciaManual) modalPendenciaManual.style.display = 'none';
            processarERenderizar();
            alert('Pendência manual adicionada com sucesso!');
        } catch (err) {
            alert('Erro ao salvar pendência manual: ' + err.message);
        }
    }

    // =========================================================================
    // MODAL: EDITAR INADIMPLÊNCIA (REQUISITO 6)
    // =========================================================================

    window.abrirModalEditarInadimplencia = function(origem, id) {
        if (!modalEditarInadimplencia) return;

        document.getElementById('editInadimplenciaOrigem').value = origem;
        document.getElementById('editInadimplenciaId').value = id;

        const boxManual = document.getElementById('boxCamposEdicaoManual');
        const boxFaturamento = document.getElementById('boxCamposEdicaoFaturamento');
        const btnExcluir = document.getElementById('btnExcluirPendenciaManual');

        if (origem === 'manual') {
            const item = manualDelinquencies.find(m => m.id === id);
            if (!item) return;

            if (boxManual) boxManual.style.display = 'block';
            if (boxFaturamento) boxFaturamento.style.display = 'none';
            if (btnExcluir) btnExcluir.style.display = 'inline-block';

            // Popula empresa
            const selEmp = document.getElementById('editManualEmpresa');
            selEmp.innerHTML = '';
            empresas.forEach(emp => {
                const opt = document.createElement('option');
                opt.value = emp.id;
                opt.textContent = emp.name;
                selEmp.appendChild(opt);
            });
            selEmp.value = item.company_id;

            document.getElementById('editManualContrato').value = item.contract_name || '';
            document.getElementById('editManualDataEmissao').value = item.issue_date || '';
            document.getElementById('editManualDataVencimento').value = item.due_date || '';
            document.getElementById('editManualValorTotal').value = window.BpoMoney.formatBRL(item.gross_amount);
            document.getElementById('editManualValorLiquido').value = (item.net_amount != null) ? window.BpoMoney.formatBRL(item.net_amount) : '';
            document.getElementById('editManualObservacoes').value = item.notes || '';

        } else {
            // Faturamento: campos de origem são somente para leitura
            const doc = billingDocs.find(d => d.id === id);
            if (!doc) return;

            if (boxManual) boxManual.style.display = 'none';
            if (boxFaturamento) boxFaturamento.style.display = 'block';
            if (btnExcluir) btnExcluir.style.display = 'none';

            const emp = companiesMap.get(doc.company_id);
            const ctr = contratosMap.get(doc.contract_id);
            const taxDetails = window.BpoFiscalUtils.extrairTaxDetails(doc);
            const fatTotal = window.BpoFiscalUtils.calcularFaturamentoTotalDoc(doc, taxDetails);

            document.getElementById('readEmpresaNome').value = emp ? emp.name : '-';
            document.getElementById('readContratoNome').value = ctr ? (ctr.code ? `${ctr.code} — ${ctr.name}` : ctr.name) : 'Avulso';
            document.getElementById('readDataEmissao').value = formatarDataBR(doc.issue_date);
            document.getElementById('readDataVencimento').value = formatarDataBR(doc.due_date);
            document.getElementById('readValorTotal').value = window.BpoMoney.formatBRL(fatTotal);
            document.getElementById('editFaturamentoObservacoes').value = (taxDetails && taxDetails.inadimplencia_obs) ? taxDetails.inadimplencia_obs : '';
        }

        modalEditarInadimplencia.style.display = 'flex';
    };

    async function salvarEdicaoInadimplenciaSubmit(e) {
        e.preventDefault();
        const origem = document.getElementById('editInadimplenciaOrigem').value;
        const id = document.getElementById('editInadimplenciaId').value;

        try {
            if (origem === 'manual') {
                const companyId = document.getElementById('editManualEmpresa').value;
                const contratoNome = document.getElementById('editManualContrato').value.trim();
                const dataEmissao = document.getElementById('editManualDataEmissao').value;
                const dataVencimento = document.getElementById('editManualDataVencimento').value;
                const valorTotalStr = document.getElementById('editManualValorTotal').value.trim();
                const valorLiquidoStr = document.getElementById('editManualValorLiquido').value.trim();
                const observacoes = document.getElementById('editManualObservacoes').value.trim();

                const brutoCents = window.BpoMoney.toCents(valorTotalStr);
                let liquidoDecimal = null;
                if (valorLiquidoStr) {
                    const liqCents = window.BpoMoney.toCents(valorLiquidoStr);
                    liquidoDecimal = window.BpoMoney.toDecimalString(liqCents);
                }

                const itemAtualizado = {
                    id,
                    company_id: companyId,
                    contract_name: contratoNome,
                    issue_date: dataEmissao,
                    due_date: dataVencimento,
                    gross_amount: window.BpoMoney.toDecimalString(brutoCents),
                    net_amount: liquidoDecimal,
                    notes: observacoes,
                    updated_at: new Date().toISOString()
                };

                await salvarPendenciaManualNoBanco(itemAtualizado);

            } else {
                // Origem Faturamento: atualiza apenas observações de cobrança/inadimplência dentro de description
                const doc = billingDocs.find(d => d.id === id);
                if (!doc) return;

                const observacoes = document.getElementById('editFaturamentoObservacoes').value.trim();
                const taxDetails = window.BpoFiscalUtils.extrairTaxDetails(doc) || {};
                taxDetails.inadimplencia_obs = observacoes;

                const novaDescricao = window.BpoFiscalUtils.serializarTaxDetails(doc.description, taxDetails);
                await window.BpoSupabase.request(`billing_documents?id=eq.${id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ description: novaDescricao })
                });

                doc.description = novaDescricao;
                doc.tax_details = taxDetails;
            }

            if (modalEditarInadimplencia) modalEditarInadimplencia.style.display = 'none';
            processarERenderizar();
            alert('Alterações salvas com sucesso!');

        } catch (err) {
            alert('Erro ao salvar alterações: ' + (err.message || err));
        }
    }

    async function excluirPendenciaManualClick() {
        const id = document.getElementById('editInadimplenciaId').value;
        if (!confirm('Tem certeza de que deseja excluir esta pendência manual?')) return;

        try {
            await excluirPendenciaManualNoBanco(id);
            if (modalEditarInadimplencia) modalEditarInadimplencia.style.display = 'none';
            processarERenderizar();
            alert('Pendência manual excluída com sucesso!');
        } catch (err) {
            alert('Erro ao excluir pendência manual: ' + err.message);
        }
    }

    // =========================================================================
    // INICIALIZAÇÃO E EVENTOS
    // =========================================================================

    function configurarEventos() {
        // Seletor de Empresa
        if (selectEmpresa) {
            selectEmpresa.addEventListener('change', (e) => {
                empresaAtivaId = e.target.value;
                processarERenderizar();
            });
        }

        // Botão Nova Pendência Manual
        if (btnNovaPendenciaManual) {
            btnNovaPendenciaManual.addEventListener('click', abrirModalNovaPendenciaManual);
        }

        // Submissão do Formulário Manual
        if (formPendenciaManual) {
            formPendenciaManual.addEventListener('submit', salvarPendenciaManualSubmit);
        }

        // Submissão do Formulário de Edição
        if (formEditarInadimplencia) {
            formEditarInadimplencia.addEventListener('submit', salvarEdicaoInadimplenciaSubmit);
        }

        // Excluir Pendência Manual
        const btnExcluir = document.getElementById('btnExcluirPendenciaManual');
        if (btnExcluir) {
            btnExcluir.addEventListener('click', excluirPendenciaManualClick);
        }

        // Fechamento de Modais
        document.querySelectorAll('.modal-close, .btn-cancelar-modal').forEach(btn => {
            btn.addEventListener('click', () => {
                if (modalPendenciaManual) modalPendenciaManual.style.display = 'none';
                if (modalEditarInadimplencia) modalEditarInadimplencia.style.display = 'none';
            });
        });

        // Fechar ao clicar no backdrop
        window.addEventListener('click', (e) => {
            if (e.target === modalPendenciaManual) modalPendenciaManual.style.display = 'none';
            if (e.target === modalEditarInadimplencia) modalEditarInadimplencia.style.display = 'none';
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        configurarEventos();
        carregarDadosInadimplencia();
    });

    // Exposição global para testes
    window.BpoInadimplencia = {
        calcularDiasAtraso,
        extrairPendenciasInadimplentes,
        calcularValorLiquidoImpostosDoc
    };

})();
