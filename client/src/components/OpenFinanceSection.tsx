import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { ConnectProgress, ConnectionTest, OpenFinanceStatus } from '../types';
import { bankOf } from './CardsSection';
import Loader from './Loader';
import '../openfinance.css';

type Connection = OpenFinanceStatus['connections'][number];

const when = (iso: string | null) => {
  if (!iso) return 'nunca';
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return 'há menos de 1 hora';
  if (hours < 48) return `há ${hours} h`;
  return `há ${Math.floor(hours / 24)} dias`;
};
const date = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'America/Sao_Paulo' });

// Situação da conexão em palavras; a cor só reforça.
function situation(c: Connection): { tone: 'ok' | 'warn' | 'high'; label: string; needsReconnect: boolean } {
  if (c.consentExpiresAt && new Date(c.consentExpiresAt).getTime() < Date.now()) return { tone: 'high', label: 'Autorização vencida', needsReconnect: true };
  if (c.status === 'UPDATED') return { tone: 'ok', label: 'Conectado', needsReconnect: false };
  if (c.status === 'UPDATING') return { tone: 'warn', label: 'Atualizando', needsReconnect: false };
  if (c.status === 'WAITING_USER_INPUT') return { tone: 'warn', label: 'Aguardando autorização', needsReconnect: true };
  return { tone: 'high', label: 'Precisa reconectar', needsReconnect: true };
}

const MARK = { ok: '✓', warn: '!', fail: '✕' } as const;
const VERDICT = { ok: 'Conexão saudável', warn: 'Funciona, com avisos', fail: 'Com problema' } as const;

