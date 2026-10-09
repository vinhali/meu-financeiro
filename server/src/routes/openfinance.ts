import { Router } from 'express';
import { prisma } from '../db';
import { PluggyClient, pluggyConfigFromEnv } from '../openfinance/pluggy';
import { isSyncRunning, mapConnection, syncAll, syncConnection } from '../openfinance/sync';
import { invalidateOpenFinance } from '../openfinance/cache';
import { loadBudget, loadCards } from '../openfinance/service';
import { CATEGORY_CHOICES } from '../openfinance/labels';
import { authorizationUrl, checkConnection, duplicateConnection, needsReconnect } from '../openfinance/health';

const router = Router();

const reais = (cents: bigint | null) => (cents === null ? null : Number(cents) / 100);

let client: PluggyClient | null = null;
function getClient(): PluggyClient | null {
  if (client) return client;
  const config = pluggyConfigFromEnv();
  if (config) client = new PluggyClient(config);
  return client;
}

// GET /api/openfinance/status - conexões, contas e últimas sincronizações
router.get('/status', async (_req, res) => {
  const [connections, runs, transactions, investments, loans] = await Promise.all([
    prisma.ofConnection.findMany({
      orderBy: { connectorName: 'asc' },
      include: { accounts: { orderBy: { name: 'asc' }, include: { _count: { select: { transactions: true } } } } },
    }),
    prisma.ofSyncRun.findMany({ orderBy: { startedAt: 'desc' }, take: 10 }),
    prisma.ofTransaction.count(),
    prisma.ofInvestment.count(),
    prisma.ofLoan.count(),
  ]);

  res.json({
    configured: getClient() !== null,
    syncing: isSyncRunning(),
    totals: { transactions, investments, loans },
    connections: connections.map((c) => ({
      id: c.id,
      connector: c.connectorName,
      status: c.status,
      error: c.errorMessage,
      consentExpiresAt: c.consentExpiresAt,
      providerUpdatedAt: c.providerUpdatedAt,
      lastSyncedAt: c.lastSyncedAt,
      accounts: c.accounts.map((a) => ({
        id: a.id,
        type: a.type,
        subtype: a.subtype,
        name: a.name,
        number: a.number,
        currencyCode: a.currencyCode,
        balance: reais(a.balanceCents),
        creditLimit: reais(a.creditLimitCents),
        transactions: a._count.transactions,
      })),
    })),
    runs: runs.map((r) => ({
      id: r.id,
      connectionId: r.connectionId,
      trigger: r.trigger,
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      stats: JSON.parse(r.stats),
      error: r.error,
    })),
  });
});

// GET /api/openfinance/cards?months=1|3|6|12&from=AAAA-MM-DD&to=AAAA-MM-DD&accountId=... - gastos dos cartões
router.get('/cards', async (req, res) => {
  const months = [1, 3, 6, 12].includes(Number(req.query.months)) ? Number(req.query.months) : 6;
  // Intervalo personalizado: as duas datas válidas (AAAA-MM-DD) e em ordem; senão vale `months`.
  const isDay = (v: unknown): v is string => typeof v === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v) && !Number.isNaN(Date.parse(v));
  const { from, to } = req.query;
  const range: { from?: string; to?: string } = isDay(from) && isDay(to) && from <= to ? { from, to } : {};
  const billCycle = req.query.period === 'bill';
  const accountId = typeof req.query.accountId === 'string' && req.query.accountId ? req.query.accountId : undefined;

  res.json(await loadCards({ months, range, billCycle, accountId }));
});

// GET /api/openfinance/budget?scenarioId=... - planejado x realizado das saídas do cenário
router.get('/budget', async (req, res) => {
  const scenarioId = typeof req.query.scenarioId === 'string' ? req.query.scenarioId : '';
  const budget = await loadBudget(scenarioId);
  if (!budget) {
    res.status(404).json({ error: 'Cenário não encontrado' });
    return;
  }
  res.json(budget);
});

// PUT /api/openfinance/paid-marks - marca (ou desmarca) uma conta como paga num mês
router.put('/paid-marks', async (req, res) => {
  const itemId = typeof req.body?.itemId === 'string' ? req.body.itemId : '';
  const month = typeof req.body?.month === 'string' && /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(req.body.month) ? req.body.month : '';
  if (!itemId || !month || !(await prisma.lineItem.findUnique({ where: { id: itemId }, select: { id: true } }))) {
    res.status(400).json({ error: 'Linha ou mês inválido' });
    return;
  }
  if (req.body?.paid === false) await prisma.paidMark.deleteMany({ where: { itemId, month } });
  // Marcar de novo recomeça o prazo de conferência.
  else await prisma.paidMark.upsert({ where: { itemId_month: { itemId, month } }, create: { itemId, month }, update: { markedAt: new Date() } });
  res.json({ ok: true });
});

