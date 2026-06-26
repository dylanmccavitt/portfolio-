---
name: portfolio-agent-first-redesign
description: Use when working on the portfolio agent-first redesign, DM runtime, legacy Eve runtime migration, Split-canvas landing, Typographic cards, Editorial project pages, or retiring the Spotify/player shell.
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
- UI implementation routes to Claude or GLM.
- DM runtime, data tools, endpoint plumbing, tests, and cleanup route to Codex agents/subagents.
- Use published DB project records when available, `src/data/catalog.ts` as shadow fallback during migration, and `src/data/resume.ts` for v1 résumé/contact facts; do not duplicate project or résumé facts.
- Keep copy recruiter-first and jargon-light.
- Preserve static Astro pages except the deliberate DM chat island and server endpoint.

## Locked design decisions

- Landing: Split-canvas agent UI from `src/pages/prototype/_AgentVariantB.astro`; treat Eve naming there as legacy prototype naming and DM as the product seam.
- Cards: Typographic project card from `src/pages/prototype/_CardsVariantB.astro`.
- Detail pages: Editorial case study from `src/pages/prototype/_ProjectVariantA.astro`.
- Retire the Spotify/player shell after replacement production routes exist.
