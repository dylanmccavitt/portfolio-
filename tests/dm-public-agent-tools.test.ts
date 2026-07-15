import assert from 'node:assert/strict';
import test from 'node:test';
import { CATALOG } from '@/data/catalog';
import { buildCatalogShadowRecords } from '@/lib/db/catalog-shadow';
import { projectRecordToReadModels, type ProjectDetailReadModel, type ProjectReadQueryable } from '@/lib/db/project-reads';
import {
  createPublicAgentTools,
  GetContactInputSchema,
  GetProjectInputSchema,
  ReadResumeInputSchema,
  SearchProfileInputSchema,
  SearchProjectsInputSchema,
  SearchPublicSourcesInputSchema,
  type PublicProfileSourceEntry,
} from '@/lib/dm/public-agent-tools';
import type { PublicRagSearchConfig } from '@/lib/rag/retrieval';

const project = publishedProject();

test('public agent tool schemas are strict and bound their required inputs', () => {
  assert.equal(SearchProjectsInputSchema.safeParse({ query: 'automation', limit: 4 }).success, true);
  assert.equal(SearchProjectsInputSchema.safeParse({ query: '', limit: 4 }).success, false);
  assert.equal(SearchProjectsInputSchema.safeParse({ query: 'automation', private: true }).success, false);
  assert.equal(GetProjectInputSchema.safeParse({ id: project.id }).success, true);
  assert.equal(GetProjectInputSchema.safeParse({ slug: project.slug }).success, true);
  assert.equal(GetProjectInputSchema.safeParse({ id: project.id, slug: project.slug }).success, false);
  assert.equal(GetProjectInputSchema.safeParse({}).success, false);
  assert.equal(ReadResumeInputSchema.safeParse({ query: 'engineering', trackIds: ['now'] }).success, true);
  assert.equal(GetContactInputSchema.safeParse({}).success, true);
  assert.equal(GetContactInputSchema.safeParse({ credential: 'nope' }).success, false);
  assert.equal(SearchPublicSourcesInputSchema.safeParse({ query: 'public proof', projectIds: [project.id] }).success, true);
  assert.equal(SearchProfileInputSchema.safeParse({ query: 'leadership', categories: ['work'] }).success, true);
});

test('project, resume, and contact tools return sanitized public records with stable evidence and artifact ids', async () => {
  const run = createPublicAgentTools({ db: unusedDb(), loadProjects: async () => [project] });

  const search = await run.searchProjects({ query: 'trading automation' });
  assert.equal(search.status, 'complete');
  assert.equal(search.projects[0]?.id, project.id);
  assert.deepEqual(search.artifactIds, [project.id]);
  assert.ok(search.evidenceIds.includes(`${project.id}:summary`));
  assert.equal('source' in (search.projects[0] ?? {}), false);
  assert.equal('seo' in (search.projects[0] ?? {}), false);
  assert.equal('shots' in (search.projects[0] ?? {}), false);

  const byId = await run.getProject.execute({ id: project.id });
  const bySlug = await run.getProject({ slug: project.slug });
  assert.equal(byId.status, 'complete');
  assert.deepEqual(byId.evidenceIds, bySlug.evidenceIds);
  assert.deepEqual(byId.artifactIds, [project.id]);

  const resume = await run.readResume({ query: 'open opportunities', trackIds: ['now'] });
  assert.equal(resume.status, 'complete');
  assert.deepEqual(resume.tracks.map((track) => track.id), ['now']);
  assert.deepEqual(resume.tracks[0]?.projectIds, [project.id]);
  assert.deepEqual(resume.artifactIds, ['now']);
  assert.ok(resume.evidenceIds.includes('resume:now:role'));

  const allResumeTracks = await run.readResume({});
  const emptyResumeFilter = await run.readResume({ trackIds: [] });
  assert.equal(emptyResumeFilter.status, 'complete');
  assert.deepEqual(
    emptyResumeFilter.tracks.map((track) => track.id),
    allResumeTracks.tracks.map((track) => track.id),
  );

  const contact = await run.getContact({});
  assert.equal(contact.status, 'complete');
  assert.equal(contact.contact?.email, 'dylanmccavitt@outlook.com');
  assert.deepEqual(contact.artifactIds, ['contact']);
  assert.ok(contact.evidenceIds.includes('contact:email'));
});

test('title-only project names can use search when their stable id or slug is unknown', async () => {
  const titleOnlyProject = publishedCatalogProject('nhf');
  const run = createPublicAgentTools({ db: unusedDb(), loadProjects: async () => [titleOnlyProject] });

  const unresolvedDirectRead = await run.getProject({ id: 'No Hard Feelings' });
  assert.equal(unresolvedDirectRead.status, 'empty');

  const resolvedByTitle = await run.searchProjects({ query: 'No Hard Feelings', limit: 1 });
  assert.equal(resolvedByTitle.status, 'complete');
  assert.deepEqual(resolvedByTitle.projects.map((item) => item.id), ['nhf']);
  assert.ok(resolvedByTitle.evidenceIds.includes('nhf:identity'));
  assert.deepEqual(resolvedByTitle.artifactIds, ['nhf']);
});

