import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations, type Queryable } from '../scripts/db';
import { createAdminSessionCookie, type AdminAuthConfig, type AdminSessionResult } from '@/lib/admin/auth';
import { createAdminDraftsGetHandler } from '@/pages/api/admin/drafts';
import { createAdminDraftDetailGetHandler, createAdminDraftDetailPatchHandler } from '@/pages/api/admin/drafts/[id]';
import { createAdminDraftApprovePostHandler } from '@/pages/api/admin/drafts/[id]/approve';
import { createAdminDraftPublishPostHandler } from '@/pages/api/admin/drafts/[id]/publish';
import {
  EDITABLE_PUBLIC_FIELDS,
  approveAdminDraftForPublish,
  publishAdminDraft,
  updateAdminDraftFields,
  type AdminPublishQueryable,
} from '@/lib/admin/publish';

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
  area: 'AI & Developer Tools',
  year: 2026,
  summary: 'Public summary for the project.',
  activity: 'Active',
  details: [{ label: 'Detail', value: 'One' }],
  metrics: [{ label: 'Metric', value: 'Two' }],
  links: [{ label: 'Repo', href: 'https://example.test/repo' }],
  media: [{ kind: 'image', src: '/screenshots/example.png', caption: 'Example screenshot' }],
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
    provider?: string | null;
    repositoryId?: string | null;
    sourceRevision?: string | null;
    contentFingerprint?: string | null;
    baseProjectVersion?: number;
  },
): Promise<string> {
  await db.query(
    `INSERT INTO project_drafts (
       id, candidate_id, proposed_project_id, proposed_fields, private_notes, provenance_map, lifecycle_state,
       provider, repository_id, source_revision, content_fingerprint, base_project_version
     ) VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7, $8, $9, $10, $11, $12)`,
    [
      input.id,
      input.candidateId ?? null,
      input.projectId ?? null,
      JSON.stringify(input.fields ?? {}),
      input.privateNotes ?? '',
      JSON.stringify(input.provenance ?? {}),
      input.lifecycle ?? 'hidden',
      input.provider ?? null,
      input.repositoryId ?? null,
      input.sourceRevision ?? null,
      input.contentFingerprint ?? null,
      input.baseProjectVersion ?? 0,
    ],
  );
  return input.id;
}

async function insertReviewEvent(
  db: Queryable,
  input: { draftId: string; candidateId?: string | null; action: string; actor?: string; metadata?: JsonBody },
): Promise<void> {
  let metadata = input.metadata ?? {};
  if (input.action === 'approved_for_publish') {
    const draft = await db.query<{ proposed_fields: JsonBody }>(
      `SELECT proposed_fields FROM project_drafts WHERE id = $1`,
      [input.draftId],
    );
    const fields: Record<string, unknown> = {
      activity: '', details: [], metrics: [], links: [], media: [],
      ...(draft.rows[0]?.proposed_fields ?? {}),
    };
    const reviewedFieldDiff = EDITABLE_PUBLIC_FIELDS.map((field) => ({ field, before: null, after: fields[field] }));
    await db.query(`UPDATE project_drafts SET reviewed_field_diff = $2::jsonb WHERE id = $1`, [input.draftId, JSON.stringify(reviewedFieldDiff)]);
    metadata = {
      ...metadata,
      reviewedFields: [...EDITABLE_PUBLIC_FIELDS],
      reviewedFieldDiff,
      baseProjectVersion: 0,
    };
  }
  await db.query(
    `INSERT INTO review_events (id, draft_id, candidate_id, actor, action, before_state, after_state, notes, metadata)
     VALUES ($1, $2, $3, $4, $5, 'hidden', $5, '', $6::jsonb)`,
    [`review_${input.draftId}_${input.action}_${crypto.randomUUID()}`, input.draftId, input.candidateId ?? null, input.actor ?? ACTOR, input.action, JSON.stringify(metadata)],
  );
}

