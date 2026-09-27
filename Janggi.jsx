import { useState, useEffect, useLayoutEffect, useRef } from "react";
// ===== 장기 엔진 =====
const PV={K:0,R:1300,C:700,H:500,E:300,A:300,P:200};
const ORTH=[[1,0],[-1,0],[0,1],[0,-1]];
const DIAGS=[[[0,3],[1,4],[2,5]],[[0,5],[1,4],[2,3]],[[7,3],[8,4],[9,5]],[[7,5],[8,4],[9,3]]];
const on=(r,c)=>r>=0&&r<10&&c>=0&&c<9;
const inPal=(r,c)=>c>=3&&c<=5&&(r<=2||r>=7);
const DL=[];for(let i=0;i<90;i++){const r=(i/9)|0,c=i%9;DL.push(DIAGS.map(L=>[L,L.findIndex(p=>p[0]===r&&p[1]===c)]).filter(x=>x[1]>=0));}
const other=s=>s==='c'?'h':'c';
const SETUPS={'마상마상':'HEHE','상마상마':'EHEH','마상상마':'HEEH','상마마상':'EHHE'};

function newBoard(choSetup,hanSetup){
  const b=new Array(90).fill(null);
  const put=(r,c,p)=>{b[r*9+c]=p;};
  // 한 (위쪽, rows 0-3)
  put(0,0,'hR');put(0,8,'hR');put(0,3,'hA');put(0,5,'hA');put(1,4,'hK');
  put(2,1,'hC');put(2,7,'hC');for(const c of[0,2,4,6,8])put(3,c,'hP');
  const hs=SETUPS[hanSetup];[7,6,2,1].forEach((c,k)=>put(0,c,'h'+hs[k]));
  // 초 (아래쪽, rows 6-9)
  put(9,0,'cR');put(9,8,'cR');put(9,3,'cA');put(9,5,'cA');put(8,4,'cK');
  put(7,1,'cC');put(7,7,'cC');for(const c of[0,2,4,6,8])put(6,c,'cP');
  const cs=SETUPS[choSetup];[1,2,6,7].forEach((c,k)=>put(9,c,'c'+cs[k]));
  return b;
}

function gen(b,side){
  const mv=[];const fwd=side==='c'?-1:1;
  for(let i=0;i<90;i++){
    const p=b[i];if(!p||p[0]!==side)continue;
    const r=(i/9)|0,c=i%9,t=p[1];
    const add=(nr,nc)=>{if(!on(nr,nc))return false;const j=nr*9+nc,q=b[j];if(q&&q[0]===side)return false;mv.push([i,j]);return !q;};
    if(t==='K'||t==='A'){
      for(const[dr,dc]of ORTH){const nr=r+dr,nc=c+dc;if(on(nr,nc)&&inPal(nr,nc))add(nr,nc);}
      for(const[L,k]of DL[i])for(const j of[k-1,k+1])if(j>=0&&j<3)add(L[j][0],L[j][1]);
    }else if(t==='R'){
      for(const[dr,dc]of ORTH){let nr=r+dr,nc=c+dc;while(on(nr,nc)){if(!add(nr,nc))break;nr+=dr;nc+=dc;}}
      for(const[L,k]of DL[i])for(const d of[-1,1]){let j=k+d;while(j>=0&&j<3){if(!add(L[j][0],L[j][1]))break;j+=d;}}
    }else if(t==='C'){
      for(const[dr,dc]of ORTH){
        let nr=r+dr,nc=c+dc;
        while(on(nr,nc)&&!b[nr*9+nc]){nr+=dr;nc+=dc;}
        if(!on(nr,nc)||b[nr*9+nc][1]==='C')continue;
        nr+=dr;nc+=dc;
        while(on(nr,nc)){const q=b[nr*9+nc];
          if(!q)mv.push([i,nr*9+nc]);
          else{if(q[0]!==side&&q[1]!=='C')mv.push([i,nr*9+nc]);break;}
          nr+=dr;nc+=dc;}
      }
      for(const[L,k]of DL[i]){if(k===1)continue;
        const sc=b[L[1][0]*9+L[1][1]];if(!sc||sc[1]==='C')continue;
        const ti=L[2-k][0]*9+L[2-k][1],q=b[ti];
        if(!q||(q[0]!==side&&q[1]!=='C'))mv.push([i,ti]);}
    }else if(t==='H'){
      for(const[dr,dc]of ORTH){const r1=r+dr,c1=c+dc;if(!on(r1,c1)||b[r1*9+c1])continue;
        if(dr){add(r1+dr,c1-1);add(r1+dr,c1+1);}else{add(r1-1,c1+dc);add(r1+1,c1+dc);}}
    }else if(t==='E'){
      for(const[dr,dc]of ORTH){const r1=r+dr,c1=c+dc;if(!on(r1,c1)||b[r1*9+c1])continue;
        const ds=dr?[[dr,-1],[dr,1]]:[[-1,dc],[1,dc]];
        for(const[a,e]of ds){const r2=r1+a,c2=c1+e;if(!on(r2,c2)||b[r2*9+c2])continue;add(r2+a,c2+e);}}
    }else if(t==='P'){
      add(r+fwd,c);add(r,c-1);add(r,c+1);
      for(const[L,k]of DL[i])for(const j of[k-1,k+1])if(j>=0&&j<3&&L[j][0]-r===fwd)add(L[j][0],L[j][1]);
    }
  }
  return mv;
}
const kingIdx=(b,s)=>b.indexOf(s+'K');
function inCheck(b,s){const k=kingIdx(b,s);if(k<0)return true;return gen(b,other(s)).some(m=>m[1]===k);}
function make(b,m){const cap=b[m[1]];b[m[1]]=b[m[0]];b[m[0]]=null;return cap;}
function unmake(b,m,cap){b[m[0]]=b[m[1]];b[m[1]]=cap;}
function legal(b,s){return gen(b,s).filter(m=>{const cap=make(b,m);const ok=!inCheck(b,s);unmake(b,m,cap);return ok;});}

