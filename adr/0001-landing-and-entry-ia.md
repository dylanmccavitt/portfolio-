# ADR 0001 — Landing Page Concept & Entry IA

**Status:** Superseded by the agent-first Split-canvas landing — retained as 2026-06-14 architecture history
**Implements:** Issue #59
**Unblocks:** Issue #60 (nav/code wiring), Issue #62 (hiring tour)

---

## Context

The portfolio's root (`/`) previously rendered the full player library (all work). As the site matures it needs a neutral entry point that works for non-technical visitors (recruiters, hiring managers) without assuming they want to browse every project. A guided-tour route for hiring visitors (`/hiring`) has also been planned. These two additions require a clear IA and route contract before either is built.

Open question resolved here: should `/projects` remain a live route or redirect to a single canonical all-work URL?
**Decision: 301 to `/library`.**

---

## Decision

### Concierge landing (`/`)

- `/` becomes a **standalone concierge page** — centered layout, no PlayerLayout sidebar or player shell.
- Prototype reference: `~/Projects/portfolio-redesign-prototypes/17-landing-v2.html` variant E.
- Hero: **Dylan McCavitt** / **Software engineer · Backend · AI.** No career-arc or player-metaphor copy.
- Three route cards:

| Card label | Destination | Notes |
|---|---|---|
| I'm hiring | `/hiring` | Guided tour; built in #62 |
| Just exploring | `/library` | All-work player library |
| Show me the code | `https://github.com/DylanMcCavitt` | External link |

### All-work library relocation

- Today's `/` (player library, all work) **moves to `/library`** as `src/pages/library/index.astro` rendering `LibraryView filter="all"`.
- Non-`all` filter pages stay at `/library/[filter]` — no collision.
- Do **not** add `"all"` to `PLAYLIST_SLUGS`; the index page handles the all-work view directly.

### Route table

| Route | Page | Status |
|---|---|---|
| `/` | Concierge (standalone layout) | New — #60 |
| `/library` | All-work library (was `/`) | New index — #60 |
| `/library/[filter]` | Filtered playlists | Unchanged |
| `/hiring` | Guided hiring tour | New — #62 |
| `/journey` | Resume album | Unchanged |
| `/journey/[track]` | Resume track detail | Unchanged |
| `/projects` | — | 301 → `/library` |
| `/projects/[id]` | Project detail | Unchanged |

---

## Navigation reconciliation

All items below are explicit instructions for **#60**:

1. **Sidebar profile avatar** — `<a class="me" href="/">` stays as-is. After the route swap `/` is the concierge, so the avatar correctly points home. No change needed here.
2. **Sidebar "All work" filter link** — `filterHref('all')` in `Sidebar.astro` currently returns `/` when `id === 'all'`. Change the return value to `/library` so the "All work" Library entry routes to the new all-work index instead of the concierge.
3. **Mobile TabBar "Home" tab** — `href` stays `/` (concierge is the entry point); active-detection for `/library` should map to the `projects` tab, `/library/wip` to `building` (already works). Drop the `/prototype` scaffolding branch. Note: because the concierge uses a standalone layout (not PlayerLayout), TabBar does not render on `/` at all — the `path === '/'` branch in active-detection therefore becomes dead code and should be removed at the same time as the `/prototype` branch.
4. **Mobile TabBar "Projects" tab** — `href` is currently `/projects`. Change to `/library` to avoid a permanent 301 redirect hop on every mobile tap.
5. **`PlaylistMenu.astro` "All work" link** — change `href` from `/projects` to `/library`. Also remove or update the stale inline comment on that line (which currently explains why `all` pointed at `/projects` — the reasoning no longer applies once `/library` is canonical).
6. **`404.astro` "Back to the library" link** — change to `/library`.
7. **`projects/[id].astro` "Library" back-link** — change to `/library`.
8. **`src/data/resume.ts` header comment** — rename any "The Journey"/player-metaphor copy to "Resume". Also audit all remaining player-metaphor copy site-wide and rename to plain language.

---

## Redirect plan (`vercel.json`)

- **No 301 from `/`** — old `/` bookmarks intentionally land on the concierge; one click reaches `/library`.
- Update three existing redirects that currently point to `/`:

| Source | Old destination | New destination |
|---|---|---|
| `/player` | `/` | `/library` |
| `/log` | `/` | `/library` |
| `/log/:slug` | `/` | `/library` |

- **Add new redirect:**

| Source | Destination | Type |
|---|---|---|
| `/projects` | `/library` | 301 |

- All other existing `vercel.json` redirects are **unchanged**.

---

## Sitemap changes

Update `src/pages/sitemap.xml.ts` canonical path list:

- `/` — description changes to "Concierge / entry" (was "library, all work").
- Add `/library/` as a distinct canonical URL (new all-work index).
- Add `/hiring/` (new guided tour page, built in #62).
- Remove `/projects/` (it becomes a redirect; non-canonical).

---

## Layout decision

The concierge (`/`) uses a **standalone layout** — not `PlayerLayout`. `PlayerLayout` must never be rendered at `/`. If `PlayerLayout` is ever conditionally rendered at `/`, the `Sidebar` `active` prop type (`PlaylistId | 'resume'`) would need a `'home'` or `'concierge'` value — flag this for #60 if it arises.

---

## Out of scope

- Design/visual implementation of `/` concierge (belongs in #60).
- Implementation of `/hiring` tour (belongs in #62).
- Any new content or copy beyond what is specified here.
- Blog or other new routes not listed in the route table.

---

## Consequences

- **#60** owns: creating `src/pages/index.astro` (concierge), moving today's `src/pages/index.astro` to `src/pages/library/index.astro`, all nav-link updates, `vercel.json` updates, sitemap update, and the resume.ts copy rename.
- **#62** owns: creating `src/pages/hiring/index.astro` with end-of-tour CTA → `/library`; sitemap entry for `/hiring/` is noted but can be added when the page ships.
- `/projects` becomes non-canonical; the 301 ensures existing links and any search-index entries resolve to `/library`.
- The concierge layout is fully independent of the player shell; there is no shared layout dependency between `/` and `/library`.
