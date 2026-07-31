/**
 * DM corpus gate (#356).
 *
 * The corpus is the whole of what the public DM agent gets to know, so this
 * suite is the privacy boundary's regression gate rather than a shape smoke
 * test. It fails closed: the key allowlist below rejects any key that appears
 * in the serialized corpus without being named here, and any nested object at a
 * path the allowlist doesn't know. Adding a field upstream — a catalog column,
 * a profile flag, a resume attribute — breaks this suite until someone decides,
 * on purpose, that the field is publishable and bumps `DM_CORPUS_VERSION`.
 *
 * Two provenance suites sit alongside the key gate and ask the other half of
 * the question — not "is this key allowed" but "may this text be here at all":
 * one for profile entries that never cleared approval, one for resume tracks
 * the site withholds.
 *
 * THE CORPUS IS NOT PUBLISHED. It used to be served at `/dm/corpus.json`; it is
 * not any more, and the last test here holds that down by scanning `src/pages`
 * for anything that would put it back on the wire. The bytes asserted below are
 * the ones `npm run dm:corpus` writes for the service's own deployment — the
 * only copy that leaves this repository.
 */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const { CATALOG } = await import('@/data/catalog');
const { PUBLIC_PROFILE_IDENTITY, PROFILE_SOURCE_UNFILTERED_FOR_LEAK_TEST } = await import(
  '@/data/profile'
);
const { RESUME, PUBLIC_RESUME_TRACK_IDS } = await import('@/data/resume');
const { DM_CORPUS_ANCHORS, DM_CORPUS_VERSION, DM_PROFILE_ENTRY_IDS, buildDmCorpus } =
  await import('@/lib/dm/corpus');
const { buildDmPageManifest } = await import('@/lib/dm/page-manifest');

const root = new URL('../', import.meta.url);

// Exactly what `scripts/dm-corpus.ts` writes, so the leak scans below run over
// the bytes that actually reach the service.
const built = await buildDmCorpus();
const body = `${JSON.stringify(built, null, 2)}\n`;
const corpus = JSON.parse(body) as Record<string, unknown>;

/**
 * Every object path the corpus may contain, mapped to the keys it may carry.
 * Array paths carry a `[]` suffix. A path missing from this map is a failure,
 * not a pass — that is what makes the gate closed.
 */
const ALLOWED_KEYS: Record<string, readonly string[]> = {
  $: ['version', 'source', 'site', 'profile', 'resume', 'projects', 'page'],
  '$.site': ['origin', 'owner'],
  '$.profile': ['name', 'role', 'focus', 'location', 'status', 'email', 'summary', 'entries'],
  '$.profile.entries[]': ['id', 'category', 'title', 'summary', 'href'],
  '$.resume': ['title', 'tracks'],
  '$.resume.tracks[]': ['id', 'title', 'role', 'when', 'current', 'about', 'notes', 'credits', 'era'],
  '$.projects[]': [
    'id',
    'slug',
    'href',
    'title',
    'line',
    'summary',
    'area',
    'status',
    'year',
    'activity',
    'about',
    'notes',
    'stack',
    'metrics',
    'links',
    'shots',
  ],
  '$.projects[].stack[]': ['label', 'value'],
  '$.projects[].metrics[]': ['value', 'label'],
  '$.projects[].links[]': ['label', 'href'],
  '$.projects[].shots[]': ['src', 'caption'],
  '$.page': ['anchors', 'projectIds', 'actions'],
};

function walk(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, `${path}[]`);
    return;
  }
  if (value === null || typeof value !== 'object') return;

  const allowed = ALLOWED_KEYS[path];
  assert.ok(allowed, `${path} is an object the corpus allowlist does not know about`);
  for (const key of Object.keys(value)) {
    assert.ok(allowed.includes(key), `${path}.${key} is not an allowed corpus key`);
    walk((value as Record<string, unknown>)[key], path === '$' ? `$.${key}` : `${path}.${key}`);
  }
}

