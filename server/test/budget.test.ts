// Planejado x realizado (função pura). Rodar: npm test (em server/).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBudget, BudgetTx, dueMonthFor, monthOfLabel, reversedDebits } from '../src/openfinance/budget';

const NOW = new Date('2026-10-15T15:00:00.000Z');

const tx = (over: Partial<BudgetTx>): BudgetTx => ({
  date: new Date('2026-10-05T15:00:00.000Z'),
  cents: 10000,
  key: 'LOJA',
  name: 'Loja',
  kind: null,
  famId: '08',
  sub: 'Compras em geral',
  description: 'LOJA',
  source: 'Nubank · cartão',
  ...over,
});

const budget = (items: Array<[string, number[]]>, transactions: BudgetTx[], cards = [] as Parameters<typeof buildBudget>[0]['cards']) =>
  buildBudget({
    items: items.map(([name, values], i) => ({ id: `i${i}`, name, values, controllable: /Aliment|Sociais|Combust/.test(name) })),
    months: ['SET', 'OUT', 'NOV'],
    transactions,
    cards,
    now: NOW,
  });

test('rótulo do mês vira o mês de calendário mais próximo de hoje', () => {
  assert.equal(monthOfLabel('OUT', NOW), '2026-10');
  assert.equal(monthOfLabel('dez', NOW), '2026-12');
  assert.equal(monthOfLabel('Jan', NOW), '2027-01');
  assert.equal(monthOfLabel('JUL', NOW), '2026-07');
  assert.equal(monthOfLabel('Março/2027', NOW), '2027-03');
  assert.equal(monthOfLabel('Mês 4', NOW), null);
});

test('limite: soma o consumo do mês, mostra onde foi e avisa perto do teto ou pelo ritmo', () => {
  const b = budget(
    [
      ['Alimentação', [1000, 1000, 1000]],
      ['Despesas Sociais', [500, 500, 500]],
      ['Combustível e Pedágio', [0, 400, 400]],
    ],
    [
      tx({ famId: '10', sub: 'Mercado', name: 'Mercado A', cents: 30000 }),
      tx({ famId: '10', sub: 'Mercado', name: 'Mercado A', cents: 10000, source: 'Nubank · conta' }),
      tx({ famId: '11', sub: 'Delivery', name: 'iFood', cents: 20000 }),
      tx({ famId: '11', sub: 'Restaurantes', name: 'Bar', cents: 45000 }),
      tx({ famId: '19', sub: 'Combustível', name: 'Posto', cents: 41000 }),
      tx({ famId: '10', sub: 'Mercado', name: 'Mercado A', cents: 99900, date: new Date('2026-09-10T15:00:00.000Z') }),
      tx({ famId: '10', sub: 'Mercado', name: 'Futuro', cents: 99900, date: new Date('2026-10-20T15:00:00.000Z') }),
    ],
  );
  const [food, social, fuel] = b.rows;
  assert.deepEqual([food.type, food.rule], ['limit', 'Mercado e delivery']);
  const oct = food.months[1] as { actual: number; used: number; status: string; projected: number; top: unknown; count: number };
  // 600 em 15 de 31 dias: 60% usado, mas o ritmo fecha em 1.240 — "perto".
  assert.deepEqual([oct.actual, oct.used, oct.count, oct.status, oct.projected], [600, 0.6, 3, 'near', 1240]);
  assert.deepEqual(oct.top, [
    { name: 'Mercado A', amount: 400 },
    { name: 'iFood', amount: 200 },
  ]);
  // Mês passado fechado em 99,9% do limite: ficou "perto", sem estourar.
  assert.deepEqual([(food.months[0] as { actual: number }).actual, (food.months[0] as { status: string }).status], [999, 'near']);
  assert.equal((food.months[2] as { status: string }).status, 'none');
  assert.deepEqual([(social.months[1] as { actual: number }).actual, (social.months[1] as { status: string }).status], [450, 'near']);
  assert.deepEqual([(fuel.months[1] as { actual: number }).actual, (fuel.months[1] as { status: string }).status], [410, 'over']);
  // Setembro não tem valor na linha: o limite de referência vem do mês vizinho que tem.
  const fuelSep = fuel.months[0] as { status: string; limit: number | null; limitFrom: string | null; used: number | null };
  assert.deepEqual([fuelSep.limit, fuelSep.limitFrom, fuelSep.used, fuelSep.status], [400, 'OUT', 0, 'ok']);
  assert.deepEqual([(fuel.months[1] as { limit: number }).limit, (fuel.months[1] as { limitFrom: string | null }).limitFrom], [400, null]);
});

test('conta fixa: reconhece o pagamento por regra, marca, rótulo do usuário ou nome da linha', () => {
  const b = budget(
    [
      ['Água', [50, 50, 50]],
      ['Seguro Veicular', [373, 373, 373]],
      ['Financiamento Veicular', [1623, 1623, 1623]],
      ['Financiamento Estudantil', [0, 360, 360]],
      ['Academia', [0, 149.9, 149.9]],
      ['Claude', [0, 120, 120]],
      ['Aluguel', [3663, 3663, 3663]],
      ['Internet', [245, 245, 245]],
    ],
    [
      tx({ key: 'SERVICO AUTONOM', name: 'Servico Autonom', description: 'Pagamento efetuado|SERVICO AUTONOM', famId: '17', sub: 'Água', cents: 4562, source: 'Nubank · conta' }),
      tx({ key: 'BRADESCO', name: 'Bradesco Seguros', kind: 'seguro do carro', famId: '20', sub: 'Seguros', cents: 37273 }),
      tx({ key: 'OUTRO SEGURO', name: 'Outro', famId: '20', sub: 'Seguros', cents: 9126 }),
      tx({ key: 'BX.ANT.FINANC/EMP', name: 'Bx.ant.financ/emp', description: 'BX.ANT.FINANC/EMP - CONTRATO 1', famId: '02', sub: 'Loans', cents: 161564, source: 'Bradesco · conta' }),
      ...[1, 2, 3].map((d) => tx({ key: 'FIES JRS/AMORT', name: 'Fies Jrs/amort', description: 'FIES JRS/AMORT', famId: '15', cents: 12000, date: new Date(`2026-10-0${d}T15:00:00.000Z`) })),
      tx({ key: 'TOTALPASS', name: 'TotalPass', kind: 'academia', famId: '18', sub: 'Academia', cents: 14990 }),
      tx({ key: 'ANTHROPIC* CLAUDE SUB', name: 'Claude (Anthropic)', kind: 'assistente de IA', description: 'ANTHROPIC* CLAUDE SUB', famId: '09', cents: 11434 }),
      tx({ key: 'JOSE DA SILVA', name: 'Jose da Silva', description: 'Transferência enviada pelo Pix|JOSE DA SILVA', famId: '05', sub: 'Transferências', cents: 405566, source: 'Nubank · conta' }),
      // Compra de valor parecido com o aluguel, mas no cartão: não é candidata.
      tx({ key: 'LOJA CARA', name: 'Loja Cara', cents: 366000 }),
      tx({ key: 'CLARO', name: 'Claro', description: 'CONTA DE TELEFONE - CLARO S/A', famId: '07', sub: 'Telefonia', cents: 12990, source: 'Bradesco · conta' }),
    ],
  );
  const paid = (i: number) => (b.rows[i].months[1] as { paid: { amount: number; name: string; count: number; differs: boolean; date: string; source: string; onCard: boolean } | null }).paid;
  assert.deepEqual(paid(0), { amount: 45.62, date: '2026-10-05', name: 'Servico Autonom', source: 'Nubank · conta', byAmount: false, onCard: false, billRow: false, joint: null, ahead: false, manual: null, count: 1, sameCount: 1, sameTotal: 45.62, differs: false });
  // Entre dois seguros, fica o de valor mais próximo do planejado.
  assert.deepEqual([paid(1)?.name, paid(1)?.amount], ['Bradesco Seguros', 372.73]);
  // "Seguro Veicular" não pode cair na regra de financiamento veicular.
  assert.deepEqual([paid(2)?.name, paid(2)?.amount], ['Bx.ant.financ/emp', 1615.64]);
  // Várias linhas da mesma cobrança somam.
  assert.deepEqual([paid(3)?.amount, paid(3)?.count, paid(3)?.date], [360, 3, '2026-10-03']);
  assert.equal(paid(4)?.name, 'TotalPass');
  assert.equal(paid(5)?.amount, 114.34);
  // Valor muito diferente do planejado é mostrado com aviso.
  assert.deepEqual([paid(7)?.name, paid(7)?.differs], ['Claro', true]);

  // Aluguel pago por Pix para uma pessoa: não há como reconhecer, mas o valor parecido vira sugestão.
  const rent = b.rows[6].months[1] as { paid: unknown; candidates: Array<{ key: string; amount: number }> };
  assert.equal(rent.paid, null);
  assert.deepEqual(rent.candidates.map((c) => [c.key, c.amount]), [['JOSE DA SILVA', 4055.66]]);
  // Mês anterior sem lançamento: não pago; mês futuro: nada a dizer.
  assert.equal((b.rows[4].months[0] as { paid: unknown }).paid, null);
  assert.deepEqual((b.rows[6].months[2] as { candidates: unknown[] }).candidates, []);
});

