# Portfolio

Clean, recruiter-friendly portfolio site on the **agent-first redesign** preview
branch. Visitors land on the device console home, where **DM** — the public
portfolio agent — opens as the route-bound contextual guide. Designed for
non-technical visitors first (recruiters, hiring managers).

`docs/agents/product-direction.md` is the naming and product-direction
authority. Use the names it anchors; do not restate or invent surface names
here.

## Stack

- **Astro + TypeScript** — static-first site framework (see `package.json` for the pinned `astro` version)
- **@astrojs/vercel** — Vercel adapter for server/API routes and deployment
- **three** — muted Three.js device visual system in `src/scripts/device-renderer.ts`, bootstrapped by `src/scripts/device.ts` with keyboard/D-pad handling in `src/scripts/device-keyboard.ts`. Adapted shader techniques carry an **MIT + Commons Clause** obligation; see [`docs/licenses/canvas-ui.md`](docs/licenses/canvas-ui.md) before copying, extracting, or redistributing that code.
- **Global CSS** — design tokens in `src/styles/player.css` (`--pl-*`); device console styles in `src/styles/device.css`; contextual guide styles in `src/styles/dm.css`
- **Vanilla TypeScript client islands** — `src/scripts/dm.ts` streams against `/api/dm/chat` for the contextual guide; `src/scripts/device.ts` bootstraps on every page and dynamically imports the Three.js renderer only above 769px
- **TypeScript data modules** — `src/data/catalog.ts` (migration shadow plus local/emergency source), `src/data/resume.ts` (résumé/contact v1 source), and `src/data/profile.ts` (owner-approved public profile); no Markdown/MDX content collections
- **Neon Postgres** — DM project records; see `docs/agents/db-foundation.md`
- **Deployed** to Vercel

Default to zero client JS beyond those two islands: static `.astro` pages
everywhere else. The Three.js renderer is progressive enhancement — every route
must remain complete and navigable as semantic HTML without WebGL or client
JavaScript.

## Design Direction

> DM is the public portfolio agent (`src/lib/dm/`, `/api/dm/chat`,
> `src/scripts/dm.ts`, `src/styles/dm.css`). Authoritative product/design
> direction and deferred-scope custody live in
> `docs/agents/product-direction.md`; binding visual references live in
> `docs/design/contextual-guide-reset/`. The retired Spotify **player shell**
> (sidebar + bottom player bar) is not extended — `/player` and other legacy
> routes 301 via `vercel.json`.

Current preview-branch UI:

- **Device console home** (`/`) — Three.js handheld with a keyboard-accessible menu; the contextual guide opens as the right-side sidecar and streams from `/api/dm/chat`
- **Typographic project cards** — image-free library grid at `/library` and filtered `/library/[filter]`
- **Editorial project detail** — static case-study pages at `/projects/[id]`
- **Résumé journey** (`/journey`, `/journey/[track]`) — editorial timeline from `src/data/resume.ts`
- **Résumé** (`/resume`) and **Contact** (`/contact`) — concise recruiter surfaces from `src/data/resume.ts`

Dark-only tokens (`--pl-*` in `player.css`). Deployed public project reads are
published-DB only and fail closed; they never overlay or fall back to
`src/data/catalog.ts`. The catalog remains a migration/parity input, an offline
development source, and the explicit `catalog_emergency` rollback source.

## Content

- Home: device console with the contextual guide (`/`)
- Library: project index (`/library`) + area/status filters (`/library/[filter]`)
- Projects: editorial detail pages (`/projects/[id]`) from the public-project source loader
- Journey: résumé timeline (`/journey`, `/journey/[track]`) from `src/data/resume.ts`
- Résumé: concise recruiter résumé (`/resume`)
- Contact: direct contact surface (`/contact`)
- Legacy routes (`/about`, `/experience`, `/log`, `/log/:slug`, `/player`, `/projects`, `/homelab/topology`, and remapped library/project slugs) redirect via `vercel.json` — that file is the redirect authority

## Constraints

- Zero client JS by default — progressive enhancement only where needed
- No jargon in project descriptions — write for someone with no coding background
- Use the canonical product names anchored in `docs/agents/product-direction.md`. **Eve** and the player shell are historical only and must not be restored as live product seams.
- The public-source and privacy boundary in `docs/agents/product-direction.md` is the single authority for what DM may answer from. Do not restate a partial allowlist anywhere else. Hidden drafts, private docs, admin notes, candidate evidence, visitor chats, credentials, and unsupported or generated claims are never public sources.

## Workflow

- **No co-author lines** on commits
- **Don't commit** working docs (`docs/superpowers/`, `docs/workflow-playbook/`, `work/`) — those are scratch files, not repo artifacts
- GitHub issues are the durable contract surface for tracked repository delivery; they are the sole tracker identity — do not introduce identifiers from any other tracker. Gepetto is the sole coordinator: implementation begins only from an approved contract persisted under the `gepetto-research` marker.
- Deliver one independently reviewable leaf with one writer, one dedicated worktree, one branch, and one linked PR. Bind implementation proof and review to the exact live PR head.
- Agent-first redesign PRs target the approved stack parent rooted at `preview/agent-first-redesign`, never `main`, unless the persisted contract says otherwise.
- Merge, deploy, migrations, issue/PR closure, review-thread resolution, and destructive cleanup require their explicit authority gates.
- Preserve continuity and deferred scope in `docs/agents/product-direction.md`; keep active operator procedures under `docs/agents/` current.

## Environment and checks

The executable build, test, lint, and run commands live in `package.json`. Use
those scripts directly; this section records only the non-obvious caveats.

- **Node 24 is required** (`engines: 24.x`, `.node-version`, `.nvmrc`, `mise.toml`). Development is local — there is no container or remote dev environment. If a shell resolves a different `node`, activate 24 first (for example `mise use node@24`, or prepend the mise Node 24 `bin` directory to `PATH`) and confirm with `node -v` before running `npm run verify` or any `test:*` script.
- **Tests need no external services or secrets.** The `test:*` scripts use an in-memory Postgres via `@electric-sql/pglite`. The authoritative test set is whatever `.github/workflows/ci.yml` runs — read that file rather than trusting an enumeration here.
- **DM chat is disabled without config.** `/api/dm/chat` returns HTTP 503 `missing_config` unless a database URL and either `AI_GATEWAY_API_KEY` or `OPENAI_API_KEY` are set; the site shell, browsing, and all tests work without them. The guide degrades to a "DM is unavailable right now" notice. Never commit these values.

## Code review

Follow [`code_review.md`](code_review.md) for repository-wide review guidance.
