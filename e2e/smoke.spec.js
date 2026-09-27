import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { NNUE } from "../src/analysis/fsf.js";

// 신경망 "배달 경로"와 무관하게 "브라우저 WASM 이 신경망을 쓰는가"만 검증하려고, Drive 요청을 로컬 파일로 바꿔치기한다.
// (Drive 는 브라우저 교차 출처 요청에 403 — 2026-09-28 실측. 배달 방식은 별도 결정.)
const LOCAL_NNUE = `${homedir()}/.janggi/${NNUE.name}`;
test.beforeEach(async ({ context }) => {
  test.skip(!existsSync(LOCAL_NNUE), `로컬 신경망 없음: ${LOCAL_NNUE}`);
  await context.route(NNUE.url, (route) =>
    route.fulfill({ status: 200, body: readFileSync(LOCAL_NNUE), headers: { "access-control-allow-origin": "*", "content-type": "application/octet-stream" } }));
});

const START_FEN = "rnba1abnr/4k4/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/4K4/RNBA1ABNR w - - 0 1";

// 보드 SVG viewBox(560x620) 좌표 → 화면 좌표. MG=40, S=60, 초가 아래(뒤집지 않음).
async function clickSq(page, r, c) {
  const box = await page.locator("svg").first().boundingBox();
  const k = box.width / 560;
  await page.mouse.click(box.x + (40 + c * 60) * k, box.y + (40 + r * 60) * k);
}

test("앱이 뜨고, 격리가 켜지고, 신경망 승률이 나오고, 수를 두면 다시 분석한다", async ({ page }) => {
  await page.goto("/janggi/");
  await expect(page.getByRole("heading", { name: "장기" })).toBeVisible();

  // coi-serviceworker 가 한 번 새로고침한 뒤 격리돼야 한다(Pages 와 같은 경로).
  await expect.poll(() => page.evaluate(() => self.crossOriginIsolated), { timeout: 20_000 }).toBe(true);

  // 기본 상차림(양쪽 마상마상)이 아닌 FSF startpos 비교는 단위 테스트가 한다. 여기서는 신경망 적용과 값의 범위.
  const bar = page.getByTestId("winbar");
  await expect(bar).toHaveAttribute("data-nnue", "on", { timeout: 120_000 });
  await expect(bar).toHaveAttribute("data-cho-win", /\d/, { timeout: 30_000 });
  const w0 = Number(await bar.getAttribute("data-cho-win"));
  expect(w0).toBeGreaterThan(30);
  expect(w0).toBeLessThan(70);
  const fen0 = await bar.getAttribute("data-fen");
  expect(fen0).not.toBe(START_FEN); // 원본 기본값은 마상마상 → FSF startpos(마상상마)와 다르다

  // 사람(초): a4 졸 → a5. 엔진(한)이 응수하면 다시 초 차례이고, 분석한 국면이 바뀐다.
  await clickSq(page, 6, 0);
  await clickSq(page, 5, 0);
  await expect(page.getByText("내 차례예요")).toBeVisible({ timeout: 20_000 });
  await expect(bar).not.toHaveAttribute("data-fen", fen0, { timeout: 30_000 });
  await expect(bar).toHaveAttribute("data-fen", / w - - 0 1$/, { timeout: 30_000 }); // 다시 초 차례
  await page.screenshot({ path: "test-results/smoke.png", fullPage: true });
});
