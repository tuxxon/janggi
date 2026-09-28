import { useEffect, useRef, useState } from "react";
import { createAnalyzer, ISOLATION_REASON } from "./fsf.js";
import { analysisPositions, cacheEvaluation, syncAnalysisCache } from "./gameAnalysis.js";

export function useAnalysis(game) {
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
    serviceRef.current.sync(game.id, analysisPositions(game).map((p) => evals?.[p.ply] ? { ...p, known: evals[p.ply] } : p));
  }, [game]);
  // Render immediately against the new game, even before the synchronization effect runs.
  const view = syncAnalysisCache(cache.id === game.id ? cache : cachesRef.current.get(game.id) ?? null, game);
  const ply = game.moves.length;
  return { serviceRef, status, cacheId: view.id, cache: view.analysis, results: view.results, evals: view.analysis?.evals,
    current: view.results[ply], evaluation: view.analysis?.evals[ply] };
}
