# Domain glossary

The words specs and issues must use. `blueprint`, `ghosts`, and `main-bus` read
this so planning artifacts speak the repo's language.

## Audience & north star

- **Audience:** recruiters and hiring managers first; write jargon-light, outcome-focused copy.
- **North star:** an **agent-first portfolio** — visitors land on **Eve**, a chat
  agent that answers questions about Dylan and renders project, résumé, and
  contact artifacts. Recruiter-friendly, jargon-light, static-first outside the
  deliberate chat island.

## Canonical nouns (naming anchors)

Use these exact words; avoid synonyms.

- **Eve** — the portfolio's chat agent. Not "the bot", "assistant", or "chatbot".
- **agent-first portfolio** — the product framing.
- **Split-canvas landing** — the landing UI hosting Eve.
- **Typographic project card** — the canonical project card.
- **Editorial project detail** — the project detail / case-study page.
- **answer block** — Eve's structured response unit.
- **tool trace** — the visible record of Eve's tool calls.
- **artifact card** — a rendered project/résumé/contact artifact in an answer.
- **player shell** — the retired Spotify-style app shell (sidebar + bottom player bar); being replaced, not extended.
- **`preview/agent-first-redesign`** — the redesign stack root branch.

## Bounded contexts

- **Content (canonical):** `src/data/catalog.ts` (projects) and
  `src/data/resume.ts` (résumé + contact). Single source of truth — Eve tools and
  static pages share these facts; never duplicate project or résumé content.
- **Eve runtime:** the agent + streaming endpoint + data tools (`agent/`, server route).
- **Site:** static Astro pages; client JS only for the deliberate Eve chat island.

## Read first for this repo

- `docs/agents/scope-ledger.md` — agent-first redesign continuity (north star, deferred scope, do-not-preclude, open questions).
- `adr/0001-landing-and-entry-ia.md` — landing / entry information-architecture history.
- `src/data/catalog.ts`, `src/data/resume.ts` — canonical project, résumé, and contact content.

## Style rules

- Keep project copy jargon-light — write for a non-technical reader.
- Default to static Astro pages; reach for client JavaScript only for deliberate
  interactive islands such as Eve chat.
