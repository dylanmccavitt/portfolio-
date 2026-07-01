# DB foundation

AGE-728 adds the Neon-on-Vercel foundation for future DM project records. It does not change public route reads; `src/data/catalog.ts` remains the public project source until shadow parity and one-publish proof land in later issues.

## Environment story

- Production and preview use the Vercel-connected Neon/Postgres database.
- Runtime code reads the first available private server variable in this order: `DATABASE_URL`, then `POSTGRES_URL`.
- Pull local secrets from Vercel when needed, for example `vercel env pull .env.local`, or set an equivalent local `DATABASE_URL` manually.
- Do not commit `.env*`, connection strings, passwords, Neon project ids, or Vercel account values.
- Keep preview and production databases separate in Vercel/Neon. The repo only names variables; Vercel owns the actual secret values.

## Commands

- `npm run db:migrate` applies unapplied SQL files under `db/migrations/`.
- Deploys do NOT run migrations (`build` is bare `astro build`). Every new migration file requires a one-time manual `DATABASE_URL='<neon-connection-string>' npm run db:migrate` against the real database before deployed code depends on it. The connection string is Sensitive in Vercel (`vercel env pull` returns it empty) — read it from the Neon console or Vercel → Storage. Automation is deferred scope; see `docs/agents/scope-ledger.md`.
- Migrations must stay statement-idempotent (`IF NOT EXISTS` et al.): the `neon()` HTTP driver has no session/transaction support, so the runner executes statements without `BEGIN`/`COMMIT` and a partial failure must converge on re-run.
- `npm run db:seed` applies migrations and non-public seed rows under `db/seeds/`.
- `ALLOW_DB_RESET=1 npm run db:reset` drops the AGE-728 foundation tables, reapplies migrations, then reapplies seeds. The safety flag is required because this command uses the active Neon/Vercel connection string.
- `npm run test:db` runs the migration/seed/reset proof against an in-memory PGlite database, so CI/local tests do not require Vercel or Neon credentials.

## Scope guard

The seed row uses `lifecycle_state = 'shadow'` and `source = 'test_seed'`. It exists only to prove schema and reset mechanics; it is not a catalog import and must not feed public pages or DM answers.
