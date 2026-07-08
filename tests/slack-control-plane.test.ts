import assert from 'node:assert/strict';
import test from 'node:test';
import { format } from 'node:util';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations, type Queryable } from '../scripts/db';
import { PORTFOLIO_CANDIDATE_TOPIC, type GithubRepositorySnapshot } from '@/lib/db/github-discovery';
import {
  handleSlackFormEncodedRequest,
  signSlackBody,
  verifySlackRequest,
  type SlackControlPlaneConfig,
} from '@/lib/slack/control-plane';
import { createGithubSnapshotFetcher } from '@/lib/slack/github-fetch';
import { createSlackControlPlanePostHandler } from '@/pages/api/slack/control-plane';

const SIGNING_SECRET = 'test-signing-secret';
const DYLAN_SLACK_USER = 'U_DYLAN';
const NOW = new Date('2026-06-30T12:00:00.000Z');
const NOW_SECONDS = String(Math.floor(NOW.getTime() / 1000));

const CONFIG: SlackControlPlaneConfig = {
  signingSecret: SIGNING_SECRET,
  allowedUserId: DYLAN_SLACK_USER,
  now: () => NOW,
};

const LIVE_REPO: GithubRepositorySnapshot = {
  owner: 'DylanMcCavitt',
  name: 'portfolio-candidate-app',
  fullName: 'DylanMcCavitt/portfolio-candidate-app',
  htmlUrl: 'https://github.com/DylanMcCavitt/portfolio-candidate-app',
  description: 'A live GitHub repo worth reviewing for the portfolio.',
  homepageUrl: 'https://example.com/candidate',
  language: 'TypeScript',
  topics: [PORTFOLIO_CANDIDATE_TOPIC, 'astro'],
  isPrivate: false,
  defaultBranch: 'main',
  pushedAt: '2026-06-01T00:00:00.000Z',
  stars: 2,
  readmeMarkdown: '# Live candidate\n\nFetched from GitHub.',
};

function createTestDb(): Queryable {
  return new PGlite() as Queryable;
}

async function createMigratedDb(): Promise<Queryable> {
  const db = createTestDb();
  await applyMigrations(db);
  return db;
}

function signedSlackRequest(body: string, config = CONFIG): Request {
  return new Request('https://example.test/api/slack/control-plane', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-slack-request-timestamp': NOW_SECONDS,
      'x-slack-signature': signSlackBody(config.signingSecret, NOW_SECONDS, body),
    },
    body,
  });
}

function formBody(values: Record<string, string>): string {
  return new URLSearchParams(values).toString();
}

async function callRoute(body: string, db: Queryable, config = CONFIG): Promise<Response> {
  const POST = createSlackControlPlanePostHandler({ config, db });
  return POST({ request: signedSlackRequest(body, config) } as never);
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function slackLogDetails(logged: string[]): Record<string, unknown>[] {
  return logged
    .filter((line) => line.includes('[slack-control-plane]'))
    .map((line) => JSON.parse(line.slice(line.indexOf('{'))) as Record<string, unknown>);
}

function assertSlackLogKeys(logged: string[]): void {
  const errorKeys = ['errorRef', 'frames', 'name', 'pg_code', 'pg_constraint', 'pg_table'];
  const nonErrorKeys = ['errorRef', 'thrownType'];
  for (const details of slackLogDetails(logged)) {
    const allowedKeys = 'thrownType' in details ? nonErrorKeys : errorKeys;
    assert.deepEqual(
      Object.keys(details).sort(),
      Object.keys(details)
        .filter((key) => allowedKeys.includes(key))
        .sort(),
      'slack control-plane logs must not add unapproved fields',
    );
  }
}

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers,
  });
}

function fetchHeaders(init: RequestInit | undefined): Record<string, string> {
  return Object.fromEntries(new Headers(init?.headers).entries());
}