// PUT /api/openfinance/merchant-labels - nome, descrição e categoria que o usuário dá a um estabelecimento.
// Só os campos enviados mudam: dá para corrigir a categoria sem mexer no nome.
router.put('/merchant-labels', async (req, res) => {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 80) : '');
  const key = typeof req.body?.key === 'string' ? req.body.key.trim().slice(0, 200) : '';
  if (!key) {
    res.status(400).json({ error: 'key é obrigatória' });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  if ('category' in body && body.category !== null && body.category !== '' && !(typeof body.category === 'string' && body.category in CATEGORY_CHOICES)) {
    res.status(400).json({ error: 'categoria desconhecida' });
    return;
  }
  const current = await prisma.ofMerchantLabel.findUnique({ where: { key } });
  const name = 'name' in body ? text(body.name) || null : (current?.name ?? null);
  const kind = 'kind' in body ? text(body.kind) || null : (current?.kind ?? null);
  const category = 'category' in body ? (typeof body.category === 'string' && body.category ? body.category : null) : (current?.category ?? null);
  // Nada definido: volta ao rótulo automático.
  if (!name && !kind && !category) await prisma.ofMerchantLabel.deleteMany({ where: { key } });
  else await prisma.ofMerchantLabel.upsert({ where: { key }, create: { key, name, kind, category }, update: { name, kind, category } });
  invalidateOpenFinance();
  res.json({ ok: true });
});

// POST /api/openfinance/connections - registra um item da Pluggy e faz a primeira carga
router.post('/connections', async (req, res) => {
  const pluggy = getClient();
  if (!pluggy) {
    res.status(503).json({ error: 'Pluggy não configurada: defina PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET' });
    return;
  }
  const itemId = typeof req.body?.itemId === 'string' ? req.body.itemId.trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemId)) {
    res.status(400).json({ error: 'itemId inválido (esperado um UUID da Pluggy)' });
    return;
  }
  const result = await syncConnection(prisma, pluggy, itemId, 'manual');
  res.status(result.status === 'error' ? 502 : 201).json(result);
});

// POST /api/openfinance/sync - dispara a sincronização em segundo plano
router.post('/sync', (_req, res) => {
  const pluggy = getClient();
  if (!pluggy) {
    res.status(503).json({ error: 'Pluggy não configurada: defina PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET' });
    return;
  }
  const alreadyRunning = isSyncRunning();
  syncAll(prisma, pluggy, 'manual').catch((err) => console.error('[openfinance] falha na sincronização:', err));
  res.status(202).json({ started: !alreadyRunning, syncing: true });
});

// ── Conectar, reconectar e testar ──
// Conector MeuPluggy: é por ele que cada banco é autorizado, um item por banco.
const MEU_PLUGGY = 200;
const isItemId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
// Itens cuja primeira carga está rodando, para não disparar duas vezes enquanto a tela consulta.
const loading = new Set<string>();

// O link de autorização aparece alguns segundos depois de criar/atualizar o item.
async function waitForAuthorization(pluggy: PluggyClient, first: any): Promise<any> {
  let item = first;
  for (let i = 0; i < 12 && !authorizationUrl(item) && ['WAITING_USER_INPUT', 'UPDATING', 'CREATED'].includes(String(item.status)); i++) {
    await new Promise((r) => setTimeout(r, 1500));
    item = await pluggy.getItem(item.id);
  }
  return item;
}

const progress = (item: any) => ({
  itemId: String(item.id),
  status: String(item.status ?? 'UNKNOWN'),
  executionStatus: item.executionStatus ?? null,
  url: authorizationUrl(item),
  error: item.error?.message ? String(item.error.message).slice(0, 300) : null,
});

// POST /api/openfinance/connect - cria um item novo e devolve o link para autorizar o banco
router.post('/connect', async (_req, res) => {
  const pluggy = getClient();
  if (!pluggy) {
    res.status(503).json({ error: 'Pluggy não configurada: defina PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET' });
    return;
  }
  const item = await waitForAuthorization(pluggy, await pluggy.createItem(MEU_PLUGGY));
  res.status(201).json(progress(item));
});

// POST /api/openfinance/connections/:id/reconnect - pede nova coleta; se a autorização venceu, devolve o link
router.post('/connections/:id/reconnect', async (req, res) => {
  const pluggy = getClient();
  if (!pluggy) {
    res.status(503).json({ error: 'Pluggy não configurada: defina PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET' });
    return;
  }
  if (!isItemId(req.params.id) || !(await prisma.ofConnection.findUnique({ where: { id: req.params.id }, select: { id: true } }))) {
    res.status(404).json({ error: 'Conexão não encontrada' });
    return;
  }
  // Antes de mexer, olha a situação real: conexão saudável (ou já atualizando) fica como está.
  // Os dados guardados não são tocados em nenhum caso — reconectar usa o mesmo item, então as
  // contas e o histórico continuam os mesmos.
  const current = await pluggy.getItem(req.params.id);
  const need = needsReconnect(current, new Date());
  if (!need.needed) {
    res.status(409).json({ error: `Nada foi alterado: ${need.reason}.` });
    return;
  }
  const item = await waitForAuthorization(pluggy, await pluggy.updateItem(req.params.id));
  res.json(progress(item));
});

