// 복기 화면용 순수 계산. evals 는 기보의 초 기준 평가(없으면 null).
import { moveDelta, grade } from "./winrate.js";
import { describeMove } from "./notation.js";

export function reviewRows(record, positions, evals) {
  return record.moves.map((move, k) => {
    const side = positions[k].turn, before = evals?.[k], after = evals?.[k + 1];
    const delta = before && after ? moveDelta(before.win, after.win, side) : null;
    // 수를 둔 뒤에도 같은 편 차례면 상대가 둘 수 없어 자동으로 쉰 것이다.
    // label: 한글 기물 이름과 칸("마 g1→f3", "쉬기") — 그 수를 두기 전 판에서 읽는다.
    return { ply: k + 1, side, move, label: describeMove(positions[k].b, move), delta, grade: delta === null ? null : grade(delta), autoPassAfter: positions[k + 1]?.turn === side };
  });
}

// ply → x(0..w), 초 승률 → y(100%가 위). 평가가 없는 국면은 건너뛴다.
export function chartPoints(evals, w, h) {
  const n = evals.length;
  return evals.flatMap((e, ply) => (e ? [{ ply, x: n === 1 ? w / 2 : (ply * w) / (n - 1), y: ((100 - e.win) / 100) * h }] : []));
}

export const resultText = (r) => (r ? `${r.winner === "c" ? "초" : "한"} 승 (${r.reason})` : "진행 중");
