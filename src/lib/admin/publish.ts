import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { DraftLifecycleState, JsonRecord, JsonValue, PrivacyState, ReviewEventRecord } from '@/lib/db/schema';
import {
  ProjectAreaSchema,
  ProjectDetailSchema,
  ProjectLinkSchema,
  ProjectMediaSchema,
  ProjectMetricSchema,
  parsePublicProjectFields,
  type PublicProjectFields,
} from '@/lib/projects/schema';

export interface AdminPublishQueryable {
  query<Row = unknown>(sql: string, params?: unknown[]): Promise<{ rows: Row[] } | Row[]>;
}

export const REQUIRED_PUBLIC_FIELDS = ['slug', 'title', 'tagline', 'area', 'year', 'summary'] as const;
export const EDITABLE_PUBLIC_FIELDS = [
  ...REQUIRED_PUBLIC_FIELDS,
  'activity',
  'details',
  'metrics',
  'links',
  'media',
] as const;

type RequiredPublicField = (typeof REQUIRED_PUBLIC_FIELDS)[number];
export type EditablePublicField = (typeof EDITABLE_PUBLIC_FIELDS)[number];
type PublicArrayField = 'details' | 'metrics' | 'links' | 'media';
type AdminPublishFailure = { ok: false; status: number; code: string; message: string; [key: string]: unknown };
type AdminPublishSuccess = { ok: true; status: number; code: string; message: string; [key: string]: unknown };
export type AdminPublishResult = AdminPublishFailure | AdminPublishSuccess;
export type ReviewedFieldDiffEntry = { field: EditablePublicField; before: JsonValue; after: JsonValue };

type DraftRow = {
  id: string;
  candidate_id: string | null;
  proposed_project_id: string | null;
  proposed_fields: JsonRecord;
  private_notes: string;
  provenance_map: JsonRecord;
  lifecycle_state: DraftLifecycleState;
  provider: 'github' | null;
  repository_id: string | null;
  source_revision: string | null;
  content_fingerprint: string | null;
  reviewed_field_diff: JsonValue[];
  base_project_version: string | number;
  created_at: string;
  updated_at: string;
};

type DraftListRow = Pick<
  DraftRow,
  'id' | 'candidate_id' | 'proposed_project_id' | 'lifecycle_state' | 'created_at' | 'updated_at'
> & {
  slug: string | null;
  title: string | null;
  source_ref: string | null;
  signals: JsonRecord | null;
};

type PublishedProjectRow = PublicProjectFields & {
  id: string;
  lifecycle_state: string;
  publication_version: string | number;
};
type EvidencePrivacyRow = { privacy_state: PrivacyState; count: string | number };
type EvidenceRow = { id: string; privacy_state: PrivacyState; project_id: string | null };
type ApprovalEventRow = { action: string; source: string | null; reviewed_field_diff: unknown; reviewed_fields: unknown };
type ReviewEventRow = ReviewEventRecord;
export type ValidationIssue = { field: string; message: string };
export type PublicFieldValidationResult = { ok: true; value: JsonValue } | { ok: false; issue: ValidationIssue };

const EDITABLE_FIELDS: Record<EditablePublicField, true> = {
  slug: true,
  title: true,
  tagline: true,
  area: true,
  year: true,
  summary: true,
  activity: true,
  details: true,
  metrics: true,
  links: true,
  media: true,
};
const TERMINAL_DRAFT_STATES = new Set<DraftLifecycleState>(['published', 'superseded']);

export async function listAdminDrafts(db: AdminPublishQueryable): Promise<AdminPublishResult> {
  const rows = normalizeRows(
    await db.query<DraftListRow>(
      `SELECT id,
              candidate_id,
              proposed_project_id,
              lifecycle_state,
              created_at,
              updated_at,
              proposed_fields->>'slug' AS slug,
              proposed_fields->>'title' AS title,
              proposed_fields->>'sourceRef' AS source_ref,
              proposed_fields->'signals' AS signals
       FROM project_drafts
       ORDER BY updated_at DESC, created_at DESC`,
    ),
  );
  return { ok: true, status: 200, code: 'drafts_listed', message: 'Drafts listed.', drafts: rows };
}

export async function getAdminDraft(db: AdminPublishQueryable, draftId: string): Promise<AdminPublishResult> {
  const draft = await fetchDraft(db, draftId);
  if (!draft) return draftNotFound(draftId);

  const privacy = normalizeRows(
    await db.query<EvidencePrivacyRow>(
      `SELECT privacy_state, count(*) AS count
       FROM evidence_sources
       WHERE (draft_id = $1 OR ($2::text IS NOT NULL AND candidate_id = $2))
         AND ($3::text IS NULL OR claim_map->>'contentFingerprint' = $3)
       GROUP BY privacy_state
       ORDER BY privacy_state`,
      [draft.id, draft.candidate_id, draft.provider ? draft.content_fingerprint : null],
    ),
  ).map((row) => ({ privacy_state: row.privacy_state, count: Number(row.count) }));

  const events = normalizeRows(
    await db.query<ReviewEventRow>(
      `SELECT id, project_id, draft_id, candidate_id, actor, action, before_state, after_state, notes, metadata, created_at
       FROM review_events
       WHERE draft_id = $1
       ORDER BY created_at DESC, seq DESC
       LIMIT 20`,
      [draft.id],
    ),
  );

  return {
    ok: true,
    status: 200,
    code: 'draft_loaded',
    message: 'Draft loaded.',
    draft,
    evidencePrivacy: privacy,
    reviewEvents: events,
  };
}

