import { describe, it, expect } from "vitest";
import * as game from "../src/game.js";
import { forbiddenMove } from "../src/repetition.js";
import { sqIndex } from "../src/notation.js";

// 반복수(카카오 장기, Fairy-Stockfish janggimodern 기준): 궁·사가 아닌 기물로 같은 수를 세 번째 두지 못한다.
const m = (from, to) => [sqIndex(from), sqIndex(to)];
const humans = { controllers: { c: "human", h: "human" }, level: 3, setups: { c: "마상마상", h: "마상마상" } };
const playAll = (state, moves) => moves.reduce((s, [f, t]) => game.play(s, m(f, t)), state);
const has = (state, [f, t]) => game.legalMoves(state).some(([a, b]) => a === sqIndex(f) && b === sqIndex(t));

describe("repetition rule (user request: Kakao Janggi)", () => {
  const shuffle = [["a1", "a2"], ["i10", "i9"], ["a2", "a1"], ["i9", "i10"], ["a1", "a2"], ["i10", "i9"], ["a2", "a1"], ["i9", "i10"]];

  it("allows the same move twice, forbids it the third time (초 차 a1↔a2)", () => {
    const four = playAll(game.newGame(humans), shuffle.slice(0, 4));
    expect(has(four, ["a1", "a2"])).toBe(true);                  // 두 번째 a1a2 는 된다
    const eight = playAll(game.newGame(humans), shuffle);
    expect(forbiddenMove(eight)).toEqual(m("a1", "a2"));
    expect(has(eight, ["a1", "a2"])).toBe(false);                 // 세 번째 a1a2 는 안 된다
    expect(() => game.play(eight, m("a1", "a2"))).toThrow("반복수");
    expect(has(eight, ["a1", "a3"])).toBe(true);                  // 다른 수는 된다
    // 한도 같은 규칙: 초가 다른 수를 두면 한의 세 번째 i10i9 가 막힌다
    const nine = game.play(eight, m("a4", "b4"));
    expect(forbiddenMove(nine)).toEqual(m("i10", "i9"));
  });

  it("counts from the move that brought the piece in: the second occurrence of a move is still allowed", () => {
    // 초 c4c5(다른 기물), a1a2, a2a1, a1a2 다음의 a2a1 은 a2a1 로서 두 번째 → 된다. 그다음 a1a2(세 번째)는 막힌다.
    const s = playAll(game.newGame(humans), [["c4", "c5"], ["i10", "i9"], ["a1", "a2"], ["i9", "i10"], ["a2", "a1"], ["i10", "i9"], ["a1", "a2"], ["i9", "i10"]]);
    expect(forbiddenMove(s)).toBeNull();
    expect(has(s, ["a2", "a1"])).toBe(true);
    const t = playAll(s, [["a2", "a1"], ["a7", "a6"]]);
    expect(forbiddenMove(t)).toEqual(m("a1", "a2"));
  });

  it("lets the king and advisors repeat without limit", () => {
    const kings = [["e2", "e1"], ["e9", "e10"], ["e1", "e2"], ["e10", "e9"]];
    let s = game.newGame(humans);
    for (let round = 0; round < 3; round++) s = playAll(s, kings);
    expect(forbiddenMove(s)).toBeNull();
    expect(has(s, ["e2", "e1"])).toBe(true);
    const advisors = [["d1", "d2"], ["d10", "d9"], ["d2", "d1"], ["d9", "d10"]];
    s = game.newGame(humans);
    for (let round = 0; round < 3; round++) s = playAll(s, advisors);
    expect(forbiddenMove(s)).toBeNull();
  });

  it("does not count a shuffle that a capture (by either side) interrupts", () => {
    // 초 a1a2, 한 a7a6, 초 a2a1, 한 a6a5, 초 a1a2, 한 a5xa4(잡음), 초 a2a1, 한 i10i9 → 초 a1a2 세 번째지만 잡는 수가 끼었다
    const s = playAll(game.newGame(humans), [["a1", "a2"], ["a7", "a6"], ["a2", "a1"], ["a6", "a5"], ["a1", "a2"], ["a5", "a4"], ["a2", "a1"], ["i10", "i9"]]);
    expect(s.caps.h).toHaveLength(1);
    expect(forbiddenMove(s)).toBeNull();
    expect(has(s, ["a1", "a2"])).toBe(true);
  });

  it("blocks a perpetual-check shuffle, but moves made while in check do not count", () => {
    // 가상 국면: 초 궁 e2 · 초 차 d3, 한 궁 f9 · 한 차 d10. 한 차가 d10↔e10 으로 장군을 반복하고 초 차가 d3↔e3 으로 막는다.
    const b = new Array(90).fill(null);
    b[sqIndex("e2")] = "cK"; b[sqIndex("d3")] = "cR"; b[sqIndex("f9")] = "hK"; b[sqIndex("d10")] = "hR";
    let s = { ...game.newGame(humans), b, turn: "h" };
    s = playAll(s, [["d10", "e10"], ["d3", "e3"], ["e10", "d10"], ["e3", "d3"], ["d10", "e10"], ["d3", "e3"], ["e10", "d10"], ["e3", "d3"]]);
    expect(s.turn).toBe("h");
    expect(forbiddenMove(s)).toEqual(m("d10", "e10"));            // 한의 세 번째 장군 d10e10 은 막힌다
    const s2 = game.play(s, m("d10", "d9"));
    expect(forbiddenMove(s2)).toBeNull();                          // 초의 d3e3 들 중 둘은 장군 중에 둔 수라 세지 않는다
  });

  it("applies only to games that carry the rule (old records replay unchanged)", () => {
    const legacy = playAll({ ...game.newGame(humans), repetition: false }, shuffle);
    expect(forbiddenMove(legacy)).toBeNull();
    expect(has(legacy, ["a1", "a2"])).toBe(true);
    expect(game.newGame(humans).repetition).toBe(true);           // 새 판은 규칙을 가진다
  });

  // ---- 리뷰(Opus, 반복수) 반영: 살아남던 뮤턴트를 잡는 핀과 자동 쉬기 묶임 ----
  const board = (pieces) => { const b = new Array(90).fill(null); for (const [q, p] of Object.entries(pieces)) b[sqIndex(q)] = p; return b; };
  const at = (pieces, turn = "c") => ({ ...game.newGame(humans), b: board(pieces), turn });

  it("does not block while the side is in check now (the blocked move may be the only good defence)", () => {
    // 초 차 d3↔e3 왕복을 마친 뒤 한 차가 e10 으로 장군 → 세 번째 d3e3 은 막는 수라 둘 수 있어야 한다
    const s = playAll(at({ e2: "cK", d3: "cR", f9: "hK", a10: "hR" }),
      [["d3", "e3"], ["f9", "f10"], ["e3", "d3"], ["f10", "f9"], ["d3", "e3"], ["f9", "f10"], ["e3", "d3"], ["a10", "e10"]]);
    expect(forbiddenMove(s)).toBeNull();
    expect(has(s, ["d3", "e3"])).toBe(true);
  });
  it("a capture by the arrival move itself resets the count", () => {
    const s = playAll(at({ e2: "cK", a1: "cR", f9: "hK", a3: "hP" }),
      [["a1", "a3"], ["f9", "f10"], ["a3", "a2"], ["f10", "f9"], ["a2", "a3"], ["f9", "f10"], ["a3", "a2"], ["f10", "f9"]]);
    expect(forbiddenMove(s)).toBeNull();
    expect(has(s, ["a2", "a3"])).toBe(true);
  });
  it("never blocks a candidate that captures", () => {
    const s = playAll(at({ e2: "cK", a1: "cR", f9: "hK", i3: "hR" }),
      [["a1", "a3"], ["f9", "f10"], ["a3", "a1"], ["f10", "f9"], ["a1", "a3"], ["f9", "f10"], ["a3", "a1"], ["i3", "a3"]]);
    expect(forbiddenMove(s)).toBeNull();
    expect(has(s, ["a1", "a3"])).toBe(true);
  });
  it("an own pass resets the count (documented simplification; FSF skips one pass)", () => {
    const s = playAll(game.newGame(humans), [["a1", "a2"], ["e9", "e10"], ["a2", "a1"], ["e10", "e9"], ["a1", "a2"], ["e9", "e10"], ["a2", "a1"], ["e10", "e9"]]);
    const t = game.play(game.play(s, "pass"), m("e9", "e10"));
    expect(forbiddenMove(t)).toBeNull();
    expect(has(t, ["a1", "a2"])).toBe(true);
  });
  it("needs an unbroken chain of reversals (a1a3, a3a2, a2a1, a1a2 → a2a1 is fine)", () => {
    const s = playAll(game.newGame(humans), [["a1", "a3"], ["e9", "e10"], ["a3", "a2"], ["e10", "e9"], ["a2", "a1"], ["e9", "e10"], ["a1", "a2"], ["e10", "e9"]]);
    expect(forbiddenMove(s)).toBeNull();
    expect(has(s, ["a2", "a1"])).toBe(true);
  });
  it("auto-passes a side whose only move is blocked, and that forced pass resets the count (review MED-1)", () => {
    // 초 궁 d1 은 한 차 a2·한 마 f3 에 갇혔고, 초 마 a10 은 a9 다리가 막혀 a10c9 하나뿐이다.
    const s8 = playAll(at({ d1: "cK", a10: "cH", e9: "hK", a2: "hR", f3: "hH", a9: "hP" }),
      [["a10", "c9"], ["e9", "f9"], ["c9", "a10"], ["f9", "e9"], ["a10", "c9"], ["e9", "f9"], ["c9", "a10"], ["f9", "e9"]]);
    expect(s8.turn).toBe("h");                               // 막힌 수뿐이라 초는 자동으로 쉬었다
    expect(s8.msg).toContain("둘 수 없어");
    const s9 = game.play(s8, m("e9", "f9"));
    expect(s9.turn).toBe("c");                               // 그 쉼이 셈을 끊는다: 초가 영원히 묶이지 않는다
    expect(has(s9, ["a10", "c9"])).toBe(true);
  });
  it("does not name a move that is illegal anyway (horse leg blocked)", () => {
    const s = playAll(at({ d1: "cK", b1: "cH", e9: "hK", i2: "hR" }),
      [["b1", "c3"], ["e9", "f9"], ["c3", "b1"], ["f9", "e9"], ["b1", "c3"], ["e9", "f9"], ["c3", "b1"], ["i2", "b2"]]);
    expect(forbiddenMove(s)).toBeNull();
  });
});
