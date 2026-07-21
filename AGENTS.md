# Portfolio

Clean, recruiter-friendly portfolio site on the **agent-first redesign** preview branch. Visitors land on **DM**, the public portfolio agent, in a Split-canvas chat surface. Designed for non-technical visitors first (recruiters, hiring managers).

## Stack

- **Astro + TypeScript** — static-first site framework (see `package.json` for the pinned `astro` version)
- **@astrojs/vercel** — Vercel adapter for server/API routes and deployment
- **Global CSS** — design tokens in `src/styles/player.css` (`--pl-*`); Split-canvas landing styles in `src/styles/dm.css`
- **Vanilla TypeScript client island** — `src/scripts/dm.ts` streams against `/api/dm/chat` on the DM landing and fit-check routes
- **TypeScript data modules** — `src/data/catalog.ts` (migration shadow plus local/emergency source) and `src/data/resume.ts` (résumé/contact v1 source); no Markdown/MDX content collections
- **Neon Postgres** — DM project records, admin publish flow, RAG; see `docs/agents/db-foundation.md`
- **Deployed** to Vercel

Default to zero client JS: static `.astro` pages everywhere. Client JS only for the deliberate DM chat island (`src/scripts/dm.ts`) and the hiring-tour stepper (`src/scripts/tour.ts`).

## Design Direction

> DM is the public portfolio agent (`src/lib/dm/`, `/api/dm/chat`, `src/scripts/dm.ts`, `src/styles/dm.css`). The authoritative product/design direction and deferred-scope custody live in `docs/agents/scope-ledger.md`. The retired Spotify **player shell** (sidebar + bottom player bar) is not extended — `/player` and other legacy routes 301 via `vercel.json`.

Current preview-branch UI:

- **Split-canvas landing** (`/`) — persistent left rail + main conversation pane; DM answers stream from `/api/dm/chat`
- **Typographic project cards** — image-free library grid at `/library` and filtered `/library/[filter]`
- **Editorial project detail** — static case-study pages at `/projects/[id]`
- **Résumé journey** (`/journey`, `/journey/[track]`) — editorial timeline from `src/data/resume.ts`
- **Hiring tour** (`/hiring`) — stepped recruiter path with optional `tour.ts` progressive enhancement
- **Fit check** (`/fit-check`) — job-description paste surface using the same DM chat island

Dark-only tokens (`--pl-*` in `player.css`). Deployed public project reads are
published-DB only and fail closed; they never overlay or fall back to
`src/data/catalog.ts`. The catalog remains a migration/parity input, an offline
development source, and the explicit `catalog_emergency` rollback source until
the full Loom proof and operational cutover in GitHub **#190**.

## Content

- Landing: Split-canvas DM (`/`)
- Library: project index (`/library`) + area/status filters (`/library/[filter]`)
- Projects: editorial detail pages (`/projects/[id]`) from the public-project source loader
- Journey: résumé timeline (`/journey`, `/journey/[track]`) from `src/data/resume.ts`
- Hiring: guided tour (`/hiring`)
- Fit check: JD paste + DM read (`/fit-check`)
- Legacy routes (`/about`, `/contact`, `/experience`, `/projects`, `/log`, `/player`, …) redirect via `vercel.json`

## Constraints

- Zero client JS by default — progressive enhancement only where needed
- No jargon in project descriptions — write for someone with no coding background
- Use the canonical product names: **DM**, **agent-first portfolio**, **Split-canvas landing**, **Typographic project card**, **Editorial project detail**, **answer block**, **tool trace**, and **artifact card**. **Eve** is historical only and must not be restored as a live product seam.
- Public DM answers may use only published DB project records, approved public RAG sources, and static résumé/contact data. Hidden drafts, private docs, Slack/admin notes, candidate evidence, visitor chats, and unsupported/generated claims are not public sources.

## Workflow

- **No co-author lines** on commits
- **Don't commit** spec/plan docs (`docs/superpowers/`) — those are working files, not repo artifacts
- Dev environment runs inside a Distrobox container
- GitHub issues are the durable contract surface for tracked repository delivery. Gepetto is the sole coordinator: implementation begins only from an approved contract persisted under the `gepetto-research` marker.
- Deliver one independently reviewable leaf with one writer, one dedicated worktree, one branch, and one linked PR. Bind implementation proof and review to the exact live PR head.
- Agent-first redesign PRs target the approved stack parent rooted at `preview/agent-first-redesign`, never `main`, unless the persisted contract says otherwise.
- Merge, deploy, publish, migrations, issue/PR closure, review-thread resolution, and destructive cleanup require their explicit authority gates.
- Preserve continuity and deferred scope in `docs/agents/scope-ledger.md`; keep active operator procedures under `docs/agents/` current.

## Cursor Cloud specific instructions

The executable build, test, lint, and run commands live in `package.json`. Use
those scripts directly; this section records only the non-obvious cloud caveats.

- **Node 24 is required** (`engines: 24.x`, `.node-version`, `.nvmrc`, `mise.toml`).
  The nvm default alias is set to `24`, so tmux / interactive login shells (where
  `npm run dev` runs) already use Node 24. The Cursor **Shell tool runs a non-login
  shell** with `/exec-daemon/node` (Node 22) first on `PATH`, so bare `node`/`npm`
  there is Node 22. Before running `npm run typecheck`/`build`/`test:*` from the
  Shell tool, activate Node 24 first, e.g. `source ~/.nvm/nvm.sh && nvm use 24`
  (or prepend `$HOME/.nvm/versions/node/v24.18.0/bin` to `PATH`).
- **Tests need no external services or secrets.** The `test:*` scripts use an
  in-memory Postgres via `@electric-sql/pglite`; the CI test set is
  `test:db test:discovery test:slack test:admin test:dm test:metrics test:rag
  test:benchmark test:eval-report test:proof`.
- **DM chat is disabled without config.** `/api/dm/chat` returns HTTP 503
  `missing_config` unless a database URL and either `AI_GATEWAY_API_KEY` or
  `OPENAI_API_KEY` are set; the site shell, browsing, and all tests work without
  them. Approved-source vector search additionally needs `OPENAI_API_KEY`. The
  chat UI degrades to a "DM is unavailable right now" notice. Never commit these
  values.

## Code review

Follow [`code_review.md`](code_review.md) for repository-wide review guidance.
