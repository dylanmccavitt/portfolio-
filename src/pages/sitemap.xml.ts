/**
 * Sitemap (#25) — emitted as a static `/sitemap.xml` at build time.
 *
 * Built from canonical static routes, filter slugs, resume tracks, and the
 * selected public project source (`loadPublicProjectDetails()`).
 *
 * Route families included:
 *   /                       — concierge landing (#60)
 *   /library                — all-work library
 *   /library/<slug>         — filtered project indexes (from PLAYLIST_SLUGS)
 *   /projects/<id-or-slug>  — project detail pages from the active source
 *   /journey                — resume timeline
 *   /journey/<track>        — one route per resume entry
 *   /resume                 — concise recruiter résumé
 *   /contact                — direct contact surface
 *
 * Total URL count is source-dependent: deployed database mode uses published
 * rows only; offline development and explicit emergency mode use the catalog.
 *
 * `/projects` (the index) is intentionally absent — it now 301s to `/library`.
 * Retired legacy URLs are handled by `vercel.json` 301s and never appear here.
 */
import type { APIRoute } from 'astro';
import { PLAYLIST_SLUGS } from '@/data/catalog';
import { RESUME } from '@/data/resume';
import { loadPublicProjectDetails } from '@/lib/public-projects';

/**
 * Canonical path list, in sitemap order. Nested routes carry a trailing slash
 * to match the directory pages Astro emits and the `<link rel="canonical">` the
 * layouts render (built from `Astro.url.pathname`), so sitemap and canonical
 * agree exactly. Root stays `/`.
 */
function canonicalPaths(projectPaths: string[]): string[] {
  return [
    '/',
    '/library/',
    ...Object.values(PLAYLIST_SLUGS).map((slug) => `/library/${slug}/`),
    ...projectPaths,
    '/journey/',
    ...RESUME.tracks.map((t) => `/journey/${t.id}/`),
    '/resume/',
    '/contact/',
  ];
}

export const GET: APIRoute = async ({ site }) => {
  // `site` is guaranteed by the `site` option in astro.config.mjs.
  const origin = site ?? new URL('https://dylanmccavitt.xyz');
  const { projects } = await loadPublicProjectDetails();
  const urls = canonicalPaths(projects.map((project) => project.seo.sitemapPath))
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
