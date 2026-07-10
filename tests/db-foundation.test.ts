import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { afterEach } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations, applySeeds, resetDatabase, splitSqlStatements, type Queryable } from '../scripts/db';
import { CATALOG, PLAYLIST_SLUGS } from '@/data/catalog';
import {
  buildCatalogShadowRecords,
  fetchCatalogShadowRecords,
  generateCatalogParityReport,
  importCatalogShadowRecords,
  type CatalogShadowRecord,
} from '@/lib/db/catalog-shadow';
import {
  fetchInternalShadowProjectReadModels,
  fetchPublicProjectCards,
  fetchPublicProjectDetail,
  fetchPublicProjectDetails,
  projectRecordToReadModels,
  tryFetchInternalShadowProjectReadModels,
  type ProjectReadQueryable,
} from '@/lib/db/project-reads';
import {
  filterPublicProjectDetails,
  loadPublicProjectDetails,
  PublicProjectDataError,
  resetPublicProjectDetailsLoadForTests,
  resolvePublicProjectSourceMode,
  shouldUsePublicProjectDb,
} from '@/lib/public-projects';
import {
  projectPublicMark,
  resolvePublicProjectByReference,
  resolveRequiredPublicProjectByReference,
} from '@/lib/public-project-route-resolver';
import {
  CANDIDATE_LIFECYCLE_STATES,
  DRAFT_LIFECYCLE_STATES,
  PUBLISH_OUTBOX_JOB_TYPES,
  PUBLISH_OUTBOX_STATES,
  PROJECT_LIFECYCLE_STATES,
  RAG_REMOTE_STEPS,
  RAG_SOURCE_ELIGIBILITY_STATES,
  SCAN_RUN_LIFECYCLE_STATES,
} from '@/lib/db/schema';
import { projectMeta } from '@/lib/seo';
import {
  PROJECT_AREAS,
  ProjectAreaSchema,
  ProjectDetailSchema,
  ProjectLinkSchema,
  ProjectMediaSchema,
  ProjectMetricSchema,
} from '@/lib/projects/schema';

afterEach(() => {
  resetPublicProjectDetailsLoadForTests();
});

const FOUNDATION_TABLES = [
  'projects',
  'project_sources',
  'project_candidates',
  'project_drafts',
  'evidence_sources',
  'scan_runs',
  'review_events',
  'rag_sources',
  'publish_outbox',
] as const;

test('canonical project schema has five areas and validates nested public fields', () => {
  assert.deepEqual(PROJECT_AREAS, [
    'Shipped & Client Work',
    'Apps',
    'AI & Developer Tools',
    'Side Projects & Experiments',
    'Coursework',
  ]);
  assert.equal(ProjectAreaSchema.safeParse('TypeScript').success, false);
  assert.equal(ProjectAreaSchema.safeParse('AI & Developer Tools').success, true);
  assert.deepEqual(PLAYLIST_SLUGS, {
    wip: 'wip',
    'Shipped & Client Work': 'shipped-client-work',
    Apps: 'apps',
    'AI & Developer Tools': 'ai-developer-tools',
    'Side Projects & Experiments': 'side-projects-experiments',
    Coursework: 'coursework',
  });

  assert.deepEqual(ProjectLinkSchema.parse({ label: 'Repo', href: 'http://example.test/repo' }), {
    label: 'Repo',
    href: 'http://example.test/repo',
  });
  assert.equal(ProjectLinkSchema.safeParse({ label: 'Bad', href: 'javascript:alert(1)' }).success, false);
  assert.equal(ProjectLinkSchema.safeParse({ label: 'Bad', href: 'data:text/plain,bad' }).success, false);
  assert.deepEqual(ProjectMetricSchema.parse({ value: ' 64 KiB ', label: ' manifest ceiling ' }), {
    value: '64 KiB',
    label: 'manifest ceiling',
  });
  assert.equal(ProjectDetailSchema.safeParse('A reviewed public paragraph.').success, true);
  assert.equal(ProjectDetailSchema.safeParse({ label: 'Source', value: 'Published DB record' }).success, true);

  assert.equal(
    ProjectMediaSchema.safeParse({
      kind: 'image',
      src: '/screenshots/loom/overview.webp',
      caption: 'Loom overview',
    }).success,
    true,
  );
  assert.equal(
    ProjectMediaSchema.safeParse({
      kind: 'video',
      src: '/demos/loom-install.mp4',
      poster: '/demos/loom-install-poster.png',
      caption: 'Loom install demo',
    }).success,
    true,
  );

  for (const src of [
    '/screenshots/../private.txt',
    '/screenshots/%2e%2e/private.txt',
    '/screenshots/%5c..%5cprivate.txt',
    '/screenshots/%252e%252e%252fprivate.txt',
    '/assets/not-approved.png',
    '/demos/image-not-approved.png',
    'javascript:alert(1)',
    'data:image/png;base64,bad',
  ]) {
    assert.equal(
      ProjectMediaSchema.safeParse({ kind: 'image', src, caption: 'Rejected image' }).success,
      false,
      `expected image source ${src} to be rejected`,
    );
  }
  assert.equal(
    ProjectMediaSchema.safeParse({ kind: 'video', src: '/assets/not-approved.mp4', caption: 'Rejected video' }).success,
    false,
  );
});

function createTestDb(): Queryable {
  return new PGlite() as Queryable;
}

interface ProjectAreaPreflightRow {
  source: string;
  project_ref: string;
  current_area: string;
  prospective_area: string;
}

async function runProjectAreaPreflight(db: Queryable): Promise<ProjectAreaPreflightRow[]> {
  const sql = await readFile(
    fileURLToPath(new URL('../db/preflight/0003_recruiter_project_areas.sql', import.meta.url)),
    'utf8',
  );
  const statements = splitSqlStatements(sql);
  assert.equal(statements.length, 1);
  return (await db.query<ProjectAreaPreflightRow>(statements[0]!)).rows;
}

async function insertProjectRecord(db: Queryable, record: CatalogShadowRecord): Promise<void> {
  await db.query(
    `INSERT INTO projects (
       id, slug, title, tagline, area, year, lifecycle_state, activity, summary,
       details, metrics, links, media, source, published_at, archived_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9,
       $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14, $15, $16
     )`,
    [
      record.id,
      record.slug,
      record.title,
      record.tagline,
      record.area,
      record.year,
      record.lifecycle_state,
      record.activity,
      record.summary,
      JSON.stringify(record.details),
      JSON.stringify(record.metrics),
      JSON.stringify(record.links),
      JSON.stringify(record.media),
      record.source,
      record.published_at,
      record.archived_at,
    ],
  );
}

