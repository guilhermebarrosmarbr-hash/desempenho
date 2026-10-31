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
    let regrasContrato = [];

    // DOM
    const selectEmpresa = document.getElementById('selectEmpresa');
    const inputCompetencia = document.getElementById('inputCompetencia');
    const listaComissoesBody = document.getElementById('listaComissoesBody');
    const listaColaboradoresBody = document.getElementById('listaColaboradoresBody');
    const listaRegrasBody = document.getElementById('listaRegrasBody');

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

        document.getElementById('btnRegrasContrato').addEventListener('click', () => abrirModalRegras());
        const btnNovaRegraCard = document.getElementById('btnNovaRegraCard');
        if (btnNovaRegraCard) btnNovaRegraCard.addEventListener('click', () => abrirModalRegras());
        document.getElementById('btnCalcularComissoes').addEventListener('click', processarApuracaoComissoes);

        // Delegate: quitar comissão
        listaComissoesBody.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-quitar-comissao');
            if (btn) window.quitarComissao(btn.dataset.id);
        });

        // Delegate: editar / excluir regra de contrato
        if (listaRegrasBody) {
            listaRegrasBody.addEventListener('click', (e) => {
                const btnEditar = e.target.closest('.btn-editar-regra');
                if (btnEditar) { window.editarRegra(btnEditar.dataset.id); return; }
                const btnExcluir = e.target.closest('.btn-excluir-regra');
                if (btnExcluir) window.deletarRegra(btnExcluir.dataset.id);
            });
        }

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

            // 3. Regras de comissão dos contratos elegíveis desta empresa
            regrasContrato = [];
            if (contratos.length > 0) {
                try {
                    const idsElegiveis = contratos.map(c => c.id).join(',');
                    regrasContrato = await window.BpoSupabase.request(
                        `contract_commission_rules?contract_id=in.(${idsElegiveis})`,
                        { method: 'GET' }
                    ) || [];
                } catch (rErr) {
                    console.warn('Aviso ao carregar regras:', rErr);
                }
            }

            // 4. Comissões calculadas na competência
            comissoes = await window.BpoSupabase.request(
                `commission_calculations?company_id=eq.${empresaAtiva.id}&competence_month=eq.${competenciaAtiva}&order=event_date.desc`,
                { method: 'GET' }
            ) || [];

            renderizarMetricas();
            renderizarExtrato();
            renderizarRegras();
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

    
    function renderizarRegras() {
        if (!listaRegrasBody) return;
        if (!regrasContrato || regrasContrato.length === 0) {
            listaRegrasBody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">
                        Nenhuma regra de comissão cadastrada para os contratos elegíveis desta empresa.
                    </td>
                </tr>
            `;
            return;
        }

        listaRegrasBody.innerHTML = regrasContrato.map(r => {
            const ctr = contratos.find(c => c.id === r.contract_id) || { code: 'CTR', name: 'Contrato' };
            const col = colaboradores.find(c => c.id === r.collaborator_id) || { name: 'Colaborador' };
            const baseTxt = r.basis_override === 'gross_invoiced' ? 'Faturamento Emitido (Bruto)' : 'Líquido Recebido';
            const vigencia = r.valid_from ? formatarData(r.valid_from) : 'Desde o início';

            return `
                <tr>
                    <td style="font-weight: 600; color: #fff;">${escapeHtml(ctr.code)} - ${escapeHtml(ctr.name)}</td>
                    <td>${escapeHtml(col.name)}</td>
                    <td style="color: var(--color-warning); font-weight: 700;">${r.percentage}%</td>
                    <td style="font-size: 0.85rem; color: var(--text-secondary);">${baseTxt}</td>
                    <td style="font-size: 0.85rem; color: var(--text-muted);">${vigencia}</td>
                    <td style="display: flex; gap: 6px;">
                        <button class="btn btn-secondary btn-sm btn-editar-regra" data-id="${escapeHtml(r.id)}">
                            ✏️ Editar
                        </button>
                        <button class="btn btn-danger btn-sm btn-excluir-regra" data-id="${escapeHtml(r.id)}">
                            🗑️ Excluir
                        </button>
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

    
    function extrairMesAnoIso(dataStr) {
        if (!dataStr) return '';
        const s = String(dataStr).trim();
        // Formato ISO: YYYY-MM-DD
        if (/^\d{4}-\d{2}/.test(s)) {
            return s.slice(0, 7);
        }
        // Formato BR: DD/MM/YYYY
        const parts = s.split('/');
        if (parts.length === 3) {
            return `${parts[2]}-${parts[1].padStart(2, '0')}`;
        }
        return '';
    }

    function converterParaDataIso(dataStr) {
        if (!dataStr) return '';
        const s = String(dataStr).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        const parts = s.split('/');
        if (parts.length === 3) {
            return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
        return s;
    }

    function formatarData(dataStr) {
        if (!dataStr) return '-';
        const parts = dataStr.split('-');
        return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : dataStr;
    }

    function abrirModalRegras(regraExistente = null) {
        const selContrato = document.getElementById('regraContrato');
        const selColab = document.getElementById('regraColaborador');
        const inpRegraId = document.getElementById('regraId');
        const inpPercentual = document.getElementById('regraPercentual');
        const selBase = document.getElementById('regraBase');
        const btnExc = document.getElementById('btnExcluirRegraModal');
        const titulo = document.getElementById('modalRegraTitulo');

        selContrato.innerHTML = contratos.map(c => `<option value="${c.id}">${escapeHtml(c.code)} - ${escapeHtml(c.name)}</option>`).join('') || '<option value="">Sem contratos elegíveis</option>';
        selColab.innerHTML = colaboradores.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('') || '<option value="">Sem colaboradores</option>';

        if (regraExistente) {
            if (inpRegraId) inpRegraId.value = regraExistente.id;
            if (titulo) titulo.textContent = 'Editar Regra de Comissão';
            selContrato.value = regraExistente.contract_id;
            selColab.value = regraExistente.collaborator_id;
            if (inpPercentual) inpPercentual.value = regraExistente.percentage;
            if (selBase) selBase.value = regraExistente.basis_override || 'gross_invoiced';
            if (btnExc) btnExc.style.display = 'inline-flex';
        } else {
            if (inpRegraId) inpRegraId.value = '';
            if (titulo) titulo.textContent = 'Regra de Comissão por Contrato';
            document.getElementById('formRegra').reset();
            if (inpPercentual) inpPercentual.value = '5.0';
            if (btnExc) btnExc.style.display = 'none';
        }

        modalRegra.style.display = 'flex';
    }

    window.editarRegra = function(id) {
        const r = regrasContrato.find(reg => reg.id === id);
        if (r) abrirModalRegras(r);
    };

    window.deletarRegra = async function(id) {
        if (!confirm('Deseja excluir esta regra de comissão?')) return;
        try {
            await window.BpoSupabase.request(`contract_commission_rules?id=eq.${id}`, { method: 'DELETE' });
            await carregarDadosComissoes();
            alert('Regra excluída com sucesso.');
        } catch (err) {
            alert('Erro ao excluir regra: ' + err.message);
        }
    };

    window.deletarRegraModal = async function() {
        const id = document.getElementById('regraId')?.value;
        if (!id) return;
        if (!confirm('Deseja excluir esta regra de comissão?')) return;
        try {
            await window.BpoSupabase.request(`contract_commission_rules?id=eq.${id}`, { method: 'DELETE' });
            fecharModais();
            await carregarDadosComissoes();
            alert('Regra excluída com sucesso.');
        } catch (err) {
            alert('Erro ao excluir regra: ' + err.message);
        }
    };

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
        const idExistente = document.getElementById('regraId')?.value;
        const contratoId = document.getElementById('regraContrato').value;
        const colabId = document.getElementById('regraColaborador').value;
        const percentual = parseFloat(document.getElementById('regraPercentual').value);
        const base = document.getElementById('regraBase').value;

        if (!contratoId || !colabId) {
            alert('Selecione o contrato e o colaborador.');
            return;
        }

        try {
            if (idExistente) {
                await window.BpoSupabase.request(`contract_commission_rules?id=eq.${idExistente}`, {
                    method: 'PATCH',
                    body: JSON.stringify({
                        contract_id: contratoId,
                        collaborator_id: colabId,
                        percentage: percentual,
                        basis_override: base
                    })
                });
                fecharModais();
                await carregarDadosComissoes();
                alert('Regra atualizada com sucesso!');
                return;
            }

            await window.BpoSupabase.request('contract_commission_rules', {
                method: 'POST',
                body: JSON.stringify({
                    contract_id: contratoId,
                    collaborator_id: colabId,
                    percentage: percentual,
                    basis_override: base,
                    valid_from: '2000-01-01'
                })
            });

            fecharModais();
            await carregarDadosComissoes();
            alert('Regra vinculada ao contrato com sucesso!');
        } catch (err) {
            alert('Erro ao salvar regra: ' + err.message);
        }
    }

    async function processarApuracaoComissoes() {
        if (!empresaAtiva) return;

        try {
            // 1. Busca TODOS os contratos da empresa para resolução precisa de dados
            let todosContratos = [];
            try {
                todosContratos = await window.BpoSupabase.request(
                    `contracts?company_id=eq.${empresaAtiva.id}`,
                    { method: 'GET' }
                ) || [];
            } catch(e) {}
            const todosContratosMap = new Map();
            todosContratos.forEach(c => todosContratosMap.set(c.id, c));

            // 2. Busca regras vigentes de comissão dos contratos elegíveis
            let regrasComissao = [];
            try {
                const elegiveisIds = (contratos || []).map(c => c.id);
                if (elegiveisIds.length > 0) {
                    regrasComissao = await window.BpoSupabase.request(
                        `contract_commission_rules?contract_id=in.(${elegiveisIds.join(',')})`,
                        { method: 'GET' }
                    ) || [];
                }
            } catch(e) {}

            const regrasPorContrato = new Map();
            (regrasComissao || []).forEach(reg => {
                if (!regrasPorContrato.has(reg.contract_id)) {
                    regrasPorContrato.set(reg.contract_id, []);
                }
                regrasPorContrato.get(reg.contract_id).push(reg);
            });

            // 3. Busca todos os documentos da empresa para vincular baixas e pagamentos
            const docs = await window.BpoSupabase.request(
                `billing_documents?company_id=eq.${empresaAtiva.id}&status=neq.cancelled`,
                { method: 'GET' }
            ) || [];
            const docsMapById = new Map();
            docs.forEach(d => docsMapById.set(d.id, d));

            // 4. Busca recebimentos da tabela receipts
            let receipts = [];
            try {
                receipts = await window.BpoSupabase.request(
                    `receipts?company_id=eq.${empresaAtiva.id}&order=receipt_date.desc`,
                    { method: 'GET' }
                ) || [];
            } catch (rErr) {
                console.warn('Aviso ao consultar receipts:', rErr.message);
            }

            // Compila lista unificada de eventos de recebimento por Regime de Caixa (competência = mês do recebimento)
            // Cada item: { id, contract_id, document_id, receipt_date, baseAmountCents }
            const eventosRecebimento = [];
            const docsProcessadosViaReceipts = new Set();

            (receipts || []).forEach(r => {
                if (!r.receipt_date || extrairMesAnoIso(r.receipt_date) !== competenciaAtiva) return;

                const doc = docsMapById.get(r.document_id) || docsMapById.get(r.external_id) || null;
                const contratoId = r.contract_id || (doc ? doc.contract_id : null);
                if (!contratoId) return;

                const valorCents = window.BpoMoney.toCents(r.gross_amount);
                if (valorCents <= 0n) return;

                if (doc) docsProcessadosViaReceipts.add(doc.id);

                eventosRecebimento.push({
                    origemId: `rec_${r.id}`,
                    contract_id: contratoId,
                    document_id: doc ? doc.id : null,
                    receipt_date: r.receipt_date,
                    baseAmountCents: valorCents
                });
            });

            // Resiliência / Fallback: documentos cujo recebimento foi registrado no faturamento (payment_date, tax_details ou receipt_date)
            // que pertençam à competência ativa e que não tenham sido capturados via receipts
            docs.forEach(d => {
                if (docsProcessadosViaReceipts.has(d.id)) return;
                const td = d.tax_details || (window.BpoFiscalUtils ? window.BpoFiscalUtils.extrairTaxDetails(d) : null) || {};
                const dataRecRaw = td.payment_date || d.payment_date || d.receipt_date || null;
                const dataRecIso = converterParaDataIso(dataRecRaw);

                if (!dataRecRaw || extrairMesAnoIso(dataRecRaw) !== competenciaAtiva) return;
                if (!d.contract_id) return;

                // Se o documento estiver liquidado ou com baixa parcial
                if (d.status === 'paid' || d.status === 'partially_paid' || dataRecRaw) {
                    const valorCents = window.BpoMoney.toCents(d.net_amount || d.gross_amount);
                    if (valorCents > 0n) {
                        eventosRecebimento.push({
                            origemId: `doc_${d.id}`,
                            contract_id: d.contract_id,
                            document_id: d.id,
                            receipt_date: dataRecIso,
                            baseAmountCents: valorCents
                        });
                    }
                }
            });

            if (colaboradores.length === 0) {
                alert('Cadastre colaboradores antes de processar as comissões.');
                return;
            }

            const lotesComissoes = [];

            // 5. Processa cada evento de recebimento no Regime de Caixa
            for (const ev of eventosRecebimento) {
                const contratoId = ev.contract_id;
                const contrato = todosContratosMap.get(contratoId);
                if (!contrato || !contrato.commission_eligible) continue;

                const dataEvento = ev.receipt_date;

                // Busca regras ativas deste contrato específico (com flexibilidade para valid_until se preenchido)
                const regrasDoContrato = (regrasPorContrato.get(contratoId) || []).filter(reg => {
                    const ate = !reg.valid_until || reg.valid_until >= dataEvento;
                    return ate;
                });

                if (regrasDoContrato.length === 0) continue;

                for (const regra of regrasDoContrato) {
                    const colabId = regra.collaborator_id;
                    const percentual = parseFloat(regra.percentage) || 0;
                    const capType = contrato.commission_cap_type || 'none';
                    const capValue = contrato.commission_cap_value || 0;

                    const res = window.BpoCommissionEngine.calcularComissao({
                        baseAmount: ev.baseAmountCents,
                        percentage: percentual,
                        capType,
                        capValue
                    });

                    const chaveIdempotente = `com_${ev.origemId}_${contratoId}_${colabId}`;

                    lotesComissoes.push({
                        company_id: empresaAtiva.id,
                        collaborator_id: colabId,
                        contract_id: contratoId,
                        document_id: ev.document_id,
                        competence_month: competenciaAtiva,
                        event_date: dataEvento,
                        base_amount: window.BpoMoney.toDecimalString(ev.baseAmountCents),
                        percentage: percentual,
                        commission_amount: window.BpoMoney.toDecimalString(res.comissaoCents),
                        status: 'pending',
                        idempotency_key: chaveIdempotente
                    });
                }
            }

            if (lotesComissoes.length === 0) {
                const totalRecebimentosMes = eventosRecebimento.length;
                let detalheMsg = `Nenhum recebimento elegível com regra de comissão ativa foi encontrado para ${competenciaAtiva}.\n\n`;
                detalheMsg += `• Recebimentos detectados em ${competenciaAtiva}: ${totalRecebimentosMes}\n`;
                if (totalRecebimentosMes > 0) {
                    const ctrsComRec = [...new Set(eventosRecebimento.map(e => {
                        const c = todosContratosMap.get(e.contract_id);
                        return c ? `${c.code} (${c.name}) [Elegível: ${c.commission_eligible ? 'SIM' : 'NÃO'}]` : e.contract_id;
                    }))];
                    detalheMsg += `• Contratos dos recebimentos:\n  - ${ctrsComRec.join('\n  - ')}\n\n`;
                    detalheMsg += `Certifique-se de que os contratos estão marcados como 'Elegível para Comissões' e que possuem uma regra cadastrada na seção 'Regras de Comissão por Contrato'.`;
                } else {
                    detalheMsg += `Nenhuma baixa/recebimento foi encontrada com data em ${competenciaAtiva}. Verifique a data de recebimento das notas no módulo de faturamento.`;
                }
                alert(detalheMsg);
                return;
            }

            // Upsert em lote ignorando duplicatas existentes
            await window.BpoSupabase.request('commission_calculations?on_conflict=idempotency_key', {
                method: 'POST',
                prefer: 'resolution=ignore-duplicates,return=representation',
                body: JSON.stringify(lotesComissoes)
            });

            await carregarDadosComissoes();
            alert(`Apuração concluída!\n${lotesComissoes.length} comissão(ões) calculada(s) para ${competenciaAtiva}.`);

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
