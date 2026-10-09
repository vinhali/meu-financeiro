// Agregações da aba "Cartões": função pura sobre as linhas já sincronizadas (of_*).
import { assignDueMonths, computeBills } from './bills';
import { CATEGORY_CHOICES, findBrand, labelMerchant, UserLabel } from './labels';

export interface CardAccountRow {
  id: string;
  connectionId: string;
  name: string;
  number: string | null;
  cardBrand: string | null;
  balanceCents: bigint;
  creditLimitCents: bigint | null;
  availableCreditLimitCents: bigint | null;
  minimumPaymentCents: bigint | null;
  balanceDueDate: Date | null;
}

export interface CardTransactionRow {
  accountId: string;
  date: Date;
  description: string;
  type: string;
  amountCents: bigint;
  currencyCode: string;
  amountInAccountCurrencyCents: bigint | null;
  category: string | null;
  categoryId: string | null;
  operationType: string | null;
  installmentNumber: number | null;
  totalInstallments: number | null;
  merchantName: string | null;
  billId?: string | null;
  billForecast?: string | null; // creditCardMetadata.billForecastDate ("AAAA-MM")
}

export interface CardBillRow {
  id: string;
  accountId: string;
  dueDate: Date;
  closingDate: Date | null;
  totalAmountCents: bigint;
  paymentsCents: number;
}

// Datas da Pluggy são UTC; mês e dia da semana são atribuídos no horário de Brasília.
const BRT_OFFSET_MS = 3 * 3_600_000;
const local = (d: Date) => new Date(d.getTime() - BRT_OFFSET_MS);
const monthKey = (d: Date) => local(d).toISOString().slice(0, 7);
const dayKey = (d: Date) => local(d).toISOString().slice(0, 10);
const reais = (cents: number) => Math.round(cents) / 100;

const FAMILIES: Record<string, string> = {
  '01': 'Renda',
  '02': 'Juros e empréstimos',
  '03': 'Investimentos',
  '04': 'Entre contas próprias',
  '05': 'Transferências',
  '07': 'Serviços',
  '08': 'Compras',
  '09': 'Serviços digitais',
  '10': 'Mercado',
  '11': 'Alimentação',
  '12': 'Viagem',
  '13': 'Doações',
  '14': 'Apostas',
  '15': 'Impostos',
  '16': 'Tarifas',
  '17': 'Moradia',
  '18': 'Saúde',
  '19': 'Transporte',
  '20': 'Seguros',
  '21': 'Lazer',
};

const SUBCATEGORIES: Record<string, string> = {
  'Digital services': 'Serviços digitais',
  Groceries: 'Mercado',
  'Eating out': 'Restaurantes',
  'Food delivery': 'Delivery',
  Shopping: 'Compras em geral',
  'Online shopping': 'Compras online',
  Electronics: 'Eletrônicos',
  Clothing: 'Vestuário',
  'Pet supplies and vet': 'Pet',
  'Kids and toys': 'Crianças e brinquedos',
  Bookstore: 'Livraria',
  'Sports goods': 'Artigos esportivos',
  'Office supplies': 'Papelaria e escritório',
  Services: 'Serviços em geral',
  Telecommunications: 'Telefonia',
  Internet: 'Internet',
  Education: 'Educação',
  School: 'Escola',
  'Wellness and fitness': 'Bem-estar',
  'Gyms and fitness centers': 'Academia',
  Wellness: 'Bem-estar',
  Tickets: 'Ingressos',
  'Cinema, theater and concerts': 'Cinema e shows',
  Travel: 'Viagem',
  'Airport and airlines': 'Passagens aéreas',
  Accomodation: 'Hospedagem',
  'Tax on financial operations': 'IOF',
  Taxes: 'Impostos',
  'Bank fees': 'Tarifas bancárias',
  'Credit card fees': 'Tarifas do cartão',
  'Wire transfer fees and ATM fees': 'Tarifas de transferência',
  Housing: 'Moradia',
  Houseware: 'Casa e utilidades',
  Water: 'Água',
  Electricity: 'Energia',
  Gas: 'Gás',
  Healthcare: 'Saúde',
  Pharmacy: 'Farmácia',
  Optometry: 'Ótica',
  Transportation: 'Transporte',
  'Taxi and ride-hailing': 'Táxi e apps',
  'Public transportation': 'Transporte público',
  Automotive: 'Automotivo',
  'Gas stations': 'Combustível',
  Parking: 'Estacionamento',
  'Tolls and in vehicle payment': 'Pedágio',
  'Vehicle maintenance': 'Manutenção do veículo',
  Insurance: 'Seguros',
  'Health insurance': 'Plano de saúde',
  Leisure: 'Lazer',
  Transfers: 'Transferências',
  'Transfer - PIX': 'Pix no crédito',
  'Transfer - Bank Slip': 'Boleto no crédito',
  Donations: 'Doações',
  Gambling: 'Apostas',
  'Late payment and overdraft costs': 'Multa e atraso',
  'Interests charged': 'Juros',
  Loans: 'Empréstimos',
  'Loans and financing': 'Empréstimos',
};

