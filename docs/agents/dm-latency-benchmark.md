# DM latency benchmark procedure (AGE-718)

`scripts/dm-benchmark.ts` provides the credential-gated live latency/eval harness for DM model comparisons without changing runtime defaults.

## Recommendation status

- **Default DM model remains unchanged in this issue.**
- Keep `DM_MODEL` as currently configured until a maintainer runs live benchmark/eval comparisons with valid provider keys.
- Do not decide from focused harness tests, `MODEL_CALL_FAILED`, or partial-stream runs; those are not valid live latency evidence.

## Run focused harness proof (no provider call)

```bash
npm run test:benchmark
```

This test exercises model-id parsing, timing instrumentation, aggregation, and
failure classification without calling a model. It does not run the benchmark
or produce latency evidence.

Model ids are full `<creator>/<model>` gateway ids. A benchmark requires
`AI_GATEWAY_API_KEY` or `OPENAI_API_KEY` and fails before model execution when
neither is available. When `AI_GATEWAY_API_KEY` is set, **all** models —
including `openai/*` — route through the Vercel AI Gateway, so one key compares
models across creators. Without a gateway key, `OPENAI_API_KEY` reaches only
`openai/*` models directly. Answer-quality evals (corpus validation, live
behavioral, LLM-as-judge) live in `docs/agents/dm-evals.md`.

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

Before comparing results, run the checked-in corpus and harness proof:

```bash
npm run dm:eval
npm run test:benchmark
npm run test:eval-report
```

These commands do not produce live model evidence. Pair the live benchmark with
a credentialed `npm run dm:eval:report` result for model recommendation:
median/p95 first-token/completion latency, invalid/error rate, and eval pass
rate.
