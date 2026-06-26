# Triage

Issues are triaged in **Linear** (team `dmcc`/AGE, project Portfolio). The
authoritative role→state map lives in `.agents/envelope/linear-map.md`; this file
mirrors it for quick reference.

## Triage role -> Linear state

| Role | Linear state | Extra labels |
| --- | --- | --- |
| Needs maintainer evaluation | `Triage` | — |
| Waiting on reporter/user | `Blocked` | — |
| Ready for agent implementation | `Ready` | engine (`claude`/`glm`/`codex`) |
| Ready for human implementation | `Todo` | — |
| Will not be actioned | `Canceled` | — |

Type labels: `Bug`, `Improvement`, `Feature`. Risk tier: `risk:low`, `risk:medium`, `risk:high`.

## Owner routing

- Claude- or GLM-owned UI implementation issues: label `claude` or `glm`; route to a matching UI worktree/branch. Set state `Todo` (`ready-for-human`) only when a human must act.
- Non-UI implementation issues (DM runtime, data, plumbing, tests, cleanup): label `codex`; `Ready` for Codex agents/subagents.
- Agent-first redesign issues are rooted at `preview/agent-first-redesign`; each PR targets the issue's documented stack parent / Desired base branch, never `main`.

## Continuity rules

Triage changes must preserve Source PRD, Parent issue, dependencies, Deferred scope custody, Explicitly deferred items, Open questions, Do not preclude constraints, Future issue candidates, and scope ledger links.

- `Ready` + engine label means the issue still carries enough context for one issue / one worktree / one PR implementation.
- `Blocked` (needs-info) questions must keep already-established scope and non-decisions intact.
- `Canceled` (wontfix) must not erase deferred capabilities; link where that context is retained.
