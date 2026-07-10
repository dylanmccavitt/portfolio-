import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  EDITABLE_PUBLIC_FIELDS,
  isEditablePublicField,
  updateAdminDraftFields,
  validatePublicFieldUpdate,
  type EditablePublicField,
} from '@/lib/admin/publish';
import {
  scanGithubRepositoryCandidate,
  type GithubDiscoveryScanResult,
  type GithubRepositorySnapshot,
} from '@/lib/db/github-discovery';
import type { JsonRecord, JsonValue, RepoVisibility } from '@/lib/db/schema';
import { GithubSnapshotFetchError, type GithubSnapshotFetcher } from './github-fetch';

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
  githubFetcher?: GithubSnapshotFetcher;
  fetchImpl?: typeof fetch;
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
  repo_visibility: RepoVisibility;
  signals: JsonRecord;
  confidence: string;
  evidence_packet: JsonRecord;
  lifecycle_state: string;
}

interface DraftRow {
  id: string;
}

interface PublishedProjectSourceRow {
  id: string;
  slug: string;
  canonical_full_name: string;
}

interface SlackFieldUpdateInput {
  target: string;
  field: EditablePublicField;
  value: JsonValue;
}

interface ParsedSlackRepoSnapshotInput {
  repo: GithubRepositorySnapshot;
  isJson: boolean;
  options: Record<string, string>;
  hasExplicitTopics: boolean;
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

  if (interactionPayload) {
    const responseUrl = parseSlackInteractionResponseUrl(interactionPayload);
    let result: SlackControlPlaneResult;

    try {
      result = await handleSlackInteraction(db, config, parseSlackInteractionPayload(interactionPayload));
    } catch (error) {
      result = safeSlackError(error);
    }

    await postSlackInteractionAck(config, responseUrl, result);
    return result;
  }

  try {
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

  const update = parseSlackFieldUpdate(payload);
  if (update) return stageSlackFieldUpdate(db, config, update, `slack:${payload.userId}`);

  const parsed = parseSlackRepoSnapshotInput(payload.text);
  const { repo, scannerMode } = await resolveSlackRepoSnapshot(config, parsed);
  const actor = `slack:${payload.userId}`;
  const scan = await scanGithubRepositoryCandidate(db, { actor, trigger: 'slack', repo, scannerMode });

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
      draftId: scan.draftId,
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
          text: { type: 'plain_text', text: 'Send to admin review' },
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

function parseSlackInteractionResponseUrl(payloadJson: string): string | undefined {
  try {
    const payload = parseJsonRecord(payloadJson, 'Slack interaction payload must be JSON.');
    const responseUrl = payload.response_url;
    return typeof responseUrl === 'string' && responseUrl.trim() ? responseUrl.trim() : undefined;
  } catch (_error) {
    return undefined;
  }
}

async function postSlackInteractionAck(
  config: SlackControlPlaneConfig,
  responseUrl: string | undefined,
  result: SlackControlPlaneResult,
): Promise<void> {
  const trustedUrl = trustedSlackResponseUrl(responseUrl);
  if (!trustedUrl) return;

  try {
    const response = await (config.fetchImpl ?? globalThis.fetch)(trustedUrl.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        response_type: 'ephemeral',
        replace_original: false,
        text: result.message,
      }),
    });
    if (!response.ok) {
      logSlackInteractionAckWarning({ reason: 'http_status', status: response.status });
    }
  } catch (error) {
    const details =
      error instanceof Error
        ? { name: typeof error.name === 'string' ? error.name : 'Error', frames: stackFrames(error) }
        : { thrownType: typeof error };
    logSlackInteractionAckWarning({
      reason: 'fetch_error',
      ...details,
    });
  }
}

function trustedSlackResponseUrl(responseUrl: string | undefined): URL | null {
  if (!responseUrl) return null;
  try {
    const url = new URL(responseUrl);
    return url.protocol === 'https:' && url.hostname === 'hooks.slack.com' ? url : null;
  } catch (_error) {
    return null;
  }
}

