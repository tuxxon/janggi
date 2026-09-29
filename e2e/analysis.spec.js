import { test, expect } from "@playwright/test";
import { openIsolated, clickBoard } from "./helpers.js";

// "더 깊이 보기" (사용자 요청 2026-09-29): 분석 모드 빠르게·깊게·계속, 계속은 보고 있는 국면을 최대 20초 깊게 읽는다.
const OLD = "2026-09-27T10-00-00-000", LIVE = "2026-09-28T10-00-00-000";
const rec = (id, createdAt, extra) => ({ v: 1, id, createdAt, setups: { c: "마상마상", h: "마상마상" },
  controllers: { c: "human", h: "engine" }, level: 3, moves: [], result: null, ...extra });
const old = rec(OLD, "2026-09-27T10:00:00.000Z", { moves: ["a4a5", "a7a6", "c4c5"], analysis: { engine: "seed",
  evals: [0, 1, 2, 3].map((ply) => ({ ply, cp: 0, win: 50, depth: 10 })) } });
const live = rec(LIVE, "2026-09-28T10:00:00.000Z", { moves: ["e4e5"] });

const bar = (page) => page.getByTestId("winbar");
const depthOf = async (page) => Number(/깊이 (\d+)/.exec(await bar(page).textContent())?.[1] ?? NaN);
const modeSelect = (page) => page.getByLabel("분석", { exact: true });

test("분석 선택지는 기본이 '계속'이고, 고른 모드는 새로고침해도 기억한다", async ({ page }) => {
  await openIsolated(page, "/janggi/", { analysis: null, cores: null });
  await expect(modeSelect(page)).toHaveValue("continuous");
  await modeSelect(page).selectOption("deep");
  await page.reload();
  await expect(modeSelect(page)).toHaveValue("deep");
  expect(await page.evaluate(() => localStorage.getItem("janggi.prefs"))).toBe('{"analysis":"deep"}');
});

test("계속: 깊이가 시간이 지나며 커지고 '계속 분석 중'을 보여주며, 빠르게로 바꾸면 바로 멈춘다", async ({ page }) => {
  await openIsolated(page, "/janggi/", { analysis: "continuous", cores: null });
  await expect(bar(page)).toContainText("계속 분석 중", { timeout: 30_000 });
  const first = await depthOf(page);
  expect(first).toBeGreaterThan(0);
  await expect.poll(() => depthOf(page), { timeout: 25_000 }).toBeGreaterThan(first);
  // 깊어진 평가는 기보에도 남는다(가장 최근 판의 0수째).
  const saved = () => page.evaluate(() => {
    const [{ id }] = JSON.parse(localStorage.getItem("janggi.index"));
    return JSON.parse(localStorage.getItem(`janggi.game.${id}`)).analysis;
  });
  await expect.poll(async () => (await saved())?.evals[0]?.depth, { timeout: 10_000 }).toBeGreaterThan(first);
  expect((await saved()).engine).toContain("mode=continuous");

  await modeSelect(page).selectOption("fast");
  await expect(bar(page)).not.toContainText("계속 분석 중");
  const stopped = await depthOf(page);
  await page.waitForTimeout(3_000);
  expect(await depthOf(page)).toBe(stopped);
});

test("계속: 복기에서는 보고 있는 k수째 국면을 깊게 읽는다", async ({ page }) => {
  await openIsolated(page, "/janggi/", { analysis: "continuous", cores: null });
  await page.evaluate((records) => {
    localStorage.clear();
    localStorage.setItem("janggi.prefs", JSON.stringify({ analysis: "continuous" }));
    for (const r of records) localStorage.setItem(`janggi.game.${r.id}`, JSON.stringify(r));
    localStorage.setItem("janggi.index", JSON.stringify(records.map((r) => ({ id: r.id, createdAt: r.createdAt }))));
  }, [live, old]);
  await page.reload();
  await page.getByRole("button", { name: "기보" }).click();
  await page.getByTestId("game-item").nth(1).getByRole("button", { name: "복기" }).click();
  await page.getByRole("button", { name: "다음 수" }).click();
  await expect(page.getByTestId("status")).toHaveText("복기 중 · 1/3수");
  // 심어 둔 평가는 깊이 10. 1수째를 깊게 읽으면 그 국면의 깊이가 10을 넘는다(마지막 국면만 읽으면 10에 머문다).
  await expect(bar(page)).toContainText("계속 분석 중", { timeout: 30_000 });
  await expect.poll(() => depthOf(page), { timeout: 30_000 }).toBeGreaterThan(10);
  await expect.poll(() => page.evaluate((id) => JSON.parse(localStorage.getItem(`janggi.game.${id}`)).analysis.evals[1].depth, OLD),
    { timeout: 10_000 }).toBeGreaterThan(10);
  expect(await page.evaluate((id) => JSON.parse(localStorage.getItem(`janggi.game.${id}`)).analysis.evals[2].depth, OLD)).toBe(10);
});

test("계속: 깊게 읽는 중에도 기물을 집으면 수마다 승률이 바로 뜨고, 수를 두면 새 국면을 바로 분석한다", async ({ page }) => {
  await openIsolated(page, "/janggi/", { analysis: "continuous", cores: null });
  await page.getByLabel("위 두는 이", { exact: true }).selectOption("human"); // 엔진 응수가 끼지 않게 두 편 다 사람
  await expect(bar(page)).toContainText("계속 분석 중", { timeout: 30_000 });
  await page.getByLabel("후보 수 보기").check();
  await clickBoard(page, 6, 0);                                                  // 초 a4 졸
  // 초점 분석(0.5초)이 20초짜리 깊게 보기가 끝나기를 기다리지 않는다.
  await expect(page.getByTestId("target-win")).toHaveCount(2, { timeout: 5_000 });
  await clickBoard(page, 5, 0);                                                  // a4→a5
  const after = await page.locator("svg[data-fen]").getAttribute("data-fen");
  await expect(bar(page)).toHaveAttribute("data-fen", after, { timeout: 5_000 }); // 새 국면의 평가가 곧 뜬다
  await expect(bar(page)).toContainText("계속 분석 중", { timeout: 10_000 });     // 그리고 그 국면을 다시 깊게 읽는다
});

test("깊게 읽어 저장한 지금 국면의 평가는 새로고침 뒤 0.8초 탐색에 얕아지지 않는다 (리뷰 A F1)", async ({ page }) => {
  const saved = () => page.evaluate(() => {
    const [{ id }] = JSON.parse(localStorage.getItem("janggi.index"));
    return JSON.parse(localStorage.getItem(`janggi.game.${id}`)).analysis;
  });
  await openIsolated(page, "/janggi/", { analysis: "continuous", cores: null });
  await page.getByLabel("위 두는 이", { exact: true }).selectOption("human");
  await expect(bar(page)).toContainText("계속 분석 중", { timeout: 30_000 });
  const first = await depthOf(page);
  await expect.poll(async () => (await saved())?.evals[0]?.depth, { timeout: 25_000 }).toBeGreaterThanOrEqual(first + 3);
  const deep = (await saved()).evals[0].depth;
  await modeSelect(page).selectOption("fast");                     // 새로고침 뒤에는 다시 깊게 읽지 않는다
  await page.reload();
  await expect(bar(page)).toContainText("깊이", { timeout: 30_000 });
  await page.waitForTimeout(3_000);                                 // 지금 국면은 후보 때문에 0.8초 다시 탐색한다
  expect((await saved()).evals[0].depth).toBeGreaterThanOrEqual(deep);
  expect(await depthOf(page)).toBeGreaterThanOrEqual(deep);
});
