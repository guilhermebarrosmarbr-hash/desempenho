// ==============================================================================
// money.js — Utilitário de precisão exata para valores monetários (sem float)
// ==============================================================================

(function(global) {
    class MoneyUtil {
        /**
         * Converte qualquer representação válida de valor monetário para centavos (BigInt).
         * Regras de parsing inequívocas:
         * 1. BigInt: retornado diretamente.
         * 2. Number: tratado como valor numérico decimal puro (ex: 1.005 vira 101 centavos; 1250.5 vira 125050 centavos).
         *    NUNCA é tratado como milhar brasileiro.
         * 3. String:
         *    - Remove prefixos "R$", espaços e caracteres invisíveis.
         *    - Suporta sinal negativo ("-" ou parênteses).
         *    - Se contiver vírgula (formato brasileiro): pontos são milhares e vírgula é decimal.
         *      Ex: "1.250,50" -> 1250.50 -> 125050 centavos.
         *      Ex: "1250,50" -> 1250.50 -> 125050 centavos.
         *    - Se contiver APENAS ponto (formato internacional/API):
         *      Ex: "1250.50" -> 1250.50 -> 125050 centavos.
         *      Ex: "1.005" -> 1.005 -> 101 centavos (arredondado).
         *      Ex: "1000.00" -> 100000 centavos.
         *    - Se não contiver nem ponto nem vírgula: inteiro puro.
         */
        static toCents(val) {
            if (val === null || val === undefined) return 0n;
            if (typeof val === 'bigint') return val;

            if (typeof val === 'number') {
                if (!Number.isFinite(val) || Number.isNaN(val)) return 0n;
                // Converte number multiplicando por 100 com Math.round
                return BigInt(Math.round(val * 100));
            }

            let str = String(val).trim();
            if (str === '') return 0n;

            // Suporte a notação contábil de negativos: (1.250,50) -> -1250.50
            let isNegative = false;
            if (str.startsWith('(') && str.endsWith(')')) {
                isNegative = true;
                str = str.slice(1, -1).trim();
            } else if (str.startsWith('-')) {
                isNegative = true;
                str = str.slice(1).trim();
            } else if (str.startsWith('+')) {
                str = str.slice(1).trim();
            }

            // Remove R$, espaços e caracteres invisíveis
            str = str.replace(/R\$\s?/gi, '').replace(/\s+/g, '');

            if (str === '') return 0n;

            if (str.includes(',')) {
                // Notação brasileira: pontos são separadores de milhar, vírgula é decimal
                str = str.replace(/\./g, '').replace(',', '.');
            }

            const num = parseFloat(str);
            if (!Number.isFinite(num) || Number.isNaN(num)) return 0n;

            const cents = BigInt(Math.round(num * 100));
            return isNegative ? -cents : cents;
        }

        // Converte centavos (BigInt) para string decimal "1250.50"
        static toDecimalString(cents) {
            const c = typeof cents === 'bigint' ? cents : this.toCents(cents);
            const isNegative = c < 0n;
            const absCents = isNegative ? -c : c;
            const intPart = absCents / 100n;
            const decPart = absCents % 100n;
            const formattedDec = decPart < 10n ? `0${decPart}` : `${decPart}`;
            return `${isNegative ? '-' : ''}${intPart}.${formattedDec}`;
        }

        // Formata para moeda brasileira: R$ 1.250,50 ou - R$ 1.250,50
        static formatBRL(val) {
            const cents = this.toCents(val);
            const isNegative = cents < 0n;
            const absCents = isNegative ? -cents : cents;
            const intPart = (absCents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
            const decPart = absCents % 100n;
            const formattedDec = decPart < 10n ? `0${decPart}` : `${decPart}`;
            return `${isNegative ? '- ' : ''}R$ ${intPart},${formattedDec}`;
        }

        /**
         * Aplica percentual com alta precisão (ex: 0.225% para comissões)
         * percentage: número ou string (ex: 0.225 para 0.225%, ou 10 para 10%)
         */
        static applyPercentage(cents, percentage) {
            const c = typeof cents === 'bigint' ? cents : this.toCents(cents);
            const pctNum = typeof percentage === 'number' ? percentage : parseFloat(percentage);
            if (!Number.isFinite(pctNum) || Number.isNaN(pctNum) || pctNum === 0) {
                return 0n;
            }
            // Multiplica centavos por (percentage * 1000000) e divide por 100000000 (100 milhões)
            // Isso preserva até 6 casas decimais de percentual (ex: 0.225% -> 225000 / 100.000.000)
            const scaledRate = BigInt(Math.round(pctNum * 1000000));
            const prod = c * scaledRate;
            const divisor = 100000000n; // 100 * 1.000.000

            if (prod >= 0n) {
                return (prod + (divisor / 2n)) / divisor;
            } else {
                return (prod - (divisor / 2n)) / divisor;
            }
        }
    }

    global.BpoMoney = MoneyUtil;
    global.MoneyUtil = MoneyUtil;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = MoneyUtil;
    }
})(typeof window !== 'undefined' ? window : globalThis);
