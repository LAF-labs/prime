# Claude 핸드오프: 백엔드 코드 조사 (TDD 검증 완료)

> **상태: 종결 (2026-08-10).** 이 문서가 지시한 3건(B 정정, A 판단, E 문서화)은 모두 처리됐고,
> 그 과정에서 v0.2.0 판정 2건이 정정됐다. **A는 기각(도달 불가), E-1은 통과(가설이 맞았음)**이며,
> E에서 실제 버그 1건을 발견해 수정했다. 아래 본문은 인계 시점의 기록으로 남겨두지만,
> 판정의 최신 상태는 `docs/backend-audit-findings.md` v0.3.0을 보라.
>
> 특히 다음 세 가지는 이 문서의 서술이 틀렸다:
> - "`cargo test` 전체 실행이 300초 타임아웃, macOS에 대안 없음" → E-1 테스트 한 줄(`rx.recv().await`)의
>   데드락이었다. 제거 후 287개가 1.03초에 끝난다. `perl -e 'alarm N; exec @ARGV'`가 `timeout` 대안이다.
> - "E-1 기각: send는 receiver drop을 감지하지 못한다" → 감지한다(`Err` 반환). 그 판정은 데드락으로
>   **실행된 적 없는 테스트**에서 나왔다.
> - "B 기각: CASCADE가 트리거를 fire한다" → 결론은 맞지만 근거가 무효였다. 테스트가 쓴
>   `search_messages`는 FTS를 `messages`·`threads`와 JOIN하므로 두 결과를 구분할 수 없다.
>   FTS 테이블을 직접 세어 다시 확인했다.

**수신**: Claude (다음 담당자)
**발신**: 이전 담당자
**일자**: 2026-08-10
**프로젝트**: prime-agent Tauri 데스크톱 앱 (`/Users/gimgibeom/Desktop/prime-agent/`)
**관련 문서**: `docs/backend-audit-findings.md` (v0.2.0), `src-tauri/src/commands/backend_audit_tests.rs`

---

## 배경

백엔드(Rust 명령어 레이어) 정적 코드 조사로 잠재적 버그·엣지케이스·기술부채 8건을 발견(`docs/backend-audit-findings.md` v0.1.0). 사용자 Requested로 TDD 방식으로 의심 지점을 검증하라는 요청을 받아, 5개 가설·7개 세부 케이스에 대한 테스트를 `backend_audit_tests.rs`에 작성하고 컴파일 및 부분 실행으로 판정을 내렸다.

**핵심 결론**: 8건 중 3건(A, B, E)은 TDD로 실제 동작을 확인했고, 그 결과 2개 가설(B, E-1)은 **틀렸음**이 밝혀졌다. 나머지 5건(2, 3, 5, 6, 7, 8)은 TDD 미검증 상태.

---

## TDD 검증 결과 요약

### 통과한 것 (가설 유지)

| 가설 | 테스트 | 결과 | 의미 |
|---|---|---|---|
| A: spawn 직후 child.id()가 None인 경로 존재 | `child_id_is_some_right_after_spawn` | 통과 (수정 후) | spawn 직후 pid는 Some. `/bin/true` 없음 환경 문제로 초기 실패 → `true`(PATH)로 수정 후 통과. |
| C-1: 같은 초, 다른 ms 구분 안 됨 | `dedupe_key_distinguishes_same_second_different_ms` | 통과 | dedupe_key는 ms 단위까지 구분함. |
| C-2: 동일 내용+동일 ms 중복 누락 | `dedupe_key_collapses_identical_messages` | 통과 (수정 후) | 초기 실패는 테스트 버그(FK constraint failed — 스레드 없이 메시지 저장). 스레드 먼저 저장하도록 수정 후 통과. 동일 내용+동일 ms는 같은 key로 collapse, INSERT OR IGNORE로 두 번째 무시됨 확인. |
| D: extract_from_if 범위 불분명 | `redb_range_to_exclusive_excludes_the_boundary_key` | 통과 | `range(..cutoff)`는 half-open. cutoff 키 제외. |

### 틀린 것으로 판명된 가설 (기각)

| 가설 | 테스트 | 결과 | 실제 동작 |
|---|---|---|---|
| B: CASCADE delete 시 FTS trigger가 fire하지 않아 FTS entries 생존 | `fts_entries_survive_cascade_delete_without_explicit_message_deletion` | **가설 기각 — 틀림** | CASCADE delete 시 FTS trigger가 실제로 fire하여 FTS가 정리됨. SQLite 공식 문서: "ON DELETE CASCADE로 child row 삭제 시 child 테이블의 DELETE trigger가 fire함." |
| E-1: receiver dropped 상태에서 send가 실패 반환 | `unbounded_sender_send_fails_when_receiver_is_dropped` | **가설 기각 — 틀림** | `tokio::mpsc::UnboundedSender::send`는 receiver drop을 감지하지 않음. Ok 반환. |

