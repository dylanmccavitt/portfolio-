# Palette Nav + Theme Switcher Design Spec

## Overview

Replace the current sticky top-bar navigation and color scheme with a centered palette-strip nav and a multi-theme system. The nav links render as equal-width color swatches from the active theme. Users can switch the entire site's palette via a `[/theme]` dropdown.

Font: Google Sans Code (monospace) sitewide — already applied.

## Palette Nav

### Layout

- **Header**: `[Dylan McCavitt]` top-left, monospace, links to `/`. No other elements in the header bar.
- **Palette strip**: Centered horizontally on the page, positioned in the hero area (not sticky, not a top bar).
- **`[/theme]` toggle**: Sits directly above the left edge of the palette strip. Styled as monospace text in brackets, matching the `[Dylan McCavitt]` aesthetic.

### Swatches

Five equal-width swatches in a rounded strip with subtle box-shadow:

| Position | Label    | Link target                                   |
| -------- | -------- | --------------------------------------------- |
| 1        | Projects | `/#projects`                                  |
| 2        | About    | `/#about`                                     |
| 3        | Contact  | `/#contact`                                   |
| 4        | Resume   | `/resume/`                                    |
| 5        | GitHub   | `https://github.com/DylanMcCavitt` (external) |

Each swatch:

- Equal width (flex: 1, or fixed equal widths)
- Background color from the active theme's `nav` palette (5 colors per theme)
- Text: uppercase, monospace, small (11px), letter-spaced
- Text color: dark or light depending on swatch contrast (defined per theme)

### Mobile

- Strip stacks vertically or shrinks to fit
- Swatches become full-width rows
- `[/theme]` stays above the strip

## Theme System

### Architecture

Themes are defined as CSS custom property sets on `[data-theme="<name>"]` selectors. The active theme is stored in `localStorage` and applied as a data attribute on `<html>`.

A single `themes.css` file contains all theme definitions. A small vanilla JS script (`theme-switcher.js`) handles:

1. Read `localStorage` on page load, apply `data-theme` before first paint (inline script in `<head>` to prevent flash)
2. Toggle dropdown open/close on `[/theme]` click
3. On theme selection: update `data-theme`, save to `localStorage`, close dropdown

### CSS Custom Properties Per Theme

Each theme defines:

```css
[data-theme="nord"] {
  --bg: #d8dee9;
  --surface: #c8d0dc;
  --text: #2e3440;
  --text-muted: #4c566a;
  --accent: #5e81ac;
  --border: #b8c2d0;

  /* Nav swatch colors (1-5) */
  --nav-1: #8fbcbb;
  --nav-2: #88c0d0;
  --nav-3: #81a1c1;
  --nav-4: #5e81ac;
  --nav-5: #4c566a;

  /* Text color on each swatch */
  --nav-text-1: #2e3440;
  --nav-text-2: #2e3440;
  --nav-text-3: #2e3440;
  --nav-text-4: #eceff4;
  --nav-text-5: #eceff4;
}
```

### Themes

7 themes total:

| Theme      | Background | Nav colors (signature)               |
| ---------- | ---------- | ------------------------------------ |
| Nord       | `#d8dee9`  | Frost blues → Polar Night            |
| Dracula    | `#44475a`  | Purple, cyan, green, pink, dark      |
| Rosé Pine  | `#1f1d2e`  | Rose, gold, iris, foam, muted        |
| Gruvbox    | `#282828`  | Red, yellow, aqua, blue, dark        |
| Everforest | `#2d353b`  | Green, yellow, cyan, pink, dark      |
| Night Owl  | `#011627`  | Purple, blue, green, orange, dark    |
| Dark+      | `#1e1e1e`  | Blue, teal, light blue, orange, dark |

Nord is the default. All others are dark themes.

### Theme Dropdown

- Triggered by clicking `[/theme]`
- Dark background (`#2e3440` or similar), rounded corners, shadow
- Each row: mini color swatch preview (4 small squares) + theme name
- Active theme has a checkmark
- Click outside or select a theme to close
- Dropdown appears directly below `[/theme]`, left-aligned

## Resume Page

- New page at `/resume/`
- Full resume content rendered on-page (not just a PDF embed)
- PDF download link at the bottom
- Styled with the active theme
- Content TBD — will be populated separately

## What Changes

### Removed

- Sticky top-bar header with wordmark left / links right
- Current header component (`Header.astro`) — replaced entirely
- Old `--bg` / palette values in `global.css` `:root`

### Added

- `src/components/PaletteNav.astro` — the centered palette strip + `[/theme]` button
- `src/components/ThemeDropdown.astro` — dropdown markup
- `src/styles/themes.css` — all 7 theme definitions
- `src/scripts/theme-switcher.ts` — localStorage read/write, dropdown toggle, theme apply
- Inline `<script>` in `Base.astro` `<head>` for flash-prevention (reads localStorage, sets `data-theme` before render)
- `src/pages/resume.astro` — resume page (content placeholder initially)

### Modified

- `src/layouts/Base.astro` — import themes.css, add flash-prevention script, update header slot
- `src/styles/global.css` — `:root` becomes the Nord fallback, all color tokens reference theme variables
- `src/pages/index.astro` — hero section restructured: `[Dylan McCavitt]` header, palette nav centered, hero content below
- `src/styles/components.css` — header styles replaced with palette nav styles

## Constraints

- Zero framework JS. Vanilla only.
- Theme switch must not cause a flash on page load (inline script in `<head>`).
- All theme colors must maintain WCAG AA contrast for text readability.
- Palette strip must be responsive — stacks or adapts on mobile.
- `localStorage` only — no cookies, no server state.
