-- GitHub issue #188: immutable source identity and review-gated refresh drafts.
-- Keep every statement independently retryable for the Neon HTTP migration runner.

CREATE TABLE IF NOT EXISTS project_sources (
  id text PRIMARY KEY,
  provider text NOT NULL,
  repository_id text NOT NULL,
  canonical_full_name text NOT NULL,
  project_id text REFERENCES projects(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (provider = 'github'),
  CHECK (length(btrim(repository_id)) > 0),
  CHECK (length(btrim(canonical_full_name)) > 0),
  UNIQUE (provider, repository_id)
);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS publication_version bigint NOT NULL DEFAULT 0;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_publication_version_check;

ALTER TABLE projects
  ADD CONSTRAINT projects_publication_version_check CHECK (publication_version >= 0) NOT VALID;

ALTER TABLE projects VALIDATE CONSTRAINT projects_publication_version_check;

ALTER TABLE project_sources DROP CONSTRAINT IF EXISTS project_sources_repository_id_numeric_check;

ALTER TABLE project_sources
  ADD CONSTRAINT project_sources_repository_id_numeric_check CHECK (repository_id ~ '^[0-9]+$') NOT VALID;

ALTER TABLE project_sources VALIDATE CONSTRAINT project_sources_repository_id_numeric_check;

ALTER TABLE project_candidates ADD COLUMN IF NOT EXISTS provider text;

ALTER TABLE project_candidates ADD COLUMN IF NOT EXISTS repository_id text;

ALTER TABLE project_candidates ADD COLUMN IF NOT EXISTS source_revision text;

ALTER TABLE project_candidates ADD COLUMN IF NOT EXISTS content_fingerprint text;

ALTER TABLE project_candidates DROP CONSTRAINT IF EXISTS project_candidates_source_identity_check;

ALTER TABLE project_candidates
  ADD CONSTRAINT project_candidates_source_identity_check CHECK (
    (provider IS NULL AND repository_id IS NULL AND source_revision IS NULL AND content_fingerprint IS NULL)
    OR (
      provider IS NOT NULL
      AND repository_id IS NOT NULL
      AND source_revision IS NOT NULL
      AND content_fingerprint IS NOT NULL
      AND provider = 'github'
      AND repository_id ~ '^[0-9]+$'
      AND source_revision ~ '^[0-9a-f]{40}$'
      AND content_fingerprint ~ '^[0-9a-f]{64}$'
    )
  ) NOT VALID;

ALTER TABLE project_candidates VALIDATE CONSTRAINT project_candidates_source_identity_check;

CREATE UNIQUE INDEX IF NOT EXISTS project_candidates_source_revision_uidx
  ON project_candidates (provider, repository_id, source_revision)
  WHERE provider IS NOT NULL AND repository_id IS NOT NULL AND source_revision IS NOT NULL;

ALTER TABLE project_drafts ADD COLUMN IF NOT EXISTS provider text;

ALTER TABLE project_drafts ADD COLUMN IF NOT EXISTS repository_id text;

ALTER TABLE project_drafts ADD COLUMN IF NOT EXISTS source_revision text;

ALTER TABLE project_drafts ADD COLUMN IF NOT EXISTS content_fingerprint text;

ALTER TABLE project_drafts
  ADD COLUMN IF NOT EXISTS reviewed_field_diff jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE project_drafts
  ADD COLUMN IF NOT EXISTS base_project_version bigint NOT NULL DEFAULT 0;

ALTER TABLE project_drafts DROP CONSTRAINT IF EXISTS project_drafts_lifecycle_state_check;

ALTER TABLE project_drafts
  ADD CONSTRAINT project_drafts_lifecycle_state_check CHECK (
    lifecycle_state IN ('hidden', 'needs_review', 'changes_requested', 'approved_for_publish', 'published', 'superseded')
  ) NOT VALID;

ALTER TABLE project_drafts VALIDATE CONSTRAINT project_drafts_lifecycle_state_check;

ALTER TABLE project_drafts DROP CONSTRAINT IF EXISTS project_drafts_source_identity_check;

ALTER TABLE project_drafts
  ADD CONSTRAINT project_drafts_source_identity_check CHECK (
    (provider IS NULL AND repository_id IS NULL AND source_revision IS NULL AND content_fingerprint IS NULL)
    OR (
      provider IS NOT NULL
      AND repository_id IS NOT NULL
      AND source_revision IS NOT NULL
      AND content_fingerprint IS NOT NULL
      AND provider = 'github'
      AND repository_id ~ '^[0-9]+$'
      AND source_revision ~ '^[0-9a-f]{40}$'
      AND content_fingerprint ~ '^[0-9a-f]{64}$'
    )
  ) NOT VALID;

ALTER TABLE project_drafts VALIDATE CONSTRAINT project_drafts_source_identity_check;

ALTER TABLE project_drafts DROP CONSTRAINT IF EXISTS project_drafts_reviewed_field_diff_check;

ALTER TABLE project_drafts
  ADD CONSTRAINT project_drafts_reviewed_field_diff_check CHECK (
    jsonb_typeof(reviewed_field_diff) = 'array'
  ) NOT VALID;

ALTER TABLE project_drafts VALIDATE CONSTRAINT project_drafts_reviewed_field_diff_check;

ALTER TABLE project_drafts DROP CONSTRAINT IF EXISTS project_drafts_base_project_version_check;

ALTER TABLE project_drafts
  ADD CONSTRAINT project_drafts_base_project_version_check CHECK (base_project_version >= 0) NOT VALID;

ALTER TABLE project_drafts VALIDATE CONSTRAINT project_drafts_base_project_version_check;

CREATE UNIQUE INDEX IF NOT EXISTS project_drafts_source_revision_uidx
  ON project_drafts (provider, repository_id, source_revision)
  WHERE provider IS NOT NULL AND repository_id IS NOT NULL AND source_revision IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS project_drafts_active_source_uidx
  ON project_drafts (provider, repository_id)
  WHERE provider IS NOT NULL
    AND repository_id IS NOT NULL
    AND lifecycle_state IN ('hidden', 'needs_review', 'changes_requested', 'approved_for_publish');

CREATE INDEX IF NOT EXISTS project_sources_project_id_idx ON project_sources(project_id);

CREATE INDEX IF NOT EXISTS project_candidates_source_identity_idx
  ON project_candidates(provider, repository_id, source_revision);

CREATE INDEX IF NOT EXISTS project_drafts_source_identity_idx
  ON project_drafts(provider, repository_id, source_revision);