async function insertEvidence(
  db: Queryable,
  input: {
    id: string;
    draftId?: string | null;
    candidateId?: string | null;
    projectId?: string | null;
    privacy: string;
    contentFingerprint?: string;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO evidence_sources (id, candidate_id, draft_id, project_id, source_type, source_ref, repo_visibility, privacy_state, claim_map)
     VALUES ($1, $2, $3, $4, 'repo', $5, 'public', $6, $7::jsonb)`,
    [
      input.id,
      input.candidateId ?? null,
      input.draftId ?? null,
      input.projectId ?? null,
      `evidence:${input.id}`,
      input.privacy,
      JSON.stringify(input.contentFingerprint ? { contentFingerprint: input.contentFingerprint } : {}),
    ],
  );
}

async function insertPublishedProject(
  db: Queryable,
  input: { id: string; slug: string; publicationVersion: number },
): Promise<void> {
  await db.query(
    `INSERT INTO projects (
       id, slug, title, tagline, area, year, summary, activity, details, metrics, links, media,
       lifecycle_state, published_at, source, publication_version
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb,
       'published', now(), 'github_discovery', $13)`,
    [
      input.id,
      input.slug,
      VALID_FIELDS.title,
      VALID_FIELDS.tagline,
      VALID_FIELDS.area,
      VALID_FIELDS.year,
      VALID_FIELDS.summary,
      VALID_FIELDS.activity,
      JSON.stringify(VALID_FIELDS.details),
      JSON.stringify(VALID_FIELDS.metrics),
      JSON.stringify(VALID_FIELDS.links),
      JSON.stringify(VALID_FIELDS.media),
      input.publicationVersion,
    ],
  );
}

async function patchDraft(db: Queryable, draftId: string, body: JsonBody): Promise<Response> {
  const PATCH = createAdminDraftDetailPatchHandler({ db, session: AUTHORIZED_SESSION });
  return PATCH({ request: jsonRequest(`https://example.test/api/admin/drafts/${draftId}`, body, 'PATCH'), params: { id: draftId } } as never);
}

async function approveDraft(db: Queryable, draftId: string, reviewedFields?: string[]): Promise<Response> {
  const POST = createAdminDraftApprovePostHandler({ db, session: AUTHORIZED_SESSION });
  return POST({ request: jsonRequest(`https://example.test/api/admin/drafts/${draftId}/approve`, reviewedFields ? { reviewedFields } : {}), params: { id: draftId } } as never);
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
  assert.equal(json.code, 'reviewed_diff_missing');
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
  assert.equal(staleJson.code, 'reviewed_diff_missing');

  const secondApproval = await approveDraft(db, 'draft_freshness');
  assert.equal(secondApproval.status, 200);

  const freshPublish = await publishDraft(db, 'draft_freshness', { confirmProvenance: true, confirmPrivacy: true });
  const freshJson = await responseJson(freshPublish);
  assert.equal(freshPublish.status, 200);
  assert.equal(freshJson.code, 'published');
});

test('publish requires the latest admin event to approve the exact immutable field diff', async () => {
  const db = await createMigratedDb();
  const candidateId = await insertCandidate(db, 'candidate_exact_diff');
  await insertDraft(db, {
    id: 'draft_exact_diff',
    candidateId,
    fields: VALID_FIELDS,
    provenance: { repo: true },
    lifecycle: 'needs_review',
  });
  await insertEvidence(db, { id: 'evidence_exact_diff', draftId: 'draft_exact_diff', privacy: 'safe_public' });
  assert.equal((await approveDraft(db, 'draft_exact_diff')).status, 200);

  await db.query(
    `UPDATE review_events
     SET metadata = jsonb_set(metadata, '{reviewedFieldDiff}', '[]'::jsonb)
     WHERE draft_id = $1 AND action = 'approved_for_publish'`,
    ['draft_exact_diff'],
  );
  const response = await publishDraft(db, 'draft_exact_diff', { confirmProvenance: true, confirmPrivacy: true });
  assert.equal(response.status, 409);
  assert.equal((await responseJson(response)).code, 'admin_approval_missing');
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
  assert.equal(noProvenance.status, 200);
  assert.equal((await responseJson(noProvenance)).code, 'published');

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
  assert.equal(privateAllowed.status, 422);
  assert.equal(privateAllowedJson.code, 'public_provenance_missing');
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
  const queued = await db.query<{
    job_type: string; publication_version: string | number; evidence_source_id: string | null; evidence_version: string | number | null;
  }>(
    `SELECT job_type, publication_version, evidence_source_id, evidence_version
     FROM publish_outbox WHERE project_id = $1 ORDER BY job_type`,
    [projectId],
  );
  assert.deepEqual(queued.rows.map((row) => ({
    ...row,
    publication_version: Number(row.publication_version),
    evidence_version: row.evidence_version === null ? null : Number(row.evidence_version),
  })), [
    { job_type: 'rag_index', publication_version: 1, evidence_source_id: 'evidence_happy', evidence_version: 1 },
    { job_type: 'site_refresh', publication_version: 1, evidence_source_id: null, evidence_version: null },
  ]);

  const updateResponse = await patchDraft(db, 'draft_happy', { title: 'Updated Project Title' });
  assert.equal(updateResponse.status, 409);
  assert.equal((await responseJson(updateResponse)).code, 'draft_terminal');
  const republishResponse = await publishDraft(db, 'draft_happy', { confirmProvenance: true, confirmPrivacy: true });
  assert.equal(republishResponse.status, 409);

  const countRows = await db.query<{ count: string; published_at: string; title: string }>(
    `SELECT count(*) AS count, min(published_at)::text AS published_at, min(title) AS title FROM projects WHERE id = $1 GROUP BY id`,
    [projectId],
  );
  assert.equal(Number(countRows.rows[0].count), 1);
  assert.equal(String(countRows.rows[0].published_at), String(firstPublishedAt));
  assert.equal(countRows.rows[0].title, VALID_FIELDS.title);
});

