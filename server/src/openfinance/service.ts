// Montagem das duas visões do Open Finance (cartões e planejado × realizado) a partir do banco.
// Fica fora das rotas para servir também aos alertas, que rodam sem pedido HTTP.
import { prisma } from '../db';
import { billPaymentsCents } from './bills';
import { buildBudget, BudgetTx, reversedDebits } from './budget';
import { cached } from './cache';
import { brlCents, buildCardsOverview, cardDueMonths, describePurchase, isBillPayment, withInstallments } from './cards';
import { prettyName } from './labels';

// Prazo do cache das telas: curto o bastante para a virada do dia aparecer sem ninguém invalidar.
const CACHE_MS = 5 * 60_000;

export interface CardsQuery {
  months: number;
  range: { from?: string; to?: string };
  billCycle: boolean;
  accountId?: string;
}

export async function loadCards({ months, range, billCycle, accountId }: CardsQuery) {
  return cached(`cards|${months}|${range.from ?? ''}|${range.to ?? ''}|${billCycle}|${accountId ?? ''}`, CACHE_MS, async () => {
    const accounts = await prisma.ofAccount.findMany({ where: { type: 'CREDIT' }, orderBy: { name: 'asc' } });
    // 13 meses cobrem o maior período pré-definido (12) e a folga para detectar parcelamentos ativos;
    // um intervalo personalizado mais antigo estende a busca até o seu início.
    const since = new Date(Math.min(Date.now() - 400 * 86_400_000, range.from ? Date.parse(range.from) - 86_400_000 : Infinity));
    const [transactions, bills, bankAccounts, labels] = await Promise.all([
      prisma.ofTransaction.findMany({ where: { accountId: { in: accounts.map((a) => a.id) }, date: { gte: since } } }),
      prisma.ofCreditCardBill.findMany({ where: { accountId: { in: accounts.map((a) => a.id) } } }),
      prisma.ofAccount.findMany({ where: { type: 'BANK' }, select: { connectionId: true, name: true } }),
      prisma.ofMerchantLabel.findMany(),
    ]);
    // O conector é sempre "MeuPluggy"; o nome da instituição vem da conta bancária da mesma conexão.
    const bankNames: Record<string, string> = {};
    for (const b of bankAccounts) bankNames[b.connectionId] ??= b.name.trim();

    const last = await prisma.ofConnection.findFirst({ orderBy: { lastSyncedAt: 'desc' }, select: { lastSyncedAt: true } });
    const overview = buildCardsOverview({
      accounts,
      bankNames,
      userLabels: Object.fromEntries(labels.map((l) => [l.key, { name: l.name, kind: l.kind, category: l.category }])),
      months,
      ...range,
      billCycle,
      accountId,
      transactions: transactions.map((t) => ({
        ...t,
        billForecast: (JSON.parse(t.raw) as { creditCardMetadata?: { billForecastDate?: string } }).creditCardMetadata?.billForecastDate ?? null,
      })),
      bills: bills.map((b) => ({
        ...b,
        paymentsCents: billPaymentsCents(b.raw, b.closingDate),
      })),
    });
    return { ...overview, lastSyncedAt: last?.lastSyncedAt ?? null };
  });
}

