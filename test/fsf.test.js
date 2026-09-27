import { afterEach, expect, it, vi } from "vitest";
import * as fsf from "../src/analysis/fsf.js";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("rejects WASM loading without cross-origin isolation with an actionable reason", async () => {
  vi.stubGlobal("self", { crossOriginIsolated: false });
  expect(fsf.loadEngine).toBeTypeOf("function");
  await expect(fsf.loadEngine()).rejects.toThrow("교차 출처 격리");
});
it("loads the same-origin WASM factory and forwards runtime aborts for recovery", async () => {
  vi.stubEnv("BASE_URL", "/janggi/");
  let options;
  const engine = { postMessage: vi.fn(), addMessageListener: vi.fn(), FS: {} };
  const factory = vi.fn(async (o) => { options = o; return engine; });
  vi.stubGlobal("self", { crossOriginIsolated: true, Stockfish: factory });
  const onError = vi.fn();
  expect(fsf.loadEngine).toBeTypeOf("function");
  expect(await fsf.loadEngine({ onError })).toBe(engine);
  expect(options.locateFile("stockfish.wasm")).toBe("/janggi/fsf/stockfish.wasm");
  options.onAbort("worker failed");
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "worker failed" }));
});
