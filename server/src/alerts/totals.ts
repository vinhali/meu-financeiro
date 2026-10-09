// Totais de cada mês como a planilha mostra: o que já está nas faturas não conta de novo.
// É a mesma regra do cliente (client/src/calc.ts e Dashboard); o teste totals.test.ts compara as
// duas implementações para que não se afastem.

export interface TotalsItem {
  id: string;
  name: string;
  section: string;
  controllable: boolean;
  values: number[];
}

// Só os campos da resposta do orçamento que as regras de total usam.
export interface TotalsMonth {
  state?: string;
  actual?: number;
  offBill?: number;
  accountInMonth?: number;
  suggested?: number | null;
  billState?: string | null;
  paid?: { onCard: boolean; billRow?: boolean; byAmount?: boolean; manual?: string | null; ahead?: boolean; differs: boolean } | null;
}
export interface TotalsRow {
  itemId: string;
  type: string;
  months: TotalsMonth[];
}

const isAdvanceIncome = (item: TotalsItem) => item.section === 'entrada' && /adiantamento|(^|[^a-z])vale([^a-z]|$)/i.test(item.name);

export function monthTotals(items: TotalsItem[], rows: TotalsRow[], monthCount: number): Array<{ entradas: number; saidas: number; subtotal: number }> {
  const rowOf = (id: string) => rows.find((r) => r.itemId === id);
  const advance = items.find(isAdvanceIncome);
  const paidAhead = (item: TotalsItem, m: number) => {
    const row = rowOf(item.id);
    const paid = row?.type === 'fixed' ? row.months[m]?.paid : null;
    return Boolean(advance && paid && paid.ahead && !paid.manual && !paid.differs);
  };
  const cents = (v: number) => Math.round(v * 100) / 100;

  return Array.from({ length: monthCount }, (_, m) => {
    // Contas pagas adiantado com o adiantamento saem das saídas e do próprio adiantamento.
    const ahead = items.reduce((sum, it) => sum + (it.section !== 'entrada' && paidAhead(it, m) ? it.values[m] || 0 : 0), 0);
    let entradas = 0;
    let saidas = 0;
    for (const item of items) {
      const value = item.values[m] || 0;
      if (item.section === 'entrada') {
        entradas += item === advance ? Math.max(value - ahead, 0) : value;
        continue;
      }
      if (paidAhead(item, m)) continue;
      const row = rowOf(item.id);
      const month = row?.months[m];
      if (item.controllable && row?.type === 'limit') {
        if (!month || month.actual === undefined) saidas += value;
        else {
          const outside = (month.offBill ?? 0) + (month.accountInMonth ?? 0);
          saidas += month.state === 'current' ? Math.max(value - month.actual, 0) + outside : month.state === 'past' ? outside : value;
        }
      } else if (row?.type === 'fixed') {
        const paid = month?.paid;
        const covered = Boolean(paid && paid.onCard && paid.billRow !== false && !paid.byAmount && !paid.manual && !paid.differs);
        saidas += covered ? 0 : value;
      } else if (row?.type === 'cardBill') {
        saidas += month && month.suggested != null && (month.billState === 'closed' || month.billState === 'open') ? month.suggested : value;
      } else saidas += value;
    }
    return { entradas: cents(entradas), saidas: cents(saidas), subtotal: cents(entradas - saidas) };
  });
}
