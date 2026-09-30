import { afterEach, describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Janggi, { WinBar, Candidates } from "../src/Janggi.jsx";
import { ReviewPanel } from "../src/Review.jsx";
import { newGame } from "../src/game.js";

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
    expect(render()).toContain("초 졸 a4→a5 −30%p 대실수 ??"); // 한글 기물 이름(사용자 요청 2026-09-29)
  });
});

describe("board coordinates (user request 2026-09-29)", () => {
  const labels = (html, kind) => [...html.matchAll(new RegExp(`data-coord="${kind}"[^>]*>([^<]+)<`, "g"))].map((m) => m[1]);
  it("labels files a–i along the bottom and ranks 10→1 down the left side (초 궁 줄이 1)", () => {
    vi.stubGlobal("localStorage", fake());
    const html = render();
    expect(labels(html, "file").join("")).toBe("abcdefghi");
    expect(labels(html, "rank")).toEqual(["10", "9", "8", "7", "6", "5", "4", "3", "2", "1"]);
  });
  it("flips the labels with the board when 한 is at the bottom", () => {
    const flipped = { ...record, bottom: "h" };
    vi.stubGlobal("localStorage", fake({ "janggi.index": JSON.stringify([{ id }]), [`janggi.game.${id}`]: JSON.stringify(flipped) }));
    const html = render();
    expect(labels(html, "file").join("")).toBe("ihgfedcba");
    expect(labels(html, "rank")).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
  });
});

describe("deeper analysis settings (user request 2026-09-29)", () => {
  const modeSelect = (html) => /<select[^>]*aria-label="분석"[^>]*>(.*?)<\/select>/.exec(html)?.[1];
  it("offers fast / deep / continuous analysis with continuous selected by default", () => {
    vi.stubGlobal("localStorage", fake());
    const options = modeSelect(render());
    expect([...options.matchAll(/<option value="(\w+)"/g)].map((m) => m[1])).toEqual(["fast", "deep", "continuous"]);
    expect(options).toMatch(/<option value="fast">빠르게/);
    expect(options).toMatch(/<option value="deep">깊게/);
    expect(options).toMatch(/<option value="continuous" selected="">계속/);
  });
  it("restores the remembered mode from janggi.prefs", () => {
    vi.stubGlobal("localStorage", fake({ "janggi.prefs": '{"analysis":"fast"}' }));
    expect(modeSelect(render())).toMatch(/<option value="fast" selected="">빠르게/);
  });
  it("tells that the analysis mode applies immediately (not from the next game)", () => {
    vi.stubGlobal("localStorage", fake());
    expect(render()).toContain("두는 이(사람/엔진)와 분석은 고르는 즉시 바뀌어요.");
  });
  it("shows the depth and 'continuous analysis' on the win bar while deepening", () => {
    const bar = (status) => renderToStaticMarkup(createElement(WinBar, { a: { win: 55, depth: 18 }, fen: "f",
      status: { state: "ready", pending: 0, nnue: "on", ...status } }));
    expect(bar({ deepening: true })).toContain("깊이 18 · 계속 분석 중");
    expect(bar({ deepening: false })).toContain("깊이 18<");
    expect(bar({ deepening: false })).not.toContain("계속 분석 중");
    expect(bar({ pending: 2, deepening: false })).toContain("분석 중 (2개 남음)");
  });
});
  it("counts the seconds of the running deep look on the win bar", () => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    const bar = (status) => renderToStaticMarkup(createElement(WinBar, { a: { win: 55, depth: 18 }, fen: "f",
      status: { state: "ready", pending: 0, nnue: "on", ...status } }));
    try {
      expect(bar({ deepening: true, deepSince: 93_000 })).toContain("깊이 18 · 계속 분석 중 (7초)<");
      expect(bar({ deepening: true, deepSince: 100_000 })).toContain("계속 분석 중 (0초)<");
      expect(bar({ deepening: true, deepSince: 35_000 })).toContain("계속 분석 중 (1분 5초)<");
      expect(bar({ deepening: false, deepSince: null })).toContain("깊이 18<");
    } finally { vi.useRealTimers(); }
  });

