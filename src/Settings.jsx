// 설정 패널: 위/아래 자리마다 나라·두는 이·상차림, 그리고 난이도와 분석.
// 두는 이와 분석은 고르는 즉시 적용되고, 나라·상차림·난이도는 새 게임부터 적용된다(바뀐 것은 목록으로 알려 준다).
import { SETUPS } from "./engine.js";
import { nationAt } from "./seats.js";
import { isMaxLevel } from "./game.js";

const COL = { c: "#1b4a8c", h: "#ae2219" };
const NATION = { c: "초나라", h: "한나라" };
const SEAT = { top: "위", bottom: "아래" };
const selStyle = { padding: "8px 6px", borderRadius: 8, border: "1.5px solid #4e3118", background: "#f3eee4", color: "#261d15", width: "100%", fontSize: 14 };
const lab = { display: "grid", gap: 3, fontSize: 12, color: "#65584a" };

function Seat({ seat, seats, nowBottom, onNation, onWho, onSetup }) {
  const next = nationAt(seats.bottomNation, seat), now = nationAt(nowBottom, seat);
  return (
    <fieldset style={{ border: `2px solid ${COL[now]}`, borderRadius: 8, padding: "6px 10px 10px", margin: "10px 0 0", display: "grid", gap: 8 }}>
      <legend style={{ fontSize: 13, fontWeight: 700, color: COL[now], padding: "0 4px" }}>{SEAT[seat]}쪽 · 지금 {NATION[now]}</legend>
      <label style={lab}>나라
        <select aria-label={`${SEAT[seat]} 나라`} style={{ ...selStyle, color: COL[next] }} value={next} onChange={(e) => onNation(seat, e.target.value)}>
          <option value="c">초나라(파랑)</option>
          <option value="h">한나라(빨강)</option>
        </select>
      </label>
      <label style={lab}>두는 이
        <select aria-label={`${SEAT[seat]} 두는 이`} style={selStyle} value={seats[seat].who} onChange={(e) => onWho(seat, e.target.value)}>
          <option value="human">사람</option>
          <option value="engine">엔진</option>
        </select>
      </label>
      <label style={lab}>상차림
        <select aria-label={`${SEAT[seat]} 상차림`} style={selStyle} value={seats[seat].setup} onChange={(e) => onSetup(seat, e.target.value)}>
          {Object.keys(SETUPS).map((k) => <option key={k}>{k}</option>)}
        </select>
      </label>
    </fieldset>
  );
}

export function SettingsPanel({ seats, nowBottom, pending, level, maxReason, analysisMode, onNation, onWho, onSetup, onLevel, onAnalysis }) {
  const waiting = [pending.nation && "나라", pending.top && "위 상차림", pending.bottom && "아래 상차림", pending.level && "난이도"].filter(Boolean);
  return (
    <section data-testid="settings" aria-label="설정" style={{ background: "#e2dccf", borderRadius: 10, padding: "10px 12px 12px" }}>
      <b style={{ fontSize: 15 }}>설정</b>
      {["top", "bottom"].map((seat) => (
        <Seat key={seat} seat={seat} seats={seats} nowBottom={nowBottom} onNation={onNation} onWho={onWho} onSetup={onSetup} />
      ))}
      <label style={{ ...lab, marginTop: 10 }}>난이도(엔진)
        <select aria-label="난이도" style={selStyle} value={level} onChange={(e) => onLevel(isMaxLevel(e.target.value) ? e.target.value : +e.target.value)}>
          <option value={2}>쉬움</option>
          <option value={3}>보통</option>
          <option value={4}>어려움</option>
          <option value="max" disabled={!!maxReason}>최강 · 3초</option>
          <option value="max20" disabled={!!maxReason}>최강 · 20초</option>
        </select>
        {maxReason && <span>최강: {maxReason}</span>}
      </label>
      <label style={{ ...lab, marginTop: 10 }}>분석(승률)
        <select aria-label="분석" style={selStyle} value={analysisMode} onChange={(e) => onAnalysis(e.target.value)}>
          <option value="fast">빠르게 · 0.8초</option>
          <option value="deep">깊게 · 3초</option>
          <option value="continuous">계속 · 다음 수까지 최대 1분</option>
        </select>
      </label>
      {/* 알림 영역은 항상 둔다: 내용이 든 채로 새로 끼워 넣은 status 는 스크린리더가 읽지 않을 수 있다(리뷰 LOW). */}
      <div role="status" aria-live="polite">
        {waiting.length > 0 && (
          <div data-testid="pending" style={{ marginTop: 10, fontSize: 13, color: "#7a4a00", background: "#f7e4b5", borderRadius: 6, padding: "6px 8px" }}>
            새 게임부터 적용: {waiting.join(", ")}
          </div>
        )}
      </div>
      <p style={{ fontSize: 12, color: "#65584a", margin: "10px 0 0", lineHeight: 1.6 }}>
        두는 이(사람/엔진)와 분석은 고르는 즉시 바뀌어요. 나라·상차림·난이도는 새 게임을 누르면 적용돼요(최강 · 3초 ↔ 20초는 바로 바뀌어요). 선수는 항상 초나라예요.
      </p>
    </section>
  );
}
