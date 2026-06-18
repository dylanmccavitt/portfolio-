/**
 * Fallback OG image for home, library, resume, and hiring routes.
 */
import type { APIRoute } from 'astro';
import { renderOgImage } from '../../lib/og';

export const GET: APIRoute = async () => {
  const png = await renderOgImage({
    title: 'Dylan McCavitt',
    hue: '#8b7cf6',
    kind: 'Software engineer',
    tagline: 'Agentic systems, trading infrastructure, and iOS apps in NYC.',
  });
  return new Response(new Uint8Array(png), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
};
