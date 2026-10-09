// Sincronização do Open Finance contra uma Pluggy simulada e um SQLite temporário.
// Rodar: npm test (em server/).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { PluggyClient } from '../src/openfinance/pluggy';
import { syncConnection, toCents } from '../src/openfinance/sync';

const ITEM = '11111111-1111-4111-8111-111111111111';
const dir = mkdtempSync(path.join(tmpdir(), 'financeiro-test-'));
const url = `file:${path.join(dir, 'test.db').replace(/\\/g, '/')}`;
let prisma: PrismaClient;

interface FakeState {
  calls: string[];
  authCalls: number;
  transactions: Record<string, any[]>;
  loansStatus: number;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fakePluggy(state: FakeState) {
  return async (input: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(input);
    state.calls.push(`${init?.method ?? 'GET'} ${u.pathname}${u.search}`);
    if (u.pathname === '/auth') {
      state.authCalls++;
      return json({ apiKey: 'key' });
    }
    if ((init?.headers as Record<string, string>)?.['X-API-KEY'] !== 'key') return json({ message: 'unauthorized' }, 401);
    if (u.pathname === `/items/${ITEM}`) {
      return json({
        id: ITEM,
        status: 'UPDATED',
        executionStatus: 'SUCCESS',
        connector: { id: 200, name: 'MeuPluggy', imageUrl: 'https://example.test/logo.svg' },
        lastUpdatedAt: '2026-10-03T10:00:00.000Z',
        consentExpiresAt: '2027-10-03T10:00:00.000Z',
        error: null,
      });
    }
    if (u.pathname === '/accounts') {
      return json({
        results: [
          { id: 'acc-bank', itemId: ITEM, type: 'BANK', subtype: 'CHECKING_ACCOUNT', name: 'Conta Corrente', number: '0001/12345-6', balance: 1234.56, currencyCode: 'BRL', owner: 'Fulano', bankData: {}, creditData: null },
          { id: 'acc-card', itemId: ITEM, type: 'CREDIT', subtype: 'CREDIT_CARD', name: 'Cartão', number: '1234', balance: 987.65, currencyCode: 'BRL', bankData: null, creditData: { creditLimit: 5000, availableCreditLimit: 4012.35, brand: 'VISA', balanceDueDate: '2026-10-10T00:00:00.000Z' } },
        ],
      });
    }
    if (u.pathname === '/v2/transactions') {
      const accountId = u.searchParams.get('accountId')!;
      const all = state.transactions[accountId] ?? [];
      // Duas páginas, para exercitar o cursor `next`.
      if (!u.searchParams.get('after') && all.length > 1) {
        // Formato real da Pluggy: só a query string.
        return json({ results: all.slice(0, 1), next: `?accountId=${accountId}&dateFrom=${u.searchParams.get('dateFrom')}&after=cursor%3D%3D` });
      }
      return json({ results: u.searchParams.get('after') ? all.slice(1) : all, next: null });
    }
    if (u.pathname === '/bills') {
      return json({ page: 1, total: 1, totalPages: 1, results: [{ id: 'bill-1', dueDate: '2026-10-10T00:00:00.000Z', totalAmount: 987.65, totalAmountCurrencyCode: 'BRL', minimumPaymentAmount: 98.77 }] });
    }
    if (u.pathname === '/investments') {
      return json({ page: 1, total: 1, totalPages: 1, results: [{ id: 'inv-1', itemId: ITEM, type: 'FIXED_INCOME', subtype: 'CDB', name: 'CDB 110% CDI', balance: 10000.01, currencyCode: 'BRL', rate: 110, rateType: 'CDI' }] });
    }
    if (u.pathname === '/loans') {
      if (state.loansStatus !== 200) return json({ message: 'product not available' }, state.loansStatus);
      return json({ page: 1, total: 1, totalPages: 1, results: [{ id: 'loan-1', itemId: ITEM, contractNumber: 'C-1', productName: 'Crédito pessoal', contractAmount: 20000, CET: 0.031, installments: { totalNumberOfInstallments: 36, paidInstallments: 4 }, payments: { contractOutstandingBalance: 18123.45 } }] });
    }
    return json({ message: 'not found' }, 404);
  };
}

const tx = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  accountId: 'acc-bank',
  date: '2026-10-01T12:00:00.000Z',
  description: 'PIX enviado',
  type: 'DEBIT',
  status: 'POSTED',
  amount: -150.1,
  currencyCode: 'BRL',
  category: 'Transfers',
  categoryId: '05000000',
  creditCardMetadata: null,
  ...over,
});

