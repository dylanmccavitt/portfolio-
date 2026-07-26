/**
 * Route coverage gate (#323, reconciled to the Frost site in #342).
 *
 * The owner's "routes working" criterion had no check behind it. This suite
 * enumerates every HTML route the site actually serves — discovered from
 * `src/pages`, with dynamic segments expanded from the same data the pages use —
 * and asserts three things per route:
 *
 *   1. it appears in `src/pages/sitemap.xml.ts`'s rendered output, unless it is
 *      a redirect stub (a meta-refresh page into a `/#anchor`), which must be
 *      absent from the sitemap instead;
 *   2. it renders through the Frost shell (the FrostSite island on `/`,
 *      `.frost-doc` pages on the rest) or is a redirect stub;
 *   3. it is reachable by the agent's route allowlist in `src/lib/dm/guide.ts`.
 *
 * Discovery is filesystem-driven on purpose: adding `src/pages/about.astro`
 * without touching the sitemap fails this suite rather than shipping silently.
 */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

// Hermetic source selection: the sitemap resolves its project rows from a
// database when any DB env key is present. Tests must not depend on ambient
// developer configuration, so the keys are removed from this test process
// before `@/lib/public-projects` is imported. Values are never read or logged.
for (const key of [
  'DATABASE_URL',
  'POSTGRES_URL',
  'PORTFOLIO_DATABASE_URL',
  'PORTFOLIO_POSTGRES_URL',
  'PUBLIC_PROJECT_SOURCE',
  'VERCEL',
  'VERCEL_ENV',
  'VERCEL_REGION',
]) {
  delete process.env[key];
}

const { loadPublicProjectDetails } = await import('@/lib/public-projects');
const { isAllowedGuideActionDestination } = await import('@/lib/dm/guide');
const { GET: sitemapGet } = await import('@/pages/sitemap.xml.ts');

const root = new URL('../', import.meta.url);
const read = (path: string) => readFile(new URL(path, root), 'utf8');
const SITE = new URL('https://dylanmccavitt.xyz');

/**
 * Page files under `src/pages` that do not serve an HTML route in the sitemap
 * sense. Each entry is a directory or filename, with the reason it is skipped.
 */
const NON_ROUTE_ENTRIES: Record<string, string> = {
  api: 'JSON endpoints, not indexable pages',
  og: 'generated Open Graph images, not indexable pages',
  'sitemap.xml.ts': 'the sitemap itself',
  '404.astro': 'error page; deliberately absent from the sitemap (#25)',
};

/**
 * Redirect stubs: pages whose whole purpose is a meta-refresh into a Frost
 * anchor. They are served (so old links don't 404 without JS) but are
 * deliberately absent from the sitemap and carry no shell or allowlist duty.
 */
const REDIRECT_STUBS: Record<string, string> = {
  '/contact': 'meta-refresh into /#contact since the Frost cutover',
  '/journey': 'meta-refresh into /#journey since the Frost cutover',
  '/library': 'meta-refresh into /#work since the Frost cutover',
};

/**
 * `/resume` is served and sitemapped but absent from the agent's route
 * allowlist: `DMPageContextKind` has no value for it, and adding one has to
 * propagate through the guide, the runtime, the client, and the tool boundary.
 * Tracked as issue #318 — agent-rework scope, deliberately not fixed here.
 * This allowance keeps the gap visible instead of silent.
 */
const AGENT_ALLOWLIST_EXEMPT: Record<string, string> = {
  '/resume': 'no DMPageContextKind for the résumé route yet — see issue #318',
};

/** Normalise to a leading-slash, no-trailing-slash comparison key. */
function normalize(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : '/';
}

interface DiscoveredRoute {
  /** Concrete served path, normalised. */
  path: string;
  /** `src/pages`-relative file that serves it. */
  file: string;
}