test('depois que o usuário vincula a contraparte à linha, ela passa a ser reconhecida', () => {
  const b = budget(
    [['Aluguel', [3663, 3663, 3663]]],
    [tx({ key: 'JOSE DA SILVA', name: 'Jose da Silva', kind: 'Aluguel', description: 'Transferência enviada pelo Pix|JOSE DA SILVA', famId: '05', cents: 405566 })],
  );
  const oct = b.rows[0].months[1] as { paid: { amount: number; differs: boolean } | null };
  assert.deepEqual([oct.paid?.amount, oct.paid?.differs], [4055.66, false]);
});

test('linha de fatura sugere a fatura do cartão do banco que vence naquele mês', () => {
  const b = budget(
    [
      ['Nu Bank (fatura)', [0, 6914.2, 2000]],
      ['C6 Bank (fatura)', [0, 0, 0]],
      ['PicPay (fatura)', [0, 0, 0]],
    ],
    [],
    [
      { bank: 'Nu Pagamentos S.A. - Instituição de Pagamento', closedBill: { amount: 6914.2, dueDate: '2026-10-06' }, openBill: { amount: 2396.29, dueDate: '2026-11-06' } },
      { bank: 'C6 BANK', closedBill: null, openBill: { amount: 442.81, dueDate: '2026-11-05' } },
    ],
  );
  const m = (row: number, i: number) => b.rows[row].months[i] as { suggested: number | null; billState: string | null; dueDate: string | null };
  assert.equal(b.rows[0].type, 'cardBill');
  assert.deepEqual(m(0, 1), { ...m(0, 1), suggested: 6914.2, billState: 'closed', dueDate: '2026-10-06' });
  assert.deepEqual([m(0, 2).suggested, m(0, 2).billState], [2396.29, 'open']);
  // C6 sem fatura vencendo em outubro e com a de novembro aberta: outubro fechou zerada.
  assert.deepEqual([m(1, 1).suggested, m(1, 1).billState, m(1, 2).suggested], [0, 'closed', 442.81]);
  // Banco sem cartão conectado: sem sugestão.
  assert.equal(m(2, 2).suggested, null);
});

test('com o ciclo dos cartões, o limite de uma coluna soma o que será pago naquele mês', () => {
  // Cartões fecharam em 26/09: o que se gasta de 27/09 a 26/10 vence em novembro.
  const b = buildBudget({
    items: [{ id: 'a', name: 'Alimentação', controllable: true, values: [0, 1000, 1800] }],
    months: ['OUT', 'NOV', 'DEZ'],
    cards: [],
    cycle: { start: '2026-09-27', dueMonth: '2026-11' },
    now: NOW,
    transactions: [
      tx({ famId: '10', sub: 'Mercado', name: 'A', cents: 99900, date: new Date('2026-09-26T15:00:00.000Z') }), // ciclo de OUT
      tx({ famId: '10', sub: 'Mercado', name: 'B', cents: 30000, date: new Date('2026-09-28T15:00:00.000Z') }),
      tx({ famId: '10', sub: 'Mercado', name: 'B', cents: 20000, date: new Date('2026-10-10T15:00:00.000Z') }),
    ],
  });
  const [out, nov, dez] = b.rows[0].months as Array<{ state: string; actual: number; window: { start: string; end: string }; limit: number; limitFrom: string | null; projected: number | null }>;
  assert.deepEqual([out.state, out.window, out.actual, out.limit, out.limitFrom], ['past', { start: '2026-08-27', end: '2026-09-26' }, 999, 1000, 'NOV']);
  // 19 dos 30 dias do ciclo: 500 gastos projetam 789,47.
  assert.deepEqual([nov.state, nov.window, nov.actual, nov.limit, nov.projected], ['current', { start: '2026-09-27', end: '2026-10-26' }, 500, 1000, 789.47]);
  assert.deepEqual([dez.state, dez.window, dez.actual], ['future', { start: '2026-10-27', end: '2026-11-26' }, 0]);
  assert.deepEqual(b.months.map((m) => m.cycle?.state), ['past', 'current', 'future']);
});

