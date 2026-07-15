import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { gateway, generateText, type LanguageModel } from 'ai';
import {
  DM_LIVE_EVAL_CORPUS,
  DM_RELEASE_MODELS,
  DM_RELEASE_RUNS_PER_CASE,
  assertDMReleaseConfiguration,
  evaluateDMEvalObservation,
  requestForEvalCase,
  validateDMLiveEvalCorpus,
  type DMLiveEvalCase,
} from '@/lib/dm/eval-corpus';
import { createEvalProjectSource, createUnavailableEvalPublicSourceSearch } from '@/lib/dm/eval-source';
import { observeDMResponse } from '@/lib/dm/response-observer';
import type { DMMetricsRecord } from '@/lib/dm/metrics';
import { formatMissingLiveModelKeysError, parseDMEvalModelSpecs, readModelKeyAvailability } from '@/lib/dm/model-specs';
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
  describeJudge,
  describeJudgeConfig,
  DM_JUDGE_RUBRIC,
  extractJudgeScore,
  judgeForAnsweringModel,
  parseJudgeArg,
  runCliJudge,
  type DMJudgeConfig,
  type DMJudgePayload,
} from '@/lib/dm/judge';
import {
  selectDMReleaseWinner,
  validateDMReleaseReport,
  validateDMReleaseSelectionEvidence,
  type DMReleaseSelectionEvidence,
} from '@/lib/dm/release-qualification';
import { createDMChatResponse, createDMModel } from '@/lib/dm/runtime';

interface CliOptions {
  live: boolean;
  release: boolean;
  runs: number;
  modelsArg?: string;
  judgeArg?: string;
  jsonPath?: string;
  reportDir?: string;
  baselinePath?: string;
  selectionEvidencePath?: string;
  releaseReportPath?: string;
  captureRelease: boolean;
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
  if (options.captureRelease && !options.release) throw new Error('--capture-release requires --release.');

  validateDMLiveEvalCorpus();
  if (!options.live) {
    if (options.release || options.judgeArg || options.reportDir || options.jsonPath) {
      throw new Error('Reports and release scores require --live; offline mode only validates the corpus contract.');
    }
    console.log(`[dm:eval] offline corpus validation passed: ${DM_LIVE_EVAL_CORPUS.length} conversational cases`);
    console.log('[dm:eval] no models were called and no release-quality score was produced');
    return;
  }

  let selectionEvidence: DMReleaseSelectionEvidence | null = null;
  if (options.release) {
    if (options.captureRelease && options.selectionEvidencePath) {
      throw new Error('--capture-release cannot accept final selection evidence. Capture first, then qualify the exact report.');
    }
    if (!options.captureRelease && !options.selectionEvidencePath) {
      throw new Error('Release eval requires --selection-evidence with the sanitized captured-baseline comparison contract.');
    }
    if (options.selectionEvidencePath) {
      selectionEvidence = validateDMReleaseSelectionEvidence(JSON.parse(await readFile(options.selectionEvidencePath, 'utf8')));
    }
  }

  if (options.releaseReportPath) {
    if (!options.release) throw new Error('--release-report requires --release.');
    const report = validateDMReleaseReport(JSON.parse(await readFile(options.releaseReportPath, 'utf8')));
    report.releaseDecision = selectDMReleaseWinner(report, selectionEvidence);
    printReleaseDecision(report);
    if (options.jsonPath) {
      await mkdir(dirname(options.jsonPath), { recursive: true });
      await writeFile(options.jsonPath, JSON.stringify(report, null, 2));
    }
    if (options.reportDir) await writeReportDir(options.reportDir, report, options.baselinePath);
    if (report.releaseDecision.status !== 'winner') process.exitCode = 1;
    return;
  }

  const keys = readModelKeyAvailability();
  if (!keys.hasGatewayKey && !keys.hasOpenaiKey) {
    throw new Error(formatMissingLiveModelKeysError());
  }

