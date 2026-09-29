# 복기 깊게 보기 (저장된 판 복기 전용) — 구현 계획

설계 정본: `docs/superpowers/specs/2026-09-28-janggi-mcp-design.md` **개정 2.10** 7절 "복기 깊게 보기". 이 계획은 그 절을 옮긴다. 충돌하면 설계 문서가 이긴다.

## Global Constraints

- 저장소 `~/workspace/janggi`, 브랜치 `main` 에서 작업 브랜치 `review-deep-look` 을 만들어 거기에 커밋한다. 푸시하지 않는다.
- **범위의 핵심 조건**: 새 동작(MultiPV 1 · 긴 상한 · 멈춤 · 안정 표시 · Hash 256)은 **진행 중인 판이 아닌 저장된 판의 복기**(`review.record.id !== g.id`)에서만 켜진다. 진행 중인 판, 진행 중인 판의 복기는 지금 동작(계속 = MultiPV 5 · `go movetime 20000` · Hash 64) 그대로여야 하고, 그것을 테스트로 묶는다.
- 상한 값: `20000`(기본) · `60000` · `300000` · 무제한(서비스에는 `Infinity`, prefs 에는 문자열 `"infinite"`). 무제한은 `go infinite`.
- Hash: 저장된 판 복기 깊게 보기이고 상한 ≥ 60000 일 때 **256**, 그 밖에는 지금 값(**64**, `fsf.js` `createAnalyzer`). `setoption name Hash` 는 탐색이 멈춰 있을 때만, 그 뒤 `isready`/`readyok`.
- 기존 규칙 유지: 우선순위(최강 > 밀린 국면 > 초점 > 깊게 보기), 선점, 점진 결과는 "더 깊을 때만", `keepDeeper`, 최강 차례 국면은 깊게 보지 않음, 반복수 `searchmoves`.
- TDD: 실패하는 테스트를 먼저 돌려 빨간 것을 본다. 기대값은 리터럴. 새 테스트는 코드를 일부러 망가뜨려 빨개지는지 보고 되돌린다(뮤테이션).
- 테스트 명령: `npx vitest run`(단위, 지금 217), e2e 는 `npm run test:e2e`(지금 40). 둘 다 초록으로 끝낸다.
- 커밋: 영어 메시지, 끝에 작성 모델의 `Co-Authored-By: Claude <모델> <noreply@anthropic.com>`. `git add -A`·`git add .` 금지(경로를 적는다). `docs/kibo/` 는 사용자 개인 기보다 — 절대 add 하지 않는다.
- 문자열은 한국어(웹은 한국어 전용).

### Task 1: 분석 서비스 — 2단계 깊게 보기 (Fable 5.1)

**Files:** `src/analysis/service.js`, `test/analysis.test.js`, 실엔진 확인은 `test/repetition-engine.test.js` 처럼 WASM 을 node 에서 불러오는 새 테스트 파일(예: `test/deep-look-engine.test.js`).

**API (Task 2 가 이것에 맞춰 붙인다 — 이름·모양 그대로):**
- `service.deepen(ply, cap = null)`: `cap === null` 이면 지금 동작 그대로(진행 중인 판·그 복기). `cap` 이 `20000|60000|300000|Infinity` 이면 저장된 판 복기의 2단계 깊게 보기. 같은 국면에 같은 cap 으로 다시 부르면 아무것도 바꾸지 않는다. cap 이 바뀌면 모든 항목의 `capped` 를 풀고, 달리는 깊게 보기를 멈추고 새 cap 으로 다시 본다.
- `service.haltDeepen()`: 달리는 깊게 보기를 멈추고 그 국면을 `capped` 로 표시한다(결과는 남긴다). 깊게 보는 중이 아니면 아무것도 안 한다.
- 결과 객체(`onResult`, `entry.result`)에 2단계일 때 `stable: N`(같은 수 N깊이째)과 `deepCap`(그 탐색의 cap) 을 더한다. 후보 객체마다 `depth` 를 더한다(그 줄의 깊이) — 1단계·2단계·초점 분석 모두. 기존 테스트 리터럴은 기계적으로 맞춘다.
- `status.deepening` 은 지금처럼. 2단계 여부는 결과의 `deepCap` 으로 안다.

