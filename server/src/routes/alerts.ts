import { parseRecipients } from '../alerts/config';
import { Router } from 'express';
import { prisma } from '../db';
import { latestTelegramChat, maskEmail, sendTelegram, telegramBotName } from '../alerts/channels';
import { getSetting, linkTelegramChat, loadChannels, loadConfig, normalizeConfig, saveConfig, setSetting, unlinkTelegramChat } from '../alerts/config';
import { evaluate, sendDigest } from '../alerts/engine';

const router = Router();

// Situação dos canais, sem nenhum segredo: só se está configurado e para onde vai.
async function channelStatus() {
  const channels = await loadChannels();
  return {
    telegram: { configured: channels.telegram.token !== null, linked: channels.telegram.chatId !== null, bot: channels.telegram.token ? await getSetting('telegram.botName') : null },
    email: { configured: channels.email !== null, to: channels.email ? parseRecipients(channels.email.to).map(maskEmail).join(', ') : null, recipients: channels.email ? parseRecipients(channels.email.to).length : 0, hasPassword: Boolean(channels.email?.pass) },
  };
}

// GET /api/alerts - alertas em aberto, quantos não lidos e a situação dos canais
router.get('/', async (_req, res) => {
  const [alerts, unread, channels] = await Promise.all([
    prisma.alert.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.alert.count({ where: { resolvedAt: null, readAt: null } }),
    channelStatus(),
  ]);
  res.json({
    alerts: alerts.map((a) => ({ id: a.id, kind: a.kind, severity: a.severity, title: a.title, body: a.body, createdAt: a.createdAt, read: a.readAt !== null })),
    unread,
    channels,
  });
});

// GET /api/alerts/history - os últimos alertas, inclusive os dispensados
router.get('/history', async (_req, res) => {
  const alerts = await prisma.alert.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  res.json(alerts.map((a) => ({ id: a.id, kind: a.kind, severity: a.severity, title: a.title, body: a.body, createdAt: a.createdAt, sent: a.sentAt !== null, dismissed: a.resolvedAt !== null })));
});

// GET /api/alerts/settings - configuração dos alertas (os segredos nunca são devolvidos)
router.get('/settings', async (_req, res) => {
  res.json({ config: await loadConfig(), channels: await channelStatus() });
});

// PUT /api/alerts/settings - grava a configuração. `telegramToken` e `smtpPass`: texto grava,
// null apaga, ausente mantém o que já está.
router.put('/settings', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const secret = (v: unknown): string | null | undefined => (v === null ? null : typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 500) : undefined);
  const config = normalizeConfig(body.config, await loadConfig());
  // Token novo: confere com o Telegram antes de guardar, para não salvar um token errado.
  const newToken = secret(body.telegramToken);
  if (typeof newToken === 'string') {
    try {
      await setSetting('telegram.botName', await telegramBotName(newToken));
    } catch (err) {
      res.status(400).json({ error: `O Telegram não aceitou esse token. Confira se copiou inteiro do BotFather. (${err instanceof Error ? err.message : 'sem resposta'})` });
      return;
    }
  }
  await saveConfig(config, { telegramToken: secret(body.telegramToken), smtpPass: secret(body.smtpPass) });
  // Token novo é de outro bot: a conversa vinculada ao anterior deixa de valer.
  if (secret(body.telegramToken) !== undefined) await unlinkTelegramChat();
  res.json({ config, channels: await channelStatus() });
});

// POST /api/alerts/read - marca todos como lidos
router.post('/read', async (_req, res) => {
  await prisma.alert.updateMany({ where: { readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
});

// POST /api/alerts/:id/dismiss - dispensa um alerta (some da lista; o mesmo fato não volta)
router.post('/:id/dismiss', async (req, res) => {
  await prisma.alert.updateMany({ where: { id: req.params.id }, data: { resolvedAt: new Date(), readAt: new Date() } });
  res.json({ ok: true });
});

// POST /api/alerts/run - aplica as regras agora
router.post('/run', async (_req, res) => {
  const { created } = await evaluate();
  res.json({ created });
});

// POST /api/alerts/telegram/link - vincula a conversa em que o usuário mandou /start para o bot
router.post('/telegram/link', async (_req, res) => {
  const { token } = (await loadChannels()).telegram;
  if (!token) {
    res.status(503).json({ error: 'Falta o token do bot do Telegram. Cole o token em Alertas > Telegram e salve.' });
    return;
  }
  let chat: Awaited<ReturnType<typeof latestTelegramChat>>;
  try {
    chat = await latestTelegramChat(token);
  } catch (err) {
    res.status(502).json({ error: `Não consegui falar com o Telegram: ${err instanceof Error ? err.message : 'sem resposta'}` });
    return;
  }
  if (!chat) {
    res.status(404).json({ error: 'Não achei nenhuma conversa. Abra o seu bot no Telegram, mande /start e tente de novo.' });
    return;
  }
  await linkTelegramChat(chat.chatId);
  await sendTelegram(token, chat.chatId, 'Meu financeiro: esta conversa vai receber o resumo diário e os alertas urgentes.');
  res.json({ ok: true, name: chat.name });
});

// POST /api/alerts/telegram/unlink - deixa de enviar para a conversa vinculada
router.post('/telegram/unlink', async (_req, res) => {
  await unlinkTelegramChat();
  res.json({ ok: true });
});

// POST /api/alerts/test - envia agora o resumo do dia; `channel` restringe a um canal
router.post('/test', async (req, res) => {
  const only = req.body?.channel === 'telegram' || req.body?.channel === 'email' ? (req.body.channel as 'telegram' | 'email') : undefined;
  const results = await sendDigest(new Date(), true, only);
  if (results.length === 0) {
    res.status(503).json({ error: only ? 'Este canal ainda não está pronto: confira a configuração.' : 'Nenhum canal pronto: configure o Telegram ou o e-mail.' });
    return;
  }
  res.json({ results });
});

export default router;
