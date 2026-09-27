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
        cacheRef.current = { ...syncAnalysisCache(cacheRef.current, latest.current), analysis: undefined, results: [] };
        setCache(cacheRef.current);
      },
    });
    serviceRef.current = service;
    return () => { alive = false; service.dispose(); serviceRef.current = null; };
  }, []);
  useEffect(() => {
    cacheRef.current = syncAnalysisCache(cacheRef.current, game);
    setCache(cacheRef.current);
    serviceRef.current.sync(game.id, analysisPositions(game));
  }, [game]);
  // Render immediately against the new game, even before the synchronization effect runs.
  const view = syncAnalysisCache(cache, game);
  const ply = game.moves.length;
  return { serviceRef, status, cache: view.analysis, current: view.results[ply], evaluation: view.analysis?.evals[ply] };
}
