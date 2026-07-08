import type { APIRoute } from 'astro';
import { createDbClient, getDatabaseUrl, type DbClient } from '@/lib/db/client';
import { listAdminDrafts, type AdminPublishQueryable } from '@/lib/admin/publish';
import {
  readAdminAuthConfig,
  requireAdminSession,
  type AdminAuthConfig,
  type AdminSessionResult,
} from '@/lib/admin/auth';

export const prerender = false;

export interface AdminDraftsHandlerDeps {
  db?: AdminPublishQueryable;
  authConfig?: AdminAuthConfig;
  session?: (request: Request) => AdminSessionResult;
  createClient?: () => DbClient;
}

export function createAdminDraftsGetHandler(deps: AdminDraftsHandlerDeps = {}): APIRoute {
  return async ({ request }) => {
    try {
      const auth = authorizeAdmin(request, deps);
      if (!auth.ok) return adminJson(auth.status, auth);

      const dbResult = createDbResult(deps);
      if (!dbResult.ok) return adminJson(503, dbResult.body);

      const result = await listAdminDrafts(dbResult.db);
      return adminJson(result.status, result);
    } catch (error) {
      return adminJson(500, safeAdminError(error));
    }
  };
}

function authorizeAdmin(
  request: Request,
  deps: AdminDraftsHandlerDeps,
): AdminSessionResult | { ok: false; status: 503; code: string; message: string } {
  if (deps.session) return deps.session(request);
  try {
    return requireAdminSession(request, deps.authConfig ?? readAdminAuthConfig());
  } catch {
    return {
      ok: false,
      status: 503,
      code: 'admin_auth_unconfigured',
      message: 'Admin authentication is not configured.',
    };
  }
}

function createDbResult(
  deps: AdminDraftsHandlerDeps,
): { ok: true; db: AdminPublishQueryable } | { ok: false; body: { ok: false; code: string; message: string } } {
  try {
    return { ok: true, db: deps.db ?? dbFromClient(deps.createClient?.() ?? createDbClient(getDatabaseUrl())) };
  } catch {
    return { ok: false, body: { ok: false, code: 'database_config_missing', message: 'Admin database configuration is missing.' } };
  }
}

function dbFromClient(client: DbClient): AdminPublishQueryable {
  return {
    async query<Row = unknown>(query: string, params?: unknown[]) {
      const rows = (await client.query(query, params)) as Row[];
      return { rows };
    },
  };
}

function adminJson(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function safeAdminError(error: unknown): { ok: false; status: 500; code: string; message: string; errorRef: string } {
  const errorRef = crypto.randomUUID().slice(0, 8);
  const details: Record<string, unknown> = { errorRef };
  if (error instanceof Error) {
    details.name = typeof error.name === 'string' ? error.name : 'Error';
    details.frames = stackFrames(error);
    for (const key of ['code', 'table', 'constraint'] as const) {
      const value = errorField(error, key);
      if (typeof value === 'string') details[`pg_${key}`] = value;
    }
  } else {
    details.thrownType = typeof error;
  }
  console.error('[admin-publish]', JSON.stringify(details));
  return { ok: false, status: 500, code: 'admin_internal_error', message: `Admin publish request failed. Error ref ${errorRef}.`, errorRef };
}

function errorField(error: Error, key: 'code' | 'table' | 'constraint'): unknown {
  if (!(key in error)) return undefined;
  return Object.getOwnPropertyDescriptor(error, key)?.value;
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

export const GET = createAdminDraftsGetHandler();
export const ALL: APIRoute = () => adminJson(405, { ok: false, code: 'method_not_allowed', message: 'Use GET.' });
