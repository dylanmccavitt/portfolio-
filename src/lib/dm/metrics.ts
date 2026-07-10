import type { DMStreamEvent } from './contract';

export type DMMetricsOutcome = 'completed' | 'error' | 'timeout' | 'aborted' | 'rate_limited';
export type DMSourceMode = 'published_db' | 'resume_static' | 'contact_static' | 'rag' | 'mixed' | 'none';

export interface DMMetricsRecord {
  traceId: string;
  sessionStart: number;
  /** Milliseconds to first visible output (text-delta or block); null when the stream failed before any token. */
  firstTokenMs: number | null;
  completionMs?: number;
  toolCount: number;
  errorCount: number;
  sourceMode: DMSourceMode;
  retrievalHits: number;
  fallbackUsed: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  outcome?: DMMetricsOutcome;
}

export interface DMMetricsRecorder {
  ready(event: Extract<DMStreamEvent, { type: 'ready' }>): void;
  tool(event: Extract<DMStreamEvent, { type: 'tool' }>): void;
  textDelta(event: Extract<DMStreamEvent, { type: 'text-delta' }>): void;
  block(event: Extract<DMStreamEvent, { type: 'block' }>): void;
  done(event: Extract<DMStreamEvent, { type: 'done' }>): void;
  error(event: Extract<DMStreamEvent, { type: 'error' }>): void;
  setSource(sourceMode: DMSourceMode, retrievalHits: number, fallbackUsed: boolean): void;
  setUsage(inputTokens: number | null, outputTokens: number | null): void;
  finish(outcome: DMMetricsOutcome): void;
  record(event: DMStreamEvent): void;
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

/**
 * Metrics default ON: one content-free JSON line per chat stream is the
 * production baseline AGE-718 tunes against. Opt out with DM_METRICS=0|false|off|no.
 */
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
    fallbackUsed: false,
    inputTokens: null,
    outputTokens: null,
  };
  let emitted = false;

  function markFirstToken(): void {
    record.firstTokenMs ??= Math.max(0, now() - record.sessionStart);
  }

  function finish(outcome: DMMetricsOutcome): void {
    record.outcome = outcome;
    record.completionMs = Math.max(0, now() - record.sessionStart);
    emitOnce();
  }

  function emitOnce(): void {
    if (!enabled || emitted) return;
    emitted = true;
    try {
      logger(`[dm-metrics] ${JSON.stringify(snapshot())}`);
    } catch {
      // Metrics are deliberately best-effort, including direct completion paths.
    }
  }

  function snapshot(): DMMetricsRecord {
    return { ...record };
  }

  return {
    ready() {},
    tool() {
      record.toolCount += 1;
    },
    textDelta() {
      markFirstToken();
    },
    block() {
      markFirstToken();
    },
    done() {
      finish('completed');
    },
    error() {
      record.errorCount += 1;
      finish('error');
    },
    setSource(sourceMode, retrievalHits, fallbackUsed) {
      record.sourceMode = sourceMode;
      record.retrievalHits = Math.max(0, Math.trunc(retrievalHits));
      record.fallbackUsed = fallbackUsed;
    },
    setUsage(inputTokens, outputTokens) {
      record.inputTokens = safeUsage(inputTokens);
      record.outputTokens = safeUsage(outputTokens);
    },
    finish,
    record(event) {
      // Metrics must never kill the stream: swallow recorder/logger failures.
      try {
        if (event.type === 'ready') this.ready(event);
        else if (event.type === 'tool') this.tool(event);
        else if (event.type === 'text-delta') this.textDelta(event);
        else if (event.type === 'block') this.block(event);
        else if (event.type === 'done') this.done(event);
        else this.error(event);
      } catch {
        // Swallow: instrumentation is best-effort by contract.
      }
    },
    snapshot,
  };
}

function safeUsage(value: number | null): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}