describe("review deep look (spec 2.10: saved-game review only)", () => {
  const bar = (status, stable) => renderToStaticMarkup(createElement(WinBar, { a: { win: 55, depth: 18 }, fen: "f", stable,
    status: { state: "ready", pending: 0, nnue: "on", ...status } }));
  it("shows the same-move count of a stage-2 result on the win bar, and the old text otherwise", () => {
    expect(bar({ deepening: true }, 4)).toContain("깊이 18 · 같은 수 4깊이째 · 계속 분석 중<");
    expect(bar({ deepening: false }, 4)).toContain("깊이 18 · 같은 수 4깊이째<");
    expect(bar({ deepening: true }, null)).toContain("깊이 18 · 계속 분석 중<");
    expect(bar({ deepening: false })).toContain("깊이 18<");
    expect(bar({ pending: 2, deepening: false }, 4)).toContain("분석 중 (2개 남음)<");
  });

  const panel = (deep) => renderToStaticMarkup(createElement(ReviewPanel, { rows: [], k: 0, n: 0, setK() {}, evals: [], onExit() {}, deep }));
  const deep = (extra) => ({ value: 20000, deepening: false, continuous: true, onChange() {}, onHalt() {}, ...extra });
  const capSelect = (html) => /<select[^>]*aria-label="깊게 보기"[^>]*>(.*?)<\/select>/.exec(html)?.[1];
  it("offers 20 s / 1 min / 5 min / unlimited in the saved-game review, with the remembered cap selected", () => {
    const options = capSelect(panel(deep({ value: 60000 })));
    expect([...options.matchAll(/<option value="(\w+)"[^>]*>([^<]+)</g)].map((m) => [m[1], m[2]]))
      .toEqual([["20000", "20초"], ["60000", "1분"], ["300000", "5분"], ["infinite", "무제한"]]);
    expect(options).toContain('<option value="60000" selected="">1분');
    expect(capSelect(panel(deep({ value: "infinite" })))).toContain('<option value="infinite" selected="">무제한');
  });
  it("shows 멈춤 only while the deep look runs", () => {
    expect(panel(deep({ deepening: true }))).toMatch(/<button[^>]*>멈춤<\/button>/);
    expect(panel(deep({ deepening: false }))).not.toContain("멈춤");
  });
  it("says the deep look needs the continuous mode when another mode is chosen, with a button to switch to it", () => {
    expect(panel(deep({ continuous: false }))).toMatch(/분석 모드가 &#x27;계속&#x27;일 때 깊게 봐요<\/span><button[^>]*>계속으로 바꾸기<\/button>/);
    expect(panel(deep({ continuous: true }))).not.toContain("분석 모드가");
    expect(panel(deep({ continuous: true }))).not.toContain("계속으로 바꾸기");
  });
  it("has no deep-look row in the review of the live game", () => {
    const html = panel(null);
    expect(html).toContain("대국으로 돌아가기");
    expect(html).not.toContain("깊게 보기");
    expect(html).not.toContain("멈춤");
    expect(html).not.toContain("분석 모드가");
    expect(html).not.toContain("계속으로 바꾸기");
  });

  const list = (depth) => renderToStaticMarkup(createElement(Candidates, { board: newGame().b, depth,
    candidates: [{ move: "a4a5", win: 55.4, depth: 21 }, { move: "c4c5", win: 48, depth: 14 }] }));
  it("writes each candidate's depth in the saved-game review list only", () => {
    const saved = list(true);
    // 깊이는 한 덩어리로 줄을 바꾼다(좁은 칸에서 "깊이"와 숫자가 갈리지 않게 — 스크린샷으로 확인).
    expect(saved).toContain('<b>55%</b><span style="white-space:nowrap"> · 깊이 21</span></li>');
    expect(saved).toContain('<b>48%</b><span style="white-space:nowrap"> · 깊이 14</span></li>');
    const live = list(false);
    expect(live).toContain("<b>55%</b></li>");
    expect(live).toContain("<b>48%</b></li>");
    expect(live).not.toContain("깊이");
  });
});
