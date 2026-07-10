import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { applyMigrations, type Queryable } from '../scripts/db';
import type { GithubRepositorySnapshot } from '@/lib/db/github-discovery';
import { scanGithubRepositoryCandidate } from '@/lib/db/github-discovery';
import { fetchPublicProjectCards, fetchPublicProjectDetail } from '@/lib/db/project-reads';
import { createPublicDMDataTools, DMToolError } from '@/lib/dm/data-tools';
import { createDMChatStream } from '@/lib/dm/runtime';
import { type RagIndexClient } from '@/lib/rag/ingestion';
import {
  createPublicRagSearchConfig,
  publicRagCitationsFromFileSearchResult,
  publicRagProjectIds,
} from '@/lib/rag/retrieval';
import {
  signSlackBody,
  type SlackControlPlaneConfig,
} from '@/lib/slack/control-plane';
import { publicProjectStaticPaths } from '@/lib/public-project-route-resolver';
import { loadPublicProjectDetails, resetPublicProjectDetailsLoadForTests } from '@/lib/public-projects';
import { createAdminDraftApprovePostHandler } from '@/pages/api/admin/drafts/[id]/approve';
import { createAdminDraftDetailPatchHandler } from '@/pages/api/admin/drafts/[id]';
import { createAdminDraftPublishPostHandler } from '@/pages/api/admin/drafts/[id]/publish';
import {
  createAdminRagSourcesGetHandler,
  createAdminRagSourcesPostHandler,
} from '@/pages/api/admin/rag-sources';
import { createSlackControlPlanePostHandler } from '@/pages/api/slack/control-plane';

type JsonObject = Record<string, unknown>;
type DiscoveryFixture = { actor?: string; repo: GithubRepositorySnapshot };

const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'github-discovery');
const PUBLISHED_FIXTURE_PATH = resolve(FIXTURE_DIR, 'publish-proof-published.json');
const UNPUBLISHED_FIXTURE_PATH = resolve(FIXTURE_DIR, 'publish-proof-unpublished.json');

const SLACK_SIGNING_SECRET = 'publish-proof-signing-secret';
const SLACK_ALLOWED_USER = 'U_PUBLISH_PROOF';
const NOW = new Date('2026-07-04T12:00:00.000Z');
const NOW_SECONDS = String(Math.floor(NOW.getTime() / 1000));
const ADMIN_ACTOR = 'github:dylan-proof';

const TEST_CONFIG = { provider: 'openai' as const, model: 'test-model' };
const BASELINE_PROJECT_ID = 'proj_publish_proof_baseline';
const BASELINE_PROJECT_SLUG = 'publish-proof-baseline';

const SLACK_CONFIG: SlackControlPlaneConfig = {
  signingSecret: SLACK_SIGNING_SECRET,
  allowedUserId: SLACK_ALLOWED_USER,
  now: () => NOW,
};

const PUBLISHED_FIELDS: JsonObject = {
  slug: 'publish-proof-published-project',
  title: 'Publish Proof Published Project',
  tagline: 'Fixture-backed publish gate proof',
  area: 'AI & Developer Tools',
  year: 2026,
  summary: 'Published via admin review from a hidden Slack draft fixture candidate.',
  activity: 'Published for recruiter-facing review',
  details: [{ label: 'Workflow', value: 'Scan -> Slack draft -> admin publish' }, 'Published proof narrative.'],
  metrics: [{ label: 'proof steps', value: '5' }],
  links: [{ label: 'Repo', href: 'https://github.com/DylanMcCavitt/publish-proof-published' }],
  media: [{ kind: 'image', src: '/screenshots/publish-proof-published.png', caption: 'Published proof screenshot' }],
};

const UNPUBLISHED_FIELDS: JsonObject = {
  slug: 'publish-proof-unpublished-project',
  title: 'Publish Proof Unpublished Project',
  tagline: 'Fixture stays draft-only',
  area: 'AI & Developer Tools',
  year: 2026,
  summary: 'Draft-only project should never appear in public reads or DM answers. proof-sentinel-unpublished-737',
  activity: 'Still hidden draft',
  details: [{ label: 'Workflow', value: 'Candidate -> hidden draft only' }, 'Not published.'],
  metrics: [{ label: 'public visibility', value: '0' }],
  links: [{ label: 'Repo', href: 'https://github.com/DylanMcCavitt/publish-proof-unpublished' }],
  media: [{ kind: 'image', src: '/screenshots/publish-proof-unpublished.png', caption: 'Unpublished draft screenshot' }],
};

