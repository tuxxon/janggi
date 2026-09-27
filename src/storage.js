import { newGame } from "./game.js";
import { toRecord, replay, validId } from "./record.js";

export const SAVE_ERROR = "기보 저장 실패 — 내보내기로 백업하세요";
const INDEX = "janggi.index", PREFIX = "janggi.game.";

function unusedId(id, has) {
  if (!has(id)) return id;
  // 이미 접미사가 있는 날짜 id도 접미사를 겹치지 않고 새 번호로 바꾼다.
  const base = id.replace(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3})-\d+$/, "$1");
  let n = 1;
  while (has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

// UI 없이 쓸 수 있는 순수 JSON 도우미. 손상된 원본도 내보내기로 보관할 수 있다.
export function exportRecords(records, id) {
  const value = id === undefined ? records : records.find((record) => record.id === id);
  if (!value) throw new Error("기보를 찾을 수 없어요.");
  return JSON.stringify(value, null, 2);
}
export function importRecords(json, existingIds = []) {
  let parsed;
  try { parsed = JSON.parse(json); } catch { throw new Error("기보 JSON을 읽을 수 없어요."); }
  const used = new Set(existingIds);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((record) => {
    const checked = toRecord(replay(record).state);
    checked.id = unusedId(checked.id, (id) => used.has(id));
    used.add(checked.id);
    return checked;
  });
}

// getter도 try 안에서 호출한다. 비공개 창은 localStorage 접근 자체가 실패할 수 있다.
export function createStore({ storage = () => globalThis.localStorage, now = () => new Date() } = {}) {
  const backend = () => typeof storage === "function" ? storage() : storage;
  const reserved = new Set();
  let error = null;
  function readIndex() {
    const index = JSON.parse(backend().getItem(INDEX) ?? "[]");
    if (!Array.isArray(index) || !index.every((entry) => entry && validId(entry.id))) throw new Error("기보 목록 손상됨");
    return index;
  }
  function fresh(options) {
    const createdAt = now().toISOString(), base = createdAt.replace(/[:.]/g, "-").replace(/Z$/, "");
    const id = unusedId(base, (candidate) => {
      if (reserved.has(candidate)) return true;
      try { return backend().getItem(PREFIX + candidate) !== null || readIndex().some((entry) => entry.id === candidate); }
      catch { error = SAVE_ERROR; return false; }
    });
    reserved.add(id);
    return { ...newGame(options), id, createdAt };
  }
  function save(state) {
    try {
      const record = toRecord(state), index = readIndex();
      backend().setItem(PREFIX + record.id, JSON.stringify(record));
      backend().setItem(INDEX, JSON.stringify([{ id: record.id, createdAt: record.createdAt }, ...index.filter((entry) => entry.id !== record.id)]));
      error = null;
      return { ok: true, error: null };
    } catch {
      error = SAVE_ERROR;
      return { ok: false, error };
    }
  }
  function loadLatest(options) {
    let index, corrupted = null;
    error = null;
    try { index = readIndex(); } catch { error = SAVE_ERROR; }
    const entry = index?.[0];
    if (entry) {
      let raw;
      try { raw = backend().getItem(PREFIX + entry.id); } catch { error = SAVE_ERROR; }
      if (!error) {
        try {
          const record = JSON.parse(raw);
          if (record?.id !== entry.id) throw new Error("기보 id가 목록과 달라요.");
          const { state } = replay(record);
          reserved.add(state.id);
          return { state, error: null, corrupted: null };
        } catch (cause) {
          corrupted = { ...entry, status: "손상됨", error: cause.message };
          try { backend().setItem(INDEX, JSON.stringify([corrupted, ...index.slice(1)])); }
          catch { error = SAVE_ERROR; }
        }
      }
    }
    const state = fresh(options);
    return { state, error, corrupted };
  }
  return { newGame: fresh, save, loadLatest };
}