test('the run-local ledger records only evidence returned by tools in that run', async () => {
  const run = createPublicAgentTools({ db: unusedDb(), loadProjects: async () => [project] });
  assert.deepEqual(run.evidenceLedger.snapshot(), []);
  assert.equal('record' in run.evidenceLedger, false);
  assert.equal(run.evidenceLedger.has(`${project.id}:summary`), false);

  const result = await run.getProject({ id: project.id });
  assert.equal(run.evidenceLedger.has(`${project.id}:summary`), true);
  assert.deepEqual(
    run.evidenceLedger.resolve([`${project.id}:summary`, 'conversation:invented-fact']).map((item) => item.id),
    [`${project.id}:summary`],
  );
  assert.deepEqual(
    new Set(run.evidenceLedger.snapshot().map((item) => item.id)),
    new Set(result.evidenceIds),
  );

  await run.getProject({ id: project.id });
  assert.equal(run.evidenceLedger.snapshot().length, result.evidenceIds.length, 'stable ids deduplicate repeat calls');
});

test('deployed project reads use the published-only query and never surface draft rows', async () => {
  const [published, draft] = buildCatalogShadowRecords(CATALOG.slice(0, 2));
  assert.ok(published && draft);
  const sqlSeen: string[] = [];
  const db: ProjectReadQueryable = {
    async query<Row = unknown>(sql: string) {
      sqlSeen.push(sql);
      assert.match(sql, /WHERE lifecycle_state = 'published'/);
      return { rows: [{ ...published, lifecycle_state: 'published', published_at: '2026-07-13T00:00:00.000Z' }] as Row[] };
    },
  };
  const run = createPublicAgentTools({
    db,
    env: { PUBLIC_PROJECT_PAGES_FROM_DB: 'true' },
  });

  const visible = await run.getProject({ id: published.id });
  const hidden = await run.getProject({ id: draft.id });
  assert.equal(visible.status, 'complete');
  assert.equal(hidden.status, 'empty');
  assert.ok(sqlSeen.length > 0);
});

test('approved public-source search composes with project tools and rechecks every citation boundary', async () => {
  const config = publicRagConfig();
  const run = createPublicAgentTools({
    db: unusedDb(),
    loadProjects: async () => [project],
    createRagConfig: async () => config,
    ragSearch: async (_query, received) => {
      assert.deepEqual(received.sources.map((source) => source.id), ['rag-public']);
      return {
        citations: [
          {
            ragSourceId: 'rag-public',
            projectId: project.id,
            fileId: 'file-public',
            filename: 'approved.md',
            score: 0.9,
            text: 'Approved public evidence returned for the published project.',
          },
          {
            ragSourceId: 'rag-private',
            projectId: 'candidate-hidden',
            fileId: 'file-private',
            filename: 'private.md',
            score: 1,
            text: 'Private candidate evidence must never cross the public tool boundary.',
          },
        ],
      };
    },
  });

  const projects = await run.searchProjects({ query: 'trading automation' });
  const sources = await run.searchPublicSources({ query: 'public evidence', projectIds: [projects.projects[0]!.id] });
  assert.equal(sources.status, 'partial');
  assert.deepEqual(sources.sources.map((source) => source.id), ['rag-public']);
  assert.equal('fileId' in (sources.sources[0] ?? {}), false);
  assert.doesNotMatch(JSON.stringify(sources), /candidate-hidden|private\.md|file-private/);
  assert.equal(run.evidenceLedger.has('citation:rag-public'), true);
  assert.equal(run.evidenceLedger.has('citation:rag-private'), false);

  const omittedProjectFilter = await run.searchPublicSources({ query: 'public evidence' });
  const emptyProjectFilter = await run.searchPublicSources({ query: 'public evidence', projectIds: [] });
  assert.deepEqual(
    emptyProjectFilter.sources.map((source) => source.id),
    omittedProjectFilter.sources.map((source) => source.id),
  );

  const missingConfig = createPublicAgentTools({
    db: unusedDb(),
    loadProjects: async () => [project],
    createRagConfig: async () => config,
  });
  const unavailable = await missingConfig.searchPublicSources({ query: 'public evidence' });
  assert.equal(unavailable.status, 'unavailable');
  assert.deepEqual(unavailable.limitations, ['public_source_config_unavailable']);
});