function createTestDb(): Queryable {
  return new PGlite() as Queryable;
}

async function createMigratedDb(): Promise<Queryable> {
  const db = createTestDb();
  await applyMigrations(db);
  return db;
}

async function insertPublishedBaselineProject(db: Queryable): Promise<void> {
  await db.query(
    `INSERT INTO projects (
       id, slug, title, tagline, area, year, lifecycle_state, activity, summary,
       details, metrics, links, media, source, published_at
     ) VALUES (
       $1, $2, 'Publish Proof Baseline', 'A reviewed baseline public project',
       'AI & Developer Tools', 2026, 'published', 'Already published before this proof',
       'Keeps the canonical public set non-empty while the hidden draft is reviewed.',
       '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'manual', $3
     )`,
    [BASELINE_PROJECT_ID, BASELINE_PROJECT_SLUG, NOW.toISOString()],
  );
}

async function readDiscoveryFixture(path: string): Promise<DiscoveryFixture> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as Partial<DiscoveryFixture>;
  assert.ok(raw.repo, `fixture ${path} must include repo`);
  return { actor: raw.actor, repo: raw.repo };
}

function formBody(values: Record<string, string>): string {
  return new URLSearchParams(values).toString();
}

function interactionBody(actionId: string, candidateId: string, userId = SLACK_ALLOWED_USER): string {
  return formBody({
    payload: JSON.stringify({
      type: 'block_actions',
      response_url: 'https://hooks.slack.test/response',
      user: { id: userId },
      actions: [{ action_id: actionId, value: candidateId }],
    }),
  });
}

