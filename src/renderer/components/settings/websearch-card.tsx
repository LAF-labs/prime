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
    <SettingsGrid label={t('Web search')} description={t('How the agent reads the web.')}>
      <SettingsCard>
        <div className="flex flex-col gap-3 py-2">
          <div className="flex items-start gap-2.5">
            <IconWorldSearch size={15} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div>
              <p className="text-[12px] font-medium text-foreground">{t('Built into Anthropic and OpenAI models')}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">{t('Search runs on the provider’s servers as part of the model turn — the same way Claude and Codex do it. No search API key, nothing to configure.')}</p>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <IconFileText size={15} className="mt-0.5 shrink-0 text-sky-600 dark:text-sky-400" />
            <div>
              <p className="text-[12px] font-medium text-foreground">{t('Page reading on every model')}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">{t('The web_fetch tool retrieves any URL as readable text. It works with every provider and needs no key.')}</p>
            </div>
          </div>

          <div className="flex items-start gap-2.5 rounded-lg bg-muted/30 px-3 py-2">
            <IconInfoCircle size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
            <p className="text-[11px] text-muted-foreground leading-relaxed">{t('Providers without server-side search (OpenAI-compatible endpoints, local servers) can read pages with web_fetch but cannot run open-ended web searches.')}</p>
          </div>
        </div>
      </SettingsCard>
    </SettingsGrid>
  )
})
