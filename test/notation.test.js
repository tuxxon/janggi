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
