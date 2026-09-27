import { describe, it, expect } from "vitest";
import { reviewRows, chartPoints, resultText } from "../src/review.js";
import { replay } from "../src/record.js";

const base = { v: 1, id: "2026-09-28T14-03-12-345", createdAt: "2026-09-28T14:03:12.345Z",
  setups: { c: "마상마상", h: "마상마상" }, controllers: { c: "human", h: "engine" }, level: 3, result: null };

describe("review rows", () => {
  it("numbers moves, names the mover, and grades the mover's win-rate change", () => {
    const record = { ...base, moves: ["a4a5", "a7a6", "pass"] };
    const { positions } = replay(record);
    // evals are Cho's win %: 50 → 52 (초 +2) → 80 (한 −28 실수) → 45 (초 −35 대실수)
    const evals = [{ win: 50 }, { win: 52 }, { win: 80 }, { win: 45 }];
    expect(reviewRows(record, positions, evals)).toEqual([
      { ply: 1, side: "c", move: "a4a5", delta: 2, grade: null, autoPassAfter: false },
      { ply: 2, side: "h", move: "a7a6", delta: -28, grade: "실수 ?", autoPassAfter: false },
      { ply: 3, side: "c", move: "pass", delta: -35, grade: "대실수 ??", autoPassAfter: false },
    ]);
  });
  it("leaves the change empty when either side's evaluation is missing", () => {
    const record = { ...base, moves: ["a4a5", "a7a6"] };
    const { positions } = replay(record);
    expect(reviewRows(record, positions, [{ win: 50 }, null, { win: 40 }]).map((r) => r.delta)).toEqual([null, null]);
    expect(reviewRows(record, positions, undefined).map((r) => r.grade)).toEqual([null, null]);
  });
});

describe("win-rate chart", () => {
  it("maps ply to x across the width and Cho's win % to y (100% at the top), skipping gaps", () => {
    const pts = chartPoints([{ win: 50 }, null, { win: 100 }, { win: 0 }], 300, 100);
    expect(pts).toEqual([{ ply: 0, x: 0, y: 50 }, { ply: 2, x: 200, y: 0 }, { ply: 3, x: 300, y: 100 }]);
  });
  it("puts a single position in the middle", () => {
    expect(chartPoints([{ win: 25 }], 300, 100)).toEqual([{ ply: 0, x: 150, y: 75 }]);
  });
});

describe("result text", () => {
  it("describes the outcome", () => {
    expect(resultText(null)).toBe("진행 중");
    expect(resultText({ winner: "c", reason: "외통수" })).toBe("초 승 (외통수)");
    expect(resultText({ winner: "h", reason: "외통수" })).toBe("한 승 (외통수)");
  });
});
