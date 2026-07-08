import assert from 'node:assert/strict';
import test from 'node:test';
import { createDMMetricsRecorder } from '@/lib/dm/metrics';

test('DM metrics records first-token timing once and completion outcome', () => {
  let currentTime = 1_000;
  const lines: string[] = [];
  const metrics = createDMMetricsRecorder({ now: () => currentTime, logger: (line) => lines.push(line) });

  currentTime = 1_012;
  metrics.record({ type: 'text-delta', delta: 'first public token' });
  currentTime = 1_030;
  metrics.record({ type: 'block', index: 0, block: { kind: 'text', text: 'later block' } });
  currentTime = 1_050;
  metrics.record({ type: 'done', answer: [], trace: emptyTrace() });

  assert.deepEqual(metrics.snapshot(), {
    sessionStart: 1_000,
    firstTokenMs: 12,
    completionMs: 50,
    toolCount: 0,
    errorCount: 0,
    outcome: 'completed',
  });
  assert.equal(lines.length, 1);
  assert.equal(parseMetricsLine(lines[0]).firstTokenMs, 12);
});

test('DM metrics counts tools and stream errors', () => {
  let currentTime = 2_000;
  const lines: string[] = [];
  const metrics = createDMMetricsRecorder({ now: () => currentTime, logger: (line) => lines.push(line) });

  metrics.record({ type: 'tool', name: 'searchProjects', summary: 'Search published projects' });
  metrics.record({ type: 'tool', name: 'readResume', summary: 'Read public resume' });
  currentTime = 2_025;
  metrics.record({ type: 'error', message: 'DM is unavailable right now.' });

  assert.deepEqual(metrics.snapshot(), {
    sessionStart: 2_000,
    firstTokenMs: null,
    completionMs: 25,
    toolCount: 2,
    errorCount: 1,
    outcome: 'error',
  });
  assert.deepEqual(parseMetricsLine(lines[0]), metrics.snapshot());
});

test('DM metrics log line never includes stream content', () => {
  const privateText = 'private Slack candidate note: secret-token-123';
  const lines: string[] = [];
  const metrics = createDMMetricsRecorder({ now: () => 5_000, logger: (line) => lines.push(line) });

  metrics.record({ type: 'text-delta', delta: privateText });
  metrics.record({ type: 'block', index: 0, block: { kind: 'text', text: privateText } });
  metrics.record({ type: 'error', message: privateText });

  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], /private Slack candidate note|secret-token-123/);
  assert.deepEqual(Object.keys(parseMetricsLine(lines[0])).sort(), [
    'completionMs',
    'errorCount',
    'firstTokenMs',
    'outcome',
    'sessionStart',
    'toolCount',
  ]);
});

function emptyTrace() {
  return { mode: 'vercel-ai-sdk' as const, agent: 'DM' as const, items: [] };
}

function parseMetricsLine(line: string): Record<string, unknown> {
  const prefix = '[dm-metrics] ';
  assert.ok(line.startsWith(prefix), `expected metrics prefix in ${line}`);
  return JSON.parse(line.slice(prefix.length)) as Record<string, unknown>;
}
