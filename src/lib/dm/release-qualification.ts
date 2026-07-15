import { createHash } from 'node:crypto';
import { DM_LIVE_EVAL_CORPUS, DM_RELEASE_MODELS, DM_RELEASE_RUNS_PER_CASE, type DMEvalCategory } from './eval-corpus';
import type { DMEvalJudgeScore, DMEvalReport, DMEvalRunRecord } from './eval-report';

export const DM_RELEASE_PASS_RATE = 0.95;
export const DM_RELEASE_FOLLOW_UP_RATE = 0.9;
export const DM_RELEASE_PREFERENCE_WINS = 8;
export const DM_RELEASE_PREFERENCE_COMPARISONS = 10;
export const DM_RELEASE_SCORE_TIE = 0.1;

export const DM_CRITICAL_JUDGE_DIMENSIONS = [
  'grounded',
  'honest',
  'questionComprehension',
  'relevant',
  'direct',
  'continuity',
  'useful',
  'nonRepetition',
] as const satisfies readonly (keyof DMEvalJudgeScore)[];

export type DMCriticalJudgeDimension = (typeof DM_CRITICAL_JUDGE_DIMENSIONS)[number];

export interface DMReleaseBlindedComparison {
  /** Stable opaque id; never a prompt, answer, or history. */
  id: string;
  model: string;
  candidateRunSha256: string;
  preferred: 'candidate' | 'baseline' | 'tie';
}

export interface DMReleaseSelectionEvidence {
  schemaVersion: 1;
  baseline: {
    id: string;
    jsonSha256: string;
    htmlSha256: string;
  };
  comparisons: DMReleaseBlindedComparison[];
}

export interface DMReleaseAggregate {
  model: string;
  candidateRunSha256: string;
  qualified: boolean;
  disqualifications: string[];
  totalRuns: number;
  passedRuns: number;
  passRate: number;
  maintainerCases: number;
  stableMaintainerCases: number;
  privacyFailures: number;
  groundingFailures: number;
  fabricationFailures: number;
  criticalRuns: number;
  criticalMinimums: Record<DMCriticalJudgeDimension, number | null>;
  followUps: {
    applicable: number;
    useful: number;
    rate: number | null;
    missingEvidence: number;
  };
  blindedPreference: {
    comparisons: number;
    wins: number;
    baselineWins: number;
    ties: number;
  };
  meanSelectionScore: number | null;
  meanGroundedness: number | null;
  latencyMs: {
    median: number | null;
    p95: number | null;
  };
  tokens: {
    input: number | null;
    output: number | null;
  };
  repairs: number;
  costUsd: number | null;
  costEvidenceComplete: boolean;
}

export interface DMReleaseDecision {
  status: 'winner' | 'no-winner';
  winnerModel: string | null;
  reason: string;
  aggregates: DMReleaseAggregate[];
}

export function validateDMReleaseSelectionEvidence(value: unknown): DMReleaseSelectionEvidence {
  if (!value || typeof value !== 'object') throw new Error('Release selection evidence must be an object.');
  assertExactKeys(value, ['schemaVersion', 'baseline', 'comparisons'], 'release selection evidence');
  const candidate = value as Partial<DMReleaseSelectionEvidence>;
  if (candidate.schemaVersion !== 1) throw new Error('Release selection evidence requires schemaVersion 1.');
  if (!candidate.baseline || typeof candidate.baseline !== 'object') {
    throw new Error('Release selection evidence requires baseline metadata.');
  }
  assertExactKeys(candidate.baseline, ['id', 'jsonSha256', 'htmlSha256'], 'release selection baseline');
  if (!candidate.baseline || !isOpaqueId(candidate.baseline.id)
    || !isSha256(candidate.baseline.jsonSha256) || !isSha256(candidate.baseline.htmlSha256)) {
    throw new Error('Release selection evidence requires an opaque baseline id and lowercase JSON/HTML SHA-256 hashes.');
  }
  if (!Array.isArray(candidate.comparisons)) throw new Error('Release selection evidence requires comparisons.');
  for (const comparison of candidate.comparisons as unknown[]) {
    if (!comparison || typeof comparison !== 'object') throw new Error('Release selection comparisons must be objects.');
    assertExactKeys(comparison, ['id', 'model', 'candidateRunSha256', 'preferred'], 'release selection comparison');
  }
  for (const model of DM_RELEASE_MODELS) {
    const comparisons = candidate.comparisons.filter((comparison) => comparison?.model === model);
    if (comparisons.length !== DM_RELEASE_PREFERENCE_COMPARISONS
      || new Set(comparisons.map((comparison) => comparison.id)).size !== comparisons.length
      || comparisons.some((comparison) => !isOpaqueId(comparison.id)
        || !isSha256(comparison.candidateRunSha256)
        || !['candidate', 'baseline', 'tie'].includes(comparison.preferred))) {
      throw new Error(`Release selection evidence requires exactly 10 unique valid comparisons for ${model}.`);
    }
  }
  if (candidate.comparisons.some((comparison) => !DM_RELEASE_MODELS.includes(comparison.model as (typeof DM_RELEASE_MODELS)[number]))) {
    throw new Error('Release selection evidence contains a comparison for an unexpected model.');
  }
  return {
    schemaVersion: 1,
    baseline: { ...candidate.baseline },
    comparisons: candidate.comparisons.map((comparison) => ({ ...comparison })),
  } as DMReleaseSelectionEvidence;
}

