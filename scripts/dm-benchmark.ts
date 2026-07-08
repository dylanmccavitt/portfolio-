import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { aggregateBenchmarkRuns, classifyBenchmarkRun, type DMBenchmarkRunRecord, type TimedDMEvent } from '@/lib/dm/benchmark';
import { createEvalProjectDb, createStubModelForEvalCase, DM_EVAL_CASES } from '@/lib/dm/eval-fixtures';
import type { DMStreamEvent } from '@/lib/dm/contract';
import { createDMChatStream } from '@/lib/dm/runtime';

process.env.DM_METRICS ??= '0';

interface CliOptions {
  modelsArg?: string;
  iterationsArg?: string;
  jsonStdout: boolean;
  jsonPath?: string;
  help: boolean;
}

interface BenchmarkModelSpec {
  provider: 'openai';
  model: string;
  label: string;
}

interface TimedReadResult {
  events: TimedDMEvent[];
  completionMs: number;
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const iterations = parseIterations(options.iterationsArg ?? process.env.DM_BENCH_ITERATIONS);
  const modelSpecs = parseModelSpecs(options.modelsArg ?? process.env.DM_BENCH_MODELS, process.env.DM_MODEL);
  const dryRun = !process.env.OPENAI_API_KEY?.trim();

  if (modelSpecs.length < 2) {
    console.warn(`[dm:bench] expected at least two models for comparison; running ${modelSpecs.length}.`);
  }

  const db = await createEvalProjectDb();
  const runRecords: DMBenchmarkRunRecord[] = [];

  console.log(`[dm:bench] mode=${dryRun ? 'dry (stubbed, NOT valid latency evidence)' : 'live'} iterations=${iterations} cases=${DM_EVAL_CASES.length}`);
  console.log(`[dm:bench] models=${modelSpecs.map((spec) => spec.label).join(', ')}`);

  for (const modelSpec of modelSpecs) {
    for (let iteration = 1; iteration <= iterations; iteration += 1) {
      for (const testCase of DM_EVAL_CASES) {
        const sessionStartMs = Date.now();
        const stream = createDMChatStream(
          { message: testCase.prompt },
          { provider: modelSpec.provider, model: modelSpec.model },
          { db, ...(dryRun ? { model: createStubModelForEvalCase(testCase) } : {}) },
        );

        const timed = await readTimedNdjson(stream);
        const events = timed.events.map((entry) => entry.event);
        const evalFailure = testCase.expect(events);
        const classified = classifyBenchmarkRun({
          events: timed.events,
          completionMs: timed.completionMs,
          evalFailure,
        });

        const record: DMBenchmarkRunRecord = {
          ...classified,
          model: modelSpec.label,
          caseName: testCase.name,
          iteration,
          sessionStartMs,
          dryRun,
        };
        runRecords.push(record);

        console.log(
          [
            `${modelSpec.label}`,
            `iter=${iteration}/${iterations}`,
            `"${testCase.name}"`,
            `class=${record.failureClass}`,
            `first=${formatMs(record.firstTokenMs)}`,
            `complete=${formatMs(record.completionMs)}`,
            `tools=${record.toolCount}`,
          ].join(' | '),
        );
      }
    }
  }

