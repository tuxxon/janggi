import { test, expect } from "@playwright/test";
import { openIsolated, clickBoard, hoverBoard, logUci, uci } from "./helpers.js";
import { readFileSync, readdirSync } from "node:fs";

const OLD = "2026-09-27T10-00-00-000", LIVE = "2026-09-28T10-00-00-000";
const rec = (id, createdAt, extra) => ({ v: 1, id, createdAt, setups: { c: "마상마상", h: "마상마상" },
  controllers: { c: "human", h: "engine" }, level: 3, moves: [], result: null, ...extra });
// 지난 판: 초 a4a5(+2) · 한 a7a6(−28 실수) · 초 c4c5(−35 대실수). evals 는 초 기준 승률.
const old = rec(OLD, "2026-09-27T10:00:00.000Z", { moves: ["a4a5", "a7a6", "c4c5"], analysis: { engine: "seed",
  evals: [{ ply: 0, cp: 0, win: 50, depth: 10 }, { ply: 1, cp: 22, win: 52, depth: 10 }, { ply: 2, cp: 380, win: 80, depth: 10 }, { ply: 3, cp: -54, win: 45, depth: 10 }] } });
// 진행 중인 판은 사람끼리: 엔진(한) 차례로 두면 열자마자·복기에서 돌아오자마자 420ms 뒤에 엔진이 둬서 판 비교가 경합한다.
const live = rec(LIVE, "2026-09-28T10:00:00.000Z", { moves: ["e4e5"], controllers: { c: "human", h: "human" } });

