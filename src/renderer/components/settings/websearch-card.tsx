import { memo } from 'react'
import { IconWorldSearch, IconFileText, IconInfoCircle } from '@tabler/icons-react'
import { useT } from '@/lib/i18n'
import { SettingsCard, SettingsGrid } from './settings-shared'

/**
 * Web search status.
 *
 * LAF Agent uses the same mechanism Claude and Codex do: Anthropic and OpenAI
 * run the search **server-side** inside the model turn, so there is no search
 * API key to manage — it comes with the model. Providers without a server-side
 * search tool (OpenAI-compatible third parties, local servers) can still read
 * pages through the `web_fetch` tool, which needs no key at all.
 */
export const WebSearchCard = memo(function WebSearchCard() {
  const t = useT()

  return (
    <SettingsGrid label={t('websearch.title')} description={t('websearch.desc')}>
      <SettingsCard>
        <div className="flex flex-col gap-3 py-2">
          <div className="flex items-start gap-2.5">
            <IconWorldSearch size={15} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div>
              <p className="text-[12px] font-medium text-foreground">{t('websearch.native')}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">{t('websearch.nativeDesc')}</p>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <IconFileText size={15} className="mt-0.5 shrink-0 text-sky-600 dark:text-sky-400" />
            <div>
              <p className="text-[12px] font-medium text-foreground">{t('websearch.fetch')}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">{t('websearch.fetchDesc')}</p>
            </div>
          </div>

          <div className="flex items-start gap-2.5 rounded-lg bg-muted/30 px-3 py-2">
            <IconInfoCircle size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
            <p className="text-[11px] text-muted-foreground leading-relaxed">{t('websearch.otherNote')}</p>
          </div>
        </div>
      </SettingsCard>
    </SettingsGrid>
  )
})