/** Walk `src/pages` and return every route pattern with its source file. */
async function discoverRoutePatterns(dir = '', prefix = ''): Promise<Array<{ pattern: string; file: string }>> {
  const entries = await readdir(new URL(`src/pages/${dir}`, root), { withFileTypes: true });
  const found: Array<{ pattern: string; file: string }> = [];

  for (const entry of entries) {
    if (entry.name in NON_ROUTE_ENTRIES) continue;
    const relative = dir ? `${dir}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      found.push(...(await discoverRoutePatterns(relative, `${prefix}/${entry.name}`)));
      continue;
    }
    if (!entry.name.endsWith('.astro')) continue;

    const base = entry.name.replace(/\.astro$/, '');
    found.push({
      pattern: normalize(base === 'index' ? prefix || '/' : `${prefix}/${base}`),
      file: relative,
    });
  }
  return found;
}

/** Expand a discovered pattern's dynamic segment into the paths it serves. */
async function expandPattern(pattern: string): Promise<string[]> {
  switch (pattern) {
    case '/projects/[id]': {
      const { projects } = await loadPublicProjectDetails();
      assert.ok(projects.length > 0, 'the public project source must serve at least one project');
      return projects.map((project) => normalize(project.seo.sitemapPath));
    }
    default:
      assert.equal(
        pattern.includes('['),
        false,
        `${pattern} is a dynamic route with no expansion rule in tests/route-coverage.test.ts`,
      );
      return [pattern];
  }
}

const patterns = await discoverRoutePatterns();
const routes: DiscoveredRoute[] = (
  await Promise.all(
    patterns.map(async ({ pattern, file }) =>
      (await expandPattern(pattern)).map((path) => ({ path, file })),
    ),
  )
).flat();

const sitemapPaths = await (async () => {
  const response = await sitemapGet({ site: SITE } as never);
  const body = await (response as Response).text();
  return new Set(
    [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => normalize(new URL(loc).pathname)),
  );
})();

test('route discovery found the expected route families', () => {
  assert.ok(routes.length >= 6, `expected the full route set, found ${routes.length}`);
  for (const expected of ['/', '/library', '/journey', '/resume', '/contact']) {
    assert.ok(
      routes.some((route) => route.path === expected),
      `${expected} must be discovered from src/pages`,
    );
  }
  // No duplicates: two page files claiming one path would make the other
  // assertions ambiguous.
  assert.equal(new Set(routes.map((route) => route.path)).size, routes.length);
});

test('redirect stubs really are meta-refresh pages into Frost anchors', async () => {
  for (const path of Object.keys(REDIRECT_STUBS)) {
    const file = routes.find((route) => route.path === path)?.file;
    assert.ok(file, `${path} is listed as a redirect stub but no page in src/pages serves it`);
    const source = await read(`src/pages/${file}`);
    assert.match(
      source,
      /http-equiv="refresh" content="0;url=\/#[a-z]+"/,
      `${path} (src/pages/${file}) must meta-refresh into a Frost anchor`,
    );
    assert.match(source, /<a href="\/#[a-z]+"/, `${path} must keep a plain-HTML link fallback`);
  }
});

test('every served route is present in the sitemap; redirect stubs are absent', () => {
  for (const { path, file } of routes) {
    if (path in REDIRECT_STUBS) {
      assert.ok(
        !sitemapPaths.has(path),
        `${path} is a redirect stub (${REDIRECT_STUBS[path]}) and must stay out of sitemap.xml.ts`,
      );
      continue;
    }
    assert.ok(sitemapPaths.has(path), `${path} (src/pages/${file}) is missing from sitemap.xml.ts`);
  }
});

test('the sitemap emits no route the site does not serve', () => {
  const served = new Set(routes.map((route) => route.path));
  for (const path of sitemapPaths) {
    assert.ok(served.has(path), `sitemap.xml.ts emits ${path}, which no page in src/pages serves`);
  }
});

test('every served route renders through the Frost shell', async () => {
  for (const { path, file } of routes) {
    if (path in REDIRECT_STUBS) continue;
    const source = await read(`src/pages/${file}`);
    if (path === '/') {
      // Home is the Frost single-page island with its semantic fallback.
      assert.match(source, /FrostSite/, '/ must render the FrostSite island');
      continue;
    }
    assert.match(source, /@\/layouts\/Frost\.astro/, `${path} must render inside Frost.astro`);
    assert.match(source, /class="frost-doc/, `${path} must render a .frost-doc surface`);
  }

  // The island page really carries the client directive and the layout.
  const home = await read('src/pages/index.astro');
  assert.match(home, /client:load/);
  assert.match(home, /@\/layouts\/Frost\.astro/);
});

test('every served route is reachable by the agent route allowlist', () => {
  for (const { path } of routes) {
    if (path in REDIRECT_STUBS) {
      // Stubs immediately leave the page; the allowlist governs destinations,
      // and `/` (where they land) is asserted below via the home route.
      continue;
    }
    const reason = AGENT_ALLOWLIST_EXEMPT[path];
    if (reason) {
      // Documented, tracked gap — assert it is still a gap so the exemption is
      // removed once the allowlist grows, rather than lingering as dead config.
      assert.equal(
        isAllowedGuideActionDestination(path),
        false,
        `${path} is now allowlisted; drop its exemption (${reason}) from tests/route-coverage.test.ts`,
      );
      continue;
    }
    assert.ok(
      isAllowedGuideActionDestination(path),
      `${path} is served but not allowlisted in src/lib/dm/guide.ts`,
    );
  }
});

test('allowlist exemptions stay small and documented', () => {
  const exempt = Object.keys(AGENT_ALLOWLIST_EXEMPT);
  assert.deepEqual(exempt.sort(), ['/resume']);
  for (const [path, reason] of Object.entries(AGENT_ALLOWLIST_EXEMPT)) {
    assert.match(reason, /#318/, `${path} exemption must cite its tracking issue`);
  }
});
