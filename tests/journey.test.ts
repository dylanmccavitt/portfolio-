/**
 * Public career-history gate.
 *
 * `PUBLIC_RESUME_TRACK_IDS` in `src/data/resume.ts` is the one door anything
 * public reads the career timeline through — the resume page, the per-track OG
 * images, and the DM corpus all go through it, and `boe` is deliberately behind
 * it. The homepage Journey list used to be a second, hardcoded career history
 * in `frost-data.js` that the allowlist did not govern at all, so a withheld
 * job could be published there with nothing to catch it.
 *
 * The list is now built from `publicResumeTracks()` (`src/lib/journey.ts`).
 * This suite holds that down from both ends: the rows are exactly the
 * allowlisted tracks, and no withheld track's text can appear in what the
 * homepage renders — including through the display-label map, which may only
 * shorten copy and must never introduce a row of its own.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const { RESUME, PUBLIC_RESUME_TRACK_IDS, publicResumeTracks } = await import('@/data/resume');
const { JOURNEY_LABELS } = await import('@/components/frost/frost-data.js');
const { publicJourneyRows } = await import('@/lib/journey');

const root = new URL('../', import.meta.url);
const rows = publicJourneyRows();

test('the Journey rows are exactly the allowlisted tracks, in source order', () => {
  assert.deepEqual(
    rows.map((row) => row.id),
    publicResumeTracks().map((track) => track.id),
  );
  assert.ok(rows.length > 0, 'the homepage must publish a Journey');
});

test('no track outside the allowlist reaches the homepage Journey', () => {
  const withheld = RESUME.tracks.filter((track) => !PUBLIC_RESUME_TRACK_IDS.includes(track.id));
  assert.ok(
    withheld.some((track) => track.id === 'boe'),
    'boe must stay off the public track allowlist — it is withheld from the site',
  );

  const rendered = JSON.stringify(rows);
  for (const track of withheld) {
    assert.ok(
      !rows.some((row) => row.id === track.id),
      `${track.id} is withheld from the site but has a Journey row`,
    );
    for (const text of [track.title, track.role]) {
      assert.ok(!rendered.includes(text), `${track.id} is withheld, but "${text}" is on the homepage`);
    }
  }
});

test('the label map is display copy only — it cannot add or withhold a row', () => {
  // A label for an id that is not allowlisted is inert, not a publication.
  const labelled = Object.keys(JOURNEY_LABELS as Record<string, unknown>);
  for (const id of labelled) {
    if (PUBLIC_RESUME_TRACK_IDS.includes(id)) continue;
    assert.ok(
      !rows.some((row) => row.id === id),
      `JOURNEY_LABELS names ${id}, which the allowlist withholds — it must not render`,
    );
  }

  // Every row has real copy, whether or not a label supplied it.
  for (const row of rows) {
    for (const [field, value] of Object.entries(row)) {
      assert.ok(
        typeof value === 'string' && value.trim() !== '',
        `Journey row ${row.id} has an empty ${field}`,
      );
    }
  }
});

test('frost-data.js no longer carries a career list of its own', async () => {
  const source = await readFile(new URL('src/components/frost/frost-data.js', root), 'utf8');
  assert.ok(
    !/export const JOURNEY\b/.test(source),
    'the ungoverned JOURNEY array is back — the Journey must come from the resume allowlist',
  );

  const island = await readFile(new URL('src/components/frost/FrostSite.jsx', root), 'utf8');
  assert.ok(
    !/\bJOURNEY\b/.test(island),
    'FrostSite must render the Journey rows it is handed, not a module-level list',
  );
});
