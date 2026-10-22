// ==============================================================================
// money.js — Utilitário de precisão exata para valores monetários (sem float)
// ==============================================================================

(function() {
    class MoneyUtil {
        // Converte valor monetário (string ou número) para centavos inteiros (BigInt)
        static toCents(val) {
            if (val === null || val === undefined) return 0n;
            if (typeof val === 'bigint') return val;
            
            let str = String(val).trim();
            // Remove pontuação de milhar e normaliza vírgula decimal
            str = str.replace(/R\$\s?/, '').replace(/\s/g, '');
            if (str.includes(',') && str.includes('.')) {
                // Formato brasileiro: 1.250,50
                str = str.replace(/\./g, '').replace(',', '.');
            } else if (str.includes(',')) {
                str = str.replace(',', '.');
            }

            const num = parseFloat(str);
            if (isNaN(num)) return 0n;

            // Arredondamento seguro para evitar desvios de precisão float
            return BigInt(Math.round(num * 100));
        }

        // Converte centavos (BigInt) para string decimal "1250.50"
        static toDecimalString(cents) {
            const isNegative = cents < 0n;
            const absCents = isNegative ? -cents : cents;
            const intPart = absCents / 100n;
            const decPart = absCents % 100n;
            const formattedDec = decPart < 10n ? `0${decPart}` : `${decPart}`;
            return `${isNegative ? '-' : ''}${intPart}.${formattedDec}`;
        }

        // Formata para moeda brasileira: R$ 1.250,50
        static formatBRL(val) {
            const cents = this.toCents(val);
            const isNegative = cents < 0n;
            const absCents = isNegative ? -cents : cents;
            const intPart = (absCents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
            const decPart = absCents % 100n;
            const formattedDec = decPart < 10n ? `0${decPart}` : `${decPart}`;
            return `${isNegative ? '- ' : ''}R$ ${intPart},${formattedDec}`;
        }

        // Multiplica centavos por uma taxa percentual (ex: 5.5% -> taxPercent = 5.5)
        // Arredondamento banker's rounding / round half-up
        static applyPercentage(cents, percentage) {
            const rateInBasisPoints = BigInt(Math.round(percentage * 10000)); // 5.5% = 55000 bps
            const result = (cents * rateInBasisPoints + 500000n) / 1000000n;
            return result;
        }
    }

    window.BpoMoney = MoneyUtil;
})();