function parseSlackRepoSnapshotInput(text: string): ParsedSlackRepoSnapshotInput {
  const trimmed = text.trim();
  if (!trimmed) {
    throw userFacingError('repo_input_missing', 'Use `/dm-scan owner/repo topic=portfolio-candidate`.');
  }

  if (trimmed.startsWith('{')) {
    const parsed = parseJsonRecord(trimmed, 'Repo input JSON is invalid.');
    return {
      repo: parseJsonRepoSnapshot(parsed),
      isJson: true,
      options: {},
      hasExplicitTopics: true,
    };
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
    repo: {
      repositoryId: options.repositoryId ?? '',
      owner,
      name,
      fullName: `${owner}/${name}`,
      htmlUrl,
      description: options.description,
      homepageUrl: options.homepage,
      language: options.language,
      topics,
      isPrivate: options.private === 'true',
      defaultBranch: options.branch ?? '',
      sourceRevision: options.revision ?? '',
      readmeMarkdown: options.readme,
      portfolioManifest: { status: 'missing' },
    },
    isJson: false,
    options,
    hasExplicitTopics: hasOwnOption(options, 'topic') || hasOwnOption(options, 'topics'),
  };
}

async function resolveSlackRepoSnapshot(
  config: SlackControlPlaneConfig,
  parsed: ParsedSlackRepoSnapshotInput,
): Promise<{ repo: GithubRepositorySnapshot; scannerMode: 'manual-snapshot' | 'live-github' }> {
  if (!config.githubFetcher) {
    // Tests and explicit offline callers may supply a complete snapshot. The
    // deployed Slack route always configures the authenticated fetcher below.
    if (parsed.isJson) return { repo: parsed.repo, scannerMode: 'manual-snapshot' };
    throw userFacingError('github_fetch_unconfigured', 'GitHub snapshot fetching is required for owner/repo scans.');
  }

  let fetched: GithubRepositorySnapshot;
  try {
    fetched = await config.githubFetcher(parsed.repo.owner, parsed.repo.name);
  } catch (error) {
    if (error instanceof GithubSnapshotFetchError) {
      throw userFacingError(error.code, error.message);
    }
    throw userFacingError(
      'github_fetch_failed',
      'GitHub metadata fetch failed before scanning. Check repository access and try again.',
    );
  }

  return {
    repo: parsed.isJson ? fetched : applySlackQualificationOptions(fetched, parsed.options),
    scannerMode: 'live-github',
  };
}

function applySlackQualificationOptions(
  fetched: GithubRepositorySnapshot,
  options: Record<string, string>,
): GithubRepositorySnapshot {
  const hasExplicitTopics = hasOwnOption(options, 'topic') || hasOwnOption(options, 'topics');
  const explicitTopics = (options.topic ?? options.topics ?? '')
    .split(',')
    .map((topic) => topic.trim())
    .filter(Boolean);
  return {
    ...fetched,
    // Source identity, visibility, and content are authenticated GitHub facts.
    // Slack text can qualify a scan, but must never masquerade as repository
    // evidence or downgrade a private repository to public evidence.
    topics: hasExplicitTopics ? mergeTopics(fetched.topics, explicitTopics) : fetched.topics,
  };
}

/** Explicit topic= options add to (never replace) fetched topics, so a manual allowlist tag qualifies untagged repos. */
function mergeTopics(fetched: string[], explicit: string[]): string[] {
  return [...new Set([...fetched, ...explicit])];
}