test('a new draft cannot resolve a published project by slug alone', async () => {
  const db = await createMigratedDb();
  const candidateId = await insertCandidate(db, 'candidate_loom_refresh');
  const originalDraftId = 'draft_loom_original';
  const refreshDraftId = 'draft_loom_refresh';

  await insertDraft(db, {
    id: originalDraftId,
    candidateId,
    fields: VALID_FIELDS,
    provenance: { repo: 'loom' },
    lifecycle: 'hidden',
  });
  await insertEvidence(db, { id: 'evidence_loom_original', draftId: originalDraftId, privacy: 'safe_public' });

  const originalPatch = await patchDraft(db, originalDraftId, VALID_FIELDS);
  assert.equal(originalPatch.status, 200);
  const originalApprove = await approveDraft(db, originalDraftId);
  assert.equal(originalApprove.status, 200);
  const originalPublish = await publishDraft(db, originalDraftId, { confirmProvenance: true, confirmPrivacy: true });
  assert.equal(originalPublish.status, 200);

  await insertDraft(db, {
    id: refreshDraftId,
    candidateId,
    fields: {
      ...VALID_FIELDS,
      title: 'Loom refresh title',
      media: [{
        kind: 'video',
        src: '/demos/loom-install.mp4',
        poster: '/demos/loom-install-poster.png',
        caption: 'Installing Loom',
      }],
    },
    provenance: { repo: 'loom' },
    lifecycle: 'hidden',
  });
  await insertEvidence(db, { id: 'evidence_loom_refresh', draftId: refreshDraftId, privacy: 'safe_public' });

  const refreshPatch = await patchDraft(db, refreshDraftId, {
    title: 'Loom refresh title',
    media: [{
      kind: 'video',
      src: '/demos/loom-install.mp4',
      poster: '/demos/loom-install-poster.png',
      caption: 'Installing Loom',
    }],
  });
  assert.equal(refreshPatch.status, 200);
  const refreshApprove = await approveDraft(db, refreshDraftId);
  assert.equal(refreshApprove.status, 200);
  const refreshPublish = await publishDraft(db, refreshDraftId, { confirmProvenance: true, confirmPrivacy: true });
  const refreshJson = await responseJson(refreshPublish);

  assert.equal(refreshPublish.status, 409);
  assert.equal(refreshJson.code, 'slug_conflict');

  const projectRows = await db.query<{ count: string; title: string; media: JsonBody[] }>(
    `SELECT count(*) OVER () AS count, title, media FROM projects WHERE slug = $1 LIMIT 1`,
    [VALID_FIELDS.slug],
  );
  assert.equal(Number(projectRows.rows[0].count), 1);
  assert.equal(projectRows.rows[0].title, VALID_FIELDS.title);
  assert.deepEqual(projectRows.rows[0].media, VALID_FIELDS.media);

  const refreshDraftRows = await db.query<{ proposed_project_id: string }>(
    `SELECT proposed_project_id FROM project_drafts WHERE id = $1`,
    [refreshDraftId],
  );
  assert.equal(refreshDraftRows.rows[0].proposed_project_id, null);
});