async function seed(page, records, options) {
  await openIsolated(page, "/janggi/", options);
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
  await expect(rows.nth(2)).toContainText("졸 c4→c5");        // 수순에도 한글 기물 이름(사용자 요청 2026-09-29)
  await expect(rows.nth(1)).toContainText("−28%p 실수 ?");
  // 마지막 국면은 복기에서도 항상 다시 탐색한다(후보 수용). 여러 스레드 탐색은 매번 값이 조금 달라서 심은 −35 가 흔들린다.
  await expect(rows.nth(2)).toContainText(/−3\d%p 대실수 \?\?/);
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

const clickSq = (page, r, c) => clickBoard(page, r, c);
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
  await openIsolated(page, "/janggi/", { cores: null });                  // 실제 코어 수: 여러 스레드(pthread 워커)가 WebKit 에서 뜨는지
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

test("복기 훈수에서도 그 시점에 반복수로 막힌 수는 도착 칸으로 뜨지 않는다 (리뷰 LOW)", async ({ page }) => {
  const shuffle = rec(OLD, "2026-09-27T10:00:00.000Z", { controllers: { c: "human", h: "human" }, repetition: true, bottom: "c",
    moves: ["a1a2", "e9e10", "a2a1", "e10e9", "a1a2", "e9e10", "a2a1", "e10e9"] });
  await seed(page, [live, shuffle]);
  await page.getByRole("button", { name: "기보" }).click();
  await page.getByTestId("game-item").nth(1).getByRole("button", { name: "복기" }).click();
  await page.getByRole("button", { name: "마지막 수" }).click();
  await page.getByLabel("후보 수 보기").check();
  await clickSq(page, 9, 0);                                                     // 초 차 a1
  const dotAt = (r, c) => page.locator(`svg circle[r="9"][cx="${40 + c * 60}"][cy="${40 + r * 60}"]`);
  await expect(dotAt(7, 0)).toHaveCount(1);                                      // a3 는 갈 수 있었다
  await expect(dotAt(8, 0)).toHaveCount(0);                                      // a2 는 그 시점에 반복수로 막혀 있었다
});

// ---- 복기 깊게 보기 (개정 2.10: 저장된 판 복기 전용) ----
const bar = (page) => page.getByTestId("winbar");
const capSelect = (page) => page.getByLabel("깊게 보기", { exact: true });
const openGame = async (page, nth) => {                   // 복기에서 돌아오면 목록이 열린 채다 → 닫혀 있을 때만 연다
  const list = page.getByRole("button", { name: "기보" });
  if (await list.getAttribute("aria-expanded") !== "true") await list.click();
  await page.getByTestId("game-item").nth(nth).getByRole("button", { name: "복기" }).click();
};
const isHash = (c) => c.startsWith("> setoption name Hash "), isMultiPV = (c) => c.startsWith("> setoption name MultiPV "), isGo = (c) => c.startsWith("> go ");

test("저장된 판 복기: 깊게 보기 20초로 '같은 수 N깊이째'가 뜨고 후보마다 깊이를 적으며, 멈춤 뒤 '계속 분석 중'이 사라진다", async ({ page }) => {
  await seed(page, [live, old], { analysis: "continuous" });
  await openGame(page, 1);
  await expect(status(page)).toHaveText("복기 중 · 0/3수");
  await expect(capSelect(page)).toHaveValue("20000");                           // 기본 20초
  await expect(bar(page)).toContainText(/깊이 \d+ · 같은 수 \d+깊이째 · 계속 분석 중/, { timeout: 30_000 });
  await page.getByLabel("후보 수 보기").check();
  await expect(page.getByTestId("candidates").locator("li").first()).toContainText(/\d+% · 깊이 \d+/);
  await page.getByRole("button", { name: "멈춤" }).click();
  await expect(bar(page)).not.toContainText("계속 분석 중");
  await expect(bar(page)).toContainText(/깊이 \d+ · 같은 수 \d+깊이째/);          // 멈춘 때까지의 결과는 남는다
  await expect(page.getByRole("button", { name: "멈춤" })).toHaveCount(0);
  await page.waitForTimeout(1_500);
  await expect(bar(page)).not.toContainText("계속 분석 중");                    // 멈춘 국면은 다시 깊게 보지 않는다
});

test("진행 중인 판의 복기에는 깊게 보기 줄이 없고, 저장된 판 복기에는 있다(계속이 아니면 안내와 '계속으로 바꾸기')", async ({ page }) => {
  await seed(page, [live, old]);                                               // 분석 모드 빠르게
  await openGame(page, 0);                                                     // 진행 중인 판
  await expect(status(page)).toHaveText("복기 중 · 0/1수");
  await expect(capSelect(page)).toHaveCount(0);
  await expect(page.getByText("분석 모드가 '계속'일 때 깊게 봐요")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "계속으로 바꾸기" })).toHaveCount(0);
  await page.getByRole("button", { name: "대국으로 돌아가기" }).click();
  await openGame(page, 1);                                                     // 저장된 판
  await expect(status(page)).toHaveText("복기 중 · 0/3수");
  await expect(capSelect(page)).toHaveCount(1);
  await expect(page.getByText("분석 모드가 '계속'일 때 깊게 봐요")).toBeVisible();
  await expect(page.getByRole("button", { name: "멈춤" })).toHaveCount(0);
  // 설정 패널은 복기 중에 없다(최종 리뷰 B): 안내 옆 버튼이 설정의 "분석"과 같은 값(janggi.prefs)을 바꾸고, 복기 자리에서 깊게 보기가 시작된다.
  await page.getByRole("button", { name: "계속으로 바꾸기" }).click();
  await expect(page.getByText("분석 모드가 '계속'일 때 깊게 봐요")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("janggi.prefs"))).toBe('{"analysis":"continuous","reviewDeep":20000}');
  await expect(bar(page)).toContainText(/깊이 \d+ · 같은 수 \d+깊이째 · 계속 분석 중/, { timeout: 30_000 });
  await expect(status(page)).toHaveText("복기 중 · 0/3수");
});

// 진행 중인 판의 복기는 지금 그대로(최종 리뷰 B 의 핀): "계속"이 그 국면을 깊게 보는 동안에도 후보에 깊이가 없고(스모크와 같은 모양),
// 막대에 "같은 수"가 없고, 깊게 보기 줄도 멈춤도 없다.
test("진행 중인 판의 복기는 지금 그대로다: 후보에 깊이가 없고, 막대에 '같은 수'가 없고, 깊게 보기 줄이 없다", async ({ page }) => {
  await seed(page, [live, old], { analysis: "continuous" });
  await expect(bar(page)).toHaveAttribute("data-cho-win", /\d/, { timeout: 60_000 });
  await openGame(page, 0);
  await expect(status(page)).toHaveText("복기 중 · 0/1수");
  await expect(bar(page)).toContainText(/깊이 \d+ · 계속 분석 중/, { timeout: 30_000 });
  const depthOf = async () => Number(/깊이 (\d+)/.exec(await bar(page).textContent())?.[1]);
  const passDepth = await depthOf();
  await expect.poll(depthOf, { timeout: 30_000 }).toBeGreaterThan(passDepth);   // 이 복기에서 깊게 보기의 결과가 왔다
  expect(await bar(page).textContent()).not.toContain("같은 수");
  await page.getByLabel("후보 수 보기").check();
  await expect(page.getByTestId("candidates").locator("li").first()).toBeVisible({ timeout: 30_000 });
  for (const text of await page.getByTestId("candidates").locator("li").allInnerTexts())
    expect(text).toMatch(/^\d\. ((궁|차|포|마|상|사|졸|병) [a-i](10|[1-9])→[a-i](10|[1-9])|쉬기) \d+%$/);
  await expect(capSelect(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "멈춤" })).toHaveCount(0);
});

