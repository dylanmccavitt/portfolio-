# Review-gated project refresh and publish

The authenticated admin lane turns a hidden `project_drafts` row into one
atomic first publication or reviewed refresh. GitHub issue #188 adds immutable
source identity, revision-idempotent proposals, ordered field review, and
terminal drafts on top of the original AGE-731 foundation.

## Operator entry point

- Preview admin: `https://preview.dylanmccavitt.xyz/admin`
- Local admin: `/admin` on the active dev origin
- The route is intentionally absent from recruiter-facing navigation and is
  protected by GitHub OAuth plus the allowed-login gate.
- A Slack **Send to admin review** action creates or acknowledges a hidden
  draft. `approved_for_publish` still is not public: an authenticated admin must
  press Publish successfully before the project can appear in the library or DM.

If the draft list works but a draft detail reports a missing `provider` column,
the deployed code is ahead of migration `0004`. If project pages or DM report
public data unavailable, verify migration `0003`, the database connection, and
the typed public-project failure before changing content or RAG. Catalog content
should appear on a deployment only when the response header explicitly reports
`catalog_emergency`.

## Source and draft contract

- GitHub repositories are keyed by `provider = github` plus GitHub's immutable
  numeric repository id. Owner/name and URLs are mutable metadata; slugs never
  resolve source identity.
- `source_revision` is the fetched default-branch HEAD commit SHA. `pushed_at`
  remains metadata only.
- A scan fetches repository metadata, default-branch HEAD, root
  `portfolio.json`, and README under the same authenticated snapshot operation.
- Root `portfolio.json` v1 is
  `{ "schemaVersion": 1, "project": <canonical project payload> }` and is
  limited to 64 KiB. A missing manifest may use a repository-evidence proposal.
  Present invalid JSON, unknown versions, oversize content, or canonical schema
  failures stop with `invalid_manifest`; they never fall back.
- `project_sources` links the immutable source to at most one public project.
  Database indexes enforce one candidate and one draft per source revision plus
  one active draft per source. A newer revision supersedes the prior active
  draft; `published` and `superseded` are terminal.
- Scans create hidden drafts only. `/dm-update` stages one validated field via
  the same scan/draft and admin-field service; it cannot approve or publish.

## Review and publish contract

- Slack actions never publish. A GitHub-OAuth-authenticated admin chooses the
  reviewed fields and creates an `approved_for_publish` event.
- Approval persists an ordered immutable `reviewed_field_diff` array of
  `{ field, before, after }`, the exact reviewed field names, and the draft's
  `base_project_version`. Editing a draft clears the diff and invalidates the
  approval.
- First publication requires all canonical public fields. A refresh can approve
  a subset; publish applies only reviewed `after` values and leaves every
  unreviewed field untouched.
- Publish compares the current `publication_version` and every reviewed
  `before` value. Any mismatch rejects the whole request with HTTP 409 and
  writes nothing.
- The project write, one version increment, terminal draft transition, safe
  evidence linkage, source linkage, and audit event run in one SQL statement.
  Publish returns after the database commit and has no OpenAI, deploy, or
  callback hook.
- Evidence marked `private_allowed_for_draft` may be summarized in the private
  admin UI, but it is never linked to the public project, included in public
  audit provenance, cited, or offered to RAG. Only `safe_public` evidence may
  support publication.

Required public fields: `slug`, `title`, `tagline`, `area`, `year`, `summary`.
The canonical optional fields are `activity`, `details`, `metrics`, `links`, and
`media`.

## Endpoints

All admin endpoints are dynamic, return `Cache-Control: no-store`, and require
JSON for mutations.

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/admin/auth/login` | GET | Start GitHub OAuth with signed state |
| `/api/admin/auth/callback` | GET | Verify state/login and mint the admin session |
| `/api/admin/auth/logout` | POST | Clear the admin session |
| `/api/admin/drafts` | GET | List active and terminal drafts |
| `/api/admin/drafts/[id]` | GET / PATCH | Review evidence privacy and stage canonical fields |
| `/api/admin/drafts/[id]/approve` | POST | Store the exact reviewed field set and ordered diff |
| `/api/admin/drafts/[id]/publish` | POST | Run privacy/staleness gates and commit atomically |

Approval accepts optional `reviewedFields`. Omitting it reviews every changed
field for an existing project and every public field for a first publication.

## Required environment names

- `ADMIN_GITHUB_CLIENT_ID`
- `ADMIN_GITHUB_CLIENT_SECRET`
- `ADMIN_GITHUB_ALLOWED_LOGIN`
- `ADMIN_SESSION_SECRET`
- Preview overrides with `_PREVIEW` where already supported
- The database connection names documented in `src/lib/db/client.ts`
- `GITHUB_DISCOVERY_TOKEN` (preferred) or `GITHUB_TOKEN` for authenticated Slack snapshot fetches

Never commit or log their values.

## Migration and proof

`db/migrations/0004_source_identity_and_refresh_drafts.sql` must be applied
manually to the persistent preview and production Neon branches before code
that depends on it is promoted. Do not apply either migration as part of an
agent PR.

Targeted proof:

- `npm run test:db`
- `npm run test:discovery`
- `npm run test:slack`
- `npm run test:admin`
- `npm run test:proof`

The tests cover concurrent duplicate scans, repository rename, manifest failure
policy, active-draft uniqueness, exact/partial review, stale whole-publish
rejection, version increments, terminal drafts, and private-evidence exclusion.
