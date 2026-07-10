# Issue Tracker

Issues are tracked in **Linear** — team `dmcc` (key `AGE`), project **Portfolio**.
The authoritative team/project/label/state map and the GitHub bridge are defined in
`.agents/envelope/linear-map.md`; read it first.

PRs live in GitHub repo `DylanMcCavitt/portfolio-`. The branch name carries the
Linear issue id, so the PR auto-links to the issue and the merge auto-closes it
through Linear's GitHub bridge.

The bounded production-readiness program is the exception: GitHub issues
`#184`–`#196` are authoritative for that program. Use
`codex/gh-<issue>-<slug>` for each implementation branch and `Fixes #<issue>` in
its PR. Linear/AGE remains the default for all work outside that issue range.

## Working with issues and PRs

- Issues: create/triage/update in Linear by default (see `.agents/envelope/linear-map.md` for states/labels). Stamp Linear issues from `.agents/envelope/templates/linear-issue.md`. Create and maintain issues `#184`–`#196` in GitHub for the bounded program.
- PRs (GitHub, run from inside the repo): `gh pr view`, `gh pr create`. Use `.agents/envelope/templates/pull-request.md`; reference default Linear work with `Fixes AGE-<n>` and program issues `#184`–`#196` with `Fixes #<issue>`.

## Branch and agent routing

- New DM implementation roots at preview branch `preview/agent-first-redesign` unless an issue names a different stack parent.
- Do not target `main` for redesign implementation PRs unless a maintainer explicitly changes the plan.
- Each implementation issue must name an Owner engine: `Claude` or `GLM` (labels `claude`/`glm`) for UI work, `Codex` (label `codex`) for DM runtime/data/plumbing/test/cleanup work.
- Each implementation issue should be executed as one issue / one worktree / one branch / one PR.
- Default Linear branch shape: `<engine>/age-<n>-<slug>` (e.g. `codex/age-726-supersede-eve-with-dm`).
- GitHub production-readiness program (`#184`–`#196`) branch shape:
  `codex/gh-<issue>-<slug>`; use `Fixes #<issue>` in the matching PR.
- GitHub closing keywords do not close an issue when its PR merges only into the
  non-default preview branch. Reconcile preview-landed program issues manually;
  do not interpret an open issue as proof that its implementation is absent.

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
