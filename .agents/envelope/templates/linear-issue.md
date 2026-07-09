# {{ISSUE_TITLE}}

> Repo-local Linear issue scaffold (stamped from blueprint's canonical template).
> `ghosts` stamps this from the spec — one tracer-bullet slice that cuts through
> every layer and is demoable on its own. Team `dmcc` (AGE) / project Portfolio.
>
> Linear/AGE is the default tracker outside the bounded production-readiness
> program. GitHub issues `#184`–`#196` are authoritative for that program and do
> not use this Linear scaffold; their branches use `codex/gh-<issue>-<slug>` and
> their PRs use `Fixes #<issue>`.

## Context

Why this slice exists and the spec/PRD section it implements (in glossary terms
from `.agents/envelope/domain.md`).

## Source traceability

- Source PRD:
- Parent issue:
- Owner engine: {{claude | glm | codex}}  (UI → `claude` or `glm`; runtime/data/plumbing/tests/cleanup → `codex`)
- Preserves from scope ledger:

## Acceptance criteria

| Acceptance criterion | Expected evidence | Actual evidence |
| -------------------- | ----------------- | --------------- |
| {{observable outcome}} | {{how to prove it}} | Filled at closeout. |

## Scope / non-goals

- In scope: {{the thin vertical slice}}
- Non-goals: {{what this issue does not touch}}

## Dependencies

- Blocked by: {{AGE issue ids}}
- Blocks: {{AGE issue ids}}

## Deferred scope custody

- Long-term capability / Why deferred / Where tracked (`docs/agents/scope-ledger.md`) / Constraint on V1:

## Execution

- Mode: {{HITL | AFK}}
- Labels: type (`Bug`/`Improvement`/`Feature`), engine (`claude`/`glm`/`codex`), `risk:*`.
- Branch: `<engine>/age-{{n}}-<slug>` — carries this issue's Linear id so the PR
  auto-links and the merge auto-closes the issue.
- Desired base branch: this issue's stack parent (never `main` for the redesign stack).

## Proof

How to prove this slice works on its own without expanding scope.
