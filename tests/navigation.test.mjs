import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { URL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(absolute) : absolute;
    }),
  );
  return files.flat();
}

function anchorHrefs(html) {
  return [...html.matchAll(/<a\b[^>]*\bhref=(?:"([^"]+)"|'([^']+)')[^>]*>/gi)]
    .map((match) => match[1] ?? match[2]);
}

async function routeExists(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+|\/+$/g, '');
  const candidates = clean
    ? [
        path.join(DIST, clean),
        path.join(DIST, clean, 'index.html'),
        path.join(DIST, `${clean}.html`),
      ]
    : [path.join(DIST, 'index.html')];

  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return true;
    } catch {
      // Try the next static-output shape.
    }
  }
  return false;
}

test('every rendered internal navigation link reaches a built route or local anchor', async () => {
  const htmlFiles = (await filesUnder(DIST)).filter((file) => file.endsWith('.html'));
  const failures = [];

  for (const file of htmlFiles) {
    const html = await readFile(file, 'utf8');
    const ids = [...html.matchAll(/\bid=(?:"([^"]+)"|'([^']+)')/gi)]
      .map((match) => match[1] ?? match[2]);
    const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (duplicateIds.length > 0) {
      failures.push(`${path.relative(ROOT, file)} -> duplicate ids: ${[...new Set(duplicateIds)].join(', ')}`);
    }

    for (const href of anchorHrefs(html)) {
      if (href === '#!') continue; // Clears the CSS :target screenshot lightbox.

      const url = new URL(href, 'https://dylanmccavitt.xyz');
      if (url.origin !== 'https://dylanmccavitt.xyz') continue;

      if (href.startsWith('#')) {
        const target = decodeURIComponent(url.hash.slice(1));
        const targetCount = ids.filter((id) => id === target).length;
        if (target && targetCount !== 1) {
          failures.push(`${path.relative(ROOT, file)} -> ${href}`);
        }
        continue;
      }

      if (!(await routeExists(url.pathname))) {
        failures.push(`${path.relative(ROOT, file)} -> ${href}`);
      }
    }
  }

  assert.deepEqual(failures, []);
});

test('every configured permanent redirect reaches a built destination', async () => {
  const config = JSON.parse(await readFile(path.join(ROOT, 'vercel.json'), 'utf8'));
  const failures = [];

  for (const redirect of config.redirects) {
    assert.equal(redirect.permanent, true, `${redirect.source} must remain permanent`);
    if (redirect.destination.includes(':')) continue;
    if (!(await routeExists(redirect.destination))) {
      failures.push(`${redirect.source} -> ${redirect.destination}`);
    }
  }

  assert.deepEqual(failures, []);
});

test('project rows are native links that open directly by click, tap, or Enter', async () => {
  const html = await readFile(path.join(DIST, 'library', 'index.html'), 'utf8');
  const rows = [
    ...html.matchAll(
      /<a\b(?=[^>]*\bdata-track-id="([^"]+)")(?=[^>]*\bhref="([^"]+)")[^>]*>([\s\S]*?)<\/a>/gi,
    ),
  ];

  assert.ok(rows.length > 3, 'expected several project rows in the built library');
  for (const [, id, href, contents] of rows) {
    assert.equal(href, `/projects/${id}`);
    assert.doesNotMatch(contents, /<(?:button|input|select|textarea)\b/i);
  }

  const player = await readFile(path.join(ROOT, 'src', 'scripts', 'player.ts'), 'utf8');
  assert.doesNotMatch(player, /closest<HTMLAnchorElement>\('a\[data-track-id\]'\)/);
  assert.match(
    player,
    /closest\('input, textarea, select, a, button, \[contenteditable="true"\]'\)/,
    'global player shortcuts must not intercept Enter or other keys on links and controls',
  );
});

test('the player Contact link reaches the on-site contact destination', async () => {
  const html = await readFile(path.join(DIST, 'library', 'index.html'), 'utf8');
  assert.match(
    html,
    /<nav class="pb-right"[^>]*>[\s\S]*?<a href="\/journey\/now">contact<\/a>[\s\S]*?<\/nav>/,
  );
  assert.equal(await routeExists('/journey/now'), true);
});
