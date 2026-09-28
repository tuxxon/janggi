import { describe, it, expect } from "vitest";

import * as game from "../src/game.js";
const options = { controllers: { c: "human", h: "engine" }, level: 2, setups: { c: "마상상마", h: "마상상마" } };

function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

function position(pieces, turn = "c", controllers = options.controllers) {
  const b = Array(90).fill(null);
  for (const [i, p] of Object.entries(pieces)) b[Number(i)] = p;
  return { ...game.newGame({ ...options, controllers }), b, turn };
}

describe("game", () => {
  it("creates an immutable initial state with per-side controllers", () => {
    const input = structuredClone(options), state = game.newGame(freeze(input));
    expect(state).toMatchObject({ turn: "c", controllers: { c: "human", h: "engine" }, level: 2,
      setups: { c: "마상상마", h: "마상상마" }, moves: [], hist: [], last: null, caps: { c: [], h: [] }, over: null, result: null, msg: "" });
    expect(state.b).toHaveLength(90);
    expect(state.b[76]).toBe("cK");
    expect(state.b[13]).toBe("hK");
    expect(state.controllers).not.toBe(input.controllers);
    expect(state.setups).not.toBe(input.setups);
  });
});

describe("moves and transitions", () => {
  it("rejects illegal moves with a Korean reason", () => {
    const state = freeze(game.newGame(options));
    for (const move of [[54, 36], [27, 36], [40, 41], [-1, 90], [54, 54], [54], null]) {
      expect(() => game.play(state, move)).toThrow("둘 수 없는 수예요.");
    }
    expect(state.moves).toEqual([]);
    expect(state.b[54]).toBe("cP");
  });

  it("lists legal board moves without mutating even a frozen input", () => {
    const state = freeze(game.newGame(options));
    expect(game.legalMoves(state)).toHaveLength(31);
    expect(game.legalMoves(state)).toContainEqual([54, 45]);
    expect(game.legalMoves(state)).not.toContainEqual([54, 36]);
  });

  it("records real moves, captures and explicit passes without changing input", () => {
    const state = freeze(game.newGame(options));
    const first = game.play(state, [54, 45]);
    expect(first).toMatchObject({ turn: "h", last: [54, 45], moves: ["a4a5"] });
    const captured = game.play(freeze(game.play(freeze(first), [27, 36])), [45, 36]);
    expect(captured).toMatchObject({ turn: "h", last: [45, 36], moves: ["a4a5", "a7a6", "a5a6"], caps: { c: ["hP"], h: [] } });
    expect(captured.b[36]).toBe("cP");
    const passed = game.play(freeze(captured), "pass");
    expect(passed).toMatchObject({ turn: "c", last: null, msg: "한 수 쉬었어요.", moves: ["a4a5", "a7a6", "a5a6", "pass"] });
    expect(state.b[54]).toBe("cP");
    expect(state.caps).toEqual({ c: [], h: [] });
  });

  it("rejects passing while in check", () => {
    const state = freeze(position({ 13: "hK", 67: "hR", 76: "cK" }));
    expect(() => game.play(state, "pass")).toThrow("장군일 때는 쉴 수 없어요.");
  });

  it.each([
    [{ c: "human", h: "engine" }, "외통수! 이겼어요."],
    [{ c: "engine", h: "human" }, "외통수예요. 엔진이 이겼어요."],
    [{ c: "human", h: "human" }, "외통수! 초(파랑) 승리"],
    [{ c: "engine", h: "engine" }, "외통수! 초(파랑) 승리"],
  ])("detects checkmate and result with controllers %j", (controllers, msg) => {
    // e10 궁: d9/f9 차가 d10/f10/e9를 막고 a10 차가 장군을 부른다.
    const state = freeze(position({ 4: "hK", 12: "cR", 14: "cR", 27: "cR", 76: "cK" }, "c", controllers));
    const next = game.play(state, [27, 0]);
    expect(next).toMatchObject({ over: "c", result: { winner: "c", reason: "외통수" }, turn: "h", msg, moves: ["a7a10"] });
    expect(game.legalMoves(next)).toEqual([]);
    expect(() => game.play(next, "pass")).toThrow("이미 끝난 대국이에요.");
  });

  it.each([
    [{ c: "human", h: "engine" }, "장군!"],
    [{ c: "engine", h: "human" }, "장군이에요! 궁을 지키세요."],
    [{ c: "human", h: "human" }, "장군! 한(빨강) 궁을 지키세요."],
  ])("keeps check message tone with controllers %j", (controllers, msg) => {
    const next = game.play(position({ 4: "hK", 27: "cR", 76: "cK" }, "c", controllers), [27, 0]);
    expect(next).toMatchObject({ over: null, result: null, turn: "h", msg });
  });

  it("automatically passes a side with no legal move and no check, without recording a pass", () => {
    // e10 궁은 장군이 아니다. d9/f9 차가 유일한 출구 d10/f10/e9를 모두 공격한다.
    const state = freeze(position({ 4: "hK", 11: "cR", 14: "cR", 76: "cK" }));
    const next = game.play(state, [11, 12]);
    expect(next).toMatchObject({ turn: "c", last: null, over: null, result: null,
      msg: "한(빨강) 쪽이 둘 수 없어 한 수 쉽니다.", moves: ["c9d9"], caps: { c: [], h: [] } });
    expect(next.hist).toHaveLength(1);
    expect(next.b[11]).toBeNull();
    expect(next.b[12]).toBe("cR");
  });
});

