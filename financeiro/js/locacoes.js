// ==============================================================================
// locacoes.js — Lógica do Módulo 08 (Locações e Rateio de Imóveis Ybox)
// ==============================================================================

(function() {
    let empresas = [];
    let empresaAtiva = null;
    let competenciaAtiva = '';
    let imoveis = [];
    let contratosLocacao = [];
    let distribuicoes = [];
    let pessoas = [];

    // DOM
    const selectEmpresa = document.getElementById('selectEmpresa');
    const inputCompetencia = document.getElementById('inputCompetencia');
    const listaDistribuicoesBody = document.getElementById('listaDistribuicoesBody');
    const listaImoveisBody = document.getElementById('listaImoveisBody');

    // Métricas
    const valAlugueisBruto = document.getElementById('valAlugueisBruto');
    const valDeducoes = document.getElementById('valDeducoes');
    const valDistribuivel = document.getElementById('valDistribuivel');
    const valTotalImoveis = document.getElementById('valTotalImoveis');

    // Modais
    const modalImovel = document.getElementById('modalImovel');
    const modalContratoLocacao = document.getElementById('modalContratoLocacao');

    window.addEventListener('DOMContentLoaded', async () => {
        const hoje = new Date();
        const ano = hoje.getFullYear();
        const mes = String(hoje.getMonth() + 1).padStart(2, '0');
        competenciaAtiva = `${ano}-${mes}`;
        inputCompetencia.value = competenciaAtiva;

        await carregarEmpresas();

        selectEmpresa.addEventListener('change', async (e) => {
            empresaAtiva = empresas.find(emp => emp.id === e.target.value) || null;
            await carregarDadosLocacoes();
        });

        inputCompetencia.addEventListener('change', async (e) => {
            competenciaAtiva = e.target.value;
            await carregarDadosLocacoes();
        });

        document.getElementById('btnNovoImovel').addEventListener('click', () => {
            document.getElementById('imovelId').value = '';
            document.getElementById('modalImovelTitulo').textContent = 'Cadastrar Novo Imóvel';
            document.getElementById('formImovel').reset();
            const btnExc = document.getElementById('btnExcluirImovel');
            if (btnExc) btnExc.style.display = 'none';
            modalImovel.style.display = 'flex';
        });

        document.getElementById('btnNovoContratoLocacao').addEventListener('click', abrirModalContrato);
        document.getElementById('btnProcessarDistribuicao').addEventListener('click', processarRateio);

        document.getElementById('formImovel').addEventListener('submit', salvarImovel);
        document.getElementById('formContratoLocacao').addEventListener('submit', salvarContratoLocacao);
    });

    window.fecharModais = function() {
        modalImovel.style.display = 'none';
        modalContratoLocacao.style.display = 'none';
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

            // Prioriza Ybox se existir no nome
            const ybox = empresas.find(e => e.name.toLowerCase().includes('ybox'));
            empresaAtiva = ybox || empresas[0];
            selectEmpresa.value = empresaAtiva.id;

            await carregarDadosLocacoes();

        } catch (err) {
            console.error("Erro ao carregar empresas:", err);
        }
    }

    async function carregarDadosLocacoes() {
        if (!empresaAtiva) return;

        try {
            // 1. Pessoas vinculadas à empresa (para participantes/locatários)
            pessoas = await window.BpoSupabase.request(`people?company_id=eq.${empresaAtiva.id}&order=name.asc`, { method: 'GET' });

            // 2. Imóveis da empresa ativa
            imoveis = await window.BpoSupabase.request(`properties?company_id=eq.${empresaAtiva.id}&order=name.asc`, { method: 'GET' });
            valTotalImoveis.textContent = imoveis.length;

            const imovelIds = imoveis.map(i => i.id);

            // 3. Contratos de locação ativos vinculados aos imóveis da empresa ativa
            if (imovelIds.length > 0) {
                const idsParam = `in.(${imovelIds.join(',')})`;
                contratosLocacao = await window.BpoSupabase.request(
                    `rental_contracts?status=eq.active&property_id=${idsParam}`,
                    { method: 'GET' }
                );
            } else {
                contratosLocacao = [];
            }

            // 4. Distribuições da empresa ativa na competência
            distribuicoes = await window.BpoSupabase.request(
                `rental_distributions?company_id=eq.${empresaAtiva.id}&competence_month=eq.${competenciaAtiva}&order=created_at.desc`,
                { method: 'GET' }
            );

            renderizarMetricas();
            renderizarExtrato();
            renderizarImoveis();

        } catch (err) {
            console.error("Erro ao carregar dados de locações:", err);
        }
    }

    function renderizarMetricas() {
        let brutoTotal = 0n;
        let deducoesTotal = 0n;
        let distribuivelTotal = 0n;

        distribuicoes.forEach(d => {
            brutoTotal += window.BpoMoney.toCents(d.gross_received);
            deducoesTotal += window.BpoMoney.toCents(d.deductions);
            distribuivelTotal += window.BpoMoney.toCents(d.distribution_amount);
        });

        valAlugueisBruto.textContent = window.BpoMoney.formatBRL(brutoTotal);
        valDeducoes.textContent = window.BpoMoney.formatBRL(deducoesTotal);
        valDistribuivel.textContent = window.BpoMoney.formatBRL(distribuivelTotal);
    }

    function renderizarExtrato() {
        if (distribuicoes.length === 0) {
            listaDistribuicoesBody.innerHTML = `
                <tr>
                    <td colspan="9" style="text-align: center; color: var(--text-muted); padding: 32px;">
                        Nenhum rateio societário registrado para a competência ${window.BpoUtils.escapeHtml(competenciaAtiva)}. Clique em "Processar Rateio Societário".
                    </td>
                </tr>
            `;
            return;
        }

        listaDistribuicoesBody.innerHTML = distribuicoes.map(d => {
            const imovel = imoveis.find(i => i.id === d.property_id) || { name: 'Imóvel' };
            const participante = pessoas.find(p => p.id === d.participant_id) || { name: 'Sócio Participante' };
            const statusBadge = d.status === 'paid' 
                ? '<span class="badge badge-success">Pago</span>' 
                : '<span class="badge badge-warning">A Repassar</span>';

            return `
                <tr>
                    <td style="font-weight: 700; color: #fff;">${window.BpoUtils.escapeHtml(d.competence_month)}</td>
                    <td>${window.BpoUtils.escapeHtml(imovel.name)}</td>
                    <td style="font-weight: 600; color: #fff;">${window.BpoUtils.escapeHtml(participante.name)}</td>
                    <td>${window.BpoMoney.formatBRL(d.gross_received)}</td>
                    <td style="color: var(--color-danger);">${window.BpoMoney.formatBRL(d.deductions)}</td>
                    <td style="color: var(--color-warning);">${Number(d.participation_pct).toFixed(2)}%</td>
                    <td style="font-weight: 700; color: #fff;">${window.BpoMoney.formatBRL(d.distribution_amount)}</td>
                    <td>${statusBadge}</td>
                    <td>
                        ${d.status !== 'paid' ? `
                            <button class="btn btn-secondary btn-sm" onclick="window.quitarDistribuicao('${window.BpoUtils.escapeHtml(d.id)}')">
                                Quitar Repasse
                            </button>
                        ` : '<span style="color: var(--text-muted); font-size: 0.8rem;">Concluído</span>'}
                    </td>
                </tr>
            `;
        }).join('');
    }

    function renderizarImoveis() {
        if (imoveis.length === 0) {
            listaImoveisBody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">
                        Nenhum imóvel cadastrado para esta empresa.
                    </td>
                </tr>
            `;
            return;
        }

        listaImoveisBody.innerHTML = imoveis.map(i => {
            const c = contratosLocacao.find(cl => cl.property_id === i.id);
            const valorLoc = c ? window.BpoMoney.formatBRL(c.monthly_amount) : 'Sem contrato';
            const diaVenc = c ? `Dia ${c.due_day}` : '-';

            return `
                <tr>
                    <td style="font-weight: 600; color: #fff;">${window.BpoUtils.escapeHtml(i.name)}</td>
                    <td>${window.BpoUtils.escapeHtml(i.address || 'Santos / SP')}</td>
                    <td style="color: var(--color-success); font-weight: 700;">${valorLoc}</td>
                    <td>${diaVenc}</td>
                    <td><span class="badge badge-success">Ativo</span></td>
                    <td style="display: flex; gap: 6px;">
                        <button class="btn btn-secondary btn-sm" onclick="window.editarImovel('${window.BpoUtils.escapeHtml(i.id)}')">
                            ✏️ Editar
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="window.deletarImovel('${window.BpoUtils.escapeHtml(i.id)}')">
                            🗑️ Excluir
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    window.editarImovel = function(id) {
        const i = imoveis.find(im => im.id === id);
        if (!i) return;

        document.getElementById('imovelId').value = i.id;
        document.getElementById('modalImovelTitulo').textContent = 'Editar Imóvel';
        document.getElementById('imovelNome').value = i.name || '';
        document.getElementById('imovelEndereco').value = i.address || '';
        const btnExc = document.getElementById('btnExcluirImovel');
        if (btnExc) btnExc.style.display = 'inline-flex';

        modalImovel.style.display = 'flex';
    };

    window.deletarImovelModal = async function() {
        const id = document.getElementById('imovelId').value;
        if (!id) return;
        if (!confirm('Tem certeza que deseja excluir este imóvel?')) return;
        try {
            await window.BpoSupabase.request(`properties?id=eq.${id}`, { method: 'DELETE' });
            fecharModais();
            await carregarDadosLocacoes();
            alert('Imóvel excluído com sucesso.');
        } catch (err) {
            alert('Erro ao excluir imóvel: ' + err.message);
        }
    };

    function abrirModalContrato() {
        const selImovel = document.getElementById('locImovel');
        selImovel.innerHTML = imoveis.map(i => `<option value="${window.BpoUtils.escapeHtml(i.id)}">${window.BpoUtils.escapeHtml(i.name)}</option>`).join('') || '<option value="">Sem imóveis cadastrados</option>';

        const selLocatario = document.getElementById('locLocatario');
        if (selLocatario) {
            selLocatario.innerHTML = pessoas.map(p => `<option value="${window.BpoUtils.escapeHtml(p.id)}">${window.BpoUtils.escapeHtml(p.name)} (${window.BpoUtils.escapeHtml(p.person_type || 'cliente')})</option>`).join('') || '<option value="">Nenhuma pessoa cadastrada</option>';
        }

        modalContratoLocacao.style.display = 'flex';
    }

    async function salvarImovel(e) {
        e.preventDefault();
        const idExistente = document.getElementById('imovelId').value;
        const nome = document.getElementById('imovelNome').value.trim();
        const end = document.getElementById('imovelEndereco').value.trim();

        try {
            if (idExistente) {
                await window.BpoSupabase.request(`properties?id=eq.${idExistente}`, {
                    method: 'PATCH',
                    body: JSON.stringify({
                        name: nome,
                        address: end
                    })
                });

                fecharModais();
                document.getElementById('formImovel').reset();
                await carregarDadosLocacoes();
                alert('Imóvel atualizado com sucesso!');
                return;
            }

            await window.BpoSupabase.request('properties', {
                method: 'POST',
                body: JSON.stringify({
                    company_id: empresaAtiva.id,
                    name: nome,
                    address: end,
                    status: 'active'
                })
            });

            fecharModais();
            document.getElementById('formImovel').reset();
            await carregarDadosLocacoes();
            alert('Imóvel cadastrado com sucesso!');
        } catch (err) {
            alert('Erro ao salvar imóvel: ' + err.message);
        }
    }

    async function salvarContratoLocacao(e) {
        e.preventDefault();
        const imovelId = document.getElementById('locImovel').value;
        const tenantId = document.getElementById('locLocatario') ? document.getElementById('locLocatario').value : '';
        const valorCents = window.BpoMoney.toCents(document.getElementById('locValor').value);
        const dia = parseInt(document.getElementById('locDia').value) || 10;

        if (!imovelId) {
            alert('Selecione um imóvel válido.');
            return;
        }

        if (!tenantId) {
            alert('Cadastre ou selecione um inquilino/locatário cadastrado para esta empresa.');
            return;
        }

        try {
            await window.BpoSupabase.request('rental_contracts', {
                method: 'POST',
                body: JSON.stringify({
                    company_id: empresaAtiva.id,
                    property_id: imovelId,
                    tenant_id: tenantId,
                    start_date: new Date().toISOString().split('T')[0],
                    monthly_amount: window.BpoMoney.toDecimalString(valorCents),
                    due_day: dia,
                    status: 'active'
                })
            });

            fecharModais();
            await carregarDadosLocacoes();
            alert('Contrato de locação registrado com sucesso!');
        } catch (err) {
            alert('Erro ao gravar contrato: ' + err.message);
        }
    }

    async function processarRateio() {
        if (!empresaAtiva || imoveis.length === 0) {
            alert('Cadastre imóveis com contratos antes de processar.');
            return;
        }

        try {
            let gerados = 0;
            const distributionsToInsert = [];

            // Obtém todos os participantes associados aos imóveis desta empresa
            const imovelIds = imoveis.map(i => i.id);
            const participantsAll = await window.BpoSupabase.request(
                `property_participants?property_id=in.(${imovelIds.join(',')})`,
                { method: 'GET' }
            );

            for (const imovel of imoveis) {
                const contrato = contratosLocacao.find(cl => cl.property_id === imovel.id);
                if (!contrato) continue;

                // Participantes válidos na competência
                const compDateStr = `${competenciaAtiva}-01`;
                const participantsProperty = participantsAll.filter(p => {
                    if (p.property_id !== imovel.id) return false;
                    const fromOk = !p.valid_from || p.valid_from <= compDateStr;
                    const untilOk = !p.valid_until || p.valid_until >= compDateStr;
                    return fromOk && untilOk;
                });

                if (participantsProperty.length === 0) {
                    console.warn(`Imóvel "${imovel.name}" não possui participantes configurados em property_participants.`);
                    continue;
                }

                const brutoCents = window.BpoMoney.toCents(contrato.monthly_amount);
                const deducoesCents = 0n; // Deduções específicas do contrato/imóvel

                // Usa admin_pct do primeiro participante ou média se aplicável
                const adminRate = parseFloat(participantsProperty[0].admin_pct) || 0;

                const calculo = window.BpoRentalEngine.calcularDistribuicao({
                    grossReceived: brutoCents,
                    deductions: deducoesCents,
                    adminRate: adminRate,
                    participants: participantsProperty
                });

                calculo.distribuicoes.forEach(item => {
                    const idempotencyKey = `dist_${imovel.id}_${item.person_id}_${competenciaAtiva}`;
                    distributionsToInsert.push({
                        company_id: empresaAtiva.id,
                        property_id: imovel.id,
                        participant_id: item.person_id,
                        competence_month: competenciaAtiva,
                        gross_received: window.BpoMoney.toDecimalString(calculo.grossCents),
                        deductions: window.BpoMoney.toDecimalString(calculo.deductionsCents),
                        distributable_amount: window.BpoMoney.toDecimalString(calculo.distributableCents),
                        participation_pct: item.participation_pct,
                        distribution_amount: window.BpoMoney.toDecimalString(item.amountCents),
                        status: 'pending',
                        idempotency_key: idempotencyKey
                    });
                });
            }

            if (distributionsToInsert.length === 0) {
                alert('Nenhum rateio calculado. Verifique se os imóveis possuem contratos ativos e participantes em "property_participants".');
                return;
            }

            // Upsert em lote com header de conflito
            await window.BpoSupabase.request(
                'rental_distributions?on_conflict=idempotency_key',
                {
                    method: 'POST',
                    headers: { 'Prefer': 'resolution=ignore-duplicates' },
                    body: JSON.stringify(distributionsToInsert)
                }
            );

            gerados = distributionsToInsert.length;
            await carregarDadosLocacoes();
            alert(`Processamento concluído! ${gerados} rateio(s) registrado(s) para a competência ${competenciaAtiva}.`);

        } catch (err) {
            console.error("Erro ao processar rateio:", err);
            alert('Erro ao processar rateio: ' + err.message);
        }
    }

    window.quitarDistribuicao = async function(id) {
        if (!confirm('Confirmar o repasse financeiro desta locação ao sócio?')) return;
        try {
            await window.BpoSupabase.request(`rental_distributions?id=eq.${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'paid' })
            });
            await carregarDadosLocacoes();
            alert('Repasse quitado com sucesso!');
        } catch (err) {
            alert('Erro ao quitar repasse: ' + err.message);
        }
    };

    window.deletarImovel = async function(id) {
        if (!confirm('Tem certeza que deseja excluir este imóvel?')) return;
        try {
            await window.BpoSupabase.request(`properties?id=eq.${id}`, { method: 'DELETE' });
            await carregarDadosLocacoes();
            alert('Imóvel excluído com sucesso.');
        } catch (err) {
            alert('Erro ao excluir imóvel: ' + err.message);
        }
    };
})();
