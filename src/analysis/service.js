// One UCI engine, an ordered position queue, a lower-priority cancellable focus search,
// and (in continuous mode) an idle, preemptible deepening search of the viewed ply.
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
// 감시 타이머는 탐색 시간 + RESPONSE_TIMEOUT: 20초 깊게 보기가 "응답 없음"으로 끝나지 않게.
const RESPONSE_TIMEOUT = 15000, NETWORK_TIMEOUT = 20000;
export const MODES = ["fast", "deep", "continuous"];
// 카카오식 반복수를 아는 변형: janggicasual(빅장·점수 판정 없음) + 반복 금지. janggicasual 은 반복을 무승부로 읽어서
// 지고 있는 쪽이 반복으로 버틸 수 있다고 계산했다(사용자 보고 2026-09-29). nFoldRule 4 는 FSF janggimodern 과 같다
// (반복 금지보다 n번 반복 무승부가 먼저 걸리지 않게). 수순은 gameAnalysis.enginePositions 가 붙인다.
export const KAKAO = { name: "janggikakao", path: "/janggi-kakao.ini",
  ini: "[janggikakao:janggicasual]\nmoveRepetitionIllegal = true\nnFoldRule = 4\n" };
export const MOVETIME = { fast: 800, deep: 3000, continuous: 800, deepen: 20000, max: 3000, focus: 500 };
function checkMode(mode) {
  if (!MODES.includes(mode)) throw new Error(`알 수 없는 분석 모드예요: ${mode}`);
  return mode;
}
// 저장된 신경망 불러오기(Cache Storage·dev fetch)가 끝나지 않아도 기본 평가로 시작한다.
const settleWithin = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

