import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAdminSessionCookie,
  readAdminAuthConfig,
  requireAdminSession,
  verifyAdminOAuthState,
  type AdminAuthConfig,
} from '@/lib/admin/auth';
import { createAdminAuthCallbackHandler } from '@/pages/api/admin/auth/callback';
import { createAdminAuthLoginHandler } from '@/pages/api/admin/auth/login';
import { createAdminAuthLogoutHandler } from '@/pages/api/admin/auth/logout';

const NOW = new Date('2026-07-02T12:00:00.000Z');
const CONFIG: AdminAuthConfig = {
  clientId: 'github-client-id',
  clientSecret: 'github-client-secret',
  allowedLogin: 'DylanMcCavitt',
  sessionSecret: 'test-session-secret-at-least-long-enough',
  now: () => NOW,
};

type MockFetchCall = {
  url: string;
  init?: RequestInit;
};

function cookieHeader(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''];
  return cookies.filter(Boolean).map((cookie) => cookie.split(';')[0]).join('; ');
}

function setCookieHeader(response: Response): string {
  return response.headers.get('set-cookie') ?? '';
}

function stateFromLoginRedirect(response: Response): string {
  const location = response.headers.get('location');
  assert.ok(location);
  return new URL(location).searchParams.get('state') ?? '';
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function createLoginResponse(config = CONFIG): Promise<Response> {
  const GET = createAdminAuthLoginHandler({ config });
  return await GET({ request: new Request('https://portfolio.test/api/admin/auth/login') } as never);
}

function callbackRequest(query: string, cookie: string): Request {
  return new Request(`https://portfolio.test/api/admin/auth/callback${query}`, {
    headers: cookie ? { cookie } : undefined,
  });
}
function tamperCookieValue(cookie: string, name: string): string {
  const prefix = `${name}=`;
  const start = cookie.indexOf(prefix);
  assert.notEqual(start, -1);
  const valueStart = start + prefix.length;
  return `${cookie.slice(0, valueStart)}x${cookie.slice(valueStart)}`;
}


function createMockFetch(login: string): typeof fetch & { calls: MockFetchCall[] } {
  const calls: MockFetchCall[] = [];
  const mock = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    if (url === 'https://github.com/login/oauth/access_token') {
      return Response.json({ access_token: 'gho_test_token' });
    }
    if (url === 'https://api.github.com/user') {
      return Response.json({ login });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch & { calls: MockFetchCall[] };
  mock.calls = calls;
  return mock;
}

test('readAdminAuthConfig names missing env keys without leaking values', () => {
  assert.throws(
    () => readAdminAuthConfig({ ADMIN_GITHUB_CLIENT_ID: 'id', ADMIN_GITHUB_CLIENT_SECRET: 'secret' }),
    /ADMIN_GITHUB_ALLOWED_LOGIN, ADMIN_SESSION_SECRET/,
  );
  assert.deepEqual(
    readAdminAuthConfig({
      ADMIN_GITHUB_CLIENT_ID: ' id ',
      ADMIN_GITHUB_CLIENT_SECRET: 'secret-value',
      ADMIN_GITHUB_ALLOWED_LOGIN: ' DylanMcCavitt ',
      ADMIN_SESSION_SECRET: 'session-secret-value',
    }),
    {
      clientId: 'id',
      clientSecret: 'secret-value',
      allowedLogin: 'DylanMcCavitt',
      sessionSecret: 'session-secret-value',
    },
  );
  assert.deepEqual(
    readAdminAuthConfig({
      VERCEL_ENV: 'preview',
      ADMIN_GITHUB_CLIENT_ID_PREVIEW: ' preview-id ',
      ADMIN_GITHUB_CLIENT_SECRET_PREVIEW: 'preview-secret-value',
      ADMIN_GITHUB_ALLOWED_LOGIN: ' DylanMcCavitt ',
      ADMIN_SESSION_SECRET_PREVIEW: 'preview-session-secret-value',
    }),
    {
      clientId: 'preview-id',
      clientSecret: 'preview-secret-value',
      allowedLogin: 'DylanMcCavitt',
      sessionSecret: 'preview-session-secret-value',
    },
  );
});

test('login redirect carries state and sets signed state cookie', async () => {
  const response = await createLoginResponse();
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('cache-control'), 'no-store');

  const location = response.headers.get('location');
  assert.ok(location);
  const redirect = new URL(location);
  assert.equal(redirect.origin, 'https://github.com');
  assert.equal(redirect.pathname, '/login/oauth/authorize');
  assert.equal(redirect.searchParams.get('client_id'), CONFIG.clientId);
  assert.equal(redirect.searchParams.get('redirect_uri'), 'https://portfolio.test/api/admin/auth/callback');
  assert.equal(redirect.searchParams.get('scope'), 'read:user');
  assert.equal(redirect.searchParams.get('allow_signup'), 'false');
  const state = redirect.searchParams.get('state') ?? '';
  assert.ok(state.length > 20);

  const setCookie = setCookieHeader(response);
  assert.match(setCookie, /admin_oauth_state=v1\./);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Path=\/api\/admin\/auth/);
  assert.match(setCookie, /Max-Age=600/);
  assert.equal(verifyAdminOAuthState(callbackRequest(`?state=${state}`, cookieHeader(response)), state, CONFIG), true);
});

