# LAF Agent design system

The visual language follows the Claude desktop app: warm paper neutrals, a
single clay accent, generous radii, quiet borders, fixed typography. Tokens
live in `src/tailwind.css`; components must consume them through Tailwind
classes (`bg-background`, `text-muted-foreground`, …), never hardcoded hex.

## Non-negotiables

- **No zoom, no font-size settings.** Typography is fixed: UI 14px root
  (`html { font-size: 14px }`), chat prose 16px (`--chat-font-size`). The old
  webview-zoom + font-slider stack caused the UI to grow/shrink on trackpad
  pinches and is deliberately gone. Do not reintroduce either.
- **Hex colors only** in CSS custom properties (`oklch()` renders magenta in
  older WebKit).
- **Tailwind utilities only** — no inline `style=` for anything expressible in
  classes, no `<style>` tags.

## Color tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `#faf9f5` | `#262624` | app canvas |
| `--sidebar` | `#f5f4ee` | `#1f1e1d` | sidebar column |
| `--card` | `#ffffff` | `#30302e` | cards, inputs, popovers |
| `--foreground` | `#2b2a27` | `#ecebe6` | primary text |
| `--muted-foreground` | `#73726c` | `#a6a39a` | secondary text |
| `--primary` | `#c96442` | `#d97757` | CTAs, send, active states, ring |
| `--border` | `#e8e6dc` | warm white @10% | hairlines |
| `--accent` / `--muted` / `--secondary` | warm alpha washes | warm alpha washes | hovers, chips |

Semantic colors (`--destructive`, `--success`, `--warning`, `--info`) are for
status only — never decoration. The old blue (`#3b82f6`) and violet accents
are retired; anything still blue/violet that isn't an info-status element
should move to `primary` or neutral tokens.

## Typography scale

System font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui`).

| Role | Size | Notes |
|---|---|---|
| Chat prose | 16px / 1.65 | `var(--chat-font-size)` |
| Body / controls | 13–14px | `text-[13px]` or `text-sm` |
| Secondary / descriptions | 12px | `text-[12px] text-muted-foreground` |
| Captions / meta | 11px | floor — nothing below 11px |
| Section titles | 14–15px / 600 | |

Avoid the 10px/10.5px micro-text the old UI used; bump to 11px minimum.

## Shape and depth

- `--radius: 0.75rem` (12px). Cards/dialogs `rounded-xl`–`rounded-2xl`,
  controls `rounded-lg`, chips `rounded-full`.
- Depth comes from background steps (background → card → popover) and
  hairline borders, not shadows. Shadows only on floating layers (popover,
  dialog, toast): soft, large-blur, low-alpha.
- Focus: `focus-visible:ring-2 ring-ring/50` — never `outline: none` without a
  visible replacement.

## Settings surfaces

One pattern for every section: `SettingsGrid` (label column + content) →
`SettingsCard` → `SettingRow` (label + description left, control right) with
`Divider` between rows. Controls are the shared primitives (`Switch`,
`Input`, segmented button groups). Segmented choices use the
active = `bg-accent text-foreground border-ring`, inactive = muted pattern.
No bespoke per-section layouts, chips, or one-off pill styles.
