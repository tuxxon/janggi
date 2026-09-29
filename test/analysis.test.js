import { afterEach, describe, expect, it, vi } from "vitest";
import * as analysis from "../src/analysis/service.js";

class FakeEngine {
  commands = [];
  listeners = new Set();
  FS = { writeFile: vi.fn() };
  addMessageListener = (fn) => this.listeners.add(fn);
  removeMessageListener = (fn) => this.listeners.delete(fn);
  postMessage = (command) => {
    this.commands.push(command);
    if (command === "uci") this.emit("uciok");
    if (command === "isready") this.emit("readyok");
  };
  emit(line) { for (const fn of [...this.listeners]) fn(line); }
  finish(cp = 0, move = "a4a5") {
    this.emit(`info depth 12 multipv 1 score cp ${cp} nodes 100 pv ${move}`);
    this.emit(`bestmove ${move}`);
  }
  get searches() { return this.commands.filter((c) => c.startsWith("go ")); }
  get positions() { return this.commands.filter((c) => c.startsWith("position ")); }
}
const position = (ply, turn = ply % 2 ? "h" : "c", extra = {}) => ({ ply, turn, fen: `fen-${ply}`, ...extra });
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const services = [];
function setup(options = {}) {
  const engine = new FakeEngine(), results = [], statuses = [];
  const service = analysis.createAnalysisService({ createEngine: async () => engine,
    onResult: (r) => results.push(r), onStatus: (s) => statuses.push(s), ...options });
  services.push(service);
  return { engine, results, statuses, service };
}
afterEach(() => { for (const s of services.splice(0)) s.dispose(); vi.useRealTimers(); });

describe("ordered UCI analysis", () => {
  it("exposes an injectable pure-JS service", () => {
    expect(analysis.createAnalysisService).toBeTypeOf("function");
  });
  it("analyses every ply in order without skipping and exposes remaining count", async () => {
    const { service, engine, results } = setup();
    service.sync("game-a", [position(0)]);
    await service.ready;
    service.sync("game-a", [position(0), position(1), position(2)]);
    expect(service.status.pending).toBe(3);
    expect(engine.positions).toEqual(["position fen fen-0"]);
    engine.finish(0); await tick();
    expect(engine.positions).toEqual(["position fen fen-0", "position fen fen-1"]);
    engine.finish(190, "a7a6"); await tick();
    engine.finish(-190); await tick();
    expect(results.map((r) => r.ply)).toEqual([0, 1, 2]);
    expect(results[1]).toMatchObject({ gameId: "game-a", ply: 1, cp: -190, depth: 12 });
    expect(results[1].win).toBeCloseTo(33.22, 1);
    expect(results[2].win).toBeCloseTo(33.22, 1);
    expect(engine.searches).toEqual(["go movetime 800", "go movetime 800", "go movetime 800"]);
    expect(engine.commands).toContain("setoption name MultiPV value 5");
    expect(service.status.pending).toBe(0);
  });
  it("keeps MultiPV candidates ordered and in the mover's perspective, including pass and mate", async () => {
    const { service, engine, results } = setup();
    service.sync("game-a", [position(0, "h")]); await service.ready;
    engine.emit("info depth 9 multipv 2 score cp -190 pv a7a6 a4a5");
    engine.emit("info depth 10 multipv 1 score mate 3 pv e9e9");
    engine.emit("info depth 10 multipv 3 score cp 0 pv c7c6");
    engine.emit("bestmove e9e9"); await tick();
    expect(results[0]).toMatchObject({ mate: -3, win: 0, depth: 10, best: "pass", candidates: [
      { move: "pass", mate: 3, win: 100 },
      { move: "a7a6", cp: -190 },
      { move: "c7c6", cp: 0, win: 50 },
    ] });
    expect(results[0].candidates[1].win).toBeCloseTo(33.22, 1);
    expect(results[0]).not.toHaveProperty("cp");
  });
  it("stops on undo, drains late bestmove, discards invalidated plies and analyses a new branch", async () => {
    const { service, engine, results } = setup();
    service.sync("a", [position(0), position(1), position(2)]); await service.ready;
    engine.finish(); await tick();
    service.sync("a", [position(0)]);
    expect(engine.commands.at(-1)).toBe("stop");
    service.sync("a", [position(0), position(1, "h", { fen: "branch" })]);
    expect(engine.searches).toHaveLength(2);
    engine.finish(900); await tick();
    expect(results.map((r) => r.ply)).toEqual([0]);
    expect(engine.positions.at(-1)).toBe("position fen branch");
    engine.finish(-190, "a7a6"); await tick();
    expect(results.map((r) => r.cp)).toEqual([0, 190]);
    expect(engine.positions).not.toContain("position fen fen-2");
  });
  it("stops and discards results when switching games even with identical FENs", async () => {
    const { service, engine, results } = setup();
    service.sync("a", [position(0), position(1)]); await service.ready;
    service.sync("b", [position(0)]);
    expect(engine.commands.at(-1)).toBe("stop");
    engine.finish(999); await tick();
    expect(results).toEqual([]);
    engine.finish(0); await tick();
    expect(results.map((r) => r.gameId)).toEqual(["b"]);
  });
  it("records a terminal mate-zero score without a PV instead of restarting forever", async () => {
    const { service, engine, results } = setup();
    service.sync("a", [position(0, "h")]); await service.ready;
    engine.emit("info depth 0 score mate 0");
    engine.emit("bestmove (none)"); await tick();
    expect(results[0]).toMatchObject({ ply: 0, mate: 0, win: 100, depth: 0, candidates: [], best: null });
    expect(service.status.pending).toBe(0);
  });
});

