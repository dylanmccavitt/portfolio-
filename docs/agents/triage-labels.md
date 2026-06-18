# Triage Labels

| Role | Label |
| --- | --- |
| Needs maintainer evaluation | `needs-triage` |
| Waiting on reporter/user | `needs-info` |
| Ready for agent implementation | `ready-for-agent` |
| Ready for human implementation | `ready-for-human` |
| Will not be actioned | `wontfix` |


## Owner routing

- Claude-owned UI implementation issues: `ready-for-human` only when a human must act; otherwise keep the issue routed to its Claude worktree/branch.
- Non-UI implementation issues: `ready-for-agent` for Codex agents/subagents.
- Agent-first redesign issues are rooted at `preview/agent-first-redesign`; each PR targets the issue's documented stack parent / Desired base branch, never `main`.

## Continuity rules

Triage changes must preserve Source PRD, Parent issue, dependencies, Deferred scope custody, Explicitly deferred items, Open questions, Do not preclude constraints, Future issue candidates, and scope ledger links.

- `ready-for-agent` means the issue still carries enough context for one issue / one worktree / one PR implementation.
- `needs-info` questions must keep already-established scope and non-decisions intact.
- `wontfix` must not erase deferred capabilities; link where that context is retained.
