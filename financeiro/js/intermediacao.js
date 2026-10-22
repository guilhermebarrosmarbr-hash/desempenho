// ==============================================================================
// intermediacao.js — Lógica do Módulo 07 (Intermediação de Negócios)
// ==============================================================================

(function() {
    let empresas = [];
    let empresaPagadoraAtiva = null;
    let competenciaAtiva = '';
    let acordos = [];
    let repasses = [];

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

    // Modal
    const modalAcordo = document.getElementById('modalAcordo');

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
    });

    window.fecharModais = function() {
        modalAcordo.style.display = 'none';
    };

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
            // 1. Acordos onde a empresa selecionada é pagadora
            acordos = await window.BpoSupabase.request(
                `intermediation_agreements?payer_company_id=eq.${empresaPagadoraAtiva.id}`,
                { method: 'GET' }
            );

            // 2. Repasses calculados da competência filtrados pela empresa pagadora
            repasses = await window.BpoSupabase.request(
                `intermediation_calculations?company_id=eq.${empresaPagadoraAtiva.id}&competence_month=eq.${competenciaAtiva}&order=created_at.desc`,
                { method: 'GET' }
            );

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
            const bCents = window.BpoMoney.toCents(r.base_amount);
            const aCents = window.BpoMoney.toCents(r.intermediation_amount);
            baseTotal += bCents;
            apuradoTotal += aCents;

            if (r.status === 'paid') {
                liquidadoTotal += aCents;
            }
        });

        // Calcula taxa média ponderada de verdade
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
                        Nenhum repasse intercompany apurado na competência ${escapeHtml(competenciaAtiva)}. Clique em "Processar Repasses".
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

            return `
                <tr>
                    <td style="font-weight: 700; color: #fff;">${escapeHtml(r.competence_month)}</td>
                    <td>${escapeHtml(empresaPagadoraAtiva.name)}</td>
                    <td>${nomeRecebedora}</td>
                    <td>${escapeHtml(window.BpoMoney.formatBRL(r.base_amount))}</td>
                    <td style="color: var(--color-warning);">${escapeHtml(r.rate)}%</td>
                    <td style="font-weight: 700; color: #fff;">${escapeHtml(window.BpoMoney.formatBRL(r.intermediation_amount))}</td>
                    <td>${statusBadge}</td>
                    <td>
                        ${r.status !== 'paid' ? `
                            <button class="btn btn-secondary btn-sm btn-quitar-repasse" data-id="${escapeHtml(r.id)}">
                                Quitar Repasse
                            </button>
                        ` : '<span style="color: var(--text-muted); font-size: 0.8rem;">Concluído</span>'}
                    </td>
                </tr>
            `;
        }).join('');

        listaIntermediacaoBody.querySelectorAll('.btn-quitar-repasse').forEach(btn => {
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
            return `
                <tr>
                    <td style="font-weight: 600; color: #fff;">${escapeHtml(empresaPagadoraAtiva.name)}</td>
                    <td>${escapeHtml(rec.name)}</td>
                    <td style="color: var(--color-warning); font-weight: 700;">${escapeHtml(a.rate)}%</td>
                    <td>${a.event_trigger === 'billing' ? 'Emissão de NFS-e' : 'Liquidação no Caixa'}</td>
                    <td>Desde ${escapeHtml(a.valid_from)}</td>
                    <td><span class="badge badge-success">Vigente</span></td>
                </tr>
            `;
        }).join('');
    }

    function abrirModalAcordo() {
        const selPag = document.getElementById('acordoPagadora');
        const selRec = document.getElementById('acordoRecebedora');

        selPag.innerHTML = empresas.map(e => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join('');
        selRec.innerHTML = empresas.map(e => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join('');

        if (empresaPagadoraAtiva) {
            selPag.value = empresaPagadoraAtiva.id;
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
            await carregarDadosIntermediacao();
            alert('Acordo de intermediação gravado com sucesso!');
        } catch (err) {
            alert('Erro ao gravar acordo: ' + err.message);
        }
    }

    async function processarRepasses() {
        if (!empresaPagadoraAtiva) return;

        try {
            // Busca faturamento emitido no mês
            const docs = await window.BpoSupabase.request(
                `billing_documents?company_id=eq.${empresaPagadoraAtiva.id}&competence_month=eq.${competenciaAtiva}`,
                { method: 'GET' }
            );

            if (docs.length === 0) {
                alert('Não há documentos faturados nesta competência.');
                return;
            }

            // Seleciona acordos vigentes na competência (valid_from <= fim do mês e valid_until >= início do mês)
            const hoje = new Date().toISOString().split('T')[0];
            const acordosVigentes = acordos.filter(a => {
                const validoDe = a.valid_from <= hoje;
                const validoAte = !a.valid_until || a.valid_until >= hoje;
                return validoDe && validoAte;
            });

            if (acordosVigentes.length === 0) {
                alert('Nenhum acordo de intermediação vigente para esta empresa.');
                abrirModalAcordo();
                return;
            }

            const acordo = acordosVigentes[0];
            const taxa = parseFloat(acordo.rate);
            const lotesCalculos = [];

            for (const d of docs) {
                if (d.status === 'cancelled') continue;

                // Respeita event_trigger: se for 'receipt', só processa documentos pagos ou parcialmente pagos
                if (acordo.event_trigger === 'receipt' && d.status !== 'paid' && d.status !== 'partially_paid') {
                    continue;
                }

                const baseCents = window.BpoMoney.toCents(d.net_amount);
                const res = window.BpoCommissionEngine.calcularIntermediacao({
                    baseAmount: baseCents,
                    ratePercentage: taxa
                });

                const idempotencyKey = `inter_${d.id}_${acordo.id}`;

                lotesCalculos.push({
                    company_id: empresaPagadoraAtiva.id,
                    agreement_id: acordo.id,
                    contract_id: d.contract_id || null,
                    document_id: d.id,
                    competence_month: competenciaAtiva,
                    base_amount: window.BpoMoney.toDecimalString(baseCents),
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

            // Upsert em lote com on_conflict=idempotency_key e ignore-duplicates
            await window.BpoSupabase.request('intermediation_calculations?on_conflict=idempotency_key', {
                method: 'POST',
                prefer: 'resolution=ignore-duplicates,return=representation',
                body: JSON.stringify(lotesCalculos)
            });

            await carregarDadosIntermediacao();
            alert(`Processamento concluído! Lote de repasses avaliado e registrado.`);

        } catch (err) {
            alert('Erro ao processar repasses: ' + err.message);
        }
    }

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