function parseSlackFieldUpdate(payload: SlackCommandPayload): SlackFieldUpdateInput | null {
  const command = payload.command.trim().toLowerCase();
  const updateCommand = command === '/dm-update';
  const text = updateCommand ? payload.text.trim() : payload.text.trim().replace(/^update\s+/i, '');
  if (!updateCommand && text === payload.text.trim()) return null;

  const match = text.match(/^(\S+)\s+(\S+)\s+([\s\S]+)$/);
  if (!match) {
    throw userFacingError('update_input_invalid', 'Use `/dm-update <project-or-draft> <field> <value>`.');
  }
  const [, target, rawField, rawValue] = match;
  if (!target || !rawField || rawValue === undefined || !isEditablePublicField(rawField)) {
    throw userFacingError('update_field_invalid', `Update field must be one of: ${EDITABLE_PUBLIC_FIELDS.join(', ')}.`);
  }
  const value = parseSlackFieldValue(rawField, rawValue);
  const validation = validatePublicFieldUpdate(rawField, value);
  if (!validation.ok) throw userFacingError('update_value_invalid', validation.issue.message);
  return { target, field: rawField, value: validation.value };
}

function parseSlackFieldValue(field: EditablePublicField, rawValue: string): unknown {
  const trimmed = rawValue.trim();
  if (field === 'year') {
    const year = Number(trimmed);
    return Number.isInteger(year) ? year : trimmed;
  }
  if (field === 'details' || field === 'metrics' || field === 'links' || field === 'media') {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      throw userFacingError('update_value_invalid', `${field} must be a valid JSON array.`);
    }
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed === 'string') return parsed;
    } catch {
      // Treat it as ordinary text and let canonical validation decide.
    }
  }
  return trimmed;
}

async function stageSlackFieldUpdate(
  db: SlackControlPlaneQueryable,
  config: SlackControlPlaneConfig,
  input: SlackFieldUpdateInput,
  actor: string,
): Promise<SlackControlPlaneResult> {
  if (input.target.startsWith('draft_')) {
    return mapAdminFieldStageResult(
      await updateAdminDraftFields(db, input.target, actor, { [input.field]: input.value }),
      input.target,
      input.field,
    );
  }

  if (!config.githubFetcher) {
    return {
      ok: false,
      status: 503,
      code: 'github_fetch_unconfigured',
      responseType: 'ephemeral',
      message: 'GitHub snapshot fetching is required to stage a published-project refresh.',
    };
  }

  const project = await fetchPublishedProjectSource(db, input.target);
  if (!project) {
    return {
      ok: false,
      status: 404,
      code: 'published_project_source_not_found',
      responseType: 'ephemeral',
      message: `Published GitHub project ${input.target} was not found.`,
    };
  }
  const [owner, name] = project.canonical_full_name.split('/');
  if (!owner || !name) throw userFacingError('source_identity_invalid', 'The linked GitHub source identity is invalid.');

  const repo = await config.githubFetcher(owner, name);
  const scan = await scanGithubRepositoryCandidate(db, { actor, trigger: 'slack', repo, scannerMode: 'live-github' });
  if (scan.status !== 'qualified') {
    return {
      ok: false,
      status: 409,
      code: scan.code,
      responseType: 'ephemeral',
      message: `Refresh scan did not create an editable draft: ${scan.reason}.`,
      scan,
    };
  }
  return mapAdminFieldStageResult(
    await updateAdminDraftFields(db, scan.draftId, actor, { [input.field]: input.value }),
    scan.draftId,
    input.field,
    scan,
  );
}

async function fetchPublishedProjectSource(
  db: SlackControlPlaneQueryable,
  target: string,
): Promise<PublishedProjectSourceRow | null> {
  const result = await db.query<PublishedProjectSourceRow>(
    `SELECT p.id, p.slug, source.canonical_full_name
     FROM projects p
     JOIN project_sources source ON source.project_id = p.id AND source.provider = 'github'
     WHERE p.lifecycle_state = 'published' AND (p.id = $1 OR p.slug = $1)
     LIMIT 1`,
    [target],
  );
  return normalizeRows(result)[0] ?? null;
}

function mapAdminFieldStageResult(
  result: Awaited<ReturnType<typeof updateAdminDraftFields>>,
  draftId: string,
  field: EditablePublicField,
  scan?: GithubDiscoveryScanResult,
): SlackControlPlaneResult {
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      code: result.code,
      responseType: 'ephemeral',
      message: result.message,
      draftId,
      scan,
    };
  }
  return {
    ok: true,
    status: 200,
    code: 'draft_field_staged',
    responseType: 'ephemeral',
    message: `Staged ${field} in draft ${draftId}. Admin review and publish remain required.`,
    draftId,
    scan,
  };
}

