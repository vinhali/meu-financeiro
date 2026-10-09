// Cache em memória das telas do Open Finance. Rodar: npm test (em server/).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cached, invalidateOpenFinance } from '../src/openfinance/cache';

test('reaproveita a carga até invalidar ou vencer; pedidos simultâneos dividem a mesma carga', async () => {
  let loads = 0;
  const load = async () => ++loads;
  const [a, b] = await Promise.all([cached('k', 60_000, load), cached('k', 60_000, load)]);
  assert.deepEqual([a, b, loads], [1, 1, 1]);
  assert.equal(await cached('k', 60_000, load), 1);
  invalidateOpenFinance();
  assert.equal(await cached('k', 60_000, load), 2);
  // Prazo vencido: carrega de novo.
  assert.equal(await cached('ttl', -1, load), 3);
  assert.equal(await cached('ttl', 60_000, load), 4);
});

test('carga que falha não fica guardada', async () => {
  invalidateOpenFinance();
  let calls = 0;
  const flaky = async () => {
    if (++calls === 1) throw new Error('falhou');
    return 'ok';
  };
  await assert.rejects(cached('f', 60_000, flaky));
  assert.equal(await cached('f', 60_000, flaky), 'ok');
});