describe("max moves and focused hints", () => {
  it("uses a 3000ms max search as that ply's analysis and returns bestmove (including pass)", async () => {
    const { service, engine, results } = setup();
    service.sync("a", [position(0, "c", { max: true })]);
    await service.ready;
    const move = service.bestMove(0);
    engine.finish(190, "e2e2"); await tick();
    expect(await move).toBe("pass");
    expect(await service.bestMove(0)).toBe("pass");
    expect(engine.searches).toEqual(["go movetime 3000"]);
    expect(engine.commands.some((c) => c.includes("Skill Level"))).toBe(false);
    expect(results[0]).toMatchObject({ ply: 0, cp: 190, movetime: 3000, best: "pass" });
  });
  it("waits for all queued positions before running focused searchmoves with one MultiPV per move", async () => {
    const { service, engine } = setup();
    service.sync("a", [position(0), position(1)]); await service.ready;
    const focus = service.focus(1, ["a7a6", "c7c6"]);
    engine.finish(); await tick();
    expect(engine.searches).toEqual(["go movetime 800", "go movetime 800"]);
    engine.finish(0, "a7a6"); await tick();
    expect(engine.commands.slice(-3)).toEqual(["setoption name MultiPV value 2", "position fen fen-1", "go movetime 500 searchmoves a7a6 c7c6"]);
    engine.emit("info depth 14 multipv 2 score cp 0 pv c7c6");
    engine.emit("info depth 14 multipv 1 score mate 2 pv a7a6");
    engine.emit("bestmove a7a6");
    expect(await focus).toEqual([{ move: "a7a6", mate: 2, win: 100 }, { move: "c7c6", cp: 0, win: 50 }]);
  });
  it("cancels a running focus on selection change and discards its late result", async () => {
    const { service, engine } = setup();
    service.sync("a", [position(0)]); await service.ready;
    engine.finish(); await tick();
    const old = service.focus(0, ["a4a5"]);
    const next = service.focus(0, ["c4c5"]);
    expect(await old).toBeNull();
    expect(engine.commands.at(-1)).toBe("stop");
    engine.finish(999); await tick();
    expect(engine.searches.at(-1)).toBe("go movetime 500 searchmoves c4c5");
    engine.finish(0, "c4c5");
    expect(await next).toEqual([{ move: "c4c5", cp: 0, win: 50 }]);
    const cleared = service.focus(0, ["a4a5"]);
    service.cancelFocus();
    expect(await cleared).toBeNull();
    expect(engine.commands.at(-1)).toBe("stop");
  });
  it("preempts focus when a move adds a position and never starts a cancelled pending focus", async () => {
    const { service, engine, results } = setup();
    service.sync("a", [position(0)]); await service.ready;
    const pending = service.focus(0, ["a4a5"]);
    service.cancelFocus(); expect(await pending).toBeNull();
    engine.finish(); await tick();
    expect(engine.searches).toHaveLength(1);
    const running = service.focus(0, ["a4a5"]);
    service.sync("a", [position(0), position(1)]);
    expect(await running).toBeNull();
    engine.finish(999); await tick();
    expect(results).toHaveLength(1);
    expect(engine.searches.at(-1)).toBe("go movetime 800");
    expect(engine.positions.at(-1)).toBe("position fen fen-1");
  });
  it("rejects an unusable bestmove explicitly", async () => {
    const { service, engine } = setup();
    service.sync("a", [position(0, "c", { max: true })]); await service.ready;
    const move = service.bestMove(0);
    const rejected = expect(move).rejects.toThrow("최강 엔진의 수");
    engine.finish(0, "(none)");
    await rejected;
  });
});

