# Domain glossary

The words specs and issues must use. `blueprint`, `ghosts`, and `main-bus` read
this so planning artifacts speak the repo's language.

## Audience & north star

- **Audience:** recruiters and hiring managers first; write jargon-light, outcome-focused copy.
- **North star:** an **agent-first portfolio** — visitors land on **DM**, the
  portfolio agent that answers questions about Dylan and renders project, résumé,
  and contact artifacts. DM supersedes Eve for new product architecture while the
  experience stays recruiter-friendly, jargon-light, and static-first outside the
  deliberate chat island.

## Canonical nouns (naming anchors)

Use these exact words; avoid synonyms.

- **DM** — the portfolio's public agent for new architecture. Not "the bot",
  "assistant", or "chatbot".
- **Eve** — retired prototype/runtime name (AGE-818). Historically used
  `src/lib/eve/` and `/api/eve/chat`; the old root `agent/` Eve app was retired
  by AGE-739. DM supersedes Eve for all live product seams.
- **agent-first portfolio** — the product framing.
- **Split-canvas landing** — the landing UI hosting DM.
- **Typographic project card** — the canonical project card.
- **Editorial project detail** — the project detail / case-study page.
- **answer block** — DM's structured response unit.
- **tool trace** — the visible record of DM's tool calls.
- **artifact card** — a rendered project/résumé/contact artifact in an answer.
- **player shell** — the retired Spotify-style app shell (sidebar + bottom player bar); removed from the redesign branch and never reintroduced.
- **`preview/agent-first-redesign`** — the redesign stack root branch.

## Bounded contexts

- **Content (migration):** deployed public project reads use published DB rows
  exclusively and fail closed. `src/data/catalog.ts` remains a parity/migration
  input, an offline development source, and an explicit operator emergency
  source until the Loom proof and operational cutover complete in #190;
  `src/data/resume.ts` remains the v1 résumé/contact source.
- **Public DM sources:** DM public answers may use only published DB project
  records, approved public RAG sources, and static résumé/contact data. Never use
  hidden drafts, private docs, Slack/admin notes, candidate evidence, visitor
  chats, or unsupported/generated claims as public answer sources.
- **DM runtime:** the agent/service layer (`src/lib/dm/`), streaming endpoint
  (`/api/dm/chat`), client island (`src/scripts/dm.ts`), and data tools for the
  architecture.
- **Site:** static Astro pages; client JS only for the deliberate DM chat island.

## Read first for this repo

- `docs/agents/scope-ledger.md` — agent-first redesign continuity (north star, deferred scope, do-not-preclude, open questions).
- `adr/0001-landing-and-entry-ia.md` — landing / entry information-architecture history.
- `src/data/catalog.ts` — legacy migration/parity plus local/emergency project content.
- `src/data/resume.ts` — canonical v1 résumé and contact content.

## Style rules

- Keep project copy jargon-light — write for a non-technical reader.
- Default to static Astro pages; reach for client JavaScript only for deliberate
  interactive islands such as DM chat.
