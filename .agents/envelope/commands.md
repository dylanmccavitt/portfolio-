# Commands

The real commands, copied from `package.json`. `roboports`, `rocket-launch`,
`modules`, and `quality` read these instead of inventing commands.

| Purpose    | Command            | Underlying |
| ---------- | ------------------ | ---------- |
| Install    | `npm install`      | — |
| Dev server | `npm run dev`      | `astro dev` |
| Build      | `npm run build`    | `astro build` |
| Preview    | `npm run preview`  | `astro preview` |
| Astro CLI  | `npm run astro`    | `astro` |
| Lint       | `npm run lint`     | `eslint .` |
| Typecheck  | `npm run typecheck`| `astro check` |
| Verify gate | `npm run verify`  | `npm run lint && npm run typecheck && npm run build` |
| Test DB foundation | `npm run test:db` | `node --import tsx --test tests/db-foundation.test.ts` |
| Test GitHub discovery | `npm run test:discovery` | `node --import tsx --test tests/github-discovery.test.ts` |
| Test Slack control plane | `npm run test:slack` | `node --import tsx --test tests/slack-control-plane.test.ts` |
| Admin publish test | `npm run test:admin` | `node --import tsx --test tests/admin-auth.test.ts tests/admin-publish.test.ts && node --import tsx --test tests/admin-rag-sources.test.ts` |
| RAG tests | `npm run test:rag` | `node --import tsx --test tests/rag-ingestion.test.ts tests/rag-retrieval.test.ts` |
| DM runtime test | `npm run test:dm` | `node --import tsx --test tests/dm-runtime.test.ts` |
| DM metrics test | `npm run test:metrics` | `node --import tsx --test tests/dm-metrics.test.ts` |
| DM benchmark test | `npm run test:benchmark` | `node --import tsx --test tests/dm-benchmark.test.ts` |
| Publish proof gate | `npm run test:proof` | `node --import tsx --test tests/publish-proof.test.ts` |
| Legacy Eve test | `npm run test:eve` | `node --import tsx --test tests/eve-runtime.test.ts` |
| DM eval | `npm run dm:eval` | `node --import tsx scripts/dm-eval.ts` |
| DM latency benchmark | `npm run dm:bench` | `node --import tsx scripts/dm-benchmark.ts` |
| DB migrate | `npm run db:migrate` | `tsx scripts/db.ts migrate` |
| DB seed | `npm run db:seed` | `tsx scripts/db.ts seed` |
| DB reset | `npm run db:reset` | `tsx scripts/db.ts reset` |
| Catalog shadow import | `npm run db:catalog:shadow` | `tsx scripts/catalog-shadow.ts import-and-report` |
| Catalog parity report | `npm run db:catalog:parity` | `tsx scripts/catalog-shadow.ts report` |
| Manual GitHub discovery scan | `npm run db:github:scan -- <repo-fixture.json>` | `tsx scripts/github-discovery.ts <repo-fixture.json>` |

## Verify gate

Run before calling work complete (also `npm run verify`):

```
npm run lint && npm run typecheck && npm run build
```

Add `npm run test:dm` when the change touches the public DM runtime/API seam.
Add `npm run test:eve` when the change touches legacy Eve runtime/tool paths
that remain as migration evidence (`src/lib/eve/`, `/api/eve/chat`, or
`tests/eve-runtime.test.ts`).

## Branches

- **Default branch:** `main`.
- **Redesign stack root:** `preview/agent-first-redesign`. Agent-first redesign
  PRs target their immediate stack parent, never `main`, until a maintainer
  changes the plan.
- **Legacy Eve stack order:** `preview/agent-first-redesign` →
  `codex/issue-84-eve-runtime` → `claude/issue-85-typographic-card` →
  `claude/issue-86-eve-landing` → `claude/issue-87-editorial-detail` →
  `codex/issue-88-retire-shell`. These branch names remain historical stack
  parents; new DM implementation issues use their issue packet's Desired base
  branch, currently `preview/agent-first-redesign` unless a maintainer changes it.

## Runtime

- Node `24.x` (see `engines` in `package.json`, `mise.toml`, `.node-version`, and `.nvmrc`).
- Dev environment runs inside a Distrobox container.
- Deployed to Vercel (`@astrojs/vercel`; see `vercel.json`).
- Model/provider for DM, and for any legacy Eve runtime kept during migration, is configured via Vercel env vars — never commit secrets.
