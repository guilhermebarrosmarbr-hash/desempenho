/**
 * Módulo 10 — Relatório Gerencial
 * - Competência e cards superiores por empresa (Alíquota Efetiva: Total Impostos / Total Faturado * 100)
 * - Carrossel Coverflow 3D em perspectiva (Contratos Faturados vs Inadimplências)
 * - Três valores por card: Valor Faturado, Valor do Imposto Gerado, Valor Líquido (Critérios estritos do Faturamento)
 * - Ocultar/Mostrar valores monetários
 * - Seleção e filtragem de inadimplências
 */

(function() {
    let empresas = [];
    let contratos = [];
    let documentosCompetencia = [];
    let todosDocumentos = [];
    let receiptsMap = new Map();
    let companiesMap = new Map();
    let contratosMap = new Map();

    let competenciaAtiva = '';
    let modoAtual = 'contratos'; // 'contratos' | 'inadimplencia'
    let valoresOcultos = false;
    let cardAtivoIndex = 0;

    // Itens ativos no Coverflow
    let cardsParaExibir = [];

    // Conjunto de IDs selecionados para exibição no modo inadimplência (manual selection)
    let idsInadimplenciaSelecionados = new Set();
    let listaInadimplenciaTotal = [];

    // Elementos DOM
    const inputCompetencia = document.getElementById('inputCompetencia');
    const containerCardsEmpresas = document.getElementById('containerCardsEmpresas');
    const tabModoContratos = document.getElementById('tabModoContratos');
    const tabModoInadimplencia = document.getElementById('tabModoInadimplencia');
    const btnToggleValores = document.getElementById('btnToggleValores');
    const iconeOlho = document.getElementById('iconeOlho');
    const labelToggleValores = document.getElementById('labelToggleValores');
    const coverflowStage = document.getElementById('coverflowStage');
    const coverflowContainer = document.getElementById('coverflowContainer');
    const coverflowCounter = document.getElementById('coverflowCounter');
    const btnCoverflowPrev = document.getElementById('btnCoverflowPrev');
    const btnCoverflowNext = document.getElementById('btnCoverflowNext');

    // Filtros de Inadimplência
    const barraFiltrosInadimplencia = document.getElementById('barraFiltrosInadimplencia');
    const filtroEmpresa = document.getElementById('filtroEmpresa');
    const filtroFaixaValor = document.getElementById('filtroFaixaValor');
    const filtroBuscaContrato = document.getElementById('filtroBuscaContrato');
    const btnFiltrarInadimplencias = document.getElementById('btnFiltrarInadimplencias');
    const contagemSelecionados = document.getElementById('contagemSelecionados');

    // Modal
    const modalSelecaoInadimplencias = document.getElementById('modalSelecaoInadimplencias');
    const checklistInadimplencias = document.getElementById('checklistInadimplencias');
    const btnFecharModalInadimplencias = document.getElementById('btnFecharModalInadimplencias');
    const btnMarcarTodos = document.getElementById('btnMarcarTodos');
    const btnDesmarcarTodos = document.getElementById('btnDesmarcarTodos');
    const btnSalvarSelecaoInadimplencias = document.getElementById('btnSalvarSelecaoInadimplencias');

    // Inicialização
    window.addEventListener('DOMContentLoaded', async () => {
        const hoje = new Date();
        const ano = hoje.getFullYear();
        const mes = String(hoje.getMonth() + 1).padStart(2, '0');
        competenciaAtiva = `${ano}-${mes}`;
        inputCompetencia.value = competenciaAtiva;

        configurarEventos();
        await carregarDados();
    });

    function configurarEventos() {
        inputCompetencia.addEventListener('change', async (e) => {
            competenciaAtiva = e.target.value;
            await carregarDocumentosCompetencia();
            processarDados();
        });

        tabModoContratos.addEventListener('click', () => {
            if (modoAtual === 'contratos') return;
            modoAtual = 'contratos';
            tabModoContratos.classList.add('active');
            tabModoInadimplencia.classList.remove('active');
            barraFiltrosInadimplencia.style.display = 'none';
            btnFiltrarInadimplencias.style.display = 'none';
            cardAtivoIndex = 0;
            montarCardsCoverflow();
        });

        tabModoInadimplencia.addEventListener('click', () => {
            if (modoAtual === 'inadimplencia') return;
            modoAtual = 'inadimplencia';
            tabModoInadimplencia.classList.add('active');
            tabModoContratos.classList.remove('active');
            barraFiltrosInadimplencia.style.display = 'flex';
            btnFiltrarInadimplencias.style.display = 'inline-flex';
            cardAtivoIndex = 0;
            montarCardsCoverflow();
        });

        btnToggleValores.addEventListener('click', () => {
            valoresOcultos = !valoresOcultos;
            if (valoresOcultos) {
                coverflowStage.classList.add('blur-values');
                iconeOlho.textContent = '🙈';
                labelToggleValores.textContent = 'Mostrar valores';
            } else {
                coverflowStage.classList.remove('blur-values');
                iconeOlho.textContent = '👁️';
                labelToggleValores.textContent = 'Ocultar valores';
            }
        });

        btnCoverflowPrev.addEventListener('click', () => navegarCoverflow(-1));
        btnCoverflowNext.addEventListener('click', () => navegarCoverflow(1));

        window.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') navegarCoverflow(-1);
            if (e.key === 'ArrowRight') navegarCoverflow(1);
        });

        filtroEmpresa.addEventListener('change', () => { cardAtivoIndex = 0; montarCardsCoverflow(); });
        filtroFaixaValor.addEventListener('change', () => { cardAtivoIndex = 0; montarCardsCoverflow(); });
        filtroBuscaContrato.addEventListener('input', () => { cardAtivoIndex = 0; montarCardsCoverflow(); });

        btnFiltrarInadimplencias.addEventListener('click', abrirModalInadimplencias);
        btnFecharModalInadimplencias.addEventListener('click', fecharModalInadimplencias);
        btnMarcarTodos.addEventListener('click', () => {
            document.querySelectorAll('#checklistInadimplencias input[type="checkbox"]').forEach(cb => cb.checked = true);
        });
        btnDesmarcarTodos.addEventListener('click', () => {
            document.querySelectorAll('#checklistInadimplencias input[type="checkbox"]').forEach(cb => cb.checked = false);
        });
        btnSalvarSelecaoInadimplencias.addEventListener('click', salvarSelecaoInadimplencias);
    }

    // =========================================================================
    // CARREGAMENTO DE DADOS DO SUPABASE
    // =========================================================================
    async function carregarDados() {
        try {
            const [emps, ctrs] = await Promise.all([
                window.BpoSupabase.request('companies', { method: 'GET' }),
                window.BpoSupabase.request('contracts', { method: 'GET' })
            ]);

            empresas = emps || [];
            contratos = ctrs || [];

            companiesMap.clear();
            empresas.forEach(e => companiesMap.set(e.id, e));

            contratosMap.clear();
            contratos.forEach(c => contratosMap.set(c.id, c));

            // Preenche select de empresas no filtro
            filtroEmpresa.innerHTML = '<option value="all">Todas as empresas</option>' + 
                empresas.map(e => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.trade_name || e.name)}</option>`).join('');

            // Busca clientes para os contratos
            try {
                const clientes = await window.BpoSupabase.request('people', { method: 'GET' });
                const clientesMap = new Map();
                clientes.forEach(p => clientesMap.set(p.id, p));
                contratos.forEach(c => {
                    if (c.client_id && clientesMap.has(c.client_id)) {
                        c._clientName = clientesMap.get(c.client_id).name;
                    }
                });
            } catch (e) {
                console.warn('Erro ao carregar clientes:', e);
            }

            // Carrega todos os recibos para determinar quitações e saldos
            try {
                const recs = await window.BpoSupabase.request('receipts', { method: 'GET' });
                receiptsMap.clear();
                (recs || []).forEach(r => {
                    let docId = r.document_id;
                    if (!docId && r.notes && r.notes.includes('[doc_id:')) {
                        const m = r.notes.match(/\[doc_id:([a-f0-9\-]+)\]/);
                        if (m) docId = m[1];
                    }
                    if (docId) {
                        if (!receiptsMap.has(docId)) receiptsMap.set(docId, []);
                        receiptsMap.get(docId).push(r);
                    }
                });
            } catch (e) {
                console.warn('Erro ao carregar recibos:', e);
            }

            // Carrega documentos da competência e histórico para inadimplências
            await carregarDocumentosCompetencia();
            await carregarTodosDocumentos();

            processarDados();

        } catch (err) {
            console.error('Erro ao carregar dados do Relatório Gerencial:', err);
        }
    }

    async function carregarDocumentosCompetencia() {
        try {
            const docs = await window.BpoSupabase.request(
                `billing_documents?competence_month=eq.${competenciaAtiva}&status=neq.cancelled`,
                { method: 'GET' }
            );
            documentosCompetencia = docs || [];
        } catch (e) {
            console.error('Erro ao buscar documentos da competência:', e);
            documentosCompetencia = [];
        }
    }

    async function carregarTodosDocumentos() {
        try {
            const docs = await window.BpoSupabase.request(
                `billing_documents?status=neq.cancelled`,
                { method: 'GET' }
            );
            todosDocumentos = docs || [];
        } catch (e) {
            console.error('Erro ao buscar histórico de documentos:', e);
            todosDocumentos = [];
        }
    }

    // =========================================================================
    // FÓRMULAS E CRITÉRIOS IDÊNTICOS AO MÓDULO DE FATURAMENTO
    // =========================================================================

    // Faturamento Total = gross_amount + extras - discounts
    function calcularFaturamentoTotal(doc) {
        const taxDetails = (doc.tax_details && typeof doc.tax_details === 'object')
            ? doc.tax_details
            : (window.BpoFiscalUtils ? window.BpoFiscalUtils.extrairTaxDetails(doc) : {});

        const bCents = window.BpoMoney.toCents(doc.gross_amount);
        const dCents = (taxDetails && taxDetails.desconto != null)
            ? window.BpoMoney.toCents(taxDetails.desconto)
            : (doc.discounts ? window.BpoMoney.toCents(doc.discounts) : 0n);
        const eCents = (taxDetails && taxDetails.extras != null)
            ? window.BpoMoney.toCents(taxDetails.extras)
            : 0n;

        const total = (bCents + eCents) > dCents ? (bCents + eCents - dCents) : 0n;
        return total;
    }

    // Imposto e Líquido calculados de acordo com os critérios do Faturamento
    function calcularTributosELiquidoDoc(doc, emp) {
        const taxDetails = (doc.tax_details && typeof doc.tax_details === 'object')
            ? doc.tax_details
            : (window.BpoFiscalUtils ? window.BpoFiscalUtils.extrairTaxDetails(doc) : {});

        const fatTotalCents = calcularFaturamentoTotal(doc);
        const fatTotalNum = Number(fatTotalCents) / 100;
        const isLP = emp && emp.tax_regime === 'lucro_presumido';
        const retCents = window.BpoMoney.toCents(doc.retentions);
        const isLocacao = (doc.document_type === 'locacao') || !!(taxDetails && taxDetails.is_locacao);
        const itemType = (taxDetails && taxDetails.item_type) || 'servico';
        const issRetido = !!(taxDetails && taxDetails.iss_retained);

        if (isLP) {
            // Lucro Presumido
            const pisCents = (taxDetails && taxDetails.pis_valor != null)
                ? window.BpoMoney.toCents(taxDetails.pis_valor)
                : BigInt(Math.round(fatTotalNum * 0.0065 * 100));
            const cofinsCents = (taxDetails && taxDetails.cofins_valor != null)
                ? window.BpoMoney.toCents(taxDetails.cofins_valor)
                : BigInt(Math.round(fatTotalNum * 0.03 * 100));

            const aliqIss = (taxDetails && taxDetails.iss_aliq != null) ? Number(taxDetails.iss_aliq) : 3.0;
            const issCents = !isLocacao
                ? (taxDetails && taxDetails.iss_valor != null
                    ? window.BpoMoney.toCents(taxDetails.iss_valor)
                    : BigInt(Math.round(fatTotalNum * (aliqIss / 100) * 100)))
                : 0n;

            let irpjBrutoCents;
            let csllCents;

            if (taxDetails && taxDetails.irpj_valor !== undefined && taxDetails.irpj_valor !== null && String(taxDetails.irpj_valor).trim() !== '') {
                irpjBrutoCents = window.BpoMoney.toCents(taxDetails.irpj_valor);
            } else {
                const aliqIrpj = itemType === 'produto' ? 0.012 : 0.048;
                irpjBrutoCents = BigInt(Math.round(fatTotalNum * aliqIrpj * 100));
            }

            if (taxDetails && taxDetails.csll_valor !== undefined && taxDetails.csll_valor !== null && String(taxDetails.csll_valor).trim() !== '') {
                csllCents = window.BpoMoney.toCents(taxDetails.csll_valor);
            } else {
                const aliqCsll = itemType === 'produto' ? 0.0108 : 0.0288;
                csllCents = BigInt(Math.round(fatTotalNum * aliqCsll * 100));
            }

            // IRRF retido do documento
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

            // Total do Imposto Gerado pelo lançamento
            const impostoGeradoCents = pisCents + cofinsCents + issCents + irpjBrutoCents + csllCents;

            // Líquido Econômico do Faturamento
            const deducoesTotais = pisCents + cofinsCents + issCents + irpjLiqCents + csllCents + irrfDocCents;
            const liquidoCents = fatTotalCents > deducoesTotais ? (fatTotalCents - deducoesTotais) : 0n;

            return {
                faturadoCents: fatTotalCents,
                impostoCents: impostoGeradoCents,
                liquidoCents: liquidoCents
            };
        } else {
            // Simples Nacional: DAS proporcional
            const anexoKey = (taxDetails && taxDetails.das_anexo) || 'anexo_iii';
            const issIsento = isLocacao || !!(taxDetails && taxDetails.iss_isento_simples);
            const rbt12Num = (taxDetails && taxDetails.das_rbt12)
                ? Number(window.BpoMoney.toCents(taxDetails.das_rbt12)) / 100
                : 180000;

            let aliquotaDas = 0.06;
            if (window.BpoTaxEngine) {
                try {
                    const apuracao = window.BpoTaxEngine.apurarSimplesNacional(rbt12Num, fatTotalNum, anexoKey, {
                        issRetidoTomador: issRetido,
                        issIsento: issIsento
                    });
                    aliquotaDas = apuracao.aliquotaEfetivaNumero || 0.06;
                } catch (e) {
                    aliquotaDas = 0.06;
                }
            }

            const impostoGeradoCents = BigInt(Math.round(fatTotalNum * aliquotaDas * 100));
            const deducoesTotais = impostoGeradoCents + retCents;
            const liquidoCents = fatTotalCents > deducoesTotais ? (fatTotalCents - deducoesTotais) : 0n;

            return {
                faturadoCents: fatTotalCents,
                impostoCents: impostoGeradoCents,
                liquidoCents: liquidoCents
            };
        }
    }

    // =========================================================================
    // 1. CARDS SUPERIORES: ALÍQUOTA EFETIVA POR EMPRESA
    // =========================================================================
    function renderizarCardsSuperiores() {
        if (!containerCardsEmpresas) return;

        const coresEmpresas = ['#3b82f6', '#10b981', '#f59e0b', '#a855f7'];

        const cardsHtml = empresas.map((emp, idx) => {
            const docsEmp = documentosCompetencia.filter(d => d.company_id === emp.id);

            let totalFaturadoCents = 0n;
            let totalImpostosCents = 0n;

            docsEmp.forEach(d => {
                const res = calcularTributosELiquidoDoc(d, emp);
                totalFaturadoCents += res.faturadoCents;
                totalImpostosCents += res.impostoCents;
            });

            let aliquotaTexto = 'Sem faturamento';
            if (totalFaturadoCents > 0n) {
                const aliq = (Number(totalImpostosCents) / Number(totalFaturadoCents) * 100).toFixed(2);
                aliquotaTexto = `${aliq}%`;
            }

            const cor = coresEmpresas[idx % coresEmpresas.length];

            return `
                <div class="card-empresa-stat" style="--accent-color: ${cor};">
                    <div class="card-empresa-nome">
                        <span>${escapeHtml(emp.trade_name || emp.name)}</span>
                        <span class="badge" style="font-size:0.7rem; background:rgba(255,255,255,0.06); color:#cbd5e1;">
                            ${emp.tax_regime === 'lucro_presumido' ? 'Lucro Presumido' : 'Simples Nacional'}
                        </span>
                    </div>
                    <div class="card-empresa-aliq-label">Alíquota Efetiva na Competência</div>
                    <div class="card-empresa-aliq-val" style="font-size: ${aliquotaTexto === 'Sem faturamento' ? '1.25rem' : '1.7rem'}; color: ${aliquotaTexto === 'Sem faturamento' ? 'var(--text-muted)' : cor};">
                        ${aliquotaTexto}
                    </div>
                </div>
            `;
        }).join('');

        containerCardsEmpresas.innerHTML = cardsHtml;
    }

    // =========================================================================
    // 2. EXTRAÇÃO E FILTRAGEM DE ITENS PARA O COVERFLOW
    // =========================================================================
    function extrairContratosFaturados() {
        const itens = [];
        documentosCompetencia.forEach(d => {
            const emp = companiesMap.get(d.company_id);
            const ctr = contratosMap.get(d.contract_id);
            const res = calcularTributosELiquidoDoc(d, emp);

            const nomeEmpresa = emp ? (emp.trade_name || emp.name) : 'Empresa';
            const nomeContrato = ctr 
                ? (ctr._clientName || ctr.name || ctr.code || 'Contrato Sem Nome')
                : (d.description ? (window.BpoFiscalUtils ? window.BpoFiscalUtils.limparDescricao(d.description) : d.description) : 'Lançamento Avulso');

            const docNum = d.document_number ? `Doc: ${d.document_number}` : '';

            itens.push({
                id: d.id,
                empresaNome: nomeEmpresa,
                contratoNome: nomeContrato,
                subtitulo: docNum || (ctr ? `CTR: ${ctr.code}` : 'Faturamento'),
                faturadoCents: res.faturadoCents,
                impostoCents: res.impostoCents,
                liquidoCents: res.liquidoCents
            });
        });

        // Ordena por maior valor faturado
        itens.sort((a, b) => (b.faturadoCents > a.faturadoCents ? 1 : -1));
        return itens;
    }

    // Identifica títulos vencidos em aberto (Inadimplências) usando a lógica do Faturamento
    function extrairInadimplencias() {
        const itens = [];
        const hojeStr = new Date().toISOString().split('T')[0];

        todosDocumentos.forEach(d => {
            if (d.status === 'cancelled') return;
            if (!d.due_date || d.due_date >= hojeStr) return; // Apenas vencidos antes de hoje

            // Verifica recebimentos
            const docRecs = receiptsMap.get(d.id) || [];
            const totalRecebidoCents = docRecs.reduce((acc, r) => acc + window.BpoMoney.toCents(r.gross_amount), 0n);
            const liqEsperadoCents = window.BpoMoney.toCents(d.net_amount);

            if (totalRecebidoCents >= liqEsperadoCents && liqEsperadoCents > 0n) return;
            if (d.status === 'paid') return;

            const emp = companiesMap.get(d.company_id);
            const ctr = contratosMap.get(d.contract_id);
            const res = calcularTributosELiquidoDoc(d, emp);

            // Saldo faturado devedor
            let saldoFaturadoCents = res.faturadoCents;
            if (totalRecebidoCents > 0n) {
                saldoFaturadoCents = res.faturadoCents > totalRecebidoCents ? (res.faturadoCents - totalRecebidoCents) : 0n;
            }
            if (saldoFaturadoCents <= 0n) return;

            const nomeEmpresa = emp ? (emp.trade_name || emp.name) : 'Empresa';
            const nomeContrato = ctr 
                ? (ctr._clientName || ctr.name || ctr.code || 'Contrato Sem Nome')
                : (d.description ? (window.BpoFiscalUtils ? window.BpoFiscalUtils.limparDescricao(d.description) : d.description) : 'Lançamento Avulso');

            itens.push({
                id: d.id,
                company_id: d.company_id,
                contract_id: d.contract_id,
                empresaNome: nomeEmpresa,
                contratoNome: nomeContrato,
                subtitulo: `Vencimento: ${formatarData(d.due_date)}${d.document_number ? ` • Nº ${d.document_number}` : ''}`,
                faturadoCents: saldoFaturadoCents,
                impostoCents: res.impostoCents,
                liquidoCents: res.liquidoCents > totalRecebidoCents ? (res.liquidoCents - totalRecebidoCents) : res.liquidoCents
            });
        });

        // Ordena por vencimento / maior valor
        itens.sort((a, b) => (b.faturadoCents > a.faturadoCents ? 1 : -1));
        return itens;
    }

    function montarCardsCoverflow() {
        if (modoAtual === 'contratos') {
            cardsParaExibir = extrairContratosFaturados();
        } else {
            // Modo Inadimplência: aplica filtros e seleção manual
            listaInadimplenciaTotal = extrairInadimplencias();

            // Se ainda não inicializou os IDs selecionados, seleciona todos inicialmente
            if (idsInadimplenciaSelecionados.size === 0 && listaInadimplenciaTotal.length > 0) {
                listaInadimplenciaTotal.forEach(item => idsInadimplenciaSelecionados.add(item.id));
            }

            const empFiltro = filtroEmpresa.value;
            const faixaFiltro = filtroFaixaValor.value;
            const buscaFiltro = (filtroBuscaContrato.value || '').trim().toLowerCase();

            cardsParaExibir = listaInadimplenciaTotal.filter(item => {
                // Filtro por seleção manual
                if (!idsInadimplenciaSelecionados.has(item.id)) return false;

                // Filtro Empresa
                if (empFiltro !== 'all' && item.company_id !== empFiltro) return false;

                // Filtro Faixa de Valor
                const valorNum = Number(item.faturadoCents) / 100;
                if (faixaFiltro === 'ate_5k' && valorNum > 5000) return false;
                if (faixaFiltro === '5k_20k' && (valorNum <= 5000 || valorNum > 20000)) return false;
                if (faixaFiltro === 'acima_20k' && valorNum <= 20000) return false;

                // Busca textual
                if (buscaFiltro) {
                    const texto = `${item.contratoNome} ${item.empresaNome} ${item.subtitulo}`.toLowerCase();
                    if (!texto.includes(buscaFiltro)) return false;
                }

                return true;
            });

            if (contagemSelecionados) {
                contagemSelecionados.textContent = `${cardsParaExibir.length}/${listaInadimplenciaTotal.length}`;
            }
        }

        if (cardAtivoIndex >= cardsParaExibir.length) {
            cardAtivoIndex = Math.max(0, cardsParaExibir.length - 1);
        }

        renderizarCoverflow();
    }

    // =========================================================================
    // 3. RENDERIZAÇÃO DO CARROSSEL COVERFLOW 3D EM PERSPECTIVA
    // =========================================================================
    function renderizarCoverflow() {
        if (!coverflowContainer) return;

        if (cardsParaExibir.length === 0) {
            coverflowContainer.innerHTML = `
                <div style="text-align:center; color:var(--text-muted); padding:40px;">
                    <div style="font-size:2.5rem; margin-bottom:12px;">📂</div>
                    <p style="font-size:1.05rem; font-weight:600; color:#fff;">Nenhum item disponível para exibição</p>
                    <p style="font-size:0.85rem;">Não foram encontrados ${modoAtual === 'contratos' ? 'contratos faturados na competência selecionada' : 'títulos inadimplentes com os filtros atuais'}.</p>
                </div>
            `;
            if (coverflowCounter) coverflowCounter.textContent = '0 de 0';
            return;
        }

        coverflowContainer.innerHTML = cardsParaExibir.map((item, idx) => {
            return `
                <div class="coverflow-card" data-index="${idx}">
                    <div>
                        <div class="card-header-badge">
                            <span class="card-empresa-tag">${escapeHtml(item.empresaNome)}</span>
                            <span class="badge" style="font-size:0.72rem; background:rgba(255,255,255,0.06); color:#cbd5e1;">#${idx + 1}</span>
                        </div>
                        <div class="card-contrato-title" title="${escapeHtml(item.contratoNome)}">
                            ${escapeHtml(item.contratoNome)}
                        </div>
                        <div class="card-contrato-sub">${escapeHtml(item.subtitulo)}</div>
                    </div>

                    <div class="card-metricas-trio">
                        <div class="metrica-row">
                            <span class="metrica-label">Valor Faturado:</span>
                            <span class="metrica-val val-faturado">${window.BpoMoney.formatBRL(item.faturadoCents)}</span>
                        </div>
                        <div class="metrica-row">
                            <span class="metrica-label">Imposto Gerado:</span>
                            <span class="metrica-val val-imposto">${window.BpoMoney.formatBRL(item.impostoCents)}</span>
                        </div>
                        <div class="metrica-row">
                            <span class="metrica-label">Valor Líquido:</span>
                            <span class="metrica-val val-liquido">${window.BpoMoney.formatBRL(item.liquidoCents)}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Adiciona clique aos cards para navegação direta
        coverflowContainer.querySelectorAll('.coverflow-card').forEach(el => {
            el.addEventListener('click', () => {
                const idx = parseInt(el.dataset.index, 10);
                if (!isNaN(idx) && idx !== cardAtivoIndex) {
                    cardAtivoIndex = idx;
                    atualizarTransformacoesCoverflow();
                }
            });
        });

        atualizarTransformacoesCoverflow();
    }

    function atualizarTransformacoesCoverflow() {
        const cards = coverflowContainer.querySelectorAll('.coverflow-card');
        const total = cards.length;
        if (total === 0) return;

        cards.forEach((card, idx) => {
            const diff = idx - cardAtivoIndex;

            if (diff === 0) {
                // Card Central em Destaque
                card.className = 'coverflow-card center';
                card.style.transform = `translateX(0px) translateZ(120px) rotateY(0deg) scale(1.05)`;
                card.style.zIndex = '50';
                card.style.opacity = '1';
                card.style.filter = 'none';
            } else if (diff < 0) {
                // Cards à Esquerda (inclinados para a direita, rotacionados em Y)
                const distance = Math.abs(diff);
                const xOffset = -220 - (distance - 1) * 75;
                const zOffset = -100 - (distance - 1) * 60;
                const rotY = Math.min(45 + (distance - 1) * 5, 65);
                const opacity = Math.max(0.2, 0.9 - distance * 0.18);

                card.className = 'coverflow-card left';
                card.style.transform = `translateX(${xOffset}px) translateZ(${zOffset}px) rotateY(${rotY}deg) scale(${Math.max(0.75, 0.9 - distance * 0.05)})`;
                card.style.zIndex = `${50 - distance}`;
                card.style.opacity = `${opacity}`;
                card.style.filter = `brightness(${Math.max(0.4, 0.8 - distance * 0.1)})`;
            } else {
                // Cards à Direita (inclinados para a esquerda, rotacionados em Y negativo)
                const distance = Math.abs(diff);
                const xOffset = 220 + (distance - 1) * 75;
                const zOffset = -100 - (distance - 1) * 60;
                const rotY = -Math.min(45 + (distance - 1) * 5, 65);
                const opacity = Math.max(0.2, 0.9 - distance * 0.18);

                card.className = 'coverflow-card right';
                card.style.transform = `translateX(${xOffset}px) translateZ(${zOffset}px) rotateY(${rotY}deg) scale(${Math.max(0.75, 0.9 - distance * 0.05)})`;
                card.style.zIndex = `${50 - distance}`;
                card.style.opacity = `${opacity}`;
                card.style.filter = `brightness(${Math.max(0.4, 0.8 - distance * 0.1)})`;
            }
        });

        if (coverflowCounter) {
            coverflowCounter.textContent = `${cardAtivoIndex + 1} de ${total}`;
        }
    }

    function navegarCoverflow(direcao) {
        if (cardsParaExibir.length === 0) return;
        const novoIdx = cardAtivoIndex + direcao;
        if (novoIdx >= 0 && novoIdx < cardsParaExibir.length) {
            cardAtivoIndex = novoIdx;
            atualizarTransformacoesCoverflow();
        }
    }

    // =========================================================================
    // MODAL DE SELEÇÃO MANUAL DE INADIMPLÊNCIAS
    // =========================================================================
    function abrirModalInadimplencias() {
        if (!modalSelecaoInadimplencias || !checklistInadimplencias) return;

        checklistInadimplencias.innerHTML = listaInadimplenciaTotal.map(item => {
            const isChecked = idsInadimplenciaSelecionados.has(item.id);
            return `
                <label class="checklist-item">
                    <input type="checkbox" value="${item.id}" ${isChecked ? 'checked' : ''}>
                    <div style="flex:1;">
                        <strong style="color:#fff;">${escapeHtml(item.contratoNome)}</strong>
                        <span style="font-size:0.75rem; color:var(--text-muted); display:block;">
                            ${escapeHtml(item.empresaNome)} • ${item.subtitulo} • ${window.BpoMoney.formatBRL(item.faturadoCents)}
                        </span>
                    </div>
                </label>
            `;
        }).join('');

        modalSelecaoInadimplencias.style.display = 'flex';
    }

    function fecharModalInadimplencias() {
        if (modalSelecaoInadimplencias) modalSelecaoInadimplencias.style.display = 'none';
    }

    function salvarSelecaoInadimplencias() {
        idsInadimplenciaSelecionados.clear();
        document.querySelectorAll('#checklistInadimplencias input[type="checkbox"]:checked').forEach(cb => {
            idsInadimplenciaSelecionados.add(cb.value);
        });

        fecharModalInadimplencias();
        cardAtivoIndex = 0;
        montarCardsCoverflow();
    }

    function processarDados() {
        renderizarCardsSuperiores();
        montarCardsCoverflow();
    }

    function formatarData(dataStr) {
        if (!dataStr) return '—';
        const p = dataStr.split('T')[0].split('-');
        if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`;
        return dataStr;
    }

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
})();