  const modelSpecs = parseDMEvalModelSpecs(options.modelsArg ?? DM_RELEASE_MODELS.join(','), {}, keys);
  const judgeConfig = options.judgeArg ? parseJudgeArg(options.judgeArg, keys) : null;
  if (options.release) assertDMReleaseConfiguration(modelSpecs.map((spec) => spec.label), options.runs, judgeConfig !== null);

  const source = await createEvalProjectSource();
  const unavailablePublicSourceSearch = createUnavailableEvalPublicSourceSearch();
  const records: EvalRunRecord[] = [];
  process.env.DM_METRICS = '1';

  console.log(`[dm:eval] mode=live score=${options.release ? 'release' : 'diagnostic'} cases=${DM_LIVE_EVAL_CORPUS.length} runs=${options.runs}`);
  console.log(`[dm:eval] models=${modelSpecs.map((spec) => `${spec.label} via ${spec.provider}`).join(', ')}`);
  if (judgeConfig) console.log(`[dm:eval] judge=${describeJudgeConfig(judgeConfig)}`);

  for (const spec of modelSpecs) {
    for (const testCase of DM_LIVE_EVAL_CORPUS) {
      for (let runNumber = 1; runNumber <= options.runs; runNumber += 1) {
        let metrics: DMMetricsRecord | undefined;
        const telemetry = { modelCalls: 0, generationIds: new Set<string>() };
        const model = instrumentModel(createDMModel({ provider: spec.provider, model: spec.model }), telemetry);
        const started = performance.now();
        const request = requestForEvalCase(testCase);
        const observation = await observeDMResponse(
          createDMChatResponse(
            request,
            { provider: spec.provider, model: spec.model },
            {
              db: source.db,
              model,
              projectLoader: testCase.toolFailure?.tool === 'searchProjects'
                ? async () => { throw new Error('simulated eval project source unavailable'); }
                : source.projectLoader,
              ragSearch: testCase.toolFailure?.tool === 'searchPublicSources'
                ? unavailablePublicSourceSearch
                : source.publicSourceSearch,
              metricsLogger(line: string) {
                metrics = parseMetricsLine(line) ?? metrics;
              },
            },
          ),
          request,
        );
        const elapsedMs = Math.round(performance.now() - started);
        const { answerText, blockKinds, tools, projectIds } = observation;
        const outcome = metrics?.outcome ?? observation.outcome;
        const failure = evaluateDMEvalObservation(testCase, { answerText, tools, blockKinds, projectIds, outcome });
        const record: EvalRunRecord = {
          model: spec.label,
          caseId: testCase.id,
          caseName: testCase.name,
          runNumber,
          passed: failure === null,
          failure,
          elapsedMs,
          tools,
          stepCount: telemetry.modelCalls,
          inputTokens: metrics?.inputTokens ?? null,
          outputTokens: metrics?.outputTokens ?? null,
          repairCount: Math.max(0, telemetry.modelCalls - tools.length - (telemetry.modelCalls > 0 ? 1 : 0)),
          outcome,
          answerText,
          blockKinds,
          evidenceIds: observation.evidenceIds,
          source: testCase.source,
          categories: [...testCase.categories],
          critical: testCase.critical,
          followUpApplicable: testCase.expectations.followUp !== 'not-useful',
          costUsd: options.release
            ? await readSameRunProviderCost(spec.provider, telemetry.generationIds)
            : null,
        };

        if (judgeConfig) {
          record.judge = await judgeAnswer(judgeConfig, spec.model, testCase, record);
        }

        const gated = applyEvalReleaseGate(record);
        records.push(gated);
        console.log(formatRunLine(gated));
      }
    }
  }

  console.log('');
  for (const summary of summarize(records)) {
    console.log(summary);
  }

  const report: DMEvalReport = {
    generatedAt: new Date().toISOString(),
    mode: 'live',
    scoreKind: options.release ? 'release' : 'diagnostic',
    judge: judgeConfig ? describeJudgeConfig(judgeConfig) : null,
    runs: records,
  };
  if (options.release) {
    report.releaseDecision = selectDMReleaseWinner(report, selectionEvidence);
    printReleaseDecision(report);
  }

