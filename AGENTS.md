# Portfolio

Recruiter-facing portfolio (Astro + Vercel) on the agent-first redesign preview branch. The homepage is the **Signal Frost** site — a React island (`src/components/frost/FrostSite.jsx`) with no page-level canvas: a smooth landing, then Work cards whose hover reveal flashes a snapshot-fed glitch canvas (`SnapshotFx.jsx` + `glitch.js`, `?effect=off` disables the canvases). The chromatic fringe (magenta/cyan RGB split) is the accent language. **DM** is the public portfolio agent (`src/lib/dm/`, `/api/dm/chat`). `docs/agents/product-direction.md` is the sole authority for product names and for DM's public-source/privacy boundary — don't restate either elsewhere. **Eve** and the retired player shell must never be restored. `vercel.json` is the redirect authority for legacy routes.

## Environment and checks

- Node 24 required (`mise use node@24`). Local dev only — no container.
- `npm run verify` = lint + typecheck + build. `npm test` runs all suites; `.github/workflows/ci.yml` runs both and is the authoritative check set (reconciled to the Frost world in #342).
- Tests need no external services or secrets (in-memory Postgres via pglite).

## Current state (July 2026)

- `/` is Frost (single page: About/Work/Journey/Contact anchors). `/journey`, `/library`, `/contact` are meta-refresh redirects into those anchors.
- `/resume`, `/projects/[id]`, and `/404` are static Frost-styled pages (`.frost-doc` classes in `src/components/frost/frost.css`, layout `src/layouts/Frost.astro`). The legacy Three.js device stack is fully deleted.
- Homepage content comes from `src/components/frost/frost-data.js` (owner-approved copy) pending wiring to `src/data/`.
- The Frost "Ask DM" button opens a live chat panel (`src/components/frost/DmChat.jsx`, the only client of `/api/dm/chat`); the DM backend (`src/lib/dm/`, api routes, DB) is unchanged, but the DM lane's answer behavior is being replanned — its voice/conversation docs were removed. `docs/agents/product-direction.md` still owns product names and the public-source/privacy boundary.
- `prototype-lab/` is an inert frozen reference of the design exploration (own package.json, not part of the Astro build). Don't build features there.

## Gotchas

- `/api/dm/chat` returns 503 `missing_config` without a database URL plus `AI_GATEWAY_API_KEY` or `OPENAI_API_KEY`; the site and all tests work without them.
- Deployed public project reads are published-DB only and fail closed. `src/data/catalog.ts` is a migration/offline/`catalog_emergency` source only — never a runtime fallback.
- `SnapshotFx` rasterizes via SVG foreignObject: WebKit requires retina scaling through an inner `transform: scale(n)`, never SVG viewBox scaling. Text-only content — external `<img>` elements don't survive foreignObject.

## Conventions

- The homepage island must keep a complete semantic-HTML fallback (`?effect=off`, no-JS); all other routes stay complete as semantic HTML without WebGL or JS.
- Write project copy for non-technical readers — no jargon.
- No co-author lines on commits.
- GitHub issues are the tracker when work is tracked: one issue → one branch → one PR, targeting `preview/agent-first-redesign`, never `main`. (The former Gepetto contract workflow is retired; do not look for `gepetto-research` markers.)
- Review guidance: `code_review.md`.
