import { randomUUID } from 'node:crypto';
import type { DraftLifecycleState, JsonRecord, JsonValue, PrivacyState, ReviewEventRecord } from '@/lib/db/schema';

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
type EditablePublicField = (typeof EDITABLE_PUBLIC_FIELDS)[number];
type PublicArrayField = 'details' | 'metrics' | 'links' | 'media';
type AdminPublishFailure = { ok: false; status: number; code: string; message: string; [key: string]: unknown };
type AdminPublishSuccess = { ok: true; status: number; code: string; message: string; [key: string]: unknown };
export type AdminPublishResult = AdminPublishFailure | AdminPublishSuccess;

type DraftRow = {
  id: string;
  candidate_id: string | null;
  proposed_project_id: string | null;
  proposed_fields: JsonRecord;
  private_notes: string;
  provenance_map: JsonRecord;
  lifecycle_state: DraftLifecycleState;
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

type EvidencePrivacyRow = { privacy_state: PrivacyState; count: string | number };
type ReviewEventRow = ReviewEventRecord;
type ValidationIssue = { field: string; message: string };
type ValidationResult = { ok: true; value: JsonValue } | { ok: false; issue: ValidationIssue };

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
const ARRAY_FIELDS: Record<PublicArrayField, true> = {
  details: true,
  metrics: true,
  links: true,
  media: true,
};

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
       WHERE draft_id = $1 OR ($2::text IS NOT NULL AND candidate_id = $2)
       GROUP BY privacy_state
       ORDER BY privacy_state`,
      [draft.id, draft.candidate_id],
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
    if (!isEditableField(key)) {
      return { ok: false, status: 400, code: 'invalid_field', message: `Field ${key} is not editable.`, field: key };
    }
    keys.push(key);
  }

  const validated: JsonRecord = {};
  for (const key of keys) {
    const result = validateEditableField(key, fields[key]);
    if (!result.ok) {
      const status = result.issue.field === 'slug' || result.issue.field === 'year' ? 422 : 400;
      return { ok: false, status, code: 'field_invalid', message: result.issue.message, field: result.issue.field };
    }
    validated[key] = result.value;
  }

  const draft = await fetchDraft(db, draftId);
  if (!draft) return draftNotFound(draftId);

  const beforeState = draft.lifecycle_state;
  const afterState: DraftLifecycleState = beforeState === 'approved_for_publish' ? 'needs_review' : beforeState;
  const proposedFields = { ...draft.proposed_fields, ...validated };

  await db.query(
    `UPDATE project_drafts
     SET proposed_fields = $2::jsonb,
         lifecycle_state = $3,
         updated_at = now()
     WHERE id = $1`,
    [draft.id, JSON.stringify(proposedFields), afterState],
  );
  await db.query(
    `INSERT INTO review_events (id, draft_id, candidate_id, actor, action, before_state, after_state, notes, metadata)
     VALUES ($1, $2, $3, $4, 'note', $5, $6, $7, $8::jsonb)`,
    [
      `review_${randomUUID()}`,
      draft.id,
      draft.candidate_id,
      actor,
      beforeState,
      afterState,
      'Admin updated public draft fields.',
      JSON.stringify({ source: 'admin_publish', kind: 'fields_updated', keys }),
    ],
  );

  return {
    ok: true,
    status: 200,
    code: 'draft_fields_updated',
    message: 'Draft fields updated.',
    draftId: draft.id,
    lifecycleState: afterState,
    fields: proposedFields,
  };
}

export async function approveAdminDraftForPublish(
  db: AdminPublishQueryable,
  draftId: string,
  actor: string,
): Promise<AdminPublishResult> {
  const draft = await fetchDraft(db, draftId);
  if (!draft) return draftNotFound(draftId);

  const issues = validateRequiredFields(draft.proposed_fields);
  if (issues.length > 0) return fieldsIncomplete(issues);

  if (draft.lifecycle_state !== 'approved_for_publish') {
    await db.query(
      `UPDATE project_drafts
       SET lifecycle_state = 'approved_for_publish', updated_at = now()
       WHERE id = $1`,
      [draft.id],
    );
  }

  await db.query(
    `INSERT INTO review_events (id, draft_id, candidate_id, actor, action, before_state, after_state, notes, metadata)
     VALUES ($1, $2, $3, $4, 'approved_for_publish', $5, 'approved_for_publish', $6, $7::jsonb)`,
    [
      `review_${randomUUID()}`,
      draft.id,
      draft.candidate_id,
      actor,
      draft.lifecycle_state,
      'Admin approved draft for publish.',
      JSON.stringify({ source: 'admin_publish' }),
    ],
  );

  return {
    ok: true,
    status: 200,
    code: 'approved_for_publish',
    message: 'Draft approved for publish.',
    draftId: draft.id,
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
      code: 'draft_not_approved',
      message: 'Admin approval required; Slack approval alone cannot publish.',
      draftId,
    };
  }

  const adminApprovalFresh = await hasFreshAdminPublishApproval(db, draft.id);
  if (!adminApprovalFresh) {
    return {
      ok: false,
      status: 409,
      code: 'admin_approval_missing',
      message: 'Admin publish approval event is required before publishing.',
      draftId,
    };
  }

  const issues = validateRequiredFields(draft.proposed_fields);
  if (issues.length > 0) return fieldsIncomplete(issues);

  if (input.confirmProvenance !== true || input.confirmPrivacy !== true) {
    return {
      ok: false,
      status: 428,
      code: 'confirmation_required',
      message: 'Confirm provenance and privacy review before publishing.',
      draftId,
    };
  }

  if (!hasPublicProvenance(draft.provenance_map)) {
    return {
      ok: false,
      status: 422,
      code: 'provenance_missing',
      message: 'Draft provenance map must be a non-empty object before publishing.',
      draftId,
    };
  }

  const privacyCounts = await countPublishBlockingEvidence(db, draft);
  if (privacyCounts.unreviewed > 0) {
    return {
      ok: false,
      status: 422,
      code: 'privacy_unreviewed_evidence',
      message: 'All linked evidence sources must be reviewed before publishing.',
      draftId,
      count: privacyCounts.unreviewed,
    };
  }

  if (privacyCounts.blocked > 0) {
    return {
      ok: false,
      status: 422,
      code: 'privacy_blocked_evidence',
      message: 'Blocked linked evidence sources cannot be published.',
      draftId,
      count: privacyCounts.blocked,
    };
  }

  const projectId = draft.proposed_project_id ?? projectIdFromDraftId(draft.id);
  const publicFields = publicProjectFields(draft.proposed_fields);

  try {
    await db.query(
      `INSERT INTO projects (
         id, slug, title, tagline, area, year, summary, activity, details, metrics, links, media,
         lifecycle_state, published_at, source, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb,
         'published', now(), $13, now()
       )
       ON CONFLICT (id) DO UPDATE SET
         slug = EXCLUDED.slug,
         title = EXCLUDED.title,
         tagline = EXCLUDED.tagline,
         area = EXCLUDED.area,
         year = EXCLUDED.year,
         summary = EXCLUDED.summary,
         activity = EXCLUDED.activity,
         details = EXCLUDED.details,
         metrics = EXCLUDED.metrics,
         links = EXCLUDED.links,
         media = EXCLUDED.media,
         lifecycle_state = 'published',
         published_at = COALESCE(projects.published_at, now()),
         source = EXCLUDED.source,
         updated_at = now()`,
      [
        projectId,
        publicFields.slug,
        publicFields.title,
        publicFields.tagline,
        publicFields.area,
        publicFields.year,
        publicFields.summary,
        publicFields.activity,
        JSON.stringify(publicFields.details),
        JSON.stringify(publicFields.metrics),
        JSON.stringify(publicFields.links),
        JSON.stringify(publicFields.media),
        draft.candidate_id ? 'github_discovery' : 'manual',
      ],
    );
  } catch (error) {
    if (isPgErrorCode(error, '23505')) {
      return { ok: false, status: 409, code: 'slug_conflict', message: 'Project slug already exists.', draftId };
    }
    throw error;
  }

  await db.query(`UPDATE project_drafts SET proposed_project_id = $2, updated_at = now() WHERE id = $1`, [draft.id, projectId]);
  await db.query(
    `UPDATE evidence_sources
     SET project_id = $1
     WHERE project_id IS NULL
       AND (
         ($2::text IS NOT NULL AND candidate_id = $2)
         OR draft_id = $3
       )`,
    [projectId, draft.candidate_id, draft.id],
  );
  await db.query(
    `INSERT INTO review_events (id, project_id, draft_id, candidate_id, actor, action, before_state, after_state, notes, metadata)
     VALUES ($1, $2, $3, $4, $5, 'published', 'approved_for_publish', 'published', $6, $7::jsonb)`,
    [
      `review_${randomUUID()}`,
      projectId,
      draft.id,
      draft.candidate_id,
      actor,
      'Admin published draft to public project record.',
      JSON.stringify({ source: 'admin_publish', confirmProvenance: true, confirmPrivacy: true, projectId }),
    ],
  );

  return { ok: true, status: 200, code: 'published', projectId, draftId: draft.id, message: 'Draft published.' };
}

async function fetchDraft(db: AdminPublishQueryable, draftId: string): Promise<DraftRow | null> {
  const rows = normalizeRows(
    await db.query<DraftRow>(
      `SELECT id, candidate_id, proposed_project_id, proposed_fields, private_notes, provenance_map,
              lifecycle_state, created_at, updated_at
       FROM project_drafts
       WHERE id = $1`,
      [draftId],
    ),
  );
  return rows[0] ?? null;
}

async function hasFreshAdminPublishApproval(db: AdminPublishQueryable, draftId: string): Promise<boolean> {
  const rows = normalizeRows(
    await db.query<{ action: string; source: string | null }>(
      `SELECT action, metadata->>'source' AS source
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
  );
  return rows[0]?.action === 'approved_for_publish' && rows[0].source === 'admin_publish';
}

