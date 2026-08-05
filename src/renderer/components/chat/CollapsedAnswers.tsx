import { memo, useState } from 'react'
import { IconChevronDown, IconChevronRight, IconMessageCircleQuestion } from '@tabler/icons-react'

interface QuestionAnswer {
  question: string
  answer: string
}

interface CollapsedAnswersProps {
  questionAnswers: QuestionAnswer[]
}

export const CollapsedAnswers = memo(function CollapsedAnswers({ questionAnswers }: CollapsedAnswersProps) {
  const [expanded, setExpanded] = useState(true)
  if (!questionAnswers.length) return null
  return (
    <div className="rounded-xl border border-primary/15 bg-primary/[0.03]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-primary/[0.04]"
      >
        {expanded
          ? <IconChevronDown className="size-4 shrink-0 text-primary" />
          : <IconChevronRight className="size-4 shrink-0 text-primary" />}
        <IconMessageCircleQuestion className="size-4 shrink-0 text-primary" />
        <span className="text-[14px] font-semibold text-primary">
          Answered {questionAnswers.length} question{questionAnswers.length > 1 ? 's' : ''}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-primary/10 px-4 py-3 space-y-3">
          {questionAnswers.map((qa, i) => (
            <div key={i} className="space-y-0.5">
              <p className="break-words text-[15px] font-medium leading-relaxed text-foreground/80">{qa.question}</p>
              <p className="break-words text-[14px] leading-relaxed text-primary">{qa.answer}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