test('compra de cartão vai para a fatura em que cai, pelo fechamento do próprio cartão', () => {
  // Cartão que fecha dia 29 e vence dia 6 do mês seguinte.
  assert.equal(dueMonthFor('2026-09-29', '2026-10-29', '2026-11-06'), '2026-10');
  assert.equal(dueMonthFor('2026-09-30', '2026-10-29', '2026-11-06'), '2026-11');
  assert.equal(dueMonthFor('2026-10-29', '2026-10-29', '2026-11-06'), '2026-11');
  assert.equal(dueMonthFor('2026-12-30', '2026-10-29', '2026-11-06'), '2027-02');
  // Fechamento no dia 31 em mês de 30 dias: o último dia do mês ainda fecha nele.
  assert.equal(dueMonthFor('2026-09-30', '2026-10-31', '2026-11-08'), '2026-10');

  const b = buildBudget({
    items: [{ id: 'a', name: 'Alimentação', controllable: true, values: [1000, 1000, 1000] }],
    months: ['OUT', 'NOV', 'DEZ'],
    cards: [],
    cycle: { start: '2026-09-27', dueMonth: '2026-11' },
    now: NOW,
    transactions: [
      // Mesmo dia, cartões diferentes: no que fecha dia 29 ainda é fatura de outubro.
      tx({ famId: '10', sub: 'Mercado', name: 'Fecha 29', cents: 10000, date: new Date('2026-09-28T15:00:00.000Z'), dueMonth: '2026-10' }),
      tx({ famId: '10', sub: 'Mercado', name: 'Fecha 26', cents: 20000, date: new Date('2026-09-28T15:00:00.000Z'), dueMonth: '2026-11' }),
      // Gasto pela conta: segue a janela geral do ciclo.
      tx({ famId: '10', sub: 'Mercado', name: 'Débito', cents: 5000, date: new Date('2026-09-28T15:00:00.000Z'), source: 'Nubank · conta' }),
    ],
  });
  const [out, nov] = b.rows[0].months as Array<{ actual: number }>;
  assert.deepEqual([out.actual, nov.actual], [100, 250]);
});

test('fatura de mês futuro usa as parcelas já contratadas; entradas reconhecem o crédito do mês', () => {
  const b = buildBudget({
    items: [
      { id: 'c6', name: 'C6 Bank (fatura)', values: [0, 0, 0] },
      { id: 'sal', name: 'Salário', section: 'entrada', values: [9692.45, 9692.45, 9692.45] },
      { id: 'aux', name: 'Aux. Home Office', section: 'entrada', values: [403, 403, 403] },
      { id: 'cx', name: 'Caixa', section: 'entrada', values: [4500, 0, 0] },
    ],
    months: ['OUT', 'NOV', 'DEZ'],
    cards: [{ bank: 'C6 BANK', closedBill: null, openBill: { amount: 442.81, dueDate: '2026-11-05' }, upcomingBills: [{ dueMonth: '2026-12', amount: 259.99 }] }],
    transactions: [],
    income: [
      tx({ date: new Date('2026-10-05T12:00:00.000Z'), cents: 969245, key: 'EMPRESA X', name: 'Empresa X', description: 'PAGAMENTO DE SALARIO|EMPRESA X', sub: 'Salary', famId: '01', source: 'Bradesco · conta' }),
      tx({ date: new Date('2026-10-01T12:00:00.000Z'), cents: 40300, key: 'EMPRESA X AUX', name: 'Empresa X', description: 'CREDITO AUX HOME OFFICE', sub: 'Income', famId: '01', source: 'Bradesco · conta' }),
      tx({ date: new Date('2026-10-02T12:00:00.000Z'), cents: 9400, key: 'FULANO', name: 'Fulano', description: 'Transferência recebida pelo Pix|FULANO', sub: 'Transfers', famId: '05' }),
    ],
    now: NOW,
  });
  const bill = b.rows[0].months as Array<{ suggested: number | null; billState: string | null }>;
  assert.deepEqual(bill.map((m) => [m.suggested, m.billState]), [[0, 'closed'], [442.81, 'open'], [259.99, 'projected']]);
  const received = (row: number, i: number) => (b.rows[row].months[i] as { received: { amount: number; date: string; name: string; differs: boolean } | null }).received;
  assert.equal(b.rows[1].type, 'income');
  assert.deepEqual([received(1, 0)?.amount, received(1, 0)?.date, received(1, 0)?.differs], [9692.45, '2026-10-05', false]);
  // "Aux. Home Office" casa pelas palavras da linha, não pelo salário.
  assert.equal(received(2, 0)?.amount, 403);
  // "Caixa" não corresponde a nenhum crédito; mês futuro nunca tem recebimento.
  assert.equal(received(3, 0), null);
  assert.equal(received(1, 1), null);
});

test('só linha marcada como gasto controlável vira limite; sem regra própria, soma o que cita a linha', () => {
  const b = buildBudget({
    items: [
      { id: 'a', name: 'Alimentação', values: [1000, 1000, 1000] }, // não marcada: não é limite
      { id: 'f', name: 'Farmácia', controllable: true, values: [200, 200, 200] },
      { id: 'u', name: 'Uber', controllable: true, values: [100, 100, 100] },
    ],
    months: ['SET', 'OUT', 'NOV'],
    cards: [],
    now: NOW,
    transactions: [
      tx({ famId: '10', sub: 'Mercado', name: 'Mercado A', cents: 30000 }),
      tx({ famId: '18', sub: 'Farmácia', name: 'Drogasil', cents: 2500 }),
      tx({ famId: '18', sub: 'Farmácia', name: 'Drogal', cents: 5500 }),
      tx({ famId: '19', sub: 'Táxi e apps', name: 'Uber Trip', description: 'UBER *TRIP', cents: 2300 }),
    ],
  });
  assert.deepEqual(b.rows.map((r) => r.type), ['fixed', 'limit', 'limit']);
  const oct = (i: number) => b.rows[i].months[1] as { actual: number; limit: number; status: string };
  assert.deepEqual([oct(1).actual, oct(1).limit, oct(1).status], [80, 200, 'ok']);
  assert.equal(b.rows[1].rule, 'lançamentos que citam "Farmácia"');
  assert.equal(oct(2).actual, 23);
});

test('assinatura cobrada no cartão aparece na coluna do mês em que a fatura vence', () => {
  const b = buildBudget({
    items: [
      { id: 'c', name: 'Claude', values: [0, 120, 120] },
      { id: 'a', name: 'Academia', values: [0, 0, 149.9] },
    ],
    months: ['OUT', 'NOV', 'DEZ'],
    cards: [],
    cycle: { start: '2026-09-27', dueMonth: '2026-11' },
    now: NOW,
    transactions: [
      // Cobrado em setembro, na fatura que vence em outubro.
      tx({ key: 'ANTHROPIC* CLAUDE SUB', name: 'Claude (Anthropic)', description: 'ANTHROPIC* CLAUDE SUB', cents: 11434, date: new Date('2026-09-14T15:00:00.000Z'), dueMonth: '2026-10' }),
      // Cobrado em 01/10, já na fatura aberta que vence em novembro.
      tx({ key: 'TOTALPASS', name: 'TotalPass', kind: 'academia', sub: 'Academia', famId: '18', cents: 14990, date: new Date('2026-10-01T15:00:00.000Z'), dueMonth: '2026-11' }),
    ],
  });
  const paid = (row: number, i: number) => (b.rows[row].months[i] as { paid: { amount: number; date: string; onCard: boolean } | null }).paid;
  assert.deepEqual(paid(0, 0), { ...paid(0, 0)!, amount: 114.34, date: '2026-09-14', onCard: true });
  assert.equal(paid(0, 1), null);
  // Novembro ainda não começou no calendário, mas a cobrança já está na fatura dele.
  assert.deepEqual([paid(1, 0), paid(1, 1)?.amount, paid(1, 1)?.onCard], [null, 149.9, true]);
});