// Devolve null quando o cenário não existe.
export async function loadBudget(scenarioId: string) {
  const scenario = await prisma.scenario.findUnique({
    where: { id: scenarioId },
    include: { items: { orderBy: [{ section: 'asc' }, { order: 'asc' }] } },
  });
  if (!scenario) return null;

  // O que não depende do cenário é montado uma vez e reaproveitado entre os pedidos.
  const { consumption, income, overview, dueById, cash, pix } = await cached('budget-base', CACHE_MS, async () => {
    // Quatro meses cobrem o mês corrente e os anteriores que o cenário ainda mostra.
    const since = new Date(Date.now() - 125 * 86_400_000);
    const [accounts, transactions, bills, labels] = await Promise.all([
      prisma.ofAccount.findMany(),
      prisma.ofTransaction.findMany({ where: { date: { gte: new Date(Date.now() - 400 * 86_400_000) } } }),
      prisma.ofCreditCardBill.findMany(),
      prisma.ofMerchantLabel.findMany(),
    ]);
    const userLabels = Object.fromEntries(labels.map((l) => [l.key, { name: l.name, kind: l.kind, category: l.category }]));
    const bankNames: Record<string, string> = {};
    for (const a of accounts) if (a.type === 'BANK') bankNames[a.connectionId] ??= a.name.trim();
    const accountOf = new Map(accounts.map((a) => [a.id, a]));

    // Tentativas de débito em conta desfeitas pelo banco não são gasto, nem o estorno é entrada.
    const reversed = reversedDebits(
      transactions.flatMap((t) => {
        const cents = accountOf.get(t.accountId)?.type === 'BANK' ? brlCents(t) : null;
        return cents === null ? [] : [{ id: t.id, accountId: t.accountId, type: t.type, date: t.date, description: t.description, cents: Math.abs(cents) }];
      }),
    );
    const consumption: Array<BudgetTx & { id: string }> = [];
    const income: BudgetTx[] = [];
    for (const t of transactions) {
      const account = accountOf.get(t.accountId);
      if (!account || t.date < since || reversed.has(t.id)) continue;
      if (t.type === 'CREDIT') {
        // Entradas: só o que chega de fora nas contas (não cartão, não resgate, não entre contas próprias).
        const fam = t.categoryId?.slice(0, 2) ?? '';
        const cents = brlCents(t);
        if (account.type !== 'BANK' || cents === null || ['03', '04'].includes(fam)) continue;
        const counterparty = t.description.split('|')[1]?.trim() || t.merchantName || t.counterpartyName;
        const d = describePurchase({ merchantName: counterparty, description: t.description, category: t.category, categoryId: t.categoryId }, userLabels);
        income.push({
          date: t.date,
          cents: Math.abs(cents),
          key: d.key,
          name: d.name,
          kind: userLabels[d.key]?.kind ?? null,
          famId: fam,
          sub: t.category ?? '',
          description: t.description,
          source: `${bankNames[account.connectionId] ?? account.name.trim()} · conta`,
        });
        continue;
      }
      if (t.type !== 'DEBIT') continue;
      const cents = brlCents(t);
      if (cents === null) continue;
      const isCard = account.type === 'CREDIT';
      const famId = t.categoryId?.slice(0, 2) ?? '';
      if (isCard) {
        // No cartão: só compras (sem pagamento de fatura, IOF, tarifas e juros).
        if (isBillPayment(t) || (['02', '15', '16'].includes(famId) && !/sem juros/i.test(t.description))) continue;
      } else if (['03', '04'].includes(famId) || t.categoryId === '05100000' || /FATURA|GASTOS CARTAO DE CREDITO/i.test(t.description)) {
        // Na conta: investimento, transferência entre contas próprias e pagamento de fatura não são
        // consumo (as compras do cartão já entram uma a uma).
        continue;
      }
      // Na conta, a contraparte vem depois da barra: "Transferência enviada pelo Pix|FULANO".
      const counterparty = isCard ? t.merchantName : (t.description.split('|')[1]?.trim() || t.merchantName || t.counterpartyName);
      const d = describePurchase({ merchantName: counterparty, description: t.description, category: t.category, categoryId: t.categoryId }, userLabels);
      // Empréstimo e juros pagos pela conta mantêm a família original (não são "compras").
      const keepFamily = !isCard && ['02', '15', '16'].includes(famId);
      consumption.push({
        id: t.id,
        date: t.date,
        cents: Math.abs(cents),
        key: d.key,
        name: d.name,
        kind: d.kind,
        famId: keepFamily ? famId : d.fam.id,
        sub: keepFamily ? (t.category ?? '') : d.sub,
        description: t.description,
        source: `${bankNames[account.connectionId] ?? account.name.trim()} · ${isCard ? 'cartão' : 'conta'}`,
        installment: isCard ? withInstallments(t).installmentNumber : null,
        installmentTotal: isCard ? withInstallments(t).totalInstallments : null,
      });
    }

    const cardAccounts = accounts.filter((a) => a.type === 'CREDIT');
    const cardRows = transactions
      .filter((t) => accountOf.get(t.accountId)?.type === 'CREDIT')
      .map((t) => ({
        ...t,
        billForecast: (JSON.parse(t.raw) as { creditCardMetadata?: { billForecastDate?: string } }).creditCardMetadata?.billForecastDate ?? null,
      }));
    const cardBills = bills.map((b) => ({
      ...b,
      paymentsCents: billPaymentsCents(b.raw, b.closingDate),
    }));
    const overview = buildCardsOverview({ accounts: cardAccounts, bankNames, months: 1, billCycle: true, userLabels, transactions: cardRows, bills: cardBills });
    // Fatura em que cada compra de cartão cai, segundo o banco.
    const dueById = new Map<string, string | null>();
    for (const [row, due] of cardDueMonths({ accounts: cardAccounts, transactions: cardRows, bills: cardBills })) dueById.set((row as (typeof cardRows)[number]).id, due);
    // Dinheiro em conta agora: o saldo de cada conta corrente/poupança, banco a banco.
    const cash = accounts
      .filter((a) => a.type === 'BANK')
      .map((a) => ({ bank: bankNames[a.connectionId] ?? a.name.trim(), name: a.name.trim(), balance: Number(a.balanceCents) / 100 }))
      .sort((a, b) => b.balance - a.balance);
    // Pix que entrou e saiu das contas. Transferência entre contas próprias e tentativa desfeita
    // pelo banco não contam: não é dinheiro que chegou nem que foi embora.
    const pix = transactions.flatMap((t) => {
      const account = accountOf.get(t.accountId);
      const cents = brlCents(t);
      if (!account || account.type !== 'BANK' || cents === null || t.date < since || reversed.has(t.id)) return [];
      if (!/PIX/i.test(t.description) || t.categoryId?.slice(0, 2) === '04') return [];
      // "Valor adicionado para Pix no crédito" é o próprio cartão bancando um Pix: não é dinheiro recebido.
      if (t.type === 'CREDIT' && /PIX NO CR[EÉ]DITO/i.test(t.description)) return [];
      // Quem mandou ou recebeu: o nome da contraparte, sem passar pelas regras de marca (que
      // chamariam qualquer descrição com "Pix" de "Pix no crédito").
      const counterparty = t.description.split('|')[1]?.trim() || t.counterpartyName || t.merchantName || '';
      return [{ date: t.date, cents: Math.abs(cents), incoming: t.type === 'CREDIT', name: counterparty ? prettyName(counterparty.toUpperCase()) : 'sem nome informado' }];
    });
    return { consumption, income, overview, dueById, cash, pix };
  });

  const [marks, lastSync] = await Promise.all([
    prisma.paidMark.findMany({ where: { itemId: { in: scenario.items.map((i) => i.id) } } }),
    prisma.ofConnection.findFirst({ orderBy: { lastSyncedAt: 'desc' }, select: { lastSyncedAt: true } }),
  ]);
  const { staleMarks, ...budget } = buildBudget({
      items: scenario.items.map((i) => ({ id: i.id, name: i.name, section: i.section === 'entrada' ? ('entrada' as const) : ('saida' as const), controllable: i.controllable, values: JSON.parse(i.values) as number[] })),
      income,
      months: JSON.parse(scenario.months) as string[],
      // Cada compra de cartão vai para a fatura em que o banco diz que ela cai.
      transactions: consumption.map(({ id, ...t }) => ({ ...t, dueMonth: dueById.get(id) ?? null })),
      cards: overview.cards.map((c) => ({ bank: c.bank, closedBill: c.closedBill, openBill: c.openBill, upcomingBills: c.upcomingBills, pastBills: c.pastBills })),
      // O ciclo aberto começa no dia seguinte ao último fechamento e é pago no vencimento da fatura aberta.
      cycle: (() => {
        const dues = overview.cards.flatMap((c) => (c.openBill ? [c.openBill.dueDate] : [])).sort();
        return overview.period.billCycle && dues.length ? { start: overview.period.startDate, dueMonth: dues[0].slice(0, 7) } : null;
      })(),
        marks,
    lastSyncAt: lastSync?.lastSyncedAt ?? null,
    cash,
    pix,
  });
  // Marcações que os bancos desmentiram (ou que já não são necessárias) deixam de existir.
  if (staleMarks.length) await prisma.paidMark.deleteMany({ where: { OR: staleMarks } });
  return budget;
}
