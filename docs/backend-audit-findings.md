# 백엔드 코드 조사: 발견된 문제

**조사 대상**: `/Users/gimgibeom/Desktop/prime-agent/src-tauri/src/commands/`
---
**문서 버전**: 0.3.0 (TDD 재검증 — v0.2.0의 판정 2건 정정)
**조사 방식**: 정적 코드 읽기 + TDD 테스트(`src-tauri/src/commands/backend_audit_tests.rs`)
**테스트 실행**: `cargo test --lib` 전체 287개가 **1.04초**에 완료. v0.2.0이 기록한 "300초 타임아웃"은 환경 문제가 아니라 테스트 한 줄의 데드락이었음(E-1의 `rx.recv().await` — 빈 채널에 sender가 살아 있으면 영원히 대기). 그 줄 때문에 프로세스가 종료되지 않아 **어떤 판정도 실제로 관측된 적이 없었음**. macOS에 `timeout`이 없다는 것도 맞지만 대안은 있음: `perl -e 'alarm N; exec @ARGV' <cmd>`.

---

## TDD 검증 요약

### 판정 결과

| # | 가설 | 테스트 | 결과 | 판정 |
|---|---|---|---|---|
| A | `terminate_group_of(None)` 도달 가능성, spawn 직후 child.id()가 None인 경로 존재 | `child_id_is_some_right_after_spawn` 외 2건 | **가설 기각 — 도달 불가** | `tokio::process::Command`(프로덕션과 같은 타입)로 재검증. pid는 spawn 직후는 물론 **프로세스가 종료된 뒤에도** reap 전까지 `Some`. `None`은 `wait()` 이후에만. `spawn()`과 `child.id()` 사이에 await 지점이 없어 아무도 reap할 수 없음. |
| B | CASCADE delete 시 FTS trigger가 fire하지 않아 FTS entries가 생존함 | `cascade_delete_also_clears_the_fts_index` | **가설 기각 — 틀림** | cascade가 `AFTER DELETE` 트리거를 fire시켜 FTS 행까지 제거됨. **단, v0.2.0의 근거는 무효**였음 — 아래 B절 참조. |
| C-1 | 같은 초에 발생한 다른 ms 이벤트가 dedupe_key로 구분되지 않음 | `dedupe_key_distinguishes_same_second_different_ms` | 통과 | dedupe_key는 ms 단위까지 구분함. |
| C-2 | 동일 내용 + 동일 ms의 중복 메시지가 dedupe로 누락됨 | `dedupe_key_collapses_identical_messages` | 통과 (수정 후) | 초기 실패 원인은 테스트 버그(FK constraint failed — 스레드 없이 메시지 저장 시도). 스레드 먼저 저장하도록 수정 후 통과. 동일 내용+동일 ms는 같은 key로 collapse, 두 번째 INSERT OR IGNORE로 무시됨은 확인. |
| D | `extract_from_if(..cutoff_key)`가 half-open인지 closed인지 불분명 | `redb_range_to_exclusive_excludes_the_boundary_key` | 통과 | `range(..cutoff)`는 half-open. cutoff 키 자체는 제외. |
| E-1 | receiver dropped 상태에서 `task_send_message`(send)가 실패를 반환함 | `unbounded_sender_send_fails_when_receiver_is_dropped` | **통과 — 가설 유지** | `UnboundedSender::send`는 receiver drop 시 `Err` 반환. v0.2.0의 "기각" 판정은 **데드락으로 실행되지 않은 테스트**에서 나온 것. |
| E-2 | receiver live 상태에서 send 성공 | `unbounded_sender_send_succeeds_with_live_receiver` | 통과 | live receiver에는 send 성공. |

---

## TDD 세부 판정 및 근거

### A. `terminate_group_of(None)` — **가설 기각, 도달 불가**

**가설**: `spawn_connection`에서 `child.id()`가 `None`이면 `pid_slot`이 0으로 남고, `terminate_group_of(None)`이 아무것도 하지 않아 자식 프로세스 그룹이 orphan 된다.

**v0.2.0의 문제**: 테스트가 `std::process::Command`를 썼음. 프로덕션은 `tokio::process::Command`이고, `id()`의 `None` 반환 조건은 두 타입이 다름. 또 초기 실패를 "환경 문제(`/bin/true` 없음)"로 정리했는데, 그건 spawn 실패였지 pid 문제가 아니었음 — 즉 가설을 검증한 적이 없음.

**재검증**: 프로덕션과 같은 `tokio::process::Command`로 3가지를 측정.

| 시점 | `child.id()` |
|---|---|
| spawn 직후 | `Some` |
| 프로세스가 이미 종료된 뒤(reap 전) | `Some` |
| `wait()` 이후(reap 후) | `None` |

**판정**: `None`은 reap 이후에만 나옴. `connection.rs`는 `spawn()` 바로 다음 줄에서 `id()`를 읽고 그 사이에 **await 지점이 없어** 태스크가 양보할 수 없으므로, 무엇도 그 전에 reap할 수 없음. **`None` 경로는 도달 불가.**

**그럼에도 한 일**: 도달 불가와 무해는 다름. 만약 이 가정이 깨지면(예: tokio 업그레이드로 의미 변경) `pid_slot`은 0으로 남고, 종료 시 스윕이 그룹을 찾지 못해 에이전트가 띄운 모든 프로세스가 앱보다 오래 살아남음 — **소리 없이**. 이건 실제로 있었던 사건이고, 사용자가 팬 소리로 알아챘음. 그래서 방어 분기가 아니라 `log::error!` 한 줄을 넣어, 가정이 깨지면 로그에서 발견되게 했음(`connection.rs`).

---

