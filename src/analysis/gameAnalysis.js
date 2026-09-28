// Glue between canonical game history, the UCI service and persisted evaluations.
import { toFen, moveToUci, sqName } from "../notation.js";
import { bestMove, inCheck, kingIdx } from "../engine.js";
import { play, legalMoves } from "../game.js";
import { forbiddenMove } from "../repetition.js";
import { bestMoveExcluding } from "../engineMove.js";

// 반복수로 막힌 수가 있는 국면만 Fairy-Stockfish 루트 수를 제한한다(엔진은 FEN 만 받아 수순을 모른다).
// 쉬기는 FSF 표기(궁이 제자리로 가는 수)로 넣는다.
function restriction(state) {
  if (!forbiddenMove(state)) return undefined;
  const moves = legalMoves(state).map(moveToUci);
  if (!inCheck(state.b, state.turn)) { const k = sqName(kingIdx(state.b, state.turn)); moves.push(k + k); }
  return moves;
}

// restrictions: 판이 바뀔 때(서비스 동기화)만 계산한다 — 렌더마다 모든 국면의 반복수를 보지 않게.
export const analysisPositions = (game, { restrictions = false } = {}) => [...game.hist, game].map((state, ply) => {
  const searchmoves = restrictions ? restriction(state) : undefined;
  return { ply, fen: toFen(state.b, state.turn), turn: state.turn,
    max: ply === game.moves.length && !game.over && game.level === "max" && game.controllers[game.turn] === "engine",
    ...(searchmoves ? { searchmoves } : {}) };
});

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
  if (game.level !== "max") {
    // 반복수로 막힌 수가 있으면 그 수를 뺀 루트 탐색(원본과 같은 식), 없으면 원본 bestMove 그대로.
    const blocked = forbiddenMove(game);
    const move = blocked ? bestMoveExcluding(game.b.slice(), game.turn, game.level, blocked) : bestMove(game.b.slice(), game.turn, game.level);
    return play(game, move ?? "pass");
  }
  const move = await service.bestMove(game.moves.length);
  if (move === null) return null;
  try { return play(game, move); }
  catch (error) { throw new Error(`최강 엔진의 불법 수 — ${error.message}`, { cause: error }); }
}
