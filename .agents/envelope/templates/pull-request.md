# {{PR_TITLE}}

> Repo-local PR scaffold (stamped from blueprint's canonical template).
> Linear/AGE is the default tracker outside the bounded production-readiness
> program. For GitHub issues `#184`–`#196`, use branch
> `codex/gh-<issue>-<slug>` and replace the default issue line below with exactly
> `Fixes #<issue>`. For all other work, keep the Linear/AGE convention.

Fixes AGE-{{ISSUE_NUMBER}}

<!-- For GitHub program issues #184-#196, replace the line above with:
Fixes #<issue>
-->

## Summary

What changed and why, in one short paragraph.

## Base branch

Target this issue's immediate stack parent / Desired base branch. New DM
implementation currently roots at `preview/agent-first-redesign`. Never target
`main` for this stack unless a maintainer changes the plan.

## Changes

- {{change}}

## Acceptance criteria

Map each tracked issue acceptance criterion to where it is satisfied.

- [ ] {{criterion}} — {{how it is met}}

## Proof

The targeted checks/tests run for the changed behavior and the evidence captured
(`npm run lint && npm run typecheck && npm run build`; add `npm run test:dm` for
DM runtime/API seam changes).

## Continuity constraints checked

- Constraint / Result / Evidence:
- Did not preclude deferred capabilities:
- Open questions unchanged or answered with evidence:
- Scope ledger (`docs/agents/scope-ledger.md`) updated or linked:

## Review notes

Risks, trade-offs, follow-ups, and what a reviewer should focus on.
