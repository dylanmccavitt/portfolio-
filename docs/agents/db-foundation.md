# DB foundation

AGE-728 adds the Neon-on-Vercel foundation for future DM project records. It does not change public route reads; `src/data/catalog.ts` remains the public project source until shadow parity and one-publish proof land in later issues.

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