### B. FTS CASCADE + 트리거 정합성 — **가설 기각 (근거는 v0.2.0에서 재작성)**

**가설**: cascade delete는 row-level 트리거를 fire하지 않으므로 FTS 인덱스에 고아 행이 남는다.

**v0.2.0 근거의 결함**: 테스트가 `search_messages()`로 확인했음. 그 쿼리는

```sql
FROM messages_fts
JOIN messages m ON m.id = messages_fts.rowid
JOIN threads t ON t.id = m.thread_id
```

**FTS 테이블을 `messages`·`threads`와 JOIN**함. cascade가 그 두 테이블의 행을 지우므로, FTS 인덱스가 살아 있든 없든 검색 결과는 비어 있음. 즉 그 테스트는 구분하려던 두 결과를 구분할 수 없었음.

**재검증**: `messages_fts`를 직접 카운트(`SELECT count(*) FROM messages_fts WHERE messages_fts MATCH ...`). cascade가 실제로 일어났는지도 `messages` 행 수로 함께 확인.

| 단계 | `messages` 행 | `messages_fts` 행 |
|---|---|---|
| 메시지 저장 후 | 1 | 1 |
| 스레드만 DELETE(cascade) | 0 | **0** |

**측정 조건**: SQLite 3.45.0, `foreign_keys=1`, `recursive_triggers=0` (테스트가 이 값들을 함께 기록함).

**판정**: cascade가 `AFTER DELETE` 트리거를 fire시켜 FTS 행까지 제거함. **가설은 틀렸고, 결론은 v0.2.0과 같지만 근거는 이번에 처음 성립함.**

**부수 발견**: 이 파일은 **자기모순 상태**였음. `save_thread`의 주석(594행 부근)은 `INSERT OR REPLACE`의 cascade가 "모든 메시지 + FTS 인덱스 항목"을 지운다고 정확히 적고 있었음 — 트리거가 fire해야만 가능한 서술. 틀린 쪽은 `delete_thread`의 781행이었음.

**조치**: `delete_thread`의 주석을 정정. 메시지를 먼저 지우는 코드는 **유지**하되 이유를 바꿈 — 트리거 때문이 아니라 **`PRAGMA foreign_keys`로부터의 독립성** 때문. 이 pragma는 연결별이고 기본값이 off이며, cascade는 `set_pragmas`가 켜주기 때문에만 존재함. 이를 잊은 경로로 연 연결에서는 cascade 자체가 일어나지 않아 메시지와 FTS 행이 통째로 고아가 됨. 지울 행을 명시하는 비용은 statement 하나이고 그 pragma에 의존하지 않음.

---
### C. dedupe_key — **통과**

**C-1 (같은 초, 다른 ms 구분)**: `dedupe_key_distinguishes_same_second_different_ms` — 통과. dedupe_key는 ms 단위까지 구분하여 다른 ms는 다른 key를 생성.

**C-2 (동일 내용+동일 ms 붕괴)**: `dedupe_key_collapses_identical_messages` — 초기 FK constraint failed는 테스트 버그(스레드 없이 메시지 저장 시도). 스레드 먼저 저장하도록 수정 후 통과. 동일 내용+동일 ms는 같은 key로 collapse, 두 번째 INSERT OR IGNORE로 무시됨은 확인.

**근거**:
- `thread_db.rs` 라인 129: `pub(crate) fn dedupe_key(message: &DbMessage) -> String` — ms 포함 key 생성.
- `thread_db.rs` 라인 854: `save_message` 구현 — `INSERT OR IGNORE INTO messages ...`로 dedupe_key 기반 중복 방지.

**판단**: dedupe_key는 의도된 대로 동작. C-1, C-2 모두 통과.

---

### D. redb range half-open 범위 — **통과**

**가설**: `analyse_prune`의 `extract_from_if(..cutoff_key, ...)`가 half-open 범위인지 closed인지 불분명.

**테스트**: `redb_range_to_exclusive_excludes_the_boundary_key` — `range(..cutoff)`가 cutoff 키를 포함하는지 확인.

**결과**: 통과. `range(..cutoff)`는 half-open으로 cutoff 미만만 반환. cutoff 키 자체는 제외.

**근거**: redb 2.4 기준 `range()`는 Rust의 범위 문법을 따름. `..cutoff`는 half-open.

---

### E. `task_send_message` race — **가설 유지, 실제 버그 1건 발견·수정**

**가설**: liveness 확인과 send가 원자적이지 않아, 그 사이에 자식이 죽으면 send가 명확한 에러 없이 실패한다.

**v0.2.0의 문제**: E-1 테스트가 **데드락이었음**.

```rust
let (tx, mut rx) = mpsc::unbounded_channel::<String>();
let _ = rx.recv().await;   // ← 빈 채널 + 살아있는 sender = 영원히 대기
drop(rx);
let result = tx.send(...);  // ← 여기까지 도달한 적 없음
```

`recv()`는 다음 메시지를 기다리는데 이 테스트는 아무것도 보내지 않음. 프로세스가 종료되지 않아 `cargo test`가 타임아웃을 보고했고, 그래서 "send가 Ok를 반환한다"는 판정은 **관측된 적이 없음**. 이 한 줄이 v0.2.0이 기록한 300초 타임아웃 전부였음.

**재검증**: 그 줄을 지우자 테스트가 즉시 통과 — `UnboundedSender::send`는 receiver drop 시 **`Err`를 반환함**. 가설 E-1은 맞았음.

**그래서 진짜 질문은 채널이 아니라 호출부**: `task_send_message`가 그 `Err`를 보는가?

