import { createHash, timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import { getSetting, setSetting } from './alerts/config';

export const COOKIE_NAME = 'financeiro_session';
const SESSION_DURATION = '7d';
const MIN_SECRET_LENGTH = 32;
const WEAK_PASSWORDS = new Set(['troque-esta-senha', 'dev123', 'admin', 'password', '123456']);

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`SESSION_SECRET must be set to a string with at least ${MIN_SECRET_LENGTH} characters`);
  }
  return new TextEncoder().encode(secret);
}

// Falha na inicialização (em vez de no primeiro login) se a configuração for insegura.
export function assertAuthConfig() {
  getSecret();
  const password = process.env.APP_PASSWORD;
  if (!process.env.APP_USER || !password) {
    throw new Error('APP_USER and APP_PASSWORD must be set');
  }
  if (process.env.NODE_ENV === 'production') {
    const secret = process.env.SESSION_SECRET ?? '';
    if (password.length < 10 || WEAK_PASSWORDS.has(password)) {
      throw new Error('APP_PASSWORD is too weak for production (min 10 chars, not a default value)');
    }
    if (secret.startsWith('troque-') || secret.startsWith('dev-secret')) {
      throw new Error('SESSION_SECRET is still the example value');
    }
  }
}

// Comparação em tempo constante, independente do tamanho das strings.
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

// Geração das sessões: todo token carrega a geração em que nasceu. Subir o número (ao sair)
// invalida de uma vez todos os tokens emitidos antes, mesmo os que ainda não venceram.
let epoch: number | null = null;
async function sessionEpoch(): Promise<number> {
  if (epoch === null) epoch = Number(await getSetting('auth.sessionEpoch')) || 0;
  return epoch;
}
export async function revokeSessions(): Promise<void> {
  epoch = (await sessionEpoch()) + 1;
  await setSetting('auth.sessionEpoch', String(epoch));
}

export async function createSessionToken(username: string): Promise<string> {
  return new SignJWT({ sub: username, ver: await sessionEpoch() })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] });
    // Tokens de antes desta regra não têm geração: contam como a geração zero.
    return payload.sub === process.env.APP_USER && (typeof payload.ver === 'number' ? payload.ver : 0) === (await sessionEpoch());
  } catch {
    return false;
  }
}

export function isCookieSecure(): boolean {
  return process.env.COOKIE_SECURE === 'true';
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isCookieSecure(),
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: isCookieSecure(),
    sameSite: 'strict',
    path: '/',
  });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token || !(await verifySessionToken(token))) {
    res.status(401).json({ error: 'Não autenticado' });
    return;
  }
  next();
}

// Defesa extra contra CSRF: requisições que alteram estado precisam vir da própria origem.
export function requireSameOrigin(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }
  const origin = req.get('origin');
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (originHost !== req.get('host')) {
      res.status(403).json({ error: 'Origem não permitida' });
      return;
    }
  }
  next();
}
