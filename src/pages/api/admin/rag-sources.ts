import type { APIRoute } from 'astro';
import { createDbClient, getDatabaseUrl, type DbClient } from '@/lib/db/client';
import {
  readAdminAuthConfig,
  requireAdminSession,
  type AdminAuthConfig,
  type AdminSessionResult,
} from '@/lib/admin/auth';
import {
  ingestRagSource,
  markRagSourceEligible,
  revokeRagSource,
  type IngestOptions,
  type RagIndexClient,
  type RagQueryable,
} from '@/lib/rag/ingestion';
import { createOpenAiRagIndexClient, readRagVectorStoreId } from '@/lib/rag/openai';

export const prerender = false;

export interface AdminRagSourcesHandlerDeps {
  db?: RagQueryable;
  authConfig?: AdminAuthConfig;
  session?: (request: Request) => AdminSessionResult;
  createClient?: () => DbClient;
  ragClient?: RagIndexClient;
  ingestOptions?: IngestOptions;
}

type RagSourceListRow = {
  evidenceSourceId: string;
  project_id: string;
  slug: string;
  title: string;
  lifecycle_state: string;
  source_type: string;
  source_url: string | null;
  source_ref: string | null;
  repo_visibility: string | null;
  privacy_state: string;
  extracted_text_sha256: string | null;
  extracted_text_chars: number;
  generated: boolean;
  ragSourceId: string | null;
  eligibility_state: string | null;
  has_openai_file: boolean;
  has_vector_store: boolean;
  last_synced_at: string | null;
  revoked_at: string | null;
  failure_message: string | null;
};

const LIST_RAG_SOURCES_SQL = `SELECT e.id AS "evidenceSourceId",
       e.project_id,
       p.slug,
       p.title,
       p.lifecycle_state,
       e.source_type,
       e.source_url,
       e.source_ref,
       e.repo_visibility,
       e.privacy_state,
       e.extracted_text_sha256,
       length(trim(coalesce(e.extracted_text, ''))) AS extracted_text_chars,
       COALESCE(e.claim_map->>'generated', 'false') = 'true' AS generated,
       r.id AS "ragSourceId",
       r.eligibility_state,
       r.openai_file_id IS NOT NULL AS has_openai_file,
       r.vector_store_id IS NOT NULL AS has_vector_store,
       r.last_synced_at,
       r.revoked_at,
       r.failure_message
FROM evidence_sources e
JOIN projects p ON p.id = e.project_id
LEFT JOIN rag_sources r ON r.project_id = e.project_id AND r.evidence_source_id = e.id
WHERE e.project_id IS NOT NULL`;

type PostAction =
  | { ok: true; action: 'mark_eligible'; projectId: string; evidenceSourceId: string }
  | { ok: true; action: 'ingest'; ragSourceId: string }
  | { ok: true; action: 'revoke'; ragSourceId: string }
  | { ok: false; status: 400; code: string; message: string };

export function createAdminRagSourcesGetHandler(deps: AdminRagSourcesHandlerDeps = {}): APIRoute {
  return async ({ request }) => {
    try {
      const auth = authorizeAdmin(request, deps);
      if (!auth.ok) return adminJson(auth.status, auth);

      const dbResult = createDbResult(deps);
      if (!dbResult.ok) return adminJson(503, dbResult.body);

      const sources = normalizeRows(await dbResult.db.query<RagSourceListRow>(LIST_RAG_SOURCES_SQL));
      return adminJson(200, {
        ok: true,
        code: 'rag_sources_listed',
        message: 'RAG sources listed.',
        sources,
      });
    } catch (error) {
      return adminJson(500, safeAdminError(error));
    }
  };
}