test('partial-field approval applies only reviewed values and keeps private evidence draft-only', async () => {
  const db = await createMigratedDb();
  const projectId = 'project_partial_refresh';
  const repositoryId = '81001';
  await insertPublishedProject(db, { id: projectId, slug: 'partial-refresh', publicationVersion: 3 });
  await db.query(
    `INSERT INTO project_sources (id, provider, repository_id, canonical_full_name, project_id)
     VALUES ('source_partial', 'github', $1, 'DylanMcCavitt/partial-refresh', $2)`,
    [repositoryId, projectId],
  );
  await insertDraft(db, {
    id: 'draft_partial_refresh',
    projectId,
    fields: { ...VALID_FIELDS, slug: 'partial-refresh', title: 'Reviewed title', summary: 'Unreviewed summary' },
    provenance: { publicEvidenceIds: ['evidence_partial_safe'], privateEvidenceIds: ['evidence_partial_private'] },
    lifecycle: 'needs_review',
    provider: 'github',
    repositoryId,
    sourceRevision: '7777777777777777777777777777777777777777',
    contentFingerprint: 'a'.repeat(64),
    baseProjectVersion: 3,
  });
  await insertEvidence(db, { id: 'evidence_partial_safe', draftId: 'draft_partial_refresh', privacy: 'safe_public', contentFingerprint: 'a'.repeat(64) });
  await insertEvidence(db, { id: 'evidence_partial_private', draftId: 'draft_partial_refresh', privacy: 'private_allowed_for_draft', contentFingerprint: 'a'.repeat(64) });

  const approval = await approveDraft(db, 'draft_partial_refresh', ['title']);
  const approvalJson = await responseJson(approval);
  assert.equal(approval.status, 200);
  assert.deepEqual(approvalJson.reviewedFields, ['title']);

  const publish = await publishDraft(db, 'draft_partial_refresh', { confirmProvenance: true, confirmPrivacy: true });
  const publishJson = await responseJson(publish);
  assert.equal(publish.status, 200);
  assert.deepEqual(publishJson.changedFields, ['title']);
  assert.equal(publishJson.publicationVersion, 4);

  const project = await db.query<{ title: string; summary: string; publication_version: string | number }>(
    `SELECT title, summary, publication_version FROM projects WHERE id = $1`,
    [projectId],
  );
  assert.equal(project.rows[0]?.title, 'Reviewed title');
  assert.equal(project.rows[0]?.summary, VALID_FIELDS.summary);
  assert.equal(Number(project.rows[0]?.publication_version), 4);

  const draft = await db.query<{ lifecycle_state: string }>(`SELECT lifecycle_state FROM project_drafts WHERE id = 'draft_partial_refresh'`);
  assert.equal(draft.rows[0]?.lifecycle_state, 'published');
  const evidence = await db.query<{ id: string; project_id: string | null }>(
    `SELECT id, project_id FROM evidence_sources WHERE draft_id = 'draft_partial_refresh' ORDER BY id`,
  );
  assert.deepEqual(evidence.rows, [
    { id: 'evidence_partial_private', project_id: null },
    { id: 'evidence_partial_safe', project_id: projectId },
  ]);
  const event = await db.query<{ metadata: Record<string, unknown> }>(
    `SELECT metadata FROM review_events WHERE draft_id = 'draft_partial_refresh' AND action = 'published'`,
  );
  assert.deepEqual(event.rows[0]?.metadata.safePublicEvidenceIds, ['evidence_partial_safe']);
  assert.ok(!JSON.stringify(event.rows[0]?.metadata).includes('evidence_partial_private'));
  const jobs = await db.query<{ job_type: string; evidence_source_id: string | null }>(
    `SELECT job_type, evidence_source_id FROM publish_outbox WHERE project_id = $1 ORDER BY job_type`,
    [projectId],
  );
  assert.deepEqual(jobs.rows, [
    { job_type: 'rag_index', evidence_source_id: 'evidence_partial_safe' },
    { job_type: 'site_refresh', evidence_source_id: null },
  ]);
});

test('outbox enqueue conflict rolls the entire reviewed refresh back', async () => {
  const db = await createMigratedDb();
  const projectId = 'project_outbox_conflict';
  await insertPublishedProject(db, { id: projectId, slug: 'outbox-conflict', publicationVersion: 3 });
  await insertDraft(db, {
    id: 'draft_outbox_conflict',
    projectId,
    fields: { ...VALID_FIELDS, slug: 'outbox-conflict', title: 'Must roll back' },
    provenance: { manual: true },
    lifecycle: 'needs_review',
    baseProjectVersion: 3,
  });
  await insertEvidence(db, { id: 'evidence_outbox_conflict', draftId: 'draft_outbox_conflict', privacy: 'safe_public' });
  assert.equal((await approveDraft(db, 'draft_outbox_conflict', ['title'])).status, 200);
  await db.query(
    `INSERT INTO publish_outbox (id, job_type, project_id, publication_version)
     VALUES ('preexisting-refresh', 'site_refresh', $1, 4)`,
    [projectId],
  );

  const response = await publishDraft(db, 'draft_outbox_conflict', { confirmProvenance: true, confirmPrivacy: true });
  const json = await responseJson(response);
  assert.equal(response.status, 409);
  assert.equal(json.code, 'outbox_enqueue_conflict');
  assert.deepEqual((await db.query<{ title: string; publication_version: string | number }>(
    `SELECT title, publication_version FROM projects WHERE id = $1`, [projectId],
  )).rows.map((row) => ({ ...row, publication_version: Number(row.publication_version) })), [
    { title: VALID_FIELDS.title, publication_version: 3 },
  ]);
  assert.equal((await db.query<{ lifecycle_state: string }>(
    `SELECT lifecycle_state FROM project_drafts WHERE id = 'draft_outbox_conflict'`,
  )).rows[0]?.lifecycle_state, 'approved_for_publish');
  assert.equal((await db.query<{ project_id: string | null }>(
    `SELECT project_id FROM evidence_sources WHERE id = 'evidence_outbox_conflict'`,
  )).rows[0]?.project_id, null);
});

