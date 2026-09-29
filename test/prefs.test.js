import { describe, expect, it } from "vitest";
import * as prefs from "../src/prefs.js";

const fake = (data = {}) => {
  const values = new Map(Object.entries(data));
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
};

describe("view preferences (user request 2026-09-29: remember the analysis mode)", () => {
  it("defaults to continuous analysis", () => {
    expect(prefs.loadPrefs(fake())).toEqual({ analysis: "continuous", reviewDeep: 20000 });
  });
  it("restores a saved mode under janggi.prefs", () => {
    expect(prefs.loadPrefs(fake({ "janggi.prefs": '{"analysis":"fast"}' }))).toEqual({ analysis: "fast", reviewDeep: 20000 });
    expect(prefs.loadPrefs(fake({ "janggi.prefs": '{"analysis":"deep"}' }))).toEqual({ analysis: "deep", reviewDeep: 20000 });
  });
  it("falls back to the default for an unknown mode or a corrupt value", () => {
    expect(prefs.loadPrefs(fake({ "janggi.prefs": '{"analysis":"slow"}' }))).toEqual({ analysis: "continuous", reviewDeep: 20000 });
    expect(prefs.loadPrefs(fake({ "janggi.prefs": "{oops" }))).toEqual({ analysis: "continuous", reviewDeep: 20000 });
    expect(prefs.loadPrefs(fake({ "janggi.prefs": "null" }))).toEqual({ analysis: "continuous", reviewDeep: 20000 });
  });
  it("saves as JSON under janggi.prefs and survives a blocked storage", () => {
    const store = fake();
    prefs.savePrefs({ analysis: "deep" }, store);
    expect(store.values.get("janggi.prefs")).toBe('{"analysis":"deep"}');
    const blocked = { getItem() { throw new Error("private mode"); }, setItem() { throw new Error("quota"); } };
    expect(prefs.loadPrefs(blocked)).toEqual({ analysis: "continuous", reviewDeep: 20000 });
    expect(() => prefs.savePrefs({ analysis: "fast" }, blocked)).not.toThrow();
  });
  it("reads the global localStorage lazily (a throwing getter is a blocked storage)", () => {
    expect(prefs.loadPrefs(() => { throw new Error("SecurityError"); })).toEqual({ analysis: "continuous", reviewDeep: 20000 });
  });
});

describe("review deep-look cap preference (spec 2.10: saved-game review only)", () => {
  it("restores each cap: 20 s, 1 min, 5 min and unlimited", () => {
    for (const [saved, reviewDeep] of [["20000", 20000], ["60000", 60000], ["300000", 300000], ['"infinite"', "infinite"]]) {
      expect(prefs.loadPrefs(fake({ "janggi.prefs": `{"analysis":"fast","reviewDeep":${saved}}` }))).toEqual({ analysis: "fast", reviewDeep });
    }
  });
  it("falls back to 20 s for an unknown cap, keeping the mode", () => {
    for (const saved of ["1000", '"60000"', "null", '"forever"', "true"]) {
      expect(prefs.loadPrefs(fake({ "janggi.prefs": `{"analysis":"deep","reviewDeep":${saved}}` }))).toEqual({ analysis: "deep", reviewDeep: 20000 });
    }
  });
  it("keeps a good cap when the mode is unknown", () => {
    expect(prefs.loadPrefs(fake({ "janggi.prefs": '{"analysis":"slow","reviewDeep":"infinite"}' }))).toEqual({ analysis: "continuous", reviewDeep: "infinite" });
  });
  it("saves the cap with the mode", () => {
    const store = fake();
    prefs.savePrefs({ analysis: "continuous", reviewDeep: "infinite" }, store);
    expect(store.values.get("janggi.prefs")).toBe('{"analysis":"continuous","reviewDeep":"infinite"}');
    expect(prefs.loadPrefs(store)).toEqual({ analysis: "continuous", reviewDeep: "infinite" });
  });
  it("offers the four caps in order and maps them to the service caps (unlimited = Infinity)", () => {
    expect(prefs.REVIEW_DEEP).toEqual([20000, 60000, 300000, "infinite"]);
    expect(prefs.REVIEW_DEEP.map(prefs.capOf)).toEqual([20000, 60000, 300000, Infinity]);
  });
});
