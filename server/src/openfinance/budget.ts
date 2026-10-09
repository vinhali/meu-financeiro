// Acompanhamento do planejamento com dados reais do Open Finance.
//
// Cada linha de saída do cenário vira um de três tipos, deduzido pelo nome:
//   - limite: categoria de consumo (alimentação, social, combustível) — soma os gastos reais
//     do mês e compara com o valor planejado;
//   - conta fixa: uma cobrança esperada no mês (aluguel, internet, academia) — procura o
//     pagamento nos cartões e nas contas e diz se já foi pago;
//   - fatura: linha de fatura de cartão — sugere o valor calculado a partir do banco.
// Função pura: recebe os lançamentos já normalizados.

export interface BudgetItem {
  id: string;
  name: string;
  section?: 'entrada' | 'saida';
  // Gasto controlável: o valor do mês é um limite, comparado com o consumo real.
  controllable?: boolean;
  values: number[]; // planejado por mês, na ordem de `months`
}

export interface BudgetTx {
  date: Date;
  cents: number; // sempre positivo
  key: string; // chave do estabelecimento/contraparte
  name: string;
  kind: string | null;
  famId: string;
  sub: string;
  description: string;
  source: string; // "Nubank · cartão", "Bradesco · conta"
  // Compra no cartão: mês em que vence a fatura em que ela cai, pelo fechamento daquele cartão.
  dueMonth?: string | null;
  // Compra parcelada: número desta parcela (1 = a compra aconteceu neste ciclo).
  installment?: number | null;
  // Total de parcelas do plano, quando conhecido.
  installmentTotal?: number | null;
}

export interface BudgetCard {
  bank: string;
  closedBill: { amount: number; dueDate: string } | null;
  openBill: { amount: number; dueDate: string } | null;
  upcomingBills?: Array<{ dueMonth: string; amount: number }>;
  // Faturas de ciclos já fechados, por mês de vencimento (continuam valendo depois de vencer).
  pastBills?: Array<{ dueMonth: string; amount: number; dueDate: string }>;
}

const BRT_OFFSET_MS = 3 * 3_600_000;
const localMonth = (d: Date) => new Date(d.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 7);
const localDay = (d: Date) => new Date(d.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10);
const reais = (cents: number) => Math.round(cents) / 100;
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();

const MONTH_LABELS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

// Os meses do cenário são só rótulos ("OUT", "Janeiro/2027"). Sem ano explícito, vale a
// ocorrência mais próxima de hoje, olhando até 3 meses para trás e o resto para a frente.
export function monthOfLabel(label: string, now: Date): string | null {
  const text = norm(label);
  const index = MONTH_LABELS.findIndex((m) => text.startsWith(m));
  if (index < 0) return null;
  const explicit = text.match(/(20\d{2})/);
  const current = new Date(now.getTime() - BRT_OFFSET_MS);
  let year = explicit ? Number(explicit[1]) : current.getUTCFullYear();
  if (!explicit) {
    const diff = index - current.getUTCMonth();
    if (diff < -3) year += 1;
    else if (diff > 8) year -= 1;
  }
  return `${year}-${String(index + 1).padStart(2, '0')}`;
}

interface LimitRule {
  row: RegExp;
  label: string;
  test: (t: BudgetTx) => boolean;
  // Categoria (id de CATEGORY_CHOICES) que faz um estabelecimento contar neste limite.
  category?: string;
}

const LIMITS: LimitRule[] = [
  { row: /ALIMENT|MERCADO|COMIDA/, label: 'Mercado e delivery', category: 'mercado', test: (t) => t.famId === '10' || t.sub === 'Delivery' },
  {
    row: /SOCIA|LAZER|SAIDAS|RESTAURANTE/,
    label: 'Restaurantes, lazer e ingressos',
    category: 'restaurante',
    test: (t) => t.sub === 'Restaurantes' || t.famId === '21' || t.sub === 'Ingressos' || t.sub === 'Cinema e shows',
  },
  {
    row: /COMBUST|PEDAGIO|GASOLINA/,
    label: 'Combustível, pedágio e estacionamento',
    category: 'combustivel',
    test: (t) => t.sub === 'Combustível' || t.sub === 'Pedágio' || t.sub === 'Estacionamento',
  },
];

interface FixedRule {
  row: RegExp;
  words?: RegExp; // testado na descrição/nome sem acentos, em maiúsculas
  subs?: string[];
  famId?: string;
  ahead?: number; // dia do mês a partir do qual o pagamento pela conta vale para a coluna seguinte
}

const FIXED: FixedRule[] = [
  { row: /ALUGUEL/, words: /ALUGUEL|IMOBILI|QUINTO ?ANDAR/ },
  { row: /CONDOMINIO/, words: /CONDOM/ },
  { row: /IPTU/, words: /IPTU|PREFEITURA/ },
  { row: /\bGAS\b/, words: /COMGAS|CONSIGAZ|ULTRAGAZ|SUPERGASBRAS|LIQUIGAS|NATURGY/, subs: ['Gás'] },
  { row: /ENERGIA|\bLUZ\b/, words: /CPFL|ENEL|ELEKTRO|LIGHT|CEMIG|ENERGISA|COPEL|EQUATORIAL|NEOENERGIA/, subs: ['Energia'] },
  { row: /AGUA/, words: /SAAE|SABESP|SANASA|COPASA|SANEPAR|SERVICO AUTONOM/, subs: ['Água'] },
  { row: /INTERNET|TELEFONE|CELULAR/, words: /VIVO|CLARO|\bTIM\b|\bOI\b|FIBRA|TELECOM/, subs: ['Internet', 'Telefonia'] },
  // "Seguro Veicular" precisa casar aqui antes da regra de financiamento veicular.
  // Só a categoria "seguros" não basta (um seguro viagem não é o seguro do carro): a linha de seguro
  // casa pelo nome da seguradora ou pelo rótulo que o usuário deu ao estabelecimento.
  { row: /SEGURO/, words: /SEGURO|SEGURADORA|TOKIO MARINE|ALLIANZ|MAPFRE|LIBERTY|SULAMERICA/ },
  // Debitado a partir do dia 15 e coberto com o vale do dia 20: esse dinheiro já é do mês seguinte.
  { row: /FINANCIAMENTO ESTUD|FIES/, words: /FIES|PRAVALER|ESTUDANTIL/, ahead: 15 },
  { row: /FINANCIAMENTO|VEICUL/, words: /FINANC/ },
  { row: /EMPRESTIMO/, words: /EMPRESTIMO|PARCELA PAGA/ },
  { row: /ICLOUD|APPLE/, words: /APPLE/ },
  { row: /ACADEMIA/, subs: ['Academia'] },
  { row: /\bVPS\b|SERVIDOR|HOSPEDAGEM/, subs: ['Servidores e hospedagem'] },
];

