// Agregações da aba Cartões (função pura). Rodar: npm test (em server/).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCardsOverview, CardAccountRow, CardTransactionRow, describePurchase, merchantKey, planLabelKey, withInstallments } from '../src/openfinance/cards';
import { labelMerchant, prettyName } from '../src/openfinance/labels';

const NOW = new Date('2026-10-04T15:00:00.000Z');

const account: CardAccountRow = {
  id: 'card-1',
  connectionId: 'conn-1',
  name: ' Cartão Teste ',
  number: '1234',
  cardBrand: 'VISA',
  balanceCents: 150000n,
  creditLimitCents: 1000000n,
  availableCreditLimitCents: 700000n,
  minimumPaymentCents: 15000n,
  balanceDueDate: new Date('2026-10-10T00:00:00.000Z'),
};

const tx = (over: Partial<CardTransactionRow>): CardTransactionRow => ({
  accountId: 'card-1',
  date: new Date('2026-09-10T15:00:00.000Z'),
  description: 'LOJA X',
  type: 'DEBIT',
  amountCents: 10000n,
  currencyCode: 'BRL',
  amountInAccountCurrencyCents: null,
  category: 'Shopping',
  categoryId: '08000000',
  operationType: 'PAGAMENTO',
  installmentNumber: null,
  totalInstallments: null,
  merchantName: null,
  ...over,
});

const overview = (transactions: CardTransactionRow[], months = 6) =>
  buildCardsOverview({ accounts: [account], transactions, bills: [], bankNames: { 'conn-1': 'Banco Teste' }, months, now: NOW });

test('merchantKey ignora sufixo de parcela e espaços', () => {
  assert.equal(merchantKey({ merchantName: null, description: 'Loja  X PARC 03/10' }), 'LOJA X');
  assert.equal(merchantKey({ merchantName: null, description: 'Loja X - Parcela 3/10' }), 'LOJA X');
  assert.equal(merchantKey({ merchantName: 'Mercado Y', description: 'qualquer' }), 'MERCADO Y');
});

