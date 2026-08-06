import { memo } from 'react'
import { t } from '@/lib/i18n'
import { SectionHeader, SettingsGrid } from './settings-shared'
import { DeletedThreadsRestore } from './deleted-threads-restore'

export const ArchivesSection = memo(function ArchivesSection() {
  return (
    <>
      <SectionHeader section="archives" />
      <SettingsGrid label={t('Deleted threads')} description={t('Restore or permanently remove')}>
        <DeletedThreadsRestore />
      </SettingsGrid>
    </>
  )
})
