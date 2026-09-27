import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { SETUPS, inCheck, kingIdx } from "./engine.js";
import { play as applyMove, undo as undoMove, canUndo, legalMoves } from "./game.js";
import { createStore, exportRecords, importRecords } from "./storage.js";
import { replay } from "./record.js";
import { reviewRows } from "./review.js";
import { GameList, ReviewPanel } from "./Review.jsx";
import { toFen, moveToUci } from "./notation.js";
import { moveDelta, grade } from "./winrate.js";
import { useAnalysis } from "./analysis/useAnalysis.js";
import { engineTurn } from "./analysis/gameAnalysis.js";
import { HintLabels } from "./analysis/HintLabels.jsx";

// ===== React 화면 =====

const S = 60, MG = 40, W = MG * 2 + S * 8, H = MG * 2 + S * 9;
const RAD = { K: 27, R: 23, C: 23, H: 23, E: 23, A: 18, P: 18 };
const GL = { K: { c: "楚", h: "漢" }, R: "車", C: "包", H: "馬", E: "象", A: "士", P: { c: "卒", h: "兵" } };
const glyph = (p) => (typeof GL[p[1]] === "string" ? GL[p[1]] : GL[p[1]][p[0]]);
const NAME = { c: "초(파랑)", h: "한(빨강)" };
const COL = { c: "#1b4a8c", h: "#ae2219" };
const MARK = "#e3a21a";
const oct = (x, y, r) =>
  Array.from({ length: 8 }, (_, k) => {
    const a = Math.PI / 8 + (k * Math.PI) / 4;
    return `${(x + r * Math.cos(a)).toFixed(1)},${(y + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");

function Piece({ p, x, y, selected, lifted }) {
  const r = RAD[p[1]] * (lifted ? 1.12 : 1), col = COL[p[0]];
  const sh = lifted ? 7 : 2.5;
  return (
    <>
      <polygon points={oct(x + sh * 0.6, y + sh, r)} fill="#2a1606" opacity={lifted ? 0.3 : 0.35} />
      <polygon points={oct(x, y, r)} fill="#f8eed7" stroke={col} strokeWidth={selected ? 4.5 : 2.5} />
      {selected && !lifted && <polygon points={oct(x, y, r + 5)} fill="none" stroke={MARK} strokeWidth="3" />}
      <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="central" fontWeight="900" fontSize={Math.round(r * 1.12)} fill={col} fontFamily="serif">
        {glyph(p)}
      </text>
    </>
  );
}

// ---- 승률 분석 (Fairy-Stockfish WASM) ----
function WinBar({ a, status, fen }) {
  const w = a?.win ?? null;
  const note = status.state === "disabled" ? status.reason : status.state === "loading" ? "엔진 준비 중…"
    : status.pending ? `분석 중 (${status.pending}개 남음)` : a ? `깊이 ${a.depth}` : "";
  return (
    <div data-testid="winbar" data-nnue={status.nnue} data-cho-win={w != null ? w.toFixed(1) : ""} data-fen={a ? fen : ""} style={{ margin: "6px 0 4px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700 }}>
        <span style={{ color: COL.c, minWidth: 64 }}>초 {w == null ? "–" : Math.round(w)}%</span>
        <div style={{ flex: 1, height: 10, borderRadius: 5, overflow: "hidden", background: COL.h, opacity: w == null ? 0.25 : 1 }}>
          <div style={{ width: `${w == null ? 50 : w}%`, height: "100%", background: COL.c, transition: "width 300ms" }} />
        </div>
        <span style={{ color: COL.h, minWidth: 64, textAlign: "right" }}>{w == null ? "–" : Math.round(100 - w)}% 한</span>
      </div>
      <div title="평가 점수를 체스 기준 식으로 바꾼 추정치" style={{ fontSize: 11, color: "#65584a", marginTop: 2 }}>
        승률(추정) · {status.nnue === "on" ? "NNUE" : "기본 평가(약함)"} · {note}
      </div>
    </div>
  );
}

export default function Janggi() {
  const [session] = useState(() => {
    const store = createStore();
    return { store, ...store.loadLatest() };
  });
  const [g, setG] = useState(session.state);
  const [controllers, setControllers] = useState(g.controllers);
  const [choSetup, setChoSetup] = useState(g.setups.c);
  const [hanSetup, setHanSetup] = useState(g.setups.h);
  const [level, setLevel] = useState(g.level);
  const [saveError, setSaveError] = useState(session.error);
  const [corrupted, setCorrupted] = useState(session.corrupted);
  const [sel, setSel] = useState(null);
  const [hints, setHints] = useState(false);
  const [focused, setFocused] = useState(null);
  const [moveError, setMoveError] = useState(null);
  const [networkError, setNetworkError] = useState(null);
  const [networkBusy, setNetworkBusy] = useState(false);
  const [showList, setShowList] = useState(false);
  const [listItems, setListItems] = useState([]);
  const [listError, setListError] = useState(null);
  const [review, setReview] = useState(null); // { record, positions, state, k } — 복기 중인 판(읽기 전용)
  const reviewing = !!review;
  const thinking = !g.over && g.controllers[g.turn] === "engine";
  const gRef = useRef(g);
  gRef.current = g;
  // 분석 대상: 복기 중이면 그 판(빈 평가를 자동으로 채운다), 아니면 진행 중인 판.
  const analysis = useAnalysis(review ? review.state : g);
  const { serviceRef } = analysis;

  // 판에 그릴 국면: 진행 중인 판, 또는 복기 중인 판의 k수째.
  const rpos = review && review.positions[review.k];
  const view = review ? { b: rpos.b, last: rpos.last, caps: rpos.caps, turn: rpos.turn, controllers: review.record.controllers, over: null } : g;
  const posState = review ? { b: view.b, turn: view.turn, over: null } : g;
  const flip = view.controllers.h === "human" && view.controllers.c !== "human";
  const xy = (i) => {
    let r = (i / 9) | 0, c = i % 9;
    if (flip) { r = 9 - r; c = 8 - c; }
    return [MG + c * S, MG + r * S];
  };

  // 엔진의 타이머와 탐색은 화면 계층에만 있다. 무르기/새 판은 cleanup으로 취소한다.
  useEffect(() => {
    if (!thinking || reviewing) return; // 복기하는 동안 진행 중인 대국은 멈춘다(최강 엔진이 복기 판 분석을 자기 수로 쓰지 않게).
    let alive = true;
    const run = async () => {
      try {
        const next = await engineTurn(g, serviceRef.current);
        if (alive && gRef.current === g && next) setG({ ...next, slide: true });
      } catch (error) {
        if (alive && gRef.current === g) setMoveError({ game: g, message: error.message });
      }
    };
    const t = g.level === "max" ? null : setTimeout(run, 420);
    if (g.level === "max") void run();
    return () => { alive = false; clearTimeout(t); };
  }, [g, thinking, serviceRef, reviewing]);

  const myTurn = !review && !g.over && g.controllers[g.turn] === "human";
  const canSelect = myTurn || (reviewing && hints); // 복기에서는 훈수 모드일 때 기물을 집어 승률만 본다
  const targets = sel !== null && canSelect ? legalMoves(posState).filter((m) => m[0] === sel) : [];
  const checkKing = !view.over && inCheck(view.b, view.turn) ? kingIdx(view.b, view.turn) : -1;
  // 분석 캐시는 그 캐시의 판에만 저장한다. 복기 판은 목록 순서(가장 최근 판)를 바꾸지 않는다.
  useEffect(() => {
    if (analysis.cacheId === g.id) setSaveError(session.store.save({ ...g, analysis: analysis.cache }).error);
    else if (review && analysis.cacheId === review.state.id && analysis.cache) session.store.save({ ...review.state, analysis: analysis.cache }, { touch: false });
  }, [g, review, analysis.cache, analysis.cacheId, session.store]);

  const fPly = review ? review.k : g.moves.length;
  const fGame = review ? review.state : g;
  const fReady = review ? !!(analysis.evals?.[review.k] || analysis.results?.[review.k]) : !!analysis.current;
  useEffect(() => {
    setFocused(null);
    const service = serviceRef.current;
    if (!hints || sel === null || !canSelect || !fReady || !targets.length) return;
    let alive = true;
    service.focus(fPly, targets.map(moveToUci)).then((candidates) => {
      if (alive && candidates) setFocused({ game: fGame, ply: fPly, sel, candidates });
    });
    return () => { alive = false; service.cancelFocus(); };
  }, [fGame, fPly, sel, hints, canSelect, fReady, serviceRef]);

  async function updateNetwork(file) {
    setNetworkBusy(true); setNetworkError(null);
    try {
      if (file) await serviceRef.current.addNetwork(file);
      else await serviceRef.current.clearNetwork();
    } catch (error) { setNetworkError(error.message); }
    finally { setNetworkBusy(false); }
  }

  // ---- 드래그 & 탭 ----
  const svgRef = useRef(null);
  const [drag, setDrag] = useState(null); // {i, x, y, moved, wasSel}
  const toSvg = (e) => {
    const pt = svgRef.current.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svgRef.current.getScreenCTM().inverse());
  };
  const idxAt = (x, y) => {
    let c = Math.round((x - MG) / S), r = Math.round((y - MG) / S);
    if (c < 0 || c > 8 || r < 0 || r > 9) return null;
    if (Math.hypot(x - (MG + c * S), y - (MG + r * S)) > S * 0.55) return null;
    if (flip) { r = 9 - r; c = 8 - c; }
    return r * 9 + c;
  };
  const movesFrom = (i) => legalMoves(posState).filter((m) => m[0] === i);
  function play(m, slide) { setSel(null); setDrag(null); setG({ ...applyMove(g, m), slide }); }

  function onDown(e) {
    if (!canSelect) return;
    const { x, y } = toSvg(e), i = idxAt(x, y);
    if (i === null) return;
    const t = targets.find((m) => m[1] === i);
    if (t) { if (!review) play(t, true); return; } // 선택 후 목적지를 탭(복기에서는 두지 않는다)
    const p = view.b[i];
    if (p && p[0] === view.turn) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ i, x, y, moved: false, wasSel: sel === i });
      setSel(i);
    } else setSel(null);
  }
  function onMove(e) {
    if (!drag) return;
    const { x, y } = toSvg(e);
    const [ox, oy] = xy(drag.i);
    setDrag({ ...drag, x, y, moved: drag.moved || Math.hypot(x - ox, y - oy) > 10 });
  }
  function onUp(e) {
    if (!drag) return;
    if (drag.moved) {
      const { x, y } = toSvg(e), j = idxAt(x, y);
      const t = j === null ? null : movesFrom(drag.i).find((m) => m[1] === j);
      if (t && !review) { play(t, false); return; } // 끌어다 놓기: 이미 손으로 옮겼으니 슬라이드 생략
    } else if (drag.wasSel) setSel(null);        // 선택된 기물을 다시 탭하면 해제
    setDrag(null);
  }

  // ---- 이동 애니메이션 ----
  const reduce = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [anim, setAnim] = useState(null); // {to, dx, dy, go}
  useLayoutEffect(() => {
    if (reviewing || !g.last || !g.slide || reduce) { setAnim(null); return; }
    const [fx, fy] = xy(g.last[0]), [tx, ty] = xy(g.last[1]);
    setAnim({ to: g.last[1], dx: fx - tx, dy: fy - ty, go: false });
    let r2;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setAnim((a) => a && { ...a, go: true })); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [g.last, g.slide, reviewing]);

  function undo() {
    if (!canUndo(g)) return;
    setSel(null); setDrag(null);
    setG({ ...undoMove(g), slide: false });
  }
  function pass() {
    if (!myTurn || inCheck(g.b, g.turn)) return;
    play("pass", false);
  }
  function setK(to) {
    setSel(null); setDrag(null);
    setReview((r) => r && { ...r, k: Math.max(0, Math.min(r.record.moves.length, typeof to === "function" ? to(r.k) : to)) });
  }
  useEffect(() => {
    if (!reviewing) return;
    const onKey = (e) => {
      if (e.target.closest?.("input, select, textarea")) return;
      const move = { ArrowLeft: (k) => k - 1, ArrowRight: (k) => k + 1, Home: () => 0, End: () => Infinity }[e.key];
      if (move) { e.preventDefault(); setK(move); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reviewing]);
  const refreshList = () => setListItems(session.store.list());
  function toggleList() { if (!showList) refreshList(); setShowList(!showList); setListError(null); }
  function openReview(id) {
    try {
      const record = session.store.load(id);
      const { positions, state } = replay(record);
      setSel(null); setDrag(null); setFocused(null); setListError(null);
      setReview({ record, positions, state, k: 0 });
    } catch (error) { setListError(error.message); }
  }
  function exitReview() { setSel(null); setDrag(null); setReview(null); refreshList(); }
  function download(name, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function exportOne(id) {
    try { download(`janggi-${id}.json`, exportRecords(session.store.records(), id)); } catch (error) { setListError(error.message); }
  }
  function exportAll() {
    try { download(`janggi-all-${new Date().toISOString().slice(0, 10)}.json`, exportRecords(session.store.records())); } catch (error) { setListError(error.message); }
  }
  async function importFile(file) {
    try {
      const checked = importRecords(await file.text(), session.store.list().map((it) => it.id));
      for (const record of checked) session.store.put(record);
      setListError(null);
    } catch (error) { setListError(error.message); }
    refreshList();
  }
  function restart() {
    setSel(null); setDrag(null); setCorrupted(null);
    setG(session.store.newGame({ controllers, level, setups: { c: choSetup, h: hanSetup } }));
  }

  const oneHuman = Object.values(g.controllers).filter((c) => c === "human").length === 1;
  const engineError = moveError?.game === g ? moveError.message
    : thinking && g.level === "max" && analysis.status.state === "disabled" ? analysis.status.reason : null;
  const rows = review ? reviewRows(review.record, review.positions, analysis.evals) : null;
  const status = review ? `복기 중 · ${review.k}/${review.record.moves.length}수`
    : g.over ? g.msg : engineError || (thinking ? "엔진이 생각하는 중…"
    : g.msg || (oneHuman ? `내 차례예요 · ${NAME[g.turn]}` : `${NAME[g.turn]} 차례예요.`));
  const ply = g.moves.length, previous = g.hist.at(-1), evals = analysis.cache?.evals;
  const delta = review ? rows[review.k - 1]?.delta ?? null
    : previous && evals?.[ply - 1] && evals?.[ply] ? moveDelta(evals[ply - 1].win, evals[ply].win, previous.turn) : null;
  const lastSide = review ? rows[review.k - 1]?.side : previous?.turn, lastMove = review ? rows[review.k - 1]?.move : g.moves.at(-1);
  const lastEvaluation = delta === null ? null : `${lastSide === "c" ? "초" : "한"} ${lastMove} ${delta < 0 ? "−" : "+"}${Math.abs(delta).toFixed(0)}%p${grade(delta) ? " " + grade(delta) : ""}`;
  const viewEval = review ? analysis.evals?.[review.k] : analysis.evaluation;
  const candidates = hints ? (review ? analysis.results?.[review.k]?.candidates : analysis.current?.candidates) ?? [] : [];
  const focusCandidates = hints && focused?.game === fGame && focused.ply === fPly && focused.sel === sel ? focused.candidates : [];
  const turnWin = viewEval ? view.turn === "c" ? viewEval.win : 100 - viewEval.win : 50;

  const Tray = ({ side }) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 3, minHeight: 28, alignItems: "center", padding: "2px 4px" }}>
      {view.caps[side].map((p, k) => (
        <span key={k} style={{ display: "inline-grid", placeItems: "center", width: 24, height: 24, borderRadius: 5, background: "#f8eed7", color: COL[p[0]], fontWeight: 900, fontFamily: "serif" }}>
          {glyph(p)}
        </span>
      ))}
    </div>
  );

  const btn = { padding: "10px 8px", borderRadius: 8, background: "#3a2c20", color: "#f8eed7", border: "none", fontSize: 15, cursor: "pointer" };
  const selStyle = { padding: "9px 6px", borderRadius: 8, border: "1.5px solid #4e3118", background: "#e2dccf", color: "#261d15", width: "100%", fontSize: 14 };
  const lab = { display: "grid", gap: 4, fontSize: 12, color: "#65584a" };

  return (
    <div style={{ minHeight: "100vh", background: "#cfc8bb", color: "#261d15", fontFamily: "serif" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "18px 14px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <h1 style={{ fontSize: 32, fontWeight: 900, margin: 0, letterSpacing: "0.05em" }}>장기</h1>
          <div data-testid="status" style={{ fontSize: 16, color: !review && (g.over || engineError || status.includes("장군")) ? COL.h : "#261d15", fontWeight: !review && g.over ? 700 : 400 }}>{status}</div>
        </div>
        {lastEvaluation && <div data-testid="last-evaluation" style={{ fontSize: 13, marginBottom: 4 }}>{lastEvaluation}</div>}
        <div style={{ fontSize: 13, color: "#65584a" }}>초 {view.controllers.c === "human" ? "사람" : "엔진"} · 한 {view.controllers.h === "human" ? "사람" : "엔진"}. 상차림은 초 {(review ? review.record : g).setups.c}, 한 {(review ? review.record : g).setups.h}</div>
        {saveError && <div role="alert" style={{ fontSize: 13, color: COL.h, marginTop: 6 }}>{saveError}</div>}
        {corrupted && <div role="status" style={{ fontSize: 13, color: COL.h, marginTop: 6 }}>최근 기보 손상됨 — 새 게임을 시작했어요.</div>}
        <WinBar a={viewEval} status={analysis.status} fen={toFen(view.b, view.turn)} />
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 5 }}>
          <input type="checkbox" checked={hints} onChange={(e) => setHints(e.target.checked)} />후보 수 보기
        </label>
        {hints && <div style={{ fontSize: 12, color: "#65584a", marginTop: 4 }}>
          {view.turn === "c" ? "초" : "한"}가 둘 수 · 두는 쪽 승률
          <ol data-testid="candidates" style={{ display: "flex", flexWrap: "wrap", gap: "4px 20px", paddingLeft: 20, margin: "4px 0" }}>
            {candidates.map((candidate) => <li key={candidate.move}>{candidate.move === "pass" ? "쉬기" : candidate.move} {Math.round(candidate.win)}%</li>)}
          </ol>
        </div>}
        <Tray side={flip ? "c" : "h"} />
        <div style={{ borderRadius: 10, overflow: "hidden", boxShadow: "0 10px 30px rgba(40,20,5,.35)" }}>
          <svg ref={svgRef} data-fen={toFen(view.b, view.turn)} viewBox={`0 0 ${W} ${H}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)} style={{ display: "block", width: "100%", height: "auto", userSelect: "none", touchAction: "none", cursor: canSelect ? "pointer" : "default" }}>
            <defs>
              <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#d6ab66" />
                <stop offset="1" stopColor="#c19050" />
              </linearGradient>
            </defs>
            <rect width={W} height={H} fill="url(#wood)" />
            {Array.from({ length: 10 }, (_, r) => (
              <line key={"r" + r} x1={MG} y1={MG + r * S} x2={MG + 8 * S} y2={MG + r * S} stroke="#4e3118" strokeWidth="1.6" />
            ))}
            {Array.from({ length: 9 }, (_, c) => (
              <line key={"c" + c} x1={MG + c * S} y1={MG} x2={MG + c * S} y2={MG + 9 * S} stroke="#4e3118" strokeWidth="1.6" />
            ))}
            {[0, 7].map((t) => (
              <g key={"p" + t} stroke="#4e3118" strokeWidth="1.6">
                <line x1={MG + 3 * S} y1={MG + t * S} x2={MG + 5 * S} y2={MG + (t + 2) * S} />
                <line x1={MG + 5 * S} y1={MG + t * S} x2={MG + 3 * S} y2={MG + (t + 2) * S} />
              </g>
            ))}
            {view.last && view.last.map((i, k) => {
              const [x, y] = xy(i);
              return <circle key={"l" + k} cx={x} cy={y} r="29" fill="none" stroke={MARK} strokeWidth="3.5" strokeDasharray={k === 0 ? "5 5" : undefined} />;
            })}
            {view.b.map((p, i) => {
              if (!p) return null;
              const [x, y] = xy(i);
              const moving = drag && drag.moved && drag.i === i;
              const sliding = anim && anim.to === i;
              const style = sliding
                ? { transform: anim.go ? "translate(0px,0px)" : `translate(${anim.dx}px,${anim.dy}px)`, transition: anim.go ? "transform 320ms cubic-bezier(.3,.7,.3,1)" : "none" }
                : undefined;
              return (
                <g key={"pc" + i} style={style} opacity={moving ? 0.3 : 1}>
                  {i === checkKing && <circle cx={x} cy={y} r={RAD[p[1]] + 7} fill={COL.h} opacity=".45" />}
                  <Piece p={p} x={x} y={y} selected={i === sel} />
                </g>
              );
            })}
            {targets.map((m) => {
              const [x, y] = xy(m[1]);
              return view.b[m[1]] ? (
                <circle key={"t" + m[1]} cx={x} cy={y} r="31" fill="none" stroke={MARK} strokeWidth="4" />
              ) : (
                <circle key={"t" + m[1]} cx={x} cy={y} r="9" fill={MARK} />
              );
            })}
            {drag && drag.moved && view.b[drag.i] && (
              <g style={{ pointerEvents: "none" }}>
                <Piece p={view.b[drag.i]} x={drag.x} y={drag.y} selected lifted />
              </g>
            )}
            {hints && <HintLabels candidates={candidates} focused={focusCandidates} targets={targets} turnWin={turnWin}
              passSquare={kingIdx(view.b, view.turn)} hovered={drag?.moved ? idxAt(drag.x, drag.y) : null} xy={xy} />}
          </svg>
        </div>
        <Tray side={flip ? "h" : "c"} />
        {review ? <ReviewPanel rows={rows} k={review.k} n={review.record.moves.length} setK={setK} evals={analysis.evals} onExit={exitReview} /> : <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginTop: 10 }}>
          <button style={{ ...btn, opacity: canUndo(g) ? 1 : 0.4 }} disabled={!canUndo(g)} onClick={undo}>무르기</button>
          <button style={{ ...btn, opacity: myTurn && !inCheck(g.b, g.turn) ? 1 : 0.4 }} disabled={!myTurn || inCheck(g.b, g.turn)} onClick={pass}>한 수 쉬기</button>
          <button style={btn} onClick={restart}>새 게임</button>
        </div>
        <button style={{ ...btn, width: "100%", marginTop: 8, background: showList ? "#5a4636" : btn.background }} aria-expanded={showList} onClick={toggleList}>기보</button>
        {showList && <GameList items={listItems} liveId={g.id} onOpen={openReview} onExport={exportOne} onExportAll={exportAll} onImport={importFile} error={listError} />}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8, marginTop: 10 }}>
          {["c", "h"].map((side) => <label key={side} style={lab}>{NAME[side]}
            <select aria-label={NAME[side]} style={selStyle} value={controllers[side]} onChange={(e) => setControllers({ ...controllers, [side]: e.target.value })}>
              <option value="human">사람</option>
              <option value="engine">엔진</option>
            </select>
          </label>)}
          <label style={lab}>난이도
            <select aria-label="난이도" style={selStyle} value={level} onChange={(e) => setLevel(e.target.value === "max" ? "max" : +e.target.value)}>
              <option value={2}>쉬움</option>
              <option value={3}>보통</option>
              <option value={4}>어려움</option>
              <option value="max" disabled={analysis.status.state !== "ready"}>최강</option>
            </select>
            {analysis.status.state !== "ready" && <span>최강: {analysis.status.reason || "엔진 준비 중…"}</span>}
          </label>
          <label style={lab}>초(파랑) 상차림
            <select aria-label="초(파랑) 상차림" style={{ ...selStyle, color: COL.c }} value={choSetup} onChange={(e) => setChoSetup(e.target.value)}>
              {Object.keys(SETUPS).map((k) => <option key={k}>{k}</option>)}
            </select>
          </label>
          <label style={lab}>한(빨강) 상차림
            <select aria-label="한(빨강) 상차림" style={{ ...selStyle, color: COL.h }} value={hanSetup} onChange={(e) => setHanSetup(e.target.value)}>
              {Object.keys(SETUPS).map((k) => <option key={k}>{k}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 12, fontSize: 12 }}>
          <label style={{ ...btn, fontSize: 13, cursor: networkBusy ? "wait" : "pointer" }}>
            신경망 넣기
            <input aria-label="신경망 넣기" type="file" accept=".nnue" disabled={networkBusy} style={{ display: "none" }}
              onChange={(e) => { const file = e.target.files[0]; e.target.value = ""; if (file) void updateNetwork(file); }} />
          </label>
          <button style={{ ...btn, fontSize: 13 }} disabled={networkBusy} onClick={() => updateNetwork(null)}>신경망 지우기</button>
          <a href="https://fairy-stockfish.github.io/nnue/" target="_blank" rel="noreferrer" style={{ color: COL.c }}>신경망 받는 곳</a>
          {networkBusy && <span>신경망 적용 중…</span>}
        </div>
        {networkError && <div role="alert" style={{ fontSize: 13, color: COL.h, marginTop: 6 }}>{networkError}</div>}
        </>}
        <p style={{ fontSize: 13, color: "#65584a", marginTop: 12, lineHeight: 1.6 }}>
          설정을 바꾼 뒤 새 게임을 누르면 적용돼요. 상차림은 각 편이 자기 쪽에서 바라본 왼쪽부터 읽어요. 파랑(초)이 먼저 둡니다. 빅장과 점수 판정은 없고 외통수로 승부가 납니다.
        </p>
      </div>
    </div>
  );
}
