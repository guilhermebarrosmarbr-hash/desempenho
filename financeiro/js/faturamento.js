// ==============================================================================
// faturamento.js — Lógica do Módulo 04 (Controle de Faturamento e Recebimentos)
// Atualizado com suporte a Visão Consolidada Inicial, Filtros Multi-empresa,
// Painel de Impostos/Retenções e Prévia em Tempo Real pelo Motor Puro.
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
    let empresaAtivaId = 'all'; // Default: "Todas as empresas"
    let competenciaAtiva = '';
    let contratoFiltro = '';
    let situacaoFiltro = '';
    let ordenacaoColuna = '';
    let ordenacaoDirecao = 'asc'; // 'asc' ou 'desc'
    let documentos = [];
    let contratos = [];
    let companiesMap = new Map();

    // Elementos DOM
    const selectEmpresa = document.getElementById('selectEmpresa');
    const inputCompetencia = document.getElementById('inputCompetencia');
    const selectFiltroContrato = document.getElementById('selectFiltroContrato');
    const selectFiltroSituacao = document.getElementById('selectFiltroSituacao');
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

    // Controle de concorrência / debounce para prévia de impostos
    let debounceTimerPrevia = null;
    let requestIdPrevia = 0;

    // Inicialização
    window.addEventListener('DOMContentLoaded', async () => {
        // Define competência padrão: ano-mês atual
        const hoje = new Date();
        const ano = hoje.getFullYear();
        const mes = String(hoje.getMonth() + 1).padStart(2, '0');
        competenciaAtiva = `${ano}-${mes}`;
        inputCompetencia.value = competenciaAtiva;

        // Configura inputs do formulário de lançamento para prévia em tempo real
        configurarPainelPreviaImpostos();

        // Carrega empresas do Supabase
        await carregarEmpresas();

        // Eventos dos Filtros Principais
        selectEmpresa.addEventListener('change', async (e) => {
            empresaAtivaId = e.target.value || 'all';
            const btnEditar = document.getElementById('btnEditarEmpresa');
            if (btnEditar) btnEditar.style.display = empresaAtivaId !== 'all' ? 'inline-flex' : 'none';
            atualizarDropdownFiltroContratos();
            await carregarDadosCompetencia();
        });

        inputCompetencia.addEventListener('change', async (e) => {
            competenciaAtiva = e.target.value;
            await carregarDadosCompetencia();
        });

        if (selectFiltroContrato) {
            selectFiltroContrato.addEventListener('change', (e) => {
                contratoFiltro = e.target.value;
                renderizarDocumentos();
                renderizarMetricas();
            });
        }

        if (selectFiltroSituacao) {
            selectFiltroSituacao.addEventListener('change', (e) => {
                situacaoFiltro = e.target.value;
                renderizarDocumentos();
                renderizarMetricas();
            });
        }

        // Ordenação por colunas da tabela de faturamento (Ponto 02)
        document.querySelectorAll('#tabelaDocumentos .th-sort').forEach(btn => {
            btn.addEventListener('click', () => {
                const col = btn.dataset.col;
                if (!col) return;

                if (ordenacaoColuna === col) {
                    ordenacaoDirecao = ordenacaoDirecao === 'asc' ? 'desc' : 'asc';
                } else {
                    ordenacaoColuna = col;
                    ordenacaoDirecao = 'asc';
                }

                // Atualiza estado visual de todos os botões de cabeçalho
                document.querySelectorAll('#tabelaDocumentos .th-sort').forEach(b => {
                    if (b.dataset.col === ordenacaoColuna) {
                        b.classList.add('ativo');
                        b.setAttribute('data-dir', ordenacaoDirecao);
                    } else {
                        b.classList.remove('ativo');
                        b.removeAttribute('data-dir');
                    }
                });

                renderizarDocumentos();
            });
        });

        // Botões de Ação
        document.getElementById('btnNovaEmpresa').addEventListener('click', () => {
            document.getElementById('empresaId').value = '';
            document.getElementById('modalEmpresaTitulo').textContent = 'Cadastrar Nova Empresa';
            document.getElementById('formNovaEmpresa').reset();
            document.getElementById('btnExcluirEmpresa').style.display = 'none';
            abrirModal(modalEmpresa);
        });

        document.getElementById('btnEditarEmpresa').addEventListener('click', () => {
            if (empresaAtivaId === 'all') {
                alert('Selecione uma empresa específica no topo para editar seus dados.');
                return;
            }
            const emp = companiesMap.get(empresaAtivaId);
            if (!emp) return;

            document.getElementById('empresaId').value = emp.id;
            document.getElementById('modalEmpresaTitulo').textContent = 'Editar Empresa';
            document.getElementById('empresaNome').value = emp.name || '';
            document.getElementById('empresaFantasia').value = emp.trade_name || '';
            document.getElementById('empresaCnpj').value = emp.document || '';
            document.getElementById('empresaRegime').value = emp.tax_regime || 'simples_nacional';
            document.getElementById('btnExcluirEmpresa').style.display = 'inline-flex';
            abrirModal(modalEmpresa);
        });

        document.getElementById('btnNovoDocumento').addEventListener('click', () => {
            prepararModalNovoDocumento();
        });

        // Alternância PF / PJ no formulário de Contrato
        const selTipoCliente = document.getElementById('contratoTipoCliente');
        const lblDocumento = document.getElementById('lblContratoDocumento');
        const inpDocumento = document.getElementById('contratoDocumento');
        if (selTipoCliente && lblDocumento && inpDocumento) {
            selTipoCliente.addEventListener('change', () => {
                if (selTipoCliente.value === 'PF') {
                    lblDocumento.textContent = 'CPF do Cliente';
                    inpDocumento.placeholder = '000.000.000-00';
                } else {
                    lblDocumento.textContent = 'CNPJ do Cliente';
                    inpDocumento.placeholder = '00.000.000/0000-00';
                }
            });
        }

        // Novo Contrato
        document.getElementById('btnNovoContrato').addEventListener('click', () => {
            if (empresas.length === 0) { alert('Cadastre ao menos uma empresa primeiro.'); return; }

            document.getElementById('contratoId').value = '';
            document.getElementById('modalContratoTitulo').textContent = 'Cadastrar Novo Contrato';
            document.getElementById('formContrato').reset();

            // Popula seletor de empresa do contrato
            const selContratoEmp = document.getElementById('contratoEmpresaId');
            if (selContratoEmp) {
                selContratoEmp.innerHTML = '<option value="">Selecione a empresa...</option>';
                empresas.forEach(emp => {
                    const opt = document.createElement('option');
                    opt.value = emp.id;
                    opt.textContent = `${emp.name} (${emp.trade_name || ''})`;
                    selContratoEmp.appendChild(opt);
                });
                if (empresaAtivaId !== 'all') {
                    selContratoEmp.value = empresaAtivaId;
                } else if (empresas.length > 0) {
                    selContratoEmp.value = empresas[0].id;
                }
            }

            const inpInicio = document.getElementById('contratoInicio');
            if (inpInicio) inpInicio.value = new Date().toISOString().slice(0, 10);

            document.getElementById('contratoTipo').value = 'B2B';
            document.getElementById('contratoTipoCliente').value = 'PJ';
            if (lblDocumento) lblDocumento.textContent = 'CNPJ do Cliente';
            if (inpDocumento) inpDocumento.placeholder = '00.000.000/0000-00';
            document.getElementById('btnExcluirContratoModal').style.display = 'none';
            abrirModal(modalContrato);
        });

        // Botões de exclusão nos modais
        const btnExcluirDocModal = document.getElementById('btnExcluirDocumentoModal');
        if (btnExcluirDocModal) {
            btnExcluirDocModal.addEventListener('click', () => {
                const docId = document.getElementById('docId').value;
                if (docId) excluirDocumento(docId);
            });
        }

        const btnExcluirCtrModal = document.getElementById('btnExcluirContratoModal');
        if (btnExcluirCtrModal) {
            btnExcluirCtrModal.addEventListener('click', () => {
                const ctrId = document.getElementById('contratoId').value;
                if (ctrId) excluirContrato(ctrId);
            });
        }

        const btnExcluirEmpModal = document.getElementById('btnExcluirEmpresa');
        if (btnExcluirEmpModal) {
            btnExcluirEmpModal.addEventListener('click', async () => {
                const empId = document.getElementById('empresaId').value;
                if (!empId) return;
                const emp = companiesMap.get(empId);
                if (!confirm(`Deseja realmente excluir a empresa "${emp ? emp.name : empId}"?`)) return;
                try {
                    await window.BpoSupabase.request(`companies?id=eq.${empId}`, { method: 'DELETE' });
                    fecharModais();
                    await carregarEmpresas();
                    alert('Empresa excluída com sucesso!');
                } catch (err) {
                    alert('Erro ao excluir empresa: ' + err.message);
                }
            });
        }

        // Form submits (salvamento normal do operador, sem chamadas automáticas)
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

    async function carregarEmpresas() {
        try {
            empresas = await window.BpoSupabase.request('companies?order=name.asc', { method: 'GET' });
            companiesMap.clear();
            empresas.forEach(emp => companiesMap.set(emp.id, emp));
            
            selectEmpresa.innerHTML = '';
            
            // Requisito 2: "O filtro inicial deve ser Empresa: Todas as empresas. Não abra automaticamente Mar Brasil, DZM ou Ybox."
            const optTodas = document.createElement('option');
            optTodas.value = 'all';
            optTodas.textContent = 'Todas as Empresas (Consolidado)';
            selectEmpresa.appendChild(optTodas);

            empresas.forEach(emp => {
                const opt = document.createElement('option');
                opt.value = emp.id;
                opt.textContent = `${emp.name} (${emp.document || 'Sem CNPJ'})`;
                selectEmpresa.appendChild(opt);
            });

            // Mantém "all" como padrão inicial consolidado
            empresaAtivaId = 'all';
            selectEmpresa.value = 'all';

            await carregarDadosCompetencia();

        } catch (err) {
            console.error("Erro ao carregar empresas:", err);
            const msgErro = err && err.message ? err.message : 'Falha na conexão';
            selectEmpresa.innerHTML = `<option value="all">Erro Supabase: ${escapeHtml(msgErro)}</option>`;
        }
    }

    async function carregarDadosCompetencia() {
        try {
            // Busca documentos de faturamento conforme filtro de empresa (all ou específica)
            let queryDocs = `billing_documents?competence_month=eq.${competenciaAtiva}&order=issue_date.desc`;
            if (empresaAtivaId !== 'all') {
                queryDocs += `&company_id=eq.${empresaAtivaId}`;
            }
            const docsDb = await window.BpoSupabase.request(queryDocs, { method: 'GET' });

            // Busca recebimentos da competência/empresa para mapear pagamentos (Suporte a Múltiplas Baixas Parciais - Item 03)
            let receiptsByDocMap = new Map();
            try {
                let queryRecs = `receipts?order=receipt_date.asc`;
                if (empresaAtivaId !== 'all') {
                    queryRecs += `&company_id=eq.${empresaAtivaId}`;
                }
                const recs = await window.BpoSupabase.request(queryRecs, { method: 'GET' });
                recs.forEach(r => {
                    if (r.external_id) {
                        if (!receiptsByDocMap.has(r.external_id)) {
                            receiptsByDocMap.set(r.external_id, []);
                        }
                        receiptsByDocMap.get(r.external_id).push(r);
                    }
                });
            } catch (e) {
                console.warn('Aviso ao consultar receipts:', e);
            }

            documentos = docsDb.map(d => {
                const taxDetails = window.BpoFiscalUtils.extrairTaxDetails(d);
                const docRecs = receiptsByDocMap.get(d.id) || [];
                
                // Soma todos os pagamentos já baixados para este documento
                const totalRecebidoCents = docRecs.reduce((acc, r) => acc + window.BpoMoney.toCents(r.gross_amount), 0n);
                const liqCents = window.BpoMoney.toCents(d.net_amount);

                let statusEfetivo = d.status;
                let ultDataRecebimento = null;

                if (docRecs.length > 0) {
                    ultDataRecebimento = docRecs[docRecs.length - 1].receipt_date;
                } else if (taxDetails && taxDetails.payment_date) {
                    ultDataRecebimento = taxDetails.payment_date;
                } else if (d.payment_date) {
                    ultDataRecebimento = d.payment_date;
                }

                if (d.status !== 'cancelled') {
                    if (totalRecebidoCents >= liqCents && liqCents > 0n) {
                        statusEfetivo = 'paid';
                    } else if (totalRecebidoCents > 0n) {
                        statusEfetivo = 'partially_paid';
                    } else if (ultDataRecebimento && d.status === 'paid') {
                        statusEfetivo = 'paid';
                    } else {
                        statusEfetivo = 'emitted';
                    }
                }

                const saldoRestanteCents = liqCents > totalRecebidoCents ? (liqCents - totalRecebidoCents) : 0n;

                const extrasCents = (taxDetails && taxDetails.extras) ? window.BpoMoney.toCents(taxDetails.extras) : 0n;
                const discountsCents = d.discounts ? window.BpoMoney.toCents(d.discounts) : ((taxDetails && taxDetails.desconto) ? window.BpoMoney.toCents(taxDetails.desconto) : 0n);

                return {
                    ...d,
                    tax_details: taxDetails,
                    _descricaoLimpa: window.BpoFiscalUtils.limparDescricao(d.description),
                    payment_date: ultDataRecebimento,
                    status: statusEfetivo,
                    _receipts: docRecs,
                    _totalRecebidoCents: totalRecebidoCents,
                    _saldoRestanteCents: saldoRestanteCents,
                    _extrasCents: extrasCents,
                    _discountsCents: discountsCents
                };
            });

            // Busca clientes cadastrados
            let clientesMap = new Map();
            try {
                let queryCli = 'people';
                if (empresaAtivaId !== 'all') queryCli += `?company_id=eq.${empresaAtivaId}`;
                const clientes = await window.BpoSupabase.request(queryCli, { method: 'GET' });
                clientes.forEach(p => clientesMap.set(p.id, p));
            } catch (e) {}

            // Busca contratos
            let queryContratos = 'contracts?order=name.asc';
            if (empresaAtivaId !== 'all') {
                queryContratos += `&company_id=eq.${empresaAtivaId}`;
            }
            const contratosDb = await window.BpoSupabase.request(queryContratos, { method: 'GET' });
            contratos = contratosDb.map(c => {
                const cli = c.client_id ? clientesMap.get(c.client_id) : null;
                return {
                    ...c,
                    _clientName: cli ? cli.name : '',
                    _clientDoc: cli ? (cli.cpf || cli.cnpj || cli.document || '') : '',
                    _clientType: cli ? (cli.client_category || (cli.document_type === 'CPF' ? 'PF' : 'PJ')) : 'PJ'
                };
            });

            atualizarDropdownFiltroContratos();
            renderizarMetricas();
            renderizarDocumentos();
            renderizarContratos();

        } catch (err) {
            console.error("Erro ao carregar dados da competência:", err);
        }
    }

    function atualizarDropdownFiltroContratos() {
        if (!selectFiltroContrato) return;
        const currentVal = selectFiltroContrato.value;
        selectFiltroContrato.innerHTML = '<option value="">Todos os Contratos</option>';

        contratos.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            const emp = companiesMap.get(c.company_id);
            const prefix = (empresaAtivaId === 'all' && emp) ? `[${emp.trade_name || emp.name}] ` : '';
            opt.textContent = `${prefix}${c.code} — ${c.name}`;
            selectFiltroContrato.appendChild(opt);
        });

        if (contratos.some(c => c.id === currentVal)) {
            selectFiltroContrato.value = currentVal;
            contratoFiltro = currentVal;
        } else {
            selectFiltroContrato.value = '';
            contratoFiltro = '';
        }
    }

    function getDocumentosFiltrados() {
        let lista = documentos.filter(doc => {
            if (contratoFiltro && doc.contract_id !== contratoFiltro) return false;
            if (situacaoFiltro && doc.status !== situacaoFiltro) return false;
            return true;
        });

        if (ordenacaoColuna) {
            lista.sort((a, b) => {
                let valA = '';
                let valB = '';

                switch (ordenacaoColuna) {
                    case 'empresa': {
                        const empA = companiesMap.get(a.company_id);
                        const empB = companiesMap.get(b.company_id);
                        valA = (empA?.trade_name || empA?.name || '').toLowerCase();
                        valB = (empB?.trade_name || empB?.name || '').toLowerCase();
                        break;
                    }
                    case 'numero': {
                        valA = (a.document_number || '').toLowerCase();
                        valB = (b.document_number || '').toLowerCase();
                        break;
                    }
                    case 'cliente': {
                        const cA = contratos.find(c => c.id === a.contract_id);
                        const cB = contratos.find(c => c.id === b.contract_id);
                        valA = (cA?._clientName || cA?.name || '').toLowerCase();
                        valB = (cB?._clientName || cB?.name || '').toLowerCase();
                        break;
                    }
                    case 'emissao': {
                        valA = a.issue_date || '';
                        valB = b.issue_date || '';
                        break;
                    }
                    case 'vencimento': {
                        valA = a.due_date || '';
                        valB = b.due_date || '';
                        break;
                    }
                    case 'recebimento': {
                        valA = a.payment_date || '';
                        valB = b.payment_date || '';
                        break;
                    }
                    case 'bruto': {
                        const cA = window.BpoMoney.toCents(a.gross_amount);
                        const cB = window.BpoMoney.toCents(b.gross_amount);
                        return ordenacaoDirecao === 'asc' ? (cA < cB ? -1 : (cA > cB ? 1 : 0)) : (cA > cB ? -1 : (cA < cB ? 1 : 0));
                    }
                    case 'retencoes': {
                        const cA = window.BpoMoney.toCents(a.retentions);
                        const cB = window.BpoMoney.toCents(b.retentions);
                        return ordenacaoDirecao === 'asc' ? (cA < cB ? -1 : (cA > cB ? 1 : 0)) : (cA > cB ? -1 : (cA < cB ? 1 : 0));
                    }
                    case 'liquido': {
                        const cA = window.BpoMoney.toCents(a.net_amount);
                        const cB = window.BpoMoney.toCents(b.net_amount);
                        return ordenacaoDirecao === 'asc' ? (cA < cB ? -1 : (cA > cB ? 1 : 0)) : (cA > cB ? -1 : (cA < cB ? 1 : 0));
                    }
                    case 'status': {
                        valA = (a.status || '').toLowerCase();
                        valB = (b.status || '').toLowerCase();
                        break;
                    }
                    default:
                        return 0;
                }

                if (valA < valB) return ordenacaoDirecao === 'asc' ? -1 : 1;
                if (valA > valB) return ordenacaoDirecao === 'asc' ? 1 : -1;
                return 0;
            });
        }

        return lista;
    }

    function renderizarMetricas() {
        let faturamentoTotal = 0n;
        let retencoesTotal = 0n;
        let recebidoTotal = 0n;

        // Exclui cancelados das métricas financeiras
        const docsAtivos = getDocumentosFiltrados().filter(d => d.status !== 'cancelled');
        docsAtivos.forEach(doc => {
            const bCents = window.BpoMoney.toCents(doc.gross_amount);
            const rCents = window.BpoMoney.toCents(doc.retentions);
            const lCents = window.BpoMoney.toCents(doc.net_amount);
            const dCents = doc._discountsCents !== undefined ? doc._discountsCents : (doc.discounts ? window.BpoMoney.toCents(doc.discounts) : 0n);
            const eCents = doc._extrasCents !== undefined ? doc._extrasCents : 0n;

            // Faturamento Total = Valor Base - Descontos + Extras (não considera multas nem juros)
            const fatDoc = (bCents + eCents) > dCents ? (bCents + eCents - dCents) : 0n;
            faturamentoTotal += fatDoc;
            retencoesTotal += rCents;

            if (doc._totalRecebidoCents !== undefined && doc._totalRecebidoCents > 0n) {
                recebidoTotal += doc._totalRecebidoCents;
            } else if (doc.status === 'paid' || doc.payment_date) {
                recebidoTotal += lCents;
            }
        });

        const liqGeral = faturamentoTotal > retencoesTotal ? (faturamentoTotal - retencoesTotal) : 0n;
        const aReceber = liqGeral > recebidoTotal ? liqGeral - recebidoTotal : 0n;

        valFaturadoBruto.textContent = window.BpoMoney.formatBRL(faturamentoTotal);
        valRetencoes.textContent = window.BpoMoney.formatBRL(retencoesTotal);
        valTotalRecebido.textContent = window.BpoMoney.formatBRL(recebidoTotal);
        valAReceber.textContent = window.BpoMoney.formatBRL(aReceber);
    }

    function renderizarDocumentos() {
        const docsExibicao = getDocumentosFiltrados();

        const contador = document.getElementById('resumoContagemDocs');
        if (contador) contador.textContent = `Exibindo ${docsExibicao.length} lançamento${docsExibicao.length !== 1 ? 's' : ''}`;

        if (docsExibicao.length === 0) {
            listaDocumentosBody.innerHTML = `
                <tr>
                    <td colspan="12" style="text-align: center; color: var(--text-muted); padding: 32px;">
                        Nenhum documento de faturamento encontrado para os filtros selecionados na competência ${escapeHtml(competenciaAtiva)}.
                    </td>
                </tr>
            `;
            return;
        }

        listaDocumentosBody.innerHTML = docsExibicao.map(doc => {
            const statusBadge = getStatusBadge(doc.status, doc._totalRecebidoCents, doc._saldoRestanteCents);
            const podeReceber = doc.status !== 'paid' && doc.status !== 'cancelled';
            const contrato = contratos.find(c => c.id === doc.contract_id);
            const emp = companiesMap.get(doc.company_id);
            const empBadge = emp ? `<span class="badge badge-primary" style="font-size:0.75rem;">${escapeHtml(emp.trade_name || emp.name)}</span>` : '<span style="color:var(--text-muted);">-</span>';

            const clientLabel = (contrato && contrato._clientName) 
                ? escapeHtml(contrato._clientName)
                : (contrato ? escapeHtml(contrato.name) : '<span style="color:var(--text-muted);font-size:0.8rem;">Sem cliente vinculado</span>');

            const contratoLabel = contrato ? `<span style="font-size:0.8rem; color:var(--text-secondary); display:block;">CTR: ${escapeHtml(contrato.code)}</span>` : '';

            let recebimentoLabel = '<span style="color: var(--text-muted); font-size: 0.8rem;">Pendente</span>';
            if (doc.status === 'paid') {
                recebimentoLabel = `<span style="color: var(--color-success); font-weight: 500;">${escapeHtml(formatarData(doc.payment_date))}</span>`;
            } else if (doc.status === 'partially_paid') {
                recebimentoLabel = `
                    <span style="color: #f59e0b; font-weight: 500;">${escapeHtml(formatarData(doc.payment_date))}</span>
                    <span style="font-size: 0.7rem; color: #f59e0b; display: block;">Pago: ${escapeHtml(window.BpoMoney.formatBRL(doc._totalRecebidoCents))}</span>
                `;
            }

            // Impostos atribuídos (campo tax_details ou estimativa gerencial)
            let impostosAtrib = '<span style="color:var(--text-muted);font-size:0.8rem;">—</span>';
            if (doc.tax_details && doc.tax_details.total_tax) {
                impostosAtrib = window.BpoMoney.formatBRL(doc.tax_details.total_tax);
            } else if (doc.tax_details && window.BpoTaxEngine && emp) {
                const bNum = Number(window.BpoMoney.toCents(doc.gross_amount)) / 100;
                const p = window.BpoTaxEngine.calcularPreviaNota({
                    gross_amount: bNum,
                    company_tax_regime: emp.tax_regime,
                    item_type: doc.tax_details.item_type || 'servico',
                    temIrrf: !!doc.tax_details.has_irrf,
                    aliquotaIrrf: doc.tax_details.irrf_aliq,
                    temInss: !!doc.tax_details.has_inss,
                    aliquotaInss: doc.tax_details.inss_aliq,
                    issRetido: !!doc.tax_details.iss_retained,
                    aliquotaIss: doc.tax_details.iss_aliq || 5.0
                });
                if (p) {
                    const tot = (p.impostosMensais ? ((p.impostosMensais.pis?.valor || 0) + (p.impostosMensais.cofins?.valor || 0) + (p.impostosMensais.iss?.valor || 0)) : (p.impostosEconomicos?.valorTotal || 0)) + (p.provisaoTrimestral ? ((p.provisaoTrimestral.irpjProvisao || 0) + (p.provisaoTrimestral.csllProvisao || 0)) : 0);
                    impostosAtrib = window.BpoMoney.formatBRL(BigInt(Math.round(tot * 100)));
                }
            }

            return `
                <tr>
                    <td>${empBadge}</td>
                    <td style="font-weight: 600; color: #fff;">
                        ${escapeHtml(doc.document_number)}
                        <span style="font-size: 0.72rem; color: var(--text-muted); display: block;">${escapeHtml((doc.document_type || 'nfse').toUpperCase())}</span>
                    </td>
                    <td>
                        ${clientLabel}
                        ${contratoLabel}
                    </td>
                    <td>${escapeHtml(formatarData(doc.issue_date))}</td>
                    <td>${escapeHtml(formatarData(doc.due_date))}</td>
                    <td>${recebimentoLabel}</td>
                    <td>${escapeHtml(window.BpoMoney.formatBRL(doc.gross_amount))}</td>
                    <td style="color: #f59e0b;">${impostosAtrib}</td>
                    <td style="color: var(--color-danger);">${escapeHtml(window.BpoMoney.formatBRL(doc.retentions))}</td>
                    <td style="font-weight: 700; color: #fff;">${escapeHtml(window.BpoMoney.formatBRL(doc.net_amount))}</td>
                    <td>${statusBadge}</td>
                    <td style="white-space: nowrap;">
                        <button class="btn btn-primary btn-sm btn-editar-documento" data-id="${escapeHtml(doc.id)}">
                            Editar
                        </button>
                        ${podeReceber ? `
                            <button class="btn btn-secondary btn-sm btn-dar-baixa" 
                                data-id="${escapeHtml(doc.id)}" 
                                data-numero="${escapeHtml(doc.document_number)}" 
                                data-liquido="${escapeHtml(doc.net_amount)}"
                                title="${doc.status === 'partially_paid' ? 'Baixar restante ou outra parcela' : 'Registrar recebimento'}">
                                ${doc.status === 'partially_paid' ? 'Baixar Restante' : 'Baixa'}
                            </button>
                        ` : ''}
                        <button class="btn btn-danger btn-sm btn-excluir-documento" data-id="${escapeHtml(doc.id)}" title="Excluir Lançamento" style="padding: 4px 8px; margin-left: 4px;">
                            🗑️
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        listaDocumentosBody.querySelectorAll('.btn-editar-documento').forEach(btn => {
            btn.addEventListener('click', () => {
                window.editarDocumento(btn.dataset.id);
            });
        });

        listaDocumentosBody.querySelectorAll('.btn-dar-baixa').forEach(btn => {
            btn.addEventListener('click', () => {
                window.abrirModalRecebimento(btn.dataset.id, btn.dataset.numero, btn.dataset.liquido);
            });
        });

        listaDocumentosBody.querySelectorAll('.btn-excluir-documento').forEach(btn => {
            btn.addEventListener('click', () => {
                excluirDocumento(btn.dataset.id);
            });
        });
    }

    function renderizarContratos() {
        if (contratos.length === 0) {
            listaContratosBody.innerHTML = `
                <tr>
                    <td colspan="10" style="text-align: center; color: var(--text-muted); padding: 24px;">
                        Nenhum contrato cadastrado para a seleção atual.
                    </td>
                </tr>
            `;
            return;
        }

        listaContratosBody.innerHTML = contratos.map(c => {
            const clienteExibicao = c._clientName ? escapeHtml(c._clientName) : '<span style="color:var(--text-muted);font-size:0.85rem;">Não informado</span>';
            const docExibicao = c._clientDoc ? `<span style="font-family: monospace; font-size: 0.85rem;">${escapeHtml(c._clientDoc)}</span>` : '<span style="color:var(--text-muted);font-size:0.85rem;">-</span>';
            const tipoContrato = c.contract_type || 'B2B';
            const tipoBadgeClass = tipoContrato === 'B2G' ? 'badge-info' : (tipoContrato === 'B2C' ? 'badge-warning' : 'badge-primary');
            const tipoBadge = `<span class="badge ${tipoBadgeClass}">${escapeHtml(tipoContrato)}</span>`;

            const statusBadge = c.status === 'active' 
                ? '<span class="badge badge-success">Ativo</span>' 
                : `<span class="badge badge-warning">${escapeHtml(c.status)}</span>`;

            const emp = companiesMap.get(c.company_id);
            const empText = emp ? ` <span style="font-size:0.75rem; color:var(--text-muted);">(${escapeHtml(emp.trade_name || emp.name)})</span>` : '';

            return `
                <tr>
                    <td style="font-weight: 600; color: #fff;">${escapeHtml(c.code)}${empText}</td>
                    <td>${tipoBadge}</td>
                    <td>${escapeHtml(c.name)}</td>
                    <td>${clienteExibicao}</td>
                    <td>${docExibicao}</td>
                    <td>${escapeHtml(window.BpoMoney.formatBRL(c.reference_value))}</td>
                    <td>${escapeHtml(c.billing_frequency)}</td>
                    <td>${c.commission_eligible ? 'Sim' : 'Não'}</td>
                    <td>${statusBadge}</td>
                    <td style="white-space: nowrap;">
                        <button class="btn btn-primary btn-sm btn-editar-contrato" data-id="${escapeHtml(c.id)}">Editar</button>
                        <button class="btn btn-danger btn-sm btn-excluir-contrato" data-id="${escapeHtml(c.id)}" title="Excluir Contrato" style="padding: 4px 8px; margin-left: 4px;">🗑️</button>
                    </td>
                </tr>
            `;
        }).join('');

        listaContratosBody.querySelectorAll('.btn-editar-contrato').forEach(btn => {
            btn.addEventListener('click', () => window.editarContrato(btn.dataset.id));
        });

        listaContratosBody.querySelectorAll('.btn-excluir-contrato').forEach(btn => {
            btn.addEventListener('click', () => excluirContrato(btn.dataset.id));
        });
    }

    function getStatusBadge(status, totalPagoCents, saldoRestanteCents) {
        switch(status) {
            case 'paid': return '<span class="badge badge-success">Liquidado</span>';
            case 'partially_paid': {
                const pagoFmt = totalPagoCents ? window.BpoMoney.formatBRL(totalPagoCents) : '';
                const faltaFmt = saldoRestanteCents ? window.BpoMoney.formatBRL(saldoRestanteCents) : '';
                const titleStr = faltaFmt ? `Pago: ${pagoFmt} | Restante: ${faltaFmt}` : 'Pagamento Parcial';
                return `<span class="badge badge-warning" title="${titleStr}">Parcial</span>`;
            }
            case 'emitted': return '<span class="badge badge-info">Emitido</span>';
            case 'cancelled': return '<span class="badge badge-danger">Cancelado</span>';
            default: return `<span class="badge badge-info">${escapeHtml(status || '')}</span>`;
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

    // =========================================================================
    // CONFIGURAÇÃO DO FORMULÁRIO E PRÉVIA DE IMPOSTOS EM TEMPO REAL
    // =========================================================================
    function configurarPainelPreviaImpostos() {
        const inpBruto = document.getElementById('docValorBruto');
        const inpDesconto = document.getElementById('docDesconto');
        const inpMulta = document.getElementById('docMulta');
        const inpJuros = document.getElementById('docJuros');
        const inpExtras = document.getElementById('docExtras');

        const selEmpresa = document.getElementById('docEmpresaId');
        const selContrato = document.getElementById('docContrato');
        const selItemTipo = document.getElementById('docItemTipo');
        const chkIrrf = document.getElementById('chkIrrf');
        const aliqIrrf = document.getElementById('aliqIrrf');
        const boxIrrf = document.getElementById('boxIrrfConfig');
        const chkInss = document.getElementById('chkInss');
        const aliqInss = document.getElementById('aliqInss');
        const boxInss = document.getElementById('boxInssConfig');
        const aliqIss = document.getElementById('aliqIss');
        const chkIssRetido = document.getElementById('chkIssRetido');

        // Inputs editáveis de PIS, COFINS, IRPJ, CSLL (Lucro Presumido)
        const inpAliqPis = document.getElementById('inpAliqPis');
        const inpValorPis = document.getElementById('inpValorPis');
        const inpAliqCofins = document.getElementById('inpAliqCofins');
        const inpValorCofins = document.getElementById('inpValorCofins');
        const inpAliqIrpj = document.getElementById('inpAliqIrpj');
        const inpValorIrpj = document.getElementById('inpValorIrpj');
        const inpAliqCsll = document.getElementById('inpAliqCsll');
        const inpValorCsll = document.getElementById('inpValorCsll');

        // Inputs do Simples Nacional (Item 02)
        const selAnexoSimples = document.getElementById('selAnexoSimples');
        const inpRbt12Simples = document.getElementById('inpRbt12Simples');
        const inpAliqDas = document.getElementById('inpAliqDas');
        const inpValorDas = document.getElementById('inpValorDas');

        // Toggles visuais
        chkIrrf.addEventListener('change', () => {
            boxIrrf.style.display = chkIrrf.checked ? 'block' : 'none';
            dispararPreviaImpostos('geral');
        });

        chkInss.addEventListener('change', () => {
            boxInss.style.display = chkInss.checked ? 'block' : 'none';
            dispararPreviaImpostos('geral');
        });

        // Eventos de valores, acréscimos e descontos (Item 01)
        [inpBruto, inpDesconto, inpMulta, inpJuros, inpExtras].forEach(el => {
            if (el) el.addEventListener('input', () => dispararPreviaImpostos('valores'));
        });

        [aliqIrrf, aliqInss, aliqIss].forEach(el => {
            if (el) el.addEventListener('input', () => dispararPreviaImpostos('geral'));
        });

        [selEmpresa, selContrato, selItemTipo, chkIssRetido].forEach(el => {
            if (el) el.addEventListener('change', () => dispararPreviaImpostos('empresa_ou_tipo'));
        });

        // Interação bidirecional dos campos de PIS/COFINS/IRPJ/CSLL
        if (inpAliqPis) inpAliqPis.addEventListener('input', () => dispararPreviaImpostos('aliq_pis'));
        if (inpValorPis) inpValorPis.addEventListener('input', () => dispararPreviaImpostos('valor_pis'));

        if (inpAliqCofins) inpAliqCofins.addEventListener('input', () => dispararPreviaImpostos('aliq_cofins'));
        if (inpValorCofins) inpValorCofins.addEventListener('input', () => dispararPreviaImpostos('valor_cofins'));

        if (inpAliqIrpj) inpAliqIrpj.addEventListener('input', () => dispararPreviaImpostos('aliq_irpj'));
        if (inpValorIrpj) inpValorIrpj.addEventListener('input', () => dispararPreviaImpostos('valor_irpj'));

        if (inpAliqCsll) inpAliqCsll.addEventListener('input', () => dispararPreviaImpostos('aliq_csll'));
        if (inpValorCsll) inpValorCsll.addEventListener('input', () => dispararPreviaImpostos('valor_csll'));

        // Eventos do Simples Nacional
        if (selAnexoSimples) selAnexoSimples.addEventListener('change', () => dispararPreviaImpostos('simples_anexo'));
        if (inpRbt12Simples) inpRbt12Simples.addEventListener('input', () => dispararPreviaImpostos('simples_rbt12'));
        if (inpAliqDas) inpAliqDas.addEventListener('input', () => dispararPreviaImpostos('simples_aliq'));
        if (inpValorDas) inpValorDas.addEventListener('input', () => dispararPreviaImpostos('simples_valor'));

        // Isenção de ISS no Simples Nacional
        const chkIssIsentoSimples = document.getElementById('chkIssIsentoSimples');
        if (chkIssIsentoSimples) chkIssIsentoSimples.addEventListener('change', () => dispararPreviaImpostos('simples_anexo'));

        // Filtra contratos do modal quando seleciona empresa emitente
        selEmpresa.addEventListener('change', () => {
            const empId = selEmpresa.value;
            atualizarContratosModal(empId);
            atualizarBadgeRegimeModal(empId);
        });
    }

    function atualizarContratosModal(companyId) {
        const selContrato = document.getElementById('docContrato');
        selContrato.innerHTML = '<option value="">— Sem vínculo de contrato —</option>';
        const contratosFiltrados = companyId 
            ? contratos.filter(c => c.company_id === companyId) 
            : contratos;

        contratosFiltrados.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = `${c.code} — ${c.name}`;
            selContrato.appendChild(opt);
        });
    }

    function atualizarBadgeRegimeModal(companyId) {
        const badge = document.getElementById('badgeRegimePrevia');
        const emp = companiesMap.get(companyId);
        if (!emp) {
            badge.textContent = 'Regime Fiscal';
            badge.style.color = '#94a3b8';
            return;
        }

        const isPresumido = emp.tax_regime === 'lucro_presumido';
        badge.textContent = isPresumido ? 'Lucro Presumido (Provisão Trimestral)' : 'Simples Nacional (DAS Estimado)';
        badge.style.color = isPresumido ? '#60a5fa' : '#34d399';
    }

    let ultimaOrigemDisparo = 'geral';
    function dispararPreviaImpostos(origem) {
        ultimaOrigemDisparo = origem || 'geral';
        if (debounceTimerPrevia) clearTimeout(debounceTimerPrevia);
        debounceTimerPrevia = setTimeout(() => executarPreviaImpostos(ultimaOrigemDisparo), 80);
    }

    function executarPreviaImpostos(origem) {
        requestIdPrevia++;
        const currentReq = requestIdPrevia;

        const companyId = document.getElementById('docEmpresaId').value;
        const brutoStr = document.getElementById('docValorBruto').value;
        const brutoCents = window.BpoMoney.toCents(brutoStr);
        const brutoNum = Number(brutoCents) / 100;

        // Acréscimos e Descontos (Item 01)
        const descontoCents = window.BpoMoney.toCents(document.getElementById('docDesconto')?.value || '0');
        const multaCents = window.BpoMoney.toCents(document.getElementById('docMulta')?.value || '0');
        const jurosCents = window.BpoMoney.toCents(document.getElementById('docJuros')?.value || '0');
        const extrasCents = window.BpoMoney.toCents(document.getElementById('docExtras')?.value || '0');

        const emp = companiesMap.get(companyId);
        const isSimples = emp && emp.tax_regime === 'simples_nacional';
        const isLucroPresumido = !isSimples;

        // Painéis condicionais por Regime Fiscal (Item 02)
        const painelSimples = document.getElementById('painelSimplesNacional');
        const painelLucro = document.getElementById('painelCalculoTributosLancamento');
        const boxRetencoes = document.getElementById('boxCampoRetencoes');
        const painelRetencoesIss = document.getElementById('painelRetencoesIss');

        let retTotalCents = 0n;
        let totalImpostosCents = 0n;

        if (isSimples) {
            // =========================================================================
            // SIMPLES NACIONAL (Item 02): Sem retenções na fonte, unificado no DAS Estimado
            // =========================================================================
            if (painelSimples) painelSimples.style.display = 'block';
            if (painelLucro) painelLucro.style.display = 'none';
            if (boxRetencoes) boxRetencoes.style.display = 'none';
            if (painelRetencoesIss) painelRetencoesIss.style.display = 'none';

            retTotalCents = 0n;

            const selAnexo = document.getElementById('selAnexoSimples');
            const inpRbt12 = document.getElementById('inpRbt12Simples');
            const inpAliqDas = document.getElementById('inpAliqDas');
            const inpValorDas = document.getElementById('inpValorDas');
            const chkIssIsento = document.getElementById('chkIssIsentoSimples');
            const badgeIssIsento = document.getElementById('badgeIssIsentoSimples');

            const anexoKey = selAnexo ? selAnexo.value : 'anexo_iii';
            const rbt12Num = inpRbt12 ? Number(window.BpoMoney.toCents(inpRbt12.value)) / 100 : 180000;
            const issIsento = chkIssIsento ? chkIssIsento.checked : false;

            // Atualiza badge de isenção de ISS
            if (badgeIssIsento) badgeIssIsento.style.display = issIsento ? 'inline-block' : 'none';

            // =========================================================================
            // Tabela de partilha dos 5 anexos do Simples Nacional (2024)
            // Proporções aproximadas da 1ª faixa (até R$180k RBT12) para fins de estimativa.
            // irpj, csll, cofins, pis, inss (CPP), iss — todos em decimal (1.0 = 100%)
            // =========================================================================
            const repFaixas = {
                // Anexo I — Comércio: sem ISS (inclui ICMS), sem CPP nesta partilha básica
                anexo_i:   { irpj: 0.0500, csll: 0.0350, cofins: 0.1274, pis: 0.0276, inss: 0.4150, iss: 0.0000 },
                // Anexo II — Indústria: similar ao I com partilha para IPI
                anexo_ii:  { irpj: 0.0500, csll: 0.0350, cofins: 0.1274, pis: 0.0276, inss: 0.4150, iss: 0.0000 },
                // Anexo III — Serviços (PMOC, Instalação, Manutenção)
                anexo_iii: { irpj: 0.0400, csll: 0.0350, cofins: 0.1280, pis: 0.0280, inss: 0.4340, iss: 0.3350 },
                // Anexo IV — Construção civil, Obras, Vigilância (sem CPP — recolhido separado)
                anexo_iv:  { irpj: 0.1880, csll: 0.1520, cofins: 0.1765, pis: 0.0385, inss: 0.0000, iss: 0.4450 },
                // Anexo V — Serviços Profissionais com Fator R (contabilidade, TI, etc.)
                anexo_v:   { irpj: 0.1500, csll: 0.1500, cofins: 0.1600, pis: 0.0350, inss: 0.2850, iss: 0.2200 }
            };
            let rep = repFaixas[anexoKey] || repFaixas.anexo_iii;

            // Se ISS isento: redistribui a parcela do ISS proporcionalmente entre os demais tributos
            if (issIsento && rep.iss > 0) {
                const issShare = rep.iss;
                const outrosTotal = 1 - issShare;
                const fator = outrosTotal > 0 ? (1 / outrosTotal) : 1;
                rep = {
                    irpj:  rep.irpj  * fator,
                    csll:  rep.csll  * fator,
                    cofins:rep.cofins * fator,
                    pis:   rep.pis   * fator,
                    inss:  rep.inss  * fator,
                    iss:   0
                };
            }

            let aliquotaDasFinal = 0.06;

            if (origem === 'simples_valor' && inpValorDas && inpAliqDas) {
                const vCents = window.BpoMoney.toCents(inpValorDas.value);
                if (brutoCents > 0n) {
                    aliquotaDasFinal = Number(vCents) / Number(brutoCents);
                    inpAliqDas.value = (aliquotaDasFinal * 100).toFixed(2);
                }
            } else if (origem === 'simples_aliq' && inpAliqDas && inpValorDas) {
                aliquotaDasFinal = (parseFloat(inpAliqDas.value) || 0) / 100;
                const dasCents = BigInt(Math.round(brutoNum * aliquotaDasFinal * 100));
                inpValorDas.value = window.BpoMoney.toDecimalString(dasCents);
            } else if (origem !== 'simples_valor' && origem !== 'simples_aliq') {
                // Cálculo automático pela tabela do Simples quando muda anexo, rbt12 ou valor bruto
                if (window.BpoTaxEngine) {
                    try {
                        const apuracao = window.BpoTaxEngine.apurarSimplesNacional(rbt12Num, brutoNum, anexoKey, { issRetidoTomador: false, issIsento });
                        aliquotaDasFinal = apuracao.aliquotaEfetivaNumero || 0.06;
                        if (inpAliqDas) inpAliqDas.value = (aliquotaDasFinal * 100).toFixed(2);
                        const dasCents = BigInt(Math.round(apuracao.valorDas * 100));
                        if (inpValorDas) inpValorDas.value = window.BpoMoney.toDecimalString(dasCents);
                    } catch (_) {
                        // BpoTaxEngine não implementado: usa alíquota atual do campo
                        aliquotaDasFinal = (parseFloat(inpAliqDas?.value) || 6.0) / 100;
                        const dasCents = BigInt(Math.round(brutoNum * aliquotaDasFinal * 100));
                        if (inpValorDas) inpValorDas.value = window.BpoMoney.toDecimalString(dasCents);
                    }
                } else {
                    aliquotaDasFinal = (parseFloat(inpAliqDas?.value) || 6.0) / 100;
                    const dasCents = BigInt(Math.round(brutoNum * aliquotaDasFinal * 100));
                    if (inpValorDas) inpValorDas.value = window.BpoMoney.toDecimalString(dasCents);
                }
            } else {
                aliquotaDasFinal = (parseFloat(inpAliqDas?.value) || 6.0) / 100;
            }

            const dasValorCents = inpValorDas ? window.BpoMoney.toCents(inpValorDas.value) : 0n;
            totalImpostosCents = dasValorCents;

            // Detalhamento dos 6 tributos usando a tabela de partilha já calculada (rep)
            const fatNum = Number(brutoCents) / 100;
            const aliqBruta = (parseFloat(inpAliqDas?.value) || 6.0) / 100;

            const setComponente = (idPct, idVal, pct) => {
                const elPct = document.getElementById(idPct);
                const elVal = document.getElementById(idVal);
                if (elPct) elPct.textContent = `${(pct * 100).toFixed(1)}%`;
                if (elVal) {
                    const cCents = BigInt(Math.round(fatNum * aliqBruta * pct * 100));
                    elVal.textContent = window.BpoMoney.formatBRL(cCents);
                }
            };
            setComponente('dasPctIrpj',   'dasValIrpj',   rep.irpj);
            setComponente('dasPctCsll',   'dasValCsll',   rep.csll);
            setComponente('dasPctCofins', 'dasValCofins', rep.cofins);
            setComponente('dasPctPis',    'dasValPis',    rep.pis);
            setComponente('dasPctInss',   'dasValInss',   rep.inss);
            setComponente('dasPctIss',    'dasValIss',    rep.iss);

        } else {
            // =========================================================================
            // LUCRO PRESUMIDO / REAL: PIS, COFINS, IRPJ, CSLL e Retenções/ISS
            // =========================================================================
            if (painelSimples) painelSimples.style.display = 'none';
            if (painelLucro) painelLucro.style.display = 'block';
            if (boxRetencoes) boxRetencoes.style.display = 'block';
            if (painelRetencoesIss) painelRetencoesIss.style.display = 'block';

            const chkIrrf = document.getElementById('chkIrrf').checked;
            const aliqIrrfVal = parseFloat(document.getElementById('aliqIrrf').value) || 0;

            const chkInss = document.getElementById('chkInss').checked;
            const aliqInssVal = parseFloat(document.getElementById('aliqInss').value) || 0;

            const aliqIssVal = parseFloat(document.getElementById('aliqIss').value) || 0;
            const chkIssRetido = document.getElementById('chkIssRetido').checked;
            const itemTipo = document.getElementById('docItemTipo').value || 'servico';

            // Elementos dos tributos editáveis
            const elAliqPis = document.getElementById('inpAliqPis');
            const elValorPis = document.getElementById('inpValorPis');
            const elAliqCofins = document.getElementById('inpAliqCofins');
            const elValorCofins = document.getElementById('inpValorCofins');
            const elAliqIrpj = document.getElementById('inpAliqIrpj');
            const elValorIrpj = document.getElementById('inpValorIrpj');
            const elAliqCsll = document.getElementById('inpAliqCsll');
            const elValorCsll = document.getElementById('inpValorCsll');
            const elBadgeRegime = document.getElementById('badgePreviaRegime');

            // Se trocou de empresa ou tipo de documento, ajusta defaults de alíquotas
            if (origem === 'empresa_ou_tipo') {
                if (elAliqPis) elAliqPis.value = '0.65';
                if (elAliqCofins) elAliqCofins.value = '3.00';
                if (elAliqIrpj) elAliqIrpj.value = itemTipo === 'servico' ? '4.80' : '1.20';
                if (elAliqCsll) elAliqCsll.value = itemTipo === 'servico' ? '2.88' : '1.08';
            }

            // 1. PIS
            if (origem === 'valor_pis' && elValorPis && elAliqPis) {
                const vCents = window.BpoMoney.toCents(elValorPis.value);
                if (brutoCents > 0n) {
                    elAliqPis.value = (Number(vCents) / Number(brutoCents) * 100).toFixed(2);
                }
            } else if (elAliqPis && elValorPis) {
                const aliq = parseFloat(elAliqPis.value) || 0;
                const pisCents = BigInt(Math.round(brutoNum * (aliq / 100) * 100));
                if (origem !== 'valor_pis') {
                    elValorPis.value = window.BpoMoney.toDecimalString(pisCents);
                }
            }

            // 2. COFINS
            if (origem === 'valor_cofins' && elValorCofins && elAliqCofins) {
                const vCents = window.BpoMoney.toCents(elValorCofins.value);
                if (brutoCents > 0n) {
                    elAliqCofins.value = (Number(vCents) / Number(brutoCents) * 100).toFixed(2);
                }
            } else if (elAliqCofins && elValorCofins) {
                const aliq = parseFloat(elAliqCofins.value) || 0;
                const cofinsCents = BigInt(Math.round(brutoNum * (aliq / 100) * 100));
                if (origem !== 'valor_cofins') {
                    elValorCofins.value = window.BpoMoney.toDecimalString(cofinsCents);
                }
            }

            // 3. IRPJ
            if (origem === 'valor_irpj' && elValorIrpj && elAliqIrpj) {
                const vCents = window.BpoMoney.toCents(elValorIrpj.value);
                if (brutoCents > 0n) {
                    elAliqIrpj.value = (Number(vCents) / Number(brutoCents) * 100).toFixed(2);
                }
            } else if (elAliqIrpj && elValorIrpj) {
                const aliq = parseFloat(elAliqIrpj.value) || 0;
                const irpjCents = BigInt(Math.round(brutoNum * (aliq / 100) * 100));
                if (origem !== 'valor_irpj') {
                    elValorIrpj.value = window.BpoMoney.toDecimalString(irpjCents);
                }
            }

            // 4. CSLL
            if (origem === 'valor_csll' && elValorCsll && elAliqCsll) {
                const vCents = window.BpoMoney.toCents(elValorCsll.value);
                if (brutoCents > 0n) {
                    elAliqCsll.value = (Number(vCents) / Number(brutoCents) * 100).toFixed(2);
                }
            } else if (elAliqCsll && elValorCsll) {
                const aliq = parseFloat(elAliqCsll.value) || 0;
                const csllCents = BigInt(Math.round(brutoNum * (aliq / 100) * 100));
                if (origem !== 'valor_csll') {
                    elValorCsll.value = window.BpoMoney.toDecimalString(csllCents);
                }
            }

            // Atualiza badge de regime
            if (elBadgeRegime) {
                elBadgeRegime.textContent = 'Lucro Presumido';
                elBadgeRegime.style.background = 'rgba(59,130,246,0.15)';
                elBadgeRegime.style.color = '#60a5fa';
            }

            // Retenções
            const irrfCents = (itemTipo === 'servico' && chkIrrf) 
                ? BigInt(Math.round(brutoNum * (aliqIrrfVal / 100) * 100)) 
                : 0n;
            const inssCents = (itemTipo === 'servico' && chkInss) 
                ? BigInt(Math.round(brutoNum * (aliqInssVal / 100) * 100)) 
                : 0n;
            const issCalcCents = (itemTipo === 'servico') 
                ? BigInt(Math.round(brutoNum * (aliqIssVal / 100) * 100)) 
                : 0n;
            const issRetidoCents = chkIssRetido ? issCalcCents : 0n;

            retTotalCents = irrfCents + inssCents + issRetidoCents;

            const curPisCents = elValorPis ? window.BpoMoney.toCents(elValorPis.value) : 0n;
            const curCofinsCents = elValorCofins ? window.BpoMoney.toCents(elValorCofins.value) : 0n;
            const curIrpjCents = elValorIrpj ? window.BpoMoney.toCents(elValorIrpj.value) : 0n;
            const curCsllCents = elValorCsll ? window.BpoMoney.toCents(elValorCsll.value) : 0n;

            totalImpostosCents = curPisCents + curCofinsCents + issCalcCents + curIrpjCents + curCsllCents;

            // Valores de retenção nas tags
            document.getElementById('valIrrfPreview').textContent = window.BpoMoney.toDecimalString(irrfCents);
            document.getElementById('valInssPreview').textContent = window.BpoMoney.toDecimalString(inssCents);
        }

        // =========================================================================
        // Cálculo do Líquido a Receber (Item 01):
        // Líquido = Bruto + Multa + Juros + Extras - Desconto - Retenções
        // =========================================================================
        const subtotalCents = brutoCents + multaCents + jurosCents + extrasCents;
        const deducoesCents = descontoCents + retTotalCents;
        const liquidoRecebCents = subtotalCents > deducoesCents ? (subtotalCents - deducoesCents) : 0n;
        const liquidoEcoCents = subtotalCents > (totalImpostosCents + descontoCents) ? (subtotalCents - totalImpostosCents - descontoCents) : 0n;

        // Atualiza campos de saída na tela
        document.getElementById('docRetencoes').value = window.BpoMoney.toDecimalString(retTotalCents);
        document.getElementById('docValorLiquido').value = window.BpoMoney.toDecimalString(liquidoRecebCents);

        document.getElementById('previaTotalImpostos').textContent = window.BpoMoney.formatBRL(totalImpostosCents);
        document.getElementById('previaTotalRetencoes').textContent = window.BpoMoney.formatBRL(retTotalCents);
        document.getElementById('previaLiquidoEconomico').textContent = window.BpoMoney.formatBRL(liquidoEcoCents);

        const pendenciasBox = document.getElementById('previaPendenciasTexto');
        if (pendenciasBox) pendenciasBox.style.display = 'none';
    }

    function prepararModalNovoDocumento() {
        document.getElementById('docId').value = '';
        document.getElementById('modalDocumentoTitulo').textContent = 'Criar Lançamento';
        document.getElementById('btnExcluirDocumentoModal').style.display = 'none';

        // Popula dropdown de empresas no modal
        const selEmpresa = document.getElementById('docEmpresaId');
        selEmpresa.innerHTML = '<option value="">Selecione a empresa...</option>';
        empresas.forEach(emp => {
            const opt = document.createElement('option');
            opt.value = emp.id;
            opt.textContent = `${emp.name} (${emp.trade_name || ''})`;
            selEmpresa.appendChild(opt);
        });

        if (empresaAtivaId !== 'all') {
            selEmpresa.value = empresaAtivaId;
        } else if (empresas.length > 0) {
            selEmpresa.value = empresas[0].id;
        }

        atualizarContratosModal(selEmpresa.value);
        atualizarBadgeRegimeModal(selEmpresa.value);

        document.getElementById('formNovoDocumento').reset();
        document.getElementById('docNumero').value = '';
        document.getElementById('docRecebimento').value = '';
        document.getElementById('docValorBruto').value = '0,00';
        document.getElementById('docDesconto').value = '0,00';
        document.getElementById('docMulta').value = '0,00';
        document.getElementById('docJuros').value = '0,00';
        document.getElementById('docExtras').value = '0,00';

        // Simples Nacional defaults
        const selAnexo = document.getElementById('selAnexoSimples');
        if (selAnexo) selAnexo.value = 'anexo_iii';
        const inpRbt12 = document.getElementById('inpRbt12Simples');
        if (inpRbt12) inpRbt12.value = '180.000,00';
        const inpAliqDas = document.getElementById('inpAliqDas');
        if (inpAliqDas) inpAliqDas.value = '6.00';
        const inpValorDas = document.getElementById('inpValorDas');
        if (inpValorDas) inpValorDas.value = '0,00';
        const chkIssIsentoSimples = document.getElementById('chkIssIsentoSimples');
        if (chkIssIsentoSimples) chkIssIsentoSimples.checked = false;
        const badgeIssIsento = document.getElementById('badgeIssIsentoSimples');
        if (badgeIssIsento) badgeIssIsento.style.display = 'none';

        document.getElementById('chkIrrf').checked = false;
        document.getElementById('boxIrrfConfig').style.display = 'none';
        document.getElementById('aliqIrrf').value = '4.8';
        document.getElementById('chkInss').checked = false;
        document.getElementById('boxInssConfig').style.display = 'none';
        document.getElementById('aliqInss').value = '11';
        document.getElementById('aliqIss').value = '5.0';
        document.getElementById('chkIssRetido').checked = false;

        document.getElementById('inpAliqPis').value = '0.65';
        document.getElementById('inpValorPis').value = '0,00';
        document.getElementById('inpAliqCofins').value = '3.00';
        document.getElementById('inpValorCofins').value = '0,00';
        document.getElementById('inpAliqIrpj').value = '4.80';
        document.getElementById('inpValorIrpj').value = '0,00';
        document.getElementById('inpAliqCsll').value = '2.88';
        document.getElementById('inpValorCsll').value = '0,00';

        executarPreviaImpostos('novo');
        abrirModal(modalDocumento);
    }

    // Editar documento existente
    window.editarDocumento = function(docId) {
        const d = documentos.find(x => x.id === docId);
        if (!d) return;

        prepararModalNovoDocumento();

        document.getElementById('docId').value = d.id;
        document.getElementById('modalDocumentoTitulo').textContent = 'Editar Lançamento';
        document.getElementById('docEmpresaId').value = d.company_id || '';
        atualizarContratosModal(d.company_id);
        atualizarBadgeRegimeModal(d.company_id);

        document.getElementById('docContrato').value = d.contract_id || '';
        document.getElementById('docTipo').value = d.document_type || 'nfse';
        document.getElementById('docNumero').value = d.document_number || '';
        document.getElementById('docEmissao').value = d.issue_date || '';
        document.getElementById('docVencimento').value = d.due_date || '';
        document.getElementById('docRecebimento').value = d.payment_date || '';
        document.getElementById('docValorBruto').value = window.BpoMoney.toDecimalString(window.BpoMoney.toCents(d.gross_amount));
        document.getElementById('docDescricao').value = d._descricaoLimpa !== undefined ? d._descricaoLimpa : window.BpoFiscalUtils.limparDescricao(d.description);

        // Carrega dados de retenção, tributos e acréscimos se existirem em tax_details
        const taxDetails = d.tax_details || window.BpoFiscalUtils.extrairTaxDetails(d);
        if (taxDetails) {
            // Acréscimos e Descontos (Item 01)
            document.getElementById('docDesconto').value = taxDetails.desconto || (d.discounts ? window.BpoMoney.toDecimalString(window.BpoMoney.toCents(d.discounts)) : '0,00');
            document.getElementById('docMulta').value = taxDetails.multa || '0,00';
            document.getElementById('docJuros').value = taxDetails.juros || '0,00';
            document.getElementById('docExtras').value = taxDetails.extras || '0,00';

            // Simples Nacional (Item 02)
            if (taxDetails.is_simples) {
                const selAnexo = document.getElementById('selAnexoSimples');
                if (selAnexo && taxDetails.das_anexo) selAnexo.value = taxDetails.das_anexo;
                const inpRbt12 = document.getElementById('inpRbt12Simples');
                if (inpRbt12 && taxDetails.das_rbt12) inpRbt12.value = taxDetails.das_rbt12;
                const inpAliqDas = document.getElementById('inpAliqDas');
                if (inpAliqDas && taxDetails.das_aliq) inpAliqDas.value = taxDetails.das_aliq;
                const inpValorDas = document.getElementById('inpValorDas');
                if (inpValorDas && taxDetails.das_valor) inpValorDas.value = taxDetails.das_valor;
                // Isenção de ISS
                const chkIsento = document.getElementById('chkIssIsentoSimples');
                if (chkIsento) chkIsento.checked = !!taxDetails.iss_isento_simples;
                const badgeIsento = document.getElementById('badgeIssIsentoSimples');
                if (badgeIsento) badgeIsento.style.display = taxDetails.iss_isento_simples ? 'inline-block' : 'none';
            }

            if (taxDetails.has_irrf) {
                document.getElementById('chkIrrf').checked = true;
                document.getElementById('boxIrrfConfig').style.display = 'block';
                if (taxDetails.irrf_aliq) document.getElementById('aliqIrrf').value = taxDetails.irrf_aliq;
            } else {
                document.getElementById('chkIrrf').checked = false;
                document.getElementById('boxIrrfConfig').style.display = 'none';
            }

            if (taxDetails.has_inss) {
                document.getElementById('chkInss').checked = true;
                document.getElementById('boxInssConfig').style.display = 'block';
                if (taxDetails.inss_aliq) document.getElementById('aliqInss').value = taxDetails.inss_aliq;
            } else {
                document.getElementById('chkInss').checked = false;
                document.getElementById('boxInssConfig').style.display = 'none';
            }

            if (taxDetails.iss_aliq !== undefined && taxDetails.iss_aliq !== null) {
                document.getElementById('aliqIss').value = taxDetails.iss_aliq;
            }
            document.getElementById('chkIssRetido').checked = !!taxDetails.iss_retained;
            if (taxDetails.item_type) document.getElementById('docItemTipo').value = taxDetails.item_type;

            if (taxDetails.pis_aliq !== undefined && taxDetails.pis_aliq !== null) {
                document.getElementById('inpAliqPis').value = taxDetails.pis_aliq;
            }
            if (taxDetails.pis_valor !== undefined && taxDetails.pis_valor !== null) {
                document.getElementById('inpValorPis').value = taxDetails.pis_valor;
            }

            if (taxDetails.cofins_aliq !== undefined && taxDetails.cofins_aliq !== null) {
                document.getElementById('inpAliqCofins').value = taxDetails.cofins_aliq;
            }
            if (taxDetails.cofins_valor !== undefined && taxDetails.cofins_valor !== null) {
                document.getElementById('inpValorCofins').value = taxDetails.cofins_valor;
            }

            if (taxDetails.irpj_aliq !== undefined && taxDetails.irpj_aliq !== null) {
                document.getElementById('inpAliqIrpj').value = taxDetails.irpj_aliq;
            }
            if (taxDetails.irpj_valor !== undefined && taxDetails.irpj_valor !== null) {
                document.getElementById('inpValorIrpj').value = taxDetails.irpj_valor;
            }

            if (taxDetails.csll_aliq !== undefined && taxDetails.csll_aliq !== null) {
                document.getElementById('inpAliqCsll').value = taxDetails.csll_aliq;
            }
            if (taxDetails.csll_valor !== undefined && taxDetails.csll_valor !== null) {
                document.getElementById('inpValorCsll').value = taxDetails.csll_valor;
            }
        }

        document.getElementById('btnExcluirDocumentoModal').style.display = 'inline-flex';
        executarPreviaImpostos('edicao_carregada');
        abrirModal(modalDocumento);
    };

    // Modal de Recebimento (Suporte a Baixas Parciais - Item 03)
    window.abrirModalRecebimento = function(id, numero, valorLiquido) {
        const d = documentos.find(x => x.id === id);
        if (!d) return;

        document.getElementById('recDocId').value = id;
        document.getElementById('recDocIdentificacao').value = `Doc: ${numero} | Valor Líquido: ${window.BpoMoney.formatBRL(d.net_amount)}`;
        
        const netCents = window.BpoMoney.toCents(d.net_amount);
        const jaPagoCents = d._totalRecebidoCents || 0n;
        const saldoCents = netCents > jaPagoCents ? (netCents - jaPagoCents) : 0n;

        const elTotal = document.getElementById('recTotalDoc');
        const elJaPago = document.getElementById('recTotalJaPago');
        const elSaldo = document.getElementById('recSaldoRestante');

        if (elTotal) elTotal.textContent = window.BpoMoney.formatBRL(netCents);
        if (elJaPago) elJaPago.textContent = window.BpoMoney.formatBRL(jaPagoCents);
        if (elSaldo) elSaldo.textContent = window.BpoMoney.formatBRL(saldoCents);

        // Valor sugerido para a baixa é o saldo restante (ou o valor líquido se 1ª baixa)
        const valorSugerido = saldoCents > 0n ? saldoCents : netCents;
        document.getElementById('recValor').value = window.BpoMoney.toDecimalString(valorSugerido);
        
        const hoje = new Date().toISOString().split('T')[0];
        document.getElementById('recData').value = hoje;

        // Histórico de baixas anteriores deste documento
        const boxHist = document.getElementById('recHistoricoBox');
        const listaHist = document.getElementById('recHistoricoLista');
        if (boxHist && listaHist) {
            if (d._receipts && d._receipts.length > 0) {
                boxHist.style.display = 'block';
                listaHist.innerHTML = d._receipts.map((r, idx) => `
                    <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <span>${idx + 1}ª Baixa (${formatarData(r.receipt_date)}) - ${escapeHtml(r.account || 'Conta')}:</span>
                        <strong style="color: #34d399;">${window.BpoMoney.formatBRL(r.gross_amount)}</strong>
                    </div>
                `).join('');
            } else {
                boxHist.style.display = 'none';
                listaHist.innerHTML = '';
            }
        }

        abrirModal(modalRecebimento);
    };

    // Editar contrato existente
    window.editarContrato = function(contratoId) {
        const c = contratos.find(x => x.id === contratoId);
        if (!c) return;

        const lblDocumento = document.getElementById('lblContratoDocumento');
        const inpDocumento = document.getElementById('contratoDocumento');
        const targetEmpresa = companiesMap.get(c.company_id) || empresas[0];

        document.getElementById('contratoId').value = c.id;
        document.getElementById('modalContratoTitulo').textContent = `Editar Contrato (${targetEmpresa ? targetEmpresa.name : ''})`;
        document.getElementById('formContrato').reset();

        const selContratoEmp = document.getElementById('contratoEmpresaId');
        if (selContratoEmp) {
            selContratoEmp.innerHTML = '<option value="">Selecione a empresa...</option>';
            empresas.forEach(emp => {
                const opt = document.createElement('option');
                opt.value = emp.id;
                opt.textContent = `${emp.name} (${emp.trade_name || ''})`;
                selContratoEmp.appendChild(opt);
            });
            selContratoEmp.value = c.company_id || '';
        }

        const inpInicio = document.getElementById('contratoInicio');
        if (inpInicio) inpInicio.value = c.start_date || '';

        document.getElementById('contratoCodigo').value = c.code || '';
        document.getElementById('contratoNome').value = c.name || '';
        document.getElementById('contratoTipo').value = c.contract_type || 'B2B';
        document.getElementById('contratoTipoCliente').value = c._clientType || 'PJ';
        document.getElementById('contratoCliente').value = c._clientName || '';
        if (inpDocumento) inpDocumento.value = c._clientDoc || '';
        if (lblDocumento) lblDocumento.textContent = (c._clientType === 'PF') ? 'CPF do Cliente' : 'CNPJ do Cliente';
        
        const elVal = document.getElementById('contratoValorBase') || document.getElementById('contratoValor');
        if (elVal) elVal.value = window.BpoMoney.toDecimalString(window.BpoMoney.toCents(c.reference_value));

        document.getElementById('contratoPeriodicidade').value = c.billing_frequency || 'monthly';
        document.getElementById('contratoComissao').checked = !!c.commission_eligible;

        document.getElementById('btnExcluirContratoModal').style.display = 'inline-flex';
        abrirModal(modalContrato);
    };

    // Submissão pelo operador (preserva regras normais de autorização quando acionado)
    async function salvarNovoDocumento(e) {
        e.preventDefault();
        const docId = document.getElementById('docId').value;
        const companyId = document.getElementById('docEmpresaId').value;
        if (!companyId) {
            alert('Selecione a empresa emitente.');
            return;
        }

        const emp = companiesMap.get(companyId);
        const isSimples = emp && emp.tax_regime === 'simples_nacional';

        const tipo = document.getElementById('docTipo').value;
        const itemTipo = document.getElementById('docItemTipo').value;
        const serie = '1';
        const numero = document.getElementById('docNumero').value.trim();
        const emissao = document.getElementById('docEmissao').value;
        const vencimento = document.getElementById('docVencimento').value;
        const dataRecebimento = document.getElementById('docRecebimento').value || null;

        const brutoCents = window.BpoMoney.toCents(document.getElementById('docValorBruto').value);
        const descontoCents = window.BpoMoney.toCents(document.getElementById('docDesconto').value);
        const multaCents = window.BpoMoney.toCents(document.getElementById('docMulta').value);
        const jurosCents = window.BpoMoney.toCents(document.getElementById('docJuros').value);
        const extrasCents = window.BpoMoney.toCents(document.getElementById('docExtras').value);

        // No Simples Nacional não há retenções de IRRF, INSS nem ISS
        const retCents = isSimples ? 0n : window.BpoMoney.toCents(document.getElementById('docRetencoes').value);

        const subtotalCents = brutoCents + multaCents + jurosCents + extrasCents;
        const deducoesCents = descontoCents + retCents;
        const liqCents = subtotalCents > deducoesCents ? (subtotalCents - deducoesCents) : 0n;

        const descricao = document.getElementById('docDescricao').value.trim();
        const contratoId = document.getElementById('docContrato').value || null;

        if (liqCents < 0n) {
            alert('As deduções não podem ser maiores que o valor bruto e acréscimos.');
            return;
        }

        let taxDetailsPayload = {};
        if (isSimples) {
            // =========================================================================
            // SIMPLES NACIONAL (Item 02): Guia DAS única estimada
            // =========================================================================
            const anexoSelecionado = document.getElementById('selAnexoSimples')?.value || 'anexo_iii';
            const issIsentoSimples = document.getElementById('chkIssIsentoSimples')?.checked || false;
            taxDetailsPayload = {
                is_simples: true,
                item_type: itemTipo,
                das_anexo: anexoSelecionado,
                das_rbt12: document.getElementById('inpRbt12Simples')?.value || '180.000,00',
                das_aliq: parseFloat(document.getElementById('inpAliqDas')?.value) || 0,
                das_valor: document.getElementById('inpValorDas')?.value || '0,00',
                iss_isento_simples: issIsentoSimples,
                total_tax: document.getElementById('inpValorDas')?.value || '0,00',
                desconto: window.BpoMoney.toDecimalString(descontoCents),
                multa: window.BpoMoney.toDecimalString(multaCents),
                juros: window.BpoMoney.toDecimalString(jurosCents),
                extras: window.BpoMoney.toDecimalString(extrasCents),
                payment_date: dataRecebimento || null
            };
        } else {
            // =========================================================================
            // LUCRO PRESUMIDO / REAL: Tributos e Retenções Discriminados
            // =========================================================================
            taxDetailsPayload = {
                is_simples: false,
                item_type: itemTipo,
                has_irrf: document.getElementById('chkIrrf').checked,
                irrf_aliq: parseFloat(document.getElementById('aliqIrrf').value) || 0,
                has_inss: document.getElementById('chkInss').checked,
                inss_aliq: parseFloat(document.getElementById('aliqInss').value) || 0,
                iss_aliq: parseFloat(document.getElementById('aliqIss').value) || 0,
                iss_retained: document.getElementById('chkIssRetido').checked,
                pis_aliq: parseFloat(document.getElementById('inpAliqPis').value) || 0,
                pis_valor: document.getElementById('inpValorPis').value,
                cofins_aliq: parseFloat(document.getElementById('inpAliqCofins').value) || 0,
                cofins_valor: document.getElementById('inpValorCofins').value,
                irpj_aliq: parseFloat(document.getElementById('inpAliqIrpj').value) || 0,
                irpj_valor: document.getElementById('inpValorIrpj').value,
                csll_aliq: parseFloat(document.getElementById('inpAliqCsll').value) || 0,
                csll_valor: document.getElementById('inpValorCsll').value,
                desconto: window.BpoMoney.toDecimalString(descontoCents),
                multa: window.BpoMoney.toDecimalString(multaCents),
                juros: window.BpoMoney.toDecimalString(jurosCents),
                extras: window.BpoMoney.toDecimalString(extrasCents),
                payment_date: dataRecebimento || null
            };
        }

        const descricaoComMeta = window.BpoFiscalUtils.anexarTaxDetailsNaDescricao(descricao, taxDetailsPayload);

        const payload = {
            company_id: companyId,
            competence_month: competenciaAtiva,
            document_type: tipo,
            series: serie,
            document_number: numero,
            issue_date: emissao,
            due_date: vencimento,
            gross_amount: window.BpoMoney.toDecimalString(brutoCents),
            discounts: window.BpoMoney.toDecimalString(descontoCents),
            retentions: window.BpoMoney.toDecimalString(retCents),
            net_amount: window.BpoMoney.toDecimalString(liqCents),
            description: descricaoComMeta,
            contract_id: contratoId,
            status: dataRecebimento ? 'paid' : 'emitted'
            // NÃO envia tax_details nem payment_date: não são colunas em billing_documents
        };

        try {
            let savedDoc;
            if (docId) {
                const res = await window.BpoSupabase.request(`billing_documents?id=eq.${docId}`, {
                    method: 'PATCH',
                    body: JSON.stringify(payload)
                });
                savedDoc = Array.isArray(res) ? res[0] : { id: docId };
            } else {
                const res = await window.BpoSupabase.request('billing_documents', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                savedDoc = Array.isArray(res) ? res[0] : null;
            }

            // Sincroniza tabela receipts se houver dataRecebimento (SEM A COLUNA 'amount')
            const idDocSalvo = (savedDoc && savedDoc.id) ? savedDoc.id : docId;
            if (dataRecebimento && idDocSalvo) {
                try {
                    const existingRecs = await window.BpoSupabase.request(`receipts?external_id=eq.${idDocSalvo}`, { method: 'GET' });
                    const recPayload = {
                        company_id: companyId,
                        external_id: idDocSalvo,
                        receipt_date: dataRecebimento,
                        gross_amount: window.BpoMoney.toDecimalString(liqCents),
                        account: 'conta_padrao'
                    };
                    if (existingRecs && existingRecs.length > 0) {
                        await window.BpoSupabase.request(`receipts?id=eq.${existingRecs[0].id}`, {
                            method: 'PATCH',
                            body: JSON.stringify(recPayload)
                        });
                    } else {
                        await window.BpoSupabase.request('receipts', {
                            method: 'POST',
                            body: JSON.stringify(recPayload)
                        });
                    }
                } catch (recErr) {
                    console.warn('Aviso: não foi possível sincronizar recebimento na tabela receipts:', recErr.message);
                }
            } else if (!dataRecebimento && docId) {
                try {
                    await window.BpoSupabase.request(`receipts?external_id=eq.${docId}`, { method: 'DELETE' });
                } catch (_) {}
            }

            fecharModais();
            await carregarDadosCompetencia();
            alert('Lançamento gravado com sucesso!');
        } catch (err) {
            alert('Erro ao gravar lançamento: ' + err.message);
        }
    }

    async function salvarNovaEmpresa(e) {
        e.preventDefault();
        const idExistente = document.getElementById('empresaId').value;
        const nome = document.getElementById('empresaNome').value.trim();
        const fantasia = document.getElementById('empresaFantasia').value.trim();
        const cnpj = document.getElementById('empresaCnpj').value.trim();
        const regime = document.getElementById('empresaRegime').value;

        try {
            if (idExistente) {
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
            } else {
                const grupos = await window.BpoSupabase.request('groups?limit=1', { method: 'GET' });
                let groupId = grupos.length > 0 ? grupos[0].id : null;

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
            }

            fecharModais();
            await carregarEmpresas();
            alert('Empresa salva com sucesso!');
        } catch (err) {
            alert('Erro ao salvar empresa: ' + err.message);
        }
    }

    async function salvarRecebimento(e) {
        e.preventDefault();
        const docId = document.getElementById('recDocId').value;
        const recData = document.getElementById('recData').value;
        const recValorCents = window.BpoMoney.toCents(document.getElementById('recValor').value);
        const doc = documentos.find(d => d.id === docId);

        if (!doc) return;
        if (recValorCents <= 0n) {
            alert('Informe um valor de baixa maior que zero.');
            return;
        }

        try {
            const netCents = window.BpoMoney.toCents(doc.net_amount);
            const jaPagoCents = doc._totalRecebidoCents || 0n;
            const novoTotalPagoCents = jaPagoCents + recValorCents;

            // Determina se a liquidação é total ou parcial (Item 03)
            const isLiquidadoTotal = novoTotalPagoCents >= netCents && netCents > 0n;
            const novoStatus = isLiquidadoTotal ? 'paid' : 'partially_paid';

            // 1. Atualiza status e anexa payment_date nos metadados fiscais da descrição
            let novaDescricao = doc.description || '';
            const taxDetails = doc.tax_details || window.BpoFiscalUtils.extrairTaxDetails(doc) || {};
            taxDetails.payment_date = recData;
            novaDescricao = window.BpoFiscalUtils.anexarTaxDetailsNaDescricao(
                window.BpoFiscalUtils.limparDescricao(novaDescricao),
                taxDetails
            );

            await window.BpoSupabase.request(`billing_documents?id=eq.${docId}`, {
                method: 'PATCH',
                body: JSON.stringify({
                    status: novoStatus,
                    description: novaDescricao
                })
            });

            // 2. Grava um novo recebimento na tabela receipts (SEM A COLUNA 'amount')
            const contaBancaria = document.getElementById('recConta')?.value || 'conta_padrao';
            const recPayload = {
                company_id: doc.company_id,
                external_id: docId,
                receipt_date: recData,
                gross_amount: window.BpoMoney.toDecimalString(recValorCents),
                account: contaBancaria
            };

            await window.BpoSupabase.request('receipts', {
                method: 'POST',
                body: JSON.stringify(recPayload)
            });

            fecharModais();
            await carregarDadosCompetencia();

            if (isLiquidadoTotal) {
                alert('Baixa concluída com sucesso! Documento 100% liquidado.');
            } else {
                const restanteCents = netCents > novoTotalPagoCents ? (netCents - novoTotalPagoCents) : 0n;
                alert(`Baixa parcial de ${window.BpoMoney.formatBRL(recValorCents)} registrada com sucesso!\nSaldo restante a receber: ${window.BpoMoney.formatBRL(restanteCents)}`);
            }
        } catch (err) {
            alert('Erro ao registrar recebimento: ' + err.message);
        }
    }

    async function salvarContrato(e) {
        e.preventDefault();
        const idExistente = document.getElementById('contratoId').value;
        const codigo = document.getElementById('contratoCodigo').value.trim();
        const nome = document.getElementById('contratoNome').value.trim();
        const tipo = document.getElementById('contratoTipo').value;
        const clienteNome = document.getElementById('contratoCliente').value.trim();
        const clienteTipo = document.getElementById('contratoTipoCliente').value;
        const clienteDoc = document.getElementById('contratoDocumento').value.trim();
        
        const elValor = document.getElementById('contratoValorBase') || document.getElementById('contratoValor');
        const valorBaseCents = window.BpoMoney.toCents(elValor ? elValor.value : '0');

        const periodicidade = document.getElementById('contratoPeriodicidade').value;
        const elegivelComissao = document.getElementById('contratoComissao').checked;
        const dataInicio = document.getElementById('contratoInicio')?.value || new Date().toISOString().slice(0, 10);

        const selContratoEmp = document.getElementById('contratoEmpresaId');
        let targetEmpresaId = selContratoEmp ? selContratoEmp.value : null;
        if (!targetEmpresaId) {
            targetEmpresaId = empresaAtivaId !== 'all' ? empresaAtivaId : (empresas[0] ? empresas[0].id : null);
        }

        if (!targetEmpresaId) {
            alert('Selecione uma empresa emitente para o contrato.');
            return;
        }

        try {
            let clientId = null;
            if (clienteNome) {
                // Tenta reaproveitar cliente existente com o mesmo nome na mesma empresa
                let existingPeople = [];
                try {
                    const q = `people?company_id=eq.${targetEmpresaId}&name=eq.${encodeURIComponent(clienteNome)}`;
                    existingPeople = await window.BpoSupabase.request(q, { method: 'GET' });
                } catch (_) {}

                if (existingPeople && existingPeople.length > 0) {
                    clientId = existingPeople[0].id;
                } else {
                    const payloadPessoa = {
                        company_id: targetEmpresaId,
                        name: clienteNome,
                        document_type: clienteTipo === 'PF' ? 'CPF' : 'CNPJ',
                        document: clienteDoc || null,
                        person_type: 'client',
                        active: true
                    };

                    try {
                        const resPessoa = await window.BpoSupabase.request('people', {
                            method: 'POST',
                            body: JSON.stringify(payloadPessoa)
                        });
                        if (resPessoa && resPessoa.length > 0) clientId = resPessoa[0].id;
                    } catch (pErr) {
                        console.warn('Aviso ao cadastrar cliente em people:', pErr.message);
                    }
                }
            }

            const payloadContrato = {
                company_id: targetEmpresaId,
                code: codigo,
                name: nome,
                object: nome,
                client_id: clientId,
                start_date: dataInicio,
                reference_value: window.BpoMoney.toDecimalString(valorBaseCents),
                billing_frequency: periodicidade,
                commission_eligible: elegivelComissao,
                status: 'active'
            };

            // Tenta salvar incluindo contract_type com fallback seguro
            try {
                const payloadComTipo = { ...payloadContrato, contract_type: tipo };
                if (idExistente) {
                    await window.BpoSupabase.request(`contracts?id=eq.${idExistente}`, {
                        method: 'PATCH',
                        body: JSON.stringify(payloadComTipo)
                    });
                } else {
                    await window.BpoSupabase.request('contracts', {
                        method: 'POST',
                        body: JSON.stringify(payloadComTipo)
                    });
                }
            } catch (errTipo) {
                if (errTipo.message && errTipo.message.includes('contract_type')) {
                    if (idExistente) {
                        await window.BpoSupabase.request(`contracts?id=eq.${idExistente}`, {
                            method: 'PATCH',
                            body: JSON.stringify(payloadContrato)
                        });
                    } else {
                        await window.BpoSupabase.request('contracts', {
                            method: 'POST',
                            body: JSON.stringify(payloadContrato)
                        });
                    }
                } else {
                    throw errTipo;
                }
            }

            fecharModais();
            await carregarDadosCompetencia();
            alert('Contrato salvo com sucesso!');
        } catch (err) {
            alert('Erro ao salvar contrato: ' + err.message);
        }
    }

    async function excluirDocumento(docId) {
        const doc = documentos.find(d => d.id === docId);
        const numero = doc ? doc.document_number : 'selecionado';
        if (!confirm(`Deseja realmente excluir o lançamento Nº ${numero}? Esta operação não pode ser desfeita.`)) {
            return;
        }

        try {
            // Remove recibos vinculados se existirem
            try {
                await window.BpoSupabase.request(`receipts?external_id=eq.${docId}`, { method: 'DELETE' });
            } catch (_) {}

            // Remove o documento
            await window.BpoSupabase.request(`billing_documents?id=eq.${docId}`, { method: 'DELETE' });

            fecharModais();
            await carregarDadosCompetencia();
            alert('Lançamento excluído com sucesso!');
        } catch (err) {
            alert('Erro ao excluir lançamento: ' + err.message);
        }
    }
    window.excluirDocumento = excluirDocumento;

    async function excluirContrato(contratoId) {
        const c = contratos.find(x => x.id === contratoId);
        const nome = c ? c.name : 'selecionado';
        if (!confirm(`Deseja realmente excluir o contrato "${nome}"?`)) {
            return;
        }

        try {
            await window.BpoSupabase.request(`contracts?id=eq.${contratoId}`, { method: 'DELETE' });
            fecharModais();
            await carregarDadosCompetencia();
            alert('Contrato excluído com sucesso!');
        } catch (err) {
            alert('Erro ao excluir contrato: ' + err.message);
        }
    }
    window.excluirContrato = excluirContrato;
})();
