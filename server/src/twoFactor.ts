// Segundo fator do login: depois da senha certa, um código de 6 dígitos sai por um canal que só
// o dono recebe (Telegram; e-mail como reserva). O desafio vive em memória — o app é um processo só,
// e reiniciar apenas obriga a pedir outro código.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';

export const CODE_TTL_MS = 5 * 60 * 1000;
export const MAX_TRIES = 5;
const MAX_OPEN = 20;

interface Challenge {
  hash: Buffer;
  username: string;
  expires: number;
  tries: number;
}
const challenges = new Map<string, Challenge>();

const digest = (id: string, code: string) => createHash('sha256').update(`${id}:${code}`).digest();

function prune(now: number) {
  for (const [id, c] of challenges) if (c.expires <= now) challenges.delete(id);
  // Map mantém a ordem de inserção: os mais antigos saem primeiro.
  while (challenges.size >= MAX_OPEN) challenges.delete(challenges.keys().next().value as string);
}

export function createChallenge(username: string, now = Date.now()): { id: string; code: string } {
  prune(now);
  const id = randomBytes(24).toString('base64url');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  challenges.set(id, { hash: digest(id, code), username, expires: now + CODE_TTL_MS, tries: 0 });
  return { id, code };
}

// Devolve o usuário quando o código confere. O desafio vale uma vez só e morre depois de
// MAX_TRIES erros, então adivinhar 1 em 1.000.000 não vira questão de insistência.
export function verifyChallenge(id: unknown, code: unknown, now = Date.now()): string | null {
  if (typeof id !== 'string' || typeof code !== 'string') return null;
  const challenge = challenges.get(id);
  if (!challenge) return null;
  if (challenge.expires <= now) {
    challenges.delete(id);
    return null;
  }
  if (!timingSafeEqual(challenge.hash, digest(id, code.trim()))) {
    challenge.tries += 1;
    if (challenge.tries >= MAX_TRIES) challenges.delete(id);
    return null;
  }
  challenges.delete(id);
  return challenge.username;
}

export const discardChallenge = (id: string) => challenges.delete(id);

// Aviso de login recusado: o primeiro sai na hora, os seguintes só depois do intervalo, com a contagem.
const NOTICE_GAP_MS = 10 * 60 * 1000;
let lastNotice = 0;
let sinceNotice = 0;
export function failureNotice(ip: string, now = Date.now()): string | null {
  sinceNotice += 1;
  if (now - lastNotice < NOTICE_GAP_MS) return null;
  const count = sinceNotice;
  lastNotice = now;
  sinceNotice = 0;
  return `Tentativa de login recusada no Meu financeiro${count > 1 ? ` (${count} desde o último aviso)` : ''}.\nÚltimo IP: ${ip}\nSe não foi você, troque a senha.`;
}
export function resetFailureNotice() {
  lastNotice = 0;
  sinceNotice = 0;
}
