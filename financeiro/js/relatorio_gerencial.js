/**
 * Módulo 10 — Relatório Gerencial
 * - Competência e cards superiores por empresa (busca exatamente as informações de apuração do módulo de impostos)
 * - Carrossel 3D em formato de Octógono com espaçamento para que os cards não se encostem
 * - Valores faturado, imposto e líquido extraídos diretamente das apurações do sistema (Faturamento/Impostos)
 * - Ocultar/Mostrar valores monetários e filtros de inadimplência
 */

(function() {
    let empresas = [];
    let contratos = [];
    let documentosCompetencia = [];
    let todosDocumentos = [];
    let receiptsMap = new Map();
    let companiesMap = new Map();
    let contratosMap = new Map();

    // Cache de RBT12 real por empresa (calculado exatamente como no módulo de impostos)
    let rbt12PorEmpresaMap = new Map();

    // Map com a apuração oficial de cada empresa na competência ativa (mesmas variáveis do módulo de impostos)
    let apuracaoPorEmpresaMap = new Map();

    let competenciaAtiva = '';
    let modoAtual = 'contratos'; // 'contratos' | 'inadimplencia'
    let valoresOcultos = false;
    let cardAtivoIndex = 0;

    // Animação fluida e contínua do octógono (via requestAnimationFrame a 60fps)
    let anguloAtualGraus = 0;
    let anguloAlvoGraus = 0;
    let animacaoFrameId = null;
    let autoplayPausado = false;
    let velocidadeContinuaGrausPorSegundo = 10; // Velocidade suave e constante de rotação contínua (360° em 36s)
    let ultimoTimestamp = 0;

    // Itens ativos no Carrossel
    let cardsParaExibir = [];

    // Seleção manual de inadimplências
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
    const coverflowCarousel3D = document.getElementById('coverflowCarousel3D');
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
            await processarApuracaoFiscalEmpresas();
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
            montarCardsCarrossel();
        });

        tabModoInadimplencia.addEventListener('click', () => {
            if (modoAtual === 'inadimplencia') return;
            modoAtual = 'inadimplencia';
            tabModoInadimplencia.classList.add('active');
            tabModoContratos.classList.remove('active');
            barraFiltrosInadimplencia.style.display = 'flex';
            btnFiltrarInadimplencias.style.display = 'inline-flex';
            cardAtivoIndex = 0;
            montarCardsCarrossel();
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

        btnCoverflowPrev.addEventListener('click', () => {
            reiniciarAutoplay();
            navegarCarrossel(-1);
        });
        btnCoverflowNext.addEventListener('click', () => {
            reiniciarAutoplay();
            navegarCarrossel(1);
        });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') {
                reiniciarAutoplay();
                navegarCarrossel(-1);
            }
            if (e.key === 'ArrowRight') {
                reiniciarAutoplay();
                navegarCarrossel(1);
            }
        });

        // Pausa automática quando o usuário passa o mouse por cima do palco para leitura
        if (coverflowStage) {
            coverflowStage.addEventListener('mouseenter', () => {
                autoplayPausado = true;
            });
            coverflowStage.addEventListener('mouseleave', () => {
                autoplayPausado = false;
            });
            // Suporte para touch em telas sensíveis
            coverflowStage.addEventListener('touchstart', () => {
                autoplayPausado = true;
            }, { passive: true });
            coverflowStage.addEventListener('touchend', () => {
                setTimeout(() => { autoplayPausado = false; }, 2000);
            }, { passive: true });
        }

        filtroEmpresa.addEventListener('change', () => { cardAtivoIndex = 0; montarCardsCarrossel(); });
        filtroFaixaValor.addEventListener('change', () => { cardAtivoIndex = 0; montarCardsCarrossel(); });
        filtroBuscaContrato.addEventListener('input', () => { cardAtivoIndex = 0; montarCardsCarrossel(); });

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

            // Busca clientes
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

            // Recibos para verificação de quitação
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

            await carregarDocumentosCompetencia();
            await carregarTodosDocumentos();

            await processarApuracaoFiscalEmpresas();
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

    // Calcula os 12 meses anteriores para RBT12 exatamente como no Módulo de Impostos
    function obterMesesRbt12(comp) {
        const [anoStr, mesStr] = comp.split('-');
        let ano = parseInt(anoStr, 10);
        let mes = parseInt(mesStr, 10);
        const meses = [];
        for (let i = 0; i < 12; i++) {
            mes -= 1;
            if (mes === 0) {
                mes = 12;
                ano -= 1;
            }
            meses.push(`${ano}-${String(mes).padStart(2, '0')}`);
        }
        return meses;
    }

    async function calcularRbt12RealEmpresa(empresaId, comp) {
        const meses12 = obterMesesRbt12(comp);
        try {
            const inQuery = meses12.join(',');
            const docs12 = await window.BpoSupabase.request(
                `billing_documents?company_id=eq.${empresaId}&competence_month=in.(${inQuery})&status=neq.cancelled`,
                { method: 'GET' }
            );
            let totalCents = 0n;
            (docs12 || []).forEach(d => {
                const td = d.tax_details || (window.BpoFiscalUtils ? window.BpoFiscalUtils.extrairTaxDetails(d) : {});
                totalCents += calcularFaturamentoTotalDoc(d, td);
            });
            return Number(totalCents) / 100;
        } catch (e) {
            console.warn(`Erro ao calcular RBT12 da empresa ${empresaId}:`, e);
            return 0;
        }
    }

    function calcularFaturamentoTotalDoc(doc, taxDetails) {
        const td = taxDetails || (doc.tax_details && typeof doc.tax_details === 'object' ? doc.tax_details : (window.BpoFiscalUtils ? window.BpoFiscalUtils.extrairTaxDetails(doc) : {}));
        const b = window.BpoMoney.toCents(doc.gross_amount);
        const d = (td && td.desconto != null)
            ? window.BpoMoney.toCents(td.desconto)
            : (doc.discounts ? window.BpoMoney.toCents(doc.discounts) : 0n);
        const e = (td && td.extras != null)
            ? window.BpoMoney.toCents(td.extras)
            : 0n;
        const total = (b + e) > d ? (b + e - d) : 0n;
        return total;
    }

    // =========================================================================
    // APURAÇÃO FISCAL OFICIAL ESPELHADA DO MÓDULO DE IMPOSTOS
    // =========================================================================
    async function processarApuracaoFiscalEmpresas() {
        apuracaoPorEmpresaMap.clear();
        rbt12PorEmpresaMap.clear();

        for (const emp of empresas) {
            const docsEmp = documentosCompetencia.filter(d => d.company_id === emp.id);
            let fatEmpCents = 0n;
            let retEmpCents = 0n;
            let servicosCents = 0n;
            let produtosCents = 0n;

            docsEmp.forEach(d => {
                const r = window.BpoMoney.toCents(d.retentions);
                const td = d.tax_details || (window.BpoFiscalUtils ? window.BpoFiscalUtils.extrairTaxDetails(d) : {});
                const fatDoc = calcularFaturamentoTotalDoc(d, td);
                fatEmpCents += fatDoc;
                retEmpCents += r;

                const itemType = (td && td.item_type) || 'servico';
                if (itemType === 'produto') produtosCents += fatDoc;
                else servicosCents += fatDoc;
            });

            const isLucroPresumido = emp.tax_regime === 'lucro_presumido';
            let impostoApuradoEmpCents = 0n;
            let cargaEfetivaTexto = 'Sem faturamento';

            if (isLucroPresumido) {
                // Lucro Presumido
                const [anoStr, mesStr] = competenciaAtiva.split('-');
                const ano = parseInt(anoStr, 10);
                const mes = parseInt(mesStr, 10);
                const numTrimestre = Math.ceil(mes / 3);

                let irrfRetidoMesCents = 0n;
                let issTotalMesCents = 0n;

                docsEmp.forEach(d => {
                    const td = d.tax_details || (window.BpoFiscalUtils ? window.BpoFiscalUtils.extrairTaxDetails(d) : {});
                    const val = calcularFaturamentoTotalDoc(d, td);
                    const valNum = Number(val) / 100;
                    const isLoc = (d.document_type === 'locacao') || !!(td && td.is_locacao);
                    const itemT = (td && td.item_type) || 'servico';
                    const aIss = (td && td.iss_aliq !== undefined && td.iss_aliq !== null) ? Number(td.iss_aliq) : 3.0;

                    if (itemT === 'servico' && !isLoc) {
                        issTotalMesCents += BigInt(Math.round(valNum * (aIss / 100) * 100));
                    }

                    if (td && td.has_irrf) {
                        const aliq = (td.irrf_aliq !== undefined && td.irrf_aliq !== null) ? td.irrf_aliq : 4.8;
                        irrfRetidoMesCents += BigInt(Math.round(valNum * (aliq / 100) * 100));
                    } else {
                        const r = window.BpoMoney.toCents(d.retentions);
                        const issRet = !!(td && td.iss_retained);
                        if (r > 0n && !issRet) {
                            irrfRetidoMesCents += r;
                        }
                    }
                });

                const fatTotalMesNum = Number(fatEmpCents) / 100;
                const L_m = 1250000 / 3;
                const baseServMes = Math.max(0, ((fatTotalMesNum - L_m) * 0.352) + (400000 / 3));
                const irpjTotServMes = (baseServMes * 0.15) + Math.max(0, (baseServMes - 20000) * 0.10);
                const csllTotServMes = baseServMes * 0.09;

                const baseProdMes = Math.max(0, ((fatTotalMesNum - L_m) * 0.088) + (100000 / 3));
                const irpjTotProdMes = (baseProdMes * 0.15) + Math.max(0, (baseProdMes - 20000) * 0.10);
                const csllTotProdMes = Math.max(0, ((fatTotalMesNum - L_m) * 0.132) + (150000 / 3)) * 0.09;

                const aliqIrpjServPlanilha = fatTotalMesNum > 0 ? (irpjTotServMes / fatTotalMesNum) : 0.048;
                const aliqCsllServPlanilha = fatTotalMesNum > 0 ? (csllTotServMes / fatTotalMesNum) : 0.0288;
                const aliqIrpjProdPlanilha = fatTotalMesNum > 0 ? (irpjTotProdMes / fatTotalMesNum) : 0.012;
                const aliqCsllProdPlanilha = fatTotalMesNum > 0 ? (csllTotProdMes / fatTotalMesNum) : 0.0108;

                const pisCents = BigInt(Math.round((Number(fatEmpCents) / 100) * 0.0065 * 100));
                const cofinsCents = BigInt(Math.round((Number(fatEmpCents) / 100) * 0.03 * 100));
                const issCents = issTotalMesCents;

                const irpjServMesCents = BigInt(Math.round((Number(servicosCents) / 100) * aliqIrpjServPlanilha * 100));
                const irpjProdMesCents = BigInt(Math.round((Number(produtosCents) / 100) * aliqIrpjProdPlanilha * 100));
                const irpjProvCents = irpjServMesCents + irpjProdMesCents;

                const csllServMesCents = BigInt(Math.round((Number(servicosCents) / 100) * aliqCsllServPlanilha * 100));
                const csllProdMesCents = BigInt(Math.round((Number(produtosCents) / 100) * aliqCsllProdPlanilha * 100));
                const csllProvCents = csllServMesCents + csllProdMesCents;

                impostoApuradoEmpCents = pisCents + cofinsCents + issCents + irpjProvCents + csllProvCents;

                if (fatEmpCents > 0n) {
                    cargaEfetivaTexto = `${(Number(impostoApuradoEmpCents) / Number(fatEmpCents) * 100).toFixed(2)}%`;
                }

                apuracaoPorEmpresaMap.set(emp.id, {
                    totalFaturadoCents: fatEmpCents,
                    totalImpostosCents: impostoApuradoEmpCents,
                    cargaEfetivaTexto: cargaEfetivaTexto,
                    aliqIrpjServPlanilha,
                    aliqCsllServPlanilha,
                    aliqIrpjProdPlanilha,
                    aliqCsllProdPlanilha
                });

            } else {
                // Simples Nacional: DZM / YBOX
                const rbt12Calculado = await calcularRbt12RealEmpresa(emp.id, competenciaAtiva);
                rbt12PorEmpresaMap.set(emp.id, rbt12Calculado);

                let anexoEmp = 'anexo_iii';
                let rbt12Emp = rbt12Calculado > 0 ? rbt12Calculado : 180000;

                let fatSemIsencaoIssCents = 0n;
                let fatComIsencaoIssCents = 0n;

                docsEmp.forEach(d => {
                    const td = d.tax_details || (window.BpoFiscalUtils ? window.BpoFiscalUtils.extrairTaxDetails(d) : {});
                    if (td) {
                        if (td.das_anexo) anexoEmp = td.das_anexo;
                        if (rbt12Calculado <= 0 && td.das_rbt12) {
                            rbt12Emp = Number(window.BpoMoney.toCents(td.das_rbt12)) / 100;
                        }
                    }
                    const isLoc = (d.document_type === 'locacao') || !!(td && td.is_locacao);
                    const isIsentoIss = isLoc || !!(td && td.iss_isento_simples);
                    const valDoc = calcularFaturamentoTotalDoc(d, td);
                    if (isIsentoIss) {
                        fatComIsencaoIssCents += valDoc;
                    } else {
                        fatSemIsencaoIssCents += valDoc;
                    }
                });

                const fatSemIsencaoNum = Number(fatSemIsencaoIssCents) / 100;
                const fatComIsencaoNum = Number(fatComIsencaoIssCents) / 100;

                const apuracaoSemIsencao = window.BpoTaxEngine.apurarSimplesNacional(rbt12Emp, fatSemIsencaoNum, anexoEmp, {
                    issIsento: false
                });

                const apuracaoComIsencao = fatComIsencaoNum > 0
                    ? window.BpoTaxEngine.apurarSimplesNacional(rbt12Emp, fatComIsencaoNum, anexoEmp, { issIsento: true })
                    : { valorDas: 0, componentes: {} };

                const dasSemIsencaoCents = BigInt(Math.round(apuracaoSemIsencao.valorDas * 100));
                const dasComIsencaoCents = BigInt(Math.round(apuracaoComIsencao.valorDas * 100));
                const dasCents = dasSemIsencaoCents + dasComIsencaoCents;

                impostoApuradoEmpCents = dasCents;

                if (fatEmpCents > 0n) {
                    cargaEfetivaTexto = `${(Number(impostoApuradoEmpCents) / Number(fatEmpCents) * 100).toFixed(2)}%`;
                }

                apuracaoPorEmpresaMap.set(emp.id, {
                    totalFaturadoCents: fatEmpCents,
                    totalImpostosCents: impostoApuradoEmpCents,
                    cargaEfetivaTexto: cargaEfetivaTexto,
                    rbt12Real: rbt12Emp,
                    anexoEmp: anexoEmp
                });
            }
        }
    }

    // Retorna os valores faturado, imposto gerado e líquido exatamente como constam na apuração de impostos e faturamento
    function extrairValoresDoc(doc, emp) {
        const td = doc.tax_details || (window.BpoFiscalUtils ? window.BpoFiscalUtils.extrairTaxDetails(doc) : {});
        const fatTotalCents = calcularFaturamentoTotalDoc(doc, td);
        const fatTotalNum = Number(fatTotalCents) / 100;
        const isLP = emp && emp.tax_regime === 'lucro_presumido';
        const isLocacao = (doc.document_type === 'locacao') || !!(td && td.is_locacao);
        const itemType = (td && td.item_type) || 'servico';
        const issRetido = !!(td && td.iss_retained);
        const retCents = window.BpoMoney.toCents(doc.retentions);

        let tributosCents = 0n;
        let retencaoExibicaoCents = 0n;

        if (isLP) {
            const aliqIss = (td && td.iss_aliq !== undefined && td.iss_aliq !== null) ? Number(td.iss_aliq) : 3.0;

            const pisCents = (td && td.pis_valor !== undefined && td.pis_valor !== null)
                ? window.BpoMoney.toCents(td.pis_valor)
                : BigInt(Math.round(fatTotalNum * 0.0065 * 100));

            const cofinsCents = (td && td.cofins_valor !== undefined && td.cofins_valor !== null)
                ? window.BpoMoney.toCents(td.cofins_valor)
                : BigInt(Math.round(fatTotalNum * 0.03 * 100));

            let issCents = 0n;
            if (itemType === 'produto') {
                issCents = (td && td.iss_valor !== undefined && td.iss_valor !== null)
                    ? window.BpoMoney.toCents(td.iss_valor)
                    : BigInt(Math.round(fatTotalNum * (aliqIss / 100) * 100));
            } else if (itemType === 'servico' && !isLocacao) {
                issCents = BigInt(Math.round(fatTotalNum * (aliqIss / 100) * 100));
            }

            const apuracaoEmp = apuracaoPorEmpresaMap.get(doc.company_id);
            const aliqIrpjSugerida = apuracaoEmp
                ? (itemType === 'produto' ? apuracaoEmp.aliqIrpjProdPlanilha : apuracaoEmp.aliqIrpjServPlanilha)
                : (itemType === 'produto' ? 0.012 : 0.048);
            const aliqCsllSugerida = apuracaoEmp
                ? (itemType === 'produto' ? apuracaoEmp.aliqCsllProdPlanilha : apuracaoEmp.aliqCsllServPlanilha)
                : (itemType === 'produto' ? 0.0108 : 0.0288);

            let irpjBrutoCents = (td && td.irpj_valor !== undefined && td.irpj_valor !== null && String(td.irpj_valor).trim() !== '')
                ? window.BpoMoney.toCents(td.irpj_valor)
                : BigInt(Math.round(fatTotalNum * aliqIrpjSugerida * 100));

            let csllCents = (td && td.csll_valor !== undefined && td.csll_valor !== null && String(td.csll_valor).trim() !== '')
                ? window.BpoMoney.toCents(td.csll_valor)
                : BigInt(Math.round(fatTotalNum * aliqCsllSugerida * 100));

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

            const irpjCents = irpjBrutoCents > irrfDocCents ? (irpjBrutoCents - irrfDocCents) : 0n;
            retencaoExibicaoCents = irrfDocCents;

            tributosCents = pisCents + cofinsCents + issCents + irpjCents + csllCents + retencaoExibicaoCents;

            const deducoesTotais = tributosCents;
            const liquidoDocCents = fatTotalCents > deducoesTotais ? (fatTotalCents - deducoesTotais) : 0n;

            return {
                faturadoCents: fatTotalCents,
                impostoCents: tributosCents,
                liquidoCents: liquidoDocCents
            };

        } else {
            // Simples Nacional
            const anexoKey = (td && td.das_anexo) ? td.das_anexo : 'anexo_iii';
            const issIsento = isLocacao || !!(td && td.iss_isento_simples);
            const rbt12Real = rbt12PorEmpresaMap.get(doc.company_id) || 0;
            const rbt12Num = rbt12Real > 0 
                ? rbt12Real 
                : ((td && td.das_rbt12) ? Number(window.BpoMoney.toCents(td.das_rbt12)) / 100 : 180000);

            let aliqDasEfetiva = 0.06;
            if (window.BpoTaxEngine) {
                const previaSN = window.BpoTaxEngine.apurarSimplesNacional(rbt12Num, fatTotalNum, anexoKey, {
                    issIsento: issIsento
                });
                aliqDasEfetiva = previaSN.aliquotaEfetivaNumero || 0.06;
            }

            retencaoExibicaoCents = retCents;
            tributosCents = BigInt(Math.round(fatTotalNum * aliqDasEfetiva * 100));

            const deducoesTotais = tributosCents + retencaoExibicaoCents;
            const liquidoDocCents = fatTotalCents > deducoesTotais ? (fatTotalCents - deducoesTotais) : 0n;

            return {
                faturadoCents: fatTotalCents,
                impostoCents: tributosCents,
                liquidoCents: liquidoDocCents
            };
        }
    }

    // =========================================================================
    // 1. CARDS SUPERIORES: ALÍQUOTA EFETIVA OFICIAL DO MÓDULO DE IMPOSTOS
    // =========================================================================
    function renderizarCardsSuperiores() {
        if (!containerCardsEmpresas) return;

        const coresEmpresas = ['#38bdf8', '#10b981', '#f59e0b', '#a855f7'];

        const cardsHtml = empresas.map((emp, idx) => {
            const apuracao = apuracaoPorEmpresaMap.get(emp.id);
            const aliquotaTexto = apuracao ? apuracao.cargaEfetivaTexto : 'Sem faturamento';
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
    // 2. EXTRAÇÃO E FILTRAGEM DOS CARDS
    // =========================================================================
    function extrairContratosFaturados() {
        const itens = [];
        documentosCompetencia.forEach(d => {
            const emp = companiesMap.get(d.company_id);
            const ctr = contratosMap.get(d.contract_id);
            const res = extrairValoresDoc(d, emp);

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

        itens.sort((a, b) => (b.faturadoCents > a.faturadoCents ? 1 : -1));
        return itens;
    }

    function extrairInadimplencias() {
        const itens = [];
        const hojeStr = new Date().toISOString().split('T')[0];

        todosDocumentos.forEach(d => {
            if (d.status === 'cancelled') return;
            if (!d.due_date || d.due_date >= hojeStr) return;

            const docRecs = receiptsMap.get(d.id) || [];
            const totalRecebidoCents = docRecs.reduce((acc, r) => acc + window.BpoMoney.toCents(r.gross_amount), 0n);
            const liqEsperadoCents = window.BpoMoney.toCents(d.net_amount);

            if (totalRecebidoCents >= liqEsperadoCents && liqEsperadoCents > 0n) return;
            if (d.status === 'paid') return;

            const emp = companiesMap.get(d.company_id);
            const ctr = contratosMap.get(d.contract_id);
            const res = extrairValoresDoc(d, emp);

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

        itens.sort((a, b) => (b.faturadoCents > a.faturadoCents ? 1 : -1));
        return itens;
    }

    function montarCardsCarrossel() {
        if (modoAtual === 'contratos') {
            cardsParaExibir = extrairContratosFaturados();
        } else {
            listaInadimplenciaTotal = extrairInadimplencias();

            if (idsInadimplenciaSelecionados.size === 0 && listaInadimplenciaTotal.length > 0) {
                listaInadimplenciaTotal.forEach(item => idsInadimplenciaSelecionados.add(item.id));
            }

            const empFiltro = filtroEmpresa.value;
            const faixaFiltro = filtroFaixaValor.value;
            const buscaFiltro = (filtroBuscaContrato.value || '').trim().toLowerCase();

            cardsParaExibir = listaInadimplenciaTotal.filter(item => {
                if (!idsInadimplenciaSelecionados.has(item.id)) return false;
                if (empFiltro !== 'all' && item.company_id !== empFiltro) return false;

                const valorNum = Number(item.faturadoCents) / 100;
                if (faixaFiltro === 'ate_5k' && valorNum > 5000) return false;
                if (faixaFiltro === '5k_20k' && (valorNum <= 5000 || valorNum > 20000)) return false;
                if (faixaFiltro === 'acima_20k' && valorNum <= 20000) return false;

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

        renderizarCarrosselOctogonal();
    }

    // =========================================================================
    // 3. CARROSSEL 3D EM FORMATO DE OCTÓGONO ESPAÇADO
    // Um octógono regular possui 8 lados e ângulos de 45° (360° / 8).
    // Para que os cards de 380px fiquem com folga/espaçamento sem se encostar,
    // o raio do cilindro apótema precisa ser aumentado: R = (largura / (2 * tan(22.5°))) + GAP.
    // Largura = 380px => apótema mínimo colado = 458px. Com folga elegante: 560px.
    // =========================================================================
    const RAIO_OCTOGONO_PX = 560; // Espaçamento confortável que impede sobreposição física dos cards
    const ANGULO_PASSO = 45; // 360 / 8 = 45 graus por face do octógono

    function renderizarCarrosselOctogonal() {
        if (!coverflowCarousel3D) return;

        if (cardsParaExibir.length === 0) {
            coverflowCarousel3D.innerHTML = `
                <div style="text-align:center; color:var(--text-muted); padding:40px; position:absolute; width:100%; top:20%;">
                    <div style="font-size:2.5rem; margin-bottom:12px;">📂</div>
                    <p style="font-size:1.05rem; font-weight:600; color:#fff;">Nenhum item disponível para exibição</p>
                    <p style="font-size:0.85rem;">Não foram encontrados ${modoAtual === 'contratos' ? 'contratos faturados na competência selecionada' : 'títulos inadimplentes com os filtros atuais'}.</p>
                </div>
            `;
            if (coverflowCounter) coverflowCounter.textContent = '0 de 0';
            return;
        }

        coverflowCarousel3D.innerHTML = cardsParaExibir.map((item, idx) => {
            const anguloCard = idx * ANGULO_PASSO;
            const transformInicial = `rotateY(${anguloCard}deg) translateZ(${RAIO_OCTOGONO_PX}px)`;

            return `
                <div class="coverflow-card ${idx === cardAtivoIndex ? 'active-card' : 'inactive-card'}" data-index="${idx}" style="transform: ${transformInicial};">
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

        coverflowCarousel3D.querySelectorAll('.coverflow-card').forEach(el => {
            el.addEventListener('click', () => {
                const idx = parseInt(el.dataset.index, 10);
                if (!isNaN(idx) && idx !== cardAtivoIndex) {
                    reiniciarAutoplay();
                    cardAtivoIndex = idx;
                    girarCarrosselOctogonal();
                }
            });
        });

        girarCarrosselOctogonal();
        iniciarAutoplay();
    }

    function girarCarrosselOctogonal() {
        const total = cardsParaExibir.length;
        if (total === 0) return;

        // Atualiza a posição visual no espaço 3D
        coverflowCarousel3D.style.transform = `translateZ(-${RAIO_OCTOGONO_PX}px) rotateY(${anguloAtualGraus}deg)`;

        // Calcula qual card está mais próximo do centro frontal (-anguloAtualGraus)
        // O ângulo normalizado de frente é (-anguloAtualGraus) mod 360
        let anguloFrente = ((-anguloAtualGraus) % 360);
        if (anguloFrente < 0) anguloFrente += 360;

        // O card 'idx' está posicionado em (idx * ANGULO_PASSO) % 360
        let idxMaisProximo = 0;
        let menorDistancia = 999999;

        const cards = coverflowCarousel3D.querySelectorAll('.coverflow-card');
        cards.forEach((card, idx) => {
            let anguloCard = (idx * ANGULO_PASSO) % 360;
            let diff = Math.abs(anguloFrente - anguloCard);
            if (diff > 180) diff = 360 - diff;

            if (diff < menorDistancia) {
                menorDistancia = diff;
                idxMaisProximo = idx;
            }

            // Destaque visual suave para o card mais frontal (ângulo próximo a zero)
            if (diff < 22.5) {
                card.classList.add('active-card');
                card.classList.remove('inactive-card');
            } else {
                card.classList.remove('active-card');
                card.classList.add('inactive-card');
            }
        });

        cardAtivoIndex = idxMaisProximo;

        if (coverflowCounter) {
            coverflowCounter.textContent = `${cardAtivoIndex + 1} de ${total}`;
        }
    }

    function navegarCarrossel(direcao) {
        if (cardsParaExibir.length === 0) return;
        // Ao clicar nos botões ou teclas, ajusta suavemente o ângulo alvo para o próximo card (45° por passo)
        anguloAlvoGraus = Math.round((anguloAtualGraus - (direcao * ANGULO_PASSO)) / ANGULO_PASSO) * ANGULO_PASSO;
        anguloAtualGraus = anguloAlvoGraus;
        girarCarrosselOctogonal();
    }

    // =========================================================================
    // CONTROLE DE ANIMAÇÃO CONTÍNUA E FLUIDA (OCTÓGONO 3D A 60FPS)
    // =========================================================================
    function animarLoopContinuo(timestamp) {
        if (!ultimoTimestamp) ultimoTimestamp = timestamp;
        const deltaSegundos = Math.min((timestamp - ultimoTimestamp) / 1000, 0.1);
        ultimoTimestamp = timestamp;

        if (!autoplayPausado && cardsParaExibir.length > 1) {
            // Rotação suave constante
            anguloAtualGraus -= velocidadeContinuaGrausPorSegundo * deltaSegundos;
            girarCarrosselOctogonal();
        }

        animacaoFrameId = requestAnimationFrame(animarLoopContinuo);
    }

    function iniciarAutoplay() {
        if (!animacaoFrameId) {
            ultimoTimestamp = 0;
            animacaoFrameId = requestAnimationFrame(animarLoopContinuo);
        }
    }

    function pararAutoplay() {
        if (animacaoFrameId) {
            cancelAnimationFrame(animacaoFrameId);
            animacaoFrameId = null;
        }
    }

    function reiniciarAutoplay() {
        // Nada a interromper, a animação é fluida contínua
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
        montarCardsCarrossel();
    }

    function processarDados() {
        renderizarCardsSuperiores();
        montarCardsCarrossel();
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
