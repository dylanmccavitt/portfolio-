import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations, type Queryable } from '../scripts/db';
import { approveAdminDraftForPublish, publishAdminDraft } from '@/lib/admin/publish';
import {
  PORTFOLIO_CANDIDATE_TOPIC,
  scanGithubRepositoryCandidate,
  type GithubDiscoveryQueryable,
  type GithubRepositorySnapshot,
} from '@/lib/db/github-discovery';

function createTestDb(): Queryable {
  return new PGlite() as Queryable;
}

async function createMigratedDb(): Promise<Queryable> {
  const db = createTestDb();
  await applyMigrations(db);
  return db;
}

const PUBLIC_REPO: GithubRepositorySnapshot = {
  repositoryId: '10001',
  owner: 'DylanMcCavitt',
  name: 'portfolio-candidate-app',
  htmlUrl: 'https://github.com/DylanMcCavitt/portfolio-candidate-app',
  description: 'A small workflow app worth reviewing for the portfolio.',
  homepageUrl: 'https://example.com/candidate',
  language: 'TypeScript',
  topics: [PORTFOLIO_CANDIDATE_TOPIC, 'astro'],
  isPrivate: false,
  defaultBranch: 'main',
  sourceRevision: '1111111111111111111111111111111111111111',
  pushedAt: '2026-06-01T00:00:00.000Z',
  stars: 1,
  readmeMarkdown: '# Candidate app\n\nShips a real workflow.',
  portfolioManifest: { status: 'missing' },
};

