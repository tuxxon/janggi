import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const OLD = "2026-09-27T10-00-00-000", LIVE = "2026-09-28T10-00-00-000";
const rec = (id, createdAt, extra) => ({ v: 1, id, createdAt, setups: { c: "마상마상", h: "마상마상" },
  controllers: { c: "human", h: "engine" }, level: 3, moves: [], result: null, ...extra });
// 지난 판: 초 a4a5(+2) · 한 a7a6(−28 실수) · 초 c4c5(−35 대실수). evals 는 초 기준 승률.
const old = rec(OLD, "2026-09-27T10:00:00.000Z", { moves: ["a4a5", "a7a6", "c4c5"], analysis: { engine: "seed",
  evals: [{ ply: 0, cp: 0, win: 50, depth: 10 }, { ply: 1, cp: 22, win: 52, depth: 10 }, { ply: 2, cp: 380, win: 80, depth: 10 }, { ply: 3, cp: -54, win: 45, depth: 10 }] } });
const live = rec(LIVE, "2026-09-28T10:00:00.000Z", { moves: ["e4e5"] });

async function seed(page, records) {
  await page.goto("/janggi/");
  await expect.poll(() => page.evaluate(() => self.crossOriginIsolated), { timeout: 20_000 }).toBe(true);
  await page.evaluate((records) => {
    localStorage.clear();
    for (const r of records) localStorage.setItem(`janggi.game.${r.id}`, JSON.stringify(r));
    localStorage.setItem("janggi.index", JSON.stringify(records.map((r) => ({ id: r.id, createdAt: r.createdAt }))));
  }, records);
  await page.reload();
  await expect(page.getByRole("heading", { name: "장기" })).toBeVisible();
}
const boardFen = (page) => page.locator("svg[data-fen]").getAttribute("data-fen");
const status = (page) => page.getByTestId("status");

test("지난 판을 열어 버튼·방향키·수순·그래프로 이동하고, 돌아오면 진행 중인 판이 그대로다", async ({ page }) => {
  await seed(page, [live, old]);
  const liveFen = await boardFen(page);
  await page.getByRole("button", { name: "기보" }).click();
  const items = page.getByTestId("game-item");
  await expect(items).toHaveCount(2);
  await expect(items.nth(1)).toContainText("3수");
  await items.nth(1).getByRole("button", { name: "복기" }).click();

  await expect(status(page)).toHaveText("복기 중 · 0/3수");
  const startFen = await boardFen(page);
  await page.getByRole("button", { name: "다음 수" }).click();
  await expect(status(page)).toHaveText("복기 중 · 1/3수");
  expect(await boardFen(page)).not.toBe(startFen);
  await page.keyboard.press("ArrowRight");
  await expect(status(page)).toHaveText("복기 중 · 2/3수");
  await page.keyboard.press("ArrowLeft");
  await expect(status(page)).toHaveText("복기 중 · 1/3수");
  await page.getByRole("button", { name: "마지막 수" }).click();
  await expect(status(page)).toHaveText("복기 중 · 3/3수");
  await page.getByRole("button", { name: "처음" }).click();
  await expect(status(page)).toHaveText("복기 중 · 0/3수");
  expect(await boardFen(page)).toBe(startFen);

  const rows = page.getByTestId("review-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("+2%p");
  await expect(rows.nth(1)).toContainText("−28%p 실수 ?");
  await expect(rows.nth(2)).toContainText("−35%p 대실수 ??");
  await rows.nth(1).click();
  await expect(status(page)).toHaveText("복기 중 · 2/3수");

  const chart = page.getByTestId("win-chart");
  const box = await chart.boundingBox();
  await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
  await expect(status(page)).toHaveText("복기 중 · 3/3수");
  await page.screenshot({ path: "test-results/m3-review.png", fullPage: true });

  await page.getByRole("button", { name: "대국으로 돌아가기" }).click();
  expect(await boardFen(page)).toBe(liveFen);
  await page.reload();
  expect(await boardFen(page)).toBe(liveFen);
  const index = await page.evaluate(() => JSON.parse(localStorage.getItem("janggi.index")).map((e) => e.id));
  expect(index[0]).toBe(LIVE);
});

test("내보내기한 기보를 가져오면 id가 겹쳐도 새 id로 목록에 추가된다", async ({ page }) => {
  await seed(page, [live, old]);
  await page.getByRole("button", { name: "기보" }).click();
  const download = page.waitForEvent("download");
  await page.getByTestId("game-item").nth(1).getByRole("button", { name: "내보내기" }).click();
  const file = await (await download).path();
  const exported = JSON.parse(readFileSync(file, "utf8"));
  expect(exported).toMatchObject({ id: OLD, moves: ["a4a5", "a7a6", "c4c5"] });
  await page.getByLabel("기보 가져오기").setInputFiles(file);
  await expect(page.getByTestId("game-item")).toHaveCount(3);
  const ids = await page.evaluate(() => JSON.parse(localStorage.getItem("janggi.index")).map((e) => e.id));
  expect(ids).toEqual([LIVE, `${OLD}-1`, OLD]);
  const all = page.waitForEvent("download");
  await page.getByRole("button", { name: "전체 내보내기" }).click();
  expect(JSON.parse(readFileSync(await (await all).path(), "utf8")).map((r) => r.id)).toEqual(ids);
});

test("잘못된 기보 파일은 이유를 보여주고 목록을 바꾸지 않는다", async ({ page }) => {
  await seed(page, [live, old]);
  await page.getByRole("button", { name: "기보" }).click();
  await page.getByLabel("기보 가져오기").setInputFiles({ name: "bad.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...old, id: "2026-01-01T00-00-00-000", moves: ["a4a5", "a4a5"] })) });
  await expect(page.getByRole("alert")).toContainText("2수째 손상됨");
  await expect(page.getByTestId("game-item")).toHaveCount(2);
});

test("복기하는 동안 엔진끼리 두는 대국은 멈추고, 돌아오면 이어서 둔다", async ({ page }) => {
  await seed(page, [rec(LIVE, "2026-09-28T10:00:00.000Z", { controllers: { c: "engine", h: "engine" }, level: 2 }), old]);
  const moves = () => page.evaluate((id) => JSON.parse(localStorage.getItem(`janggi.game.${id}`)).moves.length, LIVE);
  await expect.poll(moves, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "기보" }).click();
  await page.getByTestId("game-item").nth(1).getByRole("button", { name: "복기" }).click();
  await expect(status(page)).toHaveText("복기 중 · 0/3수");
  const paused = await moves();
  await page.waitForTimeout(2500);
  expect(await moves()).toBe(paused);
  await page.getByRole("button", { name: "대국으로 돌아가기" }).click();
  await expect.poll(moves, { timeout: 15_000 }).toBeGreaterThan(paused);
});
