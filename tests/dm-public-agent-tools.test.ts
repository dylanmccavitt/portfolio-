import assert from 'node:assert/strict';
import test from 'node:test';
import { CATALOG } from '@/data/catalog';
import {
  loadPublicProfileEntries,
  parsePublicProfileEntries,
  PUBLIC_PROFILE_SITE_SUMMARY,
} from '@/data/profile';
import { buildCatalogShadowRecords } from '@/lib/db/catalog-shadow';
import { projectRecordToReadModels, type ProjectDetailReadModel, type ProjectReadQueryable } from '@/lib/db/project-reads';
import {
  createPublicAgentTools,
  GetContactInputSchema,
  GetProjectInputSchema,
  ReadResumeInputSchema,
  SearchProfileInputSchema,
  SearchProjectsInputSchema,
  type PublicProfileSourceEntry,
} from '@/lib/dm/public-agent-tools';

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
  assert.equal(SearchProfileInputSchema.safeParse({ query: 'leadership', categories: ['work'] }).success, true);
});

test('composition tool descriptions require every requested public source', () => {
  const run = createPublicAgentTools({ db: unusedDb(), loadProjects: async () => [project] });

  assert.match(run.readResume.description, /getContact/);
  assert.match(run.getContact.description, /readResume/);
  assert.match(run.getProject.description, /searchProjects/);
});

test('the public tool surface is exactly the five published-source tools', () => {
  const run = createPublicAgentTools({ db: unusedDb(), loadProjects: async () => [project] });

  assert.deepEqual(Object.keys(run.tools).sort(), [
    'getContact', 'getProject', 'readResume', 'searchProfile', 'searchProjects',
  ]);
});

test('project discovery stays compact while direct reads retain full evidence and artifact ids', async () => {
  const run = createPublicAgentTools({ db: unusedDb(), loadProjects: async () => [project] });

  const search = await run.searchProjects({ query: 'trading automation' });
  assert.equal(search.status, 'complete');
  assert.equal(search.projects[0]?.id, project.id);
  assert.deepEqual(search.artifactIds, []);
  assert.ok(search.evidenceIds.includes(`${project.id}:summary`));
  for (const field of ['about', 'notes', 'stack', 'metrics', 'links', 'artifactId', 'source', 'seo', 'shots']) {
    assert.equal(field in (search.projects[0] ?? {}), false, `discovery record must omit ${field}`);
  }
  assert.deepEqual(
    search.evidence.map((entry) => entry.field),
    ['identity', 'slug', 'href', 'area', 'status', 'year', 'activity', 'tagline', 'summary'],
  );

  const byId = await run.getProject.execute({ id: project.id });
  const bySlug = await run.getProject({ slug: project.slug });
  assert.equal(byId.status, 'complete');
  assert.deepEqual(byId.evidenceIds, bySlug.evidenceIds);
  assert.deepEqual(byId.artifactIds, [project.id]);
  assert.ok(byId.project?.about.length);
  assert.ok(byId.project?.stack.length);
  assert.ok(byId.project?.links.length);

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
  assert.deepEqual(resolvedByTitle.artifactIds, []);
});

test('serialized discovery payloads have a fixed ceiling and are materially smaller than full reads', async () => {
  const projects = [project, renamedProject()];
  const run = createPublicAgentTools({ db: unusedDb(), loadProjects: async () => projects });
  const discovery = await run.searchProjects({ query: 'trading automation', limit: 2 });
  const full = await Promise.all(projects.map(async (item) => (await run.getProject({ id: item.id })).project));
  const discoveryBytes = Buffer.byteLength(JSON.stringify(discovery.projects));
  const fullBytes = Buffer.byteLength(JSON.stringify(full));

  assert.equal(discovery.projects.length, 2);
  assert.ok(discoveryBytes <= 4_000, `discovery payload exceeded 4000 bytes: ${discoveryBytes}`);
  assert.ok(discoveryBytes * 2 <= fullBytes, `expected at least 50% reduction, got ${discoveryBytes}/${fullBytes}`);
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
    env: { PUBLIC_PROJECT_SOURCE: 'database' },
  });

  const visible = await run.getProject({ id: published.id });
  const hidden = await run.getProject({ id: draft.id });
  assert.equal(visible.status, 'complete');
  assert.equal(hidden.status, 'empty');
  assert.ok(sqlSeen.length > 0);
});