// Nomes de banco usados para ligar "Nu Bank (fatura)" ao cartão certo.
const BANK_WORDS: Array<[RegExp, RegExp]> = [
  [/\bC6\b/, /C6/],
  [/\bNU\b|NUBANK/, /NU PAGAMENTOS|NUBANK/],
  [/PIC\s*PAY/, /PIC\s*PAY/],
  [/BRADESCO/, /BRADESCO/],
  [/BANCO DO BRASIL|\bBB\b|OUROCARD/, /BANCO DO BRASIL/],
  [/ITAU/, /ITAU/],
  [/SANTANDER/, /SANTANDER/],
  [/\bINTER\b/, /\bINTER\b/],
];

// Descrição que não identifica o estabelecimento.
const GENERIC_CHARGE = /^(COMPRA|PAGAMENTO|LANCAMENTO)\b.*(SEM JUROS|A VISTA|MASTERCARD|VISA|CREDITO)/;
const CONSUMPTION_FAMILIES = new Set(['08', '09', '10', '11', '12', '18', '19', '21']);
const STOPWORDS = new Set(['PARA', 'COM', 'DOS', 'DAS', 'UMA', 'MENSAL', 'CONTA', 'PAGAMENTO']);
const words = (s: string) =>
  norm(s)
    .split(/[^A-Z0-9]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));

// Quanto uma cobrança "é" de uma linha de conta fixa (0 = não é). Serve também para desempatar:
// cada cobrança fica só com a linha que a descreve melhor — "GOOGLE YOUTUBEPREMIUM" é da linha
// "Youtube", não da "Google One", embora as duas citem o Google.
function fixedScorer(rowName: string): (t: BudgetTx) => number {
  const row = norm(rowName);
  const rule = FIXED.find((r) => r.row.test(row));
  const rowWords = words(rowName);
  return (t) => {
    const text = `${norm(t.description)} ${norm(t.name)}`;
    // Rótulo dado pelo usuário (ou pela marca) que cita a linha: "seguro do carro" ~ "Seguro Veicular".
    if (t.kind && words(t.kind).some((w) => rowWords.includes(w))) return 100;
    if (rule?.words?.test(text)) return 20;
    if (rule?.subs?.includes(t.sub)) return 15;
    if (rule) return 0;
    // Sem regra específica: o nome da linha aparece na cobrança ("Claude", "Youtube", "Microsoft 365").
    // Quanto mais letras do nome aparecem, mais específica é a correspondência.
    return rowWords.filter((w) => text.includes(w)).reduce((n, w) => n + w.length, 0);
  };
}

// Mesma data, n meses depois, sem estourar o mês (31/01 + 1 mês = 28/02).
function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return target.toISOString().slice(0, 10);
}
const addDays = (day: string, n: number) => new Date(Date.parse(day) + n * 86_400_000).toISOString().slice(0, 10);
const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));

// Mês de vencimento da fatura em que uma compra cai, dado o fechamento e o vencimento da fatura
// aberta do cartão. A compra feita no dia do fechamento ainda entra na fatura que fecha.
export function dueMonthFor(day: string, openClosing: string, openDue: string): string {
  const closingDay = Number(openClosing.slice(8, 10));
  const offset = monthsBetween(openClosing.slice(0, 7), openDue.slice(0, 7));
  const [y, m, d] = day.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const closesThisMonth = d <= Math.min(closingDay, lastDay);
  return new Date(Date.UTC(y, m - 1 + (closesThisMonth ? 0 : 1) + offset, 1)).toISOString().slice(0, 7);
}

// Linha controlável sem regra própria ("Farmácia", "Uber", "Pet"): soma os lançamentos cuja
// subcategoria, estabelecimento ou rótulo cite alguma palavra do nome da linha.
function genericLimit(rowName: string): LimitRule {
  const rowWords = words(rowName);
  return {
    row: /$^/,
    label: `lançamentos que citam "${rowName.trim()}"`,
    test: (t) => {
      const text = `${norm(t.sub)} ${norm(t.name)} ${norm(t.kind ?? '')} ${norm(t.description)}`;
      return rowWords.length > 0 && rowWords.some((w) => text.includes(w));
    },
  };
}

// Entradas: salário e adiantamento vêm categorizados pelo banco; as demais casam pelo nome da
// linha ou por rótulo dado pelo usuário à contraparte.
function incomeMatcher(rowName: string): (t: BudgetTx) => boolean {
  const row = norm(rowName);
  const rowWords = words(rowName);
  const salaryLike = /SALARIO|ADIANTAMENTO|VALE|13/.test(row);
  return (t) => {
    const text = `${norm(t.description)} ${norm(t.name)}`;
    if (t.kind && words(t.kind).some((w) => rowWords.includes(w))) return true;
    if (salaryLike && (t.sub === 'Salary' || /SALARIO|FOLHA|PROVENTOS|ADIANT/.test(text))) return true;
    return rowWords.some((w) => text.includes(w));
  };
}