export async function updateAdminDraftFields(
  db: AdminPublishQueryable,
  draftId: string,
  actor: string,
  fields: Record<string, unknown>,
): Promise<AdminPublishResult> {
  if (!isPlainRecord(fields)) {
    return { ok: false, status: 400, code: 'invalid_body', message: 'Request body must be a JSON object of public fields.' };
  }

  const keys: EditablePublicField[] = [];
  for (const key of Object.keys(fields)) {
    if (!isEditablePublicField(key)) {
      return { ok: false, status: 400, code: 'invalid_field', message: `Field ${key} is not editable.`, field: key };
    }
    keys.push(key);
  }
  if (keys.length === 0) {
    return { ok: false, status: 400, code: 'fields_missing', message: 'At least one public field is required.' };
  }

  const validated: JsonRecord = {};
  for (const key of keys) {
    const result = validatePublicFieldUpdate(key, fields[key]);
    if (!result.ok) {
      const status = result.issue.field === 'slug' || result.issue.field === 'year' || result.issue.field === 'area' ? 422 : 400;
      return { ok: false, status, code: 'field_invalid', message: result.issue.message, field: result.issue.field };
    }
    validated[key] = result.value;
  }

  const draft = await fetchDraft(db, draftId);
  if (!draft) return draftNotFound(draftId);
  if (TERMINAL_DRAFT_STATES.has(draft.lifecycle_state)) return terminalDraft(draft);

  const updated = normalizeRows(
    await db.query<{ id: string; proposed_fields: JsonRecord }>(
    `WITH changed AS (
       UPDATE project_drafts
       SET proposed_fields = proposed_fields || $2::jsonb,
           reviewed_field_diff = '[]'::jsonb,
           lifecycle_state = 'needs_review',
           updated_at = now()
       WHERE id = $1
         AND lifecycle_state IN ('hidden', 'needs_review', 'changes_requested', 'approved_for_publish')
       RETURNING id, proposed_fields
     ),
     event AS (
       INSERT INTO review_events (id, draft_id, candidate_id, actor, action, before_state, after_state, notes, metadata)
       SELECT $3, $1, $4, $5, 'note', $6, 'needs_review', $7, $8::jsonb
       FROM changed
       RETURNING id
     )
     SELECT id, proposed_fields FROM changed WHERE EXISTS (SELECT 1 FROM event)`,
    [
      draft.id,
      JSON.stringify(validated),
      `review_${randomUUID()}`,
      draft.candidate_id,
      actor,
      draft.lifecycle_state,
      'Admin staged public draft fields; prior approval was invalidated.',
      JSON.stringify({ source: 'admin_publish', kind: 'fields_updated', keys }),
      ],
    ),
  );
  if (updated.length === 0) {
    return { ok: false, status: 409, code: 'draft_state_changed', message: 'Draft state changed before the field update committed.', draftId };
  }

  return {
    ok: true,
    status: 200,
    code: 'draft_fields_updated',
    message: 'Draft fields updated.',
    draftId: draft.id,
    lifecycleState: 'needs_review',
    fields: updated[0]?.proposed_fields,
  };
}

export async function approveAdminDraftForPublish(
  db: AdminPublishQueryable,
  draftId: string,
  actor: string,
  input: { reviewedFields?: unknown } = {},
): Promise<AdminPublishResult> {
  const draft = await fetchDraft(db, draftId);
  if (!draft) return draftNotFound(draftId);
  if (TERMINAL_DRAFT_STATES.has(draft.lifecycle_state)) return terminalDraft(draft);

  const projectId = await resolveLinkedProjectId(db, draft);
  const current = projectId ? await fetchPublishedProject(db, projectId) : null;
  if (projectId && !current) {
    return { ok: false, status: 409, code: 'staged_project_missing', message: 'The linked published project no longer exists.', draftId };
  }
  const selected = selectReviewedFields(input.reviewedFields, draft.proposed_fields, current);
  if (!selected.ok) return selected.failure;

  let canonical: PublicProjectFields;
  try {
    canonical = current
      ? parsePublicProjectFields(applyProposedFields(current, draft.proposed_fields, selected.fields))
      : parsePublicProjectFields(withPublicDefaults(draft.proposed_fields));
  } catch {
    return fieldsIncomplete(validateRequiredFields(draft.proposed_fields));
  }

  if (!current && selected.fields.length !== EDITABLE_PUBLIC_FIELDS.length) {
    return {
      ok: false,
      status: 422,
      code: 'reviewed_fields_incomplete',
      message: 'A first publication requires explicit review of every public field.',
      fields: EDITABLE_PUBLIC_FIELDS.filter((field) => !selected.fields.includes(field)),
    };
  }

  const canonicalRecord = publicFieldsRecord(canonical);
  const reviewedDiff: ReviewedFieldDiffEntry[] = EDITABLE_PUBLIC_FIELDS
    .filter((field) => selected.fields.includes(field))
    .map((field) => ({
      field,
      before: current ? asJsonValue(current[field]) : null,
      after: canonicalRecord[field] as JsonValue,
    }));
  const baseProjectVersion = Number(draft.base_project_version);
  if (!Number.isSafeInteger(baseProjectVersion) || baseProjectVersion < 0) {
    return { ok: false, status: 409, code: 'base_version_invalid', message: 'Draft base project version is invalid.', draftId };
  }
  if (current && Number(current.publication_version) !== baseProjectVersion) {
    return staleDraft(draftId, selected.fields);
  }

  const rows = normalizeRows(
    await db.query<{ id: string }>(
      `WITH approved AS (
         UPDATE project_drafts
         SET proposed_project_id = COALESCE(proposed_project_id, $2),
             reviewed_field_diff = $3::jsonb,
             lifecycle_state = 'approved_for_publish',
             updated_at = now()
         WHERE id = $1
           AND lifecycle_state IN ('hidden', 'needs_review', 'changes_requested', 'approved_for_publish')
           AND proposed_fields = $10::jsonb
           AND base_project_version = $11
           AND content_fingerprint IS NOT DISTINCT FROM $12
           AND updated_at = $13::timestamptz
         RETURNING id
       )
       INSERT INTO review_events (id, project_id, draft_id, candidate_id, actor, action, before_state, after_state, notes, metadata)
       SELECT $4, $2, $1, $5, $6, 'approved_for_publish', $7, 'approved_for_publish', $8, $9::jsonb
       FROM approved
       RETURNING id`,
      [
        draft.id,
        current?.id ?? null,
        JSON.stringify(reviewedDiff),
        `review_${randomUUID()}`,
        draft.candidate_id,
        actor,
        draft.lifecycle_state,
        'Admin approved an immutable ordered field diff for publish.',
        JSON.stringify({
          source: 'admin_publish',
          reviewedFields: reviewedDiff.map((entry) => entry.field),
          reviewedFieldDiff: reviewedDiff,
          baseProjectVersion,
        }),
        JSON.stringify(draft.proposed_fields),
        baseProjectVersion,
        draft.content_fingerprint,
        draft.updated_at,
      ],
    ),
  );
  if (rows.length === 0) return { ok: false, status: 409, code: 'draft_state_changed', message: 'Draft state changed before approval.', draftId };

  return {
    ok: true,
    status: 200,
    code: 'approved_for_publish',
    message: 'Draft approved for publish.',
    draftId: draft.id,
    reviewedFields: reviewedDiff.map((entry) => entry.field),
    reviewedFieldDiff: reviewedDiff,
    baseProjectVersion,
  };
}

