# {{PR_TITLE}}

> Repo-local PR scaffold (stamped from blueprint's canonical template). The branch
> name carries the Linear issue id (`age-<n>-...`), so this PR auto-links to the
> issue and the merge auto-closes it through Linear's GitHub bridge.

Fixes AGE-{{ISSUE_NUMBER}}

## Summary

What changed and why, in one short paragraph.

## Base branch

Target this issue's immediate stack parent / Desired base branch. New DM
implementation currently roots at `preview/agent-first-redesign`; the legacy Eve
stack order remains historical context:
`preview/agent-first-redesign` → `codex/issue-84-eve-runtime` →
`claude/issue-85-typographic-card` → `claude/issue-86-eve-landing` →
`claude/issue-87-editorial-detail` → `codex/issue-88-retire-shell`. Never target
`main` for this stack unless a maintainer changes the plan.

## Changes

- {{change}}

## Acceptance criteria

Map each Linear acceptance criterion to where it is satisfied.

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
