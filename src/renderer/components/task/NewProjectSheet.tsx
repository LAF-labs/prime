import { useEffect, useRef } from 'react'
import { useTaskStore } from '@/stores/taskStore'
import { ipc } from '@/lib/ipc'

/** Opens a folder picker and imports the selected folder as a project (no task created). */
export function NewProjectSheet() {
  const open = useTaskStore((s) => s.isNewProjectOpen)
  const setOpen = useTaskStore((s) => s.setNewProjectOpen)
  const addProject = useTaskStore((s) => s.addProject)
  const setPendingWorkspace = useTaskStore((s) => s.setPendingWorkspace)
  const didPickRef = useRef(false)

  useEffect(() => {
    if (!open || didPickRef.current) return
    didPickRef.current = true
    void ipc.pickFolder().then((folder) => {
      if (folder) { addProject(folder); setPendingWorkspace(folder) }
    }).finally(() => {
      setOpen(false)
      didPickRef.current = false
    })
  }, [open, addProject, setOpen, setPendingWorkspace])

  return null
}
