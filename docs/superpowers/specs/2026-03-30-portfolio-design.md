# Portfolio Site Design Spec

## Overview

Clean, recruiter-friendly portfolio site with a Cool Nordic design direction — slate, ice blue, stone grey, sharp edges, generous whitespace. Designed for non-technical visitors first.

Stack: Astro 5 + TypeScript, vanilla CSS with custom properties, vanilla JS for interactivity, Markdown/MDX for project content. No frameworks. No Tailwind. Zero client JS by default.

## Design System

### Palette (Cool Nordic)

| Token          | Value     | Usage                          |
| -------------- | --------- | ------------------------------ |
| `--bg`         | `#fafbfc` | Page background                |
| `--surface`    | `#e2e7ed` | Cards, dividers                |
| `--text`       | `#1a1f2e` | Primary text                   |
| `--text-muted` | `#6b7280` | Secondary text, captions       |
| `--accent`     | `#4a6fa5` | Links, hover states            |
| `--border`     | `#d0d5dd` | Card borders, horizontal rules |

### Typography

- **Font**: Typography Pro (downloaded/self-hosted), fallback `system-ui, -apple-system, sans-serif`
- **Weights**: 400 (body), 600 (headings)
- **No serif anywhere**

### Type Scale

CSS custom properties, mobile-first:

- Body: 16px / 1.6 line-height
- `--text-sm`: 0.875rem
- `--text-base`: 1rem
- `--text-lg`: 1.25rem
- `--text-xl`: 1.5rem
- `--text-2xl`: 2rem
- `--text-3xl`: 2.5rem

### Spacing

4px base unit via custom properties:

- `--space-1`: 4px
- `--space-2`: 8px
- `--space-3`: 12px
- `--space-4`: 16px
- `--space-5`: 24px
- `--space-6`: 32px
- `--space-7`: 48px
- `--space-8`: 64px

### Borders

- 1px solid `--border` everywhere
- Square corners — no border-radius
- No box-shadow

### Dark Mode

Not MVP. Light only.

## Site Structure

### Navigation

Sticky top bar:

- Left: "Dylan McCavitt" as wordmark, links to `/`
- Right: "Projects", "About", "Contact" — anchor links on homepage, navigation links on subpages
- Mobile: collapses to hamburger menu

### Pages

| Path                     | Description                  | Client JS |
| ------------------------ | ---------------------------- | --------- |
| `/`                      | Homepage                     | None      |
| `/projects/homelab/`     | Homelab case study           | None      |
| `/projects/bella/`       | Bella case study             | None      |
| `/projects/nohard/`      | Nohard case study            | None      |
| `/projects/work-orders/` | Work order system case study | None      |
| `/homelab/topology/`     | Interactive topology map     | Yes       |

### Footer

Minimal: GitHub, LinkedIn, email links. No copyright boilerplate.

## Homepage

### Hero

- Centered layout
- Name in large heading (600 weight, `--text-3xl`)
- One-line tagline below in muted text
- Thin horizontal rule
- "View Projects" anchor link scrolling to projects section
- Generous vertical padding — fills most of viewport on load

### Projects Section

- Section heading "Projects"
- 2-column grid of cards (single column on mobile)
- Each card: 1px border, square corners, project title only
- Whole card is a link to the project page
- Hover: border color shifts to `--accent`

### Bio Section

- 3-4 sentences, no heading
- Who you are, what you care about, what you're looking for
- Comfortable line height, generous margins

### Contact Section

- Horizontal row of text links: GitHub, LinkedIn, Email
- No icons, separated by spacing

## Project Pages

### Layout

- Single column, max-width ~680px, centered
- Same nav and footer as homepage

### Header

- Project title as h1
- One-line subtitle in muted text
- Thin horizontal rule below
- "View live site" link near top (for bella, nohard)
- "View topology map" link (for homelab)
- GitHub repo link if public

### Body Structure (Light Case Study)

1. **What it is** — 1-2 paragraphs, plain English, no jargon
2. **Why I built it** — 1 paragraph, motivation and context
3. **What I learned** — 1 paragraph, skills gained and challenges

Total: ~500-800 words per project.

### Screenshots

- Inline images between sections
- Full-width within content column
- 1px border to frame against white background

### Content Format

Markdown files with YAML frontmatter:

```yaml
title: string
subtitle: string
order: number
liveUrl: string (optional)
repoUrl: string (optional)
```

Astro content collections for type safety.

## Topology Map

### Page

- Standalone at `/homelab/topology/`
- Full-viewport SVG canvas
- Minimal chrome — back link to `/projects/homelab/` in top corner
- Nav hidden or minimal to maximize map space

### Rendering

- Vanilla JS + inline SVG, no framework
- Data structures (`entities.ts`, `layout.ts`) ported from `homelab/site/` as-is
- SVG renders server-side as static markup in Astro page
- JS hydrates interactivity on load — no layout shift

### Interactions (Progressive Enhancement)

- **Pan**: pointer drag
- **Zoom**: scroll wheel, pinch on mobile, +/- buttons
- **Click node/frame**: focus entity, animate camera, highlight related, open detail drawer
- **Click background**: reset view
- **Hover**: subtle border highlight, gentle camera nudge

### Detail Drawer

- Right-side slide-in panel on desktop, bottom sheet on mobile
- Content: entity title, kind eyebrow, summary, badges, related entities (clickable), detail sections

### View Modes

Three modes via toolbar buttons (top-left HUD):

- **Overview**: balanced physical, runtime, and policy context
- **Runtime**: emphasize Proxmox placement and hosted workloads
- **Trust**: emphasize VLAN lanes and firewall policy flows

### Controls HUD

Top-right: zoom in/out, reset view, legend (physical links, runtime placement, firewall flows).

### Color Palette

Keeps the existing dark topology palette (dark navy `#06121d` background, colored strokes per entity tone). Intentionally different from the rest of the site — immersive map experience.

### Entity Data

20+ entities across kinds: zone, edge, network, platform, runtime, service, device, client. Each has title, summary, badges, related entities, and detail sections. Data file ports directly from `homelab/site/src/data/topology/`.

### Camera System

Ported from existing React implementation:

- Constrained pan within scene bounds
- Zoom range: 1x to 2.35x
- Focus zoom: auto-scales and centers on selected entity
- Hover preview: gentle camera nudge toward hovered entity