async function requestHiddenDraft(
  db: SlackControlPlaneQueryable,
  candidateId: string,
  actor: string,
): Promise<SlackControlPlaneResult> {
  const candidate = await fetchCandidate(db, candidateId);
  if (!candidate) return candidateNotFound(candidateId);
  if (candidate.lifecycle_state === 'dismissed') return candidateDismissed(candidateId);

  const existingDraft = await fetchDraftForCandidate(db, candidateId);
  if (!existingDraft) {
    return {
      ok: false,
      status: 409,
      code: 'refresh_draft_missing',
      responseType: 'ephemeral',
      message: 'The scan did not leave an active revision draft. Run the GitHub scan again.',
      candidateId,
    };
  }
  const beforeState = candidate.lifecycle_state;
  const draftId = existingDraft.id;

  const transitioned = normalizeRows(
    await db.query<{ id: string }>(
    `WITH eligible_candidate AS (
       SELECT id
       FROM project_candidates
       WHERE id = $1 AND lifecycle_state <> 'dismissed'
       FOR UPDATE
     ),
     active_draft AS (
       SELECT id
       FROM project_drafts
       WHERE id = $2
         AND candidate_id = $1
         AND lifecycle_state IN ('hidden', 'needs_review', 'changes_requested', 'approved_for_publish')
       FOR UPDATE
     ),
     changed AS (
       UPDATE project_candidates
       SET lifecycle_state = 'draft_requested', updated_at = now()
       WHERE id IN (SELECT id FROM eligible_candidate)
         AND EXISTS (SELECT 1 FROM active_draft)
       RETURNING id
     ),
     event AS (
       INSERT INTO review_events (id, draft_id, candidate_id, actor, action, before_state, after_state, notes, metadata)
       SELECT $3, $2, $1, $4, 'draft_requested', $5, 'draft_requested', $6, $7::jsonb
       FROM changed
       RETURNING id
     )
     SELECT id FROM changed WHERE EXISTS (SELECT 1 FROM event)`,
    [
      candidateId,
      draftId,
      `review_${randomUUID()}`,
      actor,
      beforeState,
      'Slack acknowledged the scan-created hidden project draft; no public project row was changed.',
      JSON.stringify({ source: 'slack_control_plane', decision: 'draft', draftId }),
    ],
    ),
  );
  if (transitioned.length === 0) {
    return {
      ok: false,
      status: 409,
      code: 'candidate_state_changed',
      responseType: 'ephemeral',
      message: 'The candidate or revision draft changed before the Slack action committed.',
      candidateId,
      draftId,
    };
  }

  return {
    ok: true,
    status: 200,
    code: 'hidden_draft_requested',
    responseType: 'ephemeral',
    message: `Hidden draft ${draftId} is ready for admin review at /admin. It is not public until an admin publishes it.`,
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

  const rows = normalizeRows(
    await db.query<{ id: string }>(
    `WITH dismissed AS (
       UPDATE project_candidates
       SET lifecycle_state = $2, updated_at = now()
       WHERE id = $1
       RETURNING id
     ),
     superseded AS (
       UPDATE project_drafts
       SET lifecycle_state = 'superseded', updated_at = now()
       WHERE candidate_id = $1
         AND lifecycle_state IN ('hidden', 'needs_review', 'changes_requested', 'approved_for_publish')
         AND EXISTS (SELECT 1 FROM dismissed)
       RETURNING id
     )
     INSERT INTO review_events (id, candidate_id, actor, action, before_state, after_state, notes, metadata)
     SELECT $3, $1, $4, $5, $6, $2, $7,
            $8::jsonb || jsonb_build_object(
              'supersededDraftIds',
              COALESCE((SELECT jsonb_agg(id ORDER BY id) FROM superseded), '[]'::jsonb)
            )
     FROM dismissed
     RETURNING id`,
    [
      candidateId,
      input.afterState,
      `review_${randomUUID()}`,
      actor,
      input.action,
      candidate.lifecycle_state,
      input.notes,
      JSON.stringify(input.metadata),
    ],
    ),
  );
  if (rows.length === 0) return candidateNotFound(candidateId);

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
  if (candidate.lifecycle_state === 'dismissed') return candidateDismissed(candidateId);

  const rows = normalizeRows(
    await db.query<{ id: string }>(
    `WITH changed AS (
       UPDATE project_candidates
       SET updated_at = now()
       WHERE id = $1 AND lifecycle_state <> 'dismissed'
       RETURNING id, lifecycle_state
     ),
     event AS (
       INSERT INTO review_events (id, candidate_id, actor, action, before_state, after_state, notes, metadata)
       SELECT $2, $1, $3, 'note', lifecycle_state, lifecycle_state, $4, $5::jsonb
       FROM changed
       RETURNING id
     )
     SELECT id FROM changed WHERE EXISTS (SELECT 1 FROM event)`,
    [
      candidateId,
      `review_${randomUUID()}`,
      actor,
      'Snoozed from Slack control plane; candidate remains hidden from public surfaces.',
      JSON.stringify({ source: 'slack_control_plane', decision: 'snooze' }),
    ],
    ),
  );
  if (rows.length === 0) return candidateDismissed(candidateId);

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
    `SELECT id, scan_run_id, source_ref, repo_visibility, signals, confidence, evidence_packet, lifecycle_state
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
  const result = await db.query<DraftRow>(
    `SELECT id
     FROM project_drafts
     WHERE candidate_id = $1
       AND lifecycle_state IN ('hidden', 'needs_review', 'changes_requested', 'approved_for_publish')
     ORDER BY updated_at DESC
     LIMIT 1`,
    [candidateId],
  );
  return normalizeRows(result)[0] ?? null;
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
    repositoryId: stringValue(value, 'repositoryId'),
    owner,
    name,
    fullName: stringValue(value, 'fullName', true) || `${owner}/${name}`,
    htmlUrl,
    description: stringValue(value, 'description', true) || null,
    homepageUrl: stringValue(value, 'homepageUrl', true) || null,
    language: stringValue(value, 'language', true) || null,
    topics,
    isPrivate: booleanValue(value, 'isPrivate'),
    defaultBranch: stringValue(value, 'defaultBranch'),
    sourceRevision: stringValue(value, 'sourceRevision'),
    pushedAt: stringValue(value, 'pushedAt', true) || null,
    stars: numberValue(value, 'stars'),
    readmeMarkdown: stringValue(value, 'readmeMarkdown', true) || null,
    portfolioManifest: parsePortfolioManifestSnapshot(value.portfolioManifest),
  };
}

function parsePortfolioManifestSnapshot(value: JsonValue | undefined): GithubRepositorySnapshot['portfolioManifest'] {
  const record = asRecord(value, 'Repo field portfolioManifest must be an object.');
  const status = stringValue(record, 'status');
  if (status === 'missing') return { status };
  if (status === 'present') return { status, raw: stringValue(record, 'raw') };
  throw userFacingError('invalid_payload', 'Repo field portfolioManifest.status must be missing or present.');
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

function hasOwnOption(options: Record<string, string>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(options, key);
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

function candidateDismissed(candidateId: string): SlackControlPlaneResult {
  return {
    ok: false,
    status: 409,
    code: 'candidate_dismissed',
    responseType: 'ephemeral',
    message: `Candidate ${candidateId} is dismissed and cannot be reopened from Slack.`,
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

function logSlackInteractionAckWarning(details: Record<string, unknown>): void {
  console.warn(
    '[slack-control-plane]',
    JSON.stringify({ event: 'interaction_ack_warning', ...details }),
  );
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
