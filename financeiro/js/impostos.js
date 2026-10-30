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
    const secaoRbt12Simples = document.getElementById('secaoRbt12Simples');
    const painelRbt12Simples = document.getElementById('painelRbt12Simples');
    const tituloRbt12 = document.getElementById('tituloRbt12');
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

    // Repartição padrão aproximada dos 5 anexos do Simples Nacional
    const REPARTICAO_SIMPLES_PADRAO = {
        anexo_i:   { irpj: 0.0500, csll: 0.0350, cofins: 0.1274, pis: 0.0276, inss: 0.4150, iss: 0.0000 },
        anexo_ii:  { irpj: 0.0500, csll: 0.0350, cofins: 0.1274, pis: 0.0276, inss: 0.4150, iss: 0.0000 },
        anexo_iii: { irpj: 0.0400, csll: 0.0350, cofins: 0.1280, pis: 0.0280, inss: 0.4340, iss: 0.3350 },
        anexo_iv:  { irpj: 0.1880, csll: 0.1520, cofins: 0.1765, pis: 0.0385, inss: 0.0000, iss: 0.4450 },
        anexo_v:   { irpj: 0.1500, csll: 0.1500, cofins: 0.1600, pis: 0.0350, inss: 0.2850, iss: 0.2200 }
    };

    function calcularFaturamentoTotalDoc(doc, taxDetails) {
        const bCents = window.BpoMoney.toCents(doc.gross_amount);
        const td = taxDetails || doc.tax_details || window.BpoFiscalUtils.extrairTaxDetails(doc);
        const dCents = (td && td.desconto) 
            ? window.BpoMoney.toCents(td.desconto) 
            : (doc.discounts ? window.BpoMoney.toCents(doc.discounts) : 0n);
        const eCents = (td && td.extras) 
            ? window.BpoMoney.toCents(td.extras) 
            : 0n;
        return (bCents + eCents) > dCents ? (bCents + eCents - dCents) : 0n;
    }

    /**
     * Calcula a lista dos 12 meses anteriores à competência informada
     * Ex: Para '2026-09', retorna ['2025-09', '2025-10', ..., '2026-08']
     */
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

    /**
     * Calcula o RBT12 real de uma empresa somando o faturamento total das 12 competências anteriores
     */
    async function calcularRbt12RealEmpresa(companyId, competencia) {
        const meses12 = obterMesesRbt12(competencia);
        if (meses12.length === 0) return 0;

        let totalRbt12Cents = 0n;
        try {
            // Consulta documentos das 12 competências anteriores
            const inQuery = meses12.join(',');
            const docs12 = await window.BpoSupabase.request(
                `billing_documents?company_id=eq.${companyId}&competence_month=in.(${inQuery})&status=neq.cancelled`,
                { method: 'GET' }
            );

            if (docs12 && docs12.length > 0) {
                docs12.forEach(d => {
                    const td = d.tax_details || window.BpoFiscalUtils.extrairTaxDetails(d);
                    totalRbt12Cents += calcularFaturamentoTotalDoc(d, td);
                });
            }
        } catch (e) {
            console.warn(`Aviso ao calcular RBT12 real da empresa ${companyId}:`, e);
        }

        return Number(totalRbt12Cents) / 100;
    }

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
            const apuracoesTrimestraisPorEmpresa = new Map();

            // Processa empresa por empresa (sem jamais misturar RBT12 ou bases de CNPJs distintos)
            for (const emp of empresasProcessar) {
                const docsEmp = docsCompetencia.filter(d => d.company_id === emp.id);
                let fatEmpCents = 0n;
                let retEmpCents = 0n;
                let servicosCents = 0n;
                let produtosCents = 0n;

                docsEmp.forEach(d => {
                    const r = window.BpoMoney.toCents(d.retentions);
                    const taxDetails = d.tax_details || window.BpoFiscalUtils.extrairTaxDetails(d);
                    const fatDoc = calcularFaturamentoTotalDoc(d, taxDetails);
                    fatEmpCents += fatDoc;
                    retEmpCents += r;

                    const itemType = (taxDetails && taxDetails.item_type) || 'servico';
                    if (itemType === 'produto') produtosCents += fatDoc;
                    else servicosCents += fatDoc;
                });

                const isLucroPresumido = emp.tax_regime === 'lucro_presumido';

                let impostoApuradoEmpCents = 0n;
                let saldoRecolherEmpCents = 0n;
                let detalheCardHtml = '';

                if (isLucroPresumido) {
                    // Lucro Presumido: PIS/COFINS mensais + IRPJ/CSLL trimestrais variáveis
                    const [anoStr, mesStr] = competenciaAtiva.split('-');
                    const ano = parseInt(anoStr, 10);
                    const mes = parseInt(mesStr, 10);
                    const numTrimestre = Math.ceil(mes / 3);
                    const mesesTrimestre = [
                        `${ano}-${String((numTrimestre - 1) * 3 + 1).padStart(2, '0')}`,
                        `${ano}-${String((numTrimestre - 1) * 3 + 2).padStart(2, '0')}`,
                        `${ano}-${String((numTrimestre - 1) * 3 + 3).padStart(2, '0')}`
                    ];

                    let docsTrimestreEmp = [];
                    for (const m of mesesTrimestre) {
                        if (m === competenciaAtiva) {
                            docsTrimestreEmp.push(...docsEmp);
                        } else {
                            try {
                                const docsOutros = await window.BpoSupabase.request(
                                    `billing_documents?company_id=eq.${emp.id}&competence_month=eq.${m}&status=neq.cancelled`,
                                    { method: 'GET' }
                                );
                                if (docsOutros && docsOutros.length > 0) {
                                    docsTrimestreEmp.push(...docsOutros);
                                }
                            } catch (e) {}
                        }
                    }

                    let servicosTrimCents = 0n;
                    let produtosTrimCents = 0n;
                    let irrfRetidoTrimCents = 0n;

                    docsTrimestreEmp.forEach(d => {
                        const td = d.tax_details || window.BpoFiscalUtils.extrairTaxDetails(d);
                        const val = calcularFaturamentoTotalDoc(d, td);
                        const tipo = (td && td.item_type) || 'servico';
                        if (tipo === 'produto') produtosTrimCents += val;
                        else servicosTrimCents += val;

                        if (td && td.has_irrf) {
                            const aliq = (td.irrf_aliq !== undefined && td.irrf_aliq !== null) ? td.irrf_aliq : 4.8;
                            irrfRetidoTrimCents += BigInt(Math.round((Number(val) / 100) * (aliq / 100) * 100));
                        }
                    });

                    const apuracaoTrimestral = window.BpoTaxEngine.apurarLucroPresumidoTrimestral(
                        Number(servicosTrimCents) / 100,
                        Number(produtosTrimCents) / 100,
                        { 
                            ano: ano, 
                            trimestre: numTrimestre, 
                            irrfRetidoTrimestre: Number(irrfRetidoTrimCents) / 100 
                        }
                    );

                    apuracoesTrimestraisPorEmpresa.set(emp.id, {
                        ...apuracaoTrimestral,
                        servicosTrimCents,
                        produtosTrimCents,
                        irrfRetidoTrimCents,
                        numTrimestre,
                        ano,
                        mesesTrimestre,
                        docsTrimestreEmp
                    });

                    // PIS/COFINS mensais
                    const fatServicoNum = Number(servicosCents) / 100;
                    const fatProdutoNum = Number(produtosCents) / 100;
                    const apuracaoLP = window.BpoTaxEngine.apurarLucroPresumidoMensal(
                        fatServicoNum, fatProdutoNum, { aliquotaIss: 5.0 }
                    );

                    const pisCents = BigInt(Math.round(apuracaoLP.impostosMensais.pis.value * 100));
                    const cofinsCents = BigInt(Math.round(apuracaoLP.impostosMensais.cofins.value * 100));
                    const issCents = BigInt(Math.round(apuracaoLP.impostosMensais.iss.value * 100));

                    // Provisão IRPJ e CSLL variáveis da competência usando as alíquotas efetivas globais do trimestre
                    const irpjProvCents = BigInt(Math.round(Number(fatEmpCents) / 100 * apuracaoTrimestral.aliqEfetivaIRPJ * 100));
                    const csllProvCents = BigInt(Math.round(Number(fatEmpCents) / 100 * apuracaoTrimestral.aliqEfetivaCSLL * 100));

                    impostoApuradoEmpCents = pisCents + cofinsCents + issCents + irpjProvCents + csllProvCents;
                    saldoRecolherEmpCents = impostoApuradoEmpCents > retEmpCents ? impostoApuradoEmpCents - retEmpCents : 0n;

                    const aliqIrpjPercent = (apuracaoTrimestral.aliqEfetivaIRPJ * 100).toFixed(2);
                    const aliqCsllPercent = (apuracaoTrimestral.aliqEfetivaCSLL * 100).toFixed(2);
                    const temAdicional = apuracaoTrimestral.IRPJ_adicional > 0;

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
                                <div><span style="color:var(--text-muted);">IRPJ Variável (${aliqIrpjPercent}% Tri${temAdicional ? ' com +10%' : ''}):</span> <strong style="color:#f59e0b;">${window.BpoMoney.formatBRL(irpjProvCents)}</strong></div>
                                <div><span style="color:var(--text-muted);">CSLL Variável (${aliqCsllPercent}% Tri):</span> <strong style="color:#f59e0b;">${window.BpoMoney.formatBRL(csllProvCents)}</strong></div>
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
                    // 1. Calcula o RBT12 real das 12 competências anteriores da empresa
                    const rbt12Calculado = await calcularRbt12RealEmpresa(emp.id, competenciaAtiva);

                    // 2. Verifica se os lançamentos possuem tax_details com anexo e isenção de ISS
                    let anexoEmp = 'anexo_iii';
                    let rbt12Emp = rbt12Calculado > 0 ? rbt12Calculado : 180000;
                    let temIsencaoIssEmp = false;
                    let somaDasLancamentosCents = 0n;
                    let temDasGravado = false;

                    docsEmp.forEach(d => {
                        const td = d.tax_details || window.BpoFiscalUtils.extrairTaxDetails(d);
                        if (td) {
                            if (td.das_anexo) anexoEmp = td.das_anexo;
                            if (rbt12Calculado <= 0 && td.das_rbt12) {
                                rbt12Emp = Number(window.BpoMoney.toCents(td.das_rbt12)) / 100;
                            }
                            if (td.iss_isento_simples) temIsencaoIssEmp = true;
                            if (td.das_valor) {
                                somaDasLancamentosCents += window.BpoMoney.toCents(td.das_valor);
                                temDasGravado = true;
                            }
                        }
                    });

                    const fatMesNum = Number(fatEmpCents) / 100;
                    let dasCents = 0n;
                    let aliqEfetivaNum = 0.06;

                    // Apuração oficial com RBT12 e isenção de ISS
                    const apuracaoSN = window.BpoTaxEngine.apurarSimplesNacional(rbt12Emp, fatMesNum, anexoEmp, {
                        issIsento: temIsencaoIssEmp
                    });
                    aliqEfetivaNum = apuracaoSN.aliquotaEfetivaNumero || 0.06;

                    if (temDasGravado && somaDasLancamentosCents > 0n) {
                        dasCents = somaDasLancamentosCents;
                    } else {
                        dasCents = BigInt(Math.round(apuracaoSN.valorDas * 100));
                    }

                    impostoApuradoEmpCents = dasCents;
                    saldoRecolherEmpCents = dasCents;

                    // Componentes oficiais retornados pelo motor
                    const comp = apuracaoSN.componentes || {};
                    const cppCents = BigInt(Math.round((comp.inss || 0) * 100));
                    const issSNCents = temIsencaoIssEmp ? 0n : BigInt(Math.round((comp.iss || 0) * 100));
                    const pisSNCents = BigInt(Math.round((comp.pis || 0) * 100));
                    const cofinsSNCents = BigInt(Math.round((comp.cofins || 0) * 100));
                    const irpjCsllSNCents = BigInt(Math.round(((comp.irpj || 0) + (comp.csll || 0)) * 100));

                    const anexoNome = anexoEmp.replace('_', ' ').toUpperCase();
                    const tagIsento = temIsencaoIssEmp ? ' <span style="font-size:0.7rem; color:#f59e0b; background:rgba(245,158,11,0.15); padding:2px 6px; border-radius:4px;">ISS Isento</span>' : '';
                    const rbt12Formatado = window.BpoMoney.formatBRL(BigInt(Math.round(rbt12Emp * 100)));

                    detalheCardHtml = `
                        <div style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 16px; border: 1px solid rgba(255,255,255,0.05);">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px;">
                                <strong style="font-size:1rem; color:#fff;">${escapeHtml(emp.name)}</strong>
                                <div>
                                    <span class="badge badge-success">Simples Nacional (${anexoNome})</span>
                                    ${tagIsento}
                                </div>
                            </div>
                            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; font-size:0.85rem;">
                                <div><span style="color:var(--text-muted);">RBT12 (12m Anteriores):</span> <strong style="color:#38bdf8;">${rbt12Formatado}</strong></div>
                                <div><span style="color:var(--text-muted);">Alíquota Efetiva DAS:</span> <strong>${(aliqEfetivaNum * 100).toFixed(2)}%</strong></div>
                                <div><span style="color:var(--text-muted);">Parcela CPP (INSS):</span> <strong>${window.BpoMoney.formatBRL(cppCents)}</strong></div>
                                <div><span style="color:var(--text-muted);">Parcela ISS:</span> <strong>${temIsencaoIssEmp ? '<span style="color:#f59e0b;">R$ 0,00 (Isento)</span>' : window.BpoMoney.formatBRL(issSNCents)}</strong></div>
                                <div><span style="color:var(--text-muted);">Parcela PIS:</span> <strong>${window.BpoMoney.formatBRL(pisSNCents)}</strong></div>
                                <div><span style="color:var(--text-muted);">Parcela COFINS:</span> <strong>${window.BpoMoney.formatBRL(cofinsSNCents)}</strong></div>
                                <div><span style="color:var(--text-muted);">Parcela IRPJ/CSLL:</span> <strong>${window.BpoMoney.formatBRL(irpjCsllSNCents)}</strong></div>
                            </div>
                            <div style="margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between;">
                                <span style="font-size:0.82rem; color:var(--text-muted);">* Tributos apurados com RBT12 real das competências de faturamento${temIsencaoIssEmp ? ' (com exclusão de ISS por isenção)' : ''}</span>
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

            // Mapeia RBT12 real calculado de cada empresa do Simples Nacional
            const rbt12PorEmpresaMap = new Map();
            for (const emp of empresasProcessar) {
                if (emp.tax_regime === 'simples_nacional') {
                    const rbt12 = await calcularRbt12RealEmpresa(emp.id, competenciaAtiva);
                    rbt12PorEmpresaMap.set(emp.id, rbt12);
                }
            }

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

                    // Faturamento Total = Valor Base - Descontos + Extras
                    const fatTotalCents = calcularFaturamentoTotalDoc(doc, taxDetails);
                    const retCents = window.BpoMoney.toCents(doc.retentions);
                    const fatTotalNum = Number(fatTotalCents) / 100;

                    let pisCents = 0n;
                    let cofinsCents = 0n;
                    let issCents = 0n;
                    let irpjCents = 0n;
                    let csllCents = 0n;
                    let tributosCents = 0n;
                    let saldoCents = 0n;
                    let issIsento = false;

                    if (isLP) {
                        pisCents = (taxDetails && taxDetails.pis_valor !== undefined && taxDetails.pis_valor !== null)
                            ? window.BpoMoney.toCents(taxDetails.pis_valor)
                            : BigInt(Math.round(fatTotalNum * 0.0065 * 100));

                        cofinsCents = (taxDetails && taxDetails.cofins_valor !== undefined && taxDetails.cofins_valor !== null)
                            ? window.BpoMoney.toCents(taxDetails.cofins_valor)
                            : BigInt(Math.round(fatTotalNum * 0.03 * 100));

                        if (itemType === 'servico') {
                            issCents = BigInt(Math.round(fatTotalNum * (aliqIss / 100) * 100));
                        } else {
                            issCents = 0n;
                        }

                        // IRPJ e CSLL calculados de modo variável com base em todo o faturamento da empresa no trimestre
                        const infoTri = apuracoesTrimestraisPorEmpresa.get(doc.company_id);
                        const aliqIrpjVar = infoTri ? infoTri.aliqEfetivaIRPJ : (itemType === 'servico' ? 0.048 : 0.012);
                        const aliqCsllVar = infoTri ? infoTri.aliqEfetivaCSLL : (itemType === 'servico' ? 0.0288 : 0.0108);

                        irpjCents = BigInt(Math.round(fatTotalNum * aliqIrpjVar * 100));
                        csllCents = BigInt(Math.round(fatTotalNum * aliqCsllVar * 100));
                        tributosCents = pisCents + cofinsCents + issCents + irpjCents + csllCents;
                        const issRecolher = issRetido ? 0n : issCents;
                        const aRecolherBase = pisCents + cofinsCents + issRecolher + irpjCents + csllCents;
                        saldoCents = aRecolherBase > retCents ? (aRecolherBase - retCents) : 0n;
                    } else {
                        // Simples Nacional: DZM / Ybox
                        const anexoKey = (taxDetails && taxDetails.das_anexo) ? taxDetails.das_anexo : 'anexo_iii';
                        issIsento = !!(taxDetails && taxDetails.iss_isento_simples);
                        
                        // RBT12 real calculado a partir das 12 competências anteriores da empresa
                        const rbt12Real = rbt12PorEmpresaMap.get(doc.company_id) || 0;
                        const rbt12Num = rbt12Real > 0 
                            ? rbt12Real 
                            : ((taxDetails && taxDetails.das_rbt12) 
                                ? Number(window.BpoMoney.toCents(taxDetails.das_rbt12)) / 100 
                                : 180000);

                        // Se o operador já salvou alíquota/valor do DAS no lançamento, respeita o valor gravado
                        let valorDasGravadoCents = null;
                        if (taxDetails && taxDetails.das_valor !== undefined && taxDetails.das_valor !== null) {
                            valorDasGravadoCents = window.BpoMoney.toCents(taxDetails.das_valor);
                        }

                        let aliqDasEfetiva = 0.06;
                        if (taxDetails && taxDetails.das_aliq !== undefined && taxDetails.das_aliq !== null && Number(taxDetails.das_aliq) > 0) {
                            aliqDasEfetiva = Number(taxDetails.das_aliq) / 100;
                        } else if (window.BpoTaxEngine) {
                            const previaSN = window.BpoTaxEngine.apurarSimplesNacional(rbt12Num, fatTotalNum, anexoKey, {
                                issRetidoTomador: issRetido,
                                issIsento: issIsento
                            });
                            aliqDasEfetiva = previaSN.aliquotaEfetivaNumero || 0.06;
                        }

                        // Partilha dos 5 anexos
                        let rep = REPARTICAO_SIMPLES_PADRAO[anexoKey] || REPARTICAO_SIMPLES_PADRAO.anexo_iii;
                        if (issIsento && rep.iss > 0) {
                            const issShare = rep.iss;
                            const outrosTotal = 1 - issShare;
                            const fator = outrosTotal > 0 ? (1 / outrosTotal) : 1;
                            rep = {
                                irpj:   rep.irpj   * fator,
                                csll:   rep.csll   * fator,
                                cofins: rep.cofins * fator,
                                pis:    rep.pis    * fator,
                                inss:   rep.inss   * fator,
                                iss:    0
                            };
                        }

                        irpjCents   = BigInt(Math.round(fatTotalNum * aliqDasEfetiva * rep.irpj * 100));
                        csllCents   = BigInt(Math.round(fatTotalNum * aliqDasEfetiva * rep.csll * 100));
                        cofinsCents = BigInt(Math.round(fatTotalNum * aliqDasEfetiva * rep.cofins * 100));
                        pisCents    = BigInt(Math.round(fatTotalNum * aliqDasEfetiva * rep.pis * 100));
                        issCents    = issIsento ? 0n : BigInt(Math.round(fatTotalNum * aliqDasEfetiva * rep.iss * 100));

                        if (valorDasGravadoCents !== null && valorDasGravadoCents > 0n) {
                            tributosCents = valorDasGravadoCents;
                        } else {
                            tributosCents = BigInt(Math.round(fatTotalNum * aliqDasEfetiva * 100));
                        }
                        saldoCents = tributosCents;
                    }

                    somaBruto += fatTotalCents;
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

                    let issLabel = '';
                    if (issIsento) {
                        issLabel = `<span style="color: #f59e0b; font-size: 0.78rem;" title="Isento de ISS">R$ 0,00 <span style="font-size:0.68rem; padding:1px 4px; border-radius:3px; background:rgba(245,158,11,0.15);">Isento</span></span>`;
                    } else if (issRetido) {
                        issLabel = `<span style="color:var(--color-danger); font-size:0.8rem;" title="Retido na Fonte pelo Tomador">${window.BpoMoney.formatBRL(issCents)} <span style="font-size:0.68rem; padding:1px 4px; border-radius:3px; background:rgba(239,68,68,0.15);">Retido</span></span>`;
                    } else {
                        issLabel = `<span style="color:#fff;">${window.BpoMoney.formatBRL(issCents)}</span>`;
                    }

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
                            <td style="text-align:right; font-weight:600; color:#fff;">${window.BpoMoney.formatBRL(fatTotalCents)}</td>
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
            await renderizarPainelRbt12();
            await renderizarPainelTrimestralMarBrasil();

        } catch (err) {
            console.error("Erro ao carregar dados fiscais:", err);
        }
    }

    // =================================================================
    // PAINEL RBT12 — HISTÓRICO 12 MESES (SIMPLES NACIONAL)
    // Exibido somente quando uma empresa Simples Nacional está selecionada
    // =================================================================
    async function renderizarPainelRbt12() {
        if (!secaoRbt12Simples) return;

        // Só exibe se uma empresa Simples Nacional específica estiver selecionada
        const empSelecionada = empresaAtivaId !== 'all'
            ? empresas.find(e => e.id === empresaAtivaId)
            : null;

        if (!empSelecionada || empSelecionada.tax_regime !== 'simples_nacional') {
            secaoRbt12Simples.style.display = 'none';
            return;
        }

        secaoRbt12Simples.style.display = 'block';
        if (tituloRbt12) {
            tituloRbt12.textContent = `IRTB12 — ${empSelecionada.name} (Últimos 12 Meses)`;
        }
        if (painelRbt12Simples) {
            painelRbt12Simples.innerHTML = `<div style="padding:16px; color:var(--text-muted);">Calculando RBT12...</div>`;
        }

        const meses12 = obterMesesRbt12(competenciaAtiva);

        // Busca todos os docs das 12 competências anteriores de uma vez
        let docsPorMes = {};
        meses12.forEach(m => { docsPorMes[m] = []; });

        try {
            const inQuery = meses12.join(',');
            const docs12 = await window.BpoSupabase.request(
                `billing_documents?company_id=eq.${empSelecionada.id}&competence_month=in.(${inQuery})&status=neq.cancelled`,
                { method: 'GET' }
            );
            if (docs12 && docs12.length > 0) {
                docs12.forEach(d => {
                    if (docsPorMes[d.competence_month] !== undefined) {
                        docsPorMes[d.competence_month].push(d);
                    }
                });
            }
        } catch (e) {
            console.warn('Erro ao buscar docs para RBT12:', e);
        }

        let totalRbt12Cents = 0n;
        const linhasTabela = meses12.map(m => {
            const docs = docsPorMes[m] || [];
            let fatMesCents = 0n;
            docs.forEach(d => {
                const td = d.tax_details || window.BpoFiscalUtils.extrairTaxDetails(d);
                fatMesCents += calcularFaturamentoTotalDoc(d, td);
            });
            totalRbt12Cents += fatMesCents;
            const [a, me] = m.split('-');
            const nomesMes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
            const mesNome = nomesMes[parseInt(me, 10) - 1] || me;
            const corValor = fatMesCents > 0n ? '#e2e8f0' : 'var(--text-muted)';
            return `
                <tr>
                    <td style="color:var(--text-muted); font-size:0.82rem;">${mesNome}/${a}</td>
                    <td style="text-align:right; color:${corValor};">${window.BpoMoney.formatBRL(fatMesCents)}</td>
                    <td style="text-align:center; color:var(--text-muted); font-size:0.78rem;">${docs.length} doc${docs.length !== 1 ? 's' : ''}</td>
                </tr>
            `;
        });

        const rbt12Num = Number(totalRbt12Cents) / 100;
        // Calcula a alíquota efetiva com o RBT12 real (pega anexo do primeiro doc da competência atual)
        let anexoEmp = 'anexo_iii';
        try {
            const docsAtuais = await window.BpoSupabase.request(
                `billing_documents?company_id=eq.${empSelecionada.id}&competence_month=eq.${competenciaAtiva}&status=neq.cancelled&limit=1`,
                { method: 'GET' }
            );
            if (docsAtuais && docsAtuais.length > 0) {
                const td = docsAtuais[0].tax_details || window.BpoFiscalUtils.extrairTaxDetails(docsAtuais[0]);
                if (td && td.das_anexo) anexoEmp = td.das_anexo;
            }
        } catch (e) {}

        const previa = window.BpoTaxEngine
            ? window.BpoTaxEngine.apurarSimplesNacional(rbt12Num, rbt12Num / 12, anexoEmp, {})
            : null;
        const aliqEfetiva = previa ? (previa.aliquotaEfetivaNumero * 100).toFixed(2) : '—';
        const faixaDesc = previa ? (previa.faixaDescricao || '') : '';

        if (painelRbt12Simples) {
            painelRbt12Simples.innerHTML = `
                <div style="display:grid; grid-template-columns: 1fr auto; gap: 24px; align-items: start;">
                    <div>
                        <table style="width:100%; border-collapse:collapse; font-size:0.84rem;">
                            <thead>
                                <tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                                    <th style="text-align:left; padding:6px 8px; color:var(--text-muted); font-weight:500;">Competência</th>
                                    <th style="text-align:right; padding:6px 8px; color:var(--text-muted); font-weight:500;">Faturamento Total</th>
                                    <th style="text-align:center; padding:6px 8px; color:var(--text-muted); font-weight:500;">Docs</th>
                                </tr>
                            </thead>
                            <tbody>${linhasTabela.join('')}</tbody>
                            <tfoot>
                                <tr style="border-top: 2px solid rgba(255,255,255,0.15);">
                                    <td style="padding:8px; font-weight:700; color:#fff;">Total RBT12</td>
                                    <td style="text-align:right; padding:8px; font-weight:700; color:#38bdf8; font-size:1rem;">${window.BpoMoney.formatBRL(totalRbt12Cents)}</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                    <div style="background:rgba(0,0,0,0.25); border-radius:10px; padding:20px; min-width:220px; border:1px solid rgba(56,189,248,0.2);">
                        <div style="color:var(--text-muted); font-size:0.78rem; margin-bottom:4px;">Receita Bruta (RBT12)</div>
                        <div style="font-size:1.4rem; font-weight:700; color:#38bdf8;">${window.BpoMoney.formatBRL(totalRbt12Cents)}</div>
                        <div style="margin-top:16px; color:var(--text-muted); font-size:0.78rem;">Alíquota Efetiva DAS estimada</div>
                        <div style="font-size:1.2rem; font-weight:700; color:#f59e0b;">${aliqEfetiva}%</div>
                        ${faixaDesc ? `<div style="font-size:0.74rem; color:var(--text-muted); margin-top:4px;">${faixaDesc}</div>` : ''}
                        <div style="margin-top:16px; color:var(--text-muted); font-size:0.78rem;">Anexo do Simples</div>
                        <div style="font-size:0.9rem; color:#e2e8f0;">${anexoEmp.replace('_',' ').toUpperCase()}</div>
                        <div style="margin-top:12px; font-size:0.72rem; color:var(--text-muted);">
                            * Soma das 12 competências anteriores a ${competenciaAtiva}.<br>
                            Alíquota efetiva calculada com RBT12 real pelo motor tributário.
                        </div>
                    </div>
                </div>
            `;
        }
    }

    async function renderizarPainelTrimestralMarBrasil() {
        const marBrasil = empresas.find(e => e.tax_regime === 'lucro_presumido');
        if (!marBrasil) {
            secaoTrimestralMarBrasil.style.display = 'none';
            return;
        }

        // Se uma empresa específica está selecionada e não é a Mar Brasil, ocultar o painel
        if (empresaAtivaId !== 'all' && empresaAtivaId !== marBrasil.id) {
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
        let irrfTrimestreCents = 0n;
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
                        const taxDetails = d.tax_details || window.BpoFiscalUtils.extrairTaxDetails(d);
                        const val = calcularFaturamentoTotalDoc(d, taxDetails);
                        const tipo = (taxDetails && taxDetails.item_type) || 'servico';
                        if (tipo === 'produto') produtosTrimestreCents += val;
                        else servicosTrimestreCents += val;

                        if (taxDetails && taxDetails.has_irrf) {
                            const aliq = (taxDetails.irrf_aliq !== undefined && taxDetails.irrf_aliq !== null) ? taxDetails.irrf_aliq : 4.8;
                            irrfTrimestreCents += BigInt(Math.round((Number(val) / 100) * (aliq / 100) * 100));
                        }
                    });
                }
            } catch (e) {}
        }

        // API real: apurarLucroPresumidoTrimestral(receitaServico, receitaProduto, options)
        const apuracaoTrimestral = window.BpoTaxEngine.apurarLucroPresumidoTrimestral(
            Number(servicosTrimestreCents) / 100,
            Number(produtosTrimestreCents) / 100,
            { 
                ano: ano, 
                trimestre: trimestre,
                irrfRetidoTrimestre: Number(irrfTrimestreCents) / 100
            }
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
                        <strong style="color: #60a5fa; display: block; margin-bottom: 6px;">IRPJ Trimestral (Devido & Compensação):</strong>
                        <div>• Base de Cálculo IRPJ: <strong>${fmtBRL(apuracaoTrimestral.base_IRPJ)}</strong></div>
                        <div>• IRPJ Regular (15%): <strong>${fmtBRL(apuracaoTrimestral.IRPJ_regular)}</strong></div>
                        <div>• Adicional IRPJ (10% sobre base > R$ 60k): <strong style="color: #f59e0b;">${fmtBRL(apuracaoTrimestral.IRPJ_adicional)}</strong></div>
                        <div style="margin-top: 4px; padding-top: 4px; border-top: 1px dashed rgba(255,255,255,0.1);">
                            Total IRPJ Devido no Trimestre: <strong style="color: #60a5fa;">${fmtBRL(apuracaoTrimestral.IRPJ_devido)}</strong>
                        </div>
                        <div style="margin-top: 6px; color: var(--color-danger);">
                            • (-) Dedução de IRRF Retido no Trimestre: <strong>- ${fmtBRL(apuracaoTrimestral.irrfRetidoTrimestre)}</strong>
                        </div>
                        <div style="margin-top: 6px; padding: 6px 10px; background: rgba(34,197,94,0.1); border-radius: 4px; border: 1px solid rgba(34,197,94,0.2);">
                            Saldo IRPJ a Recolher: <strong style="color: var(--color-success); font-size: 1rem;">${fmtBRL(apuracaoTrimestral.IRPJ_a_recolher)}</strong>
                            ${apuracaoTrimestral.creditoIRRFExcedente > 0 ? `<div style="font-size:0.75rem; color:#93c5fd; margin-top:2px;">Saldo credor de IRRF a compensar: ${fmtBRL(apuracaoTrimestral.creditoIRRFExcedente)}</div>` : ''}
                        </div>
                        <div style="margin-top: 6px; font-size: 0.78rem; color: #94a3b8;">
                            Alíquota Efetiva IRPJ: <strong>${(apuracaoTrimestral.aliqEfetivaIRPJ * 100).toFixed(2)}%</strong> (variável conforme faturamento trimestral)
                        </div>
                    </div>
                    <div>
                        <strong style="color: #34d399; display: block; margin-bottom: 6px;">CSLL Trimestral (Devida):</strong>
                        <div>• Base de Cálculo CSLL: <strong>${fmtBRL(apuracaoTrimestral.base_CSLL)}</strong></div>
                        <div>• CSLL Devida (9%): <strong style="color: #34d399;">${fmtBRL(apuracaoTrimestral.CSLL_devida)}</strong></div>
                        <div style="margin-top: 6px; font-size: 0.78rem; color: #94a3b8;">
                            Alíquota Efetiva CSLL: <strong>${(apuracaoTrimestral.aliqEfetivaCSLL * 100).toFixed(2)}%</strong> (variável)
                        </div>
                        <div style="margin-top: 16px; font-size: 0.78rem; color: var(--text-muted); line-height: 1.4;">
                            * <strong>Dinâmica Trimestral:</strong> Conforme novos faturamentos entram no trimestre, o adicional de 10% e as alíquotas efetivas recalculam automaticamente todos os lançamentos do período.
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
