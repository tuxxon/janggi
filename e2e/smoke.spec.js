import { test, expect } from "@playwright/test";
import { openIsolated } from "./helpers.js";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { NNUE } from "../src/analysis/fsf.js";
import { replay } from "../src/record.js";

const LOCAL_NNUE = `${homedir()}/.janggi/${NNUE.name}`;

const START_FEN = "rnba1abnr/4k4/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/4K4/RNBA1ABNR w - - 0 1";

// 보드 SVG viewBox(560x620) 좌표 → 화면 좌표. MG=40, S=60, 초가 아래(뒤집지 않음).
async function clickSq(page, r, c) {
  // selectOption 등이 페이지를 스크롤하면 판 윗줄이 화면 밖으로 나가 클릭이 허공에 떨어진다 → 판을 가운데로.
  await page.locator("svg").first().evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = await page.locator("svg").first().boundingBox();
  const k = box.width / 560;
  await page.mouse.click(box.x + (40 + c * 60) * k, box.y + (40 + r * 60) * k);
}

test("앱이 뜨고, 격리가 켜지고, 기본 평가 승률이 나오고, 모든 수를 분석한다", async ({ page }) => {
  const externalRequests = [];
  page.on("request", (request) => { if (/drive\.(usercontent\.)?google\.com/.test(request.url())) externalRequests.push(request.url()); });
  // 서버는 격리 헤더를 보내지 않는다(GitHub Pages 와 같은 조건). 격리는 오직 coi-serviceworker 로 켜져야 한다.
  // (vite preview 가 server.headers 를 물려받아 이 경로를 한 번도 안 탔던 적이 있다 — 2026-09-28)
  const direct = await page.request.get("/janggi/");
  expect(direct.headers()["cross-origin-embedder-policy"]).toBeUndefined();
  expect(direct.headers()["cross-origin-opener-policy"]).toBeUndefined();
  await openIsolated(page);
  await expect(page.getByRole("heading", { name: "장기" })).toBeVisible();

  // 배포본에는 신경망이 없다. 기본 평가도 모든 국면을 분석한다.
  const bar = page.getByTestId("winbar");
  await expect(bar).toHaveAttribute("data-nnue", "off");
  await expect(bar).toContainText("기본 평가(약함)");
  await expect(bar).toHaveAttribute("data-cho-win", /\d/, { timeout: 30_000 });
  const w0 = Number(await bar.getAttribute("data-cho-win"));
  expect(w0).toBeGreaterThanOrEqual(0);
  expect(w0).toBeLessThanOrEqual(100);
  const fen0 = await bar.getAttribute("data-fen");
  expect(fen0).not.toBe(START_FEN); // 원본 기본값은 마상마상 → FSF startpos(마상상마)와 다르다

  // 사람(초): a4 졸 → a5. 엔진(한)이 응수하면 다시 초 차례이고, 분석한 국면이 바뀐다.
  await clickSq(page, 6, 0);
  await clickSq(page, 5, 0);
  await expect(page.getByText("내 차례예요")).toBeVisible({ timeout: 20_000 });
  await expect(bar).not.toHaveAttribute("data-fen", fen0, { timeout: 30_000 });
  await expect(bar).toHaveAttribute("data-fen", / w - - 0 1$/, { timeout: 30_000 }); // 다시 초 차례
  await expect.poll(async () => (await latestRecord(page))?.analysis?.evals.map((e) => e?.ply), { timeout: 30_000 }).toEqual([0, 1, 2]);
  await expect(page.getByTestId("last-evaluation")).toContainText("한");
  expect(externalRequests).toEqual([]);
  await page.screenshot({ path: "test-results/smoke.png", fullPage: true });
});

async function openGame(page) {
  await openIsolated(page);
  await expect(page.getByRole("heading", { name: "장기" })).toBeVisible();
}
const latestRecord = (page) => page.evaluate(() => {
  const index = JSON.parse(localStorage.getItem("janggi.index") || "[]");
  return index.length ? JSON.parse(localStorage.getItem(`janggi.game.${index[0].id}`)) : null;
});

