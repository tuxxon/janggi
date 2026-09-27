import { describe, it, expect, vi } from "vitest";
import * as nnue from "../src/analysis/nnue.js";
import { readFileSync } from "node:fs";

function setup({ dev = false, hit = null, fetcher = vi.fn(), hash = "9991472750de" } = {}) {
  const cache = { match: vi.fn(async () => hit), put: vi.fn(), delete: vi.fn() };
  const cacheStorage = { open: vi.fn(async () => cache) };
  const digest = vi.fn(async () => Uint8Array.from(hash.match(/../g), (v) => parseInt(v, 16)));
  const store = nnue.createNetworkStore({ cacheStorage, fetcher, digest, dev, base: "/janggi/" });
  return { cache, cacheStorage, digest, fetcher, store };
}
const bytes = () => new Uint8Array(11261920);
const file = (data = bytes(), name = "janggi.nnue") => ({ name, arrayBuffer: async () => data.buffer });

describe("user NNUE delivery", () => {
  it("exposes the fixed network identity and a testable store", () => {
    expect(nnue.NNUE).toEqual({ name: "janggi-9991472750de.nnue", size: 11261920, shaPrefix: "9991472750de" });
    expect(nnue.createNetworkStore).toBeTypeOf("function");
  });
  it("defaults to classical in production without any network fetch", async () => {
    const { store, fetcher } = setup();
    expect(await store.load()).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(readFileSync(new URL("../src/analysis/fsf.js", import.meta.url), "utf8")).not.toMatch(/drive\.usercontent|drive\.google/);
  });
  it("prefers the verified user cache to the dev-only same-origin path", async () => {
    const { store, cache, fetcher } = setup({ dev: true, hit: new Response(bytes()) });
    expect((await store.load()).length).toBe(11261920);
    expect(fetcher).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });
  it("uses a dev-only same-origin file without caching it as a user upload", async () => {
    const { store, cache, fetcher } = setup({ dev: true, fetcher: vi.fn(async () => new Response(bytes())) });
    expect((await store.load()).length).toBe(11261920);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/janggi/dev-nnue/janggi-9991472750de.nnue");
    expect(cache.put).not.toHaveBeenCalled();
  });
  it("falls back to classical when dev file is absent or cache storage is unavailable", async () => {
    const { store, cacheStorage } = setup({ dev: true, fetcher: vi.fn(async () => new Response("missing", { status: 404 })) });
    cacheStorage.open.mockRejectedValue(new Error("storage blocked"));
    expect(await store.load()).toBeNull();
  });
  it("validates size and SHA before caching an uploaded file", async () => {
    const { store, cache, digest } = setup();
    const loaded = await store.add(file());
    expect(loaded.length).toBe(11261920);
    expect(digest).toHaveBeenCalledOnce();
    expect(cache.put).toHaveBeenCalledOnce();
    expect(new Uint8Array(await cache.put.mock.calls[0][1].arrayBuffer()).length).toBe(11261920);
  });
  it("rejects wrong extensions, size and hash without caching bad files", async () => {
    const { store, cache, digest } = setup({ hash: "000000000000" });
    await expect(store.add(file(bytes(), "net.txt"))).rejects.toThrow(".nnue");
    await expect(store.add(file(new Uint8Array(12)))).rejects.toThrow("크기");
    expect(digest).not.toHaveBeenCalled();
    await expect(store.add(file())).rejects.toThrow("SHA-256");
    expect(cache.put).not.toHaveBeenCalled();
  });
  it("evicts corrupt cached bytes and clears the user's network on request", async () => {
    const { store, cache } = setup({ hit: new Response(new Uint8Array(12)) });
    expect(await store.load()).toBeNull();
    expect(cache.delete).toHaveBeenCalledOnce();
    await store.clear();
    expect(cache.delete).toHaveBeenCalledTimes(2);
  });
});
