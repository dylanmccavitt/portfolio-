/**
 * Per-entry resume OG image endpoint. One static `/og/journey/<track>.png` per
 * *published* resume entry, pre-rendered at build. The card carries the entry's
 * title, role, and dates as pixels, so it reads the public track allowlist like
 * every other public consumer — a withheld entry gets no image.
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { publicResumeTracks } from '@/data/resume';
import { renderOgImage } from '@/lib/og';

export const getStaticPaths = (() =>
  publicResumeTracks().map((t) => ({ params: { track: t.id } }))) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params }) => {
  const t = publicResumeTracks().find((track) => track.id === params.track);
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
