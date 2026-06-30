# Domain Notes

Agents must read repo-specific product and domain docs listed here before broad code exploration.

## Read first for this repo

- `.claude/CLAUDE.md` for current project stack and constraints. Its visual direction can lag active handoffs; prefer the latest handoff/PRD for redesign decisions.
- `.agents/envelope/domain.md` for DM canonical language; latest handoff/PRD wins over stale Eve-era naming.
- `adr/0001-landing-and-entry-ia.md` for landing/entry information architecture history.
- `src/data/catalog.ts` and `src/data/resume.ts` for current canonical project, résumé, and contact content. Catalog becomes a shadow/fallback project source during the DM DB migration; `resume.ts` remains v1 résumé/contact source.
- `docs/agents/scope-ledger.md` for agent-first redesign continuity.

## Product language

- Audience: recruiters and hiring managers first.
- Current redesign north star: an agent-first portfolio where DM answers questions about Dylan and renders project, résumé, and contact artifacts.
- Eve-era runtime code (`src/lib/eve/`, `/api/eve/chat`) is legacy implementation evidence to mine or replace, not new product direction. The old root `agent/` Eve app was retired by AGE-739.
- DM public answers may use only published DB project records, approved public RAG sources, and static résumé/contact data; hidden drafts, private docs, Slack/admin notes, candidate evidence, visitor chats, and unsupported/generated claims stay out of public answers.
- Keep project copy jargon-light and outcome-focused.
- Default to static Astro pages; use client JavaScript only for deliberate interactive islands such as DM chat.
