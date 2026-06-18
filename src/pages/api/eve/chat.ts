import type { APIRoute } from 'astro';
import {
  createEveAnswer,
  createEveAnswerStream,
  EveRuntimeConfigError,
  isEveToolError,
  readEveRuntimeConfig,
} from '../../../lib/eve/runtime';
import type { EveChatContext, EveChatRequest } from '../../../lib/eve/contract';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  let config;

  try {
    config = readEveRuntimeConfig();
  } catch (error) {
    if (error instanceof EveRuntimeConfigError) {
      console.error('[eve] missing runtime config', { missing: error.missing });
      return jsonError(503, 'missing_config', 'Eve is not configured for chat yet.');
    }
    throw error;
  }

  try {
    const payload = await parseRequest(request);
    const answer = createEveAnswer(payload.message, payload.context);

    return new Response(createEveAnswerStream(answer, config), {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (isEveToolError(error)) {
      console.error('[eve] data tool failure', {
        code: error.code,
        message: error.message,
        details: error.details,
      });
      return jsonError(400, error.code, error.safeMessage);
    }

    if (error instanceof Error && error.name === 'BadRequestError') {
      return jsonError(400, 'bad_request', error.message);
    }

    console.error('[eve] chat endpoint failure', error);
    return jsonError(500, 'chat_failed', 'Eve could not answer that safely. Try a portfolio or resume question.');
  }
};

export const ALL: APIRoute = () =>
  jsonError(405, 'method_not_allowed', 'Use POST with a visitor message.');

async function parseRequest(request: Request): Promise<EveChatRequest> {
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

function parseConversation(value: unknown): EveChatRequest['conversation'] {
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

function parseContext(value: unknown): EveChatContext | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') throw badRequest('context must be an object when provided.');

  const record = value as Record<string, unknown>;
  return {
    projectIds: parseStringArray(record.projectIds, 'context.projectIds'),
    resumeTrackIds: parseStringArray(record.resumeTrackIds, 'context.resumeTrackIds'),
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
