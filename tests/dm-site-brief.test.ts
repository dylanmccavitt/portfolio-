import assert from 'node:assert/strict';
import test from 'node:test';
import { RESUME } from '@/data/resume';
import type { ProjectDetailReadModel, ProjectReadQueryable } from '@/lib/db/project-reads';
import { createEvalProjectSource } from '@/lib/dm/eval-source';
import {
  buildDMSiteBrief,
  DM_SITE_BRIEF_MAX_CHARS,
  DM_SITE_BRIEF_MAX_UTF8_BYTES,
  DM_SITE_BRIEF_SUMMARY_MAX_CHARS,
  DMSiteBriefError,
  loadDMSiteBrief,
} from '@/lib/dm/site-brief';
import { PublicProjectDataError } from '@/lib/public-projects';

test('site brief covers variable published-project counts deterministically without a fixed 15-row assumption', async () => {
  const source = await createEvalProjectSource();
  const template = (await source.projectLoader())[0];
  assert.ok(template);

  for (const count of [3, 17]) {
    const rows = variableProjects(template, count).reverse();
    const brief = buildDMSiteBrief(rows);
    const sortedIds = rows.map((project) => project.id).sort();

    assert.equal(brief.content.projects.length, count);
    assert.deepEqual(brief.content.projects.map((project) => project.id), sortedIds);
    assert.deepEqual(
      brief.content.projects.map((project) => project.route),
      sortedIds.map((id) => `/projects/${id}`),
    );
    assert.ok(brief.content.projects.every((project) => !project.summary.includes('\n')));
    assert.ok(brief.content.projects.every((project) => [...project.summary].length <= DM_SITE_BRIEF_SUMMARY_MAX_CHARS));
    assert.equal(brief.promptText, JSON.stringify(brief.content));
    assert.equal(brief.charCount, brief.promptText.length);
    assert.equal(brief.utf8ByteCount, new TextEncoder().encode(brief.promptText).byteLength);
    assert.equal(brief.approximatePlanningTokens, Math.ceil(brief.utf8ByteCount / 4));
    assert.ok(brief.charCount <= DM_SITE_BRIEF_MAX_CHARS);
    assert.ok(brief.utf8ByteCount <= DM_SITE_BRIEF_MAX_UTF8_BYTES);
    assert.equal(buildDMSiteBrief([...rows].reverse()).promptText, brief.promptText);
  }
});

test('the complete local fixture stays in the approximate 1–2k planning range without claiming a tokenizer bound', async () => {
  const brief = await loadDMSiteBrief({ env: {} });

  assert.ok(brief.approximatePlanningTokens >= 1_000);
  assert.ok(brief.approximatePlanningTokens <= 2_000);
  assert.equal(brief.approximatePlanningTokens, Math.ceil(brief.utf8ByteCount / 4));
});

test('site brief includes the canonical career overview, resume tracks, routes, and contact pointer', async () => {
  const source = await createEvalProjectSource();
  const brief = buildDMSiteBrief(await source.projectLoader());
  const current = RESUME.tracks.find((track) => track.current) ?? RESUME.tracks.at(-1);
  assert.ok(current);

  assert.equal(brief.content.careerOverview, RESUME.about);
  assert.deepEqual(
    brief.content.resumeTracks.map((track) => ({ id: track.id, route: track.route })),
    RESUME.tracks.map((track) => ({ id: track.id, route: `/journey/${track.id}` })),
  );
  assert.deepEqual(brief.content.routes, {
    home: '/',
    projects: '/library',
    resume: '/journey',
    hiring: '/hiring',
    fitCheck: '/fit-check',
  });
  assert.deepEqual(brief.content.contact, {
    route: `/journey/${current.id}`,
    evidenceTool: 'getContact',
  });
});

test('site brief fails closed when normalized project title aliases collide', async () => {
  const source = await createEvalProjectSource();
  const template = (await source.projectLoader())[0];
  assert.ok(template);
  const rows = variableProjects(template, 2).map((project, index) => ({
    ...project,
    title: index === 0 ? 'No Hard Feelings' : 'No-Hard Feelings',
  }));

  assert.throws(
    () => buildDMSiteBrief(rows),
    (error: unknown) => error instanceof DMSiteBriefError && error.code === 'validation_failed',
  );
});

