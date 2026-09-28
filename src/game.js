import { newBoard, other, legal, inCheck, make } from "./engine.js";
import { moveToUci } from "./notation.js";

const NAME = { c: "초(파랑)", h: "한(빨강)" };

// 시각·저장·타이머는 화면/저장 계층이 맡는다.
export function newGame({ controllers = { c: "human", h: "engine" }, level = 3,
  setups = { c: "마상마상", h: "마상마상" } } = {}) {
  // c/h 만 복사한다: 가져온 기록의 모르는 키가 상태로 새어 들어오지 않게.
  return { b: newBoard(setups.c, setups.h), turn: "c", controllers: { c: controllers.c, h: controllers.h }, level,
    setups: { c: setups.c, h: setups.h }, last: null, caps: { c: [], h: [] }, hist: [], moves: [], over: null, result: null, msg: "" };
}

// 쉬기는 별도로 검증한다. 원본 legal()은 탐색 중 판을 바꾸므로 복사본을 넘긴다.
export const legalMoves = (state) => state.over ? [] : legal(state.b.slice(), state.turn);

export function play(state, move) {
  if (state.over) throw new Error("이미 끝난 대국이에요.");
  if (move === "pass") {
    if (inCheck(state.b, state.turn)) throw new Error("장군일 때는 쉴 수 없어요.");
  } else if (!Array.isArray(move) || move.length !== 2 ||
    !legalMoves(state).some(([from, to]) => from === move[0] && to === move[1])) {
    throw new Error("둘 수 없는 수예요.");
  }
  const b = state.b.slice(), caps = { c: [...state.caps.c], h: [...state.caps.h] };
  let last = move === "pass" ? null : [...move];
  if (last) {
    const cap = make(b, last);
    if (cap) caps[other(cap[0])].push(cap);
  }
  let turn = other(state.turn), over = null, result = null, msg = "";
  const ms = legal(b, turn), chk = inCheck(b, turn);
  const humans = ["c", "h"].filter((side) => state.controllers[side] === "human");
  if (!ms.length && chk) {
    over = other(turn);
    result = { winner: over, reason: "외통수" };
    msg = humans.length === 1
      ? over === humans[0] ? "외통수! 이겼어요." : "외통수예요. 엔진이 이겼어요."
      : `외통수! ${NAME[over]} 승리`;
  } else if (!ms.length) {
    msg = `${NAME[turn]} 쪽이 둘 수 없어 한 수 쉽니다.`;
    turn = other(turn);
    last = null;
  } else if (chk) {
    msg = humans.length === 1
      ? turn === humans[0] ? "장군이에요! 궁을 지키세요." : "장군!"
      : `장군! ${NAME[turn]} 궁을 지키세요.`;
  } else if (move === "pass") msg = "한 수 쉬었어요.";
  return { ...state, b, caps, last, turn, over, result, msg,
    hist: [...state.hist, state], moves: [...state.moves, moveToUci(move)] };
}

function undoIndex(state) {
  return state.hist.findLastIndex((prev) => state.controllers[prev.turn] === "human");
}
export const canUndo = (state) => undoIndex(state) >= 0;
export function undo(state) {
  const index = undoIndex(state);
  if (index < 0) throw new Error("무를 수 있는 사람 차례가 없어요.");
  return { ...state.hist[index], msg: "무르기 했어요." };
}