test('reviewed source refresh revokes only removed evidence from the same immutable repository', async () => {
  const db = await createMigratedDb();
  const projectId = 'project_source_scoped_revoke';
  const repositoryId = '81007';
  await insertPublishedProject(db, { id: projectId, slug: 'source-scoped-revoke', publicationVersion: 3 });
  await db.query(
    `INSERT INTO project_sources (id, provider, repository_id, canonical_full_name, project_id)
     VALUES ('source_scoped_revoke', 'github', $1, 'DylanMcCavitt/source-scoped-revoke', $2)`,
    [repositoryId, projectId],
  );
  const priorCandidate = await insertCandidate(db, 'candidate_prior_source');
  await db.query(
    `UPDATE project_candidates
     SET provider = 'github', repository_id = $2, source_revision = $3, content_fingerprint = $4
     WHERE id = $1`,
    [priorCandidate, repositoryId, '1'.repeat(40), 'a'.repeat(64)],
  );
  await insertEvidence(db, {
    id: 'evidence_prior_source', candidateId: priorCandidate, projectId, privacy: 'safe_public', contentFingerprint: 'a'.repeat(64),
  });
  await insertEvidence(db, { id: 'evidence_manual_independent', projectId, privacy: 'safe_public' });
  await db.query(
    `INSERT INTO rag_sources (
       id, project_id, evidence_source_id, evidence_version, publication_version,
       eligibility_state, openai_file_id, vector_store_id, remote_step
     ) VALUES
       ('rag_prior_source', $1, 'evidence_prior_source', 1, 3, 'indexed', 'file-prior', 'vs-shared', 'indexed'),
       ('rag_manual_independent', $1, 'evidence_manual_independent', 1, 3, 'indexed', 'file-manual', 'vs-shared', 'indexed')`,
    [projectId],
  );

  const nextCandidate = await insertCandidate(db, 'candidate_next_source');
  await db.query(
    `UPDATE project_candidates
     SET provider = 'github', repository_id = $2, source_revision = $3, content_fingerprint = $4
     WHERE id = $1`,
    [nextCandidate, repositoryId, '2'.repeat(40), 'b'.repeat(64)],
  );
  await insertDraft(db, {
    id: 'draft_source_scoped_revoke', candidateId: nextCandidate, projectId,
    fields: { ...VALID_FIELDS, slug: 'source-scoped-revoke', title: 'Source-scoped refresh' },
    provenance: { publicEvidenceIds: ['evidence_next_source'] }, lifecycle: 'needs_review',
    provider: 'github', repositoryId, sourceRevision: '2'.repeat(40),
    contentFingerprint: 'b'.repeat(64), baseProjectVersion: 3,
  });
  await insertEvidence(db, {
    id: 'evidence_next_source', candidateId: nextCandidate, draftId: 'draft_source_scoped_revoke',
    privacy: 'safe_public', contentFingerprint: 'b'.repeat(64),
  });
  assert.equal((await approveDraft(db, 'draft_source_scoped_revoke', ['title'])).status, 200);
  assert.equal((await publishDraft(db, 'draft_source_scoped_revoke', {
    confirmProvenance: true, confirmPrivacy: true,
  })).status, 200);

  assert.deepEqual((await db.query<{ id: string; eligibility_state: string }>(
    `SELECT id, eligibility_state FROM rag_sources WHERE project_id = $1 ORDER BY id`, [projectId],
  )).rows, [
    { id: 'rag_manual_independent', eligibility_state: 'indexed' },
    { id: 'rag_prior_source', eligibility_state: 'revoked' },
  ]);
  assert.deepEqual((await db.query<{ job_type: string; evidence_source_id: string | null }>(
    `SELECT job_type, evidence_source_id FROM publish_outbox WHERE project_id = $1 ORDER BY job_type, evidence_source_id`,
    [projectId],
  )).rows, [
    { job_type: 'rag_index', evidence_source_id: 'evidence_next_source' },
    { job_type: 'rag_revoke', evidence_source_id: 'evidence_prior_source' },
    { job_type: 'site_refresh', evidence_source_id: null },
  ]);
});

