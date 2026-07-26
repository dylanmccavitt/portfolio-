# Portfolio

Recruiter-facing portfolio (Astro + Vercel) on the agent-first redesign preview branch. The homepage is the **Signal Frost** site — a React island (`src/components/frost/FrostSite.jsx`) with an HTML-in-canvas shatter/heal surface (`src/components/frost/Shatter.jsx`: native → snapshot → semantic renderer tiers, `?effect=off|snapshot` switch). **DM** is the public portfolio agent (`src/lib/dm/`, `/api/dm/chat`). `docs/agents/product-direction.md` is the sole authority for product names and for DM's public-source/privacy boundary — don't restate either elsewhere. **Eve** and the retired player shell must never be restored. `vercel.json` is the redirect authority for legacy routes.

## Environment and checks

- Node 24 required (`mise use node@24`). Local dev only — no container.
- `npm run verify` = lint + typecheck + build. `npm run build` is the trustworthy gate today; `test:routes` and `test:visual` still assert the removed device-shell world and need reconciling before CI is authoritative again.
- Tests need no external services or secrets (in-memory Postgres via pglite).

## Current state (July 2026)

- `/` is Frost (single page: About/Work/Journey/Contact anchors). `/journey`, `/library`, `/contact` are meta-refresh redirects into those anchors.
- `/resume`, `/projects/[id]`, and `/404` still render through `Editorial.astro` → `Device.astro` (the legacy Three.js shell). Retiring that stack is pending their Frost restyle — don't delete it while those routes depend on it.
- Homepage content comes from `src/components/frost/frost-data.js` (owner-approved copy) pending wiring to `src/data/`.
- The Frost "Ask DM" button is a stub; the DM backend is live and unchanged.
- `prototype-lab/` is an inert frozen reference of the design exploration (own package.json, not part of the Astro build). Don't build features there.

## Gotchas

- `/api/dm/chat` returns 503 `missing_config` without a database URL plus `AI_GATEWAY_API_KEY` or `OPENAI_API_KEY`; the site and all tests work without them.
- Deployed public project reads are published-DB only and fail closed. `src/data/catalog.ts` is a migration/offline/`catalog_emergency` source only — never a runtime fallback.
- The legacy Three.js device renderer adapts shaders under MIT + Commons Clause — read `docs/licenses/canvas-ui.md` before copying or redistributing that code.
- Shatter's snapshot tier rasterizes via SVG foreignObject: WebKit requires retina scaling through an inner `transform: scale(n)`, never SVG viewBox scaling.

## Conventions

- The homepage island must keep a complete semantic-HTML fallback (`?effect=off`, no-JS); legacy routes stay complete as semantic HTML without WebGL or JS.
- Write project copy for non-technical readers — no jargon.
- No co-author lines on commits.
- GitHub issues are the tracker when work is tracked: one issue → one branch → one PR, targeting `preview/agent-first-redesign`, never `main`. (The former Gepetto contract workflow is retired; do not look for `gepetto-research` markers.)
- Review guidance: `code_review.md`.
