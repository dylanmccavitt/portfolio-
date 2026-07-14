import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { aggregateBenchmarkRuns, classifyBenchmarkRun, median, percentile, type DMBenchmarkRunRecord, type TimedDMEvent } from '@/lib/dm/benchmark';
import { parseDMEvalModelSpecs, parseDMModelSpec, parseDMModelSpecs } from '@/lib/dm/model-specs';

test('model specs keep full gateway ids so anthropic models resolve through the gateway', () => {
  const keys = { hasGatewayKey: true, hasOpenaiKey: true };

  assert.deepEqual(parseDMModelSpec('anthropic/claude-sonnet-4.6', keys), {
    provider: 'gateway',
    model: 'anthropic/claude-sonnet-4.6',
    label: 'anthropic/claude-sonnet-4.6',
  });
  assert.deepEqual(parseDMModelSpec('openai/gpt-4.1', keys), {
    provider: 'gateway',
    model: 'openai/gpt-4.1',
    label: 'openai/gpt-4.1',
  });
});

test('model specs fall back to direct OpenAI when only OPENAI_API_KEY is set', () => {
  const keys = { hasGatewayKey: false, hasOpenaiKey: true };

  assert.deepEqual(parseDMModelSpec('openai/gpt-4.1', keys), {
    provider: 'openai',
    model: 'openai/gpt-4.1',
    label: 'openai/gpt-4.1',
  });
  assert.deepEqual(parseDMModelSpec('gpt-4.1-mini', keys), {
    provider: 'openai',
    model: 'openai/gpt-4.1-mini',
    label: 'openai/gpt-4.1-mini',
  });
  assert.throws(() => parseDMModelSpec('anthropic/claude-sonnet-4.6', keys), /AI_GATEWAY_API_KEY/);
});

test('model spec lists dedupe explicit ids before command-level credential validation', () => {
  const keys = { hasGatewayKey: false, hasOpenaiKey: false };
  const specs = parseDMModelSpecs('anthropic/claude-sonnet-4.6, anthropic/claude-sonnet-4.6, openai/gpt-4.1', keys, []);

  assert.deepEqual(
    specs.map((spec) => spec.label),
    ['anthropic/claude-sonnet-4.6', 'openai/gpt-4.1'],
  );
  assert.equal(specs[0]?.provider, 'gateway');
  assert.throws(() => parseDMModelSpecs(undefined, keys, []), /No models configured/);
  assert.throws(() => parseDMModelSpec('anthropic/', keys), /creator.*model|<creator>\/<model>/);
});