describe("undo", () => {
  it.each([
    [{ c: "human", h: "engine" }, [], "c"],
    [{ c: "engine", h: "human" }, ["a4a5"], "h"],
    [{ c: "human", h: "human" }, ["a4a5"], "h"],
  ])("rolls back to a human turn with controllers %j", (controllers, moves, turn) => {
    let state = game.newGame({ ...options, controllers });
    state = game.play(game.play(state, [54, 45]), [27, 36]);
    freeze(state);
    expect(game.canUndo(state)).toBe(true);
    const next = game.undo(state);
    expect(next).toMatchObject({ moves, turn, msg: "무르기 했어요.", over: null, result: null, caps: { c: [], h: [] } });
    expect(next.hist).toHaveLength(moves.length);
    expect(next.b[27]).toBe("hP");
    expect(next.b[36]).toBeNull();
    expect(state.moves).toEqual(["a4a5", "a7a6"]);
  });

  it("can undo a human move while an engine reply is pending", () => {
    const state = game.play(game.newGame(options), [54, 45]);
    expect(game.canUndo(state)).toBe(true);
    expect(game.undo(state).moves).toEqual([]);
  });

  it("is unavailable with no past human turn, including engine-vs-engine", () => {
    expect(game.canUndo(game.newGame(options))).toBe(false);
    for (const controllers of [{ c: "engine", h: "engine" }, { c: "engine", h: "human" }]) {
      const state = game.play(game.newGame({ ...options, controllers }), [54, 45]);
      expect(game.canUndo(state)).toBe(false);
      expect(() => game.undo(state)).toThrow("무를 수 있는 사람 차례가 없어요.");
    }
  });

  it("undoes captures, passes and game-over results", () => {
    let state = game.newGame(options);
    for (const move of [[54, 45], [27, 36], [45, 36], "pass"]) state = game.play(state, move);
    const next = game.undo(freeze(state));
    expect(next).toMatchObject({ moves: ["a4a5", "a7a6"], caps: { c: [], h: [] }, last: [27, 36] });
    expect(next.b[36]).toBe("hP");
    const mate = game.play(position({ 4: "hK", 12: "cR", 14: "cR", 27: "cR", 76: "cK" }), [27, 0]);
    expect(game.undo(freeze(mate))).toMatchObject({ over: null, result: null, moves: [], turn: "c" });
  });
});

describe("switching controllers mid-game (user request 2026-09-28)", () => {
  it("replaces only the controllers; board, turn and moves stay", () => {
    const start = game.play(game.newGame(options), [54, 45]); // 초 a4a5 → 한 차례
    const switched = game.setControllers(start, { c: "human", h: "human", x: "engine" });
    expect(switched.controllers).toEqual({ c: "human", h: "human" });
    expect(switched.moves).toEqual(["a4a5"]);
    expect(switched.turn).toBe("h");
    expect(switched.b).toEqual(start.b);
    expect(start.controllers).toEqual({ c: "human", h: "engine" }); // 입력은 바꾸지 않는다
  });
  it("undo keeps the controllers chosen now, not the ones stored in history", () => {
    let s = game.play(game.play(game.newGame(options), [54, 45]), [27, 36]); // 초 a4a5, 한 a7a6 (한=엔진이 둠)
    s = game.setControllers(s, { c: "human", h: "human" });
    const back = game.undo(s); // 사람끼리: 한 수만 되돌린다
    expect(back.moves).toEqual(["a4a5"]);
    expect(back.controllers).toEqual({ c: "human", h: "human" });
  });
  it("can undo only through turns that are human under the current controllers", () => {
    const s = game.play(game.newGame(options), [54, 45]);
    expect(game.canUndo(game.setControllers(s, { c: "engine", h: "engine" }))).toBe(false);
    expect(game.canUndo(game.setControllers(s, { c: "human", h: "engine" }))).toBe(true);
  });
});

describe("board orientation is part of the game (user request 2026-09-28)", () => {
  it("defaults to 초 at the bottom and keeps an explicit bottom nation", () => {
    expect(game.newGame(options).bottom).toBe("c");
    expect(game.newGame({ ...options, bottom: "h" }).bottom).toBe("h");
    expect(game.newGame({ ...options, bottom: "h" }).turn).toBe("c"); // 선수는 항상 초
  });
});