| 분기 | 상태 |
|---|---|
| 연결 살아있음(`else`) | ✅ `.is_ok()`로 확인, 실패 시 `paused` + 명확한 에러 반환. 주석에 사건 경위까지 기록돼 있음 |
| 재연결 후 첫 전송 | ❌ **`let _ =`로 결과 폐기** |

**이것이 실제 버그**: `spawn_connection`은 채널만 만들고 즉시 반환하며, 에이전트 프로세스는 그 뒤 async 태스크 안에서 시작됨. 런타임 실행이 실패하면(잘못된 경로, 없는 바이너리) `cmd_rx`가 drop되고 이어지는 send가 실패하는데, 그 실패를 폐기하고 있었음. 결과는 형제 분기가 이미 주석으로 남긴 그 증상 그대로 — 타임라인에 메시지는 남고 스피너는 돌지만 전달은 없음.

**조치**: 재연결 분기도 형제 분기와 같이 결과를 확인하고 `paused` + 명확한 에러를 반환하도록 수정(`commands.rs`).

**함께 문서화한 것 (send Ok의 의미)**: 성공한 send도 전달을 보장하지 않음. 큐는 연결 태스크보다 오래 살지 않으므로, 메시지가 큐에 들어간 뒤 태스크가 실패하면 메시지는 버퍼째 사라짐. `Ok`는 "넘겼다"이지 "전달됐다"가 아니며, 전달 보장은 `alive` 플래그와 워치독에서 나옴.

---

## 이번 라운드에서 수정된 것

### 프로덕션 코드

1. **`commands.rs` — 재연결 분기의 send 실패 폐기** (실제 버그). `let _ =`를 `.is_ok()` 확인으로 바꾸고, 실패 시 `paused` + 명확한 에러 반환. 형제 분기와 동일한 처리.
2. **`thread_db.rs` — `delete_thread` 주석 정정.** "CASCADE는 트리거를 fire하지 않는다"는 틀린 서술 제거. 메시지 선삭제는 유지하되 이유를 `PRAGMA foreign_keys` 독립성으로 교체.
3. **`connection.rs` — pid 없음에 대한 관측성.** 도달 불가 경로지만 결과가 심각하므로(프로세스 그룹 유출) `log::error!` 추가.

### 테스트

4. **E-1 데드락 제거** — `rx.recv().await` 삭제. 이것이 전체 스위트 타임아웃의 원인이었고, 제거 후 287개가 1.03초에 완료.
5. **B 테스트 재작성** — `search_messages`(JOIN 때문에 구분 불가) → `messages_fts` 직접 카운트. cascade가 실제로 일어났는지 `messages` 행 수로 검증하는 단계 추가. 프로덕션 경로(`delete_thread`)의 대조 테스트와 측정 조건(SQLite 버전·pragma) 기록 테스트도 추가.
6. **A 테스트 재작성** — `std::process::Command` → 프로덕션과 같은 `tokio::process::Command`. 종료 후·reap 후 시점까지 3단계로 측정.

### v0.2.0에서 이어받은 것

7. **visibility**: `dedupe_key`, `ThreadDatabase::write`를 `pub(crate)`로. (`read`는 건드리지 않음 — B 테스트는 `write`가 넘겨주는 커넥션으로 조회함.)
8. **C-2 테스트 버그 수정**: FK 제약 위반은 스레드 없이 메시지를 저장한 테스트 잘못. 스레드 선저장으로 수정.
9. **redb 테스트**: `AccessGuard`는 `Deref` 미구현이므로 `k.value()` 사용.

---

## 테스트 실행 방법 (v0.2.0 정정)

```bash
cd src-tauri && cargo test --lib          # 287개, 약 1초
```

v0.2.0의 "전체 실행은 계속 타임아웃(300s)"은 환경 문제가 아니라 E-1 테스트의 데드락이었음. macOS에 `timeout`이 없는 것은 맞지만 대안이 있음:

```bash
perl -e 'alarm 30; exec @ARGV' cargo test --lib
```

---

## 미결 및 추가 확인 필요 사항

A·B·E는 이번 라운드에서 종결(위 각 절 참조). 남은 것:

- **미검증 5건**: 2(인메모리 DB 폴백), 3(confy torn write), 5(PTY Drop 블로킹), 6(DST 캐싱), 7(`agent_rpc_request` pending 미정리), 8(`tool_kind` 분류). TDD 미적용.
- **E의 잔여 질문**: send가 `Ok`여도 큐에 들어간 메시지는 연결 태스크와 함께 사라짐. 현재 보호 장치는 `alive` 플래그와 워치독뿐. 사용자에게 "전달되지 않았다"를 더 빨리 알릴 수 있는지는 별도 과제.

**해소된 항목** (v0.2.0의 미결 목록에서 제거):

- ~~A: 방어 코드 필요 여부~~ → 도달 불가로 판정, 관측성만 추가.
- ~~B: CASCADE + 트리거만으로 충분한지~~ → 충분함(측정). 메시지 선삭제는 pragma 독립성 때문에 유지.
- ~~E: receiver drop 비감지 문서화~~ → 전제가 틀렸음. 감지함. 대신 재연결 분기의 실제 버그를 수정.
- ~~기존 test suite 3개 실패~~ → 전체 287개 통과. 실패는 없음.
- ~~전체 실행 타임아웃~~ → E-1 테스트의 데드락이 원인. 제거 후 1.03초.

---

## 요약 (원문 유지 + TDD 반영)

