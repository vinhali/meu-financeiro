// Regras dos alertas e o texto do resumo diário. Funções puras: recebem o retrato do dia e
// devolvem o que avisar. Quem guarda, deduplica e envia é o engine.ts.

export type Severity = 'urgent' | 'attention' | 'info';

export interface AlertDraft {
  // Identifica o fato. O mesmo fato só vira um alerta, por mais vezes que as regras rodem.
  key: string;
  kind: string;
  severity: Severity;
  title: string;
  body: string;
}

export interface Thresholds {
  limitNear: number; // fração do limite que já merece aviso (0.8 = 80%)
  bigPurchase: number; // compra única a partir deste valor é "fora do padrão"
  monthDrop: number; // quanto o subtotal de um mês precisa piorar de um dia para o outro
  staleHours: number; // horas sem coleta para um banco ser considerado parado
  consentDays: number; // antecedência do aviso de autorização vencendo
}

export const DEFAULT_THRESHOLDS: Thresholds = { limitNear: 0.8, bigPurchase: 300, monthDrop: 200, staleHours: 36, consentDays: 30 };

// Só os campos da resposta do orçamento que as regras leem.
interface MonthMeta {
  label: string;
  month: string | null;
  state: string;
  cycle?: { start: string; end: string; state: string } | null;
}
interface RowMonth {
  planned?: number;
  state?: string;
  actual?: number;
  limit?: number | null;
  used?: number | null;
  projected?: number | null;
  suggested?: number | null;
  billState?: string | null;
  dueDate?: string | null;
  paid?: { amount: number; date: string } | null;
  previous?: { amount: number; date: string; firstDate?: string } | null;
}
interface Row {
  itemId: string;
  name: string;
  type: string;
  months: RowMonth[];
}

export interface AlertInput {
  now: Date;
  months: MonthMeta[];
  rows: Row[];
  cash: { total: number } | null;
  totals: Array<{ entradas: number; saidas: number; subtotal: number }>;
  // Subtotal de cada coluna no último dia anterior em que as regras rodaram, por rótulo.
  yesterday: Record<string, number> | null;
  cards: {
    avgTicket: number;
    largest: Array<{ date: string; name: string; amount: number; card: string }>;
    plans: Array<{ key?: string; name: string; label?: string | null; installment: number; totalInstallments: number; amount: number; endsIn: string }>;
    // Compras por dia do ciclo aberto, para o "desde ontem" do resumo.
    byDay: Array<{ day: string; total: number; count: number }>;
  } | null;
  connections: Array<{ id: string; bank: string; status: string; providerUpdatedAt: Date | null; consentExpiresAt: Date | null }>;
  thresholds: Thresholds;
}

const BRT_MS = 3 * 3_600_000;
export const localDay = (d: Date) => new Date(d.getTime() - BRT_MS).toISOString().slice(0, 10);
const brl = (v: number) => `${v < 0 ? '-' : ''}R$ ${Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
const monthName = (key: string) => `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(key.slice(5, 7)) - 1]}/${key.slice(2, 4)}`;

// Dia em que uma conta fixa costuma sair, neste mês: o mesmo dia do mês em que saiu no anterior.
function expectedDay(month: string, previous: { date: string; firstDate?: string }): string {
  const day = Number((previous.firstDate ?? previous.date).slice(8, 10));
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  return `${month}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

