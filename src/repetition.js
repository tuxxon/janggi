// 반복수(카카오 장기 방식). 공식 문서를 찾지 못해 카카오 호환을 목표로 만든 Fairy-Stockfish `janggimodern` 의
// moveRepetitionIllegal 구현을 기준으로 삼았다: 궁·사가 아닌 한 기물이 어느 칸(A)에 온 뒤 A↔B 를 세 번 오가면
// (A→B, B→A, A→B) 네 번째(B→A)는 둘 수 없다. 같은 자리를 왕복하던 기물이면 "같은 수 세 번째"가 막히는 셈이다.
//   예) 초 차 a1a2, a2a1, a1a2, a2a1 다음의 a1a2 (내 수 5개가 한 기물의 왕복이고 첫 수가 그 출발점에 도착한 수)
// 셈이 끊기는 경우: 그 사이 어느 쪽이든 기물을 잡음 · 장군을 받은 상태에서 둔 수 · 어느 쪽이든 쉬기(자동 쉬기 포함).
//   상대의 쉬기도 끊는 것은 사용자 규칙이다("상대방이 한 수 쉬면, 우린 둘 수 있는 거거든", 2026-09-28) — FSF 는 상대 쉬기를 세지 않는다.
// 궁·사는 무한 반복 가능.
import { inCheck, legal } from "./engine.js";
import { uciToMove } from "./notation.js";

const EXEMPT = new Set(["K", "A"]);
const reverse = (a, b) => a[0] === b[1] && a[1] === b[0];

// 지금 두는 쪽에게 반복수로 막힌 수를 돌려준다(없으면 null). 막힐 수 있는 수는 "내 직전 수를 되돌리는 수" 하나뿐이다.
export function forbiddenMove(state) {
  if (!state.repetition || state.over) return null;
  const side = state.turn, own = [], plies = [];
  // 뒤에서부터 내 수 4개를 모은다. 그 사이(내 첫 수 포함) 어느 쪽이든 잡는 수가 있으면 끊긴다.
  let next = side; // 방금 본 수 다음에 둔 쪽(맨 처음엔 지금 둘 차례인 쪽)
  for (let j = state.moves.length - 1; j >= 0 && own.length < 4; j--) {
    const before = state.hist[j], move = uciToMove(state.moves[j]);
    if (move !== "pass" && before.b[move[1]]) return null;
    // 쉬기가 끼면 끊긴다 — 내 쉬기든 상대 쉬기든. 자동 쉬기는 기록에 안 남으므로 "같은 편이 연달아 둔 두 수"로 알아본다
    // (그 사이 다른 편이 둘 수 없어 쉰 것). 내 자동 쉬기를 끊지 않으면 막힌 수뿐인 쪽이 끝없이 묶인다(리뷰 MED-1).
    if (move === "pass" || before.turn === next) return null;
    next = before.turn;
    if (before.turn !== side) continue;
    own.push(move); plies.push(j);
    // 되돌림이 이어지지 않으면 바로 끝낸다(대부분의 국면은 여기서 끝나서 싸다).
    if (own.length === 2 && !reverse(own[1], own[0])) return null;
    if (own.length === 3 && !reverse(own[2], own[1])) return null;
  }
  if (own.length < 4 || own[3][1] !== own[2][0]) return null;
  const candidate = [own[0][1], own[0][0]], piece = state.b[candidate[0]];
  if (!piece || piece[0] !== side || EXEMPT.has(piece[1]) || state.b[candidate[1]]) return null;
  // 원래 둘 수 없는 수(말 다리 막힘 등)는 반복수로 막았다고 하지 않는다(✕·안내가 엉뚱하게 뜨지 않게).
  if (!legal(state.b.slice(), side).some(([f, t]) => f === candidate[0] && t === candidate[1])) return null;
  // 장군을 받은 상태에서 둔 수는 세지 않는다(지금 포함). 비싼 검사라 패턴이 맞을 때만 한다.
  if (inCheck(state.b, side) || plies.some((j) => inCheck(state.hist[j].b, side))) return null;
  return candidate;
}
