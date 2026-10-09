import { useState } from 'react';
import { fmt } from '../calc';
import { Budget, BudgetMonth } from '../types';
import { bankOf } from './CardsSection';
import '../budget.css';

const dayLabel = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

// O rótulo acompanha a cor: o estado nunca depende só dela.
const LIMIT_STATUS: Record<string, { label: string; level: string }> = {
  ok: { label: 'dentro do limite', level: 'ok' },
  near: { label: 'perto do limite', level: 'warn' },
  over: { label: 'limite estourado', level: 'high' },
  unset: { label: 'sem limite definido em nenhum mês', level: 'none' },
  none: { label: 'este período ainda não começou', level: 'none' },
};

export default function BudgetSection({
  data,
  onLink,
  onMove,
}: {
  data: Budget | null;
  onLink: (key: string, rowName: string) => void;
  // Muda a categoria de um estabelecimento: (chave, id da categoria, nome, destino por extenso).
  onMove?: (key: string, category: string, name: string, target: string) => void;
}) {
  const [monthIndex, setMonthIndex] = useState<number | null>(null);
  // Limite com a lista de lugares aberta.
  const [openLimit, setOpenLimit] = useState<string | null>(null);
  // Detalhe aberto no bloco de dinheiro: bancos ou a lista de Pix.
  const [openCash, setOpenCash] = useState<'' | 'banks' | 'pix'>('');
  // "É este": grava que aquela contraparte é o pagamento desta linha; vale para os próximos meses.
  const link = onLink;

  if (!data || data.months.length === 0) return null;

  // Coluna padrão: a do ciclo de cartão em andamento (o que se gasta agora vence nela); sem ciclo
  // conhecido, a do mês-calendário.
  const cycleNow = data.months.findIndex((m) => m.cycle?.state === 'current');
  const current = cycleNow >= 0 ? cycleNow : data.months.findIndex((m) => m.state === 'current');
  const index = monthIndex ?? (current >= 0 ? current : 0);
  const month = data.months[index];
  if (!month) return null;
  const at = (months: BudgetMonth[]) => months[index];

  const limits = data.rows.filter((r) => r.type === 'limit');
  const fixed = data.rows.filter((r) => r.type === 'fixed' && (at(r.months).planned > 0 || at(r.months).paid));
  const billsStarted = month.state === 'current' || month.state === 'past';
  const paidCount = fixed.filter((r) => at(r.months).paid).length;

  return (
    <section className="bx">
      <h2>Planejado × realizado</h2>
      <div className="bx-months" role="group" aria-label="Mês">
        {data.months.map((m, i) => (
          <button key={`${m.label}-${i}`} className={i === index ? 'active' : ''} onClick={() => setMonthIndex(i)} disabled={m.month === null}>
            {m.label}
            {(m.cycle ? m.cycle.state === 'current' : m.state === 'current') && <small>gastos atuais</small>}
            {m.cycle && m.cycle.state !== 'current' && m.state === 'current' && <small>contas deste mês</small>}
          </button>
        ))}
      </div>

      {month.month === null ? (
        <p className="bx-empty">Não reconheci este mês pelo nome da coluna.</p>
      ) : (
        <div className="bx-grid">
          {limits.length > 0 && (
            <article className="bx-panel">
              <h3>
                Limites{' '}
                {month.cycle && (
                  <small title={`O que vence em ${month.label}: cada cartão pelo próprio fechamento; gastos pela conta de ${dayLabel(month.cycle.start)} a ${dayLabel(month.cycle.end)}.`}>
                    ciclo de {dayLabel(month.cycle.start)} a {dayLabel(month.cycle.end)}
                  </small>
                )}
              </h3>
              <ul className="bx-limits">
                {limits.map((r) => {
                  const m = at(r.months);
                  const used = m.used ?? 0;
                  // "Perto" com menos de 80% usado vem do ritmo de gasto, não do valor já atingido.
                  const s = m.status === 'near' && used < 0.8 ? { label: 'ritmo acima do limite', level: 'warn' } : LIMIT_STATUS[m.status ?? 'none'];
                  const limit = m.limit ?? 0;
                  const spent = m.actual ?? 0;
                  const places = m.places ?? [];
                  const isOpen = openLimit === r.itemId;
                  // Para onde um lugar pode ir: os outros limites e "fora dos limites".
                  const targets = [
                    ...limits.filter((other) => other.itemId !== r.itemId && other.category).map((other) => ({ category: other.category!, label: other.name })),
                    { category: 'compras', label: 'fora dos limites' },
                  ];
                  const pace =
                    m.state === 'current' && m.projected !== null && m.projected !== undefined && spent > 0
                      ? `No ritmo de hoje ${month.cycle ? 'o ciclo' : 'o mês'} fecha em ${fmt(m.projected)}${limit > 0 && m.projected > limit ? `, ${fmt(m.projected - limit)} acima do limite` : ''}.`
                      : null;
                  const overPace = limit > 0 && m.projected !== null && m.projected !== undefined && m.projected > limit && m.status !== 'over';
                  return (
                    <li key={r.itemId}>
                      <div className="bx-row">
                        <span title={`Conta: ${r.rule?.toLowerCase() ?? ''}${m.limitFrom ? `. ${month.label} está sem valor na planilha; usando o limite de ${m.limitFrom}.` : ''}`}>{r.name}</span>
                        <b>
                          {fmt(spent)}
                          {limit > 0 && <small> de {fmt(limit)}</small>}
                        </b>
                      </div>
                      <div className={`bx-meter ${s.level}`}>
                        <div className="bx-track" role="img" aria-label={limit > 0 ? `${pct(used)} do limite usado` : 'sem limite'}>
                          <div className="bx-fill" style={{ width: `${Math.min(used * 100, 100)}%` }} />
                        </div>
                      </div>
                      <div className="bx-line">
                        <span className={`tag ${s.level === 'none' ? '' : s.level}`} title={pace ?? undefined}>
                          {limit > 0 ? (m.status === 'over' ? `passou ${fmt(spent - limit)}` : `${pct(used)} · restam ${fmt(Math.max(limit - spent, 0))}`) : s.label}
                        </span>
                        {overPace && (
                          <span className="tag warn" title={pace ?? undefined}>
                            ritmo: fecha em {fmt(m.projected!)}
                          </span>
                        )}
                        {places.length > 0 && (
                          <button type="button" className="bx-toggle" aria-expanded={isOpen} onClick={() => setOpenLimit(isOpen ? null : r.itemId)}>
                            {isOpen ? 'ocultar' : `onde gastei (${places.length})`}
                          </button>
                        )}
                      </div>
                      {isOpen && (
                        <ul className="bx-places">
                          {places.map((p) => (
                            <li key={p.key}>
                              <span title={p.name}>
                                {p.name}
                                {p.count > 1 && <small> · {p.count} compras</small>}
                              </span>
                              <b>{fmt(p.amount)}</b>
                              {onMove && (
                                <select
                                  aria-label={`Mudar a categoria de ${p.name}`}
                                  value=""
                                  onChange={(e) => {
                                    const target = targets.find((t) => t.category === e.target.value);
                                    if (target) onMove(p.key, target.category, p.name, target.label);
                                  }}
                                >
                                  <option value="">não é daqui…</option>
                                  {targets.map((t) => (
                                    <option key={t.category} value={t.category}>
                                      mover para {t.label}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
              {(data.cash || month.pix) && (
                <div className="bx-cash">
                  {data.cash && data.cash.accounts.length > 0 && (
                    <>
                      <button type="button" className="bx-cash-line" aria-expanded={openCash === 'banks'} onClick={() => setOpenCash(openCash === 'banks' ? '' : 'banks')}>
                        <small>Dinheiro em conta agora</small>
                        <b className={data.cash.total < 0 ? 'neg' : undefined}>{fmt(data.cash.total)}</b>
                        <em>{openCash === 'banks' ? 'ocultar' : `por banco (${data.cash.accounts.length})`}</em>
                      </button>
                      {openCash === 'banks' && (
                        <ul className="bx-banks">
                          {data.cash.accounts.map((a, i) => {
                            const bank = bankOf(a.bank);
                            return (
                              <li key={`${a.bank}-${i}`} title={a.name}>
                                <span className="cx-badge small" style={{ background: bank.bg, color: bank.fg }} aria-hidden="true">
                                  {bank.mono}
                                </span>
                                <span>{bank.name}</span>
                                <b className={a.balance < 0 ? 'neg' : undefined}>{fmt(a.balance)}</b>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </>
                  )}
                  {month.pix && (
                    <>
                      <button
                        type="button"
                        className="bx-cash-line pix"
                        aria-expanded={openCash === 'pix'}
                        onClick={() => setOpenCash(openCash === 'pix' ? '' : 'pix')}
                        title={`${month.cycle ? `De ${dayLabel(month.cycle.start)} a ${dayLabel(month.cycle.end)}` : `Em ${month.label}`}, sem contar transferências entre as suas próprias contas.`}
                      >
                        <small>Pix no período</small>
                        <span className="pos">↓ {fmt(month.pix.received.total)}</span>
                        <span className="neg">↑ {fmt(month.pix.sent.total)}</span>
                        <em>{openCash === 'pix' ? 'ocultar' : `ver os ${month.pix.received.count + month.pix.sent.count} Pix`}</em>
                      </button>
                      {openCash === 'pix' && (
                        <ul className="bx-pixlist">
                          {(month.pix.items ?? []).length === 0 && <li className="empty">Nenhum Pix no período.</li>}
                          {(month.pix.items ?? []).map((t, i) => (
                            <li key={`${t.date}-${t.name}-${i}`}>
                              <small>{dayLabel(t.date)}</small>
                              <span title={t.name}>{t.name}</span>
                              <b className={t.incoming ? 'pos' : 'neg'}>
                                {t.incoming ? '↓' : '↑'} {fmt(t.amount)}
                              </b>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              )}
            </article>
          )}

          {fixed.length > 0 && (
            <article className="bx-panel">
              <h3>
                Contas de {month.label}{' '}
                <small>
                  {paidCount} de {fixed.length} identificadas{billsStarted ? '' : ' · o mês ainda não começou: só aparece o que já está no cartão'}
                </small>
              </h3>
              <ul className="bx-fixed">
                {fixed.map((r) => {
                  const m = at(r.months);
                  const detail = m.paid
                      ? `${m.paid.onCard ? 'lançado no cartão' : m.paid.manual === 'pending' ? 'marcado por você' : 'pago'} em ${dayLabel(m.paid.date)}${m.paid.manual === 'pending' ? '' : ` · ${m.paid.name} · ${m.paid.source}`}${m.paid.count > 1 ? ` · ${m.paid.count} lançamentos` : ''}`
                      : m.previous
                        ? `mês passado foi pago em ${m.previous.firstDate && m.previous.firstDate !== m.previous.date ? `${dayLabel(m.previous.firstDate)} a ` : ''}${dayLabel(m.previous.date)}`
                        : billsStarted
                          ? 'pagamento ainda não identificado'
                          : '';
                  return (
                    <li key={r.itemId} className={m.paid ? 'paid' : 'pending'}>
                      {/* Uma linha por conta, em colunas: situação, nome (com o detalhe abaixo), valor e etiqueta. */}
                      <div className="bx-bill" title={detail || undefined}>
                        <span className="bx-check" aria-hidden="true">
                          {m.paid ? '✓' : ''}
                        </span>
                        <span className="bx-bill-name">
                          {r.name}
                          {detail && <small>{detail}</small>}
                        </span>
                        <b>
                          {fmt(m.paid ? m.paid.amount : m.planned)}
                          {m.paid && Math.abs(m.paid.amount - m.planned) >= 0.01 && <small>de {fmt(m.planned)}</small>}
                        </b>
                        <span className={`tag ${m.paid ? (m.paid.manual === 'pending' ? 'info' : 'ok') : ''}`}>
                          {m.paid ? (m.paid.manual === 'pending' ? 'a confirmar' : m.paid.onCard ? 'no cartão' : 'pago') : billsStarted ? 'a pagar' : 'previsto'}
                        </span>
                      </div>
                      <div className="bx-bill-extra">
                        {m.paid?.byAmount && <p className="bx-note">Reconhecida pelo valor, igual ao da fatura anterior: o banco ainda não informou o nome do estabelecimento.</p>}
                        {m.paid && (m.paid.sameCount ?? 1) > m.paid.count && (
                          <p className="bx-note">
                            Há {m.paid.sameCount} lançamentos com esta mesma descrição no mês, somando {fmt(m.paid.sameTotal ?? 0)}; aqui está só o de valor mais
                            próximo do planejado.
                          </p>
                        )}
                        {m.paid?.differs && <p className="bx-note">O valor encontrado difere mais de 20% do planejado; confira se é esta cobrança.</p>}
                        {!m.paid && m.candidates && m.candidates.length > 0 && (
                          <div className="bx-candidates">
                            <small>Valor parecido neste mês:</small>
                            {m.candidates.map((c) => (
                              <button type="button" key={`${c.key}-${c.date}`} onClick={() => link(c.key, r.name)}>
                                {c.name} · {fmt(c.amount)} · {dayLabel(c.date)} · {c.source} — <u>é este</u>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </article>
          )}
        </div>
      )}
    </section>
  );
}
