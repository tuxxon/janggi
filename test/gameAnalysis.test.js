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
    const ply1 = { ...r, ply: 1, fen: integration.analysisPositions(g)[1].fen, cp: -190, win: 33.22, movetime: 1000 };
    cache = integration.cacheEvaluation(cache, g, ply1);
    expect(cache.analysis.engine).toContain("max-movetime=1000");
    const old = g;
    g = play(undo(g), [56, 47]);
    cache = integration.syncAnalysisCache(cache, g);
    expect(cache.analysis.evals).toEqual([{ ply: 0, cp: 0, win: 50, depth: 12 }, null]);
    expect(integration.cacheEvaluation(cache, g, ply1)).toBe(cache);
    expect(integration.cacheEvaluation(cache, old, { ...r, gameId: "other" })).toBe(cache);
    expect(integration.syncAnalysisCache(cache, { ...initial(), id: "new" }).analysis).toBeUndefined();
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
});
