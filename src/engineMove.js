// 원본 엔진의 bestMove 루트 루프를 그대로 따르되, 반복수로 막힌 수 하나를 뺀다(engine.js 는 원본 그대로 둔다).
import { order, legal, make, unmake, search, other } from "./engine.js";

export function bestMoveExcluding(b, side, depth, excluded) {
  const ms = order(b, legal(b, side).filter((m) => !excluded || m[0] !== excluded[0] || m[1] !== excluded[1]));
  if (!ms.length) return null;
  let best = null, bv = -Infinity, alpha = -Infinity;
  for (const m of ms) {
    const cap = make(b, m); const v = -search(b, other(side), depth - 1, -Infinity, -alpha + 30) + Math.random() * 20; unmake(b, m, cap);
    if (v > bv) { bv = v; best = m; } if (v > alpha) alpha = v;
  }
  return best;
}
