// Dev-only entry for /graph-preview.html — the knowledge graph against the
// mock notes, with no Tauri anywhere in the import graph. See the HTML file
// for why this exists.
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { KnowledgeGraph } from '@/components/knowledge/KnowledgeGraph'
import type { KnowledgeNote } from '@/lib/ipc'
import mock from './mock-knowledge.json'
import './../tailwind.css'

const notes = mock as KnowledgeNote[]

const Preview = () => {
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2 text-[13px]">
        <strong>graph-preview</strong>
        <span className="text-muted-foreground">{notes.length} notes · selected: {selected ?? '—'}</span>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-0.5 hover:bg-accent"
          onClick={() => document.documentElement.classList.toggle('dark')}
        >
          toggle dark
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <KnowledgeGraph notes={notes} selected={selected} onSelect={setSelected} />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Preview />)
