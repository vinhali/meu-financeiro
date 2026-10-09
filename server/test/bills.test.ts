// Fatura fechada/aberta reconstruída dos lançamentos. Os quatro cenários reproduzem os
// padrões reais de cada banco. Rodar: npm test (em server/).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { billPaymentsCents, BillRow, BillTransactionRow, computeBills } from '../src/openfinance/bills';

const NOW = new Date('2026-10-04T15:00:00.000Z');
const d = (s: string) => new Date(`${s}T12:00:00.000Z`);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

const bill = (over: Partial<BillRow>): BillRow => ({
  id: 'last',
  dueDate: day('2026-09-05'),
  closingDate: day('2026-08-26'),
  totalAmountCents: 100000n,
  paymentsCents: 100000,
  ...over,
});

// Compara a fatura sem a parte parcelada, que tem teste próprio.
const core = (b: { installments: number } | null) => {
  if (!b) return b;
  const { installments: _ignored, ...rest } = b;
  return rest;
};

const tx = (date: string, cents: number, over: Partial<BillTransactionRow> = {}): BillTransactionRow => ({
  date: d(date),
  type: cents < 0 ? 'CREDIT' : 'DEBIT',
  cents,
  billId: null,
  billForecast: null,
  isPayment: false,
  ...over,
});

test('sem faturas listadas não há o que calcular', () => {
  assert.deepEqual(computeBills([], [tx('2026-10-01', 1000)], NOW), { closed: null, open: null, upcoming: [], past: [] });
});

test('rótulo = mês do fechamento; fatura listada com um ciclo de atraso; resíduos antigos ignorados', () => {
  // Última fatura listada venceu em 05/09 e foi paga. O ciclo seguinte fechou zerado; o atual está aberto.
  const r = computeBills(
    [bill({ totalAmountCents: 72547n, paymentsCents: 72547 })],
    [
      tx('2026-08-10', 5000, { billId: 'last', billForecast: '2026-08' }),
      tx('2025-10-06', 45811, { billForecast: '2025-10' }), // pendente esquecido de um ano atrás
      tx('2026-09-08', -72547, { billForecast: '2026-09', isPayment: true }),
      tx('2026-09-23', 50000, { billForecast: '2026-10' }),
      tx('2026-10-01', 36558, { billForecast: '2026-10' }),
    ],
    NOW,
  );
  assert.equal(r.closed, null);
  assert.deepEqual(core(r.open), { amount: 865.58, projectedInstallments: 0, dueDate: '2026-11-05', closingDate: '2026-10-26', estimated: true });
});

test('ciclo fechado ainda não listado vira fatura fechada; estorno abate, pagamento da fatura anterior não', () => {
  const r = computeBills(
    [bill({ closingDate: day('2026-08-29'), totalAmountCents: 101795n, paymentsCents: 105329 })],
    [
      tx('2026-08-20', 5000, { billId: 'last', billForecast: '2026-08' }),
      tx('2026-09-04', -101795, { billForecast: '2026-09', isPayment: true }),
      tx('2026-09-04', -3534, { billForecast: '2026-09', isPayment: true }),
      tx('2026-09-10', 75129, { billForecast: '2026-09' }),
      tx('2026-09-23', -9800, { billForecast: '2026-09' }), // estorno
      tx('2026-09-30', 17283, { billForecast: '2026-10' }),
    ],
    NOW,
  );
  // 751,29 - 98,00 de estorno - 35,34 pagos a mais na fatura anterior.
  assert.deepEqual(core(r.closed), { amount: 617.95, projectedInstallments: 0, dueDate: '2026-10-05', closingDate: '2026-09-29', estimated: true });
  assert.deepEqual(core(r.open), { amount: 172.83, projectedInstallments: 0, dueDate: '2026-11-05', closingDate: '2026-10-29', estimated: true });
});

