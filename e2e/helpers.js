import { expect } from "@playwright/test";

// GitHub Pages 처럼 헤더가 없으면 coi-serviceworker 가 첫 방문에 페이지를 새로고침해 격리를 켠다.
// 그 새로고침이 한 번 더 걸릴 수 있어서, 격리를 확인한 뒤 우리 쪽에서 한 번 더 이동해 안정된 문서에서 시작한다.
export async function openIsolated(page, path = "/janggi/") {
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
