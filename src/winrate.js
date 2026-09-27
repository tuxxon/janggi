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