export default function OpenFinanceSection({ notify: notifyNow }: { notify: (type: 'success' | 'error', msg: string) => void }) {
  // A função do pai muda a cada renderização; a referência evita reiniciar o acompanhamento por isso.
  const notifyRef = useRef(notifyNow);
  notifyRef.current = notifyNow;
  const notify = useCallback((type: 'success' | 'error', msg: string) => notifyRef.current(type, msg), []);
  const [status, setStatus] = useState<OpenFinanceStatus | null>(null);
  const [error, setError] = useState('');
  const [tests, setTests] = useState<Record<string, ConnectionTest | 'running'>>({});
  // Conexão em andamento (nova ou reconexão): link para autorizar e acompanhamento até os dados chegarem.
  const [flow, setFlow] = useState<(ConnectProgress & { title: string; loading?: boolean; done?: boolean }) | null>(null);
  const [busy, setBusy] = useState('');
  const timer = useRef<number | null>(null);

  const load = useCallback(
    () =>
      api
        .openFinanceStatus()
        .then((s) => {
          setStatus(s);
          setError('');
        })
        .catch((e: Error) => setError(e.message)),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  // Enquanto há uma conexão em andamento, consulta a cada 4 s até os dados estarem carregados.
  useEffect(() => {
    if (!flow || flow.done || flow.error) return;
    timer.current = window.setTimeout(async () => {
      try {
        const next = await api.connectProgress(flow.itemId);
        setFlow((f) => (f && f.itemId === next.itemId ? { ...f, ...next, url: next.url ?? f.url } : f));
        if (next.done) {
          notify('success', 'Banco conectado e dados carregados.');
          load();
        }
      } catch (e) {
        setFlow((f) => (f ? { ...f, error: e instanceof Error ? e.message : 'Falha ao consultar a conexão' } : f));
      }
    }, 4000);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [flow, load, notify]);

  const start = async (title: string, key: string, action: () => Promise<ConnectProgress>) => {
    setBusy(key);
    try {
      setFlow({ ...(await action()), title });
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Não foi possível iniciar a conexão');
    } finally {
      setBusy('');
    }
  };

  const test = async (id: string) => {
    setTests((t) => ({ ...t, [id]: 'running' }));
    try {
      const result = await api.testConnection(id);
      setTests((t) => ({ ...t, [id]: result }));
      load();
    } catch (e) {
      setTests((t) => {
        const { [id]: _removed, ...rest } = t;
        return rest;
      });
      notify('error', e instanceof Error ? e.message : 'Falha no teste da conexão');
    }
  };

  const sync = async () => {
    setBusy('sync');
    try {
      await api.syncOpenFinance();
      notify('success', 'Sincronização iniciada: os dados novos aparecem em alguns minutos.');
      load();
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Não foi possível sincronizar');
    } finally {
      setBusy('');
    }
  };

  if (!status) {
    return (
      <section className="of">
        <h2>Open Finance</h2>
        {error ? <p className="of-empty">Não foi possível carregar as conexões: {error}</p> : <Loader label="Carregando as conexões" compact />}
      </section>
    );
  }

  return (
    <section className="of">
      <h2>Open Finance</h2>
      <p className="of-lead">
        {status.connections.length} banco(s) conectado(s) · {status.totals.transactions.toLocaleString('pt-BR')} lançamentos guardados
      </p>

      <div className="of-actions">
        <button className="primary" disabled={!status.configured || busy !== ''} onClick={() => start('Conectar um novo banco', 'connect', api.connectBank)}>
          {busy === 'connect' ? 'Preparando…' : 'Conectar banco'}
        </button>
        <button className="reset" disabled={!status.configured || busy !== '' || status.syncing} onClick={sync}>
          {status.syncing ? 'Sincronizando…' : 'Sincronizar agora'}
        </button>
        <button className="reset" disabled={status.connections.length === 0} onClick={() => status.connections.forEach((c) => test(c.id))}>
          Testar todas
        </button>
      </div>
      {!status.configured && <div className="alert-box">A Pluggy não está configurada no servidor: sem as chaves não é possível conectar nem sincronizar.</div>}

      {flow && (
        <div className="of-flow" role="status" aria-live="polite">
          <div className="of-flow-head">
            <h3>{flow.title}</h3>
            <button className="of-close" onClick={() => setFlow(null)} aria-label="Fechar">
              Fechar
            </button>
          </div>
          {flow.error ? (
            <p className="of-flow-error">Não deu certo: {flow.error}</p>
          ) : flow.done ? (
            <p className="of-flow-done">✓ Pronto: o banco está conectado e os dados foram carregados.</p>
          ) : (
            <ol className="of-steps">
              <li className={flow.url ? 'current' : 'done'}>
                <b>Autorize no banco</b>
                {flow.url ? (
                  <>
                    <span>Abra o link, escolha o banco e confirme o compartilhamento. Depois volte para esta tela.</span>
                    <a className="of-link" href={flow.url} target="_blank" rel="noopener noreferrer">
                      Abrir a autorização
                    </a>
                  </>
                ) : (
                  <span>{flow.status === 'WAITING_USER_INPUT' ? 'O link de autorização ainda não chegou; aguarde alguns segundos.' : 'Nenhuma autorização pendente: a conexão segue válida.'}</span>
                )}
              </li>
              <li className={flow.status === 'UPDATING' ? 'current' : flow.status === 'UPDATED' ? 'done' : ''}>
                <b>O banco entrega os dados</b>
                <span>{flow.status === 'UPDATING' ? 'A Pluggy está coletando os dados no banco.' : flow.status === 'UPDATED' ? 'Coleta concluída.' : 'Começa depois da autorização.'}</span>
              </li>
              <li className={flow.loading ? 'current' : ''}>
                <b>Carregamos os dados aqui</b>
                <span>{flow.loading ? 'Guardando contas, cartões e lançamentos.' : 'Último passo, automático.'}</span>
              </li>
            </ol>
          )}
        </div>
      )}

      {status.connections.length === 0 ? (
        <p className="of-empty">Nenhum banco conectado ainda. Use “Conectar banco” para começar.</p>
      ) : (
        <div className="of-grid">
          {status.connections.map((c) => {
            const name = c.accounts.find((a) => a.type === 'BANK')?.name ?? c.accounts[0]?.name ?? c.connector;
            const bank = bankOf(name);
            const s = situation(c);
            const result = tests[c.id];
            const cards = c.accounts.filter((a) => a.type === 'CREDIT').length;
            const banks = c.accounts.length - cards;
            return (
              <article className="of-card" key={c.id}>
                <header>
                  <span className="cx-badge" style={{ background: bank.bg, color: bank.fg }} aria-hidden="true">
                    {bank.mono}
                  </span>
                  <div className="of-card-id">
                    <b>{bank.name}</b>
                    <small>
                      {banks} conta(s) · {cards} cartão(ões) · {c.accounts.reduce((n, a) => n + a.transactions, 0).toLocaleString('pt-BR')} lançamentos
                    </small>
                  </div>
                  <span className={`tag ${s.tone}`}>{s.label}</span>
                </header>
                <dl>
                  <div>
                    <dt>Coleta no banco</dt>
                    <dd>{when(c.providerUpdatedAt)}</dd>
                  </div>
                  <div>
                    <dt>Carregado aqui</dt>
                    <dd>{when(c.lastSyncedAt)}</dd>
                  </div>
                  <div>
                    <dt>Autorização</dt>
                    <dd>{c.consentExpiresAt ? `até ${date(c.consentExpiresAt)}` : 'sem data informada'}</dd>
                  </div>
                </dl>
                {c.error && <p className="of-card-error">{c.error}</p>}
                <div className="of-card-actions">
                  <button className="reset" disabled={result === 'running'} onClick={() => test(c.id)}>
                    {result === 'running' ? 'Testando…' : 'Testar conexão'}
                  </button>
                  {/* Só quando há problema: reconectar uma conexão saudável não traria nada e poderia interrompê-la. */}
                  <button
                    className={s.needsReconnect ? 'primary' : 'reset'}
                    disabled={!status.configured || busy !== '' || !s.needsReconnect}
                    title={
                      s.needsReconnect
                        ? 'Renova o acesso deste banco. As contas e o histórico já guardados continuam os mesmos.'
                        : 'A conexão está saudável: não há o que reconectar.'
                    }
                    onClick={() => start(`Reconectar ${bank.name}`, c.id, () => api.reconnectBank(c.id))}
                  >
                    {busy === c.id ? 'Preparando…' : 'Reconectar'}
                  </button>
                </div>
                {result && result !== 'running' && (
                  <div className={`of-test ${result.state}`}>
                    <p>
                      <b>
                        {MARK[result.state]} {VERDICT[result.state]}
                      </b>
                      <small>
                        {result.checks.filter((k) => k.state === 'ok').length} de {result.checks.length} verificações sem ressalva
                      </small>
                    </p>
                    <ul>
                      {result.checks.map((k) => (
                        <li key={k.id} className={k.state}>
                          <i aria-hidden="true">{MARK[k.state]}</i>
                          <span>
                            {k.label}
                            <small>{k.detail}</small>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {status.runs.length > 0 && (
        <div className="of-runs">
          <h3>Últimas sincronizações</h3>
          <ul>
            {status.runs.map((r) => {
              const c = status.connections.find((x) => x.id === r.connectionId);
              const name = c ? bankOf(c.accounts.find((a) => a.type === 'BANK')?.name ?? c.accounts[0]?.name ?? c.connector).name : 'Conexão';
              const tone = r.status === 'success' ? 'ok' : r.status === 'error' ? 'high' : 'warn';
              const label = r.status === 'success' ? 'concluída' : r.status === 'error' ? 'erro' : r.status === 'partial' ? 'com avisos' : 'em andamento';
              return (
                <li key={r.id}>
                  <span>
                    {name}
                    <small>
                      {when(r.startedAt)} · {r.trigger === 'manual' ? 'manual' : 'automática'}
                      {r.stats?.transactions ? ` · ${r.stats.transactions} lançamentos` : ''}
                    </small>
                  </span>
                  <span className={`tag ${tone}`} title={r.error ?? r.stats?.warnings?.join(' · ') ?? undefined}>
                    {label}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