before(() => {
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  prisma = new PrismaClient({ datasources: { db: { url } } });
});

after(async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

test('toCents arredonda sem erro de ponto flutuante', () => {
  assert.equal(toCents(0.1 + 0.2), 30n);
  assert.equal(toCents(-150.1), -15010n);
  assert.equal(toCents(null), null);
  assert.equal(toCents('10'), null);
});

test('sincroniza item, contas, transações paginadas, faturas, investimentos e empréstimos', async () => {
  const state: FakeState = {
    calls: [],
    authCalls: 0,
    loansStatus: 200,
    transactions: {
      'acc-bank': [tx('t1'), tx('t2', { type: 'CREDIT', amount: 5000, description: 'Salário', paymentData: { payer: { name: 'Empresa X', documentNumber: { value: '12345678000199', type: 'CNPJ' } } } }), tx('t-pending', { status: 'PENDING' })],
      // c-future: parcela futura já lançada no cartão.
      'acc-card': [tx('c-future', { accountId: 'acc-card', amount: 99.9, date: '2027-06-30T12:00:00.000Z' }), tx('c1', { accountId: 'acc-card', amount: 99.9, description: 'Loja', creditCardMetadata: { billId: 'bill-1', installmentNumber: 2, totalInstallments: 10 }, merchant: { name: 'Loja Y', businessName: 'Loja Y LTDA', cnpj: '11222333000144' } })],
    },
  };
  const client = new PluggyClient({ clientId: 'id', clientSecret: 'secret', baseUrl: 'https://pluggy.test', fetchImpl: fakePluggy(state) });

  const result = await syncConnection(prisma, client, ITEM, 'cli', new Date('2026-10-03T12:00:00.000Z'));
  assert.equal(result.status, 'success', JSON.stringify(result));
  assert.deepEqual({ ...result.stats, warnings: undefined }, { accounts: 2, transactions: 5, bills: 1, investments: 1, loans: 1, warnings: undefined });
  assert.equal(state.authCalls, 1, 'a API key deve ser reutilizada');

  const first = state.calls.find((c) => c.includes('/v2/transactions?accountId=acc-bank'))!;
  assert.match(first, /dateFrom=2025-10-03/, 'primeira carga pede 365 dias');
  assert.ok(state.calls.some((c) => c.startsWith('GET /v2/transactions?accountId=acc-bank') && c.endsWith('after=cursor%3D%3D')), 'o cursor `next` é seguido como veio, no caminho /v2/transactions');

  const conn = await prisma.ofConnection.findUniqueOrThrow({ where: { id: ITEM } });
  assert.equal(conn.connectorName, 'MeuPluggy');
  assert.ok(conn.lastSyncedAt);

  const bank = await prisma.ofAccount.findUniqueOrThrow({ where: { id: 'acc-bank' } });
  assert.equal(bank.balanceCents, 123456n);
  const card = await prisma.ofAccount.findUniqueOrThrow({ where: { id: 'acc-card' } });
  assert.equal(card.creditLimitCents, 500000n);
  assert.equal(card.cardBrand, 'VISA');

  const t1 = await prisma.ofTransaction.findUniqueOrThrow({ where: { id: 't1' } });
  assert.equal(t1.amountCents, -15010n);
  const t2 = await prisma.ofTransaction.findUniqueOrThrow({ where: { id: 't2' } });
  assert.equal(t2.counterpartyName, 'Empresa X');
  assert.equal(t2.counterpartyDocument, '12345678000199');
  const c1 = await prisma.ofTransaction.findUniqueOrThrow({ where: { id: 'c1' } });
  assert.deepEqual([c1.billId, c1.installmentNumber, c1.totalInstallments, c1.merchantCnpj], ['bill-1', 2, 10, '11222333000144']);
  assert.equal(JSON.parse(c1.raw).merchant.businessName, 'Loja Y LTDA');

  assert.equal((await prisma.ofCreditCardBill.findUniqueOrThrow({ where: { id: 'bill-1' } })).totalAmountCents, 98765n);
  assert.equal((await prisma.ofInvestment.findUniqueOrThrow({ where: { id: 'inv-1' } })).balanceCents, 1000001n);
  const loan = await prisma.ofLoan.findUniqueOrThrow({ where: { id: 'loan-1' } });
  assert.deepEqual([loan.outstandingBalanceCents, loan.totalInstallments, loan.paidInstallments], [1812345n, 36, 4]);
});

test('segunda sincronização é idempotente, atualiza valores, remove pendentes sumidos e tolera produto indisponível', async () => {
  const state: FakeState = {
    calls: [],
    authCalls: 0,
    loansStatus: 400,
    transactions: {
      // t-pending sumiu; t1 teve a descrição corrigida pelo banco.
      'acc-bank': [tx('t1', { description: 'PIX enviado - João' }), tx('t2', { type: 'CREDIT', amount: 5000 })],
      'acc-card': [tx('c1', { accountId: 'acc-card', amount: 99.9 })],
    },
  };
  const client = new PluggyClient({ clientId: 'id', clientSecret: 'secret', baseUrl: 'https://pluggy.test', fetchImpl: fakePluggy(state) });

  const result = await syncConnection(prisma, client, ITEM, 'cli', new Date('2026-10-04T12:00:00.000Z'));
  assert.equal(result.status, 'partial');
  assert.equal(result.stats.warnings.length, 1);
  assert.match(result.stats.warnings[0], /empréstimos/);

  const first = state.calls.find((c) => c.includes('/v2/transactions?accountId=acc-bank'))!;
  assert.match(first, /dateFrom=2026-08-17/, 'cargas seguintes releem só a janela de 45 dias');

  const cardCall = state.calls.find((c) => c.includes('/v2/transactions?accountId=acc-card'))!;
  assert.match(cardCall, /dateFrom=2026-08-20/, 'parcelas futuras não empurram a janela para o futuro');

  assert.equal(await prisma.ofTransaction.count(), 4);
  assert.equal(await prisma.ofTransaction.count({ where: { id: 't-pending' } }), 0);
  assert.equal((await prisma.ofTransaction.findUniqueOrThrow({ where: { id: 't1' } })).description, 'PIX enviado - João');
  assert.equal(await prisma.ofLoan.count(), 1, 'falha em um produto não apaga o que já existia');
  assert.equal(await prisma.ofAccount.count(), 2);

  const runs = await prisma.ofSyncRun.findMany({ orderBy: { startedAt: 'asc' } });
  assert.deepEqual(runs.map((r) => r.status), ['success', 'partial']);
});

test('item inexistente vira erro registrado, sem lançar exceção', async () => {
  const state: FakeState = { calls: [], authCalls: 0, loansStatus: 200, transactions: {} };
  const client = new PluggyClient({ clientId: 'id', clientSecret: 'secret', baseUrl: 'https://pluggy.test', fetchImpl: fakePluggy(state) });
  const result = await syncConnection(prisma, client, '22222222-2222-4222-8222-222222222222', 'cli');
  assert.equal(result.status, 'error');
  assert.match(result.error ?? '', /404/);
  assert.equal(await prisma.ofConnection.count(), 1);
  assert.equal((await prisma.ofSyncRun.findFirstOrThrow({ orderBy: { startedAt: 'desc' } })).status, 'error');
});
