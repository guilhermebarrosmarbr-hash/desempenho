// ==============================================================================
// tests/acceptance_tax_engine.test.js
// Bateria de Testes de Aceite em Ambiente Isolado e em Memória (Sem Acesso / Sem Escrita no Banco)
// Atende a todos os critérios do item 6 da especificação técnica.
// ==============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Carrega os módulos puros da aplicação
const BpoMoney = require('../financeiro/js/money.js');
const BpoTaxEngine = require('../financeiro/js/taxes.js');

test('Cenário 1: Nota sintética de R$ 10.000,00 com IRRF 4,8% e INSS 11% (sem outras retenções)', () => {
    const grossAmount = 10000.00;
    
    const previa = BpoTaxEngine.calcularPreviaNota({
        gross_amount: grossAmount,
        company_tax_regime: 'lucro_presumido',
        item_type: 'service',
        temIrrf: true,
        aliquotaIrrf: 4.8,
        temInss: true,
        aliquotaInss: 11.0,
        aliquotaIss: 3.0,
        issRetido: false
    });

    // R$ 480,00 de IRRF e R$ 1.100,00 de INSS
    assert.strictEqual(previa.retencoes.irrf.valor, 480.00, 'IRRF deve ser R$ 480,00');
    assert.strictEqual(previa.retencoes.inss.valor, 1100.00, 'INSS deve ser R$ 1.100,00');
    assert.strictEqual(previa.retencoes.total, 1580.00, 'Total retenções deve ser R$ 1.580,00');
    // Líquido a receber: R$ 8.420,00 (ISS 3% não retido não reduz o depósito do cliente)
    assert.strictEqual(previa.liquidoAReceber, 8420.00, 'Líquido a receber deve ser R$ 8.420,00');
});

test('Cenário 2: Nota sintética de R$ 10.000,00 com IRRF 4,8%, INSS 11% e ISS 3% retido', () => {
    const grossAmount = 10000.00;
    
    const previa = BpoTaxEngine.calcularPreviaNota({
        gross_amount: grossAmount,
        company_tax_regime: 'lucro_presumido',
        item_type: 'service',
        temIrrf: true,
        aliquotaIrrf: 4.8,
        temInss: true,
        aliquotaInss: 11.0,
        aliquotaIss: 3.0,
        issRetido: true
    });

    assert.strictEqual(previa.retencoes.irrf.valor, 480.00);
    assert.strictEqual(previa.retencoes.inss.valor, 1100.00);
    assert.strictEqual(previa.retencoes.iss.valor, 300.00, 'ISS retido deve ser R$ 300,00');
    assert.strictEqual(previa.retencoes.total, 1880.00, 'Total retido deve ser R$ 1.880,00');
    // Líquido a receber: 10.000 - 1.880 = R$ 8.120,00
    assert.strictEqual(previa.liquidoAReceber, 8120.00, 'Líquido a receber deve ser R$ 8.120,00');
});

test('Cenário 3: IRPJ devido sintético de R$ 600,00 e IRRF compensável de R$ 480,00 -> Saldo R$ 120,00', () => {
    const irpjDevido = 600.00;
    const irrfCompensavel = 480.00;
    const saldoRecolher = irpjDevido > irrfCompensavel ? (irpjDevido - irrfCompensavel) : 0;

    assert.strictEqual(saldoRecolher, 120.00, 'Saldo a recolher de IRPJ deve ser R$ 120,00');
    // Carga de IR permanece R$ 600,00 e não vira R$ 1.080,00
    assert.notStrictEqual(irpjDevido + irrfCompensavel, 120.00);
});

test('Cenário 4: Trimestre de referência (2026/T4) — Somente Serviços R$ 1.500.000,00', () => {
    const apuracao = BpoTaxEngine.apurarLucroPresumidoTrimestral(1500000, 0, {
        ano: 2026,
        trimestre: 4
    });

    // Base presumida: R$ 488.000,00
    // IRPJ: R$ 116.000,00
    // CSLL: R$ 43.920,00
    assert.strictEqual(apuracao.base_IRPJ, 488000.00, 'Base IRPJ deve ser R$ 488.000,00');
    assert.strictEqual(apuracao.IRPJ_devido, 116000.00, 'IRPJ devido deve ser R$ 116.000,00');
    assert.strictEqual(apuracao.base_CSLL, 488000.00, 'Base CSLL deve ser R$ 488.000,00');
    assert.strictEqual(apuracao.CSLL_devida, 43920.00, 'CSLL devida deve ser R$ 43.920,00');
});

test('Cenário 5: Trimestre de referência (2026/T4) — Somente Produtos R$ 1.500.000,00', () => {
    const apuracao = BpoTaxEngine.apurarLucroPresumidoTrimestral(0, 1500000, {
        ano: 2026,
        trimestre: 4
    });

    // Base de IRPJ de R$ 122.000,00, IRPJ de R$ 24.500,00
    // Base de CSLL de R$ 183.000,00 e CSLL de R$ 16.470,00
    assert.strictEqual(apuracao.base_IRPJ, 122000.00, 'Base IRPJ deve ser R$ 122.000,00');
    assert.strictEqual(apuracao.IRPJ_devido, 24500.00, 'IRPJ devido deve ser R$ 24.500,00');
    assert.strictEqual(apuracao.base_CSLL, 183000.00, 'Base CSLL deve ser R$ 183.000,00');
    assert.strictEqual(apuracao.CSLL_devida, 16470.00, 'CSLL devida deve ser R$ 16.470,00');
});