test('migrations create the DM project foundation tables', async () => {
  const db = createTestDb();
  const applied = await applyMigrations(db);

  assert.deepEqual(applied, [
    '0001_dm_project_foundation.sql',
    '0002_review_events_seq.sql',
    '0003_recruiter_project_areas.sql',
    '0004_source_identity_and_refresh_drafts.sql',
    '0005_publish_outbox.sql',
  ]);

  const tables = await db.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
     ORDER BY table_name`,
  );
  const tableNames = tables.rows.map((row) => row.table_name);

  for (const table of FOUNDATION_TABLES) {
    assert.ok(tableNames.includes(table), `expected ${table} table`);
  }
});

test('review_events seq migration upgrades an existing database deterministically', async () => {
  const db = createTestDb();

  // Upgrade path: apply 0001 alone (as preview/prod DBs did), insert rows,
  // then apply the remaining migrations through the real runner.
  const foundationMigration = '0001_dm_project_foundation.sql';
  const stageDir = await mkdtemp(join(tmpdir(), 'age839-mig-'));
  await copyFile(
    fileURLToPath(new URL(`../db/migrations/${foundationMigration}`, import.meta.url)),
    join(stageDir, foundationMigration),
  );
  assert.deepEqual(await applyMigrations(db, stageDir), [foundationMigration]);

  // project_candidates is the lightest parent satisfying the review_events CHECK.
  await db.query(
    `INSERT INTO project_candidates (id, source_kind, source_ref) VALUES ('cand_seq', 'manual', 'seq-upgrade-test')`,
  );
  await db.query(
    `INSERT INTO review_events (id, candidate_id, actor, action, created_at)
     VALUES ('review_seq_a', 'cand_seq', 'test', 'note', '2026-01-01T00:00:00Z'),
            ('review_seq_b', 'cand_seq', 'test', 'note', '2026-01-01T00:00:00Z')`,
  );

  assert.deepEqual(await applyMigrations(db), [
    '0002_review_events_seq.sql',
    '0003_recruiter_project_areas.sql',
    '0004_source_identity_and_refresh_drafts.sql',
    '0005_publish_outbox.sql',
  ]);

  const upgraded = await db.query<{ id: string; seq: string | number | null }>(
    `SELECT id, seq FROM review_events WHERE candidate_id = 'cand_seq'`,
  );
  assert.equal(upgraded.rows.length, 2);
  for (const row of upgraded.rows) {
    assert.notEqual(row.seq, null, `expected backfilled seq for ${row.id}`);
  }

  // New rows written in the same clock tick order deterministically by seq.
  await db.query(
    `INSERT INTO review_events (id, candidate_id, actor, action, created_at)
     VALUES ('review_seq_c', 'cand_seq', 'test', 'note', '2026-01-02T00:00:00Z')`,
  );
  await db.query(
    `INSERT INTO review_events (id, candidate_id, actor, action, created_at)
     VALUES ('review_seq_d', 'cand_seq', 'test', 'note', '2026-01-02T00:00:00Z')`,
  );
  const latest = await db.query<{ id: string }>(
    `SELECT id FROM review_events WHERE candidate_id = 'cand_seq' ORDER BY created_at DESC, seq DESC LIMIT 1`,
  );
  assert.equal(latest.rows[0]?.id, 'review_seq_d');
});

test('project area migration maps legacy, explicit, DB-only, Loom, and draft values idempotently', async () => {
  const db = createTestDb();
  const stageDir = await mkdtemp(join(tmpdir(), 'gh187-area-mig-'));
  for (const name of ['0001_dm_project_foundation.sql', '0002_review_events_seq.sql']) {
    await copyFile(fileURLToPath(new URL(`../db/migrations/${name}`, import.meta.url)), join(stageDir, name));
  }
  await applyMigrations(db, stageDir);

  await db.query(
    `INSERT INTO projects (id, slug, title, tagline, area, year, lifecycle_state)
     VALUES
       ('slurmlet', 'slurmlet', 'slurmlet', 'Scheduler', 'Infrastructure', 2026, 'draft_only'),
       ('db-only-research', 'db-only-research', 'DB only', 'DB-only row', 'Research', 2026, 'draft_only'),
       ('loom', 'loom', 'Loom', 'Loom row', 'TypeScript', 2026, 'draft_only'),
       ('unmapped-typescript', 'unmapped-typescript', 'Unmapped', 'Unmapped row', 'TypeScript', 2026, 'draft_only')`,
  );
  await db.query(
    `INSERT INTO project_drafts (id, proposed_fields)
     VALUES
       ('draft_slurmlet', '{"slug":"slurmlet","area":"Infrastructure"}'::jsonb),
       ('draft_db_only', '{"slug":"db-only-research","area":"Research"}'::jsonb),
       ('draft_loom', '{"slug":"loom","area":"TypeScript"}'::jsonb),
       ('draft_unmapped', '{"slug":"unmapped-rust","area":"Rust"}'::jsonb),
       ('draft_without_area', '{"slug":"unmapped-hidden"}'::jsonb)`,
  );

  const preflightByReference = new Map(
    (await runProjectAreaPreflight(db)).map((row) => [`${row.source}:${row.project_ref}`, row]),
  );
  assert.equal(preflightByReference.size, 2);
  assert.deepEqual(preflightByReference.get('projects:unmapped-typescript / unmapped-typescript'), {
    source: 'projects',
    project_ref: 'unmapped-typescript / unmapped-typescript',
    current_area: 'TypeScript',
    prospective_area: 'TypeScript',
  });
  assert.deepEqual(preflightByReference.get('project_drafts:draft_unmapped'), {
    source: 'project_drafts',
    project_ref: 'draft_unmapped',
    current_area: 'Rust',
    prospective_area: 'Rust',
  });
  for (const mappedReference of [
    'projects:slurmlet / slurmlet',
    'projects:db-only-research / db-only-research',
    'projects:loom / loom',
    'project_drafts:draft_slurmlet',
    'project_drafts:draft_db_only',
    'project_drafts:draft_loom',
  ]) {
    assert.equal(preflightByReference.has(mappedReference), false, `${mappedReference} should be mapped by migration 0003`);
  }

  await db.query(`DELETE FROM projects WHERE id = 'unmapped-typescript'`);
  await db.query(`DELETE FROM project_drafts WHERE id = 'draft_unmapped'`);

  assert.deepEqual(await applyMigrations(db), [
    '0003_recruiter_project_areas.sql',
    '0004_source_identity_and_refresh_drafts.sql',
    '0005_publish_outbox.sql',
  ]);

  const projects = await db.query<{ id: string; area: string }>(`SELECT id, area FROM projects ORDER BY id`);
  assert.deepEqual(projects.rows, [
    { id: 'db-only-research', area: 'Side Projects & Experiments' },
    { id: 'loom', area: 'AI & Developer Tools' },
    { id: 'slurmlet', area: 'AI & Developer Tools' },
  ]);
  const drafts = await db.query<{ id: string; area: string | null }>(
    `SELECT id, proposed_fields->>'area' AS area FROM project_drafts ORDER BY id`,
  );
  assert.deepEqual(drafts.rows, [
    { id: 'draft_db_only', area: 'Side Projects & Experiments' },
    { id: 'draft_loom', area: 'AI & Developer Tools' },
    { id: 'draft_slurmlet', area: 'AI & Developer Tools' },
    { id: 'draft_without_area', area: null },
  ]);

  assert.deepEqual(await runProjectAreaPreflight(db), []);

  await db.query(`DELETE FROM schema_migrations WHERE name = '0003_recruiter_project_areas.sql'`);
  assert.deepEqual(await applyMigrations(db), ['0003_recruiter_project_areas.sql']);
  assert.deepEqual((await db.query<{ id: string; area: string }>(`SELECT id, area FROM projects ORDER BY id`)).rows, projects.rows);
});

test('project area migration preflight rejects every noncanonical project and draft value', async () => {
  const db = createTestDb();
  const stageDir = await mkdtemp(join(tmpdir(), 'gh187-area-preflight-'));
  for (const name of ['0001_dm_project_foundation.sql', '0002_review_events_seq.sql']) {
    await copyFile(fileURLToPath(new URL(`../db/migrations/${name}`, import.meta.url)), join(stageDir, name));
  }
  await applyMigrations(db, stageDir);
  await db.query(
    `INSERT INTO projects (id, slug, title, tagline, area, year)
     VALUES ('unmapped-typescript', 'unmapped-typescript', 'Bad area', 'Bad area', 'TypeScript', 2026)`,
  );
  await db.query(
    `INSERT INTO project_drafts (id, proposed_fields)
     VALUES ('unmapped-rust-draft', '{"slug":"unmapped-rust-draft","area":"Rust"}'::jsonb)`,
  );

  await assert.rejects(() => applyMigrations(db), /projects_area_recruiter_facing_check/);
  await db.query(`UPDATE projects SET area = 'AI & Developer Tools' WHERE id = 'unmapped-typescript'`);
  await assert.rejects(() => applyMigrations(db), /project_drafts_area_recruiter_facing_check/);
  await db.query(
    `UPDATE project_drafts SET proposed_fields = proposed_fields - 'area' WHERE id = 'unmapped-rust-draft'`,
  );
  assert.deepEqual(await applyMigrations(db), [
    '0003_recruiter_project_areas.sql',
    '0004_source_identity_and_refresh_drafts.sql',
    '0005_publish_outbox.sql',
  ]);

  await assert.rejects(
    db.query(
      `INSERT INTO projects (id, slug, title, tagline, area, year)
       VALUES ('post-migration-typescript', 'post-migration-typescript', 'Bad', 'Bad', 'TypeScript', 2026)`,
    ),
    /projects_area_recruiter_facing_check/,
  );
  await assert.rejects(
    db.query(
      `INSERT INTO project_drafts (id, proposed_fields)
       VALUES ('post-migration-typescript-draft', '{"area":"TypeScript"}'::jsonb)`,
    ),
    /project_drafts_area_recruiter_facing_check/,
  );
  await assert.rejects(
    db.query(
      `INSERT INTO project_drafts (id, proposed_fields)
       VALUES ('post-migration-null-area-draft', '{"area":null}'::jsonb)`,
    ),
    /project_drafts_area_recruiter_facing_check/,
  );
});

test('planned lifecycle states are constrained in SQL and exported types', async () => {
  const db = createTestDb();
  await applyMigrations(db);

  assert.deepEqual(PROJECT_LIFECYCLE_STATES, ['shadow', 'draft_only', 'published', 'archived']);
  assert.deepEqual(SCAN_RUN_LIFECYCLE_STATES, ['queued', 'running', 'completed', 'failed']);
  assert.deepEqual(CANDIDATE_LIFECYCLE_STATES, ['detected', 'qualified', 'dismissed', 'draft_requested']);
  assert.deepEqual(DRAFT_LIFECYCLE_STATES, [
    'hidden',
    'needs_review',
    'changes_requested',
    'approved_for_publish',
    'published',
    'superseded',
  ]);
  assert.deepEqual(RAG_SOURCE_ELIGIBILITY_STATES, ['not_eligible', 'eligible', 'indexing', 'indexed', 'failed', 'revoked']);
  assert.deepEqual(RAG_REMOTE_STEPS, ['pending', 'uploaded', 'attached', 'indexed', 'detached', 'revoked']);
  assert.deepEqual(PUBLISH_OUTBOX_JOB_TYPES, ['rag_index', 'rag_revoke', 'site_refresh']);
  assert.deepEqual(PUBLISH_OUTBOX_STATES, ['queued', 'processing', 'succeeded', 'dead']);

  await db.query(`
    INSERT INTO projects (id, slug, title, tagline, area, year, lifecycle_state)
    VALUES ('state-test-project', 'state-test-project', 'State test', 'State test', 'AI & Developer Tools', 2026, 'draft_only')
  `);
  await db.query(`
    INSERT INTO scan_runs (id, trigger, actor, lifecycle_state)
    VALUES ('state-test-scan', 'test', 'db-foundation-test', 'queued')
  `);

  await assert.rejects(
    db.query(`
      INSERT INTO projects (id, slug, title, tagline, area, year, lifecycle_state)
      VALUES ('bad-project', 'bad-project', 'Bad', 'Bad', 'AI & Developer Tools', 2026, 'public')
    `),
  );

  await assert.rejects(
    db.query(`
      INSERT INTO scan_runs (id, trigger, actor, lifecycle_state)
      VALUES ('bad-scan', 'test', 'db-foundation-test', 'waiting')
    `),
  );

  await assert.rejects(
    db.query(`
      INSERT INTO project_candidates (id, scan_run_id, source_kind, source_ref, lifecycle_state)
      VALUES ('bad-candidate', 'state-test-scan', 'manual', 'manual:test', 'published')
    `),
  );

  await assert.rejects(
    db.query(`
      INSERT INTO project_drafts (id, lifecycle_state)
      VALUES ('bad-draft', 'public')
    `),
  );

  await assert.rejects(
    db.query(`
      INSERT INTO rag_sources (id, project_id, eligibility_state)
      VALUES ('bad-rag', 'state-test-project', 'published')
    `),
  );
});

test('evidence versions revoke stale RAG DB-first and enqueue immutable cleanup jobs', async () => {
  const db = createTestDb();
  await applyMigrations(db);
  await db.query(
    `INSERT INTO projects (
       id, slug, title, tagline, area, year, lifecycle_state, published_at, publication_version
     ) VALUES ('outbox-versioned', 'outbox-versioned', 'Versioned', 'Versioned',
               'AI & Developer Tools', 2026, 'published', now(), 1)`,
  );
  await db.query(
    `INSERT INTO evidence_sources (
       id, project_id, source_type, source_ref, privacy_state, extracted_text,
       extracted_text_sha256, claim_map
     ) VALUES ('ev-versioned', 'outbox-versioned', 'readme', 'test:versioned',
               'safe_public', 'Public evidence', repeat('a', 64), '{}'::jsonb)`,
  );
  await db.query(
    `INSERT INTO rag_sources (
       id, project_id, evidence_source_id, evidence_version, publication_version,
       eligibility_state, openai_file_id, vector_store_id, remote_step
     ) VALUES ('rag-version-one', 'outbox-versioned', 'ev-versioned', 1, 1,
               'indexed', 'file-version-one', 'vs-versioned', 'indexed')`,
  );
  await assert.rejects(
    db.query(
      `INSERT INTO rag_sources (
         id, project_id, evidence_source_id, evidence_version, publication_version, eligibility_state
       ) VALUES ('rag-version-one-duplicate', 'outbox-versioned', 'ev-versioned', 1, 1, 'eligible')`,
    ),
    /rag_sources_active_evidence_version_uidx/,
  );

  await db.query(`UPDATE evidence_sources SET claim_map = '{"reviewed":true}'::jsonb WHERE id = 'ev-versioned'`);
  const evidence = await db.query<{ evidence_version: string | number }>(
    `SELECT evidence_version FROM evidence_sources WHERE id = 'ev-versioned'`,
  );
  assert.equal(Number(evidence.rows[0]?.evidence_version), 2);
  const rag = await db.query<{ eligibility_state: string; openai_file_id: string }>(
    `SELECT eligibility_state, openai_file_id FROM rag_sources WHERE id = 'rag-version-one'`,
  );
  assert.deepEqual(rag.rows, [{ eligibility_state: 'revoked', openai_file_id: 'file-version-one' }]);
  const jobs = await db.query<{
    job_type: string;
    project_id: string;
    publication_version: string | number;
    evidence_source_id: string | null;
    evidence_version: string | number | null;
    state: string;
  }>(
    `SELECT job_type, project_id, publication_version, evidence_source_id, evidence_version, state
     FROM publish_outbox`,
  );
  assert.deepEqual(jobs.rows.map((row) => ({ ...row, publication_version: Number(row.publication_version), evidence_version: Number(row.evidence_version) })), [
    {
      job_type: 'rag_revoke',
      project_id: 'outbox-versioned',
      publication_version: 1,
      evidence_source_id: 'ev-versioned',
      evidence_version: 1,
      state: 'queued',
    },
  ]);
  await db.query(`UPDATE evidence_sources SET extracted_text_sha256 = repeat('b', 64) WHERE id = 'ev-versioned'`);
  assert.equal(Number((await db.query<{ evidence_version: string | number }>(
    `SELECT evidence_version FROM evidence_sources WHERE id = 'ev-versioned'`,
  )).rows[0]?.evidence_version), 3);

  await assert.rejects(
    db.query(
      `INSERT INTO publish_outbox (
         id, job_type, project_id, publication_version, evidence_source_id, evidence_version
       ) VALUES ('duplicate-null-site', 'site_refresh', 'outbox-versioned', 1, NULL, NULL),
                ('duplicate-null-site-2', 'site_refresh', 'outbox-versioned', 1, NULL, NULL)`,
    ),
    /publish_outbox_identity_uidx/,
  );
});

test('source identity migration enforces revision idempotency active drafts and publication versions', async () => {
  const db = createTestDb();
  await applyMigrations(db);

  await db.query(
    `INSERT INTO projects (id, slug, title, tagline, area, year)
     VALUES ('versioned-project', 'versioned-project', 'Versioned', 'Versioned', 'Apps', 2026)`,
  );
  const project = await db.query<{ publication_version: string | number }>(
    `SELECT publication_version FROM projects WHERE id = 'versioned-project'`,
  );
  assert.equal(Number(project.rows[0]?.publication_version), 0);

  await db.query(
    `INSERT INTO project_sources (id, provider, repository_id, canonical_full_name, project_id)
     VALUES ('source-versioned', 'github', '90001', 'DylanMcCavitt/versioned-project', 'versioned-project')`,
  );
  await assert.rejects(
    db.query(
      `INSERT INTO project_sources (id, provider, repository_id, canonical_full_name)
       VALUES ('source-duplicate', 'github', '90001', 'DylanMcCavitt/renamed-project')`,
    ),
    /project_sources_provider_repository_id_key/,
  );
  await assert.rejects(
    db.query(
      `INSERT INTO project_sources (id, provider, repository_id, canonical_full_name)
       VALUES ('source-nonnumeric', 'github', 'repo-name', 'DylanMcCavitt/bad-identity')`,
    ),
    /project_sources_repository_id_numeric_check/,
  );

  const fingerprint = 'a'.repeat(64);
  await db.query(
    `INSERT INTO project_candidates (
       id, source_kind, source_ref, provider, repository_id, source_revision, content_fingerprint
     ) VALUES ('candidate-revision', 'github_repo', 'https://github.com/example/repo', 'github', '90001', $1, $2)`,
    ['1'.repeat(40), fingerprint],
  );
  await assert.rejects(
    db.query(
      `INSERT INTO project_candidates (
         id, source_kind, source_ref, provider, repository_id, source_revision, content_fingerprint
       ) VALUES ('candidate-duplicate', 'github_repo', 'https://github.com/example/renamed', 'github', '90001', $1, $2)`,
      ['1'.repeat(40), fingerprint],
    ),
    /project_candidates_source_revision_uidx/,
  );
  await assert.rejects(
    db.query(
      `INSERT INTO project_candidates (id, source_kind, source_ref, provider, repository_id)
       VALUES ('candidate-partial-identity', 'github_repo', 'https://github.com/example/bad', 'github', '90002')`,
    ),
    /project_candidates_source_identity_check/,
  );
  await assert.rejects(
    db.query(
      `INSERT INTO project_candidates (
         id, source_kind, source_ref, provider, repository_id, source_revision, content_fingerprint
       ) VALUES ('candidate-nonnumeric-identity', 'github_repo', 'https://github.com/example/bad', 'github', 'repo-name', $1, $2)`,
      ['3'.repeat(40), fingerprint],
    ),
    /project_candidates_source_identity_check/,
  );

  await db.query(
    `INSERT INTO project_drafts (
       id, provider, repository_id, source_revision, content_fingerprint, base_project_version
     ) VALUES ('draft-revision-one', 'github', '90001', $1, $2, 0)`,
    ['1'.repeat(40), fingerprint],
  );
  await assert.rejects(
    db.query(
      `INSERT INTO project_drafts (
         id, provider, repository_id, source_revision, content_fingerprint, base_project_version
       ) VALUES ('draft-active-conflict', 'github', '90001', $1, $2, 0)`,
      ['2'.repeat(40), 'b'.repeat(64)],
    ),
    /project_drafts_active_source_uidx/,
  );
  await db.query(`UPDATE project_drafts SET lifecycle_state = 'published' WHERE id = 'draft-revision-one'`);
  await db.query(
    `INSERT INTO project_drafts (
       id, provider, repository_id, source_revision, content_fingerprint, base_project_version
     ) VALUES ('draft-revision-two', 'github', '90001', $1, $2, 0)`,
    ['2'.repeat(40), 'b'.repeat(64)],
  );
  await assert.rejects(
    db.query(`UPDATE project_drafts SET reviewed_field_diff = '{}'::jsonb WHERE id = 'draft-revision-two'`),
    /project_drafts_reviewed_field_diff_check/,
  );

  await db.query(`DELETE FROM schema_migrations WHERE name = '0004_source_identity_and_refresh_drafts.sql'`);
  assert.deepEqual(await applyMigrations(db), ['0004_source_identity_and_refresh_drafts.sql']);
});

test('seed and reset path works without external credentials', async () => {
  const db = createTestDb();

  await applyMigrations(db);
  const seeds = await applySeeds(db);
  assert.deepEqual(seeds, ['001_foundation_smoke.sql']);

  const seeded = await db.query<{ id: string; lifecycle_state: string; source: string }>(
    `SELECT id, lifecycle_state, source FROM projects WHERE id = 'seed-foundation-project'`,
  );
  assert.deepEqual(seeded.rows, [
    {
      id: 'seed-foundation-project',
      lifecycle_state: 'shadow',
      source: 'test_seed',
    },
  ]);

  await resetDatabase(db);
  const afterReset = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'projects'`,
  );
  assert.equal(afterReset.rows[0]?.count, '0');

  assert.deepEqual(await applyMigrations(db), [
    '0001_dm_project_foundation.sql',
    '0002_review_events_seq.sql',
    '0003_recruiter_project_areas.sql',
    '0004_source_identity_and_refresh_drafts.sql',
    '0005_publish_outbox.sql',
  ]);
  assert.deepEqual(await applySeeds(db), ['001_foundation_smoke.sql']);

  const reseeded = await db.query<{ id: string }>(
    `SELECT id FROM projects WHERE id = 'seed-foundation-project'`,
  );
  assert.deepEqual(reseeded.rows, [{ id: 'seed-foundation-project' }]);
});

