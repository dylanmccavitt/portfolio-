import type { APIRoute } from 'astro';
import { createDbClient, getDatabaseUrl, type DbClient } from '../../../lib/db/client';
import type { ProjectReadQueryable } from '../../../lib/db/project-reads';
import {
  createDMChatStream,
  DMAgentError,
  DMRuntimeConfigError,
  readDMRuntimeConfig,
  type DMRuntimeConfig,
  type DMRuntimeDeps,
  type DMRuntimeEnv,
} from '../../../lib/dm/runtime';
import type { DMChatContext, DMChatRequest } from '../../../lib/dm/contract';
import {
  FIT_CHECK_INPUT_LIMIT,
  FIT_CHECK_MIN_CHARS,
  FIT_CHECK_REQUEST_BODY_LIMIT,
  sanitizeJobDescriptionForFitCheck,
} from '../../../lib/dm/fit-check';

export const prerender = false;

export interface DMPostHandlerDeps {
  config?: DMRuntimeConfig;
  env?: DMRuntimeEnv;
  db?: DMRuntimeDeps['db'];
  model?: DMRuntimeDeps['model'];
  createDb?: (connectionString?: string) => DbClient;
}

export function createDMPostHandler(deps: DMPostHandlerDeps = {}): APIRoute {
  return async ({ request }) => {
    let config: DMRuntimeConfig;
    let db: DMRuntimeDeps['db'];

    try {
      config = deps.config ?? readDMRuntimeConfig(deps.env);
      db = deps.db ?? projectReadDb((deps.createDb ?? createDbClient)(getDatabaseUrl(deps.env)));
    } catch (error) {
      if (error instanceof DMRuntimeConfigError) {
        console.error('[dm] missing runtime config', { missing: error.missing });
        return jsonError(503, 'missing_config', 'DM is not configured for chat yet.');
      }
      if (error instanceof Error) {
        console.error('[dm] database config failure', { message: error.message });
        return jsonError(503, 'missing_config', 'DM is not configured for chat yet.');
      }
      throw error;
    }

    try {
      assertRequestSize(request);
      const payload = await parseRequest(request);
      return new Response(createDMChatStream(payload, config, { db, model: deps.model }), {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (error) {
      if (error instanceof DMAgentError) {
        console.error('[dm] agent failure', { code: error.code, message: error.message });
        return jsonError(502, error.code, error.safeMessage);
      }

      if (error instanceof Error && error.name === 'BadRequestError') {
        return jsonError(400, 'bad_request', error.message);
      }

      console.error('[dm] chat endpoint failure', error);
      return jsonError(500, 'chat_failed', 'DM could not answer that safely. Try a portfolio or resume question.');
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

export const POST = createDMPostHandler();

export const ALL: APIRoute = () => jsonError(405, 'method_not_allowed', 'Use POST with a visitor message.');

async function parseRequest(request: Request): Promise<DMChatRequest> {
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
  const message = candidate.message;
  if (typeof message !== 'string') {
    throw badRequest('Request body must include a string message.');
  }

  const conversation = parseConversation(candidate.conversation);
  const context = parseContext(candidate.context);

  return { message, conversation, context };
}

function assertRequestSize(request: Request): void {
  const contentLength = request.headers.get('content-length');
  if (!contentLength) return;
  const size = Number.parseInt(contentLength, 10);
  if (Number.isFinite(size) && size > FIT_CHECK_REQUEST_BODY_LIMIT) {
    throw badRequest('Request body is too large.');
  }
}

function parseConversation(value: unknown): DMChatRequest['conversation'] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw badRequest('conversation must be an array when provided.');

  return value.slice(-12).map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw badRequest('conversation entries must be objects.');
    }

    const record = entry as Record<string, unknown>;
    if (record.role !== 'user' && record.role !== 'assistant') {
      throw badRequest('conversation role must be user or assistant.');
    }

    if (typeof record.content !== 'string') {
      throw badRequest('conversation content must be a string.');
    }

    return {
      role: record.role,
      content: record.content.slice(0, 4000),
    };
  });
}

function parseContext(value: unknown): DMChatContext | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') throw badRequest('context must be an object when provided.');

  const record = value as Record<string, unknown>;
  return {
    projectIds: parseStringArray(record.projectIds, 'context.projectIds'),
    resumeTrackIds: parseStringArray(record.resumeTrackIds, 'context.resumeTrackIds'),
    fitCheck: parseFitCheckContext(record.fitCheck),
  };
}

function parseStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw badRequest(`${field} must be an array when provided.`);

  return value.map((item) => {
    if (typeof item !== 'string') throw badRequest(`${field} entries must be strings.`);
    return item;
  });
}

function parseFitCheckContext(value: unknown): DMChatContext['fitCheck'] {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') {
    throw badRequest('context.fitCheck must be an object when provided.');
  }

  const record = value as Record<string, unknown>;
  if (record.kind !== 'job-description') {
    throw badRequest('context.fitCheck.kind must be job-description.');
  }
  if (typeof record.jobDescription !== 'string') {
    throw badRequest('context.fitCheck.jobDescription must be a string.');
  }
  if (record.jobDescription.length > FIT_CHECK_INPUT_LIMIT) {
    throw badRequest(`context.fitCheck.jobDescription must be ${FIT_CHECK_INPUT_LIMIT} characters or fewer.`);
  }

  const sanitized = sanitizeJobDescriptionForFitCheck(record.jobDescription);
  if (sanitized.jobDescription.length < FIT_CHECK_MIN_CHARS) {
    throw badRequest(`context.fitCheck.jobDescription must be at least ${FIT_CHECK_MIN_CHARS} characters after sanitizing.`);
  }

  return {
    kind: 'job-description',
    jobDescription: sanitized.jobDescription,
    originalLength:
      typeof record.originalLength === 'number' && Number.isFinite(record.originalLength)
        ? Math.max(0, Math.trunc(record.originalLength))
        : sanitized.originalLength,
    truncated: Boolean(record.truncated) || sanitized.truncated,
  };
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function badRequest(message: string): Error {
  const error = new Error(message);
  error.name = 'BadRequestError';
  return error;
}
