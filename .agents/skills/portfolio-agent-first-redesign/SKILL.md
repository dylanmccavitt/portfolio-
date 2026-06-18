---
name: portfolio-agent-first-redesign
description: Use when working on the portfolio agent-first redesign, Eve runtime, Split-canvas landing, Typographic cards, Editorial project pages, or retiring the Spotify/player shell.
---

# Portfolio Agent-First Redesign

## Read first

1. `.omp/AGENTS.md`
2. `docs/agents/issue-tracker.md`
3. `docs/agents/domain.md`
4. `docs/agents/scope-ledger.md`
5. The source PRD or issue packet for the current worktree

## Invariants

- Target the issue packet's Desired base branch / immediate stack parent; never target `main` unless a maintainer changes the plan.
- Keep one issue / one worktree / one branch / one PR.
- UI implementation routes to Claude.
- Eve runtime, data tools, endpoint plumbing, tests, and cleanup route to Codex agents/subagents.
- Use `src/data/catalog.ts` and `src/data/resume.ts` as canonical content; do not duplicate project or résumé facts.
- Keep copy recruiter-first and jargon-light.
- Preserve static Astro pages except the deliberate Eve chat island and server endpoint.

## Locked design decisions

- Landing: Eve Split-canvas agent UI from `src/pages/prototype/_AgentVariantB.astro`.
- Cards: Typographic project card from `src/pages/prototype/_CardsVariantB.astro`.
- Detail pages: Editorial case study from `src/pages/prototype/_ProjectVariantA.astro`.
- Retire the Spotify/player shell after replacement production routes exist.
