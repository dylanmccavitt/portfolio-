/**
 * Server-side helpers for the minimal admin review pages (`/admin`,
 * `/admin/drafts/[id]`). These mirror exactly how the admin API route handlers
 * gate access and reach the database, so the pages share one auth + data seam
 * with the JSON API instead of re-implementing it.
 *
 * The pages only ever call the read functions from `@/lib/admin/publish`
 * (`listAdminDrafts`, `getAdminDraft`) for server rendering; every mutation
 * goes back through the API routes via client-side fetch.
 */
import { createDbClient, getDatabaseUrl, type DbClient } from '@/lib/db/client';
import type { AdminPublishQueryable } from '@/lib/admin/publish';
import { readAdminAuthConfig, requireAdminSession } from '@/lib/admin/auth';

export type AdminPageAuth =
  | { status: 'unconfigured' }
  | { status: 'unauthenticated' }
  | { status: 'forbidden'; message: string }
  | { status: 'authenticated'; actor: string };

export type AdminPageDb =
  | { ok: true; db: AdminPublishQueryable }
  | { ok: false };

/**
 * Resolve the admin session for a page request using the same helper the API
 * routes use. Never touches the database and never exposes draft data — it only
 * decides which shell the page should render.
 */
export function authenticateAdminPage(request: Request): AdminPageAuth {
  let config;
  try {
    config = readAdminAuthConfig();
  } catch {
    return { status: 'unconfigured' };
  }

  const session = requireAdminSession(request, config);
  if (session.ok) return { status: 'authenticated', actor: session.actor };
  if (session.status === 403) return { status: 'forbidden', message: session.message };
  return { status: 'unauthenticated' };
}

/** Build the query seam the publish reads expect, mirroring the API routes. */
export function createAdminPageDb(): AdminPageDb {
  try {
    return { ok: true, db: dbFromClient(createDbClient(getDatabaseUrl())) };
  } catch {
    return { ok: false };
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
