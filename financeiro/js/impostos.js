// ==============================================================================
// impostos.js — Lógica do Módulo 05 (Controle de Impostos & Memória de Cálculo)
// ==============================================================================

(function() {
    let empresas = [];
    let empresaAtiva = null;
    let competenciaAtiva = '';
    let faturamentoCompetenciaCents = 0n;
    let historicoApuracoes = [];

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
            boxAnexoSimples.style.display = regimeTributario.value === 'simples_nacional' ? 'block' : 'none';
            badgeRegime.textContent = regimeTributario.value === 'simples_nacional' ? 'Simples Nacional' : 'Lucro Presumido';
            atualizarCalculoEmTempoReal();
        });

        anexoSimples.addEventListener('change', atualizarCalculoEmTempoReal);
        inpRBT12.addEventListener('input', atualizarCalculoEmTempoReal);
        inpFolha12.addEventListener('input', atualizarCalculoEmTempoReal);

        document.getElementById('formParametrosFiscais').addEventListener('submit', salvarApuracao);
    });

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
                opt.textContent = `${emp.name} (${emp.tax_regime.toUpperCase()})`;
                selectEmpresa.appendChild(opt);
            });

            empresaAtiva = empresas[0];
            selectEmpresa.value = empresaAtiva.id;
            
            // Pré-define regime da empresa
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
            // 1. Soma faturamento emitido na competência direto dos documentos do Módulo 04
            const docs = await window.BpoSupabase.request(
                `billing_documents?company_id=eq.${empresaAtiva.id}&competence_month=eq.${competenciaAtiva}`,
                { method: 'GET' }
            );

            faturamentoCompetenciaCents = 0n;
            docs.forEach(d => {
                if (d.status !== 'cancelled') {
                    faturamentoCompetenciaCents += window.BpoMoney.toCents(d.gross_amount);
                }
            });

            valBaseFaturamento.textContent = window.BpoMoney.formatBRL(faturamentoCompetenciaCents);

            // 2. Busca histórico salvo da competência na tabela revenue_history se existir
            const revHist = await window.BpoSupabase.request(
                `revenue_history?company_id=eq.${empresaAtiva.id}&competence_month=eq.${competenciaAtiva}&limit=1`,
                { method: 'GET' }
            );

            if (revHist.length > 0) {
                inpFolha12.value = window.BpoMoney.toDecimalString(window.BpoMoney.toCents(revHist[0].payroll_amount));
            }

            // 3. Carrega apurações passadas
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

    function atualizarCalculoEmTempoReal() {
        const regime = regimeTributario.value;
        const rbt12Cents = window.BpoMoney.toCents(inpRBT12.value);
        const folhaCents = window.BpoMoney.toCents(inpFolha12.value);

        valRBT12.textContent = window.BpoMoney.formatBRL(rbt12Cents);

        if (regime === 'simples_nacional') {
            // Calcula Fator R
            const fatorRObj = window.BpoTaxEngine.calcularFatorR(folhaCents, rbt12Cents);
            valFatorR.textContent = fatorRObj.fatorRPercent;

            let anexoEscolhido = anexoSimples.value;
            if (anexoEscolhido === 'auto') {
                anexoEscolhido = fatorRObj.anexoRecomendado;
            }

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
                        <strong style="color: #fff;">${resultado.anexo.toUpperCase()}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                        <span>Alíquota Nominal da Faixa:</span>
                        <strong style="color: #fff;">${resultado.faixaNominal}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                        <span>Parcela a Deduzir:</span>
                        <strong style="color: #fff;">R$ ${resultado.parcelaDeduzir.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                        <span>Alíquota Efetiva Final:</span>
                        <strong style="color: var(--color-warning);">${resultado.aliquotaEfetiva}</strong>
                    </div>
                </div>
                <div style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.4;">
                    * Fórmula oficial: [(RBT12 &times; Alíquota Nominal) - Parcela a Deduzir] &divide; RBT12.<br>
                    * Fator R apurado em <strong>${fatorRObj.fatorRPercent}</strong> (${fatorRObj.enquadraAnexoIII ? 'Enquadrado no Anexo III vantajoso' : 'Enquadrado no Anexo V'}).
                </div>
            `;

        } else {
            // Lucro Presumido
            valFatorR.textContent = "N/A";
            const resultado = window.BpoTaxEngine.apurarLucroPresumido(faturamentoCompetenciaCents, 5.0);

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
                        <span>ISS (5.00%):</span>
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
                <td style="font-weight: 700; color: #fff;">${ap.competence_month}</td>
                <td>Simples Nacional</td>
                <td>${window.BpoMoney.formatBRL(ap.gross_revenue)}</td>
                <td>${window.BpoMoney.formatBRL(ap.rbt12)}</td>
                <td>${(Number(ap.factor_r || 0) * 100).toFixed(2)}%</td>
                <td>${(Number(ap.effective_rate || 0) * 100).toFixed(4)}%</td>
                <td style="font-weight: 700; color: var(--color-danger);">${window.BpoMoney.formatBRL(ap.calculated_tax)}</td>
                <td><span class="badge badge-success">Confirmado</span></td>
            </tr>
        `).join('');
    }

    async function salvarApuracao(e) {
        e.preventDefault();
        if (!empresaAtiva) return;

        const regime = regimeTributario.value;
        const rbt12Cents = window.BpoMoney.toCents(inpRBT12.value);
        const folhaCents = window.BpoMoney.toCents(inpFolha12.value);

        const fatorRObj = window.BpoTaxEngine.calcularFatorR(folhaCents, rbt12Cents);
        let resultado;

        if (regime === 'simples_nacional') {
            let anexo = anexoSimples.value;
            if (anexo === 'auto') anexo = fatorRObj.anexoRecomendado;
            resultado = window.BpoTaxEngine.apurarSimplesNacional(rbt12Cents, faturamentoCompetenciaCents, anexo);
        } else {
            resultado = window.BpoTaxEngine.apurarLucroPresumido(faturamentoCompetenciaCents, 5.0);
        }

        const payload = {
            company_id: empresaAtiva.id,
            competence_month: competenciaAtiva,
            status: 'confirmed',
            rbt12: window.BpoMoney.toDecimalString(rbt12Cents),
            factor_r: fatorRObj.fatorR.toFixed(4),
            gross_revenue: window.BpoMoney.toDecimalString(faturamentoCompetenciaCents),
            calculated_tax: window.BpoMoney.toDecimalString(resultado.impostoCents),
            effective_rate: resultado.aliquotaEfetivaNumero ? resultado.aliquotaEfetivaNumero.toFixed(4) : '0.1633',
            confirmed_at: new Date().toISOString()
        };

        try {
            await window.BpoSupabase.request('tax_assessments', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            await carregarDadosFiscal();
            alert('Apuração fiscal gravada com sucesso no Supabase!');

        } catch (err) {
            alert('Erro ao gravar apuração: ' + err.message);
        }
    }
})();