test('allowlisted GitHub repo creates scan run candidate evidence and audit records', async () => {
  const db = await createMigratedDb();

  const result = await scanGithubRepositoryCandidate(db, {
    actor: 'age-729-test',
    trigger: 'test',
    repo: PUBLIC_REPO,
  });

  assert.equal(result.status, 'qualified');
  assert.ok(result.confidence > 0.7);
  assert.equal(result.audit.allowlisted, true);
  assert.equal(result.audit.mutatesRepository, false);

  const scanRuns = await db.query<{ lifecycle_state: string; result_counts: Record<string, unknown> }>(
    `SELECT lifecycle_state, result_counts FROM scan_runs WHERE id = $1`,
    [result.scanRunId],
  );
  assert.deepEqual(scanRuns.rows, [
    {
      lifecycle_state: 'completed',
      result_counts: {
        scanned: 1,
        candidates: 1,
        drafts: 1,
        evidence: 2,
        rejected: 0,
        privateEvidence: 0,
        audit: result.audit,
      },
    },
  ]);

  const candidates = await db.query<{
    id: string;
    source_kind: string;
    source_ref: string;
    repo_visibility: string;
    lifecycle_state: string;
    confidence: string | number;
    evidence_packet: { audit: Record<string, unknown>; evidencePolicy?: string };
  }>(`SELECT * FROM project_candidates WHERE scan_run_id = $1`, [result.scanRunId]);
  assert.equal(candidates.rows.length, 1);
  assert.equal(candidates.rows[0]?.id, result.candidateId);
  assert.equal(candidates.rows[0]?.source_kind, 'github_repo');
  assert.equal(candidates.rows[0]?.source_ref, PUBLIC_REPO.htmlUrl);
  assert.equal(candidates.rows[0]?.repo_visibility, 'public');
  assert.equal(candidates.rows[0]?.lifecycle_state, 'draft_requested');
  assert.equal(Number(candidates.rows[0]?.confidence), result.confidence);
  assert.equal(candidates.rows[0]?.evidence_packet.audit.allowlisted, true);

  const evidence = await db.query<{
    source_type: string;
    source_url: string | null;
    source_ref: string;
    repo_visibility: string;
    extracted_text_sha256: string | null;
    privacy_state: string;
    claim_map: Record<string, unknown>;
  }>(`SELECT * FROM evidence_sources WHERE candidate_id = $1 ORDER BY source_type`, [result.candidateId]);
  assert.equal(evidence.rows.length, 2);
  assert.deepEqual(
    evidence.rows.map((row) => row.source_type),
    ['readme', 'repo'],
  );
  for (const row of evidence.rows) {
    assert.equal(row.repo_visibility, 'public');
    assert.equal(row.privacy_state, 'safe_public');
    assert.ok(row.source_url?.startsWith(PUBLIC_REPO.htmlUrl));
    assert.equal(row.extracted_text_sha256?.length, 64);
    assert.equal(row.claim_map.publicSourceEligible, true);
  }

  const reviewEvents = await db.query<{ action: string; after_state: string; metadata: Record<string, unknown> }>(
    `SELECT action, after_state, metadata FROM review_events WHERE candidate_id = $1`,
    [result.candidateId],
  );
  assert.equal(reviewEvents.rows.length, 1);
  assert.equal(reviewEvents.rows[0]?.action, 'draft_requested');
  assert.equal(reviewEvents.rows[0]?.after_state, 'hidden');
  assert.equal(reviewEvents.rows[0]?.metadata.sourceRevision, PUBLIC_REPO.sourceRevision);

  const ragSources = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM rag_sources`);
  assert.equal(ragSources.rows[0]?.count, '0');
});

test('scan failure rethrows the original error when scan_runs bookkeeping also fails', async () => {
  const originalError = new Error('relation "scan_runs" does not exist');
  const bookkeepingError = new Error('bookkeeping update failed');
  let queryCount = 0;
  const db: GithubDiscoveryQueryable = {
    async query() {
      queryCount += 1;
      if (queryCount === 1) return { rows: [] };
      if (queryCount === 2) throw originalError;
      throw bookkeepingError;
    },
  };

  await assert.rejects(
    () =>
      scanGithubRepositoryCandidate(db, {
        actor: 'test',
        trigger: 'test',
        repo: {
          repositoryId: '10001',
          owner: 'DylanMcCavitt',
          name: 'portfolio-candidate-app',
          htmlUrl: 'https://github.com/DylanMcCavitt/portfolio-candidate-app',
          topics: [PORTFOLIO_CANDIDATE_TOPIC],
          isPrivate: false,
          defaultBranch: 'main',
          sourceRevision: '1111111111111111111111111111111111111111',
          portfolioManifest: { status: 'missing' },
        },
      }),
    (error) => {
      assert.equal((error as Error).message, 'relation "scan_runs" does not exist');
      return true;
    },
  );
  assert.equal(queryCount, 3);
});

test('non-allowlisted GitHub repos are rejected with audit reason and no candidate records', async () => {
  const db = await createMigratedDb();

  const result = await scanGithubRepositoryCandidate(db, {
    actor: 'age-729-test',
    trigger: 'test',
    repo: {
      ...PUBLIC_REPO,
      name: 'ordinary-repo',
      htmlUrl: 'https://github.com/DylanMcCavitt/ordinary-repo',
      topics: ['astro'],
    },
  });

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, `missing required GitHub topic: ${PORTFOLIO_CANDIDATE_TOPIC}`);
  assert.equal(result.audit.allowlisted, false);
  assert.equal(result.audit.rejectedReason, result.reason);

  const scanRuns = await db.query<{ lifecycle_state: string; result_counts: Record<string, unknown> }>(
    `SELECT lifecycle_state, result_counts FROM scan_runs WHERE id = $1`,
    [result.scanRunId],
  );
  assert.equal(scanRuns.rows[0]?.lifecycle_state, 'completed');
  assert.deepEqual(scanRuns.rows[0]?.result_counts, {
    scanned: 1,
    candidates: 0,
    drafts: 0,
    evidence: 0,
    rejected: 1,
    reason: result.reason,
    audit: result.audit,
  });

  const candidates = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM project_candidates`);
  assert.equal(candidates.rows[0]?.count, '0');

  const evidence = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM evidence_sources`);
  assert.equal(evidence.rows[0]?.count, '0');
});

test('private repo evidence is non-public draft-only evidence', async () => {
  const db = await createMigratedDb();

  const result = await scanGithubRepositoryCandidate(db, {
    actor: 'age-729-test',
    trigger: 'test',
    repo: {
      ...PUBLIC_REPO,
      name: 'private-candidate-app',
      htmlUrl: 'https://github.com/DylanMcCavitt/private-candidate-app',
      isPrivate: true,
    },
  });

  assert.equal(result.status, 'qualified');

  const candidates = await db.query<{ repo_visibility: string; evidence_packet: Record<string, unknown> }>(
    `SELECT repo_visibility, evidence_packet FROM project_candidates WHERE id = $1`,
    [result.candidateId],
  );
  assert.equal(candidates.rows[0]?.repo_visibility, 'private');
  assert.equal(
    candidates.rows[0]?.evidence_packet.evidencePolicy,
    'private evidence may support draft review only and is not a public source',
  );

  const evidence = await db.query<{
    source_url: string | null;
    repo_visibility: string;
    privacy_state: string;
    claim_map: Record<string, unknown>;
  }>(`SELECT source_url, repo_visibility, privacy_state, claim_map FROM evidence_sources WHERE candidate_id = $1`, [
    result.candidateId,
  ]);
  assert.equal(evidence.rows.length, 2);
  for (const row of evidence.rows) {
    assert.equal(row.source_url, null);
    assert.equal(row.repo_visibility, 'private');
    assert.equal(row.privacy_state, 'private_allowed_for_draft');
    assert.equal(row.claim_map.publicSourceEligible, false);
  }

  const ragSources = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM rag_sources`);
  assert.equal(ragSources.rows[0]?.count, '0');
});

