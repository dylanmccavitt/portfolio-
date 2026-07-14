import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { aggregateBenchmarkRuns, classifyBenchmarkRun, type DMBenchmarkRunRecord, type TimedDMEvent } from '@/lib/dm/benchmark';
import { DM_LIVE_EVAL_CORPUS, evaluateDMEvalObservation, requestForEvalCase } from '@/lib/dm/eval-corpus';
import { createEvalProjectSource } from '@/lib/dm/eval-source';
import { parseDMModelSpecs, readModelKeyAvailability } from '@/lib/dm/model-specs';
import { observeDMResponse } from '@/lib/dm/response-observer';
import { createDMChatResponse } from '@/lib/dm/runtime';

process.env.DM_METRICS ??= '0';

interface CliOptions {
  modelsArg?: string;
  iterationsArg?: string;
  jsonStdout: boolean;
  jsonPath?: string;
  help: boolean;
}

const BENCHMARK_CASES = DM_LIVE_EVAL_CORPUS.filter((testCase) =>
  ['mf-trading-automation', 'mf-recruiter-resume-contact', 'mf-unmatched-quantum', 'derived-project-comparison'].includes(testCase.id),
);

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const iterations = parseIterations(options.iterationsArg ?? process.env.DM_BENCH_ITERATIONS);
  const keys = readModelKeyAvailability();
  if (!keys.hasGatewayKey && !keys.hasOpenaiKey) {
    throw new Error('DM benchmark requires AI_GATEWAY_API_KEY or OPENAI_API_KEY; scripted benchmark fallbacks were removed.');
  }
  const configuredModels = options.modelsArg ?? process.env.DM_BENCH_MODELS ?? process.env.DM_MODEL;
  if (!configuredModels?.trim()) throw new Error('DM benchmark requires --models, DM_BENCH_MODELS, or DM_MODEL.');
  const modelSpecs = parseDMModelSpecs(configuredModels, keys, []);
  const dryRun = false;

  if (modelSpecs.length < 2) {
    console.warn(`[dm:bench] expected at least two models for comparison; running ${modelSpecs.length}.`);
  }

  const source = await createEvalProjectSource();
  const runRecords: DMBenchmarkRunRecord[] = [];

  console.log(`[dm:bench] mode=live iterations=${iterations} cases=${BENCHMARK_CASES.length}`);
  console.log(`[dm:bench] models=${modelSpecs.map((spec) => `${spec.label} via ${spec.provider}`).join(', ')}`);

  for (const modelSpec of modelSpecs) {
    for (let iteration = 1; iteration <= iterations; iteration += 1) {
      for (const testCase of BENCHMARK_CASES) {
        const sessionStartMs = Date.now();
        const request = requestForEvalCase(testCase);
        const started = performance.now();
        const observation = await observeDMResponse(createDMChatResponse(
          request,
          { provider: modelSpec.provider, model: modelSpec.model },
          { db: source.db, projectLoader: source.projectLoader },
        ), request);
        const completionMs = Math.max(0, Math.round(performance.now() - started));
        const evalFailure = evaluateDMEvalObservation(testCase, observation);
        const classified = classifyBenchmarkRun({
          events: observation.timedChunks.map((entry): TimedDMEvent => ({ event: entry.chunk, elapsedMs: entry.elapsedMs })),
          completionMs,
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
  console.log(
    `[dm:bench] live latency evidence runs=${runRecords.filter((run) => run.validLatency && run.modelExercised && !run.dryRun).length}/${runRecords.length}`,
  );

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun,
    iterations,
    fixtures: BENCHMARK_CASES.map((testCase) => testCase.name),
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
  --models <list>       Comma-separated model ids to measure
  --iterations <n>      Iterations per fixture (default: 3 or DM_BENCH_ITERATIONS)
  --json                Print JSON report to stdout
  --json-path <path>    Write JSON report to a file path
  --help                Show this help

Environment:
  DM_BENCH_MODELS       Comma-separated model list (same format as --models)
  DM_BENCH_ITERATIONS   Iteration count override
  AI_GATEWAY_API_KEY    When set, ALL models (including openai/*) route through the Vercel AI Gateway.
  OPENAI_API_KEY        Without a gateway key, reaches openai/* models directly. Also used by RAG search.
                        With neither key set, the run uses dry mode (stubbed models, plumbing check only).
`);
}

await main();
