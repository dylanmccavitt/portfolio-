export const PROJECT_LIFECYCLE_STATES = ['shadow', 'draft_only', 'published', 'archived'] as const;
export const SCAN_RUN_LIFECYCLE_STATES = ['queued', 'running', 'completed', 'failed'] as const;
export const CANDIDATE_LIFECYCLE_STATES = ['detected', 'qualified', 'dismissed', 'draft_requested'] as const;
export const DRAFT_LIFECYCLE_STATES = ['hidden', 'needs_review', 'changes_requested', 'approved_for_publish'] as const;
export const RAG_SOURCE_ELIGIBILITY_STATES = ['not_eligible', 'eligible', 'indexing', 'indexed', 'failed', 'revoked'] as const;

export const PROJECT_SOURCES = ['manual', 'legacy_catalog', 'github_discovery', 'test_seed'] as const;
export const SCAN_TRIGGERS = ['manual', 'slack', 'scheduled', 'test'] as const;
export const SOURCE_KINDS = ['github_repo', 'manual'] as const;
export const REPO_VISIBILITIES = ['public', 'private', 'unknown'] as const;
export const EVIDENCE_SOURCE_TYPES = ['repo', 'readme', 'release', 'pull_request', 'commit', 'manual', 'catalog', 'document', 'screenshot'] as const;
export const PRIVACY_STATES = ['unreviewed', 'safe_public', 'private_allowed_for_draft', 'blocked'] as const;
export const REVIEW_ACTIONS = [
  'candidate_qualified',
  'candidate_dismissed',
  'draft_requested',
  'draft_submitted',
  'changes_requested',
  'approved_for_publish',
  'published',
  'archived',
  'rag_marked_eligible',
  'rag_revoked',
  'note',
] as const;

export type ProjectLifecycleState = (typeof PROJECT_LIFECYCLE_STATES)[number];
export type ScanRunLifecycleState = (typeof SCAN_RUN_LIFECYCLE_STATES)[number];
export type CandidateLifecycleState = (typeof CANDIDATE_LIFECYCLE_STATES)[number];
export type DraftLifecycleState = (typeof DRAFT_LIFECYCLE_STATES)[number];
export type RagSourceEligibilityState = (typeof RAG_SOURCE_ELIGIBILITY_STATES)[number];

export type ProjectSource = (typeof PROJECT_SOURCES)[number];
export type ScanTrigger = (typeof SCAN_TRIGGERS)[number];
export type SourceKind = (typeof SOURCE_KINDS)[number];
export type RepoVisibility = (typeof REPO_VISIBILITIES)[number];
export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];
export type PrivacyState = (typeof PRIVACY_STATES)[number];
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonRecord = { [key: string]: JsonValue };

export interface ProjectRecord {
  id: string;
  slug: string;
  title: string;
  tagline: string;
  area: string;
  year: number;
  lifecycle_state: ProjectLifecycleState;
  activity: string;
  summary: string;
  details: JsonValue[];
  metrics: JsonValue[];
  links: JsonValue[];
  media: JsonValue[];
  source: ProjectSource;
  published_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScanRunRecord {
  id: string;
  trigger: ScanTrigger;
  actor: string;
  repo_scope: JsonRecord;
  lifecycle_state: ScanRunLifecycleState;
  result_counts: JsonRecord;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface ProjectCandidateRecord {
  id: string;
  scan_run_id: string | null;
  source_kind: SourceKind;
  source_ref: string;
  repo_visibility: RepoVisibility;
  signals: JsonRecord;
  confidence: string;
  evidence_packet: JsonRecord;
  lifecycle_state: CandidateLifecycleState;
  created_at: string;
  updated_at: string;
}

export interface ProjectDraftRecord {
  id: string;
  candidate_id: string | null;
  proposed_project_id: string | null;
  proposed_fields: JsonRecord;
  private_notes: string;
  provenance_map: JsonRecord;
  lifecycle_state: DraftLifecycleState;
  created_at: string;
  updated_at: string;
}

export interface EvidenceSourceRecord {
  id: string;
  candidate_id: string | null;
  draft_id: string | null;
  project_id: string | null;
  source_type: EvidenceSourceType;
  source_url: string | null;
  source_ref: string;
  repo_visibility: RepoVisibility;
  extracted_text: string | null;
  extracted_text_sha256: string | null;
  privacy_state: PrivacyState;
  claim_map: JsonRecord;
  created_at: string;
}

export interface ReviewEventRecord {
  id: string;
  project_id: string | null;
  draft_id: string | null;
  candidate_id: string | null;
  actor: string;
  action: ReviewAction;
  before_state: string | null;
  after_state: string | null;
  notes: string;
  metadata: JsonRecord;
  created_at: string;
}

export interface RagSourceRecord {
  id: string;
  project_id: string;
  evidence_source_id: string | null;
  eligibility_state: RagSourceEligibilityState;
  openai_file_id: string | null;
  vector_store_id: string | null;
  metadata: JsonRecord;
  last_synced_at: string | null;
  revoked_at: string | null;
  failure_message: string | null;
  created_at: string;
  updated_at: string;
}
