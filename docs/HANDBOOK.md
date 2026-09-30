# 장기(janggi) 핸드북

다음 세션이 이 문서 하나로 이어서 일할 수 있게 쓴 안내서다. 결정의 근거와 세부 규칙의 정본은 설계 문서다:
[`docs/superpowers/specs/2026-09-28-janggi-mcp-design.md`](superpowers/specs/2026-09-28-janggi-mcp-design.md) (개정 2.11).

- 저장소: `~/workspace/janggi` · GitHub [tuxxon/janggi](https://github.com/tuxxon/janggi) (public)
- 기준: 2026-09-30, 브랜치 `review-deep-look` (이 문서를 고친 커밋)
- 진행 중 브랜치: `review-deep-look` — **복기 깊게 보기**(저장된 판 복기 전용, 개정 2.10). 리뷰 끝, main 병합은 사용자 확인 뒤. 그 전 것("더 깊이 보기", "한글 기물 이름", 반복수 수정 `76e38ba`)은 main 에 있다.
- **Flutter 앱 "장기9단"**: `~/workspace/janggi-flutter`(비공개). 이어서 할 때는 그 저장소의 `docs/HANDOFF-2026-09-29-m0.md` 부터.

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
| 표시 | 판에 좌표(아래 a–i, 왼쪽 1–10). 후보 수·복기 수순·직전 수 줄에 한글 기물 이름("마 g1→f3") |
| 분석 모드 | 설정의 "분석": 빠르게 0.8초 / 깊게 3초 / **계속**(기본, 보고 있는 국면을 최대 1분 계속 깊게 — 처음엔 20초, 사용자 요청 2026-09-30). 즉시 적용, `janggi.prefs`에 기억. 엔진 스레드 = 코어의 절반(1~8), Hash 64MB(저장된 판 복기의 깊게 보기가 1분 이상일 때만 256MB), 최강 3초. 저장된 판의 복기는 "깊게 보기"(MultiPV 1 · 20초/1분/5분/무제한, 5절) |
| 반복수와 엔진 | 엔진도 카카오식 반복수를 안다: ini 변형 `janggikakao`(janggicasual + moveRepetitionIllegal) + 마지막 쉬기 이후 수순을 보냄. 예전엔 반복을 무승부로 읽어 지는 수를 권했다(사용자 보고) |
| 테스트 | 단위 276개 · Playwright 48개(Chromium + WebKit 스모크) — 전부 초록(2026-09-30, 복기 깊게 보기 최종 리뷰 수정 뒤) |

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
src/Settings.jsx       설정 패널(자리별 나라·두는 이·상차림, 난이도, 분석 모드, "새 게임부터 적용" 알림)
src/prefs.js           보기 설정 localStorage["janggi.prefs"] = { analysis: "fast"|"deep"|"continuous", reviewDeep: 20000|60000|300000|"infinite" }
                       (기본 continuous · 20000)
src/Review.jsx         기보 목록, 복기 패널, 승률 그래프
src/engineMove.js      원본 bestMove 루트 루프에서 막힌 수 하나를 뺀 버전
src/analysis/service.js      UCI 서비스(주입된 엔진): 국면 대기열(빠짐없이 순서대로), 최강 우선, 초점 분석, 신경망 교체, 재시작 1회,
                             분석 모드(setMode)와 깊게 보기(deepen(ply, cap), 선점·점진 결과). cap null = 진행 중인 판과 그 복기
                             (MultiPV 5 · 1분), cap 이 있으면 저장된 판 복기의 2단계(MultiPV 1 · 20초/1분/5분/무제한, 멈춤 haltDeepen,
                             무제한은 isready 탐침, 1분 이상 Hash 256). 판이 바뀌면 sync 가 첫 탐색 전에 상한을 푼다
src/analysis/gameAnalysis.js 판 ↔ 서비스 연결(analysisPositions{restrictions}, cacheEvaluation 병합, engineTurn)
src/analysis/useAnalysis.js  React 훅(판별 캐시, known 평가 전달, setMode·deepen(k, deepCap) 효과, haltDeepen)
src/analysis/fsf.js / nnue.js  WASM 로더(threadsFor, Hash 64), 사용자 신경망(크기+SHA-256 전체)
vendor/coi-serviceworker.js  격리 서비스워커 수정본(MIT) — WebKit 304 처리
scripts/vendor.mjs     public/ 으로 엔진 파일·SW·라이선스 고지 복사(dev/build 전에 자동)
e2e/                   smoke / review / settings / analysis .spec.js + helpers.js(openIsolated{analysis, cores}, clickBoard)
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
- **분석 깊이**: 계속 깊게 보기 + 코어 여러 개 + 최강 더 깊게 + 설정에서 고르기 — **네 가지 전부**(구현 끝, spec 2.9).
- **난이도는 새 게임부터**(2026-09-29 답): 대국 중 즉시 바꾸지 않는다. 두는 이와 분석 모드만 즉시.
- **한글 기물 이름**(2026-09-29 답): 후보 수, 복기 수순, 직전 수 평가 줄 모두.

## 5. 끝난 일 — "더 깊이 보기" (2026-09-29, spec 2.9)

동작의 정본은 spec 7절 "분석 모드 — 더 깊이 보기"다. 여기는 요약과 리뷰 결과만 둔다.

- **분석 모드**: 빠르게 0.8초 / 깊게 3초 / **계속**(기본). 계속은 0.8초 결과 뒤 할 일이 없으면 보고 있는 국면(대국 = 마지막, 복기 = k수째)을 `go movetime 20000`으로 읽는다. 우선순위 최강 > 밀린 국면 > 초점 > 깊게 보기, 최강 차례는 깊게 보지 않는다.
- **점진 결과**: MultiPV 묶음의 마지막 순위 줄이 왔을 때, 1순위가 보여준 결과보다 깊을 때만.
- **저장 평가 보존**: 마지막 국면은 후보 때문에 항상 다시 읽지만, 기보에 더 깊은 평가(known)가 있으면 평가는 그대로 두고 후보·최선수만 바꾼다. 신경망을 바꾸면 known 을 버린다.
- **스레드**: 코어의 절반(1~8). `navigator.deviceMemory`가 8GB 미만이면 `max(1, floor(GB/2))`. Hash 64MB. 최강 3000ms·MultiPV 1.
- **실측**(M3 Max, Chromium WASM, NNUE, 초반/중반 depth): MultiPV 5·1스레드·0.8초 11/13 → 4스레드·0.8초 12/15 → 8스레드·3초 17/20 → MultiPV 1·4스레드·3초 16/28. 기본 평가·7스레드 "계속"은 초기 국면 20초 동안 깊이 11 → 18.
- **메모리**(리뷰어 실측, WASM 공유 힙, Hash 64): 1스레드 204MB · 2스레드 230 · 4스레드 382 · 7스레드 551 · 8스레드 661(예전 main 1스레드·Hash 32 는 184). 한 번 늘면 줄지 않는다.
- **리뷰**(Opus×2, worktree): HIGH 없음. MED 는 모두 고쳤다 — 깊게 읽은 평가가 새로고침 뒤 얕아짐, 테스트 빈틈 4개(MultiPV 5·searchmoves·쉬는 엔진에서 deepen·한 차례 부호), 저메모리 기기 스레드(사용자 결정). "최강 국면을 다시 탐색한다"는 서비스 단독 재현이었고, 앱에서는 UCI 로그로 한 번만 탐색하는 걸 확인해서 고치지 않았다.
- **복기 깊게 보기**(2026-09-30, spec 2.10 — 정본은 spec 7절): 진행 중인 판이 아닌 **저장된 판의 복기**에서만, 분석 모드가 계속일 때 1단계(MultiPV 5) 뒤 보고 있는 국면을 MultiPV 1 로 복기 패널 "깊게 보기"의 상한(20초 기본 · 1분 · 5분 · 무제한 = `go infinite`)까지 읽는다. 상한은 `janggi.prefs` 의 `reviewDeep` 에 기억한다. "멈춤"은 그 국면을 다 읽은 것으로 친다(상한을 바꾸면 다시 본다). 막대에 "같은 수 N깊이째", 후보마다 깊이를 적는다. 1분 이상이면 Hash 256(WASM 메모리는 새로고침 전까지 줄지 않는다). 무제한은 30초마다 `isready` 탐침으로 감시한다(탐색 중 readyok 는 브라우저에서도 온다 — e2e). 상한과 Hash 는 서비스 전체 값이다: 판이 바뀌면 `sync` 가 그 판의 첫 탐색 전에 상한을 풀고(Hash 64), 저장된 판 복기면 뒤따르는 `deepen(k, cap)` 이 다시 건다(최종 리뷰 I1: 전에는 쉬고 있는 복기에서 나오면 진행 중인 판의 첫 탐색 — 최강의 수 포함 — 이 Hash 256 이었다). 다시 찾아간 국면도 2단계의 1순위·"같은 수"를 후보 1단계 깊이를 넘는 첫 줄부터 보여주고, 막대는 저장된 평가가 더 깊으면 그것을 둔다(개정 2.10 "다시 찾아간 국면"). 복기 패널의 "계속으로 바꾸기"로 그 자리에서 모드를 바꾼다. 진행 중인 판과 그 복기는 지금 "계속" 그대로다 — e2e 가 UCI 명령 기록으로 묶는다: 저장된 판 복기를 탐색 중에 떠나도 쉬는 중에 떠나도 진행 중인 판의 첫 `go` 는 Hash 64 · MultiPV 5, 그 복기는 MultiPV 5 · `go movetime 60000` · Hash 변경 없음. 화면도 묶는다: 진행 중인 판의 복기는 후보에 깊이가 없고 막대에 "같은 수"가 없고 깊게 보기 줄이 없다.

## 6. 그 뒤에 남은 것

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

**고친 버그 — 후보 수 4/5, 도착 칸 2/3 (2026-09-29)**
- 원인(실엔진 줄로 확인): 엔진은 반복마다 1~N순위를 한 묶음으로 **다** 찍고, 그때 보던 순위 한 줄은 `lowerbound`/`upperbound` 로 온다(멈출 때만이 아니라 끝난 반복에서도). 그 줄을 버리니 그 순위에 이전 묶음의 수가 남아 같은 수가 두 순위에 들어가고 중복 제거로 하나가 빠졌다.
- 첫 수정(`3dce1af`, "모든 순위가 정확한 묶음에서")은 Opus 리뷰 A 가 실엔진 366회 녹화로 반증했다: 후보 1순위가 엔진이 둔 수와 달라졌다(한두 깊이 전 목록). → 최종: bound 줄도 그 점수로 후보에 넣고(순위별 마지막 줄 = 마지막 묶음), 평가는 가장 최근의 **정확한** 1순위 줄, 1순위가 평가와 같은 수면 평가 줄을 쓴다.
- 증거: 366회 재생에서 후보 부족 0(원래 12), 1순위 ≠ bestmove 0, 1순위 승률 ≠ 막대 0. e2e 60회 반복: 원래 6/60 실패 → 0/60(두 번). 2차 리뷰(Opus): 회귀 없음, 5,471 묶음에서 짧은 묶음·묶음 안 중복 0. 실데이터의 bound 줄은 전부 `upperbound` 라 그 모양의 테스트를 더했다.
- **알려진 LOW(원래 코드부터)**: 깊게 보기는 "더 깊어졌을 때"만 새 결과를 보내서, 같은 깊이 안에서 1순위가 바뀐 채 상한(지금 1분)에 끝나면 목록 1순위가 엔진의 수와 한 박자 다를 수 있다(녹화 6회 중 1회).
- **원인 미확인 관찰**: 고친 직후 첫 36회 중 3회 "도착 칸 승률 0개(30초)"가 나왔고 그 뒤 144회는 0회. 고친 코드는 원래보다 줄을 더 쓰므로 빈 결과를 새로 만들 수 없다 — 화면 쪽 초점 요청 경쟁(`Janggi.jsx` focus effect)으로 의심. 다시 보이면 `test-results/*/error-context.md` 를 지우기 전에 본다.

**알려진 한계 (LOW)**
- 같은 판을 탭 두 개에서 열면 서로 덮어쓴다.
- 앱 안에 기보 삭제가 없어서 저장 공간이 결국 찬다.
- 바꿔 둔 나라·상차림·난이도는 새로고침하면 사라진다.
- 동형반복(서로 다른 기물로 같은 국면 반복)과 만년장 전체 규칙은 범위 밖이다.
- 쉬기 처리는 FSF와 다르다(의도한 것).
- "깊게"로 바꿔도 지금 보이는 국면은 다시 읽지 않는다(다음 국면부터 3초). 계속으로 바꾸면 바로 깊게 읽는다.
- 깊게 모드에서 사람이 3초 안에 두면, 최강 차례가 진행 중인 3초 탐색 뒤에서 기다린다(원래는 0.8초). 달리는 일반 탐색은 선점하지 않는다.
- 감시 타이머는 `stop`을 보낼 때 다시 맞추지 않는다. 깊게 보기를 멈춘 뒤 엔진이 응답하지 않으면 최강 차례가 15초가 아니라 최대 35초 뒤에 실패로 잡힌다(추정, 재현 안 함).
- "계속"은 새로고침하면 상한 기록(capped)이 메모리에만 있어서 같은 국면을 다시 1분 읽는다(보여준 깊이보다 깊을 때만 표시).

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
| e2e 뮤테이션 스크립트가 소스는 되돌려도 `dist/`는 **마지막 뮤턴트로 빌드된 채** 남는다. `npx playwright test`는 빌드하지 않아서 그 뒤 스트레스·진단이 전부 망가진 빌드를 테스트했다(가짜 "버그"를 한참 쫓음) | e2e 는 항상 `npm run test:e2e`(빌드 포함). 뮤테이션을 돌린 뒤엔 다시 빌드 |
| `git add -A`가 리뷰어 worktree(`.claude/worktrees/agent-*`)를 임베디드 저장소로 커밋에 넣었다 | `.git/info/exclude`에 `.claude/worktrees/`(로컬 설정, 새 클론이면 다시) |
| 복기 e2e 의 진행 중인 판이 엔진 차례면, 열자마자·복기에서 돌아오자마자 420ms 뒤 엔진이 둬서 FEN 비교가 경합한다(main 에서도 12번 중 2번) | 진행 중인 판은 사람끼리로 심는다 |
| 복기에서도 **마지막 국면은 항상 다시 탐색**하고, 여러 스레드 탐색은 매번 값이 조금 다르다. 1스레드일 땐 심은 평가와 우연히 같아서 정확한 %p 단언이 통과했다 | 정확한 값 단언은 캐시된(지난) 국면에만 |
| MultiPV 점진 결과를 1순위 줄에서 보내면 이전 반복의 아래 순위와 섞여 후보가 하나 빠진다(실측 표본 180개 중 73개가 4개) | 엔진이 찍는 1~N순위 묶음의 마지막 줄에서 보낸다 |
| 엔진이 `janggicasual` 이라 반복을 무승부로 읽고, FEN 만 받아 지난 수순도 몰랐다 → 반복으로 버틸 수 있다고 계산해 지는 수를 권했다 | ini 변형 `janggikakao` + 마지막 쉬기 이후 수순(`gameAnalysis.enginePositions`). WASM 대조 `test/repetition-engine.test.js` |
| FSF 반복 금지는 쉬기 너머까지 센다(우리 규칙: 쉬기면 다시) | 전체 수순이 아니라 마지막 쉬기 이후만 보낸다(실측: 한이 쉰 뒤 a1a2 를 전체 수순으로 보내면 금지로 본다) |
| ini 로 정의한 변형은 부모의 NNUE 별칭("janggi")을 잃는다 → 신경망이 조용히 꺼졌다(e2e 가 잡음) | 엔진 안 파일 이름을 `/janggikakao-<name>` 으로 |
| 스레드가 코어의 절반(이 맥 7)이라 병렬 e2e 워커끼리 CPU를 다퉈 서비스워커 첫 방문 격리가 20초를 넘겼다(평소 실행 4번 중 1번, main 은 0번) | `openIsolated`가 기본으로 코어 2개(엔진 1스레드)로 보이게 하고, 저장된 값이 없으면 "빠르게"를 심는다. 실제 스레드·계속 모드는 `analysis.spec.js`와 WebKit 스모크가 `cores: null`로 본다 |
