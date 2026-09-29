// 좌표·수·FEN 표기. Fairy-Stockfish 장기 좌표와 같다: 파일 a–i, 랭크 1–10, 초(아래) 궁 줄이 랭크 1.
const FILES = "abcdefghi";

export const sqName = (i) => FILES[i % 9] + (10 - ((i / 9) | 0));

export function sqIndex(s) {
  const m = /^([a-i])(10|[1-9])$/.exec(s);
  if (!m) return null;
  return (10 - Number(m[2])) * 9 + FILES.indexOf(m[1]);
}

export const moveToUci = (m) => (m === "pass" ? "pass" : sqName(m[0]) + sqName(m[1]));

// "b1c3" → [from, to]. Fairy-Stockfish는 쉬기를 제자리 수(e2e2)로 쓴다 → "pass".
export function uciToMove(u) {
  if (u === "pass") return "pass";
  const m = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(u);
  if (!m) return null;
  const from = sqIndex(m[1]), to = sqIndex(m[2]);
  return from === to ? "pass" : [from, to];
}

// 내부 글자 → FSF 장기 글자 (마=n, 상=b). 초=대문자(백), 한=소문자(흑).
const FEN_CH = { K: "k", R: "r", C: "c", H: "n", E: "b", A: "a", P: "p" };

export function toFen(b, turn) {
  const rows = [];
  for (let r = 0; r < 10; r++) {
    let row = "", empty = 0;
    for (let c = 0; c < 9; c++) {
      const p = b[r * 9 + c];
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      const ch = FEN_CH[p[1]];
      row += p[0] === "c" ? ch.toUpperCase() : ch;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join("/")} ${turn === "c" ? "w" : "b"} - - 0 1`;
}

// 수를 한글 기물 이름과 함께 보여준다: "마 g1→f3", 쉬기는 "쉬기". 졸은 초, 병은 한.
const KO = { K: "궁", R: "차", C: "포", H: "마", E: "상", A: "사" };
export function describeMove(b, uci) {
  const move = uciToMove(uci);
  if (move === "pass") return "쉬기";
  if (!move) return uci;
  const p = b[move[0]];
  const name = !p ? "" : p[1] === "P" ? (p[0] === "c" ? "졸" : "병") : KO[p[1]];
  return `${name ? name + " " : ""}${sqName(move[0])}→${sqName(move[1])}`;
}
