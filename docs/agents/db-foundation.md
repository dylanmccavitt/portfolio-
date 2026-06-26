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
- `npm run db:seed` applies migrations and non-public seed rows under `db/seeds/`.
- `ALLOW_DB_RESET=1 npm run db:reset` drops the AGE-728 foundation tables, reapplies migrations, then reapplies seeds. The safety flag is required because this command uses the active Neon/Vercel connection string.
- `npm run test:db` runs the migration/seed/reset proof against an in-memory PGlite database, so CI/local tests do not require Vercel or Neon credentials.

## Scope guard

The seed row uses `lifecycle_state = 'shadow'` and `source = 'test_seed'`. It exists only to prove schema and reset mechanics; it is not a catalog import and must not feed public pages or DM answers.
