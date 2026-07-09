# AGENTS.md

## Cursor Cloud specific instructions

This is a static-first **Astro 5/6 + TypeScript** portfolio site (Spotify-style "player" UI where
projects are tracks). It has no backend, database, or external services — everything is
static content sourced from `src/data/catalog.ts` and `src/data/resume.ts`.

### Services

There is a single dev service. Standard scripts live in `package.json`:

- Dev server: `npm run dev` (Astro dev server on `http://localhost:4321`).
- Lint: `npm run lint` (ESLint).
- Typecheck: `npm run typecheck` (`astro check`).
- Build: `npm run build` (static output to `dist/`).
- `npm run verify` runs lint + typecheck + build (mirrors CI in `.github/workflows/ci.yml`).

### Notes / caveats

- Requires Node `>=22.12.0` (see `engines` in `package.json`); the environment's Node 22 satisfies this.
- `npm run typecheck` reports two `astro(4000)` hints about inline `<script type="application/ld+json">`
  tags in `src/layouts/Player.astro` and `Tour.astro`. These are expected (0 errors) and not a failure.
- The dev server binds to `localhost` only; use `npm run dev -- --host` if you need it exposed on the network.
- Astro's dev toolbar is disabled in `astro.config.mjs` (it overlaps the bottom player bar in screenshots) — this is intentional, not a bug.