export function createAdminRagSourcesPostHandler(deps: AdminRagSourcesHandlerDeps = {}): APIRoute {
  return async ({ request }) => {
    try {
      const csrf = requireJsonContentType(request);
      if (!csrf.ok) return adminJson(csrf.status, csrf);

      const auth = authorizeAdmin(request, deps);
      if (!auth.ok) return adminJson(auth.status, auth);

      const body = await readJsonObject(request);
      if (!body.ok) return adminJson(body.status, body);

      const action = validatePostAction(body.value);
      if (!action.ok) return adminJson(action.status, action);

      const dbResult = createDbResult(deps);
      if (!dbResult.ok) return adminJson(503, dbResult.body);

      if (action.action === 'mark_eligible') {
        const result = await markRagSourceEligible(dbResult.db, {
          projectId: action.projectId,
          evidenceSourceId: action.evidenceSourceId,
          actor: auth.actor,
        });
        return adminJson(result.status, result);
      }

      const client = deps.ragClient ?? createOpenAiRagIndexClient();

      if (action.action === 'ingest') {
        const result = await ingestRagSource(
          dbResult.db,
          client,
          action.ragSourceId,
          auth.actor,
          deps.ingestOptions ?? { vectorStoreId: readRagVectorStoreId() },
        );
        return adminJson(result.status, result);
      }

      const result = await revokeRagSource(dbResult.db, client, action.ragSourceId, auth.actor);
      return adminJson(result.status, result);
    } catch (error) {
      return adminJson(500, safeAdminError(error));
    }
  };
}

function validatePostAction(body: Record<string, unknown>): PostAction {
  const action = body.action;
  if (action !== 'mark_eligible' && action !== 'ingest' && action !== 'revoke') {
    return { ok: false, status: 400, code: 'invalid_action', message: 'action must be mark_eligible, ingest, or revoke.' };
  }

  if (action === 'mark_eligible') {
    if (!isNonEmptyString(body.projectId)) {
      return { ok: false, status: 400, code: 'invalid_body', message: 'projectId must be a non-empty string for mark_eligible.' };
    }
    if (!isNonEmptyString(body.evidenceSourceId)) {
      return {
        ok: false,
        status: 400,
        code: 'invalid_body',
        message: 'evidenceSourceId must be a non-empty string for mark_eligible.',
      };
    }
    return { ok: true, action, projectId: body.projectId.trim(), evidenceSourceId: body.evidenceSourceId.trim() };
  }

  if (!isNonEmptyString(body.ragSourceId)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_body',
      message: `ragSourceId must be a non-empty string for ${action}.`,
    };
  }

  return { ok: true, action, ragSourceId: body.ragSourceId.trim() };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeRows<Row>(result: { rows: Row[] } | Row[]): Row[] {
  return Array.isArray(result) ? result : result.rows;
}

function authorizeAdmin(
  request: Request,
  deps: AdminRagSourcesHandlerDeps,
): AdminSessionResult | { ok: false; status: 503; code: string; message: string } {
  if (deps.session) return deps.session(request);
  try {
    return requireAdminSession(request, deps.authConfig ?? readAdminAuthConfig());
  } catch {
    return { ok: false, status: 503, code: 'admin_auth_unconfigured', message: 'Admin authentication is not configured.' };
  }
}

function requireJsonContentType(request: Request): { ok: true } | { ok: false; status: 403; code: string; message: string } {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.toLowerCase().includes('application/json')) return { ok: true };
  return { ok: false, status: 403, code: 'admin_csrf_content_type', message: 'Admin mutation requests require application/json.' };
}

async function readJsonObject(
  request: Request,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; status: 400; code: string; message: string }> {
  try {
    const value = await request.json();
    if (value && typeof value === 'object' && !Array.isArray(value)) return { ok: true, value };
  } catch {
    return { ok: false, status: 400, code: 'invalid_json', message: 'Request body must be valid JSON.' };
  }
  return { ok: false, status: 400, code: 'invalid_body', message: 'Request body must be a JSON object.' };
}

function createDbResult(
  deps: AdminRagSourcesHandlerDeps,
): { ok: true; db: RagQueryable } | { ok: false; body: { ok: false; code: string; message: string } } {
  try {
    return { ok: true, db: deps.db ?? dbFromClient(deps.createClient?.() ?? createDbClient(getDatabaseUrl())) };
  } catch {
    return { ok: false, body: { ok: false, code: 'database_config_missing', message: 'Admin database configuration is missing.' } };
  }
}

function dbFromClient(client: DbClient): RagQueryable {
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
  console.error('[admin-rag]', JSON.stringify(details));
  return { ok: false, status: 500, code: 'admin_internal_error', message: `Admin RAG request failed. Error ref ${errorRef}.`, errorRef };
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

export const GET = createAdminRagSourcesGetHandler();
export const POST = createAdminRagSourcesPostHandler();
export const ALL: APIRoute = () => adminJson(405, { ok: false, code: 'method_not_allowed', message: 'Use GET or POST.' });
