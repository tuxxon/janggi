// 브라우저 안의 Fairy-Stockfish(WASM, GPL-3.0). 교차 출처 격리(SharedArrayBuffer)가 필요하다.
// 신경망은 배포본에 넣지 않고 Google Drive 에서 직접 받는다(CORS 허용, 2026-09-28 확인) → Cache Storage.
export const NNUE = {
  url: "https://drive.usercontent.google.com/download?id=1dAEzbK1rOm8UGm_-CLdDEgeopFDcAtQP&export=download",
  name: "janggi-9991472750de.nnue",
  size: 11261920,
  shaPrefix: "9991472750de",
};
const CACHE = "janggi-nnue-v1";

const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function loadNnue() {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(NNUE.url);
  const src = hit || (import.meta.env.DEV ? await fetchOk(import.meta.env.BASE_URL + "dev-nnue/" + NNUE.name) : await fetchOk(NNUE.url));
  const bytes = new Uint8Array(await src.arrayBuffer());
  if (bytes.length !== NNUE.size) throw new Error(`NNUE 크기 불일치 ${bytes.length}`);
  const sha = hex(await crypto.subtle.digest("SHA-256", bytes));
  if (!sha.startsWith(NNUE.shaPrefix)) {
    if (hit) await cache.delete(NNUE.url);
    throw new Error(`NNUE 해시 불일치 ${sha.slice(0, 12)}`);
  }
  if (!hit) await cache.put(NNUE.url, new Response(bytes));
  return bytes;
}

async function fetchOk(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`NNUE 다운로드 실패 HTTP ${r.status}`);
  return r;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`스크립트 로드 실패 ${src}`));
    document.head.appendChild(s);
  });
}

// 엔진 하나를 띄워 { analyze(fen, ms) } 를 돌려준다. analyze 는 한 번에 하나만 돈다(새 요청이 오면 이전 것을 stop).
export async function createAnalyzer({ onStatus = () => {} } = {}) {
  if (!self.crossOriginIsolated) throw new Error("교차 출처 격리가 안 돼서 엔진을 띄울 수 없어요");
  const base = import.meta.env.BASE_URL + "fsf/";
  await loadScript(base + "stockfish.js");
  const sf = await self.Stockfish({ locateFile: (f) => base + f });

  const listeners = new Set();
  sf.addMessageListener((line) => listeners.forEach((f) => f(line)));
  const waitFor = (pred) => new Promise((resolve) => {
    const f = (line) => { if (pred(line)) { listeners.delete(f); resolve(line); } };
    listeners.add(f);
  });

  let nnue = "loading";
  listeners.add((line) => {
    if (line.startsWith("info string NNUE evaluation using")) nnue = "on";
    else if (line.startsWith("info string classical evaluation")) nnue = "off";
  });

  sf.postMessage("uci");
  await waitFor((l) => l === "uciok");
  sf.postMessage("setoption name UCI_Variant value janggicasual");
  sf.postMessage("setoption name Threads value 1");
  sf.postMessage("setoption name Hash value 32");
  let nnueError = null;
  try {
    onStatus({ nnue: "loading" });
    const bytes = await loadNnue();
    sf.FS.writeFile("/" + NNUE.name, bytes);
    sf.postMessage(`setoption name EvalFile value /${NNUE.name}`);
  } catch (e) {
    nnueError = e.message;
    sf.postMessage("setoption name Use NNUE value false");
  }
  sf.postMessage("isready");
  await waitFor((l) => l === "readyok");

  // 요청은 하나씩 순서대로 돈다. 새 요청이 들어오면 진행 중인 탐색을 stop 하고, 밀린 옛 요청은 null 로 끝낸다(최신 우선).
  let chain = Promise.resolve(), gen = 0, searching = false;
  function analyze(fen, ms) {
    const my = ++gen;
    if (searching) sf.postMessage("stop");
    const p = chain.then(async () => {
      if (my !== gen) return null;
      let last = null;
      const onInfo = (line) => {
        if (line.startsWith("info") && / multipv 1 /.test(line) && / score /.test(line)) last = line;
      };
      listeners.add(onInfo);
      const done = waitFor((l) => l.startsWith("bestmove"));
      searching = true;
      sf.postMessage(`position fen ${fen}`);
      sf.postMessage(`go movetime ${ms}`);
      const best = await done;
      searching = false;
      listeners.delete(onInfo);
      if (!last || my !== gen) return null;
      const sc = / score (cp|mate) (-?\d+)/.exec(last);
      const depth = Number(/ depth (\d+)/.exec(last)[1]);
      return { score: sc[1] === "cp" ? { cp: Number(sc[2]) } : { mate: Number(sc[2]) }, depth, best: best.split(" ")[1], nnue, nnueError };
    });
    chain = p.catch(() => {});
    return p;
  }
  return { analyze, get nnue() { return nnue; }, nnueError };
}
