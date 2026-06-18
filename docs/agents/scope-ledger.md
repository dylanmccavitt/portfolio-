# Scope Ledger

Use this file to keep product intent alive after work is sliced into issues. V1 is an execution boundary, not the product vision.

## Product north star

The portfolio becomes agent-first: visitors land on Eve, a chat agent that answers questions about Dylan and his work, backed by project, résumé, and contact data. The experience stays recruiter-friendly, jargon-light, and static-first outside the deliberate chat island.

## PRD continuity

The PRD created from the 2026-06-18 handoff records the locked decisions from the prototype session and the implementation routing rule.

- Source grilled plan: `/var/folders/kk/k4gwllpx1cb8yl9n5t1stn8h0000gn/T/handoff-portfolio-agent-redesign.md`
- Acceptance criterion: Issues preserve locked prototype decisions, preview-branch base, one issue / one worktree / one PR, and Claude-vs-Codex ownership.
- Expected evidence: PRD issue plus child issue packets link this ledger and name continuity constraints.
- Actual evidence: Filled during issue closeout.

## Now

- Build the agent-first redesign on preview branch `preview/agent-first-redesign`.
- Create Eve agent runtime and streaming endpoint.
- Rebuild landing as the Split-canvas agent UI.
- Establish the Typographic project card as the canonical card.
- Rebuild project detail pages as Editorial case studies.
- Retire the Spotify/player shell after replacements exist.
- Keep content sourced from `src/data/catalog.ts` and `src/data/resume.ts`.

## Next

- Select the production model/provider once Vercel environment variables are available.
- Extend Eve tools only after the first streaming path works end-to-end.
- Add deeper evaluation or analytics only after the agent-first V1 is stable.

## Later

- Blog/log expansion remains optional.
- Richer agent memory, personalization, or multi-turn persistence remains outside the first redesign slice.
- Additional artifact types can be added after the answer-block contract proves stable.

## Explicitly deferred

- Capability: Production model/provider selection.
  - Why deferred: Provider keys live in Vercel env and are not in the repo.
  - Where tracked: Eve runtime issue.
  - Constraint imposed on Now: Runtime code must keep model/provider configurable without committing secrets.
- Capability: Persistent agent memory or personalization.
  - Why deferred: The first slice only needs streamed answers over canonical site data.
  - Where tracked: Future issue candidates below.
  - Constraint imposed on Now: Do not bake UI or API assumptions that prevent later conversation state.
- Capability: Blog/log MVP expansion.
  - Why deferred: Handoff names blog as nice-to-have, not MVP.
  - Where tracked: Future issue candidates below.
  - Constraint imposed on Now: Do not remove routes/data patterns that make future writing sections possible.

## Do not preclude

- Constraint: Redesign implementation PRs form a stacked chain rooted at `preview/agent-first-redesign`, never `main`.
  - Deferred capability protected: Safe stacked preview before mainline merge.
  - Verification evidence: PR base branch matches the issue's stack parent branch.
- Constraint: One implementation issue maps to one worktree, one branch, and one PR.
  - Deferred capability protected: Parallel agent ownership without hidden coupling.
  - Verification evidence: Issue packet and PR link.
- Constraint: UI implementation routes to Claude; non-UI runtime/data/plumbing routes to Codex.
  - Deferred capability protected: Correct agent specialization.
  - Verification evidence: Owner engine field on every issue.
- Constraint: Keep project and résumé content canonical in source data modules.
  - Deferred capability protected: Eve tools and static pages share the same facts.
  - Verification evidence: Runtime/tool tests or PR review evidence.
- Constraint: Retire the player shell only after replacement UI slices cover production routes.
  - Deferred capability protected: No broken route while migrating.
  - Verification evidence: Build plus route smoke checks.

## Naming anchors

- Eve
- agent-first portfolio
- Split-canvas landing
- Typographic project card
- Editorial project detail
- answer block
- tool trace
- artifact card
- `preview/agent-first-redesign`

## Open questions

- Question: Which model/provider powers Eve in production?
  - Owner: Maintainer
  - Needed before: Production deploy configuration
- Question: Exact final tool I/O shapes beyond the prototype answer-block contract?
  - Owner: Eve runtime issue owner
  - Needed before: Runtime/landing integration closeout

## Future issue candidates

- Title: Add persistent agent memory
  - Type: HITL
  - Depends on: Eve streaming endpoint
  - Preserves: Multi-turn personalization
- Title: Add richer artifact types
  - Type: AFK
  - Depends on: Stable answer-block contract
  - Preserves: Extensible Eve responses
- Title: Expand blog/log content
  - Type: AFK
  - Depends on: Agent-first V1
  - Preserves: Long-form writing surface