test('stale base version rejects the whole reviewed publish without partial writes', async () => {
  const db = await createMigratedDb();
  const projectId = 'project_stale_refresh';
  await insertPublishedProject(db, { id: projectId, slug: 'stale-refresh', publicationVersion: 5 });
  await insertDraft(db, {
    id: 'draft_stale_refresh',
    projectId,
    fields: { ...VALID_FIELDS, slug: 'stale-refresh', title: 'Staged title' },
    provenance: { publicEvidenceIds: ['evidence_stale_safe'] },
    lifecycle: 'needs_review',
    provider: 'github',
    repositoryId: '81002',
    sourceRevision: '8888888888888888888888888888888888888888',
    contentFingerprint: 'b'.repeat(64),
    baseProjectVersion: 5,
  });
  await db.query(
    `INSERT INTO project_sources (id, provider, repository_id, canonical_full_name, project_id)
     VALUES ('source_stale', 'github', '81002', 'DylanMcCavitt/stale-refresh', $1)`,
    [projectId],
  );
  await insertEvidence(db, { id: 'evidence_stale_safe', draftId: 'draft_stale_refresh', privacy: 'safe_public', contentFingerprint: 'b'.repeat(64) });
  assert.equal((await approveDraft(db, 'draft_stale_refresh', ['title'])).status, 200);

  await db.query(
    `UPDATE projects SET title = 'Concurrent title', publication_version = 6 WHERE id = $1`,
    [projectId],
  );
  const response = await publishDraft(db, 'draft_stale_refresh', { confirmProvenance: true, confirmPrivacy: true });
  const json = await responseJson(response);
  assert.equal(response.status, 409);
  assert.equal(json.code, 'reviewed_diff_stale');

  const state = await db.query<{ title: string; publication_version: string | number; lifecycle_state: string; project_id: string | null }>(
    `SELECT p.title, p.publication_version, d.lifecycle_state, e.project_id
     FROM projects p
     JOIN project_drafts d ON d.id = 'draft_stale_refresh'
     JOIN evidence_sources e ON e.id = 'evidence_stale_safe'
     WHERE p.id = $1`,
    [projectId],
  );
  assert.equal(state.rows[0]?.title, 'Concurrent title');
  assert.equal(Number(state.rows[0]?.publication_version), 6);
  assert.equal(state.rows[0]?.lifecycle_state, 'approved_for_publish');
  assert.equal(state.rows[0]?.project_id, null);
  const events = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM review_events WHERE draft_id = 'draft_stale_refresh' AND action = 'published'`,
  );
  assert.equal(events.rows[0]?.count, '0');
});

test('atomic publish rejects a reviewed field changed without a publication-version bump', async () => {
  const db = await createMigratedDb();
  const projectId = 'project_field_race';
  await insertPublishedProject(db, { id: projectId, slug: 'field-race', publicationVersion: 5 });
  await db.query(
    `INSERT INTO project_sources (id, provider, repository_id, canonical_full_name, project_id)
     VALUES ('source_field_race', 'github', '81003', 'DylanMcCavitt/field-race', $1)`,
    [projectId],
  );
  await insertDraft(db, {
    id: 'draft_field_race',
    projectId,
    fields: { ...VALID_FIELDS, slug: 'field-race', title: 'Reviewed title' },
    provenance: { publicEvidenceIds: ['evidence_field_race'] },
    lifecycle: 'needs_review',
    provider: 'github',
    repositoryId: '81003',
    sourceRevision: '9999999999999999999999999999999999999998',
    contentFingerprint: 'c'.repeat(64),
    baseProjectVersion: 5,
  });
  await insertEvidence(db, {
    id: 'evidence_field_race',
    draftId: 'draft_field_race',
    privacy: 'safe_public',
    contentFingerprint: 'c'.repeat(64),
  });
  assert.equal((await approveDraft(db, 'draft_field_race', ['title'])).status, 200);

  let changedAtCommit = false;
  const racingDb: AdminPublishQueryable = {
    async query<Row = unknown>(sql: string, params?: unknown[]) {
      if (!changedAtCommit && sql.includes('WITH locked_evidence AS')) {
        changedAtCommit = true;
        await db.query(`UPDATE projects SET title = 'Direct concurrent edit' WHERE id = $1`, [projectId]);
      }
      return db.query<Row>(sql, params);
    },
  };
  const result = await publishAdminDraft(racingDb, 'draft_field_race', ACTOR, {
    confirmProvenance: true,
    confirmPrivacy: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.code, 'reviewed_diff_stale');
  assert.deepEqual(
    (await db.query<{ title: string; publication_version: string | number }>(
      `SELECT title, publication_version FROM projects WHERE id = $1`,
      [projectId],
    )).rows,
    [{ title: 'Direct concurrent edit', publication_version: 5 }],
  );
  assert.equal(
    (await db.query<{ lifecycle_state: string }>(`SELECT lifecycle_state FROM project_drafts WHERE id = 'draft_field_race'`)).rows[0]?.lifecycle_state,
    'approved_for_publish',
  );
});

test('approval rejects a concurrent field restage instead of approving a stale visible diff', async () => {
  const db = await createMigratedDb();
  await insertDraft(db, {
    id: 'draft_approval_race',
    fields: { ...VALID_FIELDS, title: 'Older staged title' },
    provenance: { manual: true },
    lifecycle: 'needs_review',
  });
  let changedBeforeApproval = false;
  const racingDb: AdminPublishQueryable = {
    async query<Row = unknown>(sql: string, params?: unknown[]) {
      if (!changedBeforeApproval && sql.includes('WITH approved AS')) {
        changedBeforeApproval = true;
        const staged = await updateAdminDraftFields(db, 'draft_approval_race', 'github:other-admin', {
          title: 'Newer staged title',
        });
        assert.equal(staged.ok, true);
      }
      return db.query<Row>(sql, params);
    },
  };
  const result = await approveAdminDraftForPublish(racingDb, 'draft_approval_race', ACTOR);
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.code, 'draft_state_changed');
  const draft = await db.query<{ title: string; lifecycle_state: string; reviewed_field_diff: unknown[] }>(
    `SELECT proposed_fields->>'title' AS title, lifecycle_state, reviewed_field_diff
     FROM project_drafts WHERE id = 'draft_approval_race'`,
  );
  assert.deepEqual(draft.rows, [{ title: 'Newer staged title', lifecycle_state: 'needs_review', reviewed_field_diff: [] }]);
  assert.equal(
    (await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM review_events
       WHERE draft_id = 'draft_approval_race' AND action = 'approved_for_publish'`,
    )).rows[0]?.count,
    '0',
  );
});

