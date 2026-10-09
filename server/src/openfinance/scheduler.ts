import { prisma } from '../db';
import { PluggyClient, pluggyConfigFromEnv } from './pluggy';
import { connectionIds, syncAll } from './sync';

const DEFAULT_INTERVAL_HOURS = 6;
const CHECK_EVERY_MS = 15 * 60 * 1000;

function intervalMs(): number {
  const n = Number(process.env.PLUGGY_SYNC_INTERVAL_HOURS);
  return (Number.isFinite(n) && n > 0 ? n : DEFAULT_INTERVAL_HOURS) * 3_600_000;
}

async function tick(client: PluggyClient) {
  const ids = await connectionIds(prisma);
  if (ids.length === 0) return;
  const last = await prisma.ofSyncRun.findFirst({ orderBy: { startedAt: 'desc' }, select: { startedAt: true } });
  if (last && Date.now() - last.startedAt.getTime() < intervalMs()) return;
  const results = await syncAll(prisma, client, 'schedule');
  for (const r of results) {
    console.log(`[openfinance] ${r.connectionId}: ${r.status} ${JSON.stringify(r.stats)}${r.error ? ` erro=${r.error}` : ''}`);
  }
}

// A Pluggy atualiza os itens do MeuPluggy uma vez por dia; aqui só puxamos o que já está lá.
export function startOpenFinanceScheduler() {
  const config = pluggyConfigFromEnv();
  if (!config) {
    console.log('[openfinance] PLUGGY_CLIENT_ID/PLUGGY_CLIENT_SECRET não definidos — sincronização desativada');
    return;
  }
  const client = new PluggyClient(config);
  const run = () => tick(client).catch((err) => console.error('[openfinance] falha no agendador:', err));
  setTimeout(run, 60_000).unref();
  setInterval(run, CHECK_EVERY_MS).unref();
  console.log('[openfinance] agendador ativo');
}
