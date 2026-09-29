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
it("uses half the cores for engine threads, clamped to 1–8 (user request 2026-09-29)", () => {
  expect([undefined, 0, 1, 2, 3, 4, 14, 16, 17, 64].map((cores) => fsf.threadsFor(cores))).toEqual([1, 1, 1, 1, 1, 2, 7, 8, 8, 8]);
});
it("creates the analyzer with that thread count and a 64 MB hash", async () => {
  vi.stubGlobal("navigator", { hardwareConcurrency: 14 });
  const commands = [], listeners = [];
  const engine = { FS: { writeFile() {} }, addMessageListener: (fn) => listeners.push(fn), removeMessageListener() {},
    postMessage: (c) => { commands.push(c); if (c === "uci") listeners.forEach((fn) => fn("uciok")); if (c === "isready") listeners.forEach((fn) => fn("readyok")); } };
  const analyzer = fsf.createAnalyzer({ createEngine: async () => engine, loadNetwork: async () => null });
  await analyzer.ready;
  expect(commands).toContain("setoption name Threads value 7");
  expect(commands).toContain("setoption name Hash value 64");
  analyzer.dispose();
});
it("caps threads on low-memory devices by deviceMemory / 2 (user decision 2026-09-29, review B memory)", () => {
  // deviceMemory 는 크롬 계열만 준다(0.25~8, 8 이상은 8). 없거나 8이면 코어 공식 그대로.
  const cases = [[14, 8], [14, undefined], [16, 8], [8, 4], [8, 2], [8, 1], [8, 0.5], [2, 4], [6, 4]];
  expect(cases.map(([cores, memory]) => fsf.threadsFor(cores, memory))).toEqual([7, 7, 8, 2, 1, 1, 1, 1, 2]);
});
it("passes the device memory to the thread count when creating the analyzer", async () => {
  vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 4 });
  const commands = [], listeners = [];
  const engine = { FS: { writeFile() {} }, addMessageListener: (fn) => listeners.push(fn), removeMessageListener() {},
    postMessage: (c) => { commands.push(c); if (c === "uci") listeners.forEach((fn) => fn("uciok")); if (c === "isready") listeners.forEach((fn) => fn("readyok")); } };
  const analyzer = fsf.createAnalyzer({ createEngine: async () => engine, loadNetwork: async () => null });
  await analyzer.ready;
  expect(commands).toContain("setoption name Threads value 2");
  analyzer.dispose();
});