test('gasto exclui pagamento de fatura, custos e lançamentos futuros; estorno e custo são separados', () => {
  const o = overview([
    tx({ amountCents: 10000n }),
    tx({ description: 'MERCADO', category: 'Groceries', categoryId: '10000000', amountCents: 30000n }),
    tx({ description: 'IOF', category: 'Tax on financial operations', categoryId: '15030000', amountCents: 500n }),
    tx({ type: 'CREDIT', description: 'Pagamento recebido', amountCents: -40000n, operationType: 'PAGAMENTO_FATURA', categoryId: '05100000' }),
    tx({ type: 'CREDIT', description: 'PAGTO ANTECIPADO', amountCents: -5000n, operationType: null, categoryId: null }),
    tx({ type: 'CREDIT', description: 'Estorno Loja X', amountCents: -2000n, operationType: 'ESTORNO' }),
    tx({ date: new Date('2026-11-10T15:00:00.000Z'), amountCents: 99900n }),
    tx({ date: new Date('2025-01-10T15:00:00.000Z'), amountCents: 77700n }),
  ]);
  assert.equal(o.totals.spent, 400);
  assert.equal(o.totals.purchases, 2);
  assert.equal(o.totals.costs, 5);
  // Estorno sem compra de mesmo valor: fica como crédito avulso, não abate o gasto.
  assert.deepEqual([o.totals.otherCredits, o.totals.refundedPurchases], [20, 0]);
  assert.deepEqual(o.costs, [{ label: 'IOF', charged: 5, refunded: 0, net: 5 }]);
  assert.deepEqual(o.byCategory.map((c) => [c.label, c.total]), [['Mercado', 300], ['Compras', 100]]);
  assert.equal(o.byCategory[0].share, 0.75);
  assert.deepEqual(o.byMonth.map((m) => m.month), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  assert.equal(o.byMonth[4].total, 400);
  // Média só com meses fechados que tiveram compras.
  assert.equal(o.totals.avgMonthly, 400);
});

test('mês é atribuído no horário de Brasília', () => {
  // 01/10 01:00 UTC ainda é 30/09 em Brasília.
  const o = overview([tx({ date: new Date('2026-10-01T01:00:00.000Z') })]);
  assert.equal(o.byMonth.find((m) => m.month === '2026-09')?.total, 100);
  assert.equal(o.byMonth.find((m) => m.month === '2026-10')?.total, 0);
});

test('moeda estrangeira usa o valor convertido e fica fora dos totais quando não há conversão', () => {
  const o = overview([
    tx({ currencyCode: 'USD', amountCents: 2000n, amountInAccountCurrencyCents: 11000n }),
    tx({ currencyCode: 'USD', amountCents: 5000n, amountInAccountCurrencyCents: null }),
  ]);
  assert.equal(o.totals.spent, 110);
  assert.equal(o.totals.international, 110);
  assert.equal(o.totals.unconverted, 1);
});

test('limite, uso e dados do cartão', () => {
  const o = overview([tx({})]);
  const card = o.cards[0];
  assert.deepEqual([card.name, card.bank, card.last4, card.limit, card.used, card.utilization], ['Cartão Teste', 'Banco Teste', '1234', 10000, 3000, 0.3]);
  assert.equal(card.spentInPeriod, 100);
  // Sem faturas listadas não há fatura calculável; o saldo da conta é limite usado, não fatura.
  assert.deepEqual([card.closedBill, card.openBill, o.totals.openBills, o.totals.closedBills], [null, null, 0, 0]);
});

test('parcelamento ativo projeta as parcelas que faltam; plano encerrado não entra', () => {
  const o = overview([
    tx({ description: 'TV PARC 01/04', installmentNumber: 1, totalInstallments: 4, amountCents: 50000n, date: new Date('2026-08-10T15:00:00.000Z') }),
    tx({ description: 'TV PARC 02/04', installmentNumber: 2, totalInstallments: 4, amountCents: 50000n, date: new Date('2026-09-10T15:00:00.000Z') }),
    tx({ description: 'SOFA 03/03', installmentNumber: 3, totalInstallments: 3, amountCents: 20000n, date: new Date('2026-09-12T15:00:00.000Z') }),
    tx({ description: 'ANTIGO 02/10', installmentNumber: 2, totalInstallments: 10, amountCents: 9000n, date: new Date('2026-05-12T15:00:00.000Z') }),
  ]);
  assert.equal(o.installments.activeCount, 1);
  assert.deepEqual(o.installments.active[0], {
    key: 'plan:card-1|TV|4|50000', label: null, name: 'TV',
    card: 'Cartão Teste',
    installment: 2,
    totalInstallments: 4,
    remainingInstallments: 2,
    amount: 500,
    remainingAmount: 1000,
    endsIn: '2026-11',
  });
  // A parcela 3 cai em outubro (mês corrente, já na fatura); só novembro é futuro.
  assert.deepEqual(o.installments.monthly, [{ month: '2026-11', total: 500 }]);
  assert.equal(o.installments.totalRemaining, 500);
});

test('assinatura: mensal, valor estável, não parcelada; inativa quando para de cobrar', () => {
  const monthly = (description: string, amounts: Array<[string, bigint]>) =>
    amounts.map(([month, amountCents]) => tx({ description, amountCents, date: new Date(`${month}-05T15:00:00.000Z`), category: 'Digital services', categoryId: '09000000' }));
  const o = overview([
    ...monthly('STREAMING', [['2026-07', 3990n], ['2026-08', 3990n], ['2026-09', 4290n]]),
    ...monthly('CANCELADA', [['2026-05', 1990n], ['2026-06', 1990n], ['2026-07', 1990n]]),
    ...monthly('VARIAVEL', [['2026-07', 1000n], ['2026-08', 9000n], ['2026-09', 30000n]]),
    ...monthly('DUAS VEZES', [['2026-08', 5000n], ['2026-09', 5000n]]),
  ]);
  assert.deepEqual(
    o.subscriptions.map((s) => [s.name, s.monthly, s.months, s.active]),
    [
      ['Streaming', 39.9, 3, true],
      ['Cancelada', 19.9, 3, false],
    ],
  );
});

test('filtro por cartão restringe as compras mas mantém a lista de cartões', () => {
  const other: CardAccountRow = { ...account, id: 'card-2', name: 'Outro', balanceCents: 0n };
  const o = buildCardsOverview({
    accounts: [account, other],
    transactions: [tx({}), tx({ accountId: 'card-2', amountCents: 70000n })],
    bills: [],
    bankNames: {},
    months: 3,
    accountId: 'card-2',
    now: NOW,
  });
  assert.equal(o.totals.spent, 700);
  assert.equal(o.cards.length, 2);
  assert.equal(o.byMonth.length, 3);
});

test('1 mês = últimos 30 dias, com gráfico por dia; assinaturas continuam olhando 6 meses', () => {
  const o = buildCardsOverview({
    accounts: [account],
    bills: [],
    bankNames: {},
    months: 1,
    now: NOW,
    transactions: [
      tx({ date: new Date('2026-09-04T15:00:00.000Z'), amountCents: 99900n }), // 31 dias atrás: fora
      tx({ date: new Date('2026-09-05T15:00:00.000Z'), amountCents: 10000n }), // 30º dia: dentro
      tx({ date: new Date('2026-10-04T12:00:00.000Z'), amountCents: 5000n }),
      ...['2026-07', '2026-08', '2026-09'].map((m) => tx({ description: 'STREAMING', amountCents: 3990n, date: new Date(`${m}-20T15:00:00.000Z`) })),
    ],
  });
  assert.deepEqual([o.period.startDate, o.period.endDate, o.period.months], ['2026-09-05', '2026-10-04', 1]);
  assert.equal(o.totals.spent, 189.9);
  assert.equal(o.byDay?.length, 30);
  assert.deepEqual(
    [o.byDay?.[0], o.byDay?.[29]].map((d) => [d?.day, d?.total, d?.count]),
    [['2026-09-05', 100, 1], ['2026-10-04', 50, 1]],
  );
  // Cada barra do gráfico traz as compras que a compõem.
  assert.deepEqual(o.byDay?.[0].items, [{ name: 'Loja X', kind: 'compras em geral', card: 'Cartão Teste', amount: 100, installments: null }]);
  assert.deepEqual(o.byMonth.map((m) => m.month), ['2026-09', '2026-10']);
  // Nenhum mês inteiro no período: não há média mensal.
  assert.equal(o.totals.avgMonthly, null);
  assert.deepEqual(o.subscriptions.map((s) => s.name), ['Streaming']);
});

test('intervalo personalizado é inclusivo, limitado a hoje, e a média usa só meses inteiros', () => {
  const rows = [
    tx({ date: new Date('2026-06-14T15:00:00.000Z'), amountCents: 99900n }), // antes do início
    tx({ date: new Date('2026-06-15T15:00:00.000Z'), amountCents: 10000n }),
    tx({ date: new Date('2026-07-10T15:00:00.000Z'), amountCents: 20000n }),
    tx({ date: new Date('2026-08-31T15:00:00.000Z'), amountCents: 40000n }),
    tx({ date: new Date('2026-09-01T15:00:00.000Z'), amountCents: 99900n }), // depois do fim
  ];
  const o = buildCardsOverview({ accounts: [account], transactions: rows, bills: [], bankNames: {}, from: '2026-06-15', to: '2026-08-31', now: NOW });
  assert.deepEqual([o.period.custom, o.period.months, o.period.startDate, o.period.endDate], [true, null, '2026-06-15', '2026-08-31']);
  assert.equal(o.totals.spent, 700);
  assert.equal(o.byDay, null);
  assert.deepEqual(o.byMonth.map((m) => [m.month, m.total]), [['2026-06', 100], ['2026-07', 200], ['2026-08', 400]]);
  // Junho está cortado pelo início; só julho e agosto são meses inteiros.
  assert.equal(o.totals.avgMonthly, 300);
  assert.equal(o.cards[0].spentInPeriod, 700);

  const future = buildCardsOverview({ accounts: [account], transactions: rows, bills: [], bankNames: {}, from: '2026-09-01', to: '2027-01-31', now: NOW });
  assert.equal(future.period.endDate, '2026-10-04');
});

test('compra estornada sai do gasto; tarifa estornada zera o custo; "sem juros" é compra', () => {
  const o = overview([
    tx({ description: 'ALUGUEL DE CARRO', amountCents: 247732n, date: new Date('2026-08-10T15:00:00.000Z'), category: 'Travel', categoryId: '12000000' }),
    tx({ type: 'CREDIT', description: 'Estorno de compra', amountCents: -247732n, date: new Date('2026-08-20T15:00:00.000Z'), operationType: 'ESTORNO' }),
    tx({ description: 'MERCADO', amountCents: 10000n, category: 'Groceries', categoryId: '10000000' }),
    ...['2026-07', '2026-08', '2026-09'].flatMap((m) => [
      tx({ description: 'Tarifa Anuidade', amountCents: 9800n, date: new Date(`${m}-23T15:00:00.000Z`), category: 'Credit card fees', categoryId: '16030000' }),
      tx({ type: 'CREDIT', description: 'Estorno Tarifa Anuidade', amountCents: -9800n, date: new Date(`${m}-23T16:00:00.000Z`), category: 'Credit card fees', categoryId: '16030000', operationType: 'ESTORNO' }),
    ]),
    tx({ description: 'IOF de compra internacional', amountCents: 2000n, category: 'Tax on financial operations', categoryId: '15030000' }),
    tx({ type: 'CREDIT', description: 'Estorno de IOF', amountCents: -500n, category: 'Tax on financial operations', categoryId: '15030000', operationType: 'TARIFA' }),
    tx({ description: 'COMPRA A VISTA SEM JUROS MASTERCARD', amountCents: 999n, category: 'Interests charged', categoryId: '02020000' }),
  ]);
  assert.equal(o.totals.spent, 109.99);
  assert.deepEqual([o.totals.refundedPurchases, o.totals.refundedCount, o.totals.otherCredits], [2477.32, 1, 0]);
  assert.deepEqual(o.costs, [
    { label: 'IOF', charged: 20, refunded: 5, net: 15 },
    { label: 'Tarifas do cartão', charged: 294, refunded: 294, net: 0 },
  ]);
  assert.equal(o.totals.costs, 15);
  assert.ok(!o.byCategory.some((c) => c.label === 'Viagem'));
});

test('dia da semana é a média por ocorrência do dia no período', () => {
  // De 01/09 (terça) a 14/09 (segunda): duas ocorrências de cada dia.
  const o = buildCardsOverview({
    accounts: [account],
    bills: [],
    bankNames: {},
    from: '2026-09-01',
    to: '2026-09-14',
    now: NOW,
    transactions: [
      tx({ date: new Date('2026-09-04T15:00:00.000Z'), amountCents: 30000n }), // sexta
      tx({ date: new Date('2026-09-11T15:00:00.000Z'), amountCents: 10000n }), // sexta
      tx({ date: new Date('2026-09-07T15:00:00.000Z'), amountCents: 5000n }), // segunda
    ],
  });
  const core = (w: { total: number; days: number; average: number }) => ({ total: w.total, days: w.days, average: w.average });
  assert.deepEqual(core(o.weekdays[5]), { total: 400, days: 2, average: 200 });
  assert.deepEqual(core(o.weekdays[1]), { total: 50, days: 2, average: 25 });
  assert.deepEqual(core(o.weekdays[0]), { total: 0, days: 2, average: 0 });
});

test('compras internacionais: por moeda, com câmbio médio', () => {
  const o = overview([
    tx({ description: 'HOTEL', currencyCode: 'USD', amountCents: 10000n, amountInAccountCurrencyCents: 53000n }),
    tx({ description: 'HOTEL', currencyCode: 'USD', amountCents: 10000n, amountInAccountCurrencyCents: 54000n }),
    tx({ description: 'TAXI', currencyCode: 'EUR', amountCents: 2000n, amountInAccountCurrencyCents: 12000n }),
    // Duas descrições da mesma marca: uma linha só, com o nome exibido.
    tx({ description: 'ANTHROPIC* CLAUDE SUB', currencyCode: 'USD', amountCents: 2000n, amountInAccountCurrencyCents: 10000n }),
    tx({ description: 'CLAUDE.AI SUBSCRIPTION', currencyCode: 'USD', amountCents: 2000n, amountInAccountCurrencyCents: 11000n }),
  ]);
  assert.deepEqual(o.international.top.map((t) => [t.name, t.total, t.count]), [
    ['Hotel', 1070, 2],
    ['Claude (Anthropic)', 210, 2],
    ['Taxi', 120, 1],
  ]);
  assert.deepEqual(o.international.byCurrency, [
    { currency: 'USD', count: 4, original: 240, total: 1280, rate: 5.33 },
    { currency: 'EUR', count: 1, original: 20, total: 120, rate: 6 },
  ]);
  assert.deepEqual(o.international.top[0], { name: 'Hotel', total: 1070, count: 2 });
  assert.equal(o.international.count, 5);
});

test('parcelamentos: maior alívio mensal e data do fim', () => {
  const o = overview([
    tx({ description: 'TV 02/04', installmentNumber: 2, totalInstallments: 4, amountCents: 50000n, date: new Date('2026-09-10T15:00:00.000Z') }),
    tx({ description: 'LIVRO 01/06', installmentNumber: 1, totalInstallments: 6, amountCents: 3000n, date: new Date('2026-09-12T15:00:00.000Z') }),
    // Arredondamento na primeira parcela não cria um segundo plano.
    tx({ description: 'CURSO 01/02', installmentNumber: 1, totalInstallments: 2, amountCents: 6126n, date: new Date('2026-08-12T15:00:00.000Z') }),
    tx({ description: 'CURSO 02/02', installmentNumber: 2, totalInstallments: 2, amountCents: 6125n, date: new Date('2026-09-12T15:00:00.000Z') }),
  ]);
  assert.equal(o.installments.activeCount, 2);
  assert.deepEqual(o.installments.monthly, [
    { month: '2026-11', total: 530 },
    { month: '2026-12', total: 30 },
    { month: '2027-01', total: 30 },
    { month: '2027-02', total: 30 },
  ]);
  assert.deepEqual(o.installments.relief, { month: '2026-12', from: 530, to: 30 });
  assert.deepEqual([o.installments.nextMonth, o.installments.endsIn], [{ month: '2026-11', total: 530 }, '2027-02']);
});

test('nomes legíveis: tira intermediador e razão social', () => {
  assert.equal(prettyName('IYZICO *VPSDIME.C'), 'Vpsdime');
  assert.equal(prettyName('MICROSOFT DO BRASIL IMPORTACAO E COMERCIO DE SOFTWARE E VIDEO GAMES LTDA'), 'Microsoft');
  assert.equal(prettyName('PAYPAL DO BRASIL INSTITUICAO DE PAGAMENTO LTDA'), 'Paypal');
  assert.equal(prettyName('ADEGA DO VIZINHO'), 'Adega do Vizinho');
  assert.equal(prettyName('SUM*EXEMPLO RENT SRL'), 'Exemplo Rent Srl');
  assert.equal(prettyName('IFD*12345678 JOAO SILV'), 'Joao Silv');
});

test('rótulos: usuário > marca conhecida > categoria do Open Finance', () => {
  assert.deepEqual(labelMerchant('TOTALPASS', {}, 'Bem-estar'), { name: 'TotalPass', kind: 'academia' });
  assert.deepEqual(labelMerchant('ANTHROPIC* CLAUDE SUB', {}, null), { name: 'Claude (Anthropic)', kind: 'assistente de IA' });
  // Padaria é mercado pelo nome, mesmo que o banco diga restaurante; sem palavra conhecida vale a do banco.
  assert.deepEqual(labelMerchant('PADARIA DA ESQUINA', {}, 'Restaurantes'), { name: 'Padaria da Esquina', kind: 'mercado' });
  assert.deepEqual(labelMerchant('RECANTO SABORES', {}, 'Restaurantes'), { name: 'Recanto Sabores', kind: 'restaurantes' });
  assert.deepEqual(labelMerchant('BRADESCO', { BRADESCO: { name: 'Bradesco Seguros', kind: 'seguro do carro' } }, 'Seguros'), {
    name: 'Bradesco Seguros',
    kind: 'seguro do carro',
  });
  // Rótulo parcial do usuário completa com o automático.
  assert.deepEqual(labelMerchant('TOTALPASS', { TOTALPASS: { name: null, kind: 'academia da família' } }, null), {
    name: 'TotalPass',
    kind: 'academia da família',
  });
});

test('marca conhecida corrige a categoria e aparece na composição dela', () => {
  const o = buildCardsOverview({
    accounts: [account],
    bills: [],
    bankNames: {},
    months: 6,
    now: NOW,
    userLabels: { BRADESCO: { name: 'Bradesco Seguros', kind: 'seguro do carro' } },
    transactions: [
      tx({ description: 'TOTALPASS', amountCents: 14990n, category: 'Wellness and fitness', categoryId: '07030000' }),
      tx({ description: 'DROGASIL 123', amountCents: 5000n, category: 'Pharmacy', categoryId: '18020000' }),
      tx({ description: 'BRADESCO', amountCents: 37273n, category: 'Insurance', categoryId: '20000000' }),
    ],
  });
  const saude = o.byCategory.find((c) => c.label === 'Saúde');
  assert.deepEqual(saude?.subcategories, [
    { label: 'Academia', total: 149.9 },
    { label: 'Farmácia', total: 50 },
  ]);
  assert.deepEqual(saude?.merchants, [
    { name: 'TotalPass', total: 149.9 },
    { name: 'Drogasil 123', total: 50 },
  ]);
  assert.ok(!o.byCategory.some((c) => c.label === 'Serviços'));
  assert.deepEqual(o.topMerchants[0], { key: 'BRADESCO', name: 'Bradesco Seguros', kind: 'seguro do carro', total: 372.73, count: 1 });
});

test('período "fatura atual": do dia seguinte ao último fechamento até hoje', () => {
  const o = buildCardsOverview({
    accounts: [account],
    bankNames: {},
    billCycle: true,
    now: NOW,
    bills: [{ id: 'b1', accountId: 'card-1', dueDate: new Date('2026-09-05T00:00:00.000Z'), closingDate: new Date('2026-08-29T00:00:00.000Z'), totalAmountCents: 10000n, paymentsCents: 10000 }],
    transactions: [
      tx({ date: new Date('2026-09-29T15:00:00.000Z'), amountCents: 99900n }), // dia do fechamento: fatura anterior
      tx({ date: new Date('2026-09-30T15:00:00.000Z'), amountCents: 10000n }),
      tx({ date: new Date('2026-10-02T15:00:00.000Z'), amountCents: 5000n }),
    ],
  });
  // Última fatura listada fechou em 29/08; o ciclo seguinte fechou em 29/09 e o aberto fecha em 29/10.
  assert.deepEqual([o.period.billCycle, o.period.startDate, o.period.endDate, o.period.months], [true, '2026-09-30', '2026-10-04', null]);
  assert.equal(o.totals.spent, 150);
  assert.equal(o.byDay?.length, 5);
});

test('sem fatura aberta conhecida, "fatura atual" cai no período padrão', () => {
  const o = buildCardsOverview({ accounts: [account], bankNames: {}, billCycle: true, now: NOW, bills: [], transactions: [tx({})] });
  assert.deepEqual([o.period.billCycle, o.period.months], [false, 6]);
});

test('"fatura atual" separa as compras pelo fechamento de cada cartão', () => {
  const early: CardAccountRow = { ...account, id: 'early', name: 'Fecha 26' };
  const late: CardAccountRow = { ...account, id: 'late', name: 'Fecha 29' };
  const bill = (accountId: string, closing: string) => ({
    id: `bill-${accountId}`,
    accountId,
    dueDate: new Date('2026-09-05T00:00:00.000Z'),
    closingDate: new Date(`${closing}T00:00:00.000Z`),
    totalAmountCents: 10000n,
    paymentsCents: 10000,
  });
  const o = buildCardsOverview({
    accounts: [early, late],
    bankNames: {},
    billCycle: true,
    now: NOW,
    bills: [bill('early', '2026-08-26'), bill('late', '2026-08-29')],
    transactions: [
      // 28/09: já é fatura aberta no cartão que fechou dia 26, ainda não no que fecha dia 29.
      tx({ accountId: 'early', date: new Date('2026-09-28T15:00:00.000Z'), amountCents: 10000n }),
      tx({ accountId: 'late', date: new Date('2026-09-28T15:00:00.000Z'), amountCents: 77700n }),
      tx({ accountId: 'late', date: new Date('2026-09-30T15:00:00.000Z'), amountCents: 5000n }),
      // O banco já marca esta compra de 25/09 como da fatura aberta (fechou antes do estimado): entra.
      tx({ accountId: 'early', date: new Date('2026-09-25T15:00:00.000Z'), amountCents: 2000n, billForecast: '2026-10' }),
    ],
  });
  assert.equal(o.period.startDate, '2026-09-25');
  assert.equal(o.totals.spent, 170);
  assert.deepEqual(o.cards.map((c) => [c.name, c.cycleStart, c.spentInPeriod]), [
    ['Fecha 26', '2026-09-25', 120],
    ['Fecha 29', '2026-09-30', 50],
  ]);
});

test('categoria: escolha do usuário vence a do banco; palavras do nome separam mercado de restaurante', () => {
  const eatingOut = { category: 'Eating out', categoryId: '11010000' };
  const bistro = { merchantName: 'RECANTO SABORES', description: 'RECANTO SABORES', ...eatingOut };
  // Sem nada que diga o contrário, vale a categoria do banco.
  assert.equal(describePurchase(bistro, {}).sub, 'Restaurantes');
  // O usuário diz que é mercado: passa a ser, e a descrição acompanha.
  const fixed = describePurchase(bistro, { [merchantKey(bistro)]: { name: null, kind: null, category: 'mercado' } });
  assert.deepEqual([fixed.fam.id, fixed.sub, fixed.kind], ['10', 'Mercado', 'mercado']);
  // Categoria desconhecida é ignorada.
  assert.equal(describePurchase(bistro, { [merchantKey(bistro)]: { name: null, kind: null, category: 'xyz' } }).sub, 'Restaurantes');

  const by = (name: string) => describePurchase({ merchantName: name, description: name, ...eatingOut }, {}).sub;
  assert.equal(by('EXEMPLO SUPERMERCADO'), 'Mercado');
  assert.equal(by('PADARIA BOM PAO'), 'Mercado');
  assert.equal(by('GOCASH SUSHI ESTRELA'), 'Restaurantes');
  // "Mercado Livre" continua sendo compra online, e "barbearia" não é bar.
  assert.equal(by('MERCADOLIVRE*LOJA'), 'Compras online');
  const barber = describePurchase({ merchantName: 'BARBEARIA DO BAIRRO', description: 'BARBEARIA DO BAIRRO', category: 'Services', categoryId: '07000000' }, {});
  assert.notEqual(barber.sub, 'Restaurantes');
});

test('parcela escrita só na descrição ("03de12") é reconhecida; a dos metadados tem prioridade', () => {
  const row = (description: string, installmentNumber: number | null = null, totalInstallments: number | null = null) => ({ description, installmentNumber, totalInstallments });
  assert.deepEqual(withInstallments(row('BRADESCO AUT*03de12')), { description: 'BRADESCO AUT*03de12', installmentNumber: 3, totalInstallments: 12 });
  assert.deepEqual(withInstallments(row('Loja X 2/6', 2, 6)), row('Loja X 2/6', 2, 6));
  // Sem padrão de parcela, ou números que não fazem sentido: fica como veio.
  assert.deepEqual(withInstallments(row('ADEGA DO VIZINHO')), row('ADEGA DO VIZINHO'));
  assert.deepEqual(withInstallments(row('LOJA 13de12')), row('LOJA 13de12'));
});

test('categoria traz todos os lugares com a chave, e a visão lista as categorias que o usuário pode escolher', () => {
  const account = { id: 'card', name: 'Cartão', connectionId: 'c', number: '1234', cardBrand: 'VISA', creditLimitCents: 100000n, availableCreditLimitCents: 50000n, balanceCents: 50000n } as unknown as CardAccountRow;
  const row = (id: string, description: string, cents: number, category: string, categoryId: string) =>
    ({ id, accountId: 'card', date: new Date('2026-10-01T15:00:00.000Z'), type: 'DEBIT', amountCents: BigInt(cents), amountInAccountCurrencyCents: null, currencyCode: 'BRL', description, merchantName: null, category, categoryId, billId: null, billForecast: null, installmentNumber: null, totalInstallments: null }) as unknown as CardTransactionRow;
  const o = buildCardsOverview({
    accounts: [account],
    bankNames: {},
    months: 1,
    now: new Date('2026-10-05T15:00:00.000Z'),
    bills: [],
    transactions: [row('a', 'RECANTO SABORES', 10000, 'Eating out', '11010000'), row('b', 'RECANTO SABORES', 5000, 'Eating out', '11010000'), row('c', 'GOCASH SUSHI', 7000, 'Eating out', '11010000')],
    userLabels: { 'RECANTO SABORES': { name: null, kind: null, category: 'mercado' } },
  });
  const market = o.byCategory.find((c) => c.label === 'Mercado');
  assert.deepEqual(market?.places, [{ key: 'RECANTO SABORES', name: 'Recanto Sabores', total: 150, count: 2 }]);
  assert.deepEqual(o.byCategory.find((c) => c.label === 'Alimentação')?.places.map((p) => p.key), ['GOCASH SUSHI']);
  assert.ok(o.categoryChoices.some((c) => c.id === 'mercado' && c.label === 'Mercado'));
});

test('parcelamento: cada plano tem a sua etiqueta, mesmo no mesmo estabelecimento', () => {
  const account = { id: 'card', name: 'Cartão', connectionId: 'c', number: '1234', cardBrand: 'VISA', creditLimitCents: 100000n, availableCreditLimitCents: 50000n, balanceCents: 50000n } as unknown as CardAccountRow;
  const row = (id: string, cents: number, installmentNumber: number, totalInstallments: number) =>
    ({ id, accountId: 'card', date: new Date('2026-10-01T15:00:00.000Z'), type: 'DEBIT', amountCents: BigInt(cents), amountInAccountCurrencyCents: null, currencyCode: 'BRL', description: 'FULANO SILVA', merchantName: null, category: 'Shopping', categoryId: '08000000', billId: null, billForecast: null, installmentNumber, totalInstallments }) as unknown as CardTransactionRow;
  const o = buildCardsOverview({
    accounts: [account],
    bankNames: {},
    months: 1,
    now: new Date('2026-10-05T15:00:00.000Z'),
    bills: [],
    transactions: [row('a', 50396, 6, 18), row('b', 36807, 9, 24)],
    userLabels: { [planLabelKey('card', 'FULANO SILVA', 18, 50396)]: { name: 'Notebook', kind: null } },
  });
  const plans = o.installments.active.map((p) => [p.label, p.name, p.totalInstallments]);
  assert.deepEqual(plans.sort((x, y) => Number(x[2]) - Number(y[2])), [['Notebook', 'Fulano Silva', 18], [null, 'Fulano Silva', 24]]);
  assert.equal(o.installments.active.every((p) => p.key.startsWith('plan:card|FULANO SILVA|')), true);
});

test('dia da semana: conta só o que foi comprado no dia; parcela de compra antiga fica de fora', () => {
  const account = { id: 'card', name: 'Cartão', connectionId: 'c', number: '1234', cardBrand: 'VISA', creditLimitCents: 100000n, availableCreditLimitCents: 50000n, balanceCents: 50000n } as unknown as CardAccountRow;
  const row = (id: string, date: string, cents: number, category: string, categoryId: string, installmentNumber: number | null = null, totalInstallments: number | null = null) =>
    ({ id, accountId: 'card', date: new Date(`${date}T15:00:00.000Z`), type: 'DEBIT', amountCents: BigInt(cents), amountInAccountCurrencyCents: null, currencyCode: 'BRL', description: `LOJA ${id}`, merchantName: null, category, categoryId, billId: null, billForecast: null, installmentNumber, totalInstallments }) as unknown as CardTransactionRow;
  const o = buildCardsOverview({
    accounts: [account],
    bankNames: {},
    from: '2026-09-28',
    to: '2026-10-11',
    now: new Date('2026-10-12T15:00:00.000Z'),
    bills: [],
    transactions: [
      // Terça 29/09: uma compra de mercado e uma parcela 7/12 de compra antiga.
      row('a', '2026-09-29', 10000, 'Groceries', '10000000'),
      row('b', '2026-09-29', 90000, 'Shopping', '08000000', 7, 12),
      // Terça 06/10: restaurante e a primeira parcela de uma compra nova.
      row('c', '2026-10-06', 6000, 'Eating out', '11010000'),
      row('d', '2026-10-06', 4000, 'Shopping', '08000000', 1, 3),
    ],
    userLabels: {},
  });
  const tue = o.weekdays[2];
  // 100 + 60 + 40 em duas terças; a parcela 7/12 (R$ 900) não entra.
  assert.deepEqual([tue.total, tue.days, tue.average, tue.count, tue.activeDays, tue.top], [200, 2, 100, 3, 2, { label: 'Mercado', total: 100 }]);
  assert.deepEqual([o.weekdays[3].total, o.weekdays[3].count, o.weekdays[3].top], [0, 0, null]);
});