test('catalog shadow import writes every project as legacy shadow records', async () => {
  const db = createTestDb();
  await applyMigrations(db);

  const imported = await importCatalogShadowRecords(db);
  assert.equal(imported.imported, CATALOG.length);
  assert.deepEqual(imported.ids, CATALOG.map((project) => project.id));

  const records = await fetchCatalogShadowRecords(db);
  assert.equal(records.length, CATALOG.length);
  assert.deepEqual(
    records.map((record) => record.id).sort(),
    CATALOG.map((project) => project.id).sort(),
  );

  for (const record of records) {
    assert.equal(record.lifecycle_state, 'shadow');
    assert.equal(record.source, 'legacy_catalog');
    assert.equal(record.slug, record.id);
    assert.equal(record.published_at, null);
    assert.equal(record.archived_at, null);
  }

  const report = generateCatalogParityReport(records);
  assert.equal(report.status, 'pass');
  assert.equal(report.catalogProjectCount, CATALOG.length);
  assert.equal(report.shadowRecordCount, CATALOG.length);
  assert.deepEqual(
    report.sections.map((section) => section.name),
    ['cards', 'details', 'dm_artifacts', 'seo_og_sitemap', 'media_placeholders', 'external_links', 'fallback'],
  );
});

test('catalog shadow import refuses to overwrite non-legacy projects', async () => {
  const db = createTestDb();
  await applyMigrations(db);
  const project = CATALOG[0];
  assert.ok(project, 'expected at least one catalog project');

  await db.query(
    `INSERT INTO projects (id, slug, title, tagline, area, year, lifecycle_state, source)
     VALUES ($1, $2, $3, $4, $5, $6, 'draft_only', 'manual')`,
    [project.id, project.id, project.title, project.line, project.area, project.year],
  );

  await assert.rejects(
    () => importCatalogShadowRecords(db),
    /Refusing to overwrite non-legacy catalog project records/,
  );

  const unchanged = await db.query<{ source: string; lifecycle_state: string }>(
    `SELECT source, lifecycle_state FROM projects WHERE id = $1`,
    [project.id],
  );
  assert.deepEqual(unchanged.rows, [{ source: 'manual', lifecycle_state: 'draft_only' }]);
});