test('conta fixa: cobrança isolada vence o total da contraparte, e valor muito diferente não é aceito', () => {
  const b = budget(
    [
      ['Google One', [9.9, 9.9, 9.9]],
      ['Seguro Veicular', [373, 373, 373]],
    ],
    [
      // A mesma contraparte cobra duas assinaturas diferentes.
      tx({ key: 'GOOGLE', name: 'Google', description: 'GOOGLE YOUTUBEPREMIUM', cents: 2690 }),
      tx({ key: 'GOOGLE', name: 'Google', description: 'GOOGLE G1SK002M', cents: 999 }),
      // Seguro de viagem de R$ 183 não é o seguro do carro de R$ 373.
      tx({ key: 'ASSIST CARD', name: 'Assist Card', famId: '20', sub: 'Seguros', cents: 18323 }),
    ],
  );
  const paid = (i: number) => (b.rows[i].months[1] as { paid: { amount: number; count: number } | null }).paid;
  assert.deepEqual([paid(0)?.amount, paid(0)?.count], [9.99, 1]);
  assert.equal(paid(1), null);
});

test('cada cobrança fica com uma linha só: YouTube e Google One não se somam', () => {
  const b = budget(
    [
      ['Youtube', [0, 0, 26.9]],
      ['Google One', [0, 0, 9.9]],
      ['Claude', [0, 0, 120]],
    ],
    [
      // Mesmo fornecedor ("Google"), cobranças diferentes; as linhas estão zeradas neste mês.
      tx({ key: 'GOOGLE', name: 'Google', description: 'GOOGLE YOUTUBEPREMIUM', cents: 2690 }),
      tx({ key: 'GOOGLE', name: 'Google', description: 'GOOGLE G1SK002M', cents: 999 }),
      // A mesma assinatura cobrada mais de uma vez continua somando, e diz quantas foram.
      tx({ key: 'ANTHROPIC* CLAUDE SUB', name: 'Claude (Anthropic)', description: 'ANTHROPIC* CLAUDE SUB', cents: 11434 }),
      tx({ key: 'ANTHROPIC* CLAUDE SUB', name: 'Claude (Anthropic)', description: 'ANTHROPIC* CLAUDE SUB', cents: 48739, date: new Date('2026-10-09T15:00:00.000Z') }),
    ],
  );
  const paid = (i: number) => (b.rows[i].months[1] as { paid: { amount: number; count: number } | null }).paid;
  assert.deepEqual([paid(0)?.amount, paid(0)?.count], [26.9, 1]);
  assert.deepEqual([paid(1)?.amount, paid(1)?.count], [9.99, 1]);
  assert.deepEqual([paid(2)?.amount, paid(2)?.count], [601.73, 2]);
});

test('cobrança recente com descrição genérica é reconhecida pelo valor igual ao da fatura anterior', () => {
  const b = buildBudget({
    items: [
      { id: 'g', name: 'Google One', values: [0, 0, 9.9] },
      { id: 'y', name: 'Youtube', values: [0, 0, 26.9] },
    ],
    months: ['OUT', 'NOV', 'DEZ'],
    cards: [],
    cycle: { start: '2026-09-27', dueMonth: '2026-11' },
    now: NOW,
    transactions: [
      tx({ key: 'GOOGLE ONE', name: 'Google One', description: 'GOOGLE ONE', cents: 999, date: new Date('2026-09-01T15:00:00.000Z'), dueMonth: '2026-10', source: 'C6 BANK · cartão' }),
      tx({ key: 'GOOGLE', name: 'Google', description: 'GOOGLE YOUTUBEPREMIUM', cents: 2690, date: new Date('2026-09-03T15:00:00.000Z'), dueMonth: '2026-10', source: 'C6 BANK · cartão' }),
      // Outubro: o banco ainda manda a do Google One sem nome; a do YouTube não chegou.
      tx({ key: 'COMPRA A VISTA SEM JUROS MASTE', name: 'Compra a Vista Sem Juros Maste', description: 'Compra a Vista sem Juros Maste', cents: 999, date: new Date('2026-10-01T15:00:00.000Z'), dueMonth: '2026-11', source: 'C6 BANK · cartão' }),
      // Mesmo valor em outro cartão não conta.
      tx({ key: 'COMPRA A VISTA', name: 'Compra a Vista', description: 'Compra a Vista sem Juros Visa', cents: 2690, date: new Date('2026-10-03T15:00:00.000Z'), dueMonth: '2026-11', source: 'Nubank · cartão' }),
    ],
  });
  const paid = (row: number, i: number) => (b.rows[row].months[i] as { paid: { amount: number; date: string; name: string; byAmount: boolean; onCard: boolean } | null }).paid;
  assert.deepEqual([paid(0, 0)?.amount, paid(0, 0)?.byAmount], [9.99, false]);
  assert.deepEqual([paid(0, 1)?.amount, paid(0, 1)?.date, paid(0, 1)?.name, paid(0, 1)?.byAmount, paid(0, 1)?.onCard], [9.99, '2026-10-01', 'Google One', true, true]);
  assert.equal(paid(1, 1), null);
});

