# Portfolio

Recruiter-facing portfolio (Astro + Vercel) on the agent-first redesign preview branch. The homepage is the **Signal Frost** site — a React island (`src/components/frost/FrostSite.jsx`) with no page-level canvas: a smooth landing, then Work cards whose hover reveal flashes a snapshot-fed glitch canvas (`SnapshotFx.jsx` + `glitch.js`, `?effect=off` disables the canvases). The chromatic fringe (magenta/cyan RGB split) is the accent language. **DM** (the public portfolio agent) is being rebuilt from scratch — the backend and `/api` routes were torn down in #352; the Ask DM button opens a "being rebuilt" panel with a mailto link. `docs/agents/product-direction.md` is the sole authority for product names and for DM's public-source/privacy boundary — don't restate either elsewhere. **Eve** and the retired player shell must never be restored. `vercel.json` is the redirect authority for legacy routes.

## Environment and checks

- Node 24 required (`mise use node@24`). Local dev only — no container.
- `npm run verify` = lint + typecheck + build. `npm test` runs all suites; `.github/workflows/ci.yml` runs both and is the authoritative check set.
- No database, no external services, no secrets — the site and all tests run from the repo alone.

## Current state (July 2026)

- `/` is Frost (single page: About/Work/Journey/Contact anchors). `/journey`, `/library`, `/contact` are meta-refresh redirects into those anchors.
- `/resume`, `/projects/[id]`, and `/404` are static Frost-styled pages (`.frost-doc` classes in `src/components/frost/frost.css`, layout `src/layouts/Frost.astro`). Every page prerenders — the whole site is static output.
- **`src/data/catalog.ts` is the single content source** (6 projects; each `about` is exactly [problem, approach, outcome]). `src/lib/projects/read-models.ts` converts catalog entries to the read models pages consume via `src/lib/public-projects.ts`. `WORK_ORDER` in `src/components/frost/frost-data.js` pins the homepage card order; `PROFILE`/`JOURNEY` live there too.
- `src/data/profile.ts` holds the owner-approved public profile entries (with their schema) for the DM rework to consume.
- `prototype-lab/` is an inert frozen reference of the design exploration (own package.json, not part of the Astro build). Don't build features there.

## Gotchas

- `SnapshotFx` rasterizes via SVG foreignObject: WebKit requires retina scaling through an inner `transform: scale(n)`, never SVG viewBox scaling. Text-only content — external `<img>` elements don't survive foreignObject.
- Touch reveal on the Work cards resolves the tapped card from coordinates, never `event.target` (iOS retargets taps on pointer-events-none layers); the burst honors `prefers-reduced-motion`.

## Conventions

- The homepage island must keep a complete semantic-HTML fallback (`?effect=off`, no-JS); all other routes stay complete as semantic HTML without WebGL or JS.
- Write project copy for non-technical readers — no jargon.
- No co-author lines on commits.
- GitHub issues are the tracker when work is tracked: one issue → one branch → one PR, targeting `preview/agent-first-redesign`, never `main`. (The former Gepetto contract workflow is retired; do not look for `gepetto-research` markers.)
- Review guidance: `code_review.md`.
