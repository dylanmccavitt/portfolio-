-- Minimal non-public seed for migration/reset smoke tests and future parity harnesses.
-- This is not a catalog import and must not feed public routes.

INSERT INTO projects (
  id,
  slug,
  title,
  tagline,
  area,
  year,
  lifecycle_state,
  activity,
  summary,
  source
) VALUES (
  'seed-foundation-project',
  'seed-foundation-project',
  'Foundation seed project',
  'Non-public seed row for DB foundation checks.',
  'AI & Developer Tools',
  2026,
  'shadow',
  'test only',
  'Seed row used to verify the AGE-728 migration and reset path.',
  'test_seed'
) ON CONFLICT (id) DO NOTHING;
