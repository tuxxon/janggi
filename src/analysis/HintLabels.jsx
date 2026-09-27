// SVG overlays for live play and read-only review positions.
import { moveToUci, uciToMove } from "../notation.js";
import { grade, gradeColor } from "../winrate.js";

export function HintLabels({ candidates = [], focused = [], targets = [], passSquare, turnWin, hovered, xy }) {
  const labels = new Map(), allowed = new Set(targets.map(moveToUci));
  for (const candidate of candidates) {
    const move = uciToMove(candidate.move), to = move === "pass" ? passSquare : move?.[1];
    if (to != null && !labels.has(to)) labels.set(to, { ...candidate, target: false });
  }
  for (const candidate of focused) {
    if (allowed.has(candidate.move)) labels.set(uciToMove(candidate.move)[1], { ...candidate, target: true });
  }
  return <g style={{ pointerEvents: "none" }}>
    {[...labels].map(([to, candidate]) => {
      const [x, y] = xy(to), delta = candidate.win - turnWin;
      return <g key={to} data-testid={candidate.target ? "target-win" : "candidate-win"} data-move={candidate.move}>
        <title>{`${candidate.move} ${Math.round(candidate.win)}% ${grade(delta) ?? ""}`}</title>
        <text x={x} y={y - 15} textAnchor="middle" fill={candidate.target ? gradeColor(delta) : "#3a2c20"}
          stroke="#fff5de" strokeWidth="4" paintOrder="stroke" fontWeight="900"
          fontSize={candidate.target ? hovered === to ? 22 : 16 : 13}>{Math.round(candidate.win)}%</text>
      </g>;
    })}
  </g>;
}
