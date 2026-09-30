# 복기 깊게 보기 — 오케스트레이터가 대신 정한 것 (SDD 원장의 Ruling 줄, 원문)

계획 [2026-09-30-review-deep-look.md](2026-09-30-review-deep-look.md) 을 진행하며 사용자 대신 내린 결정. 각 줄은 결정 — 이유 — 틀렸을 때의 비용. 원장은 git 에 들어가지 않는 작업 공간이라 병합 전에 여기 남긴다.

- Ruling: Task 1 author = Opus 5.5 instead of Fable (Fable credits exhausted, Codex MCP down) — the user's default author; the final two adversarial Opus reviews stay — cost if wrong: a weaker first draft of the queue change, caught by review.
- Ruling: unlimited watchdog = isready probe every 30 s, readyok within RESPONSE_TIMEOUT else fail (measured 0.3–0.4 ms during search) — spec/plan amended — cost if wrong: a probe interleaving bug, caught by fake-engine tests.
- Ruling: Hash 256 only while mode is continuous and cap ≥ 60000 (memory is never returned, so raising it when the deep look cannot run is pure cost) — cost if wrong: none.
- Ruling: accept the implementer's three other decisions (list stays at five, per-position stable count, deepen rejects unknown caps) — spec amended for the first two — cost if wrong: none.
- Ruling: accept the extra (positions whose result is mate 0 get no stage 2 — the engine holds bestmove until stop on go infinite and spins a core) — cost if wrong: none.
- Ruling: spec wins — a cap-set deep look on a ply without stage-1 candidates first runs stage 1 (MultiPV 5, mode movetime, keepDeeper) then stage 2; plan amended — cost if wrong: one extra 0.8 s search per cached ply viewed.
- Ruling: pull into the same fix round the cheap Minors: M1 vacuous 'after stop' probe half, M2 list unpinned across preemption, M3 stop of a finite long cap watched for cap+15 s → RESPONSE_TIMEOUT on stop, M4 forced mate under go infinite (measure on real WASM; if it idles at max depth, stop stage 2 there and mark capped), M5–M7 parens/robust stable/comment; M8 plan text fixed by controller — cost if wrong: small scope growth.
- Ruling: I1 — sync() drops deepCap on a game switch before any job (B's verified one-liner) + idle-leave unit/e2e tests — cost if wrong: none.
- Ruling: I2 — stage-2 results gate on the depth stage 2 showed for this ply this session; eval fields keepDeeper against the stored eval; spec amended 0be8334 — cost if wrong: bar and rank-1 depth can differ briefly on a revisit (both labelled).
- Ruling: m1 — decide 'finished' from the raw candidate-pass line — cost if wrong: none.
- Ruling: pull in B's minors (blur the cap select for arrow keys; '계속으로 바꾸기' button in the review hint) and the triaged fix-before-merge minors (live-review display pin PROOF B4, HANDBOOK stale lines) — cost if wrong: small scope growth.
- Ruling: leave — Hash 256 on low-memory devices (the user runs the web on a Mac; the web on phones is the S21 bench page, not this path), Janggi.jsx:346 re-derive, DEEP_LABEL list, 49 s unlimited e2e — cost if wrong: a phone user on the saved review with a ≥1 min cap may hit WASM memory limits.
- Ruling: accept the I2 gate starting at the candidate pass's depth (stage-2 lines at or below it count toward 같은 수 but are not shown — showing depths 1–13 would be noise below the list); spec text amended after the re-review — cost if wrong: a one-token change.
- Final re-review A: parked — deepen(k,null) to depth 18 then deepen(k,20000) on the same entry can show 14 (listDepth not raised by live results) — Ruling: unreachable in the app (the live path and the saved review never share an entry: a saved review is another game id) — cost if wrong: a bar dropping 18→14 once and a shallower eval saved.
- Final re-review A: parked — countStable (service.js:244) throws on a pv-less first stage-2 line; latent on HEAD (the m1 guard closes the only path found) — Ruling: leave, note for the app port — cost if wrong: a service failure → restart on a mate-0 edge.
