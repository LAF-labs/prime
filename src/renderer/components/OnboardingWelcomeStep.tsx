import { IconStack2, IconArrowRight } from '@tabler/icons-react'
import { FEATURES, type Step } from '@/components/onboarding-shared'

interface OnboardingWelcomeStepProps {
  onNext: (step: Step) => void
}

export const OnboardingWelcomeStep = ({ onNext }: OnboardingWelcomeStepProps) => (
  <>
    <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10">
      <IconStack2 size={40} stroke={1.5} className="text-primary" />
    </div>
    <div>
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Welcome to Kirodex</h1>
      <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
        A native desktop client for Kiro; the AI-powered coding assistant.
      </p>
    </div>
    <div className="flex flex-col gap-3 text-left text-[14px] text-muted-foreground">
      {FEATURES.map(({ Icon, text }) => (
        <div key={text} className="flex items-center gap-3">
          <Icon size={20} stroke={1.5} className="text-muted-foreground" />
          <span>{text}</span>
        </div>
      ))}
    </div>
    <button
      type="button"
      onClick={() => onNext('theme')}
      className="flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-8 py-3 text-[15px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
    >
      Get Started <IconArrowRight size={18} />
    </button>
  </>
)