test('benchmark operator guidance is live-only and names the current eval source', async () => {
  const [benchmarkDoc, evalDoc, benchmarkCli, modelSpecs] = await Promise.all([
    readFile(new URL('../docs/agents/dm-latency-benchmark.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/agents/dm-evals.md', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/dm-benchmark.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/dm/model-specs.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(benchmarkDoc, /credential-gated live latency\/eval harness/);
  assert.doesNotMatch(benchmarkDoc, /dry[- ]mode|dry plumbing|stubbed models/i);
  assert.match(evalDoc, /src\/lib\/dm\/eval-source\.ts/);
  assert.doesNotMatch(evalDoc, /src\/lib\/dm\/eval-fixtures\.ts/);
  assert.match(benchmarkCli, /At least one provider key is required/);
  assert.doesNotMatch(benchmarkCli, /dry[- ]mode|stubbed models|plumbing check/i);
  assert.doesNotMatch(modelSpecs, /dry[- ]mode/i);
});

test('eval model specs prefer cli models, then DM_EVAL_MODELS, then DM_MODEL', () => {
  const keys = { hasGatewayKey: true, hasOpenaiKey: true };
  const env = {
    DM_EVAL_MODELS: 'anthropic/claude-sonnet-4.6, openai/gpt-4.1',
    DM_BENCH_MODELS: 'openai/legacy-bench-model',
    DM_MODEL: 'openai/fallback-model',
  };

  assert.deepEqual(
    parseDMEvalModelSpecs('openai/cli-model', env, keys).map((spec) => spec.label),
    ['openai/cli-model'],
  );
  assert.deepEqual(
    parseDMEvalModelSpecs(undefined, env, keys).map((spec) => spec.label),
    ['anthropic/claude-sonnet-4.6', 'openai/gpt-4.1'],
  );
  assert.deepEqual(
    parseDMEvalModelSpecs(undefined, { DM_MODEL: 'openai/fallback-model', DM_BENCH_MODELS: 'openai/legacy-bench-model' }, keys).map((spec) => spec.label),
    ['openai/fallback-model'],
  );
  assert.deepEqual(
    parseDMEvalModelSpecs(undefined, { DM_BENCH_MODELS: 'openai/legacy-bench-model, anthropic/legacy-claude' }, keys).map((spec) => spec.label),
    ['openai/legacy-bench-model', 'anthropic/legacy-claude'],
  );
});

test('benchmark classification marks no-token errors as MODEL_CALL_FAILED invalid latency', () => {
  const events: TimedDMEvent[] = [
    { elapsedMs: 2, event: { type: 'start' } },
    { elapsedMs: 5, event: { type: 'error', errorText: 'DM is unavailable right now.' } },
  ];
  const result = classifyBenchmarkRun({ events, completionMs: 8, evalFailure: 'missing refusal text block' });

  assert.equal(result.failureClass, 'MODEL_CALL_FAILED');
  assert.equal(result.firstTokenMs, null);
  assert.equal(result.validLatency, false);
  assert.equal(result.modelExercised, true);
  assert.equal(result.errorCount, 1);
});

test('benchmark classification keeps eval failures latency-valid when stream completed', () => {
  const events: TimedDMEvent[] = [
    { elapsedMs: 1, event: { type: 'start' } },
    { elapsedMs: 9, event: answerChunk() },
    { elapsedMs: 12, event: { type: 'finish' } },
  ];
  const result = classifyBenchmarkRun({ events, completionMs: 15, evalFailure: 'missing projects answer block' });

  assert.equal(result.failureClass, 'EVAL_FAILED');
  assert.equal(result.validLatency, true);
  assert.equal(result.modelExercised, true);
  assert.equal(result.firstTokenMs, 9);
  assert.equal(result.evalPassed, false);
});

test('benchmark classification requires the model-backed standard stream', () => {
  const events: TimedDMEvent[] = [
    { elapsedMs: 1, event: { type: 'start' } },
    { elapsedMs: 2, event: answerChunk() },
    { elapsedMs: 4, event: { type: 'finish' } },
  ];
  const result = classifyBenchmarkRun({ events, completionMs: 5, evalFailure: null });

  assert.equal(result.failureClass, 'OK');
  assert.equal(result.validLatency, true);
  assert.equal(result.modelExercised, true);
  assert.equal(result.firstTokenMs, 2);
});

test('benchmark aggregation excludes invalid latency runs from median and p95', () => {
  const runs: DMBenchmarkRunRecord[] = [
    runRecord({ model: 'openai/model-a', firstTokenMs: 100, completionMs: 320, failureClass: 'OK', validLatency: true }),
    runRecord({ model: 'openai/model-a', firstTokenMs: 190, completionMs: 500, failureClass: 'EVAL_FAILED', validLatency: true, evalPassed: false }),
    runRecord({ model: 'openai/model-a', firstTokenMs: null, completionMs: 50, failureClass: 'MODEL_CALL_FAILED', validLatency: false, errorCount: 1 }),
  ];

  const [summary] = aggregateBenchmarkRuns(runs);
  assert.ok(summary, 'expected model summary');

  assert.equal(summary.validLatencyRuns, 2);
  assert.equal(summary.modelExercisedRuns, 3);
  assert.equal(summary.nonModelRuns, 0);
  assert.equal(summary.invalidRuns, 1);
  assert.equal(summary.firstTokenMedianMs, 145);
  assert.equal(summary.firstTokenP95Ms, 186);
  assert.equal(summary.completionMedianMs, 410);
  assert.equal(summary.errorRuns, 1);
  assert.deepEqual(summary.failures, {
    OK: 1,
    EVAL_FAILED: 1,
    MODEL_CALL_FAILED: 1,
    STREAM_ERROR: 0,
    PARTIAL_STREAM: 0,
  });
});

test('benchmark aggregation excludes non-model refusal runs from latency medians', () => {
  const runs: DMBenchmarkRunRecord[] = [
    runRecord({ model: 'openai/model-a', firstTokenMs: 100, completionMs: 320, failureClass: 'OK', validLatency: true }),
    runRecord({
      model: 'openai/model-a',
      firstTokenMs: 3,
      completionMs: 5,
      failureClass: 'OK',
      validLatency: true,
      modelExercised: false,
    }),
  ];

  const [summary] = aggregateBenchmarkRuns(runs);
  assert.ok(summary, 'expected model summary');

  assert.equal(summary.validLatencyRuns, 2);
  assert.equal(summary.modelExercisedRuns, 1);
  assert.equal(summary.nonModelRuns, 1);
  assert.equal(summary.firstTokenMedianMs, 100);
  assert.equal(summary.completionMedianMs, 320);
});

test('median and percentile return null for empty arrays', () => {
  assert.equal(median([]), null);
  assert.equal(percentile([], 95), null);
});

function runRecord(overrides: Partial<DMBenchmarkRunRecord>): DMBenchmarkRunRecord {
  return {
    model: 'openai/model',
    caseName: 'fixture',
    iteration: 1,
    sessionStartMs: 1_000,
    dryRun: false,
    firstTokenMs: 10,
    completionMs: 20,
    toolCount: 0,
    errorCount: 0,
    hasDone: true,
    errorMessage: null,
    failureClass: 'OK',
    failureDetail: null,
    validLatency: true,
    modelExercised: true,
    evalPassed: true,
    ...overrides,
  };
}

function answerChunk(): TimedDMEvent['event'] {
  return {
    type: 'data-dm-answer',
    data: {
      status: 'accepted',
      repairAttempted: false,
      answer: { segments: [{ text: 'Public answer.', evidenceIds: [], evidence: [] }], artifacts: [], limitations: [] },
    },
  };
}
