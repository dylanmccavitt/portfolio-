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

- **Sera** aesthetic — hairline borders, uppercase tracked labels, hard edges, paper/ink feel
- Mobile-first responsive design
- Project descriptions: concise paragraphs + screenshots/visuals, not longform case studies
- Quality over quantity
- Design handoff: `~/Downloads/design_handoff_portfolio_v2/` (README + Portfolio.html prototype + screenshots)

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
- **Don't commit** — only `git add` changed files so they show as staged. Dylan reviews and commits from Zed.
- **Don't commit** spec/plan docs (`docs/superpowers/`) — those are working files, not repo artifacts
- Dev environment runs inside a Distrobox container