test('scanner treats repository snapshots as read-only input', async () => {
  const db = await createMigratedDb();
  const repo: GithubRepositorySnapshot = {
    ...PUBLIC_REPO,
    topics: [...PUBLIC_REPO.topics],
  };
  const before = structuredClone(repo);

  await scanGithubRepositoryCandidate(db, {
    actor: 'age-729-test',
    trigger: 'test',
    repo,
  });

  assert.deepEqual(repo, before);
});

test('same repository revision is idempotent across concurrent scans and rename-stable identity', async () => {
  const db = await createMigratedDb();
  const [manual, slack] = await Promise.all([
    scanGithubRepositoryCandidate(db, { actor: 'manual:test', trigger: 'test', repo: PUBLIC_REPO }),
    scanGithubRepositoryCandidate(db, { actor: 'slack:test', trigger: 'slack', repo: PUBLIC_REPO }),
  ]);
  assert.equal(manual.status, 'qualified');
  assert.equal(slack.status, 'qualified');
  assert.equal(manual.candidateId, slack.candidateId);
  assert.equal(manual.draftId, slack.draftId);

  const renamed = await scanGithubRepositoryCandidate(db, {
    actor: 'manual:rename',
    trigger: 'test',
    repo: {
      ...PUBLIC_REPO,
      owner: 'RenamedOwner',
      name: 'renamed-project',
      fullName: 'RenamedOwner/renamed-project',
      htmlUrl: 'https://github.com/RenamedOwner/renamed-project',
    },
  });
  assert.equal(renamed.status, 'qualified');
  assert.equal(renamed.candidateId, manual.candidateId);
  assert.equal(renamed.draftId, manual.draftId);

  const counts = await db.query<{ candidates: string; drafts: string; sources: string; evidence: string }>(
    `SELECT
       (SELECT count(*)::text FROM project_candidates) AS candidates,
       (SELECT count(*)::text FROM project_drafts) AS drafts,
       (SELECT count(*)::text FROM project_sources) AS sources,
       (SELECT count(*)::text FROM evidence_sources) AS evidence`,
  );
  assert.deepEqual(counts.rows, [{ candidates: '1', drafts: '1', sources: '1', evidence: '4' }]);
  const source = await db.query<{ canonical_full_name: string; project_id: string | null }>(
    `SELECT canonical_full_name, project_id FROM project_sources WHERE repository_id = $1`,
    [PUBLIC_REPO.repositoryId],
  );
  assert.deepEqual(source.rows, [{ canonical_full_name: 'RenamedOwner/renamed-project', project_id: null }]);
  const restaged = await db.query<{
    lifecycle_state: string;
    proposed_fields: Record<string, unknown>;
    provenance_map: Record<string, unknown>;
  }>(
    `SELECT lifecycle_state, proposed_fields, provenance_map FROM project_drafts WHERE id = $1`,
    [renamed.draftId],
  );
  assert.equal(restaged.rows[0]?.lifecycle_state, 'needs_review');
  assert.deepEqual(restaged.rows[0]?.proposed_fields.links, [
    { label: 'GitHub', href: 'https://github.com/RenamedOwner/renamed-project' },
  ]);
  assert.equal(restaged.rows[0]?.provenance_map.canonicalFullName, 'RenamedOwner/renamed-project');
  const evidenceLinks = await db.query<{ draft_id: string | null; count: string }>(
    `SELECT draft_id, count(*)::text AS count FROM evidence_sources GROUP BY draft_id ORDER BY draft_id NULLS FIRST`,
  );
  assert.deepEqual(evidenceLinks.rows, [
    { draft_id: null, count: '2' },
    { draft_id: renamed.draftId, count: '2' },
  ]);
});

