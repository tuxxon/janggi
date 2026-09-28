// 빌드 산출물에 넣을 외부 파일을 public/ 으로 복사한다(번들러가 건드리면 안 되는 파일들).
// - Fairy-Stockfish WASM(GPL-3.0): 엔진 스크립트·wasm·pthread 워커·라이선스 원문
// - coi-serviceworker(MIT): GitHub Pages 에서 COOP/COEP 를 붙이는 서비스워커 — 반드시 같은 출처의 별도 파일
import { cpSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";

const FSF = "node_modules/fairy-stockfish-nnue.wasm";
mkdirSync("public/fsf", { recursive: true });
for (const f of ["stockfish.js", "stockfish.wasm", "stockfish.worker.js", "Copying.txt"]) cpSync(`${FSF}/${f}`, `public/fsf/${f}`);
// 수정본(vendor/): 304/204/205 응답에서 Response 생성이 실패해 WebKit 이 엔진 워커를 못 띄우던 문제를 고쳤다.
cpSync("vendor/coi-serviceworker.js", "public/coi-serviceworker.js");

// 개발 편의: 이미 받아 둔 신경망(~/.janggi)을 dev 서버에서만 같은 출처로 쓴다. public/dev-nnue/ 는 gitignore,
// 빌드에서는 vite.config 가 빼고, fsf.js 도 import.meta.env.DEV 일 때만 이 경로를 본다(배포본 무관).
const NET = `${homedir()}/.janggi/janggi-9991472750de.nnue`;
if (existsSync(NET)) { mkdirSync("public/dev-nnue", { recursive: true }); cpSync(NET, "public/dev-nnue/janggi-9991472750de.nnue"); }

// 오픈소스 고지: 번들이 라이선스 주석을 지우므로(React 등 MIT) 원문을 따로 싣는다. AUTHORS 도 엔진 옆에 둔다.
import { readFileSync, writeFileSync } from "node:fs";
cpSync(`${FSF}/AUTHORS`, "public/fsf/AUTHORS");
const pkg = (name) => JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8")).version;
const notices = [
  ["react", "node_modules/react/LICENSE"],
  ["react-dom", "node_modules/react-dom/LICENSE"],
  ["scheduler", "node_modules/scheduler/LICENSE"],
  ["coi-serviceworker", "node_modules/coi-serviceworker/LICENSE"], // 수정본을 배포한다(vendor/coi-serviceworker.js)
  ["Fairy-Stockfish (fairy-stockfish-nnue.wasm)", `${FSF}/Copying.txt`],
].map(([name, file]) => `== ${name} ${pkg(name.startsWith("Fairy") ? "fairy-stockfish-nnue.wasm" : name)}\n\n${readFileSync(file, "utf8").trim()}\n`);
mkdirSync("public/licenses", { recursive: true });
writeFileSync("public/licenses/THIRD_PARTY_NOTICES.txt", `이 앱(장기, GPL-3.0-or-later)이 함께 배포하는 제3자 소프트웨어의 라이선스 원문.\n\n${notices.join("\n")}`);