describe("engine recovery and NNUE", () => {
  it("serializes network changes that arrive during the isready handshake", async () => {
    const { service, engine } = setup();
    await service.ready;
    const originalPost = engine.postMessage;
    engine.postMessage = (command) => {
      if (command === "isready") engine.commands.push(command);
      else originalPost(command);
    };
    const first = service.setNetwork(new Uint8Array([1]), "first.nnue");
    let removed = false;
    const second = service.setNetwork(null).then(() => { removed = true; });
    engine.emit("readyok"); await tick();
    expect(engine.commands.at(-2)).toBe("setoption name Use NNUE value false");
    expect(removed).toBe(false);
    engine.emit("readyok"); await second; await first;
    expect(removed).toBe(true);
  });
  it("keeps a user's network change made while initial cache loading is still pending", async () => {
    let loaded;
    const { service, engine } = setup({ loadNetwork: () => new Promise((resolve) => { loaded = resolve; }) });
    service.sync("a", [position(0)]);
    const bytes = new Uint8Array([7, 8]);
    const applied = service.setNetwork(bytes, "uploaded.nnue");
    loaded(null); await service.ready; await applied;
    expect(engine.FS.writeFile).toHaveBeenCalledWith("/uploaded.nnue", bytes);
    expect(engine.commands).toContain("setoption name Use NNUE value true");
  });
  it("retries a load failure once and then disables with the reason", async () => {
    const createEngine = vi.fn().mockRejectedValue(new Error("WASM load failed"));
    const { service } = setup({ createEngine });
    service.sync("a", [position(0)]); await service.ready;
    expect(createEngine).toHaveBeenCalledTimes(2);
    expect(service.status).toMatchObject({ state: "disabled", reason: "WASM load failed" });
    await expect(service.bestMove(0)).rejects.toThrow("WASM load failed");
  });
  it("restarts once after a crash, resumes queued plies, and disables on a second crash", async () => {
    const engines = [new FakeEngine(), new FakeEngine()], crashes = [];
    const createEngine = vi.fn(async ({ onError }) => { crashes.push(onError); return engines[crashes.length - 1]; });
    const { service, results } = setup({ createEngine });
    service.sync("a", [position(0), position(1)]); await service.ready;
    crashes[0](new Error("worker crashed")); await tick();
    expect(createEngine).toHaveBeenCalledTimes(2);
    engines[0].finish(999); expect(results).toEqual([]);
    engines[1].finish(0); await tick();
    expect(results.map((r) => r.ply)).toEqual([0]);
    expect(engines[1].positions.at(-1)).toBe("position fen fen-1");
    crashes[1](new Error("crashed again")); await tick();
    expect(service.status).toMatchObject({ state: "disabled", reason: "crashed again" });
    expect(createEngine).toHaveBeenCalledTimes(2);
  });
  it("treats a search that never returns bestmove as failure instead of hanging forever", async () => {
    vi.useFakeTimers();
    const engines = [new FakeEngine(), new FakeEngine()];
    const createEngine = vi.fn().mockResolvedValueOnce(engines[0]).mockResolvedValueOnce(engines[1]);
    const { service } = setup({ createEngine });
    service.sync("a", [position(0)]); await service.ready;
    await vi.advanceTimersByTimeAsync(16000);
    expect(createEngine).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(16000);
    expect(service.status.state).toBe("disabled");
    expect(service.status.reason).toMatch(/응답/);
  });
  it("reports classical until the engine confirms NNUE in a search line", async () => {
    const { service, engine, results } = setup();
    service.sync("a", [position(0)]); await service.ready;
    expect(service.status.nnue).toBe("off");
    engine.emit("info string NNUE evaluation using /janggi.nnue enabled");
    expect(service.status.nnue).toBe("on");
    engine.finish(); await tick();
    expect(results[0].nnue).toBe("on");
    service.sync("a", [position(0), position(1)]);
    engine.emit("info string classical evaluation enabled");
    expect(service.status.nnue).toBe("off");
  });
  it("applies a runtime network only after stopping the old search and reanalyses with the new evaluation", async () => {
    const onReset = vi.fn();
    const { service, engine, results } = setup({ onReset });
    service.sync("a", [position(0)]); await service.ready;
    const bytes = new Uint8Array([1, 2, 3]);
    const applied = service.setNetwork(bytes, "test.nnue");
    expect(onReset).toHaveBeenCalledOnce();
    expect(engine.commands.at(-1)).toBe("stop");
    expect(engine.FS.writeFile).not.toHaveBeenCalled();
    engine.finish(999); await applied; await tick();
    expect(results).toEqual([]);
    expect(engine.FS.writeFile).toHaveBeenCalledWith("/test.nnue", bytes);
    expect(engine.commands).toContain("setoption name EvalFile value /test.nnue");
    expect(engine.commands).toContain("setoption name Use NNUE value true");
    expect(engine.commands.filter((c) => c === "isready")).toHaveLength(2);
    expect(service.status.nnue).toBe("off");
    engine.emit("info string NNUE evaluation using /test.nnue enabled");
    engine.finish(); await tick();
    expect(results[0]).toMatchObject({ nnue: "on", ply: 0 });
    await service.setNetwork(null); await tick();
    expect(engine.commands).toContain("setoption name Use NNUE value false");
    expect(service.status.nnue).toBe("off");
  });
});

