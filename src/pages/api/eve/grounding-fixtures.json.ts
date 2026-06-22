import type { APIRoute } from 'astro';
import { createGroundingFixtureSet } from '../../../lib/eve/data-tools';

export const prerender = true;

export const GET: APIRoute = () =>
  new Response(JSON.stringify(createGroundingFixtureSet(), null, 2), {
    headers: {
      'Cache-Control': 'public, max-age=300',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
