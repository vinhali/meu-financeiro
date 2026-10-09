import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { COOKIE_NAME, clearSessionCookie, createSessionToken, revokeSessions, safeEqual, setSessionCookie, verifySessionToken } from '../auth';
import { deliver } from '../alerts/channels';
import { loadChannels } from '../alerts/config';
import { createChallenge, discardChallenge, failureNotice, verifyChallenge } from '../twoFactor';

const router = Router();

// Força bruta: no máximo 10 tentativas com falha por IP a cada 15 minutos (senha e código somam juntos).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Tente novamente em alguns minutos.' },
});

// Avisa o dono, sem segurar a resposta do login.
function reportFailure(ip: string | undefined) {
  console.warn(`[auth] login recusado de ${ip}`);
  const text = failureNotice(ip ?? 'desconhecido');
  if (!text) return;
  loadChannels()
    .then((channels) => deliver('Meu financeiro — login recusado', text, channels))
    .catch((err) => console.error('[auth] aviso de login recusado falhou:', err));
}

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  const expectedUser = process.env.APP_USER;
  const expectedPass = process.env.APP_PASSWORD;

  if (!expectedUser || !expectedPass) {
    res.status(500).json({ error: 'Servidor não configurado: defina APP_USER e APP_PASSWORD' });
    return;
  }
  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(401).json({ error: 'Usuário ou senha inválidos' });
    return;
  }
  // Avalia os dois lados sempre, para não vazar qual deles errou pelo tempo de resposta.
  const userOk = safeEqual(username, expectedUser);
  const passOk = safeEqual(password, expectedPass);
  if (!userOk || !passOk) {
    reportFailure(req.ip);
    res.status(401).json({ error: 'Usuário ou senha inválidos' });
    return;
  }

  // Segundo fator: vale sempre que existir um canal para receber o código.
  // LOGIN_2FA=off no servidor é a saída de emergência se os dois canais caírem.
  const channels = await loadChannels();
  const hasTelegram = !!(channels.telegram.token && channels.telegram.chatId);
  if (process.env.LOGIN_2FA !== 'off' && (hasTelegram || channels.email)) {
    const { id, code } = createChallenge(username);
    const text = `Código de acesso do Meu financeiro: ${code}\nVale por 5 minutos. Se não foi você que pediu, troque a senha.`;
    const subject = 'Meu financeiro — código de acesso';
    let via: 'telegram' | 'email' | null = null;
    if (hasTelegram && (await deliver(subject, text, channels, 'telegram')).some((r) => r.ok)) via = 'telegram';
    else if (channels.email && (await deliver(subject, text, channels, 'email')).some((r) => r.ok)) via = 'email';
    if (!via) {
      discardChallenge(id);
      console.error('[auth] não foi possível enviar o código de acesso');
      res.status(503).json({ error: 'Não consegui enviar o código de acesso. Tente de novo em instantes.' });
      return;
    }
    res.json({ ok: false, twoFactor: true, challenge: id, via });
    return;
  }

  const token = await createSessionToken(username);
  setSessionCookie(res, token);
  res.json({ ok: true });
});

router.post('/verify', loginLimiter, async (req, res) => {
  const { challenge, code } = req.body || {};
  const username = verifyChallenge(challenge, code);
  if (!username) {
    reportFailure(req.ip);
    res.status(401).json({ error: 'Código inválido ou vencido' });
    return;
  }
  const token = await createSessionToken(username);
  setSessionCookie(res, token);
  res.json({ ok: true });
});

// Sair encerra a sessão em todos os aparelhos: um cookie copiado deixa de valer.
router.post('/logout', async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (token && (await verifySessionToken(token))) await revokeSessions();
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  const authenticated = !!token && (await verifySessionToken(token));
  res.json({ authenticated });
});

export default router;
