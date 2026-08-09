# LAF Agent design system

Neutral-grey surfaces, one blue accent, generous radii, quiet borders, fixed
typography. The layout grammar follows the Claude Code desktop app: dialogs
over the workspace rather than screens that replace it, and settings as a
single column of full-width rows. Tokens live in `src/tailwind.css`;
components must consume them through Tailwind classes (`bg-background`,
`text-muted-foreground`, …), never hardcoded hex.

## Non-negotiables

- **No font-size settings, no pinch zoom.** Typography is fixed: UI 14px root
  (`html { font-size: 14px }`), chat prose 16px (`--chat-font-size`). The old
  font-slider stack and the ctrl+wheel handler are deliberately gone — the
  trackpad delivers a pinch as ctrl+wheel, so the whole UI grew and shrank on
  accidental gestures. **⌘+ / ⌘- / ⌘0 are supported** and scale the webview
  uniformly (`hooks/useZoomShortcuts.ts`); do not reintroduce anything else.
- **Hex colors only** in CSS custom properties (`oklch()` renders magenta in
  older WebKit).
- **Tailwind utilities only** — no inline `style=` for anything expressible in
  classes, no `<style>` tags.

## Color tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `#fafafa` | `#262626` | app canvas |
| `--sidebar` | `#f4f4f5` | `#1e1e1e` | sidebar column |
| `--card` / `--popover` | `#ffffff` | `#303030` | inputs, dialogs, raised surfaces |
| `--foreground` | `#1f1f1f` | `#ececec` | primary text |
| `--muted-foreground` | `#6e6e6e` | `#a1a1a1` | secondary text |
| `--primary` | `#1e90ff` | `#1e90ff` | CTAs, send, active states, ring |
| `--border` | `#e6e6e6` | white @10% | hairlines |
| `--accent` / `--muted` / `--secondary` | neutral alpha washes | neutral alpha washes | hovers, chips |

The greys are deliberately untinted: the brand blue reads as a colour cast
against warm beige, so only `--primary` carries hue. Semantic colors
(`--destructive`, `--success`, `--warning`, `--info`) are for status only —
never decoration. Categorical chart colors are `--chart-1..8`.

## Typography scale

System font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui`).

| Role | Size | Notes |
|---|---|---|
| Chat prose | 16px / 1.65 | `var(--chat-font-size)` |
| Body / controls | 13px | `text-[13px]` |
| Secondary / descriptions | 12px | `text-[12px] text-muted-foreground` |
| Captions / meta | 11px | floor — nothing below 11px |
| Dialog title | 19px / 600 | |
| Section titles | 15px / 600 | |

## Shape and depth

- `--radius: 0.75rem` (12px). Dialogs `rounded-2xl`, cards `rounded-xl`,
  controls `rounded-lg`, chips `rounded-full`.
- Depth comes from background steps (background → card → popover) and
  hairline borders, not shadows. Shadows only on floating layers (popover,
  dialog, toast): soft, large-blur, low-alpha.
- Focus: `focus-visible:ring-2 ring-ring/50` — never `outline: none` without a
  visible replacement.

## Settings surfaces

Settings is a **centered modal dialog** over the dimmed app
(`SettingsPanel.tsx`), never a full-screen takeover: a 212px nav column with
search on the left, a scrolling content column capped at 640px on the right,
and a close affordance in the corner. **Changes save themselves** — writes are
debounced ~400 ms and flushed on close. There is no save button, no cancel,
and no unsaved-changes dialog.

Inside a section, one grammar and nothing else (all from `settings-shared.tsx`):

| Primitive | Use |
|---|---|
| `SectionHeader` | page title + description, once at the top |
| `SettingsSection` | titled group; children auto-separated by hairlines |
| `SettingRow` | full-width row — label + description left, control right; `stacked` puts a wide control under the label |
| `SettingBlock` | unlabelled full-width block inside a section |
| `SegmentedOption` | one-of-N choice; active = `border-ring bg-accent` |
| `SETTINGS_INPUT_CLASS` / `SETTINGS_BUTTON_CLASS` | shared input and secondary-button shapes |
| `ConfirmDialog` | destructive confirmations |

No card boxes, no label gutter, no bespoke per-section layouts or one-off pill
styles. A control that needs more width than the row allows gets `stacked`; a
table that genuinely cannot shrink scrolls inside `overflow-x-auto`.
