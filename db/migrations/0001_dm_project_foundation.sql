-- AGE-728: DM project DB foundation.
-- Raw Postgres keeps this slice portable across Neon/Vercel without choosing an ORM yet.

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  tagline text NOT NULL,
  area text NOT NULL,
  year integer NOT NULL CHECK (year >= 2000 AND year <= 2100),
  lifecycle_state text NOT NULL DEFAULT 'draft_only' CHECK (lifecycle_state IN ('shadow', 'draft_only', 'published', 'archived')),
  activity text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  details jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '[]'::jsonb,
  links jsonb NOT NULL DEFAULT '[]'::jsonb,
  media jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'legacy_catalog', 'github_discovery', 'test_seed')),
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (lifecycle_state <> 'published' OR published_at IS NOT NULL),
  CHECK (lifecycle_state <> 'archived' OR archived_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS scan_runs (
  id text PRIMARY KEY,
  trigger text NOT NULL CHECK (trigger IN ('manual', 'slack', 'scheduled', 'test')),
  actor text NOT NULL,
  repo_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  lifecycle_state text NOT NULL DEFAULT 'queued' CHECK (lifecycle_state IN ('queued', 'running', 'completed', 'failed')),
  result_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (lifecycle_state <> 'running' OR started_at IS NOT NULL),
  CHECK (lifecycle_state NOT IN ('completed', 'failed') OR finished_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS project_candidates (
  id text PRIMARY KEY,
  scan_run_id text REFERENCES scan_runs(id) ON DELETE SET NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('github_repo', 'manual')),
  source_ref text NOT NULL,
  repo_visibility text NOT NULL DEFAULT 'unknown' CHECK (repo_visibility IN ('public', 'private', 'unknown')),
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(5,4) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  evidence_packet jsonb NOT NULL DEFAULT '{}'::jsonb,
  lifecycle_state text NOT NULL DEFAULT 'detected' CHECK (lifecycle_state IN ('detected', 'qualified', 'dismissed', 'draft_requested')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_drafts (
  id text PRIMARY KEY,
  candidate_id text REFERENCES project_candidates(id) ON DELETE SET NULL,
  proposed_project_id text REFERENCES projects(id) ON DELETE SET NULL,
  proposed_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  private_notes text NOT NULL DEFAULT '',
  provenance_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  lifecycle_state text NOT NULL DEFAULT 'hidden' CHECK (lifecycle_state IN ('hidden', 'needs_review', 'changes_requested', 'approved_for_publish')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence_sources (
  id text PRIMARY KEY,
  candidate_id text REFERENCES project_candidates(id) ON DELETE SET NULL,
  draft_id text REFERENCES project_drafts(id) ON DELETE SET NULL,
  project_id text REFERENCES projects(id) ON DELETE SET NULL,
  source_type text NOT NULL CHECK (source_type IN ('repo', 'readme', 'release', 'pull_request', 'commit', 'manual', 'catalog', 'document', 'screenshot')),
  source_url text,
  source_ref text NOT NULL,
  repo_visibility text NOT NULL DEFAULT 'unknown' CHECK (repo_visibility IN ('public', 'private', 'unknown')),
  extracted_text text,
  extracted_text_sha256 text,
  privacy_state text NOT NULL DEFAULT 'unreviewed' CHECK (privacy_state IN ('unreviewed', 'safe_public', 'private_allowed_for_draft', 'blocked')),
  claim_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (candidate_id IS NOT NULL OR draft_id IS NOT NULL OR project_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS review_events (
  id text PRIMARY KEY,
  project_id text REFERENCES projects(id) ON DELETE SET NULL,
  draft_id text REFERENCES project_drafts(id) ON DELETE SET NULL,
  candidate_id text REFERENCES project_candidates(id) ON DELETE SET NULL,
  actor text NOT NULL,
  action text NOT NULL CHECK (action IN ('candidate_qualified', 'candidate_dismissed', 'draft_requested', 'draft_submitted', 'changes_requested', 'approved_for_publish', 'published', 'archived', 'rag_marked_eligible', 'rag_revoked', 'note')),
  before_state text,
  after_state text,
  notes text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (project_id IS NOT NULL OR draft_id IS NOT NULL OR candidate_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS rag_sources (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  evidence_source_id text REFERENCES evidence_sources(id) ON DELETE SET NULL,
  eligibility_state text NOT NULL DEFAULT 'not_eligible' CHECK (eligibility_state IN ('not_eligible', 'eligible', 'indexing', 'indexed', 'failed', 'revoked')),
  openai_file_id text,
  vector_store_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  revoked_at timestamptz,
  failure_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (eligibility_state <> 'indexed' OR (openai_file_id IS NOT NULL AND vector_store_id IS NOT NULL)),
  CHECK (eligibility_state <> 'revoked' OR revoked_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS projects_lifecycle_state_idx ON projects(lifecycle_state);
CREATE INDEX IF NOT EXISTS project_candidates_scan_run_id_idx ON project_candidates(scan_run_id);
CREATE INDEX IF NOT EXISTS project_candidates_lifecycle_state_idx ON project_candidates(lifecycle_state);
CREATE INDEX IF NOT EXISTS project_drafts_candidate_id_idx ON project_drafts(candidate_id);
CREATE INDEX IF NOT EXISTS project_drafts_lifecycle_state_idx ON project_drafts(lifecycle_state);
CREATE INDEX IF NOT EXISTS evidence_sources_project_id_idx ON evidence_sources(project_id);
CREATE INDEX IF NOT EXISTS evidence_sources_privacy_state_idx ON evidence_sources(privacy_state);
CREATE INDEX IF NOT EXISTS review_events_project_id_idx ON review_events(project_id);
CREATE INDEX IF NOT EXISTS rag_sources_project_id_idx ON rag_sources(project_id);
CREATE INDEX IF NOT EXISTS rag_sources_eligibility_state_idx ON rag_sources(eligibility_state);
