# Scope Ledger

Use this file to keep product intent alive after work is sliced into issues. V1 is an execution boundary, not the product vision.

## Product north star

The portfolio becomes agent-first: visitors land on DM, a public agent that answers questions about Dylan and his work, backed by published project records, approved public sources, résumé data, and contact data. The experience stays recruiter-friendly, jargon-light, and static-first outside the deliberate chat island.

DM supersedes Eve for new product architecture. Eve runtime paths (`src/lib/eve/`, `/api/eve/chat`) were retired in AGE-818; do not resurrect Eve-specific product seams. The old root `agent/` Eve app was retired by AGE-739 when the public DM Vercel AI SDK seam replaced the remote Eve app dependency.

Public DM answers may use only published DB project records, approved public RAG sources, static résumé/contact data from `src/data/resume.ts`, and the owner-approved static public profile in `src/data/profile.ts`. Hidden drafts, private docs, Slack/admin notes, candidate evidence, visitor chats, and unsupported/generated claims stay out of public answers.

DM v2 runtime validation follows
[`docs/agents/dm-validator-governance.md`](./dm-validator-governance.md): hard
controls protect structure, same-run provenance, private-source exclusion, and
operations, while answer quality and semantic privacy wording remain evaluated
behavior. The rule does not weaken the published-project, approved-public-RAG,
or canonical résumé/contact source boundary above.

## PRD continuity

The 2026-06-26 Integrated DM content backend PRD supersedes the 2026-06-18 Eve-specific future architecture while preserving useful UI/runtime evidence from that prototype slice.

- Source DM PRD: Linear document `Integrated DM content backend and agent workflow PRD`.
- Planning buildout: Linear document `DM implementation planning buildout`.
- Acceptance criterion: Persisted GitHub delivery contracts preserve DM naming,
  the approved preview stack parent, and one independently reviewable leaf with
  one writer, worktree, branch, and pull request coordinated through Gepetto.
- Expected evidence: The owning GitHub issue persists the approved research and
  implementation contract, links this ledger, and binds proof to the live pull
  request head.
- Actual evidence: the preview branch contains the live DM runtime, Split-canvas
  landing, Typographic project cards, Editorial details, DB/admin/Slack seams,
  and the implementation history recorded by GitHub issues #184–#196. Those
  issues are closed historical locators; their state does not prove that
  separately authorized preview or production operations were performed.

## Now

- DM is the sole live runtime on `preview/agent-first-redesign`
  (`src/lib/dm/`, `/api/dm/chat`, `src/scripts/dm.ts`).
- GitHub discovery, Slack staging, authenticated admin review, and atomic publish
  are implemented. Slack creates or edits review drafts; it never publishes.
- Preview migrations must be applied before code that depends on them is
  deployed. `0003_recruiter_project_areas.sql` and
  `0004_source_identity_and_refresh_drafts.sql` are required for the current
  public-read and admin-detail contracts.
- Deployed database mode now returns published DB rows only and fails closed on
  missing configuration, read/validation failure, or an unexpected empty set.
  `src/data/catalog.ts` remains only for parity/migration, offline development,
  and the explicit operator `catalog_emergency` rollback. This source-boundary
  hardening does not itself prove the Loom cutover or any deployment gate.
- The reviewed implementation includes the 0006 cutover function and direct
  public-slug route reads. The function is invoked only by the explicitly
  applied, parity-first operator command; it preserves DB-only Loom and queues
  one durable static-artifact refresh.
- Keep `src/data/resume.ts` as the v1 résumé/contact source.
- Keep `src/data/profile.ts` as the owner-approved public-profile source; its production loader exposes only well-formed published/public entries, while the site brief receives only the approved short-bio summary.
- Before an approved Loom refresh, explicitly adopt Loom's authenticated,
  immutable GitHub repository id onto the reviewed published project id using
  [`docs/agents/github-refresh.md`](./github-refresh.md); never infer identity
  from a slug.
- Process publication side effects through the durable versioned outbox
  documented in [`docs/agents/publish-outbox.md`](./publish-outbox.md);
  publishing never waits for OpenAI or a deploy hook.

## Next

- Obtain each preview approval in order: 0006 migration, environment/cron/
  deploy-hook configuration, Loom repository-id adoption and real scan, then
  admin publish. Repository implementation and closed issues do not supply
  those approvals. Do not mutate production.
- Complete the authorized parity-first 0006 cutover and approved Loom publish,
  then prove
  `/library`, `/projects/loom`, DM, RAG, sitemap, and OG against the reviewed
  deployment SHA while recording the synthetic-draft exclusion evidence.
- Execute the fail-closed safeguards and
  [`release-gates.md`](./release-gates.md) checklist for the exact candidate
  before promoting the redesign to production.

## Later

