-- GitHub #187: canonical recruiter-facing project areas.
--
-- The Neon HTTP migration runner executes each statement independently. Every
-- statement below therefore converges safely when a partial run is retried.

UPDATE projects
SET area = CASE area
  WHEN 'Trading systems' THEN 'Side Projects & Experiments'
  WHEN 'Agents & MCP' THEN 'AI & Developer Tools'
  WHEN 'iOS' THEN 'Apps'
  WHEN 'Shipped' THEN 'Shipped & Client Work'
  WHEN 'School' THEN 'Coursework'
  WHEN 'Infrastructure' THEN 'Side Projects & Experiments'
  WHEN 'Research' THEN 'Side Projects & Experiments'
  ELSE area
END
WHERE area IN ('Trading systems', 'Agents & MCP', 'iOS', 'Shipped', 'School', 'Infrastructure', 'Research');

UPDATE projects AS project
SET area = mapping.new_area
FROM (
  VALUES
    ('bellas-beads', 'Shipped & Client Work'),
    ('nhf', 'Shipped & Client Work'),
    ('dog-log', 'Apps'),
    ('chore-ladder', 'Apps'),
    ('evalgate', 'AI & Developer Tools'),
    ('tradingview-mcp', 'AI & Developer Tools'),
    ('slurmlet', 'AI & Developer Tools'),
    ('loom', 'AI & Developer Tools'),
    ('agentic-trader', 'Side Projects & Experiments'),
    ('exit-manager', 'Side Projects & Experiments'),
    ('tastytrade-exit-manager', 'Side Projects & Experiments'),
    ('hood', 'Side Projects & Experiments'),
    ('condor-study', 'Side Projects & Experiments'),
    ('harness-arena', 'Side Projects & Experiments'),
    ('homeserver', 'Side Projects & Experiments'),
    ('work-orders', 'Coursework'),
    ('epl-ml', 'Coursework')
) AS mapping(project_ref, new_area)
WHERE (project.id = mapping.project_ref OR project.slug = mapping.project_ref)
  AND project.area IS DISTINCT FROM mapping.new_area;

UPDATE project_drafts
SET proposed_fields = jsonb_set(
  proposed_fields,
  '{area}',
  to_jsonb((CASE proposed_fields->>'area'
    WHEN 'Trading systems' THEN 'Side Projects & Experiments'
    WHEN 'Agents & MCP' THEN 'AI & Developer Tools'
    WHEN 'iOS' THEN 'Apps'
    WHEN 'Shipped' THEN 'Shipped & Client Work'
    WHEN 'School' THEN 'Coursework'
    WHEN 'Infrastructure' THEN 'Side Projects & Experiments'
    WHEN 'Research' THEN 'Side Projects & Experiments'
    ELSE proposed_fields->>'area'
  END)::text),
  false
)
WHERE proposed_fields->>'area' IN ('Trading systems', 'Agents & MCP', 'iOS', 'Shipped', 'School', 'Infrastructure', 'Research');

UPDATE project_drafts AS draft
SET proposed_fields = jsonb_set(draft.proposed_fields, '{area}', to_jsonb(mapping.new_area::text), false)
FROM (
  VALUES
    ('bellas-beads', 'Shipped & Client Work'),
    ('nhf', 'Shipped & Client Work'),
    ('dog-log', 'Apps'),
    ('chore-ladder', 'Apps'),
    ('evalgate', 'AI & Developer Tools'),
    ('tradingview-mcp', 'AI & Developer Tools'),
    ('slurmlet', 'AI & Developer Tools'),
    ('loom', 'AI & Developer Tools'),
    ('agentic-trader', 'Side Projects & Experiments'),
    ('exit-manager', 'Side Projects & Experiments'),
    ('tastytrade-exit-manager', 'Side Projects & Experiments'),
    ('hood', 'Side Projects & Experiments'),
    ('condor-study', 'Side Projects & Experiments'),
    ('harness-arena', 'Side Projects & Experiments'),
    ('homeserver', 'Side Projects & Experiments'),
    ('work-orders', 'Coursework'),
    ('epl-ml', 'Coursework')
) AS mapping(project_ref, new_area)
WHERE draft.proposed_fields ? 'area'
  AND (
    draft.proposed_project_id = mapping.project_ref
    OR draft.proposed_fields->>'id' = mapping.project_ref
    OR draft.proposed_fields->>'slug' = mapping.project_ref
  )
  AND draft.proposed_fields->>'area' IS DISTINCT FROM mapping.new_area;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_area_recruiter_facing_check;

ALTER TABLE projects
  ADD CONSTRAINT projects_area_recruiter_facing_check
  CHECK (area IN ('Shipped & Client Work', 'Apps', 'AI & Developer Tools', 'Side Projects & Experiments', 'Coursework'))
  NOT VALID;

ALTER TABLE projects VALIDATE CONSTRAINT projects_area_recruiter_facing_check;

ALTER TABLE project_drafts DROP CONSTRAINT IF EXISTS project_drafts_area_recruiter_facing_check;

ALTER TABLE project_drafts
  ADD CONSTRAINT project_drafts_area_recruiter_facing_check
  CHECK (
    NOT (proposed_fields ? 'area')
    OR (
      jsonb_typeof(proposed_fields->'area') = 'string'
      AND proposed_fields->>'area' IN ('Shipped & Client Work', 'Apps', 'AI & Developer Tools', 'Side Projects & Experiments', 'Coursework')
    )
  )
  NOT VALID;

ALTER TABLE project_drafts VALIDATE CONSTRAINT project_drafts_area_recruiter_facing_check;
