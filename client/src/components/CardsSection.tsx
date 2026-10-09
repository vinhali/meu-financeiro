import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { fmt } from '../calc';
import { CardsOverview, ChartItem } from '../types';
import Loader from './Loader';
import '../cards.css';

const PERIODS = [1, 3, 6, 12] as const;
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const WEEKDAYS_LONG = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const WEEKDAY_ON = ['aos domingos', 'às segundas', 'às terças', 'às quartas', 'às quintas', 'às sextas', 'aos sábados'];

// Vencimento e fechamento são datas puras (AAAA-MM-DD): sem conversão de fuso.
const dayLabel = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;
const dateLabel = (key: string) => `${dayLabel(key)}/${key.slice(2, 4)}`;
const monthLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]}/${key.slice(2, 4)}`;
const todayKey = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const day = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
const pct = (v: number) => `${Math.round(v * 100)}%`;
const compact = (v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k` : String(Math.round(v)));
const money = (v: number, currency: string) => v.toLocaleString('pt-BR', { style: 'currency', currency });

// Identidade visual por instituição: monograma na cor da marca (não é o logotipo oficial).
const BANKS: Array<{ match: RegExp; name: string; mono: string; bg: string; fg: string }> = [
  { match: /NU PAGAMENTOS|NUBANK/i, name: 'Nubank', mono: 'Nu', bg: '#820AD1', fg: '#ffffff' },
  { match: /C6/i, name: 'C6 Bank', mono: 'C6', bg: '#242424', fg: '#f4f4f4' },
  { match: /BRADESCO/i, name: 'Bradesco', mono: 'B', bg: '#CC092F', fg: '#ffffff' },
  { match: /BANCO DO BRASIL/i, name: 'Banco do Brasil', mono: 'BB', bg: '#FCEB00', fg: '#0038A8' },
  { match: /PIC\s*PAY/i, name: 'PicPay', mono: 'P', bg: '#11C76F', fg: '#062e1b' },
  { match: /ITA[UÚ]/i, name: 'Itaú', mono: 'It', bg: '#EC7000', fg: '#002D72' },
  { match: /SANTANDER/i, name: 'Santander', mono: 'S', bg: '#EC0000', fg: '#ffffff' },
  { match: /INTER/i, name: 'Inter', mono: 'In', bg: '#FF7A00', fg: '#ffffff' },
  { match: /CAIXA/i, name: 'Caixa', mono: 'Cx', bg: '#005CA9', fg: '#ffffff' },
];
export function bankOf(raw: string) {
  const known = BANKS.find((b) => b.match.test(raw));
  if (known) return known;
  const name = raw.trim() || 'Cartão';
  return { name, mono: name.slice(0, 2), bg: '#2a3944', fg: '#e9eff2' };
}

