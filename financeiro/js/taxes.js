// ==============================================================================
// taxes.js — Motor Tributário do BPO Financeiro (Módulo 05)
// Suporta: Simples Nacional (Anexos I, III, IV, V) com Fator R e Lucro Presumido
// ==============================================================================

(function() {
    // Tabelas Oficiais do Simples Nacional (LC 123/2006 atualizada)
    // Faixas: [limiteMax, aliquotaNominalPercent, parcelaDeduzirReais]
    const TABELAS_SIMPLES = {
        // Anexo III — Serviços (Instalação, reparos, manutenção, etc. ou Fator R >= 28%)
        anexo_iii: [
            { max: 180000, rate: 0.06, deduction: 0 },
            { max: 360000, rate: 0.1120, deduction: 9360 },
            { max: 720000, rate: 0.1350, deduction: 17640 },
            { max: 1800000, rate: 0.1600, deduction: 35640 },
            { max: 3600000, rate: 0.2100, deduction: 125640 },
            { max: 4800000, rate: 0.3300, deduction: 648000 }
        ],
        // Anexo IV — Serviços com INSS patronal pago à parte (Construção civil, etc.)
        anexo_iv: [
            { max: 180000, rate: 0.045, deduction: 0 },
            { max: 360000, rate: 0.090, deduction: 8100 },
            { max: 720000, rate: 0.102, deduction: 12420 },
            { max: 1800000, rate: 0.140, deduction: 39780 },
            { max: 3600000, rate: 0.220, deduction: 183780 },
            { max: 4800000, rate: 0.330, deduction: 828000 }
        ],
        // Anexo V — Serviços intelectuais/engenharia sujeitos ao Fator R (< 28%)
        anexo_v: [
            { max: 180000, rate: 0.1550, deduction: 0 },
            { max: 360000, rate: 0.1800, deduction: 4500 },
            { max: 720000, rate: 0.1950, deduction: 9900 },
            { max: 1800000, rate: 0.2050, deduction: 17100 },
            { max: 3600000, rate: 0.2300, deduction: 62100 },
            { max: 4800000, rate: 0.3050, deduction: 540000 }
        ]
    };

    class TaxEngine {
        /**
         * Calcula o Fator R (Folha de Salários 12 meses / Receita Bruta 12 meses)
         * Se Fator R >= 0.28 (28%), tributa pelo Anexo III. Caso contrário, Anexo V.
         */
        static calcularFatorR(folha12Meses, rbt12) {
            const folhaCents = window.BpoMoney.toCents(folha12Meses);
            const rbtCents = window.BpoMoney.toCents(rbt12);

            if (rbtCents === 0n) {
                return {
                    fatorR: 0,
                    fatorRPercent: "0.00%",
                    anexoRecomendado: "anexo_iii",
                    enquadraAnexoIII: true
                };
            }

            // Precisão de 4 casas decimais: (folha * 10000) / rbt
            const ratioBps = Number((folhaCents * 10000n) / rbtCents);
            const fatorR = ratioBps / 10000;
            const fatorRPercent = (fatorR * 100).toFixed(2) + "%";
            const enquadraAnexoIII = fatorR >= 0.28;

            return {
                fatorR,
                fatorRPercent,
                anexoRecomendado: enquadraAnexoIII ? "anexo_iii" : "anexo_v",
                enquadraAnexoIII
            };
        }

        /**
         * Apuração Simples Nacional:
         * Alíquota Efetiva = ((RBT12 * Alíquota Nominal) - Parcela a Deduzir) / RBT12
         * Imposto a Pagar = Faturamento do Mês * Alíquota Efetiva
         */
        static apurarSimplesNacional(rbt12, faturamentoMes, anexoKey = 'anexo_iii') {
            const rbt12Cents = window.BpoMoney.toCents(rbt12);
            const faturamentoCents = window.BpoMoney.toCents(faturamentoMes);

            const tabela = TABELAS_SIMPLES[anexoKey] || TABELAS_SIMPLES.anexo_iii;
            const rbt12Reais = Number(rbt12Cents) / 100;

            // Encontra faixa correspondente
            let faixa = tabela[0];
            for (let i = 0; i < tabela.length; i++) {
                if (rbt12Reais <= tabela[i].max || i === tabela.length - 1) {
                    faixa = tabela[i];
                    break;
                }
            }

            let aliquotaEfetiva = 0;
            if (rbt12Reais > 0) {
                aliquotaEfetiva = ((rbt12Reais * faixa.rate) - faixa.deduction) / rbt12Reais;
            } else {
                aliquotaEfetiva = faixa.rate; // 1ª faixa no início
            }

            if (aliquotaEfetiva < 0) aliquotaEfetiva = 0;

            // Imposto em centavos
            const impostoCents = window.BpoMoney.applyPercentage(faturamentoCents, aliquotaEfetiva * 100);

            return {
                regime: 'simples_nacional',
                anexo: anexoKey,
                faixaNominal: (faixa.rate * 100).toFixed(2) + '%',
                parcelaDeduzir: faixa.deduction,
                aliquotaEfetiva: (aliquotaEfetiva * 100).toFixed(4) + '%',
                aliquotaEfetivaNumero: aliquotaEfetiva,
                impostoCents,
                impostoFormatado: window.BpoMoney.formatBRL(impostoCents)
            };
        }

        /**
         * Apuração Lucro Presumido para Serviços (base padrão 32% para IRPJ/CSLL):
         * PIS: 0.65%
         * COFINS: 3.00%
         * ISS: 2.00% a 5.00% (configurável pelo município)
         * IRPJ: 15% sobre base presumida de 32% (= 4.80%) + adicional 10% s/ excedente R$ 20k/mês
         * CSLL: 9% sobre base presumida de 32% (= 2.88%)
         * Total Federal Médio = 11.33% + ISS (2 a 5%) = 13.33% a 16.33%
         */
        static apurarLucroPresumido(faturamentoMes, aliquotaIssPercent = 5.0) {
            const fatCents = window.BpoMoney.toCents(faturamentoMes);

            // Alíquotas nominais
            const pisCents = window.BpoMoney.applyPercentage(fatCents, 0.65);
            const cofinsCents = window.BpoMoney.applyPercentage(fatCents, 3.00);
            const issCents = window.BpoMoney.applyPercentage(fatCents, aliquotaIssPercent);
            const irpjCents = window.BpoMoney.applyPercentage(fatCents, 4.80);
            const csllCents = window.BpoMoney.applyPercentage(fatCents, 2.88);

            const totalImpostoCents = pisCents + cofinsCents + issCents + irpjCents + csllCents;
            const aliquotaTotalEfetiva = Number(totalImpostoCents * 10000n / fatCents) / 100;

            return {
                regime: 'lucro_presumido',
                itens: {
                    pis: { rate: '0.65%', amount: window.BpoMoney.formatBRL(pisCents), cents: pisCents },
                    cofins: { rate: '3.00%', amount: window.BpoMoney.formatBRL(cofinsCents), cents: cofinsCents },
                    iss: { rate: aliquotaIssPercent.toFixed(2) + '%', amount: window.BpoMoney.formatBRL(issCents), cents: issCents },
                    irpj: { rate: '4.80%', amount: window.BpoMoney.formatBRL(irpjCents), cents: irpjCents },
                    csll: { rate: '2.88%', amount: window.BpoMoney.formatBRL(csllCents), cents: csllCents }
                },
                aliquotaTotal: aliquotaTotalEfetiva.toFixed(2) + '%',
                impostoCents: totalImpostoCents,
                impostoFormatado: window.BpoMoney.formatBRL(totalImpostoCents)
            };
        }
    }

    window.BpoTaxEngine = TaxEngine;
})();
