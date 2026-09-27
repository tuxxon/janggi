import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { SETUPS, inCheck, kingIdx, bestMove } from "./engine.js";
import { play as applyMove, undo as undoMove, canUndo, legalMoves } from "./game.js";
import { createStore } from "./storage.js";
import { toFen } from "./notation.js";
import { choWin } from "./winrate.js";
import { createAnalyzer } from "./analysis/fsf.js";

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
let analyzerP = null;
const getAnalyzer = () => (analyzerP ??= createAnalyzer());

function useAnalysis(b, turn, over) {
  const [res, setRes] = useState(null); // { fen, score, win, depth, nnue } | { err }
  const fen = toFen(b, turn);
  useEffect(() => {
    if (over) return;
    let alive = true;
    getAnalyzer()
      .then((a) => a.analyze(fen, 800))
      .then((r) => { if (alive && r) setRes({ fen, score: r.score, win: choWin(r.score, turn), depth: r.depth, nnue: r.nnue, nnueError: r.nnueError }); })
      .catch((e) => { if (alive) setRes({ err: e.message }); });
    return () => { alive = false; };
  }, [fen, over]);
  return res;
}

function WinBar({ a }) {
  const w = a && a.win != null ? a.win : null;
  const note = !a ? "엔진 준비 중…" : a.err ? a.err : a.nnue === "on" ? `NNUE · 깊이 ${a.depth}` : `NNUE 없음(약한 평가)${a.nnueError ? " · " + a.nnueError : ""}`;
  return (
    <div data-testid="winbar" data-nnue={a?.nnue ?? "loading"} data-cho-win={w != null ? w.toFixed(1) : ""} data-fen={a?.fen ?? ""} style={{ margin: "6px 0 4px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700 }}>
        <span style={{ color: COL.c, minWidth: 64 }}>초 {w == null ? "–" : Math.round(w)}%</span>
        <div style={{ flex: 1, height: 10, borderRadius: 5, overflow: "hidden", background: COL.h, opacity: w == null ? 0.25 : 1 }}>
          <div style={{ width: `${w == null ? 50 : w}%`, height: "100%", background: COL.c, transition: "width 300ms" }} />
        </div>
        <span style={{ color: COL.h, minWidth: 64, textAlign: "right" }}>{w == null ? "–" : Math.round(100 - w)}% 한</span>
      </div>
      <div style={{ fontSize: 11, color: "#65584a", marginTop: 2 }}>승률(추정) · {note}</div>
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
  const thinking = !g.over && g.controllers[g.turn] === "engine";
  const gRef = useRef(g);
  gRef.current = g;

  const flip = g.controllers.h === "human" && g.controllers.c !== "human";
  const xy = (i) => {
    let r = (i / 9) | 0, c = i % 9;
    if (flip) { r = 9 - r; c = 8 - c; }
    return [MG + c * S, MG + r * S];
  };

  // 엔진의 타이머와 탐색은 화면 계층에만 있다. 무르기/새 판은 cleanup으로 취소한다.
  useEffect(() => {
    if (!thinking) return;
    const t = setTimeout(() => {
      if (gRef.current !== g) return;
      const m = bestMove(g.b.slice(), g.turn, g.level);
      setG({ ...applyMove(g, m ?? "pass"), slide: true });
    }, 420);
    return () => clearTimeout(t);
  }, [g, thinking]);

  const myTurn = !g.over && g.controllers[g.turn] === "human";
  const targets = sel !== null && myTurn ? legalMoves(g).filter((m) => m[0] === sel) : [];
  const checkKing = !g.over && inCheck(g.b, g.turn) ? kingIdx(g.b, g.turn) : -1;
  const analysis = useAnalysis(g.b, g.turn, g.over);
  const cacheRef = useRef({ id: g.id, analysis: g.analysis });

  // 분석 캐시 변경은 엔진 타이머를 다시 시작하지 않는다. 현재 판과 일치하는 결과만 저장한다.
  useEffect(() => {
    if (cacheRef.current.id !== g.id) cacheRef.current = { id: g.id, analysis: g.analysis };
    let cache = cacheRef.current.analysis;
    const ply = g.moves.length;
    if (cache) cache = { ...cache, evals: cache.evals.slice(0, ply + 1) };
    if (analysis?.score && analysis.fen === toFen(g.b, g.turn)) {
      const engine = `fairy-stockfish-nnue.wasm 1.1.12 janggicasual nnue=${analysis.nnue === "on" ? "janggi-9991472750de" : "off"} movetime=800`;
      const evals = cache?.engine === engine ? [...cache.evals] : [];
      while (evals.length <= ply) evals.push(null);
      const kind = analysis.score.cp != null ? "cp" : "mate";
      evals[ply] = { ply, [kind]: analysis.score[kind] * (g.turn === "c" ? 1 : -1), win: analysis.win, depth: analysis.depth };
      cache = { engine, evals };
    }
    cacheRef.current.analysis = cache;
    setSaveError(session.store.save({ ...g, analysis: cache }).error);
  }, [g, analysis, session.store]);

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
  const movesFrom = (i) => legalMoves(g).filter((m) => m[0] === i);
  function play(m, slide) { setSel(null); setDrag(null); setG({ ...applyMove(g, m), slide }); }

  function onDown(e) {
    if (!myTurn) return;
    const { x, y } = toSvg(e), i = idxAt(x, y);
    if (i === null) return;
    const t = targets.find((m) => m[1] === i);
    if (t) { play(t, true); return; }           // 선택 후 목적지를 탭
    const p = g.b[i];
    if (p && p[0] === g.turn) {
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
      if (t) { play(t, false); return; }         // 끌어다 놓기: 이미 손으로 옮겼으니 슬라이드 생략
    } else if (drag.wasSel) setSel(null);        // 선택된 기물을 다시 탭하면 해제
    setDrag(null);
  }

  // ---- 이동 애니메이션 ----
  const reduce = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [anim, setAnim] = useState(null); // {to, dx, dy, go}
  useLayoutEffect(() => {
    if (!g.last || !g.slide || reduce) { setAnim(null); return; }
    const [fx, fy] = xy(g.last[0]), [tx, ty] = xy(g.last[1]);
    setAnim({ to: g.last[1], dx: fx - tx, dy: fy - ty, go: false });
    let r2;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setAnim((a) => a && { ...a, go: true })); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [g.last, g.slide]);

  function undo() {
    if (!canUndo(g)) return;
    setSel(null); setDrag(null);
    setG({ ...undoMove(g), slide: false });
  }
  function pass() {
    if (!myTurn || inCheck(g.b, g.turn)) return;
    play("pass", false);
  }
  function restart() {
    setSel(null); setDrag(null); setCorrupted(null);
    setG(session.store.newGame({ controllers, level, setups: { c: choSetup, h: hanSetup } }));
  }

  const oneHuman = Object.values(g.controllers).filter((c) => c === "human").length === 1;
  const status = g.over ? g.msg : thinking ? "엔진이 생각하는 중…"
    : g.msg || (oneHuman ? `내 차례예요 · ${NAME[g.turn]}` : `${NAME[g.turn]} 차례예요.`);

  const Tray = ({ side }) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 3, minHeight: 28, alignItems: "center", padding: "2px 4px" }}>
      {g.caps[side].map((p, k) => (
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
          <div style={{ fontSize: 16, color: g.over || status.includes("장군") ? COL.h : "#261d15", fontWeight: g.over ? 700 : 400 }}>{status}</div>
        </div>
        <div style={{ fontSize: 13, color: "#65584a" }}>초 {g.controllers.c === "human" ? "사람" : "엔진"} · 한 {g.controllers.h === "human" ? "사람" : "엔진"}. 상차림은 초 {g.setups.c}, 한 {g.setups.h}</div>
        {saveError && <div role="alert" style={{ fontSize: 13, color: COL.h, marginTop: 6 }}>{saveError}</div>}
        {corrupted && <div role="status" style={{ fontSize: 13, color: COL.h, marginTop: 6 }}>최근 기보 손상됨 — 새 게임을 시작했어요.</div>}
        <WinBar a={analysis} />
        <Tray side={flip ? "c" : "h"} />
        <div style={{ borderRadius: 10, overflow: "hidden", boxShadow: "0 10px 30px rgba(40,20,5,.35)" }}>
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)} style={{ display: "block", width: "100%", height: "auto", userSelect: "none", touchAction: "none", cursor: myTurn ? "pointer" : "default" }}>
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
            {g.last && g.last.map((i, k) => {
              const [x, y] = xy(i);
              return <circle key={"l" + k} cx={x} cy={y} r="29" fill="none" stroke={MARK} strokeWidth="3.5" strokeDasharray={k === 0 ? "5 5" : undefined} />;
            })}
            {g.b.map((p, i) => {
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
              return g.b[m[1]] ? (
                <circle key={"t" + m[1]} cx={x} cy={y} r="31" fill="none" stroke={MARK} strokeWidth="4" />
              ) : (
                <circle key={"t" + m[1]} cx={x} cy={y} r="9" fill={MARK} />
              );
            })}
            {drag && drag.moved && g.b[drag.i] && (
              <g style={{ pointerEvents: "none" }}>
                <Piece p={g.b[drag.i]} x={drag.x} y={drag.y} selected lifted />
              </g>
            )}
          </svg>
        </div>
        <Tray side={flip ? "h" : "c"} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginTop: 10 }}>
          <button style={{ ...btn, opacity: canUndo(g) ? 1 : 0.4 }} disabled={!canUndo(g)} onClick={undo}>무르기</button>
          <button style={{ ...btn, opacity: myTurn && !inCheck(g.b, g.turn) ? 1 : 0.4 }} disabled={!myTurn || inCheck(g.b, g.turn)} onClick={pass}>한 수 쉬기</button>
          <button style={btn} onClick={restart}>새 게임</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8, marginTop: 10 }}>
          {["c", "h"].map((side) => <label key={side} style={lab}>{NAME[side]}
            <select aria-label={NAME[side]} style={selStyle} value={controllers[side]} onChange={(e) => setControllers({ ...controllers, [side]: e.target.value })}>
              <option value="human">사람</option>
              <option value="engine">엔진</option>
            </select>
          </label>)}
          <label style={lab}>난이도
            <select aria-label="난이도" style={selStyle} value={level} onChange={(e) => setLevel(+e.target.value)}>
              <option value={2}>쉬움</option>
              <option value={3}>보통</option>
              <option value={4}>어려움</option>
            </select>
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
        <p style={{ fontSize: 13, color: "#65584a", marginTop: 12, lineHeight: 1.6 }}>
          설정을 바꾼 뒤 새 게임을 누르면 적용돼요. 상차림은 각 편이 자기 쪽에서 바라본 왼쪽부터 읽어요. 파랑(초)이 먼저 둡니다. 빅장과 점수 판정은 없고 외통수로 승부가 납니다.
        </p>
      </div>
    </div>
  );
}
