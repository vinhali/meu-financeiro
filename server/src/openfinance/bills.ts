// Fatura fechada e fatura aberta de um cartão, a partir do que o Open Finance entrega.
//
// O saldo da conta de cartão (`balance`) é o limite utilizado — inclui todas as parcelas
// futuras — e NÃO o valor da fatura. As faturas listadas pela Pluggy chegam com um ciclo de
// atraso em vários bancos, então os ciclos mais recentes são reconstruídos a partir dos
// lançamentos que ainda não têm fatura (`billId` nulo), agrupados pela previsão de fatura
// (`billForecastDate`) que o banco informa em cada lançamento.

export interface BillRow {
  id: string;
  dueDate: Date;
  closingDate: Date | null;
  totalAmountCents: bigint;
  paymentsCents: number; // soma dos pagamentos registrados na própria fatura
}

export interface BillTransactionRow {
  date: Date;
  type: string; // DEBIT | CREDIT
  cents: number; // valor em reais (centavos), com o sinal da Pluggy
  billId: string | null;
  billForecast: string | null; // "AAAA-MM", como o banco informa
  isPayment: boolean;
  // Compra parcelada: identifica o plano (mesmo estabelecimento e nº de parcelas). O valor
  // distingue planos iguais no mesmo estabelecimento, com tolerância de centavos.
  planKey?: string | null;
  installmentNumber?: number | null;
  totalInstallments?: number | null;
}

export interface BillSummary {
  amount: number; // reais
  // Parte de `amount` que são parcelas ainda não lançadas pelo banco, projetadas da parcela anterior.
  projectedInstallments: number;
  // Parte de `amount` que são parcelas de compras parceladas (já lançadas ou projetadas).
  installments: number;
  dueDate: string; // AAAA-MM-DD
  closingDate: string | null;
  estimated: boolean; // reconstruída a partir dos lançamentos (ainda não listada pelo banco)
}

const INSTALLMENT_ROUNDING_CENTS = 10;

const ym = (d: Date) => d.toISOString().slice(0, 7);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

