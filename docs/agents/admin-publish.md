# Admin review and publish foundation (AGE-731)

Minimal authenticated admin lane that turns a hidden `project_drafts` row into a
published `projects` row with an auditable `review_events` trail. API-only JSON
endpoints; polished admin UI is deferred (Claude-routed later).

## Boundary rules

- Slack approval alone can never publish. The Slack control plane only creates
  `hidden` drafts; publishing requires a GitHub-OAuth-authenticated admin to
  approve (`approved_for_publish` review event with `metadata.source =
  'admin_publish'`) and then publish with explicit provenance + privacy
  confirmations in the same deliberate request.
- Only validated public fields from `proposed_fields` reach the `projects` row.
  `private_notes`, `provenance_map` contents, evidence text, and Slack payloads
  never do.
- Publish gates, in order: draft exists → lifecycle `approved_for_publish` →
  fresh admin approval event (field edits demote and invalidate stale approvals)
  → required public fields validate → `confirmProvenance` + `confirmPrivacy`
  both `true` → non-empty `provenance_map` → no linked evidence with
  `privacy_state` `unreviewed` or `blocked` (`private_allowed_for_draft` is
  allowed: it authorizes draft usage; the evidence itself stays private).

## Endpoints

All under `/api/admin/`, `prerender = false`, `Cache-Control: no-store`, JSON.
Mutating routes require `Content-Type: application/json` (CSRF defense-in-depth
alongside `SameSite=Lax` cookies, since Astro's `checkOrigin` is globally off
for Slack webhooks).

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/admin/auth/login` | GET | Redirect to GitHub OAuth authorize with signed state cookie |
| `/api/admin/auth/callback` | GET | Verify state, exchange code, allow only `ADMIN_GITHUB_ALLOWED_LOGIN`, mint signed session cookie |
| `/api/admin/auth/logout` | POST | Clear session cookie |
| `/api/admin/drafts` | GET | List drafts for review |
| `/api/admin/drafts/[id]` | GET / PATCH | Draft detail with evidence privacy summary / edit validated public fields |
| `/api/admin/drafts/[id]/approve` | POST | Mark `approved_for_publish` (requires valid required fields) |
| `/api/admin/drafts/[id]/publish` | POST | Run publish gates, upsert `projects`, write `published` review event |

Required public fields: `slug`, `title`, `tagline`, `area`, `year`, `summary`.
Optional: `activity`, `details`, `metrics`, `links`, `media` (JSON arrays).

## Required environment (names only — never commit or log values)

| Env var | Purpose |
| --- | --- |
| `ADMIN_GITHUB_CLIENT_ID` | GitHub OAuth app client id |
| `ADMIN_GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret |
| `ADMIN_GITHUB_ALLOWED_LOGIN` | The single GitHub login allowed to act as admin (case-insensitive) |
| `ADMIN_SESSION_SECRET` | HMAC key for signed state/session cookies |
| `ADMIN_GITHUB_CLIENT_ID_PREVIEW` | Preview-only override for the GitHub OAuth app client id when `VERCEL_ENV=preview` |
| `ADMIN_GITHUB_CLIENT_SECRET_PREVIEW` | Preview-only override for the GitHub OAuth app client secret when `VERCEL_ENV=preview` |
| `ADMIN_SESSION_SECRET_PREVIEW` | Preview-only override for signed state/session cookies when `VERCEL_ENV=preview` |

Plus the existing database connection env (see `src/lib/db/client.ts`).

HITL setup (maintainer): create a GitHub OAuth app with callback URL
`<origin>/api/admin/auth/callback` for each deployed origin (production and the
preview alias if admin access from previews is wanted), then set the production
env vars in Vercel for production and either the base names or the `_PREVIEW`
override names for preview. `ADMIN_GITHUB_ALLOWED_LOGIN` is shared by both.
Routes return 503 `admin_auth_unconfigured` until env is present, so deploys
stay safe before setup. Post-AGE-803, preview deploys write to the Neon
`preview` branch; production publish proof requires the production deployment.

## Actor and audit conventions

- Actor string everywhere: `github:<lowercased-login>`.
- Every admin mutation writes a `review_events` row with
  `metadata.source = 'admin_publish'`.
- Published project id is deterministic from the draft id
  (`draft_<uuid>` → `proj_<uuid>`) so a retried publish after a partial
  failure (Neon HTTP runs without transactions) converges on the same row
  instead of dead-ending in a slug conflict.

## Tests

`npm run test:admin` — `tests/admin-auth.test.ts` (OAuth boundary, cookie
signing/tampering/expiry, wrong-login refusal) and `tests/admin-publish.test.ts`
(PGlite + real migrations; every publish gate, Slack-only drafts cannot
publish, stale-approval regression, full publish projection, republish update
path).
