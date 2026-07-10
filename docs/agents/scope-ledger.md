# Scope Ledger

Use this file to keep product intent alive after work is sliced into issues. V1 is an execution boundary, not the product vision.

## Product north star

The portfolio becomes agent-first: visitors land on DM, a public agent that answers questions about Dylan and his work, backed by published project records, approved public sources, résumé data, and contact data. The experience stays recruiter-friendly, jargon-light, and static-first outside the deliberate chat island.

DM supersedes Eve for new product architecture. Eve runtime paths (`src/lib/eve/`, `/api/eve/chat`) were retired in AGE-818; do not resurrect Eve-specific product seams. The old root `agent/` Eve app was retired by AGE-739 when the public DM Vercel AI SDK seam replaced the remote Eve app dependency.

Public DM answers may use only published DB project records, approved public RAG sources, and static résumé/contact data from `src/data/resume.ts`. Hidden drafts, private docs, Slack/admin notes, candidate evidence, visitor chats, and unsupported/generated claims stay out of public answers.

## PRD continuity

The 2026-06-26 Integrated DM content backend PRD supersedes the 2026-06-18 Eve-specific future architecture while preserving useful UI/runtime evidence from that prototype slice.

- Source DM PRD: Linear document `Integrated DM content backend and agent workflow PRD`.
- Planning buildout: Linear document `DM implementation planning buildout`.
- Legacy prototype plan: `/var/folders/kk/k4gwllpx1cb8yl9n5t1stn8h0000gn/T/handoff-portfolio-agent-redesign.md`.
- Acceptance criterion: Issues preserve DM naming, preview-branch base, one issue / one worktree / one PR, and Claude/GLM-vs-Codex ownership.
- Expected evidence: PRD issue plus child issue packets link this ledger and name continuity constraints.
- Actual evidence: Filled during issue closeout.

## Now

- Superseded Eve with DM in repo planning/domain docs (Eve runtime retired in AGE-818).
- Build the DM implementation graph on preview branch `preview/agent-first-redesign`.
- DM is the sole live runtime (`src/lib/dm/`, `/api/dm/chat`, `src/scripts/dm.ts`).
- Use Neon on Vercel for the DB foundation; keep secrets out of tracked files.
- Keep `src/data/catalog.ts` as a shadow/fallback public project source until parity plus one-publish proof; keep `src/data/resume.ts` as the v1 résumé/contact source.
- Before issue #190 proves Loom refresh on preview, explicitly adopt Loom's
  authenticated immutable GitHub repository id onto its reviewed published
  project id using `docs/agents/github-refresh.md`; never infer that link from
  a matching slug. Preview adoption still requires separate user approval.

## Next

- Implement DB foundation, catalog shadow import, and DB-backed read layer before public project cutover.
- Add the public DM service seam on Vercel AI SDK after DB read-layer prerequisites are ready.
- Add approved-source RAG ingestion/search with official OpenAI JS SDK vector/file lifecycle only after admin publish gates exist.
- Keep Slack install/auth/setup as human-in-the-loop for the Slack control-plane issue.

## Later

- Blog/log expansion remains optional.
- Richer artifact types can be added after the answer-block contract proves stable.
- Review-gated existing-project refresh is implemented by GitHub issue #188;
  scheduling refresh scans remains deferred to #193.
- Resume/contact DB migration follows the project DB cutover.

## Explicitly deferred

- Capability: Production model/provider selection.
  - Why deferred: Provider keys live in Vercel env and are not in the repo.
  - Where tracked: Public DM service issue.
  - Constraint imposed on Now: Runtime code must keep model/provider configurable without committing secrets.
- Capability: Persistent agent memory or personalization.
  - Why deferred: The first slice only needs streamed answers over approved public sources.
  - Where tracked: Future issue candidates below.
  - Constraint imposed on Now: Do not bake UI or API assumptions that prevent later conversation state.
- Capability: Resume/contact DB migration.
  - Why deferred: V1 keeps résumé/contact in `src/data/resume.ts` while project records move first.
  - Where tracked: Future issue candidates below.
  - Constraint imposed on Now: Keep DM source seams separate so résumé/contact can move later without mixing with project publish state.
- Capability: Generated visuals.
  - Why deferred: Public project pages and DM artifacts should use real screenshots/demos only when available.
  - Where tracked: Future issue candidates below.
  - Constraint imposed on Now: Do not claim generated visuals as proof or public evidence.
- Capability: Scheduled GitHub refresh scans.
  - Why deferred: Issue #188 deliberately ships a manual/Slack review-gated refresh before background scheduling.
  - Where tracked: GitHub issue #193.
  - Constraint imposed on Now: Source identity and revision idempotency must remain trigger-neutral.