function evalB(b,side){
  let sc=0;
  for(let i=0;i<90;i++){const p=b[i];if(!p)continue;const r=(i/9)|0,c=i%9;let v=PV[p[1]];
    if(p[1]==='P')v+=12*Math.max(0,p[0]==='c'?6-r:r-3);
    if(p[1]==='H'||p[1]==='C')v+=c>=2&&c<=6?15:0;
    sc+=p[0]===side?v:-v;}
  return sc;
}
const WIN=100000;

function order(b,ms){return ms.map(m=>{const q=b[m[1]];return[q?PV[q[1]]*10-PV[b[m[0]][1]]:0,m];}).sort((x,y)=>y[0]-x[0]).map(x=>x[1]);}
function qs(b,side,alpha,beta,d){
  
  const ms=gen(b,side);
  for(const m of ms){const q=b[m[1]];if(q&&q[1]==='K')return WIN;}
  const stand=evalB(b,side);
  if(d===0||stand>=beta)return stand;
  if(stand>alpha)alpha=stand;
  for(const m of order(b,ms.filter(m=>b[m[1]]))){
    const cap=make(b,m);const v=-qs(b,other(side),-beta,-alpha,d-1);unmake(b,m,cap);
    if(v>=beta)return v;if(v>alpha)alpha=v;}
  return alpha;
}
function search(b,side,depth,alpha,beta){
  
  const ms=gen(b,side);
  for(const m of ms){const q=b[m[1]];if(q&&q[1]==='K')return WIN+depth;}
  if(depth===0)return qs(b,side,alpha,beta,4);
  if(!ms.length)return 0;
  let best=-Infinity;
  for(const m of order(b,ms)){
    const cap=make(b,m);const v=-search(b,other(side),depth-1,-beta,-alpha);unmake(b,m,cap);
    if(v>best)best=v;if(v>alpha)alpha=v;if(alpha>=beta)break;}
  return best;
}
function bestMove(b,side,depth){
  const ms=order(b,legal(b,side));if(!ms.length)return null;
  let best=null,bv=-Infinity,alpha=-Infinity;
  for(const m of ms){
    const cap=make(b,m);const v=-search(b,other(side),depth-1,-Infinity,-alpha+30)+Math.random()*20;unmake(b,m,cap);
    if(v>bv){bv=v;best=m;}if(v>alpha)alpha=v;}
  return best;
}

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

function freshGame(aiSide, choSetup, hanSetup, level) {
  const player = other(aiSide);
  const b = newBoard(choSetup, hanSetup);
  return { b, turn: "c", player, ai: aiSide, level, setups: { c: choSetup, h: hanSetup }, last: null, caps: { c: [], h: [] }, hist: [], over: null, msg: "", slide: false };
}

