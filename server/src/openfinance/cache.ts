// Cache em memória do que é caro de montar a partir dos dados do Open Finance (milhares de
// lançamentos lidos e reprocessados a cada tela). Os dados só mudam em três momentos — uma
// sincronização, um rótulo editado, a virada do tempo — então cada entrada vale até a próxima
// invalidação ou até o prazo, o que vier antes.
const store = new Map<string, { expires: number; version: number; value: Promise<unknown> }>();
let version = 0;

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.version === version && hit.expires > Date.now()) return hit.value as Promise<T>;
  // Guarda a promessa: pedidos simultâneos esperam a mesma carga em vez de repetir a leitura.
  const value = load();
  store.set(key, { expires: Date.now() + ttlMs, version, value });
  // Uma carga que falhou não fica guardada.
  value.catch(() => store.get(key)?.value === value && store.delete(key));
  if (store.size > 200) for (const [k, v] of store) if (v.version !== version || v.expires <= Date.now()) store.delete(k);
  return value;
}

// Chamar sempre que os dados de origem mudarem (sincronização, rótulo de estabelecimento).
export function invalidateOpenFinance(): void {
  version++;
  store.clear();
}