test('concurrent disjoint PATCH updates merge atomically without losing either field', async () => {
  const db = await createMigratedDb();
  await insertDraft(db, {
    id: 'draft_patch_merge',
    fields: VALID_FIELDS,
    provenance: { manual: true },
    lifecycle: 'needs_review',
  });
  let waiting = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const racingDb: AdminPublishQueryable = {
    async query<Row = unknown>(sql: string, params?: unknown[]) {
      if (sql.includes('WITH changed AS')) {
        waiting += 1;
        if (waiting === 2) release();
        await barrier;
      }
      return db.query<Row>(sql, params);
    },
  };
  const [title, summary] = await Promise.all([
    updateAdminDraftFields(racingDb, 'draft_patch_merge', 'github:title-editor', { title: 'Merged title' }),
    updateAdminDraftFields(racingDb, 'draft_patch_merge', 'github:summary-editor', { summary: 'Merged summary.' }),
  ]);
  assert.equal(title.ok, true);
  assert.equal(summary.ok, true);
  assert.deepEqual(
    (await db.query<{ title: string; summary: string }>(
      `SELECT proposed_fields->>'title' AS title, proposed_fields->>'summary' AS summary
       FROM project_drafts WHERE id = 'draft_patch_merge'`,
    )).rows,
    [{ title: 'Merged title', summary: 'Merged summary.' }],
  );
});

test('foreign-project evidence and source relink races cannot support or redirect a publish', async () => {
  const db = await createMigratedDb();
  const targetId = 'project_identity_target';
  const foreignId = 'project_identity_foreign';
  await insertPublishedProject(db, { id: targetId, slug: 'identity-target', publicationVersion: 2 });
  await insertPublishedProject(db, { id: foreignId, slug: 'identity-foreign', publicationVersion: 1 });
  await db.query(
    `INSERT INTO project_sources (id, provider, repository_id, canonical_full_name, project_id)
     VALUES ('source_identity_target', 'github', '81004', 'DylanMcCavitt/identity-target', $1)`,
    [targetId],
  );
  await insertDraft(db, {
    id: 'draft_foreign_evidence',
    projectId: targetId,
    fields: { ...VALID_FIELDS, slug: 'identity-target', title: 'Should not publish' },
    provenance: { publicEvidenceIds: ['evidence_foreign_owner'] },
    lifecycle: 'needs_review',
    provider: 'github',
    repositoryId: '81004',
    sourceRevision: '9999999999999999999999999999999999999997',
    contentFingerprint: 'd'.repeat(64),
    baseProjectVersion: 2,
  });
  await insertEvidence(db, {
    id: 'evidence_foreign_owner',
    draftId: 'draft_foreign_evidence',
    projectId: foreignId,
    privacy: 'safe_public',
    contentFingerprint: 'd'.repeat(64),
  });
  assert.equal((await approveDraft(db, 'draft_foreign_evidence', ['title'])).status, 200);
  const foreignEvidence = await publishDraft(db, 'draft_foreign_evidence', { confirmProvenance: true, confirmPrivacy: true });
  assert.equal(foreignEvidence.status, 409);
  assert.equal((await responseJson(foreignEvidence)).code, 'evidence_project_conflict');

  await db.query(`UPDATE evidence_sources SET project_id = NULL WHERE id = 'evidence_foreign_owner'`);
  let relinkedAtCommit = false;
  const racingDb: AdminPublishQueryable = {
    async query<Row = unknown>(sql: string, params?: unknown[]) {
      if (!relinkedAtCommit && sql.includes('WITH locked_evidence AS')) {
        relinkedAtCommit = true;
        await db.query(`UPDATE project_sources SET project_id = $1 WHERE repository_id = '81004'`, [foreignId]);
      }
      return db.query<Row>(sql, params);
    },
  };
  const sourceRace = await publishAdminDraft(racingDb, 'draft_foreign_evidence', ACTOR, {
    confirmProvenance: true,
    confirmPrivacy: true,
  });
  assert.equal(sourceRace.ok, false);
  assert.equal(sourceRace.status, 409);
  assert.deepEqual(
    (await db.query<{ id: string; title: string; publication_version: string | number }>(
      `SELECT id, title, publication_version FROM projects WHERE id IN ($1, $2) ORDER BY id`,
      [targetId, foreignId],
    )).rows,
    [
      { id: foreignId, title: VALID_FIELDS.title, publication_version: 1 },
      { id: targetId, title: VALID_FIELDS.title, publication_version: 2 },
    ],
  );
  assert.equal(
    (await db.query<{ project_id: string | null }>(`SELECT project_id FROM evidence_sources WHERE id = 'evidence_foreign_owner'`)).rows[0]?.project_id,
    null,
  );
});

