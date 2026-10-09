// Regras dos alertas, resumo diário e totais do mês. Rodar: npm test (em server/).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { billInTotal, calculateMonthly, controllableInTotal, coveredByCard, netAdvance, paidAhead } from '../../client/src/calc';
import { latestTelegramChat, maskEmail, sendTelegram, telegramBotName } from '../src/alerts/channels';
import { decryptSecret, DEFAULT_CONFIG, digestDue, encryptSecret, normalizeConfig, parseRecipients } from '../src/alerts/config';
import { AlertInput, buildDigest, DEFAULT_THRESHOLDS, dueSoon, evaluateAlerts } from '../src/alerts/rules';
import { monthTotals, TotalsItem, TotalsRow } from '../src/alerts/totals';

// Quinta, 08/10/2026, 09:00 em Brasília.
const NOW = new Date('2026-10-08T12:00:00.000Z');
const base = (over: Partial<AlertInput> = {}): AlertInput => ({
  now: NOW,
  months: [
    { label: 'OUT', month: '2026-10', state: 'current', cycle: { start: '2026-08-23', end: '2026-09-22', state: 'past' } },
    { label: 'NOV', month: '2026-11', state: 'future', cycle: { start: '2026-09-23', end: '2026-10-22', state: 'current' } },
  ],
  rows: [],
  cash: { total: 5000 },
  totals: [
    { entradas: 15000, saidas: 15600, subtotal: -600 },
    { entradas: 12000, saidas: 14000, subtotal: -2000 },
  ],
  yesterday: null,
  cards: null,
  connections: [],
  thresholds: DEFAULT_THRESHOLDS,
  ...over,
});
const keys = (input: AlertInput) => evaluateAlerts(input).map((a) => `${a.severity} ${a.key}`);

test('fatura fechada: avisa 3 dias antes e no dia; depois de vencida ou zerada, não', () => {
  const bill = (dueDate: string, suggested = 1200) => ({ itemId: 'nu', name: 'Nu Bank (fatura)', type: 'cardBill', months: [{ suggested, billState: 'closed', dueDate }, {}] });
  assert.deepEqual(keys(base({ rows: [bill('2026-10-10')] })), ['attention billdue:nu:2026-10-10:soon']);
  assert.deepEqual(keys(base({ rows: [bill('2026-10-08')] })), ['urgent billdue:nu:2026-10-08:today']);
  assert.deepEqual(keys(base({ rows: [bill('2026-10-06')] })), []);
  assert.deepEqual(keys(base({ rows: [bill('2026-10-20')] })), []);
  assert.deepEqual(keys(base({ rows: [bill('2026-10-08', 0)] })), []);
});

test('conta fixa: avisa quando passou do dia de costume e nenhum banco mostra; paga ou ainda no prazo, não', () => {
  const row = (previousDate: string, paid: { amount: number; date: string } | null = null) => ({
    itemId: 'emp',
    name: 'Empréstimo Nubank',
    type: 'fixed',
    months: [{ planned: 1236, paid, previous: { amount: 1232.28, date: previousDate } }, { planned: 1236 }],
  });
  // Mês passado saiu dia 04; hoje é dia 08 (mais de 2 dias depois).
  const late = evaluateAlerts(base({ rows: [row('2026-09-04')] }));
  assert.deepEqual(late.map((a) => a.key), ['late:emp:2026-10']);
  assert.match(late[0].body, /dia 04 .*04\/09.*R\$ 1\.236,00/);
  assert.deepEqual(keys(base({ rows: [row('2026-09-07')] })), []);
  assert.deepEqual(keys(base({ rows: [row('2026-09-04', { amount: 1236, date: '2026-10-05' })] })), []);
});

test('limites do ciclo em andamento: ritmo, perto e estourado; ciclo encerrado não avisa', () => {
  const row = (actual: number, projected: number | null) => ({
    itemId: 'ali',
    name: 'Alimentação',
    type: 'limit',
    // Coluna 0 é ciclo passado (não avisa, mesmo estourado); coluna 1 é o ciclo em andamento.
    months: [{ actual: 3100, limit: 1800, used: 3100 / 1800 }, { actual, limit: 1800, used: actual / 1800, projected }],
  });
  assert.deepEqual(keys(base({ rows: [row(900, 1500)] })), []);
  assert.deepEqual(keys(base({ rows: [row(900, 2200)] })), ['info limitpace:ali:2026-11']);
  assert.deepEqual(keys(base({ rows: [row(1500, 2400)] })), ['attention limitnear:ali:2026-11']);
  assert.deepEqual(keys(base({ rows: [row(1900, 2600)] })), ['attention limitover:ali:2026-11']);
});