export async function publishAdminDraft(
  db: AdminPublishQueryable,
  draftId: string,
  actor: string,
  input: { confirmProvenance?: boolean; confirmPrivacy?: boolean },
): Promise<AdminPublishResult> {
  const draft = await fetchDraft(db, draftId);
  if (!draft) return draftNotFound(draftId);
  if (draft.lifecycle_state !== 'approved_for_publish') {
    return {
      ok: false,
      status: 409,
      code: TERMINAL_DRAFT_STATES.has(draft.lifecycle_state) ? 'draft_terminal' : 'draft_not_approved',
      message: TERMINAL_DRAFT_STATES.has(draft.lifecycle_state)
        ? `Draft is terminal (${draft.lifecycle_state}) and cannot publish again.`
        : 'Admin approval required; Slack staging alone cannot publish.',
      draftId,
    };
  }

  const reviewedDiff = parseReviewedFieldDiff(draft.reviewed_field_diff);
  if (!reviewedDiff.ok || reviewedDiff.entries.length === 0) {
    return { ok: false, status: 409, code: 'reviewed_diff_missing', message: 'An immutable reviewed field diff is required.', draftId };
  }
  if (!(await hasExactFreshAdminApproval(db, draft.id, reviewedDiff.entries))) {
    return { ok: false, status: 409, code: 'admin_approval_missing', message: 'Fresh admin approval of this exact field diff is required.', draftId };
  }
  if (input.confirmProvenance !== true || input.confirmPrivacy !== true) {
    return { ok: false, status: 428, code: 'confirmation_required', message: 'Confirm provenance and privacy review before publishing.', draftId };
  }

  const evidence = await fetchLinkedEvidence(db, draft);
  const unreviewed = evidence.filter((row) => row.privacy_state === 'unreviewed');
  const blocked = evidence.filter((row) => row.privacy_state === 'blocked');
  if (unreviewed.length > 0) {
    return { ok: false, status: 422, code: 'privacy_unreviewed_evidence', message: 'All linked evidence sources must be reviewed before publishing.', draftId, count: unreviewed.length };
  }
  if (blocked.length > 0) {
    return { ok: false, status: 422, code: 'privacy_blocked_evidence', message: 'Blocked linked evidence sources cannot be published.', draftId, count: blocked.length };
  }
  const safeEvidenceIds = evidence.filter((row) => row.privacy_state === 'safe_public').map((row) => row.id);
  if ((draft.provider || draft.candidate_id) && safeEvidenceIds.length === 0) {
    return {
      ok: false,
      status: 422,
      code: 'public_provenance_missing',
      message: 'Only evidence explicitly marked safe_public can support a public project.',
      draftId,
    };
  }
  if (!draft.provider && !draft.candidate_id && !hasPublicProvenance(draft.provenance_map)) {
    return { ok: false, status: 422, code: 'provenance_missing', message: 'Draft provenance map must be non-empty before publishing.', draftId };
  }

  const projectId = await resolveLinkedProjectId(db, draft);
  const current = projectId ? await fetchPublishedProject(db, projectId) : null;
  if (projectId && !current) {
    return { ok: false, status: 409, code: 'staged_project_missing', message: 'The linked published project no longer exists.', draftId };
  }
  const foreignEvidence = evidence.filter(
    (row) => row.project_id !== null && row.project_id !== current?.id,
  );
  if (foreignEvidence.length > 0) {
    return {
      ok: false,
      status: 409,
      code: 'evidence_project_conflict',
      message: 'Evidence already owned by another project cannot support this publication.',
      draftId,
      count: foreignEvidence.length,
    };
  }

  const baseVersion = Number(draft.base_project_version);
  if (!Number.isSafeInteger(baseVersion) || baseVersion < 0) {
    return { ok: false, status: 409, code: 'base_version_invalid', message: 'Draft base project version is invalid.', draftId };
  }
  if (current && Number(current.publication_version) !== baseVersion) {
    return staleDraft(draftId, reviewedDiff.entries.map((entry) => entry.field));
  }
  if (current) {
    const staleFields = reviewedDiff.entries
      .filter((entry) => !isDeepStrictEqual(asJsonValue(current[entry.field]), entry.before))
      .map((entry) => entry.field);
    if (staleFields.length > 0) return staleDraft(draftId, staleFields);
  } else if (baseVersion !== 0 || reviewedDiff.entries.some((entry) => entry.before !== null)) {
    return staleDraft(draftId, reviewedDiff.entries.map((entry) => entry.field));
  }

  let canonical: PublicProjectFields;
  try {
    canonical = current
      ? parsePublicProjectFields(applyReviewedDiff(current, reviewedDiff.entries))
      : parsePublicProjectFields(Object.fromEntries(reviewedDiff.entries.map((entry) => [entry.field, entry.after])));
  } catch {
    return { ok: false, status: 422, code: 'reviewed_diff_invalid', message: 'Reviewed field values no longer form a canonical project.', draftId };
  }
  if (!current && reviewedDiff.entries.length !== EDITABLE_PUBLIC_FIELDS.length) {
    return { ok: false, status: 422, code: 'reviewed_fields_incomplete', message: 'A first publication requires review of every public field.', draftId };
  }

  const finalProjectId = current?.id ?? projectIdFromDraftId(draft.id);
  const eventMetadata = {
    source: 'admin_publish',
    confirmProvenance: true,
    confirmPrivacy: true,
    projectId: finalProjectId,
    operation: current ? 'updated' : 'created',
    reviewedFields: reviewedDiff.entries.map((entry) => entry.field),
    reviewedFieldDiff: reviewedDiff.entries,
    sourceRevision: draft.source_revision,
  } satisfies JsonRecord;

  try {
    const committed = current
      ? await commitReviewedRefresh(db, draft, current.id, baseVersion, reviewedDiff.entries, actor, eventMetadata)
      : await commitFirstPublication(db, draft, finalProjectId, canonical, reviewedDiff.entries, actor, eventMetadata);
    if (!committed) return staleDraft(draftId, reviewedDiff.entries.map((entry) => entry.field));
  } catch (error) {
    if (isPgErrorCode(error, '23505')) {
      if (errorField(error, 'constraint') === 'publish_outbox_identity_uidx' || errorField(error, 'constraint') === 'publish_outbox_pkey') {
        return { ok: false, status: 409, code: 'outbox_enqueue_conflict', message: 'Publication work was already queued; the project was not changed.', draftId };
      }
      return { ok: false, status: 409, code: 'slug_conflict', message: 'Project slug already exists.', draftId };
    }
    throw error;
  }

  return {
    ok: true,
    status: 200,
    code: 'published',
    projectId: finalProjectId,
    draftId: draft.id,
    operation: current ? 'updated' : 'created',
    changedFields: reviewedDiff.entries.map((entry) => entry.field),
    publicationVersion: baseVersion + 1,
    message: 'Draft published.',
  };
}

