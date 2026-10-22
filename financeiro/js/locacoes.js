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
            // 1. Imóveis da empresa
            imoveis = await window.BpoSupabase.request(`properties?company_id=eq.${empresaAtiva.id}&order=name.asc`, { method: 'GET' });
            valTotalImoveis.textContent = imoveis.length;

            // 2. Contratos de locação
            contratosLocacao = await window.BpoSupabase.request(`rental_contracts?status=eq.active`, { method: 'GET' });

            // 3. Distribuições já registradas na competência
            distribuicoes = await window.BpoSupabase.request(
                `rental_distributions?competence_month=eq.${competenciaAtiva}&order=created_at.desc`,
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
                        Nenhum rateio societário registrado para a competência ${competenciaAtiva}. Clique em "Processar Rateio Societário".
                    </td>
                </tr>
            `;
            return;
        }

        listaDistribuicoesBody.innerHTML = distribuicoes.map(d => {
            const imovel = imoveis.find(i => i.id === d.property_id) || { name: 'Imóvel Ybox' };
            const statusBadge = d.status === 'paid' 
                ? '<span class="badge badge-success">Pago</span>' 
                : '<span class="badge badge-warning">A Repassar</span>';

            return `
                <tr>
                    <td style="font-weight: 700; color: #fff;">${d.competence_month}</td>
                    <td>${imovel.name}</td>
                    <td style="font-weight: 600; color: #fff;">Sócio Participante</td>
                    <td>${window.BpoMoney.formatBRL(d.gross_received)}</td>
                    <td style="color: var(--color-danger);">${window.BpoMoney.formatBRL(d.deductions)}</td>
                    <td style="color: var(--color-warning);">${d.participation_pct}%</td>
                    <td style="font-weight: 700; color: #fff;">${window.BpoMoney.formatBRL(d.distribution_amount)}</td>
                    <td>${statusBadge}</td>
                    <td>
                        ${d.status !== 'paid' ? `
                            <button class="btn btn-secondary btn-sm" onclick="window.quitarDistribuicao('${d.id}')">
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
                    <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">
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
                    <td style="font-weight: 600; color: #fff;">${i.name}</td>
                    <td>${i.address || 'Santos / SP'}</td>
                    <td style="color: var(--color-success); font-weight: 700;">${valorLoc}</td>
                    <td>${diaVenc}</td>
                    <td><span class="badge badge-success">Ativo</span></td>
                    <td>
                        <button class="btn btn-secondary btn-sm" onclick="window.editarImovel('${i.id}')">
                            ✏️ Editar
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

        modalImovel.style.display = 'flex';
    };

    function abrirModalContrato() {
        const selImovel = document.getElementById('locImovel');
        selImovel.innerHTML = imoveis.map(i => `<option value="${i.id}">${i.name}</option>`).join('') || '<option value="">Sem imóveis</option>';
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
        const valorCents = window.BpoMoney.toCents(document.getElementById('locValor').value);
        const dia = parseInt(document.getElementById('locDia').value) || 10;

        try {
            // Busca ou usa pessoa padrão para locatário
            const pessoas = await window.BpoSupabase.request('people?limit=1', { method: 'GET' });
            let tenantId = pessoas.length > 0 ? pessoas[0].id : null;

            if (!tenantId) {
                const novaPessoa = await window.BpoSupabase.request('people', {
                    method: 'POST',
                    body: JSON.stringify({
                        company_id: empresaAtiva.id,
                        name: 'Inquilino / Locatário Geral',
                        person_type: 'tenant'
                    })
                });
                tenantId = novaPessoa[0].id;
            }

            await window.BpoSupabase.request('rental_contracts', {
                method: 'POST',
                body: JSON.stringify({
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
            // Exemplo de rateio: se há contrato de locação ativo, divide 50%/50% entre sócios
            let gerados = 0;
            const pessoas = await window.BpoSupabase.request('people?limit=2', { method: 'GET' });
            const socioId = pessoas.length > 0 ? pessoas[0].id : '00000000-0000-0000-0000-000000000001';

            for (const imovel of imoveis) {
                const contrato = contratosLocacao.find(cl => cl.property_id === imovel.id);
                if (!contrato) continue;

                const brutoCents = window.BpoMoney.toCents(contrato.monthly_amount);
                const deducoesCents = 0n; // Sem deduções padrão
                const distributableCents = brutoCents;

                const res = window.BpoRentalEngine.calcularDistribuicao({
                    grossReceived: brutoCents,
                    deductions: deducoesCents,
                    participants: [
                        { person_id: socioId, name: 'Sócio 01', participation_pct: 100 }
                    ]
                });

                const idempotencyKey = `dist_${imovel.id}_${competenciaAtiva}`;

                await window.BpoSupabase.request('rental_distributions', {
                    method: 'POST',
                    body: JSON.stringify({
                        property_id: imovel.id,
                        participant_id: socioId,
                        competence_month: competenciaAtiva,
                        gross_received: window.BpoMoney.toDecimalString(brutoCents),
                        deductions: window.BpoMoney.toDecimalString(deducoesCents),
                        distributable_amount: window.BpoMoney.toDecimalString(distributableCents),
                        participation_pct: 100.0,
                        distribution_amount: window.BpoMoney.toDecimalString(distributableCents),
                        status: 'pending',
                        idempotency_key: idempotencyKey
                    })
                });
                gerados++;
            }

            await carregarDadosLocacoes();
            alert(`Processamento concluído! ${gerados} rateio(s) calculado(s).`);

        } catch (err) {
            if (err.message.includes('idempotency_key') || err.message.includes('23505')) {
                alert('Os rateios desta competência já foram processados anteriormente.');
                await carregarDadosLocacoes();
            } else {
                alert('Erro ao processar: ' + err.message);
            }
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
})();
