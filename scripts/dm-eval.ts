import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { generateText } from 'ai';
import type { AnswerBlock, DMStreamEvent } from '@/lib/dm/contract';
import { createEvalProjectSource, createStubModelForEvalCase, DM_EVAL_CASES, readNdjsonEvents, type DMEvalCase } from '@/lib/dm/eval-fixtures';
import { formatMissingLiveModelKeysError, parseDMEvalModelSpecs, readModelKeyAvailability, type DMModelSpec } from '@/lib/dm/model-specs';
import {
  applyEvalReleaseGate,
  diffEvalReports,
  renderEvalReportHtml,
  triageRun,
  type DMEvalJudgeScore,
  type DMEvalReport,
  type DMEvalRunRecord,
} from '@/lib/dm/eval-report';
import {
  buildCliJudgePrompt,
  buildJudgePayloadJson,
  describeJudgeConfig,
  DM_JUDGE_RUBRIC,
  extractJudgeScore,
  judgeForAnsweringModel,
  parseJudgeArg,
  runCliJudge,
  type DMJudgeConfig,
  type DMJudgePayload,
} from '@/lib/dm/judge';
import { createDMChatStream, createDMModel } from '@/lib/dm/runtime';

process.env.DM_METRICS ??= '0';

const OFFLINE_CONFIG = { provider: 'openai' as const, model: 'offline-eval-model' };

interface CliOptions {
  live: boolean;
  modelsArg?: string;
  judgeArg?: string;
  jsonPath?: string;
  reportDir?: string;
  baselinePath?: string;
  help: boolean;
}

type JudgeScore = DMEvalJudgeScore;

type EvalRunRecord = DMEvalRunRecord;

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const keys = readModelKeyAvailability();
  if (options.live && !keys.hasGatewayKey && !keys.hasOpenaiKey) {
    throw new Error(formatMissingLiveModelKeysError());
  }

  const modelSpecs = options.live
    ? parseDMEvalModelSpecs(options.modelsArg, process.env, keys)
    : null;
  const judgeConfig = options.judgeArg ? parseJudgeArg(options.judgeArg, keys) : null;
  if (judgeConfig && !options.live) {
    throw new Error('--judge only applies to --live runs; offline answers come from stubs.');
  }

  const source = await createEvalProjectSource();
  const records: EvalRunRecord[] = [];
  const targets: Array<DMModelSpec | undefined> = modelSpecs ?? [undefined];

  console.log(`[dm:eval] mode=${options.live ? 'live' : 'offline (stubbed models)'} cases=${DM_EVAL_CASES.length}`);
  if (modelSpecs) {
    console.log(`[dm:eval] models=${modelSpecs.map((spec) => `${spec.label} via ${spec.provider}`).join(', ')}`);
    if (judgeConfig) console.log(`[dm:eval] judge=${describeJudgeConfig(judgeConfig)}`);
  }

  for (const spec of targets) {
    const modelLabel = spec?.label ?? 'offline-stub';
    for (const testCase of DM_EVAL_CASES) {
      const started = performance.now();
      const events = await readNdjsonEvents(
        createDMChatStream(
          testCase.request ?? { message: testCase.prompt },
          spec ? { provider: spec.provider, model: spec.model } : OFFLINE_CONFIG,
          { db: source.db, projectLoader: source.projectLoader, ...(spec ? {} : { model: createStubModelForEvalCase(testCase) }) },
        ),
      );
      const elapsedMs = Math.round(performance.now() - started);
      const failure = testCase.expect(events);
      const doneEvent = events.find((event): event is Extract<DMStreamEvent, { type: 'done' }> => event.type === 'done');
      const record: EvalRunRecord = {
        model: modelLabel,
        caseName: testCase.name,
        passed: failure === null,
        failure,
        elapsedMs,
        answerText: collectAnswerText(events),
        blockKinds: collectBlockKinds(events),
        factPacket: doneEvent?.facts,
      };

      if (judgeConfig && spec) {
        record.judge = await judgeAnswer(judgeConfig, spec.model, testCase, record);
      }

      const gated = applyEvalReleaseGate(record);
      records.push(gated);
      console.log(formatRunLine(gated));
    }
  }

  console.log('');
  for (const summary of summarize(records)) {
    console.log(summary);
  }

  const report: DMEvalReport = {
    generatedAt: new Date().toISOString(),
    mode: options.live ? 'live' : 'offline',
    judge: judgeConfig ? describeJudgeConfig(judgeConfig) : null,
    runs: records,
  };

  printTriage(records);

  if (options.jsonPath) {
    await mkdir(dirname(options.jsonPath), { recursive: true });
    await writeFile(options.jsonPath, JSON.stringify(report, null, 2));
    console.log(`[dm:eval] wrote JSON report to ${options.jsonPath}`);
  }

  if (options.reportDir) {
    await writeReportDir(options.reportDir, report, options.baselinePath);
  }

  if (records.some((record) => !record.passed)) process.exitCode = 1;
}

