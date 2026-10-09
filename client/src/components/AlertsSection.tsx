import { KeyboardEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { AlertsConfig, AlertsHistoryItem, AlertsSettings } from '../types';
import Loader from './Loader';
import '../alerts.css';

type Notify = (type: 'success' | 'error', msg: string) => void;

// Cada regra, em palavras, com o limiar que ela usa (quando tem).
const RULES: Array<{
  kind: keyof AlertsConfig['rules'];
  title: string;
  detail: string;
  threshold?: { key: keyof AlertsConfig['thresholds']; label: string; suffix: string; percent?: boolean };
}> = [
  { kind: 'billDue', title: 'Fatura vencendo', detail: 'Três dias antes do vencimento e no dia.' },
  { kind: 'late', title: 'Conta fixa atrasada', detail: 'Passou do dia em que costuma sair e nenhum banco mostra o pagamento.' },
  { kind: 'cash', title: 'Dinheiro não cobre a semana', detail: 'O saldo em conta é menor que o que vence nos próximos 7 dias.' },
  { kind: 'limit', title: 'Limites de gasto', detail: 'Ritmo acima do limite, perto do limite e estourado.', threshold: { key: 'limitNear', label: 'a partir de', suffix: '% do limite', percent: true } },
  { kind: 'bigPurchase', title: 'Compra fora do padrão', detail: 'Compra única bem acima do seu tíquete médio.', threshold: { key: 'bigPurchase', label: 'a partir de R$', suffix: '' } },
  { kind: 'newPlan', title: 'Parcelamento novo', detail: 'Compra parcelada nova, com quanto compromete por mês.' },
  { kind: 'monthDrop', title: 'O mês piorou', detail: 'O fechamento de um mês caiu de um dia para o outro.', threshold: { key: 'monthDrop', label: 'queda a partir de R$', suffix: '' } },
  { kind: 'connection', title: 'Dados dos bancos', detail: 'Banco sem atualizar, desconectado ou com a autorização vencendo.', threshold: { key: 'staleHours', label: 'sem atualizar há', suffix: 'horas' } },
];

const LEVEL: Record<string, { tone: string; label: string }> = {
  urgent: { tone: 'high', label: 'urgente' },
  attention: { tone: 'warn', label: 'atenção' },
  info: { tone: 'info', label: 'aviso' },
};
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MAX_RECIPIENTS = 10;
const stamp = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const recipientsOf = (to: string) => to.split(/[\s,;]+/).filter(Boolean);
const looksLikeEmail = (v: string) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(v);

const ICON = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
const TelegramIcon = () => (
  <svg {...ICON}>
    <path d="M21 4 3 11l6 2 2 6 3-4 5 4 2-15z" />
    <path d="m9 13 8-6" />
  </svg>
);
const MailIcon = () => (
  <svg {...ICON}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="m4 7 8 6 8-6" />
  </svg>
);
const ClockIcon = () => (
  <svg {...ICON}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);
const ListIcon = () => (
  <svg {...ICON}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="m3.500 6 1.200 1.200L6.500 5M3.500 12l1.200 1.200L6.500 11M3.500 18l1.200 1.200L6.500 17" />
  </svg>
);

// Um item do painel de situação no topo.
function Status({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: 'ok' | 'warn' | 'off' }) {
  return (
    <li className={tone}>
      <i>{icon}</i>
      <span>
        <small>{label}</small>
        <b>{value}</b>
      </span>
    </li>
  );
}

export default function AlertsSection({ notify }: { notify: Notify }) {
  const [settings, setSettings] = useState<AlertsSettings | null>(null);
  const [config, setConfig] = useState<AlertsConfig | null>(null);
  const [history, setHistory] = useState<AlertsHistoryItem[]>([]);
  const [token, setToken] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [recipient, setRecipient] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([api.alertSettings(), api.alertHistory()]);
      setSettings(s);
      setConfig(s.config);
      setHistory(h);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar');
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Executa uma ação, mostra o resultado e recarrega a tela.
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
  const save = (key: string, secrets: { telegramToken?: string | null; smtpPass?: string | null } = {}, done = 'Configuração salva.', next: AlertsConfig | null = config) =>
    act(key, async () => {
      await api.saveAlertSettings(next!, secrets);
      setToken('');
      setSmtpPass('');
      return done;
    });
  const test = (channel: 'telegram' | 'email') =>
    act(`test-${channel}`, async () => {
      const { results } = await api.testAlerts(channel);
      const failed = results.filter((r) => !r.ok);
      if (failed.length) throw new Error(failed.map((r) => r.error).join(' · '));
      return `Resumo enviado por ${channel === 'email' ? 'e-mail' : 'Telegram'}.`;
    });

  if (!settings || !config) {
    return (
      <section className="as">
        <h2>Alertas</h2>
        {error ? <p className="as-empty">Não foi possível carregar: {error}</p> : <Loader label="Carregando os alertas" compact />}
      </section>
    );
  }
  const { channels } = settings;
  const patch = (next: Partial<AlertsConfig>) => setConfig({ ...config, ...next });
  const dirty = JSON.stringify(config) !== JSON.stringify(settings.config);

  const recipients = recipientsOf(config.email.to);
  const setRecipients = (list: string[]) => patch({ email: { ...config.email, to: list.join(', ') } });
  // Aceita um endereço ou vários colados de uma vez; devolve a configuração já com eles.
  const withDraft = (): AlertsConfig => {
    const fresh = recipientsOf(recipient).filter((r) => looksLikeEmail(r) && !recipients.some((x) => x.toLowerCase() === r.toLowerCase()));
    if (!fresh.length) return config;
    return { ...config, email: { ...config.email, to: [...recipients, ...fresh].slice(0, MAX_RECIPIENTS).join(', ') } };
  };
  const addRecipient = () => {
    const next = withDraft();
    if (next !== config) setConfig(next);
    if (next !== config || recipient.trim() === '') setRecipient('');
  };
  const onRecipientKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      e.preventDefault();
      addRecipient();
    } else if (e.key === 'Backspace' && recipient === '' && recipients.length) setRecipients(recipients.slice(0, -1));
  };
  const draftInvalid = recipient.trim() !== '' && !recipientsOf(recipient).every(looksLikeEmail);

  const { digest } = config;
  const rulesOn = RULES.filter((r) => config.rules[r.kind]).length;
  const saved = settings.config.digest;
  const smtpReady = channels.email.configured && channels.email.hasPassword;

  return (
    <section className="as">
      <header className="as-hero">
        <div>
          <h2>Alertas</h2>
          <p className="as-lead">Para onde os avisos vão, quando saem e o que merece aviso.</p>
        </div>
        <ul className="as-status">
          <Status icon={<TelegramIcon />} label="Telegram" value={channels.telegram.linked ? 'vinculado' : channels.telegram.configured ? 'falta vincular' : 'desligado'} tone={channels.telegram.linked ? 'ok' : channels.telegram.configured ? 'warn' : 'off'} />
          <Status
            icon={<MailIcon />}
            label="E-mail"
            value={smtpReady ? `${channels.email.recipients ?? 1} destino${(channels.email.recipients ?? 1) === 1 ? '' : 's'}` : channels.email.configured ? 'falta a senha' : 'desligado'}
            tone={smtpReady ? 'ok' : channels.email.configured ? 'warn' : 'off'}
          />
          <Status icon={<ClockIcon />} label="Resumo" value={saved.enabled ? `${saved.frequency === 'weekly' ? WEEKDAYS[saved.weekday] : 'diário'} ${saved.at}` : 'desligado'} tone={saved.enabled ? 'ok' : 'off'} />
          <Status icon={<ListIcon />} label="Regras" value={`${rulesOn} de ${RULES.length} ligadas`} tone={rulesOn ? 'ok' : 'off'} />
        </ul>
      </header>

      <h3 className="as-title">Canais</h3>
      <div className="as-grid">
        <article className="as-card">
          <header>
            <i className="as-ico">
              <TelegramIcon />
            </i>
            <div>
              <h4>Telegram</h4>
              <small>{channels.telegram.bot ?? 'Mensagem no seu celular, pelo seu próprio bot.'}</small>
            </div>
            <span className={`tag ${channels.telegram.linked ? 'ok' : channels.telegram.configured ? 'warn' : ''}`}>{channels.telegram.linked ? 'vinculado' : channels.telegram.configured ? 'falta vincular' : 'não configurado'}</span>
          </header>
          <details className="as-more" open={!channels.telegram.linked}>
            <summary>{channels.telegram.configured ? 'Trocar o bot' : 'Como configurar'}</summary>
            <ol className="as-steps">
              <li>
                No Telegram, fale com o <b>@BotFather</b>, mande <code>/newbot</code> e copie o token.
              </li>
              <li>Cole o token abaixo e salve.</li>
              <li>
                Abra o seu bot, mande <code>/start</code> e clique em “vincular conversa”.
              </li>
            </ol>
            <label className="as-field">
              <span>Token do bot</span>
              <input
                type="password"
                autoComplete="off"
                value={token}
                placeholder={channels.telegram.configured ? 'já configurado — cole outro para trocar' : 'cole aqui o token do BotFather'}
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
            <div className="as-row">
              <button className="primary" disabled={busy !== '' || token.trim() === ''} onClick={() => save('tg-token', { telegramToken: token }, 'Token salvo. Agora mande /start ao bot e vincule a conversa.')}>
                {busy === 'tg-token' ? 'Salvando…' : 'Salvar token'}
              </button>
              {channels.telegram.configured && (
                <button type="button" className="as-link" disabled={busy !== ''} onClick={() => confirm('Remover o token do bot? O Telegram deixa de receber alertas.') && save('tg-clear', { telegramToken: null }, 'Token removido.')}>
                  remover o token
                </button>
              )}
            </div>
          </details>
          <div className="as-actions">
            <button className="reset" disabled={busy !== '' || !channels.telegram.configured} onClick={() => act('tg-link', async () => `Conversa vinculada (${(await api.linkTelegram()).name}).`)}>
              {busy === 'tg-link' ? 'Procurando…' : channels.telegram.linked ? 'Vincular outra conversa' : 'Vincular conversa'}
            </button>
            <button className="reset" disabled={busy !== '' || !channels.telegram.linked} onClick={() => test('telegram')}>
              {busy === 'test-telegram' ? 'Enviando…' : 'Enviar teste'}
            </button>
            {channels.telegram.linked && (
              <button type="button" className="as-link" disabled={busy !== ''} onClick={() => act('tg-unlink', async () => (await api.unlinkTelegram(), 'Conversa desvinculada.'))}>
                desvincular
              </button>
            )}
          </div>
        </article>

        <article className="as-card">
          <header>
            <i className="as-ico">
              <MailIcon />
            </i>
            <div>
              <h4>E-mail</h4>
              <small>Um ou mais endereços recebem os mesmos avisos.</small>
            </div>
            <span className={`tag ${smtpReady ? 'ok' : channels.email.configured ? 'warn' : ''}`}>{smtpReady ? 'ativo' : channels.email.configured ? 'falta a senha' : 'não configurado'}</span>
          </header>
          <div className="as-field">
            <span>
              Enviar para <em>{recipients.length}/{MAX_RECIPIENTS}</em>
            </span>
            <div className={`as-chips${draftInvalid ? ' bad' : ''}`}>
              {recipients.map((r) => (
                <span key={r} className="as-chip">
                  {r}
                  <button type="button" aria-label={`Remover ${r}`} title="Remover" onClick={() => setRecipients(recipients.filter((x) => x !== r))}>
                    ×
                  </button>
                </span>
              ))}
              {recipients.length < MAX_RECIPIENTS && (
                <input
                  type="email"
                  autoComplete="off"
                  aria-label="Adicionar destinatário"
                  value={recipient}
                  placeholder={recipients.length ? 'adicionar outro e-mail' : 'nome@exemplo.com'}
                  onChange={(e) => setRecipient(e.target.value)}
                  onKeyDown={onRecipientKey}
                  onBlur={addRecipient}
                />
              )}
            </div>
            <small className="as-hint">{draftInvalid ? 'Esse endereço não parece um e-mail.' : 'Enter ou vírgula para adicionar. Dá para colar vários de uma vez.'}</small>
          </div>
          <details className="as-more" open={!smtpReady}>
            <summary>Servidor de envio (SMTP)</summary>
            <p className="as-hint">
              No Gmail: servidor <code>smtp.gmail.com</code>, porta <code>587</code>, usuário = o seu e-mail e, como senha, uma “senha de app” (Conta Google › Segurança › Verificação em duas etapas
              › Senhas de app).
            </p>
            <div className="as-fields">
              <label className="as-field">
                <span>Servidor</span>
                <input value={config.email.host} placeholder="smtp.gmail.com" onChange={(e) => patch({ email: { ...config.email, host: e.target.value } })} />
              </label>
              <label className="as-field">
                <span>Porta</span>
                <input type="number" min={1} max={65535} value={config.email.port} onChange={(e) => patch({ email: { ...config.email, port: Number(e.target.value) || 587 } })} />
              </label>
              <label className="as-field">
                <span>Usuário (e-mail de envio)</span>
                <input type="email" autoComplete="off" value={config.email.user} onChange={(e) => patch({ email: { ...config.email, user: e.target.value } })} />
              </label>
              <label className="as-field">
                <span>Senha</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={smtpPass}
                  placeholder={channels.email.hasPassword ? 'já configurada' : 'senha de app'}
                  onChange={(e) => setSmtpPass(e.target.value)}
                />
              </label>
            </div>
          </details>
          <div className="as-actions">
            <button className="primary" disabled={busy !== '' || draftInvalid} onClick={() => save('mail', smtpPass.trim() ? { smtpPass } : {}, 'E-mail salvo.', withDraft()).then(() => setRecipient(''))}>
              {busy === 'mail' ? 'Salvando…' : 'Salvar e-mail'}
            </button>
            <button className="reset" disabled={busy !== '' || !channels.email.configured || dirty} title={dirty ? 'Salve antes de testar' : undefined} onClick={() => test('email')}>
              {busy === 'test-email' ? 'Enviando…' : 'Enviar teste'}
            </button>
          </div>
        </article>
      </div>

      <h3 className="as-title">Quando avisar</h3>
      <article className="as-card as-when">
        <div className="as-line">
          <label className="as-switch">
            <input type="checkbox" className="as-sw" checked={digest.enabled} onChange={(e) => patch({ digest: { ...digest, enabled: e.target.checked } })} />
            <span>
              <b>Resumo</b>
              <small>Saldo, vencimentos da semana, limites, compras novas e como cada mês fecha.</small>
            </span>
          </label>
          <div className={`as-sched${digest.enabled ? '' : ' off'}`}>
            <div className="as-seg" role="group" aria-label="Frequência do resumo">
              {(['daily', 'weekly'] as const).map((f) => (
                <button key={f} type="button" className={digest.frequency === f ? 'on' : ''} aria-pressed={digest.frequency === f} disabled={!digest.enabled} onClick={() => patch({ digest: { ...digest, frequency: f } })}>
                  {f === 'daily' ? 'Diário' : 'Semanal'}
                </button>
              ))}
            </div>
            {digest.frequency === 'weekly' && (
              <div className="as-seg days" role="group" aria-label="Dia da semana">
                {WEEKDAYS.map((d, i) => (
                  <button key={d} type="button" className={digest.weekday === i ? 'on' : ''} aria-pressed={digest.weekday === i} title={WEEKDAY_NAMES[i]} disabled={!digest.enabled} onClick={() => patch({ digest: { ...digest, weekday: i } })}>
                    {d}
                  </button>
                ))}
              </div>
            )}
            <label className="as-time">
              às
              <input type="time" aria-label="Horário do resumo" value={digest.at} disabled={!digest.enabled} onChange={(e) => e.target.value && patch({ digest: { ...digest, at: e.target.value } })} />
            </label>
          </div>
        </div>
        <div className="as-line">
          <label className="as-switch">
            <input type="checkbox" className="as-sw" checked={config.urgentNow} onChange={(e) => patch({ urgentNow: e.target.checked })} />
            <span>
              <b>Urgente na hora</b>
              <small>Fatura vencendo hoje, dinheiro que não cobre a semana e banco desconectado saem sem esperar o resumo.</small>
            </span>
          </label>
        </div>
        <p className="as-hint">
          Horário de Brasília. Os bancos são lidos de madrugada; antes das 06:00 o resumo ainda traria os dados de anteontem.
          {digest.frequency === 'weekly' && ' No semanal, o que for urgente continua saindo na hora se a opção acima estiver ligada.'}
        </p>
      </article>

      <h3 className="as-title">
        O que avisar <small>{rulesOn} de {RULES.length} ligadas</small>
      </h3>
      <ul className="as-rules">
        {RULES.map((r) => {
          const th = r.threshold;
          const value = th ? config.thresholds[th.key] : 0;
          const on = config.rules[r.kind];
          return (
            <li key={r.kind} className={on ? undefined : 'off'}>
              <label className="as-switch">
                <span>
                  <b>{r.title}</b>
                  <small>{r.detail}</small>
                </span>
                <input type="checkbox" className="as-sw" checked={on} onChange={(e) => patch({ rules: { ...config.rules, [r.kind]: e.target.checked } })} />
              </label>
              {th && (
                <label className="as-threshold">
                  {th.label}
                  <input
                    type="number"
                    min={0}
                    disabled={!on}
                    value={th.percent ? Math.round(value * 100) : value}
                    onChange={(e) => patch({ thresholds: { ...config.thresholds, [th.key]: th.percent ? (Number(e.target.value) || 0) / 100 : Number(e.target.value) || 0 } })}
                  />
                  {th.suffix}
                </label>
              )}
            </li>
          );
        })}
      </ul>

      <div className={`as-save${dirty ? ' dirty' : ''}`}>
        <span>{dirty ? 'Há alterações não salvas.' : 'Tudo salvo.'}</span>
        <button className="reset" disabled={busy !== ''} onClick={() => act('run', async () => ((await api.runAlerts()).created ? 'Há alertas novos.' : 'Nada de novo agora.'))}>
          {busy === 'run' ? 'Verificando…' : 'Verificar agora'}
        </button>
        {dirty && (
          <button className="reset" disabled={busy !== ''} onClick={() => setConfig(settings.config)}>
            Descartar
          </button>
        )}
        <button className="primary" disabled={busy !== '' || !dirty} onClick={() => save('config')}>
          {busy === 'config' ? 'Salvando…' : 'Salvar alterações'}
        </button>
      </div>

      <h3 className="as-title">
        Histórico <small>{history.length} mais recentes</small>
      </h3>
      <article className="as-card as-history">
        {history.length === 0 ? (
          <p className="as-empty">Nenhum alerta até agora.</p>
        ) : (
          <ul>
            {history.map((a) => (
              <li key={a.id} className={`${LEVEL[a.severity]?.tone ?? 'info'}${a.dismissed ? ' off' : ''}`}>
                <i aria-hidden="true" />
                <div>
                  <b>{a.title}</b>
                  <p>{a.body}</p>
                </div>
                <small>
                  {stamp(a.createdAt)}
                  <em>
                    {LEVEL[a.severity]?.label ?? a.severity} · {a.dismissed ? 'dispensado' : a.sent ? 'enviado' : 'só no app'}
                  </em>
                </small>
                {!a.dismissed ? (
                  <button type="button" className="al-x" title="Dispensar" aria-label={`Dispensar: ${a.title}`} onClick={() => act(a.id, async () => (await api.dismissAlert(a.id), 'Alerta dispensado.'))}>
                    ×
                  </button>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}