| # | 문제 | 파일 | 우선순위 | 유형 | TDD 판정 |
|---|---|---|---|---|---|
| 1 | `terminate_group_of(None)`에서 자식 그룹 미신호 | `rpc/connection.rs` | P1 | 프로세스 누수 | A 통과 — spawn 직후 pid는 Some. 환경 특수 케이스만 문제. |
| 2 | 인메모리 DB 폴백 감지 불가 | `thread_db.rs` | P4 | 데이터 소실/비투명 | (TDD 미검증) |
| 3 | confy 인플레이스 쓰기 + torn file | `settings.rs` | P3 | 데이터 무결성 | (TDD 미검증) |
| 4 | `task_send_message` 경합, 원인 불명 정지 | `rpc/commands.rs` | P2 | UX/에러 처리 | E-1 기각 — unbounded send는 receiver drop 감지 못 함. race window는 send 이후. |
| 5 | PTY Drop 블로킹 루프 | `pty.rs` | P5 | 패턴 일관성 | (TDD 미검증) |
| 6 | `local_offset_secs` DST 캐싱 오차 | `analytics.rs` | P5 | 분석 정밀도 | (TDD 미검증) |
| 7 | `agent_rpc_request` Ok(Err) pending 미정리 | `rpc/commands.rs` | P5 | 일시적 메모리 | (TDD 미검증) |
| 8 | `tool_kind` 분류 누락 가능 | `rpc/connection.rs` | P5 | UI 분류 | (TDD 미검증) |
| B | FTS CASCADE+트리거 정합성 주장 오류 | `thread_db.rs` | (주장 수정 필요) | 문서/코드 주석 오류 | **가설 기각 — CASCADE delete 시 FTS trigger fire함. 문서/주석 수정 필요.** |

---

**다음 단계**: B를 수정(코드 주석/문서에서 CASCADE 관련 주장 정정)하고, E의 메시지 소실 시나리오 문서화. 이후 우선순위에 따라 P1/P2 실제 수정 진입.

## 1. 프로세스 그룹 정리: `terminate_group_of(None)`에서 자식 그룹 미신호

**파일**: `src-tauri/src/commands/rpc/connection.rs`
**함수**: `terminate_group_of` (라인 799-818)
**관련**: `spawn_connection` → `pid_slot` (라인 323, 565-568)
**우선순위**: P1 — 프로세스 누수

### 원인

`spawn_connection` 내부에서 실제 프로세스 id는 다음 순서로 저장됩니다:

```
pid_slot.store(id, Ordering::SeqCst);  // 라인 567 — child.id()가 Some일 때만 실행
```

라인 565-568:

```rust
let child_pid = child.id();
if let Some(id) = child_pid {
    pid_slot.store(id, Ordering::SeqCst);
}
```

즉, `child.id()`가 `None`이면 `pid_slot`은 0인 채로 남습니다. 그다음 `run_rpc_connection`이 끝날 때 `terminate_group_of(pid_slot.load(...))`가 호출되는데, `pid_slot`이 `None`(0이면 `Option<u32>`로 변환 시 `None`)이면 함수 첫 줄에서 즉시 리턴합니다:

```rust
async fn terminate_group_of(pid: Option<u32>) {
    #[cfg(unix)]
    {
        let Some(pid) = pid else { return };  // ← 여기서 끝
        ...
    }
}
```

한편, 자식 프로세스는 spawn 시점에 `process_group::lead_new_group(&mut cmd)`로 프로세스 그룹의 리더가 됩니다(라인 550). 이 리더의 pid가 곧 그룹 id입니다. `child.id()`가 `None`이 되는 시나리오는 `tokio::process::Child::id()` 문서상 "Returns the OS pid if the child is still alive, or None if the child has been reaped"로 기술되어 있습니다. spawn 직후 reaped 되는 상황은 비정상적이지만, 검사되지 않은 코너케이스입니다.

### 예상 증상

- `child.id()`가 `None`을 반환하는 특수한 상황(예: spawn 직후 reaped, 플랫폼 특이성)에서, 에이전트 자식 프로세스와 그 자손(Python 커널, MCP 서버, bash 도구)이 SIGTERM도 받지 못하고 orphan 됩니다.
- 앱 종료 flush/checkpoint 전에 프로세스가 살아있으면 그 자식은 계속 실행됩니다.
- 사용자는 프로세스가 백그라운드에서 조용히 자원을 소모하는 것을 인지하지 못합니다.
- 단기적으로는 리소스 누수, 장기적으로는 살아있는 orphan 프로세스로 인한 포트 충돌이나 디스크 사용량 증가 가능성.

### 이상적인 해결법

**1순위 — pid_slot을 `Option<u32>`로 변경하거나, `child.id()`가 `None`일 때도 그룹 신호 경로를 확보합니다.** spawn 후 `child.id()`를 즉시 캡처하고, 그 값을 `run_rpc_connection`의 종료 경로 전체에 전달하면 pid 손실 자체를 막을 수 있습니다.

구체적으로:

```rust
// spawn_connection 내에서 현재:
let child_pid = child.id();
if let Some(id) = child_pid {
    pid_slot.store(id, Ordering::SeqCst);
}

// 개선: child.id()를 한 번만 캡처하고 Arc<Option<u32>> 또는 Arc<AtomicU32>에 저장
// pid_slot 타입은 이미 Arc<AtomicU32>이고, 0은 "미설정" 의미로 사용 중이므로
// terminate_group_of에서도 0 아닌 값을 pid로 받아들이게 수정
```

**2순위 — `terminate_group_of` 내에서 pid가 `None`이거나 0일 때 로그.warn을 남겨서 디버깅 가시성을 확보합니다.** 지금은 조용히 통과합니다.

**3순위(더 근본적)** — `child.id()`가 spawn 직후 None이 되는 케이스를 단위 테스트로 커버하거나, spawn 직후 pid를 캡처해 Arc에 넣는 방식으로 코드 구조를 바꿉니다. 현재 구조에서는 `pid_slot`이 `run_rpc_connection` 내부에서 `pid_slot.store(id, ...)`로 채워지고, reader 태스크와 command 태스크 양쪽에서 읽는 공유 상태입니다. 이 공유 타이밍에 race가 생길 여지도 있습니다.

