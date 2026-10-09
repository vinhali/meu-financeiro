// Motor dos alertas: monta o retrato do dia a partir do banco, aplica as regras, guarda o que é
// novo e envia — o urgente na hora, o resto no resumo diário.
import { prisma } from '../db';
import { loadBudget, loadCards } from '../openfinance/service';
import { deliver, ChannelResult } from './channels';
import { digestDue, getSetting, loadChannels, loadConfig, setSetting } from './config';
import { AlertInput, buildDigest, evaluateAlerts, localDay } from './rules';
import { monthTotals } from './totals';

const CHECK_EVERY_MS = 15 * 60_000;

// Retrato do dia para as regras; null quando não há cenário base.
async function snapshot(now: Date): Promise<AlertInput | null> {
  const scenario = await prisma.scenario.findFirst({ where: { isBase: true }, include: { items: { orderBy: [{ section: 'asc' }, { order: 'asc' }] } } });
  if (!scenario) return null;
  const budget = await loadBudget(scenario.id);
  if (!budget) return null;
  const items = scenario.items.map((i) => ({ id: i.id, name: i.name, section: i.section, controllable: i.controllable, values: JSON.parse(i.values) as number[] }));
  const totals = monthTotals(items, budget.rows, budget.months.length);

  // Subtotais de ontem: guardamos o último retrato de cada dia e comparamos com o do dia anterior.
  const today = localDay(now);
  const values = Object.fromEntries(budget.months.map((m, i) => [m.label, totals[i].subtotal]));
  const stored = JSON.parse((await getSetting('alerts.subtotals')) ?? 'null') as { day: string; values: Record<string, number>; previous: Record<string, number> | null } | null;
  const previous = stored ? (stored.day === today ? stored.previous : stored.values) : null;
  await setSetting('alerts.subtotals', JSON.stringify({ day: today, values, previous }));

  const [cards, connections] = await Promise.all([
    loadCards({ months: 1, range: {}, billCycle: true }).catch(() => null),
    prisma.ofConnection.findMany({ include: { accounts: { select: { type: true, name: true } } } }),
  ]);
  return {
    now,
    months: budget.months,
    rows: budget.rows,
    cash: budget.cash ?? null,
    totals,
    yesterday: previous,
    cards: cards
      ? {
          avgTicket: cards.totals.avgTicket,
          largest: cards.largest.map((p) => ({ date: p.date, name: p.name, amount: p.amount, card: p.card })),
          plans: cards.installments.active,
          byDay: (cards.byDay ?? []).map((d) => ({ day: d.day, total: d.total, count: d.count })),
        }
      : null,
    connections: connections.map((c) => ({
      id: c.id,
      bank: (c.accounts.find((a) => a.type === 'BANK') ?? c.accounts[0])?.name.trim() ?? c.connectorName,
      status: c.status,
      providerUpdatedAt: c.providerUpdatedAt,
      consentExpiresAt: c.consentExpiresAt,
    })),
    thresholds: (await loadConfig()).thresholds,
  };
}

const openAlerts = () => prisma.alert.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: 'desc' }, take: 60 });

// Aplica as regras e guarda os alertas novos. Devolve quantos foram criados.
export async function evaluate(now: Date = new Date()): Promise<{ created: number; input: AlertInput | null }> {
  const input = await snapshot(now);
  if (!input) return { created: 0, input: null };
  let created = 0;
  const { rules } = await loadConfig();
  // Regra desligada nas configurações não gera alerta.
  for (const draft of evaluateAlerts(input).filter((d) => rules[d.kind as keyof typeof rules] !== false)) {
    const exists = await prisma.alert.findUnique({ where: { key: draft.key }, select: { id: true } });
    if (exists) continue;
    await prisma.alert.create({ data: draft });
    created++;
  }
  return { created, input };
}

// Resumo do dia para os canais configurados. `force` ignora o "já enviei hoje" (botão de teste);
// `only` manda por um canal só.
export async function sendDigest(now: Date = new Date(), force = false, only?: 'telegram' | 'email'): Promise<ChannelResult[]> {
  const { input } = await evaluate(now);
  if (!input) return [];
  const today = localDay(now);
  if (!force && (await getSetting('alerts.digestDay')) === today) return [];
  const digest = buildDigest(input, await openAlerts(), process.env.APP_URL?.trim() || null);
  const results = await deliver(digest.subject, digest.text, await loadChannels(), only);
  if (results.some((r) => r.ok) && !force) {
    await setSetting('alerts.digestDay', today);
    // O resumo já levou tudo o que estava em aberto.
    await prisma.alert.updateMany({ where: { sentAt: null }, data: { sentAt: now } });
  }
  return results;
}

async function tick() {
  const now = new Date();
  const config = await loadConfig();
  await evaluate(now);
  // Urgente não espera o resumo.
  if (config.urgentNow) {
    const urgent = await prisma.alert.findMany({ where: { severity: 'urgent', sentAt: null, resolvedAt: null }, orderBy: { createdAt: 'asc' } });
    if (urgent.length) {
      const text = ['Meu financeiro · urgente', '', ...urgent.map((a) => `• ${a.title}. ${a.body}`), ...(process.env.APP_URL ? ['', process.env.APP_URL.trim()] : [])].join('\n');
      const results = await deliver(`Meu financeiro · ${urgent[0].title}`, text, await loadChannels(config));
      if (results.some((r) => r.ok)) await prisma.alert.updateMany({ where: { id: { in: urgent.map((a) => a.id) } }, data: { sentAt: now } });
      for (const r of results) if (!r.ok) console.error(`[alertas] falha no envio por ${r.channel}: ${r.error}`);
    }
  }
  // Resumo, uma vez no dia, a partir do horário combinado (Brasília); no semanal, só no dia escolhido.
  if (digestDue(config.digest, now)) {
    const results = await sendDigest(now);
    for (const r of results) if (!r.ok) console.error(`[alertas] falha no resumo por ${r.channel}: ${r.error}`);
  }
}

export function startAlerts() {
  const run = () => tick().catch((err) => console.error('[alertas] falha no agendador:', err instanceof Error ? err.message : err));
  setTimeout(run, 90_000).unref();
  setInterval(run, CHECK_EVERY_MS).unref();
  loadConfig()
    .then(async (config) => {
      const channels = await loadChannels(config);
      console.log(`[alertas] ativo · resumo ${config.digest.enabled ? `${config.digest.frequency === 'weekly' ? 'semanal' : 'diário'} às ${config.digest.at}` : 'desligado'} · telegram ${channels.telegram.token ? 'configurado' : 'sem token'} · e-mail ${channels.email ? 'configurado' : 'não configurado'}`);
    })
    .catch(() => console.log('[alertas] ativo'));
}
