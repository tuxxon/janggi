// 브라우저 WASM 로딩만 담당한다. UCI 대기열은 service.js, 사용자 신경망은 nnue.js.
import { createAnalysisService } from "./service.js";
import { createNetworkStore, NNUE } from "./nnue.js";
export { NNUE } from "./nnue.js";

export const ISOLATION_REASON = "이 브라우저에서는 승률 분석을 쓸 수 없어요(교차 출처 격리 안 됨)";
let scriptPromise;
function loadScript(src) {
  if (self.Stockfish) return Promise.resolve();
  return scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const finish = (error) => {
      clearTimeout(timer);
      if (error) { script.remove(); reject(error); } else resolve();
    };
    const timer = setTimeout(() => finish(new Error("엔진 스크립트 로딩 시간이 초과됐어요.")), 30000);
    script.src = src;
    script.onload = () => finish();
    script.onerror = () => finish(new Error("엔진 스크립트를 불러오지 못했어요."));
    document.head.appendChild(script);
  }).catch((error) => { scriptPromise = null; throw error; });
}

export async function loadEngine({ onError = () => {} } = {}) {
  if (!self.crossOriginIsolated) throw new Error(ISOLATION_REASON);
  const base = import.meta.env.BASE_URL + "fsf/";
  await loadScript(base + "stockfish.js");
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { settled = true; reject(new Error("WASM 엔진 로딩 시간이 초과됐어요.")); }, 30000);
    Promise.resolve().then(() => self.Stockfish({ locateFile: (file) => base + file,
      onAbort: (reason) => onError(new Error(String(reason))),
    })).then((engine) => {
      clearTimeout(timer);
      if (settled) { engine.postMessage("quit"); return; }
      settled = true; resolve(engine);
    }, (error) => { clearTimeout(timer); settled = true; reject(error); });
  });
}

export function createAnalyzer(options = {}) {
  const networks = createNetworkStore();
  const service = createAnalysisService({ createEngine: loadEngine, loadNetwork: () => networks.load(),
    networkName: NNUE.name, ...options });
  return { ...service,
    // Preserve the live accessor when wrapping the service.
    get status() { return service.status; },
    async addNetwork(file) { const bytes = await networks.add(file); await service.setNetwork(bytes, NNUE.name); },
    async clearNetwork() { await networks.clear(); await service.setNetwork(null); },
  };
}