  printTriage(records);

  if (options.jsonPath) {
    await mkdir(dirname(options.jsonPath), { recursive: true });
    await writeFile(options.jsonPath, JSON.stringify(report, null, 2));
    console.log(`[dm:eval] wrote JSON report to ${options.jsonPath}`);
  }

  if (options.reportDir) {
    await writeReportDir(options.reportDir, report, options.baselinePath);
  }

  const failed = options.release
    ? report.releaseDecision?.status !== 'winner'
    : records.some((record) => !record.passed);
  if (failed) process.exitCode = 1;
}

function printReleaseDecision(report: DMEvalReport): void {
  const decision = report.releaseDecision;
  if (!decision) return;
  console.log('');
  console.log(`[dm:eval] release decision=${decision.status} winner=${decision.winnerModel ?? 'none'}`);
  console.log(`[dm:eval] ${decision.reason}`);
  for (const aggregate of decision.aggregates) {
    console.log(`[dm:eval] candidate digest [${aggregate.model}] ${aggregate.candidateRunSha256}`);
    console.log(`[dm:eval] qualification [${aggregate.model}] ${aggregate.qualified ? 'QUALIFIED' : 'DISQUALIFIED'}: ${aggregate.disqualifications.join('; ') || 'all gates passed'}`);
  }
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
  return `${status} [${record.model}] ${record.caseName} run ${record.runNumber} (${record.elapsedMs}ms)${judge}${failure}`;
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
    return `LIVE SUMMARY [${model}] ${passed}/${runs.length} passed (${Math.round((passed / runs.length) * 100)}%)${judgePart}`;
  });
}

function mean(values: number[]): string {
  if (values.length === 0) return 'n/a';
  return (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1);
}

function parseMetricsLine(line: string): DMMetricsRecord | null {
  const prefix = '[dm-metrics] ';
  if (!line.startsWith(prefix)) return null;
  try {
    return JSON.parse(line.slice(prefix.length)) as DMMetricsRecord;
  } catch {
    return null;
  }
}