test('GitHub snapshot fetcher maps REST metadata and sends token-authenticated headers', async () => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, headers: fetchHeaders(init) });
    if (url.endsWith('/readme')) {
      return new Response('# Candidate app\n\nReadme body');
    }
    return jsonResponse({
      description: 'Fetched description',
      homepage: 'https://example.com/fetched',
      language: 'TypeScript',
      topics: [PORTFOLIO_CANDIDATE_TOPIC, 'workflow'],
      private: false,
      default_branch: 'main',
      pushed_at: '2026-06-01T00:00:00.000Z',
      stargazers_count: 7,
      html_url: 'https://github.com/DylanMcCavitt/portfolio-candidate-app',
      full_name: 'DylanMcCavitt/portfolio-candidate-app',
    });
  };

  const fetcher = createGithubSnapshotFetcher({ token: 'ghs_test_token', fetchImpl });
  const snapshot = await fetcher('DylanMcCavitt', 'portfolio-candidate-app');

  assert.deepEqual(calls.map((call) => call.url), [
    'https://api.github.com/repos/DylanMcCavitt/portfolio-candidate-app',
    'https://api.github.com/repos/DylanMcCavitt/portfolio-candidate-app/readme',
  ]);
  assert.equal(calls[0]?.headers.accept, 'application/vnd.github+json');
  assert.equal(calls[0]?.headers['x-github-api-version'], '2022-11-28');
  assert.equal(calls[0]?.headers['user-agent'], 'portfolio-dm-scan');
  assert.equal(calls[0]?.headers.authorization, 'Bearer ghs_test_token');
  assert.equal(calls[1]?.headers.accept, 'application/vnd.github.raw+json');
  assert.equal(calls[1]?.headers.authorization, 'Bearer ghs_test_token');

  assert.deepEqual(snapshot, {
    owner: 'DylanMcCavitt',
    name: 'portfolio-candidate-app',
    fullName: 'DylanMcCavitt/portfolio-candidate-app',
    htmlUrl: 'https://github.com/DylanMcCavitt/portfolio-candidate-app',
    description: 'Fetched description',
    homepageUrl: 'https://example.com/fetched',
    language: 'TypeScript',
    topics: [PORTFOLIO_CANDIDATE_TOPIC, 'workflow'],
    isPrivate: false,
    defaultBranch: 'main',
    pushedAt: '2026-06-01T00:00:00.000Z',
    stars: 7,
    readmeMarkdown: '# Candidate app\n\nReadme body',
  });
});

test('GitHub snapshot fetcher omits authorization without a token and degrades readme 404 to null', async () => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, headers: fetchHeaders(init) });
    if (url.endsWith('/readme')) return new Response('not found', { status: 404 });
    return jsonResponse({
      description: null,
      homepage: null,
      language: null,
      topics: [],
      private: true,
      default_branch: 'trunk',
      pushed_at: null,
      stargazers_count: 0,
      html_url: 'https://github.com/DylanMcCavitt/private-app',
      full_name: 'DylanMcCavitt/private-app',
    });
  };

  const snapshot = await createGithubSnapshotFetcher({ fetchImpl })('DylanMcCavitt', 'private-app');

  assert.equal(calls[0]?.headers.authorization, undefined);
  assert.equal(calls[1]?.headers.authorization, undefined);
  assert.equal(snapshot.isPrivate, true);
  assert.equal(snapshot.readmeMarkdown, null);
});

test('GitHub snapshot fetcher repo failures throw safe errors without body or token leakage', async () => {
  const fetchImpl: typeof fetch = async () => new Response('body secret ghs_test_token', { status: 404 });
  const fetcher = createGithubSnapshotFetcher({ token: 'ghs_test_token', fetchImpl });

  await assert.rejects(
    () => fetcher('DylanMcCavitt', 'missing-private-app'),
    (error) => {
      const thrown = error as { code?: string; message?: string };
      assert.equal(thrown.code, 'github_fetch_failed');
      assert.match(String(thrown.message), /not found or is not accessible \(HTTP 404\)/);
      assert.ok(!String(thrown.message).includes('body secret'), 'repo response body must not leak');
      assert.ok(!String(thrown.message).includes('ghs_test_token'), 'GitHub token must not leak');
      return true;
    },
  );
});

async function insertCandidate(db: Queryable, id = 'candidate_test'): Promise<string> {
  await db.query(
    `INSERT INTO scan_runs (id, trigger, actor, lifecycle_state, started_at, finished_at)
     VALUES ($1, 'test', 'test', 'completed', $2, $2)`,
    [`scan_${id}`, NOW.toISOString()],
  );
  await db.query(
    `INSERT INTO project_candidates (
       id, scan_run_id, source_kind, source_ref, repo_visibility, signals, confidence, evidence_packet, lifecycle_state
     ) VALUES ($1, $2, 'github_repo', $3, 'public', $4::jsonb, 0.91, $5::jsonb, 'qualified')`,
    [
      id,
      `scan_${id}`,
      'https://github.com/DylanMcCavitt/portfolio-candidate-app',
      JSON.stringify({ topic: PORTFOLIO_CANDIDATE_TOPIC, language: 'TypeScript' }),
      JSON.stringify({ repo: 'DylanMcCavitt/portfolio-candidate-app', audit: { allowlisted: true } }),
    ],
  );
  return id;
}

