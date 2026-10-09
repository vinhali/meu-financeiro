// Segundo fator do login e aviso de tentativa recusada. Rodar: npm test (em server/).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CODE_TTL_MS, MAX_TRIES, createChallenge, failureNotice, resetFailureNotice, verifyChallenge } from '../src/twoFactor';

const wrong = (code: string) => (code === '000000' ? '111111' : '000000');

test('o código certo entra uma vez só', () => {
  const { id, code } = createChallenge('dono', 1000);
  assert.match(code, /^[0-9]{6}$/);
  assert.equal(verifyChallenge(id, code, 2000), 'dono');
  assert.equal(verifyChallenge(id, code, 2001), null);
});

test('código errado, de outro desafio, vencido ou malformado não entra', () => {
  const a = createChallenge('dono', 1000);
  const b = createChallenge('dono', 1000);
  assert.equal(verifyChallenge(a.id, wrong(a.code), 2000), null);
  if (a.code !== b.code) assert.equal(verifyChallenge(a.id, b.code, 2000), null);
  assert.equal(verifyChallenge('nao-existe', a.code, 2000), null);
  assert.equal(verifyChallenge({ $ne: null }, a.code, 2000), null);
  assert.equal(verifyChallenge(a.id, 123456, 2000), null);
  assert.equal(verifyChallenge(b.id, b.code, 1000 + CODE_TTL_MS), null);
  // O desafio `a` ainda aceita o código certo: sobraram tentativas.
  assert.equal(verifyChallenge(a.id, ` ${a.code} `, 3000), 'dono');
});

test('depois do limite de erros o desafio morre, mesmo com o código certo', () => {
  const { id, code } = createChallenge('dono', 1000);
  for (let i = 0; i < MAX_TRIES; i++) assert.equal(verifyChallenge(id, wrong(code), 2000), null);
  assert.equal(verifyChallenge(id, code, 2000), null);
});

test('aviso de login recusado: o primeiro sai na hora, os seguintes juntam até passar o intervalo', () => {
  resetFailureNotice();
  const t0 = 1_000_000_000;
  assert.match(failureNotice('1.2.3.4', t0) ?? '', /1\.2\.3\.4/);
  assert.equal(failureNotice('1.2.3.4', t0 + 60_000), null);
  assert.equal(failureNotice('5.6.7.8', t0 + 120_000), null);
  const later = failureNotice('5.6.7.8', t0 + 11 * 60_000) ?? '';
  assert.match(later, /3 desde o último aviso/);
  assert.match(later, /5\.6\.7\.8/);
});
