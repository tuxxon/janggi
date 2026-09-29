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
    expect(await focus).toEqual([{ move: "a7a6", mate: 2, win: 100, depth: 14 }, { move: "c7c6", cp: 0, win: 50, depth: 14 }]);
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
    expect(await next).toEqual([{ move: "c4c5", cp: 0, win: 50, depth: 12 }]);
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
    expect(engine.FS.writeFile).toHaveBeenCalledWith("/janggikakao-uploaded.nnue", bytes);
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
    expect(engine.FS.writeFile).not.toHaveBeenCalledWith("/janggikakao-test.nnue", bytes); // 변형 파일은 시작 때 썼다
    engine.finish(999); await applied; await tick();
    expect(results).toEqual([]);
    expect(engine.FS.writeFile).toHaveBeenCalledWith("/janggikakao-test.nnue", bytes);
    expect(engine.commands).toContain("setoption name EvalFile value /janggikakao-test.nnue");
    expect(engine.commands).toContain("setoption name Use NNUE value true");
    expect(engine.commands.filter((c) => c === "isready")).toHaveLength(2);
    expect(service.status.nnue).toBe("off");
    engine.emit("info string NNUE evaluation using /janggikakao-test.nnue enabled");
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

describe("candidates from the engine's last batch (found while checking Korean names; review of 3dce1af)", () => {
  // 엔진은 반복마다 1~N순위를 한 묶음으로 찍고, 한 묶음 안의 수는 서로 다르다. 그때 보던 순위 한 줄은 lowerbound/upperbound
  // (정확하지 않은 점수)로 올 수 있다 — 멈출 때만이 아니라 끝난 반복에서도(리뷰 실측). bound 줄을 버리고 순위별 최신 줄을 섞으면
  // 같은 수가 겹쳐 후보가 4개가 됐고(e2e 12번 중 1번), 모든 순위가 정확한 묶음으로 물러나면 1순위가 엔진이 둔 수와 달랐다
  // (리뷰 A: 실엔진 366회 중 fast 3~5/90, deep 3/30). 엔진이 마지막에 찍은 묶음은 366번 모두 순위가 다 있고, 수가 안 겹치고,
  // 1순위가 bestmove 였다 → 후보는 그 묶음 그대로(bound 줄은 그 점수로)다.
  // 실측(WASM 1.1.12, 초기 국면, 0.8초 MultiPV 5): 13수 반복이 3순위를 보다 멈췄다.
  const stopped = [
    "info depth 12 seldepth 16 multipv 1 score cp 15 nodes 138267 pv b1c3 h10g8",
    "info depth 12 seldepth 15 multipv 2 score cp 14 nodes 138267 pv h1f4 a7b7",
    "info depth 12 seldepth 17 multipv 3 score cp 7 nodes 138267 pv g1f3 h10g8",
    "info depth 12 seldepth 15 multipv 4 score cp 7 nodes 138267 pv i4h4 c10d8",
    "info depth 12 seldepth 12 multipv 5 score cp 0 nodes 138267 pv a4b4 a7b7",
    "info depth 13 currmove h1f4 currmovenumber 3",
    "info depth 13 seldepth 19 multipv 1 score cp 17 nodes 268969 pv b1c3 h10g8",
    "info depth 13 seldepth 15 multipv 2 score cp 15 nodes 268969 pv g1f3 h10g8",
    "info depth 13 seldepth 15 multipv 3 score cp 6 upperbound nodes 268969 pv h1f4 a7b7",
    "info depth 12 seldepth 15 multipv 4 score cp 7 nodes 268969 pv i4h4 c10d8",
    "info depth 12 seldepth 12 multipv 5 score cp 0 nodes 268969 pv a4b4 a7b7",
  ];
  it("lists the last printed batch, the bound rank included with its bound score (was 4 of 5)", async () => {
    const { service, engine, results } = setup();
    service.sync("g", [position(0)]); await service.ready;
    for (const l of stopped) engine.emit(l);
    engine.emit("bestmove b1c3 ponder h10g8"); await tick();
    expect(results[0].candidates.map((c) => c.move)).toEqual(["b1c3", "g1f3", "h1f4", "i4h4", "a4b4"]);
    expect(results[0].candidates.map((c) => c.cp)).toEqual([17, 15, 6, 7, 0]);
    expect(results[0]).toMatchObject({ depth: 13, cp: 17, best: [82, 65] });
  });
  it("the first candidate is the engine's move even when a lower rank is a bound (review A: deep 3 s, real lines)", async () => {
    const { service, engine, results } = setup({ mode: "deep" });
    service.sync("g", [position(0)]); await service.ready;
    for (const l of [
      "info depth 12 multipv 1 score cp 140 nodes 653698 pv a6d6 e7d7", "info depth 12 multipv 2 score cp 129 nodes 653698 pv a6a5 h10g8",
      "info depth 12 multipv 3 score cp 88 nodes 653698 pv a6a2 c10d8", "info depth 12 multipv 4 score cp 88 nodes 653698 pv a6a3 c10d8",
      "info depth 12 multipv 5 score cp 87 nodes 653698 pv a6a1 c10d8", "info depth 13 multipv 1 score cp 116 nodes 1302133 pv a6a5 c10d8",
      "info depth 13 multipv 2 score cp 93 nodes 1302133 pv a6a2 c10d8", "info depth 13 multipv 3 score cp 90 nodes 1302133 pv a6a1 c10d8",
      "info depth 13 multipv 4 score cp 68 nodes 1302133 pv a6a4 c10d8",
      "info depth 13 multipv 5 score cp 50 upperbound nodes 1302133 pv a6d6 e7d7"]) engine.emit(l);
    engine.emit("bestmove a6a5 ponder c10d8"); await tick();
    expect(results[0].candidates.map((c) => c.move)).toEqual(["a6a5", "a6a2", "a6a1", "a6a4", "a6d6"]);
    expect(results[0].candidates.map((c) => c.cp)).toEqual([116, 93, 90, 68, 50]);
    expect(results[0]).toMatchObject({ depth: 13, cp: 116 });
  });
  it("a bound first rank of the evaluated move shows the evaluation line, so the list and the win bar agree (review B)", async () => {
    const { service, engine, results } = setup();
    service.sync("g", [position(0, "c", { max: true })]); await service.ready;
    engine.emit("info depth 12 multipv 1 score cp 15 nodes 900 pv b1c3 h10g8");
    engine.emit("info depth 13 multipv 1 score cp 40 lowerbound nodes 1800 pv b1c3 h10g8");
    engine.emit("bestmove b1c3"); await tick();
    expect(results[0]).toMatchObject({ depth: 12, cp: 15 });
    expect(results[0].candidates).toEqual([{ move: "b1c3", cp: 15, win: results[0].win, depth: 12 }]);
  });
  it("an upperbound first rank (the only kind in 366 real searches) is not the evaluation (review round 2, fast2 #19)", async () => {
    const { service, engine, results } = setup();
    service.sync("g", [position(0)]); await service.ready;
    for (const l of [
      "info depth 11 multipv 1 score cp 76 nodes 291646 pv b1c3 b8e8", "info depth 11 multipv 2 score cp 72 nodes 291646 pv a4b4 h8c8",
      "info depth 11 multipv 3 score cp 53 nodes 291646 pv h1f4 a7b7", "info depth 11 multipv 4 score cp 50 nodes 291646 pv g1f3 a7b7",
      "info depth 11 multipv 5 score cp 45 nodes 291646 pv i4h4 a7b7",
      "info depth 12 multipv 1 score cp 60 upperbound nodes 356857 pv b1c3 a7b7",
      "info depth 11 multipv 2 score cp 72 nodes 356857 pv a4b4 h8c8", "info depth 11 multipv 3 score cp 53 nodes 356857 pv h1f4 a7b7",
      "info depth 11 multipv 4 score cp 50 nodes 356857 pv g1f3 a7b7", "info depth 11 multipv 5 score cp 45 nodes 356857 pv i4h4 a7b7"]) engine.emit(l);
    engine.emit("bestmove b1c3 ponder a7b7"); await tick();
    expect(results[0]).toMatchObject({ depth: 11, cp: 76 });
    expect(results[0].candidates.map((c) => [c.move, c.cp])).toEqual([["b1c3", 76], ["a4b4", 72], ["h1f4", 53], ["g1f3", 50], ["i4h4", 45]]);
  });
  it("a focus search keeps every destination (real lines, 0.5 s MultiPV 3)", async () => {
    const { service, engine } = setup();
    service.sync("g", [position(0)]); await service.ready;
    engine.finish(); await tick();
    const focus = service.focus(0, ["c4b4", "c4c5", "c4d4"]);
    for (const l of ["info depth 12 multipv 1 score cp -46 pv c4d4", "info depth 12 multipv 2 score cp -57 pv c4b4",
      "info depth 12 multipv 3 score cp -66 pv c4c5", "info depth 13 multipv 1 score cp -32 pv c4d4",
      "info depth 13 multipv 2 score cp -60 pv c4c5", "info depth 13 multipv 3 score cp -65 upperbound pv c4b4"]) engine.emit(l);
    engine.emit("bestmove c4d4");
    expect((await focus).map((c) => [c.move, c.cp])).toEqual([["c4d4", -32], ["c4c5", -60], ["c4b4", -65]]);
  });
  it("deepening reports the batch that carries a bound rank once it is complete", async () => {
    const { service, engine, results } = setup({ mode: "continuous" });
    service.sync("g", [position(0)]); await service.ready;
    for (const l of stopped.slice(0, 5)) engine.emit(l);
    engine.emit("bestmove b1c3"); await tick();                                   // 1차 결과: 12수
    for (const l of stopped.slice(0, 5)) engine.emit(l.replace("depth 12", "depth 9")); // 깊게 보기의 얕은 묶음
    const before = results.length;
    for (const l of stopped.slice(5, 10)) engine.emit(l);                        // 13수: 4순위까지
    expect(results.length).toBe(before);
    engine.emit(stopped[10]);                                                     // 5순위로 묶음 완성
    expect(results.length).toBe(before + 1);
    expect(results.at(-1)).toMatchObject({ depth: 13, cp: 17 });
    expect(results.at(-1).candidates.map((c) => c.move)).toEqual(["b1c3", "g1f3", "h1f4", "i4h4", "a4b4"]);
  });
  it("deepening never reports a bound first rank as a deeper evaluation", async () => {
    const { service, engine, results } = setup({ mode: "continuous" });
    service.sync("g", [position(0)]); await service.ready;
    for (const l of stopped.slice(0, 5)) engine.emit(l);
    engine.emit("bestmove b1c3"); await tick();                                   // 1차 결과: 12수
    for (const l of stopped.slice(0, 5)) engine.emit(l.replace("depth 12", "depth 9"));
    const before = results.length;
    engine.emit("info depth 13 multipv 1 score cp 40 lowerbound nodes 300000 pv b1c3 h10g8");
    for (const l of stopped.slice(1, 5)) engine.emit(l);                          // 묶음 완성, 정확한 1순위는 아직 9수
    expect(results.length).toBe(before);
  });
  it("without any complete batch the per-rank lines are used and a move is never listed twice", async () => {
    const { service, engine, results } = setup();
    service.sync("g", [position(0)]); await service.ready;
    engine.emit("info depth 9 multipv 2 score cp 5 pv g1f3");
    engine.emit("info depth 10 multipv 1 score cp 9 pv g1f3");
    engine.emit("bestmove g1f3"); await tick();
    expect(results[0].candidates.map((c) => c.move)).toEqual(["g1f3"]);
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
  it("continuous: with MultiPV, reports once the whole ranked batch of the deeper iteration has arrived (found in screenshots)", async () => {
    const { service, engine, results } = setup({ mode: "continuous" });
    service.sync("g", [position(0)]); await service.ready;
    engine.emit(line(12, 30, "a4a5", 1)); engine.emit(line(12, 20, "b1c3", 2)); engine.emit(line(12, 10, "g1f3", 3));
    engine.emit("bestmove a4a5"); await tick();                                     // 빠른 1차 결과(3순위까지)
    for (const [rank, move] of [[1, "a4a5"], [2, "b1c3"], [3, "g1f3"]]) engine.emit(line(8, 0, move, rank)); // 깊게 보기의 얕은 묶음
    const before = results.length;
    engine.emit(line(13, 40, "b1c3", 1));                                          // 13수 반복의 1순위: 12수 2순위와 같은 수
    expect(results.length).toBe(before);                                            // 아직 2·3순위는 12수 것 → 보내지 않는다
    engine.emit(line(13, 35, "a4a5", 2)); engine.emit(line(13, 5, "g1f3", 3));
    expect(results.length).toBe(before + 1);
    expect(results.at(-1)).toMatchObject({ depth: 13, cp: 40, best: [82, 65] });
    expect(results.at(-1).candidates.map((c) => c.move)).toEqual(["b1c3", "a4a5", "g1f3"]);
  });
  it("continuous: a partial batch (later ranks still one depth shallower, printed after 3 s) already reports the new depth", async () => {
    const { service, engine, results } = setup({ mode: "continuous" });
    service.sync("g", [position(0)]); await service.ready;
    engine.emit(line(13, 30, "a4a5", 1)); engine.emit(line(13, 20, "b1c3", 2));   // 보여준 깊이 13
    engine.emit("bestmove a4a5"); await tick();
    engine.emit(line(9, 0, "a4a5", 1)); engine.emit(line(9, 0, "b1c3", 2));
    const before = results.length;
    engine.emit(line(14, 33, "a4a5", 1)); engine.emit(line(13, 21, "b1c3", 2));   // 1순위만 14수를 끝낸 묶음
    expect(results.length).toBe(before + 1);
    expect(results.at(-1)).toMatchObject({ depth: 14, cp: 33 });
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

describe("review A fixes (2026-09-29)", () => {
  const line = (depth, cp, move = "a4a5", rank = 1) => `info depth ${depth} multipv ${rank} score cp ${cp} nodes 100 pv ${move}`;
  const known = { cp: 40, win: 55, depth: 22 };
  it("F1: keeps a deeper stored evaluation of the searched last ply and refreshes only candidates and best move", async () => {
    const { service, engine, results } = setup();
    service.sync("g", [position(0, "c", { known: { cp: 12, win: 51.1, depth: 17 } }), position(1, "h", { known })]);
    await service.ready;
    expect(engine.positions).toEqual(["position fen fen-1"]);
    engine.finish(-30, "a7a6"); await tick();                                 // 800ms 1차 탐색: 깊이 12
    expect(results[0]).toMatchObject({ ply: 1, cp: 40, win: 55, depth: 22, best: [27, 36] });
    expect(results[0].candidates).toEqual([{ move: "a7a6", cp: -30, win: expect.any(Number), depth: 12 }]);
    expect(results[0]).not.toHaveProperty("mate");
  });
  it("F1: a fresh mate score shallower than a stored cp evaluation leaves no mate field behind", async () => {
    const { service, engine, results } = setup();
    service.sync("g", [position(0, "c", { known })]); await service.ready;
    engine.emit("info depth 12 multipv 1 score mate 2 nodes 100 pv a4a5"); engine.emit("bestmove a4a5"); await tick();
    expect(results[0]).toMatchObject({ cp: 40, win: 55, depth: 22 });
    expect(results[0]).not.toHaveProperty("mate");
  });
  it("F1: a fresh result deeper than the stored one replaces it", async () => {
    const { service, engine, results } = setup();
    service.sync("g", [position(0, "c", { known: { mate: 3, win: 100, depth: 5 } })]); await service.ready;
    engine.finish(15); await tick();
    expect(results[0]).toMatchObject({ cp: 15, depth: 12 });
    expect(results[0]).not.toHaveProperty("mate");
  });
  it("F1: continuous deepening of that ply reports only beyond the stored depth", async () => {
    const { service, engine, results } = setup({ mode: "continuous" });
    service.sync("g", [position(0, "c", { known })]); await service.ready;
    engine.finish(0); await tick();
    const before = results.length;
    engine.emit(line(20, 1)); expect(results.length).toBe(before);
    engine.emit(line(23, 2)); expect(results.at(-1)).toMatchObject({ depth: 23, cp: 2 });
  });
  it("F1: after a network change the stored evaluation no longer holds back the new one", async () => {
    const { service, engine, results } = setup();
    service.sync("g", [position(0, "c", { known })]); await service.ready;
    engine.finish(0); await tick();
    await service.setNetwork(null); await tick();
    engine.finish(7); await tick();
    expect(results.at(-1)).toMatchObject({ cp: 7, depth: 12 });
  });
  it("F3: preempting deepening with focus() or deepen(other) clears the status at once", async () => {
    const { service, engine } = setup({ mode: "continuous" });
    service.sync("g", [position(0), position(1)]); await service.ready;
    engine.finish(); await tick(); engine.finish(); await tick();
    expect(service.status.deepening).toBe(true);
    service.deepen(0);
    expect(service.status.deepening).toBe(false);
    engine.emit("bestmove a4a5"); await tick();
    expect(service.status.deepening).toBe(true);                             // 0수째를 깊게 본다
    void service.focus(0, ["a4a5"]);
    expect(service.status.deepening).toBe(false);
  });
});

describe("review B test gaps (2026-09-29)", () => {
  const line = (depth, cp, move = "a4a5", rank = 1) => `info depth ${depth} multipv ${rank} score cp ${cp} nodes 100 pv ${move}`;
  const deepening = (engine) => { const go = engine.commands.lastIndexOf("go movetime 20000"); return engine.commands.slice(0, go + 1); };
  it("deepens with MultiPV 5 so the hint list keeps five candidates", async () => {
    const { service, engine } = setup({ mode: "continuous" });
    service.sync("g", [position(0)]); await service.ready;
    engine.finish(); await tick();
    expect(deepening(engine).filter((c) => c.startsWith("setoption name MultiPV")).at(-1)).toBe("setoption name MultiPV value 5");
  });
  it("keeps the repetition restriction (searchmoves) while deepening", async () => {
    const { service, engine } = setup({ mode: "continuous" });
    service.sync("g", [position(0, "c", { searchmoves: ["a1a3", "e2e2"] })]); await service.ready;
    engine.finish(); await tick();
    expect(engine.searches.at(-1)).toBe("go movetime 20000 searchmoves a1a3 e2e2");
  });
  it("deepen(other) starts deepening right away when the engine is idle after a capped ply", async () => {
    const { service, engine } = setup({ mode: "continuous" });
    service.sync("g", [position(0), position(1)]); await service.ready;
    engine.finish(); await tick(); engine.finish(); await tick();
    engine.emit("bestmove a4a5"); await tick();                              // 1수째는 상한까지 읽었다 → 엔진이 쉰다
    const count = engine.searches.length;
    service.deepen(0);
    expect(engine.searches).toHaveLength(count + 1);
    expect(engine.positions.at(-1)).toBe("position fen fen-0");
  });
  it("progressive results are in Cho's perspective when Han is to move", async () => {
    const { service, engine, results } = setup({ mode: "continuous" });
    service.sync("g", [position(0, "h")]); await service.ready;
    engine.finish(0, "a7a6"); await tick();
    engine.emit(line(20, 190, "a7a6"));
    expect(results.at(-1)).toMatchObject({ depth: 20, cp: -190 });
    expect(results.at(-1).win).toBeCloseTo(33.22, 1);
  });
});

describe("Kakao repetition inside the engine search (user report 2026-09-29)", () => {
  it("registers janggicasual + moveRepetitionIllegal as its own variant and plays it", async () => {
    const { service, engine } = setup();
    service.sync("g", [position(0)]); await service.ready;
    expect(engine.FS.writeFile).toHaveBeenCalledWith("/janggi-kakao.ini",
      "[janggikakao:janggicasual]\nmoveRepetitionIllegal = true\nnFoldRule = 4\n");
    const path = engine.commands.indexOf("setoption name VariantPath value /janggi-kakao.ini");
    const variant = engine.commands.indexOf("setoption name UCI_Variant value janggikakao");
    expect(path).toBeGreaterThan(-1);
    expect(variant).toBeGreaterThan(path);
    expect(engine.commands).not.toContain("setoption name UCI_Variant value janggicasual");
  });
  it("sends the position with its move history when the position carries one", async () => {
    const { service, engine } = setup();
    service.sync("g", [position(0, "c", { position: "position fen start-fen moves a1a2 a10a9" })]); await service.ready;
    expect(engine.positions).toEqual(["position fen start-fen moves a1a2 a10a9"]);
  });
  it("treats the same FEN reached through a different history as a new position", async () => {
    const { service, engine } = setup();
    service.sync("g", [position(0, "c", { position: "position fen s moves a1a2" })]); await service.ready;
    engine.finish(); await tick();
    service.sync("g", [position(0, "c", { position: "position fen s moves b1c3" })]); await tick();
    expect(engine.positions).toEqual(["position fen s moves a1a2", "position fen s moves b1c3"]);
  });
});

describe("the network with the Kakao variant (found by the NNUE e2e test)", () => {
  it("writes the network under a name starting with the variant name — ini variants lose the 'janggi' NNUE alias", async () => {
    const bytes = new Uint8Array([9]);
    const { service, engine } = setup({ loadNetwork: async () => bytes });
    service.sync("g", [position(0)]); await service.ready;
    expect(engine.FS.writeFile).toHaveBeenCalledWith("/janggikakao-janggi-9991472750de.nnue", bytes);
    expect(engine.commands).toContain("setoption name EvalFile value /janggikakao-janggi-9991472750de.nnue");
  });
});


describe("review deep look: the second stage for saved games (spec 2.10)", () => {
  const line = (depth, cp, move = "a4a5", rank = 1, bound = "") =>
    `info depth ${depth} multipv ${rank} score cp ${cp}${bound} nodes 100 pv ${move}`;
  // 1단계(MultiPV 5, 0.8초): 1~3순위는 13수를 끝냈고 4·5순위는 아직 12수(실엔진의 덜 찍힌 묶음 모양).
  const firstPass = (engine) => {
    for (const [depth, cp, move, rank] of [[13, 30, "a4a5", 1], [13, 20, "b1c3", 2], [13, 10, "g1f3", 3], [12, 5, "c4c5", 4], [12, 0, "i4h4", 5]])
      engine.emit(line(depth, cp, move, rank));
    engine.emit("bestmove a4a5");
  };
  const hashes = (engine) => engine.commands.filter((c) => c.startsWith("setoption name Hash"));
  const afterStop = (engine) => engine.commands.slice(engine.commands.lastIndexOf("stop") + 1);
  const rows = (candidates) => candidates.map((c) => [c.move, c.cp, c.depth]);
  async function reviewing(cap, positions = [position(0)], options = {}) {
    const s = setup({ mode: "continuous", hash: 64, ...options });
    s.service.sync("g", positions); s.service.deepen(0, cap); await s.service.ready;
    firstPass(s.engine); await tick();
    return s;
  }

  it("cap null keeps the live game's deepening: MultiPV 5, go movetime 20000 and no Hash change", async () => {
    const { service, engine, results } = setup({ mode: "continuous", hash: 64 });
    service.sync("g", [position(0), position(1)]); service.deepen(0, null); await service.ready;
    engine.finish(); await tick(); firstPass(engine); await tick();
    expect(engine.commands.slice(-3)).toEqual(["setoption name MultiPV value 5", "position fen fen-0", "go movetime 20000"]);
    engine.emit(line(14, 40, "a4a5")); engine.emit(line(14, 20, "b1c3", 2));
    expect(results.at(-1)).toMatchObject({ ply: 0, depth: 14, movetime: 20000 });
    expect(results.at(-1)).not.toHaveProperty("stable");
    expect(results.at(-1)).not.toHaveProperty("deepCap");
    service.deepen(1);                                                     // 인수 하나(지금 useAnalysis)도 그대로
    engine.emit("bestmove a4a5"); await tick();
    expect(engine.commands.slice(-3)).toEqual(["setoption name MultiPV value 5", "position fen fen-1", "go movetime 20000"]);
    expect(hashes(engine)).toEqual(["setoption name Hash value 64"]);
  });
  it("each cap deepens with MultiPV 1 and its own go command, keeping the repetition searchmoves", async () => {
    for (const [cap, go] of [[20000, "go movetime 20000"], [60000, "go movetime 60000"], [300000, "go movetime 300000"], [Infinity, "go infinite"]]) {
      const { engine } = await reviewing(cap);
      expect(engine.commands.slice(-3)).toEqual(["setoption name MultiPV value 1", "position fen fen-0", go]);
    }
    const { engine } = await reviewing(Infinity, [position(0, "c", { searchmoves: ["a1a3", "e2e2"] })]);
    expect(engine.searches.at(-1)).toBe("go infinite searchmoves a1a3 e2e2");
  });
  it("the first stage keeps MultiPV 5 and its movetime, and its results carry no stage-2 fields", async () => {
    const { engine, results } = await reviewing(60000);
    expect(engine.commands.filter((c) => c.startsWith("setoption name MultiPV"))).toEqual(["setoption name MultiPV value 5", "setoption name MultiPV value 1"]);
    expect(engine.searches).toEqual(["go movetime 800", "go movetime 60000"]);
    expect(results[0]).toMatchObject({ depth: 13, cp: 30, movetime: 800 });
    expect(results[0]).not.toHaveProperty("stable");
    expect(results[0]).not.toHaveProperty("deepCap");
  });
  it("every candidate carries the depth of its line: first stage, second stage and focus", async () => {
    const { service, engine, results } = await reviewing(20000);
    expect(rows(results[0].candidates)).toEqual([["a4a5", 30, 13], ["b1c3", 20, 13], ["g1f3", 10, 13], ["c4c5", 5, 12], ["i4h4", 0, 12]]);
    engine.emit(line(14, 40, "a4a5"));
    expect(rows(results.at(-1).candidates)).toEqual([["a4a5", 40, 14], ["b1c3", 20, 13], ["g1f3", 10, 13], ["c4c5", 5, 12], ["i4h4", 0, 12]]);
    const focused = service.focus(0, ["a4a5", "c4c5"]);
    engine.emit("bestmove a4a5"); await tick();
    engine.emit(line(9, 33, "a4a5")); engine.emit(line(8, 4, "c4c5", 2)); engine.emit("bestmove a4a5");
    expect(rows(await focused)).toEqual([["a4a5", 33, 9], ["c4c5", 4, 8]]);
  });
  it("merges candidates: the second stage's first rank, then the first stage's list without that move (same move)", async () => {
    const { engine, results } = await reviewing(20000);
    engine.emit(line(14, 40, "a4a5"));
    expect(results.at(-1)).toMatchObject({ ply: 0, depth: 14, cp: 40, best: [54, 45], deepCap: 20000, movetime: 20000 });
    expect(rows(results.at(-1).candidates)).toEqual([["a4a5", 40, 14], ["b1c3", 20, 13], ["g1f3", 10, 13], ["c4c5", 5, 12], ["i4h4", 0, 12]]);
    expect(results.at(-1).candidates[0].win).toBe(results.at(-1).win);
  });
  it("merges candidates: a changed first rank moves up, the rest keep the first stage's order and values", async () => {
    const { engine, results } = await reviewing(20000);
    engine.emit(line(14, 40, "a4a5"));                                   // 2단계 결과가 entry.result 를 덮었다
    engine.emit(line(15, 35, "g1f3"));
    expect(results.at(-1)).toMatchObject({ depth: 15, cp: 35, best: [87, 68] });
    expect(rows(results.at(-1).candidates)).toEqual([["g1f3", 35, 15], ["a4a5", 30, 13], ["b1c3", 20, 13], ["c4c5", 5, 12], ["i4h4", 0, 12]]);
    engine.emit(line(16, 50, "i1i2"));                                   // 1단계 5개 밖의 수: 1단계 5순위가 빠져 다섯 개
    expect(rows(results.at(-1).candidates)).toEqual([["i1i2", 50, 16], ["a4a5", 30, 13], ["b1c3", 20, 13], ["g1f3", 10, 13], ["c4c5", 5, 12]]);
  });
  it("a ply with only a stored evaluation first gets the candidate pass (MultiPV 5, 800 ms, same searchmoves), keeps the deeper stored evaluation, then lists five", async () => {
    const { service, engine, results } = setup({ mode: "continuous", hash: 64 });
    const roots = ["a4a5", "b1c3", "g1f3", "c4c5", "i4h4", "i1i2"];
    service.sync("g", [position(0, "c", { known: { cp: 12, win: 51.1, depth: 17 }, searchmoves: roots }), position(1)]);
    service.deepen(0, 20000); await service.ready;
    expect(engine.positions).toEqual(["position fen fen-1"]);             // 대기열은 저장된 평가가 있는 지난 국면을 건너뛴다
    firstPass(engine); await tick();
    expect(engine.commands.slice(-3)).toEqual(["setoption name MultiPV value 5", "position fen fen-0",
      `go movetime 800 searchmoves ${roots.join(" ")}`]);                  // 깊게 보기 전에 0수째의 1단계
    expect(service.status.deepening).toBe(false);
    firstPass(engine); await tick();
    expect(results.at(-1)).toMatchObject({ ply: 0, cp: 12, win: 51.1, depth: 17, movetime: 800 }); // 저장된 17수 평가가 남는다
    expect(rows(results.at(-1).candidates)).toEqual([["a4a5", 30, 13], ["b1c3", 20, 13], ["g1f3", 10, 13], ["c4c5", 5, 12], ["i4h4", 0, 12]]);
    expect(engine.commands.slice(-3)).toEqual(["setoption name MultiPV value 1", "position fen fen-0",
      `go movetime 20000 searchmoves ${roots.join(" ")}`]);
    engine.emit(line(15, 20, "b1c3"));                                    // 목록이 보여준 13보다 깊다: 저장된 17 보다 얕아도 보낸다
    expect(results.at(-1)).toMatchObject({ ply: 0, cp: 12, win: 51.1, depth: 17, deepCap: 20000, stable: 1 }); // 막대는 저장된 17수 평가
    expect(rows(results.at(-1).candidates)).toEqual([["b1c3", 20, 15], ["a4a5", 30, 13], ["g1f3", 10, 13], ["c4c5", 5, 12], ["i4h4", 0, 12]]);
    engine.emit(line(18, 25, "b1c3"));
    expect(results.at(-1)).toMatchObject({ ply: 0, depth: 18, cp: 25, deepCap: 20000 });
    expect(rows(results.at(-1).candidates)).toEqual([["b1c3", 25, 18], ["a4a5", 30, 13], ["g1f3", 10, 13], ["c4c5", 5, 12], ["i4h4", 0, 12]]);
  });
  it("the live path (cap null) deepens a ply with only a stored evaluation directly, as before", async () => {
    const { service, engine } = setup({ mode: "continuous", hash: 64 });
    service.sync("g", [position(0, "c", { known: { cp: 12, win: 51.1, depth: 17 } }), position(1)]);
    service.deepen(0, null); await service.ready;
    firstPass(engine); await tick();
    expect(engine.searches).toEqual(["go movetime 800", "go movetime 20000"]);
    expect(engine.commands.slice(-3)).toEqual(["setoption name MultiPV value 5", "position fen fen-0", "go movetime 20000"]);
  });
  it("counts the same first-rank move over new depths (N+1), restarts at 1 when it changes, and a same-depth line resets only on a change", async () => {
    const { engine, results } = await reviewing(20000);
    const before = results.length;
    for (const l of [line(10, 0, "a4a5"), line(11, 0, "a4a5"), line(12, 0, "b1c3"), line(13, 0, "b1c3")]) engine.emit(l);
    expect(results.length).toBe(before);                                  // 1단계 깊이(13)까지는 보내지 않지만 센다
    engine.emit(line(14, 40, "b1c3"));                                    // 12·13·14 → 3
    engine.emit(line(14, 40, "b1c3"));                                    // 같은 깊이·같은 수: 그대로
    engine.emit(line(15, 41, "b1c3"));                                    // 4
    engine.emit(line(15, 30, "a4a5"));                                    // 같은 깊이·다른 수: 1, 깊이는 15 그대로
    engine.emit(line(16, 32, "a4a5"));                                    // 2
    engine.emit(line(17, 60, "g1f3", 1, " lowerbound"));                  // bound 줄은 세지 않는다
    engine.emit(line(17, 33, "a4a5"));                                    // 3
    engine.emit(line(18, 20, "g1f3"));                                    // 바뀜: 1
    expect(results.slice(before).map((r) => [r.depth, r.stable, r.candidates[0].move])).toEqual(
      [[14, 3, "b1c3"], [15, 4, "b1c3"], [16, 2, "a4a5"], [17, 3, "a4a5"], [18, 1, "g1f3"]]);
  });
  it("a preempted second stage resumes later with the same cap and MultiPV 1, and the count continues from the shown depth", async () => {
    const { service, engine, results } = await reviewing(60000);
    engine.emit(line(14, 40, "a4a5")); engine.emit(line(15, 41, "a4a5"));
    expect(results.at(-1)).toMatchObject({ depth: 15, stable: 2 });
    const focused = service.focus(0, ["a4a5"]);
    expect(engine.commands.at(-1)).toBe("stop");
    engine.emit("bestmove a4a5"); await tick();
    engine.finish(0, "a4a5"); await focused; await tick();
    expect(engine.commands.slice(-3)).toEqual(["setoption name MultiPV value 1", "position fen fen-0", "go movetime 60000"]);
    const before = results.length;
    for (const l of [line(5, 0, "b1c3"), line(14, 0, "b1c3"), line(15, 41, "a4a5")]) engine.emit(l);
    expect(results.length).toBe(before);                                  // 얕은 줄은 표시를 되돌리지 않는다
    engine.emit(line(16, 44, "a4a5"));
    expect(results.at(-1)).toMatchObject({ depth: 16, cp: 44, stable: 3, deepCap: 60000 });
    expect(rows(results.at(-1).candidates)).toEqual([["a4a5", 44, 16], ["b1c3", 20, 13], ["g1f3", 10, 13], ["c4c5", 5, 12], ["i4h4", 0, 12]]);
  });
  it("a network change restarts the count and the first-stage list", async () => {
    const { service, engine, results } = await reviewing(20000);
    engine.emit(line(14, 40, "a4a5")); engine.emit(line(15, 41, "a4a5"));
    expect(results.at(-1)).toMatchObject({ depth: 15, stable: 2 });
    const applied = service.setNetwork(null);
    engine.emit("bestmove a4a5"); await applied; await tick();
    for (const [depth, cp, move, rank] of [[11, 7, "c4c5", 1], [11, 3, "b1c3", 2]]) engine.emit(line(depth, cp, move, rank));
    engine.emit("bestmove c4c5"); await tick();                           // 새 평가의 1단계: 11수, 후보 두 개
    engine.emit(line(12, 9, "a4a5"));
    expect(results.at(-1)).toMatchObject({ depth: 12, cp: 9, stable: 1 });
    expect(rows(results.at(-1).candidates)).toEqual([["a4a5", 9, 12], ["c4c5", 7, 11], ["b1c3", 3, 11]]);
  });
  it("the unlimited cap reports movetime \"infinite\" and deepCap Infinity", async () => {
    const { engine, results } = await reviewing(Infinity);
    engine.emit(line(14, 40, "a4a5"));
    expect(results.at(-1)).toMatchObject({ depth: 14, stable: 1, deepCap: Infinity, movetime: "infinite" });
  });
  it("deepen() with the same ply and cap changes nothing; a new cap stops the search and deepens again with it", async () => {
    const { service, engine } = await reviewing(20000);
    const count = engine.commands.length;
    service.deepen(0, 20000); await tick();
    expect(engine.commands).toHaveLength(count);
    service.deepen(0, 300000);
    expect(engine.commands.at(-1)).toBe("stop");
    expect(service.status.deepening).toBe(false);
    engine.emit("bestmove a4a5"); await tick();
    expect(engine.searches.at(-1)).toBe("go movetime 300000");
    expect(service.status.deepening).toBe(true);
  });
  it("a new cap re-opens every ply that had read to its cap", async () => {
    const { service, engine } = setup({ mode: "continuous", hash: 64 });
    service.sync("g", [position(0), position(1)]); service.deepen(0, 20000); await service.ready;
    engine.finish(); await tick(); firstPass(engine); await tick();
    engine.emit("bestmove a4a5"); await tick();                           // 0수째 20초 끝
    service.deepen(1, 20000); await tick();
    expect(engine.positions.at(-1)).toBe("position fen fen-1");
    engine.emit("bestmove a4a5"); await tick();                           // 1수째 20초 끝
    const count = engine.searches.length;
    service.deepen(0, 20000); await tick();
    expect(engine.searches).toHaveLength(count);                          // 같은 상한: 다시 보지 않는다
    service.deepen(0, 60000); await tick();
    expect(engine.searches.at(-1)).toBe("go movetime 60000");
    expect(engine.positions.at(-1)).toBe("position fen fen-0");
    engine.emit("bestmove a4a5"); await tick();
    service.deepen(1, 60000); await tick();
    expect(engine.searches.at(-1)).toBe("go movetime 60000");
    expect(engine.positions.at(-1)).toBe("position fen fen-1");
  });
  it("haltDeepen stops the search, keeps its result, marks the ply read, and only a new cap deepens it again", async () => {
    const { service, engine, results } = await reviewing(Infinity);
    engine.emit(line(14, 40, "a4a5"));
    const shown = results.at(-1), count = results.length;
    service.haltDeepen();
    expect(engine.commands.at(-1)).toBe("stop");
    expect(service.status.deepening).toBe(false);
    engine.emit(line(15, 99, "a4a5")); engine.emit("bestmove a4a5"); await tick();
    expect(results).toHaveLength(count);
    expect(results.at(-1)).toBe(shown);
    const commands = engine.commands.length;
    service.haltDeepen(); service.deepen(0, Infinity); service.sync("g", [position(0)]); await tick();
    expect(engine.commands).toHaveLength(commands);                       // 멈춘 국면은 다시 보지 않는다
    service.deepen(0, 20000); await tick();
    expect(engine.searches.at(-1)).toBe("go movetime 20000");
  });
  it("haltDeepen does nothing when no deepening search is running", async () => {
    const { service, engine } = setup({ mode: "continuous", hash: 64 });
    service.sync("g", [position(0), position(1)]); service.deepen(0, 20000); await service.ready;
    const count = engine.commands.length;
    service.haltDeepen();                                                 // 0수째의 1단계(0.8초) 탐색 중
    expect(engine.commands).toHaveLength(count);
    firstPass(engine); await tick(); engine.finish(); await tick();
    expect(engine.commands.slice(-3)).toEqual(["setoption name MultiPV value 1", "position fen fen-0", "go movetime 20000"]); // 멈춘 것으로 치지 않았다
  });
  it("Hash 256 only for caps of a minute or more, sent once the deepening stopped, and back to 64 once", async () => {
    const { service, engine } = await reviewing(20000);
    expect(hashes(engine)).toEqual(["setoption name Hash value 64"]);
    service.deepen(0, 60000);
    expect(engine.commands.at(-1)).toBe("stop");                          // 탐색이 달리는 동안은 보내지 않는다
    expect(hashes(engine)).toHaveLength(1);
    engine.emit("bestmove a4a5"); await tick();
    expect(afterStop(engine)).toEqual(["setoption name Hash value 256", "isready",
      "setoption name MultiPV value 1", "position fen fen-0", "go movetime 60000"]);
    service.deepen(0, 300000); engine.emit("bestmove a4a5"); await tick();
    service.deepen(0, Infinity); engine.emit("bestmove a4a5"); await tick();
    expect(afterStop(engine)).toEqual(["setoption name MultiPV value 1", "position fen fen-0", "go infinite"]);
    service.deepen(0, 20000);
    expect(hashes(engine)).toHaveLength(2);
    engine.emit("bestmove a4a5"); await tick();
    expect(afterStop(engine)).toEqual(["setoption name Hash value 64", "isready",
      "setoption name MultiPV value 1", "position fen fen-0", "go movetime 20000"]);
    service.deepen(null, null); engine.emit("bestmove a4a5"); await tick();
    expect(afterStop(engine)).toEqual(["setoption name MultiPV value 5", "position fen fen-0", "go movetime 20000"]);
    expect(hashes(engine)).toEqual(["setoption name Hash value 64", "setoption name Hash value 256", "setoption name Hash value 64"]);
  });
  it("Hash waits for a running first-stage search instead of stopping it", async () => {
    const { service, engine } = setup({ mode: "continuous", hash: 64 });
    service.sync("g", [position(0)]); await service.ready;
    service.deepen(0, Infinity);
    expect(engine.commands.at(-1)).toBe("go movetime 800");
    firstPass(engine); await tick();
    expect(engine.commands.slice(engine.commands.lastIndexOf("go movetime 800") + 1)).toEqual(["setoption name Hash value 256", "isready",
      "setoption name MultiPV value 1", "position fen fen-0", "go infinite"]);
  });
  it("the engine starts (and restarts after a crash) with the wanted Hash", async () => {
    const engines = [new FakeEngine(), new FakeEngine()], crashes = [];
    const createEngine = vi.fn(async ({ onError }) => { crashes.push(onError); return engines[crashes.length - 1]; });
    const { service } = setup({ mode: "continuous", hash: 64, createEngine });
    service.sync("g", [position(0)]); service.deepen(0, 300000); await service.ready;
    expect(hashes(engines[0])).toEqual(["setoption name Hash value 256"]);
    crashes[0](new Error("worker crashed")); await tick();
    expect(hashes(engines[1])).toEqual(["setoption name Hash value 256"]);
    expect(engines[1].searches).toEqual(["go movetime 800"]);
  });
  // 무제한은 줄 간격으로 감시할 수 없다(30분 실측: 정상 탐색의 줄 간격이 1스레드 622초·4스레드 352초) → 30초마다 isready.
  const starts = (engine) => engine.commands.filter((c) => c === "uci").length;
  const probes = (engine) => engine.commands.slice(engine.commands.lastIndexOf("go infinite") + 1).filter((c) => c === "isready").length;
  const silentReady = (engine) => { const post = engine.postMessage; engine.postMessage = (c) => { if (c === "isready") engine.commands.push(c); else post(c); }; };
  async function unlimited() {
    vi.useFakeTimers();
    const s = setup({ mode: "continuous", hash: 64 });
    s.service.sync("g", [position(0)]); s.service.deepen(0, Infinity);
    await vi.advanceTimersByTimeAsync(0); await s.service.ready;
    firstPass(s.engine); await vi.advanceTimersByTimeAsync(0);
    expect(s.engine.searches.at(-1)).toBe("go infinite");
    return s;
  }
  it("the unlimited deep look sends isready every 30 s and, answered, stays alive past 30 minutes without a single engine line", async () => {
    const { service, engine } = await unlimited();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(probes(engine)).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(probes(engine)).toBe(1);
    await vi.advanceTimersByTimeAsync(30 * 60_000 - 30_000);                 // 30분
    expect(probes(engine)).toBe(60);
    await vi.advanceTimersByTimeAsync(60_000);                               // 31분
    expect(probes(engine)).toBe(62);
    expect(starts(engine)).toBe(1);
    expect(service.status.deepening).toBe(true);
  });
  it("a probe without readyok within 15 s fails the search", async () => {
    const { engine } = await unlimited();
    silentReady(engine);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(probes(engine)).toBe(1);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(starts(engine)).toBe(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(starts(engine)).toBe(2);
  });
  it("no probe after stop or bestmove", async () => {
    const { service, engine } = await unlimited();
    await vi.advanceTimersByTimeAsync(50_000);
    expect(probes(engine)).toBe(1);
    service.haltDeepen();                                                    // 50초에 멈춤: bestmove 기한은 65초
    expect(engine.commands.at(-1)).toBe("stop");
    await vi.advanceTimersByTimeAsync(14_000);                               // 64초: 다음 탐침 차례(60초)가 지났다
    expect(afterStop(engine)).toEqual([]);
    engine.emit("bestmove a4a5"); await vi.advanceTimersByTimeAsync(120_000);
    expect(afterStop(engine)).toEqual([]);
    expect(starts(engine)).toBe(1);
  });
  it("a stopped unlimited search must answer bestmove within 15 s", async () => {
    const { service, engine } = await unlimited();
    service.haltDeepen();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(starts(engine)).toBe(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(starts(engine)).toBe(2);
  });
  it("a probe answered after stop does not start probing again, and the bestmove deadline still holds", async () => {
    const { service, engine } = await unlimited();
    silentReady(engine);
    await vi.advanceTimersByTimeAsync(30_000);                               // 탐침이 답을 기다리는 중에
    service.haltDeepen();
    engine.emit("readyok"); await vi.advanceTimersByTimeAsync(14_999);      // 멈춘 뒤에 온 탐침의 답
    expect(starts(engine)).toBe(1);
    expect(afterStop(engine)).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    expect(starts(engine)).toBe(2);                                          // bestmove 가 15초 안에 없었다
  });
  it("a probe's readyok never confirms another isready (the Hash change right after the search)", async () => {
    const { service, engine } = await unlimited();                          // Hash 256
    silentReady(engine);
    await vi.advanceTimersByTimeAsync(30_000);                               // 탐침 isready 가 답을 기다린다
    service.deepen(0, 20000);                                                // 멈춤 → 쉬면 Hash 64
    engine.emit("bestmove a4a5"); await vi.advanceTimersByTimeAsync(0);
    expect(afterStop(engine)).toEqual(["setoption name Hash value 64", "isready"]);
    engine.emit("readyok"); await vi.advanceTimersByTimeAsync(0);          // 탐침의 답
    expect(engine.searches.at(-1)).toBe("go infinite");                      // Hash 변경은 아직 확인되지 않았다
    engine.emit("readyok"); await vi.advanceTimersByTimeAsync(0);
    expect(engine.searches.at(-1)).toBe("go movetime 20000");
  });
  it("a finished position (mate 0, no moves) gets no second stage: go infinite would wait for stop forever", async () => {
    const { service, engine } = setup({ mode: "continuous", hash: 64 });
    service.sync("g", [position(0, "h")]); service.deepen(0, Infinity); await service.ready;
    engine.emit("info depth 0 score mate 0"); engine.emit("bestmove (none)"); await tick();
    expect(engine.searches).toEqual(["go movetime 800"]);
    expect(service.status.deepening).toBe(false);
  });
  it("the watchdog of a finite cap is still cap + 15 s", async () => {
    vi.useFakeTimers();
    const { service, engine } = setup({ mode: "continuous", hash: 64 });
    service.sync("g", [position(0)]); service.deepen(0, 300000);
    await vi.advanceTimersByTimeAsync(0); await service.ready;
    firstPass(engine); await vi.advanceTimersByTimeAsync(0);
    expect(engine.searches.at(-1)).toBe("go movetime 300000");
    await vi.advanceTimersByTimeAsync(314_000);
    expect(starts(engine)).toBe(1);
    expect(engine.commands.at(-1)).toBe("go movetime 300000");               // 상한이 있으면 탐침이 없다
    await vi.advanceTimersByTimeAsync(2_000);
    expect(starts(engine)).toBe(2);
  });
  it("a stopped finite-cap deep look must answer bestmove within 15 s of the stop, not cap + 15 s", async () => {
    vi.useFakeTimers();
    const { service, engine } = setup({ mode: "continuous", hash: 64 });
    service.sync("g", [position(0)]); service.deepen(0, 300000);
    await vi.advanceTimersByTimeAsync(0); await service.ready;
    firstPass(engine); await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_000);
    service.haltDeepen();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(starts(engine)).toBe(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(starts(engine)).toBe(2);
  });
  it("the live path (cap null) keeps its 20 s + 15 s watchdog from the start of the search, even after a stop", async () => {
    vi.useFakeTimers();
    const { service, engine } = setup({ mode: "continuous", hash: 64 });
    service.sync("g", [position(0)]); service.deepen(0, null);
    await vi.advanceTimersByTimeAsync(0); await service.ready;
    firstPass(engine); await vi.advanceTimersByTimeAsync(0);
    expect(engine.searches.at(-1)).toBe("go movetime 20000");
    await vi.advanceTimersByTimeAsync(10_000);
    service.haltDeepen();
    await vi.advanceTimersByTimeAsync(24_999);
    expect(starts(engine)).toBe(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(starts(engine)).toBe(2);
  });
  it("an unlimited deep look that finishes the engine's last depth (245, a forced mate) stops and counts as read", async () => {
    const { service, engine, results } = await reviewing(Infinity);
    const mate = (depth, bound = "") => `info depth ${depth} seldepth 6 multipv 1 score mate 3${bound} nodes 100 pv a4a5 a7a6 b1c3`;
    engine.emit(mate(244));
    engine.emit(mate(245, " lowerbound"));                                  // 정확한 줄이 아니면 아직
    expect(engine.commands.at(-1)).toBe("go infinite");
    engine.emit(mate(245));                                                  // 엔진은 이 뒤로 stop 까지 코어를 돌리며 기다린다(실측)
    expect(results.at(-1)).toMatchObject({ depth: 245, mate: 3, deepCap: Infinity });
    expect(engine.commands.at(-1)).toBe("stop");
    expect(service.status.deepening).toBe(false);
    const count = engine.commands.length;
    engine.emit("bestmove a4a5"); await tick();
    service.deepen(0, Infinity); service.sync("g", [position(0)]); await tick();
    expect(engine.commands).toHaveLength(count);                             // 다 읽었다: 다시 보지 않는다
  });
  it("a finite cap is not stopped at the last depth: the engine ends that search itself", async () => {
    const { engine } = await reviewing(300000);
    engine.emit("info depth 245 seldepth 6 multipv 1 score mate 3 nodes 100 pv a4a5 a7a6 b1c3");
    expect(engine.commands.at(-1)).toBe("go movetime 300000");
  });
  it("Hash 256 needs the continuous mode: another mode keeps the constructor Hash; switching in raises it, switching out lowers it once when idle", async () => {
    const { service, engine } = setup({ mode: "fast", hash: 64 });
    service.sync("g", [position(0)]); service.deepen(0, 60000); await service.ready;
    expect(hashes(engine)).toEqual(["setoption name Hash value 64"]);
    firstPass(engine); await tick();
    expect(engine.searches).toEqual(["go movetime 800"]);                   // 빠르게: 깊게 보지 않으니 64 그대로
    service.setMode("continuous"); await tick();
    expect(engine.commands.slice(engine.commands.lastIndexOf("go movetime 800") + 1)).toEqual(["setoption name Hash value 256", "isready",
      "setoption name MultiPV value 1", "position fen fen-0", "go movetime 60000"]);
    service.setMode("deep");
    expect(engine.commands.at(-1)).toBe("stop");
    expect(hashes(engine)).toHaveLength(2);                                  // 탐색이 달리는 동안은 보내지 않는다
    engine.emit("bestmove a4a5"); await tick();
    expect(afterStop(engine)).toEqual(["setoption name Hash value 64", "isready"]);
    service.setMode("fast"); await tick();
    expect(hashes(engine)).toHaveLength(3);                                  // 한 번만
  });
  it("deepen(ply, null) after a long cap brings the constructor Hash back once", async () => {
    const { service, engine } = await reviewing(Infinity);
    expect(hashes(engine)).toEqual(["setoption name Hash value 256"]);
    service.deepen(0, null);
    expect(engine.commands.at(-1)).toBe("stop");
    engine.emit("bestmove a4a5"); await tick();
    expect(afterStop(engine)).toEqual(["setoption name Hash value 64", "isready",
      "setoption name MultiPV value 5", "position fen fen-0", "go movetime 20000"]);
  });
  it("rejects a cap that is not 20000, 60000, 300000 or Infinity", () => {
    const { service } = setup({ mode: "continuous" });
    for (const cap of ["infinite", 30000, 0]) expect(() => service.deepen(0, cap)).toThrow("깊게 보기 상한");
  });

  // 최종 리뷰 A I2(개정 2.10 "다시 찾아간 국면"): 전에 깊게 읽어 저장된 국면도 2단계의 1순위·"같은 수"를 보여준다. 2단계 결과의
  // 문턱은 이 국면에서 목록이 보여준 깊이(후보 1단계 줄, 그 뒤 2단계 줄)이지 저장된 깊이가 아니다. 평가는 저장된 것이 더 깊으면 그것.
  it("a revisited ply (stored depth 22) lists the second stage's first rank and count past the candidate pass; the bar keeps the stored evaluation until stage 2 passes it", async () => {
    const { service, engine, results } = setup({ mode: "continuous", hash: 64 });
    service.sync("saved", [position(0, "c", { known: { cp: 25, win: 52.3, depth: 22 } }), position(1)]);
    service.deepen(0, 20000); await service.ready;
    firstPass(engine); await tick(); firstPass(engine); await tick();       // 1수째 · 0수째의 후보 1단계(저장된 22 가 남는다)
    expect(results.at(-1)).toMatchObject({ ply: 0, cp: 25, win: 52.3, depth: 22, movetime: 800 });
    expect(engine.searches.at(-1)).toBe("go movetime 20000");
    const before = results.length;
    for (let d = 10; d <= 13; d++) engine.emit(line(d, 40, "b1c3"));
    expect(results.length).toBe(before);                                    // 목록이 보여준 1단계 깊이(13)까지는 보내지 않는다
    for (let d = 14; d <= 23; d++) engine.emit(line(d, 40, "b1c3"));
    expect(results.slice(before).map((r) => [r.candidates[0].depth, r.depth, r.cp, r.stable])).toEqual([
      [14, 22, 25, 5], [15, 22, 25, 6], [16, 22, 25, 7], [17, 22, 25, 8], [18, 22, 25, 9], [19, 22, 25, 10], [20, 22, 25, 11],
      [21, 22, 25, 12], [22, 22, 40, 13], [23, 23, 40, 14]]);
    expect(results[before]).toMatchObject({ ply: 0, win: 52.3, deepCap: 20000, movetime: 20000, best: [82, 65] });
    expect(rows(results[before].candidates)).toEqual([["b1c3", 40, 14], ["a4a5", 30, 13], ["g1f3", 10, 13], ["c4c5", 5, 12], ["i4h4", 0, 12]]);
    expect(results.at(-1).win).toBe(results.at(-1).candidates[0].win);     // 저장된 깊이를 넘으면 막대도 2단계 줄
    engine.emit("bestmove b1c3"); await tick();
    expect(results.at(-1)).toMatchObject({ depth: 23, cp: 40, stable: 14 });
  });

  // 최종 리뷰 A·B I1: 저장된 판 복기를 떠나면 useAnalysis 는 한 커밋에서 sync(진행 중인 판) 다음에 deepen(null, null) 을 부른다.
  // 엔진이 쉬고 있으면 sync 의 pump 가 곧바로 진행 중인 판의 첫 탐색(최강의 수일 수 있다)을 시작하므로, 판이 바뀌면 상한과
  // Hash 256 은 그 첫 탐색 전에 풀려야 한다(개정 2.10 "진행 중인 판으로 돌아올 때").
  const liveMax = [position(0, "c", { fen: "live-0" }), position(1, "h", { fen: "live-1", max: true })];
  const idleExits = {
    "after 멈춤": [60000, (engine, service) => { service.haltDeepen(); engine.emit("bestmove a4a5"); }],
    "after a 1-min cap read to its end": [60000, (engine) => { engine.emit(line(20, 5)); engine.emit("bestmove a4a5"); }],
    "after the unlimited look stopped at the engine's last depth (245)": [Infinity, (engine) => {
      engine.emit("info depth 245 seldepth 6 multipv 1 score mate 3 nodes 100 pv a4a5 a7a6 b1c3"); engine.emit("bestmove a4a5"); }],
  };
  for (const [how, [cap, rest]] of Object.entries(idleExits)) {
    it(`leaving an idle saved review ${how}: the live max move is searched with Hash 64`, async () => {
      const { service, engine } = setup({ mode: "continuous", hash: 64 });
      service.sync("saved", [position(0), position(1)]); service.deepen(0, cap); await service.ready;
      firstPass(engine); await tick(); firstPass(engine); await tick();       // 두 국면의 1단계 → 0수째 2단계
      expect(engine.commands.at(-1)).toBe(cap === Infinity ? "go infinite" : "go movetime 60000");
      rest(engine, service); await tick();
      expect(service.status).toMatchObject({ pending: 0, deepening: false });  // 엔진이 쉰다
      expect(hashes(engine).at(-1)).toBe("setoption name Hash value 256");
      const mark = engine.commands.length;
      service.sync("live", liveMax); service.deepen(null, null); await tick(); // useAnalysis 의 효과 순서
      expect(engine.commands.slice(mark)).toEqual(["setoption name Hash value 64", "isready",
        "setoption name MultiPV value 1", "position fen live-1", "go movetime 3000"]);
    });
  }
  it("leaving an idle saved review at its finished last ply (mate 0): the live game's first pass has Hash 64 and MultiPV 5", async () => {
    const { service, engine } = setup({ mode: "continuous", hash: 64 });
    service.sync("saved", [position(0), position(1)]); service.deepen(1, 300000); await service.ready;
    firstPass(engine); await tick();
    engine.emit("info depth 0 score mate 0"); engine.emit("bestmove (none)"); await tick(); // 끝난 판의 마지막 국면: 2단계 없음
    expect(engine.searches).toEqual(["go movetime 800", "go movetime 800"]);
    expect(service.status).toMatchObject({ pending: 0, deepening: false });
    expect(hashes(engine)).toEqual(["setoption name Hash value 256"]);
    const mark = engine.commands.length;
    service.sync("live", [position(0, "c", { fen: "live-0" }), position(1, "h", { fen: "live-1" })]); service.deepen(null, null); await tick();
    expect(engine.commands.slice(mark)).toEqual(["setoption name Hash value 64", "isready",
      "setoption name MultiPV value 5", "position fen live-0", "go movetime 800"]);
  });
  it("a game switch while a long cap still searches: Hash 64 comes back after the stopped search, before the live game's first search", async () => {
    const { service, engine } = await reviewing(300000, [position(0), position(1)]);
    firstPass(engine); await tick();
    expect(engine.commands.at(-1)).toBe("go movetime 300000");
    service.sync("live", liveMax); service.deepen(null, null);
    expect(engine.commands.at(-1)).toBe("stop");
    engine.emit("bestmove a4a5"); await tick();
    expect(afterStop(engine)).toEqual(["setoption name Hash value 64", "isready",
      "setoption name MultiPV value 1", "position fen live-1", "go movetime 3000"]);
  });
  it("entering a saved review after the live game still deep-looks with its cap (the deepen effect follows the sync)", async () => {
    const { service, engine } = setup({ mode: "continuous", hash: 64 });
    service.sync("live", [position(0, "c", { fen: "live-0" })]); service.deepen(null, null); await service.ready;
    engine.finish(); await tick();
    expect(engine.commands.at(-1)).toBe("go movetime 20000");
    service.sync("saved", [position(0), position(1)]); service.deepen(0, 60000);
    engine.emit("bestmove a4a5"); await tick();
    firstPass(engine); await tick(); firstPass(engine); await tick();
    expect(afterStop(engine)).toEqual(["setoption name Hash value 256", "isready",
      "setoption name MultiPV value 5", "position fen fen-0", "go movetime 800",
      "setoption name MultiPV value 5", "position fen fen-1", "go movetime 800",
      "setoption name MultiPV value 1", "position fen fen-0", "go movetime 60000"]);
  });
});
