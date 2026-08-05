/**
 * Pre-relaunch helper — flushes all persisted state to disk, creates
 * a backup, and sets the relaunch flag so the quit confirmation dialog
 * is skipped when the process restarts.
 */
import * as historyStore from '@/lib/history-store'
import { ipc } from '@/lib/ipc'
import { useTaskStore } from '@/stores/taskStore'
import { useSettingsStore } from '@/stores/settingsStore'

/** Flush state, create backup, and set relaunch flag. Call before every relaunch(). */
export const prepareForRelaunch = async (): Promise<void> => {
  useTaskStore.getState().persistHistory()
  await historyStore.flush()
  await historyStore.createBackup(useSettingsStore.getState().settings)
  await ipc.setRelaunchFlag()
}