test('site brief UTF-8 budget fails closed immediately above the Unicode-safe byte limit', async () => {
  const source = await createEvalProjectSource();
  const template = (await source.projectLoader())[0];
  assert.ok(template);
  let rowCount = 0;

  for (let count = 2; count <= 30; count += 1) {
    const belowCandidate = unicodeBudgetProjects(template, count, 0);
    const aboveCandidate = unicodeBudgetProjects(template, count, DM_SITE_BRIEF_SUMMARY_MAX_CHARS);
    try {
      buildDMSiteBrief(belowCandidate);
    } catch {
      break;
    }
    try {
      buildDMSiteBrief(aboveCandidate);
    } catch (error) {
      if (error instanceof DMSiteBriefError && error.code === 'size_limit_exceeded') {
        rowCount = count;
        break;
      }
      throw error;
    }
  }
  assert.ok(rowCount > 0, 'expected a Unicode fixture that crosses only the UTF-8 byte ceiling');

  let belowLimit: ReturnType<typeof buildDMSiteBrief> | null = null;
  let firstRejectedUnicodeCount = 0;
  for (let unicodeCount = 0; unicodeCount <= DM_SITE_BRIEF_SUMMARY_MAX_CHARS; unicodeCount += 1) {
    try {
      belowLimit = buildDMSiteBrief(unicodeBudgetProjects(template, rowCount, unicodeCount));
    } catch (error) {
      assert.ok(error instanceof DMSiteBriefError && error.code === 'size_limit_exceeded');
      firstRejectedUnicodeCount = unicodeCount;
      break;
    }
  }

  assert.ok(belowLimit);
  assert.ok(firstRejectedUnicodeCount > 0);
  assert.equal(DM_SITE_BRIEF_MAX_UTF8_BYTES - belowLimit.utf8ByteCount < 2, true);
  assert.ok(belowLimit.charCount <= DM_SITE_BRIEF_MAX_CHARS);
  assert.equal(belowLimit.approximatePlanningTokens, Math.ceil(belowLimit.utf8ByteCount / 4));
  assert.throws(
    () => buildDMSiteBrief(unicodeBudgetProjects(template, rowCount, firstRejectedUnicodeCount)),
    (error: unknown) => error instanceof DMSiteBriefError && error.code === 'size_limit_exceeded',
  );
});

test('high-entropy ASCII reaches the exact UTF-8 payload cutoff without implying a tokenizer guarantee', async () => {
  const source = await createEvalProjectSource();
  const template = (await source.projectLoader())[0];
  assert.ok(template);
  let atLimit: ReturnType<typeof buildDMSiteBrief> | null = null;
  let rejectedRows: ProjectDetailReadModel[] | null = null;

  for (let count = 2; count <= 60 && !atLimit; count += 1) {
    for (let finalSummaryCharacters = 1; finalSummaryCharacters <= DM_SITE_BRIEF_SUMMARY_MAX_CHARS; finalSummaryCharacters += 1) {
      const rows = asciiBudgetProjects(template, count, finalSummaryCharacters);
      try {
        const brief = buildDMSiteBrief(rows);
        if (brief.utf8ByteCount === DM_SITE_BRIEF_MAX_UTF8_BYTES) {
          atLimit = brief;
          rejectedRows = asciiBudgetProjects(template, count, finalSummaryCharacters + 1);
          break;
        }
      } catch (error) {
        if (!(error instanceof DMSiteBriefError) || error.code !== 'size_limit_exceeded') throw error;
        break;
      }
    }
  }

  assert.ok(atLimit, 'expected an ASCII fixture exactly at the UTF-8 byte cutoff');
  assert.ok(rejectedRows);
  assert.equal(atLimit.utf8ByteCount, DM_SITE_BRIEF_MAX_UTF8_BYTES);
  assert.ok(atLimit.charCount <= DM_SITE_BRIEF_MAX_CHARS);
  assert.equal(atLimit.approximatePlanningTokens, Math.ceil(atLimit.utf8ByteCount / 4));
  assert.throws(
    () => buildDMSiteBrief(rejectedRows),
    (error: unknown) => error instanceof DMSiteBriefError && error.code === 'size_limit_exceeded',
  );
});

test('site brief fails closed rather than dropping published projects when the complete set exceeds its budget', async () => {
  const source = await createEvalProjectSource();
  const template = (await source.projectLoader())[0];
  assert.ok(template);
  const rows = variableProjects(template, 60);

  assert.throws(
    () => buildDMSiteBrief(rows),
    (error: unknown) => error instanceof DMSiteBriefError && error.code === 'size_limit_exceeded',
  );
});