async function countPublishBlockingEvidence(
  db: AdminPublishQueryable,
  draft: DraftRow,
): Promise<{ unreviewed: number; blocked: number }> {
  const rows = normalizeRows(
    await db.query<{ privacy_state: 'unreviewed' | 'blocked'; count: string | number }>(
      `SELECT privacy_state, count(*) AS count
       FROM evidence_sources
       WHERE (draft_id = $1 OR ($2::text IS NOT NULL AND candidate_id = $2))
         AND privacy_state IN ('unreviewed', 'blocked')
       GROUP BY privacy_state`,
      [draft.id, draft.candidate_id],
    ),
  );
  return {
    unreviewed: Number(rows.find((row) => row.privacy_state === 'unreviewed')?.count ?? 0),
    blocked: Number(rows.find((row) => row.privacy_state === 'blocked')?.count ?? 0),
  };
}

function projectIdFromDraftId(draftId: string): string {
  return draftId.startsWith('draft_') ? `proj_${draftId.slice(6)}` : `proj_${draftId}`;
}

function validateRequiredFields(fields: JsonRecord): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const field of REQUIRED_PUBLIC_FIELDS) {
    const result = validateEditableField(field, fields[field]);
    if (!result.ok) issues.push(result.issue);
  }
  return issues;
}

