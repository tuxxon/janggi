import { describe, it, expect, vi, afterEach } from "vitest";
import * as engine from "../src/engine.js";
import { newGame, play, undo } from "../src/game.js";

import * as records from "../src/record.js";
const meta = { id: "2026-09-28T14-03-12-345", createdAt: "2026-09-28T14:03:12.345Z" };
const options = { controllers: { c: "human", h: "engine" }, level: 3, setups: { c: "마상상마", h: "마상상마" } };
const initial = () => ({ ...newGame(options), ...meta });
const record = (extra = {}) => ({ v: 1, ...meta, ...options, moves: [], result: null, ...extra });
afterEach(() => vi.restoreAllMocks());

describe("record v1", () => {
  it("roundtrips max difficulty without coercing it to a numeric level", () => {
    const saved = record({ level: "max" });
    // 방향이 없는 옛 기록은 예전 규칙(초 사람·한 엔진 → 초가 아래)으로 방향을 얻는다.
    expect(records.toRecord(records.replay(saved).state)).toEqual({ ...saved, bottom: "c" });
    expect(() => records.replay(record({ level: "5" }))).toThrow("난이도");
  });
  it("serializes only canonical v1 fields, leaving metadata creation to storage", () => {
    const state = play(initial(), [54, 45]);
    expect(records.toRecord(state)).toEqual({ v: 1, ...meta, controllers: { c: "human", h: "engine" }, level: 3,
      setups: { c: "마상상마", h: "마상상마" }, bottom: "c", repetition: true, moves: ["a4a5"], result: null });
    const saved = records.toRecord(state);
    saved.moves.push("pass"); saved.controllers.c = "engine";
    expect(state.moves).toEqual(["a4a5"]);
    expect(state.controllers.c).toBe("human");
  });

  it("replays a real played sequence including capture and pass with equal final state", () => {
    let state = initial();
    for (const move of [[54, 45], [27, 36], [45, 36], "pass"]) state = play(state, move);
    const saved = records.toRecord(state);
    expect(saved.moves).toEqual(["a4a5", "a7a6", "a5a6", "pass"]);
    const { positions, state: restored } = records.replay(JSON.parse(JSON.stringify(saved)));
    expect(restored).toEqual(state);
    expect(positions).toHaveLength(5);
    expect(positions.map(({ turn, last, caps }) => ({ turn, last, caps }))).toEqual([
      { turn: "c", last: null, caps: { c: [], h: [] } },
      { turn: "h", last: [54, 45], caps: { c: [], h: [] } },
      { turn: "c", last: [27, 36], caps: { c: [], h: [] } },
      { turn: "h", last: [45, 36], caps: { c: ["hP"], h: [] } },
      { turn: "c", last: null, caps: { c: ["hP"], h: [] } },
    ]);
    expect(positions[0].b[54]).toBe("cP");
    expect(positions[4].b[36]).toBe("cP");
    expect(positions[4].b[45]).toBeNull();
    expect(undo(restored).moves).toEqual(["a4a5", "a7a6"]);
  });

  it("reproduces automatic passes from the same constructed board without an extra recorded ply", () => {
    // v1은 초기 FEN을 받지 않는다. 이 테스트만 시작 배치를 교체하고 나머지 규칙/전이는 실제 모듈을 쓴다.
    const b = Array(90).fill(null);
    b[4] = "hK"; b[11] = "cR"; b[14] = "cR"; b[76] = "cK";
    vi.spyOn(engine, "newBoard").mockImplementation(() => b.slice());
    const { positions, state } = records.replay(record({ moves: ["c9d9", "e2e1"] }));
    expect(positions).toHaveLength(3);
    expect(positions.map(({ turn, last }) => ({ turn, last }))).toEqual([
      { turn: "c", last: null }, { turn: "c", last: null }, { turn: "c", last: null },
    ]);
    expect(positions[1].b[12]).toBe("cR");
    expect(positions[2].b[85]).toBe("cK");
    expect(state.moves).toEqual(["c9d9", "e2e1"]);
    expect(state.msg).toBe("한(빨강) 쪽이 둘 수 없어 한 수 쉽니다.");
  });

  it("detects corruption at its one-based ply with a Korean reason", () => {
    let error;
    try { records.replay(record({ moves: ["a4a5", "a7a5"] })); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(Error);
    expect(error.ply).toBe(2);
    expect(error.message).toBe("기보 2수째 손상됨: 둘 수 없는 수예요.");
    expect(() => records.replay(record({ moves: ["a4a5", "garbage"] }))).toThrow("2수째");
    expect(() => records.replay(record({ moves: ["e2e2"] }))).toThrow("1수째");
  });

  it("validates IDs using the spec regex and rejects invalid record metadata", () => {
    expect(records.validId("2026-09-28T14-03-12-345")).toBe(true);
    expect(records.validId("2026-09-28T14-03-12-345-2")).toBe(true);
    for (const id of ["", "../bad", "2026-09-28T14:03:12.345Z", "x", null, 123]) {
      expect(records.validId(id)).toBe(false);
      expect(() => records.replay(record({ id }))).toThrow("id");
    }
    for (const extra of [{ v: 2 }, { createdAt: "bad" }, { setups: { c: "bad", h: "마상상마" } },
      { controllers: { c: "agent", h: "human" } }, { level: 0 }, { moves: "pass" }, { result: "c" }]) {
      expect(() => records.replay(record(extra))).toThrow();
    }
    expect(() => records.replay(record({ result: { winner: "h", reason: "외통수" } }))).toThrow("결과");
  });

  it("treats analysis as disposable and preserves a valid cache without sharing it", () => {
    for (const analysis of [undefined, null, "broken", { engine: "x", evals: ["bad"] }]) {
      const restored = records.replay(record({ analysis })).state;
      expect(restored.moves).toEqual([]);
      expect(restored.analysis).toBeUndefined();
    }
    const analysis = { engine: "test engine", evals: [{ ply: 0, cp: 12, win: 51.1, depth: 17 }, null] };
    const saved = record({ analysis });
    const restored = records.replay(saved).state;
    expect(restored.analysis).toEqual(analysis);
    records.toRecord(restored).analysis.evals[0].cp = 99;
    expect(restored.analysis.evals[0].cp).toBe(12);
    expect(saved.analysis.evals[0].cp).toBe(12);
  });
});

describe("import validation (review LOW)", () => {
  const rec = { v: 1, id: "2026-09-28T14-03-12-345", createdAt: "2026-09-28T14:03:12.345Z",
    setups: { c: "마상마상", h: "마상마상" }, controllers: { c: "human", h: "engine" }, level: 3, moves: [], result: null };
  it("rejects non-string setups (an array coerces to a valid key)", () => {
    expect(() => records.replay({ ...rec, setups: { c: ["마상마상"], h: "마상마상" } })).toThrow("상차림");
  });
  it("drops unknown controller and setup keys", () => {
    const { state } = records.replay({ ...rec, controllers: { c: "human", h: "engine", x: "human" }, setups: { c: "마상마상", h: "마상마상", z: 1 } });
    expect(state.controllers).toEqual({ c: "human", h: "engine" });
    expect(state.setups).toEqual({ c: "마상마상", h: "마상마상" });
  });
});

describe("board orientation in records (user request 2026-09-28)", () => {
  const rec = { v: 1, id: "2026-09-28T14-03-12-345", createdAt: "2026-09-28T14:03:12.345Z",
    setups: { c: "마상마상", h: "마상마상" }, controllers: { c: "engine", h: "human" }, level: 3, moves: ["a4a5"], result: null };
  it("round-trips the bottom nation", () => {
    const { state } = records.replay({ ...rec, bottom: "h" });
    expect(state.bottom).toBe("h");
    expect(records.toRecord(state).bottom).toBe("h");
  });
  it("gives old records (no bottom) the orientation of the old rule", () => {
    expect(records.replay(rec).state.bottom).toBe("h");
    expect(records.replay({ ...rec, controllers: { c: "human", h: "engine" } }).state.bottom).toBe("c");
  });
  it("rejects an unknown bottom value", () => {
    expect(() => records.replay({ ...rec, bottom: "x" })).toThrow("판 방향");
  });
});

describe("repetition rule in records (user request: Kakao Janggi)", () => {
  const rec = { v: 1, id: "2026-09-28T14-03-12-345", createdAt: "2026-09-28T14:03:12.345Z", bottom: "c",
    setups: { c: "마상마상", h: "마상마상" }, controllers: { c: "human", h: "human" }, level: 3, result: null,
    moves: ["a1a2", "i10i9", "a2a1", "i9i10", "a1a2", "i10i9", "a2a1", "i9i10", "a1a2"] };
  it("replays an old record (no rule flag) with a third repetition unchanged", () => {
    const { state } = records.replay(rec);
    expect(state.repetition).toBe(false);
    expect(records.toRecord(state)).not.toHaveProperty("repetition");
  });
  it("rejects that third repetition when the record carries the rule, and round-trips the flag", () => {
    expect(() => records.replay({ ...rec, repetition: true })).toThrow("9수째");
    const { state } = records.replay({ ...rec, repetition: true, moves: rec.moves.slice(0, 8) });
    expect(records.toRecord(state).repetition).toBe(true);
    expect(() => records.replay({ ...rec, repetition: "yes" })).toThrow("반복수");
  });
});
