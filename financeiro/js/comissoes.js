// ==============================================================================
// comissoes.js — Lógica do Módulo 06 (Controle de Comissões)
// ==============================================================================

(function() {
    let empresas = [];
    let empresaAtiva = null;
    let competenciaAtiva = '';
    let colaboradores = [];
    let contratos = [];
    let comissoes = [];

    // DOM
    const selectEmpresa = document.getElementById('selectEmpresa');
    const inputCompetencia = document.getElementById('inputCompetencia');
    const listaComissoesBody = document.getElementById('listaComissoesBody');
    const listaColaboradoresBody = document.getElementById('listaColaboradoresBody');

    // Métricas
    const valBaseComissao = document.getElementById('valBaseComissao');
    const valTotalComissao = document.getElementById('valTotalComissao');
    const valComissaoPaga = document.getElementById('valComissaoPaga');
    const valComissaoPendente = document.getElementById('valComissaoPendente');

    // Modais
    const modalColaborador = document.getElementById('modalColaborador');
    const modalRegra = document.getElementById('modalRegra');

    window.addEventListener('DOMContentLoaded', async () => {
        const hoje = new Date();
        const ano = hoje.getFullYear();
        const mes = String(hoje.getMonth() + 1).padStart(2, '0');
        competenciaAtiva = `${ano}-${mes}`;
        inputCompetencia.value = competenciaAtiva;

        await carregarEmpresas();

        selectEmpresa.addEventListener('change', async (e) => {
            empresaAtiva = empresas.find(emp => emp.id === e.target.value) || null;
            await carregarDadosComissoes();
        });

        inputCompetencia.addEventListener('change', async (e) => {
            competenciaAtiva = e.target.value;
            await carregarDadosComissoes();
        });

        document.getElementById('btnNovoColaborador').addEventListener('click', () => {
            document.getElementById('colabId').value = '';
            document.getElementById('modalColaboradorTitulo').textContent = 'Cadastrar Colaborador';
            document.getElementById('formColaborador').reset();
            const btnExc = document.getElementById('btnExcluirColaborador');
            if (btnExc) btnExc.style.display = 'none';
            modalColaborador.style.display = 'flex';
        });

        document.getElementById('btnRegrasContrato').addEventListener('click', abrirModalRegras);
        document.getElementById('btnCalcularComissoes').addEventListener('click', processarApuracaoComissoes);

        // Delegate: quitar comissão
        listaComissoesBody.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-quitar-comissao');
            if (btn) window.quitarComissao(btn.dataset.id);
        });

        // Delegate: editar / excluir colaborador
        listaColaboradoresBody.addEventListener('click', (e) => {
            const btnEditar = e.target.closest('.btn-editar-colab');
            if (btnEditar) { window.editarColaborador(btnEditar.dataset.id); return; }
            const btnExcluir = e.target.closest('.btn-excluir-colab');
            if (btnExcluir) window.deletarColaborador(btnExcluir.dataset.id);
        });

        document.getElementById('formColaborador').addEventListener('submit', salvarColaborador);
        document.getElementById('formRegra').addEventListener('submit', salvarRegraContrato);
    });

    window.fecharModais = function() {
        modalColaborador.style.display = 'none';
        modalRegra.style.display = 'none';
    };

    async function carregarEmpresas() {
        try {
            empresas = await window.BpoSupabase.request('companies?order=name.asc', { method: 'GET' });
            selectEmpresa.innerHTML = '';

            if (empresas.length === 0) {
                selectEmpresa.innerHTML = '<option value="">Nenhuma empresa cadastrada</option>';
                return;
            }

            empresas.forEach(emp => {
                const opt = document.createElement('option');
                opt.value = emp.id;
                opt.textContent = emp.name;
                selectEmpresa.appendChild(opt);
            });

            empresaAtiva = empresas[0];
            selectEmpresa.value = empresaAtiva.id;
            await carregarDadosComissoes();

        } catch (err) {
            console.error("Erro ao carregar empresas:", err);
        }
    }

    async function carregarDadosComissoes() {
        if (!empresaAtiva) return;

        try {
            // 1. Colaboradores
            colaboradores = await window.BpoSupabase.request(`collaborators?company_id=eq.${empresaAtiva.id}&order=name.asc`, { method: 'GET' });

            // 2. Contratos — somente elegíveis para comissão
            const todosCtr = await window.BpoSupabase.request(`contracts?company_id=eq.${empresaAtiva.id}&order=name.asc`, { method: 'GET' });
            contratos = (todosCtr || []).filter(c => !!c.commission_eligible);

            // 3. Comissões calculadas na competência
            comissoes = await window.BpoSupabase.request(
                `commission_calculations?company_id=eq.${empresaAtiva.id}&competence_month=eq.${competenciaAtiva}&order=event_date.desc`,
                { method: 'GET' }
            );

            renderizarMetricas();
            renderizarExtrato();
            renderizarColaboradores();

        } catch (err) {
            console.error("Erro ao carregar dados de comissões:", err);
        }
    }

    function renderizarMetricas() {
        let baseTotal = 0n;
        let comissaoTotal = 0n;
        let comissaoPaga = 0n;

        comissoes.forEach(c => {
            const bCents = window.BpoMoney.toCents(c.base_amount);
            const cCents = window.BpoMoney.toCents(c.commission_amount);
            baseTotal += bCents;
            comissaoTotal += cCents;

            if (c.status === 'paid') {
                comissaoPaga += cCents;
            }
        });

        const pendente = comissaoTotal > comissaoPaga ? comissaoTotal - comissaoPaga : 0n;

        valBaseComissao.textContent = window.BpoMoney.formatBRL(baseTotal);
        valTotalComissao.textContent = window.BpoMoney.formatBRL(comissaoTotal);
        valComissaoPaga.textContent = window.BpoMoney.formatBRL(comissaoPaga);
        valComissaoPendente.textContent = window.BpoMoney.formatBRL(pendente);
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

    function renderizarExtrato() {
        if (comissoes.length === 0) {
            listaComissoesBody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 32px;">
                        Nenhuma comissão apurada para a competência ${competenciaAtiva}. Clique em "Processar Apuração".
                    </td>
                </tr>
            `;
            return;
        }

        listaComissoesBody.innerHTML = comissoes.map(c => {
            const colab = colaboradores.find(col => col.id === c.collaborator_id) || { name: 'Colaborador' };
            const contrato = contratos.find(con => con.id === c.contract_id);
            const contratoNome = contrato ? `${escapeHtml(contrato.code || '')} - ${escapeHtml(contrato.name || '')}` : 'Avulso / NF';
            const statusBadge = c.status === 'paid' 
                ? '<span class="badge badge-success">Pago</span>' 
                : '<span class="badge badge-warning">Pendente</span>';

            return `
                <tr>
                    <td style="font-weight: 600; color: #fff;">${escapeHtml(colab.name)}</td>
                    <td style="font-size: 0.85rem;">${contratoNome}</td>
                    <td>${formatarData(c.event_date)}</td>
                    <td>${window.BpoMoney.formatBRL(c.base_amount)}</td>
                    <td style="color: var(--color-warning);">${c.percentage}%</td>
                    <td style="font-weight: 700; color: #fff;">${window.BpoMoney.formatBRL(c.commission_amount)}</td>
                    <td>${statusBadge}</td>
                    <td>
                        ${c.status !== 'paid' ? `
                            <button class="btn btn-secondary btn-sm btn-quitar-comissao" data-id="${escapeHtml(c.id)}">
                                Quitar
                            </button>
                        ` : '<span style="color: var(--text-muted); font-size: 0.8rem;">Liquidado</span>'}
                    </td>
                </tr>
            `;
        }).join('');
    }

    function renderizarColaboradores() {
        if (colaboradores.length === 0) {
            listaColaboradoresBody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">
                        Nenhum colaborador cadastrado.
                    </td>
                </tr>
            `;
            return;
        }

        listaColaboradoresBody.innerHTML = colaboradores.map(c => `
            <tr>
                <td style="font-weight: 600; color: #fff;">${c.name}</td>
                <td>${c.document || '-'}</td>
                <td>${c.email || '-'}</td>
                <td>${c.role}</td>
                <td><span class="badge badge-success">Ativo</span></td>
                <td style="display: flex; gap: 6px;">
                    <button class="btn btn-secondary btn-sm btn-editar-colab" data-id="${c.id}">
                        ✏️ Editar
                    </button>
                    <button class="btn btn-danger btn-sm btn-excluir-colab" data-id="${c.id}">
                        🗑️ Excluir
                    </button>
                </td>
            </tr>
        `).join('');
    }

    window.editarColaborador = function(id) {
        const c = colaboradores.find(col => col.id === id);
        if (!c) return;

        document.getElementById('colabId').value = c.id;
        document.getElementById('modalColaboradorTitulo').textContent = 'Editar Colaborador';
        document.getElementById('colabNome').value = c.name || '';
        document.getElementById('colabCpf').value = c.document || '';
        document.getElementById('colabFuncao').value = c.role || 'Vendedor Técnico';
        document.getElementById('colabEmail').value = c.email || '';
        const btnExc = document.getElementById('btnExcluirColaborador');
        if (btnExc) btnExc.style.display = 'inline-flex';

        modalColaborador.style.display = 'flex';
    };

    window.deletarColaboradorModal = async function() {
        const id = document.getElementById('colabId').value;
        if (!id) return;
        if (!confirm('Tem certeza que deseja excluir este colaborador?')) return;
        try {
            await window.BpoSupabase.request(`collaborators?id=eq.${id}`, { method: 'DELETE' });
            fecharModais();
            await carregarDadosComissoes();
            alert('Colaborador excluído com sucesso.');
        } catch (err) {
            alert('Erro ao excluir colaborador: ' + err.message);
        }
    };

    function formatarData(dataStr) {
        if (!dataStr) return '-';
        const parts = dataStr.split('-');
        return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : dataStr;
    }

    function abrirModalRegras() {
        const selContrato = document.getElementById('regraContrato');
        const selColab = document.getElementById('regraColaborador');

        selContrato.innerHTML = contratos.map(c => `<option value="${c.id}">${c.code} - ${c.name}</option>`).join('') || '<option value="">Sem contratos</option>';
        selColab.innerHTML = colaboradores.map(c => `<option value="${c.id}">${c.name}</option>`).join('') || '<option value="">Sem colaboradores</option>';

        modalRegra.style.display = 'flex';
    }

    async function salvarColaborador(e) {
        e.preventDefault();
        const idExistente = document.getElementById('colabId').value;
        const nome = document.getElementById('colabNome').value.trim();
        const cpf = document.getElementById('colabCpf').value.trim();
        const funcao = document.getElementById('colabFuncao').value.trim();
        const email = document.getElementById('colabEmail').value.trim();

        try {
            if (idExistente) {
                await window.BpoSupabase.request(`collaborators?id=eq.${idExistente}`, {
                    method: 'PATCH',
                    body: JSON.stringify({
                        name: nome,
                        document: cpf,
                        role: funcao,
                        email: email
                    })
                });

                fecharModais();
                document.getElementById('formColaborador').reset();
                await carregarDadosComissoes();
                alert('Colaborador atualizado com sucesso!');
                return;
            }

            await window.BpoSupabase.request('collaborators', {
                method: 'POST',
                body: JSON.stringify({
                    company_id: empresaAtiva.id,
                    name: nome,
                    document: cpf,
                    role: funcao,
                    email: email,
                    active: true
                })
            });

            fecharModais();
            document.getElementById('formColaborador').reset();
            await carregarDadosComissoes();
            alert('Colaborador cadastrado com sucesso!');
        } catch (err) {
            alert('Erro ao salvar colaborador: ' + err.message);
        }
    }

    async function salvarRegraContrato(e) {
        e.preventDefault();
        const contratoId = document.getElementById('regraContrato').value;
        const colabId = document.getElementById('regraColaborador').value;
        const percentual = parseFloat(document.getElementById('regraPercentual').value);
        const base = document.getElementById('regraBase').value;

        if (!contratoId || !colabId) {
            alert('Selecione o contrato e o colaborador.');
            return;
        }

        try {
            await window.BpoSupabase.request('contract_commission_rules', {
                method: 'POST',
                body: JSON.stringify({
                    contract_id: contratoId,
                    collaborator_id: colabId,
                    percentage: percentual,
                    basis_override: base,
                    valid_from: new Date().toISOString().split('T')[0]
                })
            });

            fecharModais();
            alert('Regra vinculada ao contrato com sucesso!');
        } catch (err) {
            alert('Erro ao salvar regra: ' + err.message);
        }
    }

    async function processarApuracaoComissoes() {
        if (!empresaAtiva) return;

        try {
            // 1. Busca todos os recebimentos registrados na empresa
            let receipts = [];
            try {
                receipts = await window.BpoSupabase.request(
                    `receipts?company_id=eq.${empresaAtiva.id}&order=receipt_date.desc`,
                    { method: 'GET' }
                );
            } catch (rErr) {
                console.warn('Aviso ao consultar receipts:', rErr.message);
            }

            // Filtra os recebimentos cuja data está na competência ativa (Regime de Caixa - Item 03)
            const receiptsCompetencia = receipts.filter(r => {
                if (!r.receipt_date) return false;
                return r.receipt_date.startsWith(competenciaAtiva);
            });

            // 2. Busca documentos para vincular dados de contrato e regras
            const docs = await window.BpoSupabase.request(
                `billing_documents?company_id=eq.${empresaAtiva.id}`,
                { method: 'GET' }
            );
            const docsMap = new Map();
            docs.forEach(d => docsMap.set(d.id, d));

            if (colaboradores.length === 0) {
                alert('Cadastre colaboradores antes de processar as comissões.');
                return;
            }

            // 3. Busca regras de comissão somente dos contratos elegíveis desta empresa
            let regrasComissao = [];
            try {
                if (contratos.length > 0) {
                    const idsElegiveis = contratos.map(c => c.id).join(',');
                    regrasComissao = await window.BpoSupabase.request(
                        `contract_commission_rules?contract_id=in.(${idsElegiveis})`,
                        { method: 'GET' }
                    );
                }
            } catch(e) {}

            const lotesComissoes = [];
            const idsDocsComReceipt = new Set();

            // 4. Processa cada baixa/recebimento recebido no mês (suporte a baixas parciais - Item 03)
            for (const r of receiptsCompetencia) {
                const doc = docsMap.get(r.external_id);
                if (doc && doc.status === 'cancelled') continue;
                if (doc) idsDocsComReceipt.add(doc.id);

                const contratoId = r.contract_id || (doc ? doc.contract_id : null);
                const contrato = contratos.find(c => c.id === contratoId);

                // Se o contrato existir e não for elegível a comissão, pula
                if (contrato && !contrato.commission_eligible) continue;

                const baseCents = window.BpoMoney.toCents(r.gross_amount);
                if (baseCents <= 0n) continue;

                const dataEvento = r.receipt_date;

                // Regras vinculadas ao contrato e vigentes na data do recebimento
                const regrasDoContrato = contrato ? regrasComissao.filter(reg => {
                    if (reg.contract_id !== contrato.id) return false;
                    const de = !reg.valid_from || reg.valid_from <= dataEvento;
                    const ate = !reg.valid_until || reg.valid_until >= dataEvento;
                    return de && ate;
                }) : [];

                if (regrasDoContrato.length > 0) {
                    for (const regra of regrasDoContrato) {
                        const colabId = regra.collaborator_id;
                        const percentual = parseFloat(regra.percentage) || 5.0;
                        const capType = contrato ? (contrato.commission_cap_type || 'none') : 'none';
                        const capValue = contrato ? (contrato.commission_cap_value || 0) : 0;

                        const res = window.BpoCommissionEngine.calcularComissao({
                            baseAmount: baseCents,
                            percentage: percentual,
                            capType,
                            capValue
                        });

                        const chaveIdempotente = `com_rec_${r.id}_${colabId}`;

                        lotesComissoes.push({
                            company_id: empresaAtiva.id,
                            collaborator_id: colabId,
                            contract_id: contrato ? contrato.id : null,
                            document_id: doc ? doc.id : (r.external_id || null),
                            competence_month: competenciaAtiva,
                            event_date: dataEvento,
                            base_amount: window.BpoMoney.toDecimalString(baseCents),
                            percentage: percentual,
                            commission_amount: window.BpoMoney.toDecimalString(res.comissaoCents),
                            status: 'pending',
                            idempotency_key: chaveIdempotente
                        });
                    }
                } else if (colaboradores.length > 0 && (!contrato || contrato.commission_eligible)) {
                    // Fallback para vendedor padrão caso contrato seja elegível sem regra específica
                    const colabPadrao = colaboradores[0];
                    const percentual = 5.0;
                    const res = window.BpoCommissionEngine.calcularComissao({
                        baseAmount: baseCents,
                        percentage: percentual
                    });

                    const chaveIdempotente = `com_rec_${r.id}_${colabPadrao.id}`;

                    lotesComissoes.push({
                        company_id: empresaAtiva.id,
                        collaborator_id: colabPadrao.id,
                        contract_id: contrato ? contrato.id : null,
                        document_id: doc ? doc.id : (r.external_id || null),
                        competence_month: competenciaAtiva,
                        event_date: dataEvento,
                        base_amount: window.BpoMoney.toDecimalString(baseCents),
                        percentage: percentual,
                        commission_amount: window.BpoMoney.toDecimalString(res.comissaoCents),
                        status: 'pending',
                        idempotency_key: chaveIdempotente
                    });
                }
            }

            // 5. Fallback para documentos pagos na competência sem linha em receipts (legados)
            for (const d of docs) {
                if (d.status === 'cancelled') continue;
                if (idsDocsComReceipt.has(d.id)) continue;

                const taxDetails = d.tax_details || (window.BpoFiscalUtils ? window.BpoFiscalUtils.extrairTaxDetails(d) : null) || {};
                const dataPagamento = taxDetails.payment_date || (d.status === 'paid' && d.competence_month === competenciaAtiva ? d.issue_date : null);

                if (!dataPagamento || !dataPagamento.startsWith(competenciaAtiva)) continue;

                const contrato = contratos.find(c => c.id === d.contract_id);
                if (contrato && !contrato.commission_eligible) continue;

                const baseCents = window.BpoMoney.toCents(d.net_amount || d.gross_amount);
                if (baseCents <= 0n) continue;

                const regrasDoContrato = contrato ? regrasComissao.filter(reg => {
                    if (reg.contract_id !== contrato.id) return false;
                    const de = !reg.valid_from || reg.valid_from <= dataPagamento;
                    const ate = !reg.valid_until || reg.valid_until >= dataPagamento;
                    return de && ate;
                }) : [];

                if (regrasDoContrato.length > 0) {
                    for (const regra of regrasDoContrato) {
                        const colabId = regra.collaborator_id;
                        const percentual = parseFloat(regra.percentage) || 5.0;
                        const capType = contrato ? (contrato.commission_cap_type || 'none') : 'none';
                        const capValue = contrato ? (contrato.commission_cap_value || 0) : 0;

                        const res = window.BpoCommissionEngine.calcularComissao({
                            baseAmount: baseCents,
                            percentage: percentual,
                            capType,
                            capValue
                        });

                        const chaveIdempotente = `com_doc_${d.id}_${colabId}`;

                        lotesComissoes.push({
                            company_id: empresaAtiva.id,
                            collaborator_id: colabId,
                            contract_id: contrato ? contrato.id : null,
                            document_id: d.id,
                            competence_month: competenciaAtiva,
                            event_date: dataPagamento,
                            base_amount: window.BpoMoney.toDecimalString(baseCents),
                            percentage: percentual,
                            commission_amount: window.BpoMoney.toDecimalString(res.comissaoCents),
                            status: 'pending',
                            idempotency_key: chaveIdempotente
                        });
                    }
                } else if (colaboradores.length > 0 && (!contrato || contrato.commission_eligible)) {
                    const colabPadrao = colaboradores[0];
                    const percentual = 5.0;
                    const res = window.BpoCommissionEngine.calcularComissao({
                        baseAmount: baseCents,
                        percentage: percentual
                    });

                    const chaveIdempotente = `com_doc_${d.id}_${colabPadrao.id}`;

                    lotesComissoes.push({
                        company_id: empresaAtiva.id,
                        collaborator_id: colabPadrao.id,
                        contract_id: contrato ? contrato.id : null,
                        document_id: d.id,
                        competence_month: competenciaAtiva,
                        event_date: dataPagamento,
                        base_amount: window.BpoMoney.toDecimalString(baseCents),
                        percentage: percentual,
                        commission_amount: window.BpoMoney.toDecimalString(res.comissaoCents),
                        status: 'pending',
                        idempotency_key: chaveIdempotente
                    });
                }
            }

            if (lotesComissoes.length === 0) {
                alert(`Nenhum recebimento registrado para a competência ${competenciaAtiva}.\n\nAs comissões são apuradas pelo regime de caixa (data de recebimento). Realize as baixas totais ou parciais no Módulo de Faturamento para apurar as comissões deste mês.`);
                return;
            }

            // Upsert em lote ignorando duplicatas existentes
            await window.BpoSupabase.request('commission_calculations?on_conflict=idempotency_key', {
                method: 'POST',
                prefer: 'resolution=ignore-duplicates,return=representation',
                body: JSON.stringify(lotesComissoes)
            });

            await carregarDadosComissoes();
            alert(`Apuração concluída com sucesso!\n${lotesComissoes.length} parcela(s) de comissão vinculada(s) aos recebimentos de ${competenciaAtiva}.`);

        } catch (err) {
            alert('Erro ao processar comissões: ' + err.message);
        }
    }

    window.quitarComissao = async function(id) {
        if (!confirm('Deseja confirmar a quitação desta comissão?')) return;
        try {
            await window.BpoSupabase.request(`commission_calculations?id=eq.${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'paid' })
            });
            await carregarDadosComissoes();
            alert('Comissão quitada com sucesso!');
        } catch (err) {
            alert('Erro ao quitar: ' + err.message);
        }
    };

    window.deletarColaborador = async function(id) {
        if (!confirm('Tem certeza que deseja excluir este colaborador?')) return;
        try {
            await window.BpoSupabase.request(`collaborators?id=eq.${id}`, { method: 'DELETE' });
            await carregarDadosComissoes();
            alert('Colaborador excluído com sucesso.');
        } catch (err) {
            alert('Erro ao excluir colaborador: ' + err.message);
        }
    };
})();
