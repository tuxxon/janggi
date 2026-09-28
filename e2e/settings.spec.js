import { test, expect } from "@playwright/test";
import { openIsolated } from "./helpers.js";

// 설정 패널(자리별 나라·두는 이·상차림)과 판 방향 — 리뷰(Opus, 설정·방향)가 짚은 빈틈을 메우는 테스트.
const latestRecord = (page) => page.evaluate(() => {
  const index = JSON.parse(localStorage.getItem("janggi.index") || "[]");
  return index.length ? JSON.parse(localStorage.getItem(`janggi.game.${index[0].id}`)) : null;
});
// 화면 왼쪽 위 칸(x=40, y=40)에 그려진 기물의 색: 뒤집히면 초(파랑) 차, 아니면 한(빨강) 차.
const topLeftColor = (page) => page.locator('svg[data-fen] text[x="40"][y="41"]').getAttribute("fill");
const BLUE = "#1b4a8c", RED = "#ae2219";
const select = (page, label) => page.getByLabel(label, { exact: true });

test("아래가 한이면 사람끼리여도 판이 뒤집히고, 새로고침해도 그대로다 (새 규칙이 옛 규칙과 갈리는 경우)", async ({ page }) => {
  await openIsolated(page);
  await page.getByRole("button", { name: "새 게임" }).click();
  expect(await topLeftColor(page)).toBe(RED);
  await select(page, "위 두는 이").selectOption("human");                   // 사람끼리: 옛 규칙이면 초가 아래
  await select(page, "아래 나라").selectOption("h");
  await page.getByRole("button", { name: "새 게임" }).click();
  expect(await latestRecord(page)).toMatchObject({ bottom: "h", controllers: { c: "human", h: "human" } });
  expect(await topLeftColor(page)).toBe(BLUE);
  await page.reload();
  await expect(select(page, "아래 나라")).toHaveValue("h");
  expect(await topLeftColor(page)).toBe(BLUE);
});

test("나라 변경이 대기 중일 때 두는 이는 지금 그 자리에 앉은 나라에 적용되고, 테두리 제목은 지금 나라다", async ({ page }) => {
  await openIsolated(page);
  await page.getByRole("button", { name: "새 게임" }).click();              // 위 한(엔진) · 아래 초(사람)
  await select(page, "아래 나라").selectOption("h");
  await expect(page.getByTestId("pending")).toHaveText("새 게임부터 적용: 나라");
  await select(page, "아래 두는 이").selectOption("engine");
  expect((await latestRecord(page)).controllers).toEqual({ c: "engine", h: "engine" }); // 지금 아래는 초
  await expect(page.getByRole("group", { name: /아래쪽/ })).toContainText("아래쪽 · 지금 초나라");
});

test("상차림·난이도 변경은 알림에 그대로 뜨고, 새 게임에 그 자리의 나라로 들어간다", async ({ page }) => {
  await openIsolated(page);
  await page.getByRole("button", { name: "새 게임" }).click();              // 아래 초 · 위 한
  await select(page, "아래 상차림").selectOption("상마상마");
  await select(page, "난이도").selectOption("2");
  await expect(page.getByTestId("pending")).toHaveText("새 게임부터 적용: 아래 상차림, 난이도");
  await select(page, "위 상차림").selectOption("마상상마");
  await expect(page.getByTestId("pending")).toHaveText("새 게임부터 적용: 위 상차림, 아래 상차림, 난이도");
  await page.getByRole("button", { name: "새 게임" }).click();
  expect(await latestRecord(page)).toMatchObject({ setups: { c: "상마상마", h: "마상상마" }, level: 2 });
  await expect(page.getByTestId("pending")).toHaveCount(0);
});

test("복기 중에는 설정 대신 복기 조작이 판 오른쪽에 오고, 아래가 한인 기보는 뒤집혀 보인다", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openIsolated(page);
  const flipped = { v: 1, id: "2026-09-27T10-00-00-000", createdAt: "2026-09-27T10:00:00.000Z", bottom: "h",
    setups: { c: "마상마상", h: "마상마상" }, controllers: { c: "human", h: "human" }, level: 3, moves: ["a4a5"], result: null };
  await page.evaluate((r) => {
    const index = JSON.parse(localStorage.getItem("janggi.index") || "[]");
    localStorage.setItem(`janggi.game.${r.id}`, JSON.stringify(r));
    localStorage.setItem("janggi.index", JSON.stringify([...index, { id: r.id, createdAt: r.createdAt }]));
  }, flipped);
  await page.reload();
  expect(await topLeftColor(page)).toBe(RED);                                // 진행 중인 판은 초가 아래
  await page.getByRole("button", { name: "기보" }).click();
  await page.getByTestId("game-item").filter({ hasText: "1수" }).getByRole("button", { name: "복기" }).click();
  expect(await topLeftColor(page)).toBe(BLUE);                               // 복기 판은 그 기보의 방향(한이 아래)
  await expect(page.getByTestId("settings")).toHaveCount(0);
  const board = await page.locator("svg[data-fen]").boundingBox(), nav = await page.getByRole("button", { name: "처음" }).boundingBox();
  expect(nav.x).toBeGreaterThanOrEqual(board.x + board.width);
  expect(nav.y).toBeLessThan(board.y + board.height);
});
