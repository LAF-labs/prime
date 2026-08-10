import { t } from '@/lib/i18n'
import { useCallback, useEffect, useRef } from 'react'
import { IconUserCircle, IconArrowRight } from '@tabler/icons-react'
import type { Step } from '@/components/onboarding-shared'

/** Long enough for a full name, short enough to fit the sidebar row. */
export const MAX_DISPLAY_NAME = 40

interface OnboardingNameStepProps {
  name: string
  onNameChange: (name: string) => void
  onNext: (step: Step) => void
}

/**
 * Ask what to call the user.
 *
 * This is the only thing the wizard asks *about them* rather than about their
 * setup, and it is the value the sidebar account row shows. When the account
 * system lands, sign-up supplies the same field and this step goes away — so
 * it stays a plain local setting, with no validation beyond a length cap and
 * no requirement to answer.
 */
export const OnboardingNameStep = ({ name, onNameChange, onNext }: OnboardingNameStepProps) => {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // After the step transition paints, or focus lands mid-animation.
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])

  const goNext = useCallback(() => onNext('theme'), [onNext])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        goNext()
      }
    },
    [goNext],
  )

  const trimmed = name.trim()

  return (
    <div className="flex w-full flex-col items-center gap-8">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
        <IconUserCircle size={32} stroke={1.5} className="text-primary" />
      </div>
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">{t('What should we call you?')}</h2>
        <p className="mt-2 text-[14px] text-muted-foreground">
          {t('Just for how the app greets you. It stays on this device.')}
        </p>
      </div>

      <div className="w-full max-w-sm">
        <label htmlFor="onboarding-name" className="sr-only">{t('Your name')}</label>
        <input
          id="onboarding-name"
          ref={inputRef}
          type="text"
          value={name}
          maxLength={MAX_DISPLAY_NAME}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('Your name or nickname')}
          className="w-full rounded-xl border border-border bg-card px-4 py-3 text-center text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </div>

      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={goNext}
          className="flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-8 py-3 text-[15px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {t('Continue')} <IconArrowRight size={18} />
        </button>
        {/* Naming yourself is not a setup requirement, and a wizard that will
            not move until you fill a field is worse than an unnamed account. */}
        {!trimmed && (
          <button
            type="button"
            onClick={goNext}
            className="text-[13px] text-muted-foreground transition-colors hover:text-foreground/70"
          >
            {t('Skip for now')}
          </button>
        )}
      </div>
    </div>
  )
}
