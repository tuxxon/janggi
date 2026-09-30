import { expect } from "@playwright/test";

// GitHub Pages 처럼 헤더가 없으면 coi-serviceworker 가 첫 방문에 페이지를 새로고침해 격리를 켠다.
// 그 새로고침이 한 번 더 걸릴 수 있어서, 격리를 확인한 뒤 우리 쪽에서 한 번 더 이동해 안정된 문서에서 시작한다.
// analysis: 분석 모드를 심는다(기본 "빠르게"). 기본값 "계속"은 1분씩 여러 스레드로 읽어서 병렬 테스트끼리 CPU 를 다툰다.
// 저장된 값이 없을 때만 심으므로 테스트가 고른 모드는 새로고침해도 남는다. null 이면 심지 않는다(앱 기본값).
// cores: 페이지에 보일 코어 수(기본 2 → 엔진 1스레드). 워커마다 7스레드면 CPU 를 다퉈 서비스워커 첫 방문 격리가
// 20초를 넘긴다(main 0/4, 스레드 그대로 1/4 실패). null 이면 실제 코어 수 — 스레드 경로를 보는 테스트용.
export async function openIsolated(page, path = "/janggi/", { analysis = "fast", cores = 2 } = {}) {
  if (cores) await page.addInitScript((n) => {
    Object.defineProperty(Navigator.prototype, "hardwareConcurrency", { configurable: true, get: () => n });
  }, cores);
  if (analysis) await page.addInitScript((mode) => {
    try { if (!localStorage.getItem("janggi.prefs")) localStorage.setItem("janggi.prefs", JSON.stringify({ analysis: mode })); } catch { /* 격리 전 문서 */ }
  }, analysis);
  const ready = () => page.evaluate(() => self.crossOriginIsolated && !!navigator.serviceWorker?.controller).catch(() => false);
  await page.goto(path);
  await expect.poll(ready, { timeout: 20_000 }).toBe(true);
  await page.goto(path);
  await expect.poll(ready, { timeout: 20_000 }).toBe(true);
}

// 판 좌표(교차점 r,c)를 화면 좌표로: 브라우저의 getScreenCTM 을 쓴다(viewBox·테두리가 바뀌어도 맞다).
export async function clickBoard(page, r, c) {
  const svg = page.locator("svg[data-fen]");
  await svg.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const { x, y } = await svg.evaluate((el, [r, c]) => {
    const pt = el.createSVGPoint(); pt.x = 40 + c * 60; pt.y = 40 + r * 60;
    const s = pt.matrixTransform(el.getScreenCTM()); return { x: s.x, y: s.y };
  }, [r, c]);
  await page.mouse.click(x, y);
}
