import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface AdminAuthConfig {
  clientId: string;
  clientSecret: string;
  allowedLogin: string;
  sessionSecret: string;
  now?: () => Date;
  fetchImpl?: typeof fetch;
}

export type AdminSessionResult =
  | { ok: true; actor: string }
  | { ok: false; status: 401 | 403; code: string; message: string };

export interface AdminOAuthState {
  state: string;
  iat: number;
  exp: number;
}

type AdminSessionPayload = {
  login: string;
  iat: number;
  exp: number;
};

const ADMIN_SESSION_COOKIE = 'admin_session';
const ADMIN_OAUTH_STATE_COOKIE = 'admin_oauth_state';
const ADMIN_COOKIE_VERSION = 'v1';
const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12;
const ADMIN_OAUTH_STATE_TTL_SECONDS = 60 * 10;

export function readAdminAuthConfig(env: Record<string, string | undefined> = process.env): AdminAuthConfig {
  const clientId = adminEnvValue(env, 'ADMIN_GITHUB_CLIENT_ID');
  const clientSecret = adminEnvValue(env, 'ADMIN_GITHUB_CLIENT_SECRET');
  const allowedLogin = env.ADMIN_GITHUB_ALLOWED_LOGIN?.trim();
  const sessionSecret = adminEnvValue(env, 'ADMIN_SESSION_SECRET');
  const missing = [
    ['ADMIN_GITHUB_CLIENT_ID', clientId],
    ['ADMIN_GITHUB_CLIENT_SECRET', clientSecret],
    ['ADMIN_GITHUB_ALLOWED_LOGIN', allowedLogin],
    ['ADMIN_SESSION_SECRET', sessionSecret],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`Missing admin auth environment variables: ${missing.join(', ')}`);
  }

  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    allowedLogin: allowedLogin!,
    sessionSecret: sessionSecret!,
  };
}

function adminEnvValue(env: Record<string, string | undefined>, key: 'ADMIN_GITHUB_CLIENT_ID' | 'ADMIN_GITHUB_CLIENT_SECRET' | 'ADMIN_SESSION_SECRET'): string | undefined {
  const previewKey = `${key}_PREVIEW`;
  return (env.VERCEL_ENV === 'preview' ? env[previewKey]?.trim() : undefined) || env[key]?.trim();
}

export function requireAdminSession(request: Request, config: AdminAuthConfig): AdminSessionResult {
  const cookieValue = readCookie(request.headers.get('cookie'), ADMIN_SESSION_COOKIE);
  if (!cookieValue) return unauthenticated();

  const payload = verifySignedPayload<AdminSessionPayload>(cookieValue, config.sessionSecret);
  if (!payload || typeof payload.login !== 'string') return unauthenticated();

  const now = epochSeconds(config);
  if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || payload.exp <= now) return unauthenticated();

  const login = payload.login.trim().toLowerCase();
  if (!login) return unauthenticated();
  if (login !== config.allowedLogin.trim().toLowerCase()) {
    return {
      ok: false,
      status: 403,
      code: 'admin_forbidden',
      message: 'This GitHub account is not allowed to administer this portfolio.',
    };
  }

  return { ok: true, actor: `github:${login}` };
}

export function createAdminSessionCookie(login: string, config: AdminAuthConfig): string {
  const normalizedLogin = login.trim().toLowerCase();
  const iat = epochSeconds(config);
  const exp = iat + ADMIN_SESSION_TTL_SECONDS;
  return serializeCookie(ADMIN_SESSION_COOKIE, signPayload({ login: normalizedLogin, iat, exp }, config.sessionSecret), {
    path: '/',
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  });
}

export function createAdminOAuthStateCookie(config: AdminAuthConfig): { state: string; cookie: string } {
  const iat = epochSeconds(config);
  const exp = iat + ADMIN_OAUTH_STATE_TTL_SECONDS;
  const state = randomBytes(32).toString('base64url');
  const cookie = serializeCookie(ADMIN_OAUTH_STATE_COOKIE, signPayload({ state, iat, exp }, config.sessionSecret), {
    path: '/api/admin/auth',
    maxAge: ADMIN_OAUTH_STATE_TTL_SECONDS,
  });
  return { state, cookie };
}

export function verifyAdminOAuthState(request: Request, state: string, config: AdminAuthConfig): boolean {
  const cookieValue = readCookie(request.headers.get('cookie'), ADMIN_OAUTH_STATE_COOKIE);
  if (!cookieValue || !state) return false;

  const payload = verifySignedPayload<AdminOAuthState>(cookieValue, config.sessionSecret);
  if (!payload || typeof payload.state !== 'string') return false;
  if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || payload.exp <= epochSeconds(config)) return false;
  return safeEqual(payload.state, state);
}

export function clearAdminSessionCookie(): string {
  return serializeCookie(ADMIN_SESSION_COOKIE, '', { path: '/', maxAge: 0 });
}

export function clearAdminOAuthStateCookie(): string {
  return serializeCookie(ADMIN_OAUTH_STATE_COOKIE, '', { path: '/api/admin/auth', maxAge: 0 });
}

function signPayload(payload: Record<string, unknown>, secret: string): string {
  const payloadBase64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(payloadBase64).digest('base64url');
  return `${ADMIN_COOKIE_VERSION}.${payloadBase64}.${signature}`;
}

function verifySignedPayload<Payload>(value: string, secret: string): Payload | null {
  const [version, payloadBase64, signature, extra] = value.split('.');
  if (version !== ADMIN_COOKIE_VERSION || !payloadBase64 || !signature || extra !== undefined) return null;

  const expected = createHmac('sha256', secret).update(payloadBase64).digest('base64url');
  if (!safeEqual(signature, expected)) return null;

  try {
    const json = Buffer.from(payloadBase64, 'base64url').toString('utf8');
    return JSON.parse(json) as Payload;
  } catch {
    return null;
  }
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (key === name) return part.slice(index + 1).trim();
  }
  return null;
}

function serializeCookie(name: string, value: string, options: { path: string; maxAge: number }): string {
  return `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=${options.path}; Max-Age=${options.maxAge}`;
}

function epochSeconds(config: AdminAuthConfig): number {
  return Math.floor((config.now?.() ?? new Date()).getTime() / 1000);
}

function unauthenticated(): AdminSessionResult {
  return {
    ok: false,
    status: 401,
    code: 'admin_unauthenticated',
    message: 'Admin authentication is required.',
  };
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