test('site brief source, config, read, validation, and unexpected-empty failures are fail closed', async (t) => {
  await t.test('invalid source configuration', async () => {
    await assert.rejects(
      loadDMSiteBrief({ env: { PUBLIC_PROJECT_SOURCE: 'catalog' } }),
      (error: unknown) => error instanceof PublicProjectDataError && error.code === 'invalid_source_mode',
    );
  });

  await t.test('missing database configuration', async () => {
    await assert.rejects(
      loadDMSiteBrief({ env: { PUBLIC_PROJECT_SOURCE: 'database' } }),
      (error: unknown) => error instanceof PublicProjectDataError && error.code === 'missing_config',
    );
  });

  await t.test('database read failure', async () => {
    await assert.rejects(
      loadDMSiteBrief({
        env: { PUBLIC_PROJECT_SOURCE: 'database' },
        db: { async query() { throw new Error('private database read details'); } },
      }),
      (error: unknown) => error instanceof PublicProjectDataError && error.code === 'read_failed',
    );
  });

  await t.test('persisted row validation failure', async () => {
    await assert.rejects(
      loadDMSiteBrief({
        env: { PUBLIC_PROJECT_SOURCE: 'database' },
        db: databaseRows([{ ...DATABASE_PROJECT_ROW, slug: '../private' }]),
      }),
      (error: unknown) => error instanceof PublicProjectDataError && error.code === 'read_failed',
    );
  });

  await t.test('unexpected empty published set', async () => {
    await assert.rejects(
      loadDMSiteBrief({
        env: { PUBLIC_PROJECT_SOURCE: 'database' },
        db: databaseRows([]),
      }),
      (error: unknown) => error instanceof PublicProjectDataError && error.code === 'empty_published_set',
    );
  });

  await t.test('invalid injected typed project', async () => {
    assert.throws(
      () => buildDMSiteBrief([{ id: 'invalid project id' } as ProjectDetailReadModel]),
      (error: unknown) => error instanceof DMSiteBriefError && error.code === 'validation_failed',
    );
  });
});

test('database mode brief uses only the published DB query result and never overlays catalog projects', async () => {
  const queries: string[] = [];
  const db: ProjectReadQueryable = {
    async query<Row = unknown>(sql: string) {
      queries.push(sql);
      return { rows: [DATABASE_PROJECT_ROW] as Row[] };
    },
  };
  const brief = await loadDMSiteBrief({
    env: { PUBLIC_PROJECT_SOURCE: 'database' },
    db,
  });

  assert.deepEqual(brief.content.projects.map((project) => project.id), ['db-only-brief']);
  assert.deepEqual(brief.content.projects.map((project) => project.route), ['/projects/db-only-brief']);
  assert.equal(queries.length, 1);
  assert.match(queries[0] ?? '', /lifecycle_state = 'published'/);
  assert.doesNotMatch(brief.promptText, /agentic-trader|exit-manager|legacy_catalog/);
});

function variableProjects(template: ProjectDetailReadModel, count: number): ProjectDetailReadModel[] {
  return Array.from({ length: count }, (_, index) => {
    const suffix = String(index).padStart(2, '0');
    const id = `brief-project-${suffix}`;
    return {
      ...template,
      id,
      slug: id,
      title: `Brief Project ${suffix}`,
      summary: `A concise public summary for project ${suffix}.\nIt stays on one deterministic line in the brief.`,
      dmArtifact: {
        ...template.dmArtifact,
        id,
        title: `Brief Project ${suffix}`,
        href: `/projects/${id}`,
      },
    };
  });
}

function unicodeBudgetProjects(
  template: ProjectDetailReadModel,
  count: number,
  finalSummaryUnicodeCharacters: number,
): ProjectDetailReadModel[] {
  return variableProjects(template, count).map((project, index) => ({
    ...project,
    summary: index === count - 1
      ? `${'界'.repeat(finalSummaryUnicodeCharacters)}${'a'.repeat(DM_SITE_BRIEF_SUMMARY_MAX_CHARS - finalSummaryUnicodeCharacters)}`
      : '界'.repeat(DM_SITE_BRIEF_SUMMARY_MAX_CHARS),
  }));
}

function asciiBudgetProjects(
  template: ProjectDetailReadModel,
  count: number,
  finalSummaryCharacters: number,
): ProjectDetailReadModel[] {
  const highEntropyAscii = (length: number) => 'aZ09Qx7M'.repeat(Math.ceil(length / 8)).slice(0, length);
  return variableProjects(template, count).map((project, index) => ({
    ...project,
    summary: highEntropyAscii(index === count - 1
      ? finalSummaryCharacters
      : DM_SITE_BRIEF_SUMMARY_MAX_CHARS),
  }));
}

function databaseRows(rows: unknown[]): ProjectReadQueryable {
  return {
    async query<Row = unknown>() {
      return { rows: rows as Row[] };
    },
  };
}

const DATABASE_PROJECT_ROW = {
  id: 'db-only-brief',
  slug: 'db-only-brief',
  title: 'DB Only Brief Project',
  tagline: 'A published database-only project.',
  area: 'AI & Developer Tools',
  year: 2026,
  lifecycle_state: 'published',
  activity: 'published',
  summary: 'This sentinel exists only in the injected published database result.',
  details: [],
  metrics: [],
  links: [],
  media: [],
  source: 'test_seed',
  published_at: '2026-07-15T00:00:00.000Z',
  archived_at: null,
};
