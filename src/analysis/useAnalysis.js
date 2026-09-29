import { useEffect, useRef, useState } from "react";
import { createAnalyzer, ISOLATION_REASON } from "./fsf.js";
import { analysisPositions, cacheEvaluation, syncAnalysisCache } from "./gameAnalysis.js";

// mode: 분석 모드(fast·deep·continuous). deepen: 깊게 볼 국면(복기의 k수째), null 이면 마지막 국면.
// deepCap: 저장된 판 복기의 2단계 상한(service DEEP_CAPS), null 이면 지금 "계속"(진행 중인 판과 그 복기).
export function useAnalysis(game, { mode = "fast", deepen = null, deepCap = null } = {}) {
  const latest = useRef(game);
  latest.current = game;
  const serviceRef = useRef(null);
  const [cache, setCache] = useState(() => syncAnalysisCache(null, game));
  const cacheRef = useRef(cache);
  const [status, setStatus] = useState(() => ({ state: globalThis.crossOriginIsolated === false ? "disabled" : "loading",
    reason: globalThis.crossOriginIsolated === false ? ISOLATION_REASON : null, pending: 0, nnue: "off" }));
  useEffect(() => {
    let alive = true;
    const service = createAnalyzer({
      onStatus: (next) => { if (alive) setStatus(next); },
      onResult: (result) => {
        if (!alive) return;
        cacheRef.current = cacheEvaluation(cacheRef.current, latest.current, result);
        setCache(cacheRef.current);
      },
      onReset: () => {
        if (!alive) return;
        // 신경망이 바뀌어도 저장된 평가는 남긴다(다시 분석되면 덮어쓴다). 메모리의 후보 수만 버린다.
        cacheRef.current = { ...syncAnalysisCache(cacheRef.current, latest.current), results: [] };
        setCache(cacheRef.current);
      },
    });
    serviceRef.current = service;
    return () => { alive = false; service.dispose(); serviceRef.current = null; };
  }, []);
  // 판별 캐시: 복기 판과 진행 중인 판을 오가도 계산해 둔 평가를 잃지 않는다.
  const cachesRef = useRef(new Map());
  const baseFor = (g) => (cacheRef.current?.id === g.id ? cacheRef.current : cachesRef.current.get(g.id) ?? null);
  useEffect(() => {
    if (cacheRef.current) cachesRef.current.set(cacheRef.current.id, cacheRef.current);
    cacheRef.current = syncAnalysisCache(baseFor(game), game);
    setCache(cacheRef.current);
    const evals = cacheRef.current.analysis?.evals;
    serviceRef.current.sync(game.id, analysisPositions(game, { restrictions: true }).map((p) => evals?.[p.ply] ? { ...p, known: evals[p.ply] } : p));
  }, [game]);
  // 모드는 마운트 직후(엔진이 뜨기 전)에도 이 효과로 맞춘다. 동기화 뒤에 둔다: 새 판의 국면으로 깊게 볼 대상을 고른다.
  useEffect(() => { serviceRef.current.setMode(mode); }, [mode]);
  // 상한은 서비스 전체 값이다: 판이 바뀌면 위의 sync 가 첫 탐색 전에 풀고(Hash 64), 저장된 판 복기면 여기서 deepen(k, cap) 으로 다시 건다.
  useEffect(() => { serviceRef.current.deepen(deepen, deepCap); }, [deepen, deepCap]);
  // Render immediately against the new game, even before the synchronization effect runs.
  const view = syncAnalysisCache(cache.id === game.id ? cache : cachesRef.current.get(game.id) ?? null, game);
  const ply = game.moves.length;
  return { serviceRef, status, haltDeepen: () => serviceRef.current?.haltDeepen(), cacheId: view.id, cache: view.analysis,
    results: view.results, evals: view.analysis?.evals, current: view.results[ply], evaluation: view.analysis?.evals[ply] };
}
