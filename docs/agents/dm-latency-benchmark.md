# DM latency benchmark procedure (AGE-718)

`scripts/dm-benchmark.ts` provides the latency/eval harness for DM model comparisons without changing runtime defaults.

## Recommendation status

- **Default DM model remains unchanged in this issue.**
- Keep `DM_MODEL` as currently configured until a maintainer runs live benchmark/eval comparisons with valid provider keys.
- Do not decide from dry-mode output, `MODEL_CALL_FAILED`, or partial-stream runs; those are invalid latency evidence by policy.

## Run dry plumbing check (no API key)

```bash
npm run dm:bench -- --models openai/gpt-4.1,anthropic/claude-sonnet-4.5 --iterations 2
```

Dry mode uses deterministic model stubs and shared eval fixtures so timing instrumentation, aggregation, and failure classification remain testable in CI/local environments without secrets. Gateway model ids are accepted in dry mode.

Model ids are full `<creator>/<model>` gateway ids. When `AI_GATEWAY_API_KEY` is set, **all** models — including `openai/*` — route through the Vercel AI Gateway, so one key compares models across creators. Without a gateway key, `openai/*` ids fall back to the direct OpenAI provider. Answer-quality evals (offline gate, live behavioral, LLM-as-judge) live in `docs/agents/dm-evals.md`.

## Run live comparison (maintainer only)

Direct OpenAI models:

```bash
OPENAI_API_KEY=... \
DM_BENCH_MODELS="openai/gpt-4.1,openai/gpt-5-mini" \
npm run dm:bench -- --iterations 5 --json-path ./.tmp/dm-benchmark-live.json
```

Models through Vercel AI Gateway:

```bash
AI_GATEWAY_API_KEY=... \
OPENAI_API_KEY=... \
DM_BENCH_MODELS="openai/gpt-4.1,anthropic/claude-sonnet-4.5" \
npm run dm:bench -- --iterations 5 --json-path ./.tmp/dm-benchmark-live.json
```

`OPENAI_API_KEY` is still required even with the gateway when an explicit
source/evidence/deep-dive request invokes approved-source vector search through
the OpenAI Vector Store Search API.

Then run the deterministic fixture checker:

```bash
npm run dm:eval
```

Use both outputs together for model recommendation: median/p95 first-token/completion latency, invalid/error rate, and eval pass rate.
