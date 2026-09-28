import { test, expect } from "@playwright/test";
import { openIsolated } from "./helpers.js";
import { readFileSync, readdirSync } from "node:fs";

const OLD = "2026-09-27T10-00-00-000", LIVE = "2026-09-28T10-00-00-000";
const rec = (id, createdAt, extra) => ({ v: 1, id, createdAt, setups: { c: "마상마상", h: "마상마상" },
  controllers: { c: "human", h: "engine" }, level: 3, moves: [], result: null, ...extra });
// 지난 판: 초 a4a5(+2) · 한 a7a6(−28 실수) · 초 c4c5(−35 대실수). evals 는 초 기준 승률.
const old = rec(OLD, "2026-09-27T10:00:00.000Z", { moves: ["a4a5", "a7a6", "c4c5"], analysis: { engine: "seed",
  evals: [{ ply: 0, cp: 0, win: 50, depth: 10 }, { ply: 1, cp: 22, win: 52, depth: 10 }, { ply: 2, cp: 380, win: 80, depth: 10 }, { ply: 3, cp: -54, win: 45, depth: 10 }] } });
const live = rec(LIVE, "2026-09-28T10:00:00.000Z", { moves: ["e4e5"] });

async function seed(page, records) {
  await openIsolated(page);
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
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/m3-review-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });

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
  // 복기 중에는 진행 중인 판을 저장하지 않으므로 저장소만 보면 멈췄는지 알 수 없다(리뷰: 공허한 검사).
  // 돌아온 직후 저장되는 메모리 속 판의 수가 멈춘 시점 그대로여야 한다(멈추지 않았다면 2.5초 동안 여러 수가 쌓였다).
  await page.getByRole("button", { name: "대국으로 돌아가기" }).click();
  await page.waitForTimeout(150);
  expect(await moves()).toBeLessThanOrEqual(paused + 1);
  await expect.poll(moves, { timeout: 15_000 }).toBeGreaterThan(paused);
});

test("GPL 표기의 라이선스 원문과 엔진 파일이 배포본에 들어 있다", async ({ page, request }) => {
  await seed(page, [live]);
  await expect(page.getByTestId("license")).toContainText("Fairy-Stockfish (GPL-3.0)");
  // 화면의 링크를 따라가서 확인한다(파일만 직접 받으면 링크가 틀려도 통과한다 — 리뷰 빈틈).
  const footer = page.getByTestId("license");
  const licence = await request.get(await footer.getByRole("link", { name: "라이선스" }).getAttribute("href"));
  expect(await licence.text()).toContain("GNU GENERAL PUBLIC LICENSE");
  const notices = await request.get(await footer.getByRole("link", { name: "오픈소스 고지" }).getAttribute("href"));
  const text = await notices.text();
  for (const name of ["react", "react-dom", "scheduler", "coi-serviceworker", "Fairy-Stockfish"]) expect(text).toContain(`== ${name}`);
  expect(text).toContain("MIT License");
  expect(await footer.getByRole("link", { name: "엔진 소스" }).getAttribute("href")).toBe("https://github.com/fairy-stockfish/fairy-stockfish.wasm/tree/1.1.12");
  expect(await footer.getByRole("link", { name: "앱 소스" }).getAttribute("href")).toMatch(/^https:\/\/github\.com\/tuxxon\/janggi\/tree\/[0-9a-f]{7,40}$/);
  // 신경망은 재배포하지 않는다: 빌드 산출물 어디에도 .nnue 가 없어야 한다(preview 는 없는 경로에 index.html 을 200 으로 준다).
  const files = readdirSync("dist", { recursive: true }).map(String);
  expect(files.filter((f) => f.endsWith(".nnue") || f.startsWith("dev-nnue"))).toEqual([]);
  expect(files).toContain("fsf/stockfish.wasm");
});

async function clickSq(page, r, c) {
  await page.locator("svg[data-fen]").evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = await page.locator("svg[data-fen]").boundingBox();
  const k = box.width / 560;
  await page.mouse.click(box.x + (40 + c * 60) * k, box.y + (40 + r * 60) * k);
}
const failWritesFor = (page, id) => page.evaluate((key) => {
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { if (k === key) throw new Error("quota"); return original.call(this, k, v); };
}, `janggi.game.${id}`);

test("저장 실패 알림의 '지금 내보내기'는 저장 못 한 수까지 메모리에서 내보낸다 (리뷰 MED)", async ({ page }) => {
  await seed(page, [rec(LIVE, "2026-09-28T10:00:00.000Z", { controllers: { c: "human", h: "human" } }), old]);
  await failWritesFor(page, LIVE);
  await clickSq(page, 6, 0); await clickSq(page, 5, 0);
  await clickSq(page, 3, 0); await clickSq(page, 4, 0);
  const alert = page.getByRole("alert").filter({ hasText: "기보 저장 실패" });
  await expect(alert).toBeVisible();
  const download = page.waitForEvent("download");
  await alert.getByRole("button", { name: "지금 내보내기" }).click();
  expect(JSON.parse(readFileSync(await (await download).path(), "utf8"))).toMatchObject({ id: LIVE, moves: ["a4a5", "a7a6"] });
  await page.getByRole("button", { name: "기보" }).click();
  const all = page.waitForEvent("download");
  await page.getByRole("button", { name: "전체 내보내기" }).click();
  const exported = JSON.parse(readFileSync(await (await all).path(), "utf8"));
  expect(exported.find((r) => r.id === LIVE).moves).toEqual(["a4a5", "a7a6"]);
});

