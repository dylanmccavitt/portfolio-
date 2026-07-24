/**
 * Fallback OG image for home, library, resume, and journey routes.
 */
import type { APIRoute } from 'astro';
import { renderOgImage } from '@/lib/og';

export const GET: APIRoute = async () => {
  const png = await renderOgImage({
    title: 'Dylan McCavitt',
    hue: '#8b7cf6',
    kind: 'Software engineer',
    tagline: 'Practical tools, client software, and AI-assisted workflows.',
  });
  return new Response(new Uint8Array(png), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
};
