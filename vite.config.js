import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { rmSync } from "node:fs";
import { execSync } from "node:child_process";

// "앱 소스" 링크가 배포한 커밋을 가리키게 한다(GPL 대응 소스). git 이 없으면 main.
const commit = (() => { try { return execSync("git rev-parse HEAD").toString().trim(); } catch { return "main"; } })();

// dev 서버만 격리 헤더를 직접 붙인다. preview(=GitHub Pages 흉내)는 헤더 없이 서비스워커 경로를 탄다.
// public/dev-nnue(로컬 신경망 사본)는 dev 전용 — 빌드 산출물에서 지운다(재배포하지 않는다).
export default defineConfig({
  base: "/janggi/",
  define: { __APP_COMMIT__: JSON.stringify(commit) },
  plugins: [react(), { name: "drop-dev-nnue", apply: "build", closeBundle: () => rmSync("dist/dev-nnue", { recursive: true, force: true }) }],
  server: { headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" } },
  // preview 는 기본으로 server.headers 를 물려받는다 → 헤더를 비워야 GitHub Pages 처럼 서비스워커만으로 격리를 켠다(실측 확인).
  preview: { headers: {} },
});
