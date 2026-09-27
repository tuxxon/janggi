// User-owned NNUE delivery; no production download endpoint.
export const NNUE = { name: "janggi-9991472750de.nnue", size: 11261920, shaPrefix: "9991472750de" };
const CACHE = "janggi-nnue-v1";
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");

export function createNetworkStore({ cacheStorage = globalThis.caches, fetcher = globalThis.fetch,
  digest = (bytes) => globalThis.crypto.subtle.digest("SHA-256", bytes),
  dev = import.meta.env?.DEV, base = import.meta.env?.BASE_URL ?? "/" } = {}) {
  const key = base + "nnue/" + NNUE.name;
  async function verify(source) {
    const bytes = new Uint8Array(await source.arrayBuffer());
    if (bytes.length !== NNUE.size) throw new Error(`NNUE 크기가 달라요: ${bytes.length}바이트 (필요: ${NNUE.size})`);
    const sha = hex(await digest(bytes));
    if (!sha.startsWith(NNUE.shaPrefix)) throw new Error(`NNUE SHA-256이 달라요: ${sha.slice(0, 12)} (필요: ${NNUE.shaPrefix})`);
    return bytes;
  }
  return {
    async load() {
      try {
        const cache = await cacheStorage.open(CACHE), hit = await cache.match(key);
        if (hit) {
          try { return await verify(hit); }
          catch { await cache.delete(key); }
        }
      } catch { /* Cache Storage may be unavailable; classical still works. */ }
      if (dev) {
        try {
          const response = await fetcher(base + "dev-nnue/" + NNUE.name);
          if (response.ok) return await verify(response);
        } catch { /* Missing/unverified dev files are optional. */ }
      }
      return null;
    },
    async add(file) {
      if (!/\.nnue$/i.test(file.name)) throw new Error(".nnue 파일을 골라 주세요.");
      const bytes = await verify(file);
      const cache = await cacheStorage.open(CACHE);
      await cache.put(key, new Response(bytes));
      return bytes;
    },
    async clear() { const cache = await cacheStorage.open(CACHE); await cache.delete(key); },
  };
}