function interactionBody(
  actionId: string,
  candidateId: string,
  userId = DYLAN_SLACK_USER,
  responseUrl = 'https://hooks.slack.test/response',
): string {
  return formBody({
    payload: JSON.stringify({
      type: 'block_actions',
      response_url: responseUrl,
      user: { id: userId },
      actions: [{ action_id: actionId, value: candidateId }],
    }),
  });
}

function fetchBodyJson(init: RequestInit | undefined): Record<string, unknown> {
  const body = init?.body;
  assert.equal(typeof body, 'string');
  return JSON.parse(body as string) as Record<string, unknown>;
}

test('Slack request verification accepts valid signatures and rejects missing stale or invalid signatures', () => {
  const body = formBody({ user_id: DYLAN_SLACK_USER, command: '/dm-scan', text: 'DylanMcCavitt/portfolio-candidate-app' });
  assert.deepEqual(
    verifySlackRequest(
      {
        body,
        timestamp: NOW_SECONDS,
        signature: signSlackBody(SIGNING_SECRET, NOW_SECONDS, body),
      },
      CONFIG,
    ),
    { ok: true },
  );

  const missingSignature = verifySlackRequest({ body, timestamp: NOW_SECONDS, signature: null }, CONFIG);
  assert.equal(missingSignature.ok, false);
  assert.equal(missingSignature.code, 'slack_signature_missing');

  const staleTimestamp = verifySlackRequest(
    { body, timestamp: String(Number(NOW_SECONDS) - 600), signature: 'v0=bad' },
    CONFIG,
  );
  assert.equal(staleTimestamp.ok, false);
  assert.equal(staleTimestamp.code, 'slack_timestamp_stale');

  const invalidSignature = verifySlackRequest({ body, timestamp: NOW_SECONDS, signature: 'v0=bad' }, CONFIG);
  assert.equal(invalidSignature.ok, false);
  assert.equal(invalidSignature.code, 'slack_signature_invalid');

  const missingSecret = verifySlackRequest(
    { body, timestamp: NOW_SECONDS, signature: 'v0=bad' },
    { ...CONFIG, signingSecret: ' ' },
  );
  assert.equal(missingSecret.ok, false);
  assert.equal(missingSecret.code, 'slack_signing_secret_missing');
});

test('Slack command rejects invalid signatures before service work runs', async () => {
  const db = {
    async query() {
      throw new Error('service work should not run');
    },
  } satisfies Queryable;
  const POST = createSlackControlPlanePostHandler({ config: CONFIG, db });
  const body = formBody({ user_id: DYLAN_SLACK_USER, command: '/dm-scan', text: 'DylanMcCavitt/portfolio-candidate-app' });
  const response = await POST({
    request: new Request('https://example.test/api/slack/control-plane', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-slack-request-timestamp': NOW_SECONDS,
        'x-slack-signature': signSlackBody(SIGNING_SECRET, NOW_SECONDS, `${body}tampered`),
      },
      body,
    }),
  } as never);

  assert.equal(response.status, 200);
  assert.deepEqual(await responseJson(response), {
    ok: false,
    code: 'slack_signature_invalid',
    response_type: 'ephemeral',
    text: 'Slack signature is invalid.',
  });
});

test('Slack route returns safe 200 JSON when the request itself fails', async () => {
  const db = {
    async query() {
      throw new Error('database should not be called when request.text fails');
    },
  } satisfies Queryable;
  const POST = createSlackControlPlanePostHandler({ config: CONFIG, db });

  const response = await POST({
    request: {
      headers: new Headers(),
      text: () => Promise.reject(new Error('boom with sensitive details')),
    },
  } as never);
  const json = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(json.ok, false);
  assert.equal(json.code, 'slack_control_plane_error');
  assert.equal(json.response_type, 'ephemeral');
  assert.match(String(json.text), /Error ref [0-9a-f]{8}\.$/);
  assert.ok(!String(json.text).includes('sensitive'), 'raw request error details must not leak to Slack');
});