function instrumentModel(model: LanguageModel, telemetry: { modelCalls: number; generationIds: Set<string> }): LanguageModel {
  return new Proxy(model as object, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property === 'doStream' && typeof value === 'function') {
        return async (...args: unknown[]) => {
          telemetry.modelCalls += 1;
          const result = await Reflect.apply(value, target, args) as { stream?: ReadableStream<unknown> };
          if (!result?.stream) return result;
          const stream = result.stream.pipeThrough(new TransformStream<unknown, unknown>({
            transform(part, controller) {
              const generationId = readGatewayGenerationId(part);
              if (generationId) telemetry.generationIds.add(generationId);
              controller.enqueue(part);
            },
          }));
          return { ...result, stream };
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as LanguageModel;
}

function readGatewayGenerationId(part: unknown): string | null {
  if (!part || typeof part !== 'object') return null;
  const providerMetadata = (part as { providerMetadata?: unknown }).providerMetadata;
  if (!providerMetadata || typeof providerMetadata !== 'object') return null;
  const gatewayMetadata = (providerMetadata as Record<string, unknown>).gateway;
  if (!gatewayMetadata || typeof gatewayMetadata !== 'object') return null;
  const generationId = (gatewayMetadata as Record<string, unknown>).generationId;
  return typeof generationId === 'string' && generationId.length > 0 ? generationId : null;
}

async function readSameRunProviderCost(provider: string, generationIds: Set<string>): Promise<number | null> {
  if (provider !== 'gateway' || generationIds.size === 0) return null;
  try {
    const generations = await Promise.all([...generationIds].map((id) => gateway.getGenerationInfo({ id })));
    const costs = generations.map((generation) => generation.totalCost);
    return costs.every((cost) => typeof cost === 'number' && Number.isFinite(cost) && cost >= 0)
      ? costs.reduce((sum, cost) => sum + cost, 0)
      : null;
  } catch {
    // Cost is a release tie-break only. Missing provider cost remains explicit
    // null evidence and fails closed if selection reaches that tie-break.
    return null;
  }
}

async function judgeAnswer(
  config: DMJudgeConfig,
  answeringModelId: string,
  testCase: DMLiveEvalCase,
  record: EvalRunRecord,
): Promise<JudgeScore | { error: string }> {
  const judge = judgeForAnsweringModel(config, answeringModelId);
  record.judgedBy = describeJudge(judge);
  const payload: DMJudgePayload = {
    latestQuestion: testCase.prompt,
    conversation: testCase.history,
    expectedBehavior: testCase.expectations,
    answerText: record.answerText.slice(0, 6000),
    observedTools: record.tools,
    answerBlocks: record.blockKinds,
    evidenceIds: record.evidenceIds,
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
  const options: CliOptions = { live: false, release: false, captureRelease: false, runs: DM_RELEASE_RUNS_PER_CASE, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--live') {
      options.live = true;
    } else if (arg === '--release') {
      options.release = true;
    } else if (arg === '--capture-release') {
      options.captureRelease = true;
    } else if (arg === '--runs') {
      options.runs = parseRunCount(argv[++index]);
    } else if (arg.startsWith('--runs=')) {
      options.runs = parseRunCount(arg.slice('--runs='.length));
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
    } else if (arg === '--selection-evidence') {
      options.selectionEvidencePath = argv[++index];
    } else if (arg.startsWith('--selection-evidence=')) {
      options.selectionEvidencePath = arg.slice('--selection-evidence='.length);
    } else if (arg === '--release-report') {
      options.releaseReportPath = argv[++index];
    } else if (arg.startsWith('--release-report=')) {
      options.releaseReportPath = arg.slice('--release-report='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function parseRunCount(value: string | undefined): number {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error('--runs must be an integer from 1 to 10.');
  return count;
}

function printUsage(): void {
  console.log(`
Usage: npm run dm:eval -- [options]

Options:
  --live                Run the conversational corpus against real models
  --release             Enforce the fixed release matrix, three runs, and a judge
  --capture-release     Run the fixed matrix and emit an explicit no-winner
                        capture with exact candidate digests for blinded review
  --models <list>       Comma-separated model list (default: Luna and Grok release matrix)
  --runs <count>        Repetitions per model/case (default: 3)
  --judge <target>      Judge for live answers. Targets:
                          auto     cross-family CLI routing: codex-cli judges
                                   anthropic answers, opus-cli judges the rest
                          codex    Codex CLI headless (codex exec) for all answers
                          opus     Claude CLI headless (claude -p --model opus)
                          <id>     a gateway model id (e.g. openai/gpt-5.5)
  --json-path <path>    Write a sanitized JSON report (no visitor text or tool results)
  --report              Shorthand for --report-dir .dm-evals
  --report-dir <dir>    Write an HTML report + timestamped JSON into <dir>, and
                        diff against the previous run in that dir
  --baseline <path>     Diff against a specific JSON report instead of the
                        previous run in the report dir
  --selection-evidence <path>
                        Required for --release. Versioned sanitized baseline id,
                        hashes, and ten exact-candidate-digest-bound blinded
                        comparisons per model. Contains no prompts, histories,
                        answers, tool results, credentials, or judge prose.
  --release-report <path>
                        Qualify an exact captured release JSON against digest-bound
                        selection evidence without calling a provider again.
  --help                Show this help

Environment:
  AI_GATEWAY_API_KEY    When set, ALL models (including openai/*) route through the Vercel AI Gateway.
  OPENAI_API_KEY        Without a gateway key, reaches openai/* models directly. Also used by RAG search.
  DM_MODEL              Runtime model setting; ignored by the fixed release command.
  DM_EVAL_MODELS        Exploratory override only; --models and the release command take precedence.
  DM_JUDGE_CODEX_CMD    Override the codex judge command
                        (default: codex exec --model gpt-5.6-sol --skip-git-repo-check -).
  DM_JUDGE_OPUS_CMD     Override the opus judge command (default: claude -p --model opus).
`);
}

await main();