test('DB read layer returns card detail and DM artifact models from shadow records', async () => {
  const db = createTestDb();
  await applyMigrations(db);
  await importCatalogShadowRecords(db);

  const models = await fetchInternalShadowProjectReadModels(db);
  assert.equal(models.length, CATALOG.length);

  const byId = new Map(models.map((model) => [model.card.id, model]));
  for (const project of CATALOG) {
    const model = byId.get(project.id);
    assert.ok(model, `expected DB read model for ${project.id}`);
    const meta = projectMeta(project);

    assert.deepEqual(model.card, {
      id: project.id,
      slug: project.id,
      href: `/projects/${project.id}`,
      title: project.title,
      area: project.area,
      status: project.status,
      year: project.year,
      activity: project.activity,
      hue: project.hue,
      line: project.line,
    });
    assert.deepEqual(
      {
        seek: model.detail.seek,
        links: model.detail.links,
        metrics: model.detail.metrics,
        about: model.detail.about,
        notes: model.detail.notes,
        stack: model.detail.stack,
        shots: model.detail.shots,
        wip: model.detail.wip,
        money: model.detail.money,
        seo: model.detail.seo,
      },
      {
        seek: project.seek,
        links: project.links,
        metrics: project.metrics,
        about: project.about,
        notes: project.notes,
        stack: project.stack,
        shots: project.shots,
        wip: project.wip,
        money: project.money,
        seo: {
          title: meta.title,
          description: meta.description,
          ogImage: meta.ogImage,
          sitemapPath: `/projects/${project.id}/`,
        },
      },
    );
    assert.deepEqual(model.dmArtifact, {
      kind: 'project',
      id: project.id,
      title: project.title,
      area: project.area,
      status: project.status,
      year: project.year,
      activity: project.activity,
      line: project.line,
      wip: project.wip,
      money: project.money,
      links: project.links,
      metrics: project.metrics,
      about: project.about,
      notes: project.notes,
      stack: project.stack,
      href: `/projects/${project.id}`,
      source: 'portfolio-site-canonical-data',
    });
  }
});

