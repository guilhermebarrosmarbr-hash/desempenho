// ==============================================================================
// rentals.js — Motor de Cálculo de Locações e Rateios Societários (Módulo 08)
// Suporta dois tipos de repasse:
//   - Honorários: taxa de administração calculada sobre o bruto (antes das cotas)
//   - Cotas: % do líquido (bruto − IPTU − DAS − honorários) dividido entre sócios
// ==============================================================================

(function() {
    class RentalEngine {
        /**
         * Calcula a distribuição de cotas de um imóvel:
         * 1. Receita Bruta Recebida (já descontado desconto contratual, se houver)
         * 2. (-) Deduções totais (IPTU + DAS + Honorários já calculados externamente)
         * 3. (=) Valor Líquido Distribuível
         * 4. Multiplica pela participação societária de cada sócio
         * 5. Corrige resíduo de centavos de arredondamento (máximo 1 cent por participante)
         *
         * Nota: Honorários são calculados e inseridos externamente em locacoes.js
         *       antes de chamar esta função. adminRate deve ser 0 nesse fluxo.
         *
         * @param {Object} params
         * @param {BigInt|number|string} params.grossReceived  - Valor bruto recebido (cents ou decimal)
         * @param {BigInt|number|string} params.deductions     - Total de deduções (IPTU + DAS + honorários)
         * @param {number}               params.adminRate      - Taxa de adm % (legado; usar 0 no novo fluxo)
         * @param {Array}                params.participants   - [{person_id, name, participation_pct}]
         * @returns {Object} { grossCents, deductionsCents, distributableCents, distribuicoes[] }
         */
        static calcularDistribuicao({
            grossReceived,
            deductions = 0,
            adminRate  = 0,
            participants = []
        }) {
            const grossCents = typeof grossReceived === 'bigint'
                ? grossReceived
                : window.BpoMoney.toCents(grossReceived);

            const dedCents = typeof deductions === 'bigint'
                ? deductions
                : window.BpoMoney.toCents(deductions);

            // Taxa de administração residual (legado — usar 0 no novo fluxo)
            const adminCents = adminRate > 0
                ? window.BpoMoney.applyPercentage(grossCents, adminRate)
                : 0n;

            const totalDeducoesCents = dedCents + adminCents;
            const distributableCents = grossCents > totalDeducoesCents
                ? grossCents - totalDeducoesCents
                : 0n;

            let somaDistribuidaCents = 0n;
            const distribuicoes = participants.map(p => {
                const pct       = parseFloat(p.participation_pct) || 0;
                const valorCents = window.BpoMoney.applyPercentage(distributableCents, pct);
                somaDistribuidaCents += valorCents;

                return {
                    person_id:         p.person_id || p.id,
                    name:              p.name,
                    participation_pct: pct,
                    amountCents:       valorCents,
                    amountFormatado:   window.BpoMoney.formatBRL(valorCents)
                };
            });

            // F16: Ajuste fino de centavo residual de arredondamento (máx. 1 cent por participante)
            const somaPcts          = participants.reduce((acc, p) => acc + (parseFloat(p.participation_pct) || 0), 0);
            const somaDistribuivelPcts = window.BpoMoney.applyPercentage(distributableCents, somaPcts);
            const residuoCents      = somaDistribuivelPcts - somaDistribuidaCents;
            const limiteResiduo     = BigInt(distribuicoes.length);

            if (
                residuoCents !== 0n &&
                distribuicoes.length > 0 &&
                residuoCents <= limiteResiduo &&
                residuoCents >= -limiteResiduo
            ) {
                distribuicoes[0].amountCents    += residuoCents;
                distribuicoes[0].amountFormatado = window.BpoMoney.formatBRL(distribuicoes[0].amountCents);
            }

            return {
                grossCents,
                grossFormatado:        window.BpoMoney.formatBRL(grossCents),
                deductionsCents:       totalDeducoesCents,
                deductionsFormatado:   window.BpoMoney.formatBRL(totalDeducoesCents),
                distributableCents,
                distributableFormatado: window.BpoMoney.formatBRL(distributableCents),
                distribuicoes
            };
        }
    }

    window.BpoRentalEngine = RentalEngine;
})();