async function commitReviewedRefresh(
  db: AdminPublishQueryable,
  draft: DraftRow,
  projectId: string,
  baseVersion: number,
  diff: ReviewedFieldDiffEntry[],
  actor: string,
  metadata: JsonRecord,
): Promise<boolean> {
  const params: unknown[] = [];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };
  const project = bind(projectId);
  const draftId = bind(draft.id);
  const version = bind(baseVersion);
  const assignments = diff.map((entry) => {
    const value = bind(isArrayField(entry.field) ? JSON.stringify(entry.after) : entry.after);
    return `${entry.field} = ${value}${isArrayField(entry.field) ? '::jsonb' : ''}`;
  });
  const beforePredicates = diff.map((entry) => {
    const value = bind(isArrayField(entry.field) ? JSON.stringify(entry.before) : entry.before);
    return `${entry.field} IS NOT DISTINCT FROM ${value}${isArrayField(entry.field) ? '::jsonb' : ''}`;
  });
  const reviewed = bind(JSON.stringify(diff));
  const repositoryId = bind(draft.repository_id);
  const candidateId = bind(draft.candidate_id);
  const evidenceFingerprint = bind(draft.provider ? draft.content_fingerprint : null);
  const eventId = bind(`review_${randomUUID()}`);
  const eventActor = bind(actor);
  const eventMetadata = bind(JSON.stringify(metadata));

  const rows = normalizeRows(
    await db.query<{ id: string }>(
       `WITH locked_evidence AS (
         SELECT id, privacy_state, project_id, evidence_version
         FROM evidence_sources
         WHERE (draft_id = ${draftId}
            OR (${candidateId}::text IS NOT NULL AND candidate_id = ${candidateId}))
           AND (${evidenceFingerprint}::text IS NULL
             OR claim_map->>'contentFingerprint' = ${evidenceFingerprint})
         FOR UPDATE
       ),
       safe_evidence AS (
         SELECT id, evidence_version
         FROM locked_evidence
         WHERE privacy_state = 'safe_public'
       ),
       locked_source AS (
         SELECT project_id
         FROM project_sources
         WHERE provider = 'github' AND repository_id = ${repositoryId}
         FOR UPDATE
       ),
       locked_candidate AS (
         SELECT lifecycle_state
         FROM project_candidates
         WHERE id = ${candidateId}
         FOR UPDATE
       ),
       eligible_draft AS (
         SELECT id
         FROM project_drafts
         WHERE id = ${draftId}
           AND lifecycle_state = 'approved_for_publish'
           AND base_project_version = ${version}
           AND reviewed_field_diff = ${reviewed}::jsonb
           AND NOT EXISTS (
             SELECT 1 FROM locked_evidence WHERE privacy_state IN ('unreviewed', 'blocked')
           )
           AND NOT EXISTS (
             SELECT 1 FROM locked_evidence WHERE project_id IS NOT NULL AND project_id <> ${project}
           )
           AND (
             (${repositoryId}::text IS NULL AND ${candidateId}::text IS NULL)
             OR EXISTS (SELECT 1 FROM locked_evidence WHERE privacy_state = 'safe_public')
           )
           AND (
             ${repositoryId}::text IS NULL
             OR EXISTS (SELECT 1 FROM locked_source WHERE project_id = ${project})
           )
           AND (
             ${candidateId}::text IS NULL
             OR EXISTS (SELECT 1 FROM locked_candidate WHERE lifecycle_state <> 'dismissed')
           )
         FOR UPDATE
       ),
       updated_project AS (
         UPDATE projects
         SET ${assignments.join(', ')},
             publication_version = publication_version + 1,
             lifecycle_state = 'published',
             published_at = COALESCE(published_at, now()),
             updated_at = now()
         WHERE id = ${project}
           AND lifecycle_state = 'published'
           AND publication_version = ${version}
           AND ${beforePredicates.join('\n           AND ')}
           AND EXISTS (SELECT 1 FROM eligible_draft)
         RETURNING id, publication_version
       ),
       published_draft AS (
         UPDATE project_drafts
         SET lifecycle_state = 'published', proposed_project_id = ${project}, updated_at = now()
         WHERE id = ${draftId}
           AND lifecycle_state = 'approved_for_publish'
           AND EXISTS (SELECT 1 FROM updated_project)
         RETURNING id
       ),
       linked_source AS (
         UPDATE project_sources
         SET project_id = ${project}, updated_at = now()
         WHERE provider = 'github'
           AND repository_id = ${repositoryId}
           AND EXISTS (SELECT 1 FROM published_draft)
         RETURNING id
       ),
       linked_evidence AS (
         UPDATE evidence_sources
         SET project_id = ${project}
         WHERE project_id IS NULL
           AND id IN (SELECT id FROM locked_evidence WHERE privacy_state = 'safe_public')
           AND EXISTS (SELECT 1 FROM published_draft)
         RETURNING id, evidence_version
       ),
       revoked_sources AS (
         UPDATE rag_sources AS rag
         SET eligibility_state = 'revoked',
             revoked_at = COALESCE(revoked_at, now()),
             failure_message = NULL,
             updated_at = now()
         WHERE rag.project_id = ${project}
           AND rag.evidence_source_id IS NOT NULL
           AND rag.eligibility_state <> 'revoked'
           AND ${repositoryId}::text IS NOT NULL
           AND EXISTS (
             SELECT 1
             FROM evidence_sources AS prior_evidence
             LEFT JOIN project_candidates AS prior_candidate ON prior_candidate.id = prior_evidence.candidate_id
             LEFT JOIN project_drafts AS prior_draft ON prior_draft.id = prior_evidence.draft_id
             WHERE prior_evidence.id = rag.evidence_source_id
               AND (
                 prior_candidate.repository_id = ${repositoryId}
                 OR prior_draft.repository_id = ${repositoryId}
               )
           )
           AND NOT EXISTS (
             SELECT 1
             FROM safe_evidence AS safe
             WHERE safe.id = rag.evidence_source_id
               AND safe.evidence_version = rag.evidence_version
           )
           AND EXISTS (SELECT 1 FROM published_draft)
         RETURNING rag.project_id, rag.evidence_source_id, rag.evidence_version
       ),
       published_event AS (
         INSERT INTO review_events (id, project_id, draft_id, candidate_id, actor, action, before_state, after_state, notes, metadata)
         SELECT ${eventId}, ${project}, ${draftId}, ${candidateId}, ${eventActor}, 'published',
                'approved_for_publish', 'published', 'Admin atomically published only reviewed fields.',
                ${eventMetadata}::jsonb || jsonb_build_object(
                  'safePublicEvidenceIds',
                  COALESCE(
                    (SELECT jsonb_agg(id ORDER BY id) FROM locked_evidence WHERE privacy_state = 'safe_public'),
                    '[]'::jsonb
                  )
                )
         FROM published_draft
         RETURNING id
       ),
       site_refresh_job AS (
         INSERT INTO publish_outbox (
           id, job_type, project_id, publication_version, evidence_source_id, evidence_version
         )
         SELECT portfolio_outbox_id('site_refresh', ${project}, publication_version, NULL, NULL),
                'site_refresh', ${project}, publication_version, NULL, NULL
         FROM updated_project
         WHERE EXISTS (SELECT 1 FROM published_event)
         RETURNING id
       ),
       rag_index_jobs AS (
         INSERT INTO publish_outbox (
           id, job_type, project_id, publication_version, evidence_source_id, evidence_version
         )
         SELECT portfolio_outbox_id('rag_index', ${project}, updated.publication_version,
                                    safe.id, safe.evidence_version),
                'rag_index', ${project}, updated.publication_version, safe.id, safe.evidence_version
         FROM updated_project AS updated
         CROSS JOIN safe_evidence AS safe
         WHERE EXISTS (SELECT 1 FROM published_event)
         RETURNING id
       ),
       rag_revoke_jobs AS (
         INSERT INTO publish_outbox (
           id, job_type, project_id, publication_version, evidence_source_id, evidence_version
         )
         SELECT portfolio_outbox_id('rag_revoke', revoked.project_id, updated.publication_version,
                                    revoked.evidence_source_id, revoked.evidence_version),
                'rag_revoke', revoked.project_id, updated.publication_version,
                revoked.evidence_source_id, revoked.evidence_version
         FROM revoked_sources AS revoked
         CROSS JOIN updated_project AS updated
         WHERE EXISTS (SELECT 1 FROM published_event)
         RETURNING id
       )
       SELECT id
       FROM updated_project
       WHERE EXISTS (SELECT 1 FROM published_event)
         AND EXISTS (SELECT 1 FROM site_refresh_job)`,
      params,
    ),
  );
  return rows.length === 1;
}