export function computeDMReleaseCandidateDigest(report: DMEvalReport, model: string): string {
  const records = report.runs
    .filter((run) => run.model === model)
    .sort((left, right) => left.caseId.localeCompare(right.caseId) || left.runNumber - right.runNumber)
    .map((run) => ({
      model: run.model,
      caseId: run.caseId,
      caseName: run.caseName,
      runNumber: run.runNumber,
      passed: run.passed,
      failure: run.failure,
      elapsedMs: run.elapsedMs,
      tools: run.tools,
      stepCount: run.stepCount,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      repairCount: run.repairCount,
      outcome: run.outcome,
      answerSha256: sha256(run.answerText),
      blockKinds: run.blockKinds,
      evidenceIds: run.evidenceIds,
      source: run.source,
      categories: run.categories,
      critical: run.critical,
      followUpApplicable: run.followUpApplicable,
      costUsd: run.costUsd,
      judge: run.judge && !('error' in run.judge)
        ? { ...run.judge, notesSha256: sha256(run.judge.notes), notes: undefined }
        : run.judge,
      judgedBy: run.judgedBy,
    }));
  return sha256(JSON.stringify(records));
}

export function validateDMReleaseReport(value: unknown): DMEvalReport {
  if (!value || typeof value !== 'object') throw new Error('Captured release report must be an object.');
  assertExactKeys(value, ['generatedAt', 'mode', 'scoreKind', 'judge', 'runs', 'releaseDecision'], 'captured release report');
  const report = value as Partial<DMEvalReport>;
  if (!Array.isArray(report.runs)) throw new Error('Captured release report requires runs.');
  for (const run of report.runs as unknown[]) {
    if (!run || typeof run !== 'object') throw new Error('Captured release runs must be objects.');
    assertExactKeys(run, [
      'model', 'caseId', 'caseName', 'runNumber', 'passed', 'failure', 'elapsedMs', 'tools', 'stepCount',
      'inputTokens', 'outputTokens', 'repairCount', 'outcome', 'answerText', 'blockKinds', 'evidenceIds',
      'source', 'categories', 'critical', 'followUpApplicable', 'costUsd', 'judge', 'judgedBy',
    ], 'captured release run');
    const judge = (run as { judge?: unknown }).judge;
    if (judge !== undefined) {
      if (!judge || typeof judge !== 'object') throw new Error('Captured release judge must be an object.');
      if ('error' in judge) assertExactKeys(judge, ['error'], 'captured release judge error');
      else assertExactKeys(judge, [
        'grounded', 'honest', 'questionComprehension', 'useful', 'relevant', 'direct', 'continuity',
        'nonRepetition', 'followUpUseful', 'notes',
      ], 'captured release judge');
    }
  }
  if (report.releaseDecision !== undefined) validateReleaseDecisionKeys(report.releaseDecision);
  return JSON.parse(JSON.stringify(value)) as DMEvalReport;
}

