# Issue Tracker

Issues and PRs live in GitHub repo `DylanMcCavitt/portfolio-`.

Run GitHub commands from inside the repo:

- `gh issue view`
- `gh issue list`
- `gh issue create`
- `gh issue comment`
- `gh pr view`
- `gh pr create`


## Branch and agent routing

- The agent-first redesign roots at preview branch `preview/agent-first-redesign`.
- Do not target `main` for redesign implementation PRs unless a maintainer explicitly changes the plan.
- Stack order: `preview/agent-first-redesign` -> `codex/issue-84-eve-runtime` -> `claude/issue-85-typographic-card` -> `claude/issue-86-eve-landing` -> `claude/issue-87-editorial-detail` -> `codex/issue-88-retire-shell`.
- Each implementation issue must name an Owner engine: `Claude` for UI work, `Codex` for agent runtime/data/plumbing/test/cleanup work.
- Each implementation issue should be executed as one issue / one worktree / one branch / one PR.

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