test('dinheiro em conta abaixo do que vence em 7 dias é urgente; suficiente, não', () => {
  const rows = [
    { itemId: 'nu', name: 'Nu Bank (fatura)', type: 'cardBill', months: [{ suggested: 4000, billState: 'closed', dueDate: '2026-10-12' }, {}] },
    { itemId: 'alu', name: 'Aluguel', type: 'fixed', months: [{ planned: 3663, paid: null, previous: { amount: 3660, date: '2026-09-10' } }, { planned: 3663 }] },
    // Vence só em 20 dias: fora da janela.
    { itemId: 'c6', name: 'C6 Bank (fatura)', type: 'cardBill', months: [{ suggested: 900, billState: 'closed', dueDate: '2026-10-28' }, {}] },
  ];
  assert.deepEqual(dueSoon(base({ rows }), 7), [{ name: 'Aluguel', day: '2026-10-10', amount: 3663 }, { name: 'Nu Bank (fatura)', day: '2026-10-12', amount: 4000 }]);
  const short = evaluateAlerts(base({ rows, cash: { total: 5000 } })).find((a) => a.kind === 'cash');
  assert.equal(short?.severity, 'urgent');
  assert.equal(short?.key, 'cash7:2026-10-s2');
  assert.match(short!.body, /Faltam R\$ 2\.663,00/);
  assert.equal(evaluateAlerts(base({ rows, cash: { total: 9000 } })).some((a) => a.kind === 'cash'), false);
});

test('cartões: compra bem acima do tíquete médio e parcelamento novo', () => {
  const cards = {
    avgTicket: 104,
    largest: [
      { date: '2026-10-07T15:00:00.000Z', name: 'Loja Cara', amount: 890, card: 'Nubank' },
      { date: '2026-10-07T15:00:00.000Z', name: 'Mercado', amount: 280, card: 'Nubank' },
      { date: '2026-09-20T15:00:00.000Z', name: 'Antiga', amount: 2000, card: 'Nubank' },
    ],
    plans: [
      { key: 'plan:a', name: 'Webmotors', label: 'Anúncio do carro', installment: 1, totalInstallments: 10, amount: 25.99, endsIn: '2027-07' },
      { key: 'plan:b', name: 'Loja', installment: 4, totalInstallments: 6, amount: 100, endsIn: '2026-12' },
    ],
    byDay: [],
  };
  const out = evaluateAlerts(base({ cards }));
  assert.deepEqual(out.map((a) => a.key), ['big:2026-10-07:Loja Cara:890', 'plan:plan:a']);
  assert.match(out[1].title, /Anúncio do carro/);
  assert.match(out[1].body, /10x de R\$ 25,99, até jul\/27/);
});

test('mês que piorou além do limiar desde ontem; bancos parados, desconectados e autorização vencendo', () => {
  const out = evaluateAlerts(
    base({
      yesterday: { OUT: -350, NOV: -1950 },
      connections: [
        { id: 'a', bank: 'Nubank', status: 'UPDATED', providerUpdatedAt: new Date('2026-10-08T02:30:00.000Z'), consentExpiresAt: new Date('2027-10-01T00:00:00.000Z') },
        { id: 'b', bank: 'Bradesco', status: 'LOGIN_ERROR', providerUpdatedAt: null, consentExpiresAt: null },
        { id: 'c', bank: 'PicPay', status: 'UPDATED', providerUpdatedAt: new Date('2026-10-05T02:30:00.000Z'), consentExpiresAt: new Date('2026-10-20T00:00:00.000Z') },
      ],
    }),
  );
  assert.deepEqual(
    out.map((a) => `${a.severity} ${a.key}`),
    ['attention monthdrop:OUT:2026-10-08', 'urgent conn:b:LOGIN_ERROR', 'attention stale:c:2026-10-08', 'attention consent:c:2026-10-19'],
  );
  assert.match(out[0].title, /OUT piorou R\$ 250,00/);
});

