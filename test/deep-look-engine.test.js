// 복기 깊게 보기(개정 2.10)를 실엔진(WASM 1.1.12, Node)으로 확인한다: Hash 256 을 받는지, go infinite 가 stop 으로 끝나는지,
// 같은 시간에 MultiPV 1 이 5 보다 깊은지, 그리고 서비스가 실엔진 줄로 2단계를 도는지.
// 무제한 무응답 감시의 기준 시간(service.js SILENCE_TIMEOUT)은 테스트가 아니라 5분 측정 스크립트로 정했다(보고서).
import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { KAKAO, createAnalysisService } from "../src/analysis/service.js";

const require = createRequire(import.meta.url);
let sf;
const lines = [];
function send(cmd, until, ms = 20_000) {
  const start = lines.length;
  sf.postMessage(cmd);
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      const i = lines.findIndex((l, k) => k >= start && l.startsWith(until));
      if (i >= 0) return resolve(lines.slice(start, i + 1));
      if (Date.now() - t0 > ms) return reject(new Error(`timeout waiting for ${until} after ${cmd}`));
      setTimeout(poll, 1);
    })();
  });
}
const waitFor = (check, ms) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  (function poll() {
    if (check()) return resolve();
    if (Date.now() - t0 > ms) return reject(new Error("timeout"));
    setTimeout(poll, 5);
  })();
});
beforeAll(async () => {
  const saved = globalThis.fetch;
  delete globalThis.fetch; // 옛 Emscripten 로더가 Node 22 의 fetch 로 파일 경로를 열다 죽는다(실측)
  try { sf = await require("fairy-stockfish-nnue.wasm/stockfish.js")(); } finally { globalThis.fetch = saved; }
  sf.addMessageListener((l) => lines.push(l));
  await send("uci", "uciok");
  sf.FS.writeFile(KAKAO.path, KAKAO.ini);
  for (const c of [`setoption name VariantPath value ${KAKAO.path}`, `setoption name UCI_Variant value ${KAKAO.name}`,
    "setoption name Threads value 1", "setoption name Hash value 64", "setoption name Use NNUE value false"]) sf.postMessage(c);
  await send("isready", "readyok");
}, 60_000);
// "quit" 은 보내지 않는다(Emscripten 이 vitest 작업자까지 죽인다).

// 중반 국면: FSF 자기 대국(go depth 7) 20수째, 초 차례. 1.5초 평가 cp −42(균형).
const MIDDLEGAME = "1b1a1ab1r/4k4/3n2Ccn/1pp1p1pp1/7r1/9/1PP1PP2c/N4N1CR/7R1/2BAKA1B1 w - - 0 1";
// 서비스의 평가 규칙과 같이: 가장 최근의 정확한 1순위 줄의 깊이.
const evaluatedDepth = (out) => Number(/\bdepth (\d+)/.exec(out.filter((l) => / multipv 1 /.test(l) && / pv /.test(l) && !/bound/.test(l)).at(-1))[1]);

describe("review deep look on the real engine (spec 2.10)", () => {
  it("accepts Hash 256: isready answers readyok and a search still runs", async () => {
    sf.postMessage("setoption name Hash value 256");
    expect((await send("isready", "readyok")).at(-1)).toBe("readyok");
    sf.postMessage(`position fen ${MIDDLEGAME}`);
    const out = await send("go movetime 500", "bestmove");
    expect(out.at(-1)).toMatch(/^bestmove [a-i]\d+[a-i]\d+/);
    expect(evaluatedDepth(out)).toBeGreaterThan(5);
  });
  it("go infinite keeps searching until stop, then answers bestmove", async () => {
    sf.postMessage("setoption name MultiPV value 1");
    sf.postMessage(`position fen ${MIDDLEGAME}`);
    const start = lines.length;
    sf.postMessage("go infinite");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(lines.slice(start).some((l) => l.startsWith("bestmove"))).toBe(false);
    const out = await send("stop", "bestmove", 5_000);
    expect(out.at(-1)).toMatch(/^bestmove [a-i]\d+[a-i]\d+/);
  });
  it("in the same 3 s MultiPV 1 reads deeper than MultiPV 5 (middlegame)", async () => {
    const depthWith = async (multipv) => {
      sf.postMessage("ucinewgame"); await send("isready", "readyok"); // 앞 탐색의 해시를 물려받지 않게
      sf.postMessage(`setoption name MultiPV value ${multipv}`);
      sf.postMessage(`position fen ${MIDDLEGAME}`);
      return evaluatedDepth(await send("go movetime 3000", "bestmove"));
    };
    const one = await depthWith(1), five = await depthWith(5);
    expect(one, `MultiPV 1 depth ${one}, MultiPV 5 depth ${five}`).toBeGreaterThan(five);
  }, 30_000);
  it("the service runs the second stage on real lines: Hash 256, go infinite, merged candidates; halt keeps the result", async () => {
    const sent = [], results = [];
    const engine = { postMessage: (c) => { sent.push(c); if (c !== "quit") sf.postMessage(c); }, FS: sf.FS,
      addMessageListener: (fn) => sf.addMessageListener(fn), removeMessageListener: (fn) => sf.removeMessageListener(fn) };
    const service = createAnalysisService({ createEngine: async () => engine, onResult: (r) => results.push(r), mode: "continuous", hash: 64 });
    try {
      service.sync("g", [{ ply: 0, turn: "c", fen: MIDDLEGAME }]);
      service.deepen(0, Infinity);
      await service.ready;
      await waitFor(() => results.some((r) => r.deepCap === Infinity), 20_000);
      expect(sent.filter((c) => c.startsWith("setoption name Hash"))).toEqual(["setoption name Hash value 256"]);
      expect(sent.filter((c) => c.startsWith("go "))).toEqual(["go movetime 800", "go infinite"]);
      expect(sent.filter((c) => c.startsWith("setoption name MultiPV"))).toEqual(["setoption name MultiPV value 5", "setoption name MultiPV value 1"]);
      const [first, second] = [results.find((r) => !r.deepCap), results.find((r) => r.deepCap)];
      expect(first.candidates).toHaveLength(5);
      expect(second).toMatchObject({ movetime: "infinite", stable: expect.any(Number) });
      expect(second.depth).toBeGreaterThan(first.depth);
      expect(second.candidates[0].depth).toBe(second.depth);
      expect(second.candidates).toHaveLength(5);
      expect(new Set(second.candidates.map((c) => c.move)).size).toBe(5);
      const rest = first.candidates.filter((c) => c.move !== second.candidates[0].move).slice(0, 4);
      expect(second.candidates.slice(1)).toEqual(rest);                       // 2~5순위는 1단계 값·깊이 그대로
      const shown = results.at(-1), start = lines.length;
      service.haltDeepen();
      expect(service.status.deepening).toBe(false);
      await waitFor(() => lines.slice(start).some((l) => l.startsWith("bestmove")), 5_000);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(results.at(-1)).toBe(shown);
      expect(sent.filter((c) => c.startsWith("go "))).toHaveLength(2);        // 멈춘 국면은 다시 보지 않는다
    } finally { service.dispose(); }
  }, 60_000);
});
