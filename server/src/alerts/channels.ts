// Canais de entrega dos alertas: Telegram (bot) e e-mail (SMTP). Os dois são opcionais; a
// configuração (token, conversa, servidor de e-mail) vem de alerts/config.ts.
import nodemailer from 'nodemailer';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface ChannelResult {
  channel: 'telegram' | 'email';
  ok: boolean;
  error?: string;
}

export interface EmailChannel {
  host: string;
  port: number;
  user: string | null;
  pass: string | null;
  to: string;
  from: string;
}

// Mostra o destino sem expor o endereço inteiro: "fu***@exemplo.com".
export const maskEmail = (email: string) => email.replace(/^(.{2})[^@]*/, '$1***');

async function telegramCall<T>(token: string, method: string, body: unknown, fetchImpl: FetchLike): Promise<T> {
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  // A mensagem de erro do Telegram não traz o token; a URL (que traz) nunca é registrada.
  if (!res.ok || !data.ok) throw new Error(data.description ? `Telegram: ${data.description}` : `Telegram respondeu ${res.status}`);
  return data.result as T;
}

export async function sendTelegram(token: string, chatId: string, text: string, fetchImpl: FetchLike = fetch): Promise<void> {
  // O limite do Telegram é 4096 caracteres por mensagem.
  await telegramCall(token, 'sendMessage', { chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }, fetchImpl);
}

// Confere o token com o Telegram e devolve o nome do bot (@usuario).
export async function telegramBotName(token: string, fetchImpl: FetchLike = fetch): Promise<string> {
  const me = await telegramCall<{ username?: string; first_name?: string }>(token, 'getMe', {}, fetchImpl);
  return me.username ? `@${me.username}` : (me.first_name ?? 'bot');
}

// Conversa mais recente em que alguém falou com o bot (o usuário manda /start e clica em "vincular").
export async function latestTelegramChat(token: string, fetchImpl: FetchLike = fetch): Promise<{ chatId: string; name: string } | null> {
  const updates = await telegramCall<Array<{ message?: { chat?: { id?: number; type?: string; first_name?: string; title?: string } } }>>(token, 'getUpdates', { limit: 50, timeout: 0 }, fetchImpl);
  const chats = updates.map((u) => u.message?.chat).filter((c): c is { id: number; type?: string; first_name?: string; title?: string } => typeof c?.id === 'number');
  // Só conversa privada: num grupo, os valores ficariam à vista de outras pessoas.
  const chat = chats.reverse().find((c) => c.type === 'private');
  return chat ? { chatId: String(chat.id), name: chat.first_name ?? chat.title ?? 'conversa' } : null;
}

export async function sendEmail(config: EmailChannel, subject: string, text: string): Promise<void> {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
  });
  await transport.sendMail({ from: config.from, to: config.to, subject, text });
}

// Envia para os canais prontos; a falha de um não impede o outro. `only` restringe a um canal.
export async function deliver(
  subject: string,
  text: string,
  channels: { telegram: { token: string | null; chatId: string | null }; email: EmailChannel | null },
  only?: 'telegram' | 'email',
): Promise<ChannelResult[]> {
  const results: ChannelResult[] = [];
  const { token, chatId } = channels.telegram;
  if (token && chatId && only !== 'email') {
    try {
      await sendTelegram(token, chatId, text);
      results.push({ channel: 'telegram', ok: true });
    } catch (err) {
      results.push({ channel: 'telegram', ok: false, error: err instanceof Error ? err.message.slice(0, 200) : 'falha no envio' });
    }
  }
  if (channels.email && only !== 'telegram') {
    try {
      await sendEmail(channels.email, subject, text);
      results.push({ channel: 'email', ok: true });
    } catch (err) {
      results.push({ channel: 'email', ok: false, error: err instanceof Error ? err.message.slice(0, 200) : 'falha no envio' });
    }
  }
  return results;
}
