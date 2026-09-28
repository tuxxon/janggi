# 장기 (Janggi)

브라우저에서 두는 한국 장기. 초·한을 각각 사람/엔진으로 고르고, Fairy-Stockfish로 승률을 보여주며, 기보를 저장해 복기한다.

- 대국: 사람 vs 엔진, 사람 vs 사람, 엔진 vs 엔진. 난이도 쉬움·보통·어려움(원본 엔진), **최강**(Fairy-Stockfish가 항상 최선수)
- 승률: 수마다 막대, 직전 수의 승률 변화와 실수 등급(?! ? ??), 훈수 모드(상위 5수 + 집은 기물의 수마다 승률)
- 기보: 수마다 브라우저에 저장, 새로고침해도 이어짐, 복기(버튼·←→·수순·그래프), JSON 내보내기/가져오기
- 규칙: 원본 엔진 그대로(빅장·계가 없음, 외통수로 승부) + 반복수(카카오 방식: 궁·사가 아닌 기물로 같은 수를 세 번째 둘 수 없음). Fairy-Stockfish `janggicasual`과 국면 1600개에서 합법 수가 일치함을 테스트로 확인

## 실행

```bash
npm install
npm run dev        # http://localhost:5173/janggi/
npm test           # 단위 테스트(규칙 대조 포함)
npm run test:e2e   # 빌드 후 Playwright (Chromium + WebKit 스모크, 포트는 E2E_PORT)
```

## 신경망(NNUE)

기본은 신경망 없는 **기본 평가(약함)** 다. 더 정확한 승률을 원하면 [Fairy-Stockfish NNUE 페이지](https://fairy-stockfish.github.io/nnue/)에서 `janggi-9991472750de.nnue`(11,261,920바이트)를 받아 화면의 **신경망 넣기**로 고른다. 크기와 SHA-256을 검사한 뒤 브라우저 캐시에 저장해 다음부터 자동으로 쓴다. 이 신경망은 라이선스가 명시되지 않아 이 저장소와 배포본에 넣지 않는다. 개발 서버는 `~/.janggi/`에 받아 둔 파일을 자동으로 쓴다.

## 라이선스

GPL-3.0-or-later. 브라우저에서 도는 [Fairy-Stockfish WASM](https://github.com/fairy-stockfish/fairy-stockfish.wasm)(GPL-3.0)을 함께 배포하기 때문이다. GitHub Pages는 헤더를 설정할 수 없어 [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker)(MIT)로 교차 출처 격리를 켠다. `vendor/coi-serviceworker.js`는 304 응답 처리를 고친 수정본이다. 원본 그대로면 WebKit(사파리·아이폰)에서 엔진 워커가 뜨지 않는다. 제3자 라이선스 원문은 배포본의 `licenses/THIRD_PARTY_NOTICES.txt`에 있다.

설계 문서: [docs/superpowers/specs/2026-09-28-janggi-mcp-design.md](docs/superpowers/specs/2026-09-28-janggi-mcp-design.md)
