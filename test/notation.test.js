import { describe, it, expect } from "vitest";
import { sqName, sqIndex, moveToUci, uciToMove, toFen } from "../src/notation.js";
import { newBoard } from "../src/engine.js";

describe("notation", () => {
  it("names squares from Cho's side: file a-i, rank 1 = Cho back rank", () => {
    expect(sqName(81)).toBe("a1");
    expect(sqName(76)).toBe("e2");
    expect(sqName(13)).toBe("e9");
    expect(sqName(0)).toBe("a10");
    expect(sqName(89)).toBe("i1");
    expect(sqIndex("a1")).toBe(81);
    expect(sqIndex("a10")).toBe(0);
    expect(sqIndex("e9")).toBe(13);
    expect(sqIndex("j1")).toBe(null);
    expect(sqIndex("a11")).toBe(null);
  });

  it("converts moves both ways, and FSF's king-to-same-square pass to 'pass'", () => {
    expect(moveToUci([82, 65])).toBe("b1c3");
    expect(uciToMove("b1c3")).toEqual([82, 65]);
    expect(uciToMove("a10a9")).toEqual([0, 9]);
    expect(uciToMove("e2e2")).toBe("pass");
    expect(uciToMove("f10f10")).toBe("pass");
    expect(uciToMove("pass")).toBe("pass");
    expect(uciToMove("z9a1")).toBe(null);
  });

  it("start position FEN equals Fairy-Stockfish janggi startFen (literal from src/variant.cpp)", () => {
    const b = newBoard("마상상마", "마상상마");
    expect(toFen(b, "c")).toBe("rnba1abnr/4k4/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/4K4/RNBA1ABNR w - - 0 1");
  });

  it("encodes setups per side and side to move", () => {
    // 초 마상마상 → cols 1,2,6,7 = H,E,H,E ; 한 상마상마 read from Han's left (col 7 first) = E,H,E,H at cols 7,6,2,1
    const b = newBoard("마상마상", "상마상마");
    expect(toFen(b, "h")).toBe("rnba1anbr/4k4/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/4K4/RNBA1ANBR b - - 0 1");
  });
});

describe("Korean piece names for moves (user request 2026-09-29)", () => {
  it("names the moving piece and shows from→to; pass is 쉬기", async () => {
    const { describeMove } = await import("../src/notation.js");
    const b = newBoard("마상마상", "마상마상");
    expect(describeMove(b, "b1c3")).toBe("마 b1→c3");
    expect(describeMove(b, "a1a2")).toBe("차 a1→a2");
    expect(describeMove(b, "b3b5")).toBe("포 b3→b5");
    expect(describeMove(b, "c1a4")).toBe("상 c1→a4");
    expect(describeMove(b, "d1d2")).toBe("사 d1→d2");
    expect(describeMove(b, "e2e1")).toBe("궁 e2→e1");
    expect(describeMove(b, "a4a5")).toBe("졸 a4→a5"); // 초의 졸
    expect(describeMove(b, "a7a6")).toBe("병 a7→a6"); // 한의 병
    expect(describeMove(b, "pass")).toBe("쉬기");
  });
});
