import { describe, it, expect } from "vitest";
import { play } from "../src/game.js";

import * as storage from "../src/storage.js";
const ID = "2026-09-28T14-03-12-345", DATE = "2026-09-28T14:03:12.345Z";
const FAILURE = "기보 저장 실패 — 내보내기로 백업하세요";
const record = (extra = {}) => ({ v: 1, id: ID, createdAt: DATE, setups: { c: "마상마상", h: "마상마상" },
  controllers: { c: "human", h: "engine" }, level: 3, bottom: "c", moves: [], result: null, ...extra });
class FakeStorage {
  values = new Map();
  failRead = false;
  failWrite = false;
  failKey = null;
  get length() { return this.values.size; }
  key(i) { return [...this.values.keys()][i] ?? null; }
  getItem(key) { if (this.failRead) throw new Error("private mode"); return this.values.get(key) ?? null; }
  setItem(key, value) { if (this.failWrite || this.failKey === key) throw new Error("quota"); this.values.set(key, String(value)); }
}
const storeFor = (fake) => storage.createStore({ storage: fake, now: () => new Date(DATE) });

describe("storage", () => {
  it("saves each game under its own key and restores the latest played state", () => {
    const fake = new FakeStorage(), store = storeFor(fake);
    const first = store.loadLatest().state;
    expect(first).toMatchObject({ id: ID, createdAt: DATE, moves: [] });
    const played = play(play(first, [54, 45]), [27, 36]);
    expect(store.save(played)).toEqual({ ok: true, error: null });
    expect(JSON.parse(fake.getItem(`janggi.game.${ID}`))).toEqual(record({ moves: ["a4a5", "a7a6"], repetition: true })); // 새 판은 반복수 규칙을 가진다
    expect(JSON.parse(fake.getItem("janggi.index"))).toEqual([{ id: ID, createdAt: DATE }]);
    expect(storeFor(fake).loadLatest()).toMatchObject({ state: played, error: null, corrupted: null });
    const second = store.newGame({ controllers: { c: "human", h: "human" } });
    expect(second.id).toBe(`${ID}-1`);
    store.save(second);
    expect(storeFor(fake).loadLatest().state.id).toBe(`${ID}-1`);
    expect(fake.getItem(`janggi.game.${ID}`)).not.toBeNull();
  });

  it("saves analysis-only changes as part of the record", () => {
    const fake = new FakeStorage(), store = storeFor(fake), state = store.newGame();
    store.save(state);
    store.save({ ...state, analysis: { engine: "test", evals: [{ ply: 0, cp: 12, win: 51.1, depth: 17 }] } });
    expect(storeFor(fake).loadLatest().state.analysis).toEqual({ engine: "test", evals: [{ ply: 0, cp: 12, win: 51.1, depth: 17 }] });
  });

  it.each([false, true])("surfaces write failure without preventing play (index-only=%s)", (indexOnly) => {
    const fake = new FakeStorage(), store = storeFor(fake), state = store.newGame();
    fake.failWrite = !indexOnly; fake.failKey = indexOnly ? "janggi.index" : null;
    const played = play(state, [54, 45]);
    expect(store.save(played)).toEqual({ ok: false, error: FAILURE });
    expect(play(played, [27, 36]).moves).toEqual(["a4a5", "a7a6"]);
    fake.failWrite = false; fake.failKey = null;
    expect(store.save(played)).toEqual({ ok: true, error: null });
    expect(storeFor(fake).loadLatest().state.moves).toEqual(["a4a5"]);
  });

  it("handles both a throwing localStorage getter and getItem failure", () => {
    const fake = new FakeStorage(); fake.failRead = true;
    for (const backend of [fake, () => { throw new Error("blocked"); }]) {
      const store = storeFor(backend), loaded = store.loadLatest();
      expect(loaded.state.moves).toEqual([]);
      expect(loaded.error).toBe(FAILURE);
      expect(store.save(play(loaded.state, [54, 45]))).toEqual({ ok: false, error: FAILURE });
    }
  });

  it.each([JSON.stringify(record({ moves: ["a4a5", "a7a5"] })), "{broken JSON"])("marks corrupted records without deleting them and starts fresh", (raw) => {
    const fake = new FakeStorage();
    fake.setItem(`janggi.game.${ID}`, raw);
    fake.setItem("janggi.index", JSON.stringify([{ id: ID, createdAt: DATE }]));
    const loaded = storeFor(fake).loadLatest();
    expect(loaded).toMatchObject({ state: { id: `${ID}-1`, moves: [] }, corrupted: { id: ID, status: "손상됨" } });
    expect(fake.getItem(`janggi.game.${ID}`)).toBe(raw);
    expect(JSON.parse(fake.getItem("janggi.index"))[0]).toMatchObject({ id: ID, status: "손상됨" });
  });

  it("keeps corruption information visible when marking the index also fails", () => {
    const fake = new FakeStorage();
    fake.setItem(`janggi.game.${ID}`, JSON.stringify(record({ moves: ["bad"] })));
    fake.setItem("janggi.index", JSON.stringify([{ id: ID, createdAt: DATE }]));
    fake.failWrite = true;
    expect(storeFor(fake).loadLatest()).toMatchObject({ state: { moves: [] }, error: FAILURE, corrupted: { id: ID, status: "손상됨" } });
  });

  it("does not overwrite an unindexed record or a game allocated in the same millisecond", () => {
    const fake = new FakeStorage(); fake.setItem(`janggi.game.${ID}`, JSON.stringify(record()));
    const store = storeFor(fake);
    expect(store.newGame().id).toBe(`${ID}-1`);
    expect(store.newGame().id).toBe(`${ID}-2`);
  });
});

