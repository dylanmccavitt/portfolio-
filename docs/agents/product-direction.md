# Product direction

This file keeps durable product and operating constraints visible while the
contextual guide and visual redesign are delivered as separate reviewable
leaves.

## Current direction

- DM is the sole public portfolio agent. Eve and the Spotify-style player shell
  are retired product history and must not return as live seams.
- The portfolio remains recruiter-friendly, jargon-light, and static-first
  outside the deliberate guide client island.
- The contextual-guide runtime is the single public guide contract across
  home, library, project, journey, hiring, and fit-check contexts. The server
  validates route context and derives every action from finite public routes or
  same-run evidence; route history never crosses context boundaries.
- The muted Three.js visual system is owned by GitHub issue #307. Its binding
  references live in `docs/design/contextual-guide-reset/`. Three.js remains
  progressive enhancement; core routes and content do not depend on WebGL or
  client JavaScript.

## Public-source and privacy boundary

Public answers may use only:

- published database project records;
- approved public RAG sources;
- static resume and contact data from `src/data/resume.ts`; and
- the owner-approved public profile in `src/data/profile.ts`.

Hidden drafts, private documents, Slack or admin notes, candidate evidence,
visitor chats, credentials, and unsupported or generated claims are never
public answer sources. Database-mode project reads remain published-only and
fail closed. The catalog remains limited to migration/parity, offline
development, and the explicit `catalog_emergency` rollback source.

## Runtime invariants

Retain typed public tools, same-run evidence tracking, rate limiting, metrics,
request cancellation and deadlines, fit-check sanitization, and sanitized
errors. Model and provider selection stays configurable outside the repository;
never commit secrets or provider configuration.

## Delivery and operations

- Agent-first redesign work targets the stack rooted at
  `preview/agent-first-redesign` unless a persisted issue contract says
  otherwise.
- One independently reviewable leaf maps to one issue, writer, worktree,
  branch, and linked pull request.
- Gepetto-managed research and exact-head implementation proof live on the
  owning GitHub issue.
- Merge, deploy, promotion, migration, publication, issue closure, provider
  changes, paid evaluations, and destructive cleanup require explicit gates.
- Keep the durable outbox, review-gated GitHub refresh, and parity-first catalog
  cutover procedures in their dedicated operator documents.

## Deferred work

- Provider-free contract, accessibility, browser, responsive, and visual proof:
  issue #308.
- Production model/provider selection, persistent memory, resume/contact DB
  migration, scheduled refresh/outbox execution, generated visuals, richer
  artifact types, and blog expansion remain future separately authorized work.

## Naming anchors

- DM
- agent-first portfolio
- contextual guide
- Typographic project card
- Editorial project detail
- answer block
- tool trace
- artifact card
- `preview/agent-first-redesign`