export default function Janggi() {
  const [aiSide, setAiSide] = useState("h");
  const [choSetup, setChoSetup] = useState("마상마상");
  const [hanSetup, setHanSetup] = useState("마상마상");
  const [level, setLevel] = useState(3);
  const [g, setG] = useState(() => freshGame("h", "마상마상", "마상마상", 3));
  const [sel, setSel] = useState(null);
  const [thinking, setThinking] = useState(false);
  const gRef = useRef(g);
  gRef.current = g;

  const flip = g.player === "h";
  const xy = (i) => {
    let r = (i / 9) | 0, c = i % 9;
    if (flip) { r = 9 - r; c = 8 - c; }
    return [MG + c * S, MG + r * S];
  };

  // 수 적용 후 다음 상태 계산 (외통수/강제 쉬기 포함)
  function step(prev, m, pushHist, slide = true) {
    const b = prev.b.slice();
    const caps = { c: prev.caps.c.slice(), h: prev.caps.h.slice() };
    let hist = prev.hist;
    if (pushHist) hist = [...hist, { b: prev.b, caps: prev.caps, last: prev.last, turn: prev.turn, msg: prev.msg }];
    let last = null, turn = prev.turn;
    if (m) {
      const cap = make(b, m);
      if (cap) caps[other(cap[0])].push(cap);
      last = m;
    }
    turn = other(turn);
    let over = null, msg = "";
    const ms = legal(b, turn), chk = inCheck(b, turn);
    if (!ms.length && chk) {
      over = other(turn);
      msg = over === prev.player ? "외통수! 이겼어요." : "외통수예요. AI가 이겼어요.";
    } else if (!ms.length) {
      msg = `${NAME[turn]} 쪽이 둘 수 없어 한 수 쉽니다.`;
      turn = other(turn);
      last = null;
    } else if (chk) {
      msg = turn === prev.player ? "장군이에요! 궁을 지키세요." : "장군!";
    } else if (!m) {
      msg = "한 수 쉬었어요.";
    }
    return { ...prev, b, caps, hist, last, turn, over, msg, slide: !!m && slide };
  }

  // AI 차례면 계산
  useEffect(() => {
    if (g.over || g.turn !== g.ai) return;
    setThinking(true);
    const t = setTimeout(() => {
      const cur = gRef.current;
      const m = bestMove(cur.b, cur.turn, cur.level);
      setG(step(cur, m, false));
      setThinking(false);
    }, 420);
    return () => clearTimeout(t);
  }, [g]);

  const myTurn = !g.over && !thinking && g.turn === g.player;
  const targets = sel !== null && myTurn ? legal(g.b, g.player).filter((m) => m[0] === sel) : [];
  const checkKing = !g.over && inCheck(g.b, g.turn) ? kingIdx(g.b, g.turn) : -1;

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
  const movesFrom = (i) => legal(g.b, g.player).filter((m) => m[0] === i);
  function play(m, slide) { setSel(null); setDrag(null); setG(step(g, m, true, slide)); }

  function onDown(e) {
    if (!myTurn) return;
    const { x, y } = toSvg(e), i = idxAt(x, y);
    if (i === null) return;
    const t = targets.find((m) => m[1] === i);
    if (t) { play(t, true); return; }           // 선택 후 목적지를 탭
    const p = g.b[i];
    if (p && p[0] === g.player) {
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
    if (!g.hist.length || thinking) return;
    const h = g.hist[g.hist.length - 1];
    setSel(null);
    setG({ ...g, ...h, hist: g.hist.slice(0, -1), over: null, msg: "무르기 했어요." });
  }
  function pass() {
    if (!myTurn || inCheck(g.b, g.player)) return;
    setSel(null);
    setG(step(g, null, true));
  }
  function restart() {
    setSel(null);
    setThinking(false);
    setG(freshGame(aiSide, choSetup, hanSetup, level));
  }

  const status = g.over
    ? g.msg
    : thinking
    ? "AI가 생각하는 중…"
    : g.msg && g.turn === g.player
    ? g.msg
    : `내 차례예요 · ${NAME[g.player]}`;

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
        <div style={{ fontSize: 13, color: "#65584a" }}>AI는 {NAME[g.ai]}. 상차림은 초 {g.setups.c}, 한 {g.setups.h}</div>
        <Tray side={g.ai} />
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
        <Tray side={g.player} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginTop: 10 }}>
          <button style={{ ...btn, opacity: g.hist.length && !thinking ? 1 : 0.4 }} onClick={undo}>무르기</button>
          <button style={{ ...btn, opacity: myTurn && !inCheck(g.b, g.player) ? 1 : 0.4 }} onClick={pass}>한 수 쉬기</button>
          <button style={btn} onClick={restart}>새 게임</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8, marginTop: 10 }}>
          <label style={lab}>AI가 둘 편
            <select style={selStyle} value={aiSide} onChange={(e) => setAiSide(e.target.value)}>
              <option value="c">파랑 (초, 선수)</option>
              <option value="h">빨강 (한, 후수)</option>
            </select>
          </label>
          <label style={lab}>난이도
            <select style={selStyle} value={level} onChange={(e) => setLevel(+e.target.value)}>
              <option value={2}>쉬움</option>
              <option value={3}>보통</option>
              <option value={4}>어려움</option>
            </select>
          </label>
          <label style={lab}>초(파랑) 상차림
            <select style={{ ...selStyle, color: COL.c }} value={choSetup} onChange={(e) => setChoSetup(e.target.value)}>
              {Object.keys(SETUPS).map((k) => <option key={k}>{k}</option>)}
            </select>
          </label>
          <label style={lab}>한(빨강) 상차림
            <select style={{ ...selStyle, color: COL.h }} value={hanSetup} onChange={(e) => setHanSetup(e.target.value)}>
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