test('conta ainda não paga no mês mostra quando e quanto foi no mês anterior', () => {
  const sept = (over: Partial<BudgetTx>) => tx({ date: new Date('2026-09-04T15:00:00.000Z'), source: 'Nubank · conta', famId: '02', ...over });
  const b = budget(
    [
      ['Empréstimo Nubank', [1236, 1236, 1236]],
      ['Financiamento Veicular', [1623, 1623, 1623]],
      ['Financiamento Estudantil', [360, 360, 360]],
    ],
    [
      sept({ key: 'PARCELA PAGA | CONTAS', name: 'Parcela Paga', description: 'Parcela Paga | Contas', cents: 123228 }),
      sept({ key: 'SEGURO EMP', name: 'Seguro', description: 'Pagamento do seguro de empréstimo efetuado', cents: 4922, date: new Date('2026-09-14T15:00:00.000Z') }),
      sept({ key: 'BX.ANT.FINANC/EMP', name: 'Bx.ant.financ/emp', description: 'BX.ANT.FINANC/EMP - CONTRATO 1', cents: 161564, source: 'Bradesco · conta' }),
      sept({ key: 'FIES JRS/AMORT', name: 'Fies', description: 'FIES JRS/AMORT', cents: 1, famId: '15' }),
      ...[15, 16].map((d) => sept({ key: 'FIES JRS/AMORT', name: 'Fies', description: 'FIES JRS/AMORT', cents: 18000, famId: '15', date: new Date(`2026-09-${d}T15:00:00.000Z`) })),
      // Outubro: só o financiamento já saiu.
      tx({ key: 'BX.ANT.FINANC/EMP', name: 'Bx.ant.financ/emp', description: 'BX.ANT.FINANC/EMP - CONTRATO 1', cents: 162000, famId: '02', source: 'Bradesco · conta' }),
    ],
  );
  const oct = (i: number) => b.rows[i].months[1] as { paid: { amount: number } | null; previous: { amount: number; date: string; firstDate: string; count: number } | null };
  assert.deepEqual([oct(0).paid, oct(0).previous], [null, { amount: 1232.28, date: '2026-09-04', firstDate: '2026-09-04', count: 1 }]);
  assert.deepEqual([oct(1).paid?.amount, oct(1).previous], [1620, null]);
  // O FIES vem em várias linhas: a referência traz o intervalo de datas e a quantidade.
  // O FIES pago a partir do dia 15 de setembro (com o vale) já é a conta de outubro, quitada.
  assert.deepEqual([(oct(2).paid as { amount: number; ahead: boolean } | null)?.amount, (oct(2).paid as { ahead: boolean } | null)?.ahead, oct(2).previous], [360, true, null]);
  assert.equal((oct(1).paid as { ahead: boolean } | null)?.ahead, false);
  // Mês passado (SET) e futuro (NOV) não trazem a referência.
  assert.equal((b.rows[0].months[2] as { previous: unknown }).previous, null);
});

test('quando só um de vários lançamentos iguais é escolhido, a resposta diz quantos são e quanto somam', () => {
  const b = budget(
    [['Financiamento Estudantil', [360, 360, 360]]],
    [1, 2, 3, 4].map((d, i) => tx({ key: 'FIES JRS/AMORT', name: 'Fies', description: 'FIES JRS/AMORT', famId: '15', source: 'BB · conta', cents: [20167, 16125, 15721, 15721][i], date: new Date(`2026-10-0${d}T15:00:00.000Z`) })),
  );
  const paid = (b.rows[0].months[1] as { paid: { amount: number; count: number; sameCount: number; sameTotal: number; differs: boolean } | null }).paid;
  // O total (677,34) foge demais dos 360 planejados; fica a linha mais próxima, marcada como diferente.
  assert.deepEqual([paid?.amount, paid?.count, paid?.sameCount, paid?.sameTotal, paid?.differs], [201.67, 1, 4, 677.34, true]);
});

test('tentativa de débito desfeita pelo banco não conta: sobra só o que foi pago de fato', () => {
  const row = (id: string, type: string, day: number, cents: number, description = 'FIES JRS/AMORT', accountId = 'bb') => ({ id, accountId, type, date: new Date(`2026-09-${day}T02:59:00.000Z`), description, cents });
  const out = reversedDebits([
    row('d1', 'DEBIT', 16, 20167),
    row('d2', 'DEBIT', 17, 16125),
    row('e2', 'CREDIT', 17, 16125, 'ESTORNO DEBITO'),
    row('d3', 'DEBIT', 18, 15721),
    row('e3', 'CREDIT', 18, 15721, 'ESTORNO DEBITO'),
    row('d4', 'DEBIT', 19, 15721),
    row('e4', 'CREDIT', 19, 15721, 'ESTORNO DEBITO'),
    row('d5', 'DEBIT', 22, 15723),
    // Pix recebido de mesmo valor não é estorno; estorno em outra conta não casa.
    row('p', 'CREDIT', 16, 20167, 'PIX - RECEBIDO'),
    row('x', 'CREDIT', 22, 15723, 'ESTORNO DEBITO', 'outra'),
  ]);
  assert.deepEqual([...out].sort(), ['d2', 'd3', 'd4', 'e2', 'e3', 'e4']);
});

test('aluguel, condomínio e IPTU pagos numa transferência só são reconhecidos pela soma', () => {
  const pix = (over: Partial<BudgetTx>) => tx({ key: 'JOSE', name: 'Jose', description: 'Transferência enviada pelo Pix|JOSE', famId: '05', sub: 'Transfers', source: 'Nubank · conta', ...over });
  const b = budget(
    [
      ['Aluguel', [3663, 3663, 3663]],
      ['Condomínio', [295, 295, 295]],
      ['IPTU', [100, 100, 100]],
    ],
    [
      pix({ cents: 405566, date: new Date('2026-09-04T15:00:00.000Z') }),
      // Outubro: pago uns dias antes da virada. Um Pix de R$ 100 qualquer não é o IPTU.
      pix({ cents: 405800, date: new Date('2026-09-28T15:00:00.000Z') }),
      pix({ key: 'AMIGO', name: 'Amigo', description: 'Transferência enviada pelo Pix|AMIGO', cents: 10000 }),
    ],
  );
  type Paid = { amount: number; date: string; ahead: boolean; joint: { total: number; with: string[] } | null } | null;
  const paid = (row: number, i: number) => (b.rows[row].months[i] as { paid: Paid }).paid;
  assert.deepEqual([paid(0, 0)?.amount, paid(0, 0)?.date, paid(0, 0)?.joint], [3660.89, '2026-09-04', { total: 4055.66, with: ['Condomínio', 'IPTU'] }]);
  assert.deepEqual([paid(1, 0)?.amount, paid(2, 0)?.amount], [294.83, 99.94]);
  assert.deepEqual([paid(0, 1)?.amount, paid(0, 1)?.ahead, paid(2, 1)?.amount], [3663, false, 100]);
  assert.equal(paid(0, 2), null);
});

test('fatura do mês sem compras, com a do mês seguinte já aberta, aparece como fechada zerada', () => {
  const b = budget(
    [['Bradesco (fatura)', [0, 0, 865.58]]],
    [],
    [{ bank: 'Banco Bradesco', closedBill: null, openBill: { amount: 865.58, dueDate: '2026-11-05' }, upcomingBills: [] }] as Parameters<typeof buildBudget>[0]['cards'],
  );
  const m = (i: number) => b.rows[0].months[i] as { suggested: number | null; billState: string | null };
  assert.deepEqual([m(0).suggested, m(0).billState], [null, null]);
  assert.deepEqual([m(1).suggested, m(1).billState], [0, 'closed']);
  assert.deepEqual([m(2).suggested, m(2).billState], [865.58, 'open']);
});