test('resumo diário traz saldo, vencimentos, limites, compras, fechamento de cada mês e o que precisa de atenção', () => {
  const input = base({
    rows: [
      { itemId: 'nu', name: 'Nu Bank (fatura)', type: 'cardBill', months: [{ suggested: 4000, billState: 'closed', dueDate: '2026-10-12' }, {}] },
      { itemId: 'ali', name: 'Alimentação', type: 'limit', months: [{}, { actual: 1118.67, limit: 1800, used: 1118.67 / 1800 }] },
    ],
    yesterday: { OUT: -600, NOV: -2040 },
    cards: { avgTicket: 100, largest: [], plans: [], byDay: [{ day: '2026-10-06', total: 169.42, count: 5 }, { day: '2026-10-07', total: 80, count: 2 }] },
  });
  const digest = buildDigest(input, [{ severity: 'attention', title: 'Nu Bank (fatura) vence em 4 dia(s)', body: 'R$ 4.000,00.' }, { severity: 'info', title: 'Compra', body: 'x' }], 'https://exemplo.test');
  assert.equal(digest.subject, 'Meu financeiro · 08/10 · 1 aviso(s)');
  assert.equal(
    digest.text,
    [
      'Meu financeiro · qui 08/10',
      '',
      'Em conta: R$ 5.000,00',
      'Vence em 7 dias: R$ 4.000,00',
      '  • 12/10 Nu Bank (fatura): R$ 4.000,00',
      '',
      'Limites (ciclo 23/09 a 22/10)',
      '  • Alimentação: R$ 1.118,67 de R$ 1.800,00 (62%)',
      '',
      'Compras no cartão desde ontem: 2, somando R$ 80,00',
      '',
      'Como cada mês fecha',
      '  • OUT: -R$ 600,00',
      '  • NOV: -R$ 2.000,00 (melhorou R$ 40,00 desde ontem)',
      '',
      'Precisa de atenção',
      '  • Nu Bank (fatura) vence em 4 dia(s). R$ 4.000,00.',
      '',
      'https://exemplo.test',
    ].join('\n'),
  );
});

