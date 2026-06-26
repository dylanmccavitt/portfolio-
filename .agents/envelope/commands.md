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
| Test       | `npm run test:eve` | `node --import tsx --test tests/eve-runtime.test.ts` |

## Verify gate

Run before calling work complete (also `npm run verify`):

```
npm run lint && npm run typecheck && npm run build
```

Add `npm run test:eve` when the change touches the Eve runtime / tools
(`agent/`, the streaming endpoint, or `tests/eve-runtime.test.ts`).

## Branches

- **Default branch:** `main`.
- **Redesign stack root:** `preview/agent-first-redesign`. Agent-first redesign
  PRs target their immediate stack parent, never `main`, until a maintainer
  changes the plan.
- **Stack order:** `preview/agent-first-redesign` → `codex/issue-84-eve-runtime`
  → `claude/issue-85-typographic-card` → `claude/issue-86-eve-landing` →
  `claude/issue-87-editorial-detail` → `codex/issue-88-retire-shell`.

## Runtime

- Node `>=22.12.0` (see `engines` in `package.json`).
- Dev environment runs inside a Distrobox container.
- Deployed to Vercel (`@astrojs/vercel`; see `vercel.json`).
- Model/provider for Eve is configured via Vercel env vars — never commit secrets.