### 관련 회귀 테스트 주석

동일한 파일 라인 763-771에 기존 회귀 사례가 기록되어 있습니다:

> "Exit 137 (OOM-killed) and exit 0 were reported identically, so a crash looked like a clean finish to the whole UI."
> "The leader is reaped, but its group is not: the Python kernel, MCP servers and any bash children are still running..."

이 회귀는 `terminate_group_of`를 호출하는 것으로 수정됐습니다. 그러나 위 pid_slot 공백만큼은 아직 열려 있습니다.

---

## 2. 인메모리 DB 폴백: 감지 불가

**파일**: `src-tauri/src/commands/thread_db.rs`
**함수**: `ThreadDatabase::open` (라인 303-313), `open_fallback` (라인 364-371)
**우선순위**: P4 — 데이터 소실 위험, 사용자 비투명성

### 원인

`ThreadDatabase::open()`은 먼저 파일 기반 DB를 `try_open_file()`로 열려고 시도합니다. 실패 시:

```rust
Err(e) => {
    log::error!(
        "Failed to open thread database, falling back to in-memory: {}",
        e
    );
    Self::open_fallback()
}
```

폴백은 인메모리 SQLite를 열고, `ConnectionMode::SharedSingle`로 단일 연결을 사용합니다. 문제:

1. **사용자에게 피드백 없음** — UI에는 아무 표시도 안 납니다. 로그는 파일/콘솔에만 남습니다.
2. **종료 시 flush/checkpoint가 무의미** — `shutdown_app`의 `ThreadDbState` drain은 WAL checkpoint를 시도하지만, 인메모리 DB는 WAL 파일이 존재하지 않고, `flush_and_checkpoint`는 아무 일도 하지 않습니다.
3. **앱 재시작 시 스레드·메시지가 전부 사라짐** — 사용자가 "방금 작업을 저장했다"고 인식했는데 실제로는 휘발성 메모리에만 있었습니다.

### 예상 증상

- 디스크 공간 부족, 권한 문제, 파일 잠금으로 DB 열기에 실패한 사용자는 앱이 정상 동작하는 것처럼 보이지만, 종료 후 모든 대화가 사라집니다.
- 사용자 불만은 "앱이 내 대화를 저장하지 않는다"는 형태로 나타납니다.
- 버그 리포트가 와도 재현이 어렵고, 로그 없이는 원인 파악이 까다롭습니다.

### 이상적인 해결법

**1순위 — 폴백 활성화 시 사용자에게 명시적 피드백.** 예: 설정 화면에 "대화 저장소를 사용할 수 없습니다. 디스크 공간을 확인하거나 앱 데이터를 재설정하세요." 배너. 또는 앱 시작 시 스낵바/모달.

**2순위 — `ThreadDatabase`가 파일 기반인지 인메모리인지를 나타내는 플래그를 노출.** `ThreadDbState`에 `is_degraded: bool`을 추가하거나, `open()`의 반환 타입으로 `Result<ThreadDatabase, FallbackOpened>` 같은 형태를 고려합니다.

**3순위 — 폴백 상황에서도 최소한 로컬 캐싱을 시도.** 인메모리 폴백이 불가피할 때, 종료 시 인메모리 상태를 어딘가(예: `~/.lafagent/cache/`)에 덤핑하는 비상 경로를 둘 수 있습니다. 다만 이건 범위를 크게 벗어나는 작업입니다.

### 현재 행동

현재 행동은 "로깅만 하고 조용히 폴백"입니다. `log::error!`는 stdout/로그 파일에 남고, 사용자는 모릅니다. `quarantine_if_corrupt`(settings.rs)와 달리, 이 폴백은 회복 가능한 부패가 아니라 영구적 장애이므로 스펙이 다릅니다.

---

## 3. confy 인플레이스 쓰기: 설정 파일 찢어짐(torn write)

**파일**: `src-tauri/src/commands/settings.rs`
**함수**: `persist_store` (라인 377-379), `quarantine_if_corrupt` (라인 333-357)
**우선순위**: P3 — 데이터 무결성

### 원인

`persist_store`는 `confy::store(APP_NAME, None, data)?`를 호출합니다. 주석에 따르면:

> "confy writes the TOML in place (no temp-file + rename), so a crash mid-write can leave a torn file."

토막 기록 가능성은 크게 두 상황에서 현실화됩니다:

1. **디스크 가득 참** 직전 — 쓰기 도중 ENOSPC가 발생하면 파일의 앞부분만 confy가 쓴 상태로 중단.
2. **전원 끊김/SIGKILL** — OS 버퍼 플러시 전에 프로세스가 사라지면 디스크에 불완전한 TOML이 남음.

`quarantine_if_corrupt`는 다음 앱 시작 때 호출되어 파싱 실패 시 찢어진 파일을 `*.corrupt.<timestamp>.toml`로 이동시키고 새 기본값으로 시작합니다. 따라서 **데이터 손실은 한 번의 부트 지연으로 복구 가능**합니다. 그러나 그 사이 앱 실행 중에는 찢어진 파일을 `confy::load`가 파싱 실패로 defaulting 해버릴 수 있습니다. `SettingsState::default()` 생성자:

```rust
impl Default for SettingsState {
    fn default() -> Self {
        if let Ok(path) = confy::get_configuration_file_path(APP_NAME, None) {
            quarantine_if_corrupt(&path);
        }
        let data = confy::load::<StoreData>(APP_NAME, None).unwrap_or_default();
        Self(Mutex::new(data))
    }
}
```