test('rótulo = mês do vencimento; última fatura listada ainda não venceu e segue como fechada', () => {
  const r = computeBills(
    [bill({ dueDate: day('2026-10-06'), closingDate: day('2026-09-29'), totalAmountCents: 691420n, paymentsCents: 0 })],
    [
      tx('2026-09-10', 5000, { billId: 'last', billForecast: '2026-10' }),
      tx('2026-09-30', 200000, { billForecast: '2026-11' }),
      tx('2026-10-31', 23271, { billForecast: '2026-11' }), // parcela futura já prevista nesta fatura
      tx('2026-11-23', 32202, { billForecast: '2026-12' }), // fatura seguinte: fora
    ],
    NOW,
  );
  assert.deepEqual(core(r.closed), { amount: 6914.2, projectedInstallments: 0, dueDate: '2026-10-06', closingDate: '2026-09-29', estimated: false });
  assert.deepEqual(core(r.open), { amount: 2232.71, projectedInstallments: 0, dueDate: '2026-11-06', closingDate: '2026-10-29', estimated: true });
});

test('parcelas com rótulo do mês da compra original entram no primeiro ciclo após o fechamento', () => {
  const r = computeBills(
    [bill({ closingDate: day('2026-08-27'), totalAmountCents: 100000n, paymentsCents: 100000 })],
    [
      tx('2026-07-30', 5000, { billId: 'last', billForecast: '2026-08' }),
      tx('2026-07-31', 5000, { billId: 'last', billForecast: '2026-08' }),
      tx('2026-07-31', 5000, { billId: 'last', billForecast: '2025-12' }),
      tx('2026-08-28', 36807, { billForecast: '2025-12' }),
      tx('2026-08-28', 83610, { billForecast: '2026-04' }),
      tx('2026-09-04', -100000, { billForecast: '2026-09', isPayment: true }),
      tx('2026-09-04', -500, { billForecast: '2026-09', isPayment: true }),
    ],
    NOW,
  );
  // 1.204,17 em parcelas menos R$ 5,00 pagos além da fatura anterior.
  assert.deepEqual(core(r.closed), { amount: 1199.17, projectedInstallments: 0, dueDate: '2026-10-05', closingDate: '2026-09-27', estimated: true });
  assert.deepEqual(core(r.open), { amount: 0, projectedInstallments: 0, dueDate: '2026-11-05', closingDate: '2026-10-27', estimated: true });
});

test('fatura listada já vencida e sem pagamento registrado não é mostrada como a pagar', () => {
  const r = computeBills([bill({ paymentsCents: 0 })], [], NOW);
  assert.equal(r.closed, null);
  assert.equal(r.open?.amount, 0);
});

test('parcela ainda não lançada pelo banco é projetada na fatura aberta, uma por ciclo', () => {
  const plan = { planKey: 'LOJA|5|25999', totalInstallments: 5 };
  const r = computeBills(
    [bill({ closingDate: day('2026-08-29'), totalAmountCents: 100000n, paymentsCents: 100000 })],
    [
      tx('2026-08-08', 25999, { billId: 'last', billForecast: '2026-08', ...plan, installmentNumber: 2 }),
      tx('2026-09-08', 25999, { billForecast: '2026-09', ...plan, installmentNumber: 3 }), // ciclo fechado (vence 05/10)
      tx('2026-09-30', 17283, { billForecast: '2026-10' }),
      // Plano encerrado numa fatura antiga: não projeta nada.
      tx('2026-06-08', 9000, { billId: 'old', billForecast: '2026-06', planKey: 'ANTIGO|10|9000', totalInstallments: 10, installmentNumber: 2 }),
    ],
    NOW,
  );
  assert.deepEqual(core(r.closed), { amount: 259.99, projectedInstallments: 0, dueDate: '2026-10-05', closingDate: '2026-09-29', estimated: true });
  // 172,83 já lançados + parcela 4/5 de 259,99 que o banco só lança no dia 08/10.
  assert.deepEqual(core(r.open), { amount: 432.82, projectedInstallments: 259.99, dueDate: '2026-11-05', closingDate: '2026-10-29', estimated: true });
});