test("편별 컨트롤러 설정, 사람끼리 대국, 새로고침 복원과 무르기", async ({ page }) => {
  await openGame(page);
  const cho = page.getByLabel("아래 두는 이", { exact: true }), han = page.getByLabel("위 두는 이", { exact: true });
  await expect(cho).toHaveValue("human");
  await expect(han).toHaveValue("engine");
  await han.selectOption("human");
  // 사람/엔진은 고르는 즉시 지금 판에 반영된다(사용자 요청 2026-09-28). 난이도·상차림만 새 게임부터.
  await expect.poll(async () => (await latestRecord(page))?.controllers).toEqual({ c: "human", h: "human" });
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
  await page.getByLabel("아래 두는 이", { exact: true }).selectOption("engine");
  await page.getByLabel("난이도", { exact: true }).selectOption("2");
  await page.getByRole("button", { name: "새 게임" }).click();
  await expect(page.getByText("엔진이 생각하는 중…", { exact: true })).toBeVisible();
  await expect.poll(async () => (await latestRecord(page))?.moves.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(4);
  await expect(page.getByRole("button", { name: "무르기" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "한 수 쉬기" })).toBeDisabled();
  // 진행 중인 엔진 타이머를 새 판이 취소해야 한다.
  await page.getByLabel("아래 두는 이", { exact: true }).selectOption("human");
  await page.getByLabel("위 두는 이", { exact: true }).selectOption("human");
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


test("저장이 실패해도 대국을 계속하고 백업 안내를 표시한다", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith("janggi.")) throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await openGame(page);
  await expect(page.getByRole("alert").filter({ hasText: "기보 저장 실패 — 내보내기로 백업하세요" })).toBeVisible();
  await page.getByLabel("위 두는 이", { exact: true }).selectOption("human");
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

test("최강은 엔진 차례에 합법 수를 두고 그 탐색을 기보 분석으로 저장한다", async ({ page }) => {
  await openGame(page);
  await expect(page.locator('option[value="max"]')).toBeEnabled({ timeout: 30_000 });
  await page.getByLabel("난이도", { exact: true }).selectOption("max");
  await page.getByRole("button", { name: "새 게임" }).click();
  await clickSq(page, 6, 0); await clickSq(page, 5, 0);
  await expect.poll(async () => (await latestRecord(page))?.moves.length, { timeout: 30_000 }).toBe(2);
  const saved = await latestRecord(page);
  expect(saved.level).toBe("max");
  // replay calls the original game.play legality checks, including voluntary pass.
  expect(replay(saved).state.turn).toBe("c");
  await expect.poll(async () => (await latestRecord(page))?.analysis?.evals.map((e) => e?.ply), { timeout: 30_000 }).toEqual([0, 1, 2]);
  expect((await latestRecord(page)).analysis.engine).toContain("max-movetime=1000");
  await expect(page.getByText("내 차례예요 · 초(파랑)", { exact: true })).toBeVisible();
});

test("후보 수 보기는 선택한 기물의 도착 칸에 승률을 붙이고 선택 해제 시 지운다", async ({ page }) => {
  await openGame(page);
  await page.getByLabel("위 두는 이", { exact: true }).selectOption("human");
  await page.getByRole("button", { name: "새 게임" }).click();
  await expect(page.getByLabel("후보 수 보기")).not.toBeChecked();
  await page.getByLabel("후보 수 보기").check();
  await clickSq(page, 6, 0);
  await expect(page.getByTestId("target-win")).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByTestId("target-win").locator("text").first()).toHaveText(/\d+%/);
  expect(await page.getByTestId("target-win").evaluateAll((els) => els.map((el) => el.dataset.move).sort())).toEqual(["a4a5", "a4b4"]);
  await expect(page.getByTestId("candidates").locator("li")).toHaveCount(5);
  await clickSq(page, 6, 2);
  await expect(page.getByTestId("target-win")).toHaveCount(3, { timeout: 30_000 });
  expect(await page.getByTestId("target-win").evaluateAll((els) => els.map((el) => el.dataset.move).sort())).toEqual(["c4b4", "c4c5", "c4d4"]);
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/m2-hints-mobile.png", fullPage: true });
  await clickSq(page, 6, 2);
  await expect(page.getByTestId("target-win")).toHaveCount(0);
  await page.getByLabel("후보 수 보기").uncheck();
  await expect(page.getByTestId("candidate-win")).toHaveCount(0);
});

test("신경망 파일 선택은 NNUE를 켜고 캐시에서 복원하며 지우면 기본 평가로 돌아간다", async ({ page }) => {
  test.skip(!existsSync(LOCAL_NNUE), `로컬 신경망 없음: ${LOCAL_NNUE}`);
  await openGame(page);
  const bar = page.getByTestId("winbar");
  await expect(bar).toHaveAttribute("data-cho-win", /\d/, { timeout: 30_000 });
  await expect(bar).toHaveAttribute("data-nnue", "off");
  await page.getByLabel("신경망 넣기", { exact: true }).setInputFiles(LOCAL_NNUE);
  await expect(bar).toHaveAttribute("data-nnue", "on", { timeout: 30_000 });
  await expect(bar).toHaveAttribute("data-cho-win", /\d/, { timeout: 30_000 });
  await page.reload();
  await expect(bar).toHaveAttribute("data-nnue", "on", { timeout: 30_000 });
  await page.getByRole("button", { name: "신경망 지우기" }).click();
  await expect(bar).toHaveAttribute("data-nnue", "off", { timeout: 30_000 });
  await expect(bar).toHaveAttribute("data-cho-win", /\d/, { timeout: 30_000 });
  await page.reload();
  await expect(bar).toHaveAttribute("data-cho-win", /\d/, { timeout: 30_000 });
  await expect(bar).toHaveAttribute("data-nnue", "off");
});

test("잘못된 신경망 파일은 이유를 표시하고 캐시에 넣지 않는다", async ({ page }) => {
  await openGame(page);
  await page.getByLabel("신경망 넣기", { exact: true }).setInputFiles({ name: "wrong.nnue", mimeType: "application/octet-stream", buffer: Buffer.from("bad network") });
  await expect(page.getByRole("alert")).toContainText("NNUE 크기가 달라요");
  const bar = page.getByTestId("winbar");
  await expect(bar).toHaveAttribute("data-nnue", "off");
  await page.reload();
  await expect(bar).toHaveAttribute("data-cho-win", /\d/, { timeout: 30_000 });
  await expect(bar).toHaveAttribute("data-nnue", "off");
});

test("대국 중에 한을 사람으로 바꾸면 엔진이 대신 두지 않고, 엔진으로 되돌리면 그 자리에서 둔다 (사용자 요청)", async ({ page }) => {
  await openGame(page);
  await page.getByRole("button", { name: "새 게임" }).click();           // 기본: 초 사람 · 한 엔진
  await page.getByLabel("위 두는 이", { exact: true }).selectOption("human"); // 새 게임은 누르지 않는다
  await clickSq(page, 6, 0); await clickSq(page, 5, 0);                   // 초 a4a5
  await expect(page.getByTestId("status")).toHaveText("한(빨강) 차례예요.");
  await page.waitForTimeout(1500);
  expect(await latestRecord(page)).toMatchObject({ moves: ["a4a5"], controllers: { c: "human", h: "human" } });
  await clickSq(page, 3, 0); await clickSq(page, 4, 0);                   // 사람이 된 한이 직접 a7a6
  await expect.poll(async () => (await latestRecord(page)).moves).toEqual(["a4a5", "a7a6"]);
  await page.getByLabel("아래 두는 이", { exact: true }).selectOption("engine"); // 초를 엔진으로 → 초 차례라 바로 둔다
  await expect.poll(async () => (await latestRecord(page)).moves.length, { timeout: 10_000 }).toBe(3);
  await expect(page.getByTestId("status")).toHaveText("내 차례예요 · 한(빨강)");
});

test("엔진이 생각하는 중에 그 편을 사람으로 바꾸면 엔진의 수는 버린다", async ({ page }) => {
  await openGame(page);
  await page.getByRole("button", { name: "새 게임" }).click();
  await page.clock.install({ time: new Date("2026-09-28T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-09-28T00:01:00Z"));
  await clickSq(page, 6, 0); await clickSq(page, 5, 0);                   // 한(엔진)의 420ms 타이머가 걸린다
  await page.getByLabel("위 두는 이", { exact: true }).selectOption("human");
  await page.clock.runFor(1000);
  expect((await latestRecord(page)).moves).toEqual(["a4a5"]);
  await expect(page.getByTestId("status")).toHaveText("한(빨강) 차례예요.");
});

test("설정은 넓은 화면에서 판 오른쪽, 좁은 화면에서 판 아래에 있다 (사용자 요청)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openGame(page);
  const board = await page.locator("svg[data-fen]").boundingBox(), panel = await page.getByTestId("settings").boundingBox();
  expect(panel.x).toBeGreaterThanOrEqual(board.x + board.width);
  expect(panel.y).toBeLessThan(board.y + board.height);
  await page.screenshot({ path: "test-results/layout-wide.png", fullPage: true });
  await page.setViewportSize({ width: 360, height: 800 });
  const board2 = await page.locator("svg[data-fen]").boundingBox(), panel2 = await page.getByTestId("settings").boundingBox();
  expect(panel2.y).toBeGreaterThanOrEqual(board2.y + board2.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/layout-narrow.png", fullPage: true });
});

test("위·아래 나라는 연동되고 새 게임부터 적용되며, 한이 아래여도 초가 먼저 둔다 (사용자 요청)", async ({ page }) => {
  await openGame(page);
  await page.getByRole("button", { name: "새 게임" }).click();                   // 기본: 위 한(엔진) · 아래 초(사람)
  await page.getByLabel("아래 나라", { exact: true }).selectOption("h");
  await expect(page.getByLabel("위 나라", { exact: true })).toHaveValue("c");     // 연동
  await expect(page.getByTestId("pending")).toContainText("나라");                // 지금 판은 그대로, 새 게임부터
  expect((await latestRecord(page)).bottom).toBe("c");
  await page.getByLabel("난이도", { exact: true }).selectOption("2");
  await page.getByRole("button", { name: "새 게임" }).click();
  await expect(page.getByTestId("pending")).toHaveCount(0);
  // 선수는 초(위, 엔진): 스스로 한 수 두고, 아래 한(사람) 차례가 된다
  await expect(page.getByTestId("status")).toHaveText("내 차례예요 · 한(빨강)", { timeout: 10_000 });
  const rec = await latestRecord(page);
  expect(rec).toMatchObject({ bottom: "h", controllers: { c: "engine", h: "human" } });
  expect(rec.moves).toHaveLength(1);
  // 판이 뒤집혔다: 화면 아래 오른쪽(6,8)이 한의 a7 병
  await clickSq(page, 6, 8); await clickSq(page, 5, 8);
  await expect.poll(async () => (await latestRecord(page)).moves[1]).toBe("a7a6");
  await page.reload();
  await expect(page.getByLabel("아래 나라", { exact: true })).toHaveValue("h");
  expect((await latestRecord(page)).bottom).toBe("h");
});

test("반복수: 같은 수를 세 번째 두려 하면 그 칸에 ✕가 뜨고 둘 수 없다 (사용자 요청)", async ({ page }) => {
  await openGame(page);
  await page.getByLabel("위 두는 이", { exact: true }).selectOption("human");   // 사람끼리
  await page.getByRole("button", { name: "새 게임" }).click();
  // 초 차 a1↔a2, 한 차 i10↔i9 를 두 번씩 왕복한다
  for (const [r1, c1, r2, c2] of [[9, 0, 8, 0], [0, 8, 1, 8], [8, 0, 9, 0], [1, 8, 0, 8], [9, 0, 8, 0], [0, 8, 1, 8], [8, 0, 9, 0], [1, 8, 0, 8]]) {
    await clickSq(page, r1, c1); await clickSq(page, r2, c2);
  }
  await expect.poll(async () => (await latestRecord(page)).moves.length).toBe(8);
  expect((await latestRecord(page)).repetition).toBe(true);
  await clickSq(page, 9, 0);                                                    // 초 차를 집는다
  await expect(page.getByTestId("repetition-blocked")).toHaveCount(1);          // a2 에 ✕
  await clickSq(page, 8, 0);                                                    // 막힌 칸을 누른다
  await expect(page.getByTestId("notice")).toContainText("반복수");
  expect((await latestRecord(page)).moves).toHaveLength(8);
  await clickSq(page, 7, 0);                                                    // 차는 여전히 선택돼 있다: 다른 수(a1a3)는 된다
  await expect.poll(async () => (await latestRecord(page)).moves.at(-1)).toBe("a1a3");
  await expect(page.getByTestId("notice")).toHaveCount(0);
});
