// Teste de qualidade de uma conexão do Open Finance: junta o que a Pluggy diz do item agora com o
// que temos guardado, e devolve uma lista de verificações. Funções puras, para testar sem rede.

export type CheckState = 'ok' | 'warn' | 'fail';
export interface Check {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
}

export interface HealthInput {
  now: Date;
  // Resposta de GET /items/{id}; null quando a chamada falhou (o erro vai em `apiError`).
  item: any | null;
  apiError?: string | null;
  latencyMs?: number | null;
  remoteAccounts: number | null;
  local: {
    accounts: Array<{ name: string; type: string; transactions: number; latest: Date | null }>;
    lastRun: { status: string; finishedAt: Date | null; warnings: string[]; error: string | null } | null;
  };
}

const DAY = 86_400_000;
const days = (ms: number) => Math.floor(ms / DAY);
const ago = (d: Date, now: Date) => {
  const h = Math.floor((now.getTime() - d.getTime()) / 3_600_000);
  return h < 1 ? 'há menos de 1 hora' : h < 48 ? `há ${h} hora(s)` : `há ${Math.floor(h / 24)} dia(s)`;
};

const STATUS_TEXT: Record<string, string> = {
  UPDATED: 'conectado e atualizado',
  UPDATING: 'atualizando agora',
  WAITING_USER_INPUT: 'aguardando a sua autorização',
  LOGIN_ERROR: 'o banco recusou o acesso: é preciso reconectar',
  OUTDATED: 'a última atualização falhou',
};

// Link de autorização que a Pluggy devolve enquanto espera o usuário (o campo muda de lugar
// conforme o conector); endereços de imagem e do site da instituição não contam.
export function authorizationUrl(item: any): string | null {
  const found: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (typeof value === 'string') {
      if (/^https:\/\//.test(value) && !/imageUrl|institutionUrl/i.test(path)) found.push(value);
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
    }
  };
  walk({ parameter: item?.parameter, userAction: item?.userAction, oauthUrl: item?.oauthUrl }, '');
  return found[0] ?? null;
}

export function checkConnection(input: HealthInput): { state: CheckState; checks: Check[] } {
  const { now, item, local } = input;
  const checks: Check[] = [];
  const add = (id: string, label: string, state: CheckState, detail: string) => checks.push({ id, label, state, detail });

  if (!item) {
    add('api', 'Acesso à Pluggy', 'fail', input.apiError ?? 'a Pluggy não respondeu');
  } else {
    const slow = (input.latencyMs ?? 0) > 5000;
    add('api', 'Acesso à Pluggy', slow ? 'warn' : 'ok', input.latencyMs != null ? `respondeu em ${input.latencyMs} ms` : 'respondeu');

    const status = String(item.status ?? 'UNKNOWN');
    const reason = item.error?.message ? ` (${String(item.error.message).slice(0, 160)})` : '';
    add('status', 'Situação da conexão', status === 'UPDATED' ? 'ok' : status === 'UPDATING' ? 'warn' : 'fail', `${STATUS_TEXT[status] ?? status}${reason}`);

    const updated = item.lastUpdatedAt ? new Date(item.lastUpdatedAt) : null;
    if (!updated || Number.isNaN(updated.getTime())) add('fresh', 'Última coleta no banco', 'warn', 'a Pluggy não informou quando coletou');
    else {
      const age = now.getTime() - updated.getTime();
      add('fresh', 'Última coleta no banco', age <= 36 * 3_600_000 ? 'ok' : age <= 72 * 3_600_000 ? 'warn' : 'fail', ago(updated, now));
    }

    const consent = item.consentExpiresAt ? new Date(item.consentExpiresAt) : null;
    if (!consent || Number.isNaN(consent.getTime())) add('consent', 'Validade da autorização', 'ok', 'sem data de expiração informada');
    else {
      const left = days(consent.getTime() - now.getTime());
      add('consent', 'Validade da autorização', left < 0 ? 'fail' : left <= 30 ? 'warn' : 'ok', left < 0 ? `expirou há ${-left} dia(s): reconecte` : `vale por mais ${left} dia(s)`);
    }

    // Por produto (contas, cartões, lançamentos...): a Pluggy marca o que não conseguiu atualizar.
    const products = Object.entries((item.statusDetail ?? {}) as Record<string, any>).filter(([, v]) => v && typeof v === 'object');
    const stale = products.filter(([, v]) => v.isUpdated === false).map(([k]) => k);
    if (products.length) add('products', 'Produtos entregues pelo banco', stale.length ? 'warn' : 'ok', stale.length ? `sem atualização: ${stale.join(', ')}` : `${products.length} produto(s) atualizados`);

    if (input.remoteAccounts !== null) {
      const same = input.remoteAccounts === local.accounts.length;
      add(
        'accounts',
        'Contas e cartões',
        input.remoteAccounts === 0 ? 'fail' : same ? 'ok' : 'warn',
        input.remoteAccounts === 0 ? 'o banco não entregou nenhuma conta' : same ? `${input.remoteAccounts} encontrada(s), todas guardadas` : `${input.remoteAccounts} no banco, ${local.accounts.length} guardada(s): sincronize`,
      );
    }
  }

  // Lançamentos: cada conta deveria ter algo recente. Datas futuras (parcelas adiantadas) não contam.
  const empty = local.accounts.filter((a) => a.transactions === 0);
  const old = local.accounts.filter((a) => a.latest && now.getTime() - a.latest.getTime() > 14 * DAY);
  if (local.accounts.length) {
    const newest = local.accounts.reduce<Date | null>((best, a) => (a.latest && (!best || a.latest > best) ? a.latest : best), null);
    const problems = [
      ...(empty.length ? [`sem lançamentos: ${empty.map((a) => a.name).join(', ')}`] : []),
      ...(old.length ? [`sem novidade há mais de 14 dias: ${old.map((a) => a.name).join(', ')}`] : []),
    ];
    add(
      'transactions',
      'Lançamentos recentes',
      !newest ? 'fail' : problems.length ? 'warn' : 'ok',
      !newest ? 'nenhum lançamento guardado' : problems.length ? problems.join(' · ') : `o mais recente é de ${ago(newest, now)}`,
    );
  }

  const run = local.lastRun;
  if (!run) add('sync', 'Última sincronização', 'warn', 'ainda não sincronizada por aqui');
  else if (run.status === 'error') add('sync', 'Última sincronização', 'fail', run.error ?? 'terminou com erro');
  else if (run.status === 'partial') add('sync', 'Última sincronização', 'warn', run.warnings.slice(0, 2).join(' · ') || 'terminou com avisos');
  else add('sync', 'Última sincronização', 'ok', run.finishedAt ? `concluída ${ago(run.finishedAt, now)}` : 'em andamento');

  const state: CheckState = checks.some((c) => c.state === 'fail') ? 'fail' : checks.some((c) => c.state === 'warn') ? 'warn' : 'ok';
  return { state, checks };
}

