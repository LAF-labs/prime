/**
 * File icon resolution using material-icon-theme.
 * Maps file names and extensions to SVG icon names from the VS Code Material Icon Theme.
 *
 * The manifest is loaded once via dynamic import and cached.
 * Until loaded, fallback icon names are used.
 */

interface IconManifest {
  fileExtensions: Record<string, string>
  fileNames: Record<string, string>
  folderNames: Record<string, string>
  folderNamesExpanded: Record<string, string>
  languageIds: Record<string, string>
  file: string
  folder: string
  folderExpanded: string
}

let manifest: IconManifest = {
  fileExtensions: {},
  fileNames: {},
  folderNames: {},
  folderNamesExpanded: {},
  languageIds: {},
  file: 'file',
  folder: 'folder',
  folderExpanded: 'folder-open',
}

let loaded = false

/** Load the manifest. Call once at app startup. */
export async function loadFileIconManifest(): Promise<void> {
  if (loaded) return
  try {
    const mod = await import('material-icon-theme/dist/material-icons.json')
    const m = mod.default ?? mod
    manifest = {
      fileExtensions: m.fileExtensions ?? {},
      fileNames: m.fileNames ?? {},
      folderNames: m.folderNames ?? {},
      folderNamesExpanded: m.folderNamesExpanded ?? {},
      languageIds: m.languageIds ?? {},
      file: m.file ?? 'file',
      folder: m.folder ?? 'folder',
      folderExpanded: m.folderExpanded ?? 'folder-open',
    }
    loaded = true
  } catch (e) {
    console.warn('[file-icons] Failed to load manifest:', e)
  }
}

// Eagerly start loading on module evaluation
loadFileIconManifest()

/**
 * Extension → VS Code language ID mapping for extensions that the
 * material-icon-theme manifest lists under `languageIds` but NOT under
 * `fileExtensions`. Without this table those extensions would fall through
 * to the generic 'file' icon.
 *
 * Only extensions that are actually missing from `fileExtensions` need to be
 * listed here — everything else is resolved directly from the manifest.
 */
const EXT_TO_LANGUAGE_ID: Record<string, string> = {
  html:  'html',
  ts:    'typescript',
  tsx:   'typescriptreact',
  js:    'javascript',
  jsx:   'javascriptreact',
  yaml:  'yaml',
  yml:   'yaml',
  php:   'php',
  cjs:   'javascript',
  mjs:   'javascript',
  mts:   'typescript',
  cts:   'typescript',
  vue:   'vue',
  svelte:'svelte',
  rb:    'ruby',
  go:    'go',
  rs:    'rust',
  java:  'java',
  kt:    'kotlin',
  swift: 'swift',
  cs:    'csharp',
  cpp:   'cpp',
  cc:    'cpp',
  c:     'c',
  h:     'c',
  hpp:   'cpp',
  lua:   'lua',
  r:     'r',
  dart:  'dart',
  ex:    'elixir',
  exs:   'elixir',
  erl:   'erlang',
  hrl:   'erlang',
  hs:    'haskell',
  scala: 'scala',
  clj:   'clojure',
  cljs:  'clojure',
  elm:   'elm',
  ml:    'ocaml',
  mli:   'ocaml',
  fs:    'fsharp',
  fsx:   'fsharp',
  pl:    'perl',
  pm:    'perl',
  groovy:'groovy',
  gradle:'groovy',
  tf:    'terraform',
  tfvars:'terraform',
  proto: 'proto',
  graphql:'graphql',
  gql:   'graphql',
  sol:   'solidity',
  zig:   'zig',
  nim:   'nim',
  cr:    'crystal',
  d:     'd',
  pas:   'pascal',
  pp:    'pascal',
  asm:   'asm',
  s:     'asm',
  bat:   'bat',
  cmd:   'bat',
  ps1:   'powershell',
  psm1:  'powershell',
  psd1:  'powershell',
  fish:  'fish',
  zsh:   'shellscript',
  bash:  'shellscript',
  sh:    'shellscript',
}

/**
 * Resolve the icon name for a given file name.
 * Checks exact file name first, then tries extensions (longest match first),
 * then falls back to the languageIds table for extensions the manifest doesn't
 * list directly in fileExtensions.
 */
export function getFileIconName(fileName: string): string {
  const lower = fileName.toLowerCase()

  // 1. Exact file name match (e.g. Dockerfile, package.json, Makefile)
  if (manifest.fileNames[lower]) return manifest.fileNames[lower]

  // 2. Try compound extensions longest-first (e.g. "spec.ts", "test.tsx")
  const parts = lower.split('.')
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join('.')
    if (manifest.fileExtensions[ext]) return manifest.fileExtensions[ext]
  }

  // 3. Language-ID fallback for extensions absent from fileExtensions
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join('.')
    const langId = EXT_TO_LANGUAGE_ID[ext]
    if (langId && manifest.languageIds[langId]) return manifest.languageIds[langId]
  }

  return manifest.file
}

/**
 * Resolve the icon name for a given folder name.
 */
export function getFolderIconName(folderName: string, isExpanded: boolean): string {
  const lower = folderName.toLowerCase()

  if (isExpanded) {
    if (manifest.folderNamesExpanded[lower]) return manifest.folderNamesExpanded[lower]
    return manifest.folderExpanded
  }

  if (manifest.folderNames[lower]) return manifest.folderNames[lower]
  return manifest.folder
}

/**
 * Get the URL path to the SVG icon file.
 * In dev, served by the Vite middleware plugin.
 * In production, icons are copied to dist/material-icons/.
 */
export function getIconPath(iconName: string): string {
  return `/material-icons/${iconName}.svg`
}
