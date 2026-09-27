import { describe, it, expect } from "vitest";
import { newBoard, legal } from "../src/engine.js";
import { moveToUci } from "../src/notation.js";

// Fairy-Stockfish 14.0.1 janggicasual `go perft 1` at its startpos (both sides 마상상마),
// captured 2026-09-28. e2e2 (= pass) removed: the original engine has no pass in legal().
const FSF_START_MOVES = [
  "a1a2", "a1a3", "i1i2", "i1i3", "a4b4", "a4a5", "c4b4", "c4d4", "c4c5", "e4d4", "e4f4",
  "e4e5", "g4f4", "g4h4", "g4g5", "i4h4", "i4i5", "b1a3", "b1c3", "h1g3", "h1i3", "d1e1",
  "d1d2", "f1e1", "f1f2", "e2e1", "e2d2", "e2f2", "e2d3", "e2e3", "e2f3",
];

describe("engine (extracted unchanged from Janggi.jsx)", () => {
  it("start position legal moves match Fairy-Stockfish exactly", () => {
    const b = newBoard("마상상마", "마상상마");
    const ours = legal(b, "c").map(moveToUci).sort();
    expect(ours).toEqual([...FSF_START_MOVES].sort());
    expect(ours).toHaveLength(31);
  });
});