async function commitFirstPublication(
  db: AdminPublishQueryable,
  draft: DraftRow,
  projectId: string,
  fields: PublicProjectFields,
  diff: ReviewedFieldDiffEntry[],
  actor: string,
  metadata: JsonRecord,
): Promise<boolean> {
  const rows = normalizeRows(
    await db.query<{ id: string }>(
      `WITH locked_evidence AS (
         SELECT id, privacy_state, project_id, evidence_version
         FROM evidence_sources
         WHERE (draft_id = $14 OR ($17::text IS NOT NULL AND candidate_id = $17))
           AND ($21::text IS NULL OR claim_map->>'contentFingerprint' = $21)
         FOR UPDATE
       ),
       safe_evidence AS (
         SELECT id, evidence_version
         FROM locked_evidence
         WHERE privacy_state = 'safe_public'
       ),
       locked_source AS (
         SELECT project_id
         FROM project_sources
         WHERE provider = 'github' AND repository_id = $16
         FOR UPDATE
       ),
       locked_candidate AS (
         SELECT lifecycle_state
         FROM project_candidates
         WHERE id = $17
         FOR UPDATE
       ),
       eligible_draft AS (
         SELECT id
         FROM project_drafts
         WHERE id = $14
           AND lifecycle_state = 'approved_for_publish'
           AND base_project_version = 0
           AND reviewed_field_diff = $15::jsonb
           AND NOT EXISTS (
             SELECT 1 FROM locked_evidence WHERE privacy_state IN ('unreviewed', 'blocked')
           )
           AND NOT EXISTS (
             SELECT 1 FROM locked_evidence WHERE project_id IS NOT NULL
           )
           AND (
             ($16::text IS NULL AND $17::text IS NULL)
             OR EXISTS (SELECT 1 FROM locked_evidence WHERE privacy_state = 'safe_public')
           )
           AND (
             $16::text IS NULL
             OR EXISTS (SELECT 1 FROM locked_source WHERE project_id IS NULL)
           )
           AND (
             $17::text IS NULL
             OR EXISTS (SELECT 1 FROM locked_candidate WHERE lifecycle_state <> 'dismissed')
           )
         FOR UPDATE
       ),
       inserted_project AS (
         INSERT INTO projects (
           id, slug, title, tagline, area, year, summary, activity, details, metrics, links, media,
           lifecycle_state, published_at, source, publication_version, updated_at
         )
         SELECT
           $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb,
           'published', now(), $13, 1, now()
         FROM eligible_draft
         RETURNING id, publication_version
       ),
       published_draft AS (
         UPDATE project_drafts
         SET lifecycle_state = 'published', proposed_project_id = $1, updated_at = now()
         WHERE id = $14
           AND lifecycle_state = 'approved_for_publish'
           AND EXISTS (SELECT 1 FROM inserted_project)
         RETURNING id
       ),
       linked_source AS (
         UPDATE project_sources
         SET project_id = $1, updated_at = now()
         WHERE provider = 'github'
           AND repository_id = $16
           AND EXISTS (SELECT 1 FROM published_draft)
         RETURNING id
       ),
       linked_evidence AS (
         UPDATE evidence_sources
         SET project_id = $1
         WHERE project_id IS NULL
           AND id IN (SELECT id FROM locked_evidence WHERE privacy_state = 'safe_public')
           AND EXISTS (SELECT 1 FROM published_draft)
         RETURNING id, evidence_version
       ),
       published_event AS (
         INSERT INTO review_events (id, project_id, draft_id, candidate_id, actor, action, before_state, after_state, notes, metadata)
         SELECT $18, $1, $14, $17, $19, 'published', 'approved_for_publish', 'published',
                'Admin atomically published one reviewed project.',
                $20::jsonb || jsonb_build_object(
                  'safePublicEvidenceIds',
                  COALESCE(
                    (SELECT jsonb_agg(id ORDER BY id) FROM locked_evidence WHERE privacy_state = 'safe_public'),
                    '[]'::jsonb
                  )
                )
         FROM published_draft
         RETURNING id
       ),
       site_refresh_job AS (
         INSERT INTO publish_outbox (
           id, job_type, project_id, publication_version, evidence_source_id, evidence_version
         )
         SELECT portfolio_outbox_id('site_refresh', $1, publication_version, NULL, NULL),
                'site_refresh', $1, publication_version, NULL, NULL
         FROM inserted_project
         WHERE EXISTS (SELECT 1 FROM published_event)
         RETURNING id
       ),
       rag_index_jobs AS (
         INSERT INTO publish_outbox (
           id, job_type, project_id, publication_version, evidence_source_id, evidence_version
         )
         SELECT portfolio_outbox_id('rag_index', $1, inserted.publication_version,
                                    safe.id, safe.evidence_version),
                'rag_index', $1, inserted.publication_version, safe.id, safe.evidence_version
         FROM inserted_project AS inserted
         CROSS JOIN safe_evidence AS safe
         WHERE EXISTS (SELECT 1 FROM published_event)
         RETURNING id
       )
       SELECT id
       FROM inserted_project
       WHERE EXISTS (SELECT 1 FROM published_event)
         AND EXISTS (SELECT 1 FROM site_refresh_job)`,
      [
        projectId,
        fields.slug,
        fields.title,
        fields.tagline,
        fields.area,
        fields.year,
        fields.summary,
        fields.activity,
        JSON.stringify(fields.details),
        JSON.stringify(fields.metrics),
        JSON.stringify(fields.links),
        JSON.stringify(fields.media),
        draft.candidate_id ? 'github_discovery' : 'manual',
        draft.id,
        JSON.stringify(diff),
        draft.repository_id,
        draft.candidate_id,
        `review_${randomUUID()}`,
        actor,
        JSON.stringify(metadata),
        draft.provider ? draft.content_fingerprint : null,
      ],
    ),
  );
  return rows.length === 1;
}

