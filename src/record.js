import { SETUPS } from "./engine.js";
import { newGame, play } from "./game.js";
import { moveToUci, uciToMove } from "./notation.js";

export const validId = (id) => typeof id === "string" && /^[0-9T-]+(-[0-9]+)?$/.test(id);
const bad = (reason) => { throw new Error(`기보 ${reason}이 올바르지 않아요.`); };

function validate(record) {
  if (!record || record.v !== 1) bad("버전");
  if (!validId(record.id)) bad("id");
  if (typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt))) bad("생성 시각");
  for (const side of ["c", "h"]) {
    if (!Object.hasOwn(SETUPS, record.setups?.[side])) bad("상차림");
    if (!["human", "engine"].includes(record.controllers?.[side])) bad("컨트롤러");
  }
  if (![2, 3, 4].includes(record.level)) bad("난이도");
  if (!Array.isArray(record.moves)) bad("수순");
  if (record.result !== null && (!record.result || !["c", "h"].includes(record.result.winner) || record.result.reason !== "외통수")) bad("결과");
}

// 분석은 캐시라 손상돼도 수순 복원을 막지 않는다.
function analysisCopy(analysis) {
  if (!analysis || typeof analysis.engine !== "string" || !Array.isArray(analysis.evals)) return undefined;
  if (!analysis.evals.every((e, ply) => e === null || (e && e.ply === ply &&
    (Number.isFinite(e.cp) || Number.isFinite(e.mate)) && Number.isFinite(e.win) &&
    e.win >= 0 && e.win <= 100 && Number.isInteger(e.depth) && e.depth >= 0))) return undefined;
  return { engine: analysis.engine, evals: analysis.evals.map((e) => e === null ? null : {
    ply: e.ply, ...(Number.isFinite(e.cp) ? { cp: e.cp } : { mate: e.mate }), win: e.win, depth: e.depth,
  }) };
}

// id/createdAt은 저장 계층에서 부여한다. 국면·무르기 이력은 저장하지 않는다.
export function toRecord(state) {
  const record = { v: 1, id: state.id, createdAt: state.createdAt, setups: { ...state.setups },
    controllers: { ...state.controllers }, level: state.level, moves: [...state.moves],
    result: state.result ? { ...state.result } : null };
  validate(record);
  const analysis = analysisCopy(state.analysis);
  if (analysis) record.analysis = analysis;
  return record;
}

const position = (state) => ({ b: [...state.b], turn: state.turn, last: state.last ? [...state.last] : null,
  caps: { c: [...state.caps.c], h: [...state.caps.h] } });

export function replay(record) {
  validate(record);
  let state = { ...newGame(record), id: record.id, createdAt: record.createdAt };
  const positions = [position(state)];
  for (const [index, uci] of record.moves.entries()) {
    try {
      const move = typeof uci === "string" ? uciToMove(uci) : null;
      if (!move || moveToUci(move) !== uci) throw new Error("수 표기가 올바르지 않아요.");
      state = play(state, move);
      // 자동 쉬기는 play가 계산한다. 국면 번호는 기록된 수의 번호와 일치한다.
      positions.push(position(state));
    } catch (cause) {
      const error = new Error(`기보 ${index + 1}수째 손상됨: ${cause.message}`, { cause });
      error.ply = index + 1;
      throw error;
    }
  }
  if (state.result?.winner !== record.result?.winner || state.result?.reason !== record.result?.reason) bad("결과");
  const analysis = analysisCopy(record.analysis);
  if (analysis) state = { ...state, analysis };
  return { positions, state };
}
