import type { APIRoute } from 'astro';
import {
  createAdminOAuthStateCookie,
  readAdminAuthConfig,
  type AdminAuthConfig,
} from '../../../../lib/admin/auth';

export const prerender = false;

export interface AdminAuthRouteDeps {
  config?: AdminAuthConfig;
}

export function createAdminAuthLoginHandler(deps: AdminAuthRouteDeps = {}): APIRoute {
  return ({ request }) => {
    const configResult = readConfigResult(deps);
    if (!configResult.ok) return configResult.response;

    const { state, cookie } = createAdminOAuthStateCookie(configResult.config);
    const redirectUri = new URL('/api/admin/auth/callback', request.url).toString();
    const githubUrl = new URL('https://github.com/login/oauth/authorize');
    githubUrl.searchParams.set('client_id', configResult.config.clientId);
    githubUrl.searchParams.set('redirect_uri', redirectUri);
    githubUrl.searchParams.set('state', state);
    githubUrl.searchParams.set('scope', 'read:user');
    githubUrl.searchParams.set('allow_signup', 'false');

    return redirectResponse(githubUrl.toString(), [cookie]);
  };
}

function readConfigResult(
  deps: AdminAuthRouteDeps,
): { ok: true; config: AdminAuthConfig } | { ok: false; response: Response } {
  try {
    return { ok: true, config: deps.config ?? readAdminAuthConfig() };
  } catch {
    return {
      ok: false,
      response: adminJson(503, false, 'admin_auth_unconfigured', 'Admin authentication is not configured.'),
    };
  }
}

function redirectResponse(location: string, cookies: string[]): Response {
  const headers = new Headers({
    Location: location,
    'Cache-Control': 'no-store',
  });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
}

function adminJson(status: number, ok: boolean, code: string, message: string): Response {
  return new Response(JSON.stringify({ ok, code, message }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export const GET = createAdminAuthLoginHandler();

export const ALL: APIRoute = () => adminJson(405, false, 'method_not_allowed', 'Use GET for admin login.');
