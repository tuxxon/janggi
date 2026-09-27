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
