import { memo } from 'react'
import { IconInfoCircle } from '@tabler/icons-react'
import { useT } from '@/lib/i18n'
import { SettingBlock, SettingRow, SettingsSection } from './settings-shared'

/**
 * Web search status.
 *
 * LAF Agent uses the same mechanism Claude and Codex do: Anthropic, OpenAI,
 * and DeepSeek (Responses API) run the search **server-side** inside the model
 * turn, so there is no search API key to manage — it comes with the model.
 * Providers without a server-side search tool (OpenAI-compatible third
 * parties, local servers) can still read pages through the `web_fetch` tool,
 * which needs no key at all.
 */
export const WebSearchCard = memo(function WebSearchCard() {
  const t = useT()

  return (
    <SettingsSection title={t('Web search')} description={t('How the agent reads the web.')}>
      <SettingRow
        label={t('Built into Anthropic, OpenAI, and DeepSeek models')}
        description={t('Search runs on the provider’s servers as part of the model turn — the same way Claude and Codex do it. No search API key, nothing to configure.')}
      />

      <SettingRow
        label={t('Page reading on every model')}
        description={t('The web_fetch tool retrieves any URL as readable text. It works with every provider and needs no key.')}
      />

      <SettingBlock>
        <div className="flex items-start gap-2.5 rounded-lg bg-muted/40 px-3 py-2.5">
          <IconInfoCircle size={14} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-[12px] leading-relaxed text-muted-foreground">{t('Providers without server-side search (OpenAI-compatible endpoints, local servers) can read pages with web_fetch but cannot run open-ended web searches.')}</p>
        </div>
      </SettingBlock>
    </SettingsSection>
  )
})
