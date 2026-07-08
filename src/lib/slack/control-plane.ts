import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  scanGithubRepositoryCandidate,
  type GithubDiscoveryScanResult,
  type GithubRepositorySnapshot,
} from '../db/github-discovery';
import type { JsonRecord } from '../db/schema';

export const SLACK_SIGNATURE_VERSION = 'v0';
export const DEFAULT_SLACK_SIGNATURE_TOLERANCE_SECONDS = 60 * 5;

export interface SlackControlPlaneQueryable {
  query<Row = unknown>(sql: string, params?: unknown[]): Promise<{ rows: Row[] } | Row[]>;
}

export interface SlackControlPlaneConfig {
  signingSecret: string;
  allowedUserId: string;
  signatureToleranceSeconds?: number;
  now?: () => Date;
}

export interface SlackRequestVerificationInput {
  body: string;
  timestamp: string | null;
  signature: string | null;
}

export type SlackRequestVerificationResult =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string };

export interface SlackCommandPayload {
  userId: string;
  command: string;
  text: string;
  responseUrl?: string;
  triggerId?: string;
}

export type SlackCandidateAction = 'draft' | 'dismiss' | 'snooze';

export interface SlackInteractionPayload {
  userId: string;
  action: SlackCandidateAction;
  candidateId: string;
  responseUrl?: string;
}

export type SlackBlock = Record<string, unknown>;

export type SlackControlPlaneResult = {
  ok: boolean;
  status: number;
  code: string;
  message: string;
  responseType?: 'ephemeral' | 'in_channel';
  blocks?: SlackBlock[];
  scan?: GithubDiscoveryScanResult;
  candidateId?: string;
  draftId?: string;
};

interface CandidateRow {
  id: string;
  scan_run_id: string | null;
  source_ref: string;
  signals: JsonRecord;
  confidence: string;
  evidence_packet: JsonRecord;
  lifecycle_state: string;
}

interface DraftRow {
  id: string;
}

export function verifySlackRequest(
  input: SlackRequestVerificationInput,
  config: SlackControlPlaneConfig,
): SlackRequestVerificationResult {
  const signingSecret = config.signingSecret.trim();
  if (!signingSecret) {
    return {
      ok: false,
      status: 503,
      code: 'slack_signing_secret_missing',
      message: 'Slack signing secret is not configured.',
    };
  }

  if (!input.timestamp) {
    return { ok: false, status: 401, code: 'slack_timestamp_missing', message: 'Slack timestamp is required.' };
  }

  if (!input.signature) {
    return { ok: false, status: 401, code: 'slack_signature_missing', message: 'Slack signature is required.' };
  }

  const timestampSeconds = Number(input.timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return { ok: false, status: 401, code: 'slack_timestamp_invalid', message: 'Slack timestamp is invalid.' };
  }

  const nowSeconds = Math.floor((config.now?.() ?? new Date()).getTime() / 1000);
  const tolerance = config.signatureToleranceSeconds ?? DEFAULT_SLACK_SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(nowSeconds - timestampSeconds) > tolerance) {
    return { ok: false, status: 401, code: 'slack_timestamp_stale', message: 'Slack timestamp is outside tolerance.' };
  }

  const expected = signSlackBody(signingSecret, input.timestamp, input.body);
  if (!safeEqual(expected, input.signature)) {
    return { ok: false, status: 401, code: 'slack_signature_invalid', message: 'Slack signature is invalid.' };
  }

  return { ok: true };
}

export function signSlackBody(signingSecret: string, timestamp: string, body: string): string {
  const base = `${SLACK_SIGNATURE_VERSION}:${timestamp}:${body}`;
  return `${SLACK_SIGNATURE_VERSION}=${createHmac('sha256', signingSecret).update(base).digest('hex')}`;
}

export async function handleSlackFormEncodedRequest(
  db: SlackControlPlaneQueryable,
  config: SlackControlPlaneConfig,
  body: string,
): Promise<SlackControlPlaneResult> {
  const form = new URLSearchParams(body);
  const interactionPayload = form.get('payload');

  try {
    if (interactionPayload) {
      return await handleSlackInteraction(db, config, parseSlackInteractionPayload(interactionPayload));
    }

    return await handleSlackCommand(db, config, parseSlackCommandPayload(form));
  } catch (error) {
    return safeSlackError(error);
  }
}