export function createAnalysisService({ createEngine, loadNetwork = async () => null,
  networkName = "janggi-9991472750de.nnue", onResult = () => {}, onStatus = () => {}, onReset = () => {},
  threads = 1, hash = 32, mode = "fast" }) {
  checkMode(mode);
  // deepenPly: 깊게 볼 국면(null 이면 마지막 국면). capped: 20초 상한을 다 채운 국면(다시 깊게 보지 않는다).
  let engine, listener, gameId, entries = [], active = null, focus = null, deepenPly = null;
  let available = false, disposed = false, failures = 0, generation = 0, timer;
  let network = null, networkChange = null, configuring = false;
  const waiters = new Set();
  let status = { state: "loading", pending: 0, nnue: "off", reason: null, deepening: false };
  function publish() {
    status = { ...status, pending: entries.filter((e) => !e.result && !e.error).length,
      deepening: !!(active?.deepen && !active.cancelled) };
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
  const stopDeepening = () => { if (active?.deepen) { stop(); publish(); } };
  const deepenTarget = () => {
    const entry = deepenPly === null ? entries.at(-1) : entries.find((e) => e.ply === deepenPly);
    // 최강 차례는 깊게 보지 않는다(그 탐색이 곧 엔진의 수다). 1차 분석이 끝난 국면만.
    return mode === "continuous" && entry?.result && !entry.max && !entry.error && !entry.capped ? entry : null;
  };
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
      // FSF 는 파일 이름이 변형 이름(또는 별칭)으로 시작하는 신경망만 쓴다. ini 로 정의한 변형은 부모의 "janggi" 별칭을
      // 잃는다(Variant::init 이 비운다) → 엔진 안의 파일 이름 앞에 변형 이름을 붙인다. 판·기물이 같아 신경망은 그대로 맞는다.
      const path = `/${KAKAO.name}-${networkName}`;
      engine.FS.writeFile(path, network);
      send(`setoption name EvalFile value ${path}`);
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
    // 우선순위: 최강 > 밀린 국면 > 초점 > 깊게 보기(할 일이 없을 때만).
    const entry = entries.find((e) => e.max && open(e)) ?? entries.find(open);
    const target = !entry && !focus && deepenTarget();
    if (!entry && !focus && !target) return;
    const job = entry ? { entry, movetime: entry.max ? MOVETIME.max : MOVETIME[mode] }
      : focus ? { entry: focus.entry, focus, movetime: MOVETIME.focus } : { entry: target, deepen: true, movetime: MOVETIME.deepen };
    active = { ...job, gameId, mode, lines: new Map(), cancelled: false };
    const gen = generation;
    timer = setTimeout(() => { if (gen === generation) void fail(new Error("엔진 탐색 응답 시간이 초과됐어요.")); }, job.movetime + RESPONSE_TIMEOUT);
    try {
      // 최강 수는 MultiPV 1: 후보 5개를 함께 탐색하면 최선수에 쓸 시간이 나뉘어 약해진다(리뷰).
      send(`setoption name MultiPV value ${job.focus ? job.focus.moves.length : job.entry.max ? 1 : 5}`);
      send(job.entry.position ?? `position fen ${job.entry.fen}`);
      // 반복수로 막힌 수가 있는 국면은 루트 수를 제한한다(searchmoves). 초점 분석은 원래 그 기물의 수만 본다.
      const roots = job.focus ? job.focus.moves : job.entry.searchmoves;
      send(`go movetime ${job.movetime}${roots ? " searchmoves " + roots.join(" ") : ""}`);
      publish();
    } catch (error) { void fail(error); }
  }
  // 두는 쪽 기준 UCI 점수를 초 기준 결과로 바꾼다.
  function resultOf(job, primary, candidates, best) {
    const { entry } = job, sign = entry.turn === "c" ? 1 : -1, score = primary.score;
    const kind = score.cp !== undefined ? "cp" : "mate";
    return { gameId: job.gameId, fen: entry.fen, ply: entry.ply,
      [kind]: score[kind] * sign || 0, win: sign === 1 ? primary.win : 100 - primary.win,
      depth: primary.depth, candidates, best, nnue: status.nnue, movetime: job.movetime, mode: job.mode, threads };
  }
  // 기보에 저장된 평가(known)가 더 깊으면 평가는 그대로 두고 후보 수·최선수만 새로 쓴다: 마지막 국면은 후보 때문에
  // 항상 다시 탐색하는데, 새로고침·복기 전환 뒤의 0.8초 결과가 "계속"으로 깊게 읽어 둔 평가를 덮어쓰지 않게(리뷰 A F1).
  function keepDeeper(known, result) {
    if (!known || !(known.depth > result.depth)) return result;
    const { cp, mate, ...rest } = result;
    return { ...rest, ...(known.cp !== undefined ? { cp: known.cp } : { mate: known.mate }), win: known.win, depth: known.depth };
  }
  // 순위별 줄 → 후보(순위순). 보통은 한 묶음(complete)이라 수가 겹치지 않는다. 완성된 묶음이 없을 때만 섞인 줄이 오므로
  // 겹치면 앞 순위 것만 남긴다.
  const candidatesOf = (lines) => [...lines].sort(([a], [b]) => a - b).map(([, v]) => v.candidate).filter(Boolean)
    .filter((c, i, all) => all.findIndex((x) => x.move === c.move) === i);
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
    // 엔진은 반복(깊이)마다 1~N순위를 한 묶음으로 찍고, 한 묶음 안의 수는 서로 다르다. 탐색이 반복 도중 멈추면 그때 보던
    // 순위 한 줄이 lowerbound/upperbound 로 온다(info 가 버린다). 순위별 최신 줄을 섞으면 이전 묶음의 수가 끼어 같은 수가
    // 겹치고 후보가 빠졌다(실측 0.8초 30번 중 2번) → 후보는 모든 순위가 정확한 마지막 묶음(complete)에서만 만든다.
    const rank = /\bscore (?:cp|mate) /.test(line) ? Number(/\bmultipv (\d+)/.exec(line)?.[1] ?? 1) : 0;
    if (rank === 1) active.batch = new Map();
    if (rank) { active.batch?.set(rank, parsed); active.ranks = Math.max(active.ranks ?? 0, rank); }
    if (parsed) active.lines.set(parsed.rank, parsed);
    const completed = rank > 0 && rank === active.ranks && active.batch?.size === rank && [...active.batch.values()].every(Boolean);
    if (completed) active.complete = active.batch;
    // 깊게 보기는 점진 결과: 묶음이 완성됐을 때, 1순위가 지금 보여준 결과보다 깊을 때만 보낸다
    // (선점 뒤 다시 시작한 얕은 탐색이 표시를 되돌리지 않게).
    const primary = active.lines.get(1);
    if (completed && active.deepen && !active.cancelled && primary?.depth > active.entry.result.depth) {
      active.entry.result = resultOf(active, primary, candidatesOf(active.complete), primary.candidate ? uciToMove(primary.candidate.move) : null);
      onResult(active.entry.result);
    }
    if (!line.startsWith("bestmove ")) return;
    clearTimeout(timer);
    const job = active;
    active = null;
    if (job.deepen) {
      if (!job.cancelled) job.entry.capped = true; // 상한까지 다 읽었다(선점으로 멈춘 것은 나중에 이어서 본다)
    } else if (!job.cancelled) {
      const candidates = candidatesOf(job.complete ?? job.lines);
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
          entry.result = keepDeeper(entry.known, resultOf(job, primary, candidates, best));
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
      engine.FS.writeFile(KAKAO.path, KAKAO.ini);
      send(`setoption name VariantPath value ${KAKAO.path}`);
      send(`setoption name UCI_Variant value ${KAKAO.name}`);
      send(`setoption name Threads value ${threads}`);
      send(`setoption name Hash value ${hash}`);
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
        !!entries[common].max === !!positions[common].max && entries[common].position === positions[common].position &&
        String(entries[common].searchmoves ?? "") === String(positions[common].searchmoves ?? "")) common++;
      const changed = id !== gameId || common !== entries.length || common !== positions.length;
      if (changed) { cancelFocus(); stopDeepening(); } // 새 수가 붙어도 깊게 보기는 멈추고 새 국면부터 본다
      if (common < entries.length || id !== gameId) stop();
      for (const entry of entries.slice(common)) settle(entry, null);
      // 최강 수를 둔 뒤 max 가 풀린 국면은 새 항목이 되지만, 앱은 그 탐색을 저장한 평가(known)를 넘기므로 다시 탐색하지 않는다
      // (실측 2026-09-29: 최강 국면은 3000ms 한 번만).
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
      stopDeepening(); pump(); return promise;
    },
    cancelFocus,
    setMode(next) {
      if (checkMode(next) === mode) return;
      mode = next;
      for (const entry of entries) entry.capped = false;
      if (mode !== "continuous") stopDeepening();
      publish(); pump();
    },
    // 복기에서 보고 있는 국면을 깊게 본다. null 이면 마지막 국면(대국).
    deepen(ply) {
      deepenPly = ply ?? null;
      if (active?.entry !== deepenTarget()) stopDeepening();
      pump();
    },
    setNetwork(bytes, name = networkName) {
      if (status.state === "disabled") return Promise.reject(new Error(status.reason));
      cancelFocus();
      network = bytes; networkName = name;
      networkChange?.resolve();
      networkChange = deferred();
      const promise = networkChange.promise;
      // 다른 신경망으로 만든 저장 평가는 새 평가를 붙잡지 않는다.
      for (const entry of entries) { entry.result = null; entry.error = null; entry.capped = false; entry.known = null; }
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