function addMonths(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

// Mesma data, n meses depois, sem estourar o mês (31/01 + 1 mês = 28/02).
function shiftMonths(d: Date, n: number): Date {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return target;
}

// Mês de vencimento da fatura em que cada lançamento cai, segundo o próprio banco: a fatura já
// listada (`billId`) ou a previsão informada no lançamento. Pagamentos e resíduos antigos: null.
export function assignDueMonths(bills: BillRow[], transactions: Array<Pick<BillTransactionRow, 'date' | 'billId' | 'billForecast' | 'isPayment'>>): Array<string | null> {
  const last = [...bills].sort((a, b) => b.dueDate.getTime() - a.dueDate.getTime())[0];
  if (!last) return transactions.map(() => null);
  const dueOfBill = new Map(bills.map((b) => [b.id, ym(b.dueDate)]));
  const lastDue = ym(last.dueDate);
  const lastClosing = last.closingDate ?? new Date(last.dueDate.getTime() - 7 * 86_400_000);
  const votes = new Map<number, number>();
  for (const t of transactions) {
    if (t.billId !== last.id || !t.billForecast) continue;
    const diff = monthsBetween(t.billForecast, lastDue);
    if (diff === 0 || diff === 1) votes.set(diff, (votes.get(diff) ?? 0) + 1);
  }
  const offset = (votes.get(0) ?? 0) > (votes.get(1) ?? 0) ? 0 : 1;
  return transactions.map((t) => {
    if (t.isPayment) return null;
    if (t.billId !== null) return dueOfBill.get(t.billId) ?? null;
    const due = t.billForecast ? addMonths(t.billForecast, offset) : null;
    if (due && due > lastDue) return due;
    // Sem previsão do banco: pela data, contra os fechamentos estimados (mesmo dia a cada mês).
    // A compra feita no dia do fechamento ainda entra na fatura que fecha.
    const day = ymd(new Date(t.date.getTime() - 3 * 3_600_000));
    if (day <= ymd(lastClosing)) return null;
    for (let k = 1; k <= 24; k++) if (day <= ymd(shiftMonths(lastClosing, k))) return addMonths(lastDue, k);
    return null;
  });
}

// Fatura de um ciclo já fechado, pelo mês em que vence — continua valendo depois do vencimento,
// esteja paga ou não: é quanto aquele mês custou no cartão.
// Pagamentos de uma fatura, em centavos. Alguns bancos (Bradesco) listam na fatura os pagamentos
// feitos DURANTE o ciclo dela — ou seja, o pagamento da fatura anterior. Só vale como pagamento
// desta fatura o que foi pago depois que ela fechou.
export function billPaymentsCents(raw: string, closingDate: Date | null): number {
  const payments = (JSON.parse(raw) as { payments?: Array<{ amount?: number; paymentDate?: string }> }).payments ?? [];
  const total = payments
    .filter((p) => !closingDate || !p.paymentDate || new Date(p.paymentDate).getTime() >= closingDate.getTime())
    .reduce((sum, p) => sum + (p.amount ?? 0), 0);
  return Math.round(total * 100);
}

export interface PastBill {
  dueMonth: string;
  amount: number;
  dueDate: string;
}

export function computeBills(bills: BillRow[], transactions: BillTransactionRow[], now: Date) {
  const last = [...bills].sort((a, b) => b.dueDate.getTime() - a.dueDate.getTime())[0];
  if (!last) return { closed: null as BillSummary | null, open: null as BillSummary | null, upcoming: [] as Array<{ dueMonth: string; amount: number }>, past: [] as PastBill[] };
  const dueOfBill = new Map(bills.map((b) => [b.id, ym(b.dueDate)]));

  const today = ymd(now);
  const lastDue = ym(last.dueDate);
  const lastClosing = last.closingDate ?? new Date(last.dueDate.getTime() - 7 * 86_400_000);

  // Cada banco rotula a previsão de um jeito: mês do vencimento (deslocamento 0) ou mês do
  // fechamento (1). A última fatura listada mostra qual é a convenção deste cartão.
  const votes = new Map<number, number>();
  for (const t of transactions) {
    if (t.billId !== last.id || !t.billForecast) continue;
    const diff = monthsBetween(t.billForecast, lastDue);
    if (diff === 0 || diff === 1) votes.set(diff, (votes.get(diff) ?? 0) + 1);
  }
  const offset = (votes.get(0) ?? 0) > (votes.get(1) ?? 0) ? 0 : 1;

  // Lançamentos ainda sem fatura, agrupados pelo mês de vencimento do ciclo a que pertencem.
  const cycles = new Map<string, { debits: number; credits: number; projected: number; installments: number }>();
  // Parcelas conhecidas de cada compra parcelada e o ciclo em que cada uma caiu.
  const plans = new Map<string, Array<{ total: number; cents: number; dues: Map<number, string> }>>();
  const trackPlan = (t: BillTransactionRow, due: string) => {
    if (!t.planKey || !t.installmentNumber || !t.totalInstallments || t.totalInstallments < 2 || t.type !== 'DEBIT') return;
    const sameKey = plans.get(t.planKey) ?? [];
    // A primeira parcela costuma levar o arredondamento (61,26 e depois 61,25): é o mesmo plano.
    let seen = sameKey.find((p) => Math.abs(p.cents - t.cents) <= INSTALLMENT_ROUNDING_CENTS);
    if (!seen) sameKey.push((seen = { total: t.totalInstallments, cents: t.cents, dues: new Map() }));
    if (t.installmentNumber >= Math.max(0, ...seen.dues.keys())) seen.cents = t.cents;
    seen.dues.set(t.installmentNumber, due);
    plans.set(t.planKey, sameKey);
  };
  let payments = 0;
  for (const t of transactions) {
    if (t.billId !== null) {
      const due = dueOfBill.get(t.billId);
      if (due) trackPlan(t, due);
      continue;
    }
    const afterClosing = t.date.getTime() > lastClosing.getTime();
    if (t.isPayment) {
      if (afterClosing) payments += Math.abs(t.cents);
      continue;
    }
    let due = t.billForecast ? addMonths(t.billForecast, offset) : null;
    if (!due || due <= lastDue) {
      // Sem previsão confiável (parcelas antigas trazem o mês da compra original): se é
      // posterior ao último fechamento, entra no primeiro ciclo depois dele; senão é resíduo.
      if (!afterClosing) continue;
      due = addMonths(lastDue, 1);
    }
    const c = cycles.get(due) ?? { debits: 0, credits: 0, projected: 0, installments: 0 };
    if (t.type === 'CREDIT') c.credits += Math.abs(t.cents);
    else {
      c.debits += t.cents;
      if (t.totalInstallments && t.totalInstallments > 1) c.installments += t.cents;
    }
    cycles.set(due, c);
    trackPlan(t, due);
  }

  // Vários bancos só lançam a parcela no dia em que ela "vence"; até lá ela já conta na fatura
  // aberta do aplicativo. Projeta as parcelas seguintes de cada plano ainda em andamento, uma por
  // ciclo. Planos cuja última parcela ficou numa fatura antiga já acabaram ou foram antecipados.
  // O banco também pode lançar adiante só algumas parcelas (a 12/12 sem a 8 a 11): as que faltam
  // no meio são projetadas a partir da última parcela conhecida antes delas.
  for (const p of [...plans.values()].flat()) {
    const known = [...p.dues.keys()].sort((x, y) => x - y);
    const lastKnown = known[known.length - 1];
    for (let n = known[0] + 1; n <= p.total; n++) {
      if (p.dues.has(n)) continue;
      const base = known.filter((k) => k < n).pop()!;
      if (n > lastKnown && p.dues.get(lastKnown)! < lastDue) break;
      const due = addMonths(p.dues.get(base)!, n - base);
      if (due <= lastDue) continue;
      const c = cycles.get(due) ?? { debits: 0, credits: 0, projected: 0, installments: 0 };
      c.debits += p.cents;
      c.projected += p.cents;
      c.installments += p.cents;
      cycles.set(due, c);
    }
  }

  // Pagamentos feitos depois do último fechamento quitam primeiro a última fatura listada;
  // o que sobrar abate o ciclo seguinte.
  const lastTotal = Number(last.totalAmountCents);
  const paid = Math.max(payments, last.paymentsCents);
  const lastOutstanding = Math.max(lastTotal - paid, 0);
  const excess = Math.max(paid - lastTotal, 0);

  const closedParts: Array<{ cents: number; projected: number; installments: number; due: Date; closing: Date | null; estimated: boolean }> = [];
  let open: BillSummary | null = null;
  // Só vale como "a pagar" enquanto não venceu: depois disso o banco já a liquidou ou rolou
  // o saldo para o ciclo seguinte, e os pagamentos podem não ter chegado aqui.
  if (lastOutstanding > 0 && ymd(last.dueDate) >= today) {
    closedParts.push({ cents: lastOutstanding, projected: 0, installments: 0, due: last.dueDate, closing: last.closingDate, estimated: false });
  }

  // Faturas listadas pelo banco, mais os ciclos fechados que ele ainda não listou (abaixo).
  const past: PastBill[] = bills.map((b) => ({ dueMonth: ym(b.dueDate), amount: Number(b.totalAmountCents) / 100, dueDate: ymd(b.dueDate) }));
  let openK = 0;
  for (let k = 1; k <= 3 && !open; k++) {
    openK = k;
    const dueMonth = addMonths(lastDue, k);
    const c = cycles.get(dueMonth) ?? { debits: 0, credits: 0, projected: 0, installments: 0 };
    const cents = Math.max(c.debits - c.credits - (k === 1 ? excess : 0), 0);
    const due = shiftMonths(last.dueDate, k);
    const closing = shiftMonths(lastClosing, k);
    if (ymd(closing) < today) {
      // O mesmo valor que valia como "fechada" enquanto não tinha vencido.
      if (cents > 0) past.push({ dueMonth, amount: cents / 100, dueDate: ymd(due) });
      if (cents > 0 && ymd(due) >= today) closedParts.push({ cents, projected: Math.min(c.projected, cents), installments: Math.min(c.installments, cents), due, closing, estimated: true });
    } else {
      open = { amount: cents / 100, projectedInstallments: Math.min(c.projected, cents) / 100, installments: Math.min(c.installments, cents) / 100, dueDate: ymd(due), closingDate: ymd(closing), estimated: true };
    }
  }

  const closed: BillSummary | null = closedParts.length
    ? {
        amount: closedParts.reduce((s, p) => s + p.cents, 0) / 100,
        projectedInstallments: closedParts.reduce((s, p) => s + p.projected, 0) / 100,
        installments: closedParts.reduce((s, p) => s + p.installments, 0) / 100,
        dueDate: ymd(closedParts.reduce((min, p) => (p.due < min ? p.due : min), closedParts[0].due)),
        closingDate: closedParts[0].closing ? ymd(closedParts[0].closing) : null,
        estimated: closedParts.some((p) => p.estimated),
      }
    : null;

  // Depois da fatura aberta: o que já se sabe das seguintes (parcelas lançadas adiante pelo banco
  // e parcelas projetadas dos planos em andamento).
  const upcoming: Array<{ dueMonth: string; amount: number }> = [];
  for (let k = openK + 1; open && k <= openK + 12; k++) {
    const dueMonth = addMonths(lastDue, k);
    const c = cycles.get(dueMonth);
    if (c && c.debits - c.credits > 0) upcoming.push({ dueMonth, amount: (c.debits - c.credits) / 100 });
  }

  return { closed, open, upcoming, past };
}
