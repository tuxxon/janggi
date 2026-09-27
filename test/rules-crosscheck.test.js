// 원본 엔진(src/engine.js)의 합법 수 == Fairy-Stockfish janggicasual `go perft 1`(쉬기 제외)인지,
// 모든 상차림 조합에서 무작위 대국으로 만든 국면으로 대조한다. WASM 엔진을 Node 에서 돌린다.
import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { SETUPS, newBoard, legal, make, other } from "../src/engine.js";
import { moveToUci, toFen } from "../src/notation.js";

const require = createRequire(import.meta.url);
let sf;
const lines = [];
beforeAll(async () => {
  const saved = globalThis.fetch;
  delete globalThis.fetch; // 옛 Emscripten 로더가 Node 22 의 fetch 로 파일 경로를 열다 죽는다(실측)
  try { sf = await require("fairy-stockfish-nnue.wasm/stockfish.js")(); } finally { globalThis.fetch = saved; }
  sf.addMessageListener((l) => lines.push(l));
  await send("uci", "uciok");
  sf.postMessage("setoption name UCI_Variant value janggicasual");
  await send("isready", "readyok");
}, 60_000);
// "quit" 은 보내지 않는다: Emscripten 이 process.exit 로 vitest 작업자 프로세스까지 죽인다(실측). 정리는 vitest 가 한다.

function send(cmd, until) {
  const start = lines.length;
  sf.postMessage(cmd);
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      const i = lines.findIndex((l, k) => k >= start && l.startsWith(until));
      if (i >= 0) return resolve(lines.slice(start, i + 1));
      if (Date.now() - t0 > 10_000) return reject(new Error(`timeout waiting for ${until} after ${cmd}`));
      setTimeout(poll, 1);
    })();
  });
}
async function fsfMoves(fen) {
  sf.postMessage(`position fen ${fen}`);
  const out = await send("go perft 1", "Nodes searched");
  return out.map((l) => /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9])): 1$/.exec(l)).filter((m) => m && m[1] !== m[2]).map((m) => m[1] + m[2]).sort();
}
function rng(seed) { return () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32); }

describe("rules cross-check against Fairy-Stockfish janggicasual", () => {
  it("legal move sets are identical on 1600 positions from random games over all 16 setup pairs", async () => {
    const rand = rng(20260928), mismatches = [];
    let checked = 0;
    for (const cs of Object.keys(SETUPS)) for (const hs of Object.keys(SETUPS)) {
      for (let game = 0; game < 5; game++) {
        const b = newBoard(cs, hs);
        let turn = "c";
        for (let ply = 0; ply < 20; ply++) {
          const ours = legal(b, turn).map(moveToUci).sort(), fen = toFen(b, turn);
          const theirs = await fsfMoves(fen);
          checked++;
          if (JSON.stringify(ours) !== JSON.stringify(theirs))
            mismatches.push({ fen, onlyOurs: ours.filter((m) => !theirs.includes(m)), onlyFsf: theirs.filter((m) => !ours.includes(m)) });
          if (!ours.length) break;
          // 따먹는 수를 조금 더 자주 골라 중반·종반 국면(포 다리, 궁성 대각선)이 나오게 한다.
          const moves = legal(b, turn), caps = moves.filter((m) => b[m[1]]);
          const pool = caps.length && rand() < 0.5 ? caps : moves;
          make(b, pool[Math.floor(rand() * pool.length)]);
          turn = other(turn);
        }
      }
    }
    expect(checked).toBe(1600);
    expect(mismatches).toEqual([]);
  }, 120_000);
});
