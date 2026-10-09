import { invalidateOpenFinance } from './cache';
import type { Prisma, PrismaClient } from '@prisma/client';
import { PluggyClient } from './pluggy';

export type SyncTrigger = 'schedule' | 'manual' | 'cli';

export interface SyncStats {
  accounts: number;
  transactions: number;
  bills: number;
  investments: number;
  loans: number;
  warnings: string[];
}

export interface SyncResult {
  connectionId: string;
  status: 'success' | 'partial' | 'error';
  stats: SyncStats;
  error?: string;
}

// Open Finance entrega até 12 meses de histórico.
const DEFAULT_HISTORY_DAYS = 365;
// A cada sincronização relemos uma janela recente: lançamentos pendentes mudam e
// bancos lançam itens com data retroativa.
const OVERLAP_DAYS = 45;
const CHUNK = 200;

export function toCents(value: unknown): bigint | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return BigInt(Math.round(value * 100));
}

function toDate(value: unknown): Date | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function int(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function inChunks<T>(prisma: PrismaClient, rows: T[], op: (row: T) => Prisma.PrismaPromise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await prisma.$transaction(rows.slice(i, i + CHUNK).map(op));
  }
}

export function mapConnection(item: any) {
  return {
    connectorId: int(item.connector?.id) ?? 0,
    connectorName: str(item.connector?.name) ?? 'Desconhecido',
    connectorImageUrl: str(item.connector?.imageUrl),
    status: str(item.status) ?? 'UNKNOWN',
    executionStatus: str(item.executionStatus),
    errorCode: str(item.error?.code),
    errorMessage: str(item.error?.message),
    consentExpiresAt: toDate(item.consentExpiresAt),
    providerUpdatedAt: toDate(item.lastUpdatedAt),
    nextAutoSyncAt: toDate(item.nextAutoSyncAt),
    raw: JSON.stringify(item),
  };
}

export function mapAccount(a: any) {
  const credit = a.creditData ?? null;
  return {
    type: str(a.type) ?? 'UNKNOWN',
    subtype: str(a.subtype) ?? 'UNKNOWN',
    name: str(a.name) ?? str(a.marketingName) ?? 'Conta',
    marketingName: str(a.marketingName),
    number: str(a.number),
    ownerName: str(a.owner),
    currencyCode: str(a.currencyCode) ?? 'BRL',
    balanceCents: toCents(a.balance) ?? 0n,
    creditLimitCents: toCents(credit?.creditLimit),
    availableCreditLimitCents: toCents(credit?.availableCreditLimit),
    minimumPaymentCents: toCents(credit?.minimumPayment),
    balanceCloseDate: toDate(credit?.balanceCloseDate),
    balanceDueDate: toDate(credit?.balanceDueDate),
    cardBrand: str(credit?.brand),
    raw: JSON.stringify(a),
  };
}

export function mapTransaction(t: any) {
  const card = t.creditCardMetadata ?? null;
  const pay = t.paymentData ?? null;
  // A contraparte é quem está do outro lado: quem recebeu num débito, quem pagou num crédito.
  const counterparty = t.type === 'CREDIT' ? pay?.payer : pay?.receiver;
  return {
    date: toDate(t.date) ?? new Date(0),
    description: str(t.description) ?? '',
    descriptionRaw: str(t.descriptionRaw),
    type: str(t.type) ?? 'UNKNOWN',
    status: str(t.status) ?? 'POSTED',
    amountCents: toCents(t.amount) ?? 0n,
    currencyCode: str(t.currencyCode) ?? 'BRL',
    amountInAccountCurrencyCents: toCents(t.amountInAccountCurrency),
    balanceCents: toCents(t.balance),
    category: str(t.category),
    categoryId: str(t.categoryId),
    operationType: str(t.operationType),
    providerCode: str(t.providerCode),
    billId: str(card?.billId),
    installmentNumber: int(card?.installmentNumber),
    totalInstallments: int(card?.totalInstallments),
    purchaseDate: toDate(card?.purchaseDate),
    merchantName: str(t.merchant?.name) ?? str(t.merchant?.businessName),
    merchantCnpj: str(t.merchant?.cnpj),
    counterpartyName: str(counterparty?.name),
    counterpartyDocument: str(counterparty?.documentNumber?.value),
    paymentMethod: str(pay?.paymentMethod),
    raw: JSON.stringify(t),
    providerCreatedAt: toDate(t.createdAt),
    providerUpdatedAt: toDate(t.updatedAt),
  };
}

