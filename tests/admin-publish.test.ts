import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations, type Queryable } from '../scripts/db';
import { createAdminSessionCookie, type AdminAuthConfig, type AdminSessionResult } from '@/lib/admin/auth';
import { createAdminDraftsGetHandler } from '@/pages/api/admin/drafts';
import { createAdminDraftDetailGetHandler, createAdminDraftDetailPatchHandler } from '@/pages/api/admin/drafts/[id]';
import { createAdminDraftApprovePostHandler } from '@/pages/api/admin/drafts/[id]/approve';
import { createAdminDraftPublishPostHandler } from '@/pages/api/admin/drafts/[id]/publish';

const NOW = new Date('2026-07-02T12:00:00.000Z');
const ACTOR = 'github:dylan';
const ADMIN_CONFIG: AdminAuthConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  allowedLogin: 'Dylan',
  sessionSecret: 'test-session-secret',
  now: () => NOW,
};

const AUTHORIZED_SESSION = (): AdminSessionResult => ({ ok: true, actor: ACTOR });
const UNAUTHENTICATED_SESSION = (): AdminSessionResult => ({
  ok: false,
  status: 401,
  code: 'admin_unauthenticated',
  message: 'Admin authentication is required.',
});

const VALID_FIELDS = {
  slug: 'valid-project',
  title: 'Valid Project',
  tagline: 'A tested publish pipeline',
  area: 'Automation',
  year: 2026,
  summary: 'Public summary for the project.',
  activity: 'Active',
  details: [{ label: 'Detail', value: 'One' }],
  metrics: [{ label: 'Metric', value: 'Two' }],
  links: [{ label: 'Repo', href: 'https://example.test/repo' }],
  media: [{ type: 'image', src: '/example.png' }],
};

type JsonBody = Record<string, unknown>;

function createTestDb(): Queryable {
  return new PGlite() as Queryable;
}

async function createMigratedDb(): Promise<Queryable> {
  const db = createTestDb();
  await applyMigrations(db);
  return db;
}

function jsonRequest(url: string, body: JsonBody = {}, method = 'POST', cookie?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  return new Request(url, { method, headers, body: JSON.stringify(body) });
}

function getRequest(url: string, cookie?: string): Request {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return new Request(url, { method: 'GET', headers });
}

async function responseJson(response: Response): Promise<JsonBody> {
  return (await response.json()) as JsonBody;
}

async function insertCandidate(db: Queryable, id = 'candidate_publish'): Promise<string> {
  await db.query(
    `INSERT INTO scan_runs (id, trigger, actor, lifecycle_state, started_at, finished_at)
     VALUES ($1, 'test', 'test', 'completed', $2, $2)`,
    [`scan_${id}`, NOW.toISOString()],
  );
  await db.query(
    `INSERT INTO project_candidates (id, scan_run_id, source_kind, source_ref, repo_visibility, signals, confidence, evidence_packet, lifecycle_state)
     VALUES ($1, $2, 'github_repo', $3, 'public', '{}'::jsonb, 0.9000, '{}'::jsonb, 'draft_requested')`,
    [id, `scan_${id}`, `https://github.com/example/${id}`],
  );
  return id;
}

async function insertDraft(
  db: Queryable,
  input: {
    id: string;
    candidateId?: string | null;
    projectId?: string | null;
    fields?: JsonBody;
    privateNotes?: string;
    provenance?: JsonBody;
    lifecycle?: string;
  },
): Promise<string> {
  await db.query(
    `INSERT INTO project_drafts (id, candidate_id, proposed_project_id, proposed_fields, private_notes, provenance_map, lifecycle_state)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7)`,
    [
      input.id,
      input.candidateId ?? null,
      input.projectId ?? null,
      JSON.stringify(input.fields ?? {}),
      input.privateNotes ?? '',
      JSON.stringify(input.provenance ?? {}),
      input.lifecycle ?? 'hidden',
    ],
  );
  return input.id;
}

async function insertReviewEvent(
  db: Queryable,
  input: { draftId: string; candidateId?: string | null; action: string; actor?: string; metadata?: JsonBody },
): Promise<void> {
  await db.query(
    `INSERT INTO review_events (id, draft_id, candidate_id, actor, action, before_state, after_state, notes, metadata)
     VALUES ($1, $2, $3, $4, $5, 'hidden', $5, '', $6::jsonb)`,
    [`review_${input.draftId}_${input.action}_${crypto.randomUUID()}`, input.draftId, input.candidateId ?? null, input.actor ?? ACTOR, input.action, JSON.stringify(input.metadata ?? {})],
  );
}