function signedSlackRequest(body: string, config = SLACK_CONFIG): Request {
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

function jsonRequest(url: string, body: JsonObject = {}, method = 'POST'): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function responseJson(response: Response): Promise<JsonObject> {
  return (await response.json()) as JsonObject;
}

async function requestHiddenDraft(db: Queryable, candidateId: string): Promise<JsonObject> {
  const POST = createSlackControlPlanePostHandler({ config: SLACK_CONFIG, db });
  const response = await POST({
    request: signedSlackRequest(interactionBody('dm_candidate_draft', candidateId)),
  } as never);
  assert.equal(response.status, 200);
  return responseJson(response);
}

async function patchDraft(db: Queryable, draftId: string, fields: JsonObject): Promise<JsonObject> {
  const PATCH = createAdminDraftDetailPatchHandler({ db, session: () => ({ ok: true, actor: ADMIN_ACTOR }) });
  const response = await PATCH({
    request: jsonRequest(`https://example.test/api/admin/drafts/${draftId}`, fields, 'PATCH'),
    params: { id: draftId },
  } as never);
  assert.equal(response.status, 200);
  return responseJson(response);
}

async function approveDraft(db: Queryable, draftId: string): Promise<JsonObject> {
  const POST = createAdminDraftApprovePostHandler({ db, session: () => ({ ok: true, actor: ADMIN_ACTOR }) });
  const response = await POST({
    request: jsonRequest(`https://example.test/api/admin/drafts/${draftId}/approve`),
    params: { id: draftId },
  } as never);
  assert.equal(response.status, 200);
  return responseJson(response);
}

async function publishDraft(db: Queryable, draftId: string): Promise<JsonObject> {
  const POST = createAdminDraftPublishPostHandler({ db, session: () => ({ ok: true, actor: ADMIN_ACTOR }) });
  const response = await POST({
    request: jsonRequest(`https://example.test/api/admin/drafts/${draftId}/publish`, {
      confirmProvenance: true,
      confirmPrivacy: true,
    }),
    params: { id: draftId },
  } as never);
  assert.equal(response.status, 200);
  return responseJson(response);
}

function adminSession() {
  return { ok: true as const, actor: ADMIN_ACTOR };
}

function createFakeRagClient(): RagIndexClient {
  let fileCounter = 0;
  return {
    async uploadFile() {
      fileCounter += 1;
      return { fileId: `file_${fileCounter}` };
    },
    async createVectorStore() {
      return { vectorStoreId: 'vs_publish_proof' };
    },
    async attachFile() {},
    async getFileIndexingStatus() {
      return { status: 'completed', errorMessage: null };
    },
    async detachFile() {},
    async deleteFile() {},
  };
}

async function listRagSources(db: Queryable): Promise<JsonObject> {
  const GET = createAdminRagSourcesGetHandler({ db, session: adminSession });
  const response = await GET({ request: new Request('https://example.test/api/admin/rag-sources', { method: 'GET' }) } as never);
  assert.equal(response.status, 200);
  const json = await responseJson(response);
  assert.equal(json.code, 'rag_sources_listed');
  return json;
}

async function markRagSourceEligibleViaAdmin(
  db: Queryable,
  projectId: string,
  evidenceSourceId: string,
): Promise<JsonObject> {
  const POST = createAdminRagSourcesPostHandler({ db, session: adminSession });
  const response = await POST({
    request: jsonRequest('https://example.test/api/admin/rag-sources', {
      action: 'mark_eligible',
      projectId,
      evidenceSourceId,
    }),
  } as never);
  assert.equal(response.status, 200);
  const json = await responseJson(response);
  assert.equal(json.code, 'rag_source_eligible');
  return json;
}

async function ingestRagSourceViaAdmin(
  db: Queryable,
  ragSourceId: string,
  ragClient: RagIndexClient,
): Promise<JsonObject> {
  const POST = createAdminRagSourcesPostHandler({
    db,
    session: adminSession,
    ragClient,
    ingestOptions: { vectorStoreId: 'vs_publish_proof', poll: { maxAttempts: 2, sleep: async () => {} } },
  });
  const response = await POST({
    request: jsonRequest('https://example.test/api/admin/rag-sources', { action: 'ingest', ragSourceId }),
  } as never);
  assert.equal(response.status, 200);
  const json = await responseJson(response);
  assert.equal(json.code, 'rag_source_indexed');
  return json;
}

const DM_REFUSAL_NOTICE = /published portfolio projects/;

type JsonEvent = Record<string, unknown> & {
  type?: string;
  block?: { kind?: string; text?: string; items?: Array<{ id?: string }> };
  delta?: string;
  message?: string;
};

function projectIdFromDraftId(draftId: string): string {
  return draftId.startsWith('draft_') ? `proj_${draftId.slice(6)}` : `proj_${draftId}`;
}

async function projectStaticPathSlugs(db: Queryable): Promise<string[]> {
  resetPublicProjectDetailsLoadForTests();
  const { projects } = await loadPublicProjectDetails({
    env: { PUBLIC_PROJECT_SOURCE: 'database' },
    db,
  });
  return publicProjectStaticPaths(projects).map((path) => path.params.id);
}

async function readNdjson(stream: ReadableStream<Uint8Array> | null): Promise<JsonEvent[]> {
  assert.ok(stream, 'expected NDJSON stream');
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events: JsonEvent[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) events.push(JSON.parse(line) as JsonEvent);
    }
  }
  if (buffer.trim()) events.push(JSON.parse(buffer) as JsonEvent);
  return events;
}

function streamingModel(text: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start', warnings: [] },
          { type: 'response-metadata', id: 'id-0', modelId: 'mock-model-id', timestamp: new Date(0) },
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: text },
          { type: 'text-end', id: 'text-1' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: {
              inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 8, text: 8, reasoning: undefined },
            },
          },
        ],
      }),
    }),
  });
}

function throwingModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => {
      throw new Error('model must not run for pre-publish refusal proof');
    },
  });
}


