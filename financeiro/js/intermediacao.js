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

            // 2. Repasses calculados da competência
            // Não filtra por company_id na query direta para evitar erro PGRST204 se a coluna não existir
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
            const bCents = window.BpoMoney.toCents(r.base_amount);
            const aCents = window.BpoMoney.toCents(r.intermediation_amount);
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

            return `
                <tr>
                    <td style="font-weight: 600; color: #fff;">${escapeHtml(empresaPagadoraAtiva.name)}</td>
                    <td style="font-weight: 600; color: var(--color-primary);">${nomeRecebedora}</td>
                    <td>${escapeHtml(r.competence_month)}</td>
                    <td>${window.BpoMoney.formatBRL(r.base_amount)}</td>
                    <td style="color: var(--color-warning); font-weight: 600;">${escapeHtml(r.rate)}%</td>
                    <td style="font-weight: 700; color: #fff;">${window.BpoMoney.formatBRL(r.intermediation_amount)}</td>
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

            // Grava o cálculo sem o campo company_id
            await window.BpoSupabase.request('intermediation_calculations', {
                method: 'POST',
                body: JSON.stringify({
                    agreement_id: acordo.id,
                    contract_id: null,
                    document_id: null,
                    competence_month: comp,
                    base_amount: valorDecimal,
                    rate: acordo.rate || 100.0,
                    intermediation_amount: valorDecimal,
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