async function insertEvidence(db: Queryable, input: { id: string; draftId?: string | null; candidateId?: string | null; privacy: string }): Promise<void> {
  await db.query(
    `INSERT INTO evidence_sources (id, candidate_id, draft_id, source_type, source_ref, repo_visibility, privacy_state, claim_map)
     VALUES ($1, $2, $3, 'repo', $4, 'public', $5, '{}'::jsonb)`,
    [input.id, input.candidateId ?? null, input.draftId ?? null, `evidence:${input.id}`, input.privacy],
  );
}

async function patchDraft(db: Queryable, draftId: string, body: JsonBody): Promise<Response> {
  const PATCH = createAdminDraftDetailPatchHandler({ db, session: AUTHORIZED_SESSION });
  return PATCH({ request: jsonRequest(`https://example.test/api/admin/drafts/${draftId}`, body, 'PATCH'), params: { id: draftId } } as never);
}

async function approveDraft(db: Queryable, draftId: string): Promise<Response> {
  const POST = createAdminDraftApprovePostHandler({ db, session: AUTHORIZED_SESSION });
  return POST({ request: jsonRequest(`https://example.test/api/admin/drafts/${draftId}/approve`), params: { id: draftId } } as never);
}

async function publishDraft(db: Queryable, draftId: string, body: JsonBody): Promise<Response> {
  const POST = createAdminDraftPublishPostHandler({ db, session: AUTHORIZED_SESSION });
  return POST({ request: jsonRequest(`https://example.test/api/admin/drafts/${draftId}/publish`, body), params: { id: draftId } } as never);
}

async function assertProposedFields(db: Queryable, draftId: string, expected: JsonBody): Promise<void> {
  const rows = await db.query<{ proposed_fields: JsonBody }>(`SELECT proposed_fields FROM project_drafts WHERE id = $1`, [draftId]);
  assert.deepEqual(rows.rows[0].proposed_fields, expected);
}

test('admin publish routes reject unauthenticated requests before database work', async () => {
  const db = {
    async query() {
      throw new Error('database should not be reached for unauthenticated requests');
    },
  } satisfies Queryable;

  const calls = [
    createAdminDraftsGetHandler({ db, session: UNAUTHENTICATED_SESSION })({ request: getRequest('https://example.test/api/admin/drafts') } as never),
    createAdminDraftDetailGetHandler({ db, session: UNAUTHENTICATED_SESSION })({ request: getRequest('https://example.test/api/admin/drafts/draft_a'), params: { id: 'draft_a' } } as never),
    createAdminDraftDetailPatchHandler({ db, session: UNAUTHENTICATED_SESSION })({ request: jsonRequest('https://example.test/api/admin/drafts/draft_a', VALID_FIELDS, 'PATCH'), params: { id: 'draft_a' } } as never),
    createAdminDraftApprovePostHandler({ db, session: UNAUTHENTICATED_SESSION })({ request: jsonRequest('https://example.test/api/admin/drafts/draft_a/approve'), params: { id: 'draft_a' } } as never),
    createAdminDraftPublishPostHandler({ db, session: UNAUTHENTICATED_SESSION })({ request: jsonRequest('https://example.test/api/admin/drafts/draft_a/publish', { confirmProvenance: true, confirmPrivacy: true }), params: { id: 'draft_a' } } as never),
  ];

  for (const response of await Promise.all(calls)) {
    assert.equal(response.status, 401);
    const json = await responseJson(response);
    assert.equal(json.ok, false);
    assert.equal(json.code, 'admin_unauthenticated');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});

test('real admin session cookie authorizes the default route session path', async () => {
  const db = await createMigratedDb();
  const cookie = createAdminSessionCookie('dylan', ADMIN_CONFIG).split(';')[0];
  const GET = createAdminDraftsGetHandler({ db, authConfig: ADMIN_CONFIG });

  const response = await GET({ request: getRequest('https://example.test/api/admin/drafts', cookie) } as never);
  const json = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.code, 'drafts_listed');
});

