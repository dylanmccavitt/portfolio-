# Portfolio

Clean, recruiter-friendly portfolio site on the **agent-first redesign** preview branch. Visitors land on **DM**, the public portfolio agent, in a Split-canvas chat surface. Designed for non-technical visitors first (recruiters, hiring managers).

## Stack

- **Astro + TypeScript** — static-first site framework (see `package.json` for the pinned `astro` version)
- **@astrojs/vercel** — Vercel adapter for server/API routes and deployment
- **Global CSS** — design tokens in `src/styles/player.css` (`--pl-*`); Split-canvas landing styles in `src/styles/dm.css`
- **Vanilla TypeScript client island** — `src/scripts/dm.ts` streams against `/api/dm/chat` on the DM landing and fit-check routes
- **TypeScript data modules** — `src/data/catalog.ts` (project shadow/fallback) and `src/data/resume.ts` (résumé/contact v1 source); no Markdown/MDX content collections
- **Neon Postgres** — DM project records, admin publish flow, RAG; see `docs/agents/db-foundation.md`
- **Deployed** to Vercel

Default to zero client JS: static `.astro` pages everywhere. Client JS only for the deliberate DM chat island (`src/scripts/dm.ts`) and the hiring-tour stepper (`src/scripts/tour.ts`).

## Design Direction

> DM is the public portfolio agent (`src/lib/dm/`, `/api/dm/chat`, `src/scripts/dm.ts`, `src/styles/dm.css`). The authoritative product/design direction is `.agents/envelope/domain.md` plus `docs/agents/scope-ledger.md`. The retired Spotify **player shell** (sidebar + bottom player bar) is not extended — `/player` and other legacy routes 301 via `vercel.json`.

Current preview-branch UI:

- **Split-canvas landing** (`/`) — persistent left rail + main conversation pane; DM answers stream from `/api/dm/chat`
- **Typographic project cards** — image-free library grid at `/library` and filtered `/library/[filter]`
- **Editorial project detail** — static case-study pages at `/projects/[id]`
- **Résumé journey** (`/journey`, `/journey/[track]`) — editorial timeline from `src/data/resume.ts`
- **Hiring tour** (`/hiring`) — stepped recruiter path with optional `tour.ts` progressive enhancement
- **Fit check** (`/fit-check`) — job-description paste surface using the same DM chat island

Dark-only tokens (`--pl-*` in `player.css`). Public project pages read through the gated DB load layer when enabled (see `docs/agents/db-foundation.md`); until catalog cutover (Linear **AGE-738**), `src/data/catalog.ts` remains the shadow/fallback public project source.

## Content

- Landing: Split-canvas DM (`/`)
- Library: project index (`/library`) + area/status filters (`/library/[filter]`)
- Projects: editorial detail pages (`/projects/[id]`) from the gated public-project loader
- Journey: résumé timeline (`/journey`, `/journey/[track]`) from `src/data/resume.ts`
- Hiring: guided tour (`/hiring`)
- Fit check: JD paste + DM read (`/fit-check`)
- Legacy routes (`/about`, `/contact`, `/experience`, `/projects`, `/log`, `/player`, …) redirect via `vercel.json`

## Constraints

- Zero client JS by default — progressive enhancement only where needed
- No jargon in project descriptions — write for someone with no coding background

## Workflow

- **No co-author lines** on commits
- **Don't commit** spec/plan docs (`docs/superpowers/`) — those are working files, not repo artifacts
- Dev environment runs inside a Distrobox container

## Agent skills

This repo runs the Factorio workflow kit. The per-repo envelope is the single
binding point — read it before planning or building:

- `.agents/envelope/linear-map.md` — Linear team (`dmcc`/AGE) + Portfolio project, labels, states, the inserter triage map, and the GitHub bridge.
- `.agents/envelope/domain.md` — domain glossary (DM, Split-canvas landing, Typographic card, Editorial detail, answer block, artifact card).
- `.agents/envelope/commands.md` — build/test/lint/run + default branch and the redesign stack.
- `.agents/envelope/templates/` — PR / issue / project-doc templates.

Repo-specific skills and agents live in `.agents/skills/` and `.agents/agents/`.
Continuity for the agent-first redesign is tracked in `docs/agents/scope-ledger.md`.

## Cursor Cloud specific instructions

Standard build/test/lint/run commands live in `package.json` and
`.agents/envelope/commands.md` — use those, this section only records the
non-obvious cloud caveats.

- **Node 24 is required** (`engines: 24.x`, `.node-version`, `.nvmrc`, `mise.toml`).
  The nvm default alias is set to `24`, so tmux / interactive login shells (where
  `npm run dev` runs) already use Node 24. The Cursor **Shell tool runs a non-login
  shell** with `/exec-daemon/node` (Node 22) first on `PATH`, so bare `node`/`npm`
  there is Node 22. Before running `npm run typecheck`/`build`/`test:*` from the
  Shell tool, activate Node 24 first, e.g. `source ~/.nvm/nvm.sh && nvm use 24`
  (or prepend `$HOME/.nvm/versions/node/v24.18.0/bin` to `PATH`).
- **Tests need no external services or secrets.** The `test:*` scripts use an
  in-memory Postgres via `@electric-sql/pglite`; the CI test set is
  `test:db test:discovery test:slack test:admin test:dm test:metrics test:rag`.
- **DM chat is disabled without config.** `/api/dm/chat` returns HTTP 503
  `missing_config` unless `OPENAI_API_KEY` is set; the site shell, browsing, and
  all tests work without it. The chat UI degrades to a "DM is unavailable right
  now" notice. Set that env var (never commit it) to exercise live chat.