// Débito em conta que o banco desfez: a tentativa sem saldo volta como "ESTORNO DEBITO" de mesmo
// valor (o FIES tenta de novo a cada dia até conseguir). Devolve os ids do débito e do estorno,
// que não são nem gasto nem entrada.
export function reversedDebits(rows: Array<{ id: string; accountId: string; type: string; date: Date; description: string; cents: number }>): Set<string> {
  const out = new Set<string>();
  const debits = rows.filter((t) => t.type === 'DEBIT');
  for (const credit of rows.filter((t) => t.type === 'CREDIT' && /ESTORNO/.test(norm(t.description))).sort((a, b) => a.date.getTime() - b.date.getTime())) {
    const original = debits
      .filter((d) => !out.has(d.id) && d.accountId === credit.accountId && d.cents === credit.cents && Math.abs(d.date.getTime() - credit.date.getTime()) <= 3 * 86_400_000)
      .sort((a, b) => Math.abs(a.date.getTime() - credit.date.getTime()) - Math.abs(b.date.getTime() - credit.date.getTime()))[0];
    if (original) {
      out.add(original.id);
      out.add(credit.id);
    }
  }
  return out;
}

// Entre as cobranças de uma linha, a que vale como "o pagamento do mês".
function pickCharge(hits: BudgetTx[], planned: number): { g: BudgetTx[]; total: number; all: BudgetTx[] } | undefined {
  // Soma apenas o que é a mesma cobrança repetida (mesma contraparte e mesma descrição, como
  // as várias linhas do FIES); cobranças diferentes do mesmo fornecedor ficam separadas.
  const groups = new Map<string, BudgetTx[]>();
  for (const t of hits) {
    const groupKey = `${t.key}|${norm(t.description)}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), t]);
  }
  // Com valor planejado, concorrem tanto o total de cada contraparte quanto cada cobrança
  // isolada (o mesmo "Google" cobra YouTube e Google One); vence o mais próximo do planejado,
  // e nada que fuja mais de 50% dele é aceito — melhor não afirmar do que apontar a cobrança errada.
  // `all` guarda o grupo inteiro, para dizer quantos lançamentos iguais existem quando um só é escolhido.
  const options = [...groups.values()].flatMap((g) => [
    { g, total: g.reduce((sum, t) => sum + t.cents, 0), all: g },
    ...(planned > 0 && g.length > 1 ? g.map((t) => ({ g: [t], total: t.cents, all: g })) : []),
  ]);
  return options
    .filter((o) => planned <= 0 || Math.abs(o.total - planned * 100) <= planned * 100 * 0.5)
    .sort((x, y) => (planned > 0 ? Math.abs(x.total - planned * 100) - Math.abs(y.total - planned * 100) : y.total - x.total))[0];
}

// Tipo de cada linha do cenário, pelo que ela é: entrada, limite (gasto controlável), fatura de
// cartão (nome cita "fatura"/"cartão" e um banco) ou conta fixa.
function rowKind(item: BudgetItem): 'income' | 'limit' | 'cardBill' | 'fixed' {
  if (item.section === 'entrada') return 'income';
  if (item.controllable) return 'limit';
  const name = norm(item.name);
  return /FATURA|CARTAO/.test(name) && BANK_WORDS.some(([row]) => row.test(name)) ? 'cardBill' : 'fixed';
}

export function buildBudget(input: {
  items: BudgetItem[];
  months: string[];
  transactions: BudgetTx[];
  cards: BudgetCard[];
  // Ciclo dos cartões: `start` é o dia seguinte ao último fechamento e `dueMonth` o mês em que
  // essa fatura é paga. Com ele, o consumo de uma coluna é o do ciclo pago naquele mês — o que
  // se gasta depois que os cartões viram pertence ao mês seguinte, quando a fatura vence.
  cycle?: { start: string; dueMonth: string } | null;
  // Créditos recebidos nas contas (salário, auxílios), para reconhecer as linhas de entrada.
  income?: BudgetTx[];
  // Contas marcadas como pagas à mão, e quando os bancos foram lidos pela última vez.
  marks?: Array<{ itemId: string; month: string; markedAt: Date }>;
  // Saldo de cada conta e os Pix que entraram e saíram (sem transferências entre contas próprias).
  cash?: Array<{ bank: string; name: string; balance: number }>;
  pix?: Array<{ date: Date; cents: number; incoming: boolean; name: string }>;
  lastSyncAt?: Date | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const currentMonth = localMonth(now);
  const monthKeys = input.months.map((label) => monthOfLabel(label, now));
  const byMonth = new Map<string, BudgetTx[]>();
  for (const t of input.transactions) {
    if (t.date.getTime() > now.getTime()) continue;
    const mk = localMonth(t.date);
    byMonth.set(mk, [...(byMonth.get(mk) ?? []), t]);
  }
  const todayKey = localDay(now);
  const windowOf = (mk: string | null) => {
    if (!mk || !input.cycle) return null;
    const start = shiftDay(input.cycle.start, monthsBetween(input.cycle.dueMonth, mk));
    const end = addDays(shiftDay(start, 1), -1);
    return { start, end, state: todayKey < start ? ('future' as const) : todayKey > end ? ('past' as const) : ('current' as const) };
  };
  const incomeByMonth = new Map<string, BudgetTx[]>();
  for (const t of input.income ?? []) {
    if (t.date.getTime() > now.getTime()) continue;
    const mk = localMonth(t.date);
    incomeByMonth.set(mk, [...(incomeByMonth.get(mk) ?? []), t]);
  }
  const state = (mk: string | null) => (mk === null ? 'unknown' : mk === currentMonth ? 'current' : mk < currentMonth ? 'past' : 'future');
  // Fração do mês corrente já decorrida, para projetar o fechamento no ritmo atual.
  const today = new Date(now.getTime() - BRT_OFFSET_MS);
  const daysInMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate();
  const elapsed = today.getUTCDate() / daysInMonth;

  const scorers = input.items.map((item) => (rowKind(item) === 'fixed' ? fixedScorer(item.name) : null));
  // Um gasto no cartão só "já está na fatura" para a planilha se existe uma linha de fatura
  // daquele banco. Cartão sem linha de fatura: o gasto não está em lugar nenhum do total.
  const billBanks = input.items.flatMap((item) => {
    if (rowKind(item) !== 'cardBill') return [];
    const word = BANK_WORDS.find(([row]) => row.test(norm(item.name)));
    return word ? [word[1]] : [];
  });
  const hasBillRow = (t: BudgetTx) => billBanks.some((bank) => bank.test(norm(t.source)));

  // ── Previsão das faturas futuras ──
  // Uma fatura futura tem quatro partes: parcelas já contratadas (conhecidas), gastos controláveis
  // (as linhas de limite), contas fixas no cartão (as linhas de assinatura) e o resto — compras
  // avulsas, que não têm linha nenhuma. Esse resto é estimado pelo que cada banco teve nas
  // últimas faturas fechadas: a mediana, que não se deixa levar por um mês atípico.
  const limitTests = input.items.flatMap((item) => {
    if (rowKind(item) !== 'limit') return [];
    return [(LIMITS.find((l) => l.row.test(norm(item.name))) ?? genericLimit(item.name)).test];
  });
  const isLoose = (t: BudgetTx) =>
    Boolean(t.dueMonth) && !(t.installment && t.installment > 1) && !limitTests.some((test) => test(t)) && !scorers.some((score) => score && score(t) > 0);
  const HISTORY_CYCLES = 4;
  const EVENT_FAMILIES = new Set(['12', '05']); // viagem; transferências
  const typicalLoose = (
    bank: RegExp,
  ): { typical: number; low: number; high: number; cycles: number; events: number; history: Array<{ dueMonth: string; amount: number; top: Array<{ name: string; amount: number }> }> } | null => {
    const openDue = input.cycle?.dueMonth;
    if (!openDue) return null;
    const mine = input.transactions.filter((t) => t.dueMonth && bank.test(norm(t.source)));
    const first = mine.reduce<string | null>((min, t) => (!min || t.dueMonth! < min ? t.dueMonth! : min), null);
    if (!first) return null;
    const totals: number[] = [];
    const history: Array<{ dueMonth: string; amount: number; top: Array<{ name: string; amount: number }> }> = [];
    let events = 0;
    for (let k = 1; k <= HISTORY_CYCLES; k++) {
      const due = new Date(Date.UTC(Number(openDue.slice(0, 4)), Number(openDue.slice(5, 7)) - 1 - k, 1)).toISOString().slice(0, 7);
      // Antes do primeiro lançamento conhecido do cartão não há histórico: não conta como zero.
      if (due < first) break;
      const all = mine.filter((t) => t.dueMonth === due && isLoose(t));
      // Viagem e transferência paga com o cartão são eventos, não rotina: ficam fora do típico
      // (aparecem à parte, para planejar quando houver outro).
      const loose = all.filter((t) => !EVENT_FAMILIES.has(t.famId));
      const total = loose.reduce((sum, t) => sum + t.cents, 0);
      events += all.reduce((sum, t) => sum + t.cents, 0) - total;
      totals.push(total);
      // As maiores compras de cada fatura, para dar para ver do que a estimativa é feita.
      history.push({ dueMonth: due, amount: reais(total), top: [...loose].sort((x, y) => y.cents - x.cents).slice(0, 3).map((t) => ({ name: t.name, amount: reais(t.cents) })) });
    }
    if (totals.length < 2) return null;
    const sorted = [...totals].sort((x, y) => x - y);
    const mid = sorted.length / 2;
    const median = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
    return { typical: reais(Math.round(median)), low: reais(sorted[0]), high: reais(sorted[sorted.length - 1]), cycles: totals.length, events: reais(events), history };
  };

  // Aluguel, condomínio e IPTU costumam sair numa transferência só para o proprietário, sem nada
  // na descrição que diga o que é. Reconhece pelo valor: uma transferência que bate (até 2%) com a
  // soma do previsto dessas linhas na coluna. Vale de 25 do mês anterior a 24 do mês (aluguel
  // pago uns dias antes da virada é do mês seguinte).
  const housing = input.items.flatMap((item, index) => (scorers[index] && /ALUGUEL|CONDOMINIO|IPTU/.test(norm(item.name)) ? [{ item, index }] : []));
  const jointFor = (mk: string, column: number) => {
    const rows = housing.filter((h) => (h.item.values[column] ?? 0) > 0);
    if (rows.length < 2 || !rows.some((h) => /ALUGUEL/.test(norm(h.item.name)))) return null;
    const start = new Date(Date.UTC(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)) - 2, 25)).toISOString().slice(0, 10);
    const transfers = input.transactions.filter(
      (t) =>
        !t.dueMonth &&
        t.date.getTime() <= now.getTime() &&
        localDay(t.date) >= start &&
        localDay(t.date) <= `${mk}-24` &&
        /PIX|TRANSFER|BOLETO|^TED /.test(norm(t.description)) &&
        scorers.every((other) => !other || other(t) === 0),
    );
    let best: { tx: BudgetTx; members: typeof rows; planned: number; off: number } | null = null;
    for (let mask = 1; mask < 1 << rows.length; mask++) {
      const members = rows.filter((_, k) => mask & (1 << k));
      if (members.length < 2 || !members.some((h) => /ALUGUEL/.test(norm(h.item.name)))) continue;
      const plannedCents = Math.round(members.reduce((sum, h) => sum + (h.item.values[column] ?? 0), 0) * 100);
      for (const tx of transfers) {
        const off = Math.abs(tx.cents - plannedCents) / plannedCents;
        if (off <= 0.02 && (!best || off < best.off)) best = { tx, members, planned: plannedCents, off };
      }
    }
    return best;
  };

  // Entradas: cada crédito pertence a uma linha só. Os pares (linha, crédito) concorrem pelo valor
  // mais próximo do previsto — o salário do dia 5 é da linha "Salário", não também do "13º" e do
  // "Adiantamento", embora o banco classifique os três como salário. Linha sem valor previsto no
  // mês não espera nada, então não reconhece nada.
  const incomePick = new Map<string, BudgetTx>();
  monthKeys.forEach((mk, i) => {
    if (!mk || state(mk) === 'future') return;
    const credits = incomeByMonth.get(mk) ?? [];
    const pairs = input.items.flatMap((item, index) => {
      const planned = (item.values[i] ?? 0) * 100;
      if (rowKind(item) !== 'income' || planned <= 0) return [];
      const match = incomeMatcher(item.name);
      return credits.filter(match).map((credit) => ({ index, credit, off: Math.abs(credit.cents - planned) / planned }));
    });
    const taken = new Set<BudgetTx>();
    for (const pair of pairs.sort((x, y) => x.off - y.off)) {
      const key = `${pair.index}|${i}`;
      if (incomePick.has(key) || taken.has(pair.credit)) continue;
      incomePick.set(key, pair.credit);
      taken.add(pair.credit);
    }
  });

  // Marcações que não valem mais: desmentidas pelos bancos, ou que o reconhecimento automático já cobre.
  const staleMarks: Array<{ itemId: string; month: string }> = [];

  const rows = input.items.map((item, itemIndex) => {
    const rowName = norm(item.name);
    // Só linhas marcadas como gasto controlável viram limite. O que conta em cada uma vem do
    // nome: regras conhecidas (alimentação, social, combustível) ou, na falta, tudo o que cite a linha.
    const limit = item.controllable && item.section !== 'entrada' ? (LIMITS.find((l) => l.row.test(rowName)) ?? genericLimit(item.name)) : undefined;
    const bankWord = /FATURA|CARTAO/.test(rowName) ? BANK_WORDS.find(([row]) => row.test(rowName)) : undefined;
    const type = item.section === 'entrada' ? ('income' as const) : limit ? ('limit' as const) : bankWord ? ('cardBill' as const) : ('fixed' as const);
    const cards = bankWord ? input.cards.filter((c) => bankWord[1].test(norm(c.bank))) : [];

    const months = monthKeys.map((mk, i) => {
      const planned = item.values[i] ?? 0;
      const st = state(mk);
      const base = { label: input.months[i], month: mk, planned, state: st };
      const txs = mk && st !== 'future' ? (byMonth.get(mk) ?? []) : [];

      if (type === 'limit') {
        const window = windowOf(mk);
        const lst = window ? window.state : st;
        const pool = window
          ? lst === 'future'
            ? []
            : input.transactions.filter(
                (t) =>
                  t.date.getTime() <= now.getTime() &&
                  // Cartão: pela fatura em que a compra cai. Conta: pela janela geral do ciclo.
                  (t.dueMonth ? t.dueMonth === mk : localDay(t.date) >= window.start && localDay(t.date) <= window.end),
              )
          : txs;
        const hits = pool.filter(limit!.test);
        // Fração da janela já decorrida, para projetar o fechamento no ritmo atual.
        const share = window
          ? (Date.parse(todayKey) - Date.parse(window.start) + 86_400_000) / (Date.parse(window.end) - Date.parse(window.start) + 86_400_000)
          : elapsed;
        const actualCents = hits.reduce((s, t) => s + t.cents, 0);
        const actual = reais(actualCents);
        const places = new Map<string, number>();
        for (const t of hits) places.set(t.name, (places.get(t.name) ?? 0) + t.cents);
        // Todos os lugares, com a chave do estabelecimento, para o usuário poder corrigir a categoria.
        const byKey = new Map<string, { key: string; name: string; cents: number; count: number }>();
        for (const t of hits) {
          const p = byKey.get(t.key) ?? { key: t.key, name: t.name, cents: 0, count: 0 };
          p.cents += t.cents;
          p.count += 1;
          byKey.set(t.key, p);
        }
        const projected = lst === 'current' && share > 0 ? reais(actualCents / share) : null;
        // Mês sem valor planejado: usa como referência o limite do mês mais próximo que tenha um
        // (primeiro os seguintes), para que o uso sempre apareça contra algum teto.
        const order = [...item.values.keys()].sort((a, b) => Math.abs(a - i) - Math.abs(b - i) || b - a);
        const borrowed = planned > 0 ? undefined : order.find((j) => (item.values[j] ?? 0) > 0);
        const limitValue = planned > 0 ? planned : borrowed !== undefined ? item.values[borrowed] : 0;
        const used = limitValue > 0 ? actual / limitValue : null;
        return {
          ...base,
          state: lst,
          window: window ? { start: window.start, end: window.end } : null,
          actual,
          // Parte do gasto que saiu direto da conta (Pix, débito): não está em nenhuma fatura.
          fromAccount: reais(hits.filter((t) => !t.dueMonth).reduce((sum, t) => sum + t.cents, 0)),
          // Gasto em cartão que não tem linha de fatura na planilha: precisa somar à parte.
          offBill: reais(hits.filter((t) => t.dueMonth && !hasBillRow(t)).reduce((sum, t) => sum + t.cents, 0)),
          // O que saiu da conta nesta categoria dentro do mês de calendário da coluna: é despesa
          // do mês (como uma conta paga), e não aparece em fatura nenhuma.
          accountInMonth: reais(
            (mk ? input.transactions : [])
              .filter((t) => !t.dueMonth && t.date.getTime() <= now.getTime() && localMonth(t.date) === mk && limit!.test(t))
              .reduce((sum, t) => sum + t.cents, 0),
          ),
          count: hits.length,
          limit: limitValue > 0 ? limitValue : null,
          limitFrom: borrowed !== undefined ? input.months[borrowed] : null,
          used,
          projected,
          // perto: 80% do limite, ou ritmo que estoura antes do fim do mês.
          status:
            lst === 'future' || lst === 'unknown'
              ? ('none' as const)
              : limitValue <= 0
                ? ('unset' as const)
                : actual > limitValue
                  ? ('over' as const)
                  : actual >= limitValue * 0.8 || (projected !== null && projected > limitValue)
                    ? ('near' as const)
                    : ('ok' as const),
          places: [...byKey.values()].sort((a, b) => b.cents - a.cents).map((p) => ({ key: p.key, name: p.name, amount: reais(p.cents), count: p.count })),
          top: [...places.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([name, cents]) => ({ name, amount: reais(cents) })),
        };
      }

      if (type === 'income') {
        // Entrada: o crédito do mês atribuído a esta linha (ver `incomePick`).
        const best = incomePick.get(`${itemIndex}|${i}`);
        return {
          ...base,
          received: best
            ? { amount: reais(best.cents), date: localDay(best.date), name: best.name, source: best.source, differs: planned > 0 && Math.abs(best.cents - planned * 100) > planned * 100 * 0.2 }
            : null,
        };
      }

      if (type === 'cardBill') {
        const dueIn = (b: { amount: number; dueDate: string } | null) => (b && mk && b.dueDate.slice(0, 7) === mk ? b : null);
        const closed = cards.map((c) => dueIn(c.closedBill)).filter((b) => b !== null);
        const open = cards.map((c) => dueIn(c.openBill)).filter((b) => b !== null);
        // Fatura do mês que já venceu: some das "a pagar", mas continua sendo o custo daquele mês.
        const overdue = closed.length || open.length ? [] : cards.flatMap((c) => (c.pastBills ?? []).filter((p) => p.dueMonth === mk));
        if (overdue.length) closed.push(...overdue.map((p) => ({ amount: p.amount, dueDate: p.dueDate })));
        const picked = closed.length ? closed : open;
        // Sem fatura fechada nem aberta vencendo no mês: o que já está contratado para ela (parcelas).
        const later = cards.flatMap((c) => (c.upcomingBills ?? []).filter((u) => u.dueMonth === mk));
        const total = picked.length ? picked.reduce((s, b) => s + b.amount, 0) : later.reduce((s, u) => s + u.amount, 0);
        // Nada vencendo no mês, mas o cartão já está com a fatura do mês seguinte aberta: a deste
        // mês fechou sem nenhuma compra.
        const closedEmpty =
          !picked.length &&
          !later.length &&
          mk !== null &&
          cards.some((c) => c.openBill) &&
          cards.every((c) => !c.openBill || monthsBetween(mk, c.openBill.dueDate.slice(0, 7)) === 1);
        // Fatura de um ciclo que ainda não começou: parcelas contratadas mais as compras avulsas típicas.
        const ahead = !picked.length && !closedEmpty && mk !== null && Boolean(input.cycle) && mk > input.cycle!.dueMonth;
        const loose = ahead && bankWord ? typicalLoose(bankWord[1]) : null;
        // Parcelas contratadas que já têm linha própria na planilha (um seguro parcelado no cartão,
        // por exemplo) não entram de novo pela fatura: saem daqui, porque a linha delas já conta.
        const inOwnRow = (() => {
          if (!ahead || !bankWord || !mk) return 0;
          const latest = new Map<string, BudgetTx>();
          for (const t of input.transactions) {
            if (!t.dueMonth || !t.installment || !t.installmentTotal || !bankWord[1].test(norm(t.source))) continue;
            const id = `${t.key}|${t.installmentTotal}|${t.cents}`;
            const seen = latest.get(id);
            if (!seen || t.installment > (seen.installment ?? 0)) latest.set(id, t);
          }
          let cents = 0;
          for (const t of latest.values()) {
            const stepsAhead = monthsBetween(t.dueMonth!, mk);
            const stillRunning = stepsAhead > 0 && t.installment! + stepsAhead <= t.installmentTotal!;
            if (stillRunning && scorers.some((score) => score && score(t) > 0)) cents += t.cents;
          }
          return cents / 100;
        })();
        const installments = Math.max(Math.round((later.reduce((s, u) => s + u.amount, 0) - inOwnRow) * 100) / 100, 0);
        const forecast = loose ? { installments, ...loose, total: Math.round((installments + loose.typical) * 100) / 100 } : null;
        return {
          ...base,
          suggested: forecast ? forecast.total : picked.length || later.length ? Math.round(total * 100) / 100 : closedEmpty ? 0 : null,
          billState: closed.length || closedEmpty ? ('closed' as const) : open.length ? ('open' as const) : later.length || forecast ? ('projected' as const) : null,
          dueDate: picked[0]?.dueDate ?? null,
          forecast,
        };
      }

      // Conta fixa: agrupa as cobranças que casam por contraparte (o FIES vem em várias linhas)
      // e fica com o grupo cujo total é o mais próximo do planejado.
      // Cobrança no cartão pertence à coluna do mês em que a fatura dela vence (a assinatura cobrada
      // em setembro é paga na fatura de outubro); pagamento pela conta, ao mês em que saiu.
      // Conta paga adiantada (regra com `ahead`): o que sai a partir daquele dia vale para a coluna seguinte.
      const ahead = FIXED.find((r) => r.row.test(norm(item.name)))?.ahead;
      const accountMonth = (t: BudgetTx) => {
        const month = localMonth(t.date);
        if (!ahead || Number(localDay(t.date).slice(8, 10)) < ahead) return month;
        return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 7);
      };
      const pool = mk
        ? input.transactions.filter(
            (t) => t.date.getTime() <= now.getTime() && (t.dueMonth ? t.dueMonth === mk : (ahead || st !== 'future') && accountMonth(t) === mk),
          )
        : [];
      // Só as cobranças que são desta linha mais do que de qualquer outra conta fixa.
      const mine = scorers[itemIndex]!;
      const hits = pool.filter((t) => {
        const score = mine(t);
        return score > 0 && scorers.every((other, j) => j === itemIndex || !other || other(t) <= score);
      });
      let best = pickCharge(hits, planned);
      // Alguns bancos lançam a cobrança recente com descrição genérica ("Compra à vista sem juros")
      // e só depois trocam pelo nome do estabelecimento. Se a fatura anterior teve uma cobrança
      // desta linha e agora há, no mesmo cartão, uma genérica de mesmo valor, é a mesma assinatura.
      let byAmount = false;
      let knownName: string | null = null;
      if (!best && mk) {
        const previousDue = new Date(Date.UTC(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
        const previous = input.transactions.filter(
          (t) => t.dueMonth === previousDue && mine(t) > 0 && scorers.every((other, j) => j === itemIndex || !other || other(t) <= mine(t)),
        );
        for (const before of previous) {
          const same = pool.find(
            (t) =>
              GENERIC_CHARGE.test(norm(t.description)) &&
              t.source === before.source &&
              Math.abs(t.cents - before.cents) <= Math.max(50, before.cents * 0.02) &&
              scorers.every((other) => !other || other(t) === 0),
          );
          if (same) {
            best = { g: [same], total: same.cents, all: [same] };
            byAmount = true;
            knownName = before.name;
            break;
          }
        }
      }
      // Paga junto com outras linhas numa transferência só (aluguel + condomínio + IPTU): fica com a
      // parte proporcional ao previsto e diz com quem dividiu.
      let joint: { total: number; with: string[] } | null = null;
      const shareOf = (j: NonNullable<ReturnType<typeof jointFor>>) => Math.round((j.tx.cents * planned * 100) / j.planned);
      if (!best && mk && st !== 'future') {
        const j = jointFor(mk, i);
        if (j && j.members.some((h) => h.index === itemIndex)) {
          best = { g: [j.tx], total: shareOf(j), all: [j.tx] };
          joint = { total: reais(j.tx.cents), with: j.members.filter((h) => h.index !== itemIndex).map((h) => h.item.name) };
        }
      }
      let paid = best
        ? {
            amount: reais(best.total),
            date: localDay(best.g.reduce((last, t) => (t.date > last ? t.date : last), best.g[0].date)),
            name: knownName ?? best.g[0].name,
            source: best.g[0].source,
            // Reconhecida só pelo valor (igual ao da fatura anterior): o banco ainda não informou o nome.
            byAmount,
            // Lançado no cartão (entra na fatura) ou já saído da conta.
            onCard: Boolean(best.g[0].dueMonth),
            // No cartão, mas sem linha de fatura desse banco na planilha: não dá para tirar do total.
            billRow: Boolean(best.g[0].dueMonth) && hasBillRow(best.g[0]),
            joint,
            // Conta com pagamento adiantado (FIES, coberto com o adiantamento do dia 20) que saiu antes
            // de o mês da coluna começar: já está quitada com dinheiro dessa mesma coluna.
            ahead: Boolean(ahead) && !best.g[0].dueMonth && best.g.every((t) => localMonth(t.date) < mk!),
            count: best.g.length,
            // Lançamentos com a mesma descrição no mês (o FIES vem em várias linhas): quantos e quanto somam.
            sameCount: best.all.length,
            sameTotal: reais(best.all.reduce((sum, t) => sum + t.cents, 0)),
            // Valor bem diferente do planejado: mostra, mas avisa.
            differs: planned > 0 && Math.abs(best.total - planned * 100) > planned * 100 * 0.2,
            // Como se soube do pagamento: null = reconhecido sozinho; senão, marcado à mão.
            manual: null as null | 'pending' | 'confirmed',
          }
        : null;
      // Marcada como paga à mão. Vale de imediato; na primeira leitura dos bancos feita a partir do
      // dia seguinte, confere: se algum banco mostra um pagamento de valor compatível, fica
      // confirmada; se nenhum mostra, a marcação cai e a conta volta a não paga.
      const mark = mk ? (input.marks ?? []).find((x) => x.itemId === item.id && x.month === mk) : undefined;
      // Já reconhecida sozinha, com valor compatível: a marcação não acrescenta nada.
      if (mark && paid && !paid.differs) staleMarks.push({ itemId: item.id, month: mk! });
      // O banco mostra um pagamento desta conta pelo nome, mas de valor bem diferente do previsto
      // (por isso não aparecia como pago): a marcação do usuário confirma que é esse mesmo.
      else if (mark && paid && !paid.onCard) paid = { ...paid, differs: false, manual: 'confirmed' };
      // Cobrança no cartão de valor bem diferente não serve de prova: a marcação segue o caminho normal.
      else if (mark && paid) paid = null;
      if (mark && !paid) {
        // O que serve de prova é estreito de propósito, porque valor igual sozinho não prova nada:
        //  - só pagamento que saiu de uma conta (Pix, boleto, débito) — compra de cartão nunca;
        //  - feito no dia da marcação ou depois, com até 3 dias de folga para trás (nunca um
        //    lançamento antigo que por acaso tem o mesmo valor);
        //  - que não seja consumo já categorizado, nem de outra conta fixa, nem de categoria controlável.
        const tolerance = Math.max(100, planned * 100 * 0.05);
        const earliest = Date.parse(`${localDay(mark.markedAt)}T00:00:00-03:00`) - 3 * 86_400_000;
        const proof =
          planned > 0
            ? input.transactions
                .filter((t) => !t.dueMonth && t.source.endsWith('conta') && t.date.getTime() >= earliest && t.date.getTime() <= now.getTime())
                .filter((t) => Math.abs(t.cents - planned * 100) <= tolerance && !CONSUMPTION_FAMILIES.has(t.famId))
                .filter((t) => scorers.every((other, j) => j === itemIndex || !other || other(t) === 0) && !limitTests.some((test) => test(t)))
                .sort((x, y) => Math.abs(x.cents - planned * 100) - Math.abs(y.cents - planned * 100))[0]
            : undefined;
        const base0 = { byAmount: false, joint: null, ahead: false, count: 1, sameCount: 1 };
        if (proof) {
          paid = { ...base0, amount: reais(proof.cents), date: localDay(proof.date), name: proof.name, source: proof.source, onCard: false, billRow: false, sameTotal: reais(proof.cents), differs: false, manual: 'confirmed' };
        } else {
          // "Dia seguinte" no horário de Brasília: meia-noite depois do dia em que foi marcada.
          const nextDay = Date.parse(`${localDay(mark.markedAt)}T00:00:00-03:00`) + 86_400_000;
          const checked = Boolean(input.lastSyncAt) && input.lastSyncAt!.getTime() >= nextDay;
          if (checked) staleMarks.push({ itemId: item.id, month: mk! });
          else paid = { ...base0, amount: planned, date: localDay(mark.markedAt), name: 'marcado por você', source: 'manual', onCard: false, billRow: false, sameTotal: planned, differs: false, manual: 'pending' };
        }
      }
      // Ainda não pago neste mês: mostra como foi no mês anterior (data e valor), para saber o que
      // esperar. Vale para o que sai da conta — no cartão a referência é a fatura.
      let previous: { amount: number; date: string; firstDate: string; count: number } | null = null;
      if (!paid && mk && st === 'current') {
        const before = new Date(Date.UTC(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
        const lastHits = input.transactions.filter((t) => {
          if (t.dueMonth || accountMonth(t) !== before) return false;
          const score = mine(t);
          return score > 0 && scorers.every((other, j) => j === itemIndex || !other || other(t) <= score);
        });
        const last = pickCharge(lastHits, planned);
        if (last) {
          // Lançamentos de centavos (o FIES debita R$ 0,01 dias antes) não marcam o começo do período.
          const dates = last.g.filter((t) => t.cents >= last.total * 0.05).map((t) => localDay(t.date)).sort();
          previous = { amount: reais(last.total), date: dates[dates.length - 1], firstDate: dates[0], count: last.g.length };
        } else {
          const j = jointFor(before, i);
          if (j && j.members.some((h) => h.index === itemIndex)) previous = { amount: reais(shareOf(j)), date: localDay(j.tx.date), firstDate: localDay(j.tx.date), count: 1 };
        }
      }
      // Sem pagamento reconhecido: sugere lançamentos de valor parecido para o usuário vincular.
      const candidates =
        paid || planned <= 0 || st === 'future'
          ? []
          : txs
              // Só pagamentos feitos pela conta (Pix, boleto, débito) e que não sejam consumo já
              // categorizado: uma compra de R$ 100 no posto não é candidata a "IPTU".
              .filter((t) => t.source.endsWith('conta') && !CONSUMPTION_FAMILIES.has(t.famId))
              .filter((t) => Math.abs(t.cents - planned * 100) <= planned * 100 * 0.15)
              .sort((a, b) => Math.abs(a.cents - planned * 100) - Math.abs(b.cents - planned * 100))
              .slice(0, 3)
              .map((t) => ({ key: t.key, name: t.name, amount: reais(t.cents), date: localDay(t.date), source: t.source }));
      return { ...base, paid, previous, candidates };
    });

    return { itemId: item.id, name: item.name, type, rule: limit?.label ?? null, category: limit?.category ?? null, months };
  });

  // Dívida de cartão: o que já está contratado nas faturas depois da aberta (parcelas), somando
  // todos os cartões. A fatura aberta e a fechada ficam de fora — são despesa do mês, não dívida.
  const debtByMonth = new Map<string, number>();
  for (const card of input.cards) for (const u of card.upcomingBills ?? []) debtByMonth.set(u.dueMonth, (debtByMonth.get(u.dueMonth) ?? 0) + Math.round(u.amount * 100));
  const cardDebt = {
    total: reais([...debtByMonth.values()].reduce((sum, cents) => sum + cents, 0)),
    bills: [...debtByMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dueMonth, cents]) => ({ dueMonth, amount: reais(cents) })),
  };

  // Pix de cada coluna: no mesmo período dos limites (o ciclo dos cartões), ou no mês de calendário.
  const pixOf = (mk: string | null) => {
    if (!mk) return null;
    const window = windowOf(mk);
    const inWindow = (d: Date) => (window ? localDay(d) >= window.start && localDay(d) <= window.end : localMonth(d) === mk);
    const flows = (input.pix ?? []).filter((t) => t.date.getTime() <= now.getTime() && inWindow(t.date));
    const side = (incoming: boolean) => {
      const list = flows.filter((t) => t.incoming === incoming);
      const byName = new Map<string, number>();
      for (const t of list) byName.set(t.name, (byName.get(t.name) ?? 0) + t.cents);
      return {
        total: reais(list.reduce((sum, t) => sum + t.cents, 0)),
        count: list.length,
        top: [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, cents]) => ({ name, amount: reais(cents) })),
      };
    };
    // Todos os Pix do período, do mais recente para o mais antigo, para a lista completa.
    const items = [...flows].sort((a, b) => b.date.getTime() - a.date.getTime()).map((t) => ({ date: localDay(t.date), name: t.name, amount: reais(t.cents), incoming: t.incoming }));
    return { received: side(true), sent: side(false), items };
  };
  const accounts = input.cash ?? [];
  const cash = { total: reais(Math.round(accounts.reduce((sum, a) => sum + a.balance * 100, 0))), accounts };

  return {
    generatedAt: now.toISOString(),
    currentMonth,
    staleMarks,
    cardDebt,
    cash,
    months: input.months.map((label, i) => ({ label, month: monthKeys[i], state: state(monthKeys[i]), cycle: windowOf(monthKeys[i]), pix: pixOf(monthKeys[i]) })),
    rows,
  };
}

export type Budget = ReturnType<typeof buildBudget>;
