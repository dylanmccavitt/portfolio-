import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations, type Queryable } from '../scripts/db';
import { PORTFOLIO_CANDIDATE_TOPIC } from '../src/lib/db/github-discovery';
import {
  handleSlackFormEncodedRequest,
  signSlackBody,
  verifySlackRequest,
  type SlackControlPlaneConfig,
} from '../src/lib/slack/control-plane';
import { createSlackControlPlanePostHandler } from '../src/pages/api/slack/control-plane';

const SIGNING_SECRET = 'test-signing-secret';
const DYLAN_SLACK_USER = 'U_DYLAN';
const NOW = new Date('2026-06-30T12:00:00.000Z');
const NOW_SECONDS = String(Math.floor(NOW.getTime() / 1000));

const CONFIG: SlackControlPlaneConfig = {
  signingSecret: SIGNING_SECRET,
  allowedUserId: DYLAN_SLACK_USER,
  now: () => NOW,
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

function interactionBody(actionId: string, candidateId: string, userId = DYLAN_SLACK_USER): string {
  return formBody({
    payload: JSON.stringify({
      type: 'block_actions',
      response_url: 'https://hooks.slack.test/response',
      user: { id: userId },
      actions: [{ action_id: actionId, value: candidateId }],
    }),
  });
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

test('server-side error logs redact data values, not just the Slack response', async (t) => {
  const logged: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  };
  t.after(() => {
    console.error = originalError;
  });

  const pgError = Object.assign(
    new Error('duplicate key: Key (email)=(person@example.com) already exists at postgres://user:secret-token@db.example/neon'),
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

  const logLine = logged.find((line) => line.includes('[slack-control-plane]'));
  assert.ok(logLine, 'expected a [slack-control-plane] error log line');
  assert.match(logLine, /"errorRef":"[0-9a-f]{8}"/, 'log keeps the correlation ref');
  assert.ok(logLine.includes('"pg_code":"23505"'), 'log keeps schema-level pg code');
  assert.ok(logLine.includes('"pg_table":"project_candidates"'), 'log keeps schema-level pg table');
  assert.ok(!logLine.includes('person@example.com'), 'pg detail data values must not reach logs');
  assert.ok(!logLine.includes('secret-token'), 'URL credentials must not reach logs');
  assert.ok(!logLine.includes('pg_detail'), 'pg detail field must not be logged at all');
  assert.ok(!logLine.includes('pg_routine'), 'pg routine field must not be logged');
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
