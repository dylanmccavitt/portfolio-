# Prototype: chat-first agent landing (throwaway)

**Question:** when you land on the portfolio, what should the centered
chat/agent box look like, and how should a conversation about Dylan flow once
you ask something? Backend will be a **Vercel Eve** agent (an `agent/`
directory — `instructions.md` + TS tools `search_catalog` / `read_resume` /
`get_contact`, streamed via the AI SDK). Answers here are canned so the layouts
can be judged without a backend.

**Run:** `npm run dev` → http://localhost:4321/prototype/agent

**Drive it:** floating switcher at bottom-center, or `←` / `→` keys (ignored
while typing). Click a suggested prompt or type + Enter to see a turn reveal
(thinking beat → streamed answer). Variant is URL state: `?variant=A|B|C`
(static site, so the switch is client-side via `body[data-variant]`).

- `A` **Launcher** — single centered column, ChatGPT/Claude empty-state. The
  literal ask: a box dead-center that expands into an inline thread, composer
  docks to the bottom. The most familiar / lowest-friction.
- `B` **Split canvas** — Codex-app shell: persistent left sidebar listing the
  agent's `agent/tools/` directory + suggested prompts; each answer renders
  prose beside large detailed artifact cards. Most "this is an agent product".
- `C` **Terminal** — Codex-CLI REPL in monospace: boot log, `try ▸` commands,
  `eve ❯` prompt, tool-trace lines, records/tree output. Most on-theme for an
  engineer audience; riskiest for non-technical recruiters.

## Shared scaffolding (prototype-local)

- `_agentData.ts` — canned `CONVERSATION` (turns: question, fake tool `trace`,
  typed answer blocks: text / projects / resume / contact / links), `SUGGESTED`
  prompts, `CONTACT`, and `projectById` / `trackById` over the real catalog +
  resume. This is the only place to edit copy.
- `_agentProto.client.ts` — the interaction driver. Reveals a turn by id on
  chip-click / submit with a ~700ms "thinking" beat, then the answer. Variants
  opt in via `data-proto-*` hooks; they never reimplement reveal/streaming.
- `_AgentSwitcher.astro` — the floating variant switcher (dev-only).
- `agent.astro` — renders all three panes, toggles `body[data-variant]`, loads
  the driver. Real tokens (`player.css`) + real data; only the view markup is
  prototype-local.

Note: the shared entrance (`.proto-in`) is transform-only on purpose — an
opacity fade with fill-mode `both` leaves content invisible if the animation
stalls on a throttled surface.

**Verdict (Dylan, 2026-06-18):** **B — Split canvas** wins. That's the landing
direction: Codex-app shell, persistent left `agent/tools/` + prompts sidebar,
answers render prose beside large artifact cards. It's now the default variant
on `/prototype/agent`. (A/C kept for reference until B is folded into
`index.astro`; the shell-based D variant was removed to avoid preserving the retired player metaphor.)

**Cleanup:** once a direction is chosen, fold the winner into `index.astro`
(rewrite properly — wire the real Eve agent + AI SDK streaming, replace the
canned `_agentData` turns) and delete `_AgentVariant{A,B,C}.astro`,
`_AgentSwitcher.astro`, `_agentProto.client.ts`, `_agentData.ts`, `agent.astro`,
and this file.