test('callback with mismatched missing or tampered state returns 403 without session cookie', async () => {
  const login = await createLoginResponse();
  const state = stateFromLoginRedirect(login);
  const cookie = cookieHeader(login);
  const GET = createAdminAuthCallbackHandler({ config: { ...CONFIG, fetchImpl: createMockFetch('DylanMcCavitt') } });

  for (const request of [
    callbackRequest(`?code=code&state=${state}-wrong`, cookie),
    callbackRequest(`?code=code&state=${state}`, ''),
    callbackRequest(`?code=code&state=${state}`, tamperCookieValue(cookie, 'admin_oauth_state')),
  ]) {
    const response = await GET({ request } as never);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('set-cookie')?.includes('admin_session='), undefined);
    assert.deepEqual(await json(response), {
      ok: false,
      code: 'admin_oauth_state_mismatch',
      message: 'GitHub OAuth state did not match.',
    });
  }
});

test('callback exchanging code for non-allowed GitHub login returns 403 without session cookie', async () => {
  const login = await createLoginResponse();
  const state = stateFromLoginRedirect(login);
  const mockFetch = createMockFetch('not-dylan');
  const GET = createAdminAuthCallbackHandler({ config: { ...CONFIG, fetchImpl: mockFetch } });

  const response = await GET({ request: callbackRequest(`?code=abc123&state=${state}`, cookieHeader(login)) } as never);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie')?.includes('admin_session='), false);
  assert.deepEqual(await json(response), {
    ok: false,
    code: 'admin_forbidden',
    message: 'This GitHub account is not allowed to administer this portfolio.',
  });
  assert.equal(mockFetch.calls.length, 2);
});

test('callback for allowed GitHub login sets session cookie and redirects', async () => {
  const login = await createLoginResponse();
  const state = stateFromLoginRedirect(login);
  const mockFetch = createMockFetch('DYLANMCCAVITT');
  const GET = createAdminAuthCallbackHandler({ config: { ...CONFIG, fetchImpl: mockFetch } });

  const response = await GET({ request: callbackRequest(`?code=abc123&state=${state}`, cookieHeader(login)) } as never);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/admin');
  const setCookie = setCookieHeader(response);
  assert.match(setCookie, /admin_session=v1\./);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Path=\//);
  assert.match(setCookie, /Max-Age=43200/);
  assert.deepEqual(requireAdminSession(new Request('https://portfolio.test/admin', { headers: { cookie: cookieHeader(response) } }), CONFIG), {
    ok: true,
    actor: 'github:dylanmccavitt',
  });
  assert.equal(mockFetch.calls[0]?.url, 'https://github.com/login/oauth/access_token');
  assert.equal(mockFetch.calls[1]?.url, 'https://api.github.com/user');
});

