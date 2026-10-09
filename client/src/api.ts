import { AlertsConfig, AlertsHistoryItem, AlertsSettings, AlertsState, Bridge, Budget, CardsOverview, ConnectionTest, ConnectProgress, MonthArchive, OpenFinanceStatus, Debt, DebtPayment, LineItem, Scenario, ScenarioFull, ScenarioTexts } from './types';

const BASE = '/api';

class ApiError extends Error {}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(message);
  }
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

export { ApiError };

export const api = {
  me: () => request<{ authenticated: boolean }>('/auth/me'),
  login: (username: string, password: string) =>
    request<{ ok: true } | { ok: false; twoFactor: true; challenge: string; via: 'telegram' | 'email' }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  verifyLogin: (challenge: string, code: string) => request<{ ok: true }>('/auth/verify', { method: 'POST', body: JSON.stringify({ challenge, code }) }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),

  listScenarios: () => request<Scenario[]>('/scenarios'),
  getScenario: (id: string) => request<ScenarioFull>(`/scenarios/${id}`),
  createScenario: (name: string, duplicateFromId?: string) =>
    request<Scenario>('/scenarios', { method: 'POST', body: JSON.stringify({ name, duplicateFromId }) }),
  renameScenario: (id: string, name: string) =>
    request<Scenario>(`/scenarios/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteScenario: (id: string) => request<{ ok: true }>(`/scenarios/${id}`, { method: 'DELETE' }),
  duplicateScenario: (id: string, name: string) =>
    request<Scenario>(`/scenarios/${id}/duplicate`, { method: 'POST', body: JSON.stringify({ name }) }),
  resetScenario: (id: string) => request<{ ok: true }>(`/scenarios/${id}/reset`, { method: 'POST' }),

  updateItems: (id: string, items: LineItem[]) =>
    request<{ ok: true }>(`/scenarios/${id}/items`, { method: 'PUT', body: JSON.stringify({ items }) }),
  addItem: (id: string, section: 'entrada' | 'saida') =>
    request<LineItem>(`/scenarios/${id}/items`, { method: 'POST', body: JSON.stringify({ section }) }),
  deleteItem: (id: string, itemId: string) =>
    request<{ ok: true }>(`/scenarios/${id}/items/${itemId}`, { method: 'DELETE' }),
  updateDebts: (id: string, debts: Debt[]) =>
    request<{ ok: true }>(`/scenarios/${id}/debts`, { method: 'PUT', body: JSON.stringify({ debts }) }),
  addDebt: (id: string) => request<Debt>(`/scenarios/${id}/debts`, { method: 'POST' }),
  deleteDebt: (id: string, debtId: string) =>
    request<{ ok: true }>(`/scenarios/${id}/debts/${debtId}`, { method: 'DELETE' }),
  addDebtPayment: (id: string, debtId: string, payment: { paidAt: string; amount: number; installment?: number; note?: string }) =>
    request<DebtPayment>(`/scenarios/${id}/debts/${debtId}/payments`, { method: 'POST', body: JSON.stringify(payment) }),
  deleteDebtPayment: (id: string, debtId: string, paymentId: string) =>
    request<{ ok: true }>(`/scenarios/${id}/debts/${debtId}/payments/${paymentId}`, { method: 'DELETE' }),
  updateBridge: (id: string, bridge: Bridge) =>
    request<{ ok: true }>(`/scenarios/${id}/bridge`, { method: 'PUT', body: JSON.stringify(bridge) }),
  updateReserve: (id: string, emergencyReserve: number) =>
    request<{ ok: true }>(`/scenarios/${id}/reserve`, { method: 'PUT', body: JSON.stringify({ emergencyReserve }) }),
  updateText: <K extends keyof ScenarioTexts>(id: string, key: K, content: ScenarioTexts[K]) =>
    request<{ ok: true }>(`/scenarios/${id}/texts/${key}`, { method: 'PUT', body: JSON.stringify(content) }),
  monthArchives: (id: string) => request<MonthArchive[]>(`/scenarios/${id}/archives`),
  restoreMonth: (id: string, archiveId: string) =>
    request<{ ok: true; missing: Array<{ name: string; value: number }> }>(`/scenarios/${id}/archives/${archiveId}/restore`, { method: 'POST' }),
  updateMonths: (id: string, months: string[], removeIndex?: number, copyFromIndex?: number, shownTotals?: { entradas: number; saidas: number; saldo: number }) =>
    request<{ ok: true }>(`/scenarios/${id}/months`, {
      method: 'PUT',
      body: JSON.stringify({ months, ...(removeIndex === undefined ? {} : { removeIndex }), ...(copyFromIndex === undefined ? {} : { copyFromIndex }), ...(shownTotals ? { shownTotals } : {}) }),
    }),
  updateBridgeMonths: (id: string, bridgeMonths: string[]) =>
    request<{ ok: true }>(`/scenarios/${id}/bridge-months`, { method: 'PUT', body: JSON.stringify({ bridgeMonths }) }),

  budget: (scenarioId: string) => request<Budget>(`/openfinance/budget?${new URLSearchParams({ scenarioId })}`),
  cards: (period: { months: number } | { from: string; to: string } | { bill: true }, accountId?: string) =>
    request<CardsOverview>(
      `/openfinance/cards?${new URLSearchParams({
        ...('from' in period ? period : 'bill' in period ? { period: 'bill' } : { months: String(period.months) }),
        ...(accountId ? { accountId } : {}),
      })}`,
    ),

  alerts: () => request<AlertsState>('/alerts'),
  readAlerts: () => request<{ ok: true }>('/alerts/read', { method: 'POST' }),
  dismissAlert: (id: string) => request<{ ok: true }>(`/alerts/${id}/dismiss`, { method: 'POST' }),
  runAlerts: () => request<{ created: number }>('/alerts/run', { method: 'POST' }),
  linkTelegram: () => request<{ ok: true; name: string }>('/alerts/telegram/link', { method: 'POST' }),
  testAlerts: (channel?: 'telegram' | 'email') =>
    request<{ results: Array<{ channel: 'telegram' | 'email'; ok: boolean; error?: string }> }>('/alerts/test', { method: 'POST', body: JSON.stringify(channel ? { channel } : {}) }),
  unlinkTelegram: () => request<{ ok: true }>('/alerts/telegram/unlink', { method: 'POST' }),
  alertSettings: () => request<AlertsSettings>('/alerts/settings'),
  alertHistory: () => request<AlertsHistoryItem[]>('/alerts/history'),
  // Segredos: texto grava, null apaga, ausente mantém.
  saveAlertSettings: (config: AlertsConfig, secrets: { telegramToken?: string | null; smtpPass?: string | null } = {}) =>
    request<AlertsSettings>('/alerts/settings', { method: 'PUT', body: JSON.stringify({ config, ...secrets }) }),

  openFinanceStatus: () => request<OpenFinanceStatus>('/openfinance/status'),
  syncOpenFinance: () => request<{ started: boolean }>('/openfinance/sync', { method: 'POST' }),
  connectBank: () => request<ConnectProgress>('/openfinance/connect', { method: 'POST' }),
  reconnectBank: (id: string) => request<ConnectProgress>(`/openfinance/connections/${id}/reconnect`, { method: 'POST' }),
  connectProgress: (itemId: string) => request<ConnectProgress>(`/openfinance/connect/${itemId}`),
  testConnection: (id: string) => request<ConnectionTest>(`/openfinance/connections/${id}/test`, { method: 'POST' }),

  markPaid: (itemId: string, month: string, paid: boolean) =>
    request<{ ok: true }>('/openfinance/paid-marks', { method: 'PUT', body: JSON.stringify({ itemId, month, paid }) }),

  // Corrige só a categoria de um estabelecimento (vale para todos os lançamentos dele).
  setMerchantCategory: (key: string, category: string) =>
    request<{ ok: true }>('/openfinance/merchant-labels', { method: 'PUT', body: JSON.stringify({ key, category }) }),

  setMerchantLabel: (key: string, name: string, kind: string) =>
    request<{ ok: true }>('/openfinance/merchant-labels', { method: 'PUT', body: JSON.stringify({ key, name, kind }) }),

  exportUrl: (id: string) => `${BASE}/scenarios/${id}/export`,
  importScenario: (payload: unknown) =>
    request<Scenario>('/scenarios/import', { method: 'POST', body: JSON.stringify(payload) }),
};