export function mapBill(b: any) {
  return {
    dueDate: toDate(b.dueDate) ?? new Date(0),
    closingDate: toDate(b.billClosingDate),
    totalAmountCents: toCents(b.totalAmount) ?? 0n,
    currencyCode: str(b.totalAmountCurrencyCode) ?? 'BRL',
    minimumPaymentCents: toCents(b.minimumPaymentAmount),
    allowsInstallments: typeof b.allowsInstallments === 'boolean' ? b.allowsInstallments : null,
    raw: JSON.stringify(b),
  };
}

export function mapInvestment(i: any) {
  return {
    type: str(i.type) ?? 'OTHER',
    subtype: str(i.subtype),
    name: str(i.name) ?? 'Investimento',
    code: str(i.code),
    isin: str(i.isin),
    number: str(i.number),
    issuer: str(i.issuer),
    status: str(i.status),
    currencyCode: str(i.currencyCode) ?? 'BRL',
    balanceCents: toCents(i.balance) ?? 0n,
    amountOriginalCents: toCents(i.amountOriginal),
    amountProfitCents: toCents(i.amountProfit),
    quantity: num(i.quantity),
    unitValue: num(i.value),
    rate: num(i.rate),
    rateType: str(i.rateType),
    purchaseDate: toDate(i.purchaseDate) ?? toDate(i.date),
    dueDate: toDate(i.dueDate),
    raw: JSON.stringify(i),
  };
}

export function mapLoan(l: any) {
  return {
    contractNumber: str(l.contractNumber),
    productName: str(l.productName),
    type: str(l.type),
    currencyCode: str(l.currencyCode) ?? 'BRL',
    contractAmountCents: toCents(l.contractAmount),
    outstandingBalanceCents: toCents(l.payments?.contractOutstandingBalance),
    cet: num(l.CET),
    totalInstallments: int(l.installments?.totalNumberOfInstallments),
    paidInstallments: int(l.installments?.paidInstallments),
    dueInstallments: int(l.installments?.dueInstallments),
    pastDueInstallments: int(l.installments?.pastDueInstallments),
    contractDate: toDate(l.contractDate) ?? toDate(l.date),
    dueDate: toDate(l.dueDate),
    raw: JSON.stringify(l),
  };
}

