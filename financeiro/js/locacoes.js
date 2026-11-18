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

    // Cache de métricas calculadas pela Tabela 1 (para os cards do topo)
    let _metricasTabela1 = { bruto: 0n, abertos: 0n, honorarios: 0n, cotas: 0n };

    // DOM
    const selectEmpresa          = document.getElementById('selectEmpresa');
    const inputCompetencia       = document.getElementById('inputCompetencia');
    const listaDistribuicoesBody = document.getElementById('listaDistribuicoesBody');

    // Métricas
    const valAlugueisBruto  = document.getElementById('valAlugueisBruto');
    const valAlugueisAbertos = document.getElementById('valAlugueisAbertos');
    const valHonorarios     = document.getElementById('valHonorarios');
    const valTotalCotas     = document.getElementById('valTotalCotas');

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

        // Registra event listeners ANTES do carregamento assíncrono para garantir
        // que botões funcionem mesmo se o carregamento de dados falhar
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

        // Carrega dados após registrar todos os listeners
        try {
            await carregarEmpresas();
        } catch (err) {
            console.error('Erro ao carregar dados iniciais de locações:', err);
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

    // Calcula o mês de caixa correspondente à competência faturada:
    // Ex: Competência de Setembro (2026-09) apura os pagamentos em Outubro (2026-10);
    //     Competência de Outubro (2026-10) apura os pagamentos em Novembro (2026-11).
    function obterMesCaixaDaCompetencia(comp) {
        if (!comp || !comp.includes('-')) return comp;
        const [ano, mes] = comp.split('-').map(Number);
        const prox = new Date(ano, mes, 1);
        return `${prox.getFullYear()}-${String(prox.getMonth() + 1).padStart(2, '0')}`;
    }
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
            // 1. Sócios da empresa (filtrados por person_type = 'socio')
            pessoas = await window.BpoSupabase.request(
                `people?company_id=eq.${empresaAtiva.id}&person_type=eq.socio&order=name.asc`,
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
    // Retorna { mapCompetencia, docsCaixa }
    // =========================================================================

    /**
     * Extrai tax_details de um documento (do campo direto ou embutido na description).
     * Idêntico ao window.BpoFiscalUtils.extrairTaxDetails do impostos.js.
     */
    function extrairTaxDetails(doc) {
        if (!doc) return null;
        if (doc.tax_details && typeof doc.tax_details === 'object') return doc.tax_details;
        if (doc.description && typeof doc.description === 'string') {
            const match = doc.description.match(/<!--bpo_tax_details:(.*?)-->/);
            if (match) { try { return JSON.parse(match[1]); } catch (e) {} }
        }
        return null;
    }

    /**
     * Calcula o Valor Total de um documento.
     * Fórmula alinhada com faturamento.js (linha 379-382 e 590-591):
     *   Valor Total = Valor Base + Extras + IPTU (se locação) − Desconto
     * Prioridade de desconto: d.discounts > td.desconto (igual ao faturamento.js).
     */
    function calcularValorTotalDoc(doc, td) {
        const isLoc = (doc.document_type === 'locacao') || !!(td && td.is_locacao);
        const bCents = window.BpoMoney.toCents(doc.gross_amount);
        const eCents = (td && td.extras) ? window.BpoMoney.toCents(td.extras) : 0n;
        // faturamento.js prioriza d.discounts; fallback td.desconto
        const dCents = doc.discounts
            ? window.BpoMoney.toCents(doc.discounts)
            : ((td && td.desconto) ? window.BpoMoney.toCents(td.desconto) : 0n);
        // IPTU: apenas para locação (igual a faturamento.js linha 382)
        const iptuCents = (isLoc && td && td.iptu_valor)
            ? window.BpoMoney.toCents(td.iptu_valor)
            : 0n;
        const total = bCents + eCents + iptuCents;
        return total > dCents ? (total - dCents) : 0n;
    }

    /**
     * Calcula o Total Tributos de um documento usando BpoTaxEngine — idêntico ao
     * módulo de Impostos (tabela "Detalhamento de Tributos por Faturamento").
     * Para Simples Nacional: tributosCents = fatTotalNum * aliqDasEfetiva.
     * Para Lucro Presumido: PIS + COFINS + ISS + IRPJ + CSLL.
     */
    function calcularTributosTotalDoc(doc, td, fatTotalCents, rbt12Empresa) {
        const fatTotalNum = Number(fatTotalCents) / 100;
        const isLP = empresaAtiva && empresaAtiva.tax_regime === 'lucro_presumido';
        const isLocacao = (doc.document_type === 'locacao') || !!(td && td.is_locacao);

        if (isLP) {
            // Lucro Presumido: PIS(0,65%) + COFINS(3%) + ISS(0 p/ locação) + IRPJ + CSLL
            const pisCents = (td && td.pis_valor !== undefined && td.pis_valor !== null)
                ? window.BpoMoney.toCents(td.pis_valor)
                : BigInt(Math.round(fatTotalNum * 0.0065 * 100));
            const cofinsCents = (td && td.cofins_valor !== undefined && td.cofins_valor !== null)
                ? window.BpoMoney.toCents(td.cofins_valor)
                : BigInt(Math.round(fatTotalNum * 0.03 * 100));
            const issCents = isLocacao ? 0n
                : BigInt(Math.round(fatTotalNum * ((td && td.iss_aliq !== undefined) ? Number(td.iss_aliq) : 3.0) / 100 * 100));
            const irpjCents = (td && td.irpj_valor !== undefined && td.irpj_valor !== null)
                ? window.BpoMoney.toCents(td.irpj_valor)
                : BigInt(Math.round(fatTotalNum * 0.048 * 100));
            const csllCents = (td && td.csll_valor !== undefined && td.csll_valor !== null)
                ? window.BpoMoney.toCents(td.csll_valor)
                : BigInt(Math.round(fatTotalNum * 0.0288 * 100));
            return pisCents + cofinsCents + issCents + irpjCents + csllCents;
        } else {
            // Simples Nacional — idêntico ao impostos.js: fatTotalNum * aliqDasEfetiva
            const anexoKey = (td && td.das_anexo) || 'anexo_iii';
            const issIsento = isLocacao || !!(td && td.iss_isento_simples);
            const rbt12Num = (rbt12Empresa > 0) ? rbt12Empresa
                : ((td && td.das_rbt12) ? Number(window.BpoMoney.toCents(td.das_rbt12)) / 100 : 180000);

            if (window.BpoTaxEngine) {
                const previa = window.BpoTaxEngine.apurarSimplesNacional(rbt12Num, fatTotalNum, anexoKey, { issIsento });
                const aliq = previa.aliquotaEfetivaNumero || 0.06;
                return BigInt(Math.round(fatTotalNum * aliq * 100));
            }
            return BigInt(Math.round(fatTotalNum * 0.06 * 100));
        }
    }

    /**
     * Calcula o RBT12 real da empresa: soma o Valor Total dos 12 meses anteriores à competência.
     * Idêntico a calcularRbt12RealEmpresa() do impostos.js (inclui extração de tax_details
     * embutido na description para consistência).
     */
    async function calcularRbt12Empresa(companyId, competencia) {
        if (!competencia || !competencia.includes('-')) return 0;
        const [anoStr, mesStr] = competencia.split('-');
        let a = parseInt(anoStr, 10);
        let m = parseInt(mesStr, 10);
        const meses = [];
        for (let i = 1; i <= 12; i++) {
            m--; if (m === 0) { m = 12; a--; }
            meses.unshift(`${a}-${String(m).padStart(2, '0')}`);
        }
        try {
            const docs12 = await window.BpoSupabase.request(
                `billing_documents?company_id=eq.${companyId}&competence_month=in.(${meses.join(',')})&status=neq.cancelled`,
                { method: 'GET' }
            ) || [];
            let total = 0n;
            docs12.forEach(d => {
                const tdD = extrairTaxDetails(d) || {};
                total += calcularValorTotalDoc(d, tdD);
            });
            return Number(total) / 100;
        } catch (e) {
            return 0;
        }
    }

    async function buscarDeducoesDoFaturamento() {
        const mapImovel = new Map();
        const docsCaixa = [];
        try {
            // Busca todos os billing_documents da empresa (sem cancelados)
            const docs = await window.BpoSupabase.request(
                `billing_documents?company_id=eq.${empresaAtiva.id}&status=neq.cancelled`,
                { method: 'GET' }
            ) || [];

            // RBT12 real: necessário para cálculo correto do DAS no Simples Nacional
            const rbt12Empresa = await calcularRbt12Empresa(empresaAtiva.id, competenciaAtiva);

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

                // Status de recebimento
                const dataRec = td.payment_date || d.payment_date || d.receipt_date || null;
                const mesRec = dataRec ? String(dataRec).slice(0, 7) : '';
                const recebido = !!dataRec && d.status === 'paid';

                // Localiza contrato de locação vinculado ao documento
                let contrato = contratosLocacao.find(c => c.id === d.contract_id);
                if (!contrato && d.contract_id) {
                    contrato = contratosLocacao.find(c => {
                        const imov = imoveis.find(i => i.id === c.property_id);
                        if (!imov) return false;
                        try {
                            const meta = JSON.parse(imov.address || '{}');
                            return meta.contract_ref_id === d.contract_id;
                        } catch { return false; }
                    });
                }

                // ── Valor Total = Valor Base + Extras + IPTU (se locação) − Desconto ───────
                // Alinhado com faturamento.js: desconto prioriza d.discounts > td.desconto;
                // IPTU incluído apenas para documentos de locação.
                const fatTotalCents = calcularValorTotalDoc(d, td);

                // ── Total Tributos = mesmo valor de "Total Tributos" do módulo de Impostos ─
                // Usa BpoTaxEngine (taxes.js) com RBT12 real — resultado idêntico ao impostos.
                const dasTotalCents = calcularTributosTotalDoc(d, td, fatTotalCents, rbt12Empresa);

                // 1. Mapa da Competência de Faturamento
                if (d.competence_month === competenciaAtiva && contrato) {
                    const propId = contrato.property_id;
                    if (!mapImovel.has(propId)) {
                        mapImovel.set(propId, {
                            grossCents:      null,
                            rawGrossCents:   0n,
                            iptuCents:       0n,
                            dasCents:        0n,
                            jurosMult:       0n,
                            descontoCents:   0n,
                            dataRecebimento: null,
                            dataVencimento:  d.due_date || null,
                            recebido:        false,
                            contract_id:     contrato.id
                        });
                    }

                    const entry = mapImovel.get(propId);
                    entry.recebido = recebido;
                    if (dataRec) {
                        entry.dataRecebimento = String(dataRec).slice(0, 10);
                        entry.mesRecebimento = String(dataRec).slice(0, 7);
                    }
                    if (d.due_date) entry.dataVencimento = d.due_date;

                    entry.grossCents    = fatTotalCents;
                    entry.rawGrossCents = window.BpoMoney.toCents(d.gross_amount || 0);
                    if (td.iptu_valor) entry.iptuCents += window.BpoMoney.toCents(td.iptu_valor);
                    entry.dasCents += dasTotalCents;

                    const jurosV = td.juros_valor || td.juros || 0;
                    const multaV = td.multa_valor || td.multa || 0;
                    entry.jurosMult += window.BpoMoney.toCents(jurosV) + window.BpoMoney.toCents(multaV);

                    const descV = td.desconto_valor || td.desconto || d.discounts || 0;
                    entry.descontoCents += window.BpoMoney.toCents(descV);
                }

                // 2. Regime de Caixa: documentos recebidos no mês subsequente à competência
                const mesCaixaAlvo = obterMesCaixaDaCompetencia(competenciaAtiva);
                if (recebido && mesRec === mesCaixaAlvo) {
                    const iptuC = td.iptu_valor ? window.BpoMoney.toCents(td.iptu_valor) : 0n;
                    const jurosV = td.juros_valor || td.juros || 0;
                    const multaV = td.multa_valor || td.multa || 0;
                    const jurosC = window.BpoMoney.toCents(jurosV) + window.BpoMoney.toCents(multaV);
                    const descV = td.desconto_valor || td.desconto || d.discounts || 0;
                    const descC = window.BpoMoney.toCents(descV);

                    docsCaixa.push({
                        doc: d,
                        contrato: contrato || null,
                        dataRecebimento: String(dataRec).slice(0, 10),
                        dataVencimento: d.due_date || null,
                        competenceMonth: d.competence_month,
                        grossCents: fatTotalCents,
                        rawGrossCents: window.BpoMoney.toCents(d.gross_amount || 0),
                        iptuCents: iptuC,
                        dasCents: dasTotalCents,
                        jurosMult: jurosC,
                        descontoCents: descC
                    });
                }
            });
        } catch (e) {
            console.warn('Aviso: não foi possível buscar deduções do faturamento:', e);
        }
        return { mapCompetencia: mapImovel, docsCaixa };
    }

    // =========================================================================
    // MÉTRICAS
    // =========================================================================
    function renderizarMetricas() {
        // Os totais são calculados pela Tabela 1 (renderizarTabelas) e armazenados em _metricasTabela1.
        // Card 1: Aluguéis Faturados = soma de Valor Bruto de todos os contratos da competência
        // Card 2: Aluguéis Não Faturados = soma de Valor Bruto dos contratos "Em Aberto" (não pagos)
        // Card 3: Total de Honorários = soma da coluna Honorários da Tabela 1
        // Card 4: Total de Cotas = soma de todas as colunas de sócios da Tabela 1
        if (valAlugueisBruto)  valAlugueisBruto.textContent  = window.BpoMoney.formatBRL(_metricasTabela1.bruto);
        if (valAlugueisAbertos) valAlugueisAbertos.textContent = window.BpoMoney.formatBRL(_metricasTabela1.abertos);
        if (valHonorarios)     valHonorarios.textContent     = window.BpoMoney.formatBRL(_metricasTabela1.honorarios);
        if (valTotalCotas)     valTotalCotas.textContent     = window.BpoMoney.formatBRL(_metricasTabela1.cotas);
    }

    // =========================================================================
    // TABELAS DE GESTÃO DE LOCAÇÕES (Competência de Faturamento + Regime de Caixa)
    // =========================================================================
    async function renderizarExtrato() {
        const tbody = document.getElementById('listaDistribuicoesBody');
        const thead = document.getElementById('tabelaGestaoLocacoesHead');
        const tfoot = document.getElementById('tabelaGestaoLocacoesFoot');

        const tbodyCaixa = document.getElementById('listaCaixaBody');
        const theadCaixa = document.getElementById('tabelaLocacoesCaixaHead');
        const tfootCaixa = document.getElementById('tabelaLocacoesCaixaFoot');
        const tituloCaixa = document.getElementById('tituloTabelaCaixa');

        if (!tbody) return;

        // Atualiza título da tabela de caixa com o mês de pagamento correspondente
        if (tituloCaixa && competenciaAtiva) {
            const mesCaixaAlvo = obterMesCaixaDaCompetencia(competenciaAtiva);
            const [anoC, mesC] = mesCaixaAlvo.split('-');
            const nomesMeses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
            const nomeMesC = nomesMeses[parseInt(mesC, 10) - 1] || mesC;
            tituloCaixa.textContent = `Locações Recebidas em ${nomeMesC}/${anoC} (Regime de Caixa da Competência)`;
        }

        if (contratosLocacao.length === 0) {
            tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; color:#6b7280; padding:40px;">
                Nenhum contrato cadastrado. Clique em <strong>+ Contrato de Locação</strong> para criar o primeiro.
            </td></tr>`;
            if (tbodyCaixa) {
                tbodyCaixa.innerHTML = `<tr><td colspan="11" style="text-align:center; color:#6b7280; padding:40px;">
                    Nenhum contrato cadastrado.
                </td></tr>`;
            }
            return;
        }

        // Busca dados de faturamento (IPTU, DAS, juros/multa, recebimento) para competência e para caixa
        const { mapCompetencia, docsCaixa } = await buscarDeducoesDoFaturamento();

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

        // Função auxiliar para gerar o HTML do thead com Vencimento, Status e Recebimento
        function gerarTheadHtml() {
            return `
                <tr style="background:#111827; color:#9ca3af; text-transform:uppercase; font-size:0.72rem; letter-spacing:0.05em;">
                    <th style="padding:10px 10px; text-align:left; border-bottom:2px solid rgba(255,255,255,0.1); position:sticky; left:0; background:#111827; z-index:2;">Contrato</th>
                    <th style="padding:10px 10px; text-align:center; border-bottom:2px solid rgba(255,255,255,0.1);">Vencimento</th>
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
                    <th style="padding:10px 10px; text-align:center; border-bottom:2px solid rgba(255,255,255,0.1);">Status</th>
                    <th style="padding:10px 10px; text-align:center; border-bottom:2px solid rgba(255,255,255,0.1);">Recebimento</th>
                </tr>`;
        }

        if (thead) thead.innerHTML = gerarTheadHtml();
        if (theadCaixa) theadCaixa.innerHTML = gerarTheadHtml();

        // =========================================================================
        // 1. TABELA 1: COMPETÊNCIA DE FATURAMENTO
        // =========================================================================
        let totBruto = 0n, totIptu = 0n, totDesc = 0n, totJuros = 0n, totDas = 0n, totHon = 0n, totLiq = 0n;
        const totSocios = new Map(sociosCols.map(([id]) => [id, 0n]));
        let totRecebidoLiq = 0n;

        const linhasCompetencia = contratosLocacao.map(cl => {
            const imovel = imoveis.find(i => i.id === cl.property_id);
            const fat    = mapCompetencia.get(cl.property_id) || {};
            let meta = {};
            try { meta = JSON.parse(imovel?.address || '{}'); } catch {}

            // Valores
            const brutoCents = fat.grossCents || window.BpoMoney.toCents(cl.monthly_amount);
            const iptuCents  = fat.iptuCents  || 0n;
            const dasCents   = fat.dasCents   || 0n;
            const jurosCents = fat.jurosMult  || 0n;
            const descCents  = fat.descontoCents || (meta.discount ? window.BpoMoney.toCents(meta.discount) : 0n);

            // Honorários: procura participante com admin_pct > 0
            const partImovel = participantesAll.filter(p => p.property_id === cl.property_id);
            const admPart = partImovel.find(p => parseFloat(p.admin_pct) > 0);
            const admPct  = admPart ? parseFloat(admPart.admin_pct) : (parseFloat(meta.admin_pct) || 0);
            // Base honorários = gross_amount − desconto + juros/multa (sem IPTU, sem extras)
            const baseHonCents1 = (fat.rawGrossCents || 0n) - (fat.descontoCents || 0n) + (fat.jurosMult || 0n);
            const honCents = admPct > 0 ? window.BpoMoney.applyPercentage(baseHonCents1 > 0n ? baseHonCents1 : 0n, admPct) : 0n;

            // Líquido = Bruto − IPTU − Desconto − DAS − Honorários + Juros/Multa
            const liqCents = brutoCents - iptuCents - descCents - dasCents - honCents + jurosCents;

            // Vencimento: dataVencimento do faturamento ou dia padrão do contrato
            const dataVenc = fat.dataVencimento ? formatarData(fat.dataVencimento) : (cl.due_day ? `Dia ${cl.due_day}` : '—');

            // Recebimento e Status
            const recebido = fat.recebido || false;
            const dataRec  = fat.dataRecebimento;
            const mesRec   = fat.mesRecebimento || (dataRec ? String(dataRec).slice(0, 7) : '');

            // Determina o mês esperado de pagamento:
            // Se houver vencimento cadastrado no faturamento, usa o mês dele (ex: comp 2026-10 com venc em 2026-11).
            // Caso contrário, usa a própria competência ativa.
            const mesVencimento = fat.dataVencimento ? String(fat.dataVencimento).slice(0, 7) : competenciaAtiva;

            // Regra de Contabilização na Competência:
            // - Se recebido no próprio período/mês de vencimento (ou na competência): Liquidado e contabiliza cotas
            // - Se foi pago após esse mês: Não contabilizado (pois as cotas entram no mês que foi pago)
            // - Se ainda não foi pago: Em Aberto
            const recebidoNoMes = recebido && (mesRec === mesVencimento || mesRec === competenciaAtiva);
            const recebidoForaDoMes = recebido && !recebidoNoMes;

            let statusBadge = '';
            if (recebidoNoMes) {
                statusBadge = `<span style="background:#16a34a22; color:#22c55e; padding:2px 8px; border-radius:4px; font-size:0.78rem;">Liquidado</span>`;
            } else if (recebidoForaDoMes) {
                statusBadge = `<span style="background:#eab30822; color:#eab308; padding:2px 8px; border-radius:4px; font-size:0.78rem;">Não contabilizado</span>`;
            } else {
                statusBadge = `<span style="background:#ef444422; color:#ef4444; padding:2px 8px; border-radius:4px; font-size:0.78rem;">Em Aberto</span>`;
            }

            const recBadge = dataRec
                ? `<span style="color:#22c55e; font-size:0.8rem;">${formatarData(dataRec)}</span>`
                : `<span style="color:#6b7280;">—</span>`;

            // Cotas por sócio (apenas se recebido no próprio mês da competência ativa)
            const cotasCells = sociosCols.map(([socioId]) => {
                const pp = partImovel.find(p => p.person_id === socioId && parseFloat(p.participation_pct) > 0);
                if (!pp) return `<td style="padding:9px 8px; text-align:right; color:#6b7280;">—</td>`;
                const pct    = parseFloat(pp.participation_pct);
                const valor  = window.BpoMoney.applyPercentage(liqCents, pct);
                if (recebidoNoMes) {
                    totSocios.set(socioId, (totSocios.get(socioId) || 0n) + valor);
                    return `<td style="padding:9px 8px; text-align:right; color:#a3e635; font-size:0.8rem;">
                        ${escapeHtml(window.BpoMoney.formatBRL(valor))}
                    </td>`;
                } else {
                    return `<td style="padding:9px 8px; text-align:right; color:#6b7280; font-size:0.8rem;">—</td>`;
                }
            });

            // Acumula totais
            totBruto += brutoCents;
            totIptu  += iptuCents;
            totDesc  += descCents;
            totJuros += jurosCents;
            totDas   += dasCents;
            totHon   += honCents;
            totLiq   += liqCents;
            if (recebidoNoMes) totRecebidoLiq += liqCents;

            const nomeImovel = imovel ? escapeHtml(imovel.name) : `Imóvel (${cl.property_id.slice(0,8)})`;
            const rowBg = recebidoNoMes ? '' : (recebidoForaDoMes ? 'background:rgba(234,179,8,0.04);' : 'background:rgba(239,68,68,0.04);');

            return `<tr style="border-bottom:1px solid rgba(255,255,255,0.05); ${rowBg}" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background='${recebidoNoMes ? '' : (recebidoForaDoMes ? 'rgba(234,179,8,0.04)' : 'rgba(239,68,68,0.04)')}'">
                <td style="padding:9px 10px; color:#fff; font-weight:500; position:sticky; left:0; background:#0f172a; z-index:1; max-width:200px; overflow:hidden; text-overflow:ellipsis;" title="${nomeImovel}">${nomeImovel}</td>
                <td style="padding:9px 10px; text-align:center; color:#9ca3af; font-size:0.8rem;">${escapeHtml(dataVenc)}</td>
                <td style="padding:9px 10px; text-align:right; color:#4ade80; font-weight:600;">${escapeHtml(window.BpoMoney.formatBRL(brutoCents))}</td>
                <td style="padding:9px 10px; text-align:right; color:${iptuCents > 0n ? '#f87171' : '#6b7280'};">${iptuCents > 0n ? escapeHtml(window.BpoMoney.formatBRL(iptuCents)) : '—'}</td>
                <td style="padding:9px 10px; text-align:right; color:${descCents > 0n ? '#f87171' : '#6b7280'};">${descCents > 0n ? escapeHtml(window.BpoMoney.formatBRL(descCents)) : '—'}</td>
                <td style="padding:9px 10px; text-align:right; color:${jurosCents > 0n ? '#a3e635' : '#6b7280'};">${jurosCents > 0n ? escapeHtml(window.BpoMoney.formatBRL(jurosCents)) : '—'}</td>
                <td style="padding:9px 10px; text-align:right; color:${dasCents > 0n ? '#f87171' : '#6b7280'};">${dasCents > 0n ? escapeHtml(window.BpoMoney.formatBRL(dasCents)) : '—'}</td>
                <td style="padding:9px 10px; text-align:right; color:${honCents > 0n ? '#fbbf24' : '#6b7280'};">${honCents > 0n ? escapeHtml(window.BpoMoney.formatBRL(honCents)) : '—'}</td>
                <td style="padding:9px 10px; text-align:right; color:#60a5fa; font-weight:700;">${escapeHtml(window.BpoMoney.formatBRL(liqCents))}</td>
                ${cotasCells.join('')}
                <td style="padding:9px 10px; text-align:center;">${statusBadge}</td>
                <td style="padding:9px 10px; text-align:center;">${recBadge}</td>
            </tr>`;
        });

        tbody.innerHTML = linhasCompetencia.join('');

        if (tfoot) {
            tfoot.innerHTML = `<tr style="background:#1e3a5f; border-top:2px solid #3b82f6; font-weight:700; font-size:0.82rem;">
                <td style="padding:10px 10px; color:#93c5fd; position:sticky; left:0; background:#1e3a5f;">TOTAL</td>
                <td style="padding:10px 10px; text-align:center; color:#93c5fd;">—</td>
                <td style="padding:10px 10px; text-align:right; color:#4ade80;">${escapeHtml(window.BpoMoney.formatBRL(totBruto))}</td>
                <td style="padding:10px 10px; text-align:right; color:#f87171;">${totIptu > 0n ? escapeHtml(window.BpoMoney.formatBRL(totIptu)) : '—'}</td>
                <td style="padding:10px 10px; text-align:right; color:#f87171;">${totDesc > 0n ? escapeHtml(window.BpoMoney.formatBRL(totDesc)) : '—'}</td>
                <td style="padding:10px 10px; text-align:right; color:#a3e635;">${totJuros > 0n ? escapeHtml(window.BpoMoney.formatBRL(totJuros)) : '—'}</td>
                <td style="padding:10px 10px; text-align:right; color:#f87171;">${totDas > 0n ? escapeHtml(window.BpoMoney.formatBRL(totDas)) : '—'}</td>
                <td style="padding:10px 10px; text-align:right; color:#fbbf24;">${totHon > 0n ? escapeHtml(window.BpoMoney.formatBRL(totHon)) : '—'}</td>
                <td style="padding:10px 10px; text-align:right; color:#60a5fa;">${escapeHtml(window.BpoMoney.formatBRL(totLiq))}</td>
                ${sociosCols.map(([id]) => `<td style="padding:10px 8px; text-align:right; color:#a3e635;">${escapeHtml(window.BpoMoney.formatBRL(totSocios.get(id) || 0n))}</td>`).join('')}
                <td style="padding:10px 10px; text-align:center; color:#93c5fd; font-size:0.78rem;">—</td>
                <td style="padding:10px 10px; text-align:center; color:#93c5fd; font-size:0.78rem;">Recebido: ${escapeHtml(window.BpoMoney.formatBRL(totRecebidoLiq))}</td>
            </tr>`;
        }

        // Atualiza métricas dos cards do topo com os totais da Tabela 1
        // "Aluguéis Não Faturados" = contratos cujo status é "Em Aberto" (não pagos na competência)
        const totAberto = contratosLocacao.reduce((acc, cl) => {
            const fat = mapCompetencia.get(cl.property_id) || {};
            const recebido = fat.recebido || false;
            const dataRec  = fat.dataRecebimento;
            const mesRec   = fat.mesRecebimento || (dataRec ? String(dataRec).slice(0, 7) : '');
            const mesVenc  = fat.dataVencimento ? String(fat.dataVencimento).slice(0, 7) : competenciaAtiva;
            const recebidoNoMes = recebido && (mesRec === mesVenc || mesRec === competenciaAtiva);
            const recebidoForaDoMes = recebido && !recebidoNoMes;
            const emAberto = !recebido && !recebidoForaDoMes;
            if (emAberto) {
                const bc = fat.grossCents || window.BpoMoney.toCents(cl.monthly_amount);
                return acc + bc;
            }
            return acc;
        }, 0n);

        const totCotasSocios = [...totSocios.values()].reduce((a, v) => a + v, 0n);

        _metricasTabela1 = {
            bruto:      totBruto,
            abertos:    totAberto,
            honorarios: totHon,
            cotas:      totCotasSocios
        };

        // =========================================================================
        // 2. TABELA 2: RECEBIMENTOS NO PERÍODO (REGIME DE CAIXA)
        // =========================================================================
        if (tbodyCaixa) {
            const mesCaixaAlvo = obterMesCaixaDaCompetencia(competenciaAtiva);
            if (docsCaixa.length === 0) {
                tbodyCaixa.innerHTML = `<tr><td colspan="${9 + sociosCols.length + 1}" style="text-align:center; color:#6b7280; padding:40px;">
                    Nenhum recebimento de locação registrado no período de ${mesCaixaAlvo}.
                </td></tr>`;
                if (tfootCaixa) tfootCaixa.innerHTML = '';
            } else {
                let cTotBruto = 0n, cTotIptu = 0n, cTotDesc = 0n, cTotJuros = 0n, cTotDas = 0n, cTotHon = 0n, cTotLiq = 0n;
                const cTotSocios = new Map(sociosCols.map(([id]) => [id, 0n]));
                let cTotRecebidoLiq = 0n;

                const linhasCaixa = docsCaixa.map(item => {
                    const cl = item.contrato;
                    const imovel = cl ? imoveis.find(i => i.id === cl.property_id) : null;
                    let meta = {};
                    try { meta = JSON.parse(imovel?.address || '{}'); } catch {}

                    const brutoCents = item.grossCents;
                    const iptuCents  = item.iptuCents;
                    const dasCents   = item.dasCents;
                    const jurosCents = item.jurosMult;
                    const descCents  = item.descontoCents;

                    // Honorários do imóvel
                    const partImovel = cl ? participantesAll.filter(p => p.property_id === cl.property_id) : [];
                    const admPart = partImovel.find(p => parseFloat(p.admin_pct) > 0);
                    const admPct  = admPart ? parseFloat(admPart.admin_pct) : (parseFloat(meta.admin_pct) || 0);
                    // Base honorários = gross_amount − desconto + juros/multa (sem IPTU, sem extras)
                    const baseHonCents2 = (item.rawGrossCents || 0n) - (item.descontoCents || 0n) + (item.jurosMult || 0n);
                    const honCents = admPct > 0 ? window.BpoMoney.applyPercentage(baseHonCents2 > 0n ? baseHonCents2 : 0n, admPct) : 0n;

                    const liqCents = brutoCents - iptuCents - descCents - dasCents - honCents + jurosCents;

                    const dataVenc = item.dataVencimento ? formatarData(item.dataVencimento) : (cl && cl.due_day ? `Dia ${cl.due_day}` : '—');
                    const dataRec = item.dataRecebimento ? formatarData(item.dataRecebimento) : 'Liquidado';

                    // Cotas por sócio (todos recebidos, pois está na tabela de caixa)
                    const cotasCells = sociosCols.map(([socioId]) => {
                        const pp = partImovel.find(p => p.person_id === socioId && parseFloat(p.participation_pct) > 0);
                        if (!pp) return `<td style="padding:9px 8px; text-align:right; color:#6b7280;">—</td>`;
                        const pct   = parseFloat(pp.participation_pct);
                        const valor = window.BpoMoney.applyPercentage(liqCents, pct);
                        cTotSocios.set(socioId, (cTotSocios.get(socioId) || 0n) + valor);
                        return `<td style="padding:9px 8px; text-align:right; color:#a3e635; font-size:0.8rem;">
                            ${escapeHtml(window.BpoMoney.formatBRL(valor))}
                        </td>`;
                    });

                    cTotBruto += brutoCents;
                    cTotIptu  += iptuCents;
                    cTotDesc  += descCents;
                    cTotJuros += jurosCents;
                    cTotDas   += dasCents;
                    cTotHon   += honCents;
                    cTotLiq   += liqCents;
                    cTotRecebidoLiq += liqCents;

                    const nomeImovel = imovel ? escapeHtml(imovel.name) : (item.doc.document_number ? `Doc ${escapeHtml(item.doc.document_number)}` : 'Locação');
                    const compBadge = item.competenceMonth ? `<span style="color:#94a3b8; font-size:0.72rem; display:block;">Comp: ${escapeHtml(item.competenceMonth)}</span>` : '';

                    return `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background=''">
                        <td style="padding:9px 10px; color:#fff; font-weight:500; position:sticky; left:0; background:#0f172a; z-index:1; max-width:200px; overflow:hidden; text-overflow:ellipsis;" title="${nomeImovel}">
                            ${nomeImovel}
                            ${compBadge}
                        </td>
                        <td style="padding:9px 10px; text-align:center; color:#9ca3af; font-size:0.8rem;">${escapeHtml(dataVenc)}</td>
                        <td style="padding:9px 10px; text-align:right; color:#4ade80; font-weight:600;">${escapeHtml(window.BpoMoney.formatBRL(brutoCents))}</td>
                        <td style="padding:9px 10px; text-align:right; color:${iptuCents > 0n ? '#f87171' : '#6b7280'};">${iptuCents > 0n ? escapeHtml(window.BpoMoney.formatBRL(iptuCents)) : '—'}</td>
                        <td style="padding:9px 10px; text-align:right; color:${descCents > 0n ? '#f87171' : '#6b7280'};">${descCents > 0n ? escapeHtml(window.BpoMoney.formatBRL(descCents)) : '—'}</td>
                        <td style="padding:9px 10px; text-align:right; color:${jurosCents > 0n ? '#a3e635' : '#6b7280'};">${jurosCents > 0n ? escapeHtml(window.BpoMoney.formatBRL(jurosCents)) : '—'}</td>
                        <td style="padding:9px 10px; text-align:right; color:${dasCents > 0n ? '#f87171' : '#6b7280'};">${dasCents > 0n ? escapeHtml(window.BpoMoney.formatBRL(dasCents)) : '—'}</td>
                        <td style="padding:9px 10px; text-align:right; color:${honCents > 0n ? '#fbbf24' : '#6b7280'};">${honCents > 0n ? escapeHtml(window.BpoMoney.formatBRL(honCents)) : '—'}</td>
                        <td style="padding:9px 10px; text-align:right; color:#60a5fa; font-weight:700;">${escapeHtml(window.BpoMoney.formatBRL(liqCents))}</td>
                        ${cotasCells.join('')}
                        <td style="padding:9px 10px; text-align:center;">
                            <span style="background:#16a34a22; color:#22c55e; padding:2px 8px; border-radius:4px; font-size:0.78rem;">Liquidado</span>
                        </td>
                        <td style="padding:9px 10px; text-align:center;">
                            <span style="color:#22c55e; font-size:0.8rem;">${dataRec}</span>
                        </td>
                    </tr>`;
                });

                tbodyCaixa.innerHTML = linhasCaixa.join('');

                if (tfootCaixa) {
                    tfootCaixa.innerHTML = `<tr style="background:#1e3a5f; border-top:2px solid #3b82f6; font-weight:700; font-size:0.82rem;">
                        <td style="padding:10px 10px; color:#93c5fd; position:sticky; left:0; background:#1e3a5f;">TOTAL RECEBIDO</td>
                        <td style="padding:10px 10px; text-align:center; color:#93c5fd;">—</td>
                        <td style="padding:10px 10px; text-align:right; color:#4ade80;">${escapeHtml(window.BpoMoney.formatBRL(cTotBruto))}</td>
                        <td style="padding:10px 10px; text-align:right; color:#f87171;">${cTotIptu > 0n ? escapeHtml(window.BpoMoney.formatBRL(cTotIptu)) : '—'}</td>
                        <td style="padding:10px 10px; text-align:right; color:#f87171;">${cTotDesc > 0n ? escapeHtml(window.BpoMoney.formatBRL(cTotDesc)) : '—'}</td>
                        <td style="padding:10px 10px; text-align:right; color:#a3e635;">${cTotJuros > 0n ? escapeHtml(window.BpoMoney.formatBRL(cTotJuros)) : '—'}</td>
                        <td style="padding:10px 10px; text-align:right; color:#f87171;">${cTotDas > 0n ? escapeHtml(window.BpoMoney.formatBRL(cTotDas)) : '—'}</td>
                        <td style="padding:10px 10px; text-align:right; color:#fbbf24;">${cTotHon > 0n ? escapeHtml(window.BpoMoney.formatBRL(cTotHon)) : '—'}</td>
                        <td style="padding:10px 10px; text-align:right; color:#60a5fa;">${escapeHtml(window.BpoMoney.formatBRL(cTotLiq))}</td>
                        ${sociosCols.map(([id]) => `<td style="padding:10px 8px; text-align:right; color:#a3e635;">${escapeHtml(window.BpoMoney.formatBRL(cTotSocios.get(id) || 0n))}</td>`).join('')}
                        <td style="padding:10px 10px; text-align:center; color:#93c5fd; font-size:0.78rem;">—</td>
                        <td style="padding:10px 10px; text-align:center; color:#93c5fd; font-size:0.78rem;">Total: ${escapeHtml(window.BpoMoney.formatBRL(cTotRecebidoLiq))}</td>
                    </tr>`;
                }
            }
        }

        // Atualiza métricas
        renderizarMetricas();
    }


    // =========================================================================
    // MODAL SÓCIOS
    // =========================================================================
    async function abrirModalSocios() {
        if (!modalSocios) return;
        modalSocios.style.display = 'flex';
        renderizarListaSocios();
    }

    function renderizarListaSocios() {
        const container = document.getElementById('listaSociosContainer');
        if (!container) return;

        if (pessoas.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; color:var(--text-muted); padding:24px;">
                    Nenhum sócio cadastrado. Clique em <strong>+ Novo Sócio</strong>.
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <table class="table-custom" style="font-size:0.88rem;">
                <thead>
                    <tr>
                        <th>Nome</th>
                        <th>CPF/CNPJ</th>
                        <th>E-mail</th>
                        <th>Ações</th>
                    </tr>
                </thead>
                <tbody>
                    ${pessoas.map(p => `
                        <tr>
                            <td style="font-weight:600; color:#fff;">${escapeHtml(p.name)}</td>
                            <td style="color:var(--text-secondary);">${escapeHtml(p.document || '-')}</td>
                            <td style="color:var(--text-secondary);">${escapeHtml(p.email || '-')}</td>
                            <td style="white-space:nowrap;">
                                <button class="btn btn-secondary btn-sm" onclick="window.editarSocio('${p.id}')">✏️ Editar</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    function abrirFormSocio(socioExistente = null) {
        if (modalSocios)       modalSocios.style.display = 'none';
        if (!modalCadastroSocio) return;

        const titulo   = document.getElementById('modalSocioTitulo');
        const inpId    = document.getElementById('socioId');
        const btnExc   = document.getElementById('btnExcluirSocio');

        document.getElementById('formSocio')?.reset();

        if (socioExistente) {
            if (titulo) titulo.textContent = 'Editar Sócio';
            if (inpId)  inpId.value = socioExistente.id;
            const nomeEl  = document.getElementById('socioNome');
            const cpfEl   = document.getElementById('socioCpf');
            const emailEl = document.getElementById('socioEmail');
            if (nomeEl)  nomeEl.value  = socioExistente.name     || '';
            if (cpfEl)   cpfEl.value   = socioExistente.document  || '';
            if (emailEl) emailEl.value = socioExistente.email     || '';
            if (btnExc)  btnExc.style.display = 'inline-flex';
        } else {
            if (titulo) titulo.textContent = 'Cadastrar Sócio';
            if (inpId)  inpId.value = '';
            if (btnExc) btnExc.style.display = 'none';
        }

        modalCadastroSocio.style.display = 'flex';
    }

    window.editarSocio = function(id) {
        const p = pessoas.find(x => x.id === id);
        if (p) abrirFormSocio(p);
    };

    async function salvarSocio(e) {
        e.preventDefault();
        const id    = document.getElementById('socioId')?.value;
        const nome  = document.getElementById('socioNome')?.value.trim();
        const cpf   = document.getElementById('socioCpf')?.value.trim();
        const email = document.getElementById('socioEmail')?.value.trim();

        if (!nome) { alert('Informe o nome do sócio.'); return; }

        const payload = { name: nome, document: cpf || null, email: email || null, person_type: 'socio' };

        try {
            if (id) {
                await window.BpoSupabase.request(`people?id=eq.${id}`, {
                    method: 'PATCH', body: JSON.stringify(payload)
                });
            } else {
                await window.BpoSupabase.request('people', {
                    method: 'POST',
                    body: JSON.stringify({ ...payload, company_id: empresaAtiva.id })
                });
            }

            await carregarDadosLocacoes();
            if (modalCadastroSocio) modalCadastroSocio.style.display = 'none';
            if (modalSocios) { modalSocios.style.display = 'flex'; renderizarListaSocios(); }
            alert(id ? 'Sócio atualizado com sucesso!' : 'Sócio cadastrado com sucesso!');
        } catch (err) {
            alert('Erro ao salvar sócio: ' + err.message);
        }
    }

    window.deletarSocioModal = async function() {
        const id = document.getElementById('socioId')?.value;
        if (!id || !confirm('Tem certeza que deseja excluir este sócio?')) return;
        try {
            await window.BpoSupabase.request(`people?id=eq.${id}`, { method: 'DELETE' });
            await carregarDadosLocacoes();
            if (modalCadastroSocio) modalCadastroSocio.style.display = 'none';
            if (modalSocios) { modalSocios.style.display = 'flex'; renderizarListaSocios(); }
            alert('Sócio excluído com sucesso.');
        } catch (err) {
            // FK violation: pessoa referenciada em contratos ou outras tabelas
            const msgErro = err.message || '';
            const isFkViolation = msgErro.includes('23503') || msgErro.includes('foreign key') || msgErro.includes('still referenced');
            if (isFkViolation) {
                alert(
                    'Não é possível excluir este sócio pois ele está vinculado a contratos no sistema.\n\n' +
                    'Para removê-lo das participações de locação, edite o contrato e remova-o das cotas/honorários.\n' +
                    'Para desativá-lo definitivamente, entre em contato com o administrador do sistema.'
                );
            } else {
                alert('Erro ao excluir sócio: ' + msgErro);
            }
        }
    };

    // =========================================================================
    // MODAL CONTRATO DE LOCAÇÃO
    // =========================================================================
    function abrirModalContrato(contratoExistente = null) {
        cotasForm = [];

        const selLocatario  = document.getElementById('locLocatario');
        const selAdminSocio = document.getElementById('locAdminSocio');
        const selContratoRef = document.getElementById('locImovelContrato');

        // Popula Empresa Locatária com todas as empresas do sistema
        if (selLocatario) {
            selLocatario.innerHTML = '<option value="">Selecione a empresa locatária...</option>' +
                empresas.map(emp =>
                    `<option value="${escapeHtml(emp.id)}">${escapeHtml(emp.trade_name || emp.name)}</option>`
                ).join('');

            // Ao mudar a empresa, filtra o dropdown de contratos
            selLocatario.onchange = function() {
                filtrarContratosPorEmpresa(this.value, selContratoRef);
            };
        }

        // Popula sócio administrador com pessoas da empresa ativa
        if (selAdminSocio) {
            selAdminSocio.innerHTML = '<option value="">Nenhum (sem honorários)</option>' +
                pessoas.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
        }

        const inpId       = document.getElementById('locContratoId');
        const inpPropId   = document.getElementById('locPropertyId');
        const inpValor    = document.getElementById('locValor');
        const inpDia      = document.getElementById('locDia');
        const inpDesconto = document.getElementById('locDesconto');
        const inpAdminPct = document.getElementById('locAdminPct');
        const btnExc      = document.getElementById('btnExcluirContrato');
        const titulo      = document.getElementById('modalContratoTitulo');

        // Inicializa o select de contratos vazio (aguarda seleção de empresa)
        if (selContratoRef) {
            selContratoRef.innerHTML = '<option value="">Selecione primeiro a empresa locatária...</option>';
        }

        document.getElementById('formContratoLocacao')?.reset();
        cotasForm = [];
        renderizarCotasForm();

        if (contratoExistente) {
            if (titulo)   titulo.textContent = 'Editar Contrato de Locação';
            if (inpId)    inpId.value = contratoExistente.id;
            if (inpPropId) inpPropId.value = contratoExistente.property_id || '';

            // Restaura empresa locatária e demais metadados (gravados em properties.address)
            // tenant_id em rental_contracts é FK → people; empresa locatária fica em properties.address
            const imovel = imoveis.find(i => i.id === contratoExistente.property_id);
            if (imovel) {
                let meta = {};
                try { meta = JSON.parse(imovel.address || '{}'); } catch {}

                // Restaura empresa locatária e filtra contratos
                const tenantCompanyId = meta.tenant_company_id || '';
                if (selLocatario && tenantCompanyId) {
                    selLocatario.value = tenantCompanyId;
                    filtrarContratosPorEmpresa(tenantCompanyId, selContratoRef);
                }
                // Restaura contrato selecionado (após filtro)
                if (selContratoRef && meta.contract_ref_id) {
                    selContratoRef.value = meta.contract_ref_id;
                }
                if (inpDesconto) inpDesconto.value = window.BpoMoney.formatBRL(meta.discount || 0).replace('R\u00a0', '').replace('R$\u00a0','').trim();
                // Honorários (admin_socio e admin_pct ficam em properties.address)
                if (meta.admin_socio_id && selAdminSocio) selAdminSocio.value = meta.admin_socio_id;
                if (meta.admin_pct && inpAdminPct) inpAdminPct.value = meta.admin_pct;
            }

            if (inpValor) inpValor.value = window.BpoMoney.formatBRL(contratoExistente.monthly_amount).replace('R\u00a0', '').replace('R$\u00a0','').trim();
            if (inpDia)   inpDia.value = contratoExistente.due_day || 10;

            // Carrega cotas existentes do banco
            carregarCotasExistentes(contratoExistente.property_id);
            if (btnExc) btnExc.style.display = 'inline-flex';
        } else {
            if (titulo)         titulo.textContent = 'Novo Contrato de Locação';
            if (inpId)          inpId.value = '';
            if (inpPropId)      inpPropId.value = '';
            if (selContratoRef) selContratoRef.value = '';
            if (inpDesconto)    inpDesconto.value = '0,00';
            if (inpAdminPct)    inpAdminPct.value = '0';
            if (btnExc)         btnExc.style.display = 'none';
        }

        if (modalContratoLocacao) modalContratoLocacao.style.display = 'flex';
    }

    async function carregarCotasExistentes(propertyId) {
        if (!propertyId) return;
        try {
            const participantes = await window.BpoSupabase.request(
                `property_participants?property_id=eq.${propertyId}&order=created_at.asc`,
                { method: 'GET' }
            ) || [];
            // Apenas cotas (não honorários)
            cotasForm = participantes
                .filter(p => parseFloat(p.participation_pct) > 0 && parseFloat(p.admin_pct || 0) === 0)
                .map(p => ({
                    _db_id:    p.id,
                    person_id: p.person_id,
                    pct:       parseFloat(p.participation_pct) || 0
                }));
            renderizarCotasForm();
        } catch (e) {
            console.warn('Aviso: erro ao carregar cotas:', e);
        }
    }

    // -------------------------------------------------------------------------
    // Gerenciamento das linhas de cota no formulário
    // -------------------------------------------------------------------------
    function adicionarLinhaCotas() {
        lerCotasForm(); // sincroniza primeiro
        cotasForm.push({ _db_id: null, person_id: '', pct: 0 });
        renderizarCotasForm();
    }

    window.removerCotaLinha = function(idx) {
        lerCotasForm();
        cotasForm.splice(idx, 1);
        renderizarCotasForm();
    };

    function lerCotasForm() {
        const container = document.getElementById('listaCotasForm');
        if (!container) return;
        const linhas = container.querySelectorAll('.linha-cota');
        cotasForm = Array.from(linhas).map(linha => ({
            _db_id:    linha.dataset.dbId || null,
            person_id: linha.querySelector('.cota-pessoa')?.value || '',
            pct:       parseFloat(linha.querySelector('.cota-pct')?.value) || 0
        }));
    }

    function renderizarCotasForm() {
        const container = document.getElementById('listaCotasForm');
        const infoTotal = document.getElementById('totalCotasInfo');
        if (!container) return;

        if (cotasForm.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; color:var(--text-muted); font-size:0.85rem; padding:12px 0;">
                    Nenhum sócio adicionado. As cotas são calculadas sobre o Líquido (Bruto − IPTU − DAS − Honorários).
                </div>
            `;
            if (infoTotal) infoTotal.textContent = '';
            return;
        }

        container.innerHTML = cotasForm.map((cota, idx) => `
            <div class="linha-cota" data-idx="${idx}" data-db-id="${escapeHtml(cota._db_id || '')}"
                 style="display:grid; grid-template-columns: 1fr 140px 36px; gap:10px; margin-bottom:10px; align-items:center;">
                <select class="select-control cota-pessoa" style="width:100%;" onchange="window._syncCotasForm()">
                    <option value="">Selecione o sócio...</option>
                    ${pessoas.map(p => `<option value="${escapeHtml(p.id)}" ${p.id === cota.person_id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                </select>
                <div style="display:flex; align-items:center; gap:4px;">
                    <input type="number" class="select-control cota-pct" min="0" max="100" step="0.01"
                           value="${cota.pct}" style="width:100%;" onchange="window._syncCotasForm()">
                    <span style="color:var(--text-muted); font-size:0.85rem;">%</span>
                </div>
                <button type="button" class="btn btn-danger btn-sm" onclick="window.removerCotaLinha(${idx})" style="padding:4px 8px;">🗑</button>
            </div>
        `).join('');

        const totalPct = cotasForm.reduce((acc, c) => acc + (c.pct || 0), 0);
        const color = Math.abs(totalPct - 100) < 0.01 ? 'var(--color-success)' : 'var(--color-warning)';
        if (infoTotal) {
            infoTotal.innerHTML = `Total das cotas: <strong style="color:${color};">${totalPct.toFixed(2)}%</strong>${Math.abs(totalPct - 100) < 0.01 ? ' ✅' : ' ⚠️ deve somar 100%'}`;
        }
    }

    // Sincroniza cotasForm com o DOM (chamado por onchange nos selects)
    window._syncCotasForm = function() {
        lerCotasForm();
        const totalPct  = cotasForm.reduce((acc, c) => acc + (c.pct || 0), 0);
        const infoTotal = document.getElementById('totalCotasInfo');
        if (infoTotal) {
            const color = Math.abs(totalPct - 100) < 0.01 ? 'var(--color-success)' : 'var(--color-warning)';
            infoTotal.innerHTML = `Total das cotas: <strong style="color:${color};">${totalPct.toFixed(2)}%</strong>${Math.abs(totalPct - 100) < 0.01 ? ' ✅' : ' ⚠️ deve somar 100%'}`;
        }
    };

    // -------------------------------------------------------------------------
    // Salvar Contrato de Locação
    // -------------------------------------------------------------------------
    async function salvarContratoLocacao(e) {
        e.preventDefault();
        lerCotasForm(); // sincroniza estado do DOM antes de salvar

        const idContrato     = document.getElementById('locContratoId')?.value || '';
        const idProperty     = document.getElementById('locPropertyId')?.value || '';
        const selContratoRef = document.getElementById('locImovelContrato');
        const contratoRefId  = selContratoRef?.value || '';
        const contratoRefSel = selContratoRef?.options[selContratoRef.selectedIndex];
        const nomeImovel     = contratoRefSel?.dataset?.name || contratoRefSel?.text || '';
        const tenantId     = document.getElementById('locLocatario')?.value || '';
        const valorCents   = window.BpoMoney.toCents(document.getElementById('locValor')?.value || '0');
        const dia          = parseInt(document.getElementById('locDia')?.value) || 10;
        const descontoCents = window.BpoMoney.toCents(document.getElementById('locDesconto')?.value || '0');
        const adminSocioId = document.getElementById('locAdminSocio')?.value || '';
        const adminPct     = parseFloat(document.getElementById('locAdminPct')?.value) || 0;

        if (!contratoRefId) { alert('Selecione o contrato (imóvel) correspondente.'); return; }

        const totalCotasPct = cotasForm.reduce((acc, c) => acc + (c.pct || 0), 0);
        if (cotasForm.length > 0 && Math.abs(totalCotasPct - 100) > 0.1) {
            if (!confirm(`As cotas somam ${totalCotasPct.toFixed(2)}% (esperado 100%). Continuar mesmo assim?`)) return;
        }

        try {
            let propertyId = idProperty;

            // 1. Cria ou atualiza o imóvel (properties)
            // Guarda referência ao contrato do sistema e desconto no nome do imóvel via JSON no campo name
            // (rental_contracts não possui colunas: notes, discount_amount, contract_ref_id)
            const propMeta = JSON.stringify({
                contract_ref_id:   contratoRefId || null,
                discount:          window.BpoMoney.toDecimalString(descontoCents),
                admin_socio_id:    adminSocioId || null,
                admin_pct:         adminPct,
                tenant_company_id: tenantId || null   // empresa locatária (tenant_id FK → people, não companies)
            });
            if (propertyId) {
                await window.BpoSupabase.request(`properties?id=eq.${propertyId}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ name: nomeImovel, address: propMeta })
                });
            } else {
                const novoImovel = await window.BpoSupabase.request('properties', {
                    method: 'POST',
                    prefer: 'return=representation',
                    body: JSON.stringify({
                        company_id:  empresaAtiva.id,
                        name:        nomeImovel,
                        status:      'active',
                        address: propMeta
                    })
                });
                propertyId = Array.isArray(novoImovel) ? novoImovel[0]?.id : novoImovel?.id;
                if (!propertyId) throw new Error('Falha ao obter ID do imóvel criado.');
            }

            // 2. Cria ou atualiza o contrato de locação
            // rental_contracts: colunas NOT NULL: property_id, tenant_id (FK→people), monthly_amount, start_date
            // A empresa locatária real fica em properties.address.tenant_company_id
            // tenant_id recebe o 1º sócio da empresa ativa como placeholder (exigência do schema)
            const placeholderTenantId = pessoas[0]?.id || null;
            if (!placeholderTenantId) {
                alert('Cadastre ao menos um sócio antes de salvar um contrato de locação (exigência do banco de dados).');
                return;
            }
            const payloadContrato = {
                property_id:    propertyId,
                tenant_id:      placeholderTenantId,
                monthly_amount: window.BpoMoney.toDecimalString(valorCents),
                due_day:        dia,
                status:         'active',
                start_date:     '2000-01-01'
            };

            if (idContrato) {
                await window.BpoSupabase.request(`rental_contracts?id=eq.${idContrato}`, {
                    method: 'PATCH', body: JSON.stringify(payloadContrato)
                });
            } else {
                await window.BpoSupabase.request('rental_contracts', {
                    method: 'POST', body: JSON.stringify(payloadContrato)
                });
            }

            // 3. Recria participantes para este imóvel
            // property_participants colunas: property_id, person_id, participation_pct, admin_pct, valid_from, valid_until
            // NÃO existe participant_type — usamos admin_pct > 0 para honorários, participation_pct > 0 para cotas
            if (propertyId) {
                const existentes = await window.BpoSupabase.request(
                    `property_participants?property_id=eq.${propertyId}`,
                    { method: 'GET' }
                ) || [];

                // Remove todos os participantes existentes e recria
                for (const p of existentes) {
                    await window.BpoSupabase.request(`property_participants?id=eq.${p.id}`, { method: 'DELETE' });
                }

                // Insere as cotas (participation_pct > 0, admin_pct = 0)
                for (const cota of cotasForm) {
                    if (!cota.person_id || cota.pct <= 0) continue;
                    await window.BpoSupabase.request('property_participants', {
                        method: 'POST',
                        body: JSON.stringify({
                            property_id:       propertyId,
                            person_id:         cota.person_id,
                            participation_pct: cota.pct,
                            admin_pct:         0,
                            valid_from:        '2000-01-01'
                        })
                    });
                }

                // Insere o sócio administrador (admin_pct > 0, participation_pct = 0)
                if (adminSocioId && adminPct > 0) {
                    await window.BpoSupabase.request('property_participants', {
                        method: 'POST',
                        body: JSON.stringify({
                            property_id:       propertyId,
                            person_id:         adminSocioId,
                            participation_pct: 0,
                            admin_pct:         adminPct,
                            valid_from:        '2000-01-01'
                        })
                    });
                }
            }

            fecharModais();
            await carregarDadosLocacoes();
            alert('Contrato de locação salvo com sucesso!');
        } catch (err) {
            alert('Erro ao salvar contrato: ' + err.message);
        }
    }

    window.excluirContratoLocacaoModal = async function() {
        const id = document.getElementById('locContratoId')?.value;
        if (!id || !confirm('Tem certeza que deseja excluir este contrato?')) return;
        try {
            await window.BpoSupabase.request(`rental_contracts?id=eq.${id}`, { method: 'DELETE' });
            fecharModais();
            await carregarDadosLocacoes();
            alert('Contrato excluído com sucesso.');
        } catch (err) {
            alert('Erro ao excluir contrato: ' + err.message);
        }
    };

    // =========================================================================
    // PROCESSAR RATEIO SOCIETÁRIO
    // =========================================================================
    async function processarRateio() {
        if (!empresaAtiva)       { alert('Selecione uma empresa.'); return; }
        if (imoveis.length === 0) { alert('Nenhum imóvel cadastrado. Crie um contrato de locação primeiro.'); return; }

        try {
            // Busca Valor Total e DAS dos billing_documents do período
            const { mapCompetencia: deducoesPorImovel } = await buscarDeducoesDoFaturamento();

            // Busca todos os participantes dos imóveis
            const imovelIds = imoveis.map(i => i.id);
            const participantesAll = await window.BpoSupabase.request(
                `property_participants?property_id=in.(${imovelIds.join(',')})`,
                { method: 'GET' }
            ) || [];

            const compDateStr        = `${competenciaAtiva}-01`;
            const distributionsToInsert = [];

            for (const imovel of imoveis) {
                const contrato = contratosLocacao.find(cl => cl.property_id === imovel.id && cl.status === 'active');
                if (!contrato) continue;

                const brutoCents    = window.BpoMoney.toCents(contrato.monthly_amount);
                const descontoCents = window.BpoMoney.toCents(contrato.discount_amount || 0);
                // Valor efetivamente recebido (bruto menos desconto contratual)
                const valorRecebidoCents = brutoCents > descontoCents ? brutoCents - descontoCents : brutoCents;

                // Deduções do faturamento (IPTU + DAS + juros/multa)
                const ded = deducoesPorImovel.get(imovel.id) || { iptuCents: 0n, dasCents: 0n, jurosMult: 0n, rawGrossCents: 0n, descontoCents: 0n };

                // Participantes válidos na competência
                // Honorário: quem tem admin_pct > 0 / Cota: quem tem participation_pct > 0
                const participantesImovel = participantesAll.filter(p => {
                    if (p.property_id !== imovel.id) return false;
                    const fromOk  = !p.valid_from  || p.valid_from  <= compDateStr;
                    const untilOk = !p.valid_until || p.valid_until >= compDateStr;
                    return fromOk && untilOk;
                });

                if (participantesImovel.length === 0) {
                    console.warn(`Imóvel "${imovel.name}": sem participantes configurados. Pulando.`);
                    continue;
                }

                // ---- HONORÁRIOS (admin_pct > 0 → calculados sobre gross_amount − desconto + juros/multa) ----
                const admParticipante = participantesImovel.find(p => parseFloat(p.admin_pct) > 0);
                let honorariosCents = 0n;

                if (admParticipante && parseFloat(admParticipante.admin_pct) > 0) {
                    // Base honorários = gross_amount do faturamento − desconto + juros/multa (sem IPTU)
                    const rawGrossRateio = ded.rawGrossCents || brutoCents;
                    const descRateio     = ded.descontoCents  || descontoCents;
                    const jurosRateio    = ded.jurosMult      || 0n;
                    const baseHonRateio  = rawGrossRateio - descRateio + jurosRateio;
                    honorariosCents = window.BpoMoney.applyPercentage(
                        baseHonRateio > 0n ? baseHonRateio : 0n, parseFloat(admParticipante.admin_pct)
                    );
                    distributionsToInsert.push({
                        property_id:          imovel.id,
                        participant_id:       admParticipante.person_id,
                        competence_month:     competenciaAtiva,
                        gross_received:       window.BpoMoney.toDecimalString(valorRecebidoCents),
                        deductions:           '0.00',
                        distributable_amount: window.BpoMoney.toDecimalString(honorariosCents),
                        distribution_amount:  window.BpoMoney.toDecimalString(honorariosCents),
                        participation_pct:    admParticipante.admin_pct,
                        idempotency_key:      `hon_${imovel.id}_${admParticipante.person_id}_${competenciaAtiva}`,
                        status:               'pending'
                    });
                }

                // ---- COTAS (participation_pct > 0 → calculadas sobre o líquido) ----
                const cotasParticipantes = participantesImovel.filter(p => parseFloat(p.participation_pct) > 0);
                if (cotasParticipantes.length > 0) {
                    const totalDeducoesCotas = ded.iptuCents + ded.dasCents + honorariosCents;
                    const calculo = window.BpoRentalEngine.calcularDistribuicao({
                        grossReceived: valorRecebidoCents,
                        deductions:   totalDeducoesCotas,
                        adminRate:    0, // honorários já calculados e subtraídos
                        participants: cotasParticipantes
                    });

                    calculo.distribuicoes.forEach(item => {
                        distributionsToInsert.push({
                            property_id:          imovel.id,
                            participant_id:       item.person_id,
                            competence_month:     competenciaAtiva,
                            gross_received:       window.BpoMoney.toDecimalString(calculo.grossCents),
                            deductions:           window.BpoMoney.toDecimalString(calculo.deductionsCents),
                            distributable_amount: window.BpoMoney.toDecimalString(calculo.distributableCents),
                            distribution_amount:  window.BpoMoney.toDecimalString(item.amountCents),
                            participation_pct:    item.participation_pct,
                            idempotency_key:      `cota_${imovel.id}_${item.person_id}_${competenciaAtiva}`,
                            status:               'pending'
                        });
                    });
                }
            }

            if (distributionsToInsert.length === 0) {
                alert('Nenhum rateio calculado. Verifique se os contratos possuem participantes configurados.');
                return;
            }

            // Remove 'pending' existentes para o período (nunca toca os 'paid')
            // Filtra pelos imóveis da empresa (company_id não existe em rental_distributions)
            if (imoveis.length > 0) {
                const idsImov2 = imoveis.map(i => i.id).join(',');
                const calcsExistentes = await window.BpoSupabase.request(
                    `rental_distributions?property_id=in.(${idsImov2})&competence_month=eq.${competenciaAtiva}&status=eq.pending`,
                    { method: 'GET' }
                ) || [];
                for (const c of calcsExistentes) {
                    await window.BpoSupabase.request(`rental_distributions?id=eq.${c.id}`, { method: 'DELETE' });
                }
            }

            // Insere em lote
            await window.BpoSupabase.request('rental_distributions', {
                method: 'POST',
                body: JSON.stringify(distributionsToInsert)
            });

            await carregarDadosLocacoes();
            alert(`Rateio processado com sucesso!\n${distributionsToInsert.length} repasse(s) gerado(s) para ${competenciaAtiva}.`);

        } catch (err) {
            console.error('Erro ao processar rateio:', err);
            alert('Erro ao processar rateio: ' + err.message);
        }
    }

    // =========================================================================
    // QUITAR REPASSE
    // =========================================================================
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

    function formatarData(dataStr) {
        if (!dataStr) return '—';
        const parts = String(dataStr).split('-');
        if (parts.length === 3) {
            return `${parts[2]}/${parts[1]}/${parts[0]}`;
        }
        return dataStr;
    }
})();
