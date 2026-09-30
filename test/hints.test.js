import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import * as hints from "../src/analysis/HintLabels.jsx";

it("labels each legal selected target with its mover win and grade colour, enlarging the hovered target", () => {
  expect(hints.HintLabels).toBeTypeOf("function");
  const html = renderToStaticMarkup(createElement(hints.HintLabels, {
    candidates: [{ move: "a4a5", win: 80 }, { move: "c4c5", win: 70 }],
    focused: [{ move: "a4a5", win: 60 }, { move: "a4b4", win: 50 }],
    targets: [[54, 45], [54, 55]], turnWin: 80, hovered: 55, xy: (i) => [i, 100],
  }));
  expect(html).toContain('data-move="a4a5"');
  expect(html).toContain('data-testid="target-win"');
  expect(html).toContain('fill="#c56516"');
  expect(html).toContain('fill="#ae2219"');
  expect(html).toMatch(/font-size="22"[^>]*>50%/);
  expect(html).toContain('data-testid="candidate-win"');
  expect(html).not.toContain('>80%</text>'); // focus replaces the overlapping top-five label
});

it("places a pass candidate at the king square and omits focus results outside the selected legal moves", () => {
  expect(hints.HintLabels).toBeTypeOf("function");
  const html = renderToStaticMarkup(createElement(hints.HintLabels, {
    candidates: [{ move: "pass", win: 50 }], focused: [{ move: "a4a5", win: 0 }], targets: [],
    passSquare: 76, turnWin: 50, xy: (i) => [i, 100],
  }));
  expect(html).toContain('x="76"');
  expect(html).toContain('data-move="pass"');
  expect(html).not.toContain('data-testid="target-win"');
});

// 오른쪽 클릭 30초 깊게 보기(사용자 요청 2026-09-30): 그 수의 칸은 깊게 읽은 값이 0.5초 값을 대신하고, 깊이를 적는다.
// "…"는 지금 읽는 수(reading)에만 — 멈춘 결과가 영원히 "읽는 중"으로 보이지 않게(리뷰 MED).
it("shows a deep-look result in place of the quick focus value, with its depth (… only for the move being read now)", () => {
  const render = (deep, reading = null) => renderToStaticMarkup(createElement(hints.HintLabels, {
    focused: [{ move: "a4a5", win: 60 }, { move: "a4b4", win: 50 }], targets: [[54, 45], [54, 55]],
    turnWin: 55, xy: (i) => [i, 100], deep, reading,
  }));
  const reading = render({ a4a5: { move: "a4a5", win: 57.4, depth: 24, done: false }, c4c5: { move: "c4c5", win: 90, depth: 30, done: true } }, "a4a5");
  expect(reading).toMatch(/data-move="a4a5"[^>]*data-deep="true"/);
  expect(reading).toMatch(/>57%<\/text>/);
  expect(reading).not.toMatch(/>60%<\/text>/);
  expect(reading).toContain(">깊이 24…</text>");
  expect(reading).toMatch(/data-move="a4b4"(?![^>]*data-deep)/);              // 다른 칸은 0.5초 값 그대로
  expect(reading).not.toContain("90%");                                        // 고른 기물의 수가 아니면 없다
  expect(render({ a4a5: { move: "a4a5", win: 57.4, depth: 25, done: true } })).toContain(">깊이 25</text>");
  expect(render({ a4a5: { move: "a4a5", win: 57.4, depth: 17, done: false, ended: true } }, "a4b4")).toContain(">깊이 17</text>"); // 멈춘 것
});