  const summaries = aggregateBenchmarkRuns(runRecords);
  console.log('');
  console.log(renderSummaryTable(summaries));
  if (dryRun) {
    console.log('[dm:bench] dry mode uses deterministic stubs. These timings are plumbing checks only, not valid latency evidence.');
  }
  console.log(
    `[dm:bench] live latency evidence runs=${runRecords.filter((run) => run.validLatency && run.modelExercised && !run.dryRun).length}/${runRecords.length}`,
  );

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun,
    iterations,
    fixtures: DM_EVAL_CASES.map((testCase) => testCase.name),
    models: modelSpecs.map((spec) => spec.label),
    summaries,
    runs: runRecords,
  };

  if (options.jsonPath) {
    await mkdir(dirname(options.jsonPath), { recursive: true });
    await writeFile(options.jsonPath, JSON.stringify(report, null, 2));
    console.log(`[dm:bench] wrote JSON report to ${options.jsonPath}`);
  }
  if (options.jsonStdout) {
    console.log(JSON.stringify(report, null, 2));
  }
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = { jsonStdout: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--json') {
      options.jsonStdout = true;
      continue;
    }
    if (arg === '--models') {
      options.modelsArg = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--models=')) {
      options.modelsArg = arg.slice('--models='.length);
      continue;
    }
    if (arg === '--iterations') {
      options.iterationsArg = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--iterations=')) {
      options.iterationsArg = arg.slice('--iterations='.length);
      continue;
    }
    if (arg === '--json-path') {
      options.jsonPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--json-path=')) {
      options.jsonPath = arg.slice('--json-path='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function parseIterations(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '3', 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 50) {
    throw new Error(`DM benchmark iterations must be between 1 and 50, got: ${value ?? '(empty)'}`);
  }
  return parsed;
}

function parseModelSpecs(value: string | undefined, defaultModel: string | undefined): BenchmarkModelSpec[] {
  const fallback = [defaultModel?.trim() || 'gpt-4o-mini', 'gpt-4.1-mini'];
  const rawModels = (value ? value.split(',') : fallback).map((item) => item.trim()).filter(Boolean);
  const unique = [...new Set(rawModels)];
  if (unique.length === 0) throw new Error('No benchmark models configured.');
  return unique.map(parseModelSpec);
}

function parseModelSpec(value: string): BenchmarkModelSpec {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Model label must not be empty.');
  if (trimmed.includes('/')) {
    const [provider, ...rest] = trimmed.split('/');
    const model = rest.join('/').trim();
    if (provider !== 'openai') {
      throw new Error(`Unsupported provider "${provider}" in model "${trimmed}". Use openai/<model>.`);
    }
    if (!model) throw new Error(`Missing model name in "${trimmed}".`);
    return { provider: 'openai', model, label: `${provider}/${model}` };
  }
  return { provider: 'openai', model: trimmed, label: `openai/${trimmed}` };
}

async function readTimedNdjson(stream: ReadableStream<Uint8Array>): Promise<TimedReadResult> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const started = performance.now();
  let buffer = '';
  const events: TimedDMEvent[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = drainBuffer(buffer, events, started);
  }

  buffer += decoder.decode();
  drainBuffer(buffer, events, started, true);

  return { events, completionMs: Math.max(0, Math.round(performance.now() - started)) };
}

function drainBuffer(buffer: string, target: TimedDMEvent[], started: number, flush = false): string {
  let cursor = buffer;
  while (true) {
    const newline = cursor.indexOf('\n');
    if (newline < 0) break;
    const line = cursor.slice(0, newline).trim();
    cursor = cursor.slice(newline + 1);
    if (!line) continue;
    target.push({
      event: parseEvent(line),
      elapsedMs: Math.max(0, Math.round(performance.now() - started)),
    });
  }

  if (flush) {
    const tail = cursor.trim();
    if (tail) {
      target.push({
        event: parseEvent(tail),
        elapsedMs: Math.max(0, Math.round(performance.now() - started)),
      });
    }
    return '';
  }

  return cursor;
}

function parseEvent(line: string): DMStreamEvent {
  return JSON.parse(line) as DMStreamEvent;
}

function formatMs(value: number | null): string {
  return value === null ? 'n/a' : `${value}ms`;
}

function renderSummaryTable(
  summaries: ReturnType<typeof aggregateBenchmarkRuns>,
): string {
  const headers = [
    'model',
    'runs',
    'valid',
    'live',
    'eval',
    'errors',
    'invalid',
    'first(ms) med/p95',
    'completion(ms) med/p95',
    'tools med',
    'failure counts',
  ];
  const rows = summaries.map((summary) => [
    summary.model,
    String(summary.runs),
    String(summary.validLatencyRuns),
    String(summary.liveLatencyRuns),
    `${summary.evalPassedRuns}/${summary.evalTotalRuns}`,
    String(summary.errorRuns),
    String(summary.invalidRuns),
    `${formatStat(summary.firstTokenMedianMs)}/${formatStat(summary.firstTokenP95Ms)}`,
    `${formatStat(summary.completionMedianMs)}/${formatStat(summary.completionP95Ms)}`,
    formatStat(summary.toolCountMedian),
    renderFailureCounts(summary.failures),
  ]);
  return renderTable(headers, rows);
}

function renderFailureCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([name, count]) => `${name}:${count}`)
    .join(' ');
}

function formatStat(value: number | null): string {
  return value === null ? 'n/a' : String(value);
}

function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? '').length)),
  );

  const formatRow = (row: string[]): string =>
    row.map((cell, index) => (cell ?? '').padEnd(widths[index] ?? 0)).join(' | ');

  const divider = widths.map((width) => '-'.repeat(width)).join('-|-');
  return [formatRow(headers), divider, ...rows.map((row) => formatRow(row))].join('\n');
}

function printUsage(): void {
  console.log(`
Usage: npm run dm:bench -- [options]

Options:
  --models <list>       Comma-separated model list (gpt-4o-mini,openai/gpt-4.1-mini)
  --iterations <n>      Iterations per fixture (default: 3 or DM_BENCH_ITERATIONS)
  --json                Print JSON report to stdout
  --json-path <path>    Write JSON report to a file path
  --help                Show this help

Environment:
  DM_BENCH_MODELS       Comma-separated model list (same format as --models)
  DM_BENCH_ITERATIONS   Iteration count override
  OPENAI_API_KEY        Required for live model calls. Missing key enables dry mode.
`);
}

await main();
