/**
 * Per-project OG image endpoint (#29). One static `/og/projects/<id>.png` per
 * catalog project, pre-rendered at build (static output — no runtime endpoint).
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { CATALOG, getProjectById } from '../../../data/catalog';
import { renderOgImage } from '../../../lib/og';

export const getStaticPaths = (() =>
  CATALOG.map((p) => ({ params: { id: p.id } }))) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params }) => {
  const p = getProjectById(params.id as string);
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
