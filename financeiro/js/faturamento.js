// ==============================================================================
// faturamento.js — Lógica do Módulo 04 (Controle de Faturamento e Recebimentos)
// Atualizado com suporte a Visão Consolidada Inicial, Filtros Multi-empresa,
// Painel de Impostos/Retenções e Prévia em Tempo Real pelo Motor Puro.
// ==============================================================================

(function() {
    let empresas = [];
    let empresaAtivaId = 'all'; // Default: "Todas as empresas"
    let competenciaAtiva = '';
    let contratoFiltro = '';
    let situacaoFiltro = '';
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
            if (empresaAtivaId === 'all' && empresas.length > 0) {
                // Se estiver no consolidado, solicita escolher para qual empresa ou usa a primeira
            }
            const targetEmpresa = empresaAtivaId !== 'all' ? companiesMap.get(empresaAtivaId) : empresas[0];
            if (!targetEmpresa) { alert('Cadastre ao menos uma empresa primeiro.'); return; }

            document.getElementById('contratoId').value = '';
            document.getElementById('modalContratoTitulo').textContent = `Cadastrar Contrato (${targetEmpresa.name})`;
            document.getElementById('formContrato').reset();
            document.getElementById('contratoTipo').value = 'B2B';
            document.getElementById('contratoTipoCliente').value = 'PJ';
            if (lblDocumento) lblDocumento.textContent = 'CNPJ do Cliente';
            if (inpDocumento) inpDocumento.placeholder = '00.000.000/0000-00';
            document.getElementById('btnExcluirContratoModal').style.display = 'none';
            abrirModal(modalContrato);
        });

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

            // Busca recebimentos da competência/empresa para mapear pagamentos
            let receiptsMap = new Map();
            try {
                let queryRecs = `receipts?order=receipt_date.desc`;
                if (empresaAtivaId !== 'all') {
                    queryRecs += `&company_id=eq.${empresaAtivaId}`;
                }
                const recs = await window.BpoSupabase.request(queryRecs, { method: 'GET' });
                recs.forEach(r => {
                    if (r.external_id && !receiptsMap.has(r.external_id)) {
                        receiptsMap.set(r.external_id, r.receipt_date);
                    }
                });
            } catch (e) {}

            documentos = docsDb.map(d => ({
                ...d,
                payment_date: d.payment_date || receiptsMap.get(d.id) || null
            }));

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
        return documentos.filter(doc => {
            if (contratoFiltro && doc.contract_id !== contratoFiltro) return false;
            if (situacaoFiltro && doc.status !== situacaoFiltro) return false;
            return true;
        });
    }

    function renderizarMetricas() {
        let brutoTotal = 0n;
        let retencoesTotal = 0n;
        let recebidoTotal = 0n;

        // Exclui cancelados das métricas financeiras
        const docsAtivos = getDocumentosFiltrados().filter(d => d.status !== 'cancelled');
        docsAtivos.forEach(doc => {
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
        const docsExibicao = getDocumentosFiltrados();

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
            const statusBadge = getStatusBadge(doc.status);
            const podeReceber = doc.status !== 'paid' && doc.status !== 'cancelled';
            const contrato = contratos.find(c => c.id === doc.contract_id);
            const emp = companiesMap.get(doc.company_id);
            const empBadge = emp ? `<span class="badge badge-primary" style="font-size:0.75rem;">${escapeHtml(emp.trade_name || emp.name)}</span>` : '<span style="color:var(--text-muted);">-</span>';

            const clientLabel = (contrato && contrato._clientName) 
                ? escapeHtml(contrato._clientName)
                : (contrato ? escapeHtml(contrato.name) : '<span style="color:var(--text-muted);font-size:0.8rem;">Sem cliente vinculado</span>');

            const contratoLabel = contrato ? `<span style="font-size:0.8rem; color:var(--text-secondary); display:block;">CTR: ${escapeHtml(contrato.code)}</span>` : '';

            const recebimentoLabel = doc.payment_date 
                ? `<span style="color: var(--color-success); font-weight: 500;">${escapeHtml(formatarData(doc.payment_date))}</span>`
                : '<span style="color: var(--text-muted); font-size: 0.8rem;">Pendente</span>';

            // Impostos atribuídos (campo tax_details ou estimativa gerencial)
            const impostosAtrib = doc.tax_details && doc.tax_details.total_tax
                ? window.BpoMoney.formatBRL(doc.tax_details.total_tax)
                : '<span style="color:var(--text-muted);font-size:0.8rem;">—</span>';

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
                                data-liquido="${escapeHtml(doc.net_amount)}">
                                Baixa
                            </button>
                        ` : ''}
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
                    <td>
                        <button class="btn btn-primary btn-sm btn-editar-contrato" data-id="${escapeHtml(c.id)}">Editar</button>
                    </td>
                </tr>
            `;
        }).join('');

        listaContratosBody.querySelectorAll('.btn-editar-contrato').forEach(btn => {
            btn.addEventListener('click', () => window.editarContrato(btn.dataset.id));
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

    // =========================================================================
    // CONFIGURAÇÃO DO FORMULÁRIO E PRÉVIA DE IMPOSTOS EM TEMPO REAL
    // =========================================================================
    function configurarPainelPreviaImpostos() {
        const inpBruto = document.getElementById('docValorBruto');
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

        // Toggles visuais
        chkIrrf.addEventListener('change', () => {
            boxIrrf.style.display = chkIrrf.checked ? 'block' : 'none';
            dispararPreviaImpostos();
        });

        chkInss.addEventListener('change', () => {
            boxInss.style.display = chkInss.checked ? 'block' : 'none';
            dispararPreviaImpostos();
        });

        // Eventos que recalculam a prévia
        [inpBruto, aliqIrrf, aliqInss, aliqIss].forEach(el => {
            if (el) el.addEventListener('input', dispararPreviaImpostos);
        });

        [selEmpresa, selContrato, selItemTipo, chkIssRetido].forEach(el => {
            if (el) el.addEventListener('change', dispararPreviaImpostos);
        });

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

    function dispararPreviaImpostos() {
        if (debounceTimerPrevia) clearTimeout(debounceTimerPrevia);
        debounceTimerPrevia = setTimeout(executarPreviaImpostos, 80);
    }

    function executarPreviaImpostos() {
        requestIdPrevia++;
        const currentReq = requestIdPrevia;

        const companyId = document.getElementById('docEmpresaId').value;
        const brutoStr = document.getElementById('docValorBruto').value;
        const brutoCents = window.BpoMoney.toCents(brutoStr);

        const chkIrrf = document.getElementById('chkIrrf').checked;
        const aliqIrrfVal = parseFloat(document.getElementById('aliqIrrf').value) || 0;

        const chkInss = document.getElementById('chkInss').checked;
        const aliqInssVal = parseFloat(document.getElementById('aliqInss').value) || 0;

        const aliqIssVal = parseFloat(document.getElementById('aliqIss').value) || 0;
        const chkIssRetido = document.getElementById('chkIssRetido').checked;
        const itemTipo = document.getElementById('docItemTipo').value || 'servico';

        const emp = companiesMap.get(companyId);

        // Invoca o motor tributário puro unificado BpoTaxEngine (sem persistência)
        const params = {
            grossAmountCents: brutoCents,
            regime: emp ? emp.tax_regime : 'lucro_presumido',
            competence: competenciaAtiva,
            itemType: itemTipo,
            hasIrrf: chkIrrf,
            irrfAliq: aliqIrrfVal,
            hasInss: chkInss,
            inssAliq: aliqInssVal,
            issAliq: aliqIssVal,
            isIssRetained: chkIssRetido,
            rbt12Cents: 36000000n, // R$ 360k referência se simples
            simplesAnnex: 'anexo_iii'
        };

        const previa = window.BpoTaxEngine ? window.BpoTaxEngine.calcularPreviaNota(params) : null;

        // Proteção contra resposta concorrente antiga sobrescrevendo a nova
        if (currentReq !== requestIdPrevia) return;

        if (!previa) return;

        // Atualiza campos de saída na tela
        document.getElementById('valIrrfPreview').textContent = window.BpoMoney.toDecimalString(previa.retentions.irrf);
        document.getElementById('valInssPreview').textContent = window.BpoMoney.toDecimalString(previa.retentions.inss);

        document.getElementById('docRetencoes').value = window.BpoMoney.toDecimalString(previa.totalRetentions);
        document.getElementById('docValorLiquido').value = window.BpoMoney.toDecimalString(previa.netReceivable);

        document.getElementById('previaTotalImpostos').textContent = window.BpoMoney.formatBRL(previa.totalTaxes);
        document.getElementById('previaTotalRetencoes').textContent = window.BpoMoney.formatBRL(previa.totalRetentions);
        document.getElementById('previaLiquidoEconomico').textContent = window.BpoMoney.formatBRL(previa.netEconomic);

        const pendenciasBox = document.getElementById('previaPendenciasTexto');
        if (previa.pendingIssues && previa.pendingIssues.length > 0) {
            pendenciasBox.textContent = `Pendências fiscais: ${previa.pendingIssues.join(', ')}`;
            pendenciasBox.style.display = 'block';
        } else {
            pendenciasBox.style.display = 'none';
        }
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
        document.getElementById('chkIrrf').checked = false;
        document.getElementById('boxIrrfConfig').style.display = 'none';
        document.getElementById('aliqIrrf').value = '4.8';
        document.getElementById('chkInss').checked = false;
        document.getElementById('boxInssConfig').style.display = 'none';
        document.getElementById('aliqInss').value = '11';
        document.getElementById('aliqIss').value = '5.0';
        document.getElementById('chkIssRetido').checked = false;

        executarPreviaImpostos();
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
        document.getElementById('docDescricao').value = d.description || '';

        // Carrega dados de retenção se existirem em tax_details
        if (d.tax_details) {
            if (d.tax_details.has_irrf) {
                document.getElementById('chkIrrf').checked = true;
                document.getElementById('boxIrrfConfig').style.display = 'block';
                if (d.tax_details.irrf_aliq) document.getElementById('aliqIrrf').value = d.tax_details.irrf_aliq;
            }
            if (d.tax_details.has_inss) {
                document.getElementById('chkInss').checked = true;
                document.getElementById('boxInssConfig').style.display = 'block';
                if (d.tax_details.inss_aliq) document.getElementById('aliqInss').value = d.tax_details.inss_aliq;
            }
            if (d.tax_details.iss_aliq) document.getElementById('aliqIss').value = d.tax_details.iss_aliq;
            if (d.tax_details.iss_retained) document.getElementById('chkIssRetido').checked = true;
            if (d.tax_details.item_type) document.getElementById('docItemTipo').value = d.tax_details.item_type;
        }

        document.getElementById('btnExcluirDocumentoModal').style.display = 'inline-flex';
        executarPreviaImpostos();
        abrirModal(modalDocumento);
    };

    // Modal de Recebimento
    window.abrirModalRecebimento = function(id, numero, valorLiquido) {
        document.getElementById('recDocId').value = id;
        document.getElementById('recDocIdentificacao').value = `Doc: ${numero} | Valor: ${window.BpoMoney.formatBRL(valorLiquido)}`;
        document.getElementById('recValor').value = window.BpoMoney.toDecimalString(window.BpoMoney.toCents(valorLiquido));
        
        const hoje = new Date().toISOString().split('T')[0];
        document.getElementById('recData').value = hoje;

        abrirModal(modalRecebimento);
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

        const tipo = document.getElementById('docTipo').value;
        const itemTipo = document.getElementById('docItemTipo').value;
        const serie = '1';
        const numero = document.getElementById('docNumero').value.trim();
        const emissao = document.getElementById('docEmissao').value;
        const vencimento = document.getElementById('docVencimento').value;
        const dataRecebimento = document.getElementById('docRecebimento').value || null;
        const brutoCents = window.BpoMoney.toCents(document.getElementById('docValorBruto').value);
        const retCents = window.BpoMoney.toCents(document.getElementById('docRetencoes').value);
        const discountsCents = 0n;
        const liqCents = brutoCents - discountsCents - retCents;
        const descricao = document.getElementById('docDescricao').value.trim();
        const contratoId = document.getElementById('docContrato').value || null;

        if (liqCents < 0n) {
            alert('As retenções não podem ser maiores que o valor bruto.');
            return;
        }

        const taxDetailsPayload = {
            item_type: itemTipo,
            has_irrf: document.getElementById('chkIrrf').checked,
            irrf_aliq: parseFloat(document.getElementById('aliqIrrf').value) || 0,
            has_inss: document.getElementById('chkInss').checked,
            inss_aliq: parseFloat(document.getElementById('aliqInss').value) || 0,
            iss_aliq: parseFloat(document.getElementById('aliqIss').value) || 0,
            iss_retained: document.getElementById('chkIssRetido').checked
        };

        const payload = {
            company_id: companyId,
            competence_month: competenciaAtiva,
            document_type: tipo,
            series: serie,
            document_number: numero,
            issue_date: emissao,
            due_date: vencimento,
            gross_amount: window.BpoMoney.toDecimalString(brutoCents),
            discounts: '0.00',
            retentions: window.BpoMoney.toDecimalString(retCents),
            net_amount: window.BpoMoney.toDecimalString(liqCents),
            description: descricao,
            contract_id: contratoId,
            status: dataRecebimento ? 'paid' : 'emitted',
            payment_date: dataRecebimento
        };

        try {
            if (docId) {
                await window.BpoSupabase.request(`billing_documents?id=eq.${docId}`, {
                    method: 'PATCH',
                    body: JSON.stringify(payload)
                });
            } else {
                await window.BpoSupabase.request('billing_documents', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
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

        try {
            await window.BpoSupabase.request(`billing_documents?id=eq.${docId}`, {
                method: 'PATCH',
                body: JSON.stringify({
                    status: 'paid',
                    payment_date: recData
                })
            });

            fecharModais();
            await carregarDadosCompetencia();
            alert('Recebimento baixado com sucesso!');
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
        const valorBaseCents = window.BpoMoney.toCents(document.getElementById('contratoValorBase').value);
        const periodicidade = document.getElementById('contratoPeriodicidade').value;
        const elegivelComissao = document.getElementById('contratoComissao').checked;

        const targetEmpresa = empresaAtivaId !== 'all' ? companiesMap.get(empresaAtivaId) : empresas[0];

        try {
            let clientId = null;
            if (clienteNome) {
                const payloadPessoa = {
                    company_id: targetEmpresa.id,
                    name: clienteNome,
                    document_type: clienteTipo === 'PF' ? 'CPF' : 'CNPJ',
                    document: clienteDoc,
                    cpf: clienteTipo === 'PF' ? clienteDoc : null,
                    cnpj: clienteTipo === 'PJ' ? clienteDoc : null,
                    is_client: true,
                    active: true
                };

                const resPessoa = await window.BpoSupabase.request('people', {
                    method: 'POST',
                    body: JSON.stringify(payloadPessoa)
                });
                if (resPessoa && resPessoa.length > 0) clientId = resPessoa[0].id;
            }

            const payloadContrato = {
                company_id: targetEmpresa.id,
                code: codigo,
                name: nome,
                contract_type: tipo,
                client_id: clientId,
                reference_value: window.BpoMoney.toDecimalString(valorBaseCents),
                billing_frequency: periodicidade,
                commission_eligible: elegivelComissao,
                status: 'active'
            };

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

            fecharModais();
            await carregarDadosCompetencia();
            alert('Contrato salvo com sucesso!');
        } catch (err) {
            alert('Erro ao salvar contrato: ' + err.message);
        }
    }
})();
