# Release and rollback gate

This reusable checklist and its ruleset payload govern an exact release
candidate. Historical implementation issue #192 is a locator for the checklist,
not current execution proof or authorization. This document does not authorize
an agent to mutate GitHub rulesets, Vercel configuration, deploy hooks, cron,
or production traffic.

The site is fully static: every page prerenders from the repo alone
(`src/data/catalog.ts`, `src/data/resume.ts`, `src/data/profile.ts`). There are
no API routes, no database, and no runtime secrets. Deploying a reviewed head
is the whole release.

## Evidence identity

- At execution time, record the live reviewed base SHA, candidate head SHA,
  preview deployment SHA and URL, reviewer, timestamp, and every command result
  below before a maintainer promotes the stack. A blank checklist is not proof.
- Confirm the reviewed Git base and the live pull-request/deployment heads match
  the recorded candidate before using any artifact.
- **Any new commit invalidates every smoke and rollback artifact. Re-run and
  record the complete affected evidence at the new head.**

| Evidence | Base SHA | Head SHA | Deployment SHA / URL | Reviewer and time |
| --- | --- | --- | --- | --- |
| Local `npm run verify` and `npm test` | | | n/a | |
| GitHub CI (`Lint, typecheck, build`) | | | | |
| Vercel preview | | | | |
| Preview smoke, accessibility, and mobile | | | | |
| Ruleset read-back | | | n/a | |

## Readiness contract

Readiness for a release candidate is established by the checklist above plus
`npm test`, which gates the release checks and route coverage.

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
2. On the preview deployment, smoke `/`, `/projects/<slug>`, `/resume`, and the
   `/journey`/`/library`/`/contact` redirects. Confirm every route stays
   complete and navigable with client JavaScript unavailable and with
   `?effect=off`. Include keyboard/accessibility and narrow mobile viewport
   checks.
3. Record the Vercel deployment SHA and the smoke evidence.
4. Rollback is redeploying the previous good deployment from the Vercel
   dashboard; record the restored deployment SHA if used.
5. Keep the final preview-to-main PR as the manual program-epic gate after the
   full stack is merged. No agent merges it or mutates production.

Any earlier preview proof is historical context only. It is not evidence for a
later candidate head unless every affected artifact has been refreshed and
bound to that exact head.
