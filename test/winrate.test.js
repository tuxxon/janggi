import { describe, it, expect } from "vitest";
import { winFromScore, choWin } from "../src/winrate.js";

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
});