test("깊게 보기 상한을 고른 뒤에도 ← → 로 복기를 움직인다(선택 상자가 초점을 놓는다)", async ({ page }) => {
  await seed(page, [live, old]);
  await openGame(page, 1);
  await expect(status(page)).toHaveText("복기 중 · 0/3수");
  await capSelect(page).focus();                                               // 마우스로 고를 때처럼 초점이 선택 상자에 있다
  await capSelect(page).selectOption("60000");
  await page.keyboard.press("ArrowRight");
  await expect(status(page)).toHaveText("복기 중 · 1/3수");
  await page.keyboard.press("ArrowLeft");
  await expect(status(page)).toHaveText("복기 중 · 0/3수");
  await expect(capSelect(page)).toHaveValue("60000");                          // 화살표가 상한을 바꾸지 않았다
});

test("깊게 보기 상한은 새로고침해도 기억한다", async ({ page }) => {
  await seed(page, [live, old]);
  await openGame(page, 1);
  await capSelect(page).selectOption("60000");
  expect(await page.evaluate(() => localStorage.getItem("janggi.prefs"))).toBe('{"analysis":"fast","reviewDeep":60000}');
  await page.reload();
  await openGame(page, 1);
  await expect(capSelect(page)).toHaveValue("60000");
  await capSelect(page).selectOption("infinite");
  await page.reload();
  await openGame(page, 1);
  await expect(capSelect(page)).toHaveValue("infinite");
  expect(await page.evaluate(() => localStorage.getItem("janggi.prefs"))).toBe('{"analysis":"fast","reviewDeep":"infinite"}');
});

test("저장된 판 복기를 떠나면 상한·Hash 256 이 풀리고, 진행 중인 판과 그 복기는 MultiPV 5 · 1분 · Hash 64 그대로다", async ({ page }) => {
  await logUci(page);
  await seed(page, [live, old], { analysis: "continuous" });
  await expect.poll(async () => (await uci(page)).includes("< readyok"), { timeout: 30_000 }).toBe(true);
  expect((await uci(page)).filter(isHash)).toEqual(["> setoption name Hash value 64"]); // 진행 중인 판: 시작 값 그대로
  await openGame(page, 1);
  await capSelect(page).selectOption("60000");
  await expect.poll(async () => (await uci(page)).includes("> go movetime 60000"), { timeout: 30_000 }).toBe(true);
  const saved = await uci(page), long = saved.indexOf("> go movetime 60000");
  expect(saved.slice(0, long).filter(isHash).at(-1)).toBe("> setoption name Hash value 256");
  expect(saved.slice(0, long).filter(isMultiPV).at(-1)).toBe("> setoption name MultiPV value 1");

  // 60초 탐색이 달리는 중에 대국으로 돌아간다: 판이 바뀌면 서비스가 상한을 풀고, 멈춘 탐색의 bestmove 뒤 Hash 가 64 로 한 번
  // 돌아온 다음 진행 중인 판의 첫 탐색이 돈다. 깊게 보기는 지금 "계속"이다. 엔진이 쉬고 있을 때 떠나는 경우는 다음 테스트.
  let mark = (await uci(page)).length;
  await page.getByRole("button", { name: "대국으로 돌아가기" }).click();
  await expect.poll(async () => (await uci(page)).slice(mark).includes("> go movetime 60000"), { timeout: 30_000 }).toBe(true);
  let after = (await uci(page)).slice(mark), deep = after.indexOf("> go movetime 60000"), first = after.findIndex(isGo);
  expect(after.slice(0, first).filter(isHash)).toEqual(["> setoption name Hash value 64"]);          // 첫 탐색 전에
  expect(after.slice(0, first).filter(isMultiPV).at(-1)).toBe("> setoption name MultiPV value 5");
  expect(after.slice(0, deep).filter(isHash)).toEqual(["> setoption name Hash value 64"]);
  expect(after.slice(0, deep).filter(isMultiPV).at(-1)).toBe("> setoption name MultiPV value 5");
  expect(after.filter(isGo).filter((c) => !/^> go movetime (800|60000)$/.test(c))).toEqual([]);

  // 진행 중인 판의 복기도 상한 없이 지금 "계속" 그대로(Hash 를 바꾸지 않는다).
  mark = (await uci(page)).length;
  await openGame(page, 0);
  await expect(status(page)).toHaveText("복기 중 · 0/1수");
  await expect.poll(async () => (await uci(page)).slice(mark).includes("> go movetime 60000"), { timeout: 30_000 }).toBe(true);
  after = (await uci(page)).slice(mark); deep = after.indexOf("> go movetime 60000");
  expect(after.filter(isHash)).toEqual([]);
  expect(after.slice(0, deep).filter(isMultiPV).at(-1)).toBe("> setoption name MultiPV value 5");
  expect(after.filter(isGo).filter((c) => !/^> go movetime (800|60000)$/.test(c))).toEqual([]);
});

