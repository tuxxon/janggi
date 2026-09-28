import { defineConfig } from "vitest/config";

// Playwright(e2e/)는 test:e2e로 별도 실행한다. __APP_COMMIT__ 은 빌드(vite.config.js)가 git 커밋으로 채운다.
export default defineConfig({ define: { __APP_COMMIT__: JSON.stringify("test") }, test: { include: ["test/**/*.test.js"] } });
