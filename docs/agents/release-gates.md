# Release and rollback gate

This reusable checklist and its ruleset payload govern an exact release
candidate. Historical implementation issue #192 is a locator for the checklist,
not current execution proof or authorization. This document does not authorize
an agent to mutate GitHub rulesets, Vercel configuration, preview or production
databases, deploy hooks, cron, or production traffic.

## Evidence identity

- At execution time, record the live reviewed base SHA, candidate head SHA,
  preview deployment SHA and URL, reviewer, timestamp, and every command result
  below before a maintainer promotes the stack. A blank checklist is not proof.
- Confirm the reviewed Git base and the live pull-request/deployment heads match
  the recorded candidate before using any artifact.
- **Any new commit invalidates every smoke, migration, Vercel, and
  rollback artifact. Re-run and record the complete affected evidence at the
  new head.**

| Evidence | Base SHA | Head SHA | Deployment SHA / URL | Reviewer and time |
| --- | --- | --- | --- | --- |
| Local security tests and `npm run verify` | | | n/a | |
| GitHub CI (`Lint, typecheck, build`) | | | | |
| Vercel preview | | | | |
| Preview migration read-back | | | | |
| Published-media path preflight | | | n/a | |
| Preview smoke, accessibility, and mobile | | | | |
| Emergency rollback and restore | | | | |
| Ruleset read-back | | | n/a | |

## Readiness contract

`GET /api/admin/readiness` is machine-authenticated with
`Authorization: Bearer <DM_READINESS_TOKEN>`. The token must be at least 32
UTF-8 bytes. The endpoint returns `Cache-Control: no-store` and only the
redacted fields `status`, `checks.db.ok`,
`checks.outbox.{queued,processing,dead,overdue,backlogExceeded}`, and
`checks.rag.configured`.

It returns `200` only when the deployed DM configuration is valid (runtime,
budget, rate-limit, and `database` public-project source), the database query
completes within 2000 ms, `OPENAI_API_KEY` is configured for public RAG, and
the outbox gate is healthy. `DM_RATE_LIMIT_HMAC_SECRET` must be at least 32
UTF-8 bytes. `RAG_VECTOR_STORE_ID` remains optional because vector-store
identities are persisted per approved source.

The documented outbox gate is deliberately conservative:

- Active backlog is `queued + processing`; it must stay below `20`.
- A `dead` job always degrades readiness.
- `overdue` means a queued job whose `next_attempt_at` is at least 15 minutes
  overdue, or a processing job whose lease has expired; either always degrades
  readiness.

Counts are returned as zero when the database cannot be queried, but
`checks.db.ok: false` and `checks.outbox.backlogExceeded: true` make that state
unambiguously degraded. Raw query errors, job errors, connection strings,
provider/vector identifiers, and credentials are never returned.

## Maintainer-only GitHub protection gate

The exact repository ruleset request is
[`release-branch-ruleset.json`](./release-branch-ruleset.json). It targets only
`main` and `preview/agent-first-redesign`, requires pull requests and resolved
conversations, requires the literal existing context `Lint, typecheck, build`
from GitHub Actions (integration id `15368`), blocks force pushes and deletion,
and deliberately keeps required approvals at zero until a second GitHub identity
exists.

Before applying it, a maintainer must record a read-only preflight:

```sh
gh api repos/DylanMcCavitt/portfolio-/rulesets --paginate
gh api repos/DylanMcCavitt/portfolio-/rules/branches/main
gh api repos/DylanMcCavitt/portfolio-/rules/branches/preview%2Fagent-first-redesign
gh api repos/DylanMcCavitt/portfolio-/collaborators --paginate --jq '.[].login'
gh api repos/DylanMcCavitt/portfolio-/commits/<reviewed-head-sha>/check-runs \
  --jq '.check_runs[] | select(.name == "Lint, typecheck, build") | {name, app: {id: .app.id, slug: .app.slug}}'
```

After explicit maintainer approval names the repository and both target refs,
the maintainer may apply the reviewed file and capture the returned ruleset id:

```sh
gh api --method POST repos/DylanMcCavitt/portfolio-/rulesets \
  --input docs/agents/release-branch-ruleset.json
```

Read back the exact object and the effective rules for both branches before
continuing:

```sh
gh api repos/DylanMcCavitt/portfolio-/rulesets/<captured-ruleset-id>
gh api repos/DylanMcCavitt/portfolio-/rules/branches/main
gh api repos/DylanMcCavitt/portfolio-/rules/branches/preview%2Fagent-first-redesign
```

If the ruleset must be rolled back, obtain renewed maintainer approval and
delete only the captured newly-created ruleset; do not weaken or delete an
unrelated policy:

```sh
gh api --method DELETE repos/DylanMcCavitt/portfolio-/rulesets/<captured-ruleset-id>
```

The request schema follows GitHub's
[repository-ruleset API](https://docs.github.com/en/rest/repos/rules?apiVersion=2022-11-28).

## Preview release and rollback checklist

All items below are maintainer-operated external gates after the implementation
PR is reviewed and the stack is merged in order.

1. Record the reviewed base/head SHAs and confirm CI plus the Vercel preview
   correspond to that head.
2. Read back the preview migration ledger and the required 0003–0007 objects;
   do not apply a migration without its separate approval.
3. Before deployment, use approved preview database access to run the
   read-only published-media compatibility preflight and require a `pass`:

   ```sh
   npm run db:published-media:preflight
   ```

   It reuses the exact canonical/legacy media validation used by public reads,
   including strict shape checks and the self-hosted CSP paths. Its redacted
   output identifies only project IDs/slugs and `invalid_media`; it never
   mutates data or prints credentials. Stop on any finding and correct the
   published record through the approved admin flow before trying a preview
   deployment.
4. Verify the preview CSP response on `/`, `/library`, a published
   `/projects/<slug>`, `/admin`, and a DM request. Confirm the Split-canvas
   landing, library, detail, admin review, and DM flows remain usable under the
   header. Published image, video, and poster paths must be self-hosted under
   the approved `/screenshots/` or `/demos/` roots before this gate; external
   media is rejected to stay aligned with the exact CSP. Include
   keyboard/accessibility and narrow mobile viewport checks.
5. With approved credentials only, call readiness and record its fully redacted
   response. Runtime, accessibility, browser, responsive, and visual gates are
   tracked by issue #308 and the provider-free
   [`replacement-quality-gates.md`](./replacement-quality-gates.md) procedure;
   paid model evaluation is not a release command.
6. Record the Vercel deployment SHA, public library/detail/DM smoke evidence,
   and the hidden-draft exclusion proof required by
   [`catalog-cutover.md`](./catalog-cutover.md).
7. With a separate approval, deploy preview with
   `PUBLIC_PROJECT_SOURCE=catalog_emergency`, prove the explicit source-mode
   signal and public fallback behavior, then restore `database` and redeploy.
   Never treat a database error as permission to activate this rollback.
8. Keep the final preview-to-main PR as the manual program-epic gate after the
   full stack is merged. No agent merges it or mutates production.

Any earlier preview proof is historical context only. It is not evidence for a
later candidate head unless every affected artifact has been refreshed and
bound to that exact head.