test('server-side error logs carry only structured facts, never free error text', async (t) => {
  const logged: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(format(...args));
  };
  t.after(() => {
    console.error = originalError;
  });

  const envSecret = 'env-secret-value-cafebabe123';

  const pgError = Object.assign(
    new Error(`duplicate key: Key (email)=(person@example.com) already exists at postgres://user:secret-token@db.example/neon using ${envSecret}\nat postgres://user:frame-credential-only@db.example/neon:123:456`),
    { code: '23505', table: 'project_candidates', constraint: 'project_candidates_pkey', detail: 'Key (email)=(person@example.com) already exists.', routine: 'ExecInsert' },
  );
  const db = {
    async query() {
      throw pgError;
    },
  } satisfies Queryable;
  const POST = createSlackControlPlanePostHandler({ config: CONFIG, db });

  const body = formBody({ user_id: DYLAN_SLACK_USER, command: '/dm-scan', text: 'DylanMcCavitt/portfolio-candidate-app' });
  const response = await POST({ request: signedSlackRequest(body) } as never);
  const json = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(json.ok, false);

  const [details] = slackLogDetails(logged);
  assert.ok(details, 'expected a [slack-control-plane] error log line');
  assertSlackLogKeys(logged);

  assert.match(String(details.errorRef), /^[0-9a-f]{8}$/, 'log keeps the correlation ref');
  assert.equal(details.name, 'Error', 'log keeps the error class name');
  assert.equal(details.pg_code, '23505', 'log keeps schema-level pg code');
  assert.equal(details.pg_table, 'project_candidates', 'log keeps schema-level pg table');
  assert.equal(details.pg_constraint, 'project_candidates_pkey', 'log keeps schema-level pg constraint');
  assert.equal(details.message, undefined, 'free-text message must not be logged at all');
  assert.equal(details.pg_detail, undefined, 'pg detail field must not be logged at all');
  assert.equal(details.pg_routine, undefined, 'pg routine field must not be logged');
  assert.equal(details.routine, undefined, 'raw routine field must not be logged');

  assert.ok(Array.isArray(details.frames), 'stack is reduced to frame lines');
  for (const frame of details.frames as string[]) {
    assert.match(frame, /^at .+:\d+:\d+\)?$/, 'every logged frame is a code location, not error text');
  }

  const fullLogOutput = logged.join('\n');
  assert.ok(!fullLogOutput.includes('duplicate key'), 'error message text must not reach logs');
  assert.ok(!fullLogOutput.includes('person@example.com'), 'pg detail data values must not reach logs');
  assert.ok(!fullLogOutput.includes('secret-token'), 'URL credentials must not reach logs');
  assert.ok(!fullLogOutput.includes('frame-credential-only'), 'multiline messages that resemble real frames must not reach logs');
  assert.ok(!fullLogOutput.includes(envSecret), 'embedded env-style secret values must not reach logs');

  logged.length = 0;
  const stackSecret = 'non-location-secret-envtoken';
  const craftedStackError = new Error('crafted message');
  craftedStackError.stack = `Error: crafted message\n    at ${stackSecret}\n    at handler (/app/src/lib/slack/control-plane.ts:100:5)`;
  const craftedStackDb = {
    async query() {
      throw craftedStackError;
    },
  } satisfies Queryable;
  const craftedStackPost = createSlackControlPlanePostHandler({ config: CONFIG, db: craftedStackDb });
  const craftedStackResponse = await craftedStackPost({ request: signedSlackRequest(body) } as never);
  const craftedStackJson = await responseJson(craftedStackResponse);

  assert.equal(craftedStackResponse.status, 200);
  assert.equal(craftedStackJson.ok, false);

  const [craftedStackDetails] = slackLogDetails(logged);
  assert.ok(craftedStackDetails, 'expected a [slack-control-plane] log line for crafted stack throws');
  assertSlackLogKeys(logged);
  assert.ok(Array.isArray(craftedStackDetails.frames), 'crafted stack is reduced to frame lines');
  assert.deepEqual(craftedStackDetails.frames, ['at handler (/app/src/lib/slack/control-plane.ts:100:5)']);
  for (const frame of craftedStackDetails.frames as string[]) {
    assert.match(frame, /^at .+:\d+:\d+\)?$/, 'every crafted logged frame is a code location');
  }
  assert.ok(!logged.join('\n').includes(stackSecret), 'non-location stack lines must not reach logs');

  logged.length = 0;
  const objectNameSecret = 'obj-name-secret';
  const objectNameError = new Error('safe message');
  Object.defineProperty(objectNameError, 'name', { value: { leak: objectNameSecret } });
  Object.defineProperty(objectNameError, 'stack', { value: undefined });
  const objectNameDb = {
    async query() {
      throw objectNameError;
    },
  } satisfies Queryable;
  const objectNamePost = createSlackControlPlanePostHandler({ config: CONFIG, db: objectNameDb });
  const objectNameResponse = await objectNamePost({ request: signedSlackRequest(body) } as never);
  const objectNameJson = await responseJson(objectNameResponse);

  assert.equal(objectNameResponse.status, 200);
  assert.equal(objectNameJson.ok, false);

  const [objectNameDetails] = slackLogDetails(logged);
  assert.ok(objectNameDetails, 'expected a [slack-control-plane] log line for object-name Error throws');
  assertSlackLogKeys(logged);
  assert.equal(objectNameDetails.name, 'Error', 'non-string Error names fall back to a fixed safe name');
  assert.deepEqual(objectNameDetails.frames, [], 'non-string stack shapes fail closed to no frames');
  assert.ok(logged.join('\n').includes('"name":"Error"'), 'safe fallback name reaches logs');
  assert.ok(!logged.join('\n').includes(objectNameSecret), 'non-string Error name values must not reach logs');

  logged.length = 0;
  const thrownValueSecret = 'non-error-thrown-secret-value';
  const nonErrorDb = {
    async query() {
      throw `plain thrown value with ${thrownValueSecret}`;
    },
  } satisfies Queryable;
  const nonErrorPost = createSlackControlPlanePostHandler({ config: CONFIG, db: nonErrorDb });
  const nonErrorResponse = await nonErrorPost({ request: signedSlackRequest(body) } as never);
  const nonErrorJson = await responseJson(nonErrorResponse);

  assert.equal(nonErrorResponse.status, 200);
  assert.equal(nonErrorJson.ok, false);

  const [nonErrorDetails] = slackLogDetails(logged);
  assert.ok(nonErrorDetails, 'expected a [slack-control-plane] log line for non-Error throws');
  assertSlackLogKeys(logged);
  assert.match(String(nonErrorDetails.errorRef), /^[0-9a-f]{8}$/, 'non-Error throw log keeps the correlation ref');
  assert.equal(nonErrorDetails.thrownType, 'string', 'non-Error throws log only the thrown value type');
  assert.equal(nonErrorDetails.value, undefined, 'non-Error thrown values must not be stringified into logs');
  assert.ok(!logged.join('\n').includes(thrownValueSecret), 'non-Error thrown value text must not reach logs');
});

