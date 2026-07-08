import type { APIRoute } from 'astro';
import { clearAdminSessionCookie } from '@/lib/admin/auth';

export const prerender = false;

export function createAdminAuthLogoutHandler(): APIRoute {
  return () => adminJson(200, true, 'admin_logged_out', 'Admin session cleared.', [clearAdminSessionCookie()]);
}

function adminJson(status: number, ok: boolean, code: string, message: string, cookies: string[] = []): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify({ ok, code, message }), { status, headers });
}

export const POST = createAdminAuthLogoutHandler();

export const ALL: APIRoute = () => adminJson(405, false, 'method_not_allowed', 'Use POST for admin logout.');