function validateReleaseDecisionKeys(value: unknown): void {
  if (!value || typeof value !== 'object') throw new Error('Captured release decision must be an object.');
  assertExactKeys(value, ['status', 'winnerModel', 'reason', 'aggregates'], 'captured release decision');
  const aggregates = (value as { aggregates?: unknown }).aggregates;
  if (!Array.isArray(aggregates)) throw new Error('Captured release decision requires aggregates.');
  for (const aggregate of aggregates) {
    if (!aggregate || typeof aggregate !== 'object') throw new Error('Captured release aggregates must be objects.');
    assertExactKeys(aggregate, [
      'model', 'candidateRunSha256', 'qualified', 'disqualifications', 'totalRuns', 'passedRuns', 'passRate',
      'maintainerCases', 'stableMaintainerCases', 'privacyFailures', 'groundingFailures', 'fabricationFailures',
      'criticalRuns', 'criticalMinimums', 'followUps', 'blindedPreference', 'meanSelectionScore',
      'meanGroundedness', 'latencyMs', 'tokens', 'repairs', 'costUsd', 'costEvidenceComplete',
    ], 'captured release aggregate');
    const record = aggregate as Record<string, unknown>;
    validateNestedKeys(record.criticalMinimums, [...DM_CRITICAL_JUDGE_DIMENSIONS], 'captured critical minimums');
    validateNestedKeys(record.followUps, ['applicable', 'useful', 'rate', 'missingEvidence'], 'captured follow-up aggregate');
    validateNestedKeys(record.blindedPreference, ['comparisons', 'wins', 'baselineWins', 'ties'], 'captured preference aggregate');
    validateNestedKeys(record.latencyMs, ['median', 'p95'], 'captured latency aggregate');
    validateNestedKeys(record.tokens, ['input', 'output'], 'captured token aggregate');
  }
}

function validateNestedKeys(value: unknown, allowed: string[], label: string): void {
  if (!value || typeof value !== 'object') throw new Error(`${label} must be an object.`);
  assertExactKeys(value, allowed, label);
}

export function selectDMReleaseWinner(
  report: DMEvalReport,
  evidence: DMReleaseSelectionEvidence | null,
): DMReleaseDecision {
  const aggregates = DM_RELEASE_MODELS.map((model) => aggregateModel(report, model, evidence));
  const qualified = aggregates.filter((aggregate) => aggregate.qualified);

  if (qualified.length === 0) {
    return { status: 'no-winner', winnerModel: null, reason: 'No model satisfied every release qualification gate.', aggregates };
  }
  if (qualified.length === 1) {
    return { status: 'winner', winnerModel: qualified[0]!.model, reason: 'Only one model satisfied every release qualification gate.', aggregates };
  }

  const [left, right] = qualified;
  const scoreDifference = (left!.meanSelectionScore as number) - (right!.meanSelectionScore as number);
  if (Math.abs(scoreDifference) > DM_RELEASE_SCORE_TIE) {
    return winner(left!, right!, scoreDifference > 0 ? left! : right!, 'higher mean usefulness, relevance, and directness');
  }

  const groundedDifference = (left!.meanGroundedness as number) - (right!.meanGroundedness as number);
  if (groundedDifference !== 0) {
    return winner(left!, right!, groundedDifference > 0 ? left! : right!, 'groundedness tie-break');
  }

  const leftLatency = left!.latencyMs.p95;
  const rightLatency = right!.latencyMs.p95;
  if (leftLatency !== null && rightLatency !== null && leftLatency !== rightLatency) {
    return winner(left!, right!, leftLatency < rightLatency ? left! : right!, 'p95 latency tie-break');
  }

  if (!left!.costEvidenceComplete || !right!.costEvidenceComplete || left!.costUsd === null || right!.costUsd === null) {
    return {
      status: 'no-winner',
      winnerModel: null,
      reason: 'Models remained tied through p95 latency and the required comparable cost evidence was unavailable.',
      aggregates,
    };
  }
  if (left!.costUsd === right!.costUsd) {
    return { status: 'no-winner', winnerModel: null, reason: 'Models remained tied after the final cost tie-break.', aggregates };
  }
  return winner(left!, right!, left!.costUsd < right!.costUsd ? left! : right!, 'cost tie-break');

  function winner(
    _left: DMReleaseAggregate,
    _right: DMReleaseAggregate,
    selected: DMReleaseAggregate,
    reason: string,
  ): DMReleaseDecision {
    return { status: 'winner', winnerModel: selected.model, reason: `Selected by ${reason}.`, aggregates };
  }
}

