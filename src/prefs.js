// 보기 설정(판 기록과 따로): 분석 모드. 고르는 즉시 적용하고 localStorage 에 기억한다.
import { MODES } from "./analysis/service.js";

const KEY = "janggi.prefs", DEFAULT = "continuous";
// getter 도 try 안에서 부른다(비공개 창은 localStorage 접근 자체가 실패할 수 있다).
const backend = (storage) => typeof storage === "function" ? storage() : storage;

export function loadPrefs(storage = () => globalThis.localStorage) {
  try {
    const saved = JSON.parse(backend(storage).getItem(KEY));
    return { analysis: MODES.includes(saved?.analysis) ? saved.analysis : DEFAULT };
  } catch { return { analysis: DEFAULT }; }
}

// 저장이 안 되면(비공개 창, 용량) 이번 방문에만 적용된다. 판 기록이 아니라서 알림은 띄우지 않는다.
export function savePrefs(prefs, storage = () => globalThis.localStorage) {
  try { backend(storage).setItem(KEY, JSON.stringify(prefs)); } catch { /* 이번 방문에만 적용 */ }
}
