// Audit final resolution for every extension in our table.
import m from '../node_modules/material-icon-theme/dist/material-icons.json' with { type: 'json' }
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const src = readFileSync(path.join(__dirname, '../src/renderer/lib/file-icons.ts'), 'utf-8')
const tableStart = src.indexOf('const EXTENSION_TO_LANGUAGE')
const tableEnd = src.indexOf('\n}', tableStart) + 2
const tableBody = src.slice(tableStart, tableEnd)

const entries = []
const re = /(['"]?)([\w+\-]+)\1\s*:\s*'([\w+\-]+)'/g
let match
while ((match = re.exec(tableBody)) !== null) entries.push([match[2], match[3]])

const langs = m.languageIds || {}
const exts = m.fileExtensions || {}

const unresolved = []
for (const [ext, lang] of entries) {
  // Final resolution mimicking getFileIconName()
  const directExt = exts[ext]
  const langIcon = langs[lang]
  if (!directExt && !langIcon) {
    unresolved.push({ ext, lang })
  }
}

console.log(`Audited ${entries.length} extension entries.`)
console.log()
console.log('Truly unresolved (no fileExtensions hit AND no languageIds hit):')
unresolved.forEach(({ ext, lang }) => console.log(`  .${ext} → ${lang}`))
