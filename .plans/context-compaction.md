# Plan-Aware Context Compaction

## Summary
When context usage gets high during a planning session, the system preserves the plan across compaction and suggests switching to implement mode.

## What was built

### 1. Compaction event pipeline
- Backend already emits `compaction_status` via ACP notification `kiro.dev/compaction/status`
- Added `onCompactionStatus` IPC listener
- Added `CompactionStatus` type (`idle | compacting | completed | failed`)
- Added `updateCompactionStatus` action to taskStore that:
  - Sets `task.compactionStatus`
  - Inserts system messages for each state transition
  - When compacting starts with an active plan, injects plan steps into the system message

### 2. CompactSuggestBanner
- Shows at 80%+ context usage when in plan mode (`kiro_planner`)
- Amber warning banner with "Start building" button
- Triggers the same handoff as PlanHandoffCard (switches to `kiro_default`, sends handoff message)
- Dismissible

### 3. ContextRing compaction awareness
- Blue stroke + pulse animation during compaction
- Tooltip shows "Compacting context..." instead of percentage
- Shows "..." instead of the percentage number

### 4. Directory consolidation
- Merged `.plan/` into `.plans/` and removed `.plan/`

## Files changed
- `src/renderer/types/index.ts` — Added `CompactionStatus` type, `compactionStatus` field on `AgentTask`
- `src/renderer/lib/ipc.ts` — Added `onCompactionStatus` listener
- `src/renderer/stores/taskStore.ts` — Added `updateCompactionStatus` action, wired `unsub13` listener
- `src/renderer/components/chat/CompactSuggestBanner.tsx` — New component
- `src/renderer/components/chat/ChatPanel.tsx` — Wired banner with `isPlanMode` selector
- `src/renderer/components/chat/ContextRing.tsx` — Added `compactionStatus` prop, visual states
- `src/renderer/components/chat/ChatInput.tsx` — Reads `compactionStatus` from store, passes to ContextRing
- `.plans/diff-commit.plan` — Moved from `.plan/`
