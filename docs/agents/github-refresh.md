# GitHub refresh operator notes

## Manual fixture shape

`npm run db:github:scan -- <fixture.json>` expects a complete read-only snapshot:

```json
{
  "repo": {
    "repositoryId": "123456789",
    "owner": "owner",
    "name": "repo",
    "htmlUrl": "https://github.com/owner/repo",
    "topics": ["portfolio-candidate"],
    "isPrivate": false,
    "defaultBranch": "main",
    "sourceRevision": "0123456789012345678901234567890123456789",
    "portfolioManifest": { "status": "missing" }
  }
}
```

Live Slack scans obtain `repositoryId`, `defaultBranch`, `sourceRevision`, and
the manifest result from GitHub. Fixture callers must provide them explicitly;
the scanner will not substitute mutable timestamps or repository names.

## Existing-project identity adoption (issue #190 prerequisite)

The scanner never links by slug. Before the first Loom/existing-project refresh,
issue #190 must explicitly adopt the authenticated GitHub repository id onto the
exact published project id in the **preview** database. This is a manual preview
gate and requires the user's separate approval; issue #188 does not execute it.

1. Resolve the immutable id and current canonical name from authenticated
   GitHub, for example:

   ```sh
   gh api repos/DylanMcCavitt/loom --jq '{repository_id: (.id|tostring), canonical_full_name: .full_name}'
   ```

2. In the Neon preview SQL console, replace all three angle-bracket placeholders
   below with the reviewed exact values and run the statement. It inserts only
   when the target is already published, refuses to move either the repository
   identity or project identity to a different peer, and is safe to repeat for
   the same pair.

   ```sql
   WITH target AS (
     SELECT id
     FROM projects
     WHERE id = '<EXACT_PROJECT_ID>'
       AND lifecycle_state = 'published'
   ),
   linked AS (
     INSERT INTO project_sources (
       id, provider, repository_id, canonical_full_name, project_id
     )
     SELECT
       'source_github_adopt_<UNIQUE_SUFFIX>',
       'github',
       '<IMMUTABLE_NUMERIC_REPOSITORY_ID>',
       '<CANONICAL_OWNER_NAME>',
       target.id
     FROM target
     WHERE NOT EXISTS (
       SELECT 1
       FROM project_sources existing
       WHERE existing.project_id = target.id
         AND (
           existing.provider <> 'github'
           OR existing.repository_id <> '<IMMUTABLE_NUMERIC_REPOSITORY_ID>'
         )
     )
     ON CONFLICT (provider, repository_id) DO UPDATE
       SET canonical_full_name = EXCLUDED.canonical_full_name,
           project_id = EXCLUDED.project_id,
           updated_at = now()
       WHERE project_sources.project_id IS NULL
          OR project_sources.project_id = EXCLUDED.project_id
     RETURNING provider, repository_id, canonical_full_name, project_id
   )
   SELECT * FROM linked;
   ```

3. Require exactly one returned row matching the reviewed project/repository
   pair. Zero rows is a conflict or invalid target; stop without scanning.
4. Run the scan, confirm the draft captures that project's current
   `publication_version`, and continue through the normal review/publish flow.

Production adoption remains part of the later approved launch runbook. No
agent applies either preview or production identity linkage in issue #188.

## Safe operating sequence

1. Scan the repository. The result is a candidate plus one hidden revision
   draft; no public project changes.
2. Review the proposed fields and evidence privacy in `/admin/drafts/<id>`.
3. Save corrections. This clears any previous approval.
4. Approve the exact changed fields.
5. Publish with provenance and privacy confirmations. A stale version or field
   rejects the whole operation with 409; rescan/restage rather than forcing it.

There is no scheduled scanner in this issue. Scheduling remains deferred to
GitHub issue #193.