function printTriage(records: EvalRunRecord[]): void {
  const triaged = records
    .map((record) => ({ record, triage: triageRun(record) }))
    .filter((item) => item.triage !== null);
  if (triaged.length === 0) return;
  console.log('');
  console.log('[dm:eval] what to fix next:');
  for (const { record, triage } of triaged) {
    if (!triage) continue;
    console.log(`  [${triage.severity}] ${triage.classification} — ${record.caseName} (${record.model})`);
    console.log(`    ${triage.nextStep}`);
  }
}

/**
 * Write a timestamped run into the report directory, diff it against the
 * baseline (explicit --baseline path, else the previous run in the dir),
 * and refresh latest.html / latest.json convenience copies.
 */
async function writeReportDir(reportDir: string, report: DMEvalReport, baselinePath?: string): Promise<void> {
  await mkdir(reportDir, { recursive: true });

  const baseline = baselinePath
    ? { label: baselinePath, report: await readReport(baselinePath) }
    : await findPreviousRun(reportDir);

  const stamp = report.generatedAt.replaceAll(':', '-').replace(/\.\d+Z$/, 'Z');
  const runJsonPath = join(reportDir, `run-${stamp}.json`);
  const html = renderEvalReportHtml({
    report,
    baseline: baseline?.report,
    baselineLabel: baseline?.label,
  });

  await writeFile(runJsonPath, JSON.stringify(report, null, 2));
  await writeFile(join(reportDir, `run-${stamp}.html`), html);
  await writeFile(join(reportDir, 'latest.json'), JSON.stringify(report, null, 2));
  await writeFile(join(reportDir, 'latest.html'), html);

  if (baseline) {
    const diff = diffEvalReports(baseline.report, report);
    if (diff.length > 0) {
      console.log(`[dm:eval] changes vs ${baseline.label}:`);
      for (const entry of diff) {
        console.log(`  ${entry.kind.toUpperCase()} ${entry.caseName} [${entry.model}] — ${entry.detail}`);
      }
    } else {
      console.log(`[dm:eval] no pass/fail changes vs ${baseline.label}`);
    }
  }
  console.log(`[dm:eval] report: ${join(reportDir, 'latest.html')} (open in a browser)`);
}

async function readReport(path: string): Promise<DMEvalReport> {
  return JSON.parse(await readFile(path, 'utf8')) as DMEvalReport;
}

async function findPreviousRun(reportDir: string): Promise<{ label: string; report: DMEvalReport } | null> {
  let names: string[];
  try {
    names = await readdir(reportDir);
  } catch {
    return null;
  }
  const previous = names
    .filter((name) => /^run-.*\.json$/.test(name))
    .sort()
    .at(-1);
  if (!previous) return null;
  return { label: previous, report: await readReport(join(reportDir, previous)) };
}

function formatRunLine(record: EvalRunRecord): string {
  const status = record.passed ? 'PASS' : 'FAIL';
  const judge = record.judge
    ? 'error' in record.judge
      ? ' | judge=error'
      : ` | judge g/h/u=${record.judge.grounded}/${record.judge.honest}/${record.judge.useful}`
    : '';
  const failure = record.failure ? ` - ${record.failure}` : '';
  return `${status} [${record.model}] ${record.caseName} (${record.elapsedMs}ms)${judge}${failure}`;
}

function summarize(records: EvalRunRecord[]): string[] {
  const models = [...new Set(records.map((record) => record.model))];
  return models.map((model) => {
    const runs = records.filter((record) => record.model === model);
    const passed = runs.filter((record) => record.passed).length;
    const scored = runs.flatMap((record) => {
      const judge = record.judge;
      if (!judge || 'error' in judge) return [];
      return [judge];
    });
    const judgePart = scored.length
      ? ` | judge mean g/h/u=${mean(scored.map((s) => s.grounded))}/${mean(scored.map((s) => s.honest))}/${mean(
          scored.map((s) => s.useful),
        )}`
      : '';
    return `SUMMARY [${model}] ${passed}/${runs.length} passed (${Math.round((passed / runs.length) * 100)}%)${judgePart}`;
  });
}

function mean(values: number[]): string {
  if (values.length === 0) return 'n/a';
  return (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1);
}

function collectAnswerText(events: DMStreamEvent[]): string {
  const parts: string[] = [];
  for (const event of events) {
    if (event.type === 'text-delta') parts.push(event.delta);
    if (event.type === 'block' && event.block.kind === 'text') parts.push(`\n${event.block.text}`);
  }
  return parts.join('').trim();
}

