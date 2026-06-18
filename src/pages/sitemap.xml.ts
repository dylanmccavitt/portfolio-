/**
 * Sitemap (#25) — emitted as a static `/sitemap.xml` at build time.
 *
 * Built directly from the catalog + resume data and the canonical filter-slug
 * map rather than from every page Astro happens to build, so it stays exactly
 * aligned with the canonical redesign route set. Retired
 * Sera-era URLs are handled by `vercel.json` 301s and never appear here.
 *
 * Canonical set (32 URLs):
 *   /                        — the concierge landing (#60)
 *   /hiring                  — the "I'm hiring" guided tour (#62)
 *   /library                 — all-work library (relocated from `/` in #60)
 *   /library/<slug>          — 8 filtered project indexes (wip, 7 areas)
 *   /projects/<id>           — 13 project detail pages
 *   /journey                 — the resume timeline
 *   /journey/<track>         — 7 resume entry pages
 *
 * `/projects` (the index) is intentionally absent — it now 301s to `/library`.
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
    '/hiring/',
    '/library/',
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