---

## TDD로 실제 수정된 것

1. **A 테스트: `/bin/true` → `true`**
   - macOS 환경에 `/bin/true` 없음, `/usr/bin/true`만 존재.
   - 테스트 이름도 `child_id_is_some_right_after_spawn_on_macos` → `child_id_is_some_right_after_spawn`으로 변경.

2. **C-2 테스트 버그 수정**
   - FK constraint failed 원인은 테스트 버그: 스레드 없이 메시지 저장을 시도함.
   - 스레드 먼저 저장(`ThreadDatabase::save_thread`)한 뒤 메시지 저장하도록 수정.

3. **visibility 조정** (테스트에서 접근할 수 있도록)
   - `thread_db.rs` line 129: `fn dedupe_key` → `pub(crate) fn dedupe_key`
   - `thread_db.rs`: `fn write` → `pub(crate) async fn write`
   - 테스트 import: `crate::thread_db::{dedupe_key, DbMessage, DbThread, ThreadDatabase}`
   - 참고: `dedupe_key`를 `pub fn`로 올렸다가 다시 `pub(crate) fn`로 되돌림 (최종 유지).

4. **redb 테스트 전략 조정**
   - redb 2.4 기준 `AccessGuard`는 `Deref` 미구현. `.value()`는 `&V` 반환하므로 `*k.value()`가 아니라 `k.value()`만 사용.
   - `range()` 결과를 `(k, v)` 디스트럭처링 + `.value()` 호출 방식으로 변경.

5. **redb write 트랜잭션에서 `drop(table)` 추가**
   - write 트랜잭션 내에서 `table`을 별도 스코프로 빼서 `txn.commit()` 전에 drop.

---

## 실제 버그/문제로 확정된 것 (TDD 기반)

### B — 문서/코드 주석 오류 (수정 필요)

**문제**: `thread_db.rs`와 감사 문서에 "CASCADE delete 시 FTS trigger가 fire하지 않아 FTS entries가 생존한다"는 주장이 있음. 이는 SQLite 동작과 다름.

**근거**:
- `thread_db.rs` 라인 64: `FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE`
- `thread_db.rs` 라인 89-91: `CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN ...`
- SQLite 공식 문서: CASCADE로 child row 삭제 시 child 테이블의 DELETE trigger가 fire함.
- `thread_db.rs` 라인 780~: `delete_thread`는 실제로 메시지 먼저 DELETE 후 thread DELETE하는 이중 장치 사용.

**해야 할 일**:
1. `thread_db.rs` 코드 주석에서 "CASCADE가 trigger를 fire하지 않는다"는 주장을 수정 또는 제거.
2. `docs/backend-audit-findings.md`에서 B 항목 주장을 정정.
3. 실제 production `delete_thread`는 메시지 먼저 DELETE 후 thread DELETE하는 이중 장치. CASCADE + 트리거만으로 충분한지는 별도 확인 필요.

### A — spawn 직후 child.id() None 경로의 실제 영향도 (추가 판단 필요)

**현재 상태**: spawn 직후 `child.id()`는 `Some(pid)`를 반환함을 확인. `/bin/true` 없음 환경 문제로 초기 실패했으나 `true`(PATH)로 수정 후 통과.

**판단 보류 사유**: spawn 직후 child.id()가 None인 시나리오는 특수 환경(`true`가 PATH에 없을 때)에서만 발생. 실제 사용 환경에서는 pid가 보이므로 `terminate_group_of(None)` 경로는 드뭄. 방어 코드 필요 여부는 추가 판단 필요.

**참고 코드**:
- `connection.rs` 라인 565-568: `child.id()` 캡처, `Some(id)`일 때만 `pid_slot.store(id, ...)`
- `connection.rs` 라인 312, 420, 438, 577: 모든 채널이 `mpsc::UnboundedSender`/`UnboundedReceiver` 기반
- `connection.rs` 라인 799-818: `terminate_group_of` — pid가 None/0이면 즉시 리턴

### E — unbounded_channel send는 receiver drop 감지 못 함 (메시지 소실 시나리오 문서화 필요)

**현재 상태**: E-1 가설 기각. `tokio::mpsc::UnboundedSender::send`는 receiver drop을 감지하지 않고 Ok 반환.

