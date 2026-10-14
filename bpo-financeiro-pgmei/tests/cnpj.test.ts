import test from 'node:test';
import assert from 'node:assert/strict';
import { processarListaCnpj, validarCnpj, formatarCnpj } from '../src/utils/cnpj.js';

test('validarCnpj - deve validar CNPJs corretos e rejeitar inválidos', () => {
  // CNPJs válidos conhecidos de teste / exemplo
  // 11.222.333/0001-81 -> 11222333000181
  // 00.000.000/0001-91 (Banco do Brasil)
  assert.equal(validarCnpj('00000000000191'), true);
  assert.equal(validarCnpj('00.000.000/0001-91'), true);

  // CNPJ inválido
  assert.equal(validarCnpj('11111111111111'), false);
  assert.equal(validarCnpj('00000000000190'), false);
  assert.equal(validarCnpj('123'), false);
});

test('processarListaCnpj - deve separar por linhas, vírgulas, remover duplicados e preservar zeros', () => {
  const input = `
    00.000.000/0001-91
    00000000000191
    000000000001-91, 00.000.000/0001-91; 123456
    99999999999999
  `;

  const { validos, invalidos } = processarListaCnpj(input);
  assert.equal(validos.length, 1);
  assert.equal(validos[0], '00000000000191');
  assert.ok(invalidos.length >= 1);
});

test('formatarCnpj - formata corretamente com pontuação oficial', () => {
  assert.equal(formatarCnpj('00000000000191'), '00.000.000/0001-91');
});
