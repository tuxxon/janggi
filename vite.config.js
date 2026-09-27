import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { rmSync } from "node:fs";

// dev 서버만 격리 헤더를 직접 붙인다. preview(=GitHub Pages 흉내)는 헤더 없이 서비스워커 경로를 탄다.
// public/dev-nnue(로컬 신경망 사본)는 dev 전용 — 빌드 산출물에서 지운다(재배포하지 않는다).
export default defineConfig({
  base: "/janggi/",
  plugins: [react(), { name: "drop-dev-nnue", apply: "build", closeBundle: () => rmSync("dist/dev-nnue", { recursive: true, force: true }) }],
  server: { headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" } },
});