describe("pure export/import helpers", () => {
  it("exports one or all records to JSON without changing the input", () => {
    const records = [record(), record({ id: `${ID}-1`, moves: ["a4a5"] })];
    expect(JSON.parse(storage.exportRecords(records, `${ID}-1`))).toEqual(record({ id: `${ID}-1`, moves: ["a4a5"] }));
    expect(JSON.parse(storage.exportRecords(records))).toEqual(records);
    expect(() => storage.exportRecords(records, "missing")).toThrow("기보를 찾을 수 없어요.");
    expect(records).toHaveLength(2);
  });

  it("validates imported moves and IDs, allocating fresh IDs on all collisions", () => {
    const imported = storage.importRecords(JSON.stringify([record(), record()]), [ID, `${ID}-1`]);
    expect(imported.map((r) => r.id)).toEqual([`${ID}-2`, `${ID}-3`]);
    expect(storage.importRecords(JSON.stringify(record({ moves: ["a4a5"] })))).toEqual([record({ moves: ["a4a5"] })]);
    expect(() => storage.importRecords(JSON.stringify(record({ id: "../bad" })))).toThrow("id");
    expect(() => storage.importRecords(JSON.stringify(record({ moves: ["a4a6"] })))).toThrow("1수째");
    expect(() => storage.importRecords("{bad")).toThrow("JSON");
  });
});

describe("storage for review (M3)", () => {
  const ID2 = "2026-09-28T15-00-00-000";
  function twoGames() {
    const fake = new FakeStorage(), store = storeFor(fake);
    const old = { ...play(play(store.loadLatest().state, [54, 45]), [27, 36]), result: null };
    store.save(old);
    const live = { ...storage.createStore({ storage: fake, now: () => new Date("2026-09-28T15:00:00.000Z") }).newGame() };
    store.save(live);
    return { fake, store, old, live };
  }
  it("lists games newest-saved first with a summary read from each record", () => {
    const { store } = twoGames();
    expect(store.list()).toEqual([
      { id: ID2, createdAt: "2026-09-28T15:00:00.000Z", controllers: { c: "human", h: "engine" }, level: 3, moves: 0, result: null, corrupted: false },
      { id: ID, createdAt: DATE, controllers: { c: "human", h: "engine" }, level: 3, moves: 2, result: null, corrupted: false },
    ]);
  });
  it("marks an unreadable record in the list instead of throwing", () => {
    const { fake, store } = twoGames();
    fake.setItem(`janggi.game.${ID}`, "{not json");
    expect(store.list()[1]).toMatchObject({ id: ID, corrupted: true });
  });
  it("loads one record by id and rejects ids that are not record ids", () => {
    const { store } = twoGames();
    expect(store.load(ID)).toMatchObject({ id: ID, moves: ["a4a5", "a7a6"] });
    expect(() => store.load("../../etc")).toThrow();
    expect(() => store.load("2026-01-01T00-00-00-000")).toThrow();
  });
  it("saving a reviewed game's analysis does not make it the latest game", () => {
    const { fake, store, old } = twoGames();
    const analysed = { ...old, analysis: { engine: "e", evals: [{ ply: 0, cp: 0, win: 50, depth: 10 }, null, null] } };
    expect(store.save(analysed, { touch: false })).toEqual({ ok: true, error: null });
    expect(JSON.parse(fake.getItem("janggi.index")).map((e) => e.id)).toEqual([ID2, ID]);
    expect(storeFor(fake).loadLatest().state.id).toBe(ID2);
    expect(store.load(ID).analysis.evals[0]).toEqual({ ply: 0, cp: 0, win: 50, depth: 10 });
  });
  it("lists a record with invalid fields as corrupted instead of handing bad data to the UI (review LOW)", () => {
    const { fake, store } = twoGames();
    fake.setItem(`janggi.game.${ID}`, JSON.stringify({ ...JSON.parse(fake.getItem(`janggi.game.${ID}`)), controllers: null }));
    expect(store.list()[1]).toMatchObject({ id: ID, corrupted: true });
  });
  it("adds imported records after the live game and exports every readable record", () => {
    const { fake, store } = twoGames();
    const imported = { ...record({ id: "2026-01-01T00-00-00-000", moves: ["a4a5"] }) };
    store.put(imported);
    expect(JSON.parse(fake.getItem("janggi.index")).map((e) => e.id)).toEqual([ID2, "2026-01-01T00-00-00-000", ID]);
    expect(store.records().map((r) => r.id)).toEqual([ID2, "2026-01-01T00-00-00-000", ID]);
  });
});

describe("import limits (review LOW)", () => {
  it("rejects records with more than 5000 moves before replaying them", () => {
    const huge = JSON.stringify(record({ moves: Array(5001).fill("pass") }));
    expect(() => storage.importRecords(huge, [])).toThrow("수순이 너무 길어요");
  });
});