test('gasto controlável: separa o que não está em fatura (cartão sem linha de fatura, conta no mês)', () => {
  const b = buildBudget({
    items: [
      { id: 'a', name: 'Alimentação', controllable: true, values: [1800, 1800, 1800] },
      { id: 'n', name: 'Nu Bank (fatura)', values: [0, 0, 0] },
      { id: 'y', name: 'Youtube', values: [26.9, 26.9, 26.9] },
      { id: 'i', name: 'iCloud', values: [19.9, 19.9, 19.9] },
    ],
    months: ['OUT', 'NOV', 'DEZ'],
    cards: [],
    cycle: { start: '2026-09-23', dueMonth: '2026-11' },
    now: NOW,
    transactions: [
      // Cartão com linha de fatura (Nubank) e cartão sem (C6), ambos na fatura de novembro.
      tx({ key: 'MERCADO', name: 'Mercado', famId: '10', sub: 'Mercado', cents: 30000, dueMonth: '2026-11', source: 'Nu Pagamentos S.A. · cartão' }),
      tx({ key: 'PADARIA', name: 'Padaria', famId: '10', sub: 'Mercado', cents: 5000, dueMonth: '2026-11', source: 'C6 BANK · cartão' }),
      // Débito na conta em outubro: conta no limite do ciclo e é despesa do mês de outubro.
      tx({ key: 'FEIRA', name: 'Feira', famId: '10', sub: 'Mercado', cents: 4000, date: new Date('2026-10-03T15:00:00.000Z'), source: 'Nubank · conta' }),
      tx({ key: 'GOOGLE', name: 'Google', description: 'GOOGLE YOUTUBEPREMIUM', cents: 2690, dueMonth: '2026-11', source: 'Nu Pagamentos S.A. · cartão' }),
      tx({ key: 'APPLE', name: 'Apple', description: 'APPLE.COM/BILL', cents: 1990, dueMonth: '2026-11', source: 'C6 BANK · cartão' }),
    ],
  });
  const limit = (i: number) => b.rows[0].months[i] as { actual: number; fromAccount: number; offBill: number; accountInMonth: number };
  assert.deepEqual([limit(1).actual, limit(1).fromAccount, limit(1).offBill, limit(1).accountInMonth], [390, 40, 50, 0]);
  // Na coluna de outubro o débito em conta aparece como despesa do mês.
  assert.equal(limit(0).accountInMonth, 40);
  const paid = (row: number) => (b.rows[row].months[1] as { paid: { onCard: boolean; billRow: boolean } | null }).paid;
  assert.deepEqual([paid(2)?.onCard, paid(2)?.billRow], [true, true]);
  assert.deepEqual([paid(3)?.onCard, paid(3)?.billRow], [true, false]);
});

test('previsão de fatura futura: parcelas contratadas + mediana das compras avulsas das últimas faturas', () => {
  const nu = (over: Partial<BudgetTx>) => tx({ source: 'Nu Pagamentos S.A. · cartão', ...over });
  const b = buildBudget({
    items: [
      { id: 'n', name: 'Nu Bank (fatura)', values: [0, 0, 0] },
      { id: 'c', name: 'C6 Bank (fatura)', values: [0, 0, 0] },
      { id: 'a', name: 'Alimentação', controllable: true, values: [1800, 1800, 1800] },
      { id: 'y', name: 'Youtube', values: [26.9, 26.9, 26.9] },
    ],
    months: ['OUT', 'NOV', 'DEZ'],
    cards: [
      { bank: 'Nu Pagamentos S.A.', closedBill: { amount: 900, dueDate: '2026-10-06' }, openBill: { amount: 500, dueDate: '2026-11-06' }, upcomingBills: [{ dueMonth: '2026-12', amount: 300 }] },
      { bank: 'C6 BANK', closedBill: null, openBill: { amount: 50, dueDate: '2026-11-05' }, upcomingBills: [] },
    ] as Parameters<typeof buildBudget>[0]['cards'],
    cycle: { start: '2026-09-23', dueMonth: '2026-11' },
    now: NOW,
    transactions: [
      // Compras avulsas do Nubank nas quatro últimas faturas fechadas: 400, 600, 1000 (atípico), 200.
      nu({ cents: 40000, dueMonth: '2026-10' }),
      nu({ cents: 60000, dueMonth: '2026-09' }),
      nu({ cents: 100000, dueMonth: '2026-08' }),
      nu({ cents: 20000, dueMonth: '2026-07' }),
      // Não entram: mercado (linha de limite), assinatura (linha própria), parcela em andamento.
      nu({ cents: 90000, dueMonth: '2026-10', famId: '10', sub: 'Mercado' }),
      nu({ cents: 2690, dueMonth: '2026-10', key: 'GOOGLE', name: 'Google', description: 'GOOGLE YOUTUBEPREMIUM' }),
      nu({ cents: 30000, dueMonth: '2026-10', installment: 4 }),
      // Entra: primeira parcela de uma compra nova é gasto daquele ciclo.
      nu({ cents: 10000, dueMonth: '2026-09', installment: 1 }),
      // Viagem e transferência no cartão são eventos: ficam fora do típico e somam à parte.
      nu({ cents: 250000, dueMonth: '2026-08', famId: '12', sub: 'Viagem' }),
      nu({ cents: 50000, dueMonth: '2026-07', famId: '05', sub: 'Pix no crédito' }),
      // Fatura aberta não é histórico.
      nu({ cents: 77700, dueMonth: '2026-11' }),
      // C6: só um ciclo de histórico, não dá para estimar.
      tx({ cents: 5000, dueMonth: '2026-10', source: 'C6 BANK · cartão' }),
    ],
  });
  type Bill = { suggested: number | null; billState: string | null; forecast: { installments: number; typical: number; low: number; high: number; cycles: number; events: number; total: number } | null };
  const bill = (row: number, i: number) => b.rows[row].months[i] as Bill;
  // Ciclos: out 400, set 700 (600 + 100 da parcela nova), ago 1000, jul 200 -> mediana 550.
  const { history, ...numbers } = bill(0, 2).forecast as NonNullable<Bill['forecast']> & { history: Array<{ dueMonth: string; amount: number; top: Array<{ name: string; amount: number }> }> };
  assert.deepEqual(numbers, { installments: 300, typical: 550, low: 200, high: 1000, cycles: 4, events: 3000, total: 850 });
  assert.deepEqual(history.map((h) => [h.dueMonth, h.amount, h.top.length]), [['2026-10', 400, 1], ['2026-09', 700, 2], ['2026-08', 1000, 1], ['2026-07', 200, 1]]);
  assert.deepEqual([bill(0, 2).suggested, bill(0, 2).billState], [850, 'projected']);
  // Fatura fechada e aberta seguem pelo valor do banco, sem previsão.
  assert.deepEqual([bill(0, 0).suggested, bill(0, 0).forecast, bill(0, 1).suggested, bill(0, 1).forecast], [900, null, 500, null]);
  // Histórico insuficiente: sem previsão.
  assert.deepEqual([bill(1, 2).suggested, bill(1, 2).forecast], [null, null]);
});

