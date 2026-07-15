export type DMMetricsOutcome = 'completed' | 'error' | 'timeout' | 'aborted' | 'rate_limited';
export type DMSourceMode = 'published_db' | 'resume_static' | 'contact_static' | 'rag' | 'mixed' | 'none';
export const DM_RUNTIME_ERROR_CATEGORIES = [
  'provider_retry_exhausted',
  'provider_failure',
  'timeout',
  'aborted',
  'finalization_validation',
  'unknown',
] as const;
export type DMRuntimeErrorCategory = (typeof DM_RUNTIME_ERROR_CATEGORIES)[number];

export function isDMRuntimeErrorCategory(value: unknown): value is DMRuntimeErrorCategory {
  return typeof value === 'string'
    && DM_RUNTIME_ERROR_CATEGORIES.includes(value as DMRuntimeErrorCategory);
}

export interface DMMetricsRecord {
  traceId: string;
  sessionStart: number;
  firstTokenMs: number | null;
  completionMs?: number;
  toolCount: number;
  errorCount: number;
  sourceMode: DMSourceMode;
  retrievalHits: number;
  limitedAnswer: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  errorCategory: DMRuntimeErrorCategory | null;
  outcome?: DMMetricsOutcome;
}

export interface DMMetricsRecorder {
  modelStarted(): void;
  tool(): void;
  visibleOutput(): void;
  error(category?: DMRuntimeErrorCategory): void;
  setErrorCategory(category: DMRuntimeErrorCategory): void;
  setSource(sourceMode: DMSourceMode, retrievalHits: number, limitedAnswer: boolean): void;
  setUsage(inputTokens: number | null, outputTokens: number | null): void;
  finish(outcome: DMMetricsOutcome): void;
  snapshot(): DMMetricsRecord;
}

export interface DMMetricsRecorderOptions {
  enabled?: boolean;
  now?: () => number;
  logger?: (line: string) => void;
  traceId?: string;
  sourceMode?: DMSourceMode;
}

const DISABLED_VALUES: Record<string, true> = { 0: true, false: true, off: true, no: true };

export function shouldRecordDMMetrics(env: Record<string, string | undefined> = process.env): boolean {
  const value = env.DM_METRICS?.trim().toLowerCase();
  return !value || !DISABLED_VALUES[value];
}

export function createDMMetricsRecorder(options: DMMetricsRecorderOptions = {}): DMMetricsRecorder {
  const enabled = options.enabled ?? true;
  const now = options.now ?? Date.now;
  const logger = options.logger ?? ((line: string) => console.info(line));
  const record: DMMetricsRecord = {
    traceId: options.traceId ?? 'unknown',
    sessionStart: now(),
    firstTokenMs: null,
    toolCount: 0,
    errorCount: 0,
    sourceMode: options.sourceMode ?? 'none',
    retrievalHits: 0,
    limitedAnswer: false,
    inputTokens: null,
    outputTokens: null,
    errorCategory: null,
  };
  let emitted = false;

  function finish(outcome: DMMetricsOutcome): void {
    if (record.outcome) return;
    if (outcome === 'timeout') record.errorCategory = 'timeout';
    if (outcome === 'aborted') record.errorCategory = 'aborted';
    record.outcome = outcome;
    record.completionMs = Math.max(0, now() - record.sessionStart);
    if (!enabled || emitted) return;
    emitted = true;
    try {
      logger(`[dm-metrics] ${JSON.stringify({ ...record })}`);
    } catch {
      // Metrics are content-free and best-effort; a sink never breaks chat.
    }
  }

  return {
    modelStarted() {},
    tool() {
      record.toolCount += 1;
    },
    visibleOutput() {
      record.firstTokenMs ??= Math.max(0, now() - record.sessionStart);
    },
    error(category = 'unknown') {
      record.errorCount += 1;
      record.errorCategory ??= category;
      finish('error');
    },
    setErrorCategory(category) {
      record.errorCategory ??= category;
    },
    setSource(sourceMode, retrievalHits, limitedAnswer) {
      record.sourceMode = sourceMode;
      record.retrievalHits = Math.max(0, Math.trunc(retrievalHits));
      record.limitedAnswer = limitedAnswer;
    },
    setUsage(input, output) {
      record.inputTokens = safeUsage(input);
      record.outputTokens = safeUsage(output);
    },
    finish,
    snapshot() {
      return { ...record };
    },
  };
}

function safeUsage(value: number | null): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}
