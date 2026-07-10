---
name: portfolio-agent-first-redesign
description: Use when working on the portfolio agent-first redesign, DM runtime, Split-canvas landing, Typographic cards, Editorial project pages, or retiring the Spotify/player shell.
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
- Use published DB project records exclusively in deployed database mode and fail closed when they cannot be read. Keep `src/data/catalog.ts` only for migration/parity, offline development, and explicit `catalog_emergency`; use `src/data/resume.ts` for v1 résumé/contact facts. Do not duplicate project or résumé facts.
- Keep copy recruiter-first and jargon-light.
- Preserve static Astro pages except the deliberate DM chat island and server endpoint.

## Locked design decisions

- Landing: the live Split-canvas agent UI is `src/pages/index.astro` with `src/layouts/DM.astro`; DM is the only product seam.
- Cards: the live Typographic project card is `src/components/ProjectCard.astro`, composed by `src/components/ProjectCardGrid.astro`.
- Detail pages: the live Editorial project detail is `src/pages/projects/[id].astro`.
- The Spotify/player shell is retired on the redesign branch. Keep only the shared tokens and primitives still used by live layouts; do not recreate its navigation or player bar.
