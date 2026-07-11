import { createHmac } from 'node:crypto';
import type { ProjectReadQueryable } from '@/lib/db/project-reads';

const DEFAULT_LIMIT = 20;
const DEFAULT_WINDOW_SECONDS = 600;
const MIN_SECRET_BYTES = 32;

export type DMRateLimitEnv = {
  DM_RATE_LIMIT_HMAC_SECRET?: string;
  DM_RATE_LIMIT_KEY_VERSION?: string;
  DM_RATE_LIMIT_MAX_REQUESTS?: string;
  DM_RATE_LIMIT_WINDOW_SECONDS?: string;
  VERCEL?: string;
};

export interface DMRateLimitConfig {
  hmacSecret: string;
  keyVersion: string;
  limit: number;
  windowSeconds: number;
}

export interface DMRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

export type DMClientAddressResolver = (request: Request) => string | null;

export class DMRateLimitConfigError extends Error {}
export class DMRateLimitStorageError extends Error {}

export function readDMRateLimitConfig(env: DMRateLimitEnv = process.env): DMRateLimitConfig {
  const hmacSecret = env.DM_RATE_LIMIT_HMAC_SECRET?.trim();
  if (!hmacSecret || Buffer.byteLength(hmacSecret, 'utf8') < MIN_SECRET_BYTES) {
    throw new DMRateLimitConfigError('DM rate limit HMAC secret is unavailable.');
  }

  const keyVersion = env.DM_RATE_LIMIT_KEY_VERSION?.trim() || 'v1';
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(keyVersion)) {
    throw new DMRateLimitConfigError('DM rate limit key version is invalid.');
  }

  return {
    hmacSecret,
    keyVersion,
    limit: readBoundedInteger(env.DM_RATE_LIMIT_MAX_REQUESTS, DEFAULT_LIMIT, 1, 100),
    windowSeconds: readBoundedInteger(env.DM_RATE_LIMIT_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS, 60, 3600),
  };
}

export function resolveTrustedVercelClientAddress(request: Request, env: DMRateLimitEnv = process.env): string | null {
  if (env.VERCEL !== '1') return null;
  const forwarded = request.headers.get('x-vercel-forwarded-for');
  if (!forwarded) return null;
  return forwarded.split(',').map((value) => value.trim()).find(isValidAddress) ?? null;
}

export function deriveDMClientHash(address: string, config: Pick<DMRateLimitConfig, 'hmacSecret'>): string {
  return createHmac('sha256', config.hmacSecret).update(address).digest('hex');
}

export async function consumeDMRateLimit(
  db: ProjectReadQueryable,
  config: DMRateLimitConfig,
  clientAddress: string,
  now = Date.now(),
): Promise<DMRateLimitResult> {
  const windowMs = config.windowSeconds * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const windowEnd = windowStart + windowMs;
  const expiresAt = windowEnd + windowMs;
  const clientHash = deriveDMClientHash(clientAddress, config);

  try {
    // Keep cleanup intentionally bounded. Expired keys have no request content and
    // are also removed naturally by this lazy path after at most two windows.
    await db.query(
      `DELETE FROM dm_rate_limit_windows
       WHERE ctid IN (
         SELECT ctid FROM dm_rate_limit_windows
         WHERE expires_at <= to_timestamp($1 / 1000.0)
         ORDER BY expires_at
         LIMIT 100
       )`,
      [now],
    );
    const result = await db.query<{ count: number | string }>(
      `INSERT INTO dm_rate_limit_windows (
         key_version, client_hash, window_start, count, expires_at
       ) VALUES (
         $1, $2, to_timestamp($3 / 1000.0), 1, to_timestamp($4 / 1000.0)
       )
       ON CONFLICT (key_version, client_hash, window_start)
       DO UPDATE SET count = dm_rate_limit_windows.count + 1
       RETURNING count`,
      [config.keyVersion, clientHash, windowStart, expiresAt],
    );
    const rows = Array.isArray(result) ? result : result.rows;
    const count = Number(rows[0]?.count);
    if (!Number.isInteger(count) || count < 1) throw new Error('Limiter did not return a count.');
    return {
      allowed: count <= config.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((windowEnd - now) / 1000)),
      remaining: Math.max(0, config.limit - count),
    };
  } catch {
    throw new DMRateLimitStorageError('DM rate limiter storage is unavailable.');
  }
}

function readBoundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !value.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new DMRateLimitConfigError('DM rate limit configuration is invalid.');
  }
  return parsed;
}

function isValidAddress(value: string): boolean {
  // Accept IPv4 and IPv6 literals only; hostnames and arbitrary header values
  // are never trusted as a client identity.
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) {
    return value.split('.').every((part) => Number(part) <= 255);
  }
  return /^[0-9a-fA-F:]+$/.test(value) && value.includes(':');
}