// 리뷰(2026-09-30): 엔진 차례로 끝난 저장된 최강 · 3초 판의 복기는 진행 중인 판(최강 · 20초)의 시간이 아니라 그 판의 3초로 본다.
// (복기 화면에 시계가 없는 것은 smoke 의 진행 중인 판 복기 테스트가 묶는다: 여기선 3초 탐색이 끝나 시계가 저절로 사라져 공허하다.)
test("엔진 차례로 끝난 저장된 최강 · 3초 판을 복기하면 진행 중인 판의 20초가 아니라 3초로 본다 (리뷰 MED)", async ({ page }) => {
  await logUci(page);
  const live20 = { ...live, level: "max20" };
  const old3 = rec(OLD, "2026-09-27T10:00:00.000Z", { level: "max", moves: ["a4a5"] }); // 한(엔진) 차례로 끝났다
  await seed(page, [live20, old3]);
  await openGame(page, 1);
  await expect(status(page)).toContainText("복기 중 · 0/1수");
  await expect.poll(async () => (await uci(page)).filter((l) => /^> go movetime (3000|20000)$/.test(l)), { timeout: 30_000 })
    .toEqual(["> go movetime 3000"]);
});

// 마우스 미리 보기·오른쪽 클릭 30초 깊게 보기(사용자 요청 2026-09-30)는 복기 훈수에서도 되고, 다른 수째로 가면 멈춘다.
test("복기 훈수에서도 마우스 미리 보기와 오른쪽 클릭 깊게 보기가 되고, 다른 수째로 넘기면 그 깊게 보기를 멈춘다 (사용자 요청)", async ({ page }) => {
  await logUci(page);
  await seed(page, [live, old]);
  await openGame(page, 1);
  await page.getByLabel("후보 수 보기").check();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
  await expect(status(page)).toHaveText("복기 중 · 0/3수");
  await hoverBoard(page, 6, 0);                                                     // 초 a4 졸
  await expect(page.getByTestId("target-win")).toHaveCount(2, { timeout: 30_000 });
  let mark = (await uci(page)).length;
  await clickBoard(page, 5, 0, { button: "right" });
  await expect.poll(async () => (await uci(page)).slice(mark).includes("> go movetime 30000 searchmoves a4a5"), { timeout: 10_000 }).toBe(true);
  await expect(page.getByTestId("look-note")).toContainText("졸 a4→a5");
  mark = (await uci(page)).length;
  await page.keyboard.press("ArrowRight");
  await expect(status(page)).toHaveText("복기 중 · 1/3수");
  await expect.poll(async () => (await uci(page)).slice(mark), { timeout: 10_000 }).toContain("> stop");
  // 멈춘 탐색의 bestmove 를 받은 같은 틱에 서비스가 다음 탐색을 보낸다 — 그때 a4a5 를 다시 읽지 않았으면 이어 읽지 않는 것이다.
  await expect.poll(async () => (await uci(page)).slice(mark).some((l) => l.startsWith("< bestmove")), { timeout: 10_000 }).toBe(true);
  expect((await uci(page)).slice(mark).filter((l) => l.includes("searchmoves a4a5"))).toEqual([]);
  await expect(page.getByTestId("look-note")).toHaveCount(0);
});