describe("cached evaluations from the record", () => {
  it("skips past plies that already have a stored evaluation and searches the rest in order", async () => {
    const { service, engine } = setup();
    const known = { cp: 12, win: 51.1, depth: 17 };
    service.sync("g", [position(0, "c", { known }), position(1, "h", { known }), position(2), position(3)]);
    await service.ready;
    expect(engine.positions).toEqual(["position fen fen-2"]);
    expect(service.status.pending).toBe(2);
    engine.finish(); await tick();
    expect(engine.positions).toEqual(["position fen fen-2", "position fen fen-3"]);
  });
  it("still analyses the current ply even when cached (candidates and best move are not stored)", async () => {
    const { service, engine } = setup();
    const known = { cp: 12, win: 51.1, depth: 17 };
    service.sync("g", [position(0, "c", { known }), position(1, "h", { known, max: true })]);
    await service.ready;
    expect(engine.positions).toEqual(["position fen fen-1"]);
    expect(engine.searches).toEqual(["go movetime 3000"]);
    const best = service.bestMove(1);
    engine.finish(-30, "b10c8"); await tick();
    await expect(best).resolves.toEqual([1, 20]);
  });
  it("a max engine turn after a long restored game is searched first, not after re-analysing history", async () => {
    const { service, engine } = setup();
    const known = { cp: 0, win: 50, depth: 15 };
    const history = Array.from({ length: 40 }, (_, ply) => position(ply, ply % 2 ? "h" : "c", { known }));
    service.sync("g", [...history, position(40, "c", { max: true })]);
    await service.ready;
    expect(engine.positions).toEqual(["position fen fen-40"]);
  });
});

