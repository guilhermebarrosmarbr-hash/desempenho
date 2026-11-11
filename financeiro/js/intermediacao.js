// ==============================================================================
// intermediacao.js — Lógica do Módulo 07 (Intermediação de Negócios)
// ==============================================================================

(function() {
    let empresas = [];
    let empresaPagadoraAtiva = null;
    let competenciaAtiva = '';
    let acordos = [];
    let repasses = [];
    let contratosMap = new Map();
    let documentosMap = new Map();
    let rbt12PorEmpresaMap = new Map();

    // DOM
    const selectEmpresaPagadora = document.getElementById('selectEmpresaPagadora');
    const inputCompetencia = document.getElementById('inputCompetencia');
    const listaIntermediacaoBody = document.getElementById('listaIntermediacaoBody');
    const listaAcordosBody = document.getElementById('listaAcordosBody');

    // Métricas
    const valBaseIntermediacao = document.getElementById('valBaseIntermediacao');
    const valTaxaMedia = document.getElementById('valTaxaMedia');
    const valTotalApurado = document.getElementById('valTotalApurado');
    const valRepassesLiquidados = document.getElementById('valRepassesLiquidados');

    // Modais
    const modalAcordo = document.getElementById('modalAcordo');
    const modalRepasseManual = document.getElementById('modalRepasseManual');

    window.addEventListener('DOMContentLoaded', async () => {
        const hoje = new Date();
        const ano = hoje.getFullYear();
        const mes = String(hoje.getMonth() + 1).padStart(2, '0');
        competenciaAtiva = `${ano}-${mes}`;
        inputCompetencia.value = competenciaAtiva;

        await carregarEmpresas();

        selectEmpresaPagadora.addEventListener('change', async (e) => {
            empresaPagadoraAtiva = empresas.find(emp => emp.id === e.target.value) || null;
            await carregarDadosIntermediacao();
        });

        inputCompetencia.addEventListener('change', async (e) => {
            competenciaAtiva = e.target.value;
            await carregarDadosIntermediacao();
        });

        document.getElementById('btnNovoAcordo').addEventListener('click', abrirModalAcordo);
        document.getElementById('btnProcessarIntermediacao').addEventListener('click', processarRepasses);
        document.getElementById('formAcordo').addEventListener('submit', salvarAcordo);

        const btnNovoRepasseManual = document.getElementById('btnNovoRepasseManual');
        if (btnNovoRepasseManual) btnNovoRepasseManual.addEventListener('click', abrirModalRepasseManual);
        const formRepasseManual = document.getElementById('formRepasseManual');
        if (formRepasseManual) formRepasseManual.addEventListener('submit', salvarRepasseManual);
    });

    window.fecharModais = function() {
        if (modalAcordo) modalAcordo.style.display = 'none';
        if (modalRepasseManual) modalRepasseManual.style.display = 'none';
    };

    
    function calcularFaturamentoTotalDoc(doc, taxDetails) {
        const bCents = window.BpoMoney.toCents(doc.gross_amount);
        const td = taxDetails || doc.tax_details || (window.BpoFiscalUtils && window.BpoFiscalUtils.extrairTaxDetails(doc));
        const dCents = (td && td.desconto) 
            ? window.BpoMoney.toCents(td.desconto) 
            : (doc.discounts ? window.BpoMoney.toCents(doc.discounts) : 0n);
        const eCents = (td && td.extras) 
            ? window.BpoMoney.toCents(td.extras) 
            : 0n;
        return (bCents + eCents) > dCents ? (bCents + eCents - dCents) : 0n;
    }

    function obterMesesRbt12(competencia) {
        if (!competencia || !competencia.includes('-')) return [];
        const [anoStr, mesStr] = competencia.split('-');
        let a = parseInt(anoStr, 10);
        let m = parseInt(mesStr, 10);

        const meses = [];
        for (let i = 1; i <= 12; i++) {
            m--;
            if (m === 0) {
                m = 12;
                a--;
            }
            meses.unshift(`${a}-${String(m).padStart(2, '0')}`);
        }
        return meses;
    }

    async function calcularRbt12RealEmpresa(companyId, competencia) {
        const meses12 = obterMesesRbt12(competencia);
        if (meses12.length === 0) return 0;

        let totalRbt12Cents = 0n;
        try {
            const inQuery = meses12.join(',');
            const docs12 = await window.BpoSupabase.request(
                `billing_documents?company_id=eq.${companyId}&competence_month=in.(${inQuery})&status=neq.cancelled`,
                { method: 'GET' }
            );

            if (docs12 && docs12.length > 0) {
                docs12.forEach(d => {
                    const td = d.tax_details || (window.BpoFiscalUtils && window.BpoFiscalUtils.extrairTaxDetails(d));
                    totalRbt12Cents += calcularFaturamentoTotalDoc(d, td);
                });
            }
        } catch (e) {
            console.warn(`Aviso ao calcular RBT12 real da empresa ${companyId}:`, e);
        }

        return Number(totalRbt12Cents) / 100;
    }

    function calcularValorLiquidoDoc(doc, empresa, docsCompetenciaEmpresa, rbt12Empresa) {
        if (!doc) return 0n;
        const taxDetails = doc.tax_details || (window.BpoFiscalUtils && window.BpoFiscalUtils.extrairTaxDetails(doc));
        const itemType = (taxDetails && taxDetails.item_type) || 'servico';
        const isLocacao = (doc.document_type === 'locacao') || !!(taxDetails && taxDetails.is_locacao);
        const isLP = empresa && empresa.tax_regime === 'lucro_presumido';
        const fatTotalCents = calcularFaturamentoTotalDoc(doc, taxDetails);
        const fatTotalNum = Number(fatTotalCents) / 100;
        const retCents = window.BpoMoney.toCents(doc.retentions);

        if (isLP) {
            // Lucro Presumido
            const aliqIss = (taxDetails && taxDetails.iss_aliq !== undefined && taxDetails.iss_aliq !== null)
                ? Number(taxDetails.iss_aliq)
                : 3.0;
            const issRetido = !!(taxDetails && taxDetails.iss_retained);

            const pisCents = (taxDetails && taxDetails.pis_valor !== undefined && taxDetails.pis_valor !== null)
                ? window.BpoMoney.toCents(taxDetails.pis_valor)
                : BigInt(Math.round(fatTotalNum * 0.0065 * 100));

            const cofinsCents = (taxDetails && taxDetails.cofins_valor !== undefined && taxDetails.cofins_valor !== null)
                ? window.BpoMoney.toCents(taxDetails.cofins_valor)
                : BigInt(Math.round(fatTotalNum * 0.03 * 100));

            let issCents = 0n;
            if (itemType === 'servico' && !isLocacao) {
                issCents = BigInt(Math.round(fatTotalNum * (aliqIss / 100) * 100));
            }

            // Trimestral / Mensal LP
            let servicosCents = 0n;
            let produtosCents = 0n;
            let irrfRetidoMesCents = 0n;
            (docsCompetenciaEmpresa || []).forEach(d => {
                const td = d.tax_details || (window.BpoFiscalUtils && window.BpoFiscalUtils.extrairTaxDetails(d));
                const v = calcularFaturamentoTotalDoc(d, td);
                const it = (td && td.item_type) || 'servico';
                if (it === 'produto') produtosCents += v;
                else servicosCents += v;

                const vNum = Number(v) / 100;
                if (td && td.has_irrf) {
                    const aliq = (td.irrf_aliq !== undefined && td.irrf_aliq !== null) ? td.irrf_aliq : 4.8;
                    irrfRetidoMesCents += BigInt(Math.round(vNum * (aliq / 100) * 100));
                } else {
                    const r = window.BpoMoney.toCents(d.retentions);
                    const issR = !!(td && td.iss_retained);
                    if (r > 0n && !issR) irrfRetidoMesCents += r;
                }
            });

            const [anoStr, mesStr] = competenciaAtiva.split('-');
            const ano = parseInt(anoStr, 10);
            const mes = parseInt(mesStr, 10);
            const numTrimestre = Math.ceil(mes / 3);

            let aliqIrpjVar = 0.048;
            let aliqCsllVar = 0.0288;
            if (window.BpoTaxEngine && window.BpoTaxEngine.apurarLucroPresumidoTrimestral) {
                const apuracaoLP = window.BpoTaxEngine.apurarLucroPresumidoTrimestral(
                    Number(servicosCents) / 100,
                    Number(produtosCents) / 100,
                    { ano, trimestre: numTrimestre, isMensal: true, irrfRetidoTrimestre: Number(irrfRetidoMesCents) / 100 }
                );
                if (apuracaoLP) {
                    aliqIrpjVar = apuracaoLP.aliqEfetivaIRPJ;
                    aliqCsllVar = apuracaoLP.aliqEfetivaCSLL;
                }
            }

            const irpjBrutoCents = BigInt(Math.round(fatTotalNum * aliqIrpjVar * 100));
            const csllCents = BigInt(Math.round(fatTotalNum * aliqCsllVar * 100));

            let irrfDocCents = 0n;
            if (taxDetails && taxDetails.has_irrf) {
                const aliqIrrf = (taxDetails.irrf_aliq !== undefined && taxDetails.irrf_aliq !== null) ? taxDetails.irrf_aliq : 4.8;
                irrfDocCents = BigInt(Math.round(fatTotalNum * (aliqIrrf / 100) * 100));
            } else if (retCents > 0n && !issRetido) {
                irrfDocCents = retCents;
            } else if (retCents > 0n && issRetido) {
                irrfDocCents = retCents > issCents ? (retCents - issCents) : 0n;
            }

            const irpjLiquidoCents = irpjBrutoCents > irrfDocCents ? (irpjBrutoCents - irrfDocCents) : 0n;
            const tributosCents = pisCents + cofinsCents + issCents + irpjLiquidoCents + csllCents + irrfDocCents;

            return fatTotalCents > tributosCents ? (fatTotalCents - tributosCents) : 0n;

        } else {
            // Simples Nacional
            const anexoKey = (taxDetails && taxDetails.das_anexo) ? taxDetails.das_anexo : 'anexo_iii';
            const issIsento = isLocacao || !!(taxDetails && taxDetails.iss_isento_simples);
            const rbt12Num = rbt12Empresa > 0 ? rbt12Empresa : 180000;

            let aliqDasEfetiva = 0.06;
            if (window.BpoTaxEngine && window.BpoTaxEngine.apurarSimplesNacional) {
                const previaSN = window.BpoTaxEngine.apurarSimplesNacional(rbt12Num, fatTotalNum, anexoKey, { issIsento });
                aliqDasEfetiva = previaSN.aliquotaEfetivaNumero || 0.06;
            }

            const tributosCents = BigInt(Math.round(fatTotalNum * aliqDasEfetiva * 100));
            const deducoes = tributosCents + retCents;
            return fatTotalCents > deducoes ? (fatTotalCents - deducoes) : 0n;
        }
    }

    async function carregarEmpresas() {
        try {
            empresas = await window.BpoSupabase.request('companies?order=name.asc', { method: 'GET' });
            selectEmpresaPagadora.innerHTML = '';

            if (empresas.length === 0) {
                selectEmpresaPagadora.innerHTML = '<option value="">Nenhuma empresa cadastrada</option>';
                return;
            }

            empresas.forEach(emp => {
                const opt = document.createElement('option');
                opt.value = emp.id;
                opt.textContent = emp.name;
                selectEmpresaPagadora.appendChild(opt);
            });

            empresaPagadoraAtiva = empresas[0];
            selectEmpresaPagadora.value = empresaPagadoraAtiva.id;
            await carregarDadosIntermediacao();

        } catch (err) {
            console.error("Erro ao carregar empresas:", err);
        }
    }

    async function carregarDadosIntermediacao() {
        if (!empresaPagadoraAtiva) return;

        try {
            // 1. Acordos cadastrados
            const todosAcordos = await window.BpoSupabase.request(
                'intermediation_agreements',
                { method: 'GET' }
            );

            // Filtra acordos onde a empresa selecionada é a pagadora (faturadora do contrato)
            acordos = (todosAcordos || []).filter(a => a.payer_company_id === empresaPagadoraAtiva.id);

            // 2. Carrega todos os contratos e clientes
            try {
                const contratosDb = await window.BpoSupabase.request('contracts', { method: 'GET' });
                let clientesMap = new Map();
                try {
                    const clientesDb = await window.BpoSupabase.request('people', { method: 'GET' });
                    clientesMap = new Map((clientesDb || []).map(c => [c.id, c]));
                } catch (pe) {}

                contratosMap = new Map((contratosDb || []).map(c => {
                    const cli = c.client_id ? clientesMap.get(c.client_id) : null;
                    return [c.id, {
                        ...c,
                        _clientName: cli ? cli.name : ''
                    }];
                }));
            } catch (e) {
                console.warn('Aviso ao carregar contratos:', e);
            }

            // 3. Carrega documentos de faturamento da competência
            let docsCompetencia = [];
            try {
                docsCompetencia = await window.BpoSupabase.request(
                    `billing_documents?company_id=eq.${empresaPagadoraAtiva.id}&competence_month=eq.${competenciaAtiva}&status=neq.cancelled`,
                    { method: 'GET' }
                );
                documentosMap = new Map((docsCompetencia || []).map(d => [d.id, d]));
            } catch (e) {
                console.warn('Aviso ao carregar billing_documents:', e);
            }

            // 4. RBT12 real se for Simples Nacional
            if (empresaPagadoraAtiva.tax_regime === 'simples_nacional') {
                const rbt = await calcularRbt12RealEmpresa(empresaPagadoraAtiva.id, competenciaAtiva);
                rbt12PorEmpresaMap.set(empresaPagadoraAtiva.id, rbt);
            }

            // 5. Repasses calculados da competência
            const repassesCompetencia = await window.BpoSupabase.request(
                `intermediation_calculations?competence_month=eq.${competenciaAtiva}&order=created_at.desc`,
                { method: 'GET' }
            );

            // Filtra os repasses pertencentes aos acordos da empresa pagadora ativa
            const idsAcordosPagadora = new Set(acordos.map(a => a.id));
            repasses = (repassesCompetencia || []).filter(r => idsAcordosPagadora.has(r.agreement_id));

            renderizarMetricas();
            renderizarExtrato();
            renderizarAcordos();

        } catch (err) {
            console.error("Erro ao carregar dados de intermediação:", err);
        }
    }

    function renderizarMetricas() {
        let baseTotal = 0n;
        let apuradoTotal = 0n;
        let liquidadoTotal = 0n;

        repasses.forEach(r => {
            const doc = r.document_id ? documentosMap.get(r.document_id) : null;
            let bCents = window.BpoMoney.toCents(r.base_amount);
            let aCents = window.BpoMoney.toCents(r.intermediation_amount);

            if (doc) {
                const docsEmp = Array.from(documentosMap.values());
                const rbt12 = rbt12PorEmpresaMap.get(empresaPagadoraAtiva.id) || 0;
                bCents = calcularValorLiquidoDoc(doc, empresaPagadoraAtiva, docsEmp, rbt12);
                const taxaNum = parseFloat(r.rate) || 10.0;
                const calc = window.BpoCommissionEngine.calcularIntermediacao({
                    baseAmount: bCents,
                    ratePercentage: taxaNum
                });
                aCents = calc.intermediacaoCents;
            }

            baseTotal += bCents;
            apuradoTotal += aCents;

            if (r.status === 'paid') {
                liquidadoTotal += aCents;
            }
        });

        // Calcula taxa média ponderada
        let taxaMediaStr = '0.00%';
        if (baseTotal > 0n) {
            const taxaMediaNum = Number(apuradoTotal * 10000n / baseTotal) / 100;
            taxaMediaStr = `${taxaMediaNum.toFixed(2)}%`;
        } else if (acordos.length > 0) {
            taxaMediaStr = `${parseFloat(acordos[0].rate).toFixed(2)}%`;
        }

        valBaseIntermediacao.textContent = window.BpoMoney.formatBRL(baseTotal);
        valTotalApurado.textContent = window.BpoMoney.formatBRL(apuradoTotal);
        valRepassesLiquidados.textContent = window.BpoMoney.formatBRL(liquidadoTotal);
        valTaxaMedia.textContent = taxaMediaStr;
    }

    function renderizarExtrato() {
        if (repasses.length === 0) {
            listaIntermediacaoBody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 32px;">
                        Nenhum repasse intercompany apurado na competência ${escapeHtml(competenciaAtiva)}. Clique em "Processar Repasses" ou "+ Novo Repasse Manual".
                    </td>
                </tr>
            `;
            return;
        }

        listaIntermediacaoBody.innerHTML = repasses.map(r => {
            const statusBadge = r.status === 'paid' 
                ? '<span class="badge badge-success">Repassado</span>' 
                : '<span class="badge badge-warning">A Faturar / Repassar</span>';

            // Localiza o acordo para pegar a empresa recebedora real
            const acordo = acordos.find(a => a.id === r.agreement_id);
            const empresaRecebedora = acordo ? empresas.find(e => e.id === acordo.receiver_company_id) : null;
            const nomeRecebedora = empresaRecebedora ? escapeHtml(empresaRecebedora.name) : 'Empresa Parceira';

            // Obtém documento e contrato associados
            const doc = r.document_id ? documentosMap.get(r.document_id) : null;
            const contratoId = r.contract_id || (doc ? doc.contract_id : null);
            const contrato = contratoId ? contratosMap.get(contratoId) : null;

            // 1. Valor Base: Valor faturado do lançamento (gross_amount / faturamento total da competência)
            let valorBaseContratoCents = 0n;
            if (doc) {
                valorBaseContratoCents = calcularFaturamentoTotalDoc(doc);
            } else if (contrato && contrato.reference_value) {
                valorBaseContratoCents = window.BpoMoney.toCents(contrato.reference_value);
            } else {
                valorBaseContratoCents = window.BpoMoney.toCents(r.base_amount);
            }

            // 2. Valor Líquido com a mesma lógica do módulo de impostos
            let valorLiquidoCents = 0n;
            if (doc) {
                const docsEmp = Array.from(documentosMap.values());
                const rbt12 = rbt12PorEmpresaMap.get(empresaPagadoraAtiva.id) || 0;
                valorLiquidoCents = calcularValorLiquidoDoc(doc, empresaPagadoraAtiva, docsEmp, rbt12);
            } else {
                // Para lançamentos manuais ou sem doc vinculado, exibe o base_amount cadastrado
                valorLiquidoCents = window.BpoMoney.toCents(r.base_amount);
            }

            // O valor a repassar é calculado como a taxa (ex: 10%) sobre o valor líquido
            let valorRepassarCents = window.BpoMoney.toCents(r.intermediation_amount);
            if (doc && valorLiquidoCents > 0n) {
                const taxaNum = parseFloat(r.rate) || 10.0;
                const repasseCalc = window.BpoCommissionEngine.calcularIntermediacao({
                    baseAmount: valorLiquidoCents,
                    ratePercentage: taxaNum
                });
                valorRepassarCents = repasseCalc.intermediacaoCents;
            }

            // Identificação do Contrato / Cliente igual ao Módulo de Faturamento
            let nomeContrato = '<span style="color: var(--text-muted); font-size: 0.85rem;">Avulso</span>';
            if (contrato) {
                const desc = contrato._clientName || contrato.name || contrato.code;
                nomeContrato = escapeHtml(desc);
            } else if (doc && doc.description) {
                nomeContrato = escapeHtml(window.BpoFiscalUtils ? window.BpoFiscalUtils.limparDescricao(doc.description) : doc.description);
            }

            return `
                <tr>
                    <td style="font-weight: 600; color: #fff;">${escapeHtml(r.competence_month)}</td>
                    <td style="font-weight: 600; color: #93c5fd;">${escapeHtml(empresaPagadoraAtiva.name)}</td>
                    <td style="font-weight: 600; color: #fff;">${nomeContrato}</td>
                    <td style="font-weight: 600; color: #fff;">${window.BpoMoney.formatBRL(valorBaseContratoCents)}</td>
                    <td style="font-weight: 700; color: var(--color-success);">${window.BpoMoney.formatBRL(valorLiquidoCents)}</td>
                    <td style="color: var(--color-warning); font-weight: 600;">${escapeHtml(r.rate)}%</td>
                    <td style="font-weight: 700; color: #fff;">${window.BpoMoney.formatBRL(valorRepassarCents)}</td>
                    <td>${statusBadge}</td>
                    <td>
                        ${r.status !== 'paid' ? `
                            <button class="btn btn-secondary btn-sm btn-quitar" data-id="${r.id}" title="Marcar como Liquidado">
                                Quitar Repasse
                            </button>
                        ` : '<span style="color: var(--color-success); font-size: 0.85rem;">Concluído</span>'}
                    </td>
                </tr>
            `;
        }).join('');

        document.querySelectorAll('.btn-quitar').forEach(btn => {
            btn.addEventListener('click', () => window.quitarRepasse(btn.dataset.id));
        });
    }

    function renderizarAcordos() {
        if (acordos.length === 0) {
            listaAcordosBody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">
                        Nenhum acordo cadastrado para esta empresa como pagadora.
                    </td>
                </tr>
            `;
            return;
        }

        listaAcordosBody.innerHTML = acordos.map(a => {
            const rec = empresas.find(e => e.id === a.receiver_company_id) || { name: 'Empresa Parceira' };
            let gatilhoLabel = 'Emissão de NFS-e';
            if (a.event_trigger === 'receipt') gatilhoLabel = 'Liquidação no Caixa';
            else if (a.event_trigger === 'manual') gatilhoLabel = 'Lançamento Manual';

            return `
                <tr>
                    <td style="font-weight: 600; color: #fff;">${escapeHtml(empresaPagadoraAtiva.name)}</td>
                    <td>${escapeHtml(rec.name)}</td>
                    <td style="color: var(--color-warning); font-weight: 700;">${escapeHtml(a.rate)}%</td>
                    <td>${gatilhoLabel}</td>
                    <td>Desde ${escapeHtml(a.valid_from)}</td>
                    <td><span class="badge badge-success">Vigente</span></td>
                    <td style="text-align: right;">
                        <button class="btn btn-secondary btn-sm btn-excluir-acordo" data-id="${a.id}" style="color: #ef4444; border-color: rgba(239, 68, 68, 0.3);" title="Excluir Acordo">
                            Excluir
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        document.querySelectorAll('.btn-excluir-acordo').forEach(btn => {
            btn.addEventListener('click', () => window.excluirAcordo(btn.dataset.id));
        });
    }

    function abrirModalAcordo() {
        const selPag = document.getElementById('acordoPagadora');
        const selRec = document.getElementById('acordoRecebedora');

        selPag.innerHTML = empresas.map(e => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join('');
        selRec.innerHTML = empresas.map(e => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join('');

        if (empresaPagadoraAtiva) {
            selPag.value = empresaPagadoraAtiva.id;
            const outra = empresas.find(e => e.id !== empresaPagadoraAtiva.id);
            if (outra) selRec.value = outra.id;
        }

        modalAcordo.style.display = 'flex';
    }

    async function salvarAcordo(e) {
        e.preventDefault();
        const pag = document.getElementById('acordoPagadora').value;
        const rec = document.getElementById('acordoRecebedora').value;
        const taxa = parseFloat(document.getElementById('acordoTaxa').value);
        const gatilho = document.getElementById('acordoGatilho').value;

        if (pag === rec) {
            alert('A empresa pagadora e recebedora não podem ser a mesma.');
            return;
        }

        try {
            await window.BpoSupabase.request('intermediation_agreements', {
                method: 'POST',
                body: JSON.stringify({
                    payer_company_id: pag,
                    receiver_company_id: rec,
                    rate: taxa,
                    event_trigger: gatilho,
                    valid_from: new Date().toISOString().split('T')[0]
                })
            });

            fecharModais();
            // Sincroniza o seletor da empresa ativa para a empresa pagadora do acordo salvo
            empresaPagadoraAtiva = empresas.find(e => e.id === pag) || empresaPagadoraAtiva;
            selectEmpresaPagadora.value = empresaPagadoraAtiva.id;

            await carregarDadosIntermediacao();
            alert('Acordo de intermediação cadastrado com sucesso!');

        } catch (err) {
            console.error('Erro ao salvar acordo:', err);
            alert('Erro ao salvar acordo: ' + err.message);
        }
    }

    function abrirModalRepasseManual() {
        const selPag = document.getElementById('repasseManualPagadora');
        const selRec = document.getElementById('repasseManualRecebedora');
        const inputComp = document.getElementById('repasseManualCompetencia');
        const inputValor = document.getElementById('repasseManualValor');

        selPag.innerHTML = empresas.map(e => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join('');
        selRec.innerHTML = empresas.map(e => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join('');

        if (empresaPagadoraAtiva) {
            selPag.value = empresaPagadoraAtiva.id;
            const outra = empresas.find(e => e.id !== empresaPagadoraAtiva.id);
            if (outra) selRec.value = outra.id;
        }

        inputComp.value = competenciaAtiva;
        inputValor.value = '';
        modalRepasseManual.style.display = 'flex';
    }

    async function salvarRepasseManual(e) {
        e.preventDefault();
        const pag = document.getElementById('repasseManualPagadora').value;
        const rec = document.getElementById('repasseManualRecebedora').value;
        const valorRaw = document.getElementById('repasseManualValor').value;
        const comp = document.getElementById('repasseManualCompetencia').value;

        if (pag === rec) {
            alert('A empresa pagadora e a recebedora não podem ser a mesma.');
            return;
        }

        const valorCents = window.BpoMoney.toCents(valorRaw);
        if (valorCents <= 0n) {
            alert('Informe um valor de repasse válido maior que zero.');
            return;
        }

        try {
            // Busca se já existe acordo prévio entre as empresas
            const todosAcordos = await window.BpoSupabase.request(
                `intermediation_agreements?payer_company_id=eq.${pag}&receiver_company_id=eq.${rec}`,
                { method: 'GET' }
            );

            let acordo = (todosAcordos && todosAcordos.length > 0) ? todosAcordos[0] : null;

            // Se não houver, cadastra automaticamente o acordo intercompany para manter a integridade referencial
            if (!acordo) {
                const novoAcordo = await window.BpoSupabase.request('intermediation_agreements', {
                    method: 'POST',
                    prefer: 'return=representation',
                    body: JSON.stringify({
                        payer_company_id: pag,
                        receiver_company_id: rec,
                        rate: 100.0,
                        event_trigger: 'manual',
                        valid_from: new Date().toISOString().split('T')[0]
                    })
                });
                acordo = Array.isArray(novoAcordo) ? novoAcordo[0] : novoAcordo;
            }

            const idempotencyKey = `manual_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
            const valorDecimal = window.BpoMoney.toDecimalString(valorCents);
            const taxaAcordo = acordo.rate ? parseFloat(acordo.rate) : 10.0;
            // Para lançamento manual direto de valor, se a taxa for menor que 100%, calcula a fração ou mantém o valor direto
            const valorRepasseCents = (acordo.event_trigger === 'manual' && taxaAcordo === 100.0)
                ? valorCents
                : window.BpoCommissionEngine.calcularIntermediacao({ baseAmount: valorCents, ratePercentage: taxaAcordo }).intermediacaoCents;

            // Grava o cálculo sem o campo company_id
            await window.BpoSupabase.request('intermediation_calculations', {
                method: 'POST',
                body: JSON.stringify({
                    agreement_id: acordo.id,
                    contract_id: null,
                    document_id: null,
                    competence_month: comp,
                    base_amount: valorDecimal,
                    rate: taxaAcordo,
                    intermediation_amount: window.BpoMoney.toDecimalString(valorRepasseCents),
                    status: 'pending',
                    idempotency_key: idempotencyKey
                })
            });

            fecharModais();
            empresaPagadoraAtiva = empresas.find(e => e.id === pag) || empresaPagadoraAtiva;
            selectEmpresaPagadora.value = empresaPagadoraAtiva.id;
            competenciaAtiva = comp;
            inputCompetencia.value = comp;

            await carregarDadosIntermediacao();
            alert('Repasse manual registrado com sucesso!');

        } catch (err) {
            console.error('Erro ao salvar repasse manual:', err);
            alert('Erro ao registrar repasse manual: ' + err.message);
        }
    }

    async function processarRepasses() {
        if (!empresaPagadoraAtiva) {
            alert('Selecione uma empresa pagadora primeiro.');
            return;
        }

        if (acordos.length === 0) {
            alert('Não há nenhum acordo cadastrado para esta empresa como pagadora.');
            return;
        }

        try {
            // Busca os documentos de faturamento da empresa faturadora emitidos na competência
            const docs = await window.BpoSupabase.request(
                `billing_documents?company_id=eq.${empresaPagadoraAtiva.id}&competence_month=eq.${competenciaAtiva}`,
                { method: 'GET' }
            );

            if (!docs || docs.length === 0) {
                alert(`Nenhum documento de faturamento encontrado para a competência ${competenciaAtiva}.`);
                return;
            }

            const acordo = acordos[0]; // Acordo vigente
            const taxa = parseFloat(acordo.rate);
            const lotesCalculos = [];

            // RBT12 real da empresa pagadora se for Simples Nacional
            const rbt12Pagadora = rbt12PorEmpresaMap.get(empresaPagadoraAtiva.id) || 0;

            for (const d of docs) {
                if (d.status === 'cancelled') continue;

                // Respeita event_trigger: se for 'receipt', só processa documentos pagos ou parcialmente pagos
                if (acordo.event_trigger === 'receipt' && d.status !== 'paid' && d.status !== 'partially_paid') {
                    continue;
                }

                // O valor líquido do faturamento (deduzidos os impostos fiscais do módulo de tributos)
                const valorLiquidoCents = calcularValorLiquidoDoc(d, empresaPagadoraAtiva, docs, rbt12Pagadora);

                // O valor a repassar é a taxa acordada (ex: 10%) sobre o valor líquido
                const res = window.BpoCommissionEngine.calcularIntermediacao({
                    baseAmount: valorLiquidoCents,
                    ratePercentage: taxa
                });

                const idempotencyKey = `inter_${d.id}_${acordo.id}`;

                lotesCalculos.push({
                    agreement_id: acordo.id,
                    contract_id: d.contract_id || null,
                    document_id: d.id,
                    competence_month: competenciaAtiva,
                    base_amount: window.BpoMoney.toDecimalString(valorLiquidoCents),
                    rate: taxa,
                    intermediation_amount: window.BpoMoney.toDecimalString(res.intermediacaoCents),
                    status: 'pending',
                    idempotency_key: idempotencyKey
                });
            }

            if (lotesCalculos.length === 0) {
                alert('Nenhum documento elegível para os critérios do acordo de intermediação.');
                return;
            }

            // Upsert em lote atualizando base_amount e intermediation_amount
            await window.BpoSupabase.request('intermediation_calculations?on_conflict=idempotency_key', {
                method: 'POST',
                prefer: 'resolution=merge-duplicates,return=representation',
                body: JSON.stringify(lotesCalculos)
            });

            await carregarDadosIntermediacao();
            alert(`Processamento concluído! Lote de repasses avaliado e registrado.`);

        } catch (err) {
            alert('Erro ao processar repasses: ' + err.message);
        }
    }

    
    window.excluirAcordo = async function(id) {
        if (!confirm('Deseja realmente excluir este acordo de intermediação? Repasses já calculados com base nele também poderão ser afetados.')) {
            return;
        }

        try {
            // Remove primeiramente cálculos associados se houver (respeitando chave estrangeira)
            await window.BpoSupabase.request(`intermediation_calculations?agreement_id=eq.${id}`, {
                method: 'DELETE'
            });

            // Exclui o acordo
            await window.BpoSupabase.request(`intermediation_agreements?id=eq.${id}`, {
                method: 'DELETE'
            });

            await carregarDadosIntermediacao();
            alert('Acordo de intermediação excluído com sucesso!');
        } catch (err) {
            console.error('Erro ao excluir acordo:', err);
            alert('Erro ao excluir acordo: ' + err.message);
        }
    };

    window.quitarRepasse = async function(id) {
        if (!confirm('Deseja confirmar a quitação deste repasse intercompany?')) return;
        try {
            await window.BpoSupabase.request(`intermediation_calculations?id=eq.${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'paid' })
            });
            await carregarDadosIntermediacao();
            alert('Repasse quitado com sucesso!');
        } catch (err) {
            alert('Erro ao quitar repasse: ' + err.message);
        }
    };
})();
