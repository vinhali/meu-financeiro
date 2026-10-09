export type Section = 'entrada' | 'saida';

export interface LineItem {
  id: string;
  section: Section;
  order: number;
  name: string;
  obs: string;
  applyDissidio: boolean;
  excludeFromBridge: boolean;
  // saída: gasto controlável — o valor do mês é um limite, acompanhado contra o gasto real
  controllable: boolean;
  values: number[]; // same length/order as ScenarioFull.months
  actualValues: number[]; // realized values; zero means not informed
}

export type DebtSeverity = 'sev1' | 'sev2' | 'sev3' | 'sev4';
export type DebtStatus = 'ativa' | 'quitada' | 'monitorar';

export interface Debt {
  id: string;
  order: number;
  severity: DebtSeverity;
  severityLabel: string;
  name: string;
  balance: string;
  paidInstallments: number;
  balanceNote: string;
  installment: string;
  rate: string;
  note: string;
  action: string;
  status: DebtStatus;
  dueDay?: number | null;
  payments?: DebtPayment[];
}

export interface DebtPayment {
  id: string;
  debtId: string;
  paidAt: string;
  amount: number;
  installment?: number | null;
  note: string;
}

export interface Bridge {
  plr: number;
  dissidioPercent: number;
}

export interface Scenario {
  id: string;
  name: string;
  isBase: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HeaderContent {
  eyebrow: string;
  title: string;
  sub: string;
  noteTitle: string;
  note: string;
}

export interface RuleItem {
  id: string;
  text: string;
  hot: boolean;
}

export interface RulesContent {
  eyebrow: string;
  title: string;
  items: RuleItem[];
}

export interface AllocationSlice {
  id: string;
  label: string;
  value: string;
  description: string;
  locked: boolean;
}

export interface AllocationContent {
  eyebrow: string;
  title: string;
  slices: AllocationSlice[];
  noteTitle: string;
  note: string;
}

export interface MudancaItem {
  id: string;
  title: string;
  description: string;
}

export interface MudancaContent {
  eyebrow: string;
  title: string;
  intro: string;
  items: MudancaItem[];
}

export interface ScenarioTexts {
  header: HeaderContent;
  rules: RulesContent;
  allocation: AllocationContent;
  mudanca: MudancaContent;
}

export interface ScenarioFull {
  scenario: Scenario;
  items: LineItem[];
  debts: Debt[];
  bridge: Bridge;
  emergencyReserve: number;
  texts: ScenarioTexts;
  months: string[];
  bridgeMonths: string[];
}

export interface CardBill {
  amount: number;
  // Parte de `amount` em parcelas que o banco ainda não lançou (projetadas da parcela anterior).
  projectedInstallments: number;
  dueDate: string;
  closingDate: string | null;
  estimated: boolean;
}

// Uma compra dentro de uma barra do gráfico de gasto por dia/mês.
export interface ChartItem {
  name: string;
  kind: string | null;
  card: string;
  amount: number;
  installments: string | null;
}

// Resposta de GET /api/openfinance/cards (ver server/src/openfinance/cards.ts).
export interface CardsOverview {
  generatedAt: string;
  lastSyncedAt: string | null;
  period: { months: number | null; custom: boolean; billCycle: boolean; from: string; to: string; startDate: string; endDate: string; currentMonth: string };
  cards: Array<{
    id: string;
    name: string;
    bank: string;
    brand: string | null;
    last4: string | null;
    limit: number | null;
    available: number | null;
    used: number | null;
    utilization: number | null;
    // Fatura fechada (a pagar) e fatura aberta (em formação).
    closedBill: CardBill | null;
    openBill: CardBill | null;
    // Primeiro dia da fatura aberta deste cartão.
    cycleStart: string | null;
    spentInPeriod: number;
    bills: Array<{ dueDate: string; total: number }>;
  }>;
  totals: {
    limit: number;
    used: number;
    available: number;
    utilization: number | null;
    closedBills: number;
    openBills: number;
    spent: number;
    avgMonthly: number | null;
    purchases: number;
    avgTicket: number;
    // Compras estornadas já estão fora de `spent`.
    refundedPurchases: number;
    refundedCount: number;
    otherCredits: number;
    costs: number; // tarifas, IOF e juros, líquidos de devoluções
    international: number;
    unconverted: number;
  };
  byMonth: Array<{ month: string; total: number; count: number; items: ChartItem[] }>;
  // Preenchido só em períodos curtos (até ~2 meses), quando o gráfico é por dia.
  byDay: Array<{ day: string; total: number; count: number; items: ChartItem[] }> | null;
  byCategory: Array<{
    id: string;
    label: string;
    total: number;
    count: number;
    share: number;
    subcategories: Array<{ label: string; total: number }>;
    merchants: Array<{ name: string; total: number }>;
    places?: Array<{ key: string; name: string; total: number; count: number }>;
  }>;
  categoryChoices?: Array<{ id: string; label: string }>;
  costs: Array<{ label: string; charged: number; refunded: number; net: number }>;
  international: {
    total: number;
    count: number;
    byCurrency: Array<{ currency: string; count: number; original: number; total: number; rate: number | null }>;
    top: Array<{ name: string; total: number; count: number }>;
  };
  topMerchants: Array<{ key: string; name: string; kind: string | null; total: number; count: number }>;
  subscriptions: Array<{ key: string; name: string; kind: string | null; monthly: number; months: number; lastDate: string; active: boolean }>;
  installments: {
    monthly: Array<{ month: string; total: number }>;
    totalRemaining: number;
    nextMonth: { month: string; total: number } | null;
    endsIn: string | null;
    relief: { month: string; from: number; to: number } | null;
    activeCount: number;
    active: Array<{
      key?: string;
      // Etiqueta dada pelo usuário a este parcelamento.
      label?: string | null;
      name: string;
      card: string;
      installment: number;
      totalInstallments: number;
      remainingInstallments: number;
      amount: number;
      remainingAmount: number;
      endsIn: string;
    }>;
  };
  weekdays: Array<{ total: number; days: number; average: number; count?: number; activeDays?: number; top?: { label: string; total: number } | null }>;
  largest: Array<{ date: string; name: string; kind: string | null; card: string; amount: number; category: string; installments: string | null }>;
}

// Resposta de GET /api/openfinance/budget (ver server/src/openfinance/budget.ts).
export interface BudgetMonth {
  label: string;
  month: string | null;
  planned: number;
  state: 'current' | 'past' | 'future' | 'unknown';
  // limite
  window?: { start: string; end: string } | null;
  actual?: number;
  fromAccount?: number;
  offBill?: number;
  accountInMonth?: number;
  // Teto usado na comparação: o planejado do mês ou, se ele for zero, o de outro mês (`limitFrom`).
  limit?: number | null;
  limitFrom?: string | null;
  count?: number;
  used?: number | null;
  projected?: number | null;
  status?: 'ok' | 'near' | 'over' | 'unset' | 'none';
  top?: Array<{ name: string; amount: number }>;
  // Todos os lugares que contaram no limite, com a chave para corrigir a categoria.
  places?: Array<{ key: string; name: string; amount: number; count: number }>;
  // conta fixa
  paid?: { amount: number; date: string; name: string; source: string; onCard: boolean; billRow?: boolean; manual?: null | 'pending' | 'confirmed'; ahead?: boolean; joint?: { total: number; with: string[] } | null; byAmount?: boolean; count: number; sameCount?: number; sameTotal?: number; differs: boolean } | null;
  // Conta ainda não paga no mês corrente: como foi no mês anterior.
  previous?: { amount: number; date: string; firstDate?: string; count?: number } | null;
  candidates?: Array<{ key: string; name: string; amount: number; date: string; source: string }>;
  // fatura de cartão
  suggested?: number | null;
  billState?: 'closed' | 'open' | 'projected' | null;
  // Fatura futura: parcelas já contratadas + compras avulsas típicas (mediana das últimas faturas).
  forecast?: { installments: number; typical: number; low: number; high: number; cycles: number; events?: number; total: number; history?: Array<{ dueMonth: string; amount: number; top: Array<{ name: string; amount: number }> }> } | null;
  dueDate?: string | null;
  // entrada
  received?: { amount: number; date: string; name: string; source: string; differs: boolean } | null;
}

// Pix de um período: total, quantidade e os três maiores nomes.
export interface PixSide {
  total: number;
  count: number;
  top: Array<{ name: string; amount: number }>;
}

export interface Budget {
  cardDebt?: CardDebt;
  // Saldo em conta agora, somando todos os bancos.
  cash?: { total: number; accounts: Array<{ bank: string; name: string; balance: number }> };
  generatedAt: string;
  currentMonth: string;
  months: Array<{
    label: string;
    month: string | null;
    state: 'current' | 'past' | 'future' | 'unknown';
    pix?: { received: PixSide; sent: PixSide; items?: Array<{ date: string; name: string; amount: number; incoming: boolean }> } | null;
    // Ciclo dos cartões pago neste mês (do fechamento anterior ao próximo), quando conhecido.
    cycle: { start: string; end: string; state: 'current' | 'past' | 'future' } | null;
  }>;
  rows: Array<{ itemId: string; name: string; type: 'limit' | 'fixed' | 'cardBill' | 'income'; rule: string | null; category?: string | null; months: BudgetMonth[] }>;
}

// ── Open Finance: conexões ──
export interface OpenFinanceStatus {
  configured: boolean;
  syncing: boolean;
  totals: { transactions: number; investments: number; loans: number };
  connections: Array<{
    id: string;
    connector: string;
    status: string;
    error: string | null;
    consentExpiresAt: string | null;
    providerUpdatedAt: string | null;
    lastSyncedAt: string | null;
    accounts: Array<{ id: string; type: string; subtype: string; name: string; transactions: number }>;
  }>;
  runs: Array<{
    id: string;
    connectionId: string | null;
    trigger: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    stats: { transactions?: number; warnings?: string[] } | null;
    error: string | null;
  }>;
}
// Andamento de uma conexão nova ou de uma reconexão.
export interface ConnectProgress {
  itemId: string;
  status: string;
  executionStatus: string | null;
  url: string | null;
  error: string | null;
  loading?: boolean;
  done?: boolean;
  duplicateOf?: string;
}
export interface ConnectionTest {
  connectionId: string;
  testedAt: string;
  state: 'ok' | 'warn' | 'fail';
  checks: Array<{ id: string; label: string; state: 'ok' | 'warn' | 'fail'; detail: string }>;
}

// Mês retirado da planilha e guardado no histórico.
// Dívida de cartão calculada: parcelas nas faturas depois da aberta, de todos os cartões.
export interface CardDebt {
  total: number;
  bills: Array<{ dueMonth: string; amount: number }>;
}

export interface MonthArchive {
  id: string;
  label: string;
  month: string | null;
  archivedAt: string;
  // O que a planilha mostrava para o mês ao ser retirado; nulo quando não foi registrado.
  totals: { entradas: number; saidas: number; saldo: number } | null;
  // Soma simples dos valores digitados (conta de novo o que estava nas faturas).
  typed: { entradas: number; saidas: number; saldo: number };
  rows: Array<{ name: string; section: string; value: number }>;
}

// Central de alertas.
export interface AlertsState {
  alerts: Array<{ id: string; kind: string; severity: 'urgent' | 'attention' | 'info'; title: string; body: string; createdAt: string; read: boolean }>;
  unread: number;
  channels: AlertChannels;
}

export interface AlertChannels {
  telegram: { configured: boolean; linked: boolean; bot?: string | null };
  email: { configured: boolean; to: string | null; recipients?: number; hasPassword?: boolean };
}
// Configuração dos alertas (os segredos nunca vêm do servidor).
export interface AlertsConfig {
  digest: { enabled: boolean; at: string; frequency: 'daily' | 'weekly'; weekday: number };
  urgentNow: boolean;
  rules: Record<'billDue' | 'late' | 'cash' | 'limit' | 'bigPurchase' | 'newPlan' | 'monthDrop' | 'connection', boolean>;
  thresholds: { limitNear: number; bigPurchase: number; monthDrop: number; staleHours: number; consentDays: number };
  email: { host: string; port: number; user: string; to: string };
}
export interface AlertsSettings {
  config: AlertsConfig;
  channels: AlertChannels;
}
export interface AlertsHistoryItem {
  id: string;
  kind: string;
  severity: string;
  title: string;
  body: string;
  createdAt: string;
  sent: boolean;
  dismissed: boolean;
}
