import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { APIRoute } from 'astro';
import { createDbClient, getDatabaseUrl, type DbClient } from '@/lib/db/client';
import { runOutboxBatch, type OutboxWorkerOptions } from '@/lib/outbox/worker';
import type { OutboxQueryable } from '@/lib/outbox/queue';
import { createOpenAiRagIndexClient, readRagVectorStoreId } from '@/lib/rag/openai';

export const prerender = false;

interface OutboxRunEnv {
  OUTBOX_WORKER_TOKEN?: string;
  SITE_REFRESH_DEPLOY_HOOK_URL?: string;
  RAG_VECTOR_STORE_ID?: string;
}

export interface OutboxRunHandlerDeps {
  db?: OutboxQueryable;
  createClient?: () => DbClient;
  env?: OutboxRunEnv;
  workerOptions?: Partial<OutboxWorkerOptions>;
}

export function createOutboxRunPostHandler(deps: OutboxRunHandlerDeps = {}): APIRoute {
  return async ({ request }) => {
    const env = deps.env ?? process.env;
    const configuredToken = env.OUTBOX_WORKER_TOKEN ?? '';
    if (Buffer.byteLength(configuredToken, 'utf8') < 32) {
      return workerJson(503, { ok: false, code: 'outbox_worker_unconfigured', message: 'Outbox worker authentication is not configured.' });
    }
    if (!validBearerToken(request.headers.get('authorization'), configuredToken)) {
      return workerJson(401, { ok: false, code: 'outbox_worker_unauthorized', message: 'A valid worker bearer token is required.' });
    }

    let db: OutboxQueryable;
    try {
      db = deps.db ?? dbFromClient(deps.createClient?.() ?? createDbClient(getDatabaseUrl()));
    } catch {
      return workerJson(503, { ok: false, code: 'database_config_missing', message: 'Outbox database configuration is missing.' });
    }

    try {
      const result = await runOutboxBatch(db, {
        workerId: deps.workerOptions?.workerId ?? `vercel_${randomUUID()}`,
        limit: Math.min(deps.workerOptions?.limit ?? 10, 10),
        deadlineMs: Math.min(deps.workerOptions?.deadlineMs ?? 45_000, 45_000),
        leaseSeconds: deps.workerOptions?.leaseSeconds,
        vectorStoreId: deps.workerOptions?.vectorStoreId ?? readRagVectorStoreId(env),
        siteRefreshDeployHookUrl: deps.workerOptions?.siteRefreshDeployHookUrl ?? env.SITE_REFRESH_DEPLOY_HOOK_URL,
        fetchImpl: deps.workerOptions?.fetchImpl,
        ragClient: deps.workerOptions?.ragClient,
        createRagClient: deps.workerOptions?.createRagClient ?? createOpenAiRagIndexClient,
        now: deps.workerOptions?.now,
      });
      return workerJson(200, { ok: true, code: 'outbox_batch_processed', ...result });
    } catch (error) {
      const errorRef = randomUUID().slice(0, 8);
      console.error('[outbox-worker]', JSON.stringify({ errorRef, name: error instanceof Error ? error.name : typeof error }));
      return workerJson(500, {
        ok: false,
        code: 'outbox_worker_failed',
        message: `Outbox worker failed. Error ref ${errorRef}.`,
        errorRef,
      });
    }
  };
}

function validBearerToken(header: string | null, expected: string): boolean {
  const supplied = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const suppliedDigest = createHash('sha256').update(supplied, 'utf8').digest();
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

function dbFromClient(client: DbClient): OutboxQueryable {
  return {
    async query<Row = unknown>(query: string, params?: unknown[]) {
      const rows = (await client.query(query, params)) as Row[];
      return { rows };
    },
  };
}

function workerJson(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export const POST = createOutboxRunPostHandler();
export const ALL: APIRoute = () => workerJson(405, { ok: false, code: 'method_not_allowed', message: 'Use POST.' });
