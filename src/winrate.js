// 평가 점수 → 승률(%). lichess의 체스 곡선을 그대로 쓴 추정치다(장기 실전 통계로 보정하지 않음).
export function winFromScore(s) {
  if (s.mate !== undefined) return s.mate > 0 ? 100 : 0;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * s.cp)) - 1);
}

// UCI 점수는 두는 쪽 기준 → 초 기준 승률.
export function choWin(s, turn) {
  const w = winFromScore(s);
  return turn === "c" ? w : 100 - w;
}

// 저장된 초 기준 평가 → 두는 쪽의 지금 승률(훈수 색의 기준). 평가가 없으면 50.
export const moverWin = (e, turn) => (e ? (turn === "c" ? e.win : 100 - e.win) : 50);

// 저장된 초 승률 두 개 → 실제로 둔 쪽의 변화(%p).
export const moveDelta = (before, after, mover) => (after - before) * (mover === "c" ? 1 : -1);

export function grade(delta, forcedPass = false) {
  if (forcedPass) return null;
  if (delta <= -30) return "대실수 ??";
  if (delta <= -20) return "실수 ?";
  if (delta <= -10) return "부정확 ?!";
  return null;
}

export const gradeColor = (delta) => delta <= -30 ? "#ae2219" : delta <= -20 ? "#c56516" : delta <= -10 ? "#aa8200" : "#28783d";
