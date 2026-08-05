import { memo, useState, useCallback, useEffect } from "react";
import { IconChevronLeft, IconChevronRight, IconCornerDownLeft, IconMessageCircleQuestion, IconCircleCheckFilled, IconCircle } from "@tabler/icons-react";
import { useTaskStore } from "@/stores/taskStore";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { parseQuestions } from "@/lib/question-parser";

export const QuestionCards = memo(function QuestionCards({
  text,
  taskId: taskIdProp,
}: {
  text: string;
  taskId?: string | null;
}) {
  const blocks = parseQuestions(text);
  const [page, setPage] = useState(0);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [extraText, setExtraText] = useState<Record<string, string>>({});
  const [dismissed, setDismissed] = useState(false);

  const total = blocks.length;
  const current = blocks[page];

  const handleSelect = useCallback((questionNum: string, letter: string) => {
    setSelections((prev) =>
      prev[questionNum] === letter
        ? (() => {
            const next = { ...prev };
            delete next[questionNum];
            return next;
          })()
        : { ...prev, [questionNum]: letter },
    );
  }, []);

  const isAllAnswered = blocks.every((b) => selections[b.number] || b.options.length === 0);
  const currentExtra = current ? (extraText[current.number] ?? '') : ''
  const hasAnyInput =
    Object.keys(selections).length > 0 || Object.values(extraText).some((v) => v.trim().length > 0);
  const isLastPage = page === total - 1

  const handleContinue = useCallback(() => {
    if (!isLastPage && !isAllAnswered) {
      const nextUnanswered = blocks.findIndex(
        (b, i) => i > page && !selections[b.number] && b.options.length > 0,
      );
      if (nextUnanswered >= 0) {
        setPage(nextUnanswered);
        return;
      }
      setPage(total - 1);
      return;
    }
    if (!isAllAnswered) return;
    const state = useTaskStore.getState();
    const id = taskIdProp ?? state.selectedTaskId;
    const task = id ? state.tasks[id] : null;
    if (!task || task.status === "running" || task.status === "cancelled")
      return;
    const parts: string[] = [];
    for (const block of blocks) {
      const sel = selections[block.number];
      const extra = (extraText[block.number] ?? '').trim();
      if (sel && extra) {
        parts.push(`${block.number}=${sel}, ${extra}`);
      } else if (sel) {
        parts.push(`${block.number}=${sel}`);
      } else if (extra) {
        parts.push(`${block.number}=${extra}`);
      }
    }
    if (parts.length === 0) return;
    const msg = parts.join(", ");
    const questionAnswers = blocks
      .filter((b) => selections[b.number] || (extraText[b.number] ?? '').trim())
      .map((b) => {
        const sel = selections[b.number]
        const extra = (extraText[b.number] ?? '').trim()
        const opt = b.options.find((o) => o.letter === sel)
        const answer = [opt?.text ?? sel, extra].filter(Boolean).join(', ')
        return { question: b.question, answer }
      })
    const userMsg = {
      role: "user" as const,
      content: msg,
      timestamp: new Date().toISOString(),
      questionAnswers,
    };
    state.upsertTask({
      ...task,
      status: "running",
      messages: [...task.messages, userMsg],
    });
    state.clearTurn(task.id);
    ipc.sendMessage(task.id, msg);
    setDismissed(true);
  }, [blocks, selections, extraText, isAllAnswered, isLastPage, total, page]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (dismissed || total === 0) return;
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditable = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
      if (isEditable) return;
      if (e.key === "Escape") {
        e.preventDefault();
        handleDismiss();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        const canSubmit = isAllAnswered || (!isLastPage && hasAnyInput);
        if (!canSubmit) return;
        e.preventDefault();
        handleContinue();
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setPage((p) => Math.max(0, p - 1));
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setPage((p) => Math.min(total - 1, p + 1));
        return;
      }
      if (current?.options.length) {
        const idx = e.key.charCodeAt(0) - 97;
        if (idx >= 0 && idx < current.options.length) {
          handleSelect(current.number, current.options[idx].letter);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    dismissed,
    total,
    current,
    selections,
    handleDismiss,
    handleContinue,
    handleSelect,
    isAllAnswered,
    isLastPage,
    hasAnyInput,
  ]);

  if (blocks.length === 0 || dismissed) return null;

  const selectedCount = Object.keys(selections).length;
  const canSubmit = isAllAnswered || isLastPage ? isAllAnswered : hasAnyInput;

  return (
    <div className="my-4 overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-b from-primary/[0.04] to-transparent shadow-sm">
      {/* Accent header bar */}
      <div className="flex items-center gap-2 border-b border-primary/10 bg-primary/[0.06] px-5 py-2.5">
        <IconMessageCircleQuestion className="size-4 text-primary" />
        <span className="text-[12px] font-semibold tracking-wide text-primary">
          {total > 1 ? `Question ${page + 1} of ${total}` : 'Question'}
        </span>

        {/* Step dots for multi-question */}
        {total > 1 && (
          <div className="ml-auto flex items-center gap-1.5">
            {blocks.map((b, i) => {
              const isAnswered = !!selections[b.number];
              const isCurrent = i === page;
              return (
                <button
                  key={b.number}
                  type="button"
                  onClick={() => setPage(i)}
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full text-[10px] font-bold transition-all",
                    isCurrent
                      ? "bg-primary text-primary-foreground scale-110"
                      : isAnswered
                        ? "bg-primary/20 text-primary"
                        : "bg-muted text-muted-foreground hover:bg-muted/80",
                  )}
                  aria-label={`Go to question ${i + 1}`}
                >
                  {isAnswered && !isCurrent ? (
                    <IconCircleCheckFilled className="size-3.5" />
                  ) : (
                    <span>{i + 1}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Question text */}
      <div className="px-5 pt-4 pb-3">
        <p className="text-[15px] font-medium leading-relaxed text-foreground">
          {current?.question}
        </p>
      </div>

      {/* Options */}
      {current?.options.length > 0 && (
        <div className="flex flex-col gap-1.5 px-4 pb-3">
          {current.options.map((opt) => {
            const isSelected = selections[current.number] === opt.letter;
            return (
              <button
                key={opt.letter}
                type="button"
                onClick={() => handleSelect(current.number, opt.letter)}
                className={cn(
                  "group flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all",
                  isSelected
                    ? "border-primary/40 bg-primary/10 shadow-sm"
                    : "border-border/40 bg-background/50 hover:border-primary/25 hover:bg-primary/[0.03]",
                )}
              >
                {/* Radio indicator */}
                <span className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-all",
                  isSelected
                    ? "border-primary bg-primary"
                    : "border-muted-foreground/25 group-hover:border-primary/40",
                )}>
                  {isSelected && (
                    <span className="size-2 rounded-full bg-primary-foreground" />
                  )}
                </span>

                <div className="flex flex-1 items-baseline gap-2">
                  <kbd className={cn(
                    "shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-semibold transition-all",
                    isSelected
                      ? "bg-primary/15 text-primary"
                      : "bg-muted/50 text-muted-foreground group-hover:text-muted-foreground",
                  )}>
                    {opt.letter}
                  </kbd>
                  <span className={cn(
                    "text-[13px] leading-snug transition-colors",
                    isSelected ? "font-medium text-foreground" : "text-foreground/75",
                  )}>
                    {opt.text}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Extra text input */}
      <div className="px-5 pb-4">
        <input
          type="text"
          value={currentExtra}
          onChange={(e) => setExtraText((prev) => ({ ...prev, [current?.number ?? '']: e.target.value }))}
          placeholder="Add extra context (optional)"
          className="w-full rounded-xl border border-border/40 bg-background/60 px-3.5 py-2.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/30 focus:ring-1 focus:ring-primary/10"
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-primary/10 bg-primary/[0.02] px-5 py-3">
        <div className="flex items-center gap-3">
          {selectedCount > 0 && total > 1 && (
            <span className="text-[11px] text-muted-foreground">
              {selectedCount}/{total} answered
            </span>
          )}
          <button
            type="button"
            onClick={handleDismiss}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Dismiss
            <kbd className="rounded-sm bg-muted/40 px-1 py-0.5 text-[10px] font-medium">
              esc
            </kbd>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Prev/Next arrows for multi-question */}
          {total > 1 && (
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-lg p-1.5 text-muted-foreground/80 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-20"
                aria-label="Previous question"
              >
                <IconChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(total - 1, p + 1))}
                disabled={isLastPage}
                className="rounded-lg p-1.5 text-muted-foreground/80 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-20"
                aria-label="Next question"
              >
                <IconChevronRight className="size-4" />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={handleContinue}
            disabled={!canSubmit}
            className={cn(
              "flex items-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-medium transition-all",
              canSubmit
                ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:scale-[0.98]"
                : "bg-muted text-muted-foreground cursor-not-allowed",
            )}
          >
            {isAllAnswered || isLastPage ? "Submit" : "Next"}
            <IconCornerDownLeft className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
});