async function fetchDraft(db: AdminPublishQueryable, draftId: string): Promise<DraftRow | null> {
  return normalizeRows(
    await db.query<DraftRow>(
      `SELECT id, candidate_id, proposed_project_id, proposed_fields, private_notes, provenance_map,
              lifecycle_state, provider, repository_id, source_revision, content_fingerprint,
              reviewed_field_diff, base_project_version, created_at, updated_at
       FROM project_drafts
       WHERE id = $1`,
      [draftId],
    ),
  )[0] ?? null;
}

async function fetchPublishedProject(db: AdminPublishQueryable, projectId: string): Promise<PublishedProjectRow | null> {
  return normalizeRows(
    await db.query<PublishedProjectRow>(
      `SELECT id, slug, title, tagline, area, year, summary, activity, details, metrics, links, media,
              lifecycle_state, publication_version
       FROM projects
       WHERE id = $1 AND lifecycle_state = 'published'`,
      [projectId],
    ),
  )[0] ?? null;
}

async function resolveLinkedProjectId(db: AdminPublishQueryable, draft: DraftRow): Promise<string | null> {
  if (draft.proposed_project_id) return draft.proposed_project_id;
  if (!draft.provider || !draft.repository_id) return null;
  return normalizeRows(
    await db.query<{ project_id: string | null }>(
      `SELECT project_id FROM project_sources WHERE provider = $1 AND repository_id = $2`,
      [draft.provider, draft.repository_id],
    ),
  )[0]?.project_id ?? null;
}

