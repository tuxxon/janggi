// SVG overlays for live play and read-only review positions.
import { moveToUci, uciToMove, describeMove } from "../notation.js";
import { grade, gradeColor } from "../winrate.js";

// deep: 오른쪽 클릭 30초 깊게 보기 결과(수 → { move, win, depth, … }) — 그 칸은 0.5초 값 대신 이것과 깊이를 쓴다.
// reading: 지금 읽는 수(서비스의 lookMove). "…"는 그 수에만 붙는다.
export function HintLabels({ candidates = [], focused = [], targets = [], deep = {}, reading = null, passSquare, turnWin, hovered, xy, board }) {
  const labels = new Map(), allowed = new Set(targets.map(moveToUci));
  for (const candidate of candidates) {
    const move = uciToMove(candidate.move), to = move === "pass" ? passSquare : move?.[1];
    if (to != null && !labels.has(to)) labels.set(to, { ...candidate, target: false });
  }
  for (const candidate of focused) {
    if (allowed.has(candidate.move)) labels.set(uciToMove(candidate.move)[1], { ...candidate, target: true });
  }
  for (const candidate of Object.values(deep)) {
    if (allowed.has(candidate.move)) labels.set(uciToMove(candidate.move)[1], { ...candidate, target: true, deep: true });
  }
  return <g style={{ pointerEvents: "none" }}>
    {[...labels].map(([to, candidate]) => {
      const [x, y] = xy(to), delta = candidate.win - turnWin;
      return <g key={to} data-testid={candidate.target ? "target-win" : "candidate-win"} data-move={candidate.move}
        data-deep={candidate.deep ? "true" : undefined}>
        <title>{`${board ? describeMove(board, candidate.move) : candidate.move} ${Math.round(candidate.win)}% ${grade(delta) ?? ""}`}</title>
        <text x={x} y={y - 15} textAnchor="middle" fill={candidate.target ? gradeColor(delta) : "#3a2c20"}
          stroke="#fff5de" strokeWidth="4" paintOrder="stroke" fontWeight="900"
          fontSize={candidate.target ? hovered === to ? 22 : 16 : 13}>{Math.round(candidate.win)}%</text>
        {candidate.deep && <text x={x} y={y + 25} textAnchor="middle" fill="#3a2c20" stroke="#fff5de" strokeWidth="3"
          paintOrder="stroke" fontWeight="700" fontSize="13">{`깊이 ${candidate.depth}${candidate.move === reading ? "…" : ""}`}</text>}
      </g>;
    })}
  </g>;
}
