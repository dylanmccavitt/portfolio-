/**
 * Per-project OG image endpoint (#29). Static output follows the public project
 * source selected by the public-project source boundary.
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { loadPublicProjectDetails } from '@/lib/public-projects';
import type { ProjectDetailReadModel } from '@/lib/db/project-reads';
import { renderOgImage } from '@/lib/og';

export const getStaticPaths = (async () => {
  const { projects } = await loadPublicProjectDetails();
  return projects.map((project) => ({ params: { id: project.slug }, props: { project } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const p = (props as { project?: ProjectDetailReadModel }).project;
  if (!p) return new Response('Not found', { status: 404 });
  const png = await renderOgImage({
    title: p.title,
    hue: p.hue,
    kind: `${p.area} · ${p.year}`,
    tagline: p.line,
    status: p.status,
  });
  return new Response(new Uint8Array(png), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
};
