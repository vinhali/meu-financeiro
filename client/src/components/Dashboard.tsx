import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { billInTotal, calculateMonthly, controllableInTotal, coveredByCard, getPlanStatus, netAdvance, paidAhead } from '../calc';
import { Bridge, Budget, Debt, LineItem, MonthArchive, Scenario, ScenarioTexts, Section } from '../types';
import AlertsBell from './AlertsBell';
import AlertsSection from './AlertsSection';
import BackupBar from './BackupBar';
import BudgetSection from './BudgetSection';
import CardsSection from './CardsSection';
import DashboardCards from './DashboardCards';
import DebtsSection from './DebtsSection';
import HistorySection from './HistorySection';
import Loader from './Loader';
import OpenFinanceSection from './OpenFinanceSection';
import PlanilhaTable from './PlanilhaTable';
import ScenarioBar from './ScenarioBar';

const SAVE_DEBOUNCE_MS = 700;
type Tab = 'overview' | 'debts' | 'cards' | 'openfinance' | 'alerts';

const MONTH_LABELS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

function nextMonthLabel(previous: string, count: number): string {
  const index = MONTH_LABELS.indexOf(previous.trim().toUpperCase());
  return index >= 0 ? MONTH_LABELS[(index + 1) % MONTH_LABELS.length] : `Mês ${count + 1}`;
}

const EMPTY_TEXTS: ScenarioTexts = {
  header: { eyebrow: '', title: '', sub: '', noteTitle: '', note: '' },
  rules: { eyebrow: '', title: '', items: [] },
  allocation: { eyebrow: '', title: '', slices: [], noteTitle: '', note: '' },
  mudanca: { eyebrow: '', title: '', intro: '', items: [] },
};

