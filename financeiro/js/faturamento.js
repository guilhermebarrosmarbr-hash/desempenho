// ==============================================================================
// faturamento.js — Lógica do Módulo 04 (Controle de Faturamento e Recebimentos)
// ==============================================================================

(function() {
    let empresas = [];
    let empresaAtiva = null;
    let competenciaAtiva = '';
    let documentos = [];
    let contratos = [];

    // Elementos DOM
    const selectEmpresa = document.getElementById('selectEmpresa');
    const inputCompetencia = document.getElementById('inputCompetencia');
    const listaDocumentosBody = document.getElementById('listaDocumentosBody');
    const listaContratosBody = document.getElementById('listaContratosBody');

    // Métricas
    const valFaturadoBruto = document.getElementById('valFaturadoBruto');
    const valTotalRecebido = document.getElementById('valTotalRecebido');
    const valAReceber = document.getElementById('valAReceber');
    const valRetencoes = document.getElementById('valRetencoes');

    // Modais
    const modalEmpresa = document.getElementById('modalEmpresa');
    const modalDocumento = document.getElementById('modalDocumento');
    const modalRecebimento = document.getElementById('modalRecebimento');
    const modalContrato = document.getElementById('modalContrato');

    // Inicialização
    window.addEventListener('DOMContentLoaded', async () => {
        // Define competência padrão: ano-mês atual
        const hoje = new Date();
        const ano = hoje.getFullYear();
        const mes = String(hoje.getMonth() + 1).padStart(2, '0');
        competenciaAtiva = `${ano}-${mes}`;
        inputCompetencia.value = competenciaAtiva;

        // Configura inputs de cálculo de líquido em tempo real
        configurarCalculoLiquido();

        // Carrega empresas do Supabase
        await carregarEmpresas();

        // Eventos
        selectEmpresa.addEventListener('change', async (e) => {
            empresaAtiva = empresas.find(emp => emp.id === e.target.value) || null;
            await carregarDadosCompetencia();
        });

        inputCompetencia.addEventListener('change', async (e) => {
            competenciaAtiva = e.target.value;
            await carregarDadosCompetencia();
        });

        document.getElementById('btnNovaEmpresa').addEventListener('click', () => {
            document.getElementById('empresaId').value = '';
            document.getElementById('modalEmpresaTitulo').textContent = 'Cadastrar Nova Empresa';
            document.getElementById('formNovaEmpresa').reset();
            abrirModal(modalEmpresa);
        });

        document.getElementById('btnEditarEmpresa').addEventListener('click', () => {
            if (!empresaAtiva) {
                alert('Selecione uma empresa para editar.');
                return;
            }
            document.getElementById('empresaId').value = empresaAtiva.id;
            document.getElementById('modalEmpresaTitulo').textContent = 'Editar Empresa';
            document.getElementById('empresaNome').value = empresaAtiva.name || '';
            document.getElementById('empresaFantasia').value = empresaAtiva.trade_name || '';
            document.getElementById('empresaCnpj').value = empresaAtiva.document || '';
            document.getElementById('empresaRegime').value = empresaAtiva.tax_regime || 'simples_nacional';
            document.getElementById('btnExcluirEmpresa').style.display = 'inline-flex';
            abrirModal(modalEmpresa);
        });

        document.getElementById('btnNovoDocumento').addEventListener('click', () => {
            if (!empresaAtiva) {
                alert('Selecione ou cadastre uma empresa primeiro.');
                return;
            }
            // Popula dropdown de contratos
            const selContrato = document.getElementById('docContrato');
            selContrato.innerHTML = '<option value="">— Sem vínculo de contrato —</option>';
            contratos.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = `${c.code} — ${c.name}`;
                selContrato.appendChild(opt);
            });
            document.getElementById('formNovoDocumento').reset();
            selContrato.value = '';
            abrirModal(modalDocumento);
        });

        // Novo Contrato
        document.getElementById('btnNovoContrato').addEventListener('click', () => {
            if (!empresaAtiva) { alert('Selecione uma empresa primeiro.'); return; }
            document.getElementById('contratoId').value = '';
            document.getElementById('modalContratoTitulo').textContent = 'Cadastrar Novo Contrato';
            document.getElementById('formContrato').reset();
            document.getElementById('btnExcluirContratoModal').style.display = 'none';
            abrirModal(modalContrato);
        });

        // Excluir Empresa
        document.getElementById('btnExcluirEmpresa').addEventListener('click', async () => {
            const id = document.getElementById('empresaId').value;
            if (!id) return;
            if (!confirm('Tem certeza que deseja excluir esta empresa? Esta ação não pode ser desfeita.')) return;
            try {
                await window.BpoSupabase.request(`companies?id=eq.${id}`, { method: 'DELETE' });
                fecharModais();
                empresaAtiva = null;
                await carregarEmpresas();
                alert('Empresa excluída com sucesso.');
            } catch (err) {
                alert('Erro ao excluir empresa: ' + err.message);
            }
        });

        // Excluir Contrato (dentro do modal)
        document.getElementById('btnExcluirContratoModal').addEventListener('click', async () => {
            const id = document.getElementById('contratoId').value;
            if (!id) return;
            if (!confirm('Tem certeza que deseja excluir este contrato?')) return;
            try {
                await window.BpoSupabase.request(`contracts?id=eq.${id}`, { method: 'DELETE' });
                fecharModais();
                await carregarDadosCompetencia();
                alert('Contrato excluído com sucesso.');
            } catch (err) {
                alert('Erro ao excluir contrato: ' + err.message);
            }
        });

        document.getElementById('formNovaEmpresa').addEventListener('submit', salvarNovaEmpresa);
        document.getElementById('formNovoDocumento').addEventListener('submit', salvarNovoDocumento);
        document.getElementById('formRecebimento').addEventListener('submit', salvarRecebimento);
        document.getElementById('formContrato').addEventListener('submit', salvarContrato);
    });

    window.fecharModais = function() {
        modalEmpresa.style.display = 'none';
        modalDocumento.style.display = 'none';
        modalRecebimento.style.display = 'none';
        if (modalContrato) modalContrato.style.display = 'none';
    };

    function abrirModal(modal) {
        modal.style.display = 'flex';
    }

    // Calcula líquido automaticamente ao digitar bruto e retenções
    function configurarCalculoLiquido() {
        const brutoInp = document.getElementById('docValorBruto');
        const retInp = document.getElementById('docRetencoes');
        const liqInp = document.getElementById('docValorLiquido');

        function atualizar() {
            const brutoCents = window.BpoMoney.toCents(brutoInp.value);
            const retCents = window.BpoMoney.toCents(retInp.value);
            const liqCents = brutoCents > retCents ? brutoCents - retCents : 0n;
            liqInp.value = window.BpoMoney.toDecimalString(liqCents);
        }

        brutoInp.addEventListener('input', atualizar);
        retInp.addEventListener('input', atualizar);
    }

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
                opt.textContent = `${emp.name} (${emp.document || 'Sem CNPJ'})`;
                selectEmpresa.appendChild(opt);
            });

            empresaAtiva = empresas[0];
            selectEmpresa.value = empresaAtiva.id;
            await carregarDadosCompetencia();

        } catch (err) {
            console.error("Erro ao carregar empresas:", err);
            selectEmpresa.innerHTML = '<option value="">Erro ao conectar ao Supabase</option>';
        }
    }

    async function carregarDadosCompetencia() {
        if (!empresaAtiva) return;

        try {
            // Busca documentos de faturamento da empresa na competência
            const queryDocs = `billing_documents?company_id=eq.${empresaAtiva.id}&competence_month=eq.${competenciaAtiva}&order=issue_date.desc`;
            documentos = await window.BpoSupabase.request(queryDocs, { method: 'GET' });

            // Busca clientes cadastrados para join real
            let clientesMap = new Map();
            try {
                const clientes = await window.BpoSupabase.request(`people?company_id=eq.${empresaAtiva.id}`, { method: 'GET' });
                clientes.forEach(p => clientesMap.set(p.id, p.name));
            } catch (e) {}

            // Busca contratos da empresa e anexa o nome real do cliente
            const queryContratos = `contracts?company_id=eq.${empresaAtiva.id}&order=name.asc`;
            const contratosDb = await window.BpoSupabase.request(queryContratos, { method: 'GET' });
            contratos = contratosDb.map(c => ({
                ...c,
                _clientName: (c.client_id && clientesMap.get(c.client_id)) || ''
            }));

            renderizarMetricas();
            renderizarDocumentos();
            renderizarContratos();

        } catch (err) {
            console.error("Erro ao carregar dados da competência:", err);
        }
    }

    function renderizarMetricas() {
        let brutoTotal = 0n;
        let retencoesTotal = 0n;
        let recebidoTotal = 0n;

        // Exclui cancelados das métricas financeiras
        documentos.filter(d => d.status !== 'cancelled').forEach(doc => {
            const bCents = window.BpoMoney.toCents(doc.gross_amount);
            const rCents = window.BpoMoney.toCents(doc.retentions);
            const lCents = window.BpoMoney.toCents(doc.net_amount);

            brutoTotal += bCents;
            retencoesTotal += rCents;

            if (doc.status === 'paid') {
                recebidoTotal += lCents;
            }
        });

        const liqGeral = brutoTotal - retencoesTotal;
        const aReceber = liqGeral > recebidoTotal ? liqGeral - recebidoTotal : 0n;

        valFaturadoBruto.textContent = window.BpoMoney.formatBRL(brutoTotal);
        valRetencoes.textContent = window.BpoMoney.formatBRL(retencoesTotal);
        valTotalRecebido.textContent = window.BpoMoney.formatBRL(recebidoTotal);
        valAReceber.textContent = window.BpoMoney.formatBRL(aReceber);
    }

    function renderizarDocumentos() {
        if (documentos.length === 0) {
            listaDocumentosBody.innerHTML = `
                <tr>
                    <td colspan="9" style="text-align: center; color: var(--text-muted); padding: 32px;">
                        Nenhum documento de faturamento emitido na competência ${escapeHtml(competenciaAtiva)}.
                    </td>
                </tr>
            `;
            return;
        }

        listaDocumentosBody.innerHTML = documentos.map(doc => {
            const statusBadge = getStatusBadge(doc.status);
            const podeReceber = doc.status !== 'paid' && doc.status !== 'cancelled';
            const contrato = contratos.find(c => c.id === doc.contract_id);
            const clientLabel = (contrato && contrato._clientName) 
                ? escapeHtml(contrato._clientName)
                : (contrato ? escapeHtml(contrato.name) : '<span style="color:var(--text-muted);font-size:0.8rem;">Sem cliente vinculado</span>');

            return `
                <tr>
                    <td style="font-weight: 600; color: #fff;">
                        ${escapeHtml(doc.document_number)}
                        <span style="font-size: 0.75rem; color: var(--text-muted); display: block;">${escapeHtml(doc.document_type.toUpperCase())}</span>
                    </td>
                    <td>${clientLabel}</td>
                    <td>${escapeHtml(formatarData(doc.issue_date))}</td>
                    <td>${escapeHtml(formatarData(doc.due_date))}</td>
                    <td>${escapeHtml(window.BpoMoney.formatBRL(doc.gross_amount))}</td>
                    <td style="color: var(--color-danger);">${escapeHtml(window.BpoMoney.formatBRL(doc.retentions))}</td>
                    <td style="font-weight: 700; color: #fff;">${escapeHtml(window.BpoMoney.formatBRL(doc.net_amount))}</td>
                    <td>${statusBadge}</td>
                    <td>
                        ${podeReceber ? `
                            <button class="btn btn-secondary btn-sm btn-dar-baixa" 
                                data-id="${escapeHtml(doc.id)}" 
                                data-numero="${escapeHtml(doc.document_number)}" 
                                data-liquido="${escapeHtml(doc.net_amount)}">
                                Dar Baixa
                            </button>
                        ` : '<span style="color: var(--text-muted); font-size: 0.8rem;">Concluído</span>'}
                    </td>
                </tr>
            `;
        }).join('');

        // Event listener desacoplado sem onclick inline
        listaDocumentosBody.querySelectorAll('.btn-dar-baixa').forEach(btn => {
            btn.addEventListener('click', () => {
                window.abrirModalRecebimento(btn.dataset.id, btn.dataset.numero, btn.dataset.liquido);
            });
        });
    }

    function renderizarContratos() {
        if (contratos.length === 0) {
            listaContratosBody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 24px;">
                        Nenhum contrato cadastrado para ${escapeHtml(empresaAtiva.name)}.
                    </td>
                </tr>
            `;
            return;
        }

        // Renderiza contratos com cliente real via join e 8 colunas exatas
        listaContratosBody.innerHTML = contratos.map(c => {
            const clienteExibicao = c._clientName ? escapeHtml(c._clientName) : '<span style="color:var(--text-muted);font-size:0.85rem;">Não informado</span>';
            const statusBadge = c.status === 'active' 
                ? '<span class="badge badge-success">Ativo</span>' 
                : `<span class="badge badge-warning">${escapeHtml(c.status)}</span>`;

            return `
                <tr>
                    <td style="font-weight: 600; color: #fff;">${escapeHtml(c.code)}</td>
                    <td>${escapeHtml(c.name)}</td>
                    <td>${clienteExibicao}</td>
                    <td>${escapeHtml(window.BpoMoney.formatBRL(c.reference_value))}</td>
                    <td>${escapeHtml(c.billing_frequency)}</td>
                    <td>${c.commission_eligible ? 'Sim' : 'Não'}</td>
                    <td>${statusBadge}</td>
                    <td>
                        <button class="btn btn-primary btn-sm btn-editar-contrato" data-id="${escapeHtml(c.id)}">Editar</button>
                        <button class="btn btn-danger btn-sm btn-excluir-contrato" data-id="${escapeHtml(c.id)}">Excluir</button>
                    </td>
                </tr>
            `;
        }).join('');

        listaContratosBody.querySelectorAll('.btn-editar-contrato').forEach(btn => {
            btn.addEventListener('click', () => window.editarContrato(btn.dataset.id));
        });
        listaContratosBody.querySelectorAll('.btn-excluir-contrato').forEach(btn => {
            btn.addEventListener('click', () => window.deletarContrato(btn.dataset.id));
        });
    }

    function getStatusBadge(status) {
        switch(status) {
            case 'paid': return '<span class="badge badge-success">Liquidado</span>';
            case 'partially_paid': return '<span class="badge badge-warning">Parcial</span>';
            case 'emitted': return '<span class="badge badge-info">Emitido</span>';
            case 'cancelled': return '<span class="badge badge-danger">Cancelado</span>';
            default: return `<span class="badge badge-info">${status}</span>`;
        }
    }

    function formatarData(dataStr) {
        if (!dataStr) return '-';
        const parts = dataStr.split('-');
        if (parts.length === 3) {
            return `${parts[2]}/${parts[1]}/${parts[0]}`;
        }
        return dataStr;
    }

    // Modal de Recebimento
    window.abrirModalRecebimento = function(id, numero, valorLiquido) {
        document.getElementById('recDocId').value = id;
        document.getElementById('recDocIdentificacao').value = `Doc: ${numero} | Valor: ${window.BpoMoney.formatBRL(valorLiquido)}`;
        document.getElementById('recValor').value = window.BpoMoney.toDecimalString(window.BpoMoney.toCents(valorLiquido));
        
        const hoje = new Date().toISOString().split('T')[0];
        document.getElementById('recData').value = hoje;

        abrirModal(modalRecebimento);
    };

    async function salvarNovaEmpresa(e) {
        e.preventDefault();
        const idExistente = document.getElementById('empresaId').value;
        const nome = document.getElementById('empresaNome').value.trim();
        const fantasia = document.getElementById('empresaFantasia').value.trim();
        const cnpj = document.getElementById('empresaCnpj').value.trim();
        const regime = document.getElementById('empresaRegime').value;

        try {
            if (idExistente) {
                // Atualização / Edição da Empresa existente
                const updatePayload = {
                    name: nome,
                    trade_name: fantasia,
                    document: cnpj,
                    tax_regime: regime,
                    updated_at: new Date().toISOString()
                };

                await window.BpoSupabase.request(`companies?id=eq.${idExistente}`, {
                    method: 'PATCH',
                    body: JSON.stringify(updatePayload)
                });

                fecharModais();
                await carregarEmpresas();
                alert('Empresa atualizada com sucesso!');
                return;
            }

            // Inserção de Nova Empresa
            const grupos = await window.BpoSupabase.request('groups?limit=1', { method: 'GET' });
            let groupId = grupos.length > 0 ? grupos[0].id : null;

            if (!groupId) {
                const novoGrupo = await window.BpoSupabase.request('groups', {
                    method: 'POST',
                    body: JSON.stringify({ name: 'Grupo Principal' })
                });
                groupId = novoGrupo[0].id;
            }

            const payload = {
                group_id: groupId,
                name: nome,
                trade_name: fantasia,
                document: cnpj,
                tax_regime: regime,
                active: true
            };

            await window.BpoSupabase.request('companies', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            fecharModais();
            await carregarEmpresas();
            alert('Empresa cadastrada com sucesso!');

        } catch (err) {
            alert('Erro ao salvar empresa: ' + err.message);
        }
    }

    async function salvarNovoDocumento(e) {
        e.preventDefault();
        if (!empresaAtiva) return;

        const tipo = document.getElementById('docTipo').value;
        const numero = document.getElementById('docNumero').value.trim();
        const emissao = document.getElementById('docEmissao').value;
        const vencimento = document.getElementById('docVencimento').value;
        const brutoCents = window.BpoMoney.toCents(document.getElementById('docValorBruto').value);
        const retCents = window.BpoMoney.toCents(document.getElementById('docRetencoes').value);
        const liqCents = brutoCents - retCents;
        const descricao = document.getElementById('docDescricao').value.trim();
        const contratoId = document.getElementById('docContrato').value || null;

        const payload = {
            company_id: empresaAtiva.id,
            competence_month: competenciaAtiva,
            document_type: tipo,
            document_number: numero,
            issue_date: emissao,
            due_date: vencimento,
            gross_amount: window.BpoMoney.toDecimalString(brutoCents),
            retentions: window.BpoMoney.toDecimalString(retCents),
            net_amount: window.BpoMoney.toDecimalString(liqCents),
            description: descricao,
            status: 'emitted',
            contract_id: contratoId
        };

        try {
            await window.BpoSupabase.request('billing_documents', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            fecharModais();
            document.getElementById('formNovoDocumento').reset();
            await carregarDadosCompetencia();
            alert('Documento registrado com sucesso!');

        } catch (err) {
            alert('Erro ao gravar documento: ' + err.message);
        }
    }

    async function salvarRecebimento(e) {
        e.preventDefault();
        const docId = document.getElementById('recDocId').value;
        const dataCredito = document.getElementById('recData').value;
        const valorCents = window.BpoMoney.toCents(document.getElementById('recValor').value);
        const conta = document.getElementById('recConta').value;

        // (a) Validação de valor
        if (valorCents <= 0n) {
            alert('O valor do recebimento deve ser maior que zero.');
            return;
        }

        const doc = documentos.find(d => d.id === docId);
        if (!doc) {
            alert('Documento de faturamento não encontrado.');
            return;
        }

        const docNetCents = window.BpoMoney.toCents(doc.net_amount);
        if (valorCents > docNetCents) {
            alert(`O valor informado (${window.BpoMoney.formatBRL(valorCents)}) não pode ser superior ao valor líquido do documento (${window.BpoMoney.formatBRL(docNetCents)}).`);
            return;
        }

        // (e) Idempotency key determinística
        const idempotencyKey = `rec_${docId}_${dataCredito}_${window.BpoMoney.toDecimalString(valorCents)}`;

        let createdReceiptId = null;
        let createdInstallmentId = null;
        let createdAllocationId = null;

        try {
            // (c) Vincular receipts ao documento via external_id ou notes
            const recPayload = {
                company_id: empresaAtiva.id,
                receipt_date: dataCredito,
                gross_amount: window.BpoMoney.toDecimalString(valorCents),
                account: conta,
                idempotency_key: idempotencyKey,
                external_id: docId,
                notes: `Baixa do documento ${doc.document_number}`
            };

            const recRes = await window.BpoSupabase.request('receipts', {
                method: 'POST',
                body: JSON.stringify(recPayload)
            });
            if (recRes && recRes[0]) {
                createdReceiptId = recRes[0].id;
            }

            // (b) Criar billing_installments
            const isFullPayment = valorCents === docNetCents;
            const instPayload = {
                document_id: docId,
                installment_number: 1,
                due_date: doc.due_date,
                gross_amount: window.BpoMoney.toDecimalString(docNetCents),
                paid_amount: window.BpoMoney.toDecimalString(valorCents),
                status: isFullPayment ? 'paid' : 'partially_paid'
            };

            const instRes = await window.BpoSupabase.request('billing_installments', {
                method: 'POST',
                body: JSON.stringify(instPayload)
            });
            if (instRes && instRes[0]) {
                createdInstallmentId = instRes[0].id;
            }

            // (b) Criar receipt_allocations
            if (createdReceiptId && createdInstallmentId) {
                const allocPayload = {
                    receipt_id: createdReceiptId,
                    installment_id: createdInstallmentId,
                    allocated_principal: window.BpoMoney.toDecimalString(valorCents),
                    allocated_interest: '0.00',
                    allocated_discount: '0.00',
                    allocated_retention: '0.00'
                };
                const allocRes = await window.BpoSupabase.request('receipt_allocations', {
                    method: 'POST',
                    body: JSON.stringify(allocPayload)
                });
                if (allocRes && allocRes[0]) {
                    createdAllocationId = allocRes[0].id;
                }
            }

            // (d) Marcar paid ou partially_paid conforme o valor
            const novoStatus = isFullPayment ? 'paid' : 'partially_paid';
            await window.BpoSupabase.request(`billing_documents?id=eq.${docId}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: novoStatus })
            });

            fecharModais();
            await carregarDadosCompetencia();
            alert(`Recebimento liquidado com sucesso! Documento marcado como: ${novoStatus === 'paid' ? 'Liquidado' : 'Parcial'}`);

        } catch (err) {
            // (f) Rollback manual atômico em caso de falha
            console.error('Falha ao processar baixa financeira, executando rollback manual:', err);
            if (createdAllocationId) {
                try { await window.BpoSupabase.request(`receipt_allocations?id=eq.${createdAllocationId}`, { method: 'DELETE' }); } catch(e){}
            }
            if (createdInstallmentId) {
                try { await window.BpoSupabase.request(`billing_installments?id=eq.${createdInstallmentId}`, { method: 'DELETE' }); } catch(e){}
            }
            if (createdReceiptId) {
                try { await window.BpoSupabase.request(`receipts?id=eq.${createdReceiptId}`, { method: 'DELETE' }); } catch(e){}
            }
            alert('Erro ao liquidar recebimento: ' + err.message);
        }
    }

    // Delete contrato
    window.deletarContrato = async function(contractId) {
        if (!confirm('Tem certeza que deseja excluir este contrato?')) return;
        try {
            await window.BpoSupabase.request(`contracts?id=eq.${contractId}`, { method: 'DELETE' });
            alert('Contrato excluído com sucesso.');
            await carregarDadosCompetencia();
        } catch (err) {
            alert('Erro ao excluir contrato: ' + err.message);
        }
    };

    // Editar contrato — abre modal preenchido
    window.editarContrato = function(contractId) {
        const c = contratos.find(x => x.id === contractId);
        if (!c) return;
        document.getElementById('contratoId').value = c.id;
        document.getElementById('modalContratoTitulo').textContent = 'Editar Contrato';
        document.getElementById('contratoCodigo').value = c.code || '';
        document.getElementById('contratoNome').value = c.name || '';
        document.getElementById('contratoValor').value = window.BpoMoney.toDecimalString(window.BpoMoney.toCents(c.reference_value));
        document.getElementById('contratoPeriodicidade').value = c.billing_frequency || 'monthly';
        document.getElementById('contratoComissao').checked = c.commission_eligible || false;
        document.getElementById('contratoCliente').value = c._clientName || '';
        document.getElementById('contratoInicio').value = c.start_date || '';
        document.getElementById('btnExcluirContratoModal').style.display = 'inline-flex';
        abrirModal(modalContrato);
    };

    async function salvarContrato(e) {
        e.preventDefault();
        if (!empresaAtiva) return;
        const idExistente = document.getElementById('contratoId').value;
        const codigo = document.getElementById('contratoCodigo').value.trim();
        const nome = document.getElementById('contratoNome').value.trim();
        const valorCents = window.BpoMoney.toCents(document.getElementById('contratoValor').value);
        const periodicidade = document.getElementById('contratoPeriodicidade').value;
        const comissao = document.getElementById('contratoComissao').checked;
        const clienteNome = document.getElementById('contratoCliente').value.trim();
        const startDate = document.getElementById('contratoInicio').value || null;

        try {
            // Resolve client_id: busca ou cria pessoa com o nome informado
            let clientId = null;
            if (clienteNome) {
                const pessoasExistentes = await window.BpoSupabase.request(
                    `people?name=eq.${encodeURIComponent(clienteNome)}&company_id=eq.${empresaAtiva.id}&limit=1`,
                    { method: 'GET' }
                );
                if (pessoasExistentes.length > 0) {
                    clientId = pessoasExistentes[0].id;
                } else {
                    const novaPessoa = await window.BpoSupabase.request('people', {
                        method: 'POST',
                        body: JSON.stringify({
                            company_id: empresaAtiva.id,
                            name: clienteNome,
                            person_type: 'client'
                        })
                    });
                    clientId = novaPessoa[0].id;
                }
            }

            const payload = {
                company_id: empresaAtiva.id,
                code: codigo,
                name: nome,
                reference_value: window.BpoMoney.toDecimalString(valorCents),
                billing_frequency: periodicidade,
                commission_eligible: comissao,
                ...(clientId && { client_id: clientId }),
                ...(startDate && { start_date: startDate })
            };

            if (idExistente) {
                // Ao editar, NÃO redefine o status (mantém o status atual do contrato)
                await window.BpoSupabase.request(`contracts?id=eq.${idExistente}`, {
                    method: 'PATCH',
                    body: JSON.stringify(payload)
                });
                fecharModais();
                await carregarDadosCompetencia();
                alert('Contrato atualizado com sucesso!');
            } else {
                await window.BpoSupabase.request('contracts', {
                    method: 'POST',
                    body: JSON.stringify({ ...payload, status: 'active' })
                });
                fecharModais();
                await carregarDadosCompetencia();
                alert('Contrato cadastrado com sucesso!');
            }
        } catch (err) {
            alert('Erro ao salvar contrato: ' + err.message);
        }
    }
})();
