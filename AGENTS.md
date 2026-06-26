# Portfolio

Clean, recruiter-friendly portfolio site. Current visual direction: **shadcn/ui "Sera"** — hard edges, uppercase tracked labels, hairline borders, ring-bordered surfaces, paper/ink feel. Designed for non-technical visitors first (recruiters, hiring managers).

## Stack

- **Astro 5 + TypeScript** — static-first site framework
- **Tailwind** via `@astrojs/tailwind` — utility classes map to CSS-variable design tokens
- **React islands** via `@astrojs/react` where client state is needed (theme toggle, interactive pagers)
- **CSS variables** own the design tokens (colors, spacing, type scale) — see the Sera design handoff for the authoritative values
- **Markdown/MDX** for content collections (projects, log)
- **Deployed** to Vercel or Cloudflare Pages

Default to zero client JS: static `.astro` pages everywhere, React islands only where interactivity actually earns them.

## Design Direction

> **Superseded.** The repo is mid-migration to the **agent-first redesign** (Eve).
> The authoritative product/design direction is now `.agents/envelope/domain.md`
> plus `docs/agents/scope-ledger.md`. The Spotify/player-shell description below is
> historical — the player shell is being retired, not extended.

Current visual direction: the "now playing" player UI — a Spotify-style app shell
(sidebar, scrolling main, persistent bottom player bar) where projects are tracks
and the resume is an album ("The Journey"). Dark-only; tokens are the --pl-* set
in src/styles/player.css. All copy lives in src/data/catalog.ts / resume.ts (no
content collections). Zero client JS except the player-state island
(src/scripts/player.ts, vanilla TS). Retired Sera routes 301 via vercel.json.
Spec: ~/Projects/portfolio-redesign-prototypes/15-player-v4.html.

## Content

- Landing: monogram + numbered nav grid
- About: bio + contact row links
- Projects: index (card grid) + dynamic detail pages from a shared `PROJECTS` array
- Experience: resume button + education/work `dl` blocks
- Log: dated row-link entries
- Contact: row-link channels
- Blog: nice-to-have, not MVP

## Constraints

- Zero client JS by default — progressive enhancement only where needed
- No jargon in project descriptions — write for someone with no coding background

## Workflow

- **No co-author lines** on commits
- **Don't commit** spec/plan docs (`docs/superpowers/`) — those are working files, not repo artifacts
- Dev environment runs inside a Distrobox container

## Agent skills

This repo runs the Factorio workflow kit. The per-repo envelope is the single
binding point — read it before planning or building:

- `.agents/envelope/linear-map.md` — Linear team (`dmcc`/AGE) + Portfolio project, labels, states, the inserter triage map, and the GitHub bridge.
- `.agents/envelope/domain.md` — domain glossary (Eve, Split-canvas landing, Typographic card, Editorial detail, answer block, artifact card).
- `.agents/envelope/commands.md` — build/test/lint/run + default branch and the redesign stack.
- `.agents/envelope/templates/` — PR / issue / project-doc templates.

Repo-specific skills and agents live in `.agents/skills/` and `.agents/agents/`.
Continuity for the agent-first redesign is tracked in `docs/agents/scope-ledger.md`.
