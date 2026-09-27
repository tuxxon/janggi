import { describe, it, expect } from "vitest";
import { winFromScore, choWin, moveDelta, grade, gradeColor } from "../src/winrate.js";

describe("winrate", () => {
  it("maps centipawns with the lichess chess curve", () => {
    expect(winFromScore({ cp: 0 })).toBeCloseTo(50, 6);
    expect(winFromScore({ cp: 190 })).toBeCloseTo(66.78, 1);
    expect(winFromScore({ cp: -190 })).toBeCloseTo(33.22, 1);
  });
  it("mate scores are 100 / 0", () => {
    expect(winFromScore({ mate: 3 })).toBe(100);
    expect(winFromScore({ mate: -2 })).toBe(0);
  });
  it("flips side-to-move scores to Cho's perspective", () => {
    expect(choWin({ cp: 190 }, "c")).toBeCloseTo(66.78, 1);
    expect(choWin({ cp: 190 }, "h")).toBeCloseTo(33.22, 1);
    expect(choWin({ mate: 1 }, "h")).toBe(0);
  });
  it("grades drops at 9.9 / 10 / 20 / 30 percentage points", () => {
    expect([-9.9, -10, -20, -30, 15].map((d) => grade(d))).toEqual([null, "부정확 ?!", "실수 ?", "대실수 ??", null]);
    expect([-9.9, -10, -20, -30].map(gradeColor)).toEqual(["#28783d", "#aa8200", "#c56516", "#ae2219"]);
  });
  it("computes after minus before from the mover's perspective", () => {
    expect(moveDelta(65, 38, "c")).toBe(-27);
    expect(moveDelta(38, 65, "h")).toBe(-27);
    expect(moveDelta(38, 65, "c")).toBe(27);
  });
  it("does not grade forced passes", () => {
    expect(grade(-40, true)).toBeNull();
    expect(grade(-40, false)).toBe("대실수 ??");
  });
});