`quarantine_if_corrupt` 전에 `confy::load`가 호출될 가능성을 배제할 수 있는지 여부는 confy의 내부 동작에 달렸습니다. 현재 코드에서는 `quarantine_if_corrupt`가 먼저 호출되므로 순서는 안전합니다.

### 예상 증상

- 앱 종료 직전 설정 저장 중 크래시/전원이 끊기면, 다음 부트 시 설정이 기본값으로 초기화됩니다.
- 사용자 설정(API 키, 테마, 프로젝트 프리퍼런스, 최근 프로젝트 목록 등)이 날아갑니다.
- `quarantine_if_corrupt`가 찢어진 파일을 이름 바꿔 보관하므로 복구는 가능하지만, 사용자가 원본을 손수 되살려야 합니다.
- 빈번한 크래시가 있을 경우, 사용자는 "왜 설정이 자꾸 초기화되냐"고 느끼게 됩니다.

### 이상적인 해결법

**1순위(범위 내)** — `quarantine_if_corrupt`는 이미 있고 잘 작동합니다. 현재 코드의 방어선은 적절합니다.

**2순위(아키텍처 변경)** — confy를 우회해 직접 원자적 쓰기를 구현하는 것. `write_to_temp() + rename()` 패턴으로 torn write를 원천 차단할 수 있습니다. 단, confy가 관리하는 경로(`confy::get_configuration_file_path`가 반환하는 위치)를 그대로 써야 하고, 직렬화/역직렬화도 복제해야 합니다. 주석에 따르면 "bypassing confy would mean owning its path/serialization contract"라고 판단하여 지금 범위에서 보류 중입니다.

**3순위(개선)** — `persist_store` 호출 전에 현재 config 파일의 크기를 기억해두고, 저장 후 크기가 0이거나 비정상적으로 작아졌으면 경고를 로그/사용자 피드백으로 내보내는 모니터링. 완전하게 막지는 못해도 조기 감지는 됩니다.

---

## 4. `task_send_message` 경합: 원인 불명 일시 정지

**파일**: `src-tauri/src/commands/rpc/commands.rs`
**함수**: `task_send_message` (라인 301-432), 특히 라인 404-427
**우선순위**: P2 — UX/에러 처리

### 원인

`task_send_message`는 다음과 같은 흐름으로 동작합니다:

1. **라이브니스 확인**: `state.connections`에서 커넥션 핸들을 찾고, `h.alive.load(SeqCst)`가 false면 재연결 필요.
2. **재연결 필요 없으면**: 기존 핸들에 `cmd_tx.send(Prompt(...))`를 시도합니다.
3. **send 실패 시** (라인 419-427):

```rust
if !sent {
    if let Some(task) = state.tasks.lock().get_mut(&task_id) {
        task.status = "paused".to_string();
    }
    return Err(
        "The agent connection closed before the message was sent. Send it again to reconnect."
            .to_string(),
    );
}
```

문제는 **라이브니스 확인과 send 사이에 간격(race window)**이 존재한다는 점입니다. 라인 409-418:

```rust
let sent = {
    let conns = state.connections.lock();
    match conns.get(&task_id) {
        Some(h) => h
            .cmd_tx
            .send(AgentCommand::Prompt(message, attachments.unwrap_or_default()))
            .is_ok(),
        None => false,
    }
};
```

여기에서 `alive` 플래그는 send 전에 확인했지만, `cmd_tx.send` 호출 시점에 채널이 이미 닫혀 있을 수 있습니다(mpsc::UnboundedSender의 send는 수신 측이 드롭되면 Err를 반환). 이 구간은 lock을 잡지 않은 상태이므로, 다른 태스크에서 Kill을 보내거나 프로세스가 죽는 타이밍과 겹칠 수 있습니다.

또한 **send는 성공했지만 그 직후 reader 태스크가 stdout read error로 종료된 경우**도 똑같이 "메시지가 도달하지 않음"으로 끝나는데, 이 경로에 대한 구별은 없습니다.

### 예상 증상

- 사용자가 메시지를 보냈는데 에이전트가 반응하지 않고, 태스크 상태가 "paused"로 바뀐 채 멈춥니다.
- 에러 메시지는 "연결이 닫혔으니 다시 보내라"이고, **무엇이 원인인지(프로세스가 죽었는지, reader가 죽었는지, 시그널을 받았는지)는 제공하지 않습니다.**
- `debug_log` 이벤트로도 이 상황의 구체적 원인이 기록되지 않습니다(연결 종료 자체는 라인 394-409의 `run_rpc_connection` 완료 시점에 `task_error`로 나가지만, `task_send_message`가 실패한 시점에는 아직 그 이벤트가 안 나갔을 수 있습니다).
- 사용자는 "왜 멈췄는지"를 알 수 없고, 다시 보내기 외의 액션을 못 합니다.

### 이상적인 해결법

**1순위 — 에러 맥락을 풍부하게 전달.** send 실패 시 단순히 "재연결하라"가 아니라, 가능한 원인(프로세스 종료, 리더 재aped, reader 오류)을 구별해서 알려주거나, 최소한 `debug_log`에 구체적 원인을 기록합니다.

**2순위 — race window 축소.** `alive` 플래그 확인과 send를 하나의 잠금/불변식으로 묶을 수 있는지 검토. 현재 구조에서는 `alive`는 reader 태스크가 관리하는 AtomicBool이고, `cmd_tx`는 별도 채널이라 단일 잠금으로의 통합은 구조를 바꿔야 합니다. 당장 가능한 차선책은 send 직후 `alive`를 재확인하여 "보냈는데 reader가 이미 죽었는지가"를 체크하는 것입니다.

