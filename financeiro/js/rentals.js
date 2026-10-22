// ==============================================================================
// rentals.js — Motor de Cálculo de Locações e Rateios Societários (Módulo 08)
// ==============================================================================

(function() {
    class RentalEngine {
        /**
         * Calcula a distribuição de locação do imóvel:
         * 1. Receita Bruta Recebida
         * 2. (-) Deduções (IPTU, condomínio, taxa de administração)
         * 3. (=) Valor Líquido Distribuível
         * 4. Multiplica pelas participações societárias de cada participante (ex: 50% / 50%)
         * 5. Corrige resíduo de centavos no participante majoritário ou primeiro
         */
        static calcularDistribuicao({
            grossReceived,
            deductions = 0,
            adminRate = 0, // % taxa adm se houver
            participants = [] // [{ person_id, name, participation_pct }]
        }) {
            const grossCents = window.BpoMoney.toCents(grossReceived);
            const dedCents = window.BpoMoney.toCents(deductions);

            // Taxa de administração
            const adminCents = adminRate > 0 
                ? window.BpoMoney.applyPercentage(grossCents, adminRate) 
                : 0n;

            const totalDeducoesCents = dedCents + adminCents;
            const distributableCents = grossCents > totalDeducoesCents 
                ? grossCents - totalDeducoesCents 
                : 0n;

            let somaDistribuidaCents = 0n;
            const distribuicoes = participants.map((p, idx) => {
                const pct = parseFloat(p.participation_pct) || 0;
                const valorCents = window.BpoMoney.applyPercentage(distributableCents, pct);
                somaDistribuidaCents += valorCents;

                return {
                    person_id: p.person_id || p.id,
                    name: p.name,
                    participation_pct: pct,
                    amountCents: valorCents,
                    amountFormatado: window.BpoMoney.formatBRL(valorCents)
                };
            });

            // Ajuste fino de centavo residual (diferença de arredondamento)
            const residuoCents = distributableCents - somaDistribuidaCents;
            if (residuoCents !== 0n && distribuicoes.length > 0) {
                distribuicoes[0].amountCents += residuoCents;
                distribuicoes[0].amountFormatado = window.BpoMoney.formatBRL(distribuicoes[0].amountCents);
            }

            return {
                grossCents,
                grossFormatado: window.BpoMoney.formatBRL(grossCents),
                deductionsCents: totalDeducoesCents,
                deductionsFormatado: window.BpoMoney.formatBRL(totalDeducoesCents),
                distributableCents,
                distributableFormatado: window.BpoMoney.formatBRL(distributableCents),
                distribuicoes
            };
        }
    }

    window.BpoRentalEngine = RentalEngine;
})();
