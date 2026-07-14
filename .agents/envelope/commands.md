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
| Admin publish test | `npm run test:admin` | `node --import tsx --test tests/admin-auth.test.ts tests/admin-publish.test.ts tests/admin-readiness.test.ts && node --import tsx --test tests/admin-rag-sources.test.ts` |
| Release gate security test | `npm run test:release` | `node --import tsx --test tests/release-gates.test.ts` |
| RAG tests | `npm run test:rag` | `node --import tsx --test tests/rag-ingestion.test.ts tests/rag-retrieval.test.ts` |
| Publish outbox tests | `npm run test:outbox` | `node --import tsx --test tests/outbox-worker.test.ts` |
| DM runtime test | `npm run test:dm` | `node --import tsx --test tests/dm-runtime.test.ts tests/dm-grounding.test.ts` |
| DM metrics test | `npm run test:metrics` | `node --import tsx --test tests/dm-metrics.test.ts` |
| DM benchmark test | `npm run test:benchmark` | `node --import tsx --test tests/dm-benchmark.test.ts` |
| DM eval corpus test | `npm run test:eval-corpus` | `node --import tsx --test tests/dm-eval-corpus.test.ts` |
| DM eval report test | `npm run test:eval-report` | `node --import tsx --test tests/dm-eval-corpus.test.ts tests/dm-eval-report.test.ts tests/dm-judge.test.ts` |
| Publish proof gate | `npm run test:proof` | `node --import tsx --test tests/publish-proof.test.ts` |
| DM eval | `npm run dm:eval` | `node --env-file-if-exists=.env --env-file-if-exists=.env.local --import tsx scripts/dm-eval.ts` |
| DM eval + HTML report | `npm run dm:eval:report` | Live Luna/Grok conversational corpus, three runs per case, judged diagnostic report (writes `.dm-evals/latest.html`) |
| DM live-model release eval | `npm run dm:eval:release` | Fixed live Luna/Grok matrix, three runs per case, judged release report; canned answers cannot satisfy it |
| DM latency benchmark | `npm run dm:bench` | `node --env-file-if-exists=.env --env-file-if-exists=.env.local --import tsx scripts/dm-benchmark.ts` |
| DB migrate | `npm run db:migrate` | `tsx scripts/db.ts migrate` |
| DB seed | `npm run db:seed` | `tsx scripts/db.ts seed` |
| DB reset | `npm run db:reset` | `tsx scripts/db.ts reset` |
| Preflight published media (read-only) | `npm run db:published-media:preflight` | `tsx scripts/published-media-preflight.ts` |
| Catalog shadow import | `npm run db:catalog:shadow` | `tsx scripts/catalog-shadow.ts import-and-report` |
| Catalog parity report | `npm run db:catalog:parity` | `tsx scripts/catalog-shadow.ts report` |
| Catalog cutover dry run | `npm run db:catalog:cutover` | `tsx scripts/catalog-shadow.ts cutover` |
| Catalog cutover apply | `npm run db:catalog:cutover -- --apply` | `tsx scripts/catalog-shadow.ts cutover --apply` |
| Manual GitHub discovery scan | `npm run db:github:scan -- <repo-fixture.json>` | `tsx scripts/github-discovery.ts <repo-fixture.json>` |

## Verify gate

Run before calling work complete (also `npm run verify`):

```
npm run lint && npm run typecheck && npm run build
```

Add `npm run test:dm` when the change touches the public DM runtime/API seam.

## Branches

- **Default branch:** `main`.
- **Redesign stack root:** `preview/agent-first-redesign`. Agent-first redesign
  PRs target their immediate stack parent, never `main`, until a maintainer
  changes the plan.
- **Tracker default:** Linear/AGE work uses
  `<engine>/age-<issue>-<slug>` and the normal Linear GitHub linkage.
- **Production-readiness exception:** GitHub issues `#184`–`#196` are
  authoritative for that bounded program. Use `codex/gh-<issue>-<slug>` and
  close each issue from its PR with `Fixes #<issue>`. Linear/AGE remains the
  default outside that range.

## Runtime

- Node `24.x` (see `engines` in `package.json`, `mise.toml`, `.node-version`, and `.nvmrc`).
- Dev environment runs inside a Distrobox container.
- Deployed to Vercel (`@astrojs/vercel`; see `vercel.json`).
- Model/provider for DM is configured via Vercel env vars — never commit secrets.
