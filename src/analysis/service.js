// One UCI engine, an ordered position queue, a lower-priority cancellable focus search,
// and (in continuous mode) an idle, preemptible deepening search of the viewed ply.
// No browser/WASM dependencies: createEngine supplies { postMessage, addMessageListener, FS }.
import { uciToMove, moveToUci } from "../notation.js";
import { winFromScore } from "../winrate.js";

function info(line) {
  const score = /\bscore (cp|mate) (-?\d+)/.exec(line);
  const pv = /\bpv (\S+)/.exec(line), depth = /\bdepth (\d+)/.exec(line);
  const move = pv && uciToMove(pv[1]);
  if (!score || !depth || (!move && !(score[1] === "mate" && Number(score[2]) === 0))) return null;
  const value = { [score[1]]: Number(score[2]) };
  // bound: lowerbound/upperbound — 정확하지 않은 점수. 평가(1순위)에는 쓰지 않고, 후보 묶음에서는 그 점수로 쓴다.
  // 후보마다 그 줄의 깊이: 2단계 목록은 깊이가 다른 점수를 섞으므로 숨기지 않는다(개정 2.10).
  return { rank: Number(/\bmultipv (\d+)/.exec(line)?.[1] ?? 1), depth: Number(depth[1]),
    score: value, win: winFromScore(value), bound: /\b(?:lowerbound|upperbound)\b/.test(line),
    candidate: move ? { move: moveToUci(move), ...value, win: winFromScore(value), depth: Number(depth[1]) } : null };
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
// 감시 타이머는 탐색 시간 + RESPONSE_TIMEOUT: 20초 깊게 보기가 "응답 없음"으로 끝나지 않게.
const RESPONSE_TIMEOUT = 15000, NETWORK_TIMEOUT = 20000;
// 무제한(go infinite) 깊게 보기의 감시: PROBE_INTERVAL 마다 isready 를 보내 RESPONSE_TIMEOUT 안에 readyok 가 없으면 실패.
// 엔진 줄 간격으로는 감시할 수 없다 — 깊이가 깊어질수록 한 반복의 첫 수를 읽는 동안 줄이 없다. 실측(2026-09-30, M3 Max,
// WASM 1.1.12 Node, 중반 국면, MultiPV 1, 신경망 없음, Hash 256): 5분에 가장 긴 간격 1스레드 97.6초·4스레드 68.1초,
// 30분에는 622.6초·351.8초까지 벌어졌다. 탐색 중 isready 의 readyok 는 0.3~0.4ms 에 왔다.
const PROBE_INTERVAL = 30000;
export const MODES = ["fast", "deep", "continuous"];
// 카카오식 반복수를 아는 변형: janggicasual(빅장·점수 판정 없음) + 반복 금지. janggicasual 은 반복을 무승부로 읽어서
// 지고 있는 쪽이 반복으로 버틸 수 있다고 계산했다(사용자 보고 2026-09-29). nFoldRule 4 는 FSF janggimodern 과 같다
// (반복 금지보다 n번 반복 무승부가 먼저 걸리지 않게). 수순은 gameAnalysis.enginePositions 가 붙인다.
export const KAKAO = { name: "janggikakao", path: "/janggi-kakao.ini",
  ini: "[janggikakao:janggicasual]\nmoveRepetitionIllegal = true\nnFoldRule = 4\n" };
export const MOVETIME = { fast: 800, deep: 3000, continuous: 800, deepen: 20000, max: 3000, focus: 500 };
// 저장된 판 복기의 2단계 깊게 보기 상한(개정 2.10). 무제한은 Infinity(go infinite). 1분 이상이면 Hash 256.
export const DEEP_CAPS = [20000, 60000, 300000, Infinity];
const LONG_CAP = 60000, LONG_HASH = 256;
// 엔진이 반복하는 마지막 깊이(MAX_PLY − 1). 강제 외통에서 go infinite 는 이 깊이를 끝내고 stop 까지 코어 하나를 돌리며
// 기다린다(실측 2026-09-30, WASM 1.1.12 Node: 외통 3수 4스레드 0.28초·외통 1수 1스레드 0.01초에 245, 그 뒤 줄 없이 CPU 100%).
const ENGINE_MAX_DEPTH = 245;
function checkMode(mode) {
  if (!MODES.includes(mode)) throw new Error(`알 수 없는 분석 모드예요: ${mode}`);
  return mode;
}
function checkCap(cap) {
  if (cap !== null && !DEEP_CAPS.includes(cap)) throw new Error(`알 수 없는 깊게 보기 상한이에요: ${cap}`);
  return cap;
}
// 저장된 신경망 불러오기(Cache Storage·dev fetch)가 끝나지 않아도 기본 평가로 시작한다.
const settleWithin = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

export function createAnalysisService({ createEngine, loadNetwork = async () => null,
  networkName = "janggi-9991472750de.nnue", onResult = () => {}, onStatus = () => {}, onReset = () => {},
  threads = 1, hash = 32, mode = "fast" }) {
  checkMode(mode);
  // deepenPly: 깊게 볼 국면(null 이면 마지막 국면). capped: 깊게 보기를 끝낸 국면 — 상한까지 다 읽었거나, 멈춤(haltDeepen)이나
  // 엔진의 마지막 깊이로 끝났다. 다시 깊게 보지 않는다(모드·상한·신경망을 바꾸면 푼다).
  // deepCap: null 이면 지금 "계속"(MultiPV 5 · 20초), 값이 있으면 저장된 판 복기의 2단계(MultiPV 1 · 그 상한).
  // engineHash: 엔진에 마지막으로 보낸 Hash. 원하는 값(wantedHash)과 다르면 탐색이 멈춘 뒤 pump 가 바꾼다.
  let engine, listener, gameId, entries = [], active = null, focus = null, deepenPly = null, deepCap = null, engineHash = null;
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
  // Hash 256 은 긴 상한의 2단계가 실제로 돌 수 있는 동안만(계속 모드): WASM 메모리는 한 번 늘면 줄지 않는다.
  const wantedHash = () => (mode === "continuous" && deepCap !== null && deepCap >= LONG_CAP ? LONG_HASH : hash);
  function watch(ms) {
    const gen = generation;
    clearTimeout(timer);
    timer = setTimeout(() => { if (gen === generation) void fail(new Error("엔진 탐색 응답 시간이 초과됐어요.")); }, ms);
  }
  // 무제한 탐색의 탐침: 그 탐색이 달리는 동안(멈추지 않았고 bestmove 전) PROBE_INTERVAL 마다 isready 하나. 예약은 공용
  // timer 라 stop(→ bestmove 기한)·bestmove·실패가 지운다. 멈춘 뒤에 온 답은 다시 예약하지 않는다(그 기한을 지우지 않게).
  function probe(job) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const gen = generation;
      exchange("isready", "readyok").then(() => { if (gen === generation && active === job && !job.cancelled) probe(job); },
        (error) => { if (gen === generation) void fail(error); });
    }, PROBE_INTERVAL);
  }
  function exchange(command, response) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error("엔진 응답 시간이 초과됐어요.")), RESPONSE_TIMEOUT);
      const finish = (error) => {
        clearTimeout(timeout); waiters.delete(waiter);
        if (error) reject(error); else resolve();
      };
      // 응답 줄은 그것을 기다리는 가장 오래된 대기자 하나만 가져간다(엔진은 받은 순서대로 답한다): 탐침의 readyok 가
      // 뒤이은 신경망·Hash 변경의 isready 를 대신 확인하지 않게.
      const waiter = { receive: (line) => line === response && (finish(), true), reject: finish };
      waiters.add(waiter);
      try { send(command); } catch (error) { finish(error); }
    });
  }
  function stop() {
    if (active && !active.cancelled) {
      active.cancelled = true;
      // 2단계는 멈춘 뒤 bestmove 를 RESPONSE_TIMEOUT 안에 받아야 한다: 무제한은 상한이 없고, 5분 상한을 기다릴 까닭도 없다
      // (무제한의 다음 탐침은 이것이 지운다). 진행 중인 판의 깊게 보기(cap 없음)는 지금처럼 시작 때의 20초 + 15초.
      if (active.cap !== undefined) watch(RESPONSE_TIMEOUT);
      try { send("stop"); } catch (error) { void fail(error); }
    }
  }
  const stopDeepening = () => { if (active?.deepen) { stop(); publish(); } };
  const deepenTarget = () => {
    const entry = deepenPly === null ? entries.at(-1) : entries.find((e) => e.ply === deepenPly);
    // 최강 차례는 깊게 보지 않는다(그 탐색이 곧 엔진의 수다). 1차 분석이 끝난 국면만. 끝난 국면(mate 0, 둘 수 없음)은
    // 2단계로 보지 않는다: 엔진이 go infinite 에서 stop 을 기다리며 코어 하나를 계속 돌린다(실측, 개정 2.10).
    return mode === "continuous" && entry?.result && !entry.max && !entry.error && !entry.capped &&
      (deepCap === null || entry.result.mate !== 0) ? entry : null;
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
  // 신경망 교체·Hash 변경: 탐색이 멈춰 있을 때만(pump 가 active 없을 때 부른다), 끝나면 isready 로 확인한다.
  async function configure() {
    configuring = true;
    const change = networkChange, gen = generation;
    try {
      if (change) writeNetwork();
      if (wantedHash() !== engineHash) { engineHash = wantedHash(); send(`setoption name Hash value ${engineHash}`); }
      await exchange("isready", "readyok");
      if (disposed || gen !== generation) return;
      if (change && networkChange === change) networkChange = null;
      configuring = false; change?.resolve();
      publish(); pump();
    } catch (error) { if (gen === generation) void fail(error); }
  }
  function pump() {
    if (!available || disposed || active || configuring) return;
    if (networkChange || wantedHash() !== engineHash) { void configure(); return; }
    // 최강 엔진 차례는 밀린 지난 국면 분석보다 먼저 탐색한다(엔진이 수십 초 기다리지 않게). 나머지는 순서대로.
    const open = (e) => !e.result && !e.error;
    // 우선순위: 최강 > 밀린 국면 > 초점 > 깊게 보기(할 일이 없을 때만).
    const entry = entries.find((e) => e.max && open(e)) ?? entries.find(open);
    const target = !entry && !focus && deepenTarget();
    if (!entry && !focus && !target) return;
    // 2단계(cap): 저장된 판 복기의 깊게 보기. 1단계 후보는 그대로 두고 1순위만 그 상한까지 MultiPV 1 로 읽는다. 1단계 후보가
    // 없는 국면(저장된 평가만 있는 cached)은 먼저 보통 분석(1단계, MultiPV 5)을 한 번 돈다 — 목록 다섯 개(Task 1 리뷰).
    const pass = entry ?? (target && deepCap !== null && !target.first ? target : null);
    const job = pass ? { entry: pass, movetime: pass.max ? MOVETIME.max : MOVETIME[mode] }
      : focus ? { entry: focus.entry, focus, movetime: MOVETIME.focus }
      : { entry: target, deepen: true, movetime: deepCap ?? MOVETIME.deepen, ...(deepCap !== null ? { cap: deepCap } : {}) };
    active = { ...job, gameId, mode, lines: new Map(), cancelled: false };
    // 무제한은 끝이 없으므로 isready 탐침으로 감시한다. 상한이 있으면 상한 + 여유.
    if (job.movetime === Infinity) probe(active); else watch(job.movetime + RESPONSE_TIMEOUT);
    try {
      // 최강 수와 2단계는 MultiPV 1: 후보 5개를 함께 탐색하면 최선수에 쓸 시간이 나뉘어 약해진다(리뷰, 개정 2.10 실측).
      send(`setoption name MultiPV value ${job.focus ? job.focus.moves.length : (job.entry.max || job.cap !== undefined) ? 1 : 5}`);
      send(job.entry.position ?? `position fen ${job.entry.fen}`);
      // 반복수로 막힌 수가 있는 국면은 루트 수를 제한한다(searchmoves). 초점 분석은 원래 그 기물의 수만 본다.
      const roots = job.focus ? job.focus.moves : job.entry.searchmoves;
      send(`go ${job.movetime === Infinity ? "infinite" : `movetime ${job.movetime}`}${roots ? " searchmoves " + roots.join(" ") : ""}`);
      publish();
    } catch (error) { void fail(error); }
  }
  // 두는 쪽 기준 UCI 점수를 초 기준 결과로 바꾼다.
  function resultOf(job, primary, candidates, best) {
    const { entry } = job, sign = entry.turn === "c" ? 1 : -1, score = primary.score;
    const kind = score.cp !== undefined ? "cp" : "mate";
    return { gameId: job.gameId, fen: entry.fen, ply: entry.ply,
      [kind]: score[kind] * sign || 0, win: sign === 1 ? primary.win : 100 - primary.win,
      depth: primary.depth, candidates, best, nnue: status.nnue, movetime: job.movetime === Infinity ? "infinite" : job.movetime,
      mode: job.mode, threads, ...(job.cap !== undefined ? { deepCap: job.cap, stable: entry.stable?.n ?? 1 } : {}) };
  }
  // 기보에 저장된 평가(known)가 더 깊으면 평가는 그대로 두고 후보 수·최선수만 새로 쓴다: 마지막 국면은 후보 때문에
  // 항상 다시 탐색하는데, 새로고침·복기 전환 뒤의 0.8초 결과가 "계속"으로 깊게 읽어 둔 평가를 덮어쓰지 않게(리뷰 A F1).
  function keepDeeper(known, result) {
    if (!known || !(known.depth > result.depth)) return result;
    const { cp, mate, ...rest } = result;
    return { ...rest, ...(known.cp !== undefined ? { cp: known.cp } : { mate: known.mate }), win: known.win, depth: known.depth };
  }
  // 순위별 마지막 줄 → 후보(순위순). 엔진은 반복(깊이)마다 1~N순위를 한 묶음으로 다 찍고 한 묶음 안의 수는 서로 다르다. 그때 보던
  // 순위 한 줄은 lowerbound/upperbound 로 올 수 있다(멈출 때만이 아니라 끝난 반복에서도). 그 줄을 버리면 이전 묶음의 수가 남아
  // 같은 수가 겹쳐 후보가 빠졌다(e2e 12번 중 1번) → bound 줄도 그 점수로 넣는다. 그러면 순위별 마지막 줄이 곧 마지막 묶음이다
  // (리뷰 실측 366회: 마지막 묶음은 늘 순위가 다 있고 1순위가 bestmove). 1순위가 평가 줄(primary)과 같은 수면 평가 줄을 쓴다:
  // 1순위가 bound 여도 목록과 승률 막대가 같게. 겹침 제거는 묶음이 덜 찍힌 경우를 위한 안전장치다.
  const candidatesOf = (lines, primary) => [...lines].sort(([a], [b]) => a - b)
    .map(([rank, v]) => (rank === 1 && primary?.candidate && v.candidate?.move === primary.candidate.move ? primary : v).candidate)
    .filter(Boolean).filter((c, i, all) => all.findIndex((x) => x.move === c.move) === i);
  // 2단계 후보: 2단계의 1순위(평가 줄) + 1단계 목록에서 그 수를 뺀 것(1단계 순서·값·깊이 그대로). 1단계는 MultiPV 5 라
  // 1순위가 1단계 5개 밖의 수면 1단계 5순위가 빠진다(2~5순위 = 1단계, 개정 2.10). 1단계가 없으면(저장된 평가만) 1순위 하나.
  const mergedCandidates = (first, primary) =>
    [primary.candidate, ...(first ?? []).filter((c) => c.move !== primary.candidate?.move)].filter(Boolean).slice(0, 5);
  // 같은 수 N깊이째: 2단계의 정확한 1순위 줄이 센 깊이보다 깊으면 같은 수는 N+1, 다른 수는 1. 같은 깊이에 다른 수가 오면 1.
  // 국면(entry)에 두어 선점 뒤 다시 시작한 탐색도 보여준 깊이에서 이어 센다(얕은 줄은 세지 않는다).
  function countStable(entry, parsed) {
    const move = parsed.candidate?.move, last = entry.stable;
    if (!last || parsed.depth > last.depth) entry.stable = { depth: parsed.depth, move, n: last?.move === move ? last.n + 1 : 1 };
    else if (parsed.depth === last.depth && move !== last.move) entry.stable = { depth: parsed.depth, move, n: 1 };
  }
  function receive(line) {
    if (typeof line !== "string") { void fail(line); return; }
    for (const waiter of [...waiters]) if (waiter.receive(line)) break;
    if (active && !active.cancelled && line.startsWith("info string NNUE evaluation using")) {
      status = { ...status, nnue: "on" }; publish();
    } else if (active && !active.cancelled && line.startsWith("info string classical evaluation")) {
      status = { ...status, nnue: "off" }; publish();
    }
    if (!active) return;
    const parsed = info(line);
    if (parsed) {
      active.lines.set(parsed.rank, parsed); active.ranks = Math.max(active.ranks ?? 0, parsed.rank);
      if (parsed.rank === 1 && !parsed.bound) {
        active.primary = parsed; // 평가(점수·깊이)는 가장 최근의 정확한 1순위 줄
        if (active.cap !== undefined && !active.cancelled) countStable(active.entry, parsed);
      }
    }
    // 깊게 보기는 점진 결과: 묶음의 마지막 순위가 왔을 때, 1순위가 지금 보여준 결과보다 깊을 때만 보낸다
    // (선점 뒤 다시 시작한 얕은 탐색이 표시를 되돌리지 않게). 2단계(MultiPV 1)는 묶음이 1순위 한 줄이라 정확한 1순위 줄마다다.
    const primary = active.primary;
    if (parsed && parsed.rank === active.ranks && active.deepen && !active.cancelled && primary?.depth > active.entry.result.depth) {
      const candidates = active.cap !== undefined ? mergedCandidates(active.entry.first, primary) : candidatesOf(active.lines, primary);
      active.entry.result = resultOf(active, primary, candidates, primary.candidate ? uciToMove(primary.candidate.move) : null);
      onResult(active.entry.result);
    }
    // 무제한이 엔진의 마지막 깊이를 끝냈으면 더 읽을 것이 없다: 엔진은 stop 까지 코어를 돌리며 기다리므로 다 읽은 것으로 멈춘다.
    if (active.movetime === Infinity && !active.cancelled && parsed && parsed === active.primary && parsed.depth >= ENGINE_MAX_DEPTH) {
      active.entry.capped = true; stopDeepening();
    }
    if (!line.startsWith("bestmove ")) return;
    clearTimeout(timer);
    const job = active;
    active = null;
    if (job.deepen) {
      if (!job.cancelled) job.entry.capped = true; // 상한까지 다 읽었다(선점으로 멈춘 것은 나중에 이어서 본다)
    } else if (!job.cancelled) {
      const candidates = candidatesOf(job.lines, job.primary);
      if (job.focus) {
        focus = null;
        job.focus.resolve(candidates.filter((c) => job.focus.moves.includes(c.move)));
      } else {
        const { entry, primary } = job, best = uciToMove(line.split(/\s+/)[1]);
        if (entry.max && !best) {
          entry.error = new Error("최강 엔진의 수를 읽을 수 없어요.");
          settle(entry, null, entry.error);
        } else if (!primary) {
          void fail(new Error("엔진이 평가 점수를 보내지 않았어요.")); return;
        } else {
          entry.result = keepDeeper(entry.known, resultOf(job, primary, candidates, best));
          entry.first = candidates; // 1단계 후보: 2단계 결과가 entry.result 를 덮어도 목록의 2~5순위로 쓴다
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
      engineHash = wantedHash();
      send(`setoption name Hash value ${engineHash}`);
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
    // 복기에서 보고 있는 국면을 깊게 본다. null 이면 마지막 국면(대국). cap: null 이면 지금 "계속"(진행 중인 판과 그 복기),
    // 20000·60000·300000·Infinity 면 저장된 판 복기의 2단계. 상한이 바뀌면 다 읽은 국면을 풀고 달리는 깊게 보기를 새 상한으로 다시 본다.
    deepen(ply, cap = null) {
      const capChanged = checkCap(cap) !== deepCap;
      deepenPly = ply ?? null; deepCap = cap;
      if (capChanged) for (const entry of entries) entry.capped = false;
      if (capChanged || active?.entry !== deepenTarget()) stopDeepening();
      pump();
    },
    // 멈춤: 달리는 깊게 보기를 멈추고 그 국면을 다 읽은 것으로 친다(결과는 남는다, 상한을 바꾸면 다시 본다).
    haltDeepen() {
      if (!active?.deepen || active.cancelled) return;
      active.entry.capped = true;
      stopDeepening();
    },
    setNetwork(bytes, name = networkName) {
      if (status.state === "disabled") return Promise.reject(new Error(status.reason));
      cancelFocus();
      network = bytes; networkName = name;
      networkChange?.resolve();
      networkChange = deferred();
      const promise = networkChange.promise;
      // 다른 신경망으로 만든 저장 평가는 새 평가를 붙잡지 않는다.
      for (const entry of entries) {
        entry.result = null; entry.error = null; entry.capped = false; entry.known = null; entry.first = null; entry.stable = null;
      }
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
