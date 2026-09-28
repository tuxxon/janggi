// Glue between canonical game history, the UCI service and persisted evaluations.
import { toFen } from "../notation.js";
import { bestMove } from "../engine.js";
import { play } from "../game.js";

export const analysisPositions = (game) => [...game.hist, game].map((state, ply) => ({
  ply, fen: toFen(state.b, state.turn), turn: state.turn,
  max: ply === game.moves.length && !game.over && game.level === "max" && game.controllers[game.turn] === "engine",
}));

export function syncAnalysisCache(cache, game) {
  const fens = analysisPositions(game).map((p) => p.fen);
  if (!cache || cache.id !== game.id) return { id: game.id, fens, analysis: game.analysis, results: [] };
  let common = 0;
  while (common < fens.length && common < cache.fens.length && fens[common] === cache.fens[common]) common++;
  if (common === fens.length && common === cache.fens.length) return cache;
  const evals = fens.map((_, ply) => ply < common ? cache.analysis?.evals[ply] ?? null : null);
  return { ...cache, fens, analysis: cache.analysis ? { ...cache.analysis, evals } : undefined,
    results: cache.results.slice(0, common) };
}

export function cacheEvaluation(cache, game, result) {
  if (result.gameId !== game.id || analysisPositions(game)[result.ply]?.fen !== result.fen) return cache;
  cache = syncAnalysisCache(cache, game);
  const engine = `fairy-stockfish-nnue.wasm 1.1.12 janggicasual nnue=${result.nnue === "on" ? "janggi-9991472750de" : "off"} movetime=800 max-movetime=1000`;
  // 다른 엔진 설정(신경망 켜고 끔)으로 만든 평가도 버리지 않는다. 버리면 저장된 평가를 건너뛰는(known) 서비스가
  // 그 국면을 다시 채우지 않아 그래프·실수 표시가 영구히 빈다(리뷰 HIGH). engine 은 가장 최근 설정을 적는다.
  const evals = cache.fens.map((_, ply) => cache.analysis?.evals[ply] ?? null);
  const results = [...cache.results];
  const { ply, cp, mate, win, depth } = result;
  evals[ply] = { ply, ...(cp !== undefined ? { cp } : { mate }), win, depth };
  results[ply] = result;
  return { ...cache, analysis: { engine, evals }, results };
}

// Null means the request was invalidated by undo/new game, never a weaker fallback.
export async function engineTurn(game, service) {
  if (game.level !== "max") return play(game, bestMove(game.b.slice(), game.turn, game.level) ?? "pass");
  const move = await service.bestMove(game.moves.length);
  if (move === null) return null;
  try { return play(game, move); }
  catch (error) { throw new Error(`최강 엔진의 불법 수 — ${error.message}`, { cause: error }); }
}
