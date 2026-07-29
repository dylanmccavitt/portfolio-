/**
 * Sitemap (#25) — emitted as a static `/sitemap.xml` at build time.
 *
 * Built from canonical static routes, filter slugs, resume tracks, and the
 * selected public project source (`loadPublicProjectDetails()`).
 *
 * Route families included:
 *   /                       — single-page Frost site (About/Work/Journey/Contact anchors)
 *   /projects/<id-or-slug>  — project detail pages from the active source
 *   /resume                 — concise recruiter résumé
 *
 * /library, /journey, and /contact are now client redirects into the
 * single-page anchors and are deliberately absent.
 *
 * Only live routes appear here. Redirected and retired URLs — including
 * `/projects` (301s to `/library`) and every other `vercel.json` redirect
 * source — are deliberately absent.
 */
import type { APIRoute } from 'astro';
import { loadPublicProjectDetails } from '@/lib/public-projects';

/**
 * Canonical path list, in sitemap order. Public URLs omit trailing slashes to
 * match the `<link rel="canonical">` and JSON-LD URLs. Root stays `/`.
 */
function canonicalPaths(projectPaths: string[]): string[] {
  return [
    '/',
    ...projectPaths.map((path) => path.replace(/\/+$/, '')),
    '/resume',
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
