# Portfolio

Recruiter-facing portfolio (Astro + Vercel) on the agent-first redesign preview branch. The homepage is the **Signal Frost** site — a React island (`src/components/frost/FrostSite.jsx`) with no page-level canvas: a smooth landing, then Work cards whose hover reveal flashes a snapshot-fed glitch canvas (`SnapshotFx.jsx` + `glitch.js`, `?effect=off` disables the canvases). The chromatic fringe (magenta/cyan RGB split) is the accent language. **DM** (the public portfolio agent) is being rebuilt from scratch — the backend and `/api` routes were torn down in #352; the Ask DM button opens a "being rebuilt" panel with a mailto link. `docs/agents/product-direction.md` is the sole authority for product names and for DM's public-source/privacy boundary — don't restate either elsewhere. **Eve** and the retired player shell must never be restored. `vercel.json` is the redirect authority for legacy routes.

## Environment and checks

- Node 24 required (`mise use node@24`). Local dev only — no container.
- `npm run verify` = lint + typecheck + build. `npm test` runs all suites; `.github/workflows/ci.yml` runs both and is the authoritative check set.
- `npm run dm:corpus [path]` writes the DM grounding corpus for the service repo. Use `npm run --silent` when piping — npm's banner goes to stdout.
- No database, no external services, no secrets — the site and all tests run from the repo alone.

## Current state (July 2026)

- `/` is Frost (single page: About/Work/Journey/Contact anchors). `/journey`, `/library`, `/contact` are meta-refresh redirects into those anchors.
- `/resume`, `/projects/[id]`, and `/404` are static Frost-styled pages (`.frost-doc` classes in `src/components/frost/frost.css`, layout `src/layouts/Frost.astro`). Every page prerenders — the whole site is static output.
- **`src/data/catalog.ts` is the single content source** (8 projects; each `about` is exactly [problem, approach, outcome]). `src/lib/projects/read-models.ts` converts catalog entries to the read models pages consume via `src/lib/public-projects.ts`. `WORK_ORDER` in `src/components/frost/frost-data.js` pins the homepage card order; `PROFILE`/`JOURNEY` live there too.
- `src/data/profile.ts` holds the owner-approved public profile entries (with their schema) for the DM rework to consume.
- **The DM grounding corpus has no public URL and never reaches a browser.** `src/lib/dm/corpus.ts` builds it from catalog read models, `profile.ts`, and `resume.ts`; `npm run dm:corpus [path]` (`scripts/dm-corpus.ts`, a thin wrapper) is the only way it leaves the repo, and the owner commits that snapshot into the DM service's own deployment. `tests/dm-corpus.test.ts` is its fail-closed key allowlist (adding a published field means bumping `DM_CORPUS_VERSION` on purpose) and also fails any page or component that imports the builder.
- What the browser gets instead is `src/lib/dm/page-manifest.ts` — anchors, project ids, action verbs, all already in the homepage HTML — passed to `FrostSite` as the `dmManifest` prop from `src/pages/index.astro`. Keep it separate from `corpus.ts` so a page can import it without pulling the profile or timeline into the build graph.
- DM's browser surface is the corner card (`src/components/frost/DmCard.jsx` + `dm-client.js`). It appears **only** when `PUBLIC_DM_ENDPOINT` is set at build time; unset (the default) keeps the "being rebuilt" panel exactly as it is. The card streams SSE from `{endpoint}/chat` and drives the page with four actions — `go` (anchor), `lit` (Work card), `open` (project page), `litContact`. `dm-client.js` is the security boundary: an action is dropped unless its type is one of those four *and* its target is in the manifest's `anchors`/`projectIds`; citation chips are matched against the Work cards' own project names, never supplied by the model. `tests/dm-client.test.ts` pins all of it against a live SSE stub.
- `PUBLIC_RESUME_TRACK_IDS` in `src/data/resume.ts` is the one door anything public reads the career timeline through — the resume page, the `/og/journey/*` images, the homepage Journey (`src/lib/journey.ts`), and the corpus. `JOURNEY_LABELS` in `frost-data.js` is display copy only and cannot add a row; `tests/journey.test.ts` holds that down. Don't add a second career list.
- `prototype-lab/` is an inert frozen reference of the design exploration (own package.json, not part of the Astro build). Don't build features there.

## Gotchas

- `SnapshotFx` rasterizes via SVG foreignObject: WebKit requires retina scaling through an inner `transform: scale(n)`, never SVG viewBox scaling. Text-only content — external `<img>` elements don't survive foreignObject.
- Touch reveal on the Work cards resolves the tapped card from coordinates, never `event.target` (iOS retargets taps on pointer-events-none layers); the burst honors `prefers-reduced-motion`.
- `resolveDmEndpoint` accepts `https:` only, plus loopback over `http:` for local dev — a misconfigured cleartext endpoint degrades to "no service", not to a cleartext request.

## Deploying the DM service (owner's calls, not a code change)

Nothing in the repo turns DM on. When the owner deploys the service, all of these must change together, or the card fails in ways that look like bugs:

1. Set `PUBLIC_DM_ENDPOINT` to the service's `https://` origin at build time. Unset (the default) keeps the "being rebuilt" panel and sends nothing anywhere.
2. Add that origin to `connect-src` in `vercel.json`'s CSP. It is `connect-src 'self'` today, which **blocks** the card's POST to any cross-origin service — the request never leaves the browser and the card reports a transport failure. This is the only `vercel.json` change the service needs; the site serves no corpus, so there is no CORS `headers` rule to add for one.
3. Give the service its corpus: `npm run --silent dm:corpus <service-repo>/corpus.json`, commit it there, redeploy it. It is a **snapshot** — content changes here do not reach DM until that is repeated. The service README owns the ritual.
4. Decide and state what the service does with visitor questions. They leave the site — `docs/agents/product-direction.md` owns that boundary.

## Conventions

- The homepage island must keep a complete semantic-HTML fallback (`?effect=off`, no-JS); all other routes stay complete as semantic HTML without WebGL or JS.
- Write project copy for non-technical readers — no jargon.
- No co-author lines on commits.
- GitHub issues are the tracker when work is tracked: one issue → one branch → one PR, targeting `preview/agent-first-redesign`, never `main`. (The former Gepetto contract workflow is retired; do not look for `gepetto-research` markers.)
- Review guidance: `code_review.md`.
