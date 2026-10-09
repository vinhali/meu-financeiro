// Teste de qualidade das conexões do Open Finance. Rodar: npm test (em server/).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authorizationUrl, checkConnection, duplicateConnection, HealthInput, needsReconnect } from '../src/openfinance/health';

const NOW = new Date('2026-10-05T15:00:00.000Z');
const healthy = (over: Partial<HealthInput> = {}): HealthInput => ({
  now: NOW,
  item: {
    status: 'UPDATED',
    lastUpdatedAt: '2026-10-05T05:30:00.000Z',
    consentExpiresAt: '2027-09-01T00:00:00.000Z',
    statusDetail: { accounts: { isUpdated: true }, creditCards: { isUpdated: true }, transactions: { isUpdated: true } },
  },
  latencyMs: 320,
  remoteAccounts: 2,
  local: {
    accounts: [
      { name: 'Conta', type: 'BANK', transactions: 300, latest: new Date('2026-10-04T12:00:00.000Z') },
      { name: 'Cartão', type: 'CREDIT', transactions: 120, latest: new Date('2026-10-03T12:00:00.000Z') },
    ],
    lastRun: { status: 'success', finishedAt: new Date('2026-10-05T06:00:00.000Z'), warnings: [], error: null },
  },
  ...over,
});
const stateOf = (r: ReturnType<typeof checkConnection>, id: string) => r.checks.find((c) => c.id === id)?.state;

test('conexão saudável passa em todas as verificações', () => {
  const r = checkConnection(healthy());
  assert.equal(r.state, 'ok');
  assert.deepEqual(r.checks.map((c) => c.id), ['api', 'status', 'fresh', 'consent', 'products', 'accounts', 'transactions', 'sync']);
  assert.ok(r.checks.every((c) => c.state === 'ok'));
});

test('acesso recusado pelo banco, coleta antiga e autorização vencida reprovam', () => {
  const r = checkConnection(
    healthy({ item: { status: 'LOGIN_ERROR', error: { message: 'consent revoked' }, lastUpdatedAt: '2026-09-28T05:30:00.000Z', consentExpiresAt: '2026-10-01T00:00:00.000Z' } }),
  );
  assert.equal(r.state, 'fail');
  assert.deepEqual([stateOf(r, 'status'), stateOf(r, 'fresh'), stateOf(r, 'consent')], ['fail', 'fail', 'fail']);
  assert.match(r.checks.find((c) => c.id === 'status')!.detail, /reconectar.*consent revoked/);
});

test('avisos: autorização perto do fim, produto sem atualização, conta sem lançamentos, sincronização parcial', () => {
  const base = healthy();
  const r = checkConnection(
    healthy({
      item: { ...base.item, consentExpiresAt: '2026-10-20T00:00:00.000Z', statusDetail: { accounts: { isUpdated: true }, loans: { isUpdated: false } } },
      remoteAccounts: 3,
      local: {
        accounts: [...base.local.accounts, { name: 'Ourocard', type: 'CREDIT', transactions: 0, latest: null }],
        lastRun: { status: 'partial', finishedAt: NOW, warnings: ['empréstimos: 404'], error: null },
      },
    }),
  );
  assert.equal(r.state, 'warn');
  assert.deepEqual([stateOf(r, 'consent'), stateOf(r, 'products'), stateOf(r, 'accounts'), stateOf(r, 'transactions'), stateOf(r, 'sync')], ['warn', 'warn', 'ok', 'warn', 'warn']);
  assert.match(r.checks.find((c) => c.id === 'transactions')!.detail, /sem lançamentos: Ourocard/);
});

test('Pluggy fora do ar: reprova o acesso e ainda avalia o que está guardado', () => {
  const r = checkConnection(healthy({ item: null, apiError: 'Pluggy 503 em /items: indisponível', remoteAccounts: null }));
  assert.equal(r.state, 'fail');
  assert.deepEqual(r.checks.map((c) => [c.id, c.state]), [['api', 'fail'], ['transactions', 'ok'], ['sync', 'ok']]);
});

test('link de autorização: acha o endereço onde a Pluggy o colocar e ignora imagens', () => {
  assert.equal(authorizationUrl({ parameter: { name: 'oauth', data: 'https://meu.pluggy.ai/autorizar?x=1' }, connector: { imageUrl: 'https://cdn/x.png' } }), 'https://meu.pluggy.ai/autorizar?x=1');
  assert.equal(authorizationUrl({ userAction: { imageUrl: 'https://cdn/x.png', url: 'https://banco/ok' } }), 'https://banco/ok');
  assert.equal(authorizationUrl({ parameter: { data: 'http://inseguro' } }), null);
  assert.equal(authorizationUrl({ status: 'UPDATED' }), null);
});

test('reconectar só quando há problema: conexão saudável ou atualizando fica como está', () => {
  assert.equal(needsReconnect({ status: 'UPDATED', consentExpiresAt: '2027-09-01T00:00:00.000Z' }, NOW).needed, false);
  assert.equal(needsReconnect({ status: 'UPDATING' }, NOW).needed, false);
  assert.equal(needsReconnect({ status: 'LOGIN_ERROR' }, NOW).needed, true);
  assert.equal(needsReconnect({ status: 'OUTDATED' }, NOW).needed, true);
  assert.equal(needsReconnect({ status: 'WAITING_USER_INPUT' }, NOW).needed, true);
  // Autorização vencida pede reconexão mesmo que o item ainda apareça como atualizado.
  assert.deepEqual(needsReconnect({ status: 'UPDATED', consentExpiresAt: '2026-10-01T00:00:00.000Z' }, NOW), { needed: true, reason: 'a autorização venceu' });
});

test('banco já conectado não entra de novo como conexão nova', () => {
  const existing = [
    { connectionId: 'nubank', type: 'BANK', number: '0001/12345-6', name: 'Nu Pagamentos' },
    { connectionId: 'nubank', type: 'CREDIT', number: '8321', name: 'croma-platinum' },
    { connectionId: 'bb', type: 'CREDIT', number: '', name: 'Ourocard' },
  ];
  assert.equal(duplicateConnection([{ type: 'BANK', number: '0001/12345-6', name: 'Outro nome' }], existing), 'nubank');
  assert.equal(duplicateConnection([{ type: 'CREDIT', number: ' 8321 ', name: 'Croma-Platinum' }], existing), 'nubank');
  // Cartão de outro banco com os mesmos 4 dígitos, número curto ou ausente, conta diferente: não é repetição.
  assert.equal(duplicateConnection([{ type: 'CREDIT', number: '8321', name: 'Master Black' }], existing), null);
  assert.equal(duplicateConnection([{ type: 'BANK', number: '8321', name: 'croma-platinum' }], existing), null);
  assert.equal(duplicateConnection([{ type: 'CREDIT', number: '12', name: 'Ourocard' }, { type: 'CREDIT', number: null, name: 'Ourocard' }], existing), null);
  assert.equal(duplicateConnection([{ type: 'BANK', number: '9999/00000-0', name: 'Nu Pagamentos' }], existing), null);
});
