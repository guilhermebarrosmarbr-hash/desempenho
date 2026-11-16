const test = require('node:test');
const assert = require('node:assert/strict');
const TaxEngine = require('../financeiro/js/taxes.js');

test('F09: Normalização canônica de item_type (servico vs service)', () => {
    const prev1 = TaxEngine.calcularPreviaNota({
        gross_amount: 10000,
        company_tax_regime: 'lucro_presumido',
        item_type: 'servico',
        temIrrf: true,
        aliquotaIrrf: 4.8
    });

    const prev2 = TaxEngine.calcularPreviaNota({
        gross_amount: 10000,
        company_tax_regime: 'lucro_presumido',
        item_type: 'service',
        temIrrf: true,
        aliquotaIrrf: 4.8
    });

    assert.equal(prev1.retencoes.irrf.valor, 480);
    assert.equal(prev2.retencoes.irrf.valor, 480);
    assert.equal(prev1.liquidoEconomico, prev2.liquidoEconomico);
});

test('F10: calcularPreviaNota alinhada com apurarLucroPresumidoTrimestral', () => {
    const previa = TaxEngine.calcularPreviaNota({
        gross_amount: 10000,
        company_tax_regime: 'lucro_presumido',
        item_type: 'service'
    });

    const apuracao = TaxEngine.apurarLucroPresumidoTrimestral(10000, 0, { isMensal: true });

    assert.equal(previa.provisaoTrimestral.irpjProvisao, apuracao.IRPJ_devido);
    assert.equal(previa.provisaoTrimestral.csllProvisao, apuracao.CSLL_devida);
    assert.equal(previa.provisaoTrimestral.irpjProvisao, 480);
    assert.equal(previa.provisaoTrimestral.csllProvisao, 288);
});

test('F18: Simples Nacional com Isenção de ISS retorna propriedades oficiais', () => {
    const res = TaxEngine.apurarSimplesNacional(180000, 10000, 'anexo_iii', {
        issIsento: true
    });

    assert.equal(res.faixaIdx, 1);
    assert.equal(res.faixaNominal, '6.00%');
    assert.equal(res.parcelaDeduzir, 0);
    assert.equal(typeof res.aliquotaEfetivaDas, 'string');
    assert.equal(res.componentes.iss, 0);
    assert.ok(res.valorDas > 0);
});

test('F19: Rateio de CSLL proporcional à base de CSLL e não ao peso do IRPJ', () => {
    const notas = [
        { id: 'n1', gross_amount: 10000, item_type: 'service' },
        { id: 'n2', gross_amount: 10000, item_type: 'product' }
    ];

    const apuracao = TaxEngine.apurarLucroPresumidoTrimestral(10000, 10000, {
        ano: 2026,
        trimestre: 4
    });

    const rateios = TaxEngine.ratearObrigacaoTrimestralPorNotas(apuracao, notas);
    assert.equal(rateios.length, 2);

    // Servico base CSLL = 32% (3.200), Produto base CSLL = 12% (1.200)
    // Proporcao CSLL de Servico deve ser 3200 / (3200 + 1200) = 32/44 = 72.72%
    const n1 = rateios.find(r => r.id === 'n1');
    const n2 = rateios.find(r => r.id === 'n2');

    const totalCsll = Math.round(n1.csll_atribuido + n2.csll_atribuido);
    assert.equal(totalCsll, Math.round(apuracao.CSLL_devida));
    assert.ok(n1.csll_atribuido > n2.csll_atribuido);
});