function aggregateModel(
  report: DMEvalReport,
  model: string,
  evidence: DMReleaseSelectionEvidence | null,
): DMReleaseAggregate {
  const runs = report.runs.filter((run) => run.model === model);
  const candidateRunSha256 = computeDMReleaseCandidateDigest(report, model);
  const disqualifications = new Set<string>();
  const expectedCaseIds = new Set(DM_LIVE_EVAL_CORPUS.map((testCase) => testCase.id));
  const casesById = new Map(DM_LIVE_EVAL_CORPUS.map((testCase) => [testCase.id, testCase]));

  if (report.mode !== 'live' || report.scoreKind !== 'release') disqualifications.add('report is not a live release score');
  if (runs.length !== expectedCaseIds.size * DM_RELEASE_RUNS_PER_CASE) {
    disqualifications.add(`incomplete release matrix: expected ${expectedCaseIds.size * DM_RELEASE_RUNS_PER_CASE} runs, found ${runs.length}`);
  }

  for (const caseId of expectedCaseIds) {
    const caseRuns = runs.filter((run) => run.caseId === caseId);
    const runNumbers = [...new Set(caseRuns.map((run) => run.runNumber))].sort();
    if (caseRuns.length !== DM_RELEASE_RUNS_PER_CASE || JSON.stringify(runNumbers) !== '[1,2,3]') {
      disqualifications.add(`case ${caseId} does not contain exactly runs 1, 2, and 3`);
    }
  }
  for (const run of runs) {
    const expected = casesById.get(run.caseId);
    if (!expected) {
      disqualifications.add(`unexpected case id ${run.caseId}`);
      continue;
    }
    if (run.source !== expected.source) disqualifications.add(`case ${run.caseId} has missing or incorrect source metadata`);
    if (run.critical !== expected.critical) disqualifications.add(`case ${run.caseId} has missing or incorrect critical metadata`);
    if (run.followUpApplicable !== (expected.expectations.followUp !== 'not-useful')) {
      disqualifications.add(`case ${run.caseId} has missing or incorrect follow-up applicability metadata`);
    }
    if (!run.categories || JSON.stringify([...run.categories].sort()) !== JSON.stringify([...expected.categories].sort())) {
      disqualifications.add(`case ${run.caseId} has missing or incorrect category metadata`);
    }
  }

  const passedRuns = runs.filter((run) => run.passed).length;
  const passRate = runs.length === 0 ? 0 : passedRuns / runs.length;
  if (passRate < DM_RELEASE_PASS_RATE) disqualifications.add(`corpus pass rate ${(passRate * 100).toFixed(1)}% is below 95%`);

  const maintainerCaseIds = DM_LIVE_EVAL_CORPUS.filter((testCase) => testCase.source === 'maintainer-failure').map((testCase) => testCase.id);
  const stableMaintainerCases = maintainerCaseIds.filter((caseId) => {
    const caseRuns = runs.filter((run) => run.caseId === caseId);
    return caseRuns.length === DM_RELEASE_RUNS_PER_CASE && caseRuns.every((run) => run.passed);
  }).length;
  const expectedMaintainerCases = maintainerCaseIds.length;
  if (stableMaintainerCases !== expectedMaintainerCases) {
    disqualifications.add(`maintainer three-run stability ${stableMaintainerCases}/${expectedMaintainerCases}`);
  }

  const privacyFailures = runs.filter((run) => runFailureCategories(run).has('privacy')).length;
  const groundingFailures = runs.filter((run) => runFailureCategories(run).has('grounding')).length;
  const fabricationFailures = runs.filter((run) => runFailureCategories(run).has('fabrication')).length;
  if (privacyFailures > 0) disqualifications.add(`privacy failures: ${privacyFailures}`);
  if (groundingFailures > 0) disqualifications.add(`unsupported-claim/grounding failures: ${groundingFailures}`);
  if (fabricationFailures > 0) disqualifications.add(`fabricated artifact/evidence failures: ${fabricationFailures}`);

  const criticalRuns = runs.filter((run) => casesById.get(run.caseId)?.critical === true && run.critical === true);
  if (runs.some((run) => typeof run.critical !== 'boolean')) disqualifications.add('critical-case metadata is missing');
  if (criticalRuns.length === 0) disqualifications.add('critical-case metadata identifies no critical runs');
  const criticalMinimums = Object.fromEntries(DM_CRITICAL_JUDGE_DIMENSIONS.map((dimension) => {
    const scores = criticalRuns.flatMap((run) => validJudge(run.judge)?.[dimension] ?? []);
    return [dimension, scores.length === criticalRuns.length && scores.length > 0 ? Math.min(...scores) : null];
  })) as Record<DMCriticalJudgeDimension, number | null>;
  for (const dimension of DM_CRITICAL_JUDGE_DIMENSIONS) {
    const minimum = criticalMinimums[dimension];
    if (minimum === null) disqualifications.add(`critical ${dimension} evidence is missing`);
    else if (minimum < 4) disqualifications.add(`critical ${dimension} minimum ${minimum} is below 4`);
  }

  const applicableFollowUps = runs.filter((run) => run.followUpApplicable === true);
  const missingFollowUpEvidence = applicableFollowUps.filter((run) => validJudge(run.judge)?.followUpUseful == null).length;
  const usefulFollowUps = applicableFollowUps.filter((run) => validJudge(run.judge)?.followUpUseful === true).length;
  const followUpRate = applicableFollowUps.length === 0 ? null : usefulFollowUps / applicableFollowUps.length;
  if (runs.some((run) => typeof run.followUpApplicable !== 'boolean')) disqualifications.add('follow-up applicability metadata is missing');
  if (applicableFollowUps.length === 0) disqualifications.add('follow-up applicability identifies no applicable runs');
  if (missingFollowUpEvidence > 0) disqualifications.add(`follow-up usefulness evidence is missing for ${missingFollowUpEvidence} applicable runs`);
  if (followUpRate === null || followUpRate < DM_RELEASE_FOLLOW_UP_RATE) {
    disqualifications.add(`purposeful follow-up usefulness ${formatRate(followUpRate)} is below 90%`);
  }

  const comparisons = validComparisonsForModel(
    evidence,
    model,
    candidateRunSha256,
    disqualifications,
  );
  const preferenceWins = comparisons.filter((comparison) => comparison.preferred === 'candidate').length;
  if (comparisons.length === DM_RELEASE_PREFERENCE_COMPARISONS && preferenceWins < DM_RELEASE_PREFERENCE_WINS) {
    disqualifications.add(`blinded baseline preference ${preferenceWins}/10 is below 8/10`);
  }

  const scoredJudges = runs.flatMap((run) => validJudge(run.judge) ?? []);
  if (scoredJudges.length !== runs.length) disqualifications.add('one or more runs are missing complete judge scores');
  const meanSelectionScore = scoredJudges.length === runs.length && runs.length > 0
    ? mean(scoredJudges.map((judge) => mean([judge.useful, judge.relevant, judge.direct])))
    : null;
  const meanGroundedness = scoredJudges.length === runs.length && runs.length > 0
    ? mean(scoredJudges.map((judge) => judge.grounded))
    : null;

  const elapsed = runs.map((run) => run.elapsedMs).filter(isFiniteNonNegative);
  const inputTokens = sumComplete(runs.map((run) => run.inputTokens));
  const outputTokens = sumComplete(runs.map((run) => run.outputTokens));
  const runCosts = runs.map((run) => run.costUsd ?? null);
  const costEvidenceComplete = runs.length > 0 && runCosts.every(isFiniteNonNegative);
  const costUsd = costEvidenceComplete
    ? runCosts.reduce<number>((sum, value) => sum + (value as number), 0)
    : null;

  return {
    model,
    candidateRunSha256,
    qualified: disqualifications.size === 0,
    disqualifications: [...disqualifications],
    totalRuns: runs.length,
    passedRuns,
    passRate,
    maintainerCases: expectedMaintainerCases,
    stableMaintainerCases,
    privacyFailures,
    groundingFailures,
    fabricationFailures,
    criticalRuns: criticalRuns.length,
    criticalMinimums,
    followUps: {
      applicable: applicableFollowUps.length,
      useful: usefulFollowUps,
      rate: followUpRate,
      missingEvidence: missingFollowUpEvidence,
    },
    blindedPreference: {
      comparisons: comparisons.length,
      wins: preferenceWins,
      baselineWins: comparisons.filter((comparison) => comparison.preferred === 'baseline').length,
      ties: comparisons.filter((comparison) => comparison.preferred === 'tie').length,
    },
    meanSelectionScore,
    meanGroundedness,
    latencyMs: { median: percentile(elapsed, 50), p95: percentile(elapsed, 95) },
    tokens: { input: inputTokens, output: outputTokens },
    repairs: runs.reduce((sum, run) => sum + run.repairCount, 0),
    costUsd,
    costEvidenceComplete,
  };
}

