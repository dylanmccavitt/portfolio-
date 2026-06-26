import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations, applySeeds, resetDatabase, type Queryable } from '../scripts/db';
import {
  CANDIDATE_LIFECYCLE_STATES,
  DRAFT_LIFECYCLE_STATES,
  PROJECT_LIFECYCLE_STATES,
  RAG_SOURCE_ELIGIBILITY_STATES,
  SCAN_RUN_LIFECYCLE_STATES,
} from '../src/lib/db/schema';

const FOUNDATION_TABLES = [
  'projects',
  'project_candidates',
  'project_drafts',
  'evidence_sources',
  'scan_runs',
  'review_events',
  'rag_sources',
] as const;

function createTestDb(): Queryable {
  return new PGlite() as Queryable;
}

test('migrations create the DM project foundation tables', async () => {
  const db = createTestDb();
  const applied = await applyMigrations(db);

  assert.deepEqual(applied, ['0001_dm_project_foundation.sql']);

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

test('planned lifecycle states are constrained in SQL and exported types', async () => {
  const db = createTestDb();
  await applyMigrations(db);

  assert.deepEqual(PROJECT_LIFECYCLE_STATES, ['shadow', 'draft_only', 'published', 'archived']);
  assert.deepEqual(SCAN_RUN_LIFECYCLE_STATES, ['queued', 'running', 'completed', 'failed']);
  assert.deepEqual(CANDIDATE_LIFECYCLE_STATES, ['detected', 'qualified', 'dismissed', 'draft_requested']);
  assert.deepEqual(DRAFT_LIFECYCLE_STATES, ['hidden', 'needs_review', 'changes_requested', 'approved_for_publish']);
  assert.deepEqual(RAG_SOURCE_ELIGIBILITY_STATES, ['not_eligible', 'eligible', 'indexing', 'indexed', 'failed', 'revoked']);

  await db.query(`
    INSERT INTO projects (id, slug, title, tagline, area, year, lifecycle_state)
    VALUES ('state-test-project', 'state-test-project', 'State test', 'State test', 'Agents & MCP', 2026, 'draft_only')
  `);
  await db.query(`
    INSERT INTO scan_runs (id, trigger, actor, lifecycle_state)
    VALUES ('state-test-scan', 'test', 'db-foundation-test', 'queued')
  `);

  await assert.rejects(
    db.query(`
      INSERT INTO projects (id, slug, title, tagline, area, year, lifecycle_state)
      VALUES ('bad-project', 'bad-project', 'Bad', 'Bad', 'Agents & MCP', 2026, 'public')
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
      VALUES ('bad-draft', 'published')
    `),
  );

  await assert.rejects(
    db.query(`
      INSERT INTO rag_sources (id, project_id, eligibility_state)
      VALUES ('bad-rag', 'state-test-project', 'published')
    `),
  );
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

  assert.deepEqual(await applyMigrations(db), ['0001_dm_project_foundation.sql']);
  assert.deepEqual(await applySeeds(db), ['001_foundation_smoke.sql']);

  const reseeded = await db.query<{ id: string }>(
    `SELECT id FROM projects WHERE id = 'seed-foundation-project'`,
  );
  assert.deepEqual(reseeded.rows, [{ id: 'seed-foundation-project' }]);
});

test('public project routes remain catalog-backed', async () => {
  const routeFiles = [
    'src/pages/library/index.astro',
    'src/pages/library/[filter].astro',
    'src/pages/projects/[id].astro',
    'src/pages/sitemap.xml.ts',
    'src/pages/hiring.astro',
    'src/pages/journey/[track].astro',
    'src/pages/og/projects/[id].png.ts',
  ];

  for (const path of routeFiles) {
    const source = await readFile(path, 'utf8');
    assert.match(source, /data\/catalog|\.\.\/\.\.\/data\/catalog|\.\.\/data\/catalog/);
    assert.doesNotMatch(source, /lib\/db|src\/lib\/db/);
  }
});
