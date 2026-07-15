import assert from 'node:assert/strict';
import test from 'node:test';
import { createDMMetricsRecorder } from '@/lib/dm/metrics';

test('DM metrics records first-token timing once and completion outcome', () => {
  let currentTime = 1_000;
  const lines: string[] = [];
  const metrics = createDMMetricsRecorder({ now: () => currentTime, logger: (line) => lines.push(line) });

  currentTime = 1_012;
  metrics.visibleOutput();
  currentTime = 1_030;
  metrics.visibleOutput();
  currentTime = 1_050;
  metrics.finish('completed');

  assert.deepEqual(metrics.snapshot(), {
    traceId: 'unknown',
    sessionStart: 1_000,
    firstTokenMs: 12,
    completionMs: 50,
    toolCount: 0,
    errorCount: 0,
    sourceMode: 'none',
    retrievalHits: 0,
    limitedAnswer: false,
    inputTokens: null,
    outputTokens: null,
    errorCategory: null,
    outcome: 'completed',
  });
  assert.equal(lines.length, 1);
  assert.equal(parseMetricsLine(lines[0]).firstTokenMs, 12);
});

test('DM metrics counts tools and stream errors', () => {
  let currentTime = 2_000;
  const lines: string[] = [];
  const metrics = createDMMetricsRecorder({ now: () => currentTime, logger: (line) => lines.push(line) });

  metrics.tool();
  metrics.tool();
  currentTime = 2_025;
  metrics.error('provider_failure');
  metrics.finish('error');

  assert.deepEqual(metrics.snapshot(), {
    traceId: 'unknown',
    sessionStart: 2_000,
    firstTokenMs: null,
    completionMs: 25,
    toolCount: 2,
    errorCount: 1,
    sourceMode: 'none',
    retrievalHits: 0,
    limitedAnswer: false,
    inputTokens: null,
    outputTokens: null,
    errorCategory: 'provider_failure',
    outcome: 'error',
  });
  assert.deepEqual(parseMetricsLine(lines[0]), metrics.snapshot());
});

test('DM metrics log line remains content-free', () => {
  const lines: string[] = [];
  const metrics = createDMMetricsRecorder({ now: () => 5_000, logger: (line) => lines.push(line) });

  metrics.visibleOutput();
  metrics.error();
  metrics.finish('error');

  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], /private Slack candidate note|secret-token-123/);
  assert.deepEqual(Object.keys(parseMetricsLine(lines[0])).sort(), [
    'completionMs',
    'errorCategory',
    'errorCount',
    'firstTokenMs',
    'inputTokens',
    'limitedAnswer',
    'outcome',
    'outputTokens',
    'retrievalHits',
    'sessionStart',
    'sourceMode',
    'toolCount',
    'traceId',
  ]);
});

test('DM metrics keep one content-free record when a sink throws', () => {
  const metrics = createDMMetricsRecorder({
    traceId: 'trace-safe',
    logger: () => { throw new Error('sink unavailable'); },
  });
  metrics.setSource('published_db', 3, true);
  metrics.setUsage(12, 34);
  metrics.finish('timeout');
  assert.deepEqual(metrics.snapshot(), {
    traceId: 'trace-safe',
    sessionStart: metrics.snapshot().sessionStart,
    firstTokenMs: null,
    completionMs: 0,
    toolCount: 0,
    errorCount: 0,
    sourceMode: 'published_db',
    retrievalHits: 3,
    limitedAnswer: true,
    inputTokens: 12,
    outputTokens: 34,
    errorCategory: 'timeout',
    outcome: 'timeout',
  });
});

test('DM metrics retain only a finite sanitized runtime error category', () => {
  const metrics = createDMMetricsRecorder({ logger: () => {} });
  metrics.setErrorCategory('provider_retry_exhausted');
  metrics.finish('error');
  assert.equal(metrics.snapshot().errorCategory, 'provider_retry_exhausted');
  assert.doesNotMatch(JSON.stringify(metrics.snapshot()), /provider payload|secret-token-123/);
});

test('terminal timeout and cancellation categories override provisional provider telemetry', () => {
  const timeout = createDMMetricsRecorder({ logger: () => {} });
  timeout.setErrorCategory('provider_failure');
  timeout.finish('timeout');
  assert.equal(timeout.snapshot().errorCategory, 'timeout');

  const aborted = createDMMetricsRecorder({ logger: () => {} });
  aborted.setErrorCategory('provider_retry_exhausted');
  aborted.finish('aborted');
  assert.equal(aborted.snapshot().errorCategory, 'aborted');
});

function parseMetricsLine(line: string): Record<string, unknown> {
  const prefix = '[dm-metrics] ';
  assert.ok(line.startsWith(prefix), `expected metrics prefix in ${line}`);
  return JSON.parse(line.slice(prefix.length)) as Record<string, unknown>;
}
