# Product direction

This file keeps durable product and operating constraints visible. It is the
sole authority for product names and for DM's public-source and privacy
boundary; do not restate either elsewhere.

## Current direction

- DM is the sole public portfolio agent. It is being replanned from scratch:
  the previous implementation was deleted whole (#352/#353) and nothing from it
  is inherited. Until the replan lands, the Ask DM button opens a
  "being rebuilt" panel with a direct email link.
- Eve and the Spotify-style player shell are retired product history and must
  not return as live seams.
- The portfolio remains recruiter-friendly, jargon-light, and static-first.
  Every page prerenders; core routes and content do not depend on client
  JavaScript or WebGL.

## Public-source and privacy boundary

Public answers may use only:

- the published project catalog in `src/data/catalog.ts`;
- static resume and contact data from `src/data/resume.ts`; and
- the owner-approved public profile in `src/data/profile.ts`.

Hidden drafts, private documents, private notes, candidate evidence, visitor
chats, credentials, and unsupported or generated claims are never public answer
sources. Any future DM runtime must enforce this boundary and fail closed.

## Runtime invariants

Any rebuilt DM runtime keeps rate limiting, request cancellation and deadlines,
and sanitized errors. Model and provider selection stays configurable outside
the repository; never commit secrets or provider configuration.

## Delivery and operations

- Agent-first redesign work targets `preview/agent-first-redesign`.
- One independently reviewable piece of work maps to one issue, branch, and
  linked pull request when tracked delivery is in use.
- Merge, deploy, promotion, publication, issue closure, provider changes, paid
  evaluations, and destructive cleanup require explicit gates.

## Deferred work

- The DM replan itself: scope, architecture, grounding, and behavior are open
  decisions tracked on the decision shelf, not in this file.
- Any reinstated publication workflow, scheduled refresh, or content-operations
  surface is new work, not a restoration — the previous implementations are
  deleted, not parked.

## Naming anchors

- DM
- agent-first portfolio
- Signal Frost
- `preview/agent-first-redesign`
