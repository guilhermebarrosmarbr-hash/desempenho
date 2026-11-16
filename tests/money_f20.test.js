// ==============================================================================
// tests/money_f20.test.js — Testes de Conversão e Precisão Monetária (F20)
// ==============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const MoneyUtil = require('../financeiro/js/money.js');

test('F20: Número decimal não vira milhar brasileiro', () => {
    // 1.005 numérico é 1 real e 0.5 centavos -> arredonda para 101 ou 100 centavos, JAMAIS 100500 centavos!
    const cents = MoneyUtil.toCents(1.005);
    assert.equal(cents === 100n || cents === 101n, true, `Esperado 100n ou 101n, obtido ${cents}`);
    assert.notEqual(cents, 100500n, '1.005 nunca pode virar 100500 centavos');
});

test('F20: Decimal de API string e moeda brasileira com vírgula representam o mesmo valor', () => {
    const fromApi = MoneyUtil.toCents('1250.50');
    const fromBr = MoneyUtil.toCents('R$ 1.250,50');
    const fromBrNoDot = MoneyUtil.toCents('1250,50');

    assert.equal(fromApi, 125050n);
    assert.equal(fromBr, 125050n);
    assert.equal(fromBrNoDot, 125050n);
    assert.equal(fromApi, fromBr);
});

test('F20: Valores negativos em string e parênteses', () => {
    assert.equal(MoneyUtil.toCents('-1250.50'), -125050n);
    assert.equal(MoneyUtil.toCents('-1.250,50'), -125050n);
    assert.equal(MoneyUtil.toCents('(1.250,50)'), -125050n);
    assert.equal(MoneyUtil.toCents('- R$ 1.250,50'), -125050n);
});

test('F20: Entradas nulas, vazias e inválidas', () => {
    assert.equal(MoneyUtil.toCents(null), 0n);
    assert.equal(MoneyUtil.toCents(undefined), 0n);
    assert.equal(MoneyUtil.toCents(''), 0n);
    assert.equal(MoneyUtil.toCents('abc'), 0n);
    assert.equal(MoneyUtil.toCents(NaN), 0n);
});

test('F20: Precisão de percentuais pequenos (ex: 0,225% sobre R$ 100.000,00)', () => {
    // R$ 100.000,00 = 10.000.000 centavos
    const baseCents = 10000000n;
    // 0.225% de 100.000 = 225,00 = 22500 centavos
    const comissaoCents = MoneyUtil.applyPercentage(baseCents, 0.225);
    assert.equal(comissaoCents, 22500n);
    assert.equal(MoneyUtil.formatBRL(comissaoCents), 'R$ 225,00');

    // 0.135% de 100.000 = 135,00 = 13500 centavos
    assert.equal(MoneyUtil.applyPercentage(baseCents, 0.135), 13500n);

    // 0.09% de 100.000 = 90,00 = 9000 centavos
    assert.equal(MoneyUtil.applyPercentage(baseCents, 0.09), 9000n);
});

test('F20: toDecimalString e formatBRL', () => {
    assert.equal(MoneyUtil.toDecimalString(125050n), '1250.50');
    assert.equal(MoneyUtil.toDecimalString(-125050n), '-1250.50');
    assert.equal(MoneyUtil.formatBRL(125050n), 'R$ 1.250,50');
    assert.equal(MoneyUtil.formatBRL(-125050n), '- R$ 1.250,50');
});