test('totais do mês no servidor batem com os da planilha (mesmas regras do cliente)', () => {
  const items: TotalsItem[] = [
    { id: 'sal', name: 'Salário', section: 'entrada', controllable: false, values: [9692.45, 9692.45] },
    { id: 'adi', name: 'Adiantamento dia 20', section: 'entrada', controllable: false, values: [1055.68, 1055.68] },
    { id: 'alu', name: 'Aluguel', section: 'saida', controllable: false, values: [3663, 3663] },
    { id: 'fies', name: 'Financiamento Estudantil', section: 'saida', controllable: false, values: [358.91, 360] },
    { id: 'yt', name: 'Youtube', section: 'saida', controllable: false, values: [26.9, 26.9] },
    { id: 'g1', name: 'Google One', section: 'saida', controllable: false, values: [9.99, 9.99] },
    { id: 'gas', name: 'Gás', section: 'saida', controllable: false, values: [35, 35] },
    { id: 'nu', name: 'Nu Bank (fatura)', section: 'saida', controllable: false, values: [6000, 962.4] },
    { id: 'ali', name: 'Alimentação', section: 'saida', controllable: true, values: [1800, 1800] },
    { id: 'soc', name: 'Despesas Sociais', section: 'saida', controllable: true, values: [500, 600] },
  ];
  const rows: TotalsRow[] = [
    { itemId: 'sal', type: 'income', months: [{}, {}] },
    { itemId: 'adi', type: 'income', months: [{}, {}] },
    { itemId: 'alu', type: 'fixed', months: [{ paid: { onCard: false, differs: false } }, {}] },
    { itemId: 'fies', type: 'fixed', months: [{ paid: { onCard: false, ahead: true, differs: false } }, {}] },
    { itemId: 'yt', type: 'fixed', months: [{ paid: { onCard: true, billRow: true, differs: false } }, {}] },
    // Reconhecida só pelo valor, e marcada à mão: nenhuma das duas sai do total.
    { itemId: 'g1', type: 'fixed', months: [{ paid: { onCard: true, billRow: true, byAmount: true, differs: false } }, {}] },
    { itemId: 'gas', type: 'fixed', months: [{ paid: { onCard: false, manual: 'pending', differs: false } }, {}] },
    { itemId: 'nu', type: 'cardBill', months: [{ suggested: 6914.2, billState: 'closed' }, { suggested: 2606.92, billState: 'projected' }] },
    { itemId: 'ali', type: 'limit', months: [{ state: 'current', actual: 1118.67, offBill: 0, accountInMonth: 48.85 }, { state: 'future', actual: 0 }] },
    { itemId: 'soc', type: 'limit', months: [{ state: 'past', actual: 700, offBill: 20, accountInMonth: 0 }, {}] },
  ];

  // O que a tela faz (Dashboard.itemsForTotals), com as funções do cliente.
  const rowOf = (id: string) => rows.find((r) => r.itemId === id)!;
  const netted = netAdvance(items, (it, m) => rowOf(it.id).type === 'fixed' && paidAhead(rowOf(it.id).months[m]?.paid));
  const shown = netted.map((it) => {
    const row = rowOf(it.id);
    if (it.controllable && row.type === 'limit') return { ...it, values: it.values.map((v, i) => controllableInTotal(v, row.months[i])) };
    if (row.type === 'fixed') return { ...it, values: it.values.map((v, i) => (coveredByCard(row.months[i]?.paid) ? 0 : v)) };
    if (row.type === 'cardBill') return { ...it, values: it.values.map((v, i) => billInTotal(v, row.months[i])) };
    return it;
  });
  const client = calculateMonthly(shown as never, ['OUT', 'NOV']);
  const server = monthTotals(items, rows, 2);
  const cents = (v: number) => Math.round(v * 100) / 100;
  assert.deepEqual(server.map((m) => m.entradas), client.entradasTotais.map(cents));
  assert.deepEqual(server.map((m) => m.saidas), client.saidasTotais.map(cents));
  assert.deepEqual(server.map((m) => m.subtotal), client.subtotal.map(cents));
  // E o valor em si, para o caso de as duas errarem juntas. Entradas: 9.692,45 + (1.055,68 - 358,91).
  // Saídas: aluguel 3.663 + Google One 9,99 + gás 35 + fatura 6.914,20 + alimentação (681,33 que faltam
  // + 48,85 da conta) + sociais 20 (cartão sem linha de fatura).
  assert.deepEqual(server[0], { entradas: 10389.22, saidas: 11372.37, subtotal: -983.15 });
});

test('canais: endereço mascarado, conversa privada do Telegram, erro sem o token', async () => {
  assert.equal(maskEmail('fulano@exemplo.test'), 'fu***@exemplo.test');

  const calls: Array<{ url: string; body: unknown }> = [];
  const fake = (result: unknown, ok = true) => async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(ok ? { ok: true, result } : { ok: false, description: 'chat not found' }), { status: ok ? 200 : 400 });
  };
  // Grupo é ignorado: vale a conversa privada mais recente.
  const chat = await latestTelegramChat('TOKEN', fake([{ message: { chat: { id: 11, type: 'private', first_name: 'Antigo' } } }, { message: { chat: { id: 22, type: 'private', first_name: 'Fulano' } } }, { message: { chat: { id: -5, type: 'group', title: 'Grupo' } } }]));
  assert.deepEqual(chat, { chatId: '22', name: 'Fulano' });
  assert.equal(await latestTelegramChat('TOKEN', fake([])), null);

  await sendTelegram('TOKEN', '22', 'olá', fake({}));
  assert.deepEqual(calls[calls.length - 1], { url: 'https://api.telegram.org/botTOKEN/sendMessage', body: { chat_id: '22', text: 'olá', disable_web_page_preview: true } });
  assert.equal(await telegramBotName('TOKEN', fake({ username: 'meu_financeiro_bot' })), '@meu_financeiro_bot');
  await assert.rejects(telegramBotName('ERRADO', fake(null, false)), /chat not found/);
  // O erro traz a descrição do Telegram, nunca o token.
  await assert.rejects(sendTelegram('SEGREDO', '22', 'olá', fake(null, false)), (err: Error) => /chat not found/.test(err.message) && !/SEGREDO/.test(err.message));
});