test('single-user Slack scan trigger routes authorized repo input to GitHub discovery', async () => {
  const db = await createMigratedDb();
  const repo = {
    owner: 'DylanMcCavitt',
    name: 'portfolio-candidate-app',
    htmlUrl: 'https://github.com/DylanMcCavitt/portfolio-candidate-app',
    description: 'A small workflow app worth reviewing for the portfolio.',
    topics: [PORTFOLIO_CANDIDATE_TOPIC, 'astro'],
    isPrivate: false,
    readmeMarkdown: '# Candidate app\n\nShips a real workflow.',
  };
  const body = formBody({ user_id: DYLAN_SLACK_USER, command: '/dm-scan', text: JSON.stringify(repo) });

  const response = await callRoute(body, db);
  const json = await responseJson(response);
  assert.equal(response.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.code, 'scan_qualified');
  assert.match(String(json.text), /Queued review candidate candidate_/);

  const blocks = json.blocks;
  assert.ok(Array.isArray(blocks), 'scan_qualified response must carry Block Kit blocks');
  const actionsBlock = blocks.find(
    (block) => typeof block === 'object' && block !== null && 'elements' in block,
  );
  assert.ok(
    actionsBlock && typeof actionsBlock === 'object' && 'elements' in actionsBlock,
    'expected an actions block with elements',
  );
  const elements = actionsBlock.elements;
  assert.ok(Array.isArray(elements), 'actions block must carry button elements');
  const buttons = elements.map((element) =>
    element && typeof element === 'object' && 'action_id' in element && 'value' in element
      ? { actionId: element.action_id, value: element.value }
      : { actionId: undefined, value: undefined },
  );
  assert.deepEqual(
    buttons.map((button) => button.actionId),
    ['dm_candidate_draft', 'dm_candidate_snooze', 'dm_candidate_dismiss'],
  );
  for (const button of buttons) {
    assert.match(String(button.value), /^candidate_/, 'button value must reference the candidate id');
  }

  const scanRuns = await db.query<{ trigger: string; actor: string; lifecycle_state: string; result_counts: Record<string, unknown> }>(
    `SELECT trigger, actor, lifecycle_state, result_counts FROM scan_runs`,
  );
  assert.equal(scanRuns.rows[0]?.trigger, 'slack');
  assert.equal(scanRuns.rows[0]?.actor, `slack:${DYLAN_SLACK_USER}`);
  assert.equal(scanRuns.rows[0]?.lifecycle_state, 'completed');
  assert.equal(scanRuns.rows[0]?.result_counts.candidates, 1);

  const candidates = await db.query<{ lifecycle_state: string; source_ref: string }>(`SELECT lifecycle_state, source_ref FROM project_candidates`);
  assert.deepEqual(candidates.rows, [
    { lifecycle_state: 'qualified', source_ref: 'https://github.com/DylanMcCavitt/portfolio-candidate-app' },
  ]);
});

