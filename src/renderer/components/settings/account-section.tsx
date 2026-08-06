import { memo, useCallback } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useT } from '@/lib/i18n'
import { ProviderKeyManager } from '@/components/ProviderKeyManager'
import { SectionHeader, SettingsCard, SettingsGrid } from './settings-shared'
import { WebSearchCard } from './websearch-card'

export const AccountSection = memo(function AccountSection() {
  const t = useT()
  const checkAuth = useSettingsStore((s) => s.checkAuth)

  // Re-read auth state after a key is added or removed so the header menu and
  // model picker reflect the change immediately.
  const handleChange = useCallback(() => { checkAuth() }, [checkAuth])

  return (
    <>
      <SectionHeader section="account" />
      <SettingsGrid label={t('AI providers')} description={t('API keys for the models you use. Add as many as you like.')}>
        <SettingsCard>
          <div className="py-2">
            <ProviderKeyManager onChange={handleChange} />
          </div>
        </SettingsCard>
      </SettingsGrid>

      <WebSearchCard />
    </>
  )
})
