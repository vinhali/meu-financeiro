import { debtRemaining, fmt, isCardDebt, parseInstallment, totalDebtRemaining } from '../calc';
import { CardDebt, Debt, DebtSeverity } from '../types';

interface Props {
  debts: Debt[];
  onChange: (debts: Debt[]) => void;
  onAdd: () => void;
  onDelete: (debtId: string) => void;
  onSave: () => void;
  // Parcelas de cartão nas faturas futuras (sem a aberta), pelos bancos.
  cardDebt?: CardDebt | null;
}

const SEVERITIES: DebtSeverity[] = ['sev1', 'sev2', 'sev3', 'sev4'];

export default function DebtsSection({ debts, onChange, onAdd, onDelete, onSave, cardDebt }: Props) {
  const monthLabel = (key: string) => `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(key.slice(5, 7)) - 1]}/${key.slice(2, 4)}`;
  function update(id: string, patch: Partial<Debt>) {
    onChange(debts.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  const sortedDebts = [...debts].sort((a, b) => a.severity.localeCompare(b.severity));
  const debtTotals = totalDebtRemaining(debts, cardDebt?.total);
  const dueSoon = debts
    .filter((d) => d.status !== 'quitada' && d.dueDay)
    .map((d) => ({ ...d, days: ((d.dueDay! - new Date().getDate()) + 31) % 31 }))
    .sort((a, b) => a.days - b.days)[0];

  return (
    <section>
      <h2>Todas as dívidas</h2>
      <button className="reset" onClick={onAdd} style={{ marginTop: 12 }}>
        Adicionar dívida
      </button>
      <button className="primary" onClick={onSave} style={{ marginTop: 12 }}>
        Salvar cenário atual
      </button>
      <div className="debt-summary">
        <div>
          <span className="debt-summary-label">Saldo devedor calculado</span>
          <strong>{fmt(debtTotals.total)}</strong>
        </div>
        <div className="debt-summary-meta">
          {debtTotals.calculated} dívida(s) calculada(s)
          {debtTotals.pending > 0 ? ` · ${debtTotals.pending} sem prazo/parcelas informado` : ''}
        </div>
        <p>Valor informado − (parcelas pagas × valor da parcela). Atualiza automaticamente no dia em que você registrar um novo pagamento.</p>
        {dueSoon && <p className="debt-alert">Próximo vencimento: <b>{dueSoon.name}</b>, dia {dueSoon.dueDay} ({dueSoon.days === 0 ? 'hoje' : `em ${dueSoon.days} dia(s)`}).</p>}
      </div>
      <div className="sev-grid">
        {sortedDebts.map((debt) => (
          <div className={`debt ${debt.severity}`} key={debt.id}>
            <div className="debt-head">
              <button className="debt-del" title="Remover dívida" onClick={() => onDelete(debt.id)}>
                Remover
              </button>
            </div>

            <div className="debt-edit">
              <div className="span2">
                <label>Título</label>
                <input value={debt.name} onChange={(e) => update(debt.id, { name: e.target.value })} />
              </div>
              <div>
                <label>Severidade</label>
                <select value={debt.severity} onChange={(e) => update(debt.id, { severity: e.target.value as DebtSeverity })}>
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {s.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>Valor</label>
                {cardDebt && isCardDebt(debt) ? (
                  <input value={fmt(cardDebt.total)} readOnly disabled title="Calculado sozinho pelas faturas futuras dos cartões" />
                ) : (
                  <input value={debt.balance} onChange={(e) => update(debt.id, { balance: e.target.value })} />
                )}
              </div>
              <div>
                <label>Juros</label>
                <input value={debt.rate} onChange={(e) => update(debt.id, { rate: e.target.value })} />
              </div>
              <div>
                <label>Parcelas</label>
                {cardDebt && isCardDebt(debt) ? (
                  <input value={`${cardDebt.bills.length} fatura(s) futura(s)`} readOnly disabled />
                ) : (
                  <input value={debt.installment} onChange={(e) => update(debt.id, { installment: e.target.value })} />
                )}
              </div>
              <div>
                <label>Parcelas pagas</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={debt.paidInstallments}
                  onChange={(e) => update(debt.id, { paidInstallments: Math.max(0, Number(e.target.value) || 0) })}
                />
              </div>
              <div>
                <label>Vencimento (dia)</label>
                <input type="number" min={1} max={31} placeholder="5" value={debt.dueDay ?? ''} onChange={(e) => update(debt.id, { dueDay: e.target.value ? Math.min(31, Math.max(1, Number(e.target.value))) : null })} />
              </div>
            </div>
            {(() => {
              if (cardDebt && isCardDebt(debt)) {
                const first = cardDebt.bills[0];
                const last = cardDebt.bills[cardDebt.bills.length - 1];
                return (
                  <div className="debt-calculated">
                    <span>Nas faturas futuras</span>
                    <b>{fmt(cardDebt.total)}</b>
                    <small>
                      Automático, pelos bancos: parcelas já contratadas
                      {first ? ` nas faturas de ${monthLabel(first.dueMonth)}${last && last !== first ? ` a ${monthLabel(last.dueMonth)}` : ''}` : ''}, somando todos os cartões. Não inclui a fatura
                      aberta nem a fechada, que são despesa do mês.
                    </small>
                  </div>
                );
              }
              const remaining = debtRemaining(debt);
              const installment = parseInstallment(debt.installment);
              return (
                <div className="debt-calculated">
                  <span>Saldo após pagamentos</span>
                  <b>{remaining === null ? 'informe parcelas no formato 60x R$ 1.000' : fmt(remaining)}</b>
                  {installment && <small>{debt.paidInstallments}/{installment.total} parcelas · {fmt(debt.paidInstallments * installment.amount)} abatidos</small>}
                </div>
              );
            })()}
          </div>
        ))}
      </div>
    </section>
  );
}