test('entradas: um crédito vale para uma linha só, e linha sem valor previsto não reconhece nada', () => {
  const b = buildBudget({
    items: [
      { id: 's', name: 'Salário', section: 'entrada', values: [9692.45, 9692.45, 9692.45] },
      { id: 'a', name: 'Adiantamento dia 20', section: 'entrada', values: [0, 1055.68, 1055.68] },
      { id: 'd', name: '13º salário', section: 'entrada', values: [0, 0, 9000] },
    ],
    months: ['OUT', 'NOV', 'DEZ'],
    cards: [],
    transactions: [],
    income: [tx({ date: new Date('2026-10-05T12:00:00.000Z'), cents: 969245, key: 'EMPRESA', name: 'Empresa', description: 'Pagamento de salário recebido', sub: 'Salary', famId: '01', source: 'PicPay · conta' })],
    now: NOW,
  });
  const received = (row: number) => (b.rows[row].months[0] as { received: { amount: number } | null }).received;
  assert.deepEqual([received(0)?.amount, received(1), received(2)], [9692.45, null, null]);
});

test('dois créditos de salário no mês: cada linha fica com o de valor mais próximo do seu', () => {
  const pay = (day: number, cents: number) => tx({ date: new Date(`2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`), cents, key: 'EMPRESA', name: 'Empresa', description: 'Pagamento de salário recebido', sub: 'Salary', famId: '01', source: 'PicPay · conta' });
  const b = buildBudget({
    items: [
      { id: 's', name: 'Salário', section: 'entrada', values: [9692.45] },
      { id: 'a', name: 'Adiantamento dia 20', section: 'entrada', values: [1055.68] },
    ],
    months: ['OUT'],
    cards: [],
    transactions: [],
    income: [pay(13, 105568), pay(5, 969245)],
    now: NOW,
  });
  const received = (row: number) => (b.rows[row].months[0] as { received: { amount: number; date: string } | null }).received;
  assert.deepEqual([received(0)?.amount, received(0)?.date, received(1)?.amount, received(1)?.date], [9692.45, '2026-10-05', 1055.68, '2026-10-13']);
});

test('fatura do mês continua valendo depois de vencer; só é "fechou zerada" quando não houve fatura', () => {
  const b = budget(
    [
      ['C6 Bank (fatura)', [0, 617.95, 442.81]],
      ['Bradesco (fatura)', [0, 0, 865.58]],
    ],
    [],
    [
      // C6: a fatura de outubro venceu dia 05 (hoje é 15): não está mais "a pagar", mas existiu.
      { bank: 'C6 BANK', closedBill: null, openBill: { amount: 442.81, dueDate: '2026-11-05' }, upcomingBills: [], pastBills: [{ dueMonth: '2026-10', amount: 617.95, dueDate: '2026-10-05' }] },
      { bank: 'Banco Bradesco', closedBill: null, openBill: { amount: 865.58, dueDate: '2026-11-05' }, upcomingBills: [], pastBills: [] },
    ] as Parameters<typeof buildBudget>[0]['cards'],
  );
  const m = (row: number, i: number) => b.rows[row].months[i] as { suggested: number | null; billState: string | null; dueDate: string | null };
  assert.deepEqual([m(0, 1).suggested, m(0, 1).billState, m(0, 1).dueDate], [617.95, 'closed', '2026-10-05']);
  assert.deepEqual([m(1, 1).suggested, m(1, 1).billState], [0, 'closed']);
});

test('marcar como pago: vale na hora, confere na leitura do dia seguinte e cai se nenhum banco confirmar', () => {
  const run = (over: { lastSyncAt?: Date; transactions?: BudgetTx[]; planned?: number }) =>
    buildBudget({
      items: [{ id: 'gas', name: 'Gás', values: [0, over.planned ?? 35, 35] }],
      months: ['SET', 'OUT', 'NOV'],
      cards: [],
      transactions: over.transactions ?? [],
      marks: [{ itemId: 'gas', month: '2026-10', markedAt: new Date('2026-10-14T18:00:00.000Z') }],
      lastSyncAt: over.lastSyncAt ?? null,
      now: NOW,
    });
  const paid = (b: ReturnType<typeof run>) => (b.rows[0].months[1] as { paid: { amount: number; manual: string | null; source: string } | null }).paid;

  // Marcada dia 14; os bancos foram lidos pela última vez no próprio dia 14: ainda vale.
  const pending = run({ lastSyncAt: new Date('2026-10-14T23:30:00.000Z') });
  assert.deepEqual([paid(pending)?.manual, paid(pending)?.amount, pending.staleMarks], ['pending', 35, []]);

  // Leitura feita no dia 15 (horário de Brasília) sem pagamento compatível: a marcação cai.
  const dropped = run({ lastSyncAt: new Date('2026-10-15T05:30:00.000Z') });
  assert.deepEqual([paid(dropped), dropped.staleMarks], [null, [{ itemId: 'gas', month: '2026-10' }]]);

  // Algum banco mostra um pagamento de valor compatível: confirmada, com os dados do banco.
  const proof = tx({ key: 'PIX X', name: 'Pix X', description: 'Pagamento de boleto', famId: '05', sub: 'Transfers', cents: 3460, source: 'PicPay · conta', date: new Date('2026-10-14T15:00:00.000Z') });
  const confirmed = run({ lastSyncAt: new Date('2026-10-15T05:30:00.000Z'), transactions: [proof] });
  assert.deepEqual([paid(confirmed)?.manual, paid(confirmed)?.amount, paid(confirmed)?.source, confirmed.staleMarks], ['confirmed', 34.6, 'PicPay · conta', []]);

  // Compra antiga no cartão com o mesmo valor NÃO é prova (nem lançamento antigo da conta).
  const oldCard = tx({ key: 'LOJA', name: 'Loja', cents: 3500, dueMonth: '2026-10', date: new Date('2026-09-25T15:00:00.000Z'), source: 'Nu Pagamentos S.A. · cartão' });
  const oldAccount = { ...proof, date: new Date('2026-10-02T15:00:00.000Z') };
  const recentCard = { ...oldCard, date: new Date('2026-10-14T15:00:00.000Z') };
  const noProof = run({ lastSyncAt: new Date('2026-10-14T23:30:00.000Z'), transactions: [oldCard, oldAccount, recentCard] });
  assert.deepEqual([paid(noProof)?.manual, paid(noProof)?.source], ['pending', 'manual']);
  // Compra de consumo na conta (posto, mercado) com o mesmo valor também não.
  const fuel = { ...proof, famId: '19', sub: 'Combustível' };
  assert.equal(paid(run({ lastSyncAt: new Date('2026-10-14T23:30:00.000Z'), transactions: [fuel] }))?.manual, 'pending');

  // Valor fora da tolerância não confirma.
  const far = run({ lastSyncAt: new Date('2026-10-15T05:30:00.000Z'), transactions: [{ ...proof, cents: 5000 }] });
  assert.equal(paid(far), null);
});