test('Slack-shaped hidden drafts cannot publish without admin approval', async () => {
  const db = await createMigratedDb();
  const candidateId = await insertCandidate(db, 'candidate_hidden');
  await insertDraft(db, { id: 'draft_hidden', candidateId, fields: VALID_FIELDS, provenance: { repo: true }, lifecycle: 'hidden' });
  await insertReviewEvent(db, { draftId: 'draft_hidden', candidateId, action: 'draft_requested', actor: 'slack:U_DYLAN', metadata: { source: 'slack_control_plane' } });

  const response = await publishDraft(db, 'draft_hidden', { confirmProvenance: true, confirmPrivacy: true });
  const json = await responseJson(response);

  assert.equal(response.status, 409);
  assert.equal(json.code, 'draft_not_approved');
});

test('state-flipped drafts without admin publish approval event cannot publish', async () => {
  const db = await createMigratedDb();
  const candidateId = await insertCandidate(db, 'candidate_flipped');
  await insertDraft(db, { id: 'draft_flipped', candidateId, fields: VALID_FIELDS, provenance: { repo: true }, lifecycle: 'approved_for_publish' });
  await insertEvidence(db, { id: 'evidence_flipped', draftId: 'draft_flipped', privacy: 'safe_public' });

  const response = await publishDraft(db, 'draft_flipped', { confirmProvenance: true, confirmPrivacy: true });
  const json = await responseJson(response);

  assert.equal(response.status, 409);
  assert.equal(json.code, 'admin_approval_missing');
});

test('field updates after approval invalidate stale admin approval events', async () => {
  const db = await createMigratedDb();
  const candidateId = await insertCandidate(db, 'candidate_freshness');
  await insertDraft(db, { id: 'draft_freshness', candidateId, fields: VALID_FIELDS, provenance: { repo: true }, lifecycle: 'needs_review' });
  await insertEvidence(db, { id: 'evidence_freshness', draftId: 'draft_freshness', privacy: 'safe_public' });

  const firstApproval = await approveDraft(db, 'draft_freshness');
  assert.equal(firstApproval.status, 200);

  const patchResponse = await patchDraft(db, 'draft_freshness', { summary: 'Updated summary after approval.' });
  assert.equal(patchResponse.status, 200);
  await db.query(`UPDATE project_drafts SET lifecycle_state = 'approved_for_publish' WHERE id = $1`, ['draft_freshness']);

  const stalePublish = await publishDraft(db, 'draft_freshness', { confirmProvenance: true, confirmPrivacy: true });
  const staleJson = await responseJson(stalePublish);
  assert.equal(stalePublish.status, 409);
  assert.equal(staleJson.code, 'admin_approval_missing');

  const secondApproval = await approveDraft(db, 'draft_freshness');
  assert.equal(secondApproval.status, 200);

  const freshPublish = await publishDraft(db, 'draft_freshness', { confirmProvenance: true, confirmPrivacy: true });
  const freshJson = await responseJson(freshPublish);
  assert.equal(freshPublish.status, 200);
  assert.equal(freshJson.code, 'published');
});

test('approval freshness survives created_at ties using insertion order', async () => {
  const TIE = '2026-01-03T00:00:00Z';
  const insertTieEvent = async (db: Queryable, draftId: string, kind: 'note' | 'approval'): Promise<void> => {
    await db.query(
      `INSERT INTO review_events (id, draft_id, actor, action, before_state, after_state, notes, metadata, created_at)
       VALUES ($1, $2, $3, $4, 'needs_review', $4, '', $5::jsonb, $6)`,
      [
        `review_tie_${draftId}_${kind}_${crypto.randomUUID()}`,
        draftId,
        ACTOR,
        kind === 'approval' ? 'approved_for_publish' : 'note',
        JSON.stringify(kind === 'approval' ? { source: 'admin_publish' } : { kind: 'fields_updated' }),
        TIE,
      ],
    );
  };
  const setupDraft = async (db: Queryable, suffix: string): Promise<string> => {
    const candidateId = await insertCandidate(db, `candidate_tie_${suffix}`);
    const draftId = await insertDraft(db, {
      id: `draft_tie_${suffix}`,
      candidateId,
      fields: VALID_FIELDS,
      provenance: { repo: true },
      lifecycle: 'approved_for_publish',
    });
    await insertEvidence(db, { id: `evidence_tie_${suffix}`, draftId, privacy: 'safe_public' });
    return draftId;
  };

  // Approval inserted after the note at the SAME created_at: program order wins → publish succeeds.
  const dbFresh = await createMigratedDb();
  const freshDraft = await setupDraft(dbFresh, 'fresh');
  await insertTieEvent(dbFresh, freshDraft, 'note');
  await insertTieEvent(dbFresh, freshDraft, 'approval');
  const freshPublish = await publishDraft(dbFresh, freshDraft, { confirmProvenance: true, confirmPrivacy: true });
  assert.equal(freshPublish.status, 200);

  // Note inserted after the approval at the SAME created_at: the stale-approval invariant holds → 409.
  const dbStale = await createMigratedDb();
  const staleDraft = await setupDraft(dbStale, 'stale');
  await insertTieEvent(dbStale, staleDraft, 'approval');
  await insertTieEvent(dbStale, staleDraft, 'note');
  const stalePublish = await publishDraft(dbStale, staleDraft, { confirmProvenance: true, confirmPrivacy: true });
  const staleJson = await responseJson(stalePublish);
  assert.equal(stalePublish.status, 409);
  assert.equal(staleJson.code, 'admin_approval_missing');
});