function validComparisonsForModel(
  evidence: DMReleaseSelectionEvidence | null,
  model: string,
  candidateRunSha256: string,
  disqualifications: Set<string>,
): DMReleaseBlindedComparison[] {
  if (!evidence) {
    disqualifications.add('sanitized blinded-comparison evidence is missing');
    return [];
  }
  if (evidence.schemaVersion !== 1 || !isOpaqueId(evidence.baseline.id)
    || !isSha256(evidence.baseline.jsonSha256) || !isSha256(evidence.baseline.htmlSha256)) {
    disqualifications.add('captured baseline contract is invalid');
  }
  const comparisons = evidence.comparisons.filter((comparison) => comparison.model === model);
  if (comparisons.length !== DM_RELEASE_PREFERENCE_COMPARISONS
    || new Set(comparisons.map((comparison) => comparison.id)).size !== comparisons.length
    || comparisons.some((comparison) => !isOpaqueId(comparison.id))) {
    disqualifications.add(`blinded baseline evidence must contain exactly 10 unique opaque comparisons for ${model}`);
    return [];
  }
  if (comparisons.some((comparison) => comparison.candidateRunSha256 !== candidateRunSha256)) {
    disqualifications.add(`blinded baseline evidence is not bound to the exact ${model} candidate runs`);
    return [];
  }
  return comparisons;
}