export async function handleSlackCommand(
  db: SlackControlPlaneQueryable,
  config: SlackControlPlaneConfig,
  payload: SlackCommandPayload,
): Promise<SlackControlPlaneResult> {
  const auth = authorizeSlackUser(config, payload.userId);
  if (!auth.ok) return auth;

  const repo = parseSlackRepoSnapshot(payload.text);
  const actor = `slack:${payload.userId}`;
  const scan = await scanGithubRepositoryCandidate(db, { actor, trigger: 'slack', repo });

  if (scan.status === 'qualified') {
    const repoLabel = repo.fullName ?? `${repo.owner}/${repo.name}`;
    return {
      ok: true,
      status: 200,
      code: 'scan_qualified',
      responseType: 'ephemeral',
      message: `Queued review candidate ${scan.candidateId} from ${repoLabel}.`,
      blocks: candidateActionBlocks(scan.candidateId, repoLabel, scan.confidence),
      scan,
      candidateId: scan.candidateId,
    };
  }

  return {
    ok: true,
    status: 200,
    code: 'scan_rejected',
    responseType: 'ephemeral',
    message: `Scan completed with no candidate: ${scan.reason}.`,
    scan,
  };
}

export async function handleSlackInteraction(
  db: SlackControlPlaneQueryable,
  config: SlackControlPlaneConfig,
  payload: SlackInteractionPayload,
): Promise<SlackControlPlaneResult> {
  const auth = authorizeSlackUser(config, payload.userId);
  if (!auth.ok) return auth;

  if (payload.action === 'draft') {
    return requestHiddenDraft(db, payload.candidateId, `slack:${payload.userId}`);
  }

  if (payload.action === 'dismiss') {
    return transitionCandidate(db, payload.candidateId, `slack:${payload.userId}`, {
      action: 'candidate_dismissed',
      afterState: 'dismissed',
      notes: 'Dismissed from Slack control plane.',
      metadata: { source: 'slack_control_plane', decision: 'dismiss' },
      message: `Dismissed candidate ${payload.candidateId}.`,
      code: 'candidate_dismissed',
    });
  }

  return snoozeCandidate(db, payload.candidateId, `slack:${payload.userId}`);
}

function candidateActionBlocks(candidateId: string, repoLabel: string, confidence: number): SlackBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Review candidate* \`${candidateId}\`\n${repoLabel} — confidence ${confidence.toFixed(2)}`,
      },
    },
    {
      type: 'actions',
      block_id: `candidate_actions_${candidateId}`,
      elements: [
        {
          type: 'button',
          style: 'primary',
          action_id: 'dm_candidate_draft',
          value: candidateId,
          text: { type: 'plain_text', text: 'Draft' },
        },
        {
          type: 'button',
          action_id: 'dm_candidate_snooze',
          value: candidateId,
          text: { type: 'plain_text', text: 'Snooze' },
        },
        {
          type: 'button',
          style: 'danger',
          action_id: 'dm_candidate_dismiss',
          value: candidateId,
          text: { type: 'plain_text', text: 'Dismiss' },
        },
      ],
    },
  ];
}

export function parseSlackCommandPayload(form: URLSearchParams): SlackCommandPayload {
  const userId = requiredFormValue(form, 'user_id');
  const command = requiredFormValue(form, 'command');
  const text = form.get('text')?.trim() ?? '';
  return {
    userId,
    command,
    text,
    responseUrl: optionalFormValue(form, 'response_url'),
    triggerId: optionalFormValue(form, 'trigger_id'),
  };
}

export function parseSlackInteractionPayload(payloadJson: string): SlackInteractionPayload {
  const payload = parseJsonRecord(payloadJson, 'Slack interaction payload must be JSON.');
  const user = recordValue(payload, 'user');
  const userId = stringValue(user, 'id');
  const actions = payload.actions;
  if (!Array.isArray(actions) || actions.length === 0) {
    throw userFacingError('missing_action', 'Slack action payload did not include an action.');
  }

  const actionRecord = asRecord(actions[0], 'Slack action must be an object.');
  const action = parseCandidateAction(stringValue(actionRecord, 'action_id'));
  const candidateId = stringValue(actionRecord, 'value').trim();
  if (!candidateId.startsWith('candidate_')) {
    throw userFacingError('invalid_candidate_id', 'Slack action payload must reference a candidate id.');
  }

  return { userId, action, candidateId, responseUrl: stringValue(payload, 'response_url', true) };
}