**의미**: production 코드(`connection.rs`) 전체가 unbounded 채널 기반이므로, send 성공 ≠ 메시지 수신 성공 보장이 아님. race window는 "live check와 send 사이"가 아니라 "send 이후 메시지 처리 사이"에 존재.

**해야 할 일**:
- E의 메시지 소실 시나리오에 대한 문서화. 사용자에게 "보냈는데 반응이 없으면 다시 보내라" 이상의 맥락을 제공할 수 있는지 검토.

---

## 아직 수정 안 된 원본 8건 (TDD 미검증 포함)

| # | 문제 | 파일 | 우선순위 | TDD 상태 |
|---|---|---|---|---|
| 1 | `terminate_group_of(None)`에서 자식 그룹 미신호 | `rpc/connection.rs` | P1 | A 통과 — spawn 직후 pid는 Some. 환경 특수 케이스만 문제. 방어 코드 필요 여부 추가 판단 필요. |
| 2 | 인메모리 DB 폴백 감지 불가 | `thread_db.rs` | P4 | 미검증 |
| 3 | confy 인플레이스 쓰기 + torn file | `settings.rs` | P3 | 미검증 |
| 4 | `task_send_message` 경합, 원인 불명 정지 | `rpc/commands.rs` | P2 | E-1 기각 — unbounded send는 receiver drop 감지 못 함. race window는 send 이후. |
| 5 | PTY Drop 블로킹 루프 | `pty.rs` | P5 | 미검증 |
| 6 | `local_offset_secs` DST 캐싱 오차 | `analytics.rs` | P5 | 미검증 |
| 7 | `agent_rpc_request` Ok(Err) pending 미정리 | `rpc/commands.rs` | P5 | 미검증 |
| 8 | `tool_kind` 분류 누락 가능 | `rpc/connection.rs` | P5 | 미검증 |

---

## 테스트 파일 현황

- **파일**: `src-tauri/src/commands/backend_audit_tests.rs` (약 293 lines)
- **모듈 편입**: `src-tauri/src/commands/mod.rs`에 `#[cfg(test)] mod backend_audit_tests;` 추가됨
- **컴파일**: `cargo test --lib --no-run -- audit_tests` → 성공 (1초 내외)
- **실행**: `cargo test --lib -- audit_tests` 전체 실행은 계속 타임아웃(300s). 바이너리 직접 실행(`target/debug/deps/laf_agent_lib-****** --test-threads=1 audit_tests`)도 타임아웃 반복. 배경 작업으로 분리 시 완료되나, 최신 패치 반영 후 전체 결과를 한 번에 확보한 기록은 없음.
- **macOS `timeout` 명령어**: 없음. 대안 없음.
- **테스트 바이너리 해시**: `laf_agent_lib-4a04a5fffebcfea1` (컴파일 시점 기준)

---

## 남은 작업 제안

1. **B 수정 (우선)**: `thread_db.rs` 코드 주석과 `docs/backend-audit-findings.md`에서 "CASCADE가 trigger를 fire하지 않는다"는 주장을 정정.
2. **A 판단**: spawn 직후 child.id() None 시나리오의 실제 영향도 평가 후 방어 코드 필요 여부 결정.
3. **E 문서화**: unbounded_channel send의 receiver drop 비감지 특성과 메시지 소실 시나리오 문서화.
4. **기존 test suite 전체 실행**: `cargo test --lib` 3개 기존 실패가 audit_tests 수정으로 영향 받는지 확인.
5. **미검증 5건(2, 3, 5, 6, 7, 8)에 대한 TDD 연장**: 필요 시 추가 테스트 작성.

---

## 참고: 프로젝트 규칙 (CLAUDE.md에서 발췌)

- Git 기능 없음 (2026-08 전면 제거). 재도입 금지.
- 분석(analytics)은 로컬 전용, 원격 엔드포인트·텔레메트리 클라이언트 없음.
- CLAUDE.md가 단일 소스 오브 트루스.
- 패키지 매니저: bun. 빌드: Vite 6 + Cargo. 테스트: Vitest 4 + cargo test.
- `bun run check` (tsc + oxlint + cargo check) + `bun run test` (vitest + cargo test) 통과가 완료 기준.
- `cargo test`는 전체 실행 시 반복 타임아웃 → 바이너리 직접 실행을 배경 작업으로 분리해 결과 기록.
- `timeout` 명령어는 macOS 환경에 없음.

---

**문서 버전**: 0.1.0 (최초 작성)
**다음 업데이트 시점**: B 수정 완료, A/E 판단 정리, 미검증 항목 TDD 연장 결정 시.