// Famílias que são custo de usar o cartão, não consumo.
const COST_FAMILIES = new Set(['02', '15', '16']);
const CARD_PAYMENT_CATEGORY = '05100000';

// Pagamento de fatura (inclusive antecipado/parcial) não é compra nem estorno. Os bancos nem
// sempre marcam a categoria, então a descrição do crédito também conta.
const PAYMENT_DESCRIPTION = /(^|[^a-z])(pagamento|pagto|pgto)([^a-z]|$)/i;
export function isBillPayment(t: CardTransactionRow): boolean {
  if (t.categoryId === CARD_PAYMENT_CATEGORY || t.operationType === 'PAGAMENTO_FATURA') return true;
  return t.type === 'CREDIT' && PAYMENT_DESCRIPTION.test(t.description);
}

function family(categoryId: string | null): { id: string; label: string } {
  const id = categoryId?.slice(0, 2) ?? '';
  return FAMILIES[id] ? { id, label: FAMILIES[id] } : { id: '99', label: 'Sem categoria' };
}

// "LOJA X PARC 03/10", "Loja X - Parcela 3/10" e "LOJA  X" contam como o mesmo estabelecimento.
export function merchantKey(t: Pick<CardTransactionRow, 'merchantName' | 'description'>): string {
  const base = (t.merchantName ?? t.description)
    .replace(/\s*[-–]?\s*(parc(ela)?\.?\s*)?\d{1,2}\s*(\/|de)\s*\d{1,2}\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return base === '' ? '(sem descrição)' : base.toUpperCase();
}

// Valor em reais (centavos) do lançamento; null quando é moeda estrangeira sem conversão informada.
export function brlCents(t: CardTransactionRow): number | null {
  if (t.currencyCode === 'BRL') return Number(t.amountCents);
  return t.amountInAccountCurrencyCents === null ? null : Number(t.amountInAccountCurrencyCents);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function addMonths(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

export interface CardsInput {
  accounts: CardAccountRow[];
  transactions: CardTransactionRow[];
  bills: CardBillRow[];
  bankNames: Record<string, string>; // connectionId -> nome da instituição
  userLabels?: Record<string, UserLabel>; // chave do estabelecimento -> rótulo definido pelo usuário
  // Período: `from`/`to` (AAAA-MM-DD, inclusive) têm precedência; senão `months`, em que 1 = últimos
  // 30 dias e N > 1 = mês corrente mais os N-1 anteriores.
  months?: number;
  from?: string;
  billCycle?: boolean; // período = fatura em aberto (do último fechamento até hoje)
  to?: string;
  accountId?: string;
  now?: Date;
}

// Acima disso o gráfico do período é por mês; até aqui, por dia.
const DAILY_CHART_MAX_DAYS = 62;
// Assinaturas são um estado, não um recorte: sempre olham os últimos 6 meses.
const SUBSCRIPTION_MONTHS = 6;

type Purchase = CardTransactionRow & {
  cents: number;
  fam: { id: string; label: string };
  sub: string; // subcategoria exibida
  key: string; // chave do estabelecimento
  name: string; // nome legível
  kind: string | null; // o que é
};

// Quem é e em que categoria cai um lançamento de consumo (cartão ou conta).
export function describePurchase(t: Pick<CardTransactionRow, 'merchantName' | 'description' | 'category' | 'categoryId'>, userLabels: Record<string, UserLabel>) {
  const fam = family(t.categoryId);
  // Marcas conhecidas corrigem categorias vagas do Open Finance ("Serviços" -> "Academia").
  const key = merchantKey(t);
  const brand = findBrand(key);
  // Compra que o Open Finance pôs numa família de custo ("à vista sem juros") é compra comum.
  // A categoria que o usuário escolheu para o estabelecimento vence todas as outras.
  const chosen = userLabels[key]?.category ? CATEGORY_CHOICES[userLabels[key].category!]?.category : undefined;
  const override = chosen ?? brand?.category ?? (COST_FAMILIES.has(fam.id) ? (['08', 'Compras em geral'] as [string, string]) : undefined);
  const finalFam = override && FAMILIES[override[0]] ? { id: override[0], label: FAMILIES[override[0]] } : fam;
  const subcategory = override?.[1] ?? SUBCATEGORIES[t.category ?? ''] ?? t.category ?? finalFam.label;
  const label = labelMerchant(key, userLabels, finalFam.id === '99' ? null : subcategory);
  return { fam: finalFam, sub: subcategory, key, name: label.name, kind: label.kind };
}

// "Compra à vista sem juros" vem categorizada como juros pelo Open Finance, mas é compra.
const isCost = (t: CardTransactionRow, famId: string) => COST_FAMILIES.has(famId) && !/sem juros/i.test(t.description);

const REFUND_MATCH_WINDOW_MS = 120 * 86_400_000;

// Estorno de compra: procura a compra original (mesmo cartão, mesmo valor, até 120 dias antes).
// A compra casada deixa de contar como gasto; o estorno sem par fica só como crédito avulso.
function matchRefunds(rows: CardTransactionRow[]) {
  const cancelled = new Set<CardTransactionRow>();
  const matched = new Set<CardTransactionRow>();
  const eligible = rows.filter((t) => !isBillPayment(t) && brlCents(t) !== null && !isCost(t, family(t.categoryId).id));
  const debits = eligible.filter((t) => t.type === 'DEBIT').sort((a, b) => b.date.getTime() - a.date.getTime());
  for (const credit of eligible.filter((t) => t.type === 'CREDIT').sort((a, b) => a.date.getTime() - b.date.getTime())) {
    const cents = Math.abs(brlCents(credit)!);
    const original = debits.find(
      (d) =>
        !cancelled.has(d) &&
        d.accountId === credit.accountId &&
        brlCents(d) === cents &&
        d.date.getTime() <= credit.date.getTime() &&
        credit.date.getTime() - d.date.getTime() <= REFUND_MATCH_WINDOW_MS,
    );
    if (original) {
      cancelled.add(original);
      matched.add(credit);
    }
  }
  return { cancelled, matched };
}

// Compras: débitos no cartão, menos pagamento de fatura, custos (IOF, tarifas, juros) e compras estornadas.
function classify(rows: CardTransactionRow[], refunds: ReturnType<typeof matchRefunds>, userLabels: Record<string, UserLabel>) {
  const purchases: Purchase[] = [];
  const costs = new Map<string, { charged: number; refunded: number }>();
  let refundedPurchases = 0;
  let refundedCount = 0;
  let otherCredits = 0;
  let unconverted = 0;
  for (const t of rows) {
    if (isBillPayment(t)) continue;
    const cents = brlCents(t);
    if (cents === null) {
      unconverted++;
      continue;
    }
    const fam = family(t.categoryId);
    const cost = isCost(t, fam.id);
    if (cost) {
      const label = SUBCATEGORIES[t.category ?? ''] ?? fam.label;
      const c = costs.get(label) ?? { charged: 0, refunded: 0 };
      if (t.type === 'CREDIT') c.refunded += Math.abs(cents);
      else c.charged += cents;
      costs.set(label, c);
      continue;
    }
    if (t.type === 'CREDIT') {
      if (refunds.matched.has(t)) {
        refundedPurchases += Math.abs(cents);
        refundedCount++;
      } else {
        otherCredits += Math.abs(cents);
      }
      continue;
    }
    if (refunds.cancelled.has(t)) continue;
    purchases.push({ ...t, cents, ...describePurchase(t, userLabels) });
  }
  return { purchases, costs, refundedPurchases, refundedCount, otherCredits, unconverted };
}

function groupMerchants(purchases: Purchase[]) {
  const merchants = new Map<string, { name: string; kind: string | null; cents: number; count: number; months: Map<string, number[]>; installment: boolean; last: Date }>();
  for (const p of purchases) {
    const key = p.key;
    const m = merchants.get(key) ?? { name: p.name, kind: p.kind, cents: 0, count: 0, months: new Map<string, number[]>(), installment: false, last: p.date };
    m.cents += p.cents;
    m.count++;
    const mk = monthKey(p.date);
    m.months.set(mk, [...(m.months.get(mk) ?? []), p.cents]);
    if ((p.totalInstallments ?? 0) > 1) m.installment = true;
    if (p.date > m.last) m.last = p.date;
    merchants.set(key, m);
  }
  return merchants;
}

// Para cada lançamento de cartão, o mês de vencimento da fatura em que ele cai (ver bills.ts).
export function cardDueMonths(input: Pick<CardsInput, 'accounts' | 'transactions' | 'bills'>): Map<CardTransactionRow, string | null> {
  const out = new Map<CardTransactionRow, string | null>();
  for (const a of input.accounts) {
    const rows = input.transactions.filter((t) => t.accountId === a.id);
    const dues = assignDueMonths(
      input.bills.filter((b) => b.accountId === a.id),
      rows.map((t) => ({ date: t.date, billId: t.billId ?? null, billForecast: t.billForecast ?? null, isPayment: isBillPayment(t) })),
    );
    rows.forEach((t, i) => out.set(t, dues[i]));
  }
  return out;
}

// Alguns bancos não informam a parcela nos metadados e a deixam só na descrição
// ("BRADESCO AUT*03de12"). Sem isso o plano não é reconhecido e as parcelas futuras somem.
const INSTALLMENT_IN_TEXT = /(\d{2})de(\d{2})\s*$/i;
export function withInstallments<T extends { description: string; installmentNumber: number | null; totalInstallments: number | null }>(t: T): T {
  if (t.totalInstallments) return t;
  const m = INSTALLMENT_IN_TEXT.exec(t.description);
  if (!m) return t;
  const [number, total] = [Number(m[1]), Number(m[2])];
  return number >= 1 && total >= 2 && number <= total ? { ...t, installmentNumber: number, totalInstallments: total } : t;
}

// Chave da etiqueta de um parcelamento (guardada junto com os rótulos de estabelecimento).
export const planLabelKey = (accountId: string, merchant: string, total: number, cents: number) => `plan:${accountId}|${merchant}|${total}|${cents}`;

export function buildCardsOverview(rawInput: CardsInput) {
  const input = { ...rawInput, transactions: rawInput.transactions.map(withInstallments) };
  const now = input.now ?? new Date();
  const currentMonth = monthKey(now);
  const today = dayKey(now);
  const billsOf = new Map(
    input.accounts.map((a) => [
      a.id,
        computeBills(
        input.bills.filter((b) => b.accountId === a.id),
        input.transactions
          .filter((t) => t.accountId === a.id)
          .flatMap((t) => {
            const cents = brlCents(t);
            return cents === null
              ? []
              : [
                  {
                    date: t.date,
                    type: t.type,
                    cents,
                    billId: t.billId ?? null,
                    billForecast: t.billForecast ?? null,
                    isPayment: isBillPayment(t),
                    planKey: t.totalInstallments && t.totalInstallments > 1 ? `${merchantKey(t)}|${t.totalInstallments}` : null,
                    installmentNumber: t.installmentNumber,
                    totalInstallments: t.totalInstallments,
                  },
                ];
          }),
        now,
        ),
    ]),
  );
  const custom = Boolean(input.from && input.to);
  const months = input.months ?? 6;
  // "Fatura atual": as compras que caem na fatura aberta de cada cartão. Quem diz em que fatura
  // uma compra cai é o banco (fatura listada ou previsão do lançamento); o dia de fechamento
  // estimado só serve de apoio quando não há lançamento nenhum na fatura aberta.
  const dueOfRow = cardDueMonths(input);
  const openDueOf = new Map(input.accounts.flatMap((a) => (billsOf.get(a.id)?.open ? [[a.id, billsOf.get(a.id)!.open!.dueDate.slice(0, 7)] as const] : [])));
  const cycleStartOf = new Map<string, string>();
  for (const a of input.accounts) {
    const closing = billsOf.get(a.id)?.open?.closingDate;
    if (!closing) continue;
    const d = new Date(`${closing}T00:00:00.000Z`);
    const previous = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
    const lastDay = new Date(Date.UTC(previous.getUTCFullYear(), previous.getUTCMonth() + 1, 0)).getUTCDate();
    previous.setUTCDate(Math.min(d.getUTCDate(), lastDay) + 1);
    const estimated = previous.toISOString().slice(0, 10);
    const firstInBill = input.transactions
      .filter((t) => t.accountId === a.id && t.type === 'DEBIT' && t.date.getTime() <= now.getTime() && dueOfRow.get(t) === openDueOf.get(a.id))
      .map((t) => dayKey(t.date))
      .sort()[0];
    cycleStartOf.set(a.id, firstInBill ?? estimated);
  }
  const cycleStarts = input.accounts
    .filter((a) => !input.accountId || a.id === input.accountId)
    .flatMap((a) => cycleStartOf.get(a.id) ?? [])
    .sort();
  const billCycle = Boolean(input.billCycle) && !custom && cycleStarts.length > 0;
  const startDay = custom
    ? input.from!
    : billCycle
      ? cycleStarts[0]
      : months === 1
        ? dayKey(new Date(now.getTime() - 29 * 86_400_000))
        : `${addMonths(currentMonth, -(months - 1))}-01`;
  // Nada depois de hoje entra no período: lançamentos futuros são parcelas, tratadas à parte.
  const endDay = custom && input.to! < today ? input.to! : today;
  const firstMonth = startDay.slice(0, 7);
  const lastMonth = endDay.slice(0, 7);
  const monthKeys: string[] = [];
  for (let mk = firstMonth; mk <= lastMonth && monthKeys.length < 36; mk = addMonths(mk, 1)) monthKeys.push(mk);
  // No modo "fatura atual" cada compra é separada pelo fechamento do próprio cartão.
  const inRange = (t: CardTransactionRow) => {
    const day = dayKey(t.date);
    if (billCycle) {
      const due = dueOfRow.get(t);
      const openDue = openDueOf.get(t.accountId);
      if (due && openDue) return due === openDue && day <= endDay;
    }
    return day >= (billCycle ? (cycleStartOf.get(t.accountId) ?? startDay) : startDay) && day <= endDay;
  };
  const selected = input.accountId ? input.accounts.filter((a) => a.id === input.accountId) : input.accounts;
  const selectedIds = new Set(selected.map((a) => a.id));
  const cardName = new Map(input.accounts.map((a) => [a.id, a.name.trim()]));

  const all = input.transactions.filter((t) => selectedIds.has(t.accountId));
  const past = all.filter((t) => t.date.getTime() <= now.getTime());
  const inPeriod = past.filter(inRange);

  const userLabels = input.userLabels ?? {};
  const refunds = matchRefunds(past);
  const { purchases, costs, refundedPurchases, refundedCount, otherCredits, unconverted } = classify(inPeriod, refunds, userLabels);
  // O que compõe uma barra do gráfico: as compras daquele dia ou mês, da maior para a menor.
  const detail = (rows: Purchase[], limit: number) =>
    [...rows]
      .sort((a, b) => b.cents - a.cents)
      .slice(0, limit)
      .map((p) => ({
        name: p.name,
        kind: p.kind,
        card: cardName.get(p.accountId) ?? '',
        amount: reais(p.cents),
        installments: p.totalInstallments && p.totalInstallments > 1 ? `${p.installmentNumber}/${p.totalInstallments}` : null,
      }));
  const spent = purchases.reduce((s, p) => s + p.cents, 0);

  const byMonth = monthKeys.map((month) => {
    const rows = purchases.filter((p) => monthKey(p.date) === month);
    return { month, total: reais(rows.reduce((s, p) => s + p.cents, 0)), count: rows.length, items: detail(rows, 10) };
  });
  // Só meses inteiros dentro do período: o corrente e os cortados pelas pontas puxariam a média para baixo.
  const lastDayOf = (mk: string) => new Date(Date.UTC(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const closedMonths = byMonth.filter((m) => m.count > 0 && `${m.month}-01` >= startDay && lastDayOf(m.month) <= endDay && m.month !== currentMonth);
  const avgMonthly = closedMonths.length ? closedMonths.reduce((s, m) => s + m.total, 0) / closedMonths.length : null;

  const rangeDays = Math.round((Date.parse(endDay) - Date.parse(startDay)) / 86_400_000) + 1;
  const byDay =
    rangeDays > DAILY_CHART_MAX_DAYS
      ? null
      : Array.from({ length: rangeDays }, (_, i) => {
          const day = new Date(Date.parse(startDay) + i * 86_400_000).toISOString().slice(0, 10);
          const rows = purchases.filter((p) => dayKey(p.date) === day);
          return { day, total: reais(rows.reduce((s, p) => s + p.cents, 0)), count: rows.length, items: detail(rows, 25) };
        });

  const famMap = new Map<
    string,
    { id: string; label: string; cents: number; count: number; subs: Map<string, number>; names: Map<string, number>; places: Map<string, { key: string; name: string; cents: number; count: number }> }
  >();
  for (const p of purchases) {
    const f = famMap.get(p.fam.id) ?? { ...p.fam, cents: 0, count: 0, subs: new Map<string, number>(), names: new Map<string, number>(), places: new Map() };
    const place = f.places.get(p.key) ?? { key: p.key, name: p.name, cents: 0, count: 0 };
    place.cents += p.cents;
    place.count++;
    f.places.set(p.key, place);
    f.cents += p.cents;
    f.count++;
    f.subs.set(p.sub, (f.subs.get(p.sub) ?? 0) + p.cents);
    f.names.set(p.name, (f.names.get(p.name) ?? 0) + p.cents);
    famMap.set(p.fam.id, f);
  }
  const byCategory = [...famMap.values()]
    .sort((a, b) => b.cents - a.cents)
    .map((f) => ({
      id: f.id,
      label: f.label,
      total: reais(f.cents),
      count: f.count,
      share: spent > 0 ? f.cents / spent : 0,
      // As partes somam o total da categoria: até quatro etiquetas, a última juntando o resto.
      subcategories: (() => {
        const parts = [...f.subs.entries()].sort((a, b) => b[1] - a[1]);
        const shown = parts.length > 4 ? parts.slice(0, 3) : parts;
        const rest = parts.slice(shown.length).reduce((sum, [, cents]) => sum + cents, 0);
        return [...shown.map(([label, cents]) => ({ label, total: reais(cents) })), ...(rest > 0 ? [{ label: 'outros', total: reais(rest) }] : [])];
      })(),
      merchants: [...f.names.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([name, cents]) => ({ name, total: reais(cents) })),
      // Todos os lugares da categoria, com a chave para o usuário poder corrigir a categoria.
      places: [...f.places.values()].sort((a, b) => b.cents - a.cents).map((p) => ({ key: p.key, name: p.name, total: reais(p.cents), count: p.count })),
    }));

  const topMerchants = [...groupMerchants(purchases).entries()]
    .sort((a, b) => b[1].cents - a[1].cents)
    .slice(0, 10)
    .map(([key, m]) => ({ key, name: m.name, kind: m.kind, total: reais(m.cents), count: m.count }));

  // Assinatura: mesmo estabelecimento em 3+ meses, cerca de uma cobrança por mês, valor estável, não parcelado.
  const subscriptionWindow = past.filter((t) => monthKey(t.date) >= addMonths(currentMonth, -(SUBSCRIPTION_MONTHS - 1)));
  const subscriptions = [...groupMerchants(classify(subscriptionWindow, refunds, userLabels).purchases).entries()]
    .filter(([, m]) => {
      if (m.installment || m.months.size < 3) return false;
      const perMonth = [...m.months.values()];
      if (m.count / perMonth.length > 1.5) return false;
      const amounts = perMonth.map((v) => v[0]);
      const med = median(amounts);
      return med > 0 && (Math.max(...amounts) - Math.min(...amounts)) / med <= 0.3;
    })
    .map(([key, m]) => ({
      key,
      name: m.name,
      kind: m.kind,
      monthly: reais(median([...m.months.values()].map((v) => v[0]))),
      months: m.months.size,
      lastDate: m.last.toISOString(),
      // Sem cobrança no mês atual nem no anterior: provavelmente cancelada.
      active: monthKey(m.last) >= addMonths(currentMonth, -1),
    }))
    .sort((a, b) => Number(b.active) - Number(a.active) || b.monthly - a.monthly);

  // Parcelamentos em aberto: a última parcela vista de cada compra projeta as que faltam.
  // Parcelas do mesmo plano podem diferir em centavos (a primeira leva o arredondamento).
  const plans = new Map<string, Array<{ t: CardTransactionRow; cents: number }>>();
  for (const t of past) {
    if (!t.totalInstallments || t.totalInstallments < 2 || !t.installmentNumber || t.type !== 'DEBIT') continue;
    const cents = brlCents(t);
    if (cents === null || refunds.cancelled.has(t)) continue;
    const key = `${t.accountId}|${merchantKey(t)}|${t.totalInstallments}`;
    const sameKey = plans.get(key) ?? [];
    const seen = sameKey.find((p) => Math.abs(p.cents - cents) <= 10);
    if (!seen) sameKey.push({ t, cents });
    else if (t.installmentNumber > (seen.t.installmentNumber ?? 0)) Object.assign(seen, { t, cents });
    plans.set(key, sameKey);
  }
  const committed = new Map<string, number>();
  const hasBills = (accountId: string) => Boolean(billsOf.get(accountId)?.open);
  const activePlans = [];
  for (const { t, cents } of [...plans.values()].flat()) {
    const paid = t.installmentNumber ?? 0;
    const total = t.totalInstallments ?? 0;
    const remaining = total - paid;
    // Plano sem parcela há mais de 3 meses já acabou ou foi antecipado. A folga cobre bancos que
    // entregam os lançamentos com semanas de atraso (o plano continua correndo nas faturas).
    if (remaining <= 0 || monthKey(t.date) < addMonths(currentMonth, -3)) continue;
    const start = monthKey(t.date);
    for (let i = 1; i <= remaining; i++) {
      const mk = addMonths(start, i);
      // Só para cartão sem fatura conhecida; nos demais o comprometido vem das faturas (abaixo).
      if (mk > currentMonth && !hasBills(t.accountId)) committed.set(mk, (committed.get(mk) ?? 0) + cents);
    }
    // Etiqueta do próprio parcelamento: dois planos no mesmo estabelecimento têm cada um a sua.
    const planKey = planLabelKey(t.accountId, merchantKey(t), total, cents);
    activePlans.push({
      key: planKey,
      label: userLabels[planKey]?.name ?? null,
      name: labelMerchant(merchantKey(t), userLabels, null).name,
      card: cardName.get(t.accountId) ?? '',
      installment: paid,
      totalInstallments: total,
      remainingInstallments: remaining,
      amount: reais(cents),
      remainingAmount: reais(cents * remaining),
      endsIn: addMonths(start, remaining),
    });
  }
  // Quanto das próximas faturas já está comprometido com parcelas. Vem do mesmo cálculo das
  // faturas (a parte parcelada da aberta, mais as seguintes), para bater com elas e com a dívida
  // de cartões: a lista de planos acima serve para mostrar o que são, não para somar.
  // Cartões sem fatura listada pelo banco entram pela projeção dos próprios planos.
  const byDue = new Map<string, number>(committed);
  for (const [accountId, b] of billsOf) {
    if (input.accountId && accountId !== input.accountId) continue;
    if (b.open) byDue.set(b.open.dueDate.slice(0, 7), (byDue.get(b.open.dueDate.slice(0, 7)) ?? 0) + Math.round(b.open.installments * 100));
    for (const u of b.upcoming) byDue.set(u.dueMonth, (byDue.get(u.dueMonth) ?? 0) + Math.round(u.amount * 100));
  }
  const dueMonths = [...byDue.keys()].filter((m) => (byDue.get(m) ?? 0) > 0).sort();
  const committedMonths: Array<{ month: string; total: number }> = [];
  for (let month = dueMonths[0]; month && month <= dueMonths[dueMonths.length - 1]; month = addMonths(month, 1)) {
    committedMonths.push({ month, total: reais(byDue.get(month) ?? 0) });
  }
  // Maior alívio: o mês em que a soma das parcelas mais cai em relação ao anterior.
  let relief: { month: string; from: number; to: number } | null = null;
  for (let i = 1; i <= committedMonths.length; i++) {
    const from = committedMonths[i - 1].total;
    const to = committedMonths[i]?.total ?? 0;
    if (from - to > (relief ? relief.from - relief.to : 0)) relief = { month: committedMonths[i]?.month ?? addMonths(committedMonths[i - 1].month, 1), from, to };
  }
  const installments = {
    monthly: committedMonths,
    totalRemaining: reais(dueMonths.reduce((sum, m) => sum + (byDue.get(m) ?? 0), 0)),
    nextMonth: committedMonths[0] ?? null,
    endsIn: committedMonths.length ? committedMonths[committedMonths.length - 1].month : null,
    relief,
    active: activePlans.sort((a, b) => b.remainingAmount - a.remainingAmount),
    activeCount: activePlans.length,
  };

  // Somar seis meses de sextas-feiras dá um número grande e pouco útil: o que interessa é o
  // gasto típico de um dia daquele tipo, então divide pelo número de vezes que ele ocorreu.
  const weekdayTotals = [0, 0, 0, 0, 0, 0, 0];
  // Hábito por dia da semana: só o que foi comprado naquele dia. Parcela de compra antiga cai no
  // dia em que o banco a lança (o fechamento da fatura), o que não diz nada sobre o hábito.
  const weekdayCount = [0, 0, 0, 0, 0, 0, 0];
  const weekdayActive = Array.from({ length: 7 }, () => new Set<string>());
  const weekdayFams = Array.from({ length: 7 }, () => new Map<string, number>());
  for (const p of purchases) {
    if ((p.installmentNumber ?? 0) > 1) continue;
    const d = local(p.date).getUTCDay();
    weekdayTotals[d] += p.cents;
    weekdayCount[d]++;
    weekdayActive[d].add(dayKey(p.date));
    weekdayFams[d].set(p.fam.label, (weekdayFams[d].get(p.fam.label) ?? 0) + p.cents);
  }
  const weekdayDays = [0, 0, 0, 0, 0, 0, 0];
  for (let ms = Date.parse(startDay); ms <= Date.parse(endDay); ms += 86_400_000) weekdayDays[new Date(ms).getUTCDay()]++;
  const weekdays = weekdayTotals.map((cents, i) => {
    const top = [...weekdayFams[i].entries()].sort((x, y) => y[1] - x[1])[0];
    return {
      total: reais(cents),
      days: weekdayDays[i],
      average: weekdayDays[i] ? reais(cents / weekdayDays[i]) : 0,
      // Quantas compras, em quantos dos dias desse tipo houve compra, e o que mais pesou.
      count: weekdayCount[i],
      activeDays: weekdayActive[i].size,
      top: top ? { label: top[0], total: reais(top[1]) } : null,
    };
  });

  // Compras em moeda estrangeira (já em reais pelo câmbio que o banco aplicou).
  const foreign = purchases.filter((p) => p.currencyCode !== 'BRL');
  const byCurrency = new Map<string, { count: number; original: number; cents: number }>();
  for (const p of foreign) {
    const c = byCurrency.get(p.currencyCode) ?? { count: 0, original: 0, cents: 0 };
    c.count++;
    c.original += Number(p.amountCents);
    c.cents += p.cents;
    byCurrency.set(p.currencyCode, c);
  }
  const international = {
    total: reais(foreign.reduce((s, p) => s + p.cents, 0)),
    count: foreign.length,
    byCurrency: [...byCurrency.entries()]
      .sort((a, b) => b[1].cents - a[1].cents)
      .map(([currency, c]) => ({
        currency,
        count: c.count,
        original: reais(c.original),
        total: reais(c.cents),
        rate: c.original > 0 ? Math.round((c.cents / c.original) * 100) / 100 : null,
      })),
    // Agrupado pelo nome exibido: descrições diferentes da mesma marca viram uma linha só.
    top: [...foreign.reduce((acc, p) => acc.set(p.name, { cents: (acc.get(p.name)?.cents ?? 0) + p.cents, count: (acc.get(p.name)?.count ?? 0) + 1 }), new Map<string, { cents: number; count: number }>()).entries()]
      .sort((a, b) => b[1].cents - a[1].cents)
      .slice(0, 5)
      .map(([name, m]) => ({ name, total: reais(m.cents), count: m.count })),
  };

  const costRows = [...costs.entries()]
    .map(([label, c]) => ({ label, charged: reais(c.charged), refunded: reais(Math.min(c.refunded, c.charged)), net: reais(Math.max(c.charged - c.refunded, 0)) }))
    .sort((a, b) => b.net - a.net || b.charged - a.charged);
  const costsNet = costRows.reduce((s, c) => s + c.net * 100, 0);

  const largest = [...purchases]
    .sort((a, b) => b.cents - a.cents)
    .slice(0, 5)
    .map((p) => ({
      date: p.date.toISOString(),
      name: p.name,
      kind: p.kind,
      card: cardName.get(p.accountId) ?? '',
      amount: reais(p.cents),
      category: p.fam.label,
      installments: p.totalInstallments && p.totalInstallments > 1 ? `${p.installmentNumber}/${p.totalInstallments}` : null,
    }));

  // Os blocos de cartão mostram todos os cartões, mesmo com o filtro de cartão ativo.
  const pastAll = input.transactions.filter((t) => t.date.getTime() <= now.getTime());
  const refundsAll = input.accountId ? matchRefunds(pastAll) : refunds;
  const inPeriodAll = pastAll.filter(inRange);
  const cards = input.accounts.map((a) => {
    const limit = a.creditLimitCents === null ? null : Number(a.creditLimitCents);
    const available = a.availableCreditLimitCents === null ? null : Number(a.availableCreditLimitCents);
    const used = limit !== null && available !== null ? Math.max(limit - available, 0) : null;
    const bills = input.bills
      .filter((b) => b.accountId === a.id)
      .sort((x, y) => x.dueDate.getTime() - y.dueDate.getTime())
      .slice(-6)
      .map((b) => ({ dueDate: b.dueDate.toISOString(), total: reais(Number(b.totalAmountCents)) }));
    const { closed, open, upcoming } = billsOf.get(a.id)!;
    return {
      id: a.id,
      name: a.name.trim(),
      bank: input.bankNames[a.connectionId] ?? '',
      brand: a.cardBrand,
      last4: a.number?.slice(-4) ?? null,
      limit: limit === null ? null : reais(limit),
      available: available === null ? null : reais(available),
      used: used === null ? null : reais(used),
      utilization: limit && used !== null ? used / limit : null,
      // `balance` da conta é o limite utilizado (com parcelas futuras), não a fatura.
      closedBill: closed,
      openBill: open,
      // Faturas depois da aberta: só o que já está contratado (parcelas).
      upcomingBills: upcoming,
      // Faturas de ciclos já fechados, por mês de vencimento (inclusive as já vencidas).
      pastBills: billsOf.get(a.id)?.past ?? [],
      // Primeiro dia da fatura aberta deste cartão (dia seguinte ao último fechamento).
      cycleStart: cycleStartOf.get(a.id) ?? null,
      spentInPeriod: reais(classify(inPeriodAll.filter((t) => t.accountId === a.id), refundsAll, userLabels).purchases.reduce((s, p) => s + p.cents, 0)),
      bills,
    };
  });

  const sum = (pick: (c: (typeof cards)[number]) => number | null) =>
    reais(cards.filter((c) => selectedIds.has(c.id)).reduce((s, c) => s + (pick(c) ?? 0) * 100, 0));
  const limitTotal = sum((c) => c.limit);
  const usedTotal = sum((c) => c.used);

  return {
    generatedAt: now.toISOString(),
    period: { months: custom || billCycle ? null : months, custom, billCycle, from: firstMonth, to: lastMonth, startDate: startDay, endDate: endDay, currentMonth },
    cards,
    totals: {
      limit: limitTotal,
      used: usedTotal,
      available: sum((c) => c.available),
      utilization: limitTotal > 0 ? usedTotal / limitTotal : null,
      closedBills: sum((c) => c.closedBill?.amount ?? 0),
      openBills: sum((c) => c.openBill?.amount ?? 0),
      spent: reais(spent),
      avgMonthly: avgMonthly === null ? null : Math.round(avgMonthly * 100) / 100,
      purchases: purchases.length,
      avgTicket: purchases.length ? reais(spent / purchases.length) : 0,
      // Compras estornadas já estão fora de `spent`; créditos avulsos não têm compra correspondente.
      refundedPurchases: reais(refundedPurchases),
      refundedCount,
      otherCredits: reais(otherCredits),
      costs: reais(costsNet),
      international: international.total,
      unconverted,
    },
    byMonth,
    byDay,
    byCategory,
    // Categorias que o usuário pode dar a um estabelecimento.
    categoryChoices: Object.entries(CATEGORY_CHOICES).map(([id, c]) => ({ id, label: c.label })),
    costs: costRows,
    international,
    topMerchants,
    subscriptions,
    installments,
    weekdays,
    largest,
  };
}

export type CardsOverview = ReturnType<typeof buildCardsOverview>;