test('public DB read helpers expose only published project rows', async () => {
  const db = createTestDb();
  await applyMigrations(db);

  const [shadow, draft, published] = buildCatalogShadowRecords(CATALOG.slice(0, 3));
  assert.ok(shadow && draft && published, 'expected at least three catalog shadow records');

  await insertProjectRecord(db, shadow);
  await insertProjectRecord(db, { ...draft, lifecycle_state: 'draft_only', source: 'github_discovery' });
  await insertProjectRecord(db, {
    ...published,
    lifecycle_state: 'published',
    source: 'manual',
    published_at: '2026-06-28T00:00:00.000Z',
  });
  await db.query(
    `INSERT INTO project_candidates (id, source_kind, source_ref, lifecycle_state)
     VALUES ('candidate-hidden', 'github_repo', 'https://example.com/repo', 'detected')`,
  );

  const cards = await fetchPublicProjectCards(db);
  const details = await fetchPublicProjectDetails(db);
  const detail = await fetchPublicProjectDetail(db, published.id);
  const shadowDetail = await fetchPublicProjectDetail(db, shadow.id);

  assert.deepEqual(cards.map((card) => card.id), [published.id]);
  assert.deepEqual(details.map((item) => item.id), [published.id]);
  assert.equal(detail?.id, published.id);
  assert.equal(shadowDetail, null);
  const internalShadow = await fetchInternalShadowProjectReadModels(db);
  assert.deepEqual(internalShadow.map((model) => model.card.id), [shadow.id]);

  const neonStyleDb = {
    async query<Row = unknown>() {
      return [published] as Row[];
    },
  } satisfies ProjectReadQueryable;
  assert.deepEqual(
    (await fetchPublicProjectCards(neonStyleDb)).map((card) => card.id),
    [published.id],
  );

  assert.throws(
    () => projectRecordToReadModels({ ...published, media: ['not-a-shot'] }),
    /invalid legacy media/,
  );
  assert.throws(
    () => projectRecordToReadModels({ ...published, media: [{ cap: 'bad hybrid', img: false, kind: 'chart' }] }),
    /invalid legacy media/,
  );
  assert.throws(
    () => projectRecordToReadModels({ ...published, media: [{ cap: 'bad skeleton', kind: 'constructor' }] }),
    /invalid legacy media/,
  );
  const invalidStatus = JSON.parse(JSON.stringify(published)) as CatalogShadowRecord;
  (invalidStatus.details[0] as Record<string, unknown>).status = ['constructor', 'Published'];
  assert.throws(
    () => projectRecordToReadModels(invalidStatus),
    /invalid legacy status/,
  );
});