test('a new source revision supersedes the prior active draft and leaves exactly one active draft', async () => {
  const db = await createMigratedDb();
  const first = await scanGithubRepositoryCandidate(db, { actor: 'test:first', trigger: 'test', repo: PUBLIC_REPO });
  const second = await scanGithubRepositoryCandidate(db, {
    actor: 'test:second',
    trigger: 'test',
    repo: {
      ...PUBLIC_REPO,
      sourceRevision: '2222222222222222222222222222222222222222',
      description: 'A new source revision proposal.',
    },
  });
  assert.equal(first.status, 'qualified');
  assert.equal(second.status, 'qualified');
  assert.notEqual(first.draftId, second.draftId);

  const drafts = await db.query<{ source_revision: string; lifecycle_state: string }>(
    `SELECT source_revision, lifecycle_state FROM project_drafts ORDER BY source_revision`,
  );
  assert.deepEqual(drafts.rows, [
    { source_revision: PUBLIC_REPO.sourceRevision, lifecycle_state: 'superseded' },
    { source_revision: '2222222222222222222222222222222222222222', lifecycle_state: 'hidden' },
  ]);
});

test('terminal revision replays are no-ops and cannot supersede the newer active revision', async () => {
  const db = await createMigratedDb();
  const first = await scanGithubRepositoryCandidate(db, { actor: 'test:first', trigger: 'test', repo: PUBLIC_REPO });
  assert.equal(first.status, 'qualified');
  const nextRepo = {
    ...PUBLIC_REPO,
    sourceRevision: '2222222222222222222222222222222222222222',
    description: 'Newer active revision.',
  };
  const second = await scanGithubRepositoryCandidate(db, { actor: 'test:second', trigger: 'test', repo: nextRepo });
  assert.equal(second.status, 'qualified');
  const supersededBeforeReplay = await db.query<Record<string, unknown>>(
    `SELECT * FROM project_drafts WHERE id = $1`,
    [first.draftId],
  );

  const replay = await scanGithubRepositoryCandidate(db, {
    actor: 'test:old-replay',
    trigger: 'test',
    repo: { ...PUBLIC_REPO, fullName: 'RenamedOwner/old-revision', owner: 'RenamedOwner', name: 'old-revision' },
  });
  assert.equal(replay.status, 'rejected');
  assert.equal(replay.code, 'revision_already_processed');
  assert.deepEqual(
    (await db.query<Record<string, unknown>>(`SELECT * FROM project_drafts WHERE id = $1`, [first.draftId])).rows,
    supersededBeforeReplay.rows,
  );

  const drafts = await db.query<{ source_revision: string; lifecycle_state: string }>(
    `SELECT source_revision, lifecycle_state FROM project_drafts ORDER BY source_revision`,
  );
  assert.deepEqual(drafts.rows, [
    { source_revision: PUBLIC_REPO.sourceRevision, lifecycle_state: 'superseded' },
    { source_revision: nextRepo.sourceRevision, lifecycle_state: 'hidden' },
  ]);
  const counts = await db.query<{ evidence: string; events: string }>(
    `SELECT (SELECT count(*)::text FROM evidence_sources) AS evidence,
            (SELECT count(*)::text FROM review_events WHERE action = 'draft_requested') AS events`,
  );
  assert.deepEqual(counts.rows, [{ evidence: '4', events: '2' }]);

  await db.query(`UPDATE project_drafts SET lifecycle_state = 'published' WHERE id = $1`, [second.draftId]);
  const publishedBeforeReplay = await db.query<Record<string, unknown>>(
    `SELECT * FROM project_drafts WHERE id = $1`,
    [second.draftId],
  );
  const publishedReplay = await scanGithubRepositoryCandidate(db, {
    actor: 'test:published-replay',
    trigger: 'test',
    repo: nextRepo,
  });
  assert.equal(publishedReplay.status, 'rejected');
  assert.equal(publishedReplay.code, 'revision_already_processed');
  assert.deepEqual(
    (await db.query<Record<string, unknown>>(`SELECT * FROM project_drafts WHERE id = $1`, [second.draftId])).rows,
    publishedBeforeReplay.rows,
  );
  assert.deepEqual(
    (await db.query<{ evidence: string; events: string }>(
      `SELECT (SELECT count(*)::text FROM evidence_sources) AS evidence,
              (SELECT count(*)::text FROM review_events WHERE action = 'draft_requested') AS events`,
    )).rows,
    [{ evidence: '4', events: '2' }],
  );
});

