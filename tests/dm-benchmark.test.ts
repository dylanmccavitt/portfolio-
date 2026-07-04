import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateBenchmarkRuns, classifyBenchmarkRun, median, percentile, type DMBenchmarkRunRecord, type TimedDMEvent } from '../src/lib/dm/benchmark';

test('benchmark classification marks no-token errors as MODEL_CALL_FAILED invalid latency', () => {
  const events: TimedDMEvent[] = [
    { elapsedMs: 2, event: { type: 'ready', agent: 'DM', provider: 'openai', trace: emptyTrace() } },
    { elapsedMs: 5, event: { type: 'error', message: 'DM is unavailable right now.' } },
  ];
  const result = classifyBenchmarkRun({ events, completionMs: 8, evalFailure: 'missing refusal text block' });

  assert.equal(result.failureClass, 'MODEL_CALL_FAILED');
  assert.equal(result.firstTokenMs, null);
  assert.equal(result.validLatency, false);
  assert.equal(result.errorCount, 1);
});

test('benchmark classification keeps eval failures latency-valid when stream completed', () => {
  const events: TimedDMEvent[] = [
    { elapsedMs: 1, event: { type: 'ready', agent: 'DM', provider: 'openai', trace: emptyTrace() } },
    { elapsedMs: 9, event: { type: 'text-delta', delta: 'public answer token' } },
    { elapsedMs: 12, event: { type: 'done', answer: [], trace: emptyTrace() } },
  ];
  const result = classifyBenchmarkRun({ events, completionMs: 15, evalFailure: 'missing projects answer block' });

  assert.equal(result.failureClass, 'EVAL_FAILED');
  assert.equal(result.validLatency, true);
  assert.equal(result.firstTokenMs, 9);
  assert.equal(result.evalPassed, false);
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
    evalPassed: true,
    ...overrides,
  };
}

function emptyTrace() {
  return { mode: 'vercel-ai-sdk' as const, agent: 'DM' as const, items: [] };
}
