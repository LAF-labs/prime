# Handoff: 비개발자 친화성 개선 (개인 비서 + 개인사업 경리)

> 버전: 0.1.0
> 날짜: 2026-08-11
> 목적: 자영업자·직장인·학생이 prime-agent를 개인 비서/경리로 쓰기 편하도록,
>        내부구조·백엔드·UI 개선 항목을 외부 검증 패턴 기반으로 TDD 진행.
> 작업 로그: 이 문서에 모든 항목의 연구/설계/TDD/구현/검증을 기록.

## 방법론 (중요)

- 본 모델은 설계 목적용 고급 추론 모델이 아님. 따라서 설계는 **외부에서 검증된 패턴**을
  찾아 근거로 삼고, 임의 추측은 배제한다.
- 진행 단위: **항목 하나씩** 깔끔하게. 각 항목은
  `외부 연구 → 설계 결정 → TDD 실패 테스트 → 구현 → 검증` 순으로 밀어붙인다.
- 외부 비교 레포(이미 탐색됨): khoj(Electron 데스크톱, 설정 폼 + 명시적 에러 alert),
  llm-space(Electrobun 데스크톱, 호스트/클라이언트 분리), nao(백엔드+CLI 컨텍스트 분리),
  agent-chat-ui(LangGraph 채팅 UI), deepsec(안내형 첫 실행 + 비용/시간 제어).

## 항목 백로그 (우선순위 순)

| # | 항목 | 근거(감사) | 비개발자 영향 |
|---|------|-----------|--------------|
| P4 | 인메모리 DB 폴백 비투명성 → degraded 표시 | backend-audit-findings.md §2 | 데이터 소실 직결, 최악의 페인 |
| P3 | confy 인플레이스 쓰기(torn write) | §3 | 설정 리셋 불신 |
| B1 | 경리/비서 온보딩 선택지 | 외부 비교(khoj) | 첫 1분 장벽 |
| P8 | tool_kind 분류 누락 | §8 | 화면 신뢰 |
| P6 | DST 경계 분석 오차 | §6 | 보고서 정밀도 |

## 진행 상태

- [x] P4 — 인메모리 DB 폴백 비투명성 (배너까지 완료)
- [ ] P3 — torn write
- [ ] B1 — 온보딩
- [ ] P8 — tool_kind
- [ ] P6 — DST

---

## P4 — 인메모리 DB 폴백 비투명성 (진행 중)

### 외부 연구
- **SQLite 공식 문서(WAL)**: file-backed DB와 in-memory DB는 본질적으로 다른 durability
  계약이다. WAL checkpoint는 인메모리엔 존재하지 않는다. 따라서 "저장됨"과 "휘발성"을
  명시적으로 구분하는 것은 업계 표준.
- **Rust 관행**: open의 성공/폴백을 타입 또는 플래그로 구분(`Result<T,E>` 또는 상태 플래그).
  호출자가 degraded 상태를 알아야 한다.
- **비교 레포(khoj)**: 설정 로드 실패/용량 부족 시 사용자에게 `window.alert`로 명시적 안내.
  우리도 동일하게 "사용자에게 알린다"는 방향.

### 설계 결정
- `ThreadDatabase`에 `is_degraded: bool` 필드 추가.
- `build_from_connection(write_conn, mode, is_degraded)` 시그니처 확장.
- `open_fallback()`/`open_memory()` → `is_degraded = true` (둘 다 인메모리).
  `try_open_file()`/`open_at()` → `false`.
- `ThreadDatabase::is_degraded() -> bool` 메서드 노출.
- `ThreadDbState::is_degraded()` 위임 + `thread_db_is_degraded` Tauri 명령.
- `StorageBanner`가 시작 시 1회 조회해 배너 표시.

### TDD 실패 테스트
- 파일: `src-tauri/src/commands/backend_audit_tests.rs` (기존 `audit_tests` 모듈 확장)
- 테스트:
  - `open_memory_is_degraded()` — `open_memory()` 결과 `is_degraded() == true` 기대
  - `open_at_is_not_degraded()` — `open_at(path)` 결과 `is_degraded() == false` 기대
- 상태: **RED** — `is_degraded()` 메서드 미존재로 컴파일 실패 예상 (백그라운드 빌드 확인 중)
- 커밋/수정: `backend_audit_tests.rs`에 두 테스트 추가 완료.

### 구현
- `ThreadDatabase` struct에 `is_degraded: bool` 필드 추가.
- `build_from_connection(write_conn, mode, is_degraded)` 시그니처 확장.
- 호출부:
  - `try_open_file` 두 return 지점 → `FileSeparate, false`
  - `open_fallback` → `SharedSingle, true`
  - `open_at` → `FileSeparate, false`
  - `open_memory` → `SharedSingle, true`
- `ThreadDatabase::is_degraded() -> bool` 공개 메서드 추가 (open 시 1회 세팅, lock 불필요).
- `ThreadDbState::is_degraded() -> bool` 위임 메서드 추가 (UI가 시작 시 호출).

### 검증
- **TDD RED→GREEN 확인**:
  - RED: `is_degraded()` 미존재로 컴파일 실패(E0599) 확인 완료.
  - GREEN: `cargo test --lib audit_tests::open_` → 2 passed; 0 failed; finished 0.00s.
- **회귀 테스트**: `cargo test --lib` 전체 → **289 passed; 0 failed** (1.03s).
  기존 287 + 추가 2. `build_from_connection` 시그니처 변경 후 기존 테스트 깨짐 없음 확인.
- **결과**: 인메모리 폴백(`open_fallback`) 시 `is_degraded() == true`, 파일 기반
  (`open_at`/`try_open_file`) 시 `false`임을 테스트가 보증. UI는 시작 시
  `ThreadDbState::is_degraded()`를 호출해 배너를 띄우면 됨 (UI 연동은 별도 항목).
- 커밋/수정: `thread_db.rs` struct 필드 + 메서드 + 호출부 4곳, `backend_audit_tests.rs` 테스트 2건.

### UI 연동 (2026-08-11 추가)

플래그만으로는 §2가 닫히지 않는다. 문제는 "감지 불가"가 아니라 **사용자가 모른다**는
것이었고, 호출부 없는 `is_degraded()`는 그 상태 그대로다. 그래서 끝까지 배선했다.

- `thread_db_is_degraded` Tauri 명령 (동기 — 열릴 때 고정되는 bool이라 await/lock 불필요)
- `lib.rs` 등록, `ipc.ts`에 `threadDbIsDegraded()` 래퍼
- `StorageBanner` — `ConnectionBanner` 옆, `ErrorBoundary`로 감싸 렌더
- 문구는 `t()`를 거치고 한국어 항목도 함께 추가

설계 판단 두 가지:

- **닫을 수 없게 했다.** 연결 끊김은 돌아오지만, 저장 안 되는 DB는 이미 쓴 걸
  돌려주지 않는다. 아끼는 내용을 쓰기 *전에* 알아야 한다.
- **조회 실패 시엔 침묵.** 조회가 실패한 것은 DB가 망가졌다는 증거가 아니다.
  멀쩡한 설치에 데이터 소실을 경고하는 건 이전의 침묵보다 나쁘다.

테스트 4건(`StorageBanner.test.tsx`): 폴백 시 경고, 정상 시 무표시, 조회 실패 시 무표시,
1회만 조회.

> 남은 것: 없음. 이 항목은 사용자에게 도달하는 지점까지 닫혔다.
