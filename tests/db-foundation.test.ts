import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { afterEach } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations, applySeeds, resetDatabase, type Queryable } from '../scripts/db';
import { CATALOG } from '../src/data/catalog';
import {
  buildCatalogShadowRecords,
  fetchCatalogShadowRecords,
  generateCatalogParityReport,
  importCatalogShadowRecords,
  type CatalogShadowRecord,
} from '../src/lib/db/catalog-shadow';
import {
  fetchInternalShadowProjectReadModels,
  fetchPublicProjectCards,
  fetchPublicProjectDetail,
  fetchPublicProjectDetails,
  projectRecordToReadModels,
  tryFetchInternalShadowProjectReadModels,
  type ProjectReadQueryable,
} from '../src/lib/db/project-reads';
import {
  filterPublicProjectDetails,
  loadPublicProjectDetails,
  resetPublicProjectDetailsLoadForTests,
  shouldUsePublicProjectDb,
} from '../src/lib/public-projects';
import {
  resolvePublicProjectByReference,
  resolveRequiredPublicProjectByReference,
} from '../src/lib/public-project-route-resolver';
import {
  CANDIDATE_LIFECYCLE_STATES,
  DRAFT_LIFECYCLE_STATES,
  PROJECT_LIFECYCLE_STATES,
  RAG_SOURCE_ELIGIBILITY_STATES,
  SCAN_RUN_LIFECYCLE_STATES,
} from '../src/lib/db/schema';
import { projectMeta } from '../src/lib/seo';

afterEach(() => {
  resetPublicProjectDetailsLoadForTests();
});

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
    /invalid media read details/,
  );
  assert.throws(
    () => projectRecordToReadModels({ ...published, media: [{ cap: 'bad hybrid', img: false, kind: 'chart' }] }),
    /invalid media read details/,
  );
  assert.throws(
    () => projectRecordToReadModels({ ...published, media: [{ cap: 'bad skeleton', kind: 'constructor' }] }),
    /invalid media read details/,
  );
  const invalidStatus = JSON.parse(JSON.stringify(published)) as CatalogShadowRecord;
  (invalidStatus.details[0] as Record<string, unknown>).status = ['constructor', 'Published'];
  assert.throws(
    () => projectRecordToReadModels(invalidStatus),
    /invalid status read details/,
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
       'Agents & MCP', 2026, 'published', 'Published from admin',
       'Public summary from admin review.',
       $1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb, 'manual', '2026-07-04T00:00:00.000Z', null
     )`,
    [
      JSON.stringify([{ label: 'Detail', value: 'One' }, { provenance: 'not a legacy snapshot' }, 'Public admin paragraph.']),
      JSON.stringify([{ label: 'published proof', value: '1' }]),
      JSON.stringify([{ label: 'Live ↗', href: 'https://example.com/manual-db-project' }]),
      JSON.stringify([{ type: 'image', src: '/manual-db-project.png', caption: 'Manual DB screenshot' }]),
    ],
  );

  const detail = await fetchPublicProjectDetail(db, 'manual-db-slug');
  assert.equal(detail?.id, 'manual-db-project');
  assert.equal(detail?.href, '/projects/manual-db-slug');
  assert.deepEqual(detail?.status, ['done', 'Published']);
  assert.equal(detail?.hue, '#8b7cf6');
  assert.deepEqual(detail?.about, ['Public admin paragraph.']);
  assert.deepEqual(detail?.notes, []);
  assert.deepEqual(detail?.stack, [['Detail', 'One']]);
  assert.deepEqual(detail?.metrics, [['1', 'published proof']]);
  assert.deepEqual(detail?.links, [['Live ↗', 'https://example.com/manual-db-project']]);
  assert.deepEqual(detail?.shots, [{ img: '/manual-db-project.png', cap: 'Manual DB screenshot' }]);
  assert.equal(detail?.dmArtifact.href, '/projects/manual-db-slug');

  const byId = await fetchPublicProjectDetail(db, 'manual-db-project');
  assert.equal(byId?.slug, 'manual-db-slug');
});

test('public project DB gate falls back to catalog until explicitly enabled and populated', async () => {
  assert.equal(shouldUsePublicProjectDb({}), false);
  assert.equal(shouldUsePublicProjectDb({ PUBLIC_PROJECT_PAGES_FROM_DB: 'true' }), true);

  resetPublicProjectDetailsLoadForTests();
  const disabled = await loadPublicProjectDetails({ env: {} });
  assert.equal(disabled.source, 'catalog');
  assert.equal(disabled.projects.length, CATALOG.length);

  resetPublicProjectDetailsLoadForTests();
  const unavailable = await loadPublicProjectDetails({ env: { PUBLIC_PROJECT_PAGES_FROM_DB: 'true' } });
  assert.equal(unavailable.source, 'catalog');
  assert.equal(unavailable.projects.length, CATALOG.length);
  assert.match(unavailable.reason ?? '', /Missing database connection string/);

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

  resetPublicProjectDetailsLoadForTests();
  const enabled = await loadPublicProjectDetails({ env: { PUBLIC_PROJECT_PAGES_FROM_DB: 'true' }, db });
  assert.equal(enabled.source, 'db');
  assert.deepEqual(enabled.projects.map((project) => project.id), [published.id]);
  assert.deepEqual(filterPublicProjectDetails(enabled.projects, 'all').map((project) => project.id), [published.id]);
});

test('loadPublicProjectDetails keeps one source set per process after a DB failure', async () => {
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

  const env = { PUBLIC_PROJECT_PAGES_FROM_DB: 'true' };
  const first = await loadPublicProjectDetails({ env, db: flakyDb });
  assert.equal(first.source, 'catalog');
  assert.match(first.reason ?? '', /transient db error/);
  assert.equal(first.projects.length, CATALOG.length);

  shouldFail = false;
  const second = await loadPublicProjectDetails({ env, db: flakyDb });
  assert.equal(second.source, 'catalog');
  assert.equal(second.projects.length, CATALOG.length);
  assert.equal(second, first);

  resetPublicProjectDetailsLoadForTests();
  const gateOff = await loadPublicProjectDetails({ env: {} });
  assert.equal(gateOff.source, 'catalog');
  assert.equal(gateOff.reason, 'Public project DB gate is disabled.');
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
});

test('public project routes use the gated public project source', async () => {
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
});
