-- GitHub issue #190: canonical catalog-to-published-DB cutover.
--
-- This migration installs the idempotent cutover operation only. The explicit
-- db:catalog:cutover command proves one-way parity over the already-reviewed
-- shadow set, then invokes this function under the maintainer approval gate.

CREATE OR REPLACE FUNCTION catalog_cutover_publish_legacy_shadow()
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  promoted_count integer;
BEGIN
  WITH promoted AS (
    UPDATE projects
    SET lifecycle_state = 'published',
        published_at = COALESCE(published_at, now()),
        publication_version = CASE
          WHEN publication_version = 0 THEN 1
          ELSE publication_version
        END,
        updated_at = now()
    WHERE source = 'legacy_catalog'
      AND lifecycle_state = 'shadow'
    RETURNING id, publication_version
  ),
  refresh_target AS (
    SELECT id, publication_version
    FROM promoted
    ORDER BY id
    LIMIT 1
  ),
  refresh AS (
    INSERT INTO publish_outbox (
      id, job_type, project_id, publication_version, evidence_source_id, evidence_version
    )
    SELECT portfolio_outbox_id('site_refresh', id, publication_version, NULL, NULL),
           'site_refresh', id, publication_version, NULL, NULL
    FROM refresh_target
    ON CONFLICT (job_type, project_id, publication_version, evidence_source_id, evidence_version)
    DO NOTHING
  )
  SELECT count(*)::integer INTO promoted_count FROM promoted;

  RETURN promoted_count;
END;
$function$;
