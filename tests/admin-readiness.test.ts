import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAdminReadinessGetHandler,
  OUTBOX_BACKLOG_THRESHOLD,
  type ReadinessQueryable,
} from '@/pages/api/admin/readiness';

const TOKEN = 'r'.repeat(32);
const RAG_KEY = 'readiness-test-openai-key';

type ReadinessBody = {
  status: 'ready' | 'degraded';
  checks: {
    db: { ok: boolean };
    outbox: {
      queued: number;
      processing: number;
      dead: number;
      overdue: number;
      backlogExceeded: boolean;
    };
    rag: { configured: boolean };
  };
};

function readinessRequest(token?: string): Request {
  return new Request('https://portfolio.test/api/admin/readiness', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

function countDb(
  counts: { queued?: number; processing?: number; dead?: number; overdue?: number } = {},
): ReadinessQueryable {
  return {
    async query<Row = unknown>() {
      return {
        rows: [{
          queued: counts.queued ?? 0,
          processing: counts.processing ?? 0,
          dead: counts.dead ?? 0,
          overdue: counts.overdue ?? 0,
        } as Row],
      };
    },
  };
}

async function body(response: Response): Promise<ReadinessBody> {
  return (await response.json()) as ReadinessBody;
}

test('readiness keeps missing configuration and missing or invalid bearer auth away from the database', async () => {
  let calls = 0;
  const db: ReadinessQueryable = {
    async query() {
      calls += 1;
      throw new Error('database must not be reached');
    },
  };

  const missingConfig = createAdminReadinessGetHandler({ db, env: {} });
  const missingConfigResponse = await missingConfig({ request: readinessRequest(TOKEN) } as never);
  assert.equal(missingConfigResponse.status, 503);
  assert.equal((await body(missingConfigResponse)).checks.db.ok, false);

  const configured = createAdminReadinessGetHandler({
    db,
    env: { DM_READINESS_TOKEN: TOKEN, OPENAI_API_KEY: RAG_KEY },
  });
  const missingAuth = await configured({ request: readinessRequest() } as never);
  const invalidAuth = await configured({ request: readinessRequest('wrong-token') } as never);

  assert.equal(missingAuth.status, 401);
  assert.equal(invalidAuth.status, 401);
  assert.deepEqual((await body(missingAuth)).checks.outbox, {
    queued: 0,
    processing: 0,
    dead: 0,
    overdue: 0,
    backlogExceeded: true,
  });
  assert.equal(calls, 0);
});

test('readiness returns the stable healthy shape only for a reachable DB, configured RAG, and bounded outbox', async () => {
  const GET = createAdminReadinessGetHandler({
    db: countDb({ queued: 2, processing: 1 }),
    env: { DM_READINESS_TOKEN: TOKEN, OPENAI_API_KEY: RAG_KEY },
  });

  const response = await GET({ request: readinessRequest(TOKEN) } as never);
  const json = await body(response);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual(json, {
    status: 'ready',
    checks: {
      db: { ok: true },
      outbox: { queued: 2, processing: 1, dead: 0, overdue: 0, backlogExceeded: false },
      rag: { configured: true },
    },
  });
});

test('readiness degrades for a missing RAG key, an excessive active backlog, and dead or overdue jobs', async () => {
  const cases = [
    {
      name: 'RAG key missing',
      env: { DM_READINESS_TOKEN: TOKEN },
      counts: {},
      expected: { configured: false, backlogExceeded: false },
    },
    {
      name: 'backlog threshold reached',
      env: { DM_READINESS_TOKEN: TOKEN, OPENAI_API_KEY: RAG_KEY },
      counts: { queued: OUTBOX_BACKLOG_THRESHOLD },
      expected: { configured: true, backlogExceeded: true },
    },
    {
      name: 'dead job',
      env: { DM_READINESS_TOKEN: TOKEN, OPENAI_API_KEY: RAG_KEY },
      counts: { dead: 1 },
      expected: { configured: true, backlogExceeded: true },
    },
    {
      name: 'overdue job',
      env: { DM_READINESS_TOKEN: TOKEN, OPENAI_API_KEY: RAG_KEY },
      counts: { overdue: 1 },
      expected: { configured: true, backlogExceeded: true },
    },
  ] as const;

  for (const entry of cases) {
    const GET = createAdminReadinessGetHandler({ db: countDb(entry.counts), env: entry.env });
    const response = await GET({ request: readinessRequest(TOKEN) } as never);
    const json = await body(response);
    assert.equal(response.status, 503, entry.name);
    assert.equal(json.status, 'degraded', entry.name);
    assert.equal(json.checks.db.ok, true, entry.name);
    assert.equal(json.checks.rag.configured, entry.expected.configured, entry.name);
    assert.equal(json.checks.outbox.backlogExceeded, entry.expected.backlogExceeded, entry.name);
  }
});

test('readiness enforces its total query deadline and never serializes errors or configured values', async () => {
  let aborted = false;
  const hanging: ReadinessQueryable = {
    async query<Row = unknown>(
      _sql: string,
      _params?: unknown[],
      options?: { fetchOptions?: { signal?: AbortSignal } },
    ) {
      return new Promise<Row[]>((_resolve, reject) => {
        options?.fetchOptions?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('query aborted'));
        }, { once: true });
      });
    },
  };
  const timeout = createAdminReadinessGetHandler({
    db: hanging,
    env: { DM_READINESS_TOKEN: TOKEN, OPENAI_API_KEY: RAG_KEY },
    deadlineMs: 1,
  });
  const timeoutResponse = await timeout({ request: readinessRequest(TOKEN) } as never);
  assert.equal(timeoutResponse.status, 503);
  assert.equal((await body(timeoutResponse)).checks.db.ok, false);
  assert.equal(aborted, true);

  const noLeakSentinel = 'READINESS_NO_LEAK_SENTINEL';
  const failing: ReadinessQueryable = {
    async query() {
      throw new Error(noLeakSentinel);
    },
  };
  const redacted = createAdminReadinessGetHandler({
    db: failing,
    env: { DM_READINESS_TOKEN: TOKEN, OPENAI_API_KEY: `${noLeakSentinel}_OPENAI` },
  });
  const response = await redacted({ request: readinessRequest(TOKEN) } as never);
  const serialized = JSON.stringify(await body(response));

  assert.equal(response.status, 503);
  assert.equal(serialized.includes(noLeakSentinel), false);
  assert.equal(serialized.includes(TOKEN), false);
});