test('marcação fica sem uso quando o pagamento é reconhecido sozinho', () => {
  const b = buildBudget({
    items: [{ id: 'agua', name: 'Água', values: [0, 50, 50] }],
    months: ['SET', 'OUT', 'NOV'],
    cards: [],
    transactions: [tx({ key: 'SAAE', name: 'Servico Autonom', description: 'Pagamento efetuado|Servico Autonomo de Agua', famId: '17', sub: 'Água', cents: 4562, source: 'Nubank · conta' })],
    marks: [{ itemId: 'agua', month: '2026-10', markedAt: new Date('2026-10-14T18:00:00.000Z') }],
    lastSyncAt: null,
    now: NOW,
  });
  const paid = (b.rows[0].months[1] as { paid: { manual: string | null } | null }).paid;
  assert.deepEqual([paid?.manual, b.staleMarks], [null, [{ itemId: 'agua', month: '2026-10' }]]);
});

test('marcar como pago uma conta que o banco mostra com valor diferente do previsto: fica paga, com o valor real', () => {
  const b = buildBudget({
    items: [{ id: 'net', name: 'Internet', values: [0, 245, 245] }],
    months: ['SET', 'OUT', 'NOV'],
    cards: [],
    transactions: [tx({ key: 'CLARO', name: 'Claro', description: 'Pagamento efetuado|CLARO', famId: '17', sub: 'Internet', cents: 12990, source: 'Banco Bradesco · conta' })],
    marks: [{ itemId: 'net', month: '2026-10', markedAt: new Date('2026-10-14T18:00:00.000Z') }],
    lastSyncAt: new Date('2026-10-15T05:30:00.000Z'),
    now: NOW,
  });
  const paid = (b.rows[0].months[1] as { paid: { amount: number; manual: string | null; differs: boolean; onCard: boolean } | null }).paid;
  assert.deepEqual([paid?.amount, paid?.manual, paid?.differs, paid?.onCard, b.staleMarks], [129.9, 'confirmed', false, false, []]);
});

test('dívida de cartão: soma as faturas depois da aberta de todos os cartões, sem a aberta nem a fechada', () => {
  const b = budget(
    [['Nu Bank (fatura)', [0, 0, 0]]],
    [],
    [
      { bank: 'Nu Pagamentos S.A.', closedBill: { amount: 900, dueDate: '2026-10-06' }, openBill: { amount: 500, dueDate: '2026-11-06' }, upcomingBills: [{ dueMonth: '2026-12', amount: 348.01 }, { dueMonth: '2027-01', amount: 141.71 }] },
      { bank: 'C6 BANK', closedBill: null, openBill: { amount: 442.81, dueDate: '2026-11-05' }, upcomingBills: [{ dueMonth: '2026-12', amount: 259.99 }] },
      { bank: 'Banco Bradesco', closedBill: null, openBill: { amount: 865.58, dueDate: '2026-11-05' }, upcomingBills: [] },
    ] as Parameters<typeof buildBudget>[0]['cards'],
  );
  assert.deepEqual(b.cardDebt, { total: 749.71, bills: [{ dueMonth: '2026-12', amount: 608 }, { dueMonth: '2027-01', amount: 141.71 }] });
});

test('previsão: parcela contratada que já tem linha própria não entra de novo pela fatura', () => {
  const brad = (over: Partial<BudgetTx>) => tx({ source: 'Banco Bradesco · cartão', ...over });
  const b = buildBudget({
    items: [
      { id: 'b', name: 'Bradesco (fatura)', values: [0, 0, 0] },
      { id: 's', name: 'Seguro Veicular', values: [0, 372.73, 373] },
    ],
    months: ['OUT', 'NOV', 'DEZ'],
    cards: [{ bank: 'Banco Bradesco', closedBill: null, openBill: { amount: 885.31, dueDate: '2026-11-05' }, upcomingBills: [{ dueMonth: '2026-12', amount: 472.73 }] }] as Parameters<typeof buildBudget>[0]['cards'],
    cycle: { start: '2026-09-23', dueMonth: '2026-11' },
    now: NOW,
    transactions: [
      // Seguro do carro parcelado no cartão: parcela 3 de 12 na fatura de novembro.
      brad({ key: 'BRADESCO AUT*', name: 'Bradesco Seguros', kind: 'seguro do carro', description: 'BRADESCO AUT*03de12', cents: 37273, dueMonth: '2026-11', installment: 3, installmentTotal: 12 }),
      // Outra compra parcelada, sem linha própria: 2 de 3, R$ 100.
      brad({ key: 'LOJA', name: 'Loja', cents: 10000, dueMonth: '2026-11', installment: 2, installmentTotal: 3 }),
      // Histórico para a parte avulsa.
      brad({ cents: 5000, dueMonth: '2026-10' }),
      brad({ cents: 5000, dueMonth: '2026-09' }),
    ],
  });
  const f = (b.rows[0].months[2] as { forecast: { installments: number; typical: number; total: number } | null }).forecast;
  // Dos R$ 472,73 contratados para dezembro, os R$ 372,73 do seguro já estão na linha "Seguro Veicular".
  assert.deepEqual([f?.installments, f?.typical, f?.total], [100, 50, 150]);
});

test('dinheiro em conta soma todos os bancos; Pix entra pelo período da coluna, separado em recebido e enviado', () => {
  const pix = (day: string, cents: number, incoming: boolean, name: string) => ({ date: new Date(`${day}T15:00:00.000Z`), cents, incoming, name });
  const b = buildBudget({
    items: [{ id: 'a', name: 'Aluguel', values: [3663, 3663, 3663] }],
    months: ['SET', 'OUT', 'NOV'],
    cards: [],
    transactions: [],
    cash: [
      { bank: 'Nubank', name: 'Conta', balance: 1200.5 },
      { bank: 'Bradesco', name: 'Conta', balance: -150.25 },
    ],
    pix: [pix('2026-10-02', 100000, true, 'Empresa'), pix('2026-10-03', 5000, true, 'Amigo'), pix('2026-10-05', 30000, false, 'Mercado'), pix('2026-10-06', 30000, false, 'Mercado'), pix('2026-09-20', 99900, false, 'Setembro'), pix('2026-10-20', 77700, false, 'Futuro')],
    now: NOW,
  });
  assert.deepEqual(b.cash, { total: 1050.25, accounts: [{ bank: 'Nubank', name: 'Conta', balance: 1200.5 }, { bank: 'Bradesco', name: 'Conta', balance: -150.25 }] });
  // Outubro (sem ciclo de cartão conhecido, vale o mês de calendário); o Pix do dia 20 ainda não aconteceu.
  const { items, ...sides } = b.months[1].pix!;
  assert.deepEqual(items.map((t) => [t.date, t.name, t.amount, t.incoming]), [['2026-10-06', 'Mercado', 300, false], ['2026-10-05', 'Mercado', 300, false], ['2026-10-03', 'Amigo', 50, true], ['2026-10-02', 'Empresa', 1000, true]]);
  assert.deepEqual(sides, {
    received: { total: 1050, count: 2, top: [{ name: 'Empresa', amount: 1000 }, { name: 'Amigo', amount: 50 }] },
    sent: { total: 600, count: 2, top: [{ name: 'Mercado', amount: 600 }] },
  });
  assert.equal(b.months[0].pix?.sent.total, 999);
});