// "MASTER BLACK PRIME" -> "Master Black Prime"; nomes genéricos do banco viram "Cartão <banco>".
function cardTitle(name: string, bank: string) {
  if (/^bandeirado$/i.test(name.trim())) return `Cartão ${bank}`;
  return name
    .replace(/[-_]+/g, ' ')
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

// Uso do limite: o rótulo acompanha a cor, que nunca carrega a informação sozinha.
function usage(u: number | null): { level: string; label: string } {
  if (u === null) return { level: 'none', label: 'sem limite informado' };
  if (u < 0.3) return { level: 'ok', label: 'uso baixo' };
  if (u < 0.7) return { level: 'warn', label: 'uso moderado' };
  return { level: 'high', label: 'uso alto' };
}

interface Column {
  key: string;
  label: string;
  value: number;
  hint?: string;
}

// `pendingAfter`: colunas depois desta chave e sem valor ainda não têm dados do banco (não é zero).
function Columns({
  rows,
  partial,
  selected,
  onSelect,
  pendingAfter,
}: {
  rows: Column[];
  partial?: string;
  selected?: string;
  onSelect?: (key: string) => void;
  pendingAfter?: string;
}) {
  const top = Math.max(...rows.map((r) => r.value), 1);
  // Com muitas colunas os rótulos se sobrepõem: mostra cerca de oito, sempre terminando na última.
  const step = rows.length > 16 ? Math.ceil(rows.length / 8) : 1;
  const labelled = (i: number) => (rows.length - 1 - i) % step === 0;
  return (
    <div className={`cx-cols${rows.length > 16 ? ' dense' : ''}`}>
      {rows.map((r, i) => {
        const pending = pendingAfter !== undefined && r.key > pendingAfter && r.value === 0;
        const cls = `cx-col${r.key === partial ? ' partial' : ''}${r.key === selected ? ' selected' : ''}${pending ? ' pending' : ''}`;
        const title = pending ? `${r.label}: o banco ainda não entregou as compras deste dia` : `${r.label}: ${fmt(r.value)}${r.hint ? ` · ${r.hint}` : ''}`;
        const body = (
          <>
            {/* O valor aparece só na coluna escolhida (e ao passar o mouse), para o gráfico respirar. */}
            <span className="cx-col-value">{r.value > 0 ? compact(r.value) : ''}</span>
            <div className="cx-col-bar" style={{ height: pending ? undefined : `${Math.max((r.value / top) * 100, r.value > 0 ? 3 : 0)}%` }} />
            <span className="cx-col-label">{labelled(i) || r.key === selected ? r.label : ''}</span>
          </>
        );
        return onSelect && !pending ? (
          <button type="button" className={cls} key={r.key} title={title} aria-pressed={r.key === selected} onClick={() => onSelect(r.key)}>
            {body}
          </button>
        ) : (
          <div className={cls} key={r.key} title={title}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="cx-tag">{children}</span>;
}

function PurchaseList({ items, more }: { items: ChartItem[]; more: number }) {
  return (
    <ul className="cx-list">
      {items.map((p, i) => (
        <li key={`${p.name}-${i}`}>
          <span>
            {p.name}
            {p.kind && <Tag>{p.kind}</Tag>}
            <small>
              {p.card}
              {p.installments ? ` · parcela ${p.installments}` : ''}
            </small>
          </span>
          <b>{fmt(p.amount)}</b>
        </li>
      ))}
      {more > 0 && <li className="muted">e mais {more} compra(s) menores</li>}
    </ul>
  );
}

// Respostas já vistas nesta sessão, por combinação de filtros.
const seenCards = new Map<string, CardsOverview>();

export default function CardsSection() {
  const [months, setMonths] = useState<number>(6);
  // Padrão: a fatura em aberto (do último fechamento até hoje).
  const [billMode, setBillMode] = useState(true);
  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [accountId, setAccountId] = useState<string>('');
  const [data, setData] = useState<CardsOverview | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [selectedBar, setSelectedBar] = useState<string>('');
  const [showIdle, setShowIdle] = useState(false);
  const [showAllPlans, setShowAllPlans] = useState(false);
  const [editing, setEditing] = useState<{ key: string; name: string; kind: string } | null>(null);
  // Carrossel de cartões: posição atual e se há mais para cada lado.
  const walletRef = useRef<HTMLDivElement>(null);
  const [wallet, setWallet] = useState({ index: 0, pages: 1, start: true, end: true });
  const measureWallet = useCallback(() => {
    const el = walletRef.current;
    if (!el) return;
    const step = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? el.clientWidth;
    const max = el.scrollWidth - el.clientWidth;
    setWallet({
      // No fim da faixa o último cartão está inteiro à vista, mesmo sem encostar na esquerda.
      index: max > 2 && el.scrollLeft >= max - 2 ? el.children.length - 1 : step > 0 ? Math.round(el.scrollLeft / (step + 14)) : 0,
      pages: el.children.length,
      start: el.scrollLeft <= 2,
      end: el.scrollLeft >= max - 2,
    });
  }, []);
  const slideWallet = (direction: number) => {
    const el = walletRef.current;
    if (!el) return;
    const step = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? el.clientWidth;
    el.scrollBy({ left: direction * (step + 14), behavior: 'smooth' });
    // Nem todo navegador dispara o evento de rolagem ao fim da animação: mede de novo por garantia.
    window.setTimeout(measureWallet, 500);
  };
  const goToCard = (i: number) => {
    (walletRef.current?.children[i] as HTMLElement | undefined)?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    window.setTimeout(measureWallet, 500);
  };
  useEffect(() => {
    measureWallet();
    window.addEventListener('resize', measureWallet);
    return () => window.removeEventListener('resize', measureWallet);
  }, [measureWallet, data]);
  const rangeReady = custom && from !== '' && to !== '' && from <= to;
  const rangeInvalid = custom && from !== '' && to !== '' && from > to;

  useEffect(() => {
    // Intervalo personalizado ainda incompleto: mantém o que já está na tela.
    if (custom && !rangeReady) return;
    let cancelled = false;
    // O que já foi visto nesta sessão aparece na hora; a busca em seguida só atualiza.
    const cacheKey = JSON.stringify([rangeReady ? [from, to] : billMode ? 'bill' : months, accountId]);
    const seen = seenCards.get(cacheKey);
    if (seen) {
      setData(seen);
      setError('');
    }
    setLoading(true);
    api
      .cards(rangeReady ? { from, to } : billMode ? { bill: true } : { months }, accountId || undefined)
      .then((d) => {
        if (cancelled) return;
        seenCards.set(cacheKey, d);
        if (seen && JSON.stringify(seen) === JSON.stringify(d)) return;
        setData(d);
        setError('');
        setSelectedBar('');
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [months, billMode, accountId, custom, rangeReady, from, to, reload]);

  // Parcelamento com a etiqueta em edição.
  const [planEdit, setPlanEdit] = useState<{ key: string; label: string } | null>(null);
  const savePlanLabel = useCallback(async () => {
    if (!planEdit) return;
    try {
      await api.setMerchantLabel(planEdit.key, planEdit.label, '');
      setPlanEdit(null);
      seenCards.clear();
      setReload((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar a etiqueta');
    }
  }, [planEdit]);

  // Categoria aberta em "Para onde foi".
  const [openCategory, setOpenCategory] = useState('');
  // Corrige a categoria de um estabelecimento; vale para todas as compras dele.
  const moveMerchant = useCallback(async (key: string, category: string) => {
    try {
      await api.setMerchantCategory(key, category);
      seenCards.clear();
      setReload((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível mudar a categoria');
    }
  }, []);

  const saveLabel = useCallback(async () => {
    if (!editing) return;
    try {
      await api.setMerchantLabel(editing.key, editing.name, editing.kind);
      seenCards.clear();
      setEditing(null);
      setReload((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [editing]);

  const heading = (
    <>
      <h2>Cartões de crédito</h2>
    </>
  );
  if (error) {
    return (
      <section>
        {heading}
        <div className="alert-box">
          <b>Não foi possível carregar os cartões:</b> {error}
        </div>
      </section>
    );
  }
  if (!data) {
    return (
      <section>
        {heading}
        <Loader label="Carregando os cartões" />
      </section>
    );
  }
  if (data.cards.length === 0) {
    return (
      <section>
        {heading}
        <p className="cx-empty">Nenhum cartão sincronizado ainda. Conecte um banco pelo Open Finance para ver os dados aqui.</p>
      </section>
    );
  }

  const t = data.totals;
  const totalUsage = usage(t.utilization);
  const activeSubs = data.subscriptions.filter((s) => s.active);
  const subsMonthly = activeSubs.reduce((s, x) => s + x.monthly, 0);
  const nextDue = data.cards
    .filter((c) => !accountId || c.id === accountId)
    .flatMap((c) => [c.closedBill, c.openBill].filter((b) => b && b.amount > 0).map((b) => ({ bank: bankOf(c.bank).name, bill: b! })))
    .sort((a, b) => (a.bill.dueDate < b.bill.dueDate ? -1 : 1))[0];

  // Cartão sem fatura, sem gasto e sem limite usado não precisa ocupar espaço.
  const isIdle = (c: CardsOverview['cards'][number]) => !(c.openBill?.amount || c.closedBill?.amount || c.spentInPeriod || c.used);
  const activeCards = data.cards.filter((c) => !isIdle(c) || c.id === accountId);
  const idleCards = data.cards.filter((c) => isIdle(c) && c.id !== accountId);

  const chart = data.byDay
    ? data.byDay.map((d) => ({ key: d.day, label: dayLabel(d.day), value: d.total, count: d.count, items: d.items }))
    : data.byMonth.map((m) => ({ key: m.month, label: monthLabel(m.month), value: m.total, count: m.count, items: m.items }));
  const biggest = chart.reduce((best, c) => (c.value > best.value ? c : best), chart[0]);
  // Sem escolha do usuário, mostra o dia (ou mês) mais recente que tem compra.
  const latest = [...chart].reverse().find((c) => c.value > 0) ?? chart[chart.length - 1];
  const focus = chart.find((c) => c.key === selectedBar) ?? latest;
  const withSpend = chart.filter((c) => c.value > 0);
  const chartTotal = chart.reduce((sum, c) => sum + c.value, 0);

  const busiest = data.weekdays.reduce((best, w, i) => (w.average > data.weekdays[best].average ? i : best), 0);
  const inst = data.installments;
  const periodDays = Math.round((Date.parse(data.period.endDate) - Date.parse(data.period.startDate)) / 86_400_000) + 1;
  const plans = showAllPlans ? inst.active : inst.active.slice(0, 5);

  return (
    <section className={loading ? 'cx cx-loading' : 'cx'}>
      {heading}

      <div className="cx-filters">
        <div className="cx-seg" role="group" aria-label="Período">
          <button
            className={!custom && billMode ? 'active' : ''}
            onClick={() => {
              setCustom(false);
              setBillMode(true);
            }}
          >
            fatura atual
          </button>
          {PERIODS.map((p) => (
            <button
              key={p}
              className={!custom && !billMode && months === p ? 'active' : ''}
              onClick={() => {
                setCustom(false);
                setBillMode(false);
                setMonths(p);
              }}
            >
              {p === 1 ? '1 mês' : `${p} meses`}
            </button>
          ))}
          <button
            className={custom ? 'active' : ''}
            aria-expanded={custom}
            onClick={() => {
              // Começa do período que está na tela, para ajustar a partir dele.
              if (!custom) {
                setFrom(data.period.startDate);
                setTo(data.period.endDate);
              }
              setCustom(true);
            }}
          >
            datas
          </button>
        </div>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Cartão">
          <option value="">Todos os cartões</option>
          {data.cards.map((c) => (
            <option key={c.id} value={c.id}>
              {bankOf(c.bank).name} · {cardTitle(c.name, bankOf(c.bank).name)}
              {c.last4 ? ` •••• ${c.last4}` : ''}
            </option>
          ))}
        </select>
        {custom && (
          <div className="cx-range">
            <label>
              de
              <input type="date" value={from} max={to || todayKey()} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              até
              <input type="date" value={to} min={from} max={todayKey()} onChange={(e) => setTo(e.target.value)} />
            </label>
            {rangeInvalid && <span className="cx-range-error">A data inicial é depois da final.</span>}
          </div>
        )}
      </div>

      <div className="cx-kpis">
        <div className="cx-kpi hero">
          <small>
            {data.period.billCycle ? 'Fatura atual · gasto' : 'Gasto'} de {dateLabel(data.period.startDate)} a {dateLabel(data.period.endDate)}
          </small>
          <b>{fmt(t.spent)}</b>
          <ul>
            <li>
              <span>compras</span>
              <span>{t.purchases}</span>
            </li>
            <li>
              <span>ticket médio</span>
              <span>{fmt(t.avgTicket)}</span>
            </li>
            <li>
              <span>{t.avgMonthly === null ? 'média por dia' : 'média por mês fechado'}</span>
              <span>{fmt(t.avgMonthly ?? t.spent / periodDays)}</span>
            </li>
            {t.refundedCount > 0 && (
              <li>
                <span>estornado, já fora da conta</span>
                <span>{fmt(t.refundedPurchases)}</span>
              </li>
            )}
          </ul>
        </div>
        <div className="cx-kpi">
          <small>Faturas atuais</small>
          <b>{fmt(t.closedBills + t.openBills)}</b>
          <ul>
            <li>
              <span>fechadas, a pagar</span>
              <span>{fmt(t.closedBills)}</span>
            </li>
            <li>
              <span>abertas</span>
              <span>{fmt(t.openBills)}</span>
            </li>
            {nextDue && (
              <li>
                <span>próximo vencimento</span>
                <span>
                  {nextDue.bank} · {dayLabel(nextDue.bill.dueDate)}
                </span>
              </li>
            )}
          </ul>
        </div>
        <div className="cx-kpi">
          <small>Limite usado</small>
          <b>{t.utilization === null ? '—' : pct(t.utilization)}</b>
          <div className={`cx-meter ${totalUsage.level}`}>
            <div className="cx-track">
              <div className="cx-fill" style={{ width: `${Math.min((t.utilization ?? 0) * 100, 100)}%` }} />
            </div>
          </div>
          <ul>
            <li>
              <span>usado</span>
              <span>{fmt(t.used)}</span>
            </li>
            <li>
              <span>limite total · {totalUsage.label}</span>
              <span>{fmt(t.limit)}</span>
            </li>
          </ul>
        </div>
        <div className="cx-kpi">
          <small>Parcelas a vencer</small>
          <b>{fmt(inst.totalRemaining)}</b>
          <ul>
            <li>
              <span>parcelamentos em aberto</span>
              <span>{inst.activeCount}</span>
            </li>
            {inst.nextMonth && (
              <li>
                <span>na fatura de {monthLabel(inst.nextMonth.month)}</span>
                <span>{fmt(inst.nextMonth.total)}</span>
              </li>
            )}
            {inst.endsIn && (
              <li>
                <span>última parcela</span>
                <span>{monthLabel(inst.endsIn)}</span>
              </li>
            )}
          </ul>
        </div>
      </div>

      <div className="cx-carousel">
        <div className="cx-carousel-head">
          <span>
            {activeCards.length} cartão(ões) com movimento
            {!(wallet.start && wallet.end) && ' · deslize para ver os outros'}
          </span>
          {!(wallet.start && wallet.end) && (
            <span className="cx-carousel-nav">
              <button type="button" onClick={() => slideWallet(-1)} disabled={wallet.start} aria-label="Cartão anterior">
                ‹
              </button>
              <button type="button" onClick={() => slideWallet(1)} disabled={wallet.end} aria-label="Próximo cartão">
                ›
              </button>
            </span>
          )}
        </div>
        <div className="cx-wallet" ref={walletRef} onScroll={measureWallet}>
        {activeCards.map((c) => {
          const u = usage(c.utilization);
          const bank = bankOf(c.bank);
          return (
            <button
              key={c.id}
              className={`cx-card${accountId === c.id ? ' selected' : ''}`}
              onClick={() => setAccountId(accountId === c.id ? '' : c.id)}
              aria-pressed={accountId === c.id}
              style={{ '--bank': bank.bg } as React.CSSProperties}
            >
              <div className="cx-card-top">
                <span className="cx-badge" style={{ background: bank.bg, color: bank.fg }} aria-hidden="true">
                  {bank.mono}
                </span>
                <span className="cx-card-id">
                  <b>{bank.name}</b>
                  <small>
                    {cardTitle(c.name, bank.name)} · •••• {c.last4 ?? '----'}
                  </small>
                </span>
                <span className="cx-card-brand">{c.brand ?? ''}</span>
              </div>
              <div className="cx-bills">
                <div className={c.openBill?.amount ? '' : 'empty'}>
                  <small>fatura aberta</small>
                  <b>{c.openBill ? fmt(c.openBill.amount) : '—'}</b>
                  <small>
                    {c.openBill ? `${c.cycleStart ? `desde ${dayLabel(c.cycleStart)} · ` : ''}vence ${dayLabel(c.openBill.dueDate)}` : 'sem dados'}
                  </small>
                </div>
                <div className={c.closedBill?.amount ? 'due' : 'empty'}>
                  <small>fatura fechada</small>
                  <b>{c.closedBill ? fmt(c.closedBill.amount) : '—'}</b>
                  <small>{c.closedBill ? `vence ${dayLabel(c.closedBill.dueDate)}` : 'nada a pagar'}</small>
                </div>
              </div>
              {c.openBill && c.openBill.projectedInstallments > 0 && (
                <div className="cx-card-note">A aberta inclui {fmt(c.openBill.projectedInstallments)} em parcelas que o banco ainda vai lançar.</div>
              )}
              <div className={`cx-meter ${u.level}`}>
                <div className="cx-track">
                  <div className="cx-fill" style={{ width: `${Math.min((c.utilization ?? 0) * 100, 100)}%` }} />
                </div>
                <span>
                  {c.limit === null ? u.label : `${pct(c.utilization ?? 0)} do limite de ${fmt(c.limit)} · ${u.label}`}
                  <em>gasto no período {fmt(c.spentInPeriod)}</em>
                </span>
              </div>
            </button>
          );
        })}
        </div>
        {!(wallet.start && wallet.end) && (
          <div className="cx-dots">
            {activeCards.map((c, i) => (
              <button
                type="button"
                key={c.id}
                className={i === wallet.index ? 'active' : ''}
                onClick={() => goToCard(i)}
                aria-label={`Ir para ${bankOf(c.bank).name}`}
                aria-current={i === wallet.index}
              />
            ))}
          </div>
        )}
      </div>
      {idleCards.length > 0 && (
        <div className="cx-idle">
          <button type="button" onClick={() => setShowIdle(!showIdle)} aria-expanded={showIdle}>
            {showIdle ? 'ocultar' : 'mostrar'} {idleCards.length} cartão(ões) sem movimento
          </button>
          {showIdle && (
            <ul>
              {idleCards.map((c) => {
                const bank = bankOf(c.bank);
                return (
                  <li key={c.id}>
                    <span className="cx-badge small" style={{ background: bank.bg, color: bank.fg }} aria-hidden="true">
                      {bank.mono}
                    </span>
                    {bank.name} · {cardTitle(c.name, bank.name)} · •••• {c.last4 ?? '----'}
                    {c.limit !== null && <small>limite {fmt(c.limit)}</small>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="cx-grid">
        <article className="cx-panel cx-wide">
          <h3>{data.byDay ? 'Gasto por dia' : 'Gasto por mês'}</h3>
          <p className="cx-sub">
            Toque numa barra para ver as compras {data.byDay ? 'do dia' : 'do mês'}. Não entram pagamento de fatura, IOF, tarifas e juros.
            {!data.byDay && data.period.to === data.period.currentMonth && ' O mês atual ainda está em aberto.'}
          </p>
          {withSpend.length > 0 && (
            <div className="cx-daystats">
              <div>
                <small>{data.byDay ? 'dias com compra' : 'meses com compra'}</small>
                <b>
                  {withSpend.length} de {chart.length}
                </b>
              </div>
              <div>
                <small>média por {data.byDay ? 'dia' : 'mês'} com compra</small>
                <b>{fmt(chartTotal / withSpend.length)}</b>
              </div>
              <button type="button" onClick={() => setSelectedBar(biggest.key)} title="Ver as compras desse dia">
                <small>maior {data.byDay ? 'dia' : 'mês'}</small>
                <b>
                  {biggest.label} · {fmt(biggest.value)}
                </b>
              </button>
              <button type="button" onClick={() => setSelectedBar(latest.key)} title="Ver as compras mais recentes">
                <small>mais recente</small>
                <b>
                  {latest.label} · {fmt(latest.value)}
                </b>
              </button>
            </div>
          )}
          <Columns
            rows={chart.map((c) => ({ key: c.key, label: c.label, value: c.value, hint: `${c.count} compras` }))}
            partial={data.byDay ? undefined : data.period.currentMonth}
            selected={focus?.key}
            onSelect={setSelectedBar}
            pendingAfter={data.byDay ? latest?.key : undefined}
          />
          {data.byDay && latest && latest.key !== chart[chart.length - 1]?.key && (
            <p className="cx-foot">
              Os dias tracejados ainda não têm compras entregues pelos bancos
              {data.lastSyncedAt ? ` (última leitura em ${new Date(data.lastSyncedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })})` : ''}. Compra no cartão costuma
              aparecer de um a dois dias depois.
            </p>
          )}
          {focus && (
            <div className="cx-detail">
              <div className="cx-detail-head">
                <b>
                  {data.byDay ? dateLabel(focus.key) : monthLabel(focus.key)}
                  <em>{fmt(focus.value)}</em>
                </b>
                <small>
                  {focus.count} compra(s)
                  {focus.key === latest?.key ? ` · ${data.byDay ? 'dia' : 'mês'} mais recente com compra` : focus.key === biggest.key && focus.value > 0 ? ` · maior ${data.byDay ? 'dia' : 'mês'}` : ''}
                </small>
              </div>
              {focus.items.length === 0 ? (
                <p className="cx-empty">Nenhuma compra.</p>
              ) : (
                <PurchaseList items={focus.items} more={focus.count - focus.items.length} />
              )}
            </div>
          )}
        </article>

        <article className="cx-panel cx-wide">
          <h3>Para onde foi</h3>
          <p className="cx-sub">Toque numa categoria para ver o que a compõe e corrigir um lugar que esteja na categoria errada.</p>
          {data.byCategory.length === 0 ? (
            <p className="cx-empty">Sem compras no período.</p>
          ) : (
            <ul className="cx-cat">
              {data.byCategory.map((c) => {
                const isOpen = openCategory === c.id;
                const parts = c.subcategories.length > 1 || c.subcategories[0]?.label !== c.label ? c.subcategories : [];
                const places = c.places ?? [];
                return (
                  <li key={c.id} className={isOpen ? 'open' : undefined}>
                    <button type="button" className="cx-cat-row" aria-expanded={isOpen} onClick={() => setOpenCategory(isOpen ? '' : c.id)}>
                      <span className="cx-cat-name">
                        {c.label}
                        <small>{c.count} compra(s)</small>
                      </span>
                      <span className="cx-cat-bar" aria-hidden="true">
                        <i style={{ width: `${Math.max((c.total / data.byCategory[0].total) * 100, 1)}%` }} />
                      </span>
                      <span className="cx-cat-pct">{pct(c.share)}</span>
                      <b>{fmt(c.total)}</b>
                      <span className="cx-cat-chevron" aria-hidden="true">
                        {isOpen ? '−' : '+'}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="cx-cat-detail">
                        {parts.length > 0 && (
                          <div className="cx-chips">
                            {parts.map((p) => (
                              <span className="cx-chip" key={p.label}>
                                {p.label} <b>{fmt(p.total)}</b>
                              </span>
                            ))}
                          </div>
                        )}
                        <ul className="cx-cat-places">
                          {places.map((p) => (
                            <li key={p.key}>
                              <span title={p.name}>
                                {p.name}
                                {p.count > 1 && <small> · {p.count} compras</small>}
                              </span>
                              <b>{fmt(p.total)}</b>
                              <select
                                aria-label={`Mudar a categoria de ${p.name}`}
                                value=""
                                onChange={(e) => e.target.value && void moveMerchant(p.key, e.target.value)}
                              >
                                <option value="">mudar categoria…</option>
                                {(data.categoryChoices ?? []).map((choice) => (
                                  <option key={choice.id} value={choice.id}>
                                    {choice.label}
                                  </option>
                                ))}
                              </select>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </article>

        <article className="cx-panel">
          <h3>Onde você mais gasta</h3>
          <p className="cx-sub">Dez estabelecimentos com maior valor no período.</p>
          <ul className="cx-bars">
            {data.topMerchants.map((m) => (
              <li key={m.key} title={`${m.name}: ${fmt(m.total)}`}>
                <div className="cx-bars-head">
                  <span className="cx-bars-label">
                    {m.name}
                    {m.kind && <Tag>{m.kind}</Tag>}
                  </span>
                  <span className="cx-bars-value">
                    <small>{m.count}×</small>
                    {fmt(m.total)}
                  </span>
                </div>
                <div className="cx-track">
                  <div className="cx-fill" style={{ width: `${Math.max((m.total / (data.topMerchants[0]?.total || 1)) * 100, 1)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </article>

        <article className="cx-panel">
          <h3>Assinaturas detectadas</h3>
          <p className="cx-sub">
            Cobranças que se repetem todo mês com valor parecido, nos últimos 6 meses.{' '}
            {activeSubs.length > 0 && (
              <>
                Ativas somam <b>{fmt(subsMonthly)}</b> por mês ({fmt(subsMonthly * 12)} por ano).
              </>
            )}{' '}
            Use “editar” para dizer o que é cada uma.
          </p>
          {data.subscriptions.length === 0 ? (
            <p className="cx-empty">Nenhuma cobrança recorrente encontrada.</p>
          ) : (
            <ul className="cx-list">
              {data.subscriptions.map((s) =>
                editing?.key === s.key ? (
                  <li key={s.key} className="cx-edit">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveLabel();
                      }}
                    >
                      <label>
                        nome
                        <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={80} autoFocus />
                      </label>
                      <label>
                        o que é
                        <input
                          value={editing.kind}
                          onChange={(e) => setEditing({ ...editing, kind: e.target.value })}
                          maxLength={80}
                          placeholder="ex.: seguro do carro"
                        />
                      </label>
                      <div>
                        <button type="submit" className="primary">
                          salvar
                        </button>
                        <button type="button" className="reset" onClick={() => setEditing(null)}>
                          cancelar
                        </button>
                      </div>
                      <small>Na fatura aparece como “{s.key}”. Deixe os dois campos vazios para voltar ao automático.</small>
                    </form>
                  </li>
                ) : (
                  <li key={s.key} className={s.active ? '' : 'muted'}>
                    <span>
                      {s.name}
                      {s.kind && <Tag>{s.kind}</Tag>}
                      <small>
                        {s.active ? `${s.months} meses seguidos` : `sem cobrança desde ${day(s.lastDate)}`} ·{' '}
                        <button type="button" className="cx-link" onClick={() => setEditing({ key: s.key, name: s.name, kind: s.kind ?? '' })}>
                          editar
                        </button>
                      </small>
                    </span>
                    <b>{fmt(s.monthly)}</b>
                  </li>
                ),
              )}
            </ul>
          )}
        </article>

        <article className="cx-panel cx-wide">
          <h3>Parcelas que ainda vêm</h3>
          <p className="cx-sub">Quanto das próximas faturas já está comprometido com compras parceladas.</p>
          {inst.monthly.length === 0 ? (
            <p className="cx-empty">Nenhum parcelamento em aberto.</p>
          ) : (
            <>
              <div className="cx-stats four">
                <div>
                  <small>total a pagar</small>
                  <b>{fmt(inst.totalRemaining)}</b>
                </div>
                <div>
                  <small>na próxima fatura ({inst.nextMonth ? monthLabel(inst.nextMonth.month) : '—'})</small>
                  <b>{inst.nextMonth ? fmt(inst.nextMonth.total) : '—'}</b>
                </div>
                <div>
                  <small>última parcela em</small>
                  <b>{inst.endsIn ? monthLabel(inst.endsIn) : '—'}</b>
                </div>
                {inst.relief && (
                  <div>
                    <small>maior alívio: {monthLabel(inst.relief.month)}</small>
                    <b>
                      {fmt(inst.relief.from)} → {fmt(inst.relief.to)}
                    </b>
                  </div>
                )}
              </div>
              <Columns rows={inst.monthly.map((m) => ({ key: m.month, label: monthLabel(m.month), value: m.total }))} />
              <ul className="cx-plans">
                {plans.map((p, i) => (
                  <li key={p.key ?? `${p.name}-${i}`}>
                    <div className="cx-plan-head">
                      <span>
                        {planEdit && planEdit.key === p.key ? (
                          <form
                            className="cx-plan-edit"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void savePlanLabel();
                            }}
                          >
                            <input
                              autoFocus
                              aria-label={`Etiqueta do parcelamento em ${p.name}`}
                              placeholder="o que é esta compra? (ex.: notebook, viagem)"
                              value={planEdit.label}
                              maxLength={80}
                              onChange={(e) => setPlanEdit({ key: planEdit.key, label: e.target.value })}
                              onKeyDown={(e) => e.key === 'Escape' && setPlanEdit(null)}
                            />
                            <button type="submit" className="tag-btn">
                              salvar
                            </button>
                            <button type="button" className="tag-btn quiet-static" onClick={() => setPlanEdit(null)}>
                              cancelar
                            </button>
                          </form>
                        ) : (
                          <>
                            {p.label || p.name}
                            {p.label && <span className="cx-tag">{p.name}</span>}
                            {p.key && (
                              <button type="button" className="cx-link cx-plan-name" onClick={() => setPlanEdit({ key: p.key!, label: p.label ?? '' })}>
                                {p.label ? 'editar' : '+ etiqueta'}
                              </button>
                            )}
                          </>
                        )}
                        <small>
                          {p.card} · faltam {p.remainingInstallments} de {fmt(p.amount)} · termina em {monthLabel(p.endsIn)}
                        </small>
                      </span>
                      <b>{fmt(p.remainingAmount)}</b>
                    </div>
                    {/* Semáforo: do vermelho (começando) ao verde (quase quitado). O "7/12 pagas" ao lado diz o mesmo em texto. */}
                    <div
                      className="cx-steps"
                      role="img"
                      aria-label={`${p.installment} de ${p.totalInstallments} parcelas pagas`}
                      style={{ '--step': `hsl(${Math.round((p.installment / p.totalInstallments) * 150)} 78% 58%)` } as React.CSSProperties}
                    >
                      {Array.from({ length: p.totalInstallments }, (_, n) => (
                        <i key={n} className={n < p.installment ? 'paid' : ''} />
                      ))}
                      <small>
                        {p.installment}/{p.totalInstallments} pagas
                      </small>
                    </div>
                  </li>
                ))}
              </ul>
              {inst.active.length > 5 && (
                <button type="button" className="cx-more" onClick={() => setShowAllPlans(!showAllPlans)}>
                  {showAllPlans ? 'mostrar só os 5 maiores' : `ver todos os ${inst.active.length} parcelamentos`}
                </button>
              )}
            </>
          )}
        </article>

        <article className="cx-panel cx-fact">
          <header>
            <div>
              <h3>Tarifas, IOF e juros</h3>
              <p className="cx-sub">O que o cartão custou além das compras, já sem o que o banco devolveu.</p>
            </div>
            <b className={t.costs > 0 ? 'warn' : undefined}>{fmt(t.costs)}</b>
          </header>
          {data.costs.length === 0 ? (
            <p className="cx-empty">Nenhuma tarifa, imposto ou juro no período.</p>
          ) : (
            <ul className="cx-fact-rows">
              {data.costs.map((c) => (
                <li key={c.label} className={c.net === 0 ? 'muted' : ''}>
                  <span>{c.label}</span>
                  <span className={`tag ${c.net === 0 ? 'ok' : c.refunded > 0 ? 'info' : ''}`} title={`Cobrado ${fmt(c.charged)}${c.refunded > 0 ? `, devolvido ${fmt(c.refunded)}` : ''}`}>
                    {c.refunded > 0 ? (c.net === 0 ? 'devolvido' : `devolvido ${fmt(c.refunded)}`) : 'cobrado'}
                  </span>
                  <b>{fmt(c.net)}</b>
                </li>
              ))}
            </ul>
          )}
          {t.otherCredits > 0 && <p className="cx-foot">Outros créditos recebidos no período, sem compra correspondente: {fmt(t.otherCredits)}.</p>}
        </article>

        <article className="cx-panel cx-fact">
          <header>
            <div>
              <h3>Compras internacionais</h3>
              <p className="cx-sub">
                {data.international.count === 0
                  ? 'Nenhuma compra em moeda estrangeira no período.'
                  : `${data.international.count} compra(s) em moeda estrangeira, já em reais pelo câmbio do banco.`}
              </p>
            </div>
            {data.international.count > 0 && <b>{fmt(data.international.total)}</b>}
          </header>
          {data.international.count > 0 && (
            <>
              <ul className="cx-fact-rows">
                {data.international.byCurrency.map((c) => (
                  <li key={c.currency}>
                    <span>{money(c.original, c.currency)}</span>
                    <span className="tag" title={`${c.count} compra(s) nesta moeda`}>
                      {c.rate ? `câmbio ${c.rate.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `${c.count} compra(s)`}
                    </span>
                    <b>{fmt(c.total)}</b>
                  </li>
                ))}
              </ul>
              <div className="cx-chips">
                {data.international.top.map((m, i) => (
                  <span className="cx-chip place" key={`${m.name}-${i}`}>
                    {m.name} <b>{fmt(m.total)}</b>
                  </span>
                ))}
              </div>
              <p className="cx-foot">Fazem parte do gasto do período; o IOF delas está em “Tarifas, IOF e juros”.</p>
            </>
          )}
        </article>

        <article className="cx-panel">
          <h3>Dia da semana</h3>
          <p className="cx-sub">
            {data.weekdays[busiest].total > 0 ? (
              <>
                Você gasta mais {WEEKDAY_ON[busiest]}: em média <b>{fmt(data.weekdays[busiest].average)}</b> por dia. Conta só o que foi comprado no dia; parcelas de compras
                antigas ficam de fora.
              </>
            ) : (
              'Sem compras no período.'
            )}
          </p>
          <ul className="cx-week">
            {data.weekdays.map((w, i) => {
              const top = Math.max(...data.weekdays.map((x) => x.average), 1);
              return (
                <li key={i} className={i === busiest && w.total > 0 ? 'top' : undefined} title={`${WEEKDAYS_LONG[i]}: ${fmt(w.total)} em ${w.days} dia(s) do período`}>
                  <span className="cx-week-day">{WEEKDAYS[i]}</span>
                  <span className="cx-week-bar" aria-hidden="true">
                    <i style={{ width: `${w.average > 0 ? Math.max((w.average / top) * 100, 2) : 0}%` }} />
                  </span>
                  <b>{w.average > 0 ? fmt(w.average) : '—'}</b>
                  <small>
                    {w.total > 0
                      ? `${w.count ?? 0} compra(s) em ${w.activeDays ?? 0} de ${w.days} dia(s)${w.top ? ` · mais em ${w.top.label.toLowerCase()}` : ''}`
                      : `nenhuma compra em ${w.days} dia(s)`}
                  </small>
                </li>
              );
            })}
          </ul>
        </article>

        <article className="cx-panel">
          <h3>Maiores compras</h3>
          <p className="cx-sub">Os cinco lançamentos de maior valor no período.</p>
          <ul className="cx-week cx-top">
            {data.largest.map((p, i) => (
              <li key={`${p.name}-${i}`} className={i === 0 ? 'top' : undefined} title={`${p.name}: ${fmt(p.amount)}`}>
                <span className="cx-week-day">{day(p.date)}</span>
                <span className="cx-week-bar" aria-hidden="true">
                  <i style={{ width: `${Math.max((p.amount / (data.largest[0]?.amount || 1)) * 100, 2)}%` }} />
                </span>
                <b>{fmt(p.amount)}</b>
                <small>
                  <strong>{p.name}</strong>
                  {p.kind ? ` · ${p.kind}` : ` · ${p.category.toLowerCase()}`} · {p.card}
                  {p.installments ? ` · parcela ${p.installments}` : ''}
                </small>
              </li>
            ))}
          </ul>
        </article>
      </div>

      <p className="cx-foot">
        Dados do Open Finance, atualizados pelos bancos cerca de uma vez por dia: compras das últimas 24 a 48 horas podem ainda não ter
        chegado, e a fatura aberta é a soma dos lançamentos já recebidos.
        {data.lastSyncedAt ? ` Última sincronização em ${new Date(data.lastSyncedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.` : ''}
        {t.unconverted > 0 && ` ${t.unconverted} lançamento(s) em moeda estrangeira sem valor em reais ficaram fora dos totais.`}
      </p>
    </section>
  );
}