function collectBlockKinds(events: DMStreamEvent[]): string[] {
  const kinds: string[] = [];
  for (const event of events) {
    if (event.type === 'block') kinds.push(describeBlock(event.block));
  }
  return kinds;
}

function describeBlock(block: AnswerBlock): string {
  switch (block.kind) {
    case 'projects':
      return `projects:${block.ids.join('+')}`;
    case 'resume':
      return `resume:${block.trackIds.join('+')}`;
    case 'evidence':
      return 'evidence';
    case 'contact':
      return 'contact';
    case 'links':
      return 'links';
    case 'text':
      return 'text';
    default: {
      const exhaustive: never = block;
      return String(exhaustive);
    }
  }
}

async function judgeAnswer(
  config: DMJudgeConfig,
  answeringModelId: string,
  testCase: DMEvalCase,
  record: EvalRunRecord,
): Promise<JudgeScore | { error: string }> {
  const judge = judgeForAnsweringModel(config, answeringModelId);
  record.judgedBy = judge.label;
  const payload: DMJudgePayload = {
    visitorQuestion: testCase.prompt,
    answerText: record.answerText.slice(0, 6000),
    answerBlocks: record.blockKinds,
    factPacket: record.factPacket ?? null,
    deterministicCheck: record.failure ?? 'passed',
  };

  if (judge.kind === 'cli') {
    return runCliJudge(judge, buildCliJudgePrompt(payload));
  }
  try {
    const { text } = await generateText({
      model: createDMModel({ provider: judge.spec.provider, model: judge.spec.model }),
      system: DM_JUDGE_RUBRIC,
      prompt: buildJudgePayloadJson(payload),
    });
    return extractJudgeScore(text);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = { live: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--live') {
      options.live = true;
    } else if (arg === '--models') {
      options.modelsArg = argv[++index];
    } else if (arg.startsWith('--models=')) {
      options.modelsArg = arg.slice('--models='.length);
    } else if (arg === '--judge') {
      options.judgeArg = argv[++index];
    } else if (arg.startsWith('--judge=')) {
      options.judgeArg = arg.slice('--judge='.length);
    } else if (arg === '--json-path') {
      options.jsonPath = argv[++index];
    } else if (arg.startsWith('--json-path=')) {
      options.jsonPath = arg.slice('--json-path='.length);
    } else if (arg === '--report-dir') {
      options.reportDir = argv[++index];
    } else if (arg.startsWith('--report-dir=')) {
      options.reportDir = arg.slice('--report-dir='.length);
    } else if (arg === '--report') {
      options.reportDir = '.dm-evals';
    } else if (arg === '--baseline') {
      options.baselinePath = argv[++index];
    } else if (arg.startsWith('--baseline=')) {
      options.baselinePath = arg.slice('--baseline='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printUsage(): void {
  console.log(`
Usage: npm run dm:eval -- [options]

Options:
  --live                Run fixtures against real models instead of stubs
  --models <list>       Comma-separated model list for --live (default: DM_EVAL_MODELS, then DM_MODEL)
  --judge <target>      Judge for live answers. Targets:
                          auto     cross-family CLI routing: codex-cli judges
                                   anthropic answers, opus-cli judges the rest
                          codex    Codex CLI headless (codex exec) for all answers
                          opus     Claude CLI headless (claude -p --model opus)
                          <id>     a gateway model id (e.g. openai/gpt-5.5)
  --json-path <path>    Write a JSON report (answers, failures, judge scores)
  --report              Shorthand for --report-dir .dm-evals
  --report-dir <dir>    Write an HTML report + timestamped JSON into <dir>, and
                        diff against the previous run in that dir
  --baseline <path>     Diff against a specific JSON report instead of the
                        previous run in the report dir
  --help                Show this help

Environment:
  AI_GATEWAY_API_KEY    When set, ALL models (including openai/*) route through the Vercel AI Gateway.
  OPENAI_API_KEY        Without a gateway key, reaches openai/* models directly. Also used by RAG search.
  DM_MODEL              Default live model (full <creator>/<model> id, e.g. anthropic/claude-sonnet-4.6).
  DM_EVAL_MODELS        Comma-separated live eval model list; --models overrides this.
                        Legacy fallback only when DM_MODEL is unset: DM_BENCH_MODELS.
  DM_JUDGE_CODEX_CMD    Override the codex judge command (default: codex exec --skip-git-repo-check -).
  DM_JUDGE_OPUS_CMD     Override the opus judge command (default: claude -p --model opus).
`);
}

await main();
