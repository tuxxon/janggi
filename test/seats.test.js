import { describe, it, expect } from "vitest";
import { bottomOf, nationAt, seatsOf, chooseNation, nextGame, pendingOf, whoApplied } from "../src/seats.js";

const game = (extra = {}) => ({ controllers: { c: "human", h: "engine" }, setups: { c: "마상마상", h: "상마상마" }, level: 3, bottom: "c", ...extra });

describe("seats: top/bottom settings (user request 2026-09-28)", () => {
  it("reads the board orientation, falling back to the old rule for records without one", () => {
    expect(bottomOf(game())).toBe("c");
    expect(bottomOf(game({ bottom: "h" }))).toBe("h");
    expect(bottomOf(game({ bottom: undefined, controllers: { c: "engine", h: "human" } }))).toBe("h"); // 옛 규칙: 한만 사람
    expect(bottomOf(game({ bottom: undefined, controllers: { c: "human", h: "human" } }))).toBe("c");
    expect(nationAt("c", "bottom")).toBe("c");
    expect(nationAt("c", "top")).toBe("h");
    expect(nationAt("h", "top")).toBe("c");
  });
  it("maps a game to per-seat settings", () => {
    expect(seatsOf(game())).toEqual({ bottomNation: "c", top: { who: "engine", setup: "상마상마" }, bottom: { who: "human", setup: "마상마상" } });
    expect(seatsOf(game({ bottom: "h" }))).toEqual({ bottomNation: "h", top: { who: "human", setup: "마상마상" }, bottom: { who: "engine", setup: "상마상마" } });
  });
  it("links the nations: choosing one seat's nation gives the other seat the opposite", () => {
    const s = seatsOf(game());
    expect(chooseNation(s, "top", "c").bottomNation).toBe("h");
    expect(chooseNation(s, "bottom", "h").bottomNation).toBe("h");
    expect(chooseNation(s, "bottom", "c").bottomNation).toBe("c");
    expect(chooseNation(s, "top", "h").bottomNation).toBe("c");
  });
  it("keeps who-plays and setups attached to the seat when the nations swap", () => {
    const s = chooseNation(seatsOf(game()), "bottom", "h"); // 아래(사람, 마상마상)가 한나라로
    expect(nextGame(s)).toEqual({ bottom: "h", controllers: { h: "human", c: "engine" }, setups: { h: "마상마상", c: "상마상마" } });
  });
  it("reports which choices wait for a new game", () => {
    const g = game();
    expect(pendingOf(seatsOf(g), 3, g)).toEqual({ nation: false, top: false, bottom: false, level: false });
    const s = chooseNation(seatsOf(g), "top", "c");
    expect(pendingOf(s, 3, g)).toEqual({ nation: true, top: false, bottom: false, level: false });
    expect(pendingOf({ ...seatsOf(g), top: { who: "engine", setup: "마상상마" } }, "max", g)).toEqual({ nation: false, top: true, bottom: false, level: true });
  });
  it("applies a seat's who-plays to the nation sitting there in the current game, even with a nation change pending", () => {
    expect(whoApplied(game(), "top", "human")).toEqual({ c: "human", h: "human" });
    expect(whoApplied(game({ bottom: "h" }), "top", "engine")).toEqual({ c: "engine", h: "engine" });
    expect(whoApplied(game({ bottom: "h", controllers: { c: "engine", h: "human" } }), "bottom", "engine")).toEqual({ c: "engine", h: "engine" });
  });
});