test('single-statement publish leaves no project or evidence link when draft eligibility changes at commit time', async () => {
  const db = await createMigratedDb();
  const candidateId = await insertCandidate(db, 'candidate_commit_race');
  await insertDraft(db, {
    id: 'draft_commit_race',
    candidateId,
    fields: { ...VALID_FIELDS, slug: 'commit-race' },
    provenance: { publicEvidenceIds: ['evidence_commit_race'] },
    lifecycle: 'needs_review',
  });
  await insertEvidence(db, { id: 'evidence_commit_race', draftId: 'draft_commit_race', privacy: 'safe_public' });
  assert.equal((await approveDraft(db, 'draft_commit_race')).status, 200);

  let changedAtCommit = false;
  const racingDb: AdminPublishQueryable = {
    async query<Row = unknown>(sql: string, params?: unknown[]) {
      if (!changedAtCommit && sql.includes('WITH locked_evidence AS')) {
        changedAtCommit = true;
        await db.query(`UPDATE project_drafts SET lifecycle_state = 'changes_requested' WHERE id = 'draft_commit_race'`);
      }
      return db.query<Row>(sql, params);
    },
  };
  const result = await publishAdminDraft(racingDb, 'draft_commit_race', ACTOR, {
    confirmProvenance: true,
    confirmPrivacy: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.code, 'reviewed_diff_stale');

  assert.equal((await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM projects WHERE slug = 'commit-race'`)).rows[0]?.count, '0');
  assert.equal((await db.query<{ project_id: string | null }>(`SELECT project_id FROM evidence_sources WHERE id = 'evidence_commit_race'`)).rows[0]?.project_id, null);
  assert.equal((await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM review_events WHERE draft_id = 'draft_commit_race' AND action = 'published'`)).rows[0]?.count, '0');
});

test('publish revalidates evidence privacy inside the atomic commit statement', async () => {
  const db = await createMigratedDb();
  const candidateId = await insertCandidate(db, 'candidate_privacy_race');
  await insertDraft(db, {
    id: 'draft_privacy_race',
    candidateId,
    fields: { ...VALID_FIELDS, slug: 'privacy-race' },
    provenance: { publicEvidenceIds: ['evidence_privacy_race'] },
    lifecycle: 'needs_review',
  });
  await insertEvidence(db, { id: 'evidence_privacy_race', draftId: 'draft_privacy_race', privacy: 'safe_public' });
  assert.equal((await approveDraft(db, 'draft_privacy_race')).status, 200);

  let changedAtCommit = false;
  const racingDb: AdminPublishQueryable = {
    async query<Row = unknown>(sql: string, params?: unknown[]) {
      if (!changedAtCommit && sql.includes('WITH locked_evidence AS')) {
        changedAtCommit = true;
        await db.query(
          `UPDATE evidence_sources SET privacy_state = 'private_allowed_for_draft' WHERE id = 'evidence_privacy_race'`,
        );
      }
      return db.query<Row>(sql, params);
    },
  };
  const result = await publishAdminDraft(racingDb, 'draft_privacy_race', ACTOR, {
    confirmProvenance: true,
    confirmPrivacy: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal((await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM projects WHERE slug = 'privacy-race'`)).rows[0]?.count, '0');
  assert.equal((await db.query<{ lifecycle_state: string }>(`SELECT lifecycle_state FROM project_drafts WHERE id = 'draft_privacy_race'`)).rows[0]?.lifecycle_state, 'approved_for_publish');
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

  const areaResponse = await patchDraft(db, 'draft_invalid', { area: 'TypeScript' });
  assert.equal(areaResponse.status, 422);
  assert.equal((await responseJson(areaResponse)).field, 'area');
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

  const malformedDetailsResponse = await patchDraft(db, 'draft_invalid', {
    details: [{ label: 'Missing value' }],
  });
  assert.equal((await responseJson(malformedDetailsResponse)).field, 'details');
  await assertProposedFields(db, 'draft_invalid', unchanged);

  const unsafeLinkResponse = await patchDraft(db, 'draft_invalid', {
    links: [{ label: 'Unsafe', href: 'javascript:alert(1)' }],
  });
  assert.equal((await responseJson(unsafeLinkResponse)).field, 'links');
  await assertProposedFields(db, 'draft_invalid', unchanged);

  const unsafeMediaResponse = await patchDraft(db, 'draft_invalid', {
    media: [{ kind: 'image', src: 'data:image/png;base64,bad', caption: 'Unsafe' }],
  });
  assert.equal((await responseJson(unsafeMediaResponse)).field, 'media');
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
