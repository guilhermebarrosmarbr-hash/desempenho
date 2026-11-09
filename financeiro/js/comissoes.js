// ==============================================================================
// comissoes.js — Lógica do Módulo 06 (Controle de Comissões)
// Atualizado com layout em colunas por colaborador ativo, linha de totais oficial,
// modal de configurações com abas (Regras, Contratos e Colaboradores), setor,
// vigência de contratos e precisão decimal livre de comissão.
// ==============================================================================

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
    }
};

(function() {
    let empresas = [];
    let empresaAtiva = null;
    let competenciaAtiva = '';
    let colaboradores = [];
    let contratos = [];
    let todosContratosEmpresa = [];
    let regrasContrato = [];
    let comissoesCalculadas = [];
    let documentosDoMes = [];

    // DOM Elements
    const selectEmpresa = document.getElementById('selectEmpresa');
    const inputCompetencia = document.getElementById('inputCompetencia');
    const tituloDemonstrativo = document.getElementById('tituloDemonstrativo');
    const theadDemonstrativo = document.getElementById('theadDemonstrativo');
    const tbodyDemonstrativo = document.getElementById('tbodyDemonstrativo');
    const tfootDemonstrativo = document.getElementById('tfootDemonstrativo');

    // Métricas
    const valBaseComissao = document.getElementById('valBaseComissao');
    const valTotalComissao = document.getElementById('valTotalComissao');
    const valComissaoPaga = document.getElementById('valComissaoPaga');
    const valComissaoPendente = document.getElementById('valComissaoPendente');

    // Modais
    const modalConfiguracoes = document.getElementById('modalConfiguracoes');
    const modalColaborador = document.getElementById('modalColaborador');
    const modalRegra = document.getElementById('modalRegra');
    const modalConfigContrato = document.getElementById('modalConfigContrato');

    window.addEventListener('DOMContentLoaded', async () => {
        // Inicializa competência com o mês atual (ex: 2026-09 ou conforme dados)
        const hoje = new Date();
        const ano = hoje.getFullYear();
        const mes = String(hoje.getMonth() + 1).padStart(2, '0');
        competenciaAtiva = `${ano}-${mes}`;
        if (inputCompetencia) inputCompetencia.value = competenciaAtiva;

        await carregarEmpresas();

        // Eventos de topo
        if (selectEmpresa) {
            selectEmpresa.addEventListener('change', async (e) => {
                empresaAtiva = empresas.find(emp => emp.id === e.target.value) || null;
                await carregarDadosComissoes();
            });
        }

        if (inputCompetencia) {
            inputCompetencia.addEventListener('change', async (e) => {
                competenciaAtiva = e.target.value;
                await carregarDadosComissoes();
            });
        }

        // Botão de Engrenagem (Abre Modal de Configurações)
        const btnGear = document.getElementById('btnConfiguracoesComissoes');
        if (btnGear) {
            btnGear.addEventListener('click', () => abrirModalConfiguracoes('regras'));
        }
        const btnRegrasRapido = document.getElementById('btnAbrirRegrasRapido');
        if (btnRegrasRapido) {
            btnRegrasRapido.addEventListener('click', () => abrirModalConfiguracoes('regras'));
        }

        // Processar apuração
        const btnCalcular = document.getElementById('btnCalcularComissoes');
        if (btnCalcular) {
            btnCalcular.addEventListener('click', processarApuracaoComissoes);
        }

        // Botões dentro das abas do Modal de Configurações
        const btnNovoColabAba = document.getElementById('btnNovoColaboradorModal');
        if (btnNovoColabAba) {
            btnNovoColabAba.addEventListener('click', () => abrirModalColaborador());
        }
        const btnNovaRegraAba = document.getElementById('btnNovaRegraAba');
        if (btnNovaRegraAba) {
            btnNovaRegraAba.addEventListener('click', () => abrirModalRegras());
        }

        // Filtro de contrato na aba de regras
        const filtroContratoRegras = document.getElementById('filtroContratoRegras');
        if (filtroContratoRegras) {
            filtroContratoRegras.addEventListener('change', renderizarRegrasModal);
        }

        // Comportamento do campo Status do colaborador (desabilita fim de vigência se Ativo)
        const selColabStatus = document.getElementById('colabStatus');
        const inpColabFimVigencia = document.getElementById('colabFimVigencia');
        if (selColabStatus && inpColabFimVigencia) {
            selColabStatus.addEventListener('change', () => {
                const isAtivo = selColabStatus.value === 'active';
                inpColabFimVigencia.disabled = isAtivo;
                if (isAtivo) {
                    inpColabFimVigencia.value = '';
                }
            });
        }

        // Comportamento do escopo do contrato
        const selCfgEscopo = document.getElementById('cfgContratoEscopo');
        const boxCustom = document.getElementById('boxCfgContratoCustom');
        if (selCfgEscopo && boxCustom) {
            selCfgEscopo.addEventListener('change', () => {
                boxCustom.style.display = selCfgEscopo.value === 'custom' ? 'block' : 'none';
            });
        }

        // Submits dos formulários
        const formColab = document.getElementById('formColaborador');
        if (formColab) formColab.addEventListener('submit', salvarColaborador);

        const formRegra = document.getElementById('formRegra');
        if (formRegra) formRegra.addEventListener('submit', salvarRegraContrato);

        const formCfgContrato = document.getElementById('formConfigContrato');
        if (formCfgContrato) formCfgContrato.addEventListener('submit', salvarConfiguracaoContrato);
    });

    // =========================================================================
    // NAVEGAÇÃO DE ABAS NO MODAL DE CONFIGURAÇÕES
    // =========================================================================
    window.alternarAbaModal = function(abaNome) {
        const abas = ['regras', 'contratos', 'colaboradores'];
        abas.forEach(nome => {
            const btn = document.getElementById(`tabBtn${capitalize(nome)}`);
            const box = document.getElementById(`tabConteudo${capitalize(nome)}`);
            if (btn) btn.classList.toggle('active', nome === abaNome);
            if (box) box.classList.toggle('active', nome === abaNome);
        });

        if (abaNome === 'regras') renderizarRegrasModal();
        if (abaNome === 'contratos') renderizarContratosModal();
        if (abaNome === 'colaboradores') renderizarColaboradoresModal();
    };

    function capitalize(s) {
        if (!s) return '';
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    window.abrirModalConfiguracoes = function(abaInicial = 'regras') {
        alternarAbaModal(abaInicial);
        if (modalConfiguracoes) modalConfiguracoes.style.display = 'flex';
    };

    window.fecharModais = function() {
        if (modalConfiguracoes) modalConfiguracoes.style.display = 'none';
        if (modalColaborador) modalColaborador.style.display = 'none';
        if (modalRegra) modalRegra.style.display = 'none';
        if (modalConfigContrato) modalConfigContrato.style.display = 'none';
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

            // Dá preferência à Mar Brasil
            const marBrasil = empresas.find(e => (e.trade_name || e.name || '').toLowerCase().includes('mar brasil'));
            empresaAtiva = marBrasil || empresas[0];
            selectEmpresa.value = empresaAtiva.id;

            await carregarDadosComissoes();

        } catch (err) {
            console.error("Erro ao carregar empresas:", err);
        }
    }

    async function carregarDadosComissoes() {
        if (!empresaAtiva) return;

        try {
            // 1. Colaboradores da empresa
            const colabsDb = await window.BpoSupabase.request(
                `collaborators?company_id=eq.${empresaAtiva.id}&order=name.asc`,
                { method: 'GET' }
            ) || [];

            // Suporte aos campos: setor, inicio_vigencia, fim_vigencia (extrai se salvo em document/meta se schema antigo)
            colaboradores = colabsDb.map(c => {
                let setor = 'Geral';
                let inicioVigencia = c.created_at ? c.created_at.slice(0, 10) : '2026-01-01';
                let fimVigencia = null;

                // Tenta extrair metadados extras se armazenados em role ou document
                if (c.role && c.role.includes('[')) {
                    const match = c.role.match(/\[Setor:\s*(.*?)\]/);
                    if (match) setor = match[1];
                } else if (c.role) {
                    if (c.role.toLowerCase().includes('licitaç')) setor = 'Licitações';
                    else if (c.role.toLowerCase().includes('juríd') || c.role.toLowerCase().includes('direito')) setor = 'Jurídico';
                    else if (c.role.toLowerCase().includes('vended') || c.role.toLowerCase().includes('comerc')) setor = 'Comercial';
                }

                return {
                    ...c,
                    setor: c.sector || setor,
                    inicioVigencia: c.start_date || inicioVigencia,
                    fimVigencia: c.end_date || fimVigencia,
                    active: c.active !== false
                };
            });

            // 2. Todos os contratos da empresa
            todosContratosEmpresa = await window.BpoSupabase.request(
                `contracts?company_id=eq.${empresaAtiva.id}&order=code.asc`,
                { method: 'GET' }
            ) || [];

            // Contratos elegíveis
            contratos = todosContratosEmpresa.filter(c => !!c.commission_eligible);

            // Popula dropdown de filtro de contratos na aba de regras
            const selFiltro = document.getElementById('filtroContratoRegras');
            if (selFiltro) {
                selFiltro.innerHTML = '<option value="all">Todos os Contratos</option>' + 
                    todosContratosEmpresa.map(c => `<option value="${c.id}">${escapeHtml(c.code)} - ${escapeHtml(c.name)}</option>`).join('');
            }

            // 3. Regras de comissão
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

            // 4. Comissões calculadas gravadas no banco para o período
            comissoesCalculadas = await window.BpoSupabase.request(
                `commission_calculations?company_id=eq.${empresaAtiva.id}&competence_month=eq.${competenciaAtiva}&order=event_date.asc`,
                { method: 'GET' }
            ) || [];

            // 5. Documentos e baixas do período
            await carregarDocumentosDoPeriodo();

            // Atualiza UI
            atualizarTituloBanner();
            renderizarMetricas();
            renderizarDemonstrativoOficial();
            renderizarRegrasModal();
            renderizarContratosModal();
            renderizarColaboradoresModal();

        } catch (err) {
            console.error("Erro ao carregar dados de comissões:", err);
        }
    }

    async function carregarDocumentosDoPeriodo() {
        documentosDoMes = [];
        try {
            // Busca documentos de faturamento
            const docs = await window.BpoSupabase.request(
                `billing_documents?company_id=eq.${empresaAtiva.id}&status=neq.cancelled`,
                { method: 'GET' }
            ) || [];

            // Filtra os documentos cuja DATA DE RECEBIMENTO seja no período selecionado (Regime de Caixa)
            docs.forEach(d => {
                const td = window.BpoFiscalUtils.extrairTaxDetails(d) || {};
                const dataRec = td.payment_date || d.payment_date || d.receipt_date || null;
                const mesRec = extrairMesAnoIso(dataRec);

                if (mesRec === competenciaAtiva) {
                    documentosDoMes.push({
                        ...d,
                        tax_details: td,
                        payment_date: converterParaDataIso(dataRec)
                    });
                }
            });
        } catch (e) {
            console.warn("Erro ao buscar documentos do período:", e);
        }
    }

    function atualizarTituloBanner() {
        if (!tituloDemonstrativo) return;
        const [anoStr, mesStr] = competenciaAtiva.split('-');
        const nomesMeses = [
            'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
            'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
        ];
        const mesNome = nomesMeses[parseInt(mesStr, 10) - 1] || mesStr;
        const empNome = empresaAtiva ? (empresaAtiva.trade_name || empresaAtiva.name) : 'Empresa';
        tituloDemonstrativo.textContent = `Demonstrativo de comissões - ${empNome} - ${mesNome}/${anoStr}`;
    }

    // =========================================================================
    // RENDERIZAR O DEMONSTRATIVO OFICIAL (ESTILO PLANILHA COM COLUNAS DINÂMICAS)
    // =========================================================================
    function renderizarDemonstrativoOficial() {
        if (!theadDemonstrativo || !tbodyDemonstrativo || !tfootDemonstrativo) return;

        // Identifica colaboradores ativos para compor as colunas dinâmicas
        const colabsAtivos = colaboradores.filter(c => c.active !== false);

        // Agrupa colaboradores por Setor para exibir no cabeçalho (ex: Licitações 1%, Jurídico 0,45%)
        const setoresMap = new Map();
        colabsAtivos.forEach(c => {
            const set = c.setor || 'Geral';
            if (!setoresMap.has(set)) setoresMap.set(set, []);
            setoresMap.get(set).push(c);
        });

        // 1. MONTAGEM DO CABEÇALHO (2 LINHAS: LINHA DE GRUPOS/SETORES E LINHA DE NOMES)
        let trHead1 = `
            <tr>
                <th rowspan="2" style="min-width: 170px;">Contrato</th>
                <th rowspan="2" style="min-width: 60px;">NF</th>
                <th rowspan="2" style="min-width: 75px;">Ciclo</th>
                <th rowspan="2" style="min-width: 110px;">Data de recebimento</th>
                <th rowspan="2" style="min-width: 100px;">Valor Bruto</th>
                <th rowspan="2" style="min-width: 100px;">Valor recebido</th>
                <th rowspan="2" style="min-width: 100px;">Valor Líquido</th>
        `;

        let trHead2 = `<tr>`;

        // Para cada setor, adiciona uma coluna agrupada ou totalizadora se houver regra
        colabsAtivos.forEach(colab => {
            // Percentual padrão de exibição do colaborador
            const regraRef = regrasContrato.find(r => r.collaborator_id === colab.id);
            const pctExibicao = regraRef ? `${regraRef.percentage}%` : '';

            trHead1 += `<th style="min-width: 95px;">${escapeHtml(colab.name.split(' ')[0])}</th>`;
            trHead2 += `<th>${pctExibicao || escapeHtml(colab.setor)}</th>`;
        });

        trHead1 += `</tr>`;
        trHead2 += `</tr>`;

        theadDemonstrativo.innerHTML = trHead1 + trHead2;

        // 2. MONTAGEM DAS LINHAS DA TABELA (DOCUMENTOS RECEBIDOS NO PERÍODO)
        // Se houver comissões calculadas no banco, agrupa por documento
        // Caso não haja cálculos no banco mas haja documentos, projeta os valores usando as regras
        const linhasData = [];

        // Monta mapa de regras por contrato
        const regrasPorContrato = new Map();
        regrasContrato.forEach(r => {
            if (!regrasPorContrato.has(r.contract_id)) regrasPorContrato.set(r.contract_id, []);
            regrasPorContrato.get(r.contract_id).push(r);
        });

        // Documentos do período
        if (documentosDoMes.length === 0 && comissoesCalculadas.length === 0) {
            tbodyDemonstrativo.innerHTML = `
                <tr>
                    <td colspan="${7 + colabsAtivos.length}" style="text-align: center; color: var(--text-muted); padding: 36px;">
                        Nenhum faturamento com recebimento registrado em ${competenciaAtiva}.<br>
                        Verifique a data de recebimento das notas no módulo de faturamento ou clique em "Processar Apuração do Período".
                    </td>
                </tr>
            `;
            tfootDemonstrativo.innerHTML = '';
            return;
        }

        // Agrupa por documento de faturamento
        const docsMap = new Map();
        documentosDoMes.forEach(doc => docsMap.set(doc.id, doc));

        // Estrutura das linhas
        const linhasTabela = [];

        // Acumuladores de totais para o rodapé
        let totalBrutoCents = 0n;
        let totalRecebidoCents = 0n;
        let totalLiquidoCents = 0n;
        const totaisPorColaborador = new Map();
        colabsAtivos.forEach(c => totaisPorColaborador.set(c.id, 0n));

        // Processa documentos
        documentosDoMes.forEach(doc => {
            const ctr = todosContratosEmpresa.find(c => c.id === doc.contract_id);
            const td = doc.tax_details || {};
            const numNF = doc.document_number || '-';
            const ciclo = doc.competence_month ? formatarCiclo(doc.competence_month) : '-';
            const dataRec = doc.payment_date ? formatarData(doc.payment_date) : '-';

            const brutoCents = window.BpoMoney.toCents(doc.gross_amount);
            const recebidoCents = window.BpoMoney.toCents(doc.net_amount || doc.gross_amount);

            // Valor Líquido Deduzido de Impostos (Base Oficial de Comissão)
            // Desconta os impostos federais proporcionais da nota
            const deducoesImpostosCents = calcularImpostosProporcionaisDoc(doc);
            const liquidoCents = recebidoCents > deducoesImpostosCents ? (recebidoCents - deducoesImpostosCents) : recebidoCents;

            totalBrutoCents += brutoCents;
            totalRecebidoCents += recebidoCents;
            totalLiquidoCents += liquidoCents;

            // Nome do contrato/aditivo conforme notas e descrição
            let nomeContrato = ctr ? (ctr.code || ctr.name) : 'Avulso';
            if (doc.description && doc.description.toLowerCase().includes('aditivo')) {
                const matchAd = doc.description.match(/Aditivo\s*\d+/i);
                if (matchAd) nomeContrato += ` - ${matchAd[0]}`;
            }

            // Comissões de cada colaborador para este documento
            const comissoesColabs = {};
            colabsAtivos.forEach(colab => {
                // Busca se há comissão gravada no banco para este doc + colab
                const calcGravado = comissoesCalculadas.find(c => c.document_id === doc.id && c.collaborator_id === colab.id);
                if (calcGravado) {
                    const cCents = window.BpoMoney.toCents(calcGravado.commission_amount);
                    comissoesColabs[colab.id] = cCents;
                } else if (ctr && ctr.commission_eligible) {
                    // Calcula dinamicamente com base na regra do contrato
                    const regras = regrasPorContrato.get(ctr.id) || [];
                    const reg = regras.find(r => r.collaborator_id === colab.id);
                    if (reg) {
                        const pct = parseFloat(reg.percentage) || 0;
                        const baseUso = (reg.basis_override === 'gross_invoiced') ? brutoCents : liquidoCents;
                        const cNum = (Number(baseUso) / 100) * (pct / 100);
                        comissoesColabs[colab.id] = BigInt(Math.round(cNum * 100));
                    } else {
                        comissoesColabs[colab.id] = 0n;
                    }
                } else {
                    comissoesColabs[colab.id] = 0n;
                }

                // Soma totalizador
                totaisPorColaborador.set(colab.id, totaisPorColaborador.get(colab.id) + (comissoesColabs[colab.id] || 0n));
            });

            // Monta linha HTML
            let rowHtml = `
                <tr>
                    <td style="font-weight: 600; color: #fff;">${escapeHtml(nomeContrato)}</td>
                    <td style="text-align: center;">${escapeHtml(numNF)}</td>
                    <td style="text-align: center;">${escapeHtml(ciclo)}</td>
                    <td style="text-align: center;">${escapeHtml(dataRec)}</td>
                    <td style="text-align: right; color: #94a3b8;">${window.BpoMoney.formatBRL(brutoCents)}</td>
                    <td style="text-align: right; color: #38bdf8;">${window.BpoMoney.formatBRL(recebidoCents)}</td>
                    <td style="text-align: right; font-weight: 700; color: #fff;">${window.BpoMoney.formatBRL(liquidoCents)}</td>
            `;

            colabsAtivos.forEach(colab => {
                const valC = comissoesColabs[colab.id] || 0n;
                const formatado = valC > 0n ? window.BpoMoney.formatBRL(valC) : 'R$ 0,00';
                const styleVal = valC > 0n ? 'color: #fbbf24; font-weight: 600;' : 'color: var(--text-muted);';
                rowHtml += `<td style="text-align: right; ${styleVal}">${formatado}</td>`;
            });

            rowHtml += `</tr>`;
            linhasTabela.push(rowHtml);
        });

        tbodyDemonstrativo.innerHTML = linhasTabela.join('');

        // 3. MONTAGEM DA LINHA DE TOTAIS (FOOTER IDÊNTICO À PLANILHA OFICIAL)
        let tfootHtml = `
            <tr>
                <td colspan="4" style="text-align: center; font-weight: 800; font-size: 0.9rem;">Total</td>
                <td style="text-align: right; font-weight: 800;">${window.BpoMoney.formatBRL(totalBrutoCents)}</td>
                <td style="text-align: right; font-weight: 800;">${window.BpoMoney.formatBRL(totalRecebidoCents)}</td>
                <td style="text-align: right; font-weight: 800;">${window.BpoMoney.formatBRL(totalLiquidoCents)}</td>
        `;

        colabsAtivos.forEach(colab => {
            const totC = totaisPorColaborador.get(colab.id) || 0n;
            tfootHtml += `<td style="text-align: right; font-weight: 800;">${window.BpoMoney.formatBRL(totC)}</td>`;
        });

        tfootHtml += `</tr>`;
        tfootDemonstrativo.innerHTML = tfootHtml;
    }

    function calcularImpostosProporcionaisDoc(doc) {
        const td = doc.tax_details || {};
        let impostosCents = 0n;

        // Se tem tributos declarados no tax_details
        if (td.pis_valor) impostosCents += window.BpoMoney.toCents(td.pis_valor);
        if (td.cofins_valor) impostosCents += window.BpoMoney.toCents(td.cofins_valor);
        if (td.irpj_valor) impostosCents += window.BpoMoney.toCents(td.irpj_valor);
        if (td.csll_valor) impostosCents += window.BpoMoney.toCents(td.csll_valor);

        // Se não houver detalhamento salvo, aplica a estimativa de Lucro Presumido (~14.63%)
        if (impostosCents === 0n) {
            const b = Number(window.BpoMoney.toCents(doc.gross_amount)) / 100;
            // 0.65% PIS + 3% COFINS + ~8% IRPJ + ~3% CSLL
            impostosCents = BigInt(Math.round(b * 0.1463 * 100));
        }

        return impostosCents;
    }

    function formatarCiclo(competenciaStr) {
        if (!competenciaStr) return '-';
        const parts = competenciaStr.split('-');
        if (parts.length === 2) {
            return `${parts[1]}/${parts[0]}`;
        }
        return competenciaStr;
    }

    function renderizarMetricas() {
        let baseTotal = 0n;
        let comissaoTotal = 0n;
        let comissaoPaga = 0n;

        comissoesCalculadas.forEach(c => {
            const bCents = window.BpoMoney.toCents(c.base_amount);
            const cCents = window.BpoMoney.toCents(c.commission_amount);
            baseTotal += bCents;
            comissaoTotal += cCents;

            if (c.status === 'paid') {
                comissaoPaga += cCents;
            }
        });

        const pendente = comissaoTotal > comissaoPaga ? comissaoTotal - comissaoPaga : 0n;

        if (valBaseComissao) valBaseComissao.textContent = window.BpoMoney.formatBRL(baseTotal);
        if (valTotalComissao) valTotalComissao.textContent = window.BpoMoney.formatBRL(comissaoTotal);
        if (valComissaoPaga) valComissaoPaga.textContent = window.BpoMoney.formatBRL(comissaoPaga);
        if (valComissaoPendente) valComissaoPendente.textContent = window.BpoMoney.formatBRL(pendente);
    }

    // =========================================================================
    // MODAL DE CONFIGURAÇÕES: ABA 1 — REGRAS DE COMISSÃO
    // =========================================================================
    function renderizarRegrasModal() {
        const tbody = document.getElementById('listaRegrasModalBody');
        if (!tbody) return;

        const filtroContrato = document.getElementById('filtroContratoRegras')?.value || 'all';
        const regrasFiltradas = filtroContrato === 'all'
            ? regrasContrato
            : regrasContrato.filter(r => r.contract_id === filtroContrato);

        if (regrasFiltradas.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">
                        Nenhuma regra de comissão cadastrada para o filtro selecionado.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = regrasFiltradas.map(r => {
            const ctr = todosContratosEmpresa.find(c => c.id === r.contract_id) || { code: 'CTR', name: 'Contrato' };
            const col = colaboradores.find(c => c.id === r.collaborator_id) || { name: 'Colaborador', setor: 'Geral' };
            const baseTxt = r.basis_override === 'gross_invoiced' ? 'Faturamento Bruto' : 'Líquido Recebido';

            return `
                <tr>
                    <td style="font-weight: 600; color: #fff;">${escapeHtml(ctr.code)} - ${escapeHtml(ctr.name)}</td>
                    <td>${escapeHtml(col.name)}</td>
                    <td><span class="badge badge-info">${escapeHtml(col.setor)}</span></td>
                    <td style="color: #f59e0b; font-weight: 700;">${r.percentage}%</td>
                    <td style="font-size: 0.85rem; color: var(--text-secondary);">${baseTxt}</td>
                    <td style="white-space: nowrap;">
                        <button class="btn btn-secondary btn-sm" onclick="window.editarRegra('${r.id}')">✏️ Editar</button>
                        <button class="btn btn-danger btn-sm" onclick="window.deletarRegra('${r.id}')" style="margin-left: 4px;">🗑️</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // =========================================================================
    // MODAL DE CONFIGURAÇÕES: ABA 2 — GERENCIAMENTO DE CONTRATOS
    // =========================================================================
    function renderizarContratosModal() {
        const tbody = document.getElementById('listaGerenciarContratosBody');
        if (!tbody) return;

        if (todosContratosEmpresa.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">
                        Nenhum contrato cadastrado para esta empresa.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = todosContratosEmpresa.map(c => {
            const elegivel = !!c.commission_eligible;
            const badgeElegivel = elegivel 
                ? '<span class="badge badge-success">Sim</span>'
                : '<span class="badge badge-danger">Não</span>';

            let modoTxt = 'Total';
            if (c.notes && c.notes.includes('[ComissaoEscopo:')) {
                const match = c.notes.match(/\[ComissaoEscopo:\s*(.*?)\]/);
                if (match) {
                    if (match[1] === 'aditivos_only') modoTxt = 'Apenas Aditivos';
                    else if (match[1] === 'base_only') modoTxt = 'Apenas Valor Base';
                    else if (match[1] === 'custom') modoTxt = 'Customizado';
                }
            }

            return `
                <tr>
                    <td style="font-weight: 600; color: #fff;">${escapeHtml(c.code)}</td>
                    <td>${escapeHtml(c.name)}</td>
                    <td style="color: var(--text-secondary);">${escapeHtml(c.contract_type || 'B2B')}</td>
                    <td>${window.BpoMoney.formatBRL(c.reference_value || 0)}</td>
                    <td>${badgeElegivel}</td>
                    <td style="font-size: 0.85rem; color: #f59e0b;">${modoTxt}</td>
                    <td>
                        <button class="btn btn-secondary btn-sm" onclick="window.abrirConfigContrato('${c.id}')">
                            ⚙️ Definir Comissão
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    window.abrirConfigContrato = function(contratoId) {
        const c = todosContratosEmpresa.find(ctr => ctr.id === contratoId);
        if (!c) return;

        document.getElementById('cfgContratoId').value = c.id;
        document.getElementById('cfgContratoNome').value = `${c.code} — ${c.name}`;
        document.getElementById('cfgContratoElegivel').checked = !!c.commission_eligible;

        let escopo = 'total';
        let pctCustom = '100';
        let obsLimpa = c.notes || '';

        if (c.notes && c.notes.includes('[ComissaoEscopo:')) {
            const mEscopo = c.notes.match(/\[ComissaoEscopo:\s*(.*?)\]/);
            if (mEscopo) escopo = mEscopo[1];
            const mPct = c.notes.match(/\[ComissaoPctCustom:\s*(.*?)\]/);
            if (mPct) pctCustom = mPct[1];
            obsLimpa = obsLimpa.replace(/\[ComissaoEscopo:.*?\]/g, '').replace(/\[ComissaoPctCustom:.*?\]/g, '').trim();
        }

        document.getElementById('cfgContratoEscopo').value = escopo;
        document.getElementById('cfgContratoPctFaturamento').value = pctCustom;
        document.getElementById('boxCfgContratoCustom').style.display = escopo === 'custom' ? 'block' : 'none';
        document.getElementById('cfgContratoObs').value = obsLimpa;

        if (modalConfigContrato) modalConfigContrato.style.display = 'flex';
    };

    async function salvarConfiguracaoContrato(e) {
        e.preventDefault();
        const id = document.getElementById('cfgContratoId').value;
        const elegivel = document.getElementById('cfgContratoElegivel').checked;
        const escopo = document.getElementById('cfgContratoEscopo').value;
        const pctCustom = document.getElementById('cfgContratoPctFaturamento').value;
        const obs = document.getElementById('cfgContratoObs').value.trim();

        const notesCompleto = `${obs} [ComissaoEscopo: ${escopo}] [ComissaoPctCustom: ${pctCustom}]`.trim();

        try {
            await window.BpoSupabase.request(`contracts?id=eq.${id}`, {
                method: 'PATCH',
                body: JSON.stringify({
                    commission_eligible: elegivel,
                    notes: notesCompleto
                })
            });

            if (modalConfigContrato) modalConfigContrato.style.display = 'none';
            await carregarDadosComissoes();
            alert('Configuração do contrato salva com sucesso!');
        } catch (err) {
            alert('Erro ao salvar configuração do contrato: ' + err.message);
        }
    }

    // =========================================================================
    // MODAL DE CONFIGURAÇÕES: ABA 3 — COLABORADORES
    // =========================================================================
    function renderizarColaboradoresModal() {
        const tbody = document.getElementById('listaColaboradoresModalBody');
        if (!tbody) return;

        if (colaboradores.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 24px;">
                        Nenhum colaborador cadastrado.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = colaboradores.map(c => {
            const statusBadge = c.active !== false 
                ? '<span class="badge badge-success">Ativo</span>'
                : '<span class="badge badge-danger">Inativo</span>';

            const ini = c.inicioVigencia ? formatarData(c.inicioVigencia) : '-';
            const fim = c.fimVigencia ? formatarData(c.fimVigencia) : (c.active !== false ? 'Vigente' : '-');

            return `
                <tr>
                    <td style="font-weight: 600; color: #fff;">${escapeHtml(c.name)}</td>
                    <td><span class="badge badge-info">${escapeHtml(c.setor)}</span></td>
                    <td>${escapeHtml(c.role || '-')}</td>
                    <td>${escapeHtml(c.document || '-')}</td>
                    <td>${statusBadge}</td>
                    <td style="font-size: 0.85rem;">${ini}</td>
                    <td style="font-size: 0.85rem;">${fim}</td>
                    <td style="white-space: nowrap;">
                        <button class="btn btn-secondary btn-sm" onclick="window.editarColaborador('${c.id}')">✏️ Editar</button>
                        <button class="btn btn-danger btn-sm" onclick="window.deletarColaborador('${c.id}')" style="margin-left: 4px;">🗑️</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    window.abrirModalColaborador = function(colabExistente = null) {
        document.getElementById('formColaborador').reset();
        const titulo = document.getElementById('modalColaboradorTitulo');
        const inpId = document.getElementById('colabId');
        const btnExc = document.getElementById('btnExcluirColaborador');
        const inpFim = document.getElementById('colabFimVigencia');

        if (colabExistente) {
            titulo.textContent = 'Editar Colaborador';
            inpId.value = colabExistente.id;
            document.getElementById('colabNome').value = colabExistente.name || '';
            document.getElementById('colabSetor').value = colabExistente.setor || 'Licitações';
            document.getElementById('colabFuncao').value = colabExistente.role || '';
            document.getElementById('colabCpf').value = colabExistente.document || '';
            document.getElementById('colabEmail').value = colabExistente.email || '';
            document.getElementById('colabStatus').value = colabExistente.active !== false ? 'active' : 'inactive';
            document.getElementById('colabInicioVigencia').value = colabExistente.inicioVigencia || '2026-01-01';
            document.getElementById('colabFimVigencia').value = colabExistente.fimVigencia || '';

            const isAtivo = colabExistente.active !== false;
            inpFim.disabled = isAtivo;

            if (btnExc) btnExc.style.display = 'inline-flex';
        } else {
            titulo.textContent = 'Cadastrar Colaborador';
            inpId.value = '';
            document.getElementById('colabStatus').value = 'active';
            document.getElementById('colabInicioVigencia').value = '2026-01-01';
            inpFim.disabled = true;
            if (btnExc) btnExc.style.display = 'none';
        }

        if (modalColaborador) modalColaborador.style.display = 'flex';
    };

    window.editarColaborador = function(id) {
        const c = colaboradores.find(col => col.id === id);
        if (c) abrirModalColaborador(c);
    };

    async function salvarColaborador(e) {
        e.preventDefault();
        const id = document.getElementById('colabId').value;
        const nome = document.getElementById('colabNome').value.trim();
        const setor = document.getElementById('colabSetor').value;
        const funcao = document.getElementById('colabFuncao').value.trim();
        const cpf = document.getElementById('colabCpf').value.trim();
        const email = document.getElementById('colabEmail').value.trim();
        const status = document.getElementById('colabStatus').value;
        const inicioVigencia = document.getElementById('colabInicioVigencia').value;
        const fimVigencia = status === 'active' ? null : (document.getElementById('colabFimVigencia').value || null);

        // Salva role enriquecida com o Setor para compatibilidade
        const roleEnriquecida = `${funcao} [Setor: ${setor}]`.trim();

        const payload = {
            name: nome,
            role: roleEnriquecida,
            document: cpf,
            email: email,
            active: (status === 'active')
        };

        try {
            if (id) {
                await window.BpoSupabase.request(`collaborators?id=eq.${id}`, {
                    method: 'PATCH',
                    body: JSON.stringify(payload)
                });
            } else {
                await window.BpoSupabase.request('collaborators', {
                    method: 'POST',
                    body: JSON.stringify({
                        ...payload,
                        company_id: empresaAtiva.id
                    })
                });
            }

            if (modalColaborador) modalColaborador.style.display = 'none';
            await carregarDadosComissoes();
            alert('Colaborador salvo com sucesso!');
        } catch (err) {
            alert('Erro ao salvar colaborador: ' + err.message);
        }
    }

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

    window.deletarColaboradorModal = async function() {
        const id = document.getElementById('colabId')?.value;
        if (id) window.deletarColaborador(id);
    };

    // =========================================================================
    // MODAL DE REGRAS DE COMISSÃO POR CONTRATO
    // =========================================================================
    window.abrirModalRegras = function(regraExistente = null) {
        const selContrato = document.getElementById('regraContrato');
        const selColab = document.getElementById('regraColaborador');
        const inpRegraId = document.getElementById('regraId');
        const inpPercentual = document.getElementById('regraPercentual');
        const selBase = document.getElementById('regraBase');
        const btnExc = document.getElementById('btnExcluirRegraModal');
        const titulo = document.getElementById('modalRegraTitulo');

        selContrato.innerHTML = contratos.map(c => `<option value="${c.id}">${escapeHtml(c.code)} - ${escapeHtml(c.name)}</option>`).join('') || '<option value="">Sem contratos elegíveis</option>';
        selColab.innerHTML = colaboradores.map(c => `<option value="${c.id}">${escapeHtml(c.name)} (${escapeHtml(c.setor)})</option>`).join('') || '<option value="">Sem colaboradores</option>';

        if (regraExistente) {
            if (inpRegraId) inpRegraId.value = regraExistente.id;
            if (titulo) titulo.textContent = 'Editar Regra de Comissão';
            selContrato.value = regraExistente.contract_id;
            selColab.value = regraExistente.collaborator_id;
            // Preserva as casas decimais exatas da regra
            if (inpPercentual) inpPercentual.value = regraExistente.percentage;
            if (selBase) selBase.value = regraExistente.basis_override || 'net_proportional';
            if (btnExc) btnExc.style.display = 'inline-flex';
        } else {
            if (inpRegraId) inpRegraId.value = '';
            if (titulo) titulo.textContent = 'Regra de Comissão por Contrato';
            document.getElementById('formRegra').reset();
            if (inpPercentual) inpPercentual.value = '0.5';
            if (btnExc) btnExc.style.display = 'none';
        }

        if (modalRegra) modalRegra.style.display = 'flex';
    };

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
        if (id) window.deletarRegra(id);
    };

    async function salvarRegraContrato(e) {
        e.preventDefault();
        const id = document.getElementById('regraId')?.value;
        const contratoId = document.getElementById('regraContrato').value;
        const colabId = document.getElementById('regraColaborador').value;
        // Permite casas decimais arbitrárias (ex: 0.5, 0.225, 0.135, etc.)
        const percentual = parseFloat(document.getElementById('regraPercentual').value);
        const base = document.getElementById('regraBase').value;

        if (!contratoId || !colabId) {
            alert('Selecione o contrato e o colaborador.');
            return;
        }

        try {
            if (id) {
                await window.BpoSupabase.request(`contract_commission_rules?id=eq.${id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({
                        contract_id: contratoId,
                        collaborator_id: colabId,
                        percentage: percentual,
                        basis_override: base
                    })
                });
            } else {
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
            }

            if (modalRegra) modalRegra.style.display = 'none';
            await carregarDadosComissoes();
            alert('Regra salva com sucesso!');
        } catch (err) {
            alert('Erro ao salvar regra: ' + err.message);
        }
    }

    // =========================================================================
    // PROCESSAMENTO DE APURAÇÃO DE COMISSÕES (REGIME DE CAIXA OFICIAL)
    // =========================================================================
    async function processarApuracaoComissoes() {
        if (!empresaAtiva) return;

        try {
            if (documentosDoMes.length === 0) {
                alert(`Nenhum recebimento/faturamento com data de pagamento em ${competenciaAtiva} foi localizado.`);
                return;
            }

            const colabsAtivos = colaboradores.filter(c => c.active !== false);
            if (colabsAtivos.length === 0) {
                alert('Cadastre colaboradores ativos antes de processar.');
                return;
            }

            const lotes = [];

            documentosDoMes.forEach(doc => {
                const ctr = todosContratosEmpresa.find(c => c.id === doc.contract_id);
                if (!ctr || !ctr.commission_eligible) return;

                // Regras deste contrato
                const regrasDoCtr = regrasContrato.filter(r => r.contract_id === ctr.id);
                if (regrasDoCtr.length === 0) return;

                const brutoCents = window.BpoMoney.toCents(doc.gross_amount);
                const recebidoCents = window.BpoMoney.toCents(doc.net_amount || doc.gross_amount);
                const impostosCents = calcularImpostosProporcionaisDoc(doc);
                const liquidoCents = recebidoCents > impostosCents ? (recebidoCents - impostosCents) : recebidoCents;

                regrasDoCtr.forEach(reg => {
                    const colab = colabsAtivos.find(c => c.id === reg.collaborator_id);
                    if (!colab) return;

                    const baseUso = (reg.basis_override === 'gross_invoiced') ? brutoCents : liquidoCents;
                    const pct = parseFloat(reg.percentage) || 0;

                    const res = window.BpoCommissionEngine.calcularComissao({
                        baseAmount: baseUso,
                        percentage: pct,
                        capType: ctr.commission_cap_type || 'none',
                        capValue: ctr.commission_cap_value || 0
                    });

                    const chaveIdempotente = `c_${competenciaAtiva}_${hashCurto(doc.id)}_${hashCurto(ctr.id)}_${hashCurto(colab.id)}`;

                    lotes.push({
                        company_id: empresaAtiva.id,
                        collaborator_id: colab.id,
                        contract_id: ctr.id,
                        document_id: doc.id,
                        competence_month: competenciaAtiva,
                        event_date: doc.payment_date || doc.issue_date,
                        base_amount: window.BpoMoney.toDecimalString(baseUso),
                        percentage: pct,
                        commission_amount: window.BpoMoney.toDecimalString(res.comissaoCents),
                        status: 'pending',
                        idempotency_key: chaveIdempotente
                    });
                });
            });

            if (lotes.length === 0) {
                alert(`Nenhum contrato com regras ativas de comissão encontrado para os recebimentos de ${competenciaAtiva}.`);
                return;
            }

            // Upsert dos cálculos
            await window.BpoSupabase.request('commission_calculations?on_conflict=idempotency_key', {
                method: 'POST',
                prefer: 'resolution=ignore-duplicates,return=representation',
                body: JSON.stringify(lotes)
            });

            await carregarDadosComissoes();
            alert(`Apuração concluída com sucesso!\n${lotes.length} comissões geradas para o período ${competenciaAtiva}.`);

        } catch (err) {
            alert('Erro ao processar comissões: ' + err.message);
        }
    }

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
        if (!dataStr) return '-';
        const s = String(dataStr).slice(0, 10);
        const parts = s.split('-');
        return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : s;
    }

    function extrairMesAnoIso(dataStr) {
        if (!dataStr) return '';
        const s = String(dataStr).trim();
        if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
        const parts = s.split('/');
        if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, '0')}`;
        return '';
    }

    function converterParaDataIso(dataStr) {
        if (!dataStr) return '';
        const s = String(dataStr).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        const parts = s.split('/');
        if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        return s;
    }

    function hashCurto(str) {
        if (!str) return '00000000';
        let hash = 0;
        const s = String(str);
        for (let i = 0; i < s.length; i++) {
            hash = ((hash << 5) - hash) + s.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(36).padStart(6, '0');
    }
})();
