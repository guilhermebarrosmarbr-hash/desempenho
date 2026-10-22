// ==============================================================================
// commissions.js — Motor de Cálculo de Comissões e Intermediações (Módulos 06 e 07)
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
         * Fórmula: Comissao = (BaseElegivel * Percentual)
         * Respeita Teto (cap) se configurado no contrato.
         */
        static calcularComissao({
            baseAmount,
            percentage,
            capType = 'none', // 'none', 'fixed_amount', 'percentage'
            capValue = 0
        }) {
            const baseCents = window.BpoMoney.toCents(baseAmount);
            let comissaoCents = window.BpoMoney.applyPercentage(baseCents, percentage);

            if (capType === 'fixed_amount') {
                const capCents = window.BpoMoney.toCents(capValue);
                if (capCents > 0n && comissaoCents > capCents) {
                    comissaoCents = capCents;
                }
            }

            return {
                baseCents,
                baseFormatada: window.BpoMoney.formatBRL(baseCents),
                percentage,
                comissaoCents,
                comissaoFormatada: window.BpoMoney.formatBRL(comissaoCents)
            };
        }

        /**
         * Calcula a taxa de intermediação entre empresas do grupo:
         * Ex: Mar Brasil faturou R$ 10.000, taxa de 10% para a DZM como intermediadora.
         * Valor Intermediacao = Base * (Taxa / 100)
         */
        static calcularIntermediacao({
            baseAmount,
            ratePercentage
        }) {
            const baseCents = window.BpoMoney.toCents(baseAmount);
            const intermediacaoCents = window.BpoMoney.applyPercentage(baseCents, ratePercentage);

            return {
                baseCents,
                baseFormatada: window.BpoMoney.formatBRL(baseCents),
                ratePercentage,
                intermediacaoCents,
                intermediacaoFormatada: window.BpoMoney.formatBRL(intermediacaoCents)
            };
        }
    }

    window.BpoCommissionEngine = CommissionEngine;
})();