test('empty and failed searches return source-specific safe limitation categories', async () => {
  const projectSearch = createPublicAgentTools({
    db: unusedDb(),
    loadProjects: async () => [project],
  });
  const unmatched = await projectSearch.searchProjects({ query: 'quantum cryptography' });
  assert.equal(unmatched.status, 'empty');
  assert.deepEqual(unmatched.limitations, ['no_matching_published_projects']);

  const filtered = await projectSearch.searchProjects({
    query: 'projects',
    filters: { status: 'in progress' },
  });
  assert.equal(filtered.status, 'empty');
  assert.deepEqual(filtered.limitations, ['no_matching_published_project_filters']);

  const queryMissWithMatchingFilters = await projectSearch.searchProjects({
    query: 'quantum cryptography',
    filters: { status: project.status[0] },
  });
  assert.equal(queryMissWithMatchingFilters.status, 'empty');
  assert.deepEqual(queryMissWithMatchingFilters.limitations, ['no_matching_published_projects']);
});

test('profile search filters adapters to well-formed published public entries and sanitizes failures', async () => {
  const empty = createPublicAgentTools({ db: unusedDb(), loadProjects: async () => [project] });
  const unavailableProfile = await empty.searchProfile({ query: 'leadership' });
  assert.equal(unavailableProfile.status, 'empty');
  assert.deepEqual(unavailableProfile.profiles, []);
  assert.deepEqual(unavailableProfile.limitations, ['profile_source_not_available']);

  const entries: PublicProfileSourceEntry[] = [
    { id: 'public-one', category: 'work', title: 'Leadership', summary: 'Published public profile entry.', href: 'javascript:private()', publicationStatus: 'published', visibility: 'public' },
    { id: 'draft-one', category: 'work', title: 'Leadership draft', summary: 'Draft profile entry.', publicationStatus: 'draft', visibility: 'public' },
    { id: 'private-one', category: 'work', title: 'Private leadership', summary: 'Private profile entry.', publicationStatus: 'published', visibility: 'private' },
    { id: 'malformed id', category: 'work', title: 'Malformed leadership', summary: 'Malformed profile entry.', publicationStatus: 'published', visibility: 'public' } as PublicProfileSourceEntry,
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
  assert.doesNotMatch(JSON.stringify(profile), /malformed/);

  const failed = createPublicAgentTools({
    db: unusedDb(),
    loadProjects: async () => [project],
    loadProfileEntries: async () => { throw new Error('private profile adapter details'); },
  });
  const failedProfile = await failed.searchProfile({ query: 'leadership' });
  assert.equal(failedProfile.status, 'unavailable');
  assert.deepEqual(failedProfile.limitations, ['profile_source_not_available']);
  assert.doesNotMatch(JSON.stringify(failedProfile), /private profile adapter details|public_data_unavailable/);
});

test('the reviewed static profile source exposes exactly the nine approved entries and keeps unknown topics empty', async () => {
  const entries = await loadPublicProfileEntries();
  assert.deepEqual(entries.map((entry) => entry.id), [
    'short-bio',
    'career-change',
    'working-style',
    'skills-focus',
    'recruiter-faq',
    'practical-side-projects',
    'markets-and-trading',
    'homelab',
    'games-as-test-beds',
  ]);
  assert.ok(entries.every(
    (entry) => entry.publicationStatus === 'published' && entry.visibility === 'public',
  ));
  assert.equal(entries.find((entry) => entry.id === 'short-bio')?.summary, PUBLIC_PROFILE_SITE_SUMMARY);

  const run = createPublicAgentTools({
    db: unusedDb(),
    loadProjects: async () => [project],
    loadProfileEntries: loadPublicProfileEntries,
  });
  const known = await run.searchProfile({ query: 'New York City software engineer economics' });
  assert.equal(known.status, 'complete');
  assert.equal(known.profiles[0]?.id, 'short-bio');
  assert.ok(known.evidence.some((entry) => entry.id === 'profile:short-bio:summary'));

  const biography = await run.searchProfile({ query: 'Tell me about Dylan' });
  assert.equal(biography.profiles[0]?.id, 'short-bio');
  assert.ok(biography.evidence.some((entry) => entry.id === 'profile:short-bio:summary'));

  const interests = await run.searchProfile({ query: 'markets infrastructure', categories: ['interest'] });
  assert.deepEqual(interests.profiles.map((entry) => entry.id), ['homelab', 'markets-and-trading']);

  const unknown = await run.searchProfile({ query: 'favorite weekend hobby' });
  assert.equal(unknown.status, 'empty');
  assert.deepEqual(unknown.profiles, []);
  assert.deepEqual(unknown.evidence, []);

  const genuineHobbies = await run.searchProfile({ query: "What are some of Dylan's hobbies?" });
  assert.equal(genuineHobbies.status, 'empty');
  assert.deepEqual(genuineHobbies.profiles, []);

  const privateLife = await run.searchProfile({ query: 'What is Dylan like in his private life?' });
  assert.equal(privateLife.status, 'empty');
  assert.deepEqual(privateLife.profiles, []);

  for (const query of [
    'How does Dylan work in private life?',
    'How does Dylan work in his private-life?',
    'How does Dylan work in his personal life?',
    'What does Dylan value in private life?',
    'What are his interests and hobbies?',
    'What is his home address?',
  ]) {
    const unsupported = await run.searchProfile({ query });
    assert.equal(unsupported.status, 'empty', query);
    assert.deepEqual(unsupported.profiles, [], query);
  }

  assert.deepEqual(
    (await run.searchProfile({ query: 'How does Dylan work?' })).profiles.map((entry) => entry.id),
    ['working-style'],
  );
  assert.deepEqual(
    (await run.searchProfile({ query: 'Does Dylan require sponsorship?' })).profiles.map((entry) => entry.id),
    ['recruiter-faq'],
  );
  assert.deepEqual(
    (await run.searchProfile({ query: 'private funds legal work' })).profiles.map((entry) => entry.id),
    ['career-change'],
  );
});

test('the static profile loader rejects malformed input and excludes draft or private entries', () => {
  const visible = {
    id: 'visible', category: 'bio', title: 'Visible', summary: 'Approved.',
    publicationStatus: 'published', visibility: 'public',
  };
  assert.deepEqual(parsePublicProfileEntries([
    visible,
    { ...visible, id: 'draft', publicationStatus: 'draft' },
    { ...visible, id: 'private', visibility: 'private' },
  ]).map((entry) => entry.id), ['visible']);
  assert.throws(
    () => parsePublicProfileEntries([{ ...visible, id: 'malformed id' }]),
    /Invalid string|validation/i,
  );
});

test('empty, partial, error, cancellation, and timeout outcomes are explicit and sanitized', async () => {
  const many = createPublicAgentTools({ db: unusedDb(), loadProjects: async () => [project, renamedProject()] });
  assert.equal((await many.searchProjects({ query: 'project', limit: 1 })).status, 'partial');
  const empty = await many.searchProjects({ query: 'definitely-not-present' });
  assert.equal(empty.status, 'empty');
  assert.deepEqual(empty.limitations, ['no_matching_published_projects']);
  const missingProject = await many.getProject({ id: 'candidate-hidden' });
  assert.equal(missingProject.status, 'empty');
  assert.deepEqual(missingProject.limitations, ['no_matching_published_projects']);

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
