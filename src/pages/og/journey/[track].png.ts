/**
 * Per-entry resume OG image endpoint. One static `/og/journey/<track>.png` per
 * resume entry, pre-rendered at build.
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { RESUME, getResumeTrackById } from '@/data/resume';
import { renderOgImage } from '@/lib/og';

export const getStaticPaths = (() =>
  RESUME.tracks.map((t) => ({ params: { track: t.id } }))) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params }) => {
  const t = getResumeTrackById(params.track as string);
  if (!t) return new Response('Not found', { status: 404 });
  const png = await renderOgImage({
    title: t.title,
    hue: t.hue,
    kind: `Resume · ${t.when}`,
    tagline: t.role,
    status: t.current ? ['live', 'Current'] : ['done', t.when],
  });
  return new Response(new Uint8Array(png), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
};
