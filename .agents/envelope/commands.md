# Commands

The real commands, copied from `package.json`. `roboports`, `rocket-launch`,
`modules`, and `quality` read these instead of inventing commands.

| Purpose    | Command            | Underlying |
| ---------- | ------------------ | ---------- |
| Install    | `npm install`      | — |
| Dev server | `npm run dev`      | `astro dev` |
| Build      | `npm run build`    | `astro build` |
| Preview    | `npm run preview`  | `astro preview` |
| Lint       | `npm run lint`     | `eslint .` |
| Typecheck  | `npm run typecheck`| `astro check` |
| DM runtime test | `npm run test:dm` | `node --import tsx --test tests/dm-runtime.test.ts` |
| Legacy Eve test | `npm run test:eve` | `node --import tsx --test tests/eve-runtime.test.ts` |

## Verify gate

Run before calling work complete (also `npm run verify`):

```
npm run lint && npm run typecheck && npm run build
```

Add `npm run test:dm` when the change touches the public DM runtime/API seam.
Add `npm run test:eve` when the change touches legacy Eve runtime/tool paths
that remain as migration evidence (`src/lib/eve/`, `/api/eve/chat`, or
`tests/eve-runtime.test.ts`).

## Branches

- **Default branch:** `main`.
- **Redesign stack root:** `preview/agent-first-redesign`. Agent-first redesign
  PRs target their immediate stack parent, never `main`, until a maintainer
  changes the plan.
- **Legacy Eve stack order:** `preview/agent-first-redesign` →
  `codex/issue-84-eve-runtime` → `claude/issue-85-typographic-card` →
  `claude/issue-86-eve-landing` → `claude/issue-87-editorial-detail` →
  `codex/issue-88-retire-shell`. These branch names remain historical stack
  parents; new DM implementation issues use their issue packet's Desired base
  branch, currently `preview/agent-first-redesign` unless a maintainer changes it.

## Runtime

- Node `24.x` (see `engines` in `package.json`, `mise.toml`, `.node-version`, and `.nvmrc`).
- Dev environment runs inside a Distrobox container.
- Deployed to Vercel (`@astrojs/vercel`; see `vercel.json`).
- Model/provider for DM, and for any legacy Eve runtime kept during migration, is configured via Vercel env vars — never commit secrets.
