import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { NNUE } from "../src/analysis/fsf.js";

// 신경망 "배달 경로"와 무관하게 "브라우저 WASM 이 신경망을 쓰는가"만 검증하려고, Drive 요청을 로컬 파일로 바꿔치기한다.
// (Drive 는 브라우저 교차 출처 요청에 403 — 2026-09-28 실측. 배달 방식은 별도 결정.)
const LOCAL_NNUE = `${homedir()}/.janggi/${NNUE.name}`;
test.beforeEach(async ({ context }) => {
  if (!existsSync(LOCAL_NNUE)) return;
  await context.route(NNUE.url, (route) =>
    route.fulfill({ status: 200, body: readFileSync(LOCAL_NNUE), headers: { "access-control-allow-origin": "*", "content-type": "application/octet-stream" } }));
});

const START_FEN = "rnba1abnr/4k4/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/4K4/RNBA1ABNR w - - 0 1";

// 보드 SVG viewBox(560x620) 좌표 → 화면 좌표. MG=40, S=60, 초가 아래(뒤집지 않음).
async function clickSq(page, r, c) {
  // selectOption 등이 페이지를 스크롤하면 판 윗줄이 화면 밖으로 나가 클릭이 허공에 떨어진다 → 판을 가운데로.
  await page.locator("svg").first().evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = await page.locator("svg").first().boundingBox();
  const k = box.width / 560;
  await page.mouse.click(box.x + (40 + c * 60) * k, box.y + (40 + r * 60) * k);
}

