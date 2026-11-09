// ==============================================================================
// commissions.js — Motor de Cálculo de Comissões e Intermediações (Módulos 06 e 07)
// Atualizado para suportar precisão decimal livre (ex: 0.5%, 0.225%, 0.135%, 0.09%)
// ==============================================================================

(function() {
    class CommissionEngine {
        /**
         * Calcula a comissão do colaborador com base na regra do contrato:
         * Base pode ser:
         * 1. 'gross_invoiced': Valor Bruto Emitido no faturamento
         * 2. 'gross_liquidated': Valor Bruto recebido/liquidado no caixa
         * 3. 'net_proportional': Líquido recebido descontado proporcionalmente de impostos
         *
         * Fórmula: Comissao = (BaseElegivel * Percentual / 100)
         * Suporta qualquer quantidade de casas decimais em `percentage`.
         */
        static calcularComissao({
            baseAmount,
            percentage,
            capType = 'none', // 'none', 'fixed_amount', 'percentage'
            capValue = 0
        }) {
            const baseCents = window.BpoMoney ? window.BpoMoney.toCents(baseAmount) : BigInt(Math.round(Number(baseAmount) * 100));
            const pct = parseFloat(percentage) || 0;
            
            // Cálculo com precisão decimal livre em ponto flutuante convertido para centavos arredondados
            const comissaoNum = (Number(baseCents) / 100) * (pct / 100);
            let comissaoCents = BigInt(Math.round(comissaoNum * 100));

            if (capType === 'fixed_amount' && window.BpoMoney) {
                const capCents = window.BpoMoney.toCents(capValue);
                if (capCents > 0n && comissaoCents > capCents) {
                    comissaoCents = capCents;
                }
            } else if (capType === 'percentage') {
                const capPct = parseFloat(capValue) || 0;
                const maxCapNum = (Number(baseCents) / 100) * (capPct / 100);
                const maxCapCents = BigInt(Math.round(maxCapNum * 100));
                if (maxCapCents > 0n && comissaoCents > maxCapCents) {
                    comissaoCents = maxCapCents;
                }
            }

            return {
                baseCents,
                baseFormatada: window.BpoMoney ? window.BpoMoney.formatBRL(baseCents) : `R$ ${(Number(baseCents)/100).toFixed(2)}`,
                percentage: pct,
                comissaoCents,
                comissaoFormatada: window.BpoMoney ? window.BpoMoney.formatBRL(comissaoCents) : `R$ ${(Number(comissaoCents)/100).toFixed(2)}`
            };
        }

        /**
         * Calcula a taxa de intermediação entre empresas do grupo
         */
        static calcularIntermediacao({
            baseAmount,
            ratePercentage
        }) {
            const baseCents = window.BpoMoney ? window.BpoMoney.toCents(baseAmount) : BigInt(Math.round(Number(baseAmount) * 100));
            const pct = parseFloat(ratePercentage) || 0;
            const intermediacaoNum = (Number(baseCents) / 100) * (pct / 100);
            const intermediacaoCents = BigInt(Math.round(intermediacaoNum * 100));

            return {
                baseCents,
                baseFormatada: window.BpoMoney ? window.BpoMoney.formatBRL(baseCents) : `R$ ${(Number(baseCents)/100).toFixed(2)}`,
                ratePercentage: pct,
                intermediacaoCents,
                intermediacaoFormatada: window.BpoMoney ? window.BpoMoney.formatBRL(intermediacaoCents) : `R$ ${(Number(intermediacaoCents)/100).toFixed(2)}`
            };
        }
    }

    window.BpoCommissionEngine = CommissionEngine;
})();
