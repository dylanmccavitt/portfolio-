# Portfolio Agent Instructions

## Project workflow

This repo uses Dylan's Oh My Pi workflow kit at `/Users/dylanmccavitt/.omp/agent/workflow-kit/`.

Before editing:
1. Read this file.
2. Read `.agents/envelope/` — the workflow envelope (Linear map, domain, commands, templates); it is the authoritative tracker/domain/command source.
3. Read `docs/agents/triage-labels.md`.
4. Read `docs/agents/domain.md`.
5. Read `docs/agents/scope-ledger.md`.
6. Use a matching skill from `.agents/skills/` when one matches the task.

## Issue tracker

Linear — team `dmcc` (key `AGE`), project **Portfolio** — remains the default
tracker. See `.agents/envelope/linear-map.md` for the full team/project/label/state
map. The bounded production-readiness program is the exception: GitHub issues
`#184`–`#196` are authoritative for that program, use branches shaped
`codex/gh-<issue>-<slug>`, and are closed by PRs with `Fixes #<issue>`. Legacy
GitHub issues `#84`–`#88` remain historical redesign-stack context.


## Branch and agent routing

- New DM implementation roots at `preview/agent-first-redesign` unless an issue names a different stack parent; child PRs target their immediate stack parent, never `main`.
- Implementation stays one issue / one worktree / one branch / one PR.
- For GitHub program issues `#184`–`#196`, use
  `codex/gh-<issue>-<slug>` and `Fixes #<issue>`; use the normal AGE branch and
  linkage conventions for Linear work outside that range.
- UI implementation issues route to Claude or GLM.
- DM runtime, data, plumbing, tests, and cleanup route to Codex agents/subagents.
- Legacy Eve stack order remains historical context: `preview/agent-first-redesign` -> `codex/issue-84-eve-runtime` -> `claude/issue-85-typographic-card` -> `claude/issue-86-eve-landing` -> `claude/issue-87-editorial-detail` -> `codex/issue-88-retire-shell`.

## Full-flow traceability

Preserve intent through `grill-me -> to-prd -> to-issues -> triage when needed -> one issue / one worktree / one PR`.

- A grilled plan becomes a PRD with shared understanding, source decisions, non-decisions, and links to `docs/agents/scope-ledger.md`.
- Each issue copied from a PRD must keep its Source PRD, Parent issue when applicable, dependencies, deferred scope custody, and future issue candidates.
- Implementation agents take one issue into one worktree and one PR.
- Closeout must show expected evidence versus actual evidence and evidence that the change did not preclude deferred capabilities.
- Open questions stay unchanged or answered with evidence; never answer them silently during implementation.

## Checks

npm run lint && npm run typecheck && npm run build

## Done

- Acceptance criteria are met.
- Deferred scope custody is recorded in `docs/agents/scope-ledger.md` or the issue's Deferred scope custody section.
- Relevant checks pass or the blocker is documented.
- PR or handoff records verification evidence.
- Continuity constraints are checked in the PR or handoff with evidence.
