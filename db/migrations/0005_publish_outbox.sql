-- GitHub issue #189: durable publish-to-RAG/site-refresh outbox.
--
-- The Neon HTTP runner applies each top-level statement independently. Schema
-- statements are retry-safe; publication itself remains one atomic SQL CTE in
-- src/lib/admin/publish.ts.

ALTER TABLE evidence_sources
  ADD COLUMN IF NOT EXISTS evidence_version bigint NOT NULL DEFAULT 1;

ALTER TABLE evidence_sources DROP CONSTRAINT IF EXISTS evidence_sources_evidence_version_check;

ALTER TABLE evidence_sources
  ADD CONSTRAINT evidence_sources_evidence_version_check CHECK (evidence_version >= 1) NOT VALID;

ALTER TABLE evidence_sources VALIDATE CONSTRAINT evidence_sources_evidence_version_check;

ALTER TABLE rag_sources
  ADD COLUMN IF NOT EXISTS evidence_version bigint NOT NULL DEFAULT 1;

ALTER TABLE rag_sources
  ADD COLUMN IF NOT EXISTS publication_version bigint NOT NULL DEFAULT 0;

ALTER TABLE rag_sources
  ADD COLUMN IF NOT EXISTS remote_step text NOT NULL DEFAULT 'pending';

UPDATE rag_sources AS rag
SET evidence_version = evidence.evidence_version
FROM evidence_sources AS evidence
WHERE evidence.id = rag.evidence_source_id;

UPDATE rag_sources AS rag
SET publication_version = project.publication_version
FROM projects AS project
WHERE project.id = rag.project_id;

UPDATE rag_sources
SET remote_step = CASE
  WHEN eligibility_state = 'revoked' AND openai_file_id IS NULL THEN 'revoked'
  WHEN eligibility_state = 'indexed' THEN 'indexed'
  WHEN openai_file_id IS NOT NULL AND vector_store_id IS NOT NULL THEN 'attached'
  WHEN openai_file_id IS NOT NULL THEN 'uploaded'
  ELSE 'pending'
END
WHERE remote_step = 'pending';

ALTER TABLE rag_sources DROP CONSTRAINT IF EXISTS rag_sources_evidence_version_check;

ALTER TABLE rag_sources
  ADD CONSTRAINT rag_sources_evidence_version_check CHECK (evidence_version >= 1) NOT VALID;

ALTER TABLE rag_sources VALIDATE CONSTRAINT rag_sources_evidence_version_check;

ALTER TABLE rag_sources DROP CONSTRAINT IF EXISTS rag_sources_publication_version_check;

ALTER TABLE rag_sources
  ADD CONSTRAINT rag_sources_publication_version_check CHECK (publication_version >= 0) NOT VALID;

ALTER TABLE rag_sources VALIDATE CONSTRAINT rag_sources_publication_version_check;

ALTER TABLE rag_sources DROP CONSTRAINT IF EXISTS rag_sources_remote_step_check;

ALTER TABLE rag_sources
  ADD CONSTRAINT rag_sources_remote_step_check CHECK (
    remote_step IN ('pending', 'uploaded', 'attached', 'indexed', 'detached', 'revoked')
  ) NOT VALID;

ALTER TABLE rag_sources VALIDATE CONSTRAINT rag_sources_remote_step_check;

CREATE UNIQUE INDEX IF NOT EXISTS rag_sources_active_evidence_version_uidx
  ON rag_sources(project_id, evidence_source_id, evidence_version)
  WHERE evidence_source_id IS NOT NULL
    AND eligibility_state IN ('eligible', 'indexing', 'indexed');

CREATE TABLE IF NOT EXISTS publish_outbox (
  id text PRIMARY KEY,
  job_type text NOT NULL CHECK (job_type IN ('rag_index', 'rag_revoke', 'site_refresh')),
  project_id text NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  publication_version bigint NOT NULL CHECK (publication_version >= 0),
  evidence_source_id text REFERENCES evidence_sources(id) ON DELETE RESTRICT,
  evidence_version bigint,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'processing', 'succeeded', 'dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 5),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  claim_token uuid,
  worker_id text,
  last_error text,
  remote_operation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (job_type = 'site_refresh' AND evidence_source_id IS NULL AND evidence_version IS NULL)
    OR
    (job_type IN ('rag_index', 'rag_revoke') AND evidence_source_id IS NOT NULL AND evidence_version IS NOT NULL AND evidence_version >= 1)
  ),
  CHECK (
    (state = 'processing' AND lease_expires_at IS NOT NULL AND claim_token IS NOT NULL AND worker_id IS NOT NULL)
    OR
    (state <> 'processing' AND lease_expires_at IS NULL AND claim_token IS NULL AND worker_id IS NULL)
  ),
  CHECK (worker_id IS NULL OR length(worker_id) BETWEEN 1 AND 128),
  CHECK (last_error IS NULL OR length(last_error) <= 500)
);

CREATE UNIQUE INDEX IF NOT EXISTS publish_outbox_identity_uidx
  ON publish_outbox(job_type, project_id, publication_version, evidence_source_id, evidence_version)
  NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS publish_outbox_ready_idx
  ON publish_outbox(state, next_attempt_at, lease_expires_at);