test('requireAdminSession accepts valid cookies and rejects missing tampered expired and wrong-login sessions', () => {
  const validCookie = createAdminSessionCookie('DylanMcCavitt', CONFIG);
  assert.deepEqual(requireAdminSession(new Request('https://portfolio.test/admin', { headers: { cookie: validCookie } }), CONFIG), {
    ok: true,
    actor: 'github:dylanmccavitt',
  });

  assert.deepEqual(requireAdminSession(new Request('https://portfolio.test/admin'), CONFIG), {
    ok: false,
    status: 401,
    code: 'admin_unauthenticated',
    message: 'Admin authentication is required.',
  });

  assert.deepEqual(
    requireAdminSession(new Request('https://portfolio.test/admin', { headers: { cookie: tamperCookieValue(validCookie, 'admin_session') } }), CONFIG),
    {
      ok: false,
      status: 401,
      code: 'admin_unauthenticated',
      message: 'Admin authentication is required.',
    },
  );

  const expiredConfig = { ...CONFIG, now: () => new Date('2026-07-01T12:00:00.000Z') };
  const expiredCookie = createAdminSessionCookie('DylanMcCavitt', expiredConfig);
  assert.deepEqual(
    requireAdminSession(new Request('https://portfolio.test/admin', { headers: { cookie: expiredCookie } }), CONFIG),
    {
      ok: false,
      status: 401,
      code: 'admin_unauthenticated',
      message: 'Admin authentication is required.',
    },
  );

  const wrongLoginCookie = createAdminSessionCookie('OtherAdmin', { ...CONFIG, allowedLogin: 'OtherAdmin' });
  assert.deepEqual(
    requireAdminSession(new Request('https://portfolio.test/admin', { headers: { cookie: wrongLoginCookie } }), CONFIG),
    {
      ok: false,
      status: 403,
      code: 'admin_forbidden',
      message: 'This GitHub account is not allowed to administer this portfolio.',
    },
  );
});

test('logout clears the admin session cookie with no JSON content-type gate', async () => {
  const POST = createAdminAuthLogoutHandler();
  const response = await POST({
    request: new Request('https://portfolio.test/api/admin/auth/logout', {
      method: 'POST',
      headers: { Origin: 'https://portfolio.test' },
      body: 'not-json',
    }),
  } as never);
  assert.equal(response.status, 200);
  assert.match(setCookieHeader(response), /admin_session=;.*Max-Age=0/);
  assert.deepEqual(await json(response), {
    ok: true,
    code: 'admin_logged_out',
    message: 'Admin session cleared.',
  });
});

test('logout rejects missing and forged Origins', async () => {
  const POST = createAdminAuthLogoutHandler();
  for (const origin of [undefined, 'https://forged.example']) {
    const headers: Record<string, string> = {};
    if (origin) headers.Origin = origin;
    const response = await POST({
      request: new Request('https://portfolio.test/api/admin/auth/logout', { method: 'POST', headers }),
    } as never);
    assert.equal(response.status, 403);
    assert.deepEqual(await json(response), {
      ok: false,
      code: 'admin_origin_invalid',
      message: 'Admin mutation requests require a matching Origin header.',
    });
  }
});

test('missing route config returns 503 JSON instead of throwing', async () => {
  const previous = {
    ADMIN_GITHUB_CLIENT_ID: process.env.ADMIN_GITHUB_CLIENT_ID,
    ADMIN_GITHUB_CLIENT_SECRET: process.env.ADMIN_GITHUB_CLIENT_SECRET,
    ADMIN_GITHUB_ALLOWED_LOGIN: process.env.ADMIN_GITHUB_ALLOWED_LOGIN,
    ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET,
  };
  delete process.env.ADMIN_GITHUB_CLIENT_ID;
  delete process.env.ADMIN_GITHUB_CLIENT_SECRET;
  delete process.env.ADMIN_GITHUB_ALLOWED_LOGIN;
  delete process.env.ADMIN_SESSION_SECRET;
  try {
    const GET = createAdminAuthLoginHandler();
    const response = await GET({ request: new Request('https://portfolio.test/api/admin/auth/login') } as never);
    assert.equal(response.status, 503);
    assert.deepEqual(await json(response), {
      ok: false,
      code: 'admin_auth_unconfigured',
      message: 'Admin authentication is not configured.',
    });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
