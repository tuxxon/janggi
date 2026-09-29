// 반복수가 엔진 수읽기 안까지 들어가는지(사용자 보고 2026-09-29: "3회 이상 반복이 안 되는 것을 고려하지 않고 분석해서 지는 경우").
// 제품 설정(service.js KAKAO 변형 + gameAnalysis 의 수순 명령)으로 WASM 엔진을 돌려, 우리 규칙에서 막힌 수는 엔진도
// "두는 순간 짐(mate 0)"으로 보고, 둘 수 있는 수는 그렇게 보지 않는지 대조한다.
import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { newGame, play, legalMoves } from "../src/game.js";
import { forbiddenMove } from "../src/repetition.js";
import { inCheck } from "../src/engine.js";
import { moveToUci, uciToMove } from "../src/notation.js";
import { KAKAO } from "../src/analysis/service.js";
import { analysisPositions } from "../src/analysis/gameAnalysis.js";

const require = createRequire(import.meta.url);
let sf;
const lines = [];
function send(cmd, until) {
  const start = lines.length;
  sf.postMessage(cmd);
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      const i = lines.findIndex((l, k) => k >= start && l.startsWith(until));
      if (i >= 0) return resolve(lines.slice(start, i + 1));
      if (Date.now() - t0 > 20_000) return reject(new Error(`timeout waiting for ${until} after ${cmd}`));
      setTimeout(poll, 1);
    })();
  });
}
beforeAll(async () => {
  const saved = globalThis.fetch;
  delete globalThis.fetch; // 옛 Emscripten 로더가 Node 22 의 fetch 로 파일 경로를 열다 죽는다(실측)
  try { sf = await require("fairy-stockfish-nnue.wasm/stockfish.js")(); } finally { globalThis.fetch = saved; }
  sf.addMessageListener((l) => lines.push(l));
  await send("uci", "uciok");
  sf.FS.writeFile(KAKAO.path, KAKAO.ini);
  for (const c of [`setoption name VariantPath value ${KAKAO.path}`, `setoption name UCI_Variant value ${KAKAO.name}`,
    "setoption name Threads value 1", "setoption name Hash value 16", "setoption name Use NNUE value false"]) sf.postMessage(c);
  await send("isready", "readyok");
}, 60_000);
// "quit" 은 보내지 않는다(Emscripten 이 vitest 작업자까지 죽인다).

const commandOf = (state) => analysisPositions(state, { restrictions: true }).at(-1).position;
async function scoreOf(state, move) {
  sf.postMessage(commandOf(state));
  const out = await send(`go depth 1 searchmoves ${move}`, "bestmove");
  const m = /score (cp|mate) (-?\d+)/.exec(out.filter((l) => l.includes(" score ")).at(-1));
  return `${m[1]} ${m[2]}`;
}
const human = { c: "human", h: "human" };
const playAll = (moves) => moves.reduce((s, m) => play(s, m === "pass" ? "pass" : uciToMove(m)), newGame({ controllers: human }));
function rng(seed) { return () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32); }

describe("Kakao repetition inside the engine search", () => {
  it("the fourth shuttle move is a loss to the engine (the old janggicasual/FEN-only setup scored it cp 7)", async () => {
    const s = playAll(["a1a2", "a10a9", "a2a1", "a9a10", "a1a2", "a10a9", "a2a1", "a9a10"]);
    expect(moveToUci(forbiddenMove(s))).toBe("a1a2");
    expect(await scoreOf(s, "a1a2")).toBe("mate 0");
  });
  it("after the opponent passes the count restarts, so the same move is playable again (the engine must not see past the pass)", async () => {
    const s = playAll(["a1a2", "a10a9", "a2a1", "a9a10", "a1a2", "a10a9", "a2a1", "pass"]);
    expect(forbiddenMove(s)).toBeNull();
    expect(await scoreOf(s, "a1a2")).not.toBe("mate 0");
  });
  it("on random shuttle-heavy games, forbidden ⇔ the engine scores the move as an immediate loss", async () => {
    const rand = rng(20260929), positions = [];
    for (let g = 0; g < 2000 && positions.length < 40; g++) {
      let s = newGame({ controllers: human });
      for (let ply = 0; ply < 70 && !s.over; ply++) {
        if (ply > 6 && (forbiddenMove(s) || s.moves.slice(-3).includes("pass")) && positions.length < 40) positions.push(s);
        const ms = legalMoves(s);
        if (!ms.length) break;
        const mine = s.moves.length >= 2 ? /^([a-i]\d+)([a-i]\d+)$/.exec(s.moves.at(-2)) : null;
        const back = mine ? ms.find((m) => moveToUci(m) === mine[2] + mine[1]) : null;
        const r = rand();
        s = r < 0.06 && !inCheck(s.b, s.turn) ? play(s, "pass") : play(s, back && r < 0.8 ? back : ms[Math.floor(rand() * ms.length)]);
      }
    }
    const mismatches = [];
    let forbidden = 0, checked = 0;
    for (const s of positions) {
      const bad = forbiddenMove(s) && moveToUci(forbiddenMove(s));
      if (bad) forbidden++;
      for (const u of [...legalMoves(s).map(moveToUci), ...(bad ? [bad] : [])]) {
        const score = await scoreOf(s, u);
        checked++;
        if ((score === "mate 0") !== (u === bad)) mismatches.push(`${commandOf(s)} | ${u}: ours ${u === bad ? "forbidden" : "legal"}, engine ${score}`);
      }
    }
    expect(mismatches).toEqual([]);
    expect(positions).toHaveLength(40);
    expect(forbidden).toBeGreaterThanOrEqual(10);
    expect(checked).toBeGreaterThan(1000);
  }, 180_000);
});