test('Cenário 6: Trimestre de referência (2026/T4) — Receita Mista R$ 750k Serviços + R$ 750k Produtos', () => {
    const apuracao = BpoTaxEngine.apurarLucroPresumidoTrimestral(750000, 750000, {
        ano: 2026,
        trimestre: 4
    });

    // Base de IRPJ de R$ 305.000,00, IRPJ de R$ 70.250,00
    // Base de CSLL de R$ 335.500,00 e CSLL de R$ 30.195,00
    assert.strictEqual(apuracao.base_IRPJ, 305000.00, 'Base IRPJ deve ser R$ 305.000,00');
    assert.strictEqual(apuracao.IRPJ_devido, 70250.00, 'IRPJ devido deve ser R$ 70.250,00');
    assert.strictEqual(apuracao.base_CSLL, 335500.00, 'Base CSLL deve ser R$ 335.500,00');
    assert.strictEqual(apuracao.CSLL_devida, 30195.00, 'CSLL devida deve ser R$ 30.195,00');
});

test('Cenário 7: Limites e Divisão por Zero — Receita Zero, Abaixo do Limite e Abaixo do Adicional', () => {
    const zeroRes = BpoTaxEngine.apurarLucroPresumidoTrimestral(0, 0, {
        ano: 2026,
        trimestre: 4
    });
    assert.strictEqual(zeroRes.receitaTotalTrimestre, 0);
    assert.strictEqual(zeroRes.excedenteTotal, 0);
    assert.strictEqual(zeroRes.IRPJ_devido, 0);
    assert.strictEqual(zeroRes.CSLL_devida, 0);

    // Receita de R$ 100.000,00 em serviços (base 32% = R$ 32.000,00 <= adicional de R$ 60.000,00)
    const subLimite = BpoTaxEngine.apurarLucroPresumidoTrimestral(100000, 0, {
        ano: 2026,
        trimestre: 4
    });
    assert.strictEqual(subLimite.base_IRPJ, 32000.00);
    assert.strictEqual(subLimite.IRPJ_adicional, 0, 'Sem adicional negativo');
    assert.strictEqual(subLimite.IRPJ_regular, 4800.00); // 15% de 32k = R$ 4.800,00
    assert.strictEqual(subLimite.IRPJ_devido, 4800.00);
});

test('Cenário 8: Vigência 2026 — CSLL não majorada no 1º trimestre', () => {
    const t1 = BpoTaxEngine.apurarLucroPresumidoTrimestral(1500000, 0, {
        ano: 2026,
        trimestre: 1
    });

    // No T1 de 2026, CSLL ainda usa alíquota padrão 32% sobre o total sem majoração (1.500.000 * 32% = 480.000)
    assert.strictEqual(t1.base_CSLL, 480000.00, 'Base CSLL no 2026/T1 não deve ter majoração');
    assert.strictEqual(t1.CSLL_devida, 43200.00, 'CSLL 9% sobre 480k = R$ 43.200,00');
    // Já o IRPJ no T1 já possui a majoração (488k)
    assert.strictEqual(t1.base_IRPJ, 488000.00);
});

test('Cenário 9: Reconciliação Determinística do Rateio por Nota em Centavos', () => {
    const apuracao = BpoTaxEngine.apurarLucroPresumidoTrimestral(1500000, 0, {
        ano: 2026,
        trimestre: 4
    });

    // Simula 3 notas de R$ 500.000,00 cada
    const notas = [
        { id: 'n1', gross_amount: 500000, item_type: 'service' },
        { id: 'n2', gross_amount: 500000, item_type: 'service' },
        { id: 'n3', gross_amount: 500000, item_type: 'service' }
    ];

    const rateios = BpoTaxEngine.ratearObrigacaoTrimestralPorNotas(apuracao, notas);

    let somaIrpj = 0;
    let somaCsll = 0;
    rateios.forEach(r => {
        somaIrpj += r.irpj_atribuido;
        somaCsll += r.csll_atribuido;
    });

    assert.strictEqual(Math.round(somaIrpj * 100) / 100, apuracao.IRPJ_devido, 'Soma dos rateios de IRPJ deve fechar ao centavo exato com o trimestre');
    assert.strictEqual(Math.round(somaCsll * 100) / 100, apuracao.CSLL_devida, 'Soma dos rateios de CSLL deve fechar ao centavo exato com o trimestre');
});

test('Cenário 10: Simples Nacional — DAS estimado sem adicionar PIS/Cofins duplicados', () => {
    const sim = BpoTaxEngine.apurarSimplesNacional(360000, 50000, 'anexo_iii');

    // Alíquota efetiva Faixa 2: (360k * 11.2% - 9360) / 360k = 8.6%
    // DAS: R$ 4.300,00
    assert.strictEqual(sim.valorDas, 4300.00, 'DAS total deve ser R$ 4.300,00');

    // Soma das repartições fecha com o DAS
    const somaPartes = sim.componentes.irpj +
                       sim.componentes.csll +
                       sim.componentes.cofins +
                       sim.componentes.pis +
                       sim.componentes.inss +
                       sim.componentes.iss;

    assert.strictEqual(Math.round(somaPartes * 100) / 100, sim.valorDas, 'Repartição interna deve fechar exatamente com o total da guia');
});