test('profile search is honestly empty before #194 and filters a later adapter to published public entries', async () => {
  const empty = createPublicAgentTools({ db: unusedDb(), loadProjects: async () => [project] });
  const unavailableProfile = await empty.searchProfile({ query: 'leadership' });
  assert.equal(unavailableProfile.status, 'empty');
  assert.deepEqual(unavailableProfile.profiles, []);
  assert.deepEqual(unavailableProfile.limitations, ['profile_source_not_available']);

  const entries: PublicProfileSourceEntry[] = [
    { id: 'public-one', category: 'work', title: 'Leadership', summary: 'Published public profile entry.', href: 'javascript:private()', publicationStatus: 'published', visibility: 'public' },
    { id: 'draft-one', category: 'work', title: 'Leadership draft', summary: 'Draft profile entry.', publicationStatus: 'draft', visibility: 'public' },
    { id: 'private-one', category: 'work', title: 'Private leadership', summary: 'Private profile entry.', publicationStatus: 'published', visibility: 'private' },
  ];
  const ready = createPublicAgentTools({
    db: unusedDb(),
    loadProjects: async () => [project],
    loadProfileEntries: async () => entries,
  });
  const profile = await ready.searchProfile({ query: 'leadership', categories: ['work'] });
  assert.equal(profile.status, 'complete');
  assert.deepEqual(profile.profiles.map((entry) => entry.id), ['public-one']);
  assert.equal(profile.profiles[0]?.href, undefined);
  assert.doesNotMatch(JSON.stringify(profile), /draft-one|private-one/);
});

test('empty, partial, error, cancellation, and timeout outcomes are explicit and sanitized', async () => {
  const many = createPublicAgentTools({ db: unusedDb(), loadProjects: async () => [project, renamedProject()] });
  assert.equal((await many.searchProjects({ query: 'project', limit: 1 })).status, 'partial');
  assert.equal((await many.searchProjects({ query: 'definitely-not-present' })).status, 'empty');
  assert.equal((await many.getProject({ id: 'candidate-hidden' })).status, 'empty');

  const failed = createPublicAgentTools({
    db: unusedDb(),
    loadProjects: async () => { throw new Error('private database details'); },
  });
  const failure = await failed.searchProjects({ query: 'project' });
  assert.equal(failure.status, 'unavailable');
  assert.equal(failure.query, 'project');
  assert.deepEqual(failure.limitations, ['public_data_unavailable']);
  assert.doesNotMatch(JSON.stringify(failure), /private database details/);

  const controller = new AbortController();
  controller.abort(new Error('visitor-specific cancellation details'));
  const cancelled = await many.getContact({}, { signal: controller.signal });
  assert.equal(cancelled.status, 'unavailable');
  assert.deepEqual(cancelled.limitations, ['cancelled']);
  assert.doesNotMatch(JSON.stringify(cancelled), /visitor-specific/);

  const timed = createPublicAgentTools({
    db: unusedDb(),
    timeoutMs: 10,
    loadProjects: async () => await new Promise<ProjectDetailReadModel[]>(() => {}),
  });
  const timeout = await timed.searchProjects({ query: 'project' });
  assert.equal(timeout.status, 'unavailable');
  assert.deepEqual(timeout.limitations, ['timeout']);
});

test('resume remains available with an explicit partial status when project cross-links are unavailable', async () => {
  const run = createPublicAgentTools({
    db: unusedDb(),
    loadProjects: async () => { throw new Error('db unavailable'); },
  });
  const resume = await run.readResume({ trackIds: ['now', 'missing-track'] });
  assert.equal(resume.status, 'partial');
  assert.deepEqual(resume.tracks.map((track) => track.id), ['now']);
  assert.deepEqual(resume.tracks[0]?.projectIds, []);
  assert.deepEqual(resume.limitations, ['unknown_track_ids_omitted', 'published_project_links_unavailable']);
});

function publishedProject(): ProjectDetailReadModel {
  return publishedCatalogProject(CATALOG[0]!.id);
}

function publishedCatalogProject(id: string): ProjectDetailReadModel {
  const record = buildCatalogShadowRecords(CATALOG).find((candidate) => candidate.id === id);
  assert.ok(record);
  return projectRecordToReadModels({
    ...record,
    lifecycle_state: 'published',
    published_at: '2026-07-13T00:00:00.000Z',
  }).detail;
}

function renamedProject(): ProjectDetailReadModel {
  return {
    ...project,
    id: 'project-two',
    slug: 'project-two',
    title: 'Project Two',
    dmArtifact: { ...project.dmArtifact, id: 'project-two', href: '/projects/project-two', title: 'Project Two' },
  };
}

function unusedDb(): ProjectReadQueryable {
  return { async query() { throw new Error('unexpected database query'); } };
}

function publicRagConfig(): PublicRagSearchConfig {
  const sources = [
    { id: 'rag-public', project_id: project.id, vector_store_id: 'vs-public', openai_file_id: 'file-public' },
    { id: 'rag-private', project_id: 'candidate-hidden', vector_store_id: 'vs-private', openai_file_id: 'file-private' },
  ];
  return {
    sources,
    minTextChars: 1,
    scoreThreshold: 0,
    tool: {
      vectorStoreIds: ['vs-public', 'vs-private'],
      filters: {
        type: 'and',
        filters: [
          { type: 'eq', key: 'visibility', value: 'public' },
          { type: 'in', key: 'project_id', value: sources.map((source) => source.project_id) },
          { type: 'in', key: 'rag_source_id', value: sources.map((source) => source.id) },
        ],
      },
      maxNumResults: 4,
      ranking: { ranker: 'auto', scoreThreshold: 0 },
    },
  };
}
