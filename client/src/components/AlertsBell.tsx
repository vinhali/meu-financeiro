import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { AlertsState } from '../types';
import '../alerts.css';

const LEVEL: Record<string, { tag: string; label: string }> = {
  urgent: { tag: 'high', label: 'urgente' },
  attention: { tag: 'warn', label: 'atenção' },
  info: { tag: 'info', label: 'aviso' },
};
const when = (iso: string) => {
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return 'agora há pouco';
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.floor(hours / 24)} dia(s)`;
};

// Sino da barra superior: alertas em aberto e a situação dos canais (Telegram e e-mail).
export default function AlertsBell({ notify }: { notify: (type: 'success' | 'error', msg: string) => void }) {
  const [state, setState] = useState<AlertsState | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(() => api.alerts().then(setState).catch(() => undefined), []);
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  // Fecha ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    // Abrir a lista marca tudo como lido (o contador some; os alertas continuam ali).
    if (next && state && state.unread > 0) {
      await api.readAlerts().catch(() => undefined);
      setState((s) => (s ? { ...s, unread: 0 } : s));
    }
  };

  const act = async (key: string, action: () => Promise<string>) => {
    setBusy(key);
    try {
      notify('success', await action());
      await load();
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Não deu certo');
    } finally {
      setBusy('');
    }
  };

  const channels = state?.channels;
  return (
    <div className="al" ref={box}>
      <button type="button" className="btn-ghost al-bell" onClick={toggle} aria-expanded={open} aria-label={`Alertas${state?.unread ? `: ${state.unread} não lido(s)` : ''}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9a6 6 0 1 1 12 0c0 6 2.500 7 2.500 7h-17S6 15 6 9zM10 20a2 2 0 0 0 4 0" />
        </svg>
        {state && state.unread > 0 && <b>{state.unread > 9 ? '9+' : state.unread}</b>}
      </button>
      {open && (
        <div className="al-panel" role="dialog" aria-label="Alertas">
          <header>
            <h3>Alertas</h3>
            <button type="button" className="tag-btn" disabled={busy !== ''} onClick={() => act('run', async () => ((await api.runAlerts()).created ? 'Há alertas novos.' : 'Nada de novo agora.'))}>
              {busy === 'run' ? 'verificando…' : 'verificar agora'}
            </button>
          </header>
          {!state ? (
            <p className="al-empty">Carregando…</p>
          ) : state.alerts.length === 0 ? (
            <p className="al-empty">Nada pedindo atenção. O resumo do dia chega de manhã pelos canais abaixo.</p>
          ) : (
            <ul className="al-list">
              {state.alerts.map((a) => (
                <li key={a.id}>
                  <div>
                    <span className={`tag ${LEVEL[a.severity]?.tag ?? ''}`}>{LEVEL[a.severity]?.label ?? a.severity}</span>
                    <small>{when(a.createdAt)}</small>
                    <button type="button" className="al-x" title="Dispensar este alerta" aria-label={`Dispensar: ${a.title}`} onClick={() => act(a.id, async () => (await api.dismissAlert(a.id), 'Alerta dispensado.'))}>
                      ×
                    </button>
                  </div>
                  <b>{a.title}</b>
                  <p>{a.body}</p>
                </li>
              ))}
            </ul>
          )}
          {channels && (
            <footer>
              <div>
                <span>Telegram</span>
                {!channels.telegram.configured ? (
                  <small>configure na aba Alertas</small>
                ) : channels.telegram.linked ? (
                  <small className="ok">✓ vinculado</small>
                ) : (
                  <button
                    type="button"
                    className="tag-btn"
                    disabled={busy !== ''}
                    title="Antes, abra o seu bot no Telegram e mande /start"
                    onClick={() => act('link', async () => `Telegram vinculado (${(await api.linkTelegram()).name}).`)}
                  >
                    {busy === 'link' ? 'procurando…' : 'vincular'}
                  </button>
                )}
              </div>
              <div>
                <span>E-mail</span>
                <small className={channels.email.configured ? 'ok' : undefined}>{channels.email.configured ? `✓ ${channels.email.to}` : 'configure na aba Alertas'}</small>
              </div>
              <button
                type="button"
                className="tag-btn"
                disabled={busy !== '' || !((channels.telegram.configured && channels.telegram.linked) || channels.email.configured)}
                onClick={() =>
                  act('test', async () => {
                    const { results } = await api.testAlerts();
                    const failed = results.filter((r) => !r.ok);
                    if (failed.length) throw new Error(failed.map((r) => `${r.channel}: ${r.error}`).join(' · '));
                    return `Resumo enviado por ${results.map((r) => (r.channel === 'email' ? 'e-mail' : 'Telegram')).join(' e ')}.`;
                  })
                }
              >
                {busy === 'test' ? 'enviando…' : 'enviar o resumo agora'}
              </button>
            </footer>
          )}
        </div>
      )}
    </div>
  );
}
