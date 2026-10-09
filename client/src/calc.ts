import { Debt, LineItem, Bridge } from './types';

export const SALDO_INICIAL = 0;

export const fmt = (v: number): string =>
  (v < 0 ? '-R$ ' : 'R$ ') + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface InstallmentInfo {
  total: number;
  amount: number;
}

export function parseInstallment(s: string): InstallmentInfo | null {
  const match = String(s ?? '').match(/(\d+)\s*x\s*(?:R\$\s*)?([\d.]+(?:,\d+)?)/i);
  if (!match) return null;
  const total = Number(match[1]);
  const amount = parseValue(match[2]);
  return Number.isFinite(total) && total > 0 && Number.isFinite(amount) && amount > 0 ? { total, amount } : null;
}

// Dívida que representa os cartões de crédito: o saldo vem das faturas futuras, não do que foi digitado.
export const isCardDebt = (debt: Pick<Debt, 'name'>) => /cart(ão|ao|ões|oes)\s+de\s+cr[eé]dito/i.test(debt.name);

export function debtRemaining(debt: Debt, cardDebt?: number | null): number | null {
  if (cardDebt !== null && cardDebt !== undefined && isCardDebt(debt)) return cardDebt;
  const base = parseValue(debt.balance);
  const installment = parseInstallment(debt.installment);
  if (!Number.isFinite(base) || base <= 0 || !installment) return null;
  return Math.max(0, base - Math.max(0, debt.paidInstallments || 0) * installment.amount);
}

export function totalDebtRemaining(debts: Debt[], cardDebt?: number | null): { total: number; calculated: number; pending: number } {
  return debts.reduce(
    (result, debt) => {
      const remaining = debtRemaining(debt, cardDebt);
      if (remaining === null) result.pending += 1;
      else {
        result.total += remaining;
        result.calculated += 1;
      }
      return result;
    },
    { total: 0, calculated: 0, pending: 0 }
  );
}