function historyDays(): number {
  const n = Number(process.env.PLUGGY_HISTORY_DAYS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_HISTORY_DAYS;
}

async function transactionsFrom(prisma: PrismaClient, accountId: string, now: Date): Promise<Date> {
  const oldest = new Date(now.getTime() - historyDays() * 86_400_000);
  const latest = await prisma.ofTransaction.findFirst({
    where: { accountId },
    orderBy: { date: 'desc' },
    select: { date: true },
  });
  if (!latest) return oldest;
  // Cartões trazem parcelas futuras; a janela parte de hoje, não da última data lançada.
  const anchor = Math.min(latest.date.getTime(), now.getTime());
  const overlap = new Date(anchor - OVERLAP_DAYS * 86_400_000);
  return overlap > oldest ? overlap : oldest;
}

// Um produto que falha (ex.: instituição não compartilha empréstimos) não derruba o resto.
async function optional<T>(stats: SyncStats, label: string, fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (err) {
    stats.warnings.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export async function syncConnection(
  prisma: PrismaClient,
  client: PluggyClient,
  itemId: string,
  trigger: SyncTrigger,
  now: Date = new Date(),
): Promise<SyncResult> {
  const stats: SyncStats = { accounts: 0, transactions: 0, bills: 0, investments: 0, loans: 0, warnings: [] };
  let run: { id: string } | null = null;

  try {
    const item = await client.getItem(itemId);
    const connection = mapConnection(item);
    await prisma.ofConnection.upsert({ where: { id: itemId }, create: { id: itemId, ...connection }, update: connection });
    run = await prisma.ofSyncRun.create({ data: { connectionId: itemId, trigger, status: 'running' } });

    if (connection.status !== 'UPDATED') {
      stats.warnings.push(`item com status ${connection.status}: os dados podem estar desatualizados`);
    }

    const accounts = await client.getAccounts(itemId);
    await inChunks(prisma, accounts, (a) => {
      const data = mapAccount(a);
      return prisma.ofAccount.upsert({
        where: { id: a.id },
        create: { id: a.id, connectionId: itemId, ...data },
        update: { connectionId: itemId, ...data },
      });
    });
    stats.accounts = accounts.length;

    for (const account of accounts) {
      const from = await transactionsFrom(prisma, account.id, now);
      const txs = await optional(stats, `transações de ${account.name ?? account.id}`, () =>
        client.getTransactions(account.id, isoDay(from)),
      );
      await inChunks(prisma, txs, (t) => {
        const data = mapTransaction(t);
        return prisma.ofTransaction.upsert({
          where: { id: t.id },
          create: { id: t.id, accountId: account.id, ...data },
          update: { accountId: account.id, ...data },
        });
      });
      stats.transactions += txs.length;

      // Pendentes que sumiram da janela relida foram cancelados ou viraram outro lançamento.
      if (txs.length > 0) {
        await prisma.ofTransaction.deleteMany({
          where: { accountId: account.id, status: 'PENDING', date: { gte: from }, id: { notIn: txs.map((t) => t.id) } },
        });
      }

      if (account.type === 'CREDIT') {
        const bills = await optional(stats, `faturas de ${account.name ?? account.id}`, () => client.getBills(account.id));
        await inChunks(prisma, bills, (b) => {
          const data = mapBill(b);
          return prisma.ofCreditCardBill.upsert({
            where: { id: b.id },
            create: { id: b.id, accountId: account.id, ...data },
            update: { accountId: account.id, ...data },
          });
        });
        stats.bills += bills.length;
      }
    }

    const investments = await optional(stats, 'investimentos', () => client.getInvestments(itemId));
    await inChunks(prisma, investments, (i) => {
      const data = mapInvestment(i);
      return prisma.ofInvestment.upsert({
        where: { id: i.id },
        create: { id: i.id, connectionId: itemId, ...data },
        update: { connectionId: itemId, ...data },
      });
    });
    stats.investments = investments.length;

    const loans = await optional(stats, 'empréstimos', () => client.getLoans(itemId));
    await inChunks(prisma, loans, (l) => {
      const data = mapLoan(l);
      return prisma.ofLoan.upsert({
        where: { id: l.id },
        create: { id: l.id, connectionId: itemId, ...data },
        update: { connectionId: itemId, ...data },
      });
    });
    stats.loans = loans.length;

    const status = stats.warnings.length > 0 ? 'partial' : 'success';
    await prisma.ofConnection.update({ where: { id: itemId }, data: { lastSyncedAt: now } });
    await prisma.ofSyncRun.update({
      where: { id: run.id },
      data: { status, finishedAt: new Date(), stats: JSON.stringify(stats) },
    });
    invalidateOpenFinance();
    return { connectionId: itemId, status, stats };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (run) {
      await prisma.ofSyncRun.update({
        where: { id: run.id },
        data: { status: 'error', finishedAt: new Date(), stats: JSON.stringify(stats), error },
      });
    } else {
      // Falhou antes de conhecermos a conexão (credenciais erradas, item inexistente...).
      await prisma.ofSyncRun.create({
        data: { trigger, status: 'error', finishedAt: new Date(), stats: JSON.stringify(stats), error: `${itemId}: ${error}` },
      });
    }
    // Mesmo com erro, parte dos dados pode ter entrado.
    invalidateOpenFinance();
    return { connectionId: itemId, status: 'error', stats, error };
  }
}

// Itens a sincronizar: os já conhecidos no banco mais os listados em PLUGGY_ITEM_IDS.
export async function connectionIds(prisma: PrismaClient, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const fromEnv = (env.PLUGGY_ITEM_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const known = await prisma.ofConnection.findMany({ select: { id: true } });
  return [...new Set([...known.map((c) => c.id), ...fromEnv])];
}

let running: Promise<SyncResult[]> | null = null;

export function isSyncRunning(): boolean {
  return running !== null;
}

// Uma sincronização por vez no processo; chamadas concorrentes recebem a execução em andamento.
export function syncAll(prisma: PrismaClient, client: PluggyClient, trigger: SyncTrigger): Promise<SyncResult[]> {
  if (running) return running;
  running = (async () => {
    const results: SyncResult[] = [];
    for (const id of await connectionIds(prisma)) {
      results.push(await syncConnection(prisma, client, id, trigger));
    }
    return results;
  })().finally(() => {
    running = null;
  });
  return running;
}
