// ==============================================================================
// taxes.js — Motor Tributário Completo: Simples Nacional, Lucro Presumido Mensal
// e Apuração Trimestral de IRPJ/CSLL (Regra da Portaria/Lei 9.249/1995 e Redução de Benefícios)
// Compatível com Browser (window) e Node.js (CommonJS / ES Module)
// ==============================================================================

(function(root, factory) {
    if (typeof exports === 'object' && typeof module !== 'undefined') {
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else {
        root.BpoTaxEngine = factory();
    }
})(typeof self !== 'undefined' ? self : this, function() {

    // Repartição padrão oficial dos tributos dentro do DAS Simples Nacional
    // Para Anexo III e Anexo V
    const REPARTICAO_SIMPLES = {
        anexo_iii: {
            faixa1: { irpj: 0.0400, csll: 0.0350, cofins: 0.1282, pis: 0.0278, inss: 0.4340, iss: 0.3350 },
            faixa2: { irpj: 0.0400, csll: 0.0350, cofins: 0.1405, pis: 0.0305, inss: 0.4340, iss: 0.3200 },
            faixa3: { irpj: 0.0400, csll: 0.0350, cofins: 0.1364, pis: 0.0296, inss: 0.4340, iss: 0.3250 },
            faixa4: { irpj: 0.0400, csll: 0.0350, cofins: 0.1364, pis: 0.0296, inss: 0.4340, iss: 0.3250 },
            faixa5: { irpj: 0.0400, csll: 0.0350, cofins: 0.1282, pis: 0.0278, inss: 0.4340, iss: 0.3350 },
            faixa6: { irpj: 0.3500, csll: 0.1500, cofins: 0.1603, pis: 0.0347, inss: 0.3050, iss: 0.0000 }
        },
        anexo_iv: {
            faixa1: { irpj: 0.1880, csll: 0.1520, cofins: 0.1767, pis: 0.0383, inss: 0.0000, iss: 0.4450 },
            faixa2: { irpj: 0.1980, csll: 0.1520, cofins: 0.2055, pis: 0.0445, inss: 0.0000, iss: 0.4000 },
            faixa3: { irpj: 0.2080, csll: 0.1520, cofins: 0.1973, pis: 0.0427, inss: 0.0000, iss: 0.4000 },
            faixa4: { irpj: 0.1780, csll: 0.1920, cofins: 0.1890, pis: 0.0410, inss: 0.0000, iss: 0.4000 },
            faixa5: { irpj: 0.1880, csll: 0.1920, cofins: 0.1808, pis: 0.0392, inss: 0.0000, iss: 0.4000 },
            faixa6: { irpj: 0.5350, csll: 0.2150, cofins: 0.2055, pis: 0.0440, inss: 0.0000, iss: 0.0000 }
        },
        anexo_v: {
            faixa1: { irpj: 0.2500, csll: 0.1500, cofins: 0.1410, pis: 0.0305, inss: 0.2885, iss: 0.1400 },
            faixa2: { irpj: 0.2300, csll: 0.1500, cofins: 0.1410, pis: 0.0305, inss: 0.2785, iss: 0.1700 },
            faixa3: { irpj: 0.2400, csll: 0.1500, cofins: 0.1492, pis: 0.0323, inss: 0.2385, iss: 0.1900 },
            faixa4: { irpj: 0.2100, csll: 0.1500, cofins: 0.1574, pis: 0.0341, inss: 0.2385, iss: 0.2100 },
            faixa5: { irpj: 0.2300, csll: 0.1250, cofins: 0.1410, pis: 0.0305, inss: 0.2385, iss: 0.2350 },
            faixa6: { irpj: 0.3500, csll: 0.1550, cofins: 0.1644, pis: 0.0356, inss: 0.2950, iss: 0.0000 }
        }
    };

    const TABELAS_SIMPLES = {
        anexo_iii: [
            { max: 180000, rate: 0.06, deduction: 0, faixaIdx: 1 },
            { max: 360000, rate: 0.1120, deduction: 9360, faixaIdx: 2 },
            { max: 720000, rate: 0.1350, deduction: 17640, faixaIdx: 3 },
            { max: 1800000, rate: 0.1600, deduction: 35640, faixaIdx: 4 },
            { max: 3600000, rate: 0.2100, deduction: 125640, faixaIdx: 5 },
            { max: 4800000, rate: 0.3300, deduction: 648000, faixaIdx: 6 }
        ],
        anexo_iv: [
            { max: 180000, rate: 0.045, deduction: 0, faixaIdx: 1 },
            { max: 360000, rate: 0.090, deduction: 8100, faixaIdx: 2 },
            { max: 720000, rate: 0.102, deduction: 12420, faixaIdx: 3 },
            { max: 1800000, rate: 0.140, deduction: 39780, faixaIdx: 4 },
            { max: 3600000, rate: 0.220, deduction: 183780, faixaIdx: 5 },
            { max: 4800000, rate: 0.330, deduction: 828000, faixaIdx: 6 }
        ],
        anexo_v: [
            { max: 180000, rate: 0.1550, deduction: 0, faixaIdx: 1 },
            { max: 360000, rate: 0.1800, deduction: 4500, faixaIdx: 2 },
            { max: 720000, rate: 0.1950, deduction: 9900, faixaIdx: 3 },
            { max: 1800000, rate: 0.2050, deduction: 17100, faixaIdx: 4 },
            { max: 3600000, rate: 0.2300, deduction: 62100, faixaIdx: 5 },
            { max: 4800000, rate: 0.3050, deduction: 540000, faixaIdx: 6 }
        ]
    };

    function parseToNumber(val) {
        if (typeof val === 'number') return val;
        if (typeof val === 'bigint') return Number(val) / 100;
        if (!val) return 0;
        let str = String(val).trim().replace(/R\$\s?/, '').replace(/\s/g, '');
        if (str.includes(',') && str.includes('.')) {
            str = str.replace(/\./g, '').replace(',', '.');
        } else if (str.includes(',')) {
            str = str.replace(',', '.');
        } else if (str.includes('.')) {
            if (/^\d{1,3}(\.\d{3})+$/.test(str)) {
                str = str.replace(/\./g, '');
            }
        }
        const n = parseFloat(str);
        return isNaN(n) ? 0 : n;
    }

    function roundCents(num) {
        return Math.round(num * 100) / 100;
    }

    class TaxEngine {
        /**
         * Fator R (Folha 12m / RBT12)
         */
        static calcularFatorR(folha12Meses, rbt12) {
            const folha = parseToNumber(folha12Meses);
            const rbt = parseToNumber(rbt12);

            if (rbt <= 0) {
                return {
                    fatorR: 0,
                    fatorRPercent: "0.00%",
                    anexoRecomendado: "anexo_iii",
                    enquadraAnexoIII: true,
                    pendencia: "RBT12 não informada ou zerada"
                };
            }

            const fator = folha / rbt;
            const enquadraIII = fator >= 0.28;

            return {
                fatorR: fator,
                fatorRPercent: (fator * 100).toFixed(2) + "%",
                anexoRecomendado: enquadraIII ? "anexo_iii" : "anexo_v",
                enquadraAnexoIII: enquadraIII,
                pendencia: folha <= 0 ? "Folha 12m zerada ou insuficiente" : null
            };
        }

        /**
         * Apuração Simples Nacional com repartição oficial de tributos e segregação de ISS retido
         */
        static apurarSimplesNacional(rbt12, faturamentoMes, anexoKey = 'anexo_iii', options = {}) {
            const rbt = parseToNumber(rbt12);
            const fat = parseToNumber(faturamentoMes);
            const issRetidoTomador = Boolean(options.issRetidoTomador);
            const aliquotaRetencaoInformada = options.aliquotaRetencaoInformada !== undefined ? parseToNumber(options.aliquotaRetencaoInformada) : null;

            const tabela = TABELAS_SIMPLES[anexoKey] || TABELAS_SIMPLES.anexo_iii;
            let faixa = tabela[0];
            for (let i = 0; i < tabela.length; i++) {
                if (rbt <= tabela[i].max || i === tabela.length - 1) {
                    faixa = tabela[i];
                    break;
                }
            }

            let aliquotaEfetiva = 0;
            let pendencia = null;

            if (rbt > 0) {
                aliquotaEfetiva = ((rbt * faixa.rate) - faixa.deduction) / rbt;
            } else {
                aliquotaEfetiva = faixa.rate;
                pendencia = "RBT12 zerada ou insuficiente; aplicada 1ª faixa como estimativa.";
            }

            if (aliquotaEfetiva < 0) aliquotaEfetiva = 0;

            // Repartição de tributos do DAS
            const reparticaoFaixas = REPARTICAO_SIMPLES[anexoKey] || REPARTICAO_SIMPLES.anexo_iii;
            const repFaixa = reparticaoFaixas[`faixa${faixa.faixaIdx}`] || reparticaoFaixas.faixa1;

            // Alíquota do componente ISS dentro do DAS
            const aliquotaEfetivaIss = aliquotaEfetiva * repFaixa.iss;

            // Se o ISS foi retido pelo tomador, o componente de ISS é segregado e NÃO cobrado no DAS
            const aliquotaDasFinal = issRetidoTomador 
                ? Math.max(aliquotaEfetiva - aliquotaEfetivaIss, 0)
                : aliquotaEfetiva;

            const valorDas = roundCents(fat * aliquotaDasFinal);

            // Detalhamento dos componentes do DAS
            const componentes = {
                irpj: roundCents(fat * aliquotaEfetiva * repFaixa.irpj),
                csll: roundCents(fat * aliquotaEfetiva * repFaixa.csll),
                cofins: roundCents(fat * aliquotaEfetiva * repFaixa.cofins),
                pis: roundCents(fat * aliquotaEfetiva * repFaixa.pis),
                inss: roundCents(fat * aliquotaEfetiva * repFaixa.inss),
                iss: issRetidoTomador ? 0 : roundCents(fat * aliquotaEfetivaIss)
            };

            // Cálculo da retenção de ISS no documento
            let valorIssRetido = 0;
            let pendenciaRetencao = null;
            if (issRetidoTomador) {
                const aliqRetencao = aliquotaRetencaoInformada !== null ? (aliquotaRetencaoInformada / 100) : aliquotaEfetivaIss;
                valorIssRetido = roundCents(fat * aliqRetencao);

                if (aliquotaRetencaoInformada !== null && Math.abs(aliqRetencao - aliquotaEfetivaIss) > 0.0005) {
                    pendenciaRetencao = `Alíquota retida informada (${(aliqRetencao*100).toFixed(2)}%) diverge do percentual de ISS do DAS (${(aliquotaEfetivaIss*100).toFixed(2)}%).`;
                }
            }

            return {
                regime: 'simples_nacional',
                anexo: anexoKey,
                faixaIdx: faixa.faixaIdx,
                faixaNominal: (faixa.rate * 100).toFixed(2) + '%',
                parcelaDeduzir: faixa.deduction,
                aliquotaEfetivaBruta: (aliquotaEfetiva * 100).toFixed(4) + '%',
                aliquotaEfetivaDas: (aliquotaDasFinal * 100).toFixed(4) + '%',
                aliquotaEfetivaNumero: aliquotaDasFinal,
                valorDas: valorDas,
                componentes: componentes,
                issRetidoTomador: issRetidoTomador,
                valorIssRetido: valorIssRetido,
                pendencia: pendencia || pendenciaRetencao
            };
        }

        /**
         * Apuração Mensal Lucro Presumido (PIS, COFINS, ISS e Provisões)
         */
        static apurarLucroPresumidoMensal(faturamentoServico, faturamentoProduto, options = {}) {
            const fatS = parseToNumber(faturamentoServico);
            const fatP = parseToNumber(faturamentoProduto);
            const fatTotal = fatS + fatP;

            const aliquotaIssPercent = options.aliquotaIss !== undefined ? parseToNumber(options.aliquotaIss) : 5.0;
            const issRetido = Boolean(options.issRetido);
            const temIrrf = Boolean(options.temIrrf);
            const aliquotaIrrfPercent = options.aliquotaIrrf !== undefined ? parseToNumber(options.aliquotaIrrf) : 4.8;
            const temInss = Boolean(options.temInss);
            const aliquotaInssPercent = options.aliquotaInss !== undefined ? parseToNumber(options.aliquotaInss) : 11.0;

            // PIS e COFINS (Cumulativo - Lucro Presumido: PIS 0.65%, COFINS 3.00%)
            const pis = roundCents(fatTotal * 0.0065);
            const cofins = roundCents(fatTotal * 0.03);

            // ISS incide sobre Serviços
            const issCalculado = roundCents(fatS * (aliquotaIssPercent / 100));
            const issRetidoValor = issRetido ? issCalculado : 0;
            const issARecolher = issRetido ? 0 : issCalculado;

            // Retenções federais na fonte (IRRF e INSS previdenciário)
            const irrfValor = temIrrf ? roundCents(fatS * (aliquotaIrrfPercent / 100)) : 0;
            const inssValor = temInss ? roundCents(fatS * (aliquotaInssPercent / 100)) : 0;

            const totalRetencoes = issRetidoValor + irrfValor + inssValor;

            return {
                regime: 'lucro_presumido',
                faturamentoTotal: fatTotal,
                faturamentoServico: fatS,
                faturamentoProduto: fatP,
                impostosMensais: {
                    pis: { rate: '0.65%', value: pis },
                    cofins: { rate: '3.00%', value: cofins },
                    iss: { rate: aliquotaIssPercent.toFixed(2) + '%', value: issCalculado, retido: issRetido, aRecolher: issARecolher }
                },
                retencoes: {
                    irrf: { active: temIrrf, rate: aliquotaIrrfPercent.toFixed(2) + '%', value: irrfValor, compensavel: true },
                    inss: { active: temInss, rate: aliquotaInssPercent.toFixed(2) + '%', value: inssValor, tipo: 'previdenciario' },
                    iss: { active: issRetido, rate: aliquotaIssPercent.toFixed(2) + '%', value: issRetidoValor },
                    total: totalRetencoes
                }
            };
        }

        /**
         * Motor Trimestral Oficial de IRPJ e CSLL (Lucro Presumido)
         * Implementa: Lei 9.249/1995 com Majoração da Redução de Benefícios
         * Parâmetros do Trimestre Completo:
         * Limite Trimestral de Presunção (L): R$ 1.250.000,00
         * Limite do Adicional de IRPJ: R$ 60.000,00 (R$ 20.000,00 / mês)
         * Presunção Padrão: Serviço 32%, Produto 8% (IRPJ) e 12% (CSLL)
         * Presunção Majorada (acima de L): Serviço 35.2%, Produto 8.8% (IRPJ) e 13.2% (CSLL)
         */
        static apurarLucroPresumidoTrimestral(receitaServicoTrimestre, receitaProdutoTrimestre, options = {}) {
            const S = parseToNumber(receitaServicoTrimestre);
            const P = parseToNumber(receitaProdutoTrimestre);
            const R = S + P;

            const ano = options.ano || 2026;
            const trimestre = options.trimestre || 1; // 1, 2, 3 ou 4

            // Limite trimestral de referência
            const L = options.limiteTrimestral !== undefined ? parseToNumber(options.limiteTrimestral) : 1250000;
            const limiteAdicional = options.limiteAdicional !== undefined ? parseToNumber(options.limiteAdicional) : 60000;

            // Vigências da majoração:
            // IRPJ majora a partir de 2026 T1
            // CSLL majora a partir de 2026 T2 (no T1 de 2026, vigência CSLL usa regra normal 32% e 12%)
            const aplicaMajoracaoIRPJ = options.aplicaMajoracaoIRPJ !== undefined 
                ? Boolean(options.aplicaMajoracaoIRPJ)
                : (ano > 2026 || (ano === 2026 && trimestre >= 1));

            const aplicaMajoracaoCSLL = options.aplicaMajoracaoCSLL !== undefined
                ? Boolean(options.aplicaMajoracaoCSLL)
                : (ano > 2026 || (ano === 2026 && trimestre >= 2));

            // Excedente total trimestral
            const excedente = Math.max(R - L, 0);

            let excedente_servicos = 0;
            let excedente_produtos = 0;

            if (R > 0 && excedente > 0) {
                excedente_servicos = excedente * (S / R);
                excedente_produtos = excedente * (P / R);
            }

            const servicos_normais = S - excedente_servicos;
            const produtos_normais = P - excedente_produtos;

            // Coeficientes de presunção IRPJ
            const aliqPresServIRPJNorm = 0.32;
            const aliqPresServIRPJMaj = aplicaMajoracaoIRPJ ? 0.352 : 0.32;
            const aliqPresProdIRPJNorm = 0.08;
            const aliqPresProdIRPJMaj = aplicaMajoracaoIRPJ ? 0.088 : 0.08;

            const base_IRPJ = (servicos_normais * aliqPresServIRPJNorm) +
                              (excedente_servicos * aliqPresServIRPJMaj) +
                              (produtos_normais * aliqPresProdIRPJNorm) +
                              (excedente_produtos * aliqPresProdIRPJMaj);

            // Coeficientes de presunção CSLL
            const aliqPresServCSLLNorm = 0.32;
            const aliqPresServCSLLMaj = aplicaMajoracaoCSLL ? 0.352 : 0.32;
            const aliqPresProdCSLLNorm = 0.12;
            const aliqPresProdCSLLMaj = aplicaMajoracaoCSLL ? 0.132 : 0.12;

            const base_CSLL = (servicos_normais * aliqPresServCSLLNorm) +
                              (excedente_servicos * aliqPresServCSLLMaj) +
                              (produtos_normais * aliqPresProdCSLLNorm) +
                              (excedente_produtos * aliqPresProdCSLLMaj);

            // Cálculo dos tributos
            const IRPJ_regular = base_IRPJ * 0.15;
            const IRPJ_adicional = Math.max(base_IRPJ - limiteAdicional, 0) * 0.10;
            const IRPJ_devido = IRPJ_regular + IRPJ_adicional;
            const CSLL_devida = base_CSLL * 0.09;

            // Dedução legal de IRRF retido na fonte pelos tomadores no trimestre
            const irrfRetidoTrimestre = parseToNumber(options.irrfRetidoTrimestre || 0);
            const IRPJ_a_recolher = Math.max(roundCents(IRPJ_devido - irrfRetidoTrimestre), 0);
            const creditoIRRFExcedente = Math.max(roundCents(irrfRetidoTrimestre - IRPJ_devido), 0);

            // Alíquotas efetivas globais do trimestre
            const aliqEfetivaIRPJ = R > 0 ? (IRPJ_devido / R) : 0.048;
            const aliqEfetivaCSLL = R > 0 ? (CSLL_devida / R) : 0.0288;

            return {
                trimestre: `${ano}-T${trimestre}`,
                ano: ano,
                numTrimestre: trimestre,
                receitaTotalTrimestre: R,
                receitaServicoTrimestre: S,
                receitaProdutoTrimestre: P,
                limitePresuncao: L,
                excedenteTotal: excedente,
                excedenteServicos: excedente_servicos,
                excedenteProdutos: excedente_produtos,
                servicosNormais: servicos_normais,
                produtosNormais: produtos_normais,
                aplicaMajoracaoIRPJ: aplicaMajoracaoIRPJ,
                aplicaMajoracaoCSLL: aplicaMajoracaoCSLL,
                base_IRPJ: roundCents(base_IRPJ),
                base_CSLL: roundCents(base_CSLL),
                IRPJ_regular: roundCents(IRPJ_regular),
                IRPJ_adicional: roundCents(IRPJ_adicional),
                IRPJ_devido: roundCents(IRPJ_devido),
                irrfRetidoTrimestre: roundCents(irrfRetidoTrimestre),
                IRPJ_a_recolher: roundCents(IRPJ_a_recolher),
                creditoIRRFExcedente: roundCents(creditoIRRFExcedente),
                CSLL_devida: roundCents(CSLL_devida),
                aliqEfetivaIRPJ: aliqEfetivaIRPJ,
                aliqEfetivaCSLL: aliqEfetivaCSLL
            };
        }

        /**
         * Rateio Determinístico das Obrigações Trimestrais para os Lançamentos do Trimestre
         * Garante que a soma das notas feche em centavos com a obrigação empresarial.
         */
        static ratearObrigacaoTrimestralPorNotas(apuracaoTrimestral, listaNotas) {
            if (!listaNotas || listaNotas.length === 0) {
                return [];
            }

            const totalBaseIRPJ = apuracaoTrimestral.base_IRPJ;
            const totalBaseCSLL = apuracaoTrimestral.base_CSLL;

            // 1. Calcula a base individual de cada nota
            const notasComBase = listaNotas.map(nota => {
                const tipo = nota.item_type || 'service';
                const bruto = parseToNumber(nota.gross_amount);
                
                // Proporção de presunção média da atividade no trimestre
                let fatorPresIRPJ = 0.32;
                let fatorPresCSLL = 0.32;
                
                if (tipo === 'product') {
                    fatorPresIRPJ = apuracaoTrimestral.receitaProdutoTrimestre > 0 
                        ? (apuracaoTrimestral.servicosNormais === undefined ? 0.08 : (apuracaoTrimestral.base_IRPJ / apuracaoTrimestral.receitaTotalTrimestre)) 
                        : 0.08;
                    fatorPresCSLL = 0.12;
                } else {
                    fatorPresIRPJ = 0.32;
                    fatorPresCSLL = 0.32;
                }

                const baseNotaIRPJ = roundCents(bruto * fatorPresIRPJ);
                const baseNotaCSLL = roundCents(bruto * fatorPresCSLL);

                return {
                    id: nota.id,
                    gross_amount: bruto,
                    tipo: tipo,
                    baseNotaIRPJ,
                    baseNotaCSLL
                };
            });

            // Soma das bases calculadas nas notas
            const somaBasesNotasIRPJ = notasComBase.reduce((acc, n) => acc + n.baseNotaIRPJ, 0);

            // 2. Rateio
            let somaIRPJRateado = 0;
            let somaCSLLRateado = 0;

            const resultado = notasComBase.map((nota, idx) => {
                let irpjNota = 0;
                let csllNota = 0;

                if (somaBasesNotasIRPJ > 0 && totalBaseIRPJ > 0) {
                    const pesoIRPJ = nota.baseNotaIRPJ / somaBasesNotasIRPJ;
                    irpjNota = roundCents(apuracaoTrimestral.IRPJ_devido * pesoIRPJ);
                    csllNota = roundCents(apuracaoTrimestral.CSLL_devida * pesoIRPJ);
                }

                somaIRPJRateado += irpjNota;
                somaCSLLRateado += csllNota;

                return {
                    id: nota.id,
                    base_IRPJ_nota: nota.baseNotaIRPJ,
                    base_CSLL_nota: nota.baseNotaCSLL,
                    irpj_atribuido: irpjNota,
                    csll_atribuido: csllNota
                };
            });

            // Ajuste do resíduo de centavos na última nota para conciliação matemática perfeita
            if (resultado.length > 0) {
                const diffIRPJ = roundCents(apuracaoTrimestral.IRPJ_devido - somaIRPJRateado);
                const diffCSLL = roundCents(apuracaoTrimestral.CSLL_devida - somaCSLLRateado);

                resultado[resultado.length - 1].irpj_atribuido = roundCents(resultado[resultado.length - 1].irpj_atribuido + diffIRPJ);
                resultado[resultado.length - 1].csll_atribuido = roundCents(resultado[resultado.length - 1].csll_atribuido + diffCSLL);
            }

            return resultado;
        }

        /**
         * Simulação / Prévia de Impostos de uma Nota em Digitação
         */
        static calcularPreviaNota(params) {
            const regime = params.company_tax_regime || 'lucro_presumido';
            const valorBruto = parseToNumber(params.gross_amount);
            const tipoItem = params.item_type || 'service';
            const competencia = params.competence || '2026-10';

            // Parâmetros de Retenção
            const temIrrf = Boolean(params.temIrrf);
            const aliquotaIrrf = params.aliquotaIrrf !== undefined ? parseToNumber(params.aliquotaIrrf) : 4.8;
            const temInss = Boolean(params.temInss);
            const aliquotaInss = params.aliquotaInss !== undefined ? parseToNumber(params.aliquotaInss) : 11.0;
            const issRetido = Boolean(params.issRetido);
            const aliquotaIss = params.aliquotaIss !== undefined ? parseToNumber(params.aliquotaIss) : 5.0;

            const descontosComerciais = parseToNumber(params.discounts || 0);

            if (regime === 'simples_nacional') {
                const rbt12 = parseToNumber(params.rbt12 || 0);
                const anexo = params.anexo || 'anexo_iii';
                const simplesApurado = this.apurarSimplesNacional(rbt12, valorBruto, anexo, {
                    issRetidoTomador: issRetido,
                    aliquotaRetencaoInformada: aliquotaIss
                });

                const retencaoIrrf = temIrrf ? roundCents(valorBruto * (aliquotaIrrf / 100)) : 0;
                const retencaoInss = temInss ? roundCents(valorBruto * (aliquotaInss / 100)) : 0;
                const retencaoIss = simplesApurado.valorIssRetido;

                const retencoesTotal = retencaoIrrf + retencaoInss + retencaoIss;
                const liquidoAReceber = roundCents(valorBruto - descontosComerciais - retencoesTotal);
                const liquidoEconomico = roundCents(valorBruto - simplesApurado.valorDas);

                return {
                    regime: 'simples_nacional',
                    valorBruto,
                    descontosComerciais,
                    impostosEconomicos: {
                        tipo: 'DAS Estimado',
                        aliquotaEfetiva: simplesApurado.aliquotaEfetivaDas,
                        valorTotal: simplesApurado.valorDas,
                        componentes: simplesApurado.componentes
                    },
                    retencoes: {
                        irrf: { ativo: temIrrf, valor: retencaoIrrf, taxa: aliquotaIrrf },
                        inss: { ativo: temInss, valor: retencaoInss, taxa: aliquotaInss },
                        iss: { ativo: issRetido, valor: retencaoIss, taxa: aliquotaIss },
                        total: retencoesTotal
                    },
                    liquidoAReceber,
                    liquidoEconomico,
                    pendencia: simplesApurado.pendencia
                };
            } else {
                // Lucro Presumido
                const pis = roundCents(valorBruto * 0.0065);
                const cofins = roundCents(valorBruto * 0.03);
                const issCalculado = tipoItem === 'service' ? roundCents(valorBruto * (aliquotaIss / 100)) : 0;
                const issRetidoValor = (tipoItem === 'service' && issRetido) ? issCalculado : 0;
                const issEmpresa = issRetido ? 0 : issCalculado;

                // Retenções
                const retencaoIrrf = (tipoItem === 'service' && temIrrf) ? roundCents(valorBruto * (aliquotaIrrf / 100)) : 0;
                const retencaoInss = (tipoItem === 'service' && temInss) ? roundCents(valorBruto * (aliquotaInss / 100)) : 0;
                const totalRetencoes = retencaoIrrf + retencaoInss + issRetidoValor;

                // Provisão IRPJ / CSLL (trimestre em andamento)
                const basePresIRPJ = tipoItem === 'service' ? 0.32 : 0.08;
                const basePresCSLL = tipoItem === 'service' ? 0.32 : 0.12;

                const provisaoIRPJ = roundCents(valorBruto * basePresIRPJ * 0.15);
                const provisaoCSLL = roundCents(valorBruto * basePresCSLL * 0.09);

                // Compensação: IRRF compensável abaterá o IRPJ devido
                const irpjSaldoARecolher = Math.max(roundCents(provisaoIRPJ - retencaoIrrf), 0);
                const creditoIrrfExcedente = Math.max(roundCents(retencaoIrrf - provisaoIRPJ), 0);

                const totalImpostosEconomicos = pis + cofins + issCalculado + provisaoIRPJ + provisaoCSLL;
                const liquidoAReceber = roundCents(valorBruto - descontosComerciais - totalRetencoes);
                const liquidoEconomico = roundCents(valorBruto - totalImpostosEconomicos);

                return {
                    regime: 'lucro_presumido',
                    valorBruto,
                    tipoItem,
                    descontosComerciais,
                    impostosMensais: {
                        pis: { taxa: '0.65%', valor: pis },
                        cofins: { taxa: '3.00%', valor: cofins },
                        iss: { taxa: aliquotaIss.toFixed(2) + '%', valor: issCalculado, retido: issRetido, aRecolher: issEmpresa }
                    },
                    provisaoTrimestral: {
                        irpjProvisao: provisaoIRPJ,
                        irrfCompensavel: retencaoIrrf,
                        irpjSaldoARecolher: irpjSaldoARecolher,
                        creditoIrrfExcedente: creditoIrrfExcedente,
                        csllProvisao: provisaoCSLL,
                        nota: 'Provisão — trimestre em andamento (apurada definitivamente no encerramento trimestral)'
                    },
                    retencoes: {
                        irrf: { ativo: temIrrf, valor: retencaoIrrf, taxa: aliquotaIrrf, compensavel: true },
                        inss: { ativo: temInss, valor: retencaoInss, taxa: aliquotaInss, tipo: 'previdenciario' },
                        iss: { ativo: issRetido, valor: issRetidoValor, taxa: aliquotaIss },
                        total: totalRetencoes
                    },
                    liquidoAReceber,
                    liquidoEconomico
                };
            }
        }
    }

    return TaxEngine;
});