async function hasExactFreshAdminApproval(
  db: AdminPublishQueryable,
  draftId: string,
  diff: ReviewedFieldDiffEntry[],
): Promise<boolean> {
  const row = normalizeRows(
    await db.query<ApprovalEventRow>(
      `SELECT action,
              metadata->>'source' AS source,
              metadata->'reviewedFieldDiff' AS reviewed_field_diff,
              metadata->'reviewedFields' AS reviewed_fields
       FROM review_events
       WHERE draft_id = $1
         AND (
           action = 'approved_for_publish'
           OR (action = 'note' AND metadata->>'kind' = 'fields_updated')
         )
       ORDER BY created_at DESC, seq DESC
       LIMIT 1`,
      [draftId],
    ),
  )[0];
  return Boolean(
    row
    && row.action === 'approved_for_publish'
    && row.source === 'admin_publish'
    && isDeepStrictEqual(row.reviewed_field_diff, diff)
    && isDeepStrictEqual(row.reviewed_fields, diff.map((entry) => entry.field)),
  );
}

async function fetchLinkedEvidence(db: AdminPublishQueryable, draft: DraftRow): Promise<EvidenceRow[]> {
  return normalizeRows(
    await db.query<EvidenceRow>(
      `SELECT id, privacy_state, project_id
       FROM evidence_sources
       WHERE (draft_id = $1 OR ($2::text IS NOT NULL AND candidate_id = $2))
         AND ($3::text IS NULL OR claim_map->>'contentFingerprint' = $3)
       ORDER BY id`,
      [draft.id, draft.candidate_id, draft.provider ? draft.content_fingerprint : null],
    ),
  );
}

function selectReviewedFields(
  value: unknown,
  proposed: JsonRecord,
  current: PublishedProjectRow | null,
): { ok: true; fields: EditablePublicField[] } | { ok: false; failure: AdminPublishFailure } {
  if (value !== undefined) {
    if (!Array.isArray(value) || !value.every((field) => typeof field === 'string' && isEditablePublicField(field))) {
      return {
        ok: false,
        failure: { ok: false, status: 400, code: 'reviewed_fields_invalid', message: 'reviewedFields must contain only editable public field names.' },
      };
    }
    const requested = [...new Set(value as EditablePublicField[])];
    if (requested.length === 0) {
      return { ok: false, failure: { ok: false, status: 400, code: 'reviewed_fields_missing', message: 'Select at least one field to review.' } };
    }
    return { ok: true, fields: EDITABLE_PUBLIC_FIELDS.filter((field) => requested.includes(field)) };
  }

  if (!current) return { ok: true, fields: [...EDITABLE_PUBLIC_FIELDS] };
  const changed = EDITABLE_PUBLIC_FIELDS.filter((field) => {
    if (proposed[field] === undefined) return false;
    const validation = validatePublicFieldUpdate(field, proposed[field]);
    return validation.ok && !isDeepStrictEqual(asJsonValue(current[field]), validation.value);
  });
  if (changed.length === 0) {
    return { ok: false, failure: { ok: false, status: 422, code: 'reviewed_fields_missing', message: 'No changed public fields are available to review.' } };
  }
  return { ok: true, fields: changed };
}

function applyProposedFields(
  current: PublishedProjectRow,
  proposed: JsonRecord,
  selected: EditablePublicField[],
): JsonRecord {
  const record = publicFieldsRecord(current);
  for (const field of selected) {
    const validation = validatePublicFieldUpdate(field, proposed[field]);
    if (!validation.ok) throw new Error(validation.issue.message);
    record[field] = validation.value;
  }
  return record;
}

function applyReviewedDiff(current: PublishedProjectRow, diff: ReviewedFieldDiffEntry[]): JsonRecord {
  const record = publicFieldsRecord(current);
  for (const entry of diff) record[entry.field] = entry.after;
  return record;
}

function publicFieldsRecord(fields: PublicProjectFields): JsonRecord {
  return {
    slug: fields.slug,
    title: fields.title,
    tagline: fields.tagline,
    area: fields.area,
    year: fields.year,
    summary: fields.summary,
    activity: fields.activity,
    details: fields.details as JsonValue[],
    metrics: fields.metrics as JsonValue[],
    links: fields.links as JsonValue[],
    media: fields.media as JsonValue[],
  };
}

function withPublicDefaults(fields: JsonRecord): JsonRecord {
  return {
    slug: fields.slug,
    title: fields.title,
    tagline: fields.tagline,
    area: fields.area,
    year: fields.year,
    summary: fields.summary,
    activity: fields.activity ?? '',
    details: fields.details ?? [],
    metrics: fields.metrics ?? [],
    links: fields.links ?? [],
    media: fields.media ?? [],
  };
}

