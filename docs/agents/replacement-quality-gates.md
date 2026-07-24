# Replacement portfolio quality gates

These provider-free gates replace the retired model-race release vetoes. They
verify the route-aware contextual guide and muted Three.js portfolio without
calling a paid service or recording conversational content.

## Authority and exact-head identity

Run the complete repository checks with Node 24, then inspect the local build in
the user’s in-app browser. Record the exact Git head before capture. Every
capture and the resulting JSON artifact belongs to that head only; any code,
test, reference, or documentation change invalidates the artifact.

Deployment, preview promotion, production mutation, and paid evaluation remain
fresh authority gates. This procedure does not authorize them.

## Provider-free checks

```sh
npm run test:dm
npm run test:visual
npm run test:quality
```

The DM tests cover route-context validation, same-route history, reset and
cancellation rollback, server-derived action destinations, and public-source
isolation. The visual tests cover keyboard ownership, reduced-motion hooks,
WebGL failure handling, responsive/static surfaces, and the binding reference
hashes. Optional action quality is diagnostic: an absent follow-up action never
fails release by itself.

## Browser proof matrix

Use only local catalog-development data and a local fixture interception for the
DM stream. Do not configure credentials. Do not record request bodies, visitor
text, streamed fixture data, or network payloads in the proof.

| Surface | Required proof |
| --- | --- |
| Desktop, 1440 × 900 | Home navigation; expanded Work; guide open/close; keyboard focus; fixture streaming, cancellation, failure recovery, and route-context isolation; Contact behavior; all core routes |
| Small tablet, 768 × 1024 | Static document surface, navigation and guide controls, no horizontal overflow |
| Mobile, 390 × 844 | Full-width document and bottom sheet, touch-size controls, form usefulness, no horizontal overflow |
| WebGL unavailable | Semantic content and routes remain usable after renderer failure |
| Reduced motion | No pointer or time-based visual movement; content and controls remain usable |
| JavaScript disabled | Home, Work, Journey, Resume, Contact, and project navigation remain useful |

The core routes are `/`, `/library`, one `/projects/<slug>`, `/journey`,
`/resume`, and `/contact`. The contextual guide is optional and must not block
any of them.

## Exact-head visual comparison

Compare same-viewport implementation captures against these byte-bound
references:

| Gate | Reference | SHA-256 |
| --- | --- | --- |
| Muted home | `docs/design/contextual-guide-reset/01-home-muted-threejs.png` | `92fa8bff310564a6264994382f4621428ac5add9d6a1a7afe171111f0e4103b7` |
| Expanded Work | `docs/design/contextual-guide-reset/02-work-layout.png` | `9ab440d983436c3ab09d938359e18ff5a515629975b678474a60a2b637855d69` |
| Selected DM right sidecar | `docs/design/contextual-guide-reset/07-dm-right-sidecar-muted.png` | `17eeeebb3a5167434c0d33f40e103e0a284afa09c2ca7cb46965025df7963263` |

Review typography, layout, palette, geometry, and copy for each gate. Record
visible differences as P0–P3. Any unresolved P0, P1, or P2 difference fails the
artifact. P3 observations may remain diagnostic. The comparison must be
performed independently from the package builder and persisted in
`proof/replacement-quality-visual-review.json`.

## Sanitized artifact schema

The artifact is a local JSON file with this required top-level shape:

```json
{
  "schemaVersion": 1,
  "issue": 308,
  "repository": "dylanmccavitt/portfolio-",
  "baseSha": "<40 lowercase hex>",
  "headSha": "<40 lowercase hex>",
  "createdAt": "<ISO timestamp>",
  "executionMode": "local-fixture",
  "viewports": [],
  "interactionChecks": [],
  "fallbackChecks": [],
  "visualComparisons": [],
  "diagnostics": []
}
```

The executable schema is
[`scripts/replacement-quality-proof.ts`](../../scripts/replacement-quality-proof.ts).
It requires all three viewport records, all interaction and fallback IDs, the
three bound visual comparisons, SHA-256-matching image files, exact viewport
dimensions, and the live Git head plus reviewed base. The runtime schema is
closed at every object level: undeclared fields fail validation. Capture paths
are relative to the artifact, every path component must be a regular
non-symlink entry under the real artifact directory, and every capture must
decode as a PNG. Viewport captures must be exactly 1440 × 900, 768 × 1024, and
390 × 844; each visual-comparison capture must be exactly 1440 × 900.

The schema rejects URLs, credential-like values, and fields named for provider
data, model data, prompts, payloads, credentials, authorization, cookies,
secrets, or tokens. Store no private URLs, personal visitor input, network
captures, or service responses. Free-form browser notes are not part of the
schema. Visual observations are limited to a P3 priority, one reviewed
dimension, and the `minor-drift` code; any P0–P2 observation must fail the gate
outside the artifact rather than be serialized as a passing record.

The visual-review input is a closed, sanitized object that names the independent
reviewer task, the reviewed source commit, the exact reference/capture set
digest, and a pass disposition with enumerated evidence for all five dimensions
of every comparison. Its final binding commit may change only that input file.
The package builder rejects missing, stale, self-generated, mismatched, or
materially failing review input. The CI package records the input file and its
SHA-256 so another reviewer can inspect the judgment separately from the
generated proof.

Validate the completed artifact from the exact candidate head:

```sh
npm run proof:quality -- \
  /absolute/path/to/replacement-quality-proof.json \
  <reviewed-base-sha>
```

Success prints only the exact head and artifact SHA-256. Persist that compact
result with the issue’s implementation proof; do not paste browser or stream
content into GitHub.

## Reviewer-accessible CI package

The committed files under `proof/replacement-quality-inputs/` are sanitized,
provider-free browser captures only. They contain no request payloads, private
visitor content, provider output, credentials, or private URLs. On every pull
request head, CI runs:

```sh
npm run package:quality -- \
  "$GITHUB_SHA" \
  "<pull-request-base-sha>" \
  "$RUNNER_TEMP/replacement-quality-proof" \
  "proof/replacement-quality-visual-review.json"
```

The package builder verifies that the checked-out head is a one-file review
binding commit whose parent is the reviewed source commit, copies the committed
captures and independent review input, injects the workflow’s exact head and
base SHAs, computes every hash, writes the strict JSON artifact, and validates
the completed package before upload. CI uploads it as
`replacement-quality-proof-<full-head-sha>` for 90 days. The managed issue proof
must link the exact successful Actions run and artifact download, record the
artifact name, expiration, and JSON SHA-256 printed by the builder, and be
refreshed after every head change. A local-only hash without that inspectable
package is not sufficient review evidence.
