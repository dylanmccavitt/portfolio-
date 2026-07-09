# DM eval loop

Three layers for continuous answer-quality improvement:

| Layer | Command | Measures | When |
| --- | --- | --- | --- |
| Offline gate | `npm run dm:eval` | Stubbed-model pipeline: tool routing, deterministic blocks, refusals, no-leak | Every CI run |
| Live behavioral | `npm run dm:eval -- --live` | Same fixtures against real gateway models | Model/prompt/tool changes |
| Live judged | `npm run dm:eval -- --live --judge auto` | Judge scores (grounded / honest / useful, 0-5) | Before switching `DM_MODEL` |

Latency stays separate: `npm run dm:bench` (`docs/agents/dm-latency-benchmark.md`).

## Judges

`--judge` accepts four targets:

| Target | Judge | Notes |
| --- | --- | --- |
| `auto` | Cross-family CLI routing | Codex CLI judges `anthropic/*` answers; Opus CLI judges everything else. A model never grades its own house style. |
| `codex` | Codex CLI headless | `codex exec --skip-git-repo-check -`, prompt on stdin. Uses your local Codex login. |
| `opus` (alias `claude`) | Claude CLI headless | `claude -p --model opus`, prompt on stdin. Uses your local Claude login. |
| `<creator>/<model>` | Gateway model | Explicit opt-in only; needs `AI_GATEWAY_API_KEY`. |

CLI judges need the respective CLI installed and logged in, and don't consume gateway credits.
Override the exact commands with `DM_JUDGE_CODEX_CMD` / `DM_JUDGE_OPUS_CMD` (e.g. to pin
`codex exec -m gpt-5.3-codex ... -` or `claude -p --model claude-opus-4-6`). Each judge call
sends the rubric + answer as one prompt and parses the last JSON score object out of the CLI
output, so agent progress noise is tolerated. The report records which judge scored each run.

## Visual report

`npm run dm:eval:report` (or any eval run with `--report` / `--report-dir <dir>`) writes a
self-contained HTML report plus a timestamped JSON snapshot into `.dm-evals/` (gitignored):

- **What to fix next** — failed runs triaged by severity (blocker / fix / review) with the
  file to look at, mirroring the improvement-loop classification below. Judge-scored runs
  that pass deterministic checks but score ≤ 3 on any dimension get a review flag.
- **Since last run** — regressions, improvements, still-failing, and new cases versus the
  previous run in the report dir (or an explicit `--baseline <report.json>`), including
  judge-mean movement.
- **Results matrix** — case × model pass/fail grid with latency and judge scores.
- **Answers** — full answer text and blocks per run; failures expanded by default.

Open `.dm-evals/latest.html` in a browser. Typical loop:

```bash
npm run dm:eval:report                              # offline baseline
npm run dm:eval -- --live --judge auto --report     # live judged snapshot
# ...make a fix...
npm run dm:eval -- --live --judge auto --report     # diff shows what moved
```

The same triage and diff also print to the terminal, so `--report` is optional for quick runs.

## Model routing

With `AI_GATEWAY_API_KEY`, all model ids (including `openai/*`) route through the Vercel AI Gateway. Use full `<creator>/<model>` ids. `OPENAI_API_KEY` is still required for the `searchSources` RAG tool.

Local runs auto-load `.env` and `.env.local` when those files exist. To compare models from
this repo without repeating `--models`, put the list in `DM_EVAL_MODELS`:

```dotenv
AI_GATEWAY_API_KEY=...
OPENAI_API_KEY=...
DM_EVAL_MODELS=anthropic/claude-sonnet-4.6,openai/gpt-4.1,google/gemini-2.5-pro
```

Then run:

```bash
npm run dm:eval -- --live --judge auto --report
```

Precedence is `--models` > `DM_EVAL_MODELS` > `DM_MODEL`; `DM_BENCH_MODELS` remains only as
a legacy fallback when neither eval-specific setting is present.

```bash
npm run dm:eval -- --live \
  --models anthropic/claude-sonnet-4.6,openai/gpt-4.1,google/gemini-2.5-pro \
  --judge auto \
  --json-path ./.tmp/dm-eval-live.json

npm run dm:bench -- --models anthropic/claude-sonnet-4.6,openai/gpt-4.1 --iterations 5
```

## Improvement loop

1. Capture the exact bad question and what a good answer needed.
2. Classify: content gap (unpublished fact), retrieval/tool gap (`data-tools.ts` / system prompt), or model gap (prompt / `DM_MODEL`).
3. Add a failing fixture in `src/lib/dm/eval-fixtures.ts` before fixing.
4. Fix, then run offline + live (+ judge when changing models) with `--report` so the diff confirms the fix and catches regressions.
5. Keep `--json-path` / `.dm-evals/` reports as comparison artifacts; commit conclusions to the Linear issue, not the raw files.

Unknown projects (e.g. loom) are a content gap until published and/or given an approved RAG source. The `honesty: unknown project (loom)` fixture pins the honest fallback.

## Fixture expectations

- Assert on blocks and ids, not exact prose.
- Include a leak check (`candidate-hidden`) for project-data cases.
- Provide `modelText` so the offline gate can run the same `expect()`.
- Tone/concreteness belongs in the judge rubric, not `expect()`.
