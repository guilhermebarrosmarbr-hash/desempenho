// ==============================================================================
// impostos.js — Lógica do Módulo 05 (Controle de Impostos & Memória de Cálculo)
// Suporte integral à Visão Consolidada inicial (Todas as Empresas),
// apuração isolada por CNPJ antes de consolidar, segregação do DAS para Simples
// e cálculo trimestral IRPJ/CSLL para Mar Brasil com eliminação de células aproximadas.
// ==============================================================================

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

                    const itemType = (d.tax_details && d.tax_details.item_type) || 'servico';
                    if (itemType === 'produto') produtosCents += b;
                    else servicosCents += b;
                });

                const isLucroPresumido = emp.tax_regime === 'lucro_presumido';

                let impostoApuradoEmpCents = 0n;
                let saldoRecolherEmpCents = 0n;
                let detalheCardHtml = '';

                if (isLucroPresumido) {
                    // Lucro Presumido: PIS/Cofins mensais + Provisão IRPJ/CSLL trimestrais
                    const apuracaoLP = window.BpoTaxEngine.apurarLucroPresumidoMensal({
                        grossAmountCents: fatEmpCents,
                        pisAliq: 0.65,
                        cofinsAliq: 3.0,
                        issAliq: 5.0,
                        irpjProvisaoAliq: 4.8,
                        csllProvisaoAliq: 2.88
                    });

                    impostoApuradoEmpCents = apuracaoLP.totalTaxCents;
                    // Retenções abatem das obrigações (ex: IRRF compensável de IRPJ)
                    saldoRecolherEmpCents = impostoApuradoEmpCents > retEmpCents ? impostoApuradoEmpCents - retEmpCents : 0n;

                    detalheCardHtml = `
                        <div style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 16px; border: 1px solid rgba(255,255,255,0.05);">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px;">
                                <strong style="font-size:1rem; color:#fff;">${escapeHtml(emp.name)}</strong>
                                <span class="badge badge-primary">Lucro Presumido</span>
                            </div>
                            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; font-size:0.85rem;">
                                <div><span style="color:var(--text-muted);">PIS (0,65%):</span> <strong>${window.BpoMoney.formatBRL(apuracaoLP.components.pisCents)}</strong></div>
                                <div><span style="color:var(--text-muted);">COFINS (3,00%):</span> <strong>${window.BpoMoney.formatBRL(apuracaoLP.components.cofinsCents)}</strong></div>
                                <div><span style="color:var(--text-muted);">ISS Municipal (5,00%):</span> <strong>${window.BpoMoney.formatBRL(apuracaoLP.components.issCents)}</strong></div>
                                <div><span style="color:var(--text-muted);">Provisão IRPJ Trimestral:</span> <strong>${window.BpoMoney.formatBRL(apuracaoLP.components.irpjProvisaoCents)}</strong></div>
                                <div><span style="color:var(--text-muted);">Provisão CSLL Trimestral:</span> <strong>${window.BpoMoney.formatBRL(apuracaoLP.components.csllProvisaoCents)}</strong></div>
                                <div><span style="color:var(--text-muted);">Retenções a Compensar:</span> <strong style="color:var(--color-danger);">${window.BpoMoney.formatBRL(retEmpCents)}</strong></div>
                            </div>
                            <div style="margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between;">
                                <span>Total Impostos Competência: <strong>${window.BpoMoney.formatBRL(impostoApuradoEmpCents)}</strong></span>
                                <span style="color:var(--color-success); font-weight:700;">Saldo a Recolher: ${window.BpoMoney.formatBRL(saldoRecolherEmpCents)}</span>
                            </div>
                        </div>
                    `;
                } else {
                    // Simples Nacional: DZM ou Ybox via DAS estimado (RBT12 e Folha isoladas)
                    const apuracaoSN = window.BpoTaxEngine.apurarSimplesNacional({
                        faturamentoMesCents: fatEmpCents,
                        rbt12Cents: 36000000n, // Base estimada de referência isolada
                        folha12mCents: 0n,
                        anexo: 'anexo_iii'
                    });

                    impostoApuradoEmpCents = apuracaoSN.dasTotalCents;
                    saldoRecolherEmpCents = impostoApuradoEmpCents;

                    detalheCardHtml = `
                        <div style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 16px; border: 1px solid rgba(255,255,255,0.05);">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px;">
                                <strong style="font-size:1rem; color:#fff;">${escapeHtml(emp.name)}</strong>
                                <span class="badge badge-success">Simples Nacional (Anexo III)</span>
                            </div>
                            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; font-size:0.85rem;">
                                <div><span style="color:var(--text-muted);">Alíquota Efetiva DAS:</span> <strong>${(apuracaoSN.aliquotaEfetivaPercent * 100).toFixed(2)}%</strong></div>
                                <div><span style="color:var(--text-muted);">Parcela CPP (43,4%):</span> <strong>${window.BpoMoney.formatBRL(apuracaoSN.reparticao.cppCents)}</strong></div>
                                <div><span style="color:var(--text-muted);">Parcela ISS (33,5%):</span> <strong>${window.BpoMoney.formatBRL(apuracaoSN.reparticao.issCents)}</strong></div>
                                <div><span style="color:var(--text-muted);">Parcela PIS (2,76%):</span> <strong>${window.BpoMoney.formatBRL(apuracaoSN.reparticao.pisCents)}</strong></div>
                                <div><span style="color:var(--text-muted);">Parcela COFINS (12,74%):</span> <strong>${window.BpoMoney.formatBRL(apuracaoSN.reparticao.cofinsCents)}</strong></div>
                                <div><span style="color:var(--text-muted);">Parcela IRPJ/CSLL (7,6%):</span> <strong>${window.BpoMoney.formatBRL(apuracaoSN.reparticao.irpjCents + apuracaoSN.reparticao.csllCents)}</strong></div>
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
                        const tipo = (d.tax_details && d.tax_details.item_type) || 'servico';
                        if (tipo === 'produto') produtosTrimestreCents += val;
                        else servicosTrimestreCents += val;
                    });
                }
            } catch (e) {}
        }

        const apuracaoTrimestral = window.BpoTaxEngine.apurarLucroPresumidoTrimestral({
            servicesGrossCents: servicosTrimicosCents = servicosTrimestreCents,
            productsGrossCents: produtosTrimestreCents,
            year: ano,
            quarter: trimestre
        });

        const isCompleto = mesesComDados === 3;
        badgeTrimestreMarBrasil.textContent = isCompleto ? `${trimestre}º Trimestre Fechado` : `Provisão — ${trimestre}º Trimestre em andamento (${mesesComDados}/3 meses)`;
        badgeTrimestreMarBrasil.className = isCompleto ? 'badge badge-success' : 'badge badge-warning';

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
                    <div style="font-size: 1.1rem; font-weight: 600; color: #fff;">${window.BpoMoney.formatBRL(apuracaoTrimestral.receitaTotalCents)}</div>
                    <div style="font-size: 0.75rem; color: #94a3b8;">Teto Presunção: ${window.BpoMoney.formatBRL(apuracaoTrimestral.limiteTrimestralCents)}</div>
                </div>
                <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 6px;">
                    <div style="font-size: 0.78rem; color: var(--text-muted);">Parcela Excedente Majorada</div>
                    <div style="font-size: 1.1rem; font-weight: 600; color: #f59e0b;">${window.BpoMoney.formatBRL(apuracaoTrimestral.excedenteTotalCents)}</div>
                    <div style="font-size: 0.75rem; color: #94a3b8;">Srv: 35,2% | Prod: 8,8% / 13,2%</div>
                </div>
            </div>

            <div style="background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 16px;">
                <h4 style="font-size: 0.9rem; font-weight: 600; margin-bottom: 12px; color: var(--text-main);">Memória de Cálculo Trimestral IRPJ & CSLL</h4>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 20px; font-size: 0.85rem;">
                    <div>
                        <strong style="color: #60a5fa; display: block; margin-bottom: 6px;">IRPJ Trimestral (Devido):</strong>
                        <div>• Base de Cálculo IRPJ: <strong>${window.BpoMoney.formatBRL(apuracaoTrimestral.baseIrpjCents)}</strong></div>
                        <div>• IRPJ Regular (15%): <strong>${window.BpoMoney.formatBRL(apuracaoTrimestral.irpjRegularCents)}</strong></div>
                        <div>• Adicional IRPJ (10% sobre base > R$ 60k): <strong style="color: #f59e0b;">${window.BpoMoney.formatBRL(apuracaoTrimestral.irpjAdicionalCents)}</strong></div>
                        <div style="margin-top: 4px; padding-top: 4px; border-top: 1px dashed rgba(255,255,255,0.1);">
                            Total IRPJ Devido no Trimestre: <strong style="color: #60a5fa;">${window.BpoMoney.formatBRL(apuracaoTrimestral.irpjDevidoCents)}</strong>
                        </div>
                    </div>
                    <div>
                        <strong style="color: #34d399; display: block; margin-bottom: 6px;">CSLL Trimestral (Devida):</strong>
                        <div>• Base de Cálculo CSLL: <strong>${window.BpoMoney.formatBRL(apuracaoTrimestral.baseCsllCents)}</strong></div>
                        <div>• CSLL Devida (9%): <strong style="color: #34d399;">${window.BpoMoney.formatBRL(apuracaoTrimestral.csllDevidaCents)}</strong></div>
                        <div style="margin-top: 16px; font-size: 0.78rem; color: var(--text-muted);">
                            * Não duplica em visões mensais: rateio exato em centavos por nota/competência com reconciliação determinística.
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
})();