**동작:**
1. cap 이 있을 때 깊게 보기 작업은 `setoption name MultiPV value 1` 을 보내고 `go movetime <cap>` 또는 `go infinite`(+ 반복수 `searchmoves` 그대로).
2. 후보 합치기: 2단계에서 결과를 보낼 때 후보 = [2단계의 1순위(평가 줄, 깊이 포함)] + [1단계 후보에서 그 수를 뺀 것, 1단계 순서·값·깊이 그대로]. 1단계 후보는 1단계 결과를 받을 때 항목에 따로 보관한다(2단계 결과가 `entry.result` 를 덮어도 잃지 않게). 1단계 후보가 없으면(저장된 평가만 있던 국면: `cached`) 2단계 1순위 하나.
3. 점진 결과: MultiPV 1 이면 묶음은 1순위 한 줄이다 — 정확한 1순위 줄이 지금 보여준 결과보다 깊을 때 보낸다(지금 규칙 "묶음의 마지막 순위 줄"이 ranks=1 에서 그대로 성립하는지 확인하고, 아니면 맞춘다).
4. 안정 표시: 2단계의 정확한 1순위 줄마다, 이전에 센 깊이보다 깊으면 — 수가 이전과 같으면 N+1, 다르면 1. 같은 깊이의 줄이 또 오면 수가 바뀐 경우만 1 로(깊이는 그대로).
5. 감시: cap 이 유한하면 지금처럼 `cap + RESPONSE_TIMEOUT`. `Infinity` 면 30초마다 `isready` 를 보내고 `RESPONSE_TIMEOUT`(15초) 안에 `readyok` 가 없으면 실패(설계 2.10 개정 — 줄 간격 감시는 30분 실측에서 정상 탐색을 끊었다).
6. 멈춤·선점으로 끝난 2단계는 지금처럼(선점이면 나중에 이어서, `haltDeepen` 이면 capped).
7. Hash: 서비스가 원하는 Hash = (모드가 계속이고 cap ≥ 60000 인 `deepen` 이 걸려 있으면 256, 아니면 생성 인자 `hash`). 원하는 값이 지금 엔진 값과 다르면, 탐색이 멈춘 뒤(달리는 작업이 있으면 끝나기를 기다리거나 깊게 보기면 `stop`) `setoption name Hash value <N>` → `isready` 를 보내고 나서 다음 작업을 시작한다. 신경망 교체의 `configure()` 흐름처럼 `pump()` 에서 처리한다. 엔진 재시작(`start`) 때는 원하는 값을 보낸다.
8. 기보 `analysis.engine` 문자열(gameAnalysis.js)은 바꾸지 않는다(2단계는 복기 전용이라 판마다 섞인다) — 대신 결과의 `movetime` 은 그 탐색의 cap(무제한은 `"infinite"`).

**실엔진 확인(새 테스트 파일, WASM 을 node 에서):** (a) `setoption name Hash value 256` 뒤 `isready` 가 `readyok` 로 오고 탐색이 된다, (b) `go infinite` 뒤 `stop` 에 `bestmove` 가 온다, (c) MultiPV 1 과 5 의 같은 시간 깊이(3초, 중반 국면 하나) — 1 이 더 깊다는 것을 리터럴 대신 부등식으로(환경마다 다르므로), (d) 5분 무응답 간격 측정은 테스트가 아니라 한 번 돌린 스크립트 결과를 보고서에 적는다.

**테스트(가짜 엔진, `test/analysis.test.js` 에 새 describe):** cap=null 이면 지금 명령 그대로(MultiPV 5, `go movetime 20000`, Hash 명령 없음) · cap 마다 `go` 명령 · MultiPV 1 · 후보 합치기(1순위 그대로 / 1순위 바뀜 / 1단계 후보 없음) · 후보 `depth` · 안정 N(같음·바뀜·같은 깊이 반복) · 무제한 무응답 타이머(줄이 오면 연장, 안 오면 실패) · `haltDeepen` 뒤 결과 보존·재시작 안 함·cap 바꾸면 다시 · Hash 256 은 cap ≥ 60000 에서만, 달리는 탐색이 멈춘 뒤에만, cap 을 되돌리면 64 로 한 번 · 우선순위·선점 기존 테스트 전부 초록.

### Task 2: 화면·설정 연결 (Opus 5.5)

**Files:** `src/prefs.js`, `src/analysis/useAnalysis.js`, `src/Janggi.jsx`, `src/Review.jsx`, `test/prefs.test.js`, `test/ui.test.js`(또는 가까운 UI 테스트), `e2e/review.spec.js`, `docs/HANDBOOK.md`(짧게).

1. prefs: `reviewDeep` — `20000|60000|300000|"infinite"`, 기본 `20000`, 모르는 값은 기본으로. `analysis` 와 같이 저장·불러오기.
2. `useAnalysis(game, { mode, deepen, deepCap })` — `deepCap` 이 바뀌거나 `deepen` 이 바뀌면 `service.deepen(deepen, deepCap)`. `haltDeepen` 을 돌려준다.
3. `Janggi.jsx`: `deepCap = review && review.record.id !== g.id ? capOf(prefs.reviewDeep) : null`("infinite" → `Infinity`). 진행 중인 판과 진행 중인 판의 복기는 `null`.
4. 복기 패널(저장된 판 복기일 때만): "깊게 보기" 선택(20초·1분·5분·무제한), 깊게 보는 중이면 "멈춤" 버튼, 분석 모드가 계속이 아니면 "분석 모드가 '계속'일 때 깊게 봐요". 진행 중인 판의 복기에는 이 줄이 없다.
5. 승률 막대 설명: 저장된 판 복기의 2단계 결과면 "깊이 D · 같은 수 N깊이째"(+ 깊게 보는 중이면 " · 계속 분석 중"). 그 밖에는 지금 문구 그대로.
6. 후보 목록: 저장된 판 복기에서는 후보마다 " · 깊이 D" 를 붙인다. 진행 중인 판에서는 지금 모양 그대로.
7. e2e(`review.spec.js`): (a) 진행 중이 아닌 판 복기 → 깊게 보기 선택이 보이고, 20초로 두면 "같은 수" 가 나타나고, "멈춤" 뒤 "계속 분석 중" 이 사라진다 (b) 진행 중인 판 복기에는 깊게 보기 선택이 없다 (c) 새로고침 뒤 선택이 기억된다. 긴 상한(1분 이상)은 e2e 에서 기다리지 않는다 — 선택 값과 멈춤만.
8. HANDBOOK 에 한 단락.