- Capability: OpenAI Agents SDK orchestration.
  - Why deferred: V1 public DM route defaults to Vercel AI SDK and typed services.
  - Where tracked: Future issue candidates below or a later issue that names the orchestration need.
  - Constraint imposed on Now: Use Agents SDK only if a concrete workflow needs handoffs, guardrails, tracing, sandboxing, or specialist takeover.
- Capability: Blog/log MVP expansion.
  - Why deferred: Handoff names blog as nice-to-have, not MVP.
  - Where tracked: Future issue candidates below.
  - Constraint imposed on Now: Do not remove routes/data patterns that make future writing sections possible.
- Capability: Automated DB migration on deploy.
  - Why deferred: AGE-803 split removes the topology blocker: production deploys target the Neon production branch, and preview deploys target the static `preview` branch. Auto-migration remains deferred because it is unbuilt and needs its own issue.
  - Where tracked: Future issue candidates below.
  - Constraint imposed on Now: Every new file under `db/migrations/` requires two manual applies before deployed code depends on it: once with the production connection string, once with the `preview` branch connection string, using the same idempotent Neon-HTTP-safe runner (see `docs/agents/db-foundation.md`). Migrations must stay statement-idempotent (`IF NOT EXISTS` et al.) because the Neon HTTP driver runs them without transactions.

## Do not preclude

- Constraint: Redesign implementation PRs form a stacked chain rooted at `preview/agent-first-redesign`, never `main`.
  - Deferred capability protected: Safe stacked preview before mainline merge.
  - Verification evidence: PR base branch matches the issue's stack parent branch.
- Constraint: One implementation issue maps to one worktree, one branch, and one PR.
  - Deferred capability protected: Parallel agent ownership without hidden coupling.
  - Verification evidence: Issue packet and PR link.
- Constraint: UI implementation routes to Claude or GLM; non-UI runtime/data/plumbing routes to Codex.
  - Deferred capability protected: Correct agent specialization.
  - Verification evidence: Owner engine field on every issue.
- Constraint: DM public answers use only published DB project records, approved public RAG sources, and static résumé/contact data.
  - Deferred capability protected: Privacy-safe RAG and publish flow.
  - Verification evidence: Runtime/eval fixtures or PR review evidence prove drafts/private/candidate data stay excluded.
- Constraint: Do not resurrect Eve-specific runtime paths retired in AGE-818.
  - Deferred capability protected: DM remains the sole live agent runtime seam.
  - Verification evidence: Live stack uses `src/lib/dm/` and `/api/dm/chat`; Eve paths removed in AGE-818; root `agent/` removal is recorded in AGE-739.
- Constraint: Retire the player shell only after replacement UI slices cover production routes.
  - Deferred capability protected: No broken route while migrating.
  - Verification evidence: Build plus route smoke checks.

## Naming anchors

- DM
- Eve (retired in AGE-818; DM supersedes Eve — historical naming only)
- agent-first portfolio
- Split-canvas landing
- Typographic project card
- Editorial project detail
- answer block
- tool trace
- artifact card
- `preview/agent-first-redesign`

## Open questions

- Question: Which model/provider powers DM in production?
  - Owner: Maintainer
  - Needed before: Production deploy configuration
- Question: Exact final DM tool I/O shapes beyond the prototype answer-block contract?
  - Owner: Public DM service issue owner
  - Needed before: Runtime/landing integration closeout
- Question: Whether any background workflow truly needs OpenAI Agents SDK in v1.
  - Owner: Issue owner proposing orchestration
  - Needed before: Adding Agents SDK to the runtime path

## Future issue candidates

- Title: Add persistent DM memory
  - Type: HITL
  - Depends on: Public DM service seam
  - Preserves: Multi-turn personalization
- Title: Migrate résumé/contact data to DB
  - Type: AFK
  - Depends on: Project DB cutover
  - Preserves: Unified content management without blocking v1
- Title: Schedule GitHub refreshes into reviewed drafts
  - Type: AFK
  - Depends on: GitHub issue #188 review-gated refresh workflow
  - Preserves: Background discovery without automatic public promotion
- Title: Evaluate Agents SDK orchestration
  - Type: AFK
  - Depends on: A workflow with concrete handoff/guardrail/tracing/sandbox needs
  - Preserves: Optional orchestration without over-wrapping simple routes
- Title: Add richer artifact types
  - Type: AFK
  - Depends on: Stable answer-block contract
  - Preserves: Extensible DM responses
- Title: Expand blog/log content
  - Type: AFK
  - Depends on: Agent-first V1
  - Preserves: Long-form writing surface
- Title: Automate DB migration on deploy
  - Type: AFK
  - Depends on: AGE-803 preview/prod Neon branch split landed and verified
  - Preserves: Two-target manual migration custody until an automated step exists for both branches