test('the corpus is versioned JSON that names its provenance, not its files', () => {
  assert.equal(corpus.version, DM_CORPUS_VERSION);
  assert.equal(corpus.version, 1);

  // `source` is read by strangers: it may identify where the facts come from,
  // never how the repository is laid out.
  const source = corpus.source as string;
  assert.ok(source.length > 0);
  assert.doesNotMatch(source, /src\/|\.ts\b|\//, `corpus.source discloses repo structure: ${source}`);
});

test('no key outside the allowlist appears anywhere in the corpus', () => {
  walk(corpus, '$');
});

test('the corpus carries every published project, and page.projectIds matches', () => {
  const projects = corpus.projects as Array<Record<string, unknown>>;
  const page = corpus.page as Record<string, unknown>;
  const ids = projects.map((project) => project.id as string);

  assert.equal(projects.length, CATALOG.length);
  assert.deepEqual([...ids].sort(), CATALOG.map((project) => project.id).sort());
  assert.deepEqual(page.projectIds, ids);

  for (const project of projects) {
    assert.equal(
      (project.about as string[]).length,
      3,
      `${project.id as string}: about must stay [problem, approach, outcome]`,
    );
    assert.match(project.href as string, /^\/projects\/[a-z0-9-]+$/);
  }
});

/**
 * Provenance, checked against the raw source rather than against the filtered
 * output — asserting that filtered output is filtered proves nothing. The raw
 * array is imported here and nowhere else in the shipping code.
 */
const approved = PROFILE_SOURCE_UNFILTERED_FOR_LEAK_TEST.filter(
  (entry) => entry.publicationStatus === 'published' && entry.visibility === 'public',
);

/**
 * Canaries for the leak scan. Every real profile entry is approved today, so
 * scanning the real unapproved set would loop zero times and prove nothing
 * about this build. These are handed to the builder as extra raw input instead
 * — the real source array is never mutated, and the override goes through the
 * very same published+public filter the default input does.
 *
 * The approved canary replaces an allowlisted entry. It is the positive
 * control: if it fails to appear, the injection never reached the builder and
 * the whole scan would be vacuous again for a different reason.
 */
const CANARY_APPROVED = {
  id: 'short-bio',
  category: 'canary',
  title: 'Canary approved KESTRELMARK',
  summary: 'Canary approved summary KESTRELMARK, which clears both flags and must reach the corpus.',
  publicationStatus: 'published',
  visibility: 'public',
} as const;

const CANARY_UNAPPROVED = [
  {
    id: 'canary-draft',
    category: 'canary',
    title: 'Canary draft HALDENVOX',
    summary: 'Canary draft summary HALDENVOX, unpublished and never publishable.',
    href: 'https://example.invalid/canary-draft',
    publicationStatus: 'draft',
    visibility: 'public',
  },
  {
    id: 'canary-private',
    category: 'canary',
    title: 'Canary private TORNWICKET',
    summary: 'Canary private summary TORNWICKET, published but marked private and never publishable.',
    publicationStatus: 'published',
    visibility: 'private',
  },
] as const;

const seeded = await buildDmCorpus({
  profileSource: [
    ...PROFILE_SOURCE_UNFILTERED_FOR_LEAK_TEST.filter((entry) => entry.id !== CANARY_APPROVED.id),
    CANARY_APPROVED,
    ...CANARY_UNAPPROVED,
  ],
});
const seededBody = JSON.stringify(seeded);

test('no text from an unapproved profile entry appears anywhere in the corpus', () => {
  // The positive control first: without it, a builder that ignored the seeded
  // input would sail through the scan below.
  assert.ok(
    seededBody.includes(CANARY_APPROVED.summary),
    'the seeded input never reached the builder — the leak scan below would prove nothing',
  );

  for (const entry of CANARY_UNAPPROVED) {
    for (const text of [entry.summary, entry.title, entry.id]) {
      // Searched in the serialized body, so a leak fails here whatever field it
      // travelled in — a summary hoisted to `profile.summary` included. Both
      // bodies are scanned: the one the endpoint ships, and the one built from
      // an input that really did carry unapproved entries.
      const encoded = JSON.stringify(text).slice(1, -1);
      for (const [label, haystack] of [
        ['the shipped corpus', body],
        ['the corpus built from an input carrying unapproved entries', seededBody],
      ] as const) {
        assert.ok(
          !haystack.includes(encoded),
          `${entry.id} is not published+public, but its text is in ${label}`,
        );
      }
    }
  }
});

/**
 * The same provenance idea, applied to the career timeline. `RESUME.tracks` is
 * the full history; the site publishes the allowlisted subset, and the corpus
 * has to publish exactly that and no more. `boe` is the case that matters: a
 * real job kept off the resume page on purpose.
 */
test('no resume track outside the public allowlist contributes text to the corpus', () => {
  const withheld = RESUME.tracks.filter((track) => !PUBLIC_RESUME_TRACK_IDS.includes(track.id));
  assert.ok(
    withheld.some((track) => track.id === 'boe'),
    'boe must stay off the public track allowlist — it is withheld from the site',
  );

  for (const track of withheld) {
    // The track's own prose. Ids and credits are left out of the substring
    // scan — a three-letter id and a bare year collide with ordinary text —
    // and the exact id set is pinned by the assertion below instead.
    for (const text of [track.title, track.role, ...track.about, ...track.notes]) {
      const encoded = JSON.stringify(text).slice(1, -1);
      assert.ok(
        !body.includes(encoded),
        `${track.id} is withheld from the site, but "${text}" is in the corpus`,
      );
    }
  }

  const tracks = (corpus.resume as { tracks: Array<Record<string, unknown>> }).tracks;
  assert.deepEqual(
    tracks.map((track) => track.id),
    RESUME.tracks.filter((track) => PUBLIC_RESUME_TRACK_IDS.includes(track.id)).map((t) => t.id),
    'the corpus timeline must be exactly the allowlisted tracks, in source order',
  );
});

test('the corpus profile is the project-relevant approved subset, summary included', () => {
  const profile = corpus.profile as Record<string, unknown>;
  const entries = profile.entries as Array<Record<string, unknown>>;

  assert.ok(entries.length > 0, 'the corpus must carry at least one profile entry');
  assert.deepEqual(
    entries.map((entry) => entry.id),
    [...DM_PROFILE_ENTRY_IDS],
    'the corpus profile entries must stay on the durable project-relevant allowlist',
  );
  assert.ok(
    entries.every((entry) => approved.some((candidate) => candidate.id === entry.id)),
    'every selected corpus profile entry must still clear the public approval boundary',
  );

  // The site summary is published today, and it is verbatim from an approved
  // entry. Revoking either flag on the entry that supplies it must drop the
  // field, not fall back to the raw source.
  assert.equal(typeof profile.summary, 'string', 'the corpus must carry a site summary');
  assert.ok(
    approved.some((entry) => entry.summary === profile.summary),
    'profile.summary must be the summary of an entry that cleared both approval flags',
  );
});

test('stale peripheral profile language stays out of the project-first corpus', () => {
  for (const stale of [
    'options-exit tooling',
    'browser games as repeatable test beds',
    'dozens of disposable design prototypes',
    'with pi in the mix',
    'small consumer apps',
    'Shippo',
  ]) {
    assert.ok(!body.includes(stale), `stale corpus language survived: ${stale}`);
  }
});

test('the identity block matches what the homepage publishes', async () => {
  const frostData = await readFile(new URL('src/components/frost/frost-data.js', root), 'utf8');
  const profile = corpus.profile as Record<string, string>;

  for (const [key, value] of Object.entries(PUBLIC_PROFILE_IDENTITY)) {
    assert.equal(profile[key], value);
    assert.ok(
      frostData.includes(value),
      `PROFILE in frost-data.js no longer carries ${key} "${value}" — the corpus identity has drifted`,
    );
  }
});

test('page.anchors matches the sections the Frost island renders', async () => {
  const island = await readFile(new URL('src/components/frost/FrostSite.jsx', root), 'utf8');
  // Any section carrying the class counts, whatever else it carries: a section
  // may take a second class for its own layout (About is set as marginalia and
  // has `frost-about`) without leaving DM's anchor list. What this holds down
  // is the *set and order* of anchored sections, not how they are styled — an
  // exact-attribute match would have read a styling change as a missing anchor.
  // The lookahead is load-bearing: `\b` also matches before a hyphen, so a
  // `frost-site-section-something` class would have counted as an anchored
  // section. The class must end at a space or the closing quote.
  const rendered = [
    ...island.matchAll(/className="(?:[^"]*\s)?frost-site-section(?=[\s"])[^"]*" id="([a-z]+)"/g),
  ].map(([, id]) => id);

  assert.deepEqual(rendered, [...DM_CORPUS_ANCHORS]);
  assert.deepEqual((corpus.page as Record<string, unknown>).anchors, [...DM_CORPUS_ANCHORS]);
});

test('page.actions is the closed action vocabulary', () => {
  assert.deepEqual((corpus.page as Record<string, unknown>).actions, ['go', 'lit', 'open', 'litContact']);
});

/**
 * The manifest is the browser's whole share of this file. It has to stay equal
 * to the corpus's own `page` block — the client's allowlist and the service's
 * tool enums must agree on what a legal target is, or a valid action gets
 * dropped in the browser and looks like a broken card.
 */
test('the page-action manifest is exactly the corpus page block', async () => {
  const manifest = await buildDmPageManifest();
  assert.deepEqual(manifest, corpus.page);
});

/**
 * The manifest carries the allowlist and nothing else. This is the assertion
 * that keeps a well-meaning future change from "just adding" a summary, an
 * email, or a project blurb to the prop the island ships to every visitor.
 */
test('the manifest carries no facts about anyone', async () => {
  const manifest = (await buildDmPageManifest()) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(manifest).sort(), ['actions', 'anchors', 'projectIds']);

  // Every value in it is a short identifier the homepage already renders: the
  // section ids in the nav, and the Work cards' own project ids.
  const serialized = JSON.stringify(manifest);
  const profile = corpus.profile as { entries: Array<{ summary: string }>; summary?: string };
  for (const text of [profile.summary ?? '', ...profile.entries.map((entry) => entry.summary)]) {
    if (text === '') continue;
    assert.ok(!serialized.includes(text), 'profile prose reached the browser manifest');
  }
});

/**
 * THE CORPUS HAS NO PUBLIC URL. `/dm/corpus.json` was a real route once, and
 * deleting a file is not a control — this is. Any page that imported the
 * builder would serialize approved-but-unpublished material onto the CDN, so
 * the check is on the import, not on a filename.
 */
test('no page serves the corpus, and nothing in the browser bundle builds it', async () => {
  const walk = async (dir: string): Promise<string[]> => {
    const entries = await readdir(new URL(dir, root), { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const path = `${dir}${entry.name}`;
      if (entry.isDirectory()) files.push(...(await walk(`${path}/`)));
      else files.push(path);
    }
    return files;
  };

  for (const dir of ['src/pages/', 'src/components/', 'src/layouts/']) {
    for (const file of await walk(dir)) {
      const source = await readFile(new URL(file, root), 'utf8');
      assert.ok(
        !/@\/lib\/dm\/corpus|buildDmCorpus/.test(source),
        `${file} pulls in the corpus builder — the corpus must not be served or bundled`,
      );
      assert.ok(
        !/corpus\.json/.test(source),
        `${file} references a corpus document — the corpus has no public URL`,
      );
    }
  }
});
