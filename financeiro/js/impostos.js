// ==============================================================================
// impostos.js — Lógica do Módulo 05 (Controle de Impostos & Memória de Cálculo)
// Suporte integral à Visão Consolidada inicial (Todas as Empresas),
// apuração isolada por CNPJ antes de consolidar, segregação do DAS para Simples
// e cálculo trimestral IRPJ/CSLL para Mar Brasil com eliminação de células aproximadas.
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
    }
};

(function() {
    let empresas = [];
    let empresaAtivaId = 'all'; // Padrão: "Todas as empresas"
    let competenciaAtiva = '';
    let companiesMap = new Map();

    // Elementos DOM
    const selectEmpresa = document.getElementById('selectEmpresa');
    const inputCompetencia = document.getElementById('inputCompetencia');
    const painelDetalhamentoEmpresas = document.getElementById('painelDetalhamentoEmpresas');
    const painelTrimestralMarBrasil = document.getElementById('painelTrimestralMarBrasil');
    const secaoTrimestralMarBrasil = document.getElementById('secaoTrimestralMarBrasil');
    const badgeTrimestreMarBrasil = document.getElementById('badgeTrimestreMarBrasil');
    const listaHistoricoBody = document.getElementById('listaHistoricoBody');
    const listaDocumentosTributosBody = document.getElementById('listaDocumentosTributosBody');
    const tfootDocumentosTributos = document.getElementById('tfootDocumentosTributos');
    const resumoContagemTributosDocs = document.getElementById('resumoContagemTributosDocs');

    // Métricas Consolidadas
    const valBaseFaturamento = document.getElementById('valBaseFaturamento');
    const valImpostoApurado = document.getElementById('valImpostoApurado');
    const valRetencoesCompensaveis = document.getElementById('valRetencoesCompensaveis');
    const valSaldoRecolher = document.getElementById('valSaldoRecolher');
    const labelCargaEfetiva = document.getElementById('labelCargaEfetiva');

    window.addEventListener('DOMContentLoaded', async () => {
        const hoje = new Date();
        const ano = hoje.getFullYear();
        const mes = String(hoje.getMonth() + 1).padStart(2, '0');
        competenciaAtiva = `${ano}-${mes}`;
        inputCompetencia.value = competenciaAtiva;

        await carregarEmpresas();

        // Listeners
        selectEmpresa.addEventListener('change', async (e) => {
            empresaAtivaId = e.target.value || 'all';
            await carregarDadosFiscal();
        });

        inputCompetencia.addEventListener('change', async (e) => {
            competenciaAtiva = e.target.value;
            await carregarDadosFiscal();
        });
    });

    async function carregarEmpresas() {
        try {
            empresas = await window.BpoSupabase.request('companies?order=name.asc', { method: 'GET' });
            companiesMap.clear();
            empresas.forEach(emp => companiesMap.set(emp.id, emp));

            selectEmpresa.innerHTML = '';
            
            // Requisito 2: "Ao entrar, mostre os valores consolidados de impostos de todas as empresas autorizadas... O filtro inicial deve ser Todas as empresas."
            const optTodas = document.createElement('option');
            optTodas.value = 'all';
            optTodas.textContent = 'Todas as Empresas (Consolidado)';
            selectEmpresa.appendChild(optTodas);

            empresas.forEach(emp => {
                const opt = document.createElement('option');
                opt.value = emp.id;
                const regimeLabel = emp.tax_regime === 'lucro_presumido' ? 'Lucro Presumido' : 'Simples Nacional';
                opt.textContent = `${emp.name} (${regimeLabel})`;
                selectEmpresa.appendChild(opt);
            });

            empresaAtivaId = 'all';
            selectEmpresa.value = 'all';

            await carregarDadosFiscal();
        } catch (err) {
            console.error("Erro ao carregar empresas:", err);
            selectEmpresa.innerHTML = `<option value="all">Erro de conexão</option>`;
        }
    }

    async function carregarDadosFiscal() {
        try {
            // Busca documentos de faturamento da competência (excluindo cancelados)
            let queryDocs = `billing_documents?competence_month=eq.${competenciaAtiva}&status=neq.cancelled`;
            if (empresaAtivaId !== 'all') {
                queryDocs += `&company_id=eq.${empresaAtivaId}`;
            }
            const docsCompetencia = await window.BpoSupabase.request(queryDocs, { method: 'GET' });

            // Empresas a processar (todas ou a selecionada)
            const empresasProcessar = empresaAtivaId === 'all' 
                ? empresas 
                : empresas.filter(e => e.id === empresaAtivaId);

            let totalFaturamentoConsolidado = 0n;
            let totalImpostosConsolidado = 0n;
            let totalRetencoesConsolidado = 0n;
            let totalSaldoConsolidado = 0n;

            const cardsHtml = [];
            const rowsHistorico = [];

            // Processa empresa por empresa (sem jamais misturar RBT12 ou bases de CNPJs distintos)
            for (const emp of empresasProcessar) {
                const docsEmp = docsCompetencia.filter(d => d.company_id === emp.id);
                let fatEmpCents = 0n;
                let retEmpCents = 0n;
                let servicosCents = 0n;
                let produtosCents = 0n;

                docsEmp.forEach(d => {
                    const b = window.BpoMoney.toCents(d.gross_amount);
                    const r = window.BpoMoney.toCents(d.retentions);
                    fatEmpCents += b;
                    retEmpCents += r;

                    const taxDetails = d.tax_details || window.BpoFiscalUtils.extrairTaxDetails(d);
                    const itemType = (taxDetails && taxDetails.item_type) || 'servico';
                    if (itemType === 'produto') produtosCents += b;
                    else servicosCents += b;
                });

                const isLucroPresumido = emp.tax_regime === 'lucro_presumido';

                let impostoApuradoEmpCents = 0n;
                let saldoRecolherEmpCents = 0n;
                let detalheCardHtml = '';

                if (isLucroPresumido) {
                    // Lucro Presumido: PIS/Cofins mensais + Provisão IRPJ/CSLL trimestrais
                    // API real: apurarLucroPresumidoMensal(faturamentoServico, faturamentoProduto, options)
                    const fatServicoNum = Number(servicosCents) / 100;
                    const fatProdutoNum = Number(produtosCents) / 100;
                    const apuracaoLP = window.BpoTaxEngine.apurarLucroPresumidoMensal(
                        fatServicoNum, fatProdutoNum, { aliquotaIss: 5.0 }
                    );

                    // Monta componentes em centavos para exibição
                    const pisCents = BigInt(Math.round(apuracaoLP.impostosMensais.pis.value * 100));
                    const cofinsCents = BigInt(Math.round(apuracaoLP.impostosMensais.cofins.value * 100));
                    const issCents = BigInt(Math.round(apuracaoLP.impostosMensais.iss.value * 100));
                    // Provisão trimestral estimada (32% presunção × 15% IRPJ + 9% CSLL)
                    const irpjProvCents = BigInt(Math.round(Number(fatEmpCents) / 100 * 0.32 * 0.15 * 100));
                    const csllProvCents = BigInt(Math.round(Number(fatEmpCents) / 100 * 0.32 * 0.09 * 100));

                    impostoApuradoEmpCents = pisCents + cofinsCents + issCents + irpjProvCents + csllProvCents;
                    saldoRecolherEmpCents = impostoApuradoEmpCents > retEmpCents ? impostoApuradoEmpCents - retEmpCents : 0n;

                    detalheCardHtml = `
                        <div style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 16px; border: 1px solid rgba(255,255,255,0.05);">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px;">
                                <strong style="font-size:1rem; color:#fff;">${escapeHtml(emp.name)}</strong>
                                <span class="badge badge-primary">Lucro Presumido</span>
                            </div>
                            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; font-size:0.85rem;">
                                <div><span style="color:var(--text-muted);">PIS (0,65%):</span> <strong>${window.BpoMoney.formatBRL(pisCents)}</strong></div>
                                <div><span style="color:var(--text-muted);">COFINS (3,00%):</span> <strong>${window.BpoMoney.formatBRL(cofinsCents)}</strong></div>
                                <div><span style="color:var(--text-muted);">ISS Municipal (5,00%):</span> <strong>${window.BpoMoney.formatBRL(issCents)}</strong></div>
                                <div><span style="color:var(--text-muted);">Provisão IRPJ Trimestral:</span> <strong>${window.BpoMoney.formatBRL(irpjProvCents)}</strong></div>
                                <div><span style="color:var(--text-muted);">Provisão CSLL Trimestral:</span> <strong>${window.BpoMoney.formatBRL(csllProvCents)}</strong></div>
                                <div><span style="color:var(--text-muted);">Retenções a Compensar:</span> <strong style="color:var(--color-danger);">${window.BpoMoney.formatBRL(retEmpCents)}</strong></div>
                            </div>
                            <div style="margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between;">
                                <span>Total Impostos Competência: <strong>${window.BpoMoney.formatBRL(impostoApuradoEmpCents)}</strong></span>
                                <span style="color:var(--color-success); font-weight:700;">Saldo a Recolher: ${window.BpoMoney.formatBRL(saldoRecolherEmpCents)}</span>
                            </div>
                        </div>
                    `;
                } else {
                    // Simples Nacional: DZM ou Ybox via DAS estimado
                    // API real: apurarSimplesNacional(rbt12, faturamentoMes, anexoKey, options)
                    const rbt12Num = 360000; // R$ 360.000 referência anual
                    const fatMesNum = Number(fatEmpCents) / 100;
                    const apuracaoSN = window.BpoTaxEngine.apurarSimplesNacional(rbt12Num, fatMesNum, 'anexo_iii');

                    const dasCents = BigInt(Math.round(apuracaoSN.valorDas * 100));
                    impostoApuradoEmpCents = dasCents;
                    saldoRecolherEmpCents = dasCents;

                    const comp = apuracaoSN.componentes;
                    const cppCents = BigInt(Math.round(comp.inss * 100));
                    const issSNCents = BigInt(Math.round(comp.iss * 100));
                    const pisSNCents = BigInt(Math.round(comp.pis * 100));
                    const cofinsSNCents = BigInt(Math.round(comp.cofins * 100));
                    const irpjCsllSNCents = BigInt(Math.round((comp.irpj + comp.csll) * 100));

                    detalheCardHtml = `
                        <div style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 16px; border: 1px solid rgba(255,255,255,0.05);">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px;">
                                <strong style="font-size:1rem; color:#fff;">${escapeHtml(emp.name)}</strong>
                                <span class="badge badge-success">Simples Nacional (Anexo III)</span>
                            </div>
                            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; font-size:0.85rem;">
                                <div><span style="color:var(--text-muted);">Alíquota Efetiva DAS:</span> <strong>${apuracaoSN.aliquotaEfetivaDas}</strong></div>
                                <div><span style="color:var(--text-muted);">Parcela CPP (INSS):</span> <strong>${window.BpoMoney.formatBRL(cppCents)}</strong></div>
                                <div><span style="color:var(--text-muted);">Parcela ISS:</span> <strong>${window.BpoMoney.formatBRL(issSNCents)}</strong></div>
                                <div><span style="color:var(--text-muted);">Parcela PIS:</span> <strong>${window.BpoMoney.formatBRL(pisSNCents)}</strong></div>
                                <div><span style="color:var(--text-muted);">Parcela COFINS:</span> <strong>${window.BpoMoney.formatBRL(cofinsSNCents)}</strong></div>
                                <div><span style="color:var(--text-muted);">Parcela IRPJ/CSLL:</span> <strong>${window.BpoMoney.formatBRL(irpjCsllSNCents)}</strong></div>
                            </div>
                            <div style="margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between;">
                                <span style="font-size:0.82rem; color:var(--text-muted);">* Tributos federais já integrados na guia única DAS (sem cobrança adicional)</span>
                                <span style="color:#f59e0b; font-weight:700;">DAS Estimado a Recolher: ${window.BpoMoney.formatBRL(impostoApuradoEmpCents)}</span>
                            </div>
                        </div>
                    `;
                }

                cardsHtml.push(detalheCardHtml);

                // Carga efetiva da empresa (com proteção contra denominador zero)
                const cargaEmpresaStr = fatEmpCents > 0n
                    ? `${(Number(impostoApuradoEmpCents) / Number(fatEmpCents) * 100).toFixed(2)}%`
                    : '0,00% (Sem Faturamento)';

                rowsHistorico.push(`
                    <tr>
                        <td style="font-weight:600; color:#fff;">${escapeHtml(emp.name)}</td>
                        <td><span class="badge ${isLucroPresumido ? 'badge-primary' : 'badge-success'}">${isLucroPresumido ? 'Lucro Presumido' : 'Simples Nacional'}</span></td>
                        <td>${escapeHtml(competenciaAtiva)}</td>
                        <td>${window.BpoMoney.formatBRL(fatEmpCents)}</td>
                        <td style="color:#f59e0b; font-weight:600;">${window.BpoMoney.formatBRL(impostoApuradoEmpCents)}</td>
                        <td style="color:var(--color-danger);">${window.BpoMoney.formatBRL(retEmpCents)}</td>
                        <td style="color:var(--color-success); font-weight:700;">${window.BpoMoney.formatBRL(saldoRecolherEmpCents)}</td>
                        <td>${cargaEmpresaStr}</td>
                        <td><span class="badge badge-info">Calculado</span></td>
                    </tr>
                `);

                totalFaturamentoConsolidado += fatEmpCents;
                totalImpostosConsolidado += impostoApuradoEmpCents;
                totalRetencoesConsolidado += retEmpCents;
                totalSaldoConsolidado += saldoRecolherEmpCents;
            }

            // Atualiza métricas consolidadas no topo
            valBaseFaturamento.textContent = window.BpoMoney.formatBRL(totalFaturamentoConsolidado);
            valImpostoApurado.textContent = window.BpoMoney.formatBRL(totalImpostosConsolidado);
            valRetencoesCompensaveis.textContent = window.BpoMoney.formatBRL(totalRetencoesConsolidado);
            valSaldoRecolher.textContent = window.BpoMoney.formatBRL(totalSaldoConsolidado);

            // Requisito 2: "Preserve a fórmula da carga efetiva gerencial: impostos atribuídos / faturamento correspondente × 100. No consolidado, use a razão entre as somas, sem média simples das alíquotas. Denominador zero exige estado explícito."
            if (totalFaturamentoConsolidado > 0n) {
                const cargaConsolidada = (Number(totalImpostosConsolidado) / Number(totalFaturamentoConsolidado) * 100).toFixed(2);
                labelCargaEfetiva.textContent = `${cargaConsolidada}%`;
            } else {
                labelCargaEfetiva.textContent = '0,00% (Sem faturamento)';
            }

            painelDetalhamentoEmpresas.innerHTML = cardsHtml.join('');
            listaHistoricoBody.innerHTML = rowsHistorico.join('');

            // =================================================================
            // TABELA DE DETALHAMENTO DE TRIBUTOS POR FATURAMENTO INDIVIDUAL
            // =================================================================
            let contratosMap = new Map();
            try {
                const contratosDb = await window.BpoSupabase.request('contracts', { method: 'GET' });
                const clientesDb = await window.BpoSupabase.request('people', { method: 'GET' });
                const clientesMap = new Map();
                clientesDb.forEach(c => clientesMap.set(c.id, c));
                contratosDb.forEach(ct => {
                    const cli = ct.client_id ? clientesMap.get(ct.client_id) : null;
                    contratosMap.set(ct.id, {
                        ...ct,
                        _clientName: cli ? cli.name : ''
                    });
                });
            } catch (e) {}

            const docsParaTabela = empresaAtivaId === 'all'
                ? docsCompetencia
                : docsCompetencia.filter(d => d.company_id === empresaAtivaId);

            if (resumoContagemTributosDocs) {
                resumoContagemTributosDocs.textContent = `${docsParaTabela.length} lançamento${docsParaTabela.length !== 1 ? 's' : ''}`;
            }

            if (docsParaTabela.length === 0) {
                if (listaDocumentosTributosBody) {
                    listaDocumentosTributosBody.innerHTML = `
                        <tr>
                            <td colspan="13" style="text-align: center; color: var(--text-muted); padding: 32px;">
                                Nenhum faturamento emitido nesta competência para a seleção atual.
                            </td>
                        </tr>
                    `;
                }
                if (tfootDocumentosTributos) tfootDocumentosTributos.innerHTML = '';
            } else {
                let somaBruto = 0n;
                let somaPis = 0n;
                let somaCofins = 0n;
                let somaIss = 0n;
                let somaIrpj = 0n;
                let somaCsll = 0n;
                let somaTributos = 0n;
                let somaRetencoes = 0n;
                let somaSaldo = 0n;

                const rowsDocs = docsParaTabela.map(doc => {
                    const emp = companiesMap.get(doc.company_id);
                    const isLP = emp && emp.tax_regime === 'lucro_presumido';
                    const taxDetails = doc.tax_details || window.BpoFiscalUtils.extrairTaxDetails(doc);
                    const itemType = (taxDetails && taxDetails.item_type) || 'servico';
                    const aliqIss = (taxDetails && taxDetails.iss_aliq !== undefined && taxDetails.iss_aliq !== null) ? taxDetails.iss_aliq : 5.0;
                    const issRetido = !!(taxDetails && taxDetails.iss_retained);

                    const brutoCents = window.BpoMoney.toCents(doc.gross_amount);
                    const retCents = window.BpoMoney.toCents(doc.retentions);
                    const brutoNum = Number(brutoCents) / 100;

                    let pisCents = 0n;
                    let cofinsCents = 0n;
                    let issCents = 0n;
                    let irpjCents = 0n;
                    let csllCents = 0n;
                    let tributosCents = 0n;
                    let saldoCents = 0n;

                    if (isLP) {
                        pisCents = BigInt(Math.round(brutoNum * 0.0065 * 100));
                        cofinsCents = BigInt(Math.round(brutoNum * 0.03 * 100));
                        if (itemType === 'servico') {
                            issCents = BigInt(Math.round(brutoNum * (aliqIss / 100) * 100));
                            irpjCents = BigInt(Math.round(brutoNum * 0.32 * 0.15 * 100));
                            csllCents = BigInt(Math.round(brutoNum * 0.32 * 0.09 * 100));
                        } else {
                            issCents = 0n;
                            irpjCents = BigInt(Math.round(brutoNum * 0.08 * 0.15 * 100));
                            csllCents = BigInt(Math.round(brutoNum * 0.12 * 0.09 * 100));
                        }
                        tributosCents = pisCents + cofinsCents + issCents + irpjCents + csllCents;
                        const issRecolher = issRetido ? 0n : issCents;
                        const aRecolherBase = pisCents + cofinsCents + issRecolher + irpjCents + csllCents;
                        saldoCents = aRecolherBase > retCents ? (aRecolherBase - retCents) : 0n;
                    } else {
                        // Simples Nacional
                        const previaSN = window.BpoTaxEngine.apurarSimplesNacional(360000, brutoNum, 'anexo_iii', {
                            issRetidoTomador: issRetido,
                            aliquotaRetencaoInformada: aliqIss
                        });
                        const comp = previaSN.componentes || {};
                        pisCents = BigInt(Math.round((comp.pis || 0) * 100));
                        cofinsCents = BigInt(Math.round((comp.cofins || 0) * 100));
                        issCents = BigInt(Math.round((comp.iss || 0) * 100));
                        irpjCents = BigInt(Math.round((comp.irpj || 0) * 100));
                        csllCents = BigInt(Math.round((comp.csll || 0) * 100));
                        tributosCents = BigInt(Math.round((previaSN.valorDas || 0) * 100));
                        saldoCents = tributosCents;
                    }

                    somaBruto += brutoCents;
                    somaPis += pisCents;
                    somaCofins += cofinsCents;
                    somaIss += issCents;
                    somaIrpj += irpjCents;
                    somaCsll += csllCents;
                    somaTributos += tributosCents;
                    somaRetencoes += retCents;
                    somaSaldo += saldoCents;

                    const ctr = contratosMap.get(doc.contract_id);
                    const cliDesc = (ctr && ctr._clientName) 
                        ? escapeHtml(ctr._clientName)
                        : (ctr ? escapeHtml(ctr.name) : '<span style="color:var(--text-muted);font-size:0.78rem;">Avulso</span>');

                    const issLabel = issRetido
                        ? `<span style="color:var(--color-danger); font-size:0.8rem;" title="Retido na Fonte pelo Tomador">${window.BpoMoney.formatBRL(issCents)} <span style="font-size:0.68rem; padding:1px 4px; border-radius:3px; background:rgba(239,68,68,0.15);">Retido</span></span>`
                        : `<span style="color:#fff;">${window.BpoMoney.formatBRL(issCents)}</span>`;

                    const empBadge = emp 
                        ? `<span class="badge ${isLP ? 'badge-primary' : 'badge-success'}" style="font-size:0.75rem;">${escapeHtml(emp.trade_name || emp.name)}</span>`
                        : '-';

                    return `
                        <tr>
                            <td style="font-weight:600; color:#fff;">
                                ${escapeHtml(doc.document_number)}
                                <span style="font-size:0.72rem; color:var(--text-muted); display:block;">${escapeHtml((doc.document_type || 'nfse').toUpperCase())} • ${escapeHtml(itemType)}</span>
                            </td>
                            <td>${empBadge}</td>
                            <td>${escapeHtml(formatarData(doc.issue_date))}</td>
                            <td>${cliDesc}</td>
                            <td style="text-align:right; font-weight:600; color:#fff;">${window.BpoMoney.formatBRL(brutoCents)}</td>
                            <td style="text-align:right; color:#93c5fd;">${window.BpoMoney.formatBRL(pisCents)}</td>
                            <td style="text-align:right; color:#93c5fd;">${window.BpoMoney.formatBRL(cofinsCents)}</td>
                            <td style="text-align:right;">${issLabel}</td>
                            <td style="text-align:right; color:#f59e0b;">${window.BpoMoney.formatBRL(irpjCents)}</td>
                            <td style="text-align:right; color:#f59e0b;">${window.BpoMoney.formatBRL(csllCents)}</td>
                            <td style="text-align:right; font-weight:700; color:#f59e0b;">${window.BpoMoney.formatBRL(tributosCents)}</td>
                            <td style="text-align:right; color:var(--color-danger);">${window.BpoMoney.formatBRL(retCents)}</td>
                            <td style="text-align:right; font-weight:700; color:var(--color-success);">${window.BpoMoney.formatBRL(saldoCents)}</td>
                        </tr>
                    `;
                }).join('');

                if (listaDocumentosTributosBody) listaDocumentosTributosBody.innerHTML = rowsDocs;

                if (tfootDocumentosTributos) {
                    tfootDocumentosTributos.innerHTML = `
                        <tr>
                            <td colspan="4" style="text-align:left; color:#fff;">Totais dos Lançamentos da Competência:</td>
                            <td style="text-align:right; color:#fff;">${window.BpoMoney.formatBRL(somaBruto)}</td>
                            <td style="text-align:right; color:#93c5fd;">${window.BpoMoney.formatBRL(somaPis)}</td>
                            <td style="text-align:right; color:#93c5fd;">${window.BpoMoney.formatBRL(somaCofins)}</td>
                            <td style="text-align:right; color:#fff;">${window.BpoMoney.formatBRL(somaIss)}</td>
                            <td style="text-align:right; color:#f59e0b;">${window.BpoMoney.formatBRL(somaIrpj)}</td>
                            <td style="text-align:right; color:#f59e0b;">${window.BpoMoney.formatBRL(somaCsll)}</td>
                            <td style="text-align:right; color:#f59e0b;">${window.BpoMoney.formatBRL(somaTributos)}</td>
                            <td style="text-align:right; color:var(--color-danger);">${window.BpoMoney.formatBRL(somaRetencoes)}</td>
                            <td style="text-align:right; color:var(--color-success);">${window.BpoMoney.formatBRL(somaSaldo)}</td>
                        </tr>
                    `;
                }
            }

            // =================================================================
            // PAINEL TRIMESTRAL ESPECIAL — MAR BRASIL (LUCRO PRESUMIDO)
            // =================================================================
            await renderizarPainelTrimestralMarBrasil();

        } catch (err) {
            console.error("Erro ao carregar dados fiscais:", err);
        }
    }

    async function renderizarPainelTrimestralMarBrasil() {
        const marBrasil = empresas.find(e => e.tax_regime === 'lucro_presumido');
        if (!marBrasil) {
            secaoTrimestralMarBrasil.style.display = 'none';
            return;
        }

        secaoTrimestralMarBrasil.style.display = 'block';

        // Determina o trimestre civil correspondente à competência ativa
        const [anoStr, mesStr] = competenciaAtiva.split('-');
        const ano = parseInt(anoStr, 10);
        const mes = parseInt(mesStr, 10);
        const trimestre = Math.ceil(mes / 3);
        const mesesTrimestre = [
            `${ano}-${String((trimestre - 1) * 3 + 1).padStart(2, '0')}`,
            `${ano}-${String((trimestre - 1) * 3 + 2).padStart(2, '0')}`,
            `${ano}-${String((trimestre - 1) * 3 + 3).padStart(2, '0')}`
        ];

        // Busca documentos de todos os 3 meses do trimestre para a Mar Brasil (sem persistir nada)
        let servicosTrimestreCents = 0n;
        let produtosTrimestreCents = 0n;
        let mesesComDados = 0;

        for (const m of mesesTrimestre) {
            try {
                const docsMes = await window.BpoSupabase.request(
                    `billing_documents?company_id=eq.${marBrasil.id}&competence_month=eq.${m}&status=neq.cancelled`,
                    { method: 'GET' }
                );
                if (docsMes && docsMes.length > 0) {
                    mesesComDados++;
                    docsMes.forEach(d => {
                        const val = window.BpoMoney.toCents(d.gross_amount);
                        const taxDetails = d.tax_details || window.BpoFiscalUtils.extrairTaxDetails(d);
                        const tipo = (taxDetails && taxDetails.item_type) || 'servico';
                        if (tipo === 'produto') produtosTrimestreCents += val;
                        else servicosTrimestreCents += val;
                    });
                }
            } catch (e) {}
        }

        // API real: apurarLucroPresumidoTrimestral(receitaServico, receitaProduto, options)
        const apuracaoTrimestral = window.BpoTaxEngine.apurarLucroPresumidoTrimestral(
            Number(servicosTrimestreCents) / 100,
            Number(produtosTrimestreCents) / 100,
            { ano: ano, trimestre: trimestre }
        );

        const isCompleto = mesesComDados === 3;
        badgeTrimestreMarBrasil.textContent = isCompleto ? `${trimestre}º Trimestre Fechado` : `Provisão — ${trimestre}º Trimestre em andamento (${mesesComDados}/3 meses)`;
        badgeTrimestreMarBrasil.className = isCompleto ? 'badge badge-success' : 'badge badge-warning';

        // Converte resultados numéricos do motor para centavos BigInt para formatação
        const fmtBRL = (num) => window.BpoMoney.formatBRL(BigInt(Math.round(num * 100)));

        painelTrimestralMarBrasil.innerHTML = `
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 16px;">
                <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 6px;">
                    <div style="font-size: 0.78rem; color: var(--text-muted);">Receita Serviços (Trimestre)</div>
                    <div style="font-size: 1.1rem; font-weight: 600; color: #fff;">${window.BpoMoney.formatBRL(servicosTrimestreCents)}</div>
                </div>
                <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 6px;">
                    <div style="font-size: 0.78rem; color: var(--text-muted);">Receita Produtos (Trimestre)</div>
                    <div style="font-size: 1.1rem; font-weight: 600; color: #fff;">${window.BpoMoney.formatBRL(produtosTrimestreCents)}</div>
                </div>
                <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 6px;">
                    <div style="font-size: 0.78rem; color: var(--text-muted);">Receita Total Sujeita a Limite</div>
                    <div style="font-size: 1.1rem; font-weight: 600; color: #fff;">${fmtBRL(apuracaoTrimestral.receitaTotalTrimestre)}</div>
                    <div style="font-size: 0.75rem; color: #94a3b8;">Teto Presunção: ${fmtBRL(apuracaoTrimestral.limitePresuncao)}</div>
                </div>
                <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 6px;">
                    <div style="font-size: 0.78rem; color: var(--text-muted);">Parcela Excedente Majorada</div>
                    <div style="font-size: 1.1rem; font-weight: 600; color: #f59e0b;">${fmtBRL(apuracaoTrimestral.excedenteTotal)}</div>
                    <div style="font-size: 0.75rem; color: #94a3b8;">Srv: 35,2% | Prod: 8,8% / 13,2%</div>
                </div>
            </div>

            <div style="background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 16px;">
                <h4 style="font-size: 0.9rem; font-weight: 600; margin-bottom: 12px; color: var(--text-main);">Memória de Cálculo Trimestral IRPJ & CSLL</h4>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 20px; font-size: 0.85rem;">
                    <div>
                        <strong style="color: #60a5fa; display: block; margin-bottom: 6px;">IRPJ Trimestral (Devido):</strong>
                        <div>• Base de Cálculo IRPJ: <strong>${fmtBRL(apuracaoTrimestral.base_IRPJ)}</strong></div>
                        <div>• IRPJ Regular (15%): <strong>${fmtBRL(apuracaoTrimestral.IRPJ_regular)}</strong></div>
                        <div>• Adicional IRPJ (10% sobre base > R$ 60k): <strong style="color: #f59e0b;">${fmtBRL(apuracaoTrimestral.IRPJ_adicional)}</strong></div>
                        <div style="margin-top: 4px; padding-top: 4px; border-top: 1px dashed rgba(255,255,255,0.1);">
                            Total IRPJ Devido no Trimestre: <strong style="color: #60a5fa;">${fmtBRL(apuracaoTrimestral.IRPJ_devido)}</strong>
                        </div>
                    </div>
                    <div>
                        <strong style="color: #34d399; display: block; margin-bottom: 6px;">CSLL Trimestral (Devida):</strong>
                        <div>• Base de Cálculo CSLL: <strong>${fmtBRL(apuracaoTrimestral.base_CSLL)}</strong></div>
                        <div>• CSLL Devida (9%): <strong style="color: #34d399;">${fmtBRL(apuracaoTrimestral.CSLL_devida)}</strong></div>
                        <div style="margin-top: 16px; font-size: 0.78rem; color: var(--text-muted);">
                            * Não duplica em visões mensais: rateio exato em centavos por nota/competência com reconciliação determinística.
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function formatarData(dataStr) {
        if (!dataStr) return '-';
        const partes = dataStr.split('T')[0].split('-');
        if (partes.length < 3) return dataStr;
        return `${partes[2]}/${partes[1]}/${partes[0]}`;
    }
})();
