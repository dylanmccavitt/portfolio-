import type { DMStreamEvent } from './contract';

export type DMBenchmarkFailureClass = 'OK' | 'EVAL_FAILED' | 'MODEL_CALL_FAILED' | 'STREAM_ERROR' | 'PARTIAL_STREAM';

export interface TimedDMEvent {
  event: DMStreamEvent;
  elapsedMs: number;
}

export interface DMBenchmarkClassificationInput {
  events: TimedDMEvent[];
  completionMs: number;
  evalFailure: string | null;
}

export interface DMBenchmarkClassification {
  firstTokenMs: number | null;
  completionMs: number;
  toolCount: number;
  errorCount: number;
  hasDone: boolean;
  errorMessage: string | null;
  failureClass: DMBenchmarkFailureClass;
  failureDetail: string | null;
  validLatency: boolean;
  modelExercised: boolean;
  evalPassed: boolean;
}

export interface DMBenchmarkRunRecord extends DMBenchmarkClassification {
  model: string;
  caseName: string;
  iteration: number;
  sessionStartMs: number;
  dryRun: boolean;
}

export interface DMBenchmarkModelSummary {
  model: string;
  runs: number;
  validLatencyRuns: number;
  modelExercisedRuns: number;
  nonModelRuns: number;
  liveLatencyRuns: number;
  invalidRuns: number;
  evalPassedRuns: number;
  evalTotalRuns: number;
  errorRuns: number;
  firstTokenMedianMs: number | null;
  firstTokenP95Ms: number | null;
  completionMedianMs: number | null;
  completionP95Ms: number | null;
  toolCountMedian: number | null;
  failures: Record<DMBenchmarkFailureClass, number>;
}

export function classifyBenchmarkRun(input: DMBenchmarkClassificationInput): DMBenchmarkClassification {
  const firstToken = input.events.find((entry) => entry.event.type === 'text-delta' || entry.event.type === 'block');
  const firstTokenMs = firstToken ? clampMs(firstToken.elapsedMs) : null;
  const completionMs = clampMs(input.completionMs);
  const toolCount = input.events.filter((entry) => entry.event.type === 'tool').length;
  const errorEvents = input.events
    .map((entry) => entry.event)
    .filter((event): event is Extract<DMStreamEvent, { type: 'error' }> => event.type === 'error');
  const errorCount = errorEvents.length;
  const hasDone = input.events.some((entry) => entry.event.type === 'done');
  const errorMessage = errorEvents.length > 0 ? errorEvents.map((event) => event.message).join(' | ') : null;
  const modelExercised = input.events.some((entry) => entry.event.type === 'ready');

  let failureClass: DMBenchmarkFailureClass;
  let validLatency = false;
  let failureDetail: string | null = null;

  if (errorCount > 0) {
    if (firstTokenMs === null) {
      failureClass = 'MODEL_CALL_FAILED';
      failureDetail = errorMessage;
    } else {
      failureClass = 'STREAM_ERROR';
      failureDetail = errorMessage;
    }
  } else if (!hasDone || firstTokenMs === null || !Number.isFinite(input.completionMs)) {
    failureClass = 'PARTIAL_STREAM';
    failureDetail = !hasDone ? 'stream closed without done event' : 'missing first-token or completion timing';
  } else if (input.evalFailure) {
    failureClass = 'EVAL_FAILED';
    validLatency = true;
    failureDetail = input.evalFailure;
  } else {
    failureClass = 'OK';
    validLatency = true;
  }

  return {
    firstTokenMs,
    completionMs,
    toolCount,
    errorCount,
    hasDone,
    errorMessage,
    failureClass,
    failureDetail,
    validLatency,
    modelExercised,
    evalPassed: input.evalFailure === null,
  };
}

export function aggregateBenchmarkRuns(runs: DMBenchmarkRunRecord[]): DMBenchmarkModelSummary[] {
  const grouped = new Map<string, DMBenchmarkRunRecord[]>();
  for (const run of runs) {
    const bucket = grouped.get(run.model);
    if (bucket) bucket.push(run);
    else grouped.set(run.model, [run]);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([model, modelRuns]) => {
      const validLatencyRuns = modelRuns.filter((run) => run.validLatency);
      const modelLatencyRuns = validLatencyRuns.filter((run) => run.modelExercised);
      const timedRuns = modelLatencyRuns.filter((run) => run.firstTokenMs !== null);

      const firstTokens = timedRuns.map((run) => run.firstTokenMs as number);
      const completions = modelLatencyRuns.map((run) => run.completionMs);
      const toolCounts = modelLatencyRuns.map((run) => run.toolCount);

      return {
        model,
        runs: modelRuns.length,
        validLatencyRuns: validLatencyRuns.length,
        modelExercisedRuns: modelRuns.filter((run) => run.modelExercised).length,
        nonModelRuns: modelRuns.filter((run) => !run.modelExercised).length,
        liveLatencyRuns: modelLatencyRuns.filter((run) => !run.dryRun).length,
        invalidRuns: modelRuns.length - validLatencyRuns.length,
        evalPassedRuns: modelRuns.filter((run) => run.evalPassed).length,
        evalTotalRuns: modelRuns.length,
        errorRuns: modelRuns.filter((run) => run.errorCount > 0).length,
        firstTokenMedianMs: median(firstTokens),
        firstTokenP95Ms: percentile(firstTokens, 95),
        completionMedianMs: median(completions),
        completionP95Ms: percentile(completions, 95),
        toolCountMedian: median(toolCounts),
        failures: modelRuns.reduce<Record<DMBenchmarkFailureClass, number>>((counts, run) => {
          counts[run.failureClass] += 1;
          return counts;
        }, emptyFailureCounts()),
      } satisfies DMBenchmarkModelSummary;
    });
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return clampMs((sorted[middle - 1] + sorted[middle]) / 2);
  }
  return clampMs(sorted[middle] as number);
}

export function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const clampedPercentile = Math.min(100, Math.max(0, percentileValue));
  const sorted = [...values].sort((left, right) => left - right);
  const rank = (clampedPercentile / 100) * (sorted.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const lower = sorted[lowerIndex] as number;
  const upper = sorted[upperIndex] as number;
  if (lowerIndex === upperIndex) return clampMs(lower);
  return clampMs(lower + (upper - lower) * (rank - lowerIndex));
}

function clampMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function emptyFailureCounts(): Record<DMBenchmarkFailureClass, number> {
  return {
    OK: 0,
    EVAL_FAILED: 0,
    MODEL_CALL_FAILED: 0,
    STREAM_ERROR: 0,
    PARTIAL_STREAM: 0,
  };
}
