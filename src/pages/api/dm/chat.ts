import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { createDbClient, getDatabaseUrl, type DbClient } from '@/lib/db/client';
import type { ProjectReadQueryable } from '@/lib/db/project-reads';
import {
  createDMChatResponse,
  DMAgentError,
  DMRuntimeConfigError,
  readDMRuntimeConfig,
  readDMBudgetConfig,
  type DMRuntimeConfig,
  type DMRuntimeDeps,
  type DMRuntimeEnv,
} from '@/lib/dm/runtime';
import {
  consumeDMRateLimit,
  DMRateLimitConfigError,
  DMRateLimitStorageError,
  readDMRateLimitConfig,
  resolveTrustedVercelClientAddress,
  type DMClientAddressResolver,
  type DMRateLimitConfig,
  type DMRateLimitEnv,
} from '@/lib/dm/rate-limit';
import { createDMMetricsRecorder } from '@/lib/dm/metrics';
import type { DMChatContext, DMChatRequest, DMUIMessage } from '@/lib/dm/contract';
import { dmPageContextId, DMPageContextError, parseDMPageContext } from '@/lib/dm/guide';
import { loadPublicProfileEntries } from '@/data/profile';
import { resolvePublicProjectSourceMode, type PublicProjectSourceMode } from '@/lib/public-projects';

export const prerender = false;

/** Hard ceiling on an accepted chat request body, in bytes. */
const REQUEST_BODY_LIMIT = 64_000;

export interface DMPostHandlerDeps {
  config?: DMRuntimeConfig;
  env?: DMRuntimeEnv & DMRateLimitEnv;
  db?: DMRuntimeDeps['db'];
  model?: DMRuntimeDeps['model'];
  projectLoader?: DMRuntimeDeps['projectLoader'];
  profileLoader?: DMRuntimeDeps['profileLoader'];
  createDb?: (connectionString?: string) => DbClient;
  clientAddressResolver?: DMClientAddressResolver;
  rateLimitConfig?: DMRateLimitConfig;
  now?: () => number;
}

export function createDMPostHandler(deps: DMPostHandlerDeps = {}): APIRoute {
  return async ({ request }) => {
    const traceId = randomUUID();
    let config: DMRuntimeConfig;
    let db: DMRuntimeDeps['db'];
    let projectSourceMode: PublicProjectSourceMode;

    try {
      config = deps.config ?? readDMRuntimeConfig(deps.env);
      projectSourceMode = resolvePublicProjectSourceMode({
        env: deps.env,
        ...(deps.db ? { db: deps.db } : {}),
      });
      db = deps.db ?? (
        projectSourceMode === 'catalog_emergency'
          ? unavailableEmergencyDb()
          : projectReadDb((deps.createDb ?? createDbClient)(getDatabaseUrl(deps.env)))
      );
    } catch (error) {
      if (error instanceof DMRuntimeConfigError) {
        console.error('[dm] missing runtime config', { missing: error.missing });
        return jsonError(503, 'missing_config', 'DM is not configured for chat yet.', traceId);
      }
      if (error instanceof Error) {
        console.error('[dm] database config failure', { message: error.message });
        return jsonError(503, 'missing_config', 'DM is not configured for chat yet.', traceId);
      }
      throw error;
    }

    try {
      if (shouldEnforceRateLimit(deps.env, deps)) {
        const limiterConfig = deps.rateLimitConfig ?? readDMRateLimitConfig(deps.env);
        const address = (deps.clientAddressResolver ?? ((input) => resolveTrustedVercelClientAddress(input, deps.env)))(request);
        if (!address) throw new DMRateLimitConfigError('Trusted DM client address is unavailable.');
        let limiterDb = db;
        if (!deps.db && projectSourceMode === 'catalog_emergency') {
          try {
            limiterDb = projectReadDb((deps.createDb ?? createDbClient)(getDatabaseUrl(deps.env)));
          } catch {
            throw new DMRateLimitStorageError('DM rate limiter storage is unavailable.');
          }
        }
        const limiter = await consumeDMRateLimit(limiterDb, limiterConfig, address, deps.now?.() ?? Date.now());
        if (!limiter.allowed) {
          const metrics = createDMMetricsRecorder({ traceId });
          metrics.finish('rate_limited');
          return jsonError(429, 'rate_limited', 'DM is busy right now. Please try again shortly.', traceId, {
            'Retry-After': String(limiter.retryAfterSeconds),
          });
        }
      }
      assertRequestSize(request);
      const payload = await parseDMChatRequest(request);
      const response = createDMChatResponse(payload, config, {
        db,
        model: deps.model,
        projectLoader: deps.projectLoader,
        profileLoader: deps.profileLoader ?? loadPublicProfileEntries,
        env: deps.env,
        signal: request.signal,
        traceId,
        budgets: readDMBudgetConfig(deps.env),
      });
      response.headers.set('X-Public-Project-Source', projectSourceMode);
      return response;
    } catch (error) {
      if (error instanceof DMAgentError) {
        console.error('[dm] agent failure', { code: error.code, message: error.message });
        return jsonError(502, error.code, error.safeMessage, traceId);
      }

      if (error instanceof Error && error.name === 'BadRequestError') {
        return jsonError(400, 'bad_request', error.message, traceId);
      }

      if (error instanceof DMRateLimitConfigError || error instanceof DMRateLimitStorageError) {
        return jsonError(503, 'rate_limit_unavailable', 'DM is unavailable right now. Please try again shortly.', traceId);
      }

      if (error instanceof DMRuntimeConfigError) {
        console.error('[dm] budget config failure', { missing: error.missing });
        return jsonError(503, 'missing_config', 'DM is not configured for chat yet.', traceId);
      }

      console.error('[dm] chat endpoint failure', { name: error instanceof Error ? error.name : typeof error });
      return jsonError(500, 'chat_failed', 'DM could not answer that safely. Try a portfolio or resume question.', traceId);
    }
  };
}

