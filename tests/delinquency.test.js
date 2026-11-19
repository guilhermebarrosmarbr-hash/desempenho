// ==============================================================================
// tests/delinquency.test.js — Testes unitários do motor do Módulo de Inadimplência
// ==============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');

// Importa classes utilitárias
const { BpoMoney } = require('../financeiro/js/money.js');
global.window = { BpoMoney };
require('../financeiro/js/utils.js');

// Simulação das regras lógicas do motor de Inadimplência
function parseIsoDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.slice(0, 10).split('-');
    if (parts.length !== 3) return null;
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function calcularDiasAtraso(dueDateStr, refDate = new Date()) {
    const due = parseIsoDate(dueDateStr);
    if (!due) return 0;
    const today = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
    const diffMs = today.getTime() - due.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return diffDays;
}

function isInadimplente(doc, refDate = new Date()) {
    if (doc.status === 'paid' || doc.status === 'cancelled') return false;
    if (!doc.due_date) return false;
    const dias = calcularDiasAtraso(doc.due_date, refDate);
    return dias > 0;
}

test('Inadimplência: vencimento anterior a hoje é considerado inadimplente', () => {
    const ref = new Date(2026, 10, 19); // 19/11/2026
    const docOntem = { due_date: '2026-11-18', status: 'emitted' };
    assert.equal(isInadimplente(docOntem, ref), true);
    assert.equal(calcularDiasAtraso(docOntem.due_date, ref), 1);
});

test('Inadimplência: vencimento hoje NÃO é atrasado (dias de atraso = 0)', () => {
    const ref = new Date(2026, 10, 19); // 19/11/2026
    const docHoje = { due_date: '2026-11-19', status: 'emitted' };
    assert.equal(isInadimplente(docHoje, ref), false);
    assert.equal(calcularDiasAtraso(docHoje.due_date, ref), 0);
});

test('Inadimplência: vencimento futuro NÃO é atrasado', () => {
    const ref = new Date(2026, 10, 19);
    const docAmanha = { due_date: '2026-11-20', status: 'emitted' };
    assert.equal(isInadimplente(docAmanha, ref), false);
    assert.ok(calcularDiasAtraso(docAmanha.due_date, ref) < 0);
});

test('Inadimplência: status paid ou cancelled nunca aparece como inadimplente', () => {
    const ref = new Date(2026, 10, 19);
    const docPago = { due_date: '2026-10-10', status: 'paid' };
    const docCancelado = { due_date: '2026-10-10', status: 'cancelled' };
    assert.equal(isInadimplente(docPago, ref), false);
    assert.equal(isInadimplente(docCancelado, ref), false);
});

test('Inadimplência: ordenação crescente de vencimento (pendências mais antigas primeiro)', () => {
    const docs = [
        { id: '1', due_date: '2026-11-10' },
        { id: '2', due_date: '2026-09-01' },
        { id: '3', due_date: '2026-10-15' },
        { id: '4', due_date: '2026-09-01' } // empate
    ];

    docs.sort((a, b) => {
        const cmp = a.due_date.localeCompare(b.due_date);
        if (cmp !== 0) return cmp;
        return a.id.localeCompare(b.id);
    });

    assert.equal(docs[0].id, '2');
    assert.equal(docs[1].id, '4');
    assert.equal(docs[2].id, '3');
    assert.equal(docs[3].id, '1');
});

test('Inadimplência: totalização de valores em centavos BigInt', () => {
    const pendencias = [
        { grossCents: 100050n, liquidCents: 90000n },
        { grossCents: 200025n, liquidCents: null },
        { grossCents: 50000n,  liquidCents: 45000n }
    ];

    let totalBruto = 0n;
    let totalLiquido = 0n;
    let liquidoIncompleto = false;

    for (const p of pendencias) {
        totalBruto += p.grossCents;
        if (p.liquidCents !== null && p.liquidCents !== undefined) {
            totalLiquido += p.liquidCents;
        } else {
            liquidoIncompleto = true;
        }
    }

    assert.equal(totalBruto, 350075n);
    assert.equal(totalLiquido, 135000n);
    assert.equal(liquidoIncompleto, true);
});