- Blog/log expansion remains optional.
- Richer artifact types can be added after the answer-block contract proves stable.
- Review-gated existing-project refresh is implemented. Scheduling refresh
  scans remains deferred until its configuration and execution have durable,
  exact-candidate proof; closed historical issue #193 does not provide that
  operational proof.
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
- Capability: Profile database, admin publication, or automated owner interview.
  - Why deferred: The current source is a deliberately small static corpus whose nine entries received explicit owner approval.
  - Where tracked: Future issue candidates below.
  - Constraint imposed on Now: Keep profile loading behind the typed public seam, and never infer or publish additions without renewed owner approval.
- Capability: Resume/contact DB migration.
  - Why deferred: V1 keeps résumé/contact in `src/data/resume.ts` while project records move first.
  - Where tracked: Future issue candidates below.
  - Constraint imposed on Now: Keep DM source seams separate so résumé/contact can move later without mixing with project publish state.
- Capability: Generated visuals.
  - Why deferred: Public project pages and DM artifacts should use real screenshots/demos only when available.
  - Where tracked: Future issue candidates below.
  - Constraint imposed on Now: Do not claim generated visuals as proof or public evidence.
- Capability: Scheduled GitHub refresh scans.
  - Why deferred: The implemented manual/Slack review-gated refresh does not itself configure or authorize background scheduling.
  - Where tracked: Historical GitHub issues #188 and #193 plus [`docs/agents/github-refresh.md`](./github-refresh.md); a future execution record must provide durable proof of any active schedule.
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
- Capability: Scheduled outbox execution.
  - Why deferred: The authenticated bounded worker is implemented, but that
    does not authorize Vercel cron, deploy-hook, preview, or production config.
  - Where tracked: [`docs/agents/publish-outbox.md`](./publish-outbox.md) and
    [`docs/agents/release-gates.md`](./release-gates.md); historical issues #189
    and #192 are implementation locators only.
  - Constraint imposed on Now: Jobs remain durable and safely retryable until
    a maintainer applies migration/configuration and schedules the worker.

## Do not preclude

- Constraint: Redesign implementation PRs form a stacked chain rooted at `preview/agent-first-redesign`, never `main`.
  - Deferred capability protected: Safe stacked preview before mainline merge.
  - Verification evidence: PR base branch matches the issue's stack parent branch.
- Constraint: One implementation issue maps to one worktree, one branch, and one PR.
  - Deferred capability protected: Parallel agent ownership without hidden coupling.
  - Verification evidence: Issue packet and PR link.
- Constraint: Gepetto is the sole coordinator for tracked delivery, with the
  approved research and implementation contract persisted on the owning GitHub
  issue.
  - Deferred capability protected: One auditable path from scope approval through exact-head review without competing routing systems.
  - Verification evidence: The issue's managed research and implementation sections bind one leaf to the live pull request head.
- Constraint: DM public answers use only published DB project records, approved public RAG sources, static résumé/contact data, and the owner-approved static public profile.
  - Deferred capability protected: Privacy-safe RAG and publish flow.
  - Verification evidence: Runtime/eval fixtures or PR review evidence prove drafts/private/candidate data stay excluded.
- Constraint: Golden-conversation eval families with unapproved profile, project, RAG, or site facts remain checked source-gap cases.
  - Deferred capability protected: #267 profile publication and later approved content can activate richer goldens without teaching the release harness to treat drafts or catalog migration data as public evidence.
  - Verification evidence: `DM_GOLDEN_SOURCE_STATUS` covers all twelve families and corpus tests require honest limitations for every source gap.
- Constraint: Do not resurrect Eve-specific runtime paths retired in AGE-818.
  - Deferred capability protected: DM remains the sole live agent runtime seam.
  - Verification evidence: Live stack uses `src/lib/dm/` and `/api/dm/chat`; Eve paths removed in AGE-818; root `agent/` removal is recorded in AGE-739.
- Constraint: Do not reintroduce the retired player shell while the redesign is
  release-gated for production promotion.
  - Deferred capability protected: Safe promotion without reviving duplicate navigation.
  - Verification evidence: Preview build and route smoke checks cover every replacement route.

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

- Title: Migrate the owner-approved public profile to reviewed DB/admin publication
  - Type: HITL
  - Depends on: Static public-profile source proving the typed runtime seam
  - Preserves: Explicit owner approval before any profile fact becomes public
- Title: Add an automated owner profile interview workflow
  - Type: HITL
  - Depends on: Private-to-public review gates and a concrete authoring need
  - Preserves: Draft collection without inference or automatic publication
- Title: Add persistent DM memory
  - Type: HITL
  - Depends on: Public DM service seam
  - Preserves: Multi-turn personalization
- Title: Migrate résumé/contact data to DB
  - Type: AFK
  - Depends on: Project DB cutover
  - Preserves: Unified content management without blocking v1
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
