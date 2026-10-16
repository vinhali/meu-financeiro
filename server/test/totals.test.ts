// Regras do total do mês (funções do cliente): cada real entra uma vez só. Rodar: npm test (em server/).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { billInTotal, calculateMonthly, controllableInTotal, coveredByCard, netAdvance } from '../../client/src/calc';

const cents = (v: number) => Math.round(v * 100) / 100;

test('gasto controlável no total: resto do limite, mais o que não está em fatura', () => {
  assert.equal(controllableInTotal(1800, undefined), 1800);
  assert.equal(controllableInTotal(1800, { state: 'future', actual: 0 }), 1800);
  assert.equal(cents(controllableInTotal(1800, { state: 'current', actual: 911.40 })), 888.60);
  assert.equal(controllableInTotal(1800, { state: 'current', actual: 2000 }), 0);
  assert.equal(controllableInTotal(1800, { state: 'past', actual: 2950.42 }), 0);
  // Cartão sem linha de fatura e débito em conta no mês não estão em fatura: somam à parte.
  assert.equal(controllableInTotal(1800, { state: 'current', actual: 390, offBill: 50, accountInMonth: 0 }), 1460);
  assert.equal(controllableInTotal(1800, { state: 'past', actual: 2950.42, offBill: 0, accountInMonth: 40 }), 40);
});

test('conta fixa no cartão só sai do total se existe a linha de fatura do cartão', () => {
  assert.equal(coveredByCard({ onCard: true, billRow: true, differs: false }), true);
  assert.equal(coveredByCard({ onCard: true, billRow: false, differs: false }), false);
  assert.equal(coveredByCard({ onCard: true, billRow: true, differs: true }), false);
  assert.equal(coveredByCard({ onCard: false, differs: false }), false);
  assert.equal(coveredByCard(null), false);
  // Sem prova pelo nome, nada sai do total: reconhecimento só pelo valor e marcação à mão.
  assert.equal(coveredByCard({ onCard: true, billRow: true, byAmount: true, differs: false }), false);
  assert.equal(coveredByCard({ onCard: true, billRow: true, manual: 'confirmed', differs: false }), false);
  assert.equal(coveredByCard({ onCard: true, billRow: true, manual: 'pending', differs: false }), false);
});

test('fatura fechada ou aberta entra pelo valor do banco; previsão futura, pelo digitado', () => {
  assert.equal(billInTotal(2000, { suggested: 2187.64, billState: 'open' }), 2187.64);
  assert.equal(billInTotal(500, { suggested: 0, billState: 'closed' }), 0);
  assert.equal(billInTotal(874.1, { suggested: 312.66, billState: 'projected' }), 874.1);
  assert.equal(billInTotal(700, { suggested: null, billState: null }), 700);
  assert.equal(billInTotal(700, undefined), 700);
});

test('conta paga com o adiantamento sai dos dois lados: o subtotal do mês não muda', () => {
  const items = [
    { section: 'entrada', name: 'Salário', values: [8750.30, 8750.30] },
    { section: 'entrada', name: 'Adiantamento dia 20', values: [0, 980.40] },
    { section: 'saida', name: 'Financiamento Estudantil', values: [341.27, 341.27] },
    { section: 'saida', name: 'Aluguel', values: [3480, 3480] },
  ];
  const net = netAdvance(items, (it) => it.name === 'Financiamento Estudantil');
  const sub = (list: typeof items) => calculateMonthly(list as never, ['OUT', 'NOV']).subtotal.map(cents);
  // NOV: adiantamento e conta saem juntos, subtotal igual. OUT: o adiantamento já estava em zero, a conta sai.
  assert.deepEqual(sub(net), [5270.3, sub(items)[1]]);
  assert.deepEqual(net[1].values.map(cents), [0, 639.13]);
  // Sem linha de adiantamento, nada muda.
  const without = items.filter((it) => !/Adiantamento/.test(it.name));
  assert.deepEqual(netAdvance(without, () => true), without);
});

test('total do mês: entradas menos saídas, e o acumulado é a soma corrida', () => {
  const m = calculateMonthly(
    [
      { section: 'entrada', name: 'Salário', values: [1000, 1000, 1000] },
      { section: 'saida', name: 'Aluguel', values: [1200, 900, 500] },
    ] as never,
    ['A', 'B', 'C'],
  );
  assert.deepEqual(m.subtotal, [-200, 100, 500]);
  assert.deepEqual(m.acumulado, [-200, -100, 400]);
  assert.deepEqual([m.deficitTotal, m.negativeMonths, m.rendaExtraNecessaria], [200, ['A', 'B'], 0]);
});
