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
            abrirModal(modalEmpresa);
        });

        document.getElementById('btnNovoDocumento').addEventListener('click', () => {
            if (!empresaAtiva) {
                alert('Selecione ou cadastre uma empresa primeiro.');
                return;
            }
            abrirModal(modalDocumento);
        });

        document.getElementById('formNovaEmpresa').addEventListener('submit', salvarNovaEmpresa);
        document.getElementById('formNovoDocumento').addEventListener('submit', salvarNovoDocumento);
        document.getElementById('formRecebimento').addEventListener('submit', salvarRecebimento);
    });

    window.fecharModais = function() {
        modalEmpresa.style.display = 'none';
        modalDocumento.style.display = 'none';
        modalRecebimento.style.display = 'none';
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

            // Busca contratos ativos da empresa
            const queryContratos = `contracts?company_id=eq.${empresaAtiva.id}&status=eq.active&order=name.asc`;
            contratos = await window.BpoSupabase.request(queryContratos, { method: 'GET' });

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

        documentos.forEach(doc => {
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
                        Nenhum documento de faturamento emitido na competência ${competenciaAtiva}.
                    </td>
                </tr>
            `;
            return;
        }

        listaDocumentosBody.innerHTML = documentos.map(doc => {
            const statusBadge = getStatusBadge(doc.status);
            const podeReceber = doc.status !== 'paid' && doc.status !== 'cancelled';

            return `
                <tr>
                    <td style="font-weight: 600; color: #fff;">
                        ${doc.document_number}
                        <span style="font-size: 0.75rem; color: var(--text-muted); display: block;">${doc.document_type.toUpperCase()}</span>
                    </td>
                    <td>Cliente Padrão / PMOC</td>
                    <td>${formatarData(doc.issue_date)}</td>
                    <td>${formatarData(doc.due_date)}</td>
                    <td>${window.BpoMoney.formatBRL(doc.gross_amount)}</td>
                    <td style="color: var(--color-danger);">${window.BpoMoney.formatBRL(doc.retentions)}</td>
                    <td style="font-weight: 700; color: #fff;">${window.BpoMoney.formatBRL(doc.net_amount)}</td>
                    <td>${statusBadge}</td>
                    <td>
                        ${podeReceber ? `
                            <button class="btn btn-secondary btn-sm" onclick="window.abrirModalRecebimento('${doc.id}', '${doc.document_number}', '${doc.net_amount}')">
                                Dar Baixa
                            </button>
                        ` : '<span style="color: var(--text-muted); font-size: 0.8rem;">Concluído</span>'}
                    </td>
                </tr>
            `;
        }).join('');
    }

    function renderizarContratos() {
        if (contratos.length === 0) {
            listaContratosBody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">
                        Nenhum contrato ativo cadastrado para ${empresaAtiva.name}.
                    </td>
                </tr>
            `;
            return;
        }

        listaContratosBody.innerHTML = contratos.map(c => `
            <tr>
                <td style="font-weight: 600; color: #fff;">${c.code}</td>
                <td>${c.name}</td>
                <td>Cliente Geral</td>
                <td>${window.BpoMoney.formatBRL(c.reference_value)}</td>
                <td>${c.billing_frequency}</td>
                <td>${c.commission_eligible ? 'Sim' : 'Não'}</td>
                <td><span class="badge badge-success">Ativo</span></td>
            </tr>
        `).join('');
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
        const nome = document.getElementById('empresaNome').value.trim();
        const fantasia = document.getElementById('empresaFantasia').value.trim();
        const cnpj = document.getElementById('empresaCnpj').value.trim();
        const regime = document.getElementById('empresaRegime').value;

        try {
            // Obter id do grupo default
            const grupos = await window.BpoSupabase.request('groups?limit=1', { method: 'GET' });
            let groupId = grupos.length > 0 ? grupos[0].id : null;

            if (!groupId) {
                // Cria grupo se não existir
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
            alert('Erro ao cadastrar empresa: ' + err.message);
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
            status: 'emitted'
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

        try {
            // 1. Registra recebimento
            const recPayload = {
                company_id: empresaAtiva.id,
                receipt_date: dataCredito,
                gross_amount: window.BpoMoney.toDecimalString(valorCents),
                account: conta,
                idempotency_key: `rec_${docId}_${Date.now()}`,
                notes: 'Baixa direta via Módulo 04'
            };

            await window.BpoSupabase.request('receipts', {
                method: 'POST',
                body: JSON.stringify(recPayload)
            });

            // 2. Atualiza status do documento para 'paid'
            await window.BpoSupabase.request(`billing_documents?id=eq.${docId}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'paid' })
            });

            fecharModais();
            await carregarDadosCompetencia();
            alert('Recebimento liquidado com sucesso!');

        } catch (err) {
            alert('Erro ao liquidar recebimento: ' + err.message);
        }
    }
})();
