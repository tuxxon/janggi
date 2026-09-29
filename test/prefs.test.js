import { describe, expect, it } from "vitest";
import * as prefs from "../src/prefs.js";

const fake = (data = {}) => {
  const values = new Map(Object.entries(data));
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
};

describe("view preferences (user request 2026-09-29: remember the analysis mode)", () => {
  it("defaults to continuous analysis", () => {
    expect(prefs.loadPrefs(fake())).toEqual({ analysis: "continuous" });
  });
  it("restores a saved mode under janggi.prefs", () => {
    expect(prefs.loadPrefs(fake({ "janggi.prefs": '{"analysis":"fast"}' }))).toEqual({ analysis: "fast" });
    expect(prefs.loadPrefs(fake({ "janggi.prefs": '{"analysis":"deep"}' }))).toEqual({ analysis: "deep" });
  });
  it("falls back to the default for an unknown mode or a corrupt value", () => {
    expect(prefs.loadPrefs(fake({ "janggi.prefs": '{"analysis":"slow"}' }))).toEqual({ analysis: "continuous" });
    expect(prefs.loadPrefs(fake({ "janggi.prefs": "{oops" }))).toEqual({ analysis: "continuous" });
    expect(prefs.loadPrefs(fake({ "janggi.prefs": "null" }))).toEqual({ analysis: "continuous" });
  });
  it("saves as JSON under janggi.prefs and survives a blocked storage", () => {
    const store = fake();
    prefs.savePrefs({ analysis: "deep" }, store);
    expect(store.values.get("janggi.prefs")).toBe('{"analysis":"deep"}');
    const blocked = { getItem() { throw new Error("private mode"); }, setItem() { throw new Error("quota"); } };
    expect(prefs.loadPrefs(blocked)).toEqual({ analysis: "continuous" });
    expect(() => prefs.savePrefs({ analysis: "fast" }, blocked)).not.toThrow();
  });
  it("reads the global localStorage lazily (a throwing getter is a blocked storage)", () => {
    expect(prefs.loadPrefs(() => { throw new Error("SecurityError"); })).toEqual({ analysis: "continuous" });
  });
});