test('approve requires valid public fields and records admin approval after PATCH', async () => {
  const db = await createMigratedDb();
  const candidateId = await insertCandidate(db, 'candidate_approve');
  await insertDraft(db, { id: 'draft_approve', candidateId, fields: { slug: 'valid-project' }, provenance: { repo: true }, lifecycle: 'hidden' });

  const missingResponse = await approveDraft(db, 'draft_approve');
  const missingJson = await responseJson(missingResponse);
  assert.equal(missingResponse.status, 422);
  assert.equal(missingJson.code, 'fields_incomplete');
  assert.deepEqual(missingJson.fields, ['title', 'tagline', 'area', 'year', 'summary']);

  const patchResponse = await patchDraft(db, 'draft_approve', VALID_FIELDS);
  assert.equal(patchResponse.status, 200);

  const approveResponse = await approveDraft(db, 'draft_approve');
  const approveJson = await responseJson(approveResponse);
  assert.equal(approveResponse.status, 200);
  assert.equal(approveJson.code, 'approved_for_publish');

  const events = await db.query<{ count: string }>(
    `SELECT count(*) AS count FROM review_events WHERE draft_id = $1 AND action = 'approved_for_publish' AND metadata->>'source' = 'admin_publish'`,
    ['draft_approve'],
  );
  assert.equal(Number(events.rows[0].count), 1);
});

test('publish enforces confirmation provenance and evidence privacy gates', async () => {
  const db = await createMigratedDb();
  const candidateId = await insertCandidate(db, 'candidate_gates');

  await insertDraft(db, { id: 'draft_no_confirm', candidateId, fields: VALID_FIELDS, provenance: { repo: true }, lifecycle: 'approved_for_publish' });
  await insertReviewEvent(db, { draftId: 'draft_no_confirm', candidateId, action: 'approved_for_publish', metadata: { source: 'admin_publish' } });
  await insertEvidence(db, { id: 'evidence_no_confirm', draftId: 'draft_no_confirm', privacy: 'safe_public' });

  const noConfirm = await publishDraft(db, 'draft_no_confirm', {});
  assert.equal(noConfirm.status, 428);
  assert.equal((await responseJson(noConfirm)).code, 'confirmation_required');

  await insertDraft(db, { id: 'draft_no_provenance', candidateId, fields: { ...VALID_FIELDS, slug: 'no-provenance' }, provenance: {}, lifecycle: 'approved_for_publish' });
  await insertReviewEvent(db, { draftId: 'draft_no_provenance', candidateId, action: 'approved_for_publish', metadata: { source: 'admin_publish' } });
  await insertEvidence(db, { id: 'evidence_no_provenance', draftId: 'draft_no_provenance', privacy: 'safe_public' });

  const noProvenance = await publishDraft(db, 'draft_no_provenance', { confirmProvenance: true, confirmPrivacy: true });
  assert.equal(noProvenance.status, 422);
  assert.equal((await responseJson(noProvenance)).code, 'provenance_missing');

  await insertDraft(db, { id: 'draft_unreviewed', candidateId, fields: { ...VALID_FIELDS, slug: 'unreviewed-evidence' }, provenance: { repo: true }, lifecycle: 'approved_for_publish' });
  await insertReviewEvent(db, { draftId: 'draft_unreviewed', candidateId, action: 'approved_for_publish', metadata: { source: 'admin_publish' } });
  await insertEvidence(db, { id: 'evidence_unreviewed', draftId: 'draft_unreviewed', privacy: 'unreviewed' });

  const unreviewed = await publishDraft(db, 'draft_unreviewed', { confirmProvenance: true, confirmPrivacy: true });
  const unreviewedJson = await responseJson(unreviewed);
  assert.equal(unreviewed.status, 422);
  assert.equal(unreviewedJson.code, 'privacy_unreviewed_evidence');
  assert.equal(unreviewedJson.count, 1);
  await insertDraft(db, { id: 'draft_blocked', candidateId, fields: { ...VALID_FIELDS, slug: 'blocked-evidence' }, provenance: { repo: true }, lifecycle: 'approved_for_publish' });
  await insertReviewEvent(db, { draftId: 'draft_blocked', candidateId, action: 'approved_for_publish', metadata: { source: 'admin_publish' } });
  await insertEvidence(db, { id: 'evidence_blocked', draftId: 'draft_blocked', privacy: 'blocked' });

  const blocked = await publishDraft(db, 'draft_blocked', { confirmProvenance: true, confirmPrivacy: true });
  const blockedJson = await responseJson(blocked);
  assert.equal(blocked.status, 422);
  assert.equal(blockedJson.code, 'privacy_blocked_evidence');
  assert.equal(blockedJson.count, 1);

  await insertDraft(db, { id: 'draft_private_allowed', candidateId, fields: { ...VALID_FIELDS, slug: 'private-allowed-evidence' }, provenance: { repo: true }, lifecycle: 'approved_for_publish' });
  await insertReviewEvent(db, { draftId: 'draft_private_allowed', candidateId, action: 'approved_for_publish', metadata: { source: 'admin_publish' } });
  await insertEvidence(db, { id: 'evidence_private_allowed', draftId: 'draft_private_allowed', privacy: 'private_allowed_for_draft' });

  const privateAllowed = await publishDraft(db, 'draft_private_allowed', { confirmProvenance: true, confirmPrivacy: true });
  const privateAllowedJson = await responseJson(privateAllowed);
  assert.equal(privateAllowed.status, 200);
  assert.equal(privateAllowedJson.code, 'published');
});

