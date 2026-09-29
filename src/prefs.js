// 보기 설정(판 기록과 따로): 분석 모드, 저장된 판 복기의 깊게 보기 상한. 고르는 즉시 적용하고 localStorage 에 기억한다.
import { MODES, DEEP_CAPS } from "./analysis/service.js";

const KEY = "janggi.prefs", DEFAULT = "continuous";
// 깊게 보기 상한(개정 2.10): 서비스의 DEEP_CAPS 와 같은 순서. 무제한은 JSON 에 Infinity 가 없어서 "infinite" 로 적는다.
export const REVIEW_DEEP = DEEP_CAPS.map((cap) => (cap === Infinity ? "infinite" : cap));
const DEFAULT_DEEP = REVIEW_DEEP[0];
export const capOf = (reviewDeep) => (reviewDeep === "infinite" ? Infinity : reviewDeep);
// getter 도 try 안에서 부른다(비공개 창은 localStorage 접근 자체가 실패할 수 있다).
const backend = (storage) => typeof storage === "function" ? storage() : storage;

export function loadPrefs(storage = () => globalThis.localStorage) {
  try {
    const saved = JSON.parse(backend(storage).getItem(KEY));
    return { analysis: MODES.includes(saved?.analysis) ? saved.analysis : DEFAULT,
      reviewDeep: REVIEW_DEEP.includes(saved?.reviewDeep) ? saved.reviewDeep : DEFAULT_DEEP };
  } catch { return { analysis: DEFAULT, reviewDeep: DEFAULT_DEEP }; }
}

// 저장이 안 되면(비공개 창, 용량) 이번 방문에만 적용된다. 판 기록이 아니라서 알림은 띄우지 않는다.
export function savePrefs(prefs, storage = () => globalThis.localStorage) {
  try { backend(storage).setItem(KEY, JSON.stringify(prefs)); } catch { /* 이번 방문에만 적용 */ }
}