CREATE OR REPLACE FUNCTION portfolio_outbox_id(
  requested_job_type text,
  requested_project_id text,
  requested_publication_version bigint,
  requested_evidence_source_id text,
  requested_evidence_version bigint
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT requested_job_type
    || ':' || length(requested_project_id)::text || ':' || requested_project_id
    || ':' || requested_publication_version::text
    || ':' || CASE
      WHEN requested_evidence_source_id IS NULL THEN '-'
      ELSE length(requested_evidence_source_id)::text || ':' || requested_evidence_source_id
    END
    || ':' || COALESCE(requested_evidence_version::text, '-');
$function$;

CREATE OR REPLACE FUNCTION increment_evidence_version() RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.extracted_text_sha256 IS DISTINCT FROM OLD.extracted_text_sha256
     OR NEW.claim_map IS DISTINCT FROM OLD.claim_map
     OR NEW.privacy_state IS DISTINCT FROM OLD.privacy_state THEN
    NEW.evidence_version := OLD.evidence_version + 1;
  ELSE
    NEW.evidence_version := OLD.evidence_version;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS evidence_sources_increment_version ON evidence_sources;

CREATE TRIGGER evidence_sources_increment_version
  BEFORE UPDATE OF extracted_text_sha256, claim_map, privacy_state ON evidence_sources
  FOR EACH ROW EXECUTE FUNCTION increment_evidence_version();

CREATE OR REPLACE FUNCTION revoke_stale_evidence_rag() RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.project_id IS NOT NULL
     AND (
       NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.evidence_version IS DISTINCT FROM OLD.evidence_version
       OR NEW.privacy_state IS DISTINCT FROM 'safe_public'
     ) THEN
    WITH revoked AS (
      UPDATE rag_sources
      SET eligibility_state = 'revoked',
          revoked_at = COALESCE(revoked_at, now()),
          failure_message = NULL,
          updated_at = now()
      WHERE project_id = OLD.project_id
        AND evidence_source_id = OLD.id
        AND evidence_version = OLD.evidence_version
        AND eligibility_state <> 'revoked'
      RETURNING project_id, evidence_source_id, evidence_version
    )
    INSERT INTO publish_outbox (
      id, job_type, project_id, publication_version, evidence_source_id, evidence_version
    )
    SELECT portfolio_outbox_id('rag_revoke', revoked.project_id, project.publication_version,
                               revoked.evidence_source_id, revoked.evidence_version),
           'rag_revoke', revoked.project_id, project.publication_version,
           revoked.evidence_source_id, revoked.evidence_version
    FROM revoked
    JOIN projects AS project ON project.id = revoked.project_id
    ON CONFLICT (job_type, project_id, publication_version, evidence_source_id, evidence_version)
    DO NOTHING;

  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS evidence_sources_revoke_stale_rag ON evidence_sources;

CREATE TRIGGER evidence_sources_revoke_stale_rag
  AFTER UPDATE OF project_id, extracted_text_sha256, claim_map, privacy_state ON evidence_sources
  FOR EACH ROW EXECUTE FUNCTION revoke_stale_evidence_rag();

CREATE OR REPLACE FUNCTION increment_unpublished_project_version() RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.lifecycle_state = 'published' AND NEW.lifecycle_state <> 'published' THEN
    NEW.publication_version := OLD.publication_version + 1;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS projects_increment_unpublished_version ON projects;

CREATE TRIGGER projects_increment_unpublished_version
  BEFORE UPDATE OF lifecycle_state ON projects
  FOR EACH ROW EXECUTE FUNCTION increment_unpublished_project_version();

CREATE OR REPLACE FUNCTION revoke_unpublished_project_rag() RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.lifecycle_state = 'published' AND NEW.lifecycle_state <> 'published' THEN
    WITH revoked AS (
      UPDATE rag_sources
      SET eligibility_state = 'revoked',
          revoked_at = COALESCE(revoked_at, now()),
          failure_message = NULL,
          updated_at = now()
      WHERE project_id = NEW.id
        AND eligibility_state <> 'revoked'
      RETURNING project_id, evidence_source_id, evidence_version
    )
    INSERT INTO publish_outbox (
      id, job_type, project_id, publication_version, evidence_source_id, evidence_version
    )
    SELECT portfolio_outbox_id('rag_revoke', revoked.project_id, NEW.publication_version,
                               revoked.evidence_source_id, revoked.evidence_version),
           'rag_revoke', revoked.project_id, NEW.publication_version,
           revoked.evidence_source_id, revoked.evidence_version
    FROM revoked
    WHERE revoked.evidence_source_id IS NOT NULL
    ON CONFLICT (job_type, project_id, publication_version, evidence_source_id, evidence_version)
    DO NOTHING;

    INSERT INTO publish_outbox (
      id, job_type, project_id, publication_version, evidence_source_id, evidence_version
    ) VALUES (
      portfolio_outbox_id('site_refresh', NEW.id, NEW.publication_version, NULL, NULL),
      'site_refresh', NEW.id, NEW.publication_version, NULL, NULL
    )
    ON CONFLICT (job_type, project_id, publication_version, evidence_source_id, evidence_version)
    DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS projects_revoke_unpublished_rag ON projects;

CREATE TRIGGER projects_revoke_unpublished_rag
  AFTER UPDATE OF lifecycle_state ON projects
  FOR EACH ROW EXECUTE FUNCTION revoke_unpublished_project_rag();