test('Slack scan shorthand uses live GitHub metadata when no topics are explicit', async () => {
  const db = await createMigratedDb();
  const calls: { owner: string; name: string }[] = [];
  const config: SlackControlPlaneConfig = {
    ...CONFIG,
    githubFetcher: async (owner, name) => {
      calls.push({ owner, name });
      return LIVE_REPO;
    },
  };

  const result = await handleSlackFormEncodedRequest(
    db,
    config,
    formBody({ user_id: DYLAN_SLACK_USER, command: '/dm-scan', text: 'DylanMcCavitt/portfolio-candidate-app' }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.code, 'scan_qualified');
  assert.deepEqual(calls, [{ owner: 'DylanMcCavitt', name: 'portfolio-candidate-app' }]);
  assert.equal(result.scan?.status, 'qualified');
  assert.equal(result.scan?.audit.scannerMode, 'live-github');

  const evidence = await db.query<{ source_type: string; extracted_text: string | null; claim_map: { audit?: { scannerMode?: string } } }>(
    `SELECT source_type, extracted_text, claim_map FROM evidence_sources ORDER BY source_type`,
  );
  assert.equal(evidence.rows.length, 2);
  assert.equal(evidence.rows.find((row) => row.source_type === 'readme')?.extracted_text, LIVE_REPO.readmeMarkdown);
  assert.equal(evidence.rows[0]?.claim_map.audit?.scannerMode, 'live-github');

  const scanRuns = await db.query<{ result_counts: { audit?: { scannerMode?: string } } }>(
    `SELECT result_counts FROM scan_runs WHERE id = $1`,
    [result.scan?.scanRunId],
  );
  assert.equal(scanRuns.rows[0]?.result_counts.audit?.scannerMode, 'live-github');
});

test('Slack scan shorthand live metadata without the allowlist topic is rejected without candidates', async () => {
  const db = await createMigratedDb();
  const config: SlackControlPlaneConfig = {
    ...CONFIG,
    githubFetcher: async () => ({
      ...LIVE_REPO,
      topics: ['astro'],
    }),
  };

  const result = await handleSlackFormEncodedRequest(
    db,
    config,
    formBody({ user_id: DYLAN_SLACK_USER, command: '/dm-scan', text: 'DylanMcCavitt/portfolio-candidate-app' }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.code, 'scan_rejected');
  assert.equal(result.scan?.status, 'rejected');
  assert.equal(result.scan?.audit.scannerMode, 'live-github');
  assert.match(result.message, /missing required GitHub topic/);

  const candidates = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM project_candidates`);
  assert.equal(candidates.rows[0]?.count, '0');
});

test('Slack scan shorthand fetcher failures return safe ephemeral errors before scanning', async () => {
  const db = await createMigratedDb();
  const config: SlackControlPlaneConfig = {
    ...CONFIG,
    githubFetcher: async () => {
      throw new Error('GitHub token secret and raw network internals');
    },
  };

  const result = await handleSlackFormEncodedRequest(
    db,
    config,
    formBody({ user_id: DYLAN_SLACK_USER, command: '/dm-scan', text: 'DylanMcCavitt/portfolio-candidate-app' }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.code, 'github_fetch_failed');
  assert.equal(result.responseType, 'ephemeral');
  assert.ok(!result.message.includes('secret'), 'fetcher internals must not leak to Slack');

  const candidates = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM project_candidates`);
  assert.equal(candidates.rows[0]?.count, '0');
  const scanRuns = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM scan_runs`);
  assert.equal(scanRuns.rows[0]?.count, '0');
});

test('Slack scan explicit topic option preserves manual snapshot behavior and does not fetch', async () => {
  const db = await createMigratedDb();
  let fetchCalls = 0;
  const config: SlackControlPlaneConfig = {
    ...CONFIG,
    githubFetcher: async () => {
      fetchCalls += 1;
      return LIVE_REPO;
    },
  };

  const result = await handleSlackFormEncodedRequest(
    db,
    config,
    formBody({
      user_id: DYLAN_SLACK_USER,
      command: '/dm-scan',
      text: `DylanMcCavitt/portfolio-candidate-app topic=${PORTFOLIO_CANDIDATE_TOPIC}`,
    }),
  );

  assert.equal(fetchCalls, 0);
  assert.equal(result.ok, true);
  assert.equal(result.code, 'scan_qualified');
  assert.equal(result.scan?.audit.scannerMode, 'manual-snapshot');

  const evidence = await db.query<{ source_type: string }>(`SELECT source_type FROM evidence_sources ORDER BY source_type`);
  assert.deepEqual(
    evidence.rows.map((row) => row.source_type),
    ['repo'],
  );
});

test('single-user Slack scan trigger rejects non-maintainer users without scanning', async () => {
  const db = await createMigratedDb();
  const body = formBody({
    user_id: 'U_INTRUDER',
    command: '/dm-scan',
    text: `DylanMcCavitt/portfolio-candidate-app topic=${PORTFOLIO_CANDIDATE_TOPIC}`,
  });

  const result = await handleSlackFormEncodedRequest(db, CONFIG, body);
  assert.equal(result.status, 403);
  assert.equal(result.code, 'slack_user_forbidden');

  const scanRuns = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM scan_runs`);
  assert.equal(scanRuns.rows[0]?.count, '0');
});

