# Issue Tracker

Issues are tracked in **Linear** — team `dmcc` (key `AGE`), project **Portfolio**.
The authoritative team/project/label/state map and the GitHub bridge are defined in
`.agents/envelope/linear-map.md`; read it first.

PRs live in GitHub repo `DylanMcCavitt/portfolio-`. The branch name carries the
Linear issue id, so the PR auto-links to the issue and the merge auto-closes it
through Linear's GitHub bridge.

> Legacy: GitHub issues `DylanMcCavitt/portfolio-` #84–#88 remain for the in-flight
> agent-first redesign stack. New work is filed in Linear.

## Working with issues and PRs

- Issues: create/triage/update in Linear (see `.agents/envelope/linear-map.md` for states/labels). Stamp new issues from `.agents/envelope/templates/linear-issue.md`.
- PRs (GitHub, run from inside the repo): `gh pr view`, `gh pr create`. Use `.agents/envelope/templates/pull-request.md`; reference the issue with `Fixes AGE-<n>`.

## Branch and agent routing

- The agent-first redesign roots at preview branch `preview/agent-first-redesign`.
- Do not target `main` for redesign implementation PRs unless a maintainer explicitly changes the plan.
- Stack order: `preview/agent-first-redesign` -> `codex/issue-84-eve-runtime` -> `claude/issue-85-typographic-card` -> `claude/issue-86-eve-landing` -> `claude/issue-87-editorial-detail` -> `codex/issue-88-retire-shell`.
- Each implementation issue must name an Owner engine: `Claude` (label `claude`) for UI work, `Codex` (label `codex`) for agent runtime/data/plumbing/test/cleanup work.
- Each implementation issue should be executed as one issue / one worktree / one branch / one PR.
- Branch shape: `<engine>/age-<n>-<slug>` (e.g. `claude/age-141-eve-landing`).

## Issue packet fields

Each issue packet must include:

- Source PRD
- Owner engine
- Parent issue and dependencies
- Problem
- Acceptance criteria with expected verification evidence
- Non-goals
- Relevant files
- Verification
- Risks
- Desired base branch
- Deferred scope custody
- Future issue candidates preserved
- Continuity constraints checked

Every issue created from a PRD or grilled plan must either update `docs/agents/scope-ledger.md` or link to the ledger section that owns deferred scope.

## Scope continuity

- Use the scope ledger to preserve product north star, Next, Later, Explicitly deferred, Do not preclude, Naming anchors, Open questions, and Future issue candidates.
- Do not collapse deferred capabilities into vague "future work"; name the long-term capability, why it is deferred, where it is tracked, and the constraint it imposes on V1.
- Open questions must stay explicit until answered by a human or by cited repo evidence.
- PRs and handoffs must record continuity constraints checked plus evidence.
- Triage changes must preserve Source PRD, Parent issue, dependencies, deferred scope custody, open questions, and do-not-preclude constraints.