test('a lost concurrent different-revision insert rejects without cross-linking evidence', async () => {
  const db = await createMigratedDb();
  const active = await scanGithubRepositoryCandidate(db, { actor: 'test:active', trigger: 'test', repo: PUBLIC_REPO });
  assert.equal(active.status, 'qualified');
  let injectedConflict = false;
  const racingDb: GithubDiscoveryQueryable = {
    async query<Row = unknown>(sql: string, params?: unknown[]) {
      if (!injectedConflict && sql.includes('WITH existing_revision AS')) {
        injectedConflict = true;
        throw { code: '23505', constraint: 'project_drafts_active_source_uidx' };
      }
      return db.query<Row>(sql, params);
    },
  };
  const losingRevision = '9999999999999999999999999999999999999999';
  const result = await scanGithubRepositoryCandidate(racingDb, {
    actor: 'test:losing-concurrent-revision',
    trigger: 'test',
    repo: { ...PUBLIC_REPO, sourceRevision: losingRevision, description: 'Losing concurrent revision.' },
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.code, 'active_revision_conflict');

  const losingCandidate = await db.query<{ id: string }>(
    `SELECT id FROM project_candidates WHERE source_revision = $1`,
    [losingRevision],
  );
  assert.equal(losingCandidate.rows.length, 1);
  assert.equal(
    (await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM evidence_sources WHERE candidate_id = $1`,
      [losingCandidate.rows[0]?.id],
    )).rows[0]?.count,
    '0',
  );
  assert.deepEqual(
    (await db.query<{ source_revision: string; lifecycle_state: string }>(
      `SELECT source_revision, lifecycle_state FROM project_drafts`,
    )).rows,
    [{ source_revision: PUBLIC_REPO.sourceRevision, lifecycle_state: 'hidden' }],
  );
});

test('portfolio.json v1 supplies the canonical proposal and invalid present manifests fail closed', async () => {
  const canonicalProject = {
    slug: 'manifest-project',
    title: 'Manifest Project',
    tagline: 'A canonical manifest proposal.',
    area: 'Apps',
    year: 2026,
    summary: 'A complete canonical project supplied by portfolio.json.',
    activity: 'Active',
    details: [{ label: 'Stage', value: 'Review' }],
    metrics: [{ value: '1', label: 'source revision' }],
    links: [{ label: 'Repo', href: PUBLIC_REPO.htmlUrl }],
    media: [],
  };
  const db = await createMigratedDb();
  const valid = await scanGithubRepositoryCandidate(db, {
    actor: 'test:manifest',
    trigger: 'test',
    repo: {
      ...PUBLIC_REPO,
      portfolioManifest: { status: 'present', raw: JSON.stringify({ schemaVersion: 1, project: canonicalProject }) },
    },
  });
  assert.equal(valid.status, 'qualified');
  assert.equal(valid.proposalSource, 'manifest');
  const draft = await db.query<{ proposed_fields: Record<string, unknown> }>(
    `SELECT proposed_fields FROM project_drafts WHERE id = $1`,
    [valid.draftId],
  );
  assert.deepEqual(draft.rows[0]?.proposed_fields, canonicalProject);

  const invalidCases = [
    { revision: '3333333333333333333333333333333333333333', raw: '{bad json' },
    { revision: '4444444444444444444444444444444444444444', raw: JSON.stringify({ schemaVersion: 2, project: canonicalProject }) },
    { revision: '5555555555555555555555555555555555555555', raw: JSON.stringify({ schemaVersion: 1, project: { ...canonicalProject, area: 'TypeScript' } }) },
    { revision: '6666666666666666666666666666666666666666', raw: ' '.repeat(64 * 1024 + 1) },
  ];
  for (const item of invalidCases) {
    const result = await scanGithubRepositoryCandidate(db, {
      actor: 'test:invalid-manifest',
      trigger: 'test',
      repo: { ...PUBLIC_REPO, repositoryId: item.revision.slice(0, 8).replace(/^0+/, '') || '1', sourceRevision: item.revision, portfolioManifest: { status: 'present', raw: item.raw } },
    });
    assert.equal(result.status, 'rejected');
    assert.equal(result.code, 'invalid_manifest');
    const run = await db.query<{ lifecycle_state: string; error_message: string }>(
      `SELECT lifecycle_state, error_message FROM scan_runs WHERE id = $1`,
      [result.scanRunId],
    );
    assert.deepEqual(run.rows, [{ lifecycle_state: 'failed', error_message: 'invalid_manifest' }]);
  }
});

test('missing manifest evidence proposal never derives area from GitHub language or topics', async () => {
  const db = await createMigratedDb();
  const result = await scanGithubRepositoryCandidate(db, {
    actor: 'test:no-area-derivation',
    trigger: 'test',
    repo: { ...PUBLIC_REPO, language: 'TypeScript', topics: [PORTFOLIO_CANDIDATE_TOPIC, 'rust'] },
  });
  assert.equal(result.status, 'qualified');
  const row = await db.query<{ proposed_fields: Record<string, unknown> }>(
    `SELECT proposed_fields FROM project_drafts WHERE id = $1`,
    [result.draftId],
  );
  assert.equal(Object.hasOwn(row.rows[0]?.proposed_fields ?? {}, 'area'), false);
  assert.ok(!JSON.stringify(row.rows[0]?.proposed_fields).includes('TypeScript'));
});

test('private evidence remains draft-only and is excluded from public provenance ids', async () => {
  const db = await createMigratedDb();
  const result = await scanGithubRepositoryCandidate(db, {
    actor: 'test:private-provenance',
    trigger: 'test',
    repo: { ...PUBLIC_REPO, isPrivate: true },
  });
  assert.equal(result.status, 'qualified');
  const row = await db.query<{ provenance_map: { publicEvidenceIds: string[]; privateEvidenceIds: string[] } }>(
    `SELECT provenance_map FROM project_drafts WHERE id = $1`,
    [result.draftId],
  );
  assert.deepEqual(row.rows[0]?.provenance_map.publicEvidenceIds, []);
  assert.equal(row.rows[0]?.provenance_map.privateEvidenceIds.length, 2);
});

test('same-HEAD visibility or content changes fully restage the active draft and isolate prior evidence', async () => {
  const db = await createMigratedDb();
  const initial = await scanGithubRepositoryCandidate(db, {
    actor: 'test:private-first',
    trigger: 'test',
    repo: {
      ...PUBLIC_REPO,
      isPrivate: true,
      description: 'Private-only proposal text.',
      readmeMarkdown: '# Private-only evidence',
    },
  });
  assert.equal(initial.status, 'qualified');
  await db.query(
    `UPDATE project_drafts
     SET lifecycle_state = 'approved_for_publish',
         reviewed_field_diff = '[{"field":"title","before":null,"after":"Private title"}]'::jsonb
     WHERE id = $1`,
    [initial.draftId],
  );

  const refreshed = await scanGithubRepositoryCandidate(db, {
    actor: 'test:public-restage',
    trigger: 'test',
    repo: {
      ...PUBLIC_REPO,
      isPrivate: false,
      description: 'Public proposal text.',
      readmeMarkdown: '# Public evidence',
    },
  });
  assert.equal(refreshed.status, 'qualified');
  assert.equal(refreshed.draftId, initial.draftId);

  const draft = await db.query<{
    lifecycle_state: string;
    reviewed_field_diff: unknown[];
    proposed_fields: Record<string, unknown>;
    provenance_map: { publicEvidenceIds: string[]; privateEvidenceIds: string[] };
  }>(
    `SELECT lifecycle_state, reviewed_field_diff, proposed_fields, provenance_map
     FROM project_drafts WHERE id = $1`,
    [initial.draftId],
  );
  assert.equal(draft.rows[0]?.lifecycle_state, 'needs_review');
  assert.deepEqual(draft.rows[0]?.reviewed_field_diff, []);
  assert.equal(draft.rows[0]?.proposed_fields.summary, 'Public proposal text.');
  assert.equal(draft.rows[0]?.provenance_map.publicEvidenceIds.length, 2);
  assert.deepEqual(draft.rows[0]?.provenance_map.privateEvidenceIds, []);

  const evidence = await db.query<{ privacy_state: string; draft_id: string | null; extracted_text: string | null }>(
    `SELECT privacy_state, draft_id, extracted_text FROM evidence_sources ORDER BY privacy_state, extracted_text`,
  );
  assert.equal(evidence.rows.length, 4);
  const prior = evidence.rows.filter((row) => row.privacy_state === 'private_allowed_for_draft');
  const current = evidence.rows.filter((row) => row.privacy_state === 'safe_public');
  assert.equal(prior.length, 2);
  assert.equal(current.length, 2);
  assert.ok(prior.every((row) => row.draft_id === null));
  assert.ok(current.every((row) => row.draft_id === initial.draftId));
  assert.ok(current.some((row) => row.extracted_text === 'Public proposal text.'));
  assert.ok(current.some((row) => row.extracted_text === '# Public evidence'));
});

test('public-to-private same-HEAD restage cannot publish using stale public evidence', async () => {
  const db = await createMigratedDb();
  const publicProject = {
    slug: 'visibility-restage',
    title: 'Visibility Restage',
    tagline: 'Public proposal.',
    area: 'Apps',
    year: 2026,
    summary: 'Public source text.',
    activity: '',
    details: [],
    metrics: [],
    links: [{ label: 'Repo', href: PUBLIC_REPO.htmlUrl }],
    media: [],
  };
  const first = await scanGithubRepositoryCandidate(db, {
    actor: 'test:public-first',
    trigger: 'test',
    repo: {
      ...PUBLIC_REPO,
      portfolioManifest: { status: 'present', raw: JSON.stringify({ schemaVersion: 1, project: publicProject }) },
    },
  });
  assert.equal(first.status, 'qualified');

  const privateProject = {
    ...publicProject,
    tagline: 'Private proposal.',
    summary: 'Private source text must not publish.',
    links: [],
  };
  const second = await scanGithubRepositoryCandidate(db, {
    actor: 'test:private-restage',
    trigger: 'test',
    repo: {
      ...PUBLIC_REPO,
      isPrivate: true,
      portfolioManifest: { status: 'present', raw: JSON.stringify({ schemaVersion: 1, project: privateProject }) },
    },
  });
  assert.equal(second.status, 'qualified');
  assert.equal(second.draftId, first.draftId);
  const approval = await approveAdminDraftForPublish(db, second.draftId, 'github:dylan');
  assert.equal(approval.ok, true);
  const publish = await publishAdminDraft(db, second.draftId, 'github:dylan', {
    confirmProvenance: true,
    confirmPrivacy: true,
  });
  assert.equal(publish.ok, false);
  assert.equal(publish.status, 422);
  assert.equal(publish.code, 'public_provenance_missing');
  assert.equal(
    (await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM projects WHERE lifecycle_state = 'published'`)).rows[0]?.count,
    '0',
  );
  const stalePublic = await db.query<{ project_id: string | null; draft_id: string | null }>(
    `SELECT project_id, draft_id FROM evidence_sources WHERE privacy_state = 'safe_public'`,
  );
  assert.ok(stalePublic.rows.length > 0);
  assert.ok(stalePublic.rows.every((row) => row.project_id === null && row.draft_id === null));
});
