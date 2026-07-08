import type { APIRoute } from 'astro';
import { createDbClient, getDatabaseUrl, type DbClient } from '../../../lib/db/client';
import {
  handleSlackFormEncodedRequest,
  safeSlackError,
  verifySlackRequest,
  type SlackBlock,
  type SlackControlPlaneConfig,
  type SlackControlPlaneQueryable,
} from '../../../lib/slack/control-plane';

export const prerender = false;

export interface SlackControlPlanePostHandlerDeps {
  config?: SlackControlPlaneConfig;
  db?: SlackControlPlaneQueryable;
  createClient?: () => DbClient;
  env?: SlackControlPlaneEnv;
}

type SlackControlPlaneEnv = Partial<{
  SLACK_SIGNING_SECRET: string;
  SLACK_ALLOWED_USER_ID: string;
  DYLAN_SLACK_USER_ID: string;
  DATABASE_URL: string;
  POSTGRES_URL: string;
  PORTFOLIO_DATABASE_URL: string;
  PORTFOLIO_POSTGRES_URL: string;
}>;

export function createSlackControlPlanePostHandler(deps: SlackControlPlanePostHandlerDeps = {}): APIRoute {
  return async ({ request }) => {
    try {
      const body = await request.text();
      const configResult = readConfigResult(deps);
      if (!configResult.ok) return configResult.response;

      const config = configResult.config;
      const verification = verifySlackRequest(
        {
          body,
          timestamp: request.headers.get('x-slack-request-timestamp'),
          signature: request.headers.get('x-slack-signature'),
        },
        config,
      );

      if (!verification.ok) {
        return slackJson(200, false, verification.code, verification.message);
      }

      const dbResult = createDbResult(deps);
      if (!dbResult.ok) return dbResult.response;

      const db = dbResult.db;
      const result = await handleSlackFormEncodedRequest(db, config, body);
      return slackJson(slackHttpStatus(result.status), result.ok, result.code, result.message, result.responseType, result.blocks);
    } catch (error) {
      // Last-resort guard: without it, anything thrown outside
      // handleSlackFormEncodedRequest becomes an Astro 500 and Slack shows
      // "app did not respond" with no server-side trace.
      const result = safeSlackError(error);
      return slackJson(200, false, result.code, result.message, result.responseType);
    }
  };
}

export function readSlackControlPlaneConfig(env: SlackControlPlaneEnv = process.env): SlackControlPlaneConfig {
  const allowedUserId = env.SLACK_ALLOWED_USER_ID?.trim() || env.DYLAN_SLACK_USER_ID?.trim();
  if (!allowedUserId) {
    throw new Error('Missing Slack maintainer user id. Set SLACK_ALLOWED_USER_ID or DYLAN_SLACK_USER_ID.');
  }

  return {
    signingSecret: env.SLACK_SIGNING_SECRET ?? '',
    allowedUserId,
  };
}

function readConfigResult(
  deps: SlackControlPlanePostHandlerDeps,
): { ok: true; config: SlackControlPlaneConfig } | { ok: false; response: Response } {
  try {
    return { ok: true, config: deps.config ?? readSlackControlPlaneConfig(deps.env) };
  } catch (_error) {
    return {
      ok: false,
      response: slackJson(
        200,
        false,
        'slack_config_missing',
        'Slack control-plane configuration is missing. Configure the signing secret and maintainer user id in the environment.',
      ),
    };
  }
}

function createDbResult(
  deps: SlackControlPlanePostHandlerDeps,
): { ok: true; db: SlackControlPlaneQueryable } | { ok: false; response: Response } {
  try {
    return { ok: true, db: deps.db ?? dbFromClient(deps.createClient?.() ?? createDbClient(getDatabaseUrl(deps.env))) };
  } catch (_error) {
    return {
      ok: false,
      response: slackJson(
        200,
        false,
        'database_config_missing',
        'Slack control-plane database configuration is missing.',
      ),
    };
  }
}

function dbFromClient(client: DbClient): SlackControlPlaneQueryable {
  return {
    async query<Row = unknown>(query: string, params?: unknown[]) {
      const rows = (await client.query(query, params)) as Row[];
      return { rows };
    },
  };
}

function slackHttpStatus(resultStatus: number): number {
  return resultStatus >= 400 ? 200 : resultStatus;
}

function slackJson(
  status: number,
  ok: boolean,
  code: string,
  message: string,
  responseType: 'ephemeral' | 'in_channel' = 'ephemeral',
  blocks?: SlackBlock[],
): Response {
  return new Response(
    JSON.stringify({
      ok,
      code,
      response_type: responseType,
      text: message,
      ...(blocks?.length ? { blocks } : {}),
    }),
    {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}

export const POST = createSlackControlPlanePostHandler();

export const ALL: APIRoute = () => slackJson(405, false, 'method_not_allowed', 'Use POST from Slack.');