**3순위 — send 실패 시 `task_error` 이벤트를 추가로 발생시켜 UI가 사용자에게 알림을 표시하도록 함.** 현재는 `task_send_message`가 에러 string을 반환하는 것만으로 끝나고, 프론트엔드가 이걸 어떻게 표시할지는 별도 구현 사항입니다.

---

## 5. PTY 종료 시의 그룹 신호 타이밍

**파일**: `src-tauri/src/commands/pty.rs`
**타입**: `PtyInstance` (라인 22-27), `Drop` (라인 29-58)
**우선순위**: P5 — 정상 동작하지만 패턴 일관성 관점에서 검토 가치 있음

### 원인

`PtyInstance::Drop`은 프로세스 그룹 신호를 보내는 함수입니다:

```rust
#[cfg(unix)]
if let Some(pid) = self.child.process_id() {
    super::process_group::signal_group_term(pid);
    // grace period, try_wait loop, SIGKILL fallback
}
let _ = self.child.kill();
let _ = self.child.wait();
```

`process_group.rs`의 `terminate_group`과 비슷한 패턴(우선 SIGTERM, grace, SIGKILL)을 따르지만, **Drop 안에서 블로킹 `try_wait` 루프를 돌린다**는 점이 다릅니다. Drop은 어떤 스레드에서 호출될지保証되지 않고, 긴 루프를 포함하면 해당 스레드를 오래 점유합니다.

pty의 slave는 로그인 셸을 spawns하고, 셸은 세션 리더입니다. 셸이 spawns한 자식(dev server, 빌드 등)은 같은 프로세스 그룹에 속하므로 `signal_group_term(pid)`로 종료됩니다. 이는 `rpc/connection.rs`가 사용하는 패턴과 일관됩니다.

### 예상 증상

- 일반 사용에서는 문제 없음. PTY 셸이 spawns한 자식도 함께 종료됩니다.
- Drop이 메인 스레드가 아닌 곳에서 호출될 때 긴 grace period(최대 500ms + 시그널 대기)가 스레드를 막을 수 있으나, 보통 백그라운드 스레드에서 발생하므로 UI 영향은 제한적입니다.

### 이상적인 해결법

현재 구현은 intent는 명확하고 기존 패턴과 일관됩니다. **개선을 한다면, Drop 내 `try_wait` 루프를 별도 spawned task로 빼서 동기 드롭의 블로킹을 피하는 것**이 가능하나, spawned task가 종료될 때까지 기다릴 수 없으므로 실질적 이득은 적습니다. 현재 상태로도 intent는 달성됩니다.

---

## 6. `local_offset_secs` 캐싱: DST 경계에서의 day bucket 오차

**파일**: `src-tauri/src/commands/analytics.rs`
**함수**: `local_offset_secs` (라인 454-466), `civil_local_day` (라인 428-433)
**우선순위**: P5 — 분석 정확도, 낮은 위험도

### 원인

```rust
fn local_offset_secs() -> i64 {
    static OFFSET: OnceLock<i64> = OnceLock::new();
    *OFFSET.get_or_init(|| {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        platform_local_offset(now)
    })
}
```

`OnceLock`은 한 번만 값을 계산합니다. 부트 시점의 오프셋을 고정으로 쓰므로, **부트 후 DST 전환이 발생하면 그 전환일 이후의 `day_key`가 잘못된 날짜 경계에 걸릴 수 있습니다.** 예를 들어 미국 태평양 시간대에서 가을 역행 전환(daylight → standard) 날 밤에 부트한 경우, offset이 -7시간으로 고정된 채 -8시간이어야 할 시간대를 처리합니다. 자정 근처에서 최대 1시간 차이로 날짜가 틀어질 수 있습니다.

### 예상 증상

- DST 전환일 근처에서 부트한 사용자의 일간 분석 차트(코딩 시간, 메시지 수 등)에서 하루 치가 1시간 밀리거나 당겨진 상태로 집계될 수 있습니다.
- 영향은 하루에 한정되고, 이후 날은 offset이 전체 기간에 일정하므로 현상이 지속되지는 않습니다.
- 정량的には 코딩 시간 ±1시간, 메시지 카운트 1일 오분류 정도입니다.

### 이상적인 해결법

**1순위 — 분석 정밀도 요구가 높아지면** `OnceLock` 대신 각 이벤트 timestamp마다 오프셋을 계산하는 방식으로 변경. `chrono`를 쓰거나, `localtime_r`을 이벤트마다 호출(성능 이슈 가능). 현재 주석은 "dashboards don't really need DST-correct boundaries to the second"라고 그 필요를 낮게 보고 있습니다.

**2순위 — 절충**으로, 부트 시점 offset을 쓰되, DST 전환일을 감지하면 그 날만 별도 보정하는 로직을 추가할 수 있습니다. 그러나 전환일이 시스템 로캘에 따라 달라지므로 구현이 복잡해집니다.

현 상태에서는 사용자에게 영향이 비교적 작고, 개발자가 의도한 절충 범위 내입니다.

---

## 7. `agent_rpc_request`의 pending 정리 타이밍

**파일**: `src-tauri/src/commands/rpc/commands.rs`
**함수**: `agent_rpc_request` (라인 731-792)
**우선순위**: P5 — 잠재적 메모리 누수, 낮은 빈도

### 원인

