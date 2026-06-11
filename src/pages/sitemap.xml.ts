/**
 * Sitemap (#25) — emitted as a static `/sitemap.xml` at build time.
 *
 * Built directly from the catalog + resume data and the canonical filter-slug
 * map rather than from every page Astro happens to build, so it lists *exactly*
 * the canonical redesign route set and nothing else: the legacy Sera pages
 * (`/about`, `/experience`, `/projects`, `/log/*`), the redirect stubs, and the
 * `/player` shell demo are deliberately excluded. Keeping the list
 * data-derived means a new project, track, or playlist shows up automatically.
 *
 * Canonical set (31 URLs):
 *   /                        — library, all work
 *   /library/<slug>          — 9 filtered playlists (wip, money, 7 areas)
 *   /projects/<id>           — 13 project detail pages
 *   /journey                 — the resume album
 *   /journey/<track>         — 7 resume track pages
 */
import type { APIRoute } from 'astro';
import { CATALOG, PLAYLIST_SLUGS } from '../data/catalog';
import { RESUME } from '../data/resume';

/**
 * Canonical path list, in sitemap order. Nested routes carry a trailing slash
 * to match the directory pages Astro emits and the `<link rel="canonical">` the
 * layouts render (built from `Astro.url.pathname`), so sitemap and canonical
 * agree exactly. Root stays `/`.
 */
function canonicalPaths(): string[] {
  return [
    '/',
    ...Object.values(PLAYLIST_SLUGS).map((slug) => `/library/${slug}/`),
    ...CATALOG.map((p) => `/projects/${p.id}/`),
    '/journey/',
    ...RESUME.tracks.map((t) => `/journey/${t.id}/`),
  ];
}

export const GET: APIRoute = ({ site }) => {
  // `site` is guaranteed by the `site` option in astro.config.mjs.
  const origin = site ?? new URL('https://dylanmccavitt.xyz');
  const urls = canonicalPaths()
    .map((path) => `  <url><loc>${new URL(path, origin).href}</loc></url>`)
    .join('\n');

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