test('parcelas futuras que o banco já lançou não são projetadas em dobro', () => {
  const plan = { planKey: 'WEB|10|2599', totalInstallments: 10 };
  const r = computeBills(
    [bill({ dueDate: day('2026-10-06'), closingDate: day('2026-09-29'), totalAmountCents: 50000n, paymentsCents: 50000 })],
    [
      tx('2026-09-10', 5000, { billId: 'last', billForecast: '2026-10' }),
      tx('2026-10-04', 2599, { billForecast: '2026-11', ...plan, installmentNumber: 1 }),
      tx('2026-11-04', 2599, { billForecast: '2026-12', ...plan, installmentNumber: 2 }),
      tx('2026-12-04', 2599, { billForecast: '2027-01', ...plan, installmentNumber: 3 }),
    ],
    NOW,
  );
  assert.deepEqual(core(r.open), { amount: 25.99, projectedInstallments: 0, dueDate: '2026-11-06', closingDate: '2026-10-29', estimated: true });
  // As faturas seguintes trazem o que já está contratado: 2 parcelas lançadas adiante e 7 projetadas.
  assert.deepEqual(r.upcoming.slice(0, 3), [
    { dueMonth: '2026-12', amount: 25.99 },
    { dueMonth: '2027-01', amount: 25.99 },
    { dueMonth: '2027-02', amount: 25.99 },
  ]);
  assert.equal(r.upcoming.length, 9);
});

test('arredondamento de centavos entre parcelas não cria um plano fantasma; planos iguais de valores diferentes seguem separados', () => {
  const r = computeBills(
    [bill({ dueDate: day('2026-10-06'), closingDate: day('2026-09-29'), totalAmountCents: 50000n, paymentsCents: 50000 })],
    [
      tx('2026-09-06', 6126, { billId: 'last', billForecast: '2026-10', planKey: 'IFD|2', totalInstallments: 2, installmentNumber: 1 }),
      tx('2026-09-29', 6125, { billForecast: '2026-11', planKey: 'IFD|2', totalInstallments: 2, installmentNumber: 2 }),
      // Dois parcelamentos 12x no mesmo estabelecimento: só o de 285,76 já tem a próxima parcela lançada.
      tx('2026-08-30', 32863, { billId: 'last', billForecast: '2026-10', planKey: 'PIC|12', totalInstallments: 12, installmentNumber: 6 }),
      tx('2026-08-30', 28576, { billId: 'last', billForecast: '2026-10', planKey: 'PIC|12', totalInstallments: 12, installmentNumber: 6 }),
      tx('2026-09-29', 28576, { billForecast: '2026-11', planKey: 'PIC|12', totalInstallments: 12, installmentNumber: 7 }),
    ],
    NOW,
  );
  // 61,25 + 285,76 lançados + 328,63 projetados (parcela 7/12 do outro plano).
  assert.deepEqual([r.open?.amount, r.open?.projectedInstallments], [675.64, 328.63]);
});

test('parcelas que o banco não lançou no meio do plano são projetadas (só a última veio adiantada)', () => {
  // Rótulo = mês do vencimento (Nubank). Fatura de outubro listada; novembro aberta.
  const plan = { planKey: 'PICPAY|12', totalInstallments: 12 };
  const r = computeBills(
    [bill({ dueDate: day('2026-10-06'), closingDate: day('2026-09-29'), totalAmountCents: 100000n, paymentsCents: 0 })],
    [
      tx('2026-08-30', 32863, { billId: 'last', billForecast: '2026-10', installmentNumber: 6, ...plan }),
      tx('2026-09-29', 32863, { billForecast: '2026-11', installmentNumber: 7, ...plan }),
      // Só a 12/12 aparece adiante; da 8 à 11 o banco não mandou.
      tx('2027-03-11', 32863, { billForecast: '2027-04', installmentNumber: 12, ...plan }),
    ],
    NOW,
  );
  assert.equal(r.open?.amount, 328.63);
  assert.deepEqual(
    r.upcoming,
    ['2026-12', '2027-01', '2027-02', '2027-03', '2027-04'].map((dueMonth) => ({ dueMonth, amount: 328.63 })),
  );
});

