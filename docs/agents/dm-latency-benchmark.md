# DM latency benchmark procedure (AGE-718)

`scripts/dm-benchmark.ts` provides the latency/eval harness for DM model comparisons without changing runtime defaults.

## Recommendation status

- **Default DM model remains unchanged in this issue.**
- Keep `DM_MODEL` as currently configured until a maintainer runs live benchmark/eval comparisons with valid provider keys.
- Do not decide from dry-mode output, `MODEL_CALL_FAILED`, or partial-stream runs; those are invalid latency evidence by policy.

## Run dry plumbing check (no API key)

```bash
npm run dm:bench -- --models openai/gpt-4o-mini,openai/gpt-4.1-mini --iterations 2
```

Dry mode uses deterministic model stubs and shared eval fixtures so timing instrumentation, aggregation, and failure classification remain testable in CI/local environments without secrets.

## Run live comparison (maintainer only)

```bash
OPENAI_API_KEY=... \
DM_BENCH_MODELS="openai/gpt-4o-mini,openai/gpt-4.1-mini" \
npm run dm:bench -- --iterations 5 --json-path ./.tmp/dm-benchmark-live.json
```

Then run the deterministic fixture checker:

```bash
npm run dm:eval
```

Use both outputs together for model recommendation: median/p95 first-token/completion latency, invalid/error rate, and eval pass rate.