// Reconectar só faz sentido quando a conexão está de fato com problema. Pedir nova autorização a
// uma conexão saudável poderia deixá-la esperando o usuário à toa — então, nesse caso, não se mexe.
export function needsReconnect(item: any, now: Date): { needed: boolean; reason: string } {
  const consent = item?.consentExpiresAt ? new Date(item.consentExpiresAt) : null;
  if (consent && !Number.isNaN(consent.getTime()) && consent.getTime() < now.getTime()) return { needed: true, reason: 'a autorização venceu' };
  const status = String(item?.status ?? 'UNKNOWN');
  if (status === 'UPDATED') return { needed: false, reason: 'a conexão está saudável: não há o que reconectar' };
  if (status === 'UPDATING') return { needed: false, reason: 'a conexão já está atualizando: aguarde terminar' };
  return { needed: true, reason: STATUS_TEXT[status] ?? status };
}

// Um banco já conectado não pode entrar de novo como conexão nova: as contas viriam com outros
// identificadores e todos os lançamentos passariam a contar em dobro. Compara as contas da
// conexão nova com as que já existem (mesmo tipo e mesmo número) e devolve a conexão repetida.
export function duplicateConnection(
  incoming: Array<{ type?: unknown; number?: unknown; name?: unknown }>,
  existing: Array<{ connectionId: string; type: string; number: string | null; name: string }>,
): string | null {
  // Conta: o número completo identifica. Cartão: só os 4 últimos dígitos são conhecidos, então o
  // nome do cartão precisa bater também (dois bancos podem coincidir nos 4 dígitos).
  const key = (type: unknown, number: unknown, name: unknown) => {
    const n = typeof number === 'string' ? number.replace(/\s+/g, '') : '';
    if (n.length < 4) return null;
    return type === 'BANK' ? `BANK|${n}` : `${String(type)}|${n}|${typeof name === 'string' ? name.trim().toUpperCase() : ''}`;
  };
  const known = new Map<string, string>();
  for (const a of existing) {
    const k = key(a.type, a.number, a.name);
    if (k) known.set(k, a.connectionId);
  }
  for (const a of incoming) {
    const k = key(a.type, a.number, a.name);
    if (k && known.has(k)) return known.get(k)!;
  }
  return null;
}
