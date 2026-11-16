const test = require('node:test');
const assert = require('node:assert/strict');
const MoneyUtil = require('../financeiro/js/money.js');

global.window = {
    BpoMoney: MoneyUtil
};

const fs = require('fs');
eval(fs.readFileSync('./financeiro/js/rentals.js', 'utf8'));

test('F16: Rateio com participação incompleta não transfere valor ao 1º participante', () => {
    // 2 participantes com 30% cada sobre R$ 1.000,00
    // Cada um deve receber exatamente 30% (R$ 300,00). Os 40% não devem ir para o primeiro participante!
    const calculo = global.window.BpoRentalEngine.calcularDistribuicao({
        grossReceived: 100000n, // R$ 1.000,00
        deductions: 0n,
        adminRate: 0,
        participants: [
            { id: 'p1', name: 'Sócio A', participation_pct: 30.0 },
            { id: 'p2', name: 'Sócio B', participation_pct: 30.0 }
        ]
    });

    assert.equal(calculo.distribuicoes.length, 2);
    assert.equal(calculo.distribuicoes[0].amountCents, 30000n, 'Sócio A deve receber R$ 300,00 e não R$ 700,00');
    assert.equal(calculo.distribuicoes[1].amountCents, 30000n, 'Sócio B deve receber R$ 300,00');
});

test('F16: Rateio 50%/50% sobre R$ 1.000,00 distribui 500/500 com ajuste fino de centavo', () => {
    const calculo = global.window.BpoRentalEngine.calcularDistribuicao({
        grossReceived: 100000n,
        deductions: 0n,
        adminRate: 0,
        participants: [
            { id: 'p1', name: 'Sócio A', participation_pct: 50.0 },
            { id: 'p2', name: 'Sócio B', participation_pct: 50.0 }
        ]
    });

    assert.equal(calculo.distribuicoes[0].amountCents, 50000n);
    assert.equal(calculo.distribuicoes[1].amountCents, 50000n);
});