test('happy path publishes public project fields only and republish updates the same project', async () => {
  const db = await createMigratedDb();
  const candidateId = await insertCandidate(db, 'candidate_happy');
  await insertDraft(db, {
    id: 'draft_happy',
    candidateId,
    fields: {},
    privateNotes: 'PRIVATE-NOTES-MUST-NOT-PUBLISH',
    provenance: { repo: 'candidate_happy' },
    lifecycle: 'hidden',
  });
  await insertEvidence(db, { id: 'evidence_happy', draftId: 'draft_happy', privacy: 'safe_public' });

  const patchResponse = await patchDraft(db, 'draft_happy', VALID_FIELDS);
  assert.equal(patchResponse.status, 200);
  const approveResponse = await approveDraft(db, 'draft_happy');
  assert.equal(approveResponse.status, 200);

  const publishResponse = await publishDraft(db, 'draft_happy', { confirmProvenance: true, confirmPrivacy: true });
  const publishJson = await responseJson(publishResponse);
  assert.equal(publishResponse.status, 200);
  assert.equal(publishJson.code, 'published');
  assert.equal(publishJson.projectId, 'proj_happy');
  const projectId = String(publishJson.projectId);

  const projectRows = await db.query<JsonBody>(`SELECT * FROM projects WHERE id = $1`, [projectId]);
  assert.equal(projectRows.rows.length, 1);
  const project = projectRows.rows[0];
  assert.equal(project.slug, VALID_FIELDS.slug);
  assert.equal(project.title, VALID_FIELDS.title);
  assert.equal(project.tagline, VALID_FIELDS.tagline);
  assert.equal(project.area, VALID_FIELDS.area);
  assert.equal(project.year, VALID_FIELDS.year);
  assert.equal(project.summary, VALID_FIELDS.summary);
  assert.equal(project.activity, VALID_FIELDS.activity);
  assert.deepEqual(project.details, VALID_FIELDS.details);
  assert.deepEqual(project.metrics, VALID_FIELDS.metrics);
  assert.deepEqual(project.links, VALID_FIELDS.links);
  assert.deepEqual(project.media, VALID_FIELDS.media);
  assert.equal(project.lifecycle_state, 'published');
  assert.ok(project.published_at);
  assert.equal(JSON.stringify(project).includes('PRIVATE-NOTES-MUST-NOT-PUBLISH'), false);
  const firstPublishedRows = await db.query<{ published_at: string }>(`SELECT published_at::text AS published_at FROM projects WHERE id = $1`, [projectId]);
  const firstPublishedAt = firstPublishedRows.rows[0].published_at;

  const draftRows = await db.query<{ proposed_project_id: string }>(`SELECT proposed_project_id FROM project_drafts WHERE id = $1`, ['draft_happy']);
  assert.equal(draftRows.rows[0].proposed_project_id, projectId);

  const eventRows = await db.query<{ actor: string; project_id: string }>(
    `SELECT actor, project_id FROM review_events WHERE draft_id = $1 AND action = 'published' ORDER BY created_at DESC LIMIT 1`,
    ['draft_happy'],
  );
  assert.equal(eventRows.rows[0].actor, ACTOR);
  assert.equal(eventRows.rows[0].project_id, projectId);

  const updateResponse = await patchDraft(db, 'draft_happy', { title: 'Updated Project Title' });
  assert.equal(updateResponse.status, 200);
  const reapproveResponse = await approveDraft(db, 'draft_happy');
  assert.equal(reapproveResponse.status, 200);
  const republishResponse = await publishDraft(db, 'draft_happy', { confirmProvenance: true, confirmPrivacy: true });
  assert.equal(republishResponse.status, 200);

  const countRows = await db.query<{ count: string; published_at: string; title: string }>(
    `SELECT count(*) AS count, min(published_at)::text AS published_at, min(title) AS title FROM projects WHERE id = $1 GROUP BY id`,
    [projectId],
  );
  assert.equal(Number(countRows.rows[0].count), 1);
  assert.equal(String(countRows.rows[0].published_at), String(firstPublishedAt));
  assert.equal(countRows.rows[0].title, 'Updated Project Title');
});

