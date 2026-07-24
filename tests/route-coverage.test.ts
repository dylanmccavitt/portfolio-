/**
 * Route coverage gate (#323).
 *
 * The owner's "routes working" criterion had no check behind it. This suite
 * enumerates every HTML route the site actually serves — discovered from
 * `src/pages`, with dynamic segments expanded from the same data the pages use —
 * and asserts three things per route:
 *
 *   1. it appears in `src/pages/sitemap.xml.ts`'s rendered output;
 *   2. it renders through the device route shell (or is explicitly exempted);
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

const { PLAYLIST_SLUGS } = await import('@/data/catalog');
const { RESUME } = await import('@/data/resume');
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
 * Routes exempt from a rule, each with the reason. Exemptions are the only way
 * a route is allowed to miss a criterion.
 */
const DEVICE_SHELL_EXEMPT: Record<string, string> = {
  '/': 'home renders the full device via layouts/Device.astro (surface="home"), not a route screen',
};

/**
 * `/resume` and `/contact` are served and sitemapped but are absent from the
 * agent's route allowlist: `DMPageContextKind` has no value for them, and
 * adding one has to propagate through the guide, the runtime, the client, and
 * the tool boundary. Tracked as issue #318 — agent-rework scope, deliberately
 * not fixed here. This allowance keeps the gap visible instead of silent.
 */
const AGENT_ALLOWLIST_EXEMPT: Record<string, string> = {
  '/resume': 'no DMPageContextKind for the résumé route yet — see issue #318',
  '/contact': 'no DMPageContextKind for the contact route yet — see issue #318',
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
    case '/library/[filter]':
      return Object.values(PLAYLIST_SLUGS).map((slug) => `/library/${slug}`);
    case '/journey/[track]':
      return RESUME.tracks.map((track) => `/journey/${track.id}`);
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
  assert.ok(routes.length >= 8, `expected the full route set, found ${routes.length}`);
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

test('every served route is present in the sitemap', () => {
  for (const { path, file } of routes) {
    assert.ok(sitemapPaths.has(path), `${path} (src/pages/${file}) is missing from sitemap.xml.ts`);
  }
});

test('the sitemap emits no route the site does not serve', () => {
  const served = new Set(routes.map((route) => route.path));
  for (const path of sitemapPaths) {
    assert.ok(served.has(path), `sitemap.xml.ts emits ${path}, which no page in src/pages serves`);
  }
});

test('every served route renders through the device route shell', async () => {
  const shellSources = new Map<string, string>();
  const sourceFor = async (file: string) => {
    let source = shellSources.get(file);
    if (source === undefined) {
      source = await read(`src/pages/${file}`);
      shellSources.set(file, source);
    }
    return source;
  };

  // Components a page may delegate its route screen to.
  const shellComponents = ['LibraryView'];

  for (const { path, file } of routes) {
    if (path in DEVICE_SHELL_EXEMPT) {
      const source = await sourceFor(file);
      assert.match(
        source,
        /@\/layouts\/Device\.astro/,
        `${path} is device-shell exempt (${DEVICE_SHELL_EXEMPT[path]}) but does not use Device.astro`,
      );
      continue;
    }
    const source = await sourceFor(file);
    assert.match(source, /@\/layouts\/Editorial\.astro/, `${path} must render inside Editorial.astro`);
    const delegates = shellComponents.some((component) => source.includes(`<${component}`));
    if (!delegates) {
      assert.match(
        source,
        /class="device-route-screen/,
        `${path} must render a .device-route-screen surface`,
      );
    }
  }

  // The delegated shell really does carry the route screen class.
  const libraryView = await read('src/components/LibraryView.astro');
  assert.match(libraryView, /class="device-route-screen/);

  // Editorial is the shell: it wraps its slot in Device.astro with surface="route".
  const editorial = await read('src/layouts/Editorial.astro');
  assert.match(editorial, /@\/layouts\/Device\.astro/);
  assert.match(editorial, /surface="route"/);
});

test('every served route is reachable by the agent route allowlist', () => {
  for (const { path } of routes) {
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
  assert.deepEqual(exempt.sort(), ['/contact', '/resume']);
  for (const [path, reason] of Object.entries(AGENT_ALLOWLIST_EXEMPT)) {
    assert.match(reason, /#318/, `${path} exemption must cite its tracking issue`);
  }
});