// 최종 리뷰 A·B I1: 엔진이 쉬고 있으면 판이 바뀌자마자 진행 중인 판의 탐색이 시작된다 — 그 첫 탐색부터 Hash 64 · MultiPV 5.
const lastBefore = (log, index, is) => log.slice(0, index).filter(is).at(-1);
test("쉬고 있는 저장된 판 복기(1분, 멈춤 뒤)를 떠나도 진행 중인 판의 첫 탐색은 Hash 64 · MultiPV 5 다", async ({ page }) => {
  await logUci(page);
  await seed(page, [live, old], { analysis: "continuous" });
  await openGame(page, 1);
  await capSelect(page).selectOption("60000");
  await expect.poll(async () => (await uci(page)).includes("> go movetime 60000"), { timeout: 30_000 }).toBe(true);
  await page.getByRole("button", { name: "멈춤" }).click();
  await expect.poll(async () => { const log = await uci(page), stop = log.lastIndexOf("> stop");
    return stop > 0 && log.slice(stop).some((c) => c.startsWith("< bestmove")); }, { timeout: 15_000 }).toBe(true);
  await page.waitForTimeout(500);
  let log = await uci(page);
  expect(log.slice(log.lastIndexOf("> stop")).filter(isGo)).toEqual([]);                       // 엔진이 쉰다
  expect(lastBefore(log, log.length, isHash)).toBe("> setoption name Hash value 256");
  const mark = log.length;
  await page.getByRole("button", { name: "대국으로 돌아가기" }).click();
  await expect.poll(async () => (await uci(page)).slice(mark).some(isGo), { timeout: 30_000 }).toBe(true);
  log = await uci(page);
  const first = log.findIndex((c, i) => i >= mark && isGo(c));
  expect(log[first]).toBe("> go movetime 800");
  expect(lastBefore(log, first, isHash)).toBe("> setoption name Hash value 64");
  expect(lastBefore(log, first, isMultiPV)).toBe("> setoption name MultiPV value 5");
});

test("무제한 깊게 보기는 첫 isready 탐침의 기한(30+15초)을 넘겨 계속되고(브라우저 엔진도 탐색 중 readyok 로 답한다), 멈춤으로 끝난다", async ({ page }) => {
  await logUci(page);
  await seed(page, [live, old], { analysis: "continuous" });
  await openGame(page, 1);
  await capSelect(page).selectOption("infinite");
  await expect.poll(async () => (await uci(page)).includes("> go infinite"), { timeout: 30_000 }).toBe(true);
  const started = Date.now();
  const sinceGo = async () => { const log = await uci(page); return log.slice(log.indexOf("> go infinite")); };
  // 서비스는 30초마다 isready 로 탐색 중인 엔진을 확인한다 — readyok 가 15초 안에 없으면 실패로 엔진을 다시 띄운다(quit·uci).
  // Task 1 은 탐색 중 readyok 를 node WASM 에서만 쟀다. 여기서는 브라우저 엔진이 답하는지 보고, 실패 기한(45초)을 넘겨 기다린다.
  await expect.poll(async () => {
    const log = await sinceGo(), probe = log.indexOf("> isready");
    return probe > 0 && log.indexOf("< readyok", probe) > probe;
  }, { timeout: 60_000 }).toBe(true);
  await page.waitForTimeout(Math.max(0, 46_000 - (Date.now() - started)));
  await expect(bar(page)).toContainText("계속 분석 중");
  expect((await sinceGo()).filter((c) => c === "> stop" || c === "> quit" || c.startsWith("< bestmove"))).toEqual([]); // 한 탐색이 이어진다
  expect((await uci(page)).filter((c) => c === "> uci")).toHaveLength(1);                           // 엔진을 다시 띄우지 않았다
  await page.getByRole("button", { name: "멈춤" }).click();
  await expect(bar(page)).not.toContainText("계속 분석 중");
  await expect.poll(async () => { const log = await sinceGo(), stop = log.indexOf("> stop");  // 멈춤 → stop → bestmove
    return stop > 0 && log.slice(stop).some((c) => c.startsWith("< bestmove")); }, { timeout: 15_000 }).toBe(true);
});