export default function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenarioId, setScenarioId] = useState<string>('');
  const [items, setItems] = useState<LineItem[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [, setBridge] = useState<Bridge>({ plr: 0, dissidioPercent: 0 });
  const [emergencyReserve, setEmergencyReserve] = useState(0);
  const [, setTexts] = useState<ScenarioTexts>(EMPTY_TEXTS);
  const [months, setMonths] = useState<string[]>([]);
  const [, setBridgeMonths] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [saveStatus, setSaveStatus] = useState('');
  // Muda a cada salvamento, para o planejado x realizado reler os valores do cenário.
  const [budgetVersion, setBudgetVersion] = useState(0);
  // Simulação das previsões: por 30 segundos as faturas futuras entram pelo valor previsto, para
  // ver como ficaria o subtotal de cada mês. Nada é gravado.
  const [simLeft, setSimLeft] = useState(0);
  useEffect(() => {
    if (simLeft <= 0) return;
    const timer = window.setTimeout(() => setSimLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [simLeft]);
  // Meses retirados da planilha (histórico).
  const [archives, setArchives] = useState<MonthArchive[]>([]);
  const loadArchives = useCallback((id: string) => api.monthArchives(id).then(setArchives).catch(() => setArchives([])), []);
  useEffect(() => {
    if (scenarioId) loadArchives(scenarioId);
  }, [scenarioId, loadArchives]);
  // Dados reais do Open Finance para as linhas do cenário (seção "realizado" e dicas na planilha).
  const [budget, setBudget] = useState<Budget | null>(null);
  useEffect(() => {
    if (!scenarioId) return;
    let cancelled = false;
    api
      .budget(scenarioId)
      .then((d) => !cancelled && setBudget(d))
      .catch(() => !cancelled && setBudget(null));
    return () => {
      cancelled = true;
    };
  }, [scenarioId, budgetVersion]);
  // Marca (ou desmarca) uma conta como paga; o orçamento é relido para refletir a marcação.
  const handleMarkPaid = useCallback(async (itemId: string, month: string, paid: boolean) => {
    try {
      await api.markPaid(itemId, month, paid);
      setBudgetVersion((v) => v + 1);
    } catch (e) {
      setToast({ type: 'error', msg: e instanceof Error ? e.message : 'Não foi possível marcar como pago' });
      window.setTimeout(() => setToast(null), 3500);
    }
  }, []);
  // Corrige a categoria de um estabelecimento ("isto é mercado, não restaurante") e relê o orçamento.
  const handleMoveMerchant = useCallback(async (key: string, category: string, name: string, target: string) => {
    try {
      await api.setMerchantCategory(key, category);
      setBudgetVersion((v) => v + 1);
      setToast({ type: 'success', msg: `${name} agora conta em ${target}.` });
    } catch (e) {
      setToast({ type: 'error', msg: e instanceof Error ? e.message : 'Não foi possível mudar a categoria' });
    }
    window.setTimeout(() => setToast(null), 3500);
  }, []);
  const handleLinkPayment = useCallback(async (key: string, rowName: string) => {
    try {
      await api.setMerchantLabel(key, '', rowName);
      setBudgetVersion((v) => v + 1);
    } catch {
      /* a seção continua mostrando o estado anterior */
    }
  }, []);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const itemsTimer = useRef<number>();
  const debtsTimer = useRef<number>();
  const bridgeTimer = useRef<number>();
  const reserveTimer = useRef<number>();
  const textsTimer = useRef<{ [K in keyof ScenarioTexts]?: number }>({});
  const monthsTimer = useRef<number>();
  const bridgeMonthsTimer = useRef<number>();
  const itemsRef = useRef<LineItem[]>([]);
  const debtsRef = useRef<Debt[]>([]);
  const bridgeRef = useRef<Bridge>({ plr: 0, dissidioPercent: 0 });
  const emergencyReserveRef = useRef(0);
  const textsRef = useRef<ScenarioTexts>(EMPTY_TEXTS);
  const monthsRef = useRef<string[]>([]);
  const bridgeMonthsRef = useRef<string[]>([]);
  const scenarioIdRef = useRef<string>('');

  function notify(type: 'success' | 'error', msg: string) {
    setToast({ type, msg });
    window.setTimeout(() => setToast(null), 3500);
  }

  const loadScenarios = useCallback(async (selectId?: string) => {
    const list = await api.listScenarios();
    setScenarios(list);
    const fallback = list.find((s) => s.isBase)?.id || list[0]?.id;
    const id = selectId || fallback;
    if (id) setScenarioId(id);
    return list;
  }, []);

  useEffect(() => {
    loadScenarios().catch(() => notify('error', 'Falha ao carregar cenários'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadScenario = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const full = await api.getScenario(id);
      setItems(full.items);
      setDebts(full.debts);
      setBridge(full.bridge);
      setEmergencyReserve(full.emergencyReserve);
      setTexts(full.texts);
      setMonths(full.months);
      setBridgeMonths(full.bridgeMonths);
      itemsRef.current = full.items;
      debtsRef.current = full.debts;
      bridgeRef.current = full.bridge;
      emergencyReserveRef.current = full.emergencyReserve;
      textsRef.current = full.texts;
      monthsRef.current = full.months;
      bridgeMonthsRef.current = full.bridgeMonths;
      setSaveStatus('');
    } catch {
      notify('error', 'Falha ao carregar cenário');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!scenarioId) return;
    // cancel any pending saves for the previous scenario before switching
    window.clearTimeout(itemsTimer.current);
    window.clearTimeout(debtsTimer.current);
    window.clearTimeout(bridgeTimer.current);
    window.clearTimeout(reserveTimer.current);
    window.clearTimeout(monthsTimer.current);
    window.clearTimeout(bridgeMonthsTimer.current);
    Object.values(textsTimer.current).forEach((t) => window.clearTimeout(t));
    textsTimer.current = {};
    scenarioIdRef.current = scenarioId;
    loadScenario(scenarioId);
  }, [scenarioId, loadScenario]);

  // Nos totais, o que já está dentro das faturas de cartão não soma de novo: a linha de gasto
  // controlável entra só com o que falta gastar, e a conta fixa já lançada no cartão entra com zero.
  // Os valores guardados não mudam.
  const simulating = simLeft > 0;
  const itemsForTotals = useMemo(() => {
    const usable = budget && budget.months.length === months.length && budget.months.every((m, i) => m.label === months[i]);
    if (!usable) return items;
    const rowOf = (id: string) => budget.rows.find((r) => r.itemId === id);
    // Conta paga adiantado com o adiantamento do dia 20 sai das saídas e do adiantamento, juntos.
    const netted = netAdvance(items, (it, m) => {
      const row = rowOf(it.id);
      return row?.type === 'fixed' && paidAhead(row.months[m]?.paid);
    });
    return netted.map((it) => {
      const row = rowOf(it.id);
      if (it.controllable && row?.type === 'limit') {
        return { ...it, values: it.values.map((limit, i) => controllableInTotal(limit, row.months[i])) };
      }
      // Conta fixa que já foi lançada no cartão está dentro da fatura do mês: não soma de novo.
      if (row?.type === 'fixed') return { ...it, values: it.values.map((v, i) => (coveredByCard(row.months[i]?.paid) ? 0 : v)) };
      // Fatura fechada ou aberta entra pelo valor do banco, que acompanha cada compra nova.
      if (row?.type === 'cardBill') return { ...it, values: it.values.map((v, i) => billInTotal(v, row.months[i], simulating)) };
      return it;
    });
  }, [items, months, budget, simulating]);
  const monthly = useMemo(() => calculateMonthly(itemsForTotals, months), [itemsForTotals, months]);
  const planStatus = useMemo(() => getPlanStatus(monthly), [monthly]);

  async function flushItems() {
    const id = scenarioIdRef.current;
    try {
      await api.updateItems(id, itemsRef.current);
      setSaveStatus('· salvo ✓');
      setBudgetVersion((v) => v + 1);
    } catch {
      setSaveStatus('· falha ao salvar');
    }
  }

  async function flushDebts() {
    const id = scenarioIdRef.current;
    try {
      await api.updateDebts(id, debtsRef.current);
      setSaveStatus('· salvo ✓');
      setBudgetVersion((v) => v + 1);
    } catch {
      setSaveStatus('· falha ao salvar');
    }
  }

  async function flushBridge() {
    const id = scenarioIdRef.current;
    try {
      await api.updateBridge(id, bridgeRef.current);
      setSaveStatus('· salvo ✓');
      setBudgetVersion((v) => v + 1);
    } catch {
      setSaveStatus('· falha ao salvar');
    }
  }

  async function flushReserve() {
    const id = scenarioIdRef.current;
    try {
      await api.updateReserve(id, emergencyReserveRef.current);
      setSaveStatus('· salvo ✓');
      setBudgetVersion((v) => v + 1);
    } catch {
      setSaveStatus('· falha ao salvar');
    }
  }

  async function flushText(key: keyof ScenarioTexts) {
    const id = scenarioIdRef.current;
    try {
      await api.updateText(id, key, textsRef.current[key]);
      setSaveStatus('· salvo ✓');
      setBudgetVersion((v) => v + 1);
    } catch {
      setSaveStatus('· falha ao salvar');
    }
  }

  async function flushMonths() {
    const id = scenarioIdRef.current;
    try {
      await api.updateMonths(id, monthsRef.current);
      setSaveStatus('· salvo ✓');
      setBudgetVersion((v) => v + 1);
    } catch {
      setSaveStatus('· falha ao salvar');
    }
  }

  async function flushBridgeMonths() {
    const id = scenarioIdRef.current;
    try {
      await api.updateBridgeMonths(id, bridgeMonthsRef.current);
      setSaveStatus('· salvo ✓');
      setBudgetVersion((v) => v + 1);
    } catch {
      setSaveStatus('· falha ao salvar');
    }
  }

  function handleChangeValue(itemId: string, monthIdx: number, value: number) {
    setItems((prev) => {
      const next = prev.map((it) => {
        if (it.id !== itemId) return it;
        return { ...it, values: it.values.map((v, i) => (i === monthIdx ? value : v)) };
      });
      itemsRef.current = next;
      return next;
    });
    setSaveStatus('· editando…');
    window.clearTimeout(itemsTimer.current);
    itemsTimer.current = window.setTimeout(flushItems, SAVE_DEBOUNCE_MS);
  }

  function handleChangeItemMeta(itemId: string, patch: Partial<Pick<LineItem, 'name' | 'obs' | 'controllable'>>) {
    setItems((prev) => {
      const next = prev.map((it) => (it.id === itemId ? { ...it, ...patch } : it));
      itemsRef.current = next;
      return next;
    });
    setSaveStatus('· editando…');
    window.clearTimeout(itemsTimer.current);
    itemsTimer.current = window.setTimeout(flushItems, SAVE_DEBOUNCE_MS);
  }

  async function handleAddItem(section: Section) {
    try {
      const created = await api.addItem(scenarioId, section);
      setItems((prev) => {
        const next = [...prev, created];
        itemsRef.current = next;
        return next;
      });
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Falha ao adicionar categoria');
    }
  }

  async function handleDeleteItem(itemId: string) {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    if (!confirm(`Remover a categoria "${item.name}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await api.deleteItem(scenarioId, itemId);
      setItems((prev) => {
        const next = prev.filter((i) => i.id !== itemId);
        itemsRef.current = next;
        return next;
      });
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Falha ao remover categoria');
    }
  }

  function handleReorder(section: Section, draggedId: string, targetId: string) {
    setItems((prev) => {
      const sectionItems = prev.filter((i) => i.section === section).sort((a, b) => a.order - b.order);
      const others = prev.filter((i) => i.section !== section);
      const fromIdx = sectionItems.findIndex((i) => i.id === draggedId);
      const toIdx = sectionItems.findIndex((i) => i.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const reordered = [...sectionItems];
      const [moved] = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, moved);
      const renumbered = reordered.map((it, idx) => ({ ...it, order: idx }));
      const next = [...others, ...renumbered];
      itemsRef.current = next;
      return next;
    });
    setSaveStatus('· editando…');
    window.clearTimeout(itemsTimer.current);
    itemsTimer.current = window.setTimeout(flushItems, SAVE_DEBOUNCE_MS);
  }

  function handleChangeEmergencyReserve(value: number) {
    setEmergencyReserve(value);
    emergencyReserveRef.current = value;
    setSaveStatus('· editando…');
    window.clearTimeout(reserveTimer.current);
    reserveTimer.current = window.setTimeout(flushReserve, SAVE_DEBOUNCE_MS);
  }

  function handleChangeDebts(next: Debt[]) {
    setDebts(next);
    debtsRef.current = next;
    setSaveStatus('· editando…');
    window.clearTimeout(debtsTimer.current);
    debtsTimer.current = window.setTimeout(flushDebts, SAVE_DEBOUNCE_MS);
  }

  async function handleAddDebt() {
    try {
      const created = await api.addDebt(scenarioId);
      setDebts((prev) => {
        const next = [...prev, created];
        debtsRef.current = next;
        return next;
      });
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Falha ao adicionar dívida');
    }
  }

  async function handleDeleteDebt(debtId: string) {
    const debt = debts.find((d) => d.id === debtId);
    if (!debt) return;
    if (!confirm(`Remover a dívida "${debt.name}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await api.deleteDebt(scenarioId, debtId);
      setDebts((prev) => {
        const next = prev.filter((d) => d.id !== debtId);
        debtsRef.current = next;
        return next;
      });
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Falha ao remover dívida');
    }
  }

  function handleRenameMonth(monthIdx: number, value: string) {
    setMonths((prev) => {
      const next = prev.map((m, i) => (i === monthIdx ? value : m));
      monthsRef.current = next;
      return next;
    });
    setSaveStatus('· editando…');
    window.clearTimeout(monthsTimer.current);
    monthsTimer.current = window.setTimeout(flushMonths, SAVE_DEBOUNCE_MS);
  }

  async function handleAddMonth() {
    window.clearTimeout(monthsTimer.current);
    const previousIndex = monthsRef.current.length - 1;
    const next = [...monthsRef.current, nextMonthLabel(monthsRef.current[previousIndex] || '', monthsRef.current.length)];
    try {
      await api.updateMonths(scenarioIdRef.current, next, undefined, previousIndex);
      await loadScenario(scenarioIdRef.current);
    } catch {
      notify('error', 'Falha ao adicionar mês');
    }
  }

  async function handleRemoveMonth(monthIdx: number) {
    if (monthsRef.current.length <= 1) return;
    const monthName = monthsRef.current[monthIdx] || `mês ${monthIdx + 1}`;
    if (!confirm(`Tirar ${monthName} da planilha? Os valores desse mês ficam guardados no histórico, no fim da página, e podem ser restaurados.`)) return;
    window.clearTimeout(monthsTimer.current);
    const next = monthsRef.current.filter((_, index) => index !== monthIdx);
    try {
      // Guarda junto os totais que a planilha mostra agora para o mês.
      const cents = (v: number) => Math.round(v * 100) / 100;
      const shown = { entradas: cents(monthly.entradasTotais[monthIdx] ?? 0), saidas: cents(monthly.saidasTotais[monthIdx] ?? 0), saldo: cents(monthly.subtotal[monthIdx] ?? 0) };
      await api.updateMonths(scenarioIdRef.current, next, monthIdx, undefined, shown);
      await loadScenario(scenarioIdRef.current);
      await loadArchives(scenarioIdRef.current);
      setBudgetVersion((v) => v + 1);
      notify('success', `${monthName} foi para o histórico.`);
    } catch {
      notify('error', 'Falha ao remover mês');
    }
  }

  async function handleRestoreMonth(archive: MonthArchive) {
    if (!confirm(`Devolver ${archive.label} para a planilha, com os valores guardados?`)) return;
    try {
      const result = await api.restoreMonth(scenarioIdRef.current, archive.id);
      await loadScenario(scenarioIdRef.current);
      await loadArchives(scenarioIdRef.current);
      setBudgetVersion((v) => v + 1);
      notify(
        'success',
        result.missing.length
          ? `${archive.label} restaurado. Linhas apagadas depois não voltaram: ${result.missing.map((m) => m.name).join(', ')}.`
          : `${archive.label} restaurado na planilha.`,
      );
    } catch {
      notify('error', 'Falha ao restaurar o mês');
    }
  }

  async function handleReset() {
    if (!confirm('Restaurar a projeção original deste cenário? Isso apaga os valores editados da planilha e a ponte até a PLR.')) return;
    try {
      await api.resetScenario(scenarioId);
      await loadScenario(scenarioId);
      notify('success', 'Projeção original restaurada.');
    } catch {
      notify('error', 'Falha ao restaurar projeção');
    }
  }

  async function handleSaveNow() {
    window.clearTimeout(itemsTimer.current);
    window.clearTimeout(debtsTimer.current);
    window.clearTimeout(bridgeTimer.current);
    window.clearTimeout(reserveTimer.current);
    window.clearTimeout(monthsTimer.current);
    window.clearTimeout(bridgeMonthsTimer.current);
    Object.values(textsTimer.current).forEach((t) => window.clearTimeout(t));
    textsTimer.current = {};
    await Promise.all([
      flushItems(),
      flushDebts(),
      flushBridge(),
      flushReserve(),
      flushMonths(),
      flushBridgeMonths(),
      ...(Object.keys(textsRef.current) as (keyof ScenarioTexts)[]).map((key) => flushText(key)),
    ]);
    notify('success', 'Cenário salvo.');
  }

  async function handleCreate() {
    const name = prompt('Nome do novo cenário (criado a partir do cenário base):');
    if (!name || !name.trim()) return;
    try {
      const created = await api.createScenario(name.trim());
      await loadScenarios(created.id);
      notify('success', `Cenário "${created.name}" criado.`);
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Falha ao criar cenário');
    }
  }

  async function handleDuplicate() {
    const current = scenarios.find((s) => s.id === scenarioId);
    const name = prompt('Nome do cenário duplicado:', current ? `${current.name} (cópia)` : undefined);
    if (!name || !name.trim()) return;
    try {
      const created = await api.duplicateScenario(scenarioId, name.trim());
      await loadScenarios(created.id);
      notify('success', `Cenário "${created.name}" criado.`);
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Falha ao duplicar cenário');
    }
  }

  async function handleRename() {
    const current = scenarios.find((s) => s.id === scenarioId);
    const name = prompt('Novo nome do cenário:', current?.name);
    if (!name || !name.trim()) return;
    try {
      await api.renameScenario(scenarioId, name.trim());
      await loadScenarios(scenarioId);
      notify('success', 'Cenário renomeado.');
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Falha ao renomear cenário');
    }
  }

  async function handleDelete() {
    const current = scenarios.find((s) => s.id === scenarioId);
    if (!current || current.isBase) return;
    if (!confirm(`Excluir o cenário "${current.name}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await api.deleteScenario(scenarioId);
      await loadScenarios();
      notify('success', 'Cenário excluído.');
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Falha ao excluir cenário');
    }
  }

  async function handleLogout() {
    await api.logout();
    onLogout();
  }

  if (loading && items.length === 0) {
    return <Loader label="Carregando o plano" />;
  }

  return (
    <>
      <header className="topbar">
        <div className="wrap topbar-in">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M6 17v-4m6 4V8m6 9V4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
            </div>
            <div className="brand-name">
              Meu financeiro
              <small>planejamento pessoal</small>
            </div>
          </div>
          <nav className="tab-bar" aria-label="Seções">
            <button className={activeTab === 'overview' ? 'active' : ''} aria-current={activeTab === 'overview' ? 'page' : undefined} onClick={() => setActiveTab('overview')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
              Visão geral
            </button>
            <button className={activeTab === 'debts' ? 'active' : ''} aria-current={activeTab === 'debts' ? 'page' : undefined} onClick={() => setActiveTab('debts')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></svg>
              Dívidas
            </button>
            <button className={activeTab === 'cards' ? 'active' : ''} aria-current={activeTab === 'cards' ? 'page' : undefined} onClick={() => setActiveTab('cards')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 10h19M6.5 15h4" /></svg>
              Cartões
            </button>
            <button className={activeTab === 'openfinance' ? 'active' : ''} aria-current={activeTab === 'openfinance' ? 'page' : undefined} onClick={() => setActiveTab('openfinance')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 10l9-6 9 6M5 10v8M9.500 10v8M14.500 10v8M19 10v8M3 20h18" /></svg>
              Open Finance
            </button>
            <button className={activeTab === 'alerts' ? 'active' : ''} aria-current={activeTab === 'alerts' ? 'page' : undefined} onClick={() => setActiveTab('alerts')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 1 1 12 0c0 6 2.500 7 2.500 7h-17S6 15 6 9zM10 20a2 2 0 0 0 4 0" /></svg>
              Alertas
            </button>
          </nav>
          <ScenarioBar
            scenarios={scenarios}
            selectedId={scenarioId}
            onSelect={setScenarioId}
            onCreate={handleCreate}
            onDuplicate={handleDuplicate}
            onRename={handleRename}
            onDelete={handleDelete}
            onLogout={handleLogout}
            extra={<AlertsBell notify={notify} />}
          />
        </div>
      </header>
      <main className="wrap page">
        {activeTab === 'overview' && (
          <>
            <DashboardCards
              monthly={monthly}
              planStatus={planStatus}
              emergencyReserve={emergencyReserve}
              onChangeEmergencyReserve={handleChangeEmergencyReserve}
            />

            <BudgetSection data={budget} onLink={handleLinkPayment} onMove={handleMoveMerchant} />

            <section>
              <h2>Rendimentos e gastos</h2>
              <PlanilhaTable
                items={items}
                monthly={monthly}
                months={months}
                budget={budget}
                onChangeValue={handleChangeValue}
                onChangeMeta={handleChangeItemMeta}
                onMarkPaid={handleMarkPaid}
                simLeft={simLeft}
                onSimulate={() => setSimLeft((s) => (s > 0 ? 0 : 30))}
                onAddItem={handleAddItem}
                onDeleteItem={handleDeleteItem}
                onReorder={handleReorder}
                onRenameMonth={handleRenameMonth}
                onAddMonth={handleAddMonth}
                onRemoveMonth={handleRemoveMonth}
              />
              <div className="legend">
                <span>
                  Edite qualquer valor: a planilha recalcula e <b style={{ color: 'var(--green)' }}>salva sozinha</b>
                  <span id="saveStatus" style={{ color: 'var(--green)' }}>
                    {saveStatus}
                  </span>
                </span>
              </div>
              <button className="reset" onClick={handleReset}>
                Restaurar projeção original
              </button>
              <button className="primary" onClick={handleSaveNow}>
                Salvar cenário atual
              </button>
            </section>

            <HistorySection archives={archives} onRestore={handleRestoreMonth} />
          </>
        )}

        {activeTab === 'debts' && (
          <DebtsSection debts={debts} onChange={handleChangeDebts} onAdd={handleAddDebt} onDelete={handleDeleteDebt} onSave={handleSaveNow} cardDebt={budget?.cardDebt ?? null} />
        )}

        {activeTab === 'cards' && <CardsSection />}

        {activeTab === 'openfinance' && <OpenFinanceSection notify={notify} />}

        {activeTab === 'alerts' && <AlertsSection notify={notify} />}

        <BackupBar currentScenarioId={scenarioId} onImported={() => loadScenarios()} notify={notify} />

        <footer>meu financeiro · cenário: {scenarios.find((s) => s.id === scenarioId)?.name ?? '—'}</footer>
      </main>

      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </>
  );
}
