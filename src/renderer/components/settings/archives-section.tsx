import { memo } from 'react'
import { t } from '@/lib/i18n'
import { SectionHeader, SettingsSection, SettingBlock } from './settings-shared'
import { DeletedThreadsRestore } from './deleted-threads-restore'

export const ArchivesSection = memo(function ArchivesSection() {
  return (
    <>
      <SectionHeader section="archives" />
      <SettingsSection title={t('Deleted threads')} description={t('Restore or permanently remove')}>
        <SettingBlock>
          <DeletedThreadsRestore />
        </SettingBlock>
      </SettingsSection>
    </>
  )
})