test('Slack draft action creates a hidden draft only and never publishes a project', async () => {
  const db = await createMigratedDb();
  const candidateId = await insertCandidate(db);

  const response = await callRoute(interactionBody('dm_candidate_draft', candidateId), db);
  const json = await responseJson(response);
  assert.equal(response.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.code, 'hidden_draft_requested');
  assert.match(String(json.text), /hidden draft draft_/);
  assert.match(String(json.text), /Admin publish remains required/);

  const candidates = await db.query<{ lifecycle_state: string }>(`SELECT lifecycle_state FROM project_candidates WHERE id = $1`, [
    candidateId,
  ]);
  assert.equal(candidates.rows[0]?.lifecycle_state, 'draft_requested');

  const drafts = await db.query<{
    id: string;
    candidate_id: string;
    lifecycle_state: string;
    proposed_project_id: string | null;
    proposed_fields: Record<string, unknown>;
    provenance_map: Record<string, unknown>;
  }>(`SELECT id, candidate_id, lifecycle_state, proposed_project_id, proposed_fields, provenance_map FROM project_drafts`);
  assert.equal(drafts.rows.length, 1);
  assert.equal(drafts.rows[0]?.candidate_id, candidateId);
  assert.equal(drafts.rows[0]?.lifecycle_state, 'hidden');
  assert.equal(drafts.rows[0]?.proposed_project_id, null);
  assert.equal(drafts.rows[0]?.proposed_fields.visibility, 'hidden');
  assert.equal(drafts.rows[0]?.provenance_map.publicPublish, false);

  const publishedProjects = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM projects WHERE lifecycle_state = 'published'`,
  );
  assert.equal(publishedProjects.rows[0]?.count, '0');

  const events = await db.query<{ action: string; after_state: string; metadata: Record<string, unknown> }>(
    `SELECT action, after_state, metadata FROM review_events WHERE candidate_id = $1`,
    [candidateId],
  );
  assert.equal(events.rows[0]?.action, 'draft_requested');
  assert.equal(events.rows[0]?.after_state, 'draft_requested');
  assert.equal(events.rows[0]?.metadata.decision, 'draft');
});

test('Slack draft interaction posts ephemeral response_url ack without changing HTTP result', async () => {
  const db = await createMigratedDb();
  const candidateId = await insertCandidate(db);
  const responseUrl = 'https://hooks.slack.com/actions/T123/B456/secret';
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const config: SlackControlPlaneConfig = {
    ...CONFIG,
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response('', { status: 200 });
    },
  };

  const response = await callRoute(
    interactionBody('dm_candidate_draft', candidateId, DYLAN_SLACK_USER, responseUrl),
    db,
    config,
  );
  const json = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.code, 'hidden_draft_requested');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, responseUrl);
  assert.equal(calls[0]?.init?.method, 'POST');
  assert.equal(fetchHeaders(calls[0]?.init)['content-type'], 'application/json; charset=utf-8');
  assert.deepEqual(fetchBodyJson(calls[0]?.init), {
    response_type: 'ephemeral',
    replace_original: false,
    text: json.text,
  });
});

test('Slack interaction ack fetch failures do not change the success result', async (t) => {
  const logged: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    logged.push(format(...args));
  };
  t.after(() => {
    console.warn = originalWarn;
  });

  const db = await createMigratedDb();
  const candidateId = await insertCandidate(db);
  const config: SlackControlPlaneConfig = {
    ...CONFIG,
    fetchImpl: async () => {
      throw new Error('network failure with slack response secret');
    },
  };

  const result = await handleSlackFormEncodedRequest(
    db,
    config,
    interactionBody('dm_candidate_snooze', candidateId, DYLAN_SLACK_USER, 'https://hooks.slack.com/actions/T123/B456/secret'),
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.code, 'candidate_snoozed');
  assert.equal(result.message, `Snoozed candidate ${candidateId}.`);
  assert.equal(logged.length, 1);
  assert.ok(!logged.join('\n').includes('slack response secret'), 'ack warning must not log free error text');
});

test('Slack interaction skips response_url ack for non-Slack hosts', async () => {
  const db = await createMigratedDb();
  const candidateId = await insertCandidate(db);
  let fetchCalls = 0;
  const config: SlackControlPlaneConfig = {
    ...CONFIG,
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response('', { status: 200 });
    },
  };

  const result = await handleSlackFormEncodedRequest(
    db,
    config,
    interactionBody('dm_candidate_snooze', candidateId, DYLAN_SLACK_USER, 'https://example.com/slack-response'),
  );

  assert.equal(result.ok, true);
  assert.equal(result.code, 'candidate_snoozed');
  assert.equal(fetchCalls, 0);
});

test('Slack interaction posts response_url ack for safe error results', async () => {
  const db = await createMigratedDb();
  const responseUrl = 'https://hooks.slack.com/actions/T123/B456/missing';
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const config: SlackControlPlaneConfig = {
    ...CONFIG,
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response('', { status: 200 });
    },
  };

  const result = await handleSlackFormEncodedRequest(
    db,
    config,
    interactionBody('dm_candidate_draft', 'candidate_missing', DYLAN_SLACK_USER, responseUrl),
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.code, 'candidate_not_found');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, responseUrl);
  assert.deepEqual(fetchBodyJson(calls[0]?.init), {
    response_type: 'ephemeral',
    replace_original: false,
    text: result.message,
  });
});

test('Slack candidate actions dismiss and snooze candidates using compact ids', async () => {
  const db = await createMigratedDb();
  const dismissCandidateId = await insertCandidate(db, 'candidate_dismiss');
  const snoozeCandidateId = await insertCandidate(db, 'candidate_snooze');

  const dismiss = await callRoute(interactionBody('dm_candidate_dismiss', dismissCandidateId), db);
  assert.equal(dismiss.status, 200);
  const snooze = await callRoute(interactionBody('dm_candidate_snooze', snoozeCandidateId), db);
  assert.equal(snooze.status, 200);

  const candidates = await db.query<{ id: string; lifecycle_state: string }>(
    `SELECT id, lifecycle_state FROM project_candidates ORDER BY id`,
  );
  assert.deepEqual(candidates.rows, [
    { id: dismissCandidateId, lifecycle_state: 'dismissed' },
    { id: snoozeCandidateId, lifecycle_state: 'qualified' },
  ]);

  const events = await db.query<{ candidate_id: string; action: string; before_state: string; after_state: string; metadata: Record<string, unknown> }>(
    `SELECT candidate_id, action, before_state, after_state, metadata FROM review_events ORDER BY candidate_id`,
  );
  assert.deepEqual(
    events.rows.map((event) => ({
      candidate_id: event.candidate_id,
      action: event.action,
      before_state: event.before_state,
      after_state: event.after_state,
      decision: event.metadata.decision,
    })),
    [
      {
        candidate_id: dismissCandidateId,
        action: 'candidate_dismissed',
        before_state: 'qualified',
        after_state: 'dismissed',
        decision: 'dismiss',
      },
      {
        candidate_id: snoozeCandidateId,
        action: 'note',
        before_state: 'qualified',
        after_state: 'qualified',
        decision: 'snooze',
      },
    ],
  );
});

test('Slack action errors return safe messages without public visibility changes', async () => {
  const db = await createMigratedDb();

  const malformed = await callRoute(formBody({ payload: '{' }), db);
  assert.equal(malformed.status, 200);
  assert.deepEqual(await responseJson(malformed), {
    ok: false,
    code: 'invalid_json',
    response_type: 'ephemeral',
    text: 'Slack interaction payload must be JSON.',
  });

  const missingCandidate = await callRoute(interactionBody('dm_candidate_draft', 'candidate_missing'), db);
  assert.equal(missingCandidate.status, 200);
  assert.deepEqual(await responseJson(missingCandidate), {
    ok: false,
    code: 'candidate_not_found',
    response_type: 'ephemeral',
    text: 'Candidate candidate_missing was not found or is no longer available.',
  });

  const failing = await handleSlackFormEncodedRequest(
    {
      async query() {
        throw new Error('database unavailable with secret-token details');
      },
    },
    CONFIG,
    interactionBody('dm_candidate_draft', 'candidate_failure'),
  );
  assert.equal(failing.status, 500);
  assert.equal(failing.code, 'slack_control_plane_error');
  assert.match(
    failing.message,
    /^Slack control-plane action failed before changing public project visibility\. Error ref [0-9a-f]{8}\.$/,
  );
  assert.ok(!failing.message.includes('secret-token'), 'raw error details must not leak to Slack');

  const projects = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM projects`);
  assert.equal(projects.rows[0]?.count, '0');
});