// Parses pt-BR formatted currency/number strings ("1.234,56", "R$ 1.234,56", "-50") into a number.
export function parseValue(s: string): number {
  if (typeof s !== 'string') return +s || 0;
  const cleaned = s.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

export interface MonthlyCalc {
  entradasTotais: number[];
  saidasTotais: number[];
  subtotal: number[];
  acumulado: number[];
  minAcumulado: number;
  minAcumuladoMes: string;
  deficitTotal: number;
  rendaExtraNecessaria: number;
  negativeMonths: string[];
}

export function calculateMonthly(items: LineItem[], months: string[]): MonthlyCalc {
  const n = months.length;
  const entradasTotais = new Array(n).fill(0);
  const saidasTotais = new Array(n).fill(0);

  for (const item of items) {
    for (let m = 0; m < n; m++) {
      const v = item.values[m] || 0;
      if (item.section === 'entrada') entradasTotais[m] += v;
      else saidasTotais[m] += v;
    }
  }

  const subtotal = new Array(n).fill(0);
  const acumulado = new Array(n).fill(0);
  let acum = SALDO_INICIAL;
  let minAcumulado = Infinity;
  let minAcumuladoMes: string = months[0] ?? '';
  const negativeMonths: string[] = [];

  for (let m = 0; m < n; m++) {
    const sub = entradasTotais[m] - saidasTotais[m];
    acum += sub;
    subtotal[m] = sub;
    acumulado[m] = acum;
    if (acum < minAcumulado) {
      minAcumulado = acum;
      minAcumuladoMes = months[m];
    }
    if (acum < 0) negativeMonths.push(months[m]);
  }

  const deficitTotal = subtotal.reduce((total, value) => total + (value < 0 ? -value : 0), 0);

  // Saldo extra total necessário para que o fechamento da última coluna não fique negativo.
  // O valor é exibido como total do horizonte, e não como uma média mensal.
  const finalAcumulado = acumulado[n - 1] ?? 0;
  const rendaExtraNecessaria = Math.max(0, -finalAcumulado);

  return {
    entradasTotais,
    saidasTotais,
    subtotal,
    acumulado,
    minAcumulado,
    minAcumuladoMes,
    deficitTotal,
    rendaExtraNecessaria,
    negativeMonths,
  };
}

export type PlanStatus = 'seguro' | 'atencao' | 'critico';

export function getPlanStatus(monthly: MonthlyCalc): PlanStatus {
  if (monthly.minAcumulado >= 0) return 'seguro';
  if (monthly.minAcumulado >= -3000) return 'atencao';
  return 'critico';
}

export interface BridgeMonthCalc {
  label: string;
  entradas: number;
  saidas: number;
  saldo: number;
}

export interface BridgeCalc {
  months: BridgeMonthCalc[];
  caixaUltimoMes: number;
  podePagarAteUltimo: boolean;
  negativeMonths: string[];
  saldoAntesPlr: number;
  saldoDepoisPlr: number;
}

// Uma entrada é considerada "recorrente" (salário/auxílios mensais) quando tem
// valor não-zero em todos os meses do plano — diferente de entradas pontuais
// como Férias, Crédito Pessoal, 13º, Renda extra ou Curso.
function isRecurringEntrada(item: LineItem): boolean {
  return item.section === 'entrada' && item.values.every((v) => (v || 0) !== 0);
}

// "Ponte até PLR": cada mês da ponte repete as despesas recorrentes do último
// mês da planilha (exceto as marcadas com excludeFromBridge) e as receitas
// recorrentes do último mês (com dissídio aplicado às marcadas com
// applyDissidio). O último mês da ponte soma a PLR editável.
export function calculateBridge(items: LineItem[], bridge: Bridge, acumuladoUltimoMes: number, bridgeMonths: string[]): BridgeCalc {
  let saidasRec = 0;
  let entradasRec = 0;
  for (const item of items) {
    const last = item.values[item.values.length - 1] || 0;
    if (item.section === 'saida') {
      if (item.excludeFromBridge) continue;
      saidasRec += last;
    } else if (isRecurringEntrada(item)) {
      entradasRec += item.applyDissidio ? last * (1 + bridge.dissidioPercent / 100) : last;
    }
  }

  const months: BridgeMonthCalc[] = [];
  const negativeMonths: string[] = [];
  let acum = acumuladoUltimoMes;
  for (let i = 0; i < bridgeMonths.length; i++) {
    acum += entradasRec - saidasRec;
    const isLast = i === bridgeMonths.length - 1;
    const saldo = isLast ? acum + bridge.plr : acum;
    if (saldo < 0 && !isLast) negativeMonths.push(bridgeMonths[i]);
    months.push({ label: bridgeMonths[i], entradas: entradasRec, saidas: saidasRec, saldo });
  }

  const last = months[months.length - 1];
  const saldoDepoisPlr = last ? last.saldo : acumuladoUltimoMes;
  const saldoAntesPlr = last ? last.saldo - bridge.plr : acumuladoUltimoMes;

  return {
    months,
    caixaUltimoMes: acumuladoUltimoMes,
    podePagarAteUltimo: negativeMonths.length === 0,
    negativeMonths,
    saldoAntesPlr,
    saldoDepoisPlr,
  };
}

// Quanto uma linha de gasto controlável soma no total do mês:
//  - o que ainda falta gastar do limite (ciclo em andamento) ou o limite inteiro (ciclo futuro);
//  - nada do que já foi para o cartão, porque isso está dentro das linhas de fatura...
//  - ...a não ser o gasto em cartão sem linha de fatura (`offBill`), que não está em lugar nenhum;
//  - mais o que saiu direto da conta no mês da coluna (`accountInMonth`): despesa do mês, fora de fatura.
export function controllableInTotal(limit: number, m: { state?: string; actual?: number; offBill?: number; accountInMonth?: number } | undefined): number {
  if (!m || m.actual === undefined) return limit;
  const outside = (m.offBill ?? 0) + (m.accountInMonth ?? 0);
  if (m.state === 'current') return Math.max(limit - m.actual, 0) + outside;
  if (m.state === 'past') return outside;
  return limit;
}

// Conta fixa já lançada no cartão: o valor está dentro da fatura daquele mês, então a linha
// deixa de somar no total (o valor digitado é mantido, para o caso de o reconhecimento errar).
// Só vale se a planilha tem a linha de fatura desse cartão; sem ela, o valor continua somando.
// Tirar um valor do total é a decisão mais arriscada da planilha (esconder uma despesa que existe),
// então só acontece com prova pelo nome do estabelecimento: reconhecimento só pelo valor e
// marcação feita à mão nunca tiram nada do total.
export function coveredByCard(paid: { onCard: boolean; billRow?: boolean; byAmount?: boolean; manual?: string | null; differs: boolean } | null | undefined): boolean {
  return Boolean(paid && paid.onCard && paid.billRow !== false && !paid.byAmount && !paid.manual && !paid.differs);
}

// Linha de fatura no total: fatura fechada ou aberta vale pelo valor do banco, que muda a cada
// compra; o valor digitado só vale para meses futuros (parcelas e previsão).
// Em simulação, a fatura futura entra pela previsão (parcelas + compras típicas) em vez do digitado.
export function billInTotal(
  value: number,
  m: { suggested?: number | null; billState?: string | null; forecast?: { total: number } | null } | undefined,
  simulate = false,
): number {
  if (simulate && m?.billState === 'projected' && m.forecast) return m.forecast.total;
  return m && m.suggested != null && (m.billState === 'closed' || m.billState === 'open') ? m.suggested : value;
}

// Conta fixa que não tem mais nada a pagar no mês: já está na fatura do cartão, ou saiu da conta
// antes de o mês começar (o FIES, coberto com o vale do dia 20).
export function paidAhead(paid: { ahead?: boolean; manual?: string | null; differs: boolean } | null | undefined): boolean {
  return Boolean(paid && paid.ahead && !paid.manual && !paid.differs);
}

// Entrada que banca as contas pagas adiantado: o adiantamento (vale) do dia 20.
export const isAdvanceIncome = (item: { section: string; name: string }) => item.section === 'entrada' && /adiantamento|(^|[^a-z])vale([^a-z]|$)/i.test(item.name);

// Conta paga adiantado com o adiantamento: o dinheiro entrou e saiu antes de o mês começar. Para a
// conta fechar, sai dos dois lados — a conta deixa de somar nas saídas e o mesmo valor é abatido
// do adiantamento nas entradas (até zerá-lo; se a linha já está em zero, ele já tinha sido tirado).
// Sem linha de adiantamento, a conta continua somando normalmente.
export function netAdvance<T extends { section: string; name: string; values: number[] }>(items: T[], aheadOf: (item: T, month: number) => boolean): T[] {
  const advance = items.find(isAdvanceIncome);
  if (!advance) return items;
  const spent = advance.values.map((_, m) => items.reduce((sum, it) => sum + (it.section !== 'entrada' && aheadOf(it, m) ? it.values[m] || 0 : 0), 0));
  return items.map((it) => {
    if (it === advance) return { ...it, values: it.values.map((v, m) => Math.max((v || 0) - spent[m], 0)) };
    if (it.section === 'entrada') return it;
    return { ...it, values: it.values.map((v, m) => (aheadOf(it, m) ? 0 : v)) };
  });
}

export function settled(paid: { onCard: boolean; billRow?: boolean; byAmount?: boolean; manual?: string | null; ahead?: boolean; differs: boolean } | null | undefined): boolean {
  return coveredByCard(paid) || paidAhead(paid);
}