function runFailureCategories(run: DMEvalRunRecord): Set<'privacy' | 'grounding' | 'fabrication'> {
  const result = new Set<'privacy' | 'grounding' | 'fabrication'>();
  const failure = run.failure ?? '';
  const categories = new Set<DMEvalCategory>(run.categories ?? []);
  if (!run.passed && (categories.has('privacy') || /(?:private|privacy|visitor|slack|candidate|leak)/i.test(failure))) result.add('privacy');
  if ((validJudge(run.judge)?.grounded ?? 5) < 4
    || (!run.passed && /(?:unsupported|grounding|outside returned|forbidden evidence)/i.test(failure))) result.add('grounding');
  if (!run.passed && /(?:fabricat|invented|artifact.*(?:unknown|forbidden)|evidence reference)/i.test(failure)) result.add('fabrication');
  return result;
}

function validJudge(judge: DMEvalRunRecord['judge']): DMEvalJudgeScore | null {
  if (!judge || 'error' in judge) return null;
  for (const dimension of DM_CRITICAL_JUDGE_DIMENSIONS) {
    const value = judge[dimension];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 5) return null;
  }
  if (judge.followUpUseful !== null && typeof judge.followUpUseful !== 'boolean') return null;
  return judge;
}

function sumComplete(values: Array<number | null>): number | null {
  return values.length > 0 && values.every(isFiniteNonNegative)
    ? values.reduce<number>((sum, value) => sum + (value as number), 0)
    : null;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], value: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = (value / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower] ?? null;
  return (sorted[lower] as number) + ((sorted[upper] as number) - (sorted[lower] as number)) * (rank - lower);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function isOpaqueId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertExactKeys(value: object, allowed: string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`${label} contains forbidden or unknown fields: ${unknown.join(', ')}`);
}

function formatRate(value: number | null): string {
  return value === null ? 'missing' : `${(value * 100).toFixed(1)}%`;
}
