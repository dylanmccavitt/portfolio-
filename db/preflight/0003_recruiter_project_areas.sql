-- Read-only dry run for db/migrations/0003_recruiter_project_areas.sql.
-- A safe result is zero rows. Any row will remain noncanonical after the
-- migration and must be reviewed and mapped before apply.

WITH canonical_areas(area) AS (
  VALUES
    ('Shipped & Client Work'),
    ('Apps'),
    ('AI & Developer Tools'),
    ('Side Projects & Experiments'),
    ('Coursework')
),
legacy_area_mappings(old_area, new_area) AS (
  VALUES
    ('Trading systems', 'Side Projects & Experiments'),
    ('Agents & MCP', 'AI & Developer Tools'),
    ('iOS', 'Apps'),
    ('Shipped', 'Shipped & Client Work'),
    ('School', 'Coursework'),
    ('Infrastructure', 'Side Projects & Experiments'),
    ('Research', 'Side Projects & Experiments')
),
project_overrides(override_order, project_ref, new_area) AS (
  VALUES
    (1, 'bellas-beads', 'Shipped & Client Work'),
    (2, 'nhf', 'Shipped & Client Work'),
    (3, 'dog-log', 'Apps'),
    (4, 'chore-ladder', 'Apps'),
    (5, 'evalgate', 'AI & Developer Tools'),
    (6, 'tradingview-mcp', 'AI & Developer Tools'),
    (7, 'slurmlet', 'AI & Developer Tools'),
    (8, 'loom', 'AI & Developer Tools'),
    (9, 'agentic-trader', 'Side Projects & Experiments'),
    (10, 'exit-manager', 'Side Projects & Experiments'),
    (11, 'tastytrade-exit-manager', 'Side Projects & Experiments'),
    (12, 'hood', 'Side Projects & Experiments'),
    (13, 'condor-study', 'Side Projects & Experiments'),
    (14, 'harness-arena', 'Side Projects & Experiments'),
    (15, 'homeserver', 'Side Projects & Experiments'),
    (16, 'work-orders', 'Coursework'),
    (17, 'epl-ml', 'Coursework')
),
prospective_projects AS (
  SELECT
    'projects'::text AS source,
    project.id || ' / ' || project.slug AS project_ref,
    project.area AS current_area,
    COALESCE(
      (
        SELECT override.new_area
        FROM project_overrides AS override
        WHERE project.id = override.project_ref OR project.slug = override.project_ref
        ORDER BY override.override_order
        LIMIT 1
      ),
      legacy.new_area,
      project.area
    ) AS prospective_area
  FROM projects AS project
  LEFT JOIN legacy_area_mappings AS legacy ON legacy.old_area = project.area
),
prospective_drafts AS (
  SELECT
    'project_drafts'::text AS source,
    draft.id AS project_ref,
    COALESCE(draft.proposed_fields->>'area', (draft.proposed_fields->'area')::text) AS current_area,
    COALESCE(
      (
        SELECT override.new_area
        FROM project_overrides AS override
        WHERE draft.proposed_project_id = override.project_ref
          OR draft.proposed_fields->>'id' = override.project_ref
          OR draft.proposed_fields->>'slug' = override.project_ref
        ORDER BY override.override_order
        LIMIT 1
      ),
      legacy.new_area,
      COALESCE(draft.proposed_fields->>'area', (draft.proposed_fields->'area')::text)
    ) AS prospective_area
  FROM project_drafts AS draft
  LEFT JOIN legacy_area_mappings AS legacy ON legacy.old_area = draft.proposed_fields->>'area'
  WHERE draft.proposed_fields ? 'area'
),
prospective_values AS (
  SELECT source, project_ref, current_area, prospective_area FROM prospective_projects
  UNION ALL
  SELECT source, project_ref, current_area, prospective_area FROM prospective_drafts
)
SELECT source, project_ref, current_area, prospective_area
FROM prospective_values AS candidate
WHERE NOT EXISTS (
  SELECT 1
  FROM canonical_areas AS canonical
  WHERE canonical.area = candidate.prospective_area
)
ORDER BY source, project_ref, current_area;