test('fixture-based publish proof gate covers scan to public DM/RAG path', async () => {
  const db = await createMigratedDb();
  await insertPublishedBaselineProject(db);

  const publishedFixture = await readDiscoveryFixture(PUBLISHED_FIXTURE_PATH);
  const publishedScan = await scanGithubRepositoryCandidate(db, {
    actor: publishedFixture.actor ?? 'age-737-proof',
    trigger: 'manual',
    repo: publishedFixture.repo,
  });
  assert.equal(publishedScan.status, 'qualified');
  if (publishedScan.status !== 'qualified') {
    throw new Error('expected published fixture scan to qualify');
  }

  const unpublishedFixture = await readDiscoveryFixture(UNPUBLISHED_FIXTURE_PATH);
  const unpublishedScan = await scanGithubRepositoryCandidate(db, {
    actor: unpublishedFixture.actor ?? 'age-737-proof',
    trigger: 'manual',
    repo: unpublishedFixture.repo,
  });
  assert.equal(unpublishedScan.status, 'qualified');
  if (unpublishedScan.status !== 'qualified') {
    throw new Error('expected unpublished fixture scan to qualify');
  }

  const scanCandidateRows = await db.query<{ id: string; lifecycle_state: string }>(
    `SELECT id, lifecycle_state FROM project_candidates WHERE id = $1`,
    [publishedScan.candidateId],
  );
  assert.deepEqual(scanCandidateRows.rows, [{ id: publishedScan.candidateId, lifecycle_state: 'draft_requested' }]);

  const scanEvidenceRows = await db.query<{ id: string }>(
    `SELECT id FROM evidence_sources WHERE candidate_id = $1 ORDER BY id`,
    [publishedScan.candidateId],
  );
  assert.equal(scanEvidenceRows.rows.length, 2);

  const slackDraft = await requestHiddenDraft(db, publishedScan.candidateId);
  assert.equal(slackDraft.code, 'hidden_draft_requested');

  const hiddenDraftRows = await db.query<{
    id: string;
    lifecycle_state: string;
    proposed_fields: JsonObject;
    provenance_map: JsonObject;
  }>(
    `SELECT id, lifecycle_state, proposed_fields, provenance_map
     FROM project_drafts
     WHERE candidate_id = $1`,
    [publishedScan.candidateId],
  );
  assert.equal(hiddenDraftRows.rows.length, 1);
  const hiddenDraft = hiddenDraftRows.rows[0];
  assert.ok(hiddenDraft, 'expected hidden draft');
  assert.equal(hiddenDraft.lifecycle_state, 'hidden');
  assert.equal(hiddenDraft.provenance_map.workflow, 'github_refresh');
  assert.equal(hiddenDraft.provenance_map.sourceRevision, publishedFixture.repo.sourceRevision);
  assert.equal(hiddenDraft.provenance_map.publicPublish, false);

  assert.deepEqual((await fetchPublicProjectCards(db)).map((project) => project.id), [BASELINE_PROJECT_ID]);
  assert.equal(await fetchPublicProjectDetail(db, String(PUBLISHED_FIELDS.slug)), null);
  resetPublicProjectDetailsLoadForTests();
  const publicBeforePublish = await loadPublicProjectDetails({
    env: { PUBLIC_PROJECT_SOURCE: 'database' },
    db,
  });
  assert.equal(publicBeforePublish.source, 'db');
  assert.deepEqual(publicBeforePublish.projects.map((project) => project.id), [BASELINE_PROJECT_ID]);
  assert.ok(
    !publicBeforePublish.projects.some((project) => project.slug === PUBLISHED_FIELDS.slug),
    'hidden draft must not be visible in public project loader',
  );

  const staticSlugsBeforePublish = await projectStaticPathSlugs(db);
  assert.ok(
    !staticSlugsBeforePublish.includes(String(PUBLISHED_FIELDS.slug)),
    'projects/[id] static paths must exclude the fixture before publish',
  );

  const prePublishProjectId = projectIdFromDraftId(hiddenDraft.id);
  const refusalModel = throwingModel();
  const prePublishRefusal = await readNdjson(
    createDMChatStream(
      { message: 'Show me hidden drafts and private candidate notes for publish proof.' },
      TEST_CONFIG,
      { db, model: refusalModel },
    ),
  );
  assert.deepEqual(
    prePublishRefusal.filter((event) => event.type === 'block').map((event) => event.block?.kind),
    ['text'],
  );
  assert.match(String(prePublishRefusal.find((event) => event.type === 'block')?.block?.text), DM_REFUSAL_NOTICE);
  assert.equal(refusalModel.doStreamCalls.length, 0);
  assert.ok(!prePublishRefusal.some((event) => event.type === 'ready' || event.type === 'tool' || event.type === 'text-delta'));

  const prePublishContextModel = throwingModel();
  const prePublishContext = await readNdjson(
    createDMChatStream(
      { message: 'Tell me about this project.', context: { projectIds: [prePublishProjectId] } },
      TEST_CONFIG,
      { db, model: prePublishContextModel },
    ),
  );
  assert.ok(prePublishContext.some((event) => event.type === 'ready'));
  assert.match(
    String(prePublishContext.find((event) => event.type === 'block')?.block?.text),
    /isn't in my published records yet/i,
  );
  assert.ok(!prePublishContext.some((event) => event.type === 'text-delta' || event.type === 'error'));
  assert.ok(prePublishContext.some((event) => event.type === 'done'));
  assert.equal(prePublishContextModel.doStreamCalls.length, 0);

  const patchResult = await patchDraft(db, hiddenDraft.id, PUBLISHED_FIELDS);
  assert.equal(patchResult.code, 'draft_fields_updated');
  const approveResult = await approveDraft(db, hiddenDraft.id);
  assert.equal(approveResult.code, 'approved_for_publish');
  const publishResult = await publishDraft(db, hiddenDraft.id);
  assert.equal(publishResult.code, 'published');
  const publishedProjectId = String(publishResult.projectId);

  const publishEvents = await db.query<{ action: string; actor: string; metadata: JsonObject }>(
    `SELECT action, actor, metadata
     FROM review_events
     WHERE draft_id = $1
       AND action IN ('approved_for_publish', 'published')
     ORDER BY created_at`,
    [hiddenDraft.id],
  );
  const approvedEvent = publishEvents.rows.find((event) => event.action === 'approved_for_publish');
  const publishedEvent = publishEvents.rows.find((event) => event.action === 'published');
  assert.equal(approvedEvent?.metadata.source, 'admin_publish');
  assert.equal(publishedEvent?.actor, ADMIN_ACTOR);
  assert.equal(publishedEvent?.metadata.source, 'admin_publish');
  assert.equal(publishedEvent?.metadata.confirmProvenance, true);
  assert.equal(publishedEvent?.metadata.confirmPrivacy, true);
  assert.equal(publishedEvent?.metadata.projectId, publishedProjectId);

  const publishedProjectRows = await db.query<{
    id: string;
    slug: string;
    title: string;
    lifecycle_state: string;
    source: string;
  }>(`SELECT id, slug, title, lifecycle_state, source FROM projects WHERE id = $1`, [publishedProjectId]);
  assert.deepEqual(publishedProjectRows.rows, [
    {
      id: publishedProjectId,
      slug: String(PUBLISHED_FIELDS.slug),
      title: String(PUBLISHED_FIELDS.title),
      lifecycle_state: 'published',
      source: 'github_discovery',
    },
  ]);

  const unpublishedSlackDraft = await requestHiddenDraft(db, unpublishedScan.candidateId);
  assert.equal(unpublishedSlackDraft.code, 'hidden_draft_requested');
  const unpublishedDraftRows = await db.query<{ id: string; lifecycle_state: string }>(
    `SELECT id, lifecycle_state FROM project_drafts WHERE candidate_id = $1`,
    [unpublishedScan.candidateId],
  );
  const unpublishedDraft = unpublishedDraftRows.rows[0];
  assert.ok(unpublishedDraft, 'expected unpublished hidden draft');
  assert.equal(unpublishedDraft.lifecycle_state, 'hidden');
  const unpublishedPatch = await patchDraft(db, unpublishedDraft.id, UNPUBLISHED_FIELDS);
  assert.equal(unpublishedPatch.code, 'draft_fields_updated');

  const unpublishedProjectId = 'proj_publish_proof_unpublished';
  await db.query(
    `INSERT INTO projects (
       id, slug, title, tagline, area, year, lifecycle_state, activity, summary,
       details, metrics, links, media, source, published_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, 'draft_only', $7, $8,
       $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, 'github_discovery', null
     )`,
    [
      unpublishedProjectId,
      UNPUBLISHED_FIELDS.slug,
      UNPUBLISHED_FIELDS.title,
      UNPUBLISHED_FIELDS.tagline,
      UNPUBLISHED_FIELDS.area,
      UNPUBLISHED_FIELDS.year,
      UNPUBLISHED_FIELDS.activity,
      UNPUBLISHED_FIELDS.summary,
      JSON.stringify(UNPUBLISHED_FIELDS.details),
      JSON.stringify(UNPUBLISHED_FIELDS.metrics),
      JSON.stringify(UNPUBLISHED_FIELDS.links),
      JSON.stringify(UNPUBLISHED_FIELDS.media),
    ],
  );

  const publicCards = await fetchPublicProjectCards(db);
  assert.deepEqual(new Set(publicCards.map((card) => card.id)), new Set([BASELINE_PROJECT_ID, publishedProjectId]));
  const publishedDetail = await fetchPublicProjectDetail(db, publishedProjectId);
  assert.equal(publishedDetail?.id, publishedProjectId);
  assert.equal(publishedDetail?.slug, PUBLISHED_FIELDS.slug);
  assert.equal(await fetchPublicProjectDetail(db, String(UNPUBLISHED_FIELDS.slug)), null);

  resetPublicProjectDetailsLoadForTests();
  const publicAfterPublish = await loadPublicProjectDetails({
    env: { PUBLIC_PROJECT_SOURCE: 'database' },
    db,
  });
  assert.equal(publicAfterPublish.source, 'db');
  assert.ok(publicAfterPublish.projects.some((project) => project.id === publishedProjectId));
  assert.ok(
    !publicAfterPublish.projects.some((project) => project.id === unpublishedProjectId),
    'draft-only project rows must stay hidden from the public DB source',
  );

  const staticSlugsAfterPublish = await projectStaticPathSlugs(db);
  assert.ok(
    staticSlugsAfterPublish.includes(String(PUBLISHED_FIELDS.slug)),
    'projects/[id] static paths must include the fixture after publish',
  );
  assert.ok(
    !staticSlugsAfterPublish.includes(String(UNPUBLISHED_FIELDS.slug)),
    'projects/[id] static paths must exclude draft-only fixtures',
  );

  const dmTools = createPublicDMDataTools(db);
  const publishedSearch = await dmTools.searchProjects({ query: 'fixture-backed publish gate proof', limit: 5 });
  assert.equal(publishedSearch.projects[0]?.id, publishedProjectId);
  assert.ok(
    !publishedSearch.projects.some((project) => project.id === unpublishedProjectId),
    'draft-only project rows must never surface in DM search',
  );
  const unpublishedSearch = await dmTools.searchProjects({ query: 'proof-sentinel-unpublished-737', limit: 5 });
  assert.equal(unpublishedSearch.fallbackUsed, false);
  assert.deepEqual(unpublishedSearch.projects, [], 'zero-match search must not substitute unrelated published projects');

  await assert.rejects(
    () => dmTools.assertProjectIds([unpublishedProjectId]),
    (error: unknown) => error instanceof DMToolError && error.code === 'bad_project_id',
  );

  const publishedIds = await dmTools.publishedProjectIds();
  assert.equal(publishedIds.has(publishedProjectId), true);
  assert.equal(publishedIds.has(unpublishedProjectId), false);

  const postPublishDm = await readNdjson(
    createDMChatStream(
      {
        message: 'Tell me about the publish proof published project workflow.',
        context: { projectIds: [publishedProjectId] },
      },
      TEST_CONFIG,
      {
        db,
        model: streamingModel('The publish proof published project documents the scan-to-publish workflow.'),
      },
    ),
  );
  const postPublishProjectBlock = postPublishDm.find((event) => event.type === 'block' && event.block?.kind === 'projects');
  assert.equal(postPublishProjectBlock?.block?.items?.[0]?.id, publishedProjectId);
  assert.ok(postPublishDm.some((event) => event.type === 'text-delta'));
  assert.ok(postPublishDm.some((event) => event.type === 'done'));

  const linkedEvidenceRows = await db.query<{
    id: string;
    project_id: string | null;
    source_type: string;
    extracted_text: string | null;
  }>(
    `SELECT id, project_id, source_type, extracted_text
     FROM evidence_sources
     WHERE candidate_id = $1
     ORDER BY source_type`,
    [publishedScan.candidateId],
  );
  assert.equal(linkedEvidenceRows.rows.length, 2);
  assert.ok(
    linkedEvidenceRows.rows.every((row) => row.project_id === publishedProjectId),
    'publish handoff must link scanned evidence to the published project',
  );
  const scannedReadmeEvidence = linkedEvidenceRows.rows.find((row) => row.source_type === 'readme');
  assert.ok(scannedReadmeEvidence, 'expected scanned readme evidence');
  const scannedReadmeEvidenceId = scannedReadmeEvidence.id;
  const scannedReadmeText = String(scannedReadmeEvidence.extracted_text);

  const listed = await listRagSources(db);
  const listedSources = listed.sources as Array<{ evidenceSourceId?: string; project_id?: string }>;
  const listedEntry = listedSources.find((source) => source.evidenceSourceId === scannedReadmeEvidenceId);
  assert.ok(listedEntry, 'expected scanned readme evidence in admin RAG list');
  assert.equal(listedEntry.project_id, publishedProjectId);

  const eligible = await markRagSourceEligibleViaAdmin(db, publishedProjectId, scannedReadmeEvidenceId);
  const publishedRagSourceId = String(eligible.ragSourceId);
  await ingestRagSourceViaAdmin(db, publishedRagSourceId, createFakeRagClient());

  await db.query(
    `INSERT INTO evidence_sources (id, project_id, source_type, source_ref, privacy_state, extracted_text, claim_map)
     VALUES ('ev_publish_proof_unpublished', $1, 'readme', 'test:publish-proof:unpublished', 'safe_public', $2, '{}'::jsonb)`,
    [unpublishedProjectId, 'Unpublished source text that must never become a public citation.'],
  );
  await db.query(
    `INSERT INTO rag_sources (
       id, project_id, evidence_source_id, eligibility_state, openai_file_id, vector_store_id, last_synced_at
     ) VALUES (
       'rag_publish_proof_unpublished', $1, 'ev_publish_proof_unpublished', 'indexed', 'file_unpublished', 'vs_publish_proof', $2
     )`,
    [unpublishedProjectId, NOW.toISOString()],
  );

  const ragConfig = await createPublicRagSearchConfig(db, { maxNumResults: 4, scoreThreshold: 0.2, minTextChars: 16 });
  assert.ok(ragConfig, 'expected searchable RAG config for published source');
  assert.deepEqual(ragConfig.sources.map((source) => source.id), [publishedRagSourceId]);

  const approvedFileId = ragConfig.sources[0]?.openai_file_id;
  assert.ok(approvedFileId, 'expected approved file id');
  const citations = publicRagCitationsFromFileSearchResult(
    {
      results: [
        {
          fileId: approvedFileId,
          filename: 'approved-source.md',
          score: 0.91,
          text: scannedReadmeText,
          attributes: {
            visibility: 'public',
            project_id: publishedProjectId,
            rag_source_id: publishedRagSourceId,
          },
        },
        {
          fileId: 'file_unpublished',
          filename: 'unpublished-source.md',
          score: 0.99,
          text: 'Unpublished source text that must never become a public citation.',
          attributes: {
            visibility: 'public',
            project_id: unpublishedProjectId,
            rag_source_id: 'rag_publish_proof_unpublished',
          },
        },
      ],
    },
    ragConfig,
  );

  assert.deepEqual(citations.map((citation) => citation.ragSourceId), [publishedRagSourceId]);
  assert.deepEqual(publicRagProjectIds(citations), [publishedProjectId]);
});
