# Linear map

The single binding between this repo and its tracker. Every kit skill reads this
instead of hardcoding a team, project, label, or state.

## Tracker

- **Provider:** Linear (workspace `dylanmccavitt`).
- **Team:** `dmcc` — key **`AGE`** (issue ids are `AGE-<n>`, e.g. `AGE-140`).
- **Team id:** `e513928d-f3e5-4a7c-955a-786a47287d02`

## Project

- **Name:** Portfolio
- **Id:** `d8fe2c9f-204f-48ce-9379-5860953cef3b`
- **URL:** https://linear.app/dylanmccavitt/project/portfolio-223e64d516be

All portfolio issues land in the **Portfolio** project under the **dmcc** team.

## Labels

The repo's working label vocabulary (team `dmcc`). Apply the type + engine on
every implementation issue; add risk as triage dictates.

- **Type:** `Bug`, `Improvement`, `Feature`
- **Engine routing:**
  - `claude` or `glm` — UI / layout / presentation work.
  - `codex` — DM/runtime, data tools, endpoint plumbing, tests, cleanup.
- **Risk tier:** `risk:low`, `risk:medium`, `risk:high`

## States → inserter triage roles

`inserter` reads this map; it never hardcodes a state.

| Triage role        | Linear state | Notes |
| ------------------ | ------------ | ----- |
| `needs-triage`     | `Triage`     | New, unsorted. |
| `needs-info`       | `Blocked`    | Waiting on reporter / missing info. |
| `ready-for-agent`  | `Ready`      | + engine label (`claude`/`glm` for UI, `codex` for non-UI). |
| `ready-for-human`  | `Todo`       | A human must implement. |
| `wontfix`          | `Canceled`   | Will not be actioned; preserve deferred-scope links before cancelling. |

Full state set (team `dmcc`): Triage, Backlog, Todo, Ready, In Progress, Rework,
Blocked, In Review, Human Review, Needs Fixes, Merging, Done, Canceled, Duplicate.

## GitHub bridge

- **Repo:** `DylanMcCavitt/portfolio-` (GitHub Issues remain for legacy #84–#88;
  new work is tracked in Linear).
- **Convention:** the branch name carries the Linear issue id, so the PR
  auto-links to the issue and the merge auto-closes it through Linear's GitHub
  integration.
- **Branch shape:** `<engine>/<issue-id-lower>-<slug>`
  (e.g. `claude/age-141-dm-landing`, `glm/age-141-dm-landing`, `codex/age-142-dm-runtime`).
- **Default branch:** `main`. Agent-first redesign PRs stack from
  `preview/agent-first-redesign` and target their immediate stack parent, never
  `main`, until a maintainer changes the plan. See `commands.md` for the chain.

## Routing

- One issue / one worktree / one branch / one PR.
- UI implementation → `claude` or `glm`; DM runtime / data / plumbing / tests / cleanup → `codex`.
