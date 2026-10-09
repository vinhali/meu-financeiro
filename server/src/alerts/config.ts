// Configuração dos alertas, editável pelo app: canais, horário do resumo, regras ligadas e limiares.
// Fica no banco (tabela app_settings). Token do bot e senha do SMTP são guardados cifrados — o
// backup do banco vai para fora do servidor e não deve carregar segredo em texto puro.
// As variáveis de ambiente continuam valendo como reserva para o que não foi definido pelo app.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { prisma } from '../db';
import { DEFAULT_THRESHOLDS, Thresholds } from './rules';

export const RULE_KINDS = ['billDue', 'late', 'cash', 'limit', 'bigPurchase', 'newPlan', 'monthDrop', 'connection'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export interface AlertsConfig {
  // `at` é "HH:MM" no horário de Brasília; no semanal, `weekday` é o dia (0 = domingo … 6 = sábado).
  digest: { enabled: boolean; at: string; frequency: 'daily' | 'weekly'; weekday: number };
  urgentNow: boolean; // alerta urgente sai na hora, sem esperar o resumo
  rules: Record<RuleKind, boolean>;
  thresholds: Thresholds;
  email: { host: string; port: number; user: string; to: string }; // `to`: um ou mais endereços, separados por vírgula
}

export const DEFAULT_CONFIG: AlertsConfig = {
  digest: { enabled: true, at: '07:30', frequency: 'daily', weekday: 1 },
  urgentNow: true,
  rules: { billDue: true, late: true, cash: true, limit: true, bigPurchase: true, newPlan: true, monthDrop: true, connection: true },
  thresholds: DEFAULT_THRESHOLDS,
  email: { host: '', port: 587, user: '', to: '' },
};

const getSetting = async (key: string) => (await prisma.appSetting.findUnique({ where: { key } }))?.value ?? null;
const setSetting = (key: string, value: string) => prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
const delSetting = (key: string) => prisma.appSetting.deleteMany({ where: { key } });

// ── Segredos cifrados (AES-256-GCM, chave derivada do SESSION_SECRET do servidor) ──
const secretKey = (secret = process.env.SESSION_SECRET ?? '') => createHash('sha256').update(`alerts:${secret}`).digest();

export function encryptSecret(plain: string, secret?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(secret), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

// Devolve null quando o valor não decifra (chave do servidor trocada, dado corrompido).
export function decryptSecret(stored: string, secret?: string): string | null {
  try {
    const [version, iv, tag, data] = stored.split('.');
    if (version !== 'v1') return null;
    const decipher = createDecipheriv('aes-256-gcm', secretKey(secret), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

const readSecret = async (key: string) => {
  const stored = await getSetting(key);
  return stored ? decryptSecret(stored) : null;
};
// string = grava; null = apaga; undefined = deixa como está.
async function writeSecret(key: string, value: string | null | undefined) {
  if (value === undefined) return;
  if (value === null || value.trim() === '') await delSetting(key);
  else await setSetting(key, encryptSecret(value.trim()));
}

// Destinatários do e-mail: aceita vírgula, ponto e vírgula, espaço ou quebra de linha; descarta o
// que não tem cara de endereço e os repetidos.
export const MAX_RECIPIENTS = 10;
export function parseRecipients(raw: string): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const part of raw.split(/[\s,;]+/)) {
    const address = part.trim();
    if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(address) || address.length > 120) continue;
    if (seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase());
    list.push(address);
    if (list.length === MAX_RECIPIENTS) break;
  }
  return list;
}

// O resumo sai agora? Diário: todo dia a partir do horário. Semanal: só no dia escolhido.
export function digestDue(digest: AlertsConfig['digest'], now: Date): boolean {
  if (!digest.enabled) return false;
  const brasilia = new Date(now.getTime() - 3 * 3_600_000);
  if (digest.frequency === 'weekly' && brasilia.getUTCDay() !== digest.weekday) return false;
  return brasilia.toISOString().slice(11, 16) >= digest.at;
}

// Junta o que veio (do banco ou do cliente) com os padrões, descartando o que não tem formato válido.
export function normalizeConfig(raw: unknown, base: AlertsConfig = DEFAULT_CONFIG): AlertsConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
  const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback);
  const text = (v: unknown, fallback: string) => (typeof v === 'string' ? v.trim().slice(0, 200) : fallback);
  const digest = obj(r.digest);
  const rules = obj(r.rules);
  const th = obj(r.thresholds);
  const email = obj(r.email);
  return {
    digest: {
      enabled: typeof digest.enabled === 'boolean' ? digest.enabled : base.digest.enabled,
      at: typeof digest.at === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(digest.at) ? digest.at : base.digest.at,
      frequency: digest.frequency === 'daily' || digest.frequency === 'weekly' ? digest.frequency : base.digest.frequency,
      weekday: typeof digest.weekday === 'number' && Number.isInteger(digest.weekday) && digest.weekday >= 0 && digest.weekday <= 6 ? digest.weekday : base.digest.weekday,
    },
    urgentNow: typeof r.urgentNow === 'boolean' ? r.urgentNow : base.urgentNow,
    rules: Object.fromEntries(RULE_KINDS.map((k) => [k, typeof rules[k] === 'boolean' ? (rules[k] as boolean) : base.rules[k]])) as Record<RuleKind, boolean>,
    thresholds: {
      limitNear: num(th.limitNear, base.thresholds.limitNear, 0.3, 1),
      bigPurchase: num(th.bigPurchase, base.thresholds.bigPurchase, 0, 1_000_000),
      monthDrop: num(th.monthDrop, base.thresholds.monthDrop, 0, 1_000_000),
      staleHours: num(th.staleHours, base.thresholds.staleHours, 12, 24 * 30),
      consentDays: num(th.consentDays, base.thresholds.consentDays, 1, 365),
    },
    email: {
      host: text(email.host, base.email.host),
      port: num(email.port, base.email.port, 1, 65535),
      user: text(email.user, base.email.user),
      to: typeof email.to === 'string' ? parseRecipients(email.to).join(', ') : base.email.to,
    },
  };
}