test('PATCH rejects invalid fields without changing proposed fields after each rejection', async () => {
  const db = await createMigratedDb();
  const candidateId = await insertCandidate(db, 'candidate_invalid');
  await insertDraft(db, { id: 'draft_invalid', candidateId, fields: VALID_FIELDS, provenance: { repo: true }, lifecycle: 'needs_review' });

  const before = await db.query<{ proposed_fields: JsonBody }>(`SELECT proposed_fields FROM project_drafts WHERE id = $1`, ['draft_invalid']);
  const unchanged = before.rows[0].proposed_fields;

  const slugResponse = await patchDraft(db, 'draft_invalid', { slug: 'No Uppercase' });
  assert.equal(slugResponse.status, 422);
  assert.equal((await responseJson(slugResponse)).field, 'slug');
  await assertProposedFields(db, 'draft_invalid', unchanged);

  const yearResponse = await patchDraft(db, 'draft_invalid', { year: 1999 });
  assert.equal(yearResponse.status, 422);
  assert.equal((await responseJson(yearResponse)).field, 'year');
  await assertProposedFields(db, 'draft_invalid', unchanged);

  const titleResponse = await patchDraft(db, 'draft_invalid', { title: '' });
  assert.equal((await responseJson(titleResponse)).field, 'title');
  await assertProposedFields(db, 'draft_invalid', unchanged);

  const summaryResponse = await patchDraft(db, 'draft_invalid', { summary: '   ' });
  assert.equal((await responseJson(summaryResponse)).field, 'summary');
  await assertProposedFields(db, 'draft_invalid', unchanged);

  const detailsResponse = await patchDraft(db, 'draft_invalid', { details: {} });
  assert.equal((await responseJson(detailsResponse)).field, 'details');
  await assertProposedFields(db, 'draft_invalid', unchanged);

  const privateNotesResponse = await patchDraft(db, 'draft_invalid', { private_notes: 'leak' });
  const privateNotesJson = await responseJson(privateNotesResponse);
  assert.equal(privateNotesResponse.status, 400);
  assert.equal(privateNotesJson.code, 'invalid_field');
  assert.equal(privateNotesJson.field, 'private_notes');
  await assertProposedFields(db, 'draft_invalid', unchanged);
});

test('mutating route rejects form content type for CSRF defense', async () => {
  const db = await createMigratedDb();
  const PATCH = createAdminDraftDetailPatchHandler({ db, session: AUTHORIZED_SESSION });
  const response = await PATCH({
    request: new Request('https://example.test/api/admin/drafts/draft_csrf', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ slug: 'bad' }),
    }),
    params: { id: 'draft_csrf' },
  } as never);
  const json = await responseJson(response);

  assert.equal(response.status, 403);
  assert.equal(json.code, 'admin_csrf_content_type');
});