test("앱이 뜨고, 격리가 켜지고, 신경망 승률이 나오고, 수를 두면 다시 분석한다", async ({ page }) => {
  test.skip(!existsSync(LOCAL_NNUE), `로컬 신경망 없음: ${LOCAL_NNUE}`);
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

async function openGame(page) {
  await page.goto("/janggi/");
  await expect.poll(() => page.evaluate(() => self.crossOriginIsolated), { timeout: 20_000 }).toBe(true);
  await expect(page.getByRole("heading", { name: "장기" })).toBeVisible();
}
const latestRecord = (page) => page.evaluate(() => {
  const index = JSON.parse(localStorage.getItem("janggi.index") || "[]");
  return index.length ? JSON.parse(localStorage.getItem(`janggi.game.${index[0].id}`)) : null;
});

test("편별 컨트롤러 설정, 사람끼리 대국, 새로고침 복원과 무르기", async ({ page }) => {
  await openGame(page);
  const cho = page.getByLabel("초(파랑)", { exact: true }), han = page.getByLabel("한(빨강)", { exact: true });
  await expect(cho).toHaveValue("human");
  await expect(han).toHaveValue("engine");
  await han.selectOption("human");
  await expect.poll(async () => (await latestRecord(page))?.controllers).toEqual({ c: "human", h: "engine" });
  await page.getByRole("button", { name: "새 게임" }).click();
  await clickSq(page, 6, 0); await clickSq(page, 5, 0);
  await clickSq(page, 3, 0); await clickSq(page, 4, 0);
  await expect.poll(async () => (await latestRecord(page))?.moves).toEqual(["a4a5", "a7a6"]);
  const id = (await latestRecord(page)).id;
  await page.reload();
  await expect(han).toHaveValue("human");
  await expect(page.getByText("초(파랑) 차례예요.", { exact: true })).toBeVisible();
  expect(await latestRecord(page)).toMatchObject({ id, moves: ["a4a5", "a7a6"] });
  await page.getByRole("button", { name: "무르기" }).click();
  await expect.poll(async () => (await latestRecord(page))?.moves).toEqual(["a4a5"]);
  await expect(page.getByRole("button", { name: "한 수 쉬기" })).toBeEnabled();
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/m1-mobile.png", fullPage: true });
});

test("엔진끼리 새 게임을 시작하면 양쪽이 스스로 둔다", async ({ page }) => {
  await openGame(page);
  await page.getByLabel("초(파랑)", { exact: true }).selectOption("engine");
  await page.getByLabel("난이도", { exact: true }).selectOption("2");
  await page.getByRole("button", { name: "새 게임" }).click();
  await expect(page.getByText("엔진이 생각하는 중…", { exact: true })).toBeVisible();
  await expect.poll(async () => (await latestRecord(page))?.moves.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(4);
  await expect(page.getByRole("button", { name: "무르기" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "한 수 쉬기" })).toBeDisabled();
  // 진행 중인 엔진 타이머를 새 판이 취소해야 한다.
  await page.getByLabel("초(파랑)", { exact: true }).selectOption("human");
  await page.getByLabel("한(빨강)", { exact: true }).selectOption("human");
  await page.getByRole("button", { name: "새 게임" }).click();
  await page.waitForTimeout(900);
  expect((await latestRecord(page)).moves).toEqual([]);
});

test("엔진 응수 대기 중 무르기는 타이머를 취소한다", async ({ page }) => {
  await openGame(page);
  await page.clock.install({ time: new Date("2026-09-28T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-09-28T00:01:00Z"));
  await clickSq(page, 6, 0); await clickSq(page, 5, 0);
  await expect(page.getByRole("button", { name: "무르기" })).toBeEnabled();
  await page.getByRole("button", { name: "무르기" }).click();
  await page.clock.runFor(1000);
  expect((await latestRecord(page)).moves).toEqual([]);
  await expect(page.getByText("무르기 했어요.", { exact: true })).toBeVisible();
});

test("한만 사람이면 판을 뒤집고 한의 기물을 조작한다", async ({ page }) => {
  await openGame(page);
  await page.getByLabel("초(파랑)", { exact: true }).selectOption("engine");
  await page.getByLabel("한(빨강)", { exact: true }).selectOption("human");
  await page.getByLabel("난이도", { exact: true }).selectOption("2");
  await page.getByRole("button", { name: "새 게임" }).click();
  await expect(page.getByText("내 차례예요 · 한(빨강)", { exact: true })).toBeVisible();
  // 뒤집힌 화면 아래 오른쪽은 한의 a7 병이다.
  await clickSq(page, 6, 8); await clickSq(page, 5, 8);
  await expect.poll(async () => (await latestRecord(page))?.moves[1]).toBe("a7a6");
});

test("저장이 실패해도 대국을 계속하고 백업 안내를 표시한다", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith("janggi.")) throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await openGame(page);
  await expect(page.getByText("기보 저장 실패 — 내보내기로 백업하세요", { exact: true })).toBeVisible();
  await page.getByLabel("한(빨강)", { exact: true }).selectOption("human");
  await page.getByRole("button", { name: "새 게임" }).click();
  await clickSq(page, 6, 0); await clickSq(page, 5, 0);
  await expect(page.getByText("한(빨강) 차례예요.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "무르기" })).toBeEnabled();
});

test("손상된 최신 기보를 보존하고 새 판을 연다", async ({ page }) => {
  await openGame(page);
  await page.evaluate(() => {
    const id = "2026-09-28T00-00-00-000";
    localStorage.setItem(`janggi.game.${id}`, JSON.stringify({ v: 1, id, createdAt: "2026-09-28T00:00:00.000Z",
      setups: { c: "마상마상", h: "마상마상" }, controllers: { c: "human", h: "engine" }, level: 3, moves: ["a4a6"], result: null }));
    localStorage.setItem("janggi.index", JSON.stringify([{ id, createdAt: "2026-09-28T00:00:00.000Z" }]));
  });
  await page.reload();
  await expect(page.getByText(/손상됨.*새 게임/)).toBeVisible();
  await expect.poll(async () => (await latestRecord(page))?.moves).toEqual([]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("janggi.index")).find((e) => e.id === "2026-09-28T00-00-00-000").status)).toBe("손상됨");
});
