// Glue between canonical game history, the UCI service and persisted evaluations.
import { toFen, moveToUci, sqName } from "../notation.js";
import { bestMove, inCheck, kingIdx } from "../engine.js";
import { play, legalMoves, isMaxLevel } from "../game.js";
import { forbiddenMove } from "../repetition.js";
import { bestMoveExcluding } from "../engineMove.js";
import { MOVETIME, KAKAO } from "./service.js";

// 반복수로 막힌 수가 있는 국면은 Fairy-Stockfish 루트 수도 제한한다. 엔진은 이제 수순을 받아 반복수를 스스로 알지만
// (enginePositions), 루트 제한을 이중 안전장치로 남긴다. 쉬기는 FSF 표기(궁이 제자리로 가는 수)로 넣는다.
function restriction(state) {
  if (!forbiddenMove(state)) return undefined;
  const moves = legalMoves(state).map(moveToUci);
  if (!inCheck(state.b, state.turn)) { const k = sqName(kingIdx(state.b, state.turn)); moves.push(k + k); }
  return moves;
}

// 엔진에 보낼 국면 명령: 마지막 쉬기(자동 쉬기 포함) 이후의 수순과 함께 보낸다. 반복 금지 변형(service.js KAKAO)이
// 수읽기 안에서도 반복수를 알게 하려는 것이다(사용자 보고 2026-09-29: 반복을 무승부로 읽어 지는 수를 권했다).
// 쉬기 너머는 보내지 않는다: 쉬기가 끼면 셈이 끊기는 것이 우리 규칙인데 FSF 는 쉬기 너머까지 센다(실측: 한이 쉰 뒤
// 초의 a1a2 를 전체 수순으로 보내면 FSF 가 금지로 본다). 자동 쉬기는 "같은 편이 연달아 둔 두 수"로 알아본다.
export function enginePositions(states, moves) {
  let start = 0;
  return states.map((state, ply) => {
    if (ply > 0 && (moves[ply - 1] === "pass" || state.turn === states[ply - 1].turn)) start = ply;
    const from = states[start];
    return `position fen ${toFen(from.b, from.turn)}${ply > start ? " moves " + moves.slice(start, ply).join(" ") : ""}`;
  });
}

// restrictions: 판이 바뀔 때(서비스 동기화)만 계산한다 — 렌더마다 모든 국면의 반복수·수순을 보지 않게.
export const analysisPositions = (game, { restrictions = false } = {}) => {
  const states = [...game.hist, game];
  const commands = restrictions ? enginePositions(states, game.moves) : null;
  return states.map((state, ply) => {
    const searchmoves = restrictions ? restriction(state) : undefined;
    return { ply, fen: toFen(state.b, state.turn), turn: state.turn,
      max: ply === game.moves.length && !game.over && isMaxLevel(game.level) && game.controllers[game.turn] === "engine",
      ...(searchmoves ? { searchmoves } : {}), ...(commands ? { position: commands[ply] } : {}) };
  });
};

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
  const mode = result.mode ?? "fast";
  const engine = `fairy-stockfish-nnue.wasm 1.1.12 ${KAKAO.name} nnue=${result.nnue === "on" ? "janggi-9991472750de" : "off"} mode=${mode} ` +
    `movetime=${MOVETIME[mode]}${mode === "continuous" ? ` deepen-movetime=${MOVETIME.deepen}` : ""} max-movetime=${maxTimeOf(game.level)} threads=${result.threads ?? 1}`;
  // 다른 엔진 설정(신경망 켜고 끔)으로 만든 평가도 버리지 않는다. 버리면 저장된 평가를 건너뛰는(known) 서비스가
  // 그 국면을 다시 채우지 않아 그래프·실수 표시가 영구히 빈다(리뷰 HIGH). engine 은 가장 최근 설정을 적는다.
  const evals = cache.fens.map((_, ply) => cache.analysis?.evals[ply] ?? null);
  const results = [...cache.results];
  const { ply, cp, mate, win, depth } = result;
  evals[ply] = { ply, ...(cp !== undefined ? { cp } : { mate }), win, depth };
  results[ply] = result;
  return { ...cache, analysis: { engine, evals }, results };
}

// 최강의 생각 시간(ms): 최강 · 20초만 20초, 나머지는 3초(최강이 아닌 판도 기보의 엔진 문자열에 3초를 적어 왔다).
export const maxTimeOf = (level) => (level === "max20" ? MOVETIME.max20 : MOVETIME.max);

// Null means the request was invalidated by undo/new game, never a weaker fallback.
export async function engineTurn(game, service) {
  if (!isMaxLevel(game.level)) {
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
