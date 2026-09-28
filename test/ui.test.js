import { afterEach, describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Janggi from "../src/Janggi.jsx";

const id = "2026-09-28T14-03-12-345";
const record = { v: 1, id, createdAt: "2026-09-28T14:03:12.345Z", controllers: { c: "human", h: "human" },
  setups: { c: "마상상마", h: "상마마상" }, level: 2, moves: ["a4a5"], result: null };
const render = () => renderToStaticMarkup(createElement(Janggi));
const fake = (data = {}) => {
  const values = new Map(Object.entries(data));
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
afterEach(() => vi.unstubAllGlobals());

describe("M1 UI rendering", () => {
  it("renders per-seat nation, who-plays and setup selects (user request 2026-09-28)", () => {
    vi.stubGlobal("localStorage", fake());
    const html = render();
    expect(html).toMatch(/aria-label="위 나라"[^>]*><option value="c">[^<]*<\/option><option value="h" selected="">/);
    expect(html).toMatch(/aria-label="아래 나라"[^>]*><option value="c" selected="">/);
    expect(html).toMatch(/aria-label="위 두는 이"[^>]*><option value="human">사람<\/option><option value="engine" selected="">엔진/);
    expect(html).toMatch(/aria-label="아래 두는 이"[^>]*><option value="human" selected="">사람/);
    expect(html).toContain('aria-label="위 상차림"');
    expect(html).toContain('aria-label="아래 상차림"');
    expect(html).not.toContain("AI가 둘 편");
  });

  it("restores the latest position, controllers and settings on initial render", () => {
    vi.stubGlobal("localStorage", fake({ "janggi.index": JSON.stringify([{ id, createdAt: record.createdAt }]), [`janggi.game.${id}`]: JSON.stringify(record) }));
    const html = render();
    expect(html).toContain("한(빨강) 차례예요.");
    expect(html).toContain('value="2" selected=""');
    expect(html).toContain('selected="">상마마상');
    // a4→a5 직전 수 강조: x=40, 시작 y=400, 도착 y=340.
    expect(html).toContain('cx="40" cy="340" r="29"');
    expect(html).toContain('cx="40" cy="400" r="29"');
  });

  it("shows an explicit failure state even when the storage getter throws", () => {
    vi.stubGlobal("localStorage", { getItem() { throw new Error("blocked"); } });
    const html = render();
    expect(html).toContain("기보 저장 실패 — 내보내기로 백업하세요");
    expect(html).toContain("내 차례예요 · 초(파랑)");
  });

  it("shows engine status and disables undo with two engine controllers", () => {
    const engineRecord = { ...record, controllers: { c: "engine", h: "engine" }, moves: [] };
    vi.stubGlobal("localStorage", fake({ "janggi.index": JSON.stringify([{ id }]), [`janggi.game.${id}`]: JSON.stringify(engineRecord) }));
    const html = render();
    expect(html).toContain("엔진이 생각하는 중…");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>무르기<\/button>/);
  });
});

describe("M2 UI rendering", () => {
  it("offers max, hints off by default, a local NNUE picker and the estimate explanation", () => {
    vi.stubGlobal("localStorage", fake());
    const html = render();
    expect(html).toContain('value="max"');
    expect(html).toContain("최강");
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*\/>후보 수 보기/);
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/);
    expect(html).toContain('accept=".nnue"');
    expect(html).toContain("https://fairy-stockfish.github.io/nnue/");
    expect(html).toContain("기본 평가(약함)");
    expect(html).toContain("평가 점수를 체스 기준 식으로 바꾼 추정치");
  });
  it("disables max with an isolation reason and halts a restored max engine turn", () => {
    vi.stubGlobal("crossOriginIsolated", false);
    const saved = { ...record, level: "max", controllers: { c: "engine", h: "human" }, moves: [] };
    vi.stubGlobal("localStorage", fake({ "janggi.index": JSON.stringify([{ id }]), [`janggi.game.${id}`]: JSON.stringify(saved) }));
    const html = render();
    expect(html).toMatch(/<option[^>]*value="max"[^>]*disabled=""/);
    expect(html).toContain("교차 출처 격리 안 됨");
    expect(html).not.toContain("엔진이 생각하는 중…");
  });
  it("shows last-move mover delta and grade from persisted Cho evaluations", () => {
    const saved = { ...record, analysis: { engine: "test", evals: [
      { ply: 0, cp: 190, win: 65, depth: 12 }, { ply: 1, cp: -190, win: 35, depth: 12 },
    ] } };
    vi.stubGlobal("localStorage", fake({ "janggi.index": JSON.stringify([{ id }]), [`janggi.game.${id}`]: JSON.stringify(saved) }));
    expect(render()).toContain("초 a4a5 −30%p 대실수 ??");
  });
});