test("복기 중 분석 저장이 실패하면 알린다 (리뷰 LOW-MED)", async ({ page }) => {
  const { analysis, ...bare } = old;
  await seed(page, [live, bare]);
  await failWritesFor(page, OLD);
  await page.getByRole("button", { name: "기보" }).click();
  await page.getByTestId("game-item").nth(1).getByRole("button", { name: "복기" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "기보 저장 실패" })).toBeVisible({ timeout: 20_000 });
});

test("다른 엔진 설정으로 만든 저장 평가는 새 결과가 와도 지워지지 않는다 (리뷰 HIGH)", async ({ page }) => {
  await seed(page, [live, old]);
  await page.getByRole("button", { name: "기보" }).click();
  await page.getByTestId("game-item").nth(1).getByRole("button", { name: "복기" }).click();
  const stored = () => page.evaluate((id) => JSON.parse(localStorage.getItem(`janggi.game.${id}`)).analysis, OLD);
  await expect.poll(async () => (await stored())?.engine, { timeout: 20_000 }).not.toBe("seed"); // 마지막 국면 결과가 도착했다
  const { evals } = await stored();
  expect(evals.slice(0, 3)).toEqual(old.analysis.evals.slice(0, 3));
  const rows = page.getByTestId("review-row");
  await expect(rows.nth(0)).toContainText("+2%p");
  await expect(rows.nth(1)).toContainText("−28%p 실수 ?");
  await expect(page.locator("[data-testid=win-chart] polyline")).toHaveCount(1);
});

test("@webkit WebKit(사파리·아이폰)에서도 격리되고 엔진 분석 결과가 나온다", async ({ page }) => {
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await openIsolated(page);
  await expect(page.getByTestId("winbar")).toHaveAttribute("data-cho-win", /\d/, { timeout: 60_000 });
  expect(errors.filter((e) => /Cross-Origin-Embedder-Policy/.test(e))).toEqual([]);
});

test("복기에서 훈수 체크박스를 누른 뒤에도 ← → 키가 먹고, 처음에서 ←는 그대로다 (리뷰 MED)", async ({ page }) => {
  await seed(page, [live, old]);
  await page.getByRole("button", { name: "기보" }).click();
  await page.getByTestId("game-item").nth(1).getByRole("button", { name: "복기" }).click();
  await page.keyboard.press("ArrowLeft");
  await expect(status(page)).toHaveText("복기 중 · 0/3수");
  await page.getByLabel("후보 수 보기").check();
  await page.keyboard.press("ArrowRight");
  await expect(status(page)).toHaveText("복기 중 · 1/3수");
});

test("복기 훈수: 기물을 집으면 도착 칸에 승률이 붙고, 도착 칸을 눌러도 진행 중인 판에 두지 않는다 (리뷰 빈틈)", async ({ page }) => {
  await seed(page, [live, old]);
  const liveMoves = () => page.evaluate((id) => JSON.parse(localStorage.getItem(`janggi.game.${id}`)).moves, LIVE);
  await page.getByRole("button", { name: "기보" }).click();
  await page.getByTestId("game-item").nth(1).getByRole("button", { name: "복기" }).click();
  await page.getByRole("button", { name: "다음 수" }).click(); // 1/3: 한 차례
  await page.getByLabel("후보 수 보기").check();
  await clickSq(page, 3, 0);                                    // 한 a7 병
  await expect(page.getByTestId("target-win").first()).toBeVisible({ timeout: 30_000 });
  await clickSq(page, 4, 0);                                    // 그 도착 칸(a6)을 누른다
  await expect(status(page)).toHaveText("복기 중 · 1/3수");
  await page.getByLabel("후보 수 보기").uncheck();
  await expect(page.locator('svg polygon[stroke="#e3a21a"]')).toHaveCount(0); // 훈수를 끄면 선택도 풀린다
  // 복기 중에는 진행 중인 판을 저장하지 않는다 → 돌아온 뒤(메모리의 판이 저장된 뒤)에 확인해야 공허하지 않다(리뷰 M29).
  await page.getByRole("button", { name: "대국으로 돌아가기" }).click();
  await page.waitForTimeout(150);
  expect(await liveMoves()).toEqual(["e4e5"]);
});

test("그래프의 현재 위치 선은 수를 따라 움직인다 (리뷰 빈틈)", async ({ page }) => {
  await seed(page, [live, old]);
  await page.getByRole("button", { name: "기보" }).click();
  await page.getByTestId("game-item").nth(1).getByRole("button", { name: "복기" }).click();
  const cursor = page.getByTestId("chart-cursor");
  const x0 = await cursor.getAttribute("x1");
  await page.getByRole("button", { name: "마지막 수" }).click();
  expect(Number(await cursor.getAttribute("x1"))).toBeGreaterThan(Number(x0));
});

test("손상된 목록 항목에는 복기·내보내기를 두지 않고 손상됨을 표시한다 (리뷰 LOW)", async ({ page }) => {
  await seed(page, [live, { ...old, controllers: null }]);
  await page.getByRole("button", { name: "기보" }).click();
  const bad = page.getByTestId("game-item").nth(1);
  await expect(bad).toContainText("손상됨");
  await expect(bad.getByRole("button")).toHaveCount(0);
});
