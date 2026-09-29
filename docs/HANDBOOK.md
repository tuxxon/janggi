# 장기(janggi) 핸드북

다음 세션이 이 문서 하나로 이어서 일할 수 있게 쓴 안내서다. 결정의 근거와 세부 규칙의 정본은 설계 문서다:
[`docs/superpowers/specs/2026-09-28-janggi-mcp-design.md`](superpowers/specs/2026-09-28-janggi-mcp-design.md) (개정 2.8).

- 저장소: `~/workspace/janggi` · GitHub [tuxxon/janggi](https://github.com/tuxxon/janggi) (public)
- 기준: 2026-09-29, main `b50eea8`
- 진행 중 브랜치: `wip/deeper-analysis` (`460d55c`, 테스트만 있고 빨간불)

---

## 1. 지금 어디까지 왔나

**1단계(정적 웹앱)는 끝났고 로컬에서 쓰는 중이다.** 배포와 2단계(MCP)는 아직이다.

| 항목 | 상태 |
|---|---|
| 대국 | 위·아래 자리마다 나라(초/한)·두는 이(사람/엔진)·상차림. 판 방향은 아래쪽 나라를 따르고, 선수는 항상 초 |
| 엔진 | 쉬움·보통·어려움 = 원본 엔진. **최강** = Fairy-Stockfish(WASM)가 항상 최선수 |
| 승률 | 대국 중 막대, 직전 수 변화와 실수 등급(?! ? ??), 훈수 모드(상위 5수 + 집은 기물의 수마다 승률) |
| 기보 | 수마다 localStorage에 저장. 새로고침해도 이어진다. 복기(버튼·←→·수순·그래프, 빈 평가 자동 분석), JSON 내보내기·가져오기 |
| 반복수 | 카카오식: 궁·사가 아닌 기물로 두 칸을 계속 오갈 수 없다(같은 수 세 번째 금지). 쉬기·잡기·장군이 끼면 다시 센다 |
| 표시 | 판에 좌표(아래 a–i, 왼쪽 1–10). 후보 수에 한글 기물 이름("마 g1→f3") |
| 테스트 | 단위 155개 · Playwright 35개(Chromium + WebKit 스모크) — main 에서 전부 초록 |

**진행 중: "수를 더 깊이 보기"** (사용자가 네 가지를 다 골랐다. 5절 참고)

## 2. 실행과 테스트

```bash
cd ~/workspace/janggi
npm install
npm run dev                          # http://localhost:5173/janggi/  (dev 는 격리 헤더를 직접 붙임)
npm test                             # vitest 단위(규칙 대조 포함)
E2E_PORT=4191 npm run test:e2e       # 빌드 후 Playwright. 포트가 겹치면 E2E_PORT 로 바꾼다
npm run build                        # dist/ (GitHub Pages 용, base /janggi/)
```

- **신경망**: `~/.janggi/janggi-9991472750de.nnue`(11,261,920바이트)가 있으면 dev 서버가 자동으로 쓴다. 배포본은 사용자가 "신경망 넣기"로 직접 넣는다(재배포하지 않음, 라이선스 불명).
- **브라우저**: Playwright Chromium·WebKit 이 `~/Library/Caches/ms-playwright`에 설치돼 있다.
- **네이티브 엔진**: `brew install fairy-stockfish`(14.0.1 arm64)는 실측용으로만 설치돼 있다. 앱은 WASM만 쓴다.

## 3. 구조

```
src/engine.js          원본 규칙·탐색(Janggi.jsx 에서 그대로 떼어냄. export 목록만 추가: order, search)
src/notation.js        칸·수·FEN, describeMove("마 g1→f3")
src/game.js            순수 상태 기계: newGame{controllers, level, setups, bottom, repetition}, play, undo(지금 컨트롤러 유지),
                       setControllers, legalMoves(반복수 반영), 전이(외통수/자동 쉬기/장군)
src/repetition.js      반복수 forbiddenMove(state) — 막힐 수 있는 수는 "직전 내 수를 되돌리는 수" 하나뿐
src/record.js          기보 v1(+bottom, +repetition), replay, 검증(모르는 키 제거, 수순 5000 상한은 storage 가져오기에서)
src/storage.js         localStorage: 판마다 키 하나 + 목록. list/load/put/records, save{touch:false}=복기 판 저장(순서 유지)
src/seats.js           자리 설정: seatsOf/chooseNation(연동)/nextGame/pendingOf/whoApplied/withWho(끝난 판은 안 건드림)
src/winrate.js         cp→승률(lichess 체스 곡선, 추정치), moveDelta, grade, moverWin
src/review.js          복기 순수 계산(reviewRows, chartPoints, resultText)
src/Janggi.jsx         화면(판 SVG·드래그·애니메이션은 원본). 왼쪽 판 열 + 오른쪽 패널(설정 또는 복기)
src/Settings.jsx       설정 패널(자리별 나라·두는 이·상차림, 난이도, "새 게임부터 적용" 알림)
src/Review.jsx         기보 목록, 복기 패널, 승률 그래프
src/engineMove.js      원본 bestMove 루트 루프에서 막힌 수 하나를 뺀 버전
src/analysis/service.js      UCI 서비스(주입된 엔진): 국면 대기열(빠짐없이 순서대로), 최강 우선, 초점 분석, 신경망 교체, 재시작 1회
src/analysis/gameAnalysis.js 판 ↔ 서비스 연결(analysisPositions{restrictions}, cacheEvaluation 병합, engineTurn)
src/analysis/useAnalysis.js  React 훅(판별 캐시, known 평가 전달)
src/analysis/fsf.js / nnue.js  WASM 로더, 사용자 신경망(크기+SHA-256 전체)
vendor/coi-serviceworker.js  격리 서비스워커 수정본(MIT) — WebKit 304 처리
scripts/vendor.mjs     public/ 으로 엔진 파일·SW·라이선스 고지 복사(dev/build 전에 자동)
e2e/                   smoke / review / settings .spec.js + helpers.js(openIsolated, clickBoard)
```

## 4. 사용자가 정한 것 (다시 묻지 말 것)

- **구성**: Pages 정적 웹앱(1단계) → GCF MCP(2단계). 로컬 서버와 cloudflared는 쓰지 않는다. 앱(Flutter)은 웹 검증 뒤에 판단한다.
- **저장소**: 최종 위치는 `touchizen/janggi`, 라이선스는 GPL-3.0. touchizen 은 **사용자 계정**이라 이전하려면 수락이 필요하다.
- **승률 표시**: 네 가지 전부. AI 에이전트(2단계)에게는 **대국 중에 승률을 숨긴다.**
- **신경망**: 기본 평가 + 사용자가 넣기(Drive 는 브라우저 요청을 403 으로 막는다).
- **최강**: Fairy-Stockfish가 항상 최선수(bestmove). 신경망이 없으면 기본 평가로 두고 그렇게 표시한다. 조용히 약한 엔진으로 바꾸지 않는다.
- **두는 이(사람/엔진)는 고르는 즉시 적용**. 나라·상차림·난이도는 새 게임부터(알림으로 표시).
- **반복수**: "카카오 장기 규칙을 따르면 돼", "궁과 사는 무한 반복수 가능", "상대방이 한 수 쉬면, 우린 둘 수 있는 거거든".
  - 카카오 공식 문서는 못 찾았다. 그래서 FSF `janggimodern`(카카오 호환)을 줄 단위로 따라갔고, 리뷰어가 6,400국면을 대조해서 차이 0을 확인했다.
  - 사용자 규칙으로 쉬기(내 쉬기·상대 쉬기·자동 쉬기)가 끼면 셈이 끊긴다. 이 부분은 FSF와 다르다.
  - 새 판부터 적용한다(`repetition: true`). 옛 기보는 규칙 없이 재생한다.
- **분석 깊이**(진행 중): 계속 깊게 보기 + 코어 여러 개 + 최강 더 깊게 + 설정에서 고르기 — **네 가지 전부**.

## 5. 다음 할 일 — "더 깊이 보기" (진행 중)

### 5.1 정한 동작
- **설정 패널에 "분석" 선택지**: 빠르게(0.8초) / 깊게(3초) / **계속**(기본).
  - 계속: 0.8초 결과를 먼저 보여주고, 다음 수를 둘 때까지 그 국면을 최대 20초 동안 계속 깊게 읽는다.
  - 보기 설정이라 즉시 적용하고, localStorage(예: `janggi.prefs`)에 기억한다.
- **코어**: `Threads = clamp(floor(navigator.hardwareConcurrency / 2), 1, 8)`. 이 맥(14코어)이면 7. Hash 는 64MB.
- **최강**: 3000ms(원래 1000), MultiPV 1, 위 스레드 수.
- **복기**: 보고 있는 k수째 국면을 계속 깊게 읽는다(`service.deepen(k)`).

### 5.2 실측 근거 (M3 Max, Chromium WASM, NNUE)

| 설정 | 초반 | 중반 |
|---|---|---|
| 지금: MultiPV 5 · 1스레드 · 0.8초 | depth 11 | depth 13 |
| 4스레드 · 0.8초 | 12 | 15 |
| 1스레드 · 3초 | 14 | 18 |
| 8스레드 · 3초 | 17 | 20 |
| MultiPV 1 · 4스레드 · 3초 | 16 | 28 |

### 5.3 구현 순서 (TDD — 빨간 테스트는 이미 있다)
1. `git checkout wip/deeper-analysis`로 가서 `npx vitest run test/analysis.test.js`를 돌린다. `describe("deeper analysis …")`의 11개가 빨간 게 정상이다.
2. **`src/analysis/service.js`**
   - 옵션을 받는다: `threads`(기본 1), `hash`(기본 32), `mode`(`"fast"|"deep"|"continuous"`, 기본 `"fast"`). `setMode(m)`, `deepen(ply|null)`를 추가한다.
   - movetime: fast 800 / deep 3000 / continuous 1차 800 → 깊게 보기는 `go movetime 20000`. 최강 3000, 초점 500.
   - 우선순위: 최강 > 밀린 국면(순서대로) > 초점 > 깊게 보기(대기 중인 일이 없을 때만). **최강 차례 국면은 깊게 보지 않는다.**
   - 선점: `sync`로 판이 바뀌거나(새 수가 붙는 경우 포함), `focus`, `setMode`(continuous가 아닌 쪽으로), `deepen`(다른 ply로), `setNetwork`, `dispose`가 오면 깊게 보던 탐색을 `stop`한다.
   - **점진 결과**: `multipv 1` 줄이 **지금 보여준 결과보다 깊을 때만** `onResult`로 보낸다. 선점 뒤 다시 시작한 얕은 탐색이 표시를 뒤로 돌리지 않게 하려는 것이다.
   - 20초 상한을 다 채운 ply는 다시 깊게 보지 않는다. `setMode`나 `setNetwork`가 오면 다시 허용한다.
   - 🔴 **감시 타이머(RESPONSE_TIMEOUT 15초)를 `movetime + 15초`로 바꿔야 한다.** 그대로면 20초 탐색이 매번 "엔진 실패"로 끝난다.
   - `status.deepening`을 publish 한다.
3. **`src/analysis/fsf.js` / `useAnalysis.js`**: 스레드 수를 계산해서 넘기고, mode를 넘기고(prefs), 복기면 `deepen(k)`를 부르고, 대국으로 돌아오면 `deepen(null)`을 부른다.
4. **`Settings.jsx`**: "분석" 선택지(빠르게/깊게/계속)를 넣는다. **`Janggi.jsx`** 승률 막대 설명에는 "깊이 N · 계속 분석 중"을 표시한다.
5. `gameAnalysis.cacheEvaluation`의 engine 문자열에 모드와 최강 시간을 반영한다(평가 병합 로직은 그대로).
6. **e2e**
   - 모드 선택지가 있고 새로고침 뒤에도 기억되는지
   - "계속"에서 깊이가 시간이 지나며 커지는지
   - 기존 e2e는 CPU 부하로 흔들릴 수 있다 → `openIsolated`에서 prefs를 "빠르게"로 심는 걸 고려한다. 모드 테스트만 따로 계속 모드로 돌린다.
7. Opus×2 적대적 리뷰(worktree, 서로 다른 `E2E_PORT`) → HIGH/MED 고침 → main에 병합하고 푸시한다.

## 6. 그 뒤에 남은 것

**사용자에게 물어두고 답을 못 받은 것**
- 난이도도 대국 중에 즉시 바꿀까? (지금은 새 게임부터)
- 직전 수 평가 줄과 복기 수순에도 한글 기물 이름을 넣을까? (지금은 후보 수에만)

**배포 (사용자 동의가 필요한 바깥 작업)**
1. `gh api repos/tuxxon/janggi/transfer -f new_owner=touchizen`으로 이전을 요청한다. 사용자가 touchizen 계정으로 수락해야 한다.
2. 이전한 저장소에서 Pages(소스: GitHub Actions)를 켠다.
3. `.github/workflows/deploy.yml`의 트리거를 `workflow_dispatch`에서 push 로 바꾼다.
4. `touchizen.com/janggi/`에서 다음을 확인한다: 격리, WebKit, 신경망 넣기, 기보.

**2단계: GCF MCP** (spec 12절)
- 새 Firebase 프로젝트는 사용자가 만든다(결제 연결 필요).
- 판 코드로 판을 가르고, Firestore 에 저장하고 실시간으로 동기화한다. 도구는 get_state / new_game / make_move / wait_for_turn / list_games / get_game 이다.
- **대국 중인 에이전트에게는 승률을 숨긴다.**
- `game.js`와 `engine.js`를 그대로 서버에서 쓴다. 수순 길이 상한을 둔다(재생 비용이 대략 수순 길이의 제곱).

**알려진 한계 (LOW)**
- 같은 판을 탭 두 개에서 열면 서로 덮어쓴다.
- 앱 안에 기보 삭제가 없어서 저장 공간이 결국 찬다.
- 바꿔 둔 나라·상차림·난이도는 새로고침하면 사라진다.
- 동형반복(서로 다른 기물로 같은 국면 반복)과 만년장 전체 규칙은 범위 밖이다.
- 쉬기 처리는 FSF와 다르다(의도한 것).

## 7. 일하는 방식 (이 프로젝트에서 합의·확인된 것)

- **TDD**: 실패하는 테스트를 먼저 쓰고, 기대값은 리터럴로 박는다.
  - 새 테스트는 **일부러 망가뜨려서 빨개지는지** 확인한다. "뮤테이션 확인" 같은 말을 커밋에 쓰기 전에 실제로 돌린다. 한 번 거짓으로 쓴 적이 있다.
  - 공허한 검사(무엇을 해도 초록)를 조심한다. 예: 복기 중에는 진행 중인 판을 저장하지 않으니, localStorage 만 보면 멈췄는지 알 수 없다.
- **작성자와 리뷰어**
  - 어려운 저작은 Codex(`gpt-6-astra` xhigh) 또는 Fable 5.1 이 맡는다. **현재 둘 다 못 쓴다.** Codex는 **2026-10-04 06:02까지 주간 한도**이고, Fable 은 크레딧이 없다. 그래서 내가 쓰고 Opus×2 적대적 리뷰를 붙인다(Sonnet 리뷰 금지).
  - Codex CLI: `npx -y @openai/codex@latest exec --sandbox workspace-write --skip-git-repo-check -c model="gpt-6-astra" -c model_reasoning_effort="xhigh" -c sandbox_workspace_write.network_access=true -o <out> - < <prompt>`
  - Codex 샌드박스에서는 Chromium을 못 띄운다. 그래서 e2e는 내가 돌린다.
  - 리뷰는 HIGH/MED 까지 고치고 멈춘다. 산출물에 비례해서 한다.
- **UI는 눈으로 확인한다**: 스크린샷을 찍어서 직접 본다(넓은 화면, 360px, 뒤집힌 판).
- **커밋**: 메시지는 영어로 쓰고, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`을 붙인다. main에 바로 커밋하고 푸시한다.

## 8. 함정 모음 (실제로 당한 것)

| 함정 | 대처 |
|---|---|
| `vite preview`가 dev의 `server.headers`를 물려받아 "Pages 흉내"가 서비스워커 경로를 한 번도 안 탔다 | `preview.headers: {}`. smoke 테스트가 "헤더 없음"을 단언한다 |
| coi-serviceworker 0.1.7: WebKit에서 credentialless가 엔진 워커를 막고, fetch 처리기가 304에서 TypeError | `window.coi.coepCredentialless = () => false` + `vendor/` 수정본 |
| 서비스워커 첫 방문 새로고침이 두 번 걸려 테스트와 경합한다 | `openIsolated`: 격리를 확인한 뒤 한 번 더 goto |
| Playwright 실행이 시작할 때 `test-results/`를 비운다 | 눈으로 볼 스크린샷은 스크래치 폴더에 찍는다 |
| SVG `<text>`의 innerText가 빈 문자열 | `textContent`로 읽는다 |
| `selectOption`이 페이지를 스크롤해서 좌표 클릭이 허공에 떨어진다 | `clickBoard`: scrollIntoView + `getScreenCTM` |
| 리뷰어 worktree가 같은 preview 포트를 쓴다 | `E2E_PORT`로 분리한다(재사용하면 다른 코드를 테스트하게 된다) |
| Node 22 에서 WASM 엔진 로더가 fetch로 파일 경로를 열다 죽는다 | `delete globalThis.fetch`(규칙 대조 테스트) |
| 엔진에 `quit`을 보내면 Emscripten이 process.exit로 vitest 작업자를 죽인다 | quit을 보내지 않는다 |
| FSF는 쉬기를 궁 제자리 수로 쓴다(`e2e2`) | `uciToMove`가 `pass`로 바꾼다. searchmoves 에도 그 표기로 넣는다 |
| MultiPV 반복이 중간에 멈추면 뒤 순위에 옛 줄이 남아 같은 수가 두 번 나온다 | 순위순으로 중복 제거 |
| python `open(p,'w').write(open(p).read())`가 파일을 먼저 비운다(`Janggi.jsx`가 0바이트가 됐다) | 읽고 나서 `with open(p,'w')`로 쓴다 |
| zsh 에서 `echo ====`가 `=` 확장 에러를 낸다 | 구분선은 따옴표로 감싼다 |
| 세션의 `grep`은 셸 함수라 큰 파이프에서 아무것도 안 찍는다 | `/usr/bin/grep` |
