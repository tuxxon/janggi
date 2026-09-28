// One UCI engine, an ordered position queue, and a lower-priority cancellable focus search.
// No browser/WASM dependencies: createEngine supplies { postMessage, addMessageListener, FS }.
import { uciToMove, moveToUci } from "../notation.js";
import { winFromScore } from "../winrate.js";

function info(line) {
  const score = /\bscore (cp|mate) (-?\d+)/.exec(line);
  const pv = /\bpv (\S+)/.exec(line), depth = /\bdepth (\d+)/.exec(line);
  const move = pv && uciToMove(pv[1]);
  if (!score || !depth || (!move && !(score[1] === "mate" && Number(score[2]) === 0)) || /\b(?:lowerbound|upperbound)\b/.test(line)) return null;
  const value = { [score[1]]: Number(score[2]) };
  return { rank: Number(/\bmultipv (\d+)/.exec(line)?.[1] ?? 1), depth: Number(depth[1]),
    score: value, win: winFromScore(value),
    candidate: move ? { move: moveToUci(move), ...value, win: winFromScore(value) } : null };
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const RESPONSE_TIMEOUT = 15000, NETWORK_TIMEOUT = 20000;
// 저장된 신경망 불러오기(Cache Storage·dev fetch)가 끝나지 않아도 기본 평가로 시작한다.
const settleWithin = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

export function createAnalysisService({ createEngine, loadNetwork = async () => null,
  networkName = "janggi-9991472750de.nnue", onResult = () => {}, onStatus = () => {}, onReset = () => {} }) {
  let engine, listener, gameId, entries = [], active = null, focus = null;
  let available = false, disposed = false, failures = 0, generation = 0, timer;
  let network = null, networkChange = null, configuring = false;
  const waiters = new Set();
  let status = { state: "loading", pending: 0, nnue: "off", reason: null };
  function publish() {
    status = { ...status, pending: entries.filter((e) => !e.result && !e.error).length };
    if (!disposed) onStatus(status);
  }
  const send = (command) => engine.postMessage(command);
  function exchange(command, response) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error("엔진 응답 시간이 초과됐어요.")), RESPONSE_TIMEOUT);
      const finish = (error) => {
        clearTimeout(timeout); waiters.delete(waiter);
        if (error) reject(error); else resolve();
      };
      const waiter = { receive: (line) => { if (line === response) finish(); }, reject: finish };
      waiters.add(waiter);
      try { send(command); } catch (error) { finish(error); }
    });
  }
  function stop() {
    if (active && !active.cancelled) {
      active.cancelled = true;
      try { send("stop"); } catch (error) { void fail(error); }
    }
  }
  function cancelFocus() {
    if (!focus) return;
    const old = focus;
    focus = null; old.resolve(null);
    if (active?.focus === old) stop();
  }
  function settle(entry, move, error) {
    for (const w of entry.waiting.splice(0)) error ? w.reject(error) : w.resolve(move);
  }
  function detach() {
    clearTimeout(timer);
    engine?.removeMessageListener?.(listener);
    // Invalidate callbacks before quit: some engines report abort while tearing down.
    generation++;
    try { engine?.postMessage("quit"); } catch { /* Already dead. */ }
    engine = null;
    for (const w of [...waiters]) w.reject(new Error("엔진이 종료됐어요."));
  }
  async function fail(cause) {
    if (disposed || status.state === "disabled") return;
    available = false; active = null; configuring = false;
    detach();
    const reason = cause instanceof Error ? cause.message : String(cause);
    if (failures++ === 0) {
      status = { ...status, state: "loading", nnue: "off", reason };
      publish();
      await start();
    } else {
      status = { ...status, state: "disabled", nnue: "off", reason };
      cancelFocus();
      for (const entry of entries) settle(entry, null, new Error(reason));
      networkChange?.reject(new Error(reason)); networkChange = null;
      publish();
    }
  }
  function writeNetwork() {
    if (network) {
      engine.FS.writeFile("/" + networkName, network);
      send(`setoption name EvalFile value /${networkName}`);
    }
    send(`setoption name Use NNUE value ${network ? "true" : "false"}`);
    status = { ...status, nnue: "off" };
  }
  async function configure() {
    configuring = true;
    const change = networkChange, gen = generation;
    try {
      writeNetwork();
      await exchange("isready", "readyok");
      if (disposed || gen !== generation) return;
      if (networkChange === change) networkChange = null;
      configuring = false; change.resolve();
      publish(); pump();
    } catch (error) { if (gen === generation) void fail(error); }
  }
  function pump() {
    if (!available || disposed || active || configuring) return;
    if (networkChange) { void configure(); return; }
    // 최강 엔진 차례는 밀린 지난 국면 분석보다 먼저 탐색한다(엔진이 수십 초 기다리지 않게). 나머지는 순서대로.
    const open = (e) => !e.result && !e.error;
    const entry = entries.find((e) => e.max && open(e)) ?? entries.find(open);
    if (!entry && !focus) return;
    const job = entry ? { entry, movetime: entry.max ? 1000 : 800 } : { entry: focus.entry, focus, movetime: 500 };
    active = { ...job, gameId, lines: new Map(), cancelled: false };
    const gen = generation;
    timer = setTimeout(() => { if (gen === generation) void fail(new Error("엔진 탐색 응답 시간이 초과됐어요.")); }, RESPONSE_TIMEOUT);
    try {
      // 최강 수는 MultiPV 1: 후보 5개를 함께 탐색하면 최선수에 쓸 시간이 나뉘어 약해진다(리뷰).
      send(`setoption name MultiPV value ${job.focus ? job.focus.moves.length : job.entry.max ? 1 : 5}`);
      send(`position fen ${job.entry.fen}`);
      // 반복수로 막힌 수가 있는 국면은 루트 수를 제한한다(searchmoves). 초점 분석은 원래 그 기물의 수만 본다.
      const roots = job.focus ? job.focus.moves : job.entry.searchmoves;
      send(`go movetime ${job.movetime}${roots ? " searchmoves " + roots.join(" ") : ""}`);
      publish();
    } catch (error) { void fail(error); }
  }
  function receive(line) {
    if (typeof line !== "string") { void fail(line); return; }
    for (const waiter of [...waiters]) waiter.receive(line);
    if (active && !active.cancelled && line.startsWith("info string NNUE evaluation using")) {
      status = { ...status, nnue: "on" }; publish();
    } else if (active && !active.cancelled && line.startsWith("info string classical evaluation")) {
      status = { ...status, nnue: "off" }; publish();
    }
    if (!active) return;
    const parsed = info(line);
    if (parsed) active.lines.set(parsed.rank, parsed);
    if (!line.startsWith("bestmove ")) return;
    clearTimeout(timer);
    const job = active;
    active = null;
    if (!job.cancelled) {
      const candidates = [...job.lines].sort(([a], [b]) => a - b).map(([, v]) => v.candidate).filter(Boolean);
      if (job.focus) {
        focus = null;
        job.focus.resolve(candidates.filter((c) => job.focus.moves.includes(c.move)));
      } else {
        const { entry } = job, primary = job.lines.get(1), best = uciToMove(line.split(/\s+/)[1]);
        if (entry.max && !best) {
          entry.error = new Error("최강 엔진의 수를 읽을 수 없어요.");
          settle(entry, null, entry.error);
        } else if (!primary) {
          void fail(new Error("엔진이 평가 점수를 보내지 않았어요.")); return;
        } else {
          const sign = entry.turn === "c" ? 1 : -1, score = primary.score;
          const kind = score.cp !== undefined ? "cp" : "mate";
          entry.result = { gameId: job.gameId, fen: entry.fen, ply: entry.ply,
            [kind]: score[kind] * sign || 0, win: sign === 1 ? primary.win : 100 - primary.win,
            depth: primary.depth, candidates, best, nnue: status.nnue, movetime: job.movetime };
          onResult(entry.result);
          settle(entry, best);
        }
      }
    }
    publish();
    queueMicrotask(pump);
  }
  async function start() {
    const gen = ++generation;
    try {
      const loaded = await createEngine({ onError: (error) => { if (gen === generation) void fail(error); } });
      if (disposed || gen !== generation) { loaded.postMessage("quit"); return; }
      engine = loaded;
      listener = (line) => { if (gen === generation) receive(line); };
      engine.addMessageListener(listener);
      await exchange("uci", "uciok");
      if (gen !== generation || disposed) return;
      send("setoption name UCI_Variant value janggicasual");
      send("setoption name Threads value 1");
      send("setoption name Hash value 32");
      writeNetwork();
      await exchange("isready", "readyok");
      if (gen !== generation || disposed) return;
      available = true;
      status = { ...status, state: "ready", reason: null };
      publish(); pump();
    } catch (error) { if (gen === generation && !disposed) await fail(error); }
  }
  const ready = (async () => {
    const loaded = await settleWithin(loadNetwork(), NETWORK_TIMEOUT);
    if (!networkChange) network = loaded;
    if (!disposed) await start();
  })().catch((error) => fail(error));
  return {
    ready,
    get status() { return status; },
    sync(id, positions) {
      let common = 0;
      // max 가 바뀐 국면(대국 중에 그 편을 최강 엔진으로 바꿈)도 새 국면으로 본다: 0.8초 분석 결과를 최강 수로 쓰지 않는다.
      if (id === gameId) while (common < entries.length && common < positions.length &&
        entries[common].fen === positions[common].fen && entries[common].turn === positions[common].turn &&
        !!entries[common].max === !!positions[common].max &&
        String(entries[common].searchmoves ?? "") === String(positions[common].searchmoves ?? "")) common++;
      const changed = id !== gameId || common !== entries.length || common !== positions.length;
      if (changed) cancelFocus();
      if (common < entries.length || id !== gameId) stop();
      for (const entry of entries.slice(common)) settle(entry, null);
      // Preserve completed/in-flight max work when that ply becomes history.
      // 기보에 저장된 평가(known, 초 기준)가 있는 지난 국면은 다시 탐색하지 않는다. 현재 국면은 후보 수·최강 수가 필요해서 항상 탐색한다.
      const last = positions.length - 1;
      const cached = (p) => p.known && p.ply !== last && !p.max
        ? { gameId: id, fen: p.fen, ply: p.ply, ...(p.known.cp !== undefined ? { cp: p.known.cp } : { mate: p.known.mate }),
          win: p.known.win, depth: p.known.depth, candidates: [], best: null, cached: true } : null;
      entries = [...entries.slice(0, common), ...positions.slice(common).map((p) => ({ ...p, result: cached(p), waiting: [] }))];
      gameId = id;
      publish(); pump();
    },
    bestMove(ply) {
      if (status.state === "disabled") return Promise.reject(new Error(status.reason));
      const entry = entries.find((e) => e.ply === ply);
      if (!entry) return Promise.resolve(null);
      if (entry.error) return Promise.reject(entry.error);
      if (entry.result) return Promise.resolve(entry.result.best);
      const waiting = deferred(); entry.waiting.push(waiting);
      return waiting.promise;
    },
    focus(ply, moves) {
      cancelFocus();
      const entry = entries.find((e) => e.ply === ply);
      if (!entry || !moves.length || disposed || status.state === "disabled") return Promise.resolve(null);
      focus = { ...deferred(), entry, moves: [...new Set(moves)] };
      const promise = focus.promise;
      pump(); return promise;
    },
    cancelFocus,
    setNetwork(bytes, name = networkName) {
      if (status.state === "disabled") return Promise.reject(new Error(status.reason));
      cancelFocus();
      network = bytes; networkName = name;
      networkChange?.resolve();
      networkChange = deferred();
      const promise = networkChange.promise;
      for (const entry of entries) { entry.result = null; entry.error = null; }
      onReset();
      stop(); publish(); pump();
      return promise;
    },
    dispose() {
      disposed = true;
      cancelFocus(); stop(); available = false;
      for (const entry of entries) settle(entry, null);
      networkChange?.resolve(); networkChange = null;
      detach();
    },
  };
}
