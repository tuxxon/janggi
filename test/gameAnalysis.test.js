import { describe, it, expect, vi } from "vitest";
import * as integration from "../src/analysis/gameAnalysis.js";
import * as original from "../src/engine.js";
import { newGame, play, undo } from "../src/game.js";
const initial = (options = {}) => ({ ...newGame(options), id: "game-a" });

describe("game analysis integration", () => {
  it("queues the full history including restored plies and marks only the live max engine turn", () => {
    const g = play(initial({ level: "max" }), [54, 45]);
    expect(integration.analysisPositions).toBeTypeOf("function");
    const positions = integration.analysisPositions(g);
    expect(positions.map(({ ply, turn, max }) => ({ ply, turn, max }))).toEqual([
      { ply: 0, turn: "c", max: false }, { ply: 1, turn: "h", max: true },
    ]);
    expect(positions[0].fen).toContain("/P1P1P1P1P/");
    expect(positions[1].fen).toContain("/P8/2P1P1P1P/");
  });
  it("persists late evaluations of earlier plies, omits candidates, and trims invalidated branches", () => {
    let g = play(initial(), [54, 45]);
    expect(integration.syncAnalysisCache).toBeTypeOf("function");
    let cache = integration.syncAnalysisCache(null, g);
    const r = { gameId: g.id, fen: integration.analysisPositions(g)[0].fen, ply: 0, cp: 0, win: 50, depth: 12,
      nnue: "off", movetime: 800, candidates: [{ move: "a4a5", cp: 0, win: 50 }] };
    cache = integration.cacheEvaluation(cache, g, r);
    expect(cache.analysis.evals).toEqual([{ ply: 0, cp: 0, win: 50, depth: 12 }, null]);
    expect(cache.analysis.engine).toContain("nnue=off");
    expect(cache.analysis.engine).toContain("movetime=800");
    const ply1 = { ...r, ply: 1, fen: integration.analysisPositions(g)[1].fen, cp: -190, win: 33.22, movetime: 3000 };
    cache = integration.cacheEvaluation(cache, g, ply1);
    expect(cache.analysis.engine).toContain("max-movetime=3000");
    const old = g;
    g = play(undo(g), [56, 47]);
    cache = integration.syncAnalysisCache(cache, g);
    expect(cache.analysis.evals).toEqual([{ ply: 0, cp: 0, win: 50, depth: 12 }, null]);
    expect(integration.cacheEvaluation(cache, g, ply1)).toBe(cache);
    expect(integration.cacheEvaluation(cache, old, { ...r, gameId: "other" })).toBe(cache);
    expect(integration.syncAnalysisCache(cache, { ...initial(), id: "new" }).analysis).toBeUndefined();
  });
  it("writes the analysis mode, its search times and the thread count into the engine string (user request 2026-09-29)", () => {
    const g = play(initial(), [54, 45]);
    const base = { gameId: g.id, fen: integration.analysisPositions(g)[0].fen, ply: 0, cp: 0, win: 50, depth: 20, candidates: [] };
    const engine = (result) => integration.cacheEvaluation(integration.syncAnalysisCache(null, g), g, { ...base, ...result }).analysis.engine;
    expect(engine({ nnue: "on", mode: "continuous", threads: 7, movetime: 20000 })).toBe(
      "fairy-stockfish-nnue.wasm 1.1.12 janggicasual nnue=janggi-9991472750de mode=continuous movetime=800 deepen-movetime=20000 max-movetime=3000 threads=7");
    expect(engine({ nnue: "off", mode: "deep", threads: 4, movetime: 3000 })).toBe(
      "fairy-stockfish-nnue.wasm 1.1.12 janggicasual nnue=off mode=deep movetime=3000 max-movetime=3000 threads=4");
    expect(engine({ nnue: "off", mode: "fast", threads: 1, movetime: 800 })).toBe(
      "fairy-stockfish-nnue.wasm 1.1.12 janggicasual nnue=off mode=fast movetime=800 max-movetime=3000 threads=1");
  });
  it("validates a max move through game.play and explicitly rejects an illegal result", async () => {
    expect(integration.engineTurn).toBeTypeOf("function");
    const g = initial({ level: "max", controllers: { c: "engine", h: "human" } });
    const service = { bestMove: vi.fn().mockResolvedValue([54, 45]) };
    expect((await integration.engineTurn(g, service)).moves).toEqual(["a4a5"]);
    expect(service.bestMove).toHaveBeenCalledExactlyOnceWith(0);
    service.bestMove.mockResolvedValue("pass");
    expect((await integration.engineTurn(g, service)).moves).toEqual(["pass"]);
    service.bestMove.mockResolvedValue([54, 36]);
    await expect(integration.engineTurn(g, service)).rejects.toThrow("최강 엔진의 불법 수");
    service.bestMove.mockRejectedValue(new Error("WASM unavailable"));
    await expect(integration.engineTurn(g, service)).rejects.toThrow("WASM unavailable");
    service.bestMove.mockResolvedValue(null);
    expect(await integration.engineTurn(g, service)).toBeNull();
  });
  it("keeps levels 2–4 on the original engine path", async () => {
    expect(integration.engineTurn).toBeTypeOf("function");
    const spy = vi.spyOn(original, "bestMove").mockReturnValue([54, 45]);
    try {
      const service = { bestMove: vi.fn() };
      for (const level of [2, 3, 4]) {
        expect((await integration.engineTurn(initial({ level }), service)).moves).toEqual(["a4a5"]);
        expect(spy.mock.calls.at(-1)[2]).toBe(level);
      }
      expect(service.bestMove).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
  it("keeps evaluations made with another engine setting instead of wiping them (review HIGH)", () => {
    const g = play(play(initial(), [54, 45]), [27, 36]);
    const pos = integration.analysisPositions(g);
    const stored = { engine: "old-classical", evals: [{ ply: 0, cp: 0, win: 50, depth: 10 }, { ply: 1, cp: 20, win: 52, depth: 10 }, null] };
    let cache = integration.syncAnalysisCache(null, { ...g, analysis: stored });
    cache = integration.cacheEvaluation(cache, g, { gameId: g.id, fen: pos[2].fen, ply: 2, cp: 30, win: 53, depth: 14, nnue: "on", movetime: 800, candidates: [] });
    expect(cache.analysis.evals).toEqual([{ ply: 0, cp: 0, win: 50, depth: 10 }, { ply: 1, cp: 20, win: 52, depth: 10 }, { ply: 2, cp: 30, win: 53, depth: 14 }]);
    expect(cache.analysis.engine).toContain("nnue=janggi-9991472750de");
  });
});

describe("engines obey the repetition rule (user request: Kakao Janggi)", () => {
  const sq = (s) => ({ a1: 81, a2: 72, a3: 63, a5: 45, e2: 76, f9: 14, i10: 8, i9: 17 })[s];
  const shuffle = [[81, 72], [8, 17], [72, 81], [17, 8], [81, 72], [8, 17], [72, 81], [17, 8]];
  it("the original-engine root search skips an excluded move even when it is clearly best", async () => {
    const { bestMoveExcluding } = await import("../src/engineMove.js");
    const b = new Array(90).fill(null);
    b[sq("e2")] = "cK"; b[sq("a1")] = "cR"; b[sq("f9")] = "hK"; b[sq("a5")] = "hR"; // 초 차가 한 차를 공짜로 잡을 수 있다
    expect(bestMoveExcluding(b.slice(), "c", 2, null)).toEqual([81, 45]);
    const other = bestMoveExcluding(b.slice(), "c", 2, [81, 45]);
    expect(other).not.toEqual([81, 45]);
    expect(original.legal(b.slice(), "c").some(([f, t]) => f === other[0] && t === other[1])).toBe(true);
  });
  it("levels 2–4 never play the forbidden third repetition, even if the original search would choose it", async () => {
    let g = initial({ level: 2, controllers: { c: "engine", h: "human" } });
    for (const m of shuffle) g = play(g, m);
    // 원본 bestMove 가 금지된 a1a2 를 고른다고 해도(우연히 안 고르는 것에 기대지 않는다) 규칙을 지켜야 한다.
    const spy = vi.spyOn(original, "bestMove").mockReturnValue([81, 72]);
    try {
      for (let i = 0; i < 3; i++) expect((await integration.engineTurn(g, {})).moves.at(-1)).not.toBe("a1a2");
    } finally { spy.mockRestore(); }
  });
  it("restricts the analysed root moves with searchmoves where a move is forbidden (pass as king-to-self)", () => {
    let g = initial();
    for (const m of shuffle) g = play(g, m);
    const last = integration.analysisPositions(g, { restrictions: true }).at(-1);
    expect(last.searchmoves).toContain("a1a3");
    expect(last.searchmoves).toContain("e2e2");
    expect(last.searchmoves).not.toContain("a1a2");
    expect(integration.analysisPositions(g, { restrictions: true })[0].searchmoves).toBeUndefined();
  });
});
