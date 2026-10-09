// Cliente mínimo da API da Pluggy (https://docs.pluggy.ai). Lê os dados e cria/atualiza itens (conexões).

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface PluggyConfig {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

export class PluggyError extends Error {
  constructor(
    public status: number,
    public path: string,
    message: string,
  ) {
    super(`Pluggy ${status} em ${path}: ${message}`);
  }
}

// A API key vale 2h; renovamos com folga.
const API_KEY_TTL_MS = 100 * 60 * 1000;
const MAX_PAGES = 200;
const PAGE_SIZE = 500;

export class PluggyClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private apiKey: string | null = null;
  private apiKeyAt = 0;

  constructor(private readonly config: PluggyConfig) {
    this.baseUrl = (config.baseUrl ?? 'https://api.pluggy.ai').replace(/\/$/, '');
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private async authenticate(): Promise<string> {
    if (this.apiKey && Date.now() - this.apiKeyAt < API_KEY_TTL_MS) return this.apiKey;
    const res = await this.fetchImpl(`${this.baseUrl}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ clientId: this.config.clientId, clientSecret: this.config.clientSecret }),
    });
    if (!res.ok) throw new PluggyError(res.status, '/auth', await safeMessage(res));
    const body = (await res.json()) as { apiKey?: string };
    if (!body.apiKey) throw new PluggyError(res.status, '/auth', 'resposta sem apiKey');
    this.apiKey = body.apiKey;
    this.apiKeyAt = Date.now();
    return this.apiKey;
  }

  // `pathOrUrl` pode ser um caminho ("/accounts?itemId=...") ou o link `next` devolvido pela API.
  private async get<T>(pathOrUrl: string, retry = true): Promise<T> {
    const url = new URL(pathOrUrl, `${this.baseUrl}/`).toString();
    const apiKey = await this.authenticate();
    const res = await this.fetchImpl(url, { headers: { 'X-API-KEY': apiKey, accept: 'application/json' } });
    if ((res.status === 401 || res.status === 403) && retry) {
      this.apiKey = null;
      return this.get<T>(pathOrUrl, false);
    }
    if (res.status === 429 && retry) {
      await new Promise((r) => setTimeout(r, 2000));
      return this.get<T>(pathOrUrl, false);
    }
    if (!res.ok) throw new PluggyError(res.status, new URL(url).pathname, await safeMessage(res));
    return (await res.json()) as T;
  }

  // Listagens clássicas: { page, total, totalPages, results }.
  private async getAllPages<T>(path: string, params: Record<string, string>): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const qs = new URLSearchParams({ ...params, pageSize: String(PAGE_SIZE), page: String(page) });
      const body = await this.get<{ results?: T[]; totalPages?: number }>(`${path}?${qs}`);
      out.push(...(body.results ?? []));
      if (!body.totalPages || page >= body.totalPages) break;
    }
    return out;
  }

  // Escrita: criar um item ou pedir a atualização de um existente.
  private async send<T>(method: 'POST' | 'PATCH', path: string, body: unknown, retry = true): Promise<T> {
    const apiKey = await this.authenticate();
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: { 'X-API-KEY': apiKey, accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if ((res.status === 401 || res.status === 403) && retry) {
      this.apiKey = null;
      return this.send<T>(method, path, body, false);
    }
    if (!res.ok) throw new PluggyError(res.status, path, await safeMessage(res));
    return (await res.json()) as T;
  }

  // Novo item: a Pluggy devolve o item em espera, com o link para o usuário autorizar no banco.
  createItem(connectorId: number): Promise<any> {
    return this.send('POST', '/items', { connectorId, parameters: {} });
  }

  // Pede nova coleta de um item; se a autorização venceu, ele volta a esperar o usuário.
  updateItem(itemId: string): Promise<any> {
    return this.send('PATCH', `/items/${encodeURIComponent(itemId)}`, {});
  }

  getItem(itemId: string): Promise<any> {
    return this.get(`/items/${encodeURIComponent(itemId)}`);
  }

  async getAccounts(itemId: string): Promise<any[]> {
    const body = await this.get<{ results?: any[] }>(`/accounts?itemId=${encodeURIComponent(itemId)}`);
    return body.results ?? [];
  }

  // GET /v2/transactions: paginação por cursor. `next` vem só como query string
  // ("?accountId=...&after=<cursor>") e deve ser reenviado como veio, sem recodificar o cursor.
  async getTransactions(accountId: string, dateFrom: string): Promise<any[]> {
    const path = '/v2/transactions';
    const out: any[] = [];
    let next: string | null = `${path}?${new URLSearchParams({ accountId, dateFrom })}`;
    for (let page = 0; next && page < MAX_PAGES; page++) {
      const body: { results?: any[]; next?: string | null } = await this.get(next);
      out.push(...(body.results ?? []));
      next = body.next ? (body.next.startsWith('?') ? `${path}${body.next}` : body.next) : null;
    }
    return out;
  }

  getBills(accountId: string): Promise<any[]> {
    return this.getAllPages('/bills', { accountId });
  }

  getInvestments(itemId: string): Promise<any[]> {
    return this.getAllPages('/investments', { itemId });
  }

  getLoans(itemId: string): Promise<any[]> {
    return this.getAllPages('/loans', { itemId });
  }
}

async function safeMessage(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      return String(json.message ?? json.error ?? text).slice(0, 300);
    } catch {
      return text.slice(0, 300);
    }
  } catch {
    return res.statusText;
  }
}

export function pluggyConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PluggyConfig | null {
  const clientId = env.PLUGGY_CLIENT_ID?.trim();
  const clientSecret = env.PLUGGY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, baseUrl: env.PLUGGY_API_URL?.trim() || undefined };
}
