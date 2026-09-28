import { defineConfig, devices } from "@playwright/test";

// E2E_PORT: 다른 작업 사본이 같은 포트로 preview 를 띄우고 있으면 그 서버(다른 코드)를 재사용하지 않도록 포트를 바꾼다.
const PORT = Number(process.env.E2E_PORT ?? 4173);
export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, grepInvert: /@webkit-only/ },
    // 아이폰 브라우저는 전부 WebKit 이다: 격리·WASM 엔진(pthread 워커)이 WebKit 에서도 뜨는지만 따로 본다.
    { name: "webkit", use: { ...devices["Desktop Safari"] }, grep: /@webkit/ },
  ],
  webServer: { command: `npx vite preview --port ${PORT} --strictPort`, url: `http://localhost:${PORT}/janggi/`, reuseExistingServer: false },
});
