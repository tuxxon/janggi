import { describe, it, expect } from "vitest";
import { bottomOf, nationAt, seatsOf, chooseNation, nextGame, pendingOf, whoApplied, withLevel } from "../src/seats.js";

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
  // 최강 · 3초 ↔ 최강 · 20초만 대국 중에 바로 바뀐다(사용자 요청 2026-09-30). 다른 난이도가 끼면 새 게임부터.
  it("applies a change between the two max levels to the current game at once; other level changes wait for a new game", () => {
    const g = game({ level: "max" });
    expect(withLevel(g, "max20")).toEqual({ ...g, level: "max20" });
    expect(withLevel(game({ level: "max20" }), "max").level).toBe("max");
    expect(pendingOf(seatsOf(g), "max20", withLevel(g, "max20")).level).toBe(false);
    for (const [from, to] of [[3, "max20"], ["max20", 4], ["max", 2]]) {
      const before = game({ level: from });
      expect(withLevel(before, to)).toBe(before);
      expect(pendingOf(seatsOf(before), to, withLevel(before, to)).level).toBe(true);
    }
    const over = game({ level: "max", over: "초 승" });           // 끝난 판의 기보는 바꾸지 않는다(두는 이와 같은 규칙)
    expect(withLevel(over, "max20")).toBe(over);
  });
  it("applies a seat's who-plays to the nation sitting there in the current game, even with a nation change pending", () => {
    expect(whoApplied(game(), "top", "human")).toEqual({ c: "human", h: "human" });
    expect(whoApplied(game({ bottom: "h" }), "top", "engine")).toEqual({ c: "engine", h: "engine" });
    expect(whoApplied(game({ bottom: "h", controllers: { c: "engine", h: "human" } }), "bottom", "engine")).toEqual({ c: "engine", h: "engine" });
  });
});

describe("who-plays on a finished game (review MED)", () => {
  it("only prepares the next game: a finished game's controllers (and so its record and result wording) stay", async () => {
    const { withWho } = await import("../src/seats.js");
    const live = { ...game(), over: null };
    expect(withWho(live, "top", "human").controllers).toEqual({ c: "human", h: "human" });
    const finished = { ...game(), over: "h", result: { winner: "h", reason: "외통수" } };
    expect(withWho(finished, "bottom", "engine")).toBe(finished);
  });
});
