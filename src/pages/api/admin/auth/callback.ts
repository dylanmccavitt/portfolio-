import { randomUUID } from 'node:crypto';
import type { APIRoute } from 'astro';
import {
  clearAdminOAuthStateCookie,
  createAdminSessionCookie,
  readAdminAuthConfig,
  verifyAdminOAuthState,
  type AdminAuthConfig,
} from '@/lib/admin/auth';

export const prerender = false;

export interface AdminAuthCallbackDeps {
  config?: AdminAuthConfig;
}

type GitHubTokenResponse = {
  access_token?: unknown;
  error?: unknown;
};

type GitHubUserResponse = {
  login?: unknown;
};

export function createAdminAuthCallbackHandler(deps: AdminAuthCallbackDeps = {}): APIRoute {
  return async ({ request }) => {
    try {
      const configResult = readConfigResult(deps);
      if (!configResult.ok) return configResult.response;
      const config = configResult.config;
      const url = new URL(request.url);
      const code = url.searchParams.get('code') ?? '';
      const state = url.searchParams.get('state') ?? '';

      if (!code || !verifyAdminOAuthState(request, state, config)) {
        return adminJson(403, false, 'admin_oauth_state_mismatch', 'GitHub OAuth state did not match.');
      }

      const fetchImpl = config.fetchImpl ?? globalThis.fetch;
      const token = await exchangeCode(fetchImpl, code, config, new URL('/api/admin/auth/callback', request.url).toString());
      if (!token.ok) return token.response;

      const user = await fetchGitHubUser(fetchImpl, token.accessToken);
      if (!user.ok) return user.response;

      const login = user.login.trim().toLowerCase();
      if (login !== config.allowedLogin.trim().toLowerCase()) {
        return adminJson(403, false, 'admin_forbidden', 'This GitHub account is not allowed to administer this portfolio.', [
          clearAdminOAuthStateCookie(),
        ]);
      }

      return redirectResponse('/api/admin/drafts', [createAdminSessionCookie(login, config), clearAdminOAuthStateCookie()]);
    } catch (error) {
      return safeAdminError(error);
    }
  };
}

function readConfigResult(
  deps: AdminAuthCallbackDeps,
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

async function exchangeCode(
  fetchImpl: typeof fetch,
  code: string,
  config: AdminAuthConfig,
  redirectUri: string,
): Promise<{ ok: true; accessToken: string } | { ok: false; response: Response }> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: redirectUri,
  });
  let response: Response;
  try {
    response = await fetchImpl('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
  } catch {
    return {
      ok: false,
      response: adminJson(502, false, 'admin_oauth_exchange_failed', 'GitHub OAuth code exchange failed.'),
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      response: adminJson(502, false, 'admin_oauth_exchange_failed', 'GitHub OAuth code exchange failed.'),
    };
  }
  let payload: GitHubTokenResponse;
  try {
    payload = (await response.json()) as GitHubTokenResponse;
  } catch {
    return {
      ok: false,
      response: adminJson(502, false, 'admin_oauth_exchange_failed', 'GitHub OAuth code exchange failed.'),
    };
  }
  if (typeof payload.error === 'string' || typeof payload.access_token !== 'string' || !payload.access_token) {
    return {
      ok: false,
      response: adminJson(502, false, 'admin_oauth_exchange_failed', 'GitHub OAuth code exchange failed.'),
    };
  }
  return { ok: true, accessToken: payload.access_token };
}

async function fetchGitHubUser(
  fetchImpl: typeof fetch,
  accessToken: string,
): Promise<{ ok: true; login: string } | { ok: false; response: Response }> {
  let response: Response;
  try {
    response = await fetchImpl('https://api.github.com/user', {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'portfolio-admin-auth',
      },
    });
  } catch {
    return {
      ok: false,
      response: adminJson(502, false, 'admin_oauth_user_failed', 'GitHub user lookup failed.'),
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      response: adminJson(502, false, 'admin_oauth_user_failed', 'GitHub user lookup failed.'),
    };
  }
  let payload: GitHubUserResponse;
  try {
    payload = (await response.json()) as GitHubUserResponse;
  } catch {
    return {
      ok: false,
      response: adminJson(502, false, 'admin_oauth_user_failed', 'GitHub user lookup failed.'),
    };
  }
  if (typeof payload.login !== 'string' || !payload.login.trim()) {
    return {
      ok: false,
      response: adminJson(502, false, 'admin_oauth_user_failed', 'GitHub user lookup failed.'),
    };
  }
  return { ok: true, login: payload.login };
}

function redirectResponse(location: string, cookies: string[]): Response {
  const headers = new Headers({
    Location: location,
    'Cache-Control': 'no-store',
  });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
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

function safeAdminError(error: unknown): Response {
  const errorRef = randomUUID().slice(0, 8);
  const details: Record<string, unknown> = { errorRef };
  if (error instanceof Error) {
    details.name = typeof error.name === 'string' ? error.name : 'Error';
    details.frames = stackFrames(error);
  } else {
    details.thrownType = typeof error;
  }
  console.error('[admin-auth]', JSON.stringify(details));
  return adminJson(500, false, 'admin_internal_error', `Admin authentication failed. Error ref ${errorRef}.`);
}

function stackFrames(error: Error): string[] {
  if (typeof error.stack !== 'string' || typeof error.name !== 'string' || typeof error.message !== 'string') return [];
  const prefix = error.message ? `${error.name}: ${error.message}` : error.name;
  if (!error.stack.startsWith(prefix)) return [];
  return error.stack
    .slice(prefix.length)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^at .+:\d+:\d+\)?$/.test(line));
}

export const GET = createAdminAuthCallbackHandler();

export const ALL: APIRoute = () => adminJson(405, false, 'method_not_allowed', 'Use GET for admin auth callback.');