function projectReadDb(client: DbClient): ProjectReadQueryable {
  return {
    query<Row = unknown>(sql: string, params?: unknown[]) {
      return client.query(sql, params) as Promise<Row[]>;
    },
  };
}

function unavailableEmergencyDb(): ProjectReadQueryable {
  return {
    async query() {
      throw new Error('Database access is disabled while catalog_emergency is active.');
    },
  };
}

export const POST = createDMPostHandler();

export const ALL: APIRoute = () => jsonError(405, 'method_not_allowed', 'Use POST with a visitor message.');

export async function parseDMChatRequest(request: Request): Promise<DMChatRequest> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw badRequest('Request body must be JSON.');
  }

  if (!body || typeof body !== 'object') {
    throw badRequest('Request body must be an object.');
  }

  const candidate = body as Record<string, unknown>;
  const context = parseContext(candidate.context);
  const messages = parseMessages(candidate.messages, dmPageContextId(context.page));

  return { messages, context };
}

function assertRequestSize(request: Request): void {
  const contentLength = request.headers.get('content-length');
  if (!contentLength) return;
  const size = Number.parseInt(contentLength, 10);
  if (Number.isFinite(size) && size > REQUEST_BODY_LIMIT) {
    throw badRequest('Request body is too large.');
  }
}

function parseMessages(value: unknown, pageContextId: string): DMUIMessage[] {
  if (!Array.isArray(value) || value.length === 0) throw badRequest('messages must be a non-empty array.');
  const messages = value.slice(-13).map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw badRequest('message entries must be objects.');
    }

    const record = entry as Record<string, unknown>;
    if (typeof record.id !== 'string' || !record.id.trim() || record.id.length > 200) {
      throw badRequest('message id must be a bounded string.');
    }
    if (record.role !== 'user' && record.role !== 'assistant') {
      throw badRequest('message role must be user or assistant.');
    }
    if (!Array.isArray(record.parts) || record.parts.length === 0) {
      throw badRequest('message parts must be a non-empty array.');
    }
    if (!record.metadata || typeof record.metadata !== 'object' || Array.isArray(record.metadata)) {
      throw badRequest('message metadata must identify its page context.');
    }
    const metadata = record.metadata as Record<string, unknown>;
    if (Object.keys(metadata).some((key) => key !== 'pageContextId') || metadata.pageContextId !== pageContextId) {
      throw badRequest('message history does not match the active page context.');
    }
    return {
      id: record.id,
      role: record.role,
      metadata: { pageContextId },
      parts: record.parts.map((part) => {
        if (!part || typeof part !== 'object') throw badRequest('message parts must be objects.');
        const value = part as Record<string, unknown>;
        if (value.type !== 'text' || typeof value.text !== 'string') {
          throw badRequest('only text message parts are accepted.');
        }
        return { type: 'text' as const, text: value.text.slice(0, 4_000) };
      }),
    } satisfies DMUIMessage;
  });
  if (messages.at(-1)?.role !== 'user') throw badRequest('the latest message must be from the user.');
  return messages;
}

function parseContext(value: unknown): DMChatContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest('context must be an object.');
  }

  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['page', 'projectIds', 'resumeTrackIds'].includes(key))) {
    throw badRequest('context contains unsupported fields.');
  }
  let page: DMChatContext['page'];
  try {
    page = parseDMPageContext(record.page);
  } catch (error) {
    if (error instanceof DMPageContextError) throw badRequest(error.message);
    throw error;
  }
  const projectIds = parseStringArray(record.projectIds, 'context.projectIds');
  const resumeTrackIds = parseStringArray(record.resumeTrackIds, 'context.resumeTrackIds');
  // Project route references are public slugs, not necessarily internal project
  // IDs. Keep the slug in the validated page contract and let the public
  // getProject tool resolve it through its slug input.
  const expectedProjectIds = undefined;
  const expectedResumeTrackIds = page.kind === 'journey' && page.reference ? [page.reference] : undefined;

  if (!sameOptionalStringArray(projectIds, expectedProjectIds)) {
    throw badRequest('context.projectIds must be derived from the active project route.');
  }
  if (!sameOptionalStringArray(resumeTrackIds, expectedResumeTrackIds)) {
    throw badRequest('context.resumeTrackIds must be derived from the active journey route.');
  }
  return { page, projectIds: expectedProjectIds, resumeTrackIds: expectedResumeTrackIds };
}

function parseStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw badRequest(`${field} must be an array when provided.`);

  return value.map((item) => {
    if (typeof item !== 'string') throw badRequest(`${field} entries must be strings.`);
    return item;
  });
}

function sameOptionalStringArray(actual: string[] | undefined, expected: string[] | undefined): boolean {
  if (!actual && !expected) return true;
  return Boolean(actual && expected && actual.length === expected.length && actual.every((item, index) => item === expected[index]));
}

function jsonError(status: number, code: string, message: string, traceId?: string, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...(traceId ? { 'X-DM-Trace-Id': traceId } : {}),
      ...extraHeaders,
    },
  });
}

function shouldEnforceRateLimit(env: DMRuntimeEnv | undefined, deps: DMPostHandlerDeps): boolean {
  return (env ?? process.env).VERCEL === '1' || Boolean(deps.rateLimitConfig || deps.clientAddressResolver);
}

function badRequest(message: string): Error {
  const error = new Error(message);
  error.name = 'BadRequestError';
  return error;
}
