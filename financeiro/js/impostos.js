// ==============================================================================
// impostos.js — Lógica do Módulo 05 (Controle de Impostos & Memória de Cálculo)
// ==============================================================================

(function() {
    let empresas = [];
    let empresaAtiva = null;
    let competenciaAtiva = '';
    let faturamentoCompetenciaCents = 0n;
    let historicoApuracoes = [];
    let perfilTributario = null;

    // Elementos DOM
    const selectEmpresa = document.getElementById('selectEmpresa');
    const inputCompetencia = document.getElementById('inputCompetencia');
    const regimeTributario = document.getElementById('regimeTributario');
    const boxAnexoSimples = document.getElementById('boxAnexoSimples');
    const anexoSimples = document.getElementById('anexoSimples');
    const inpRBT12 = document.getElementById('inpRBT12');
    const inpFolha12 = document.getElementById('inpFolha12');
    const painelMemoriaCalculo = document.getElementById('painelMemoriaCalculo');
    const badgeRegime = document.getElementById('badgeRegime');
    const listaHistoricoBody = document.getElementById('listaHistoricoBody');

    // Métricas
    const valBaseFaturamento = document.getElementById('valBaseFaturamento');
    const valRBT12 = document.getElementById('valRBT12');
    const valFatorR = document.getElementById('valFatorR');
    const valImpostoApurado = document.getElementById('valImpostoApurado');

    window.addEventListener('DOMContentLoaded', async () => {
        const hoje = new Date();
        const ano = hoje.getFullYear();
        const mes = String(hoje.getMonth() + 1).padStart(2, '0');
        competenciaAtiva = `${ano}-${mes}`;
        inputCompetencia.value = competenciaAtiva;

        await carregarEmpresas();

        // Listeners
        selectEmpresa.addEventListener('change', async (e) => {
            empresaAtiva = empresas.find(emp => emp.id === e.target.value) || null;
            await carregarDadosFiscal();
        });

        inputCompetencia.addEventListener('change', async (e) => {
            competenciaAtiva = e.target.value;
            await carregarDadosFiscal();
        });

        regimeTributario.addEventListener('change', () => {
            const regime = regimeTributario.value;
            boxAnexoSimples.style.display = regime === 'simples_nacional' ? 'block' : 'none';
            
            let labelRegime = 'Simples Nacional';
            if (regime === 'lucro_presumido') labelRegime = 'Lucro Presumido';
            else if (regime === 'lucro_real') labelRegime = 'Lucro Real';
            else if (regime === 'mei') labelRegime = 'MEI';

            badgeRegime.textContent = labelRegime;
            atualizarCalculoEmTempoReal();
        });

        anexoSimples.addEventListener('change', atualizarCalculoEmTempoReal);
        inpRBT12.addEventListener('input', atualizarCalculoEmTempoReal);
        inpFolha12.addEventListener('input', atualizarCalculoEmTempoReal);

        document.getElementById('formParametrosFiscais').addEventListener('submit', salvarApuracao);
    });

    function getUltimos12Meses(competencia) {
        // competencia no formato YYYY-MM
        const [anoStr, mesStr] = competencia.split('-');
        let ano = parseInt(anoStr, 10);
        let mes = parseInt(mesStr, 10);

        const meses = [];
        for (let i = 0; i < 12; i++) {
            const m = String(mes).padStart(2, '0');
            meses.push(`${ano}-${m}`);
            mes--;
            if (mes === 0) {
                mes = 12;
                ano--;
            }
        }
        return meses;
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
                opt.textContent = `${emp.name} (${(emp.tax_regime || 'simples_nacional').toUpperCase()})`;
                selectEmpresa.appendChild(opt);
            });

            empresaAtiva = empresas[0];
            selectEmpresa.value = empresaAtiva.id;
            
            if (empresaAtiva.tax_regime) {
                regimeTributario.value = empresaAtiva.tax_regime;
                regimeTributario.dispatchEvent(new Event('change'));
            }

            await carregarDadosFiscal();
        } catch (err) {
            console.error("Erro ao carregar empresas:", err);
        }
    }

    async function carregarDadosFiscal() {
        if (!empresaAtiva) return;

        try {
            // 1. Carrega perfil tributário ativo para taxas específicas (ex: ISS configurado)
            const perfis = await window.BpoSupabase.request(
                `tax_profiles?company_id=eq.${empresaAtiva.id}&order=valid_from.desc&limit=1`,
                { method: 'GET' }
            );
            perfilTributario = perfis.length > 0 ? perfis[0] : null;

            // 2. Soma faturamento emitido na competência direto dos documentos do Módulo 04 (excluindo cancelados)
            const docs = await window.BpoSupabase.request(
                `billing_documents?company_id=eq.${empresaAtiva.id}&competence_month=eq.${competenciaAtiva}&status=neq.cancelled`,
                { method: 'GET' }
            );

            faturamentoCompetenciaCents = 0n;
            docs.forEach(d => {
                faturamentoCompetenciaCents += window.BpoMoney.toCents(d.gross_amount);
            });

            valBaseFaturamento.textContent = window.BpoMoney.formatBRL(faturamentoCompetenciaCents);

            // 3. Calcula RBT12 e Folha 12m a partir da tabela revenue_history para os últimos 12 meses
            const ultimos12 = getUltimos12Meses(competenciaAtiva);
            const inClause = `in.(${ultimos12.join(',')})`;
            const revHist12 = await window.BpoSupabase.request(
                `revenue_history?company_id=eq.${empresaAtiva.id}&competence_month=${inClause}`,
                { method: 'GET' }
            );

            let rbt12CalculadoCents = 0n;
            let folha12CalculadaCents = 0n;

            revHist12.forEach(rh => {
                rbt12CalculadoCents += window.BpoMoney.toCents(rh.gross_revenue);
                folha12CalculadaCents += window.BpoMoney.toCents(rh.payroll_amount);
            });

            // Se revenue_history para a competência atual ainda não existir, soma o faturamento atual na RBT12
            const histAtual = revHist12.find(rh => rh.competence_month === competenciaAtiva);
            if (!histAtual && faturamentoCompetenciaCents > 0n) {
                rbt12CalculadoCents += faturamentoCompetenciaCents;
            }

            inpRBT12.value = window.BpoMoney.toDecimalString(rbt12CalculadoCents);
            inpFolha12.value = window.BpoMoney.toDecimalString(folha12CalculadaCents);

            // 4. Carrega apurações passadas
            historicoApuracoes = await window.BpoSupabase.request(
                `tax_assessments?company_id=eq.${empresaAtiva.id}&order=competence_month.desc`,
                { method: 'GET' }
            );

            renderizarHistorico();
            atualizarCalculoEmTempoReal();

        } catch (err) {
            console.error("Erro ao carregar dados fiscais:", err);
        }
    }

    function getIssRate() {
        if (perfilTributario && perfilTributario.iss_rate !== undefined && perfilTributario.iss_rate !== null) {
            const r = parseFloat(perfilTributario.iss_rate);
            // Se vier em formato decimal 0.05, converte para 5.0
            return r <= 1.0 ? r * 100 : r;
        }
        return 5.0; // Padrão 5.00%
    }

    function atualizarCalculoEmTempoReal() {
        const regime = regimeTributario.value;
        const rbt12Cents = window.BpoMoney.toCents(inpRBT12.value);
        const folhaCents = window.BpoMoney.toCents(inpFolha12.value);

        valRBT12.textContent = window.BpoMoney.formatBRL(rbt12Cents);

        if (regime === 'lucro_real' || regime === 'mei') {
            valFatorR.textContent = "N/A";
            valImpostoApurado.textContent = "Aviso / Não Aplicável";
            const msg = regime === 'lucro_real' 
                ? 'O regime de <strong>Lucro Real</strong> exige escrituração contábil analítica (LALUR/LACS). A apuração automatizada deste demonstrativo atende apenas Simples Nacional e Lucro Presumido.'
                : 'O regime <strong>MEI (SIMEI)</strong> recolhe valor fixo mensal pré-definido pelo PGMEI via DASN, dispensando apuração por alíquota efetiva de faturamento.';
            
            painelMemoriaCalculo.innerHTML = `
                <div style="background: rgba(234, 179, 8, 0.1); border: 1px solid var(--color-warning); padding: 16px; border-radius: 8px; color: #fff;">
                    ⚠️ ${msg}
                </div>
            `;
            return;
        }

        if (regime === 'simples_nacional') {
            // Calcula Fator R
            const fatorRObj = window.BpoTaxEngine.calcularFatorR(folhaCents, rbt12Cents);
            valFatorR.textContent = fatorRObj.fatorRPercent;

            let anexoEscolhido = anexoSimples.value;
            if (anexoEscolhido === 'auto') {
                anexoEscolhido = fatorRObj.anexoRecomendado;
            }

            try {
                // Apura Simples
                const resultado = window.BpoTaxEngine.apurarSimplesNacional(
                    rbt12Cents,
                    faturamentoCompetenciaCents,
                    anexoEscolhido
                );

                valImpostoApurado.textContent = resultado.impostoFormatado;

                painelMemoriaCalculo.innerHTML = `
                    <div style="background: rgba(255,255,255,0.02); padding: 16px; border-radius: 8px; margin-bottom: 12px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                            <span>Anexo Aplicado:</span>
                            <strong style="color: #fff;">${window.BpoUtils.escapeHtml(resultado.anexo.toUpperCase())}</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                            <span>Alíquota Nominal da Faixa:</span>
                            <strong style="color: #fff;">${window.BpoUtils.escapeHtml(resultado.faixaNominal)}</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                            <span>Parcela a Deduzir:</span>
                            <strong style="color: #fff;">R$ ${resultado.parcelaDeduzir.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                            <span>Alíquota Efetiva Final:</span>
                            <strong style="color: var(--color-warning);">${window.BpoUtils.escapeHtml(resultado.aliquotaEfetiva)}</strong>
                        </div>
                    </div>
                    <div style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.4;">
                        * Fórmula oficial: [(RBT12 &times; Alíquota Nominal) - Parcela a Deduzir] &divide; RBT12.<br>
                        * Fator R apurado em <strong>${window.BpoUtils.escapeHtml(fatorRObj.fatorRPercent)}</strong> (${fatorRObj.enquadraAnexoIII ? 'Enquadrado no Anexo III vantajoso' : 'Enquadrado no Anexo V'}).
                    </div>
                `;
            } catch (err) {
                painelMemoriaCalculo.innerHTML = `<div style="color: var(--color-danger);">${window.BpoUtils.escapeHtml(err.message)}</div>`;
            }

        } else {
            // Lucro Presumido
            valFatorR.textContent = "N/A";
            const issRate = getIssRate();
            const resultado = window.BpoTaxEngine.apurarLucroPresumido(faturamentoCompetenciaCents, issRate);

            valImpostoApurado.textContent = resultado.impostoFormatado;

            painelMemoriaCalculo.innerHTML = `
                <div style="background: rgba(255,255,255,0.02); padding: 16px; border-radius: 8px; margin-bottom: 12px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                        <span>PIS (0.65%):</span>
                        <strong style="color: #fff;">${resultado.itens.pis.amount}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                        <span>COFINS (3.00%):</span>
                        <strong style="color: #fff;">${resultado.itens.cofins.amount}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                        <span>ISS (${issRate.toFixed(2)}%):</span>
                        <strong style="color: #fff;">${resultado.itens.iss.amount}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                        <span>IRPJ (4.80%):</span>
                        <strong style="color: #fff;">${resultado.itens.irpj.amount}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                        <span>CSLL (2.88%):</span>
                        <strong style="color: #fff;">${resultado.itens.csll.amount}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.08);">
                        <span>Alíquota Total Efetiva:</span>
                        <strong style="color: var(--color-warning);">${resultado.aliquotaTotal}</strong>
                    </div>
                </div>
            `;
        }
    }

    function formatarRegimeBadge(regime, annex) {
        if (!regime) return 'Não Definido';
        const map = {
            'simples_nacional': 'Simples Nacional' + (annex ? ` (${annex.toUpperCase()})` : ''),
            'lucro_presumido': 'Lucro Presumido',
            'lucro_real': 'Lucro Real',
            'mei': 'MEI'
        };
        return map[regime] || regime;
    }

    function formatarStatusBadge(status) {
        if (status === 'confirmed') return '<span class="badge badge-success">Confirmado</span>';
        if (status === 'draft') return '<span class="badge badge-warning">Rascunho</span>';
        return `<span class="badge">${window.BpoUtils.escapeHtml(status || '')}</span>`;
    }

    function renderizarHistorico() {
        if (historicoApuracoes.length === 0) {
            listaHistoricoBody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 24px;">
                        Nenhuma apuração tributária confirmada para esta empresa.
                    </td>
                </tr>
            `;
            return;
        }

        listaHistoricoBody.innerHTML = historicoApuracoes.map(ap => `
            <tr>
                <td style="font-weight: 700; color: #fff;">${window.BpoUtils.escapeHtml(ap.competence_month)}</td>
                <td>${window.BpoUtils.escapeHtml(formatarRegimeBadge(ap.regime, ap.annex))}</td>
                <td>${window.BpoMoney.formatBRL(ap.gross_revenue)}</td>
                <td>${window.BpoMoney.formatBRL(ap.rbt12)}</td>
                <td>${ap.factor_r ? (Number(ap.factor_r) * 100).toFixed(2) + '%' : 'N/A'}</td>
                <td>${(Number(ap.effective_rate || 0) * 100).toFixed(4)}%</td>
                <td style="font-weight: 700; color: var(--color-danger);">${window.BpoMoney.formatBRL(ap.calculated_tax)}</td>
                <td>${formatarStatusBadge(ap.status)}</td>
            </tr>
        `).join('');
    }

    async function salvarApuracao(e) {
        e.preventDefault();
        if (!empresaAtiva) return;

        const regime = regimeTributario.value;
        if (regime === 'lucro_real' || regime === 'mei') {
            alert('A apuração direta automatizada está disponível para Simples Nacional e Lucro Presumido.');
            return;
        }

        const rbt12Cents = window.BpoMoney.toCents(inpRBT12.value);
        const folhaCents = window.BpoMoney.toCents(inpFolha12.value);

        const fatorRObj = window.BpoTaxEngine.calcularFatorR(folhaCents, rbt12Cents);
        let resultado;
        let annexSalvo = null;

        if (regime === 'simples_nacional') {
            let anexo = anexoSimples.value;
            if (anexo === 'auto') anexo = fatorRObj.anexoRecomendado;
            annexSalvo = anexo;
            resultado = window.BpoTaxEngine.apurarSimplesNacional(rbt12Cents, faturamentoCompetenciaCents, anexo);
        } else {
            const issRate = getIssRate();
            resultado = window.BpoTaxEngine.apurarLucroPresumido(faturamentoCompetenciaCents, issRate);
        }

        const effectiveRateVal = typeof resultado.aliquotaEfetivaNumero === 'number' 
            ? resultado.aliquotaEfetivaNumero 
            : 0;

        const payload = {
            company_id: empresaAtiva.id,
            competence_month: competenciaAtiva,
            period_type: 'monthly',
            regime: regime,
            annex: annexSalvo,
            status: 'confirmed',
            rbt12: window.BpoMoney.toDecimalString(rbt12Cents),
            factor_r: regime === 'simples_nacional' ? fatorRObj.fatorR.toFixed(4) : null,
            gross_revenue: window.BpoMoney.toDecimalString(faturamentoCompetenciaCents),
            calculated_tax: window.BpoMoney.toDecimalString(resultado.impostoCents),
            effective_rate: effectiveRateVal.toFixed(4),
            confirmed_at: new Date().toISOString()
        };

        try {
            // Upsert por company_id, competence_month e period_type
            await window.BpoSupabase.request(
                'tax_assessments?on_conflict=company_id,competence_month,period_type',
                {
                    method: 'POST',
                    headers: { 'Prefer': 'resolution=merge-duplicates' },
                    body: JSON.stringify(payload)
                }
            );

            await carregarDadosFiscal();
            alert('Apuração fiscal gravada com sucesso no Supabase!');

        } catch (err) {
            alert('Erro ao gravar apuração: ' + err.message);
        }
    }
})();