// GET /api/openfinance/connect/:itemId - andamento de uma conexão; quando o banco termina, carrega os dados
router.get('/connect/:itemId', async (req, res) => {
  const pluggy = getClient();
  if (!pluggy) {
    res.status(503).json({ error: 'Pluggy não configurada: defina PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET' });
    return;
  }
  const itemId = req.params.itemId;
  if (!isItemId(itemId)) {
    res.status(400).json({ error: 'itemId inválido' });
    return;
  }
  const item = await pluggy.getItem(itemId);
  const state = progress(item);
  let done = false;
  if (state.status === 'UPDATED' && !loading.has(itemId)) {
    const known = await prisma.ofConnection.findUnique({ where: { id: itemId }, select: { lastSyncedAt: true } });
    const collected = item.lastUpdatedAt ? new Date(item.lastUpdatedAt) : null;
    // Já carregado depois desta coleta: terminou. Senão, carrega em segundo plano.
    if (known?.lastSyncedAt && collected && known.lastSyncedAt >= collected) done = true;
    else if (!known) {
      // Conexão nova: se for um banco que já está conectado, não carrega (contaria tudo em dobro).
      const [incoming, existing] = await Promise.all([pluggy.getAccounts(itemId), prisma.ofAccount.findMany({ select: { connectionId: true, type: true, number: true, name: true } })]);
      const repeated = duplicateConnection(incoming, existing);
      if (repeated) {
        res.json({ ...state, loading: false, done: false, duplicateOf: repeated, error: 'Este banco já está conectado. Nada foi alterado: para renovar o acesso, use “Reconectar” no cartão dele.' });
        return;
      }
      loading.add(itemId);
      syncConnection(prisma, pluggy, itemId, 'manual')
        .catch((err) => console.error('[openfinance] falha ao carregar a conexão:', err))
        .finally(() => loading.delete(itemId));
    } else {
      loading.add(itemId);
      syncConnection(prisma, pluggy, itemId, 'manual')
        .catch((err) => console.error('[openfinance] falha ao carregar a conexão:', err))
        .finally(() => loading.delete(itemId));
    }
  }
  res.json({ ...state, loading: loading.has(itemId), done });
});

// POST /api/openfinance/connections/:id/test - teste de qualidade da conexão
router.post('/connections/:id/test', async (req, res) => {
  const pluggy = getClient();
  const id = req.params.id;
  const connection = isItemId(id)
    ? await prisma.ofConnection.findUnique({ where: { id }, include: { accounts: { include: { _count: { select: { transactions: true } } } } } })
    : null;
  if (!connection) {
    res.status(404).json({ error: 'Conexão não encontrada' });
    return;
  }
  const now = new Date();
  let item: any = null;
  let apiError: string | null = pluggy ? null : 'Pluggy não configurada no servidor';
  let latencyMs: number | null = null;
  let remoteAccounts: number | null = null;
  if (pluggy) {
    try {
      const started = Date.now();
      item = await pluggy.getItem(id);
      latencyMs = Date.now() - started;
      remoteAccounts = (await pluggy.getAccounts(id)).length;
    } catch (err) {
      apiError = err instanceof Error ? err.message.slice(0, 200) : 'falha ao consultar a Pluggy';
    }
  }
  const [latest, lastRun] = await Promise.all([
    prisma.ofTransaction.groupBy({ by: ['accountId'], where: { accountId: { in: connection.accounts.map((a) => a.id) }, date: { lte: now } }, _max: { date: true } }),
    prisma.ofSyncRun.findFirst({ where: { connectionId: id }, orderBy: { startedAt: 'desc' } }),
  ]);
  const latestOf = new Map(latest.map((l) => [l.accountId, l._max.date]));
  const result = checkConnection({
    now,
    item,
    apiError,
    latencyMs,
    remoteAccounts,
    local: {
      accounts: connection.accounts.map((a) => ({ name: a.name.trim(), type: a.type, transactions: a._count.transactions, latest: latestOf.get(a.id) ?? null })),
      lastRun: lastRun
        ? { status: lastRun.status, finishedAt: lastRun.finishedAt, warnings: ((JSON.parse(lastRun.stats) as { warnings?: string[] }).warnings ?? []).map(String), error: lastRun.error }
        : null,
    },
  });
  // O que a Pluggy disse agora fica guardado: a lista de conexões passa a mostrar a situação atual.
  if (item) {
    const m = mapConnection(item);
    await prisma.ofConnection.update({ where: { id }, data: m });
  }
  res.json({ connectionId: id, testedAt: now, ...result });
});

export default router;