function validateEditableField(field: EditablePublicField, value: unknown): ValidationResult {
  if (field === 'slug') return validateSlug(value);
  if (field === 'year') return validateYear(value);
  if (field === 'activity') return validateOptionalString(field, value);
  if (isArrayField(field)) return validateArray(field, value);
  return validateRequiredString(field, value);
}

function validateSlug(value: unknown): ValidationResult {
  if (typeof value !== 'string') return invalid('slug', 'Slug must be a string.');
  const slug = value.trim();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(slug)) {
    return invalid('slug', 'Slug must be 2-64 lowercase letters, numbers, or hyphens, starting with a letter or number.');
  }
  return { ok: true, value: slug };
}

function validateYear(value: unknown): ValidationResult {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 2000 || value > 2100) {
    return invalid('year', 'Year must be an integer from 2000 through 2100.');
  }
  return { ok: true, value };
}

function validateRequiredString(field: RequiredPublicField, value: unknown): ValidationResult {
  if (typeof value !== 'string') return invalid(field, `${field} must be a string.`);
  const trimmed = value.trim();
  if (!trimmed) return invalid(field, `${field} is required.`);
  return { ok: true, value: trimmed };
}

function validateOptionalString(field: 'activity', value: unknown): ValidationResult {
  if (typeof value !== 'string') return invalid(field, 'activity must be a string.');
  return { ok: true, value: value.trim() };
}

function validateArray(field: PublicArrayField, value: unknown): ValidationResult {
  if (!Array.isArray(value)) return invalid(field, `${field} must be a JSON array.`);
  return { ok: true, value: value as JsonValue[] };
}

function invalid(field: string, message: string): ValidationResult {
  return { ok: false, issue: { field, message } };
}

function fieldsIncomplete(issues: ValidationIssue[]): AdminPublishFailure {
  return {
    ok: false,
    status: 422,
    code: 'fields_incomplete',
    message: 'Required public fields are missing or invalid.',
    fields: issues.map((issue) => issue.field),
    issues,
  };
}

function publicProjectFields(fields: JsonRecord): {
  slug: string;
  title: string;
  tagline: string;
  area: string;
  year: number;
  summary: string;
  activity: string;
  details: JsonValue[];
  metrics: JsonValue[];
  links: JsonValue[];
  media: JsonValue[];
} {
  const slug = fields.slug;
  const title = fields.title;
  const tagline = fields.tagline;
  const area = fields.area;
  const year = fields.year;
  const summary = fields.summary;
  const activity = fields.activity;
  const details = fields.details;
  const metrics = fields.metrics;
  const links = fields.links;
  const media = fields.media;
  return {
    slug: typeof slug === 'string' ? slug : '',
    title: typeof title === 'string' ? title : '',
    tagline: typeof tagline === 'string' ? tagline : '',
    area: typeof area === 'string' ? area : '',
    year: typeof year === 'number' ? year : 2000,
    summary: typeof summary === 'string' ? summary : '',
    activity: typeof activity === 'string' ? activity : '',
    details: Array.isArray(details) ? details : [],
    metrics: Array.isArray(metrics) ? metrics : [],
    links: Array.isArray(links) ? links : [],
    media: Array.isArray(media) ? media : [],
  };
}

function hasPublicProvenance(value: JsonRecord): boolean {
  return isPlainRecord(value) && Object.keys(value).length > 0;
}

function isEditableField(field: string): field is EditablePublicField {
  return field in EDITABLE_FIELDS;
}

function isArrayField(field: EditablePublicField): field is PublicArrayField {
  return field in ARRAY_FIELDS;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPgErrorCode(error: unknown, code: string): boolean {
  if (!isPlainRecord(error)) return false;
  return error.code === code;
}

function draftNotFound(draftId: string): AdminPublishFailure {
  return { ok: false, status: 404, code: 'draft_not_found', message: `Draft ${draftId} was not found.`, draftId };
}

function normalizeRows<Row>(result: { rows: Row[] } | Row[]): Row[] {
  return Array.isArray(result) ? result : result.rows;
}
