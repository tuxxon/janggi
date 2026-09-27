import { defineConfig } from "vitest/config";

// Playwright smoke.spec.js는 test:e2e로 별도 실행한다.
export default defineConfig({ test: { include: ["test/**/*.test.js"] } });