export async function loadConfig(): Promise<AlertsConfig> {
  const env = process.env;
  // O que estava nas variáveis de ambiente vira o ponto de partida.
  const fromEnv: AlertsConfig = {
    ...DEFAULT_CONFIG,
    digest: { ...DEFAULT_CONFIG.digest, at: env.ALERT_DIGEST_AT?.match(/^([01]\d|2[0-3]):[0-5]\d$/) ? env.ALERT_DIGEST_AT : DEFAULT_CONFIG.digest.at },
    email: { host: env.SMTP_HOST?.trim() ?? '', port: Number(env.SMTP_PORT) || 587, user: env.SMTP_USER?.trim() ?? '', to: parseRecipients(env.ALERT_EMAIL_TO ?? '').join(', ') },
  };
  const saved = await getSetting('alerts.config');
  if (!saved) return fromEnv;
  try {
    return normalizeConfig(JSON.parse(saved), fromEnv);
  } catch {
    return fromEnv;
  }
}

export async function saveConfig(config: AlertsConfig, secrets: { telegramToken?: string | null; smtpPass?: string | null }): Promise<void> {
  await setSetting('alerts.config', JSON.stringify(config));
  await writeSecret('secret.telegramToken', secrets.telegramToken);
  await writeSecret('secret.smtpPass', secrets.smtpPass);
}

export const telegramChat = async () => (await getSetting('telegram.chatId')) ?? process.env.TELEGRAM_CHAT_ID?.trim() ?? null;
export const linkTelegramChat = (chatId: string) => setSetting('telegram.chatId', chatId);
export const unlinkTelegramChat = () => delSetting('telegram.chatId');

// Canais prontos para envio, com os segredos resolvidos (app primeiro, ambiente como reserva).
export interface Channels {
  telegram: { token: string | null; chatId: string | null };
  email: { host: string; port: number; user: string | null; pass: string | null; to: string; from: string } | null;
}
export async function loadChannels(config?: AlertsConfig): Promise<Channels> {
  const c = config ?? (await loadConfig());
  const token = (await readSecret('secret.telegramToken')) ?? process.env.TELEGRAM_BOT_TOKEN?.trim() ?? null;
  const pass = (await readSecret('secret.smtpPass')) ?? process.env.SMTP_PASS ?? null;
  const email = c.email.host && c.email.to ? { host: c.email.host, port: c.email.port, user: c.email.user || null, pass, to: c.email.to, from: process.env.ALERT_EMAIL_FROM?.trim() || c.email.user || parseRecipients(c.email.to)[0] } : null;
  return { telegram: { token: token || null, chatId: await telegramChat() }, email };
}

export { getSetting, setSetting };
