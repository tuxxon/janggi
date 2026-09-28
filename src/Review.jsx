// 복기 화면 부품: 기보 목록, 이동 버튼, 수순 목록, 승률 그래프. 계산은 review.js 가 한다.
import { chartPoints, resultText } from "./review.js";

const COL = { c: "#1b4a8c", h: "#ae2219" };
const WHO = { human: "사람", engine: "엔진" };
const LEVEL = { 2: "쉬움", 3: "보통", 4: "어려움", max: "최강" };
const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
};
const small = { padding: "6px 10px", borderRadius: 7, background: "#3a2c20", color: "#f8eed7", border: "none", fontSize: 13, cursor: "pointer" };

export function GameList({ items, liveId, onOpen, onExport, onExportAll, onImport, error }) {
  return (
    <div style={{ marginTop: 10, background: "#e2dccf", borderRadius: 10, padding: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <b style={{ fontSize: 15 }}>기보</b>
        <button style={small} onClick={onExportAll}>전체 내보내기</button>
        <label style={{ ...small, display: "inline-block" }}>
          가져오기
          <input aria-label="기보 가져오기" type="file" accept=".json,application/json" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) onImport(f); }} />
        </label>
      </div>
      {error && <div role="alert" style={{ fontSize: 13, color: COL.h, marginBottom: 6 }}>{error}</div>}
      <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
        {items.map((it) => (
          <li key={it.id} data-testid="game-item" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 13, padding: "6px 4px", borderTop: "1px solid #cfc8bb" }}>
            <span style={{ flex: "1 1 180px" }}>
              {when(it.createdAt)}{it.id === liveId ? " · 진행 중인 판" : ""}<br />
              {it.corrupted ? <b style={{ color: COL.h }}>손상됨</b>
                : <>초 {WHO[it.controllers.c]} · 한 {WHO[it.controllers.h]} · {LEVEL[it.level]} · {it.moves}수 · {resultText(it.result)}</>}
            </span>
            {!it.corrupted && <button style={small} onClick={() => onOpen(it.id)}>복기</button>}
            {!it.corrupted && <button style={small} onClick={() => onExport(it.id)}>내보내기</button>}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function WinChart({ evals, k, onPick }) {
  // 좌우 여백(PAD): 첫 수·마지막 수의 현재 위치 선이 가장자리에서 잘리지 않게.
  // 옆 패널(약 340px)에서도 읽히게 세로를 키웠다(리뷰 LOW).
  const W = 520, PAD = 8, w = W - PAD * 2, h = 130, pts = chartPoints(evals, w, h).map((p) => ({ ...p, x: p.x + PAD })), n = evals.length;
  const xOf = (ply) => PAD + (n <= 1 ? w / 2 : (ply * w) / (n - 1));
  const pick = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const frac = ((e.clientX - box.left) / box.width * W - PAD) / w;
    const ply = n <= 1 ? 0 : Math.round(frac * (n - 1));
    onPick(Math.max(0, Math.min(n - 1, ply)));
  };
  // 평가가 빈 국면은 선을 끊는다.
  const segs = [];
  pts.forEach((p, i) => (i && pts[i - 1].ply === p.ply - 1 ? segs.at(-1).push(p) : segs.push([p])));
  return (
    <svg data-testid="win-chart" viewBox={`0 0 ${W} ${h}`} onClick={pick} role="img" aria-label="초 승률 흐름"
      style={{ display: "block", width: "100%", height: "auto", background: "#f8eed7", borderRadius: 8, cursor: "pointer", marginTop: 8 }}>
      <rect x="0" y="0" width={W} height={h / 2} fill={COL.c} opacity=".07" />
      <rect x="0" y={h / 2} width={W} height={h / 2} fill={COL.h} opacity=".07" />
      <line x1="0" y1={h / 2} x2={W} y2={h / 2} stroke="#65584a" strokeDasharray="4 4" strokeWidth="1" />
      {segs.map((s, i) => <polyline key={i} points={s.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={COL.c} strokeWidth="2.5" />)}
      {pts.length === 1 && <circle cx={pts[0].x} cy={pts[0].y} r="3" fill={COL.c} />}
      <line data-testid="chart-cursor" x1={xOf(k)} y1="0" x2={xOf(k)} y2={h} stroke="#e3a21a" strokeWidth="2.5" />
      <text x={PAD + 2} y="16" fontSize="15" fill={COL.c}>초 100%</text>
      <text x={PAD + 2} y={h - 5} fontSize="15" fill={COL.h}>한 100%</text>
    </svg>
  );
}

export function ReviewPanel({ rows, k, n, setK, evals, onExit }) {
  const nav = [["처음", "⏮", 0], ["이전 수", "◀", k - 1], ["다음 수", "▶", k + 1], ["마지막 수", "⏭", n]];
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
        {nav.map(([label, icon, to]) => (
          <button key={label} aria-label={label} disabled={to < 0 || to > n}
            style={{ ...small, fontSize: 18, padding: "8px 0", opacity: to < 0 || to > n ? 0.4 : 1 }} onClick={() => setK(to)}>{icon}</button>
        ))}
      </div>
      <WinChart evals={Array.from({ length: n + 1 }, (_, i) => evals?.[i] ?? null)} k={k} onPick={setK} />
      <ol style={{ listStyle: "none", padding: 0, margin: "8px 0 0", maxHeight: 220, overflowY: "auto", fontSize: 13, background: "#e2dccf", borderRadius: 8 }}>
        {rows.map((r) => (
          <li key={r.ply} data-testid="review-row" onClick={() => setK(r.ply)}
            style={{ display: "flex", gap: 8, padding: "5px 10px", cursor: "pointer", background: r.ply === k ? "#f3d99a" : undefined }}>
            <span style={{ width: 28, color: "#65584a" }}>{r.ply}.</span>
            <span style={{ color: COL[r.side], width: 18 }}>{r.side === "c" ? "초" : "한"}</span>
            <span style={{ width: 56 }}>{r.move === "pass" ? "쉬기" : r.move}</span>
            <span>{r.delta === null ? "" : `${r.delta < 0 ? "−" : "+"}${Math.abs(r.delta).toFixed(0)}%p`}{r.grade ? ` ${r.grade}` : ""}</span>
            {r.autoPassAfter && <span style={{ color: "#65584a" }}>· 상대 둘 수 없어 쉼</span>}
          </li>
        ))}
      </ol>
      <p style={{ fontSize: 12, color: "#65584a", margin: "6px 0" }}>복기하는 동안 진행 중인 대국은 멈춰요. 빈 평가는 자동으로 분석해요. ← → 키로도 움직여요.</p>
      <button style={{ ...small, width: "100%", padding: "10px 0", fontSize: 15 }} onClick={onExit}>대국으로 돌아가기</button>
    </div>
  );
}
