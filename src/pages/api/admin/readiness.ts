import type { APIRoute } from 'astro';
import { hasMinimumSecretBytes, hasValidBearerToken } from '@/lib/admin/auth';
import {
  createDbClient,
  getDatabaseUrl,
  type DatabaseEnv,
  type DbClient,
} from '@/lib/db/client';

export const prerender = false;

const READINESS_QUERY_DEADLINE_MS = 2_000;
const OUTBOX_OVERDUE_MINUTES = 15;
export const OUTBOX_BACKLOG_THRESHOLD = 20;

const OUTBOX_READINESS_SQL = `SELECT
  COUNT(*) FILTER (WHERE state = 'queued') AS queued,
  COUNT(*) FILTER (WHERE state = 'processing') AS processing,
  COUNT(*) FILTER (WHERE state = 'dead') AS dead,
  COUNT(*) FILTER (
    WHERE (state = 'queued' AND next_attempt_at <= now() - interval '${OUTBOX_OVERDUE_MINUTES} minutes')
       OR (state = 'processing' AND lease_expires_at <= now())
  ) AS overdue
FROM publish_outbox`;

export interface AdminReadinessEnv extends DatabaseEnv {
  DM_READINESS_TOKEN?: string;
  OPENAI_API_KEY?: string;
}

export interface ReadinessQueryable {
  query<Row = unknown>(
    sql: string,
    params?: unknown[],
    options?: { fetchOptions?: { signal?: AbortSignal } },
  ): Promise<{ rows: Row[] } | Row[]>;
}

export interface AdminReadinessHandlerDeps {
  db?: ReadinessQueryable;
  createClient?: () => DbClient;
  env?: AdminReadinessEnv;
  /** Test-only override; production calls are always capped at 2000 ms. */
  deadlineMs?: number;
}

type OutboxCounts = {
  queued: number;
  processing: number;
  dead: number;
  overdue: number;
  backlogExceeded: boolean;
};

type ReadinessStatus = 'ready' | 'degraded';

type OutboxCountRow = {
  queued: string | number;
  processing: string | number;
  dead: string | number;
  overdue: string | number;
};

/**
 * A machine-authenticated, redacted release gate. It deliberately makes one
 * aggregate database query so the 2000 ms response budget covers all checks.
 */
export function createAdminReadinessGetHandler(deps: AdminReadinessHandlerDeps = {}): APIRoute {
  return async ({ request }) => {
    const env = deps.env ?? process.env;
    const configuredToken = env.DM_READINESS_TOKEN?.trim() ?? '';
    const unverified = readinessPayload('degraded', false, false, unavailableOutbox());

    if (!hasMinimumSecretBytes(configuredToken)) return readinessJson(503, unverified);
    if (!hasValidBearerToken(request.headers.get('authorization'), configuredToken)) {
      return readinessJson(401, unverified);
    }

    const ragConfigured = Boolean(env.OPENAI_API_KEY?.trim());
    let db: ReadinessQueryable;
    try {
      db = deps.db ?? dbFromClient(deps.createClient?.() ?? createDbClient(getDatabaseUrl(env)));
    } catch {
      return readinessJson(503, readinessPayload('degraded', false, ragConfigured, unavailableOutbox()));
    }

    try {
      const deadlineMs = boundedDeadline(deps.deadlineMs);
      const controller = new AbortController();
      const row = await queryWithinDeadline(
        db.query<OutboxCountRow>(OUTBOX_READINESS_SQL, undefined, {
          fetchOptions: { signal: controller.signal },
        }).then(normalizeRows).then((rows) => rows[0]),
        deadlineMs,
        controller,
      );
      if (!row) throw new Error('readiness counts missing');

      const outbox = outboxCounts(row);
      const status: ReadinessStatus = ragConfigured && !outbox.backlogExceeded ? 'ready' : 'degraded';
      return readinessJson(status === 'ready' ? 200 : 503, readinessPayload(status, true, ragConfigured, outbox));
    } catch {
      return readinessJson(503, readinessPayload('degraded', false, ragConfigured, unavailableOutbox()));
    }
  };
}

function boundedDeadline(value: number | undefined): number {
  return Math.min(Math.max(value ?? READINESS_QUERY_DEADLINE_MS, 1), READINESS_QUERY_DEADLINE_MS);
}

async function queryWithinDeadline<T>(
  operation: Promise<T>,
  deadlineMs: number,
  controller: AbortController,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error('readiness query deadline exceeded'));
        }, deadlineMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function dbFromClient(client: DbClient): ReadinessQueryable {
  return {
    async query<Row = unknown>(sql: string, params?: unknown[], options?: { fetchOptions?: { signal?: AbortSignal } }) {
      const rows = (await client.query(sql, params, options)) as Row[];
      return { rows };
    },
  };
}

function normalizeRows<Row>(result: { rows: Row[] } | Row[]): Row[] {
  return Array.isArray(result) ? result : result.rows;
}

function outboxCounts(row: OutboxCountRow): OutboxCounts {
  const queued = positiveInteger(row.queued, 'queued');
  const processing = positiveInteger(row.processing, 'processing');
  const dead = positiveInteger(row.dead, 'dead');
  const overdue = positiveInteger(row.overdue, 'overdue');
  const activeBacklog = queued + processing;

  return {
    queued,
    processing,
    dead,
    overdue,
    // A dead or overdue job is operationally actionable even when the active
    // queue itself is below the numeric threshold.
    backlogExceeded: activeBacklog >= OUTBOX_BACKLOG_THRESHOLD || dead > 0 || overdue > 0,
  };
}

function positiveInteger(value: string | number, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`invalid ${name} readiness count`);
  return parsed;
}

function unavailableOutbox(): OutboxCounts {
  return { queued: 0, processing: 0, dead: 0, overdue: 0, backlogExceeded: true };
}

function readinessPayload(
  status: ReadinessStatus,
  dbOk: boolean,
  ragConfigured: boolean,
  outbox: OutboxCounts,
): Record<string, unknown> {
  return {
    status,
    checks: {
      db: { ok: dbOk },
      outbox,
      rag: { configured: ragConfigured },
    },
  };
}

function readinessJson(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export const GET = createAdminReadinessGetHandler();
export const ALL: APIRoute = () => readinessJson(405, readinessPayload('degraded', false, false, unavailableOutbox()));