test('public DB read helpers render admin-published rows without legacy snapshots', async () => {
  const db = createTestDb();
  await applyMigrations(db);

  await db.query(
    `INSERT INTO projects (
       id, slug, title, tagline, area, year, lifecycle_state, activity, summary,
       details, metrics, links, media, source, published_at, archived_at
     ) VALUES (
       'manual-db-project', 'manual-db-slug', 'Manual DB Project', 'DB-only public tagline',
       'AI & Developer Tools', 2026, 'published', 'Published from admin',
       'Public summary from admin review.',
       $1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb, 'manual', '2026-07-04T00:00:00.000Z', null
     )`,
    [
      JSON.stringify([{ label: 'Detail', value: 'One' }, 'Public admin paragraph.']),
      JSON.stringify([{ label: 'published proof', value: '1' }]),
      JSON.stringify([{ label: 'Live ↗', href: 'https://example.com/manual-db-project' }]),
      JSON.stringify([{ kind: 'image', src: '/screenshots/manual-db-project.png', caption: 'Manual DB screenshot' }]),
    ],
  );

  const detail = await fetchPublicProjectDetail(db, 'manual-db-slug');
  assert.equal(detail?.id, 'manual-db-project');
  assert.equal(detail?.slug, 'manual-db-slug');
  assert.equal(projectPublicMark(detail!), 'manual-db-slug');
  assert.equal(detail?.href, '/projects/manual-db-slug');
  assert.deepEqual(detail?.status, ['done', 'Published']);
  assert.equal(detail?.hue, '#8b7cf6');
  assert.deepEqual(detail?.about, ['Public admin paragraph.']);
  assert.deepEqual(detail?.notes, []);
  assert.deepEqual(detail?.stack, [{ label: 'Detail', value: 'One' }]);
  assert.deepEqual(detail?.metrics, [{ value: '1', label: 'published proof' }]);
  assert.deepEqual(detail?.links, [{ label: 'Live ↗', href: 'https://example.com/manual-db-project' }]);
  assert.deepEqual(detail?.shots, [
    { kind: 'image', src: '/screenshots/manual-db-project.png', caption: 'Manual DB screenshot' },
  ]);
  assert.equal(detail?.dmArtifact.href, '/projects/manual-db-slug');

  const byId = await fetchPublicProjectDetail(db, 'manual-db-project');
  assert.equal(byId?.slug, 'manual-db-slug');
});

test('markerless pre-canonical published rows normalize only supported legacy nested shapes', async () => {
  const db = createTestDb();
  await applyMigrations(db);

  await db.query(
    `INSERT INTO projects (
       id, slug, title, tagline, area, year, lifecycle_state, activity, summary,
       details, metrics, links, media, source, published_at
     ) VALUES (
       'markerless-legacy', 'markerless-legacy', 'Markerless legacy', 'Pre-canonical persisted row',
       'AI & Developer Tools', 2026, 'published', 'Published before schema cutover', 'Legacy public summary.',
       $1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb, 'manual', '2026-07-04T00:00:00.000Z'
     )`,
    [
      JSON.stringify([
        ['Language', 'TypeScript'],
        { label: 'Version', value: 2 },
        { provenance: 'not a legacy catalog snapshot' },
        'Legacy public paragraph.',
      ]),
      JSON.stringify([
        ['1', 'published proof'],
        { value: 2, label: 'review passes' },
      ]),
      JSON.stringify([
        ['Repo', 'https://example.com/markerless-legacy'],
        { label: 'Docs', url: 'http://example.com/markerless-legacy/docs' },
      ]),
      JSON.stringify([
        { type: 'image', src: '/screenshots/markerless-legacy.png', caption: 'Legacy screenshot' },
        {
          video: '/demos/loom-install.mp4',
          poster: '/demos/loom-install-poster.png',
          cap: 'Legacy Loom demo',
        },
      ]),
    ],
  );

  const detail = await fetchPublicProjectDetail(db, 'markerless-legacy');
  assert.deepEqual(detail?.about, ['Legacy public paragraph.']);
  assert.deepEqual(detail?.stack, [
    { label: 'Language', value: 'TypeScript' },
    { label: 'Version', value: '2' },
  ]);
  assert.deepEqual(detail?.metrics, [
    { value: '1', label: 'published proof' },
    { value: '2', label: 'review passes' },
  ]);
  assert.deepEqual(detail?.links, [
    { label: 'Repo', href: 'https://example.com/markerless-legacy' },
    { label: 'Docs', href: 'http://example.com/markerless-legacy/docs' },
  ]);
  assert.deepEqual(detail?.shots, [
    {
      kind: 'image',
      src: '/screenshots/markerless-legacy.png',
      caption: 'Legacy screenshot',
    },
    {
      kind: 'video',
      src: '/demos/loom-install.mp4',
      poster: '/demos/loom-install-poster.png',
      caption: 'Legacy Loom demo',
    },
  ]);

  const [record] = (
    await db.query<CatalogShadowRecord>(
      `SELECT id, slug, title, tagline, area, year, lifecycle_state, activity, summary,
              details, metrics, links, media, source, published_at, archived_at
       FROM projects WHERE id = 'markerless-legacy'`,
    )
  ).rows;
  assert.ok(record);
  assert.throws(
    () => projectRecordToReadModels({ ...record, links: [['Unsafe', 'javascript:alert(1)']] }),
    /invalid legacy links/,
  );
  assert.throws(
    () => projectRecordToReadModels({
      ...record,
      media: [{ type: 'image', src: '/assets/not-approved.png', caption: 'Unsafe legacy media' }],
    }),
    /invalid legacy media/,
  );

  for (const invalidFields of [
    { slug: 'Invalid Slug' },
    { title: '   ' },
    { tagline: '   ' },
    { year: 1999 },
    { summary: '   ' },
  ]) {
    assert.throws(
      () => projectRecordToReadModels({ ...record, ...invalidFields }),
      `expected persisted field override ${JSON.stringify(invalidFields)} to be rejected`,
    );
  }
});