test('fatura vencida some das "a pagar" mas continua na lista por mês de vencimento', () => {
  // Última listada venceu em 05/09; o ciclo seguinte fechou em 26/09 e venceu em 05/10 (ontem).
  const r = computeBills(
    [bill({ totalAmountCents: 72547n, paymentsCents: 72547 })],
    [tx('2026-09-10', 61795, { billForecast: '2026-09' }), tx('2026-10-01', 44281, { billForecast: '2026-10' })],
    new Date('2026-10-06T15:00:00.000Z'),
  );
  assert.equal(r.closed, null);
  assert.equal(r.open?.amount, 442.81);
  assert.deepEqual(r.past, [
    { dueMonth: '2026-09', amount: 725.47, dueDate: '2026-09-05' },
    { dueMonth: '2026-10', amount: 617.95, dueDate: '2026-10-05' },
  ]);
});

test('pagamento listado na fatura só vale para ela se foi feito depois do fechamento', () => {
  // Bradesco: a fatura que fechou zerada em 23/09 lista o pagamento de 08/09, que quitou a anterior.
  const raw = JSON.stringify({ payments: [{ amount: 725.47, paymentDate: '2026-09-08T00:00:00.000Z' }] });
  assert.equal(billPaymentsCents(raw, day('2026-09-23')), 0);
  // C6: pagamento em 04/09 de uma fatura que fechou em 29/08.
  assert.equal(billPaymentsCents(JSON.stringify({ payments: [{ amount: 1017.9, paymentDate: '2026-09-04T00:00:00.000Z' }] }), day('2026-08-29')), 101790);
  assert.equal(billPaymentsCents('{}', null), 0);

  // Com o pagamento antigo fora, ele não é abatido da fatura aberta.
  const r = computeBills(
    [bill({ dueDate: day('2026-10-05'), closingDate: day('2026-09-23'), totalAmountCents: 0n, paymentsCents: billPaymentsCents(raw, day('2026-09-23')) })],
    [tx('2026-09-23', 37273, { billForecast: '2026-10' }), tx('2026-09-27', 49285, { billForecast: '2026-10' })],
    new Date('2026-10-06T15:00:00.000Z'),
  );
  assert.equal(r.open?.amount, 865.58);
  assert.deepEqual(r.past, [{ dueMonth: '2026-10', amount: 0, dueDate: '2026-10-05' }]);
});

test('parte parcelada da fatura aberta: parcelas já lançadas mais as projetadas; compra à vista fica de fora', () => {
  const plan = { planKey: 'LOJA|6', totalInstallments: 6 };
  const r = computeBills(
    [bill({ dueDate: day('2026-10-06'), closingDate: day('2026-09-29'), totalAmountCents: 100000n, paymentsCents: 0 })],
    [
      // Plano A: parcela 2 na fatura de outubro (listada); a 3 ainda não foi lançada e é projetada para novembro.
      tx('2026-09-10', 10000, { billId: 'last', billForecast: '2026-10', installmentNumber: 2, ...plan }),
      // Plano B: parcela 1 de 3 já lançada no ciclo aberto.
      tx('2026-10-02', 5000, { billForecast: '2026-11', installmentNumber: 1, planKey: 'OUTRA|3', totalInstallments: 3 }),
      // Compra à vista no ciclo aberto.
      tx('2026-10-03', 7000, { billForecast: '2026-11' }),
    ],
    NOW,
  );
  assert.deepEqual([r.open?.amount, r.open?.installments, r.open?.projectedInstallments], [220, 150, 100]);
  // Seguintes: A (parcelas 4 a 6) e B (2 e 3).
  assert.deepEqual(r.upcoming.slice(0, 3), [{ dueMonth: '2026-12', amount: 150 }, { dueMonth: '2027-01', amount: 150 }, { dueMonth: '2027-02', amount: 100 }]);
});
