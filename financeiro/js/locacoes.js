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
        if (modalSocios)          modalSocios.style.display = 'none';
        if (modalCadastroSocio)   modalCadastroSocio.style.display = 'none';
        if (modalContratoLocacao) modalContratoLocacao.style.display = 'none';
    };

    window.voltarParaSocios = function() {
        if (modalCadastroSocio)  modalCadastroSocio.style.display = 'none';
        if (modalSocios)         modalSocios.style.display = 'flex';
    };

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

            // 5. Distribuições da competência
            distribuicoes = await window.BpoSupabase.request(
                `rental_distributions?company_id=eq.${empresaAtiva.id}&competence_month=eq.${competenciaAtiva}&order=property_id.asc,distribution_type.asc`,
                { method: 'GET' }
            ) || [];

            renderizarMetricas();
            renderizarExtrato();

        } catch (err) {
            console.error('Erro ao carregar dados de locações:', err);
        }
    }

    // =========================================================================
    // BUSCAR IPTU E DAS DOS BILLING_DOCUMENTS DO PERÍODO (regime de caixa)
    // =========================================================================
    async function buscarDeducoesDoFaturamento() {
        // Retorna mapa: property_id → { iptuCents: BigInt, dasCents: BigInt }
        const deducoesPorImovel = new Map();
        try {
            const docs = await window.BpoSupabase.request(
                `billing_documents?company_id=eq.${empresaAtiva.id}&status=neq.cancelled`,
                { method: 'GET' }
            ) || [];

            docs.forEach(d => {
                // Extrai tax_details do campo description (padrão do sistema BPO)
                let td = {};
                if (d.tax_details && typeof d.tax_details === 'object') {
                    td = d.tax_details;
                } else if (d.description && typeof d.description === 'string') {
                    const match = d.description.match(/<!--bpo_tax_details:(.*?)-->/);
                    if (match) { try { td = JSON.parse(match[1]); } catch (e) {} }
                }

                // Apenas documentos de locação
                if (!td.is_locacao && d.document_type !== 'locacao') return;

                // Filtra pelo mês de recebimento (regime de caixa)
                const dataRec = td.payment_date || d.payment_date || d.receipt_date || null;
                const mesRec  = dataRec ? String(dataRec).slice(0, 7) : '';
                if (mesRec !== competenciaAtiva) return;

                // Localiza o imóvel pelo contrato
                const contrato = contratosLocacao.find(c => c.id === d.contract_id);
                if (!contrato) return;
                const propId = contrato.property_id;
                if (!deducoesPorImovel.has(propId)) {
                    deducoesPorImovel.set(propId, { iptuCents: 0n, dasCents: 0n });
                }

                const entry = deducoesPorImovel.get(propId);

                // IPTU: informado pelo usuário no lançamento de faturamento (campo iptu_valor)
                if (td.iptu_valor) {
                    entry.iptuCents += window.BpoMoney.toCents(td.iptu_valor);
                }

                // DAS (Simples Nacional): calculado automaticamente no módulo de faturamento
                if (td.das_valor) {
                    entry.dasCents += window.BpoMoney.toCents(td.das_valor);
                }
                // Lucro Presumido: soma PIS + COFINS + IRPJ + CSLL da nota de locação
                if (!td.is_simples && td.is_locacao) {
                    ['pis_valor', 'cofins_valor', 'irpj_valor', 'csll_valor'].forEach(campo => {
                        if (td[campo]) entry.dasCents += window.BpoMoney.toCents(td[campo]);
                    });
                }
            });
        } catch (e) {
            console.warn('Aviso: não foi possível buscar deduções do faturamento:', e);
        }
        return deducoesPorImovel;
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
            const tipo = d.distribution_type || 'cota';

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
    // EXTRATO DE RATEIO
    // =========================================================================
    function renderizarExtrato() {
        if (!listaDistribuicoesBody) return;

        if (distribuicoes.length === 0) {
            listaDistribuicoesBody.innerHTML = `
                <tr>
                    <td colspan="10" style="text-align: center; color: var(--text-muted); padding: 32px;">
                        Nenhum rateio registrado para a competência ${escapeHtml(competenciaAtiva)}.<br>
                        Clique em <strong>⚡ Processar Rateio Societário</strong> para gerar os repasses.
                    </td>
                </tr>
            `;
            return;
        }

        listaDistribuicoesBody.innerHTML = distribuicoes.map(d => {
            const imovel      = imoveis.find(i => i.id === d.property_id) || { name: 'Imóvel' };
            const participante = pessoas.find(p => p.id === d.participant_id) || { name: 'Sócio' };
            const tipo        = d.distribution_type || 'cota';

            const tipoBadge = tipo === 'honorarios'
                ? '<span class="badge badge-warning">🏦 Honorários</span>'
                : '<span class="badge badge-info">📊 Cota</span>';

            const statusBadge = d.status === 'paid'
                ? '<span class="badge badge-success">Pago</span>'
                : '<span class="badge badge-warning">A Repassar</span>';

            const pct = tipo === 'honorarios'
                ? `${Number(d.admin_pct || d.participation_pct || 0).toFixed(2)}%`
                : `${Number(d.participation_pct || 0).toFixed(2)}%`;

            const deducoesDisplay = tipo === 'honorarios'
                ? '<span style="color:var(--text-muted);">—</span>'
                : window.BpoMoney.formatBRL(d.deductions);

            return `
                <tr>
                    <td style="font-weight:700; color:#fff;">${escapeHtml(d.competence_month)}</td>
                    <td>${escapeHtml(imovel.name)}</td>
                    <td style="font-weight:600; color:#fff;">${escapeHtml(participante.name)}</td>
                    <td>${tipoBadge}</td>
                    <td>${window.BpoMoney.formatBRL(d.gross_received)}</td>
                    <td style="color:var(--color-danger);">${deducoesDisplay}</td>
                    <td style="color:var(--color-warning);">${pct}</td>
                    <td style="font-weight:700; color:#fff;">${window.BpoMoney.formatBRL(d.distribution_amount)}</td>
                    <td>${statusBadge}</td>
                    <td>
                        ${d.status !== 'paid' ? `
                            <button class="btn btn-secondary btn-sm btn-quitar-repasse" data-id="${escapeHtml(d.id)}">
                                ✅ Quitar
                            </button>
                        ` : '<span style="color:var(--text-muted); font-size:0.8rem;">Concluído</span>'}
                    </td>
                </tr>
            `;
        }).join('');
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

        // Popula locatário
        if (selLocatario) {
            selLocatario.innerHTML = pessoas.map(p =>
                `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`
            ).join('') || '<option value="">Nenhuma pessoa cadastrada</option>';
        }

        // Popula sócio administrador
        if (selAdminSocio) {
            selAdminSocio.innerHTML = '<option value="">Nenhum (sem honorários)</option>' +
                pessoas.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
        }

        const inpId          = document.getElementById('locContratoId');
        const inpPropId      = document.getElementById('locPropertyId');
        const selContratoRef = document.getElementById('locImovelContrato'); // select de contratos
        const inpValor       = document.getElementById('locValor');
        const inpDia         = document.getElementById('locDia');
        const inpDesconto    = document.getElementById('locDesconto');
        const inpAdminPct    = document.getElementById('locAdminPct');
        const btnExc         = document.getElementById('btnExcluirContrato');
        const titulo         = document.getElementById('modalContratoTitulo');

        // Popula o select de contratos agrupado por empresa
        if (selContratoRef) {
            selContratoRef.innerHTML = '<option value="">Selecione o contrato (imóvel)...</option>';
            const porEmpresa = new Map();
            todosContratos.forEach(c => {
                if (!porEmpresa.has(c.company_id)) porEmpresa.set(c.company_id, []);
                porEmpresa.get(c.company_id).push(c);
            });
            porEmpresa.forEach((contratos, companyId) => {
                const emp = empresas.find(e => e.id === companyId);
                const nomeEmp = emp ? (emp.trade_name || emp.name) : companyId;
                const grp = document.createElement('optgroup');
                grp.label = nomeEmp;
                contratos.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c.id;
                    // Armazena name+code como data-name para uso posterior
                    opt.dataset.name = c.code ? `${c.code} — ${c.name}` : c.name;
                    opt.textContent = c.code ? `${c.code} — ${c.name}` : c.name;
                    grp.appendChild(opt);
                });
                selContratoRef.appendChild(grp);
            });
        }

        document.getElementById('formContratoLocacao')?.reset();
        cotasForm = [];
        renderizarCotasForm();

        if (contratoExistente) {
            if (titulo)   titulo.textContent = 'Editar Contrato de Locação';
            if (inpId)    inpId.value = contratoExistente.id;
            if (inpPropId) inpPropId.value = contratoExistente.property_id || '';
            // Restaura a seleção do contrato de referência
            if (selContratoRef && contratoExistente.contract_ref_id) {
                selContratoRef.value = contratoExistente.contract_ref_id;
            }
            if (selLocatario)  selLocatario.value  = contratoExistente.tenant_id || '';
            if (inpValor)  inpValor.value = window.BpoMoney.formatBRL(contratoExistente.monthly_amount).replace('R$\u00a0', '').trim();
            if (inpDia)    inpDia.value   = contratoExistente.due_day || 10;
            if (inpDesconto) inpDesconto.value = window.BpoMoney.formatBRL(contratoExistente.discount_amount || 0).replace('R$\u00a0', '').trim();

            // Lê honorários do notes do contrato
            const notes    = contratoExistente.notes || '';
            const mAdmin   = notes.match(/\[AdminSocio:\s*(.*?)\]/);
            const mAdminPct = notes.match(/\[AdminPct:\s*(.*?)\]/);
            if (mAdmin   && selAdminSocio) selAdminSocio.value = mAdmin[1].trim();
            if (mAdminPct && inpAdminPct)  inpAdminPct.value   = mAdminPct[1].trim();

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
                .filter(p => (p.participant_type || 'cota') === 'cota')
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

        // Metadados de honorários armazenados no campo notes do contrato
        const notes = adminSocioId
            ? `[AdminSocio: ${adminSocioId}] [AdminPct: ${adminPct}]`
            : '';

        try {
            let propertyId = idProperty;

            // 1. Cria ou atualiza o imóvel (properties)
            if (propertyId) {
                await window.BpoSupabase.request(`properties?id=eq.${propertyId}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ name: nomeImovel })
                });
            } else {
                const novoImovel = await window.BpoSupabase.request('properties', {
                    method: 'POST',
                    prefer: 'return=representation',
                    body: JSON.stringify({
                        company_id: empresaAtiva.id,
                        name: nomeImovel,
                        status: 'active'
                    })
                });
                propertyId = Array.isArray(novoImovel) ? novoImovel[0]?.id : novoImovel?.id;
                if (!propertyId) throw new Error('Falha ao obter ID do imóvel criado.');
            }

            // 2. Cria ou atualiza o contrato de locação
            const payloadContrato = {
                company_id:      empresaAtiva.id,
                property_id:     propertyId,
                tenant_id:       tenantId || null,
                monthly_amount:  window.BpoMoney.toDecimalString(valorCents),
                discount_amount: window.BpoMoney.toDecimalString(descontoCents),
                due_day:         dia,
                status:          'active',
                notes:           notes,
                contract_ref_id: contratoRefId || null  // referência ao contrato cadastrado no sistema
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

            // 3. Recria participantes do tipo 'cota' para este imóvel
            if (propertyId) {
                const existentes = await window.BpoSupabase.request(
                    `property_participants?property_id=eq.${propertyId}`,
                    { method: 'GET' }
                ) || [];

                // Remove todos os 'cota' existentes
                for (const p of existentes.filter(p => (p.participant_type || 'cota') === 'cota')) {
                    await window.BpoSupabase.request(`property_participants?id=eq.${p.id}`, { method: 'DELETE' });
                }
                // Insere as novas cotas
                for (const cota of cotasForm) {
                    if (!cota.person_id) continue;
                    await window.BpoSupabase.request('property_participants', {
                        method: 'POST',
                        body: JSON.stringify({
                            property_id:      propertyId,
                            person_id:        cota.person_id,
                            participation_pct: cota.pct,
                            admin_pct:        0,
                            participant_type: 'cota',
                            valid_from:       '2000-01-01'
                        })
                    });
                }

                // Remove todos os 'honorarios' existentes e recria se houver
                for (const p of existentes.filter(p => (p.participant_type || '') === 'honorarios')) {
                    await window.BpoSupabase.request(`property_participants?id=eq.${p.id}`, { method: 'DELETE' });
                }
                if (adminSocioId && adminPct > 0) {
                    await window.BpoSupabase.request('property_participants', {
                        method: 'POST',
                        body: JSON.stringify({
                            property_id:      propertyId,
                            person_id:        adminSocioId,
                            participation_pct: 0,
                            admin_pct:        adminPct,
                            participant_type: 'honorarios',
                            valid_from:       '2000-01-01'
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
            // Busca IPTU e DAS dos billing_documents do período
            const deducoesPorImovel = await buscarDeducoesDoFaturamento();

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

                // Deduções do faturamento (IPTU + DAS)
                const ded = deducoesPorImovel.get(imovel.id) || { iptuCents: 0n, dasCents: 0n };

                // Participantes válidos na competência
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

                // ---- HONORÁRIOS (calculados sobre o bruto recebido, antes das cotas) ----
                const admParticipante = participantesImovel.find(p => (p.participant_type || 'cota') === 'honorarios');
                let honorariosCents = 0n;

                if (admParticipante && parseFloat(admParticipante.admin_pct) > 0) {
                    honorariosCents = window.BpoMoney.applyPercentage(
                        valorRecebidoCents, parseFloat(admParticipante.admin_pct)
                    );
                    distributionsToInsert.push({
                        company_id:          empresaAtiva.id,
                        property_id:         imovel.id,
                        participant_id:      admParticipante.person_id,
                        competence_month:    competenciaAtiva,
                        distribution_type:   'honorarios',
                        gross_received:      window.BpoMoney.toDecimalString(valorRecebidoCents),
                        deductions:          '0.00',
                        distributable_amount: window.BpoMoney.toDecimalString(honorariosCents),
                        participation_pct:   0,
                        admin_pct:           admParticipante.admin_pct,
                        distribution_amount: window.BpoMoney.toDecimalString(honorariosCents),
                        status:              'pending',
                        idempotency_key:     `hon_${imovel.id}_${admParticipante.person_id}_${competenciaAtiva}`
                    });
                }

                // ---- COTAS (calculadas sobre o líquido: bruto − IPTU − DAS − honorários) ----
                const cotasParticipantes = participantesImovel.filter(p => (p.participant_type || 'cota') === 'cota');
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
                            company_id:          empresaAtiva.id,
                            property_id:         imovel.id,
                            participant_id:      item.person_id,
                            competence_month:    competenciaAtiva,
                            distribution_type:   'cota',
                            gross_received:      window.BpoMoney.toDecimalString(calculo.grossCents),
                            deductions:          window.BpoMoney.toDecimalString(calculo.deductionsCents),
                            distributable_amount: window.BpoMoney.toDecimalString(calculo.distributableCents),
                            participation_pct:   item.participation_pct,
                            admin_pct:           0,
                            distribution_amount: window.BpoMoney.toDecimalString(item.amountCents),
                            status:              'pending',
                            idempotency_key:     `cota_${imovel.id}_${item.person_id}_${competenciaAtiva}`
                        });
                    });
                }
            }

            if (distributionsToInsert.length === 0) {
                alert('Nenhum rateio calculado. Verifique se os contratos possuem participantes configurados.');
                return;
            }

            // Remove 'pending' existentes para o período (nunca toca os 'paid')
            const calcsExistentes = await window.BpoSupabase.request(
                `rental_distributions?company_id=eq.${empresaAtiva.id}&competence_month=eq.${competenciaAtiva}&status=eq.pending`,
                { method: 'GET' }
            ) || [];
            for (const c of calcsExistentes) {
                await window.BpoSupabase.request(`rental_distributions?id=eq.${c.id}`, { method: 'DELETE' });
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
})();