describe("review fixes: max priority, max strength, network loading", () => {
  it("searches the max engine ply before an unanalysed history backlog (review MED)", async () => {
    const { service, engine } = setup();
    const history = Array.from({ length: 40 }, (_, ply) => position(ply));
    service.sync("g", [...history, position(40, "c", { max: true })]);
    await service.ready;
    expect(engine.positions).toEqual(["position fen fen-40"]);
  });
  it("after a network change the pending max ply is searched before re-analysing history (review MED)", async () => {
    const { service, engine } = setup();
    const known = { cp: 0, win: 50, depth: 15 };
    const history = Array.from({ length: 30 }, (_, ply) => position(ply, ply % 2 ? "h" : "c", { known }));
    service.sync("g", [...history, position(30, "c", { max: true })]);
    await service.ready;
    const applied = service.setNetwork(new Uint8Array([1]), "n.nnue");
    engine.finish(); await applied; await tick();
    expect(engine.positions.at(-1)).toBe("position fen fen-30");
  });
  it("searches the max move with MultiPV 1 so the best move gets the whole budget", async () => {
    const { service, engine } = setup();
    service.sync("g", [position(0, "c", { max: true })]); await service.ready;
    const go = engine.commands.lastIndexOf("go movetime 3000");
    expect(engine.commands.slice(0, go).filter((c) => c.startsWith("setoption name MultiPV")).at(-1)).toBe("setoption name MultiPV value 1");
  });
  it("does not hang when loading the stored network never settles (review LOW)", async () => {
    vi.useFakeTimers();
    const { service, engine } = setup({ loadNetwork: () => new Promise(() => {}) });
    service.sync("g", [position(0)]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(service.status.state).toBe("ready");
    expect(engine.positions).toEqual(["position fen fen-0"]);
  });
});

describe("controller switched to the engine at 'max' (user request 2026-09-28)", () => {
  it("re-searches the current ply as a real max move instead of reusing its 800 ms analysis", async () => {
    const { service, engine } = setup();
    service.sync("g", [position(0)]); await service.ready;
    engine.finish(10, "a4a5"); await tick();            // 사람 차례였던 국면의 일반 분석(MultiPV 5, 800ms)
    service.sync("g", [position(0, "c", { max: true })]); // 그 편을 엔진(최강)으로 바꿨다
    await tick();
    expect(engine.searches.at(-1)).toBe("go movetime 3000");
    const best = service.bestMove(0);
    engine.finish(20, "b1c3"); await tick();
    await expect(best).resolves.toEqual([82, 65]);
  });
});

describe("repetition-restricted positions (user request: Kakao Janggi)", () => {
  it("adds searchmoves to position and max searches when the position restricts root moves", async () => {
    const { service, engine } = setup();
    service.sync("g", [position(0, "c", { searchmoves: ["a1a3", "e2e2"] })]); await service.ready;
    expect(engine.searches.at(-1)).toBe("go movetime 800 searchmoves a1a3 e2e2");
    engine.finish(); await tick();
    service.sync("g", [position(0, "c", { searchmoves: ["a1a3", "e2e2"], max: true })]); await tick();
    expect(engine.searches.at(-1)).toBe("go movetime 3000 searchmoves a1a3 e2e2");
  });
});

describe("candidates from an interrupted MultiPV iteration (found while checking Korean names)", () => {
  it("never lists the same move twice when a deeper iteration stops part-way", async () => {
    const { service, engine, results } = setup();
    service.sync("g", [position(0)]); await service.ready;
    engine.emit("info depth 10 multipv 1 score cp 30 pv a4b4");
    engine.emit("info depth 10 multipv 2 score cp 20 pv b1c3");
    engine.emit("info depth 10 multipv 3 score cp 10 pv g1f3");
    engine.emit("info depth 11 multipv 1 score cp 40 pv g1f3");   // 11수 반복이 두 줄만 나오고 멈췄다
    engine.emit("info depth 11 multipv 2 score cp 35 pv a4b4");
    engine.emit("bestmove g1f3"); await tick();
    const moves = results[0].candidates.map((c) => c.move);
    expect(new Set(moves).size).toBe(moves.length);
    expect(moves.slice(0, 2)).toEqual(["g1f3", "a4b4"]);
  });
});

describe("deeper analysis (user request 2026-09-29)", () => {
  const line = (depth, cp, move = "a4a5", rank = 1) => `info depth ${depth} multipv ${rank} score cp ${cp} nodes 100 pv ${move}`;
  it("sends the configured Threads and Hash at start (defaults 1 and 32)", async () => {
    const a = setup({ threads: 7, hash: 64 }); a.service.sync("g", [position(0)]); await a.service.ready;
    expect(a.engine.commands).toContain("setoption name Threads value 7");
    expect(a.engine.commands).toContain("setoption name Hash value 64");
    const b = setup(); b.service.sync("g", [position(0)]); await b.service.ready;
    expect(b.engine.commands).toContain("setoption name Threads value 1");
    expect(b.engine.commands).toContain("setoption name Hash value 32");
  });
  it("analyses positions for 3000 ms in deep mode and 800 ms in fast mode", async () => {
    const { service, engine } = setup({ mode: "deep" });
    service.sync("g", [position(0)]); await service.ready;
    expect(engine.searches.at(-1)).toBe("go movetime 3000");
    engine.finish(); await tick();
    service.setMode("fast");
    service.sync("g", [position(0), position(1)]); await tick();
    expect(engine.searches.at(-1)).toBe("go movetime 800");
  });
  it("continuous: after the quick pass, deepens the last ply with a 20 s cap when idle", async () => {
    const { service, engine } = setup({ mode: "continuous" });
    service.sync("g", [position(0), position(1)]); await service.ready;
    engine.finish(); await tick();
    expect(engine.searches.at(-1)).toBe("go movetime 800");
    engine.finish(); await tick();
    expect(engine.positions.at(-1)).toBe("position fen fen-1");
    expect(engine.searches.at(-1)).toBe("go movetime 20000");
    expect(service.status.deepening).toBe(true);
  });
  it("continuous: reports progressively only when a deeper depth than already shown arrives", async () => {
    const { service, engine, results } = setup({ mode: "continuous" });
    service.sync("g", [position(0)]); await service.ready;
    engine.finish(10); await tick();                          // 빠른 1차 결과: depth 12
    const before = results.length;
    engine.emit(line(5, 1)); engine.emit(line(12, 2));        // 다시 시작한 탐색의 얕은 줄은 보여주지 않는다
    expect(results.length).toBe(before);
    engine.emit(line(13, 7)); engine.emit(line(13, 8));
    expect(results.length).toBe(before + 1);
    expect(results.at(-1)).toMatchObject({ ply: 0, depth: 13, cp: 7 });
    engine.emit(line(15, 9, "b1c3"));
    expect(results.at(-1)).toMatchObject({ depth: 15, cp: 9, candidates: [{ move: "b1c3" }] });
  });
  it("a new position preempts deepening and is analysed first", async () => {
    const { service, engine } = setup({ mode: "continuous" });
    service.sync("g", [position(0)]); await service.ready;
    engine.finish(); await tick();
    expect(engine.searches.at(-1)).toBe("go movetime 20000");
    service.sync("g", [position(0), position(1)]);
    expect(engine.commands.at(-1)).toBe("stop");
    engine.emit("bestmove a4a5"); await tick();
    expect(engine.positions.at(-1)).toBe("position fen fen-1");
    expect(engine.searches.at(-1)).toBe("go movetime 800");
  });
  it("a focus search preempts deepening, and deepening resumes afterwards", async () => {
    const { service, engine } = setup({ mode: "continuous" });
    service.sync("g", [position(0)]); await service.ready;
    engine.finish(); await tick();
    const focused = service.focus(0, ["a4a5"]);
    expect(engine.commands.at(-1)).toBe("stop");
    engine.emit("bestmove a4a5"); await tick();
    expect(engine.searches.at(-1)).toBe("go movetime 500 searchmoves a4a5");
    engine.finish(3, "a4a5"); await tick();
    await expect(focused).resolves.toHaveLength(1);
    expect(engine.searches.at(-1)).toBe("go movetime 20000");
  });
  it("deepen(ply) moves deepening to another ply (review), deepen(null) returns to the last ply", async () => {
    const { service, engine } = setup({ mode: "continuous" });
    service.sync("g", [position(0), position(1)]); await service.ready;
    engine.finish(); await tick(); engine.finish(); await tick();
    expect(engine.positions.at(-1)).toBe("position fen fen-1");
    service.deepen(0);
    expect(engine.commands.at(-1)).toBe("stop");
    engine.emit("bestmove a4a5"); await tick();
    expect(engine.positions.at(-1)).toBe("position fen fen-0");
    expect(engine.searches.at(-1)).toBe("go movetime 20000");
    service.deepen(null);
    engine.emit("bestmove a4a5"); await tick();
    expect(engine.positions.at(-1)).toBe("position fen fen-1");
  });
  it("does not deepen a ply again after its capped search finished; switching the mode re-enables it", async () => {
    const { service, engine } = setup({ mode: "continuous" });
    service.sync("g", [position(0)]); await service.ready;
    engine.finish(); await tick();
    const count = engine.searches.length;                                     // 깊게 보기까지 시작했다
    engine.emit(line(20, 5)); engine.emit("bestmove a4a5"); await tick();   // 20초 상한까지 다 읽었다
    expect(engine.searches).toHaveLength(count);
    service.setMode("fast");
    expect(engine.searches).toHaveLength(count);
    service.setMode("continuous"); await tick();
    expect(engine.searches).toHaveLength(count + 1);
    expect(engine.searches.at(-1)).toBe("go movetime 20000");
  });
  it("switching to fast stops an active deepening search", async () => {
    const { service, engine } = setup({ mode: "continuous" });
    service.sync("g", [position(0)]); await service.ready;
    engine.finish(); await tick();
    service.setMode("fast");
    expect(engine.commands.at(-1)).toBe("stop");
    expect(service.status.deepening).toBe(false);   // bestmove 를 기다리지 않고 바로 표시를 끈다
    engine.emit("bestmove a4a5"); await tick();
    expect(service.status.deepening).toBe(false);
  });
  it("never deepens a max engine turn", async () => {
    const { service, engine } = setup({ mode: "continuous" });
    service.sync("g", [position(0, "c", { max: true })]); await service.ready;
    expect(engine.searches.at(-1)).toBe("go movetime 3000");
    engine.finish(); await tick();
    expect(engine.searches).toEqual(["go movetime 3000"]);
  });
  it("the watchdog allows the long capped search (movetime + margin)", async () => {
    vi.useFakeTimers();
    const { service, engine } = setup({ mode: "continuous" });
    service.sync("g", [position(0)]);
    await vi.advanceTimersByTimeAsync(0); await service.ready;
    engine.finish(); await vi.advanceTimersByTimeAsync(0);
    expect(engine.searches.at(-1)).toBe("go movetime 20000");
    // 재시작해도 같은 가짜 엔진이 다시 ready 가 되므로 state 가 아니라 재시작(uci 재전송)을 센다.
    const starts = () => engine.commands.filter((c) => c === "uci").length;
    await vi.advanceTimersByTimeAsync(34_000);
    expect(starts()).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);        // 20초 + 15초가 지나도 bestmove 가 없으면 여전히 실패로 본다
    expect(starts()).toBe(2);
  });
  it("re-syncing the same positions does not interrupt deepening", async () => {
    const { service, engine } = setup({ mode: "continuous" });
    service.sync("g", [position(0)]); await service.ready;
    engine.finish(); await tick();
    const count = engine.commands.length;
    service.sync("g", [position(0)]); await tick();
    expect(engine.commands).toHaveLength(count);
  });
  it("ignores lines that arrive after a deepening search was stopped", async () => {
    const { service, engine, results } = setup({ mode: "continuous" });
    service.sync("g", [position(0)]); await service.ready;
    engine.finish(); await tick();
    const before = results.length;
    service.setMode("fast");
    engine.emit(line(30, 99)); engine.emit("bestmove a4a5"); await tick();
    expect(results.length).toBe(before);
  });
  it("deepen() with the ply already being deepened keeps the search running", async () => {
    const { service, engine } = setup({ mode: "continuous" });
    service.sync("g", [position(0), position(1)]); await service.ready;
    engine.finish(); await tick(); engine.finish(); await tick();
    const count = engine.commands.length;
    service.deepen(1); service.deepen(null); await tick();
    expect(engine.commands).toHaveLength(count);
  });
  it("a network change lets a capped ply be deepened again", async () => {
    const { service, engine } = setup({ mode: "continuous" });
    service.sync("g", [position(0)]); await service.ready;
    engine.finish(); await tick();
    engine.emit("bestmove a4a5"); await tick();                // 상한까지 다 읽었다
    const applied = service.setNetwork(null); await applied; await tick();
    engine.finish(); await tick();                             // 새 평가로 빠른 분석
    expect(engine.searches.at(-1)).toBe("go movetime 20000");
  });
  it("results record the analysis mode and thread count (for the record's engine string)", async () => {
    const { service, engine, results } = setup({ mode: "continuous", threads: 7 });
    service.sync("g", [position(0)]); await service.ready;
    engine.finish(); await tick();
    expect(results[0]).toMatchObject({ mode: "continuous", threads: 7, movetime: 800 });
    engine.emit(line(20, 5));
    expect(results.at(-1)).toMatchObject({ mode: "continuous", threads: 7, movetime: 20000, depth: 20 });
  });
  it("rejects an unknown mode instead of silently picking one", () => {
    expect(() => setup({ mode: "slow" })).toThrow("분석 모드");
    const { service } = setup();
    expect(() => service.setMode("slow")).toThrow("분석 모드");
  });
});