// O que vence nos próximos `days` dias: faturas fechadas e contas fixas ainda não pagas com dia conhecido.
export function dueSoon(input: Pick<AlertInput, 'now' | 'months' | 'rows'>, days: number): Array<{ name: string; day: string; amount: number }> {
  const today = localDay(input.now);
  const out: Array<{ name: string; day: string; amount: number }> = [];
  for (const row of input.rows) {
    row.months.forEach((m, i) => {
      const meta = input.months[i];
      if (row.type === 'cardBill' && m.billState === 'closed' && m.dueDate && (m.suggested ?? 0) > 0) {
        const left = daysBetween(today, m.dueDate);
        if (left >= 0 && left <= days) out.push({ name: row.name, day: m.dueDate, amount: m.suggested! });
      }
      if (row.type === 'fixed' && meta?.month && meta.state === 'current' && !m.paid && m.previous && (m.planned ?? 0) > 0) {
        const day = expectedDay(meta.month, m.previous);
        const left = daysBetween(today, day);
        if (left >= 0 && left <= days) out.push({ name: row.name, day, amount: m.planned! });
      }
    });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

export function evaluateAlerts(input: AlertInput): AlertDraft[] {
  const { now, thresholds: t } = input;
  const today = localDay(now);
  const out: AlertDraft[] = [];
  const add = (key: string, kind: string, severity: Severity, title: string, body: string) => out.push({ key, kind, severity, title, body });

  for (const row of input.rows) {
    row.months.forEach((m, i) => {
      const meta = input.months[i];
      if (!meta?.month) return;

      // ── Fatura de cartão vencendo ──
      if (row.type === 'cardBill' && m.billState === 'closed' && m.dueDate && (m.suggested ?? 0) > 0) {
        const left = daysBetween(today, m.dueDate);
        if (left === 0) add(`billdue:${row.itemId}:${m.dueDate}:today`, 'billDue', 'urgent', `${row.name} vence hoje`, `${brl(m.suggested!)}, vencimento em ${dm(m.dueDate)}.`);
        else if (left > 0 && left <= 3) add(`billdue:${row.itemId}:${m.dueDate}:soon`, 'billDue', 'attention', `${row.name} vence em ${left} dia(s)`, `${brl(m.suggested!)}, vencimento em ${dm(m.dueDate)}.`);
      }

      // ── Conta fixa que costuma já ter saído e nenhum banco mostra ──
      if (row.type === 'fixed' && meta.state === 'current' && !m.paid && m.previous && (m.planned ?? 0) > 0) {
        const day = expectedDay(meta.month, m.previous);
        if (daysBetween(day, today) > 2) {
          add(`late:${row.itemId}:${meta.month}`, 'late', 'attention', `${row.name} ainda não apareceu`, `Costuma sair por volta do dia ${day.slice(8, 10)} (mês passado: ${dm(m.previous.date)}, ${brl(m.previous.amount)}). Nenhum banco mostra o pagamento de ${brl(m.planned!)} deste mês.`);
        }
      }

      // ── Limites do ciclo em andamento ──
      const running = meta.cycle ? meta.cycle.state === 'current' : meta.state === 'current';
      if (row.type === 'limit' && running && (m.limit ?? 0) > 0 && m.actual !== undefined) {
        const used = m.used ?? m.actual / m.limit!;
        const pct = Math.round(used * 100);
        if (used > 1) add(`limitover:${row.itemId}:${meta.month}`, 'limit', 'attention', `${row.name} estourou o limite`, `${brl(m.actual)} de ${brl(m.limit!)} (${pct}%): passou ${brl(m.actual - m.limit!)}.`);
        else if (used >= t.limitNear) add(`limitnear:${row.itemId}:${meta.month}`, 'limit', 'attention', `${row.name} está em ${pct}% do limite`, `${brl(m.actual)} de ${brl(m.limit!)}: restam ${brl(m.limit! - m.actual)} até o fim do ciclo.`);
        else if (m.projected != null && m.projected > m.limit!) add(`limitpace:${row.itemId}:${meta.month}`, 'limit', 'info', `${row.name} no ritmo de estourar`, `${brl(m.actual)} de ${brl(m.limit!)} até agora; nesse ritmo o ciclo fecha em ${brl(m.projected)}.`);
      }
    });
  }

  // ── Dinheiro em conta não cobre o que vence na semana ──
  if (input.cash) {
    const soon = dueSoon(input, 7);
    const total = soon.reduce((sum, d) => sum + d.amount, 0);
    if (total > 0 && input.cash.total < total) {
      // Uma vez por semana do mês, enquanto a situação durar; o resumo diário mostra o estado todo dia.
      const week = `${today.slice(0, 7)}-s${Math.ceil(Number(today.slice(8, 10)) / 7)}`;
      add(`cash7:${week}`, 'cash', 'urgent', 'O dinheiro em conta não cobre a semana', `Em conta: ${brl(input.cash.total)}. Vence nos próximos 7 dias: ${brl(total)} (${soon.map((d) => `${d.name} ${dm(d.day)}`).join(', ')}). Faltam ${brl(total - input.cash.total)}.`);
    }
  }

  // ── Cartões: compra fora do padrão e parcelamento novo ──
  if (input.cards) {
    const floor = Math.max(t.bigPurchase, input.cards.avgTicket * 3);
    for (const p of input.cards.largest) {
      const day = localDay(new Date(p.date));
      if (p.amount >= floor && daysBetween(day, today) <= 3) add(`big:${day}:${p.name}:${p.amount}`, 'bigPurchase', 'info', `Compra acima do seu padrão: ${p.name}`, `${brl(p.amount)} em ${dm(day)} no ${p.card}. Seu tíquete médio no período é ${brl(input.cards.avgTicket)}.`);
    }
    for (const p of input.cards.plans) {
      if (p.installment === 1 && p.key) add(`plan:${p.key}`, 'newPlan', 'info', `Parcelamento novo: ${p.label || p.name}`, `${p.totalInstallments}x de ${brl(p.amount)}, até ${monthName(p.endsIn)}. Compromete ${brl(p.amount)} por mês nas próximas faturas.`);
    }
  }

  // ── O mês piorou desde ontem ──
  if (input.yesterday) {
    input.months.forEach((meta, i) => {
      const before = input.yesterday![meta.label];
      const nowValue = input.totals[i]?.subtotal;
      if (before === undefined || nowValue === undefined) return;
      const drop = before - nowValue;
      if (drop >= t.monthDrop) add(`monthdrop:${meta.label}:${today}`, 'monthDrop', 'attention', `${meta.label} piorou ${brl(drop)} desde ontem`, `O mês fechava em ${brl(before)} e agora fecha em ${brl(nowValue)}.`);
    });
  }

  // ── Dados dos bancos ──
  for (const c of input.connections) {
    if (!['UPDATED', 'UPDATING'].includes(c.status)) add(`conn:${c.id}:${c.status}`, 'connection', 'urgent', `${c.bank} precisa ser reconectado`, 'O banco não está entregando dados. Abra a aba Open Finance e use “Reconectar”.');
    else if (c.providerUpdatedAt && now.getTime() - c.providerUpdatedAt.getTime() > t.staleHours * 3_600_000) {
      add(`stale:${c.id}:${today}`, 'connection', 'attention', `${c.bank} está sem atualizar`, `A última coleta foi em ${dm(localDay(c.providerUpdatedAt))}. Os números desse banco podem estar atrasados.`);
    }
    if (c.consentExpiresAt) {
      const left = daysBetween(today, localDay(c.consentExpiresAt));
      if (left >= 0 && left <= t.consentDays) add(`consent:${c.id}:${localDay(c.consentExpiresAt)}`, 'connection', 'attention', `A autorização do ${c.bank} vence em ${left} dia(s)`, `Vence em ${dm(localDay(c.consentExpiresAt))}. Reconecte pela aba Open Finance antes disso para não perder os dados.`);
    }
  }

  return out;
}

// Resumo diário, em texto simples: serve para o Telegram e para o e-mail.
export function buildDigest(input: AlertInput, open: Array<{ severity: string; title: string; body: string }>, appUrl: string | null): { subject: string; text: string } {
  const today = localDay(input.now);
  const weekday = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(`${today}T12:00:00Z`).getUTCDay()];
  const lines: string[] = [`Meu financeiro · ${weekday} ${dm(today)}`, ''];

  if (input.cash) lines.push(`Em conta: ${brl(input.cash.total)}`);
  const soon = dueSoon(input, 7);
  if (soon.length) {
    lines.push(`Vence em 7 dias: ${brl(soon.reduce((sum, d) => sum + d.amount, 0))}`);
    for (const d of soon) lines.push(`  • ${dm(d.day)} ${d.name}: ${brl(d.amount)}`);
  } else lines.push('Nada com vencimento conhecido nos próximos 7 dias.');

  const limits: string[] = [];
  let cycle: MonthMeta['cycle'] = null;
  for (const row of input.rows) {
    if (row.type !== 'limit') continue;
    row.months.forEach((m, i) => {
      const meta = input.months[i];
      const running = meta?.cycle ? meta.cycle.state === 'current' : meta?.state === 'current';
      if (!running || m.actual === undefined || !(m.limit ?? 0)) return;
      cycle = meta.cycle ?? cycle;
      const pct = Math.round(((m.used ?? m.actual / m.limit!) || 0) * 100);
      limits.push(`  • ${row.name}: ${brl(m.actual)} de ${brl(m.limit!)} (${pct}%)${m.actual > m.limit! ? ' — estourou' : ''}`);
    });
  }
  if (limits.length) {
    const c = cycle as MonthMeta['cycle'];
    lines.push('', `Limites${c ? ` (ciclo ${dm(c.start)} a ${dm(c.end)})` : ''}`, ...limits);
  }

  if (input.cards) {
    const yesterday = localDay(new Date(input.now.getTime() - 86_400_000));
    const fresh = input.cards.byDay.filter((d) => d.day >= yesterday);
    const count = fresh.reduce((sum, d) => sum + d.count, 0);
    const latest = [...input.cards.byDay].reverse().find((d) => d.total > 0);
    lines.push('', count > 0 ? `Compras no cartão desde ontem: ${count}, somando ${brl(fresh.reduce((sum, d) => sum + d.total, 0))}` : `Nenhuma compra nova entregue pelos bancos desde ontem${latest ? ` (a mais recente é de ${dm(latest.day)})` : ''}.`);
  }

  lines.push('', 'Como cada mês fecha');
  input.months.forEach((meta, i) => {
    const value = input.totals[i]?.subtotal;
    if (value === undefined) return;
    const before = input.yesterday?.[meta.label];
    const delta = before === undefined ? null : Math.round((value - before) * 100) / 100;
    lines.push(`  • ${meta.label}: ${brl(value)}${delta === null || delta === 0 ? '' : delta > 0 ? ` (melhorou ${brl(delta)} desde ontem)` : ` (piorou ${brl(-delta)} desde ontem)`}`);
  });

  const needsAction = open.filter((a) => a.severity !== 'info');
  if (needsAction.length) {
    lines.push('', 'Precisa de atenção');
    for (const a of needsAction) lines.push(`  • ${a.title}. ${a.body}`);
  }
  if (appUrl) lines.push('', appUrl);

  const urgent = open.filter((a) => a.severity === 'urgent').length;
  return { subject: `Meu financeiro · ${dm(today)}${urgent ? ` · ${urgent} urgente(s)` : needsAction.length ? ` · ${needsAction.length} aviso(s)` : ''}`, text: lines.join('\n') };
}