test('DB read layer accepts canonical Loom demo media and rejects invalid media', async () => {
  const db = createTestDb();
  await applyMigrations(db);

  await db.query(
    `INSERT INTO projects (
       id, slug, title, tagline, area, year, lifecycle_state, activity, summary,
       details, metrics, links, media, source, published_at, archived_at
     ) VALUES (
       'video-media-project', 'video-media-project', 'Video Media Project', 'Demo video media',
       'AI & Developer Tools', 2026, 'published', 'Published from admin',
       'Public summary for video media.',
       $1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb, 'manual', '2026-07-04T00:00:00.000Z', null
     )`,
    [
      JSON.stringify(['Public admin paragraph.']),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify([{ kind: 'video', src: '/demos/loom-install.mp4', poster: '/demos/loom-install-poster.png', caption: 'Loom install demo' }]),
    ],
  );

  const detail = await fetchPublicProjectDetail(db, 'video-media-project');
  assert.deepEqual(detail?.shots, [
    {
      kind: 'video',
      src: '/demos/loom-install.mp4',
      poster: '/demos/loom-install-poster.png',
      caption: 'Loom install demo',
    },
  ]);

  const canonicalRecord = {
    ...(await db.query<CatalogShadowRecord>(`SELECT * FROM projects WHERE id = 'video-media-project'`)).rows[0]!,
    media: [{ kind: 'image', src: 'javascript:alert(1)', caption: 'Unsafe' }],
  };
  assert.throws(() => projectRecordToReadModels(canonicalRecord), /invalid legacy media/);
});

test('public project source modes keep catalog use explicit and database reads fail closed', async () => {
  assert.equal(shouldUsePublicProjectDb({}), false);
  assert.equal(shouldUsePublicProjectDb({ PUBLIC_PROJECT_PAGES_FROM_DB: 'true' }), true);
  assert.equal(shouldUsePublicProjectDb({ PUBLIC_PROJECT_SOURCE: 'database' }), true);
  assert.equal(shouldUsePublicProjectDb({ DATABASE_URL: 'postgres://local' }), true);
  assert.equal(shouldUsePublicProjectDb({ VERCEL: '1' }), false);
  assert.equal(shouldUsePublicProjectDb({ VERCEL: '1', CI: '1' }), true);
  assert.equal(shouldUsePublicProjectDb({ VERCEL: '1', VERCEL_REGION: 'iad1' }), true);
  assert.equal(
    shouldUsePublicProjectDb({ VERCEL: '1', CI: '1', PUBLIC_PROJECT_SOURCE: 'catalog_emergency' }),
    false,
  );
  assert.equal(resolvePublicProjectSourceMode({ env: {} }), 'catalog_development');
  assert.throws(
    () => resolvePublicProjectSourceMode({ env: { PUBLIC_PROJECT_SOURCE: 'catalog' } }),
    (error: unknown) => error instanceof PublicProjectDataError && error.code === 'invalid_source_mode',
  );

  resetPublicProjectDetailsLoadForTests();
  const development = await loadPublicProjectDetails({ env: {} });
  assert.equal(development.source, 'catalog');
  assert.equal(development.mode, 'catalog_development');
  assert.equal(development.projects.length, CATALOG.length);
  assert.match(development.reason ?? '', /development catalog source/i);

  resetPublicProjectDetailsLoadForTests();
  await assert.rejects(
    () => loadPublicProjectDetails({ env: { PUBLIC_PROJECT_SOURCE: 'database' } }),
    (error: unknown) => error instanceof PublicProjectDataError && error.code === 'missing_config',
  );
  await assert.rejects(
    () => loadPublicProjectDetails({ env: { VERCEL: '1', CI: '1', VERCEL_ENV: 'preview' } }),
    (error: unknown) => error instanceof PublicProjectDataError && error.code === 'missing_config',
  );

  const db = createTestDb();
  await applyMigrations(db);

  await assert.rejects(
    () => loadPublicProjectDetails({ env: { PUBLIC_PROJECT_SOURCE: 'database' }, db }),
    (error: unknown) => error instanceof PublicProjectDataError && error.code === 'empty_published_set',
  );

  let emergencyDbQueries = 0;
  const emergencyDb: ProjectReadQueryable = {
    async query() {
      emergencyDbQueries += 1;
      throw new Error('must not query the DB in explicit emergency mode');
    },
  };
  resetPublicProjectDetailsLoadForTests();
  const emergency = await loadPublicProjectDetails({
    env: { VERCEL: '1', CI: '1', PUBLIC_PROJECT_SOURCE: 'catalog_emergency' },
    db: emergencyDb,
  });
  assert.equal(emergency.source, 'catalog');
  assert.equal(emergency.mode, 'catalog_emergency');
  assert.equal(emergency.projects.length, CATALOG.length);
  assert.equal(emergencyDbQueries, 0);

  const [publishedRecord] = buildCatalogShadowRecords(CATALOG.slice(0, 1));
  assert.ok(publishedRecord, 'expected a catalog project record');
  const published = {
    ...publishedRecord,
    lifecycle_state: 'published' as const,
    source: 'manual' as const,
    published_at: '2026-07-04T00:00:00.000Z',
  };
  await insertProjectRecord(db, published);

  resetPublicProjectDetailsLoadForTests();
  const enabled = await loadPublicProjectDetails({ env: { PUBLIC_PROJECT_SOURCE: 'database' }, db });
  assert.equal(enabled.source, 'db');
  assert.equal(enabled.mode, 'database');
  assert.equal(enabled.projects[0]?.id, published.id);
  assert.equal(enabled.projects.length, 1);
  assert.equal(filterPublicProjectDetails(enabled.projects, 'all').length, 1);
  assert.equal(enabled.projects.some((project) => project.id === 'exit-manager'), false);

  resetPublicProjectDetailsLoadForTests();
  const injectedDb = await loadPublicProjectDetails({ db });
  assert.equal(injectedDb.source, 'db');
  assert.equal(injectedDb.projects[0]?.id, published.id);
  assert.equal(injectedDb.projects.length, 1);

  const malformedDb: ProjectReadQueryable = {
    async query<Row = unknown>() {
      return [{ ...published, title: '   ' }] as unknown as Row[];
    },
  };
  await assert.rejects(
    () => loadPublicProjectDetails({ env: { PUBLIC_PROJECT_SOURCE: 'database' }, db: malformedDb }),
    (error: unknown) => error instanceof PublicProjectDataError && error.code === 'read_failed',
  );
});