function validateRequiredFields(fields: JsonRecord): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const field of REQUIRED_PUBLIC_FIELDS) {
    const result = validatePublicFieldUpdate(field, fields[field]);
    if (!result.ok) issues.push(result.issue);
  }
  for (const field of ['activity', 'details', 'metrics', 'links', 'media'] as const) {
    const result = validatePublicFieldUpdate(field, fields[field] ?? (field === 'activity' ? '' : []));
    if (!result.ok) issues.push(result.issue);
  }
  return issues;
}

export function validatePublicFieldUpdate(field: EditablePublicField, value: unknown): PublicFieldValidationResult {
  if (field === 'slug') return validateSlug(value);
  if (field === 'year') return validateYear(value);
  if (field === 'area') return validateProjectArea(value);
  if (field === 'activity') return validateOptionalString(field, value);
  if (field === 'details') return validateNestedArray(field, ProjectDetailSchema.array(), value);
  if (field === 'metrics') return validateNestedArray(field, ProjectMetricSchema.array(), value);
  if (field === 'links') return validateNestedArray(field, ProjectLinkSchema.array(), value);
  if (field === 'media') return validateNestedArray(field, ProjectMediaSchema.array(), value);
  return validateRequiredString(field, value);
}

function validateSlug(value: unknown): PublicFieldValidationResult {
  if (typeof value !== 'string') return invalid('slug', 'Slug must be a string.');
  const slug = value.trim();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(slug)) return invalid('slug', 'Slug must be 2-64 lowercase letters, numbers, or hyphens.');
  return { ok: true, value: slug };
}

function validateYear(value: unknown): PublicFieldValidationResult {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 2000 || value > 2100) return invalid('year', 'Year must be an integer from 2000 through 2100.');
  return { ok: true, value };
}

function validateProjectArea(value: unknown): PublicFieldValidationResult {
  const parsed = ProjectAreaSchema.safeParse(value);
  return parsed.success ? { ok: true, value: parsed.data } : invalid('area', 'Area must be one of the five recruiter-facing project areas.');
}

function validateRequiredString(field: RequiredPublicField, value: unknown): PublicFieldValidationResult {
  if (typeof value !== 'string') return invalid(field, `${field} must be a string.`);
  const trimmed = value.trim();
  return trimmed ? { ok: true, value: trimmed } : invalid(field, `${field} is required.`);
}

function validateOptionalString(field: 'activity', value: unknown): PublicFieldValidationResult {
  return typeof value === 'string' ? { ok: true, value: value.trim() } : invalid(field, 'activity must be a string.');
}

function validateNestedArray(
  field: PublicArrayField,
  schema: { safeParse(value: unknown): { success: true; data: unknown[] } | { success: false } },
  value: unknown,
): PublicFieldValidationResult {
  const parsed = schema.safeParse(value);
  return parsed.success ? { ok: true, value: parsed.data as JsonValue[] } : invalid(field, `${field} must match the canonical project schema.`);
}

function parseReviewedFieldDiff(value: JsonValue[]): { ok: true; entries: ReviewedFieldDiffEntry[] } | { ok: false } {
  if (!Array.isArray(value)) return { ok: false };
  const entries: ReviewedFieldDiffEntry[] = [];
  for (const raw of value) {
    if (
      !isPlainRecord(raw)
      || typeof raw.field !== 'string'
      || !isEditablePublicField(raw.field)
      || !isJsonValue(raw.before)
      || !isJsonValue(raw.after)
    ) return { ok: false };
    if (entries.some((entry) => entry.field === raw.field)) return { ok: false };
    entries.push({ field: raw.field, before: raw.before, after: raw.after });
  }
  if (!isDeepStrictEqual(entries.map((entry) => entry.field), EDITABLE_PUBLIC_FIELDS.filter((field) => entries.some((entry) => entry.field === field)))) return { ok: false };
  return { ok: true, entries };
}

function invalid(field: string, message: string): PublicFieldValidationResult {
  return { ok: false, issue: { field, message } };
}

function fieldsIncomplete(issues: ValidationIssue[]): AdminPublishFailure {
  return { ok: false, status: 422, code: 'fields_incomplete', message: 'Required public fields are missing or invalid.', fields: issues.map((issue) => issue.field), issues };
}

function staleDraft(draftId: string, fields: EditablePublicField[]): AdminPublishFailure {
  return { ok: false, status: 409, code: 'reviewed_diff_stale', message: 'The canonical project changed after this draft was staged. Restage and review the whole draft.', draftId, fields };
}

function terminalDraft(draft: DraftRow): AdminPublishFailure {
  return { ok: false, status: 409, code: 'draft_terminal', message: `Draft is terminal (${draft.lifecycle_state}) and cannot be edited or approved.`, draftId: draft.id };
}

function projectIdFromDraftId(draftId: string): string {
  return draftId.startsWith('draft_') ? `proj_${draftId.slice(6)}` : `proj_${draftId}`;
}

function hasPublicProvenance(value: JsonRecord): boolean {
  return Object.keys(value).length > 0;
}

export function isEditablePublicField(field: string): field is EditablePublicField {
  return field in EDITABLE_FIELDS;
}

function isArrayField(field: EditablePublicField): field is PublicArrayField {
  return field === 'details' || field === 'metrics' || field === 'links' || field === 'media';
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isPlainRecord(value) && Object.values(value).every(isJsonValue);
}

function asJsonValue(value: unknown): JsonValue {
  if (!isJsonValue(value)) throw new Error('Value is not JSON serializable.');
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPgErrorCode(error: unknown, code: string): boolean {
  return isPlainRecord(error) && error.code === code;
}

function errorField(error: unknown, key: string): unknown {
  return isPlainRecord(error) ? error[key] : undefined;
}

function draftNotFound(draftId: string): AdminPublishFailure {
  return { ok: false, status: 404, code: 'draft_not_found', message: `Draft ${draftId} was not found.`, draftId };
}

function normalizeRows<Row>(result: { rows: Row[] } | Row[]): Row[] {
  return Array.isArray(result) ? result : result.rows;
}