export function parseSlackRepoSnapshot(text: string): GithubRepositorySnapshot {
  const trimmed = text.trim();
  if (!trimmed) {
    throw userFacingError('repo_input_missing', 'Use `/dm-scan owner/repo topic=portfolio-candidate`.');
  }

  if (trimmed.startsWith('{')) {
    const parsed = parseJsonRecord(trimmed, 'Repo input JSON is invalid.');
    return parseJsonRepoSnapshot(parsed);
  }

  const [repoToken, ...optionTokens] = trimmed.split(/\s+/);
  if (!repoToken) {
    throw userFacingError('repo_input_missing', 'Use `/dm-scan owner/repo topic=portfolio-candidate`.');
  }

  const match = repoToken.match(/^(?:https:\/\/github\.com\/)?([^/\s]+)\/([^/\s#?]+)(?:[/?#].*)?$/i);
  if (!match) {
    throw userFacingError('repo_input_invalid', 'Repo input must be an owner/repo or GitHub repository URL.');
  }

  const [, owner, rawName] = match;
  const name = rawName?.replace(/\.git$/i, '');
  if (!owner || !name) {
    throw userFacingError('repo_input_invalid', 'Repo input must include both owner and repository name.');
  }

  const options = parseSlackOptions(optionTokens);
  const htmlUrl = `https://github.com/${owner}/${name}`;
  const topicValues = options.topic ?? options.topics;
  const topics = topicValues ? topicValues.split(',').map((topic) => topic.trim()).filter(Boolean) : [];

  return {
    owner,
    name,
    fullName: `${owner}/${name}`,
    htmlUrl,
    description: options.description,
    homepageUrl: options.homepage,
    language: options.language,
    topics,
    isPrivate: options.private === 'true',
    defaultBranch: options.branch,
    readmeMarkdown: options.readme,
  };
}

async function requestHiddenDraft(
  db: SlackControlPlaneQueryable,
  candidateId: string,
  actor: string,
): Promise<SlackControlPlaneResult> {
  const candidate = await fetchCandidate(db, candidateId);
  if (!candidate) return candidateNotFound(candidateId);

  const existingDraft = await fetchDraftForCandidate(db, candidateId);
  const beforeState = candidate.lifecycle_state;
  const draftId = existingDraft?.id ?? `draft_${randomUUID()}`;

  await db.query(
    `UPDATE project_candidates
     SET lifecycle_state = 'draft_requested', updated_at = now()
     WHERE id = $1`,
    [candidateId],
  );

  if (!existingDraft) {
    await db.query(
      `INSERT INTO project_drafts (
         id, candidate_id, proposed_fields, private_notes, provenance_map, lifecycle_state
       ) VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, 'hidden')`,
      [
        draftId,
        candidateId,
        JSON.stringify(buildHiddenDraftFields(candidate)),
        'Created from Slack draft action. Hidden until admin review and publish.',
        JSON.stringify(buildHiddenDraftProvenance(candidate)),
      ],
    );
  }

  await db.query(
    `INSERT INTO review_events (id, draft_id, candidate_id, actor, action, before_state, after_state, notes, metadata)
     VALUES ($1, $2, $3, $4, 'draft_requested', $5, 'draft_requested', $6, $7::jsonb)`,
    [
      `review_${randomUUID()}`,
      draftId,
      candidateId,
      actor,
      beforeState,
      'Slack draft action created a hidden project draft only; no public project row was published.',
      JSON.stringify({ source: 'slack_control_plane', decision: 'draft', draftId }),
    ],
  );

  return {
    ok: true,
    status: 200,
    code: 'hidden_draft_requested',
    responseType: 'ephemeral',
    message: `Created hidden draft ${draftId} for candidate ${candidateId}. Admin publish remains required.`,
    candidateId,
    draftId,
  };
}

async function transitionCandidate(
  db: SlackControlPlaneQueryable,
  candidateId: string,
  actor: string,
  input: {
    action: 'candidate_dismissed';
    afterState: 'dismissed';
    notes: string;
    metadata: JsonRecord;
    message: string;
    code: string;
  },
): Promise<SlackControlPlaneResult> {
  const candidate = await fetchCandidate(db, candidateId);
  if (!candidate) return candidateNotFound(candidateId);

  await db.query(
    `UPDATE project_candidates
     SET lifecycle_state = $2, updated_at = now()
     WHERE id = $1`,
    [candidateId, input.afterState],
  );
  await db.query(
    `INSERT INTO review_events (id, candidate_id, actor, action, before_state, after_state, notes, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      `review_${randomUUID()}`,
      candidateId,
      actor,
      input.action,
      candidate.lifecycle_state,
      input.afterState,
      input.notes,
      JSON.stringify(input.metadata),
    ],
  );

  return {
    ok: true,
    status: 200,
    code: input.code,
    responseType: 'ephemeral',
    message: input.message,
    candidateId,
  };
}

async function snoozeCandidate(
  db: SlackControlPlaneQueryable,
  candidateId: string,
  actor: string,
): Promise<SlackControlPlaneResult> {
  const candidate = await fetchCandidate(db, candidateId);
  if (!candidate) return candidateNotFound(candidateId);

  await db.query(`UPDATE project_candidates SET updated_at = now() WHERE id = $1`, [candidateId]);
  await db.query(
    `INSERT INTO review_events (id, candidate_id, actor, action, before_state, after_state, notes, metadata)
     VALUES ($1, $2, $3, 'note', $4, $4, $5, $6::jsonb)`,
    [
      `review_${randomUUID()}`,
      candidateId,
      actor,
      candidate.lifecycle_state,
      'Snoozed from Slack control plane; candidate remains hidden from public surfaces.',
      JSON.stringify({ source: 'slack_control_plane', decision: 'snooze' }),
    ],
  );

  return {
    ok: true,
    status: 200,
    code: 'candidate_snoozed',
    responseType: 'ephemeral',
    message: `Snoozed candidate ${candidateId}.`,
    candidateId,
  };
}

async function fetchCandidate(
  db: SlackControlPlaneQueryable,
  candidateId: string,
): Promise<CandidateRow | null> {
  const result = await db.query<CandidateRow>(
    `SELECT id, scan_run_id, source_ref, signals, confidence, evidence_packet, lifecycle_state
     FROM project_candidates
     WHERE id = $1`,
    [candidateId],
  );
  return normalizeRows(result)[0] ?? null;
}

async function fetchDraftForCandidate(
  db: SlackControlPlaneQueryable,
  candidateId: string,
): Promise<DraftRow | null> {
  const result = await db.query<DraftRow>(`SELECT id FROM project_drafts WHERE candidate_id = $1 ORDER BY created_at LIMIT 1`, [
    candidateId,
  ]);
  return normalizeRows(result)[0] ?? null;
}

function buildHiddenDraftFields(candidate: CandidateRow): JsonRecord {
  return {
    source: 'github_discovery',
    candidateId: candidate.id,
    sourceRef: candidate.source_ref,
    confidence: Number(candidate.confidence),
    signals: candidate.signals,
    evidencePacket: candidate.evidence_packet,
    visibility: 'hidden',
  };
}

function buildHiddenDraftProvenance(candidate: CandidateRow): JsonRecord {
  return {
    candidateId: candidate.id,
    scanRunId: candidate.scan_run_id,
    sourceRef: candidate.source_ref,
    evidencePacket: candidate.evidence_packet,
    generatedBy: 'slack_control_plane',
    publicPublish: false,
  };
}

function authorizeSlackUser(config: SlackControlPlaneConfig, userId: string): SlackControlPlaneResult {
  if (userId !== config.allowedUserId) {
    return {
      ok: false,
      status: 403,
      code: 'slack_user_forbidden',
      responseType: 'ephemeral',
      message: 'This DM control-plane action is restricted to the configured maintainer.',
    };
  }

  return { ok: true, status: 200, code: 'authorized', message: 'Authorized.' };
}

function parseJsonRepoSnapshot(value: JsonRecord): GithubRepositorySnapshot {
  const owner = stringValue(value, 'owner');
  const name = stringValue(value, 'name');
  const htmlUrl = stringValue(value, 'htmlUrl');
  const topics = value.topics;
  if (!Array.isArray(topics) || !topics.every((topic) => typeof topic === 'string')) {
    throw userFacingError('repo_topics_invalid', 'Repo JSON must include string topics.');
  }

  return {
    owner,
    name,
    fullName: stringValue(value, 'fullName', true) || `${owner}/${name}`,
    htmlUrl,
    description: stringValue(value, 'description', true) || null,
    homepageUrl: stringValue(value, 'homepageUrl', true) || null,
    language: stringValue(value, 'language', true) || null,
    topics,
    isPrivate: booleanValue(value, 'isPrivate'),
    defaultBranch: stringValue(value, 'defaultBranch', true) || null,
    pushedAt: stringValue(value, 'pushedAt', true) || null,
    stars: numberValue(value, 'stars'),
    readmeMarkdown: stringValue(value, 'readmeMarkdown', true) || null,
  };
}

function parseSlackOptions(tokens: string[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (const token of tokens) {
    const separator = token.indexOf('=');
    if (separator <= 0) continue;
    options[token.slice(0, separator)] = token.slice(separator + 1);
  }
  return options;
}

function parseCandidateAction(actionId: string): SlackCandidateAction {
  if (actionId === 'dm_candidate_draft' || actionId === 'draft') return 'draft';
  if (actionId === 'dm_candidate_dismiss' || actionId === 'dismiss') return 'dismiss';
  if (actionId === 'dm_candidate_snooze' || actionId === 'snooze') return 'snooze';
  throw userFacingError('unsupported_action', 'Slack action is not supported.');
}

function requiredFormValue(form: URLSearchParams, key: string): string {
  const value = form.get(key)?.trim();
  if (!value) throw userFacingError('form_value_missing', `Slack form field ${key} is required.`);
  return value;
}

function optionalFormValue(form: URLSearchParams, key: string): string | undefined {
  return form.get(key)?.trim() || undefined;
}

function parseJsonRecord(value: string, message: string): JsonRecord {
  try {
    return asRecord(JSON.parse(value), message);
  } catch (_error) {
    throw userFacingError('invalid_json', message);
  }
}

function recordValue(record: JsonRecord, key: string): JsonRecord {
  return asRecord(record[key], `Slack payload field ${key} must be an object.`);
}

function asRecord(value: unknown, message: string): JsonRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as JsonRecord;
  throw userFacingError('invalid_payload', message);
}

function stringValue(record: JsonRecord, key: string, optional = false): string {
  const value = record[key];
  if (typeof value === 'string') return value;
  if (optional && value == null) return '';
  throw userFacingError('invalid_payload', `Slack payload field ${key} must be a string.`);
}

function booleanValue(record: JsonRecord, key: string): boolean {
  const value = record[key];
  if (typeof value === 'boolean') return value;
  if (value == null) return false;
  throw userFacingError('invalid_payload', `Repo field ${key} must be a boolean.`);
}

function numberValue(record: JsonRecord, key: string): number | null {
  const value = record[key];
  if (typeof value === 'number') return value;
  if (value == null) return null;
  throw userFacingError('invalid_payload', `Repo field ${key} must be a number.`);
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeRows<Row>(result: { rows: Row[] } | Row[]): Row[] {
  return Array.isArray(result) ? result : result.rows;
}

function candidateNotFound(candidateId: string): SlackControlPlaneResult {
  return {
    ok: false,
    status: 404,
    code: 'candidate_not_found',
    responseType: 'ephemeral',
    message: `Candidate ${candidateId} was not found or is no longer available.`,
    candidateId,
  };
}

export function safeSlackError(error: unknown): SlackControlPlaneResult {
  if (error instanceof SlackUserFacingError) {
    return {
      ok: false,
      status: 400,
      code: error.code,
      responseType: 'ephemeral',
      message: error.message,
    };
  }

  const errorRef = logSlackControlPlaneError(error);
  return {
    ok: false,
    status: 500,
    code: 'slack_control_plane_error',
    responseType: 'ephemeral',
    message: `Slack control-plane action failed before changing public project visibility. Error ref ${errorRef}.`,
  };
}

/**
 * Logs an unexpected control-plane error server-side (Vercel runtime logs) and
 * returns a short correlation ref that is safe to show in Slack. Logs only
 * structured facts: the error name, code-location stack frames, and Postgres
 * schema-level fields (code/table/constraint). Free-text `message`, `detail`,
 * `routine`, and stringified thrown values never reach logs — they can carry
 * row data, connection strings, or payload content that no denylist reliably
 * redacts.
 */
function logSlackControlPlaneError(error: unknown): string {
  const errorRef = randomUUID().slice(0, 8);
  const details: Record<string, unknown> = { errorRef };
  if (error instanceof Error) {
    details.name = typeof error.name === 'string' ? error.name : 'Error';
    details.frames = stackFrames(error);
    for (const key of ['code', 'table', 'constraint'] as const) {
      const value = (error as unknown as Record<string, unknown>)[key];
      if (typeof value === 'string') details[`pg_${key}`] = value;
    }
  } else {
    details.thrownType = typeof error;
  }
  console.error('[slack-control-plane]', JSON.stringify(details));
  return errorRef;
}

/**
 * Extracts only real code-location frame lines ("at fn (file:line:col)") from
 * a V8 stack trace with string name/message/stack fields. The complete
 * `name: message` prefix is removed before any frame filtering, so multiline
 * message content cannot spoof a frame-shaped line and reach logs. Unknown stack
 * formats fail closed to no frames.
 */
function stackFrames(error: Error): string[] {
  if (typeof error.stack !== 'string' || typeof error.name !== 'string' || typeof error.message !== 'string') return [];
  const stack = error.stack;
  const prefix = error.message ? `${error.name}: ${error.message}` : error.name;
  if (!stack.startsWith(prefix)) return [];
  return stack
    .slice(prefix.length)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^at .+:\d+:\d+\)?$/.test(line));
}

function userFacingError(code: string, message: string): SlackUserFacingError {
  return new SlackUserFacingError(code, message);
}

class SlackUserFacingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SlackUserFacingError';
  }
}