```rust
let (tx, rx) = tokio::sync::oneshot::channel::<Value>();
{
    let conns = state.connections.lock();
    let handle = conns.get(&task_id)...;
    handle.pending.lock().insert(request_id.clone(), tx);
    if let Err(e) = handle.cmd_tx.send(AgentCommand::Raw(...)) {
        handle.pending.lock().remove(&request_id);  // send 실패 시 정리
        return Err(...);
    }
}

let response = match tokio::time::timeout(Duration::from_secs(120), rx).await {
    Ok(Ok(v)) => v,
    Ok(Err(_)) => { ... }     // 채널이 이미 닫힘 → 정리 안 함
    Err(_) => {
        if let Some(h) = state.connections.lock().get(&task_id) {
            h.pending.lock().remove(&request_id);  // 타임아웃 시 정리
        }
        return Err(...);
    }
};
```

Timeout 케이스에서는 `pending`에서 제거하고 있습니다. 그러나 `Ok(Err(_))` 케이스(채널이 이미 닫힌 경우, 즉 reader 태스크가 응답을 보내기 전에 종료된 경우)에는 **pending 항목을 제거하지 않습니다.** reader 태스크 종료 시 pending clearance는 `spawn_connection`의 완료 핸들러(라인 353-361)가 실행합니다:

```rust
{
    let mut waiting = pending_epilogue.lock();
    if !waiting.is_empty() {
        log::warn!(...);
        waiting.clear();
    }
}
```

이건 pending 전체가 공유 `Arc<Mutex<HashMap>>`라서, 최종적으로 정리되긴 합니다. 따라서 **메모리 누수는 일시적**이며, 연결 종료 시 회수됩니다.

### 예상 증상

- 요청 → 타임아웃/연결 종료가 매우 자주 발생하는 상황이 아니라면 무시할 수 있는 수준의 일시적 메모리 사용 증가.
- `agent_rpc_request` 호출 1회당 `pending` 항목이 타임아웃까지 남아있지만, 120초 후 hoặc 연결 종료 시 정리됨.

### 이상적인 해결법

`Ok(Err(_))` 케이스에서도 명시적으로 `pending.remove`를 호출하는 게 코드 대칭성과 가독성 면에서 낫습니다:

```rust
Ok(Err(_)) => {
    if let Some(h) = state.connections.lock().get(&task_id) {
        h.pending.lock().remove(&request_id);
    }
    return Err("The agent connection closed before responding.".to_string());
}
```

기능 버그는 아니며, 최종 정리 메커니즘이 이미 존재하므로 회귀 위험은 낮습니다.

---

## 8. `tool_kind` 분류의 불완전 가능성

**파일**: `src-tauri/src/commands/rpc/connection.rs`
**함수**: `tool_kind` (라인 119-127)
**우선순위**: P5 — UI 분류 오류, 데이터 손실 없음

### 원인

`tool_kind`는 prime-agent 도구명을 프론트엔드 아이콘/분류에 지도합니다:

```rust
match tool_name {
    "bash" | "ipython" => "execute",
    "edit" | "write" | "write_file" | "multi_edit" | "str_replace" | "organize" => "edit",
    "read" | "read_file" | "ls" | "list_dir" | "grep" | "glob" | "find" => "read",
    "fetch" | "web_fetch" | "web_search" | "websearch" | "research" => "fetch",
    _ => "other",
}
```

도구가 추가될 때마다 이 match에 새 항목을 넣어야 합니다. 누락되면 "other"로 분류되고, 아이콘이 기본 처리됩니다. **기능에는 영향 없고 UI 분류만 틀립니다.**

### 예상 증상

- 새로운 도구가 추가됐는데 `tool_kind`에 없는 경우, UI에서 "other" 아이콘으로 표시됩니다.
- 사용자가 알아차리기 어려운 수준의 시각적 문제고, 데이터 손실이나 기능 오류는 없습니다.

### 이상적인 해결법

**방식 1**: prime-agent 측이 도구 메타데이터에 `category` 필드를 제공하도록 하고, 그 값을 그대로 사용하는 것. 현재 prime-agent의 RPC 도구 이벤트에서 그런 필드가 있는지 확인 필요.

**방식 2**: `tool_kind`를 플러그 가능한 맵으로 만들어서 런타임에 확장 가능하게 하는 것. 단, 이 앱의 모델("확장 발견은 allowlist")과 충돌할 수 있으므로 의도적으로 닫힌 목록을 유지하는 것일 수 있습니다.

현 상태에서는 의도적 설계일 가능성이 높고, 문제 severity는 낮습니다.

---

## 요약

| # | 문제 | 파일 | 우선순위 | 유형 |
|---|---|---|---|---|
| 1 | `terminate_group_of(None)`에서 자식 그룹 미신호 | `rpc/connection.rs` | P1 | 프로세스 누수 |
| 2 | 인메모리 DB 폴백 감지 불가 | `thread_db.rs` | P4 | 데이터 소실/비투명 |
| 3 | confy 인플레이스 쓰기 + torn file | `settings.rs` | P3 | 데이터 무결성 |
| 4 | `task_send_message` 경합, 원인 불명 정지 | `rpc/commands.rs` | P2 | UX/에러 처리 |
| 5 | PTY Drop 블로킹 루프 | `pty.rs` | P5 | 패턴 일관성 |
| 6 | `local_offset_secs` DST 캐싱 오차 | `analytics.rs` | P5 | 분석 정밀도 |
| 7 | `agent_rpc_request` Ok(Err) pending 미정리 | `rpc/commands.rs` | P5 | 일시적 메모리 |
| 8 | `tool_kind` 분류 누락 가능 | `rpc/connection.rs` | P5 | UI 분류 |

---

**다음 단계**: 우선순위를 어느 쪽으로 잡고 실제 수정을 시작할지 결정. P1(프로세스 누수)이 데이터/안정성 측면에서 가장 거칠고, P2(에러 UX)는 사용자 체감에 직접 닿는 항목입니다.
