# DB foundation

AGE-728 adds the Neon-on-Vercel foundation for DM project records. AGE-733 adds
the shared public project read layer. Source-selection hardening now makes
database mode published-DB only and fail-closed; it does not complete the
migration, Loom proof, static-artifact refresh, or deployment gates owned by
GitHub **#190**.

## Public project source boundary

- Entry point: `loadPublicProjectDetails()` in `src/lib/public-projects.ts`.
- Normal operator mode: `PUBLIC_PROJECT_SOURCE=database`.
- Database mode is also selected by an injected DB client, a real Vercel build
  (`VERCEL=1` plus `CI=1`), a Vercel function (`VERCEL=1` plus
  `VERCEL_REGION`), a configured local database URL, or the deprecated truthy compatibility flags
  `PUBLIC_PROJECT_PAGES_FROM_DB` / `PORTFOLIO_PUBLIC_PROJECTS_FROM_DB`.
- Database mode queries only rows where `lifecycle_state = 'published'` via
  `fetchPublicProjectDetails()` / `fetchPublicProjectCards()`. It never appends
  catalog rows and never catches an error into catalog content.
- Missing database configuration, connection/query failure, malformed persisted
  data, and an unexpected empty published set throw a typed, sanitized
  `PublicProjectDataError`. Live DB reads are not cached, so a later request can
  recover after a transient failure.
- An offline process with no configured DB uses the named internal
  `catalog_development` source. This includes a local workspace containing
  system markers downloaded by `vercel env pull`: `VERCEL=1` alone does not
  identify a live deployment. This is a deliberate fixture source selected
  before any DB attempt, not an error fallback.
- Explicit operator rollback mode is
  `PUBLIC_PROJECT_SOURCE=catalog_emergency`. It overrides an injected DB, emits
  a conspicuous server warning, and appears as `X-Public-Project-Source:
  catalog_emergency` on DM responses. It must be removed by a follow-up redeploy;
  it never activates because a database read failed.
- Any other non-empty `PUBLIC_PROJECT_SOURCE` value is a configuration error.
- The browser treats streamed project artifacts as authoritative. Project ids
  are never rehydrated from `src/data/catalog.ts` after a DB-backed response.
- Live rendering: Astro ignores non-literal `export const prerender` values, so
  the `live-public-project-pages` hook in `astro.config.mjs` flips `/library`,
  `/library/[filter]`, `/projects/[id]`, and `/hiring` to on-demand rendering in
  database mode. Sitemap and OG images remain build-time until #189/#190 finish
  the reviewed site-refresh contract.

## Environment story

- Production uses the Neon default production branch.
- Preview deployments use one persistent Neon branch named `preview`; per-preview branch provisioning in the Vercel↔Neon integration is disabled.
- Vercel DB env vars are environment-scoped: Production-scoped connection strings point at production, and Preview-scoped connection strings point at `preview`. Production data is unreachable from preview deployments.
- Runtime code reads the first available private server variable in this order: `DATABASE_URL`, `POSTGRES_URL`, `PORTFOLIO_DATABASE_URL`, `PORTFOLIO_POSTGRES_URL`.
- The repo names variables only; Vercel/Neon own the actual secret values.
- Pull local env from Vercel when needed, for example `vercel env pull .env.local`, or set an equivalent local `DATABASE_URL` manually. Delete any pulled `.env.local` immediately after use. Sensitive DB values pull empty; read actual connection strings only from Neon console or Vercel → Storage.
- Do not commit `.env*`, connection strings, passwords, Neon project ids, or Vercel account values.

## Commands

- `npm run db:migrate` applies unapplied SQL files under `db/migrations/`.
- **Schema first, code second:** apply a migration to the persistent preview
  database before aliasing a deployment that reads its new columns or enum
  values. Database mode now exposes schema drift as a typed failure instead of
  hiding it behind catalog content.
- Deploys do NOT run migrations (`build` is bare `astro build`). Every new migration file requires two manual applies before deployed code depends on it: once with the production connection string, once with the `preview` branch connection string, using the same idempotent Neon-HTTP-safe runner (`DATABASE_URL='<connection-string>' npm run db:migrate`). Connection strings are Sensitive in Vercel (`vercel env pull` returns them empty) — read them from the Neon console or Vercel → Storage. Automation is deferred scope; see `docs/agents/scope-ledger.md`.
- Migrations must stay statement-idempotent (`IF NOT EXISTS` et al.): the `neon()` HTTP driver has no session/transaction support, so the runner executes statements without `BEGIN`/`COMMIT` and a partial failure must converge on re-run.
- `npm run db:seed` applies migrations and non-public seed rows under `db/seeds/`.
- `ALLOW_DB_RESET=1 npm run db:reset` drops the AGE-728 foundation tables, reapplies migrations, then reapplies seeds. The safety flag is required because this command uses the active Neon/Vercel connection string.
- `npm run test:db` runs the migration/seed/reset proof against an in-memory PGlite database, so CI/local tests do not require Vercel or Neon credentials.

## Branch hygiene

- GitHub auto-delete-head-branches is enabled so merged PR branches cannot keep holding Neon preview slots; PR #127 showed orphaned branches wedged new-branch deploys with `Resource provisioning failed` until stale Neon preview branches were deleted.
- The Neon project keeps exactly two branches: production and `preview`.
- Delete stray Neon branches manually. Owner: maintainer.

## Scope guard

The seed row uses `lifecycle_state = 'shadow'` and `source = 'test_seed'`. It exists only to prove schema and reset mechanics; it is not a catalog import and must not feed public pages or DM answers.