test('loadPublicProjectDetails retries live DB reads after a transient failure', async () => {
  resetPublicProjectDetailsLoadForTests();

  const db = createTestDb();
  await applyMigrations(db);
  const [publishedRecord] = buildCatalogShadowRecords(CATALOG.slice(0, 1));
  assert.ok(publishedRecord, 'expected a catalog project record');
  const published = {
    ...publishedRecord,
    lifecycle_state: 'published' as const,
    source: 'manual' as const,
    published_at: '2026-07-04T00:00:00.000Z',
  };
  await insertProjectRecord(db, published);

  let shouldFail = true;
  const flakyDb: ProjectReadQueryable = {
    async query(sql, params) {
      if (shouldFail) throw new Error('transient db error');
      return db.query(sql, params);
    },
  };

  const env = { PUBLIC_PROJECT_SOURCE: 'database' };
  await assert.rejects(
    () => loadPublicProjectDetails({ env, db: flakyDb }),
    (error: unknown) =>
      error instanceof PublicProjectDataError &&
      error.code === 'read_failed' &&
      !('cause' in error) &&
      !String(error.stack).includes('transient db error'),
  );

  shouldFail = false;
  const second = await loadPublicProjectDetails({ env, db: flakyDb });
  assert.equal(second.source, 'db');
  assert.equal(second.projects[0]?.id, published.id);
  assert.equal(second.projects.length, 1);

  resetPublicProjectDetailsLoadForTests();
  const cachedFirst = await loadPublicProjectDetails({ env: {} });
  const cachedSecond = await loadPublicProjectDetails({ env: {} });
  assert.equal(cachedFirst.source, 'catalog');
  assert.equal(cachedFirst.mode, 'catalog_development');
  assert.equal(cachedSecond, cachedFirst);
});

test('shadow read helper reports unavailable instead of throwing on missing or failed DB', async () => {
  const missing = await tryFetchInternalShadowProjectReadModels(null);
  assert.deepEqual(missing, {
    status: 'unavailable',
    projects: [],
    reason: 'Database client is not configured.',
  });

  const failed = await tryFetchInternalShadowProjectReadModels({
    async query() {
      throw new Error('shadow read failed');
    },
  } satisfies ProjectReadQueryable);

  assert.deepEqual(failed, {
    status: 'unavailable',
    projects: [],
    reason: 'shadow read failed',
  });
});

test('catalog parity report names missing extra and mismatched fields', () => {
  const records = JSON.parse(JSON.stringify(buildCatalogShadowRecords())) as CatalogShadowRecord[];
  const firstRecord = records[0];
  assert.ok(firstRecord, 'expected at least one catalog shadow record');

  const snapshot = firstRecord.details[0] as Record<string, unknown>;
  delete snapshot.about;
  snapshot.extra_field = 'unexpected';
  firstRecord.title = 'wrong title';

  const report = generateCatalogParityReport(records);
  const firstProject = report.projects.find((project) => project.id === firstRecord.id);

  assert.equal(report.status, 'fail');
  assert.ok(firstProject, 'expected first project parity entry');
  assert.ok(firstProject.missingFields.includes('about'));
  assert.ok(firstProject.extraFields.includes('extra_field'));
  assert.ok(firstProject.mismatchedFields.includes('title'));
});

test('public route project reference resolver matches id/slug and throws on required misses', () => {
  const [record] = buildCatalogShadowRecords(CATALOG.slice(0, 1));
  assert.ok(record, 'expected at least one catalog shadow record');
  const detail = projectRecordToReadModels({ ...record, slug: `${record.id}-public-slug` }).detail;

  assert.equal(resolvePublicProjectByReference([detail], detail.id)?.id, detail.id);
  assert.equal(resolvePublicProjectByReference([detail], detail.slug)?.id, detail.id);

  assert.throws(
    () =>
      resolveRequiredPublicProjectByReference([detail], 'missing-featured-id', {
        route: 'hiring.astro',
        source: 'db',
        label: 'featured project id',
      }),
    /hiring\.astro: featured project id "missing-featured-id" not found in db public project source/,
  );

  // Any admin-published row: internal proj_* id, public slug for card marks.
  assert.equal(projectPublicMark({ id: 'proj_internal-uuid', slug: 'any-published-slug' }), 'any-published-slug');
  assert.equal(projectPublicMark({ id: 'agentic-trader', slug: 'agentic-trader' }), 'agentic-trader');
  assert.equal(projectPublicMark({ id: 'agentic-trader' }), 'agentic-trader');
});

test('public project routes use the shared public project source boundary', async () => {
  const routeFiles = [
    'src/pages/library/index.astro',
    'src/pages/library/[filter].astro',
    'src/pages/projects/[id].astro',
    'src/pages/hiring.astro',
    'src/pages/journey/[track].astro',
    'src/pages/sitemap.xml.ts',
    'src/pages/og/projects/[id].png.ts',
  ];

  for (const path of routeFiles) {
    const source = await readFile(path, 'utf8');
    assert.match(source, /loadPublicProjectDetails/);
  }

  const projectCard = await readFile('src/components/ProjectCard.astro', 'utf8');
  assert.match(projectCard, /projectPublicMark/);

  const vercelConfig = JSON.parse(await readFile('vercel.json', 'utf8')) as {
    redirects: Array<{ source: string; destination: string }>;
  };
  const redirects = new Map(vercelConfig.redirects.map((redirect) => [redirect.source, redirect.destination]));
  assert.equal(redirects.get('/library/trading-systems'), '/library/side-projects-experiments');
  assert.equal(redirects.get('/library/agents-mcp'), '/library/ai-developer-tools');
  assert.equal(redirects.get('/library/ios'), '/library/apps');
  assert.equal(redirects.get('/library/shipped'), '/library/shipped-client-work');
  assert.equal(redirects.get('/library/school'), '/library/coursework');
  assert.equal(redirects.get('/library/infrastructure'), '/library/side-projects-experiments');
  assert.equal(redirects.get('/library/research'), '/library/side-projects-experiments');
});
