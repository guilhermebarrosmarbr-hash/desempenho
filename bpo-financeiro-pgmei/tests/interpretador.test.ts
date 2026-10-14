import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizarSituacao, interpretarResumoDas } from '../src/utils/interpretador.js';
import { LinhaApuracao } from '../src/types.js';

test('normalizarSituacao - categoriza corretamente os status oficiais', () => {
  assert.equal(normalizarSituacao('Liquidado'), 'Liquidado');
  assert.equal(normalizarSituacao('DEVEDOR'), 'Devedor');
  assert.equal(normalizarSituacao('A Vencer'), 'A Vencer');
  assert.equal(normalizarSituacao('Dívida Ativa'), 'Dívida Ativa');
  assert.equal(normalizarSituacao('Nao Optante'), 'Não Optante');
  assert.equal(normalizarSituacao(''), 'Indeterminada');
});

test('interpretarResumoDas - gera resumo adequado sem débitos', () => {
  const linhas: LinhaApuracao[] = [
    { periodo: '01/2026', apurado: 'Sim', situacao: 'Liquidado', situacaoTextoOriginal: 'Liquidado', principal: '75,00', multa: '0', juros: '0', total: '75,00', dataVencimento: '20/02/2026' },
    { periodo: '02/2026', apurado: 'Sim', situacao: 'A Vencer', situacaoTextoOriginal: 'A Vencer', principal: '75,00', multa: '0', juros: '0', total: '75,00', dataVencimento: '20/03/2026' }
  ];

  const resumo = interpretarResumoDas(linhas, 2026);
  assert.match(resumo, /Sem períodos vencidos em aberto no ano 2026/);
});

test('interpretarResumoDas - alerta sobre períodos devedores', () => {
  const linhas: LinhaApuracao[] = [
    { periodo: '01/2026', apurado: 'Sim', situacao: 'Devedor', situacaoTextoOriginal: 'Devedor', principal: '75,00', multa: '5,00', juros: '2,00', total: '82,00', dataVencimento: '20/02/2026' }
  ];

  const resumo = interpretarResumoDas(linhas, 2026);
  assert.match(resumo, /período\(s\) DEVEDOR\(ES\) em aberto/);
});
