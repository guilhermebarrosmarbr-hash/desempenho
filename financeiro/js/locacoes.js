// ==============================================================================
// locacoes.js — Lógica do Módulo 08 (Locações e Rateio Societário Ybox)
// Dois tipos de repasse: Honorários (taxa adm sobre o bruto) e Cotas (% do líquido)
// IPTU: lido dos billing_documents de locação do período (campo tax_details.iptu_valor)
// DAS:  lido dos billing_documents de locação do período (campo tax_details.das_valor)
// ==============================================================================

(function() {
    let empresas = [];
    let empresaAtiva = null;
    let competenciaAtiva = '';
    let imoveis = [];           // properties[]
    let contratosLocacao = [];  // rental_contracts[]
    let distribuicoes = [];     // rental_distributions[]
    let pessoas = [];           // people[] — sócios/locatários
    let cotasForm = [];         // estado local das cotas no formulário do contrato
    let todosContratos = [];    // contracts[] de todas as empresas (para o select de imóvel)

    // DOM
    const selectEmpresa          = document.getElementById('selectEmpresa');
    const inputCompetencia       = document.getElementById('inputCompetencia');
    const listaDistribuicoesBody = document.getElementById('listaDistribuicoesBody');

    // Métricas
    const valAlugueisBruto = document.getElementById('valAlugueisBruto');
    const valDeducoes      = document.getElementById('valDeducoes');
    const valHonorarios    = document.getElementById('valHonorarios');
    const valDistribuivel  = document.getElementById('valDistribuivel');

    // Modais
    const modalSocios          = document.getElementById('modalSocios');
    const modalCadastroSocio   = document.getElementById('modalCadastroSocio');
    const modalContratoLocacao = document.getElementById('modalContratoLocacao');

    // =========================================================================
    // INICIALIZAÇÃO
    // =========================================================================
    window.addEventListener('DOMContentLoaded', async () => {
        const hoje = new Date();
        competenciaAtiva = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
        if (inputCompetencia) inputCompetencia.value = competenciaAtiva;

        await carregarEmpresas();

        if (selectEmpresa) {
            selectEmpresa.addEventListener('change', async (e) => {
                empresaAtiva = empresas.find(emp => emp.id === e.target.value) || null;
                await carregarDadosLocacoes();
            });
        }

        if (inputCompetencia) {
            inputCompetencia.addEventListener('change', async (e) => {
                competenciaAtiva = e.target.value;
                await carregarDadosLocacoes();
            });
        }

        // Botão + Contrato de Locação
        const btnContrato = document.getElementById('btnNovoContratoLocacao');
        if (btnContrato) btnContrato.addEventListener('click', () => abrirModalContrato());

        // Botão Processar Rateio
        const btnProcessar = document.getElementById('btnProcessarDistribuicao');
        if (btnProcessar) btnProcessar.addEventListener('click', processarRateio);

        // Botão Sócios
        const btnSocios = document.getElementById('btnParticipantesSocios');
        if (btnSocios) btnSocios.addEventListener('click', abrirModalSocios);

        // Botão Gerenciar Contratos
        const btnGerenciarContratos = document.getElementById('btnGerenciarContratos');
        if (btnGerenciarContratos) btnGerenciarContratos.addEventListener('click', abrirModalGerenciarContratos);

        // Novo Sócio dentro do modal de sócios
        const btnNovoSocio = document.getElementById('btnNovoSocio');
        if (btnNovoSocio) btnNovoSocio.addEventListener('click', () => abrirFormSocio());

        // Adicionar cota no formulário de contrato
        const btnAdicionarCota = document.getElementById('btnAdicionarCota');
        if (btnAdicionarCota) btnAdicionarCota.addEventListener('click', adicionarLinhaCotas);

        // Forms
        const formSocio = document.getElementById('formSocio');
        if (formSocio) formSocio.addEventListener('submit', salvarSocio);

        const formContrato = document.getElementById('formContratoLocacao');
        if (formContrato) formContrato.addEventListener('submit', salvarContratoLocacao);

        // Delegate: quitar repasse
        if (listaDistribuicoesBody) {
            listaDistribuicoesBody.addEventListener('click', (e) => {
                const btn = e.target.closest('.btn-quitar-repasse');
                if (btn) window.quitarDistribuicao(btn.dataset.id);
            });
        }
    });

    // =========================================================================
    // FECHAR MODAIS
    // =========================================================================
    window.fecharModais = function() {
        if (modalSocios)              modalSocios.style.display = 'none';
        if (modalCadastroSocio)       modalCadastroSocio.style.display = 'none';
        if (modalContratoLocacao)     modalContratoLocacao.style.display = 'none';
        const mgc = document.getElementById('modalGerenciarContratos');
        if (mgc) mgc.style.display = 'none';
    };

    window.voltarParaSocios = function() {
        if (modalCadastroSocio)  modalCadastroSocio.style.display = 'none';
        if (modalSocios)         modalSocios.style.display = 'flex';
    };

    // =========================================================================
    // MODAL GERENCIAR CONTRATOS DE LOCAÇÃO
    // =========================================================================
    function abrirModalGerenciarContratos() {
        const modal = document.getElementById('modalGerenciarContratos');
        const tbody = document.getElementById('tabelaContratosBody');
        const info  = document.getElementById('totalContratosInfo');
        if (!modal || !tbody) return;

        if (contratosLocacao.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#888; padding:32px;">
                Nenhum contrato cadastrado. Clique em <strong>+ Contrato de Locação</strong> para criar o primeiro.
            </td></tr>`;
            if (info) info.textContent = '';
        } else {
            tbody.innerHTML = contratosLocacao.map(cl => {
                const imovel = imoveis.find(i => i.id === cl.property_id);
                // Empresa locatária lida de properties.address
                let tenantName = '—';
                if (imovel) {
                    let meta = {};
                    try { meta = JSON.parse(imovel.address || '{}'); } catch {}
                    const tenantEmp = empresas.find(e => e.id === meta.tenant_company_id);
                    tenantName = tenantEmp ? escapeHtml(tenantEmp.trade_name || tenantEmp.name) : '—';
                }
                const nomeImovel = imovel ? escapeHtml(imovel.name) : `Imóvel (${cl.property_id.slice(0,8)}...)`;
                const valor = window.BpoMoney.formatBRL(cl.monthly_amount);
                const statusBadge = cl.status === 'active'
                    ? '<span style="background:#22c55e22; color:#22c55e; padding:2px 8px; border-radius:4px; font-size:0.78rem;">Ativo</span>'
                    : '<span style="background:#ef444422; color:#ef4444; padding:2px 8px; border-radius:4px; font-size:0.78rem;">Inativo</span>';

                return `<tr style="border-bottom:1px solid rgba(255,255,255,0.06); transition:background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background=''">
                    <td style="padding:12px 12px; color:#fff; font-weight:500;">${nomeImovel}</td>
                    <td style="padding:12px 12px; color:#ccc;">${tenantName}</td>
                    <td style="padding:12px 12px; text-align:right; color:#4ade80; font-weight:600;">${escapeHtml(valor)}</td>
                    <td style="padding:12px 12px; text-align:center; color:#ccc;">Dia ${cl.due_day || 10}</td>
                    <td style="padding:12px 12px; text-align:center;">${statusBadge}</td>
                    <td style="padding:12px 12px; text-align:center;">
                        <button class="btn btn-secondary btn-sm" onclick="window.editarContrato('${escapeHtml(cl.id)}')" style="margin-right:6px; padding:4px 10px; font-size:0.8rem;">✏️ Editar</button>
                        <button class="btn btn-danger btn-sm" onclick="window.excluirContrato('${escapeHtml(cl.id)}')" style="padding:4px 10px; font-size:0.8rem;">🗑️ Excluir</button>
                    </td>
                </tr>`;
            }).join('');
            if (info) info.textContent = `${contratosLocacao.length} contrato(s) cadastrado(s)`;
        }

        modal.style.display = 'flex';
    }

    window.editarContrato = function(id) {
        const contrato = contratosLocacao.find(cl => cl.id === id);
        if (!contrato) return;
        fecharModais();
        abrirModalContrato(contrato);
    };

    window.excluirContrato = async function(id) {
        if (!confirm('Tem certeza que deseja excluir este contrato de locação?\nEsta ação também removerá os participantes vinculados.')) return;
        try {
            // Remove participantes do imóvel vinculado
            const contrato = contratosLocacao.find(cl => cl.id === id);
            if (contrato?.property_id) {
                const partics = await window.BpoSupabase.request(
                    `property_participants?property_id=eq.${contrato.property_id}`, { method: 'GET' }
                ) || [];
                for (const p of partics) {
                    await window.BpoSupabase.request(`property_participants?id=eq.${p.id}`, { method: 'DELETE' });
                }
            }
            await window.BpoSupabase.request(`rental_contracts?id=eq.${id}`, { method: 'DELETE' });
            await carregarDadosLocacoes();
            abrirModalGerenciarContratos(); // recarrega a lista
            alert('Contrato excluído com sucesso.');
        } catch (err) {
            alert('Erro ao excluir contrato: ' + err.message);
        }
    };

    // =========================================================================
    // FILTRAR CONTRATOS POR EMPRESA LOCATÁRIA
    // Popula o select de contrato/imóvel com os contratos da empresa selecionada
    // =========================================================================
    function filtrarContratosPorEmpresa(companyId, selContratoRef) {
        if (!selContratoRef) return;
        if (!companyId) {
            selContratoRef.innerHTML = '<option value="">Selecione primeiro a empresa locatária...</option>';
            return;
        }
        const contratosDaEmpresa = todosContratos.filter(c => c.company_id === companyId);
        if (contratosDaEmpresa.length === 0) {
            selContratoRef.innerHTML = '<option value="">Nenhum contrato cadastrado para esta empresa</option>';
            return;
        }
        selContratoRef.innerHTML = '<option value="">Selecione o contrato (imóvel)...</option>' +
            contratosDaEmpresa.map(c => {
                const label = c.code ? `${c.code} — ${c.name}` : c.name;
                return `<option value="${escapeHtml(c.id)}" data-name="${escapeHtml(label)}">${escapeHtml(label)}</option>`;
            }).join('');
    }

    // =========================================================================
    // CARREGAMENTO DE DADOS
    // =========================================================================
    async function carregarEmpresas() {
        try {
            empresas = await window.BpoSupabase.request('companies?order=name.asc', { method: 'GET' }) || [];
            if (!selectEmpresa) return;
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

            // Prioriza Ybox
            const ybox = empresas.find(e => (e.trade_name || e.name || '').toLowerCase().includes('ybox'));
            empresaAtiva = ybox || empresas[0];
            selectEmpresa.value = empresaAtiva.id;

            await carregarDadosLocacoes();
        } catch (err) {
            console.error('Erro ao carregar empresas:', err);
        }
    }

    async function carregarDadosLocacoes() {
        if (!empresaAtiva) return;
        try {
            // 1. Pessoas (sócios/locatários) da empresa
            pessoas = await window.BpoSupabase.request(
                `people?company_id=eq.${empresaAtiva.id}&order=name.asc`,
                { method: 'GET' }
            ) || [];

            // 2. Imóveis da empresa
            imoveis = await window.BpoSupabase.request(
                `properties?company_id=eq.${empresaAtiva.id}&order=name.asc`,
                { method: 'GET' }
            ) || [];

            // 3. Contratos de locação ativos
            if (imoveis.length > 0) {
                const idsParam = `in.(${imoveis.map(i => i.id).join(',')})`;
                contratosLocacao = await window.BpoSupabase.request(
                    `rental_contracts?property_id=${idsParam}&order=created_at.desc`,
                    { method: 'GET' }
                ) || [];
            } else {
                contratosLocacao = [];
            }

            // 4. Todos os contratos do sistema (para o select de imóvel no modal)
            todosContratos = await window.BpoSupabase.request(
                'contracts?order=company_id.asc,code.asc',
                { method: 'GET' }
            ) || [];

            // 5. Distribuições da competência (filtradas pelos imóveis da empresa — company_id não existe em rental_distributions)
            if (imoveis.length > 0) {
                const idsImov = imoveis.map(i => i.id).join(',');
                distribuicoes = await window.BpoSupabase.request(
                    `rental_distributions?property_id=in.(${idsImov})&competence_month=eq.${competenciaAtiva}&order=property_id.asc`,
                    { method: 'GET' }
                ) || [];
            } else {
                distribuicoes = [];
            }

            await renderizarExtrato(); // async (busca billing_documents internamente)

        } catch (err) {
            console.error('Erro ao carregar dados de locações:', err);
        }
    }

    // =========================================================================
    // BUSCAR DADOS DOS BILLING_DOCUMENTS DO PERÍODO
    // Retorna mapa: property_id → { iptuCents, dasCents, jurosMult, descontoCents, dataRecebimento, recebido }
    // =========================================================================
    async function buscarDeducoesDoFaturamento() {
        const mapImovel = new Map();
        try {
            const docs = await window.BpoSupabase.request(
                `billing_documents?company_id=eq.${empresaAtiva.id}&status=neq.cancelled`,
                { method: 'GET' }
            ) || [];

            docs.forEach(d => {
                let td = {};
                if (d.tax_details && typeof d.tax_details === 'object') {
                    td = d.tax_details;
                } else if (d.description && typeof d.description === 'string') {
                    const match = d.description.match(/<!--bpo_tax_details:(.*?)-->/);
                    if (match) { try { td = JSON.parse(match[1]); } catch (e) {} }
                }

                // Apenas documentos de locação
                if (!td.is_locacao && d.document_type !== 'locacao') return;

                // Data de recebimento (regime de caixa)
                const dataRec = td.payment_date || d.payment_date || d.receipt_date || null;
                const mesRec  = dataRec ? String(dataRec).slice(0, 7) : '';
                const recebido = !!dataRec && d.status === 'paid';

                // Para o mês da competência ativa OU em aberto (sem data)
                if (mesRec && mesRec !== competenciaAtiva) return;

                // Localiza imóvel pelo contrato
                const contrato = contratosLocacao.find(c => c.id === d.contract_id);
                if (!contrato) return;
                const propId = contrato.property_id;
                if (!mapImovel.has(propId)) {
                    mapImovel.set(propId, {
                        grossCents:    null,
                        iptuCents:     0n,
                        dasCents:      0n,
                        jurosMult:     0n,
                        descontoCents: 0n,
                        dataRecebimento: null,
                        recebido:      false,
                        contract_id:   contrato.id
                    });
                }

                const entry = mapImovel.get(propId);
                entry.recebido = recebido;
                if (dataRec) entry.dataRecebimento = String(dataRec).slice(0, 10);

                // Valor bruto do billing_document (gross_amount)
                if (d.gross_amount) entry.grossCents = window.BpoMoney.toCents(d.gross_amount);

                if (td.iptu_valor)   entry.iptuCents     += window.BpoMoney.toCents(td.iptu_valor);
                if (td.das_valor)    entry.dasCents      += window.BpoMoney.toCents(td.das_valor);

                // Juros/multa: campos multa_valor + juros_valor (ou fallback em tax_details)
                const jurosV = td.juros_valor || td.juros || 0;
                const multaV = td.multa_valor || td.multa || 0;
                entry.jurosMult += window.BpoMoney.toCents(jurosV) + window.BpoMoney.toCents(multaV);

                // Desconto contratual
                const descV = td.desconto_valor || d.discounts || 0;
                entry.descontoCents += window.BpoMoney.toCents(descV);

                // Lucro Presumido: soma impostos
                if (!td.is_simples && td.is_locacao) {
                    ['pis_valor', 'cofins_valor', 'irpj_valor', 'csll_valor'].forEach(campo => {
                        if (td[campo]) entry.dasCents += window.BpoMoney.toCents(td[campo]);
                    });
                }
            });
        } catch (e) {
            console.warn('Aviso: não foi possível buscar deduções do faturamento:', e);
        }
        return mapImovel;
    }

    // =========================================================================
    // MÉTRICAS
    // =========================================================================
    function renderizarMetricas() {
        let brutoTotal      = 0n;
        let deducoesTotal   = 0n;
        let honorariosTotal = 0n;
        let cotasTotal      = 0n;

        const imoveisProcessados = new Set();
        distribuicoes.forEach(d => {
            // Discrimina tipo pelo idempotency_key (hon_ = honorários, cota_ = cota)
            const tipo = (d.idempotency_key || '').startsWith('hon_') ? 'honorarios' : 'cota';

            if (!imoveisProcessados.has(d.property_id)) {
                imoveisProcessados.add(d.property_id);
                brutoTotal    += window.BpoMoney.toCents(d.gross_received);
                deducoesTotal += window.BpoMoney.toCents(d.deductions);
            }

            if (tipo === 'honorarios') {
                honorariosTotal += window.BpoMoney.toCents(d.distribution_amount);
            } else {
                cotasTotal += window.BpoMoney.toCents(d.distribution_amount);
            }
        });

        if (valAlugueisBruto) valAlugueisBruto.textContent = window.BpoMoney.formatBRL(brutoTotal);
        if (valDeducoes)      valDeducoes.textContent      = window.BpoMoney.formatBRL(deducoesTotal);
        if (valHonorarios)    valHonorarios.textContent    = window.BpoMoney.formatBRL(honorariosTotal);
        if (valDistribuivel)  valDistribuivel.textContent  = window.BpoMoney.formatBRL(cotasTotal);
    }

    // =========================================================================
    // TABELA GESTÃO DE LOCAÇÕES (estilo planilha)
    // =========================================================================
    async function renderizarExtrato() {
        const tbody = document.getElementById('listaDistribuicoesBody');
        const thead = document.getElementById('tabelaGestaoLocacoesHead');
        const tfoot = document.getElementById('tabelaGestaoLocacoesFoot');
        if (!tbody) return;

        if (contratosLocacao.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; color:#6b7280; padding:40px;">
                Nenhum contrato cadastrado. Clique em <strong>+ Contrato de Locação</strong> para criar o primeiro.
            </td></tr>`;
            return;
        }

        // Busca dados de faturamento (IPTU, DAS, juros/multa, recebimento)
        const mapFat = await buscarDeducoesDoFaturamento();

        // Busca todos os participantes dos imóveis
        const imovelIds = imoveis.map(i => i.id);
        let participantesAll = [];
        if (imovelIds.length > 0) {
            participantesAll = await window.BpoSupabase.request(
                `property_participants?property_id=in.(${imovelIds.join(',')})&order=participation_pct.desc`,
                { method: 'GET' }
            ) || [];
        }

        // Coleta todos os sócios (cota, participation_pct > 0) únicos para montar colunas
        const sociosSet = new Map(); // person_id → nome
        participantesAll.forEach(p => {
            if (parseFloat(p.participation_pct) > 0 && !sociosSet.has(p.person_id)) {
                const pessoa = pessoas.find(ps => ps.id === p.person_id);
                const primeiroNome = pessoa ? (pessoa.name || '').split(' ')[0] : p.person_id.slice(0, 6);
                sociosSet.set(p.person_id, primeiroNome);
            }
        });
        const sociosCols = Array.from(sociosSet.entries()); // [[id, nome], ...]

        // Atualiza cabeçalho com colunas dinâmicas de sócios
        if (thead) {
            const thBase = `
                <tr style="background:#111827; color:#9ca3af; text-transform:uppercase; font-size:0.72rem; letter-spacing:0.05em;">
                    <th style="padding:10px 10px; text-align:left; border-bottom:2px solid rgba(255,255,255,0.1); position:sticky; left:0; background:#111827; z-index:2;">Contrato</th>
                    <th style="padding:10px 10px; text-align:right; border-bottom:2px solid rgba(255,255,255,0.1);">Valor Bruto</th>
                    <th style="padding:10px 10px; text-align:right; border-bottom:2px solid rgba(255,255,255,0.1);">IPTU</th>
                    <th style="padding:10px 10px; text-align:right; border-bottom:2px solid rgba(255,255,255,0.1);">Desconto</th>
                    <th style="padding:10px 10px; text-align:right; border-bottom:2px solid rgba(255,255,255,0.1);">Juros/Multa</th>
                    <th style="padding:10px 10px; text-align:right; border-bottom:2px solid rgba(255,255,255,0.1);">DAS</th>
                    <th style="padding:10px 10px; text-align:right; border-bottom:2px solid rgba(255,255,255,0.1);">Honorários</th>
                    <th style="padding:10px 10px; text-align:right; border-bottom:2px solid rgba(255,255,255,0.1); font-weight:700; color:#fff;">Líquido</th>
                    ${sociosCols.map(([id, nome]) =>
                        `<th style="padding:10px 8px; text-align:right; border-bottom:2px solid rgba(255,255,255,0.1);">${escapeHtml(nome)}</th>`
                    ).join('')}
                    <th style="padding:10px 10px; text-align:center; border-bottom:2px solid rgba(255,255,255,0.1);">Recebimento</th>
                </tr>`;
            thead.innerHTML = thBase;
        }

        // Totais para rodapé
        let totBruto = 0n, totIptu = 0n, totDesc = 0n, totJuros = 0n, totDas = 0n, totHon = 0n, totLiq = 0n;
        const totSocios = new Map(sociosCols.map(([id]) => [id, 0n]));
        let totRecebidoLiq = 0n;

        const linhas = contratosLocacao.map(cl => {
            const imovel = imoveis.find(i => i.id === cl.property_id);
            const fat    = mapFat.get(cl.property_id) || {};
            let meta = {};
            try { meta = JSON.parse(imovel?.address || '{}'); } catch {}

            // Valores
            // Valor bruto = gross_amount do billing_document da competência; fallback: monthly_amount do contrato
            const brutoCents = fat.grossCents || window.BpoMoney.toCents(cl.monthly_amount);
            const iptuCents  = fat.iptuCents  || 0n;
            const dasCents   = fat.dasCents   || 0n;
            const jurosCents = fat.jurosMult  || 0n;
            const descCents  = fat.descontoCents || (meta.discount ? window.BpoMoney.toCents(meta.discount) : 0n);

            // Honorários: procura participante com admin_pct > 0
            const partImovel = participantesAll.filter(p => p.property_id === cl.property_id);
            const admPart = partImovel.find(p => parseFloat(p.admin_pct) > 0);
            const admPct  = admPart ? parseFloat(admPart.admin_pct) : (parseFloat(meta.admin_pct) || 0);
            const honCents = admPct > 0 ? window.BpoMoney.applyPercentage(brutoCents, admPct) : 0n;

            // Líquido = Bruto − IPTU − Desconto − DAS − Honorários (juros/multa entra positivo)
            const liqCents = brutoCents - iptuCents - descCents - dasCents - honCents + jurosCents;

            // Recebimento
            const recebido = fat.recebido || false;
            const dataRec  = fat.dataRecebimento;
            const statusCell = recebido
                ? `<span style="background:#16a34a22; color:#22c55e; padding:2px 8px; border-radius:4px; font-size:0.78rem;">${dataRec || 'Recebido'}</span>`
                : `<span style="background:#ef444422; color:#ef4444; padding:2px 8px; border-radius:4px; font-size:0.78rem;">Em Aberto</span>`;

            // Cotas por sócio
            const cotasCells = sociosCols.map(([socioId]) => {
                const pp = partImovel.find(p => p.person_id === socioId && parseFloat(p.participation_pct) > 0);
                if (!pp) return `<td style="padding:9px 8px; text-align:right; color:#6b7280;">—</td>`;
                const pct    = parseFloat(pp.participation_pct);
                const valor  = window.BpoMoney.applyPercentage(liqCents, pct);
                const exibir = recebido ? valor : 0n;
                if (recebido) totSocios.set(socioId, (totSocios.get(socioId) || 0n) + valor);
                return `<td style="padding:9px 8px; text-align:right; color:#a3e635; font-size:0.8rem;">
                    ${recebido ? escapeHtml(window.BpoMoney.formatBRL(exibir)) : '<span style="color:#6b7280">—</span>'}
                </td>`;
            });

            // Acumula totais
            totBruto += brutoCents;
            totIptu  += iptuCents;
            totDesc  += descCents;
            totJuros += jurosCents;
            totDas   += dasCents;
            totHon   += honCents;
            totLiq   += liqCents;
            if (recebido) totRecebidoLiq += liqCents;

            const nomeImovel = imovel ? escapeHtml(imovel.name) : `Imóvel (${cl.property_id.slice(0,8)})`;
            const rowBg = recebido ? '' : 'background:rgba(239,68,68,0.04);';

            return `<tr style="border-bottom:1px solid rgba(255,255,255,0.05); ${rowBg}" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background='${recebido ? '' : 'rgba(239,68,68,0.04)'}'">
                <td style="padding:9px 10px; color:#fff; font-weight:500; position:sticky; left:0; background:#0f172a; z-index:1; max-width:200px; overflow:hidden; text-overflow:ellipsis;" title="${nomeImovel}">${nomeImovel}</td>
                <td style="padding:9px 10px; text-align:right; color:#4ade80; font-weight:600;">${escapeHtml(window.BpoMoney.formatBRL(brutoCents))}</td>
                <td style="padding:9px 10px; text-align:right; color:${iptuCents > 0n ? '#f87171' : '#6b7280'};">${iptuCents > 0n ? escapeHtml(window.BpoMoney.formatBRL(iptuCents)) : '—'}</td>
                <td style="padding:9px 10px; text-align:right; color:${descCents > 0n ? '#f87171' : '#6b7280'};">${descCents > 0n ? escapeHtml(window.BpoMoney.formatBRL(descCents)) : '—'}</td>
                <td style="padding:9px 10px; text-align:right; color:${jurosCents > 0n ? '#a3e635' : '#6b7280'};">${jurosCents > 0n ? escapeHtml(window.BpoMoney.formatBRL(jurosCents)) : '—'}</td>
                <td style="padding:9px 10px; text-align:right; color:${dasCents > 0n ? '#f87171' : '#6b7280'};">${dasCents > 0n ? escapeHtml(window.BpoMoney.formatBRL(dasCents)) : '—'}</td>
                <td style="padding:9px 10px; text-align:right; color:${honCents > 0n ? '#fbbf24' : '#6b7280'};">${honCents > 0n ? escapeHtml(window.BpoMoney.formatBRL(honCents)) : '—'}</td>
                <td style="padding:9px 10px; text-align:right; color:#60a5fa; font-weight:700;">${escapeHtml(window.BpoMoney.formatBRL(liqCents))}</td>
                ${cotasCells.join('')}
                <td style="padding:9px 10px; text-align:center;">${statusCell}</td>
            </tr>`;
        });

        tbody.innerHTML = linhas.join('');

        // Rodapé de totais
        if (tfoot) {
            const colsCount = 8 + sociosCols.length + 1;
            tfoot.innerHTML = `<tr style="background:#1e3a5f; border-top:2px solid #3b82f6; font-weight:700; font-size:0.82rem;">
                <td style="padding:10px 10px; color:#93c5fd; position:sticky; left:0; background:#1e3a5f;">TOTAL</td>
                <td style="padding:10px 10px; text-align:right; color:#4ade80;">${escapeHtml(window.BpoMoney.formatBRL(totBruto))}</td>
                <td style="padding:10px 10px; text-align:right; color:#f87171;">${totIptu > 0n ? escapeHtml(window.BpoMoney.formatBRL(totIptu)) : '—'}</td>
                <td style="padding:10px 10px; text-align:right; color:#f87171;">${totDesc > 0n ? escapeHtml(window.BpoMoney.formatBRL(totDesc)) : '—'}</td>
                <td style="padding:10px 10px; text-align:right; color:#a3e635;">${totJuros > 0n ? escapeHtml(window.BpoMoney.formatBRL(totJuros)) : '—'}</td>
                <td style="padding:10px 10px; text-align:right; color:#f87171;">${totDas > 0n ? escapeHtml(window.BpoMoney.formatBRL(totDas)) : '—'}</td>
                <td style="padding:10px 10px; text-align:right; color:#fbbf24;">${totHon > 0n ? escapeHtml(window.BpoMoney.formatBRL(totHon)) : '—'}</td>
                <td style="padding:10px 10px; text-align:right; color:#60a5fa;">${escapeHtml(window.BpoMoney.formatBRL(totLiq))}</td>
                ${sociosCols.map(([id]) => `<td style="padding:10px 8px; text-align:right; color:#a3e635;">${escapeHtml(window.BpoMoney.formatBRL(totSocios.get(id) || 0n))}</td>`).join('')}
                <td style="padding:10px 10px; text-align:center; color:#93c5fd; font-size:0.78rem;">Recebido: ${escapeHtml(window.BpoMoney.formatBRL(totRecebidoLiq))}</td>
            </tr>`;
        }

        // Atualiza métricas
        renderizarMetricas();
    }


    window.quitarDistribuicao = async function(id) {
        if (!confirm('Confirmar o repasse financeiro deste valor ao sócio?')) return;
        try {
            await window.BpoSupabase.request(`rental_distributions?id=eq.${id}`, {
                method: 'PATCH', body: JSON.stringify({ status: 'paid' })
            });
            await carregarDadosLocacoes();
            alert('Repasse quitado com sucesso!');
        } catch (err) {
            alert('Erro ao quitar repasse: ' + err.message);
        }
    };

    // =========================================================================
    // UTILITÁRIOS
    // =========================================================================
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
})();