test('segredos são guardados cifrados: decifra com a chave certa, não com outra, e nunca em texto puro', () => {
  const stored = encryptSecret('123456:ABC-token-do-bot', 'chave-do-servidor');
  assert.equal(stored.includes('ABC-token-do-bot'), false);
  assert.equal(decryptSecret(stored, 'chave-do-servidor'), '123456:ABC-token-do-bot');
  assert.equal(decryptSecret(stored, 'outra-chave'), null);
  assert.equal(decryptSecret('lixo', 'chave-do-servidor'), null);
  // Cada gravação usa um vetor novo: o mesmo segredo não gera o mesmo texto.
  assert.notEqual(encryptSecret('x', 'k'), encryptSecret('x', 'k'));
});

test('configuração: aceita o que é válido e mantém o anterior no que não é', () => {
  const next = normalizeConfig({
    digest: { enabled: false, at: '06:15' },
    urgentNow: false,
    rules: { limit: false, cash: 'sim', inventada: true },
    thresholds: { limitNear: 0.9, bigPurchase: -5, monthDrop: 500, staleHours: 2 },
    email: { host: ' smtp.exemplo.test ', port: 465, user: 'u@exemplo.test', to: 'fulano@exemplo.test' },
  });
  assert.deepEqual(next.digest, { enabled: false, at: '06:15', frequency: 'daily', weekday: 1 });
  assert.equal(next.urgentNow, false);
  assert.deepEqual([next.rules.limit, next.rules.cash, next.rules.billDue, Object.keys(next.rules).includes('inventada')], [false, true, true, false]);
  // 0.9 e 500 valem; -5 e 2 horas estão fora da faixa e caem no padrão.
  assert.deepEqual(next.thresholds, { ...DEFAULT_CONFIG.thresholds, limitNear: 0.9, monthDrop: 500 });
  assert.deepEqual(next.email, { host: 'smtp.exemplo.test', port: 465, user: 'u@exemplo.test', to: 'fulano@exemplo.test' });
  assert.equal(normalizeConfig({ digest: { at: '25:99' } }).digest.at, '07:30');
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
});

test('e-mail aceita vários destinatários, sem repetidos nem endereços inválidos', () => {
  assert.deepEqual(parseRecipients('a@x.com, B@y.com.br; a@X.com\n  c@z.io nao-e-email @semnome.com'), ['a@x.com', 'B@y.com.br', 'c@z.io']);
  assert.deepEqual(parseRecipients(''), []);
  assert.equal(parseRecipients(Array.from({ length: 30 }, (_, i) => `p${i}@x.com`).join(',')).length, 10);
  assert.equal(normalizeConfig({ email: { host: 'smtp.x.com', to: 'a@x.com;b@x.com' } }).email.to, 'a@x.com, b@x.com');
});

test('resumo diário sai todo dia a partir do horário; o semanal só no dia escolhido', () => {
  const daily = { enabled: true, at: '07:30', frequency: 'daily' as const, weekday: 1 };
  // 08/10/2026 é quinta-feira. 10:29 UTC = 07:29 em Brasília.
  assert.equal(digestDue(daily, new Date('2026-10-08T10:29:00Z')), false);
  assert.equal(digestDue(daily, new Date('2026-10-08T10:30:00Z')), true);
  assert.equal(digestDue({ ...daily, enabled: false }, new Date('2026-10-08T15:00:00Z')), false);
  const weekly = { ...daily, frequency: 'weekly' as const, weekday: 4 };
  assert.equal(digestDue(weekly, new Date('2026-10-08T10:30:00Z')), true);
  assert.equal(digestDue(weekly, new Date('2026-10-09T10:30:00Z')), false);
  assert.equal(digestDue({ ...weekly, weekday: 1 }, new Date('2026-10-08T15:00:00Z')), false);
  // 01:00 UTC de sexta ainda é quinta à noite em Brasília.
  assert.equal(digestDue(weekly, new Date('2026-10-09T01:00:00Z')), true);
  assert.deepEqual(normalizeConfig({ digest: { frequency: 'weekly', weekday: 5 } }).digest, { enabled: true, at: '07:30', frequency: 'weekly', weekday: 5 });
  assert.equal(normalizeConfig({ digest: { frequency: 'mensal', weekday: 9 } }).digest.frequency, 'daily');
});
