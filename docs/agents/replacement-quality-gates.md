# Automated replacement-quality evidence

The replacement-quality gate is a provider-free Playwright capture run. It is
generic repository infrastructure: the evidence does not contain an issue
number, visitor text, network payload, provider output, credentials, or private
URLs.

## Run it

Use Node 24 from a clean exact-head checkout. Install the pinned Chromium once:

```sh
npx playwright install chromium
npm run capture:visual -- \
  "$(git rev-parse HEAD)" \
  "<exact-base-sha>" \
  "/absolute/output/directory" \
  "owner/repository"
```

The script starts a local Astro development server with database and AI
configuration explicitly blank, blocks non-local browser requests, and creates:

- `captures/desktop-home.png` at 1440 × 900;
- `captures/desktop-guide.png` at 1440 × 900 with the guide open;
- `captures/desktop-library.png` at 1440 × 900 for the expanded route;
- `captures/tablet-library.png` at 768 × 1024;
- `captures/mobile-contact.png` at 390 × 844;
- `visual-fidelity-evidence.json`.

The desktop run installs an automation-only `document.hidden`/visibility-state
spoof before page code and dispatches `visibilitychange` before capture. The
production renderer remains authoritative and still pauses when
`document.hidden` is genuinely true.

The normal desktop-home PNG retains the visible canvas. The runner also takes a
temporary in-memory screenshot with only that canvas hidden, decodes both PNGs,
and records how many composed-page pixels changed. At least one percent of the
viewport must change by eight or more channel levels. This deliberately loose
structural threshold proves that the Three.js canvas contributes rendered
pixels while avoiding a brittle global reference-image diff. The hidden-canvas
comparison is not retained.

The separate desktop-guide state opens `[data-dm-open]`, waits for the existing
dialog to become visible, and captures without sending a prompt or invoking a
provider.

## Transitional coarse regression baselines

Three sanitized historical proof inputs provide coarse pre-Horizon regression
evidence:

| Capture | Baseline | Maximum normalized distance |
| --- | --- | ---: |
| Desktop home | `visual-home-muted.png` | 0.08 |
| Desktop library | `visual-work-expanded.png` | 0.20 |
| Desktop guide | `visual-dm-right-sidecar.png` | 0.24 |

The runner copies these bound inputs into the artifact, decodes each current and
baseline PNG, removes alpha, downsamples to 64 × 40, and records the normalized
mean absolute RGB distance. It also records luminance variance, mean RGB-channel
variance, edge density, and a spatial edge-anchor similarity from the normalized
current capture. It additionally records high-frequency retention: the ratio of
the current capture's Laplacian variance to the bound baseline's after both are
decoded, converted to luminance, and normalized to 256 × 160. The spatial metric
compares the absolute edge-energy centroid to both the packaged pre-Horizon
baseline anchor and the accepted current exact-head anchor, preserving the two
intentionally tolerated compositions without becoming mirror/rotation
invariant. The validator recomputes all six measurements from the packaged
PNGs.

Home requires at least `0.01` luminance/color variance and `0.05` edge density;
library requires `0.012`, `0.015`, and `0.05`; guide requires `0.012`, `0.012`,
and `0.06`. Current exact-head captures retain several-fold margin above these
floors. Every bound desktop capture also requires spatial similarity of at
least `0.98`. High-frequency retention must be at least `0.40` for home, `0.50`
for library, and `0.25` for guide. Those per-capture floors retain margin below
the accepted current captures while rejecting a 20px Gaussian blur. The
deliberately tolerant distance ceilings plus low structural floors, anchored
similarity, and sharpness retention catch blank, solid median/black,
wrong-palette, full-screen-quad, mirrored, vertically flipped, rotated,
materially displaced, and heavily blurred substitutions without imposing byte
equality or a global pixel-perfect cutover.

These are transitional pre-Horizon regression baselines, not visual acceptance
and not a claim that the current renderer matches the final Horizon Rail
reference. They remain until the later live visual-acceptance gate approves and
binds replacement captures.

The same run executes reduced-motion, WebGL-unavailable, and JavaScript-disabled
fallback checks. It never sends a guide prompt or contacts a provider.
The reduced-motion fallback is behavioral: after renderer readiness under
`prefers-reduced-motion: reduce`, it captures two composed frames 250 ms apart.
Byte equality passes immediately; otherwise their decoded 64 × 40 normalized
distance must be at most `0.001`.

## Fail-capable evidence

[`scripts/visual-fidelity-evidence.ts`](../../scripts/visual-fidelity-evidence.ts)
is the closed executable schema. It binds the repository, exact base, exact
head, timestamp, five capture PNGs, three packaged baseline PNGs, SHA-256
hashes, decoded image dimensions, viewport dimensions, document overflow,
semantic main/navigation/heading presence, render mode, visibility spoof,
canvas contribution, guide visibility, and fallback results.

Both passing and failing artifacts are valid representations. Material mismatch
produces bounded findings and `result: "fail"`; the capture command then exits
non-zero. Validation rejects stale bindings, unknown fields, missing or
symlinked/escaping paths, malformed images, hash mismatches, unrecognized
findings, and URL/credential/provider-shaped data. Focused adversarial coverage
lives in `tests/visual-fidelity-evidence.test.ts`.

Navigation, renderer readiness, and guide interaction are closed setup fields.
Expected page-state misses are captured in their current state and serialize as
`result: "fail"` findings rather than aborting before JSON is written. Each
fallback also records setup separately; setup exceptions become fail records.
Only catastrophic build, browser launch, page crash, or artifact-write failures
may end without evidence JSON.

## Pull-request artifact

On a pull request, CI checks out
`github.event.pull_request.head.sha` directly, passes the exact PR base SHA,
installs the pinned Chromium, runs the capture, and uploads
`visual-fidelity-evidence-<full-head-sha>` for 30 days. The upload step runs even
after a material capture failure so reviewers can inspect any evidence that was
successfully written. Any head change requires a fresh artifact.

While this leaf is stacked, the workflow explicitly includes
`issue-328-bind-horizon-rail` as a temporary pull-request base. Remove that
single filter entry after the dependency lands and this pull request retargets
to `preview/agent-first-redesign`.

This gate is automated evidence, not visual acceptance. Merge, deployment,
promotion, and production changes remain separate authority gates.
