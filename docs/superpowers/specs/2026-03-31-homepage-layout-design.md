# Homepage Layout + Section Styling Design Spec

## Overview

Update the homepage layout: reorder sections, add terminal-style project listing, style section headings with bracket syntax and nav-swatch colors, darken Nord background to match all-dark theme direction, reduce palette strip shadow.

## Nord Background Change

Nord `--bg` changes from `#d8dee9` (light) to `#3b4252` (dark surface). This makes Nord consistently dark like the other 6 themes. Update `--surface`, `--text`, `--text-muted`, `--border` to work on the dark background.

Updated Nord values:

```css
--bg: #3b4252;
--surface: #434c5e;
--text: #d8dee9;
--text-muted: #a0aec0;
--accent: #88c0d0;
--border: #4c566a;
```

The `:root` fallback in `themes.css` must also update to match.

## Section Headings

All section headings use double-bracket syntax: `[[about]]`, `[[projects]]`, `[[contact]]`.

- Rendered as `<h2>` elements
- Colored to match the corresponding nav swatch color
- Reduced opacity (0.7) for subtlety
- Lowercase text
- Font: inherits monospace body font

Heading-to-nav color mapping:

- `[[projects]]` → `var(--nav-1)` (matches Projects swatch)
- `[[about]]` → `var(--nav-2)` (matches About swatch)
- `[[contact]]` → `var(--nav-3)` (matches Contact swatch)

## Page Order

Top to bottom:

1. Header — `[Dylan McCavitt]`
2. Palette nav — centered strip + `[/theme]`
3. `[[about]]` section
4. `[[projects]]` section
5. `[[contact]]` section
6. Footer

## Projects Section — Terminal Directory Listing

Projects render as a terminal-style directory listing, not cards or a grid.

Structure per project:

```
> project-name/  — short description
```

- `>` chevron in `var(--accent)` or a muted blue
- Project name styled as a directory (trailing `/`), colored per theme nav colors, wrapped in an `<a>` tag linking to the project page
- Dashed underline on the link at low opacity
- Description after `—` em dash, in `var(--text-muted)`
- Line height generous (~2.2–2.4) for readability
- Max-width constrained (~600px), centered

Project color assignments (using nav swatch colors for variety):

- homelab/ → `var(--nav-1)`
- bella/ → `var(--nav-2)`
- nohard/ → `var(--nav-3)`
- work-orders/ → `var(--nav-4)`

## Palette Strip Shadow

Reduce from `0 2px 12px rgba(0,0,0,0.15)` to `0 1px 4px rgba(0,0,0,0.1)` — barely there, just enough depth to separate from the dark background.

## What Changes

### Modified

- `src/styles/themes.css` — update Nord `[data-theme="nord"]` and `:root` fallback with dark bg values
- `src/pages/index.astro` — reorder sections (about above projects), replace project grid with terminal listing, update section headings to `[[bracket]]` syntax with nav-swatch colors
- `src/styles/components.css` — update `.palette-nav__strip` box-shadow, remove `.project-card` styles (no longer used on homepage)
- `src/components/ProjectCard.astro` — keep file (may be used elsewhere), but homepage no longer uses it

### Not Changed

- Other theme definitions (Dracula, Rosé Pine, etc.) — already dark
- Header, PaletteNav, Footer components
- Project detail pages, resume page, topology page
