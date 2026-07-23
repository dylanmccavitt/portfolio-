# Design QA — issue #307

## Visual truth

- Binding references: `docs/design/contextual-guide-reset/01-home-muted-threejs.png` through `07-dm-right-sidecar-muted.png`.
- Reference role: factual design targets, not production screenshots.
- Browser: Codex in-app browser only.
- Local preview: Astro development server at `http://127.0.0.1:4321`.
- Comparison state: default published/offline project content, guide closed except for the sidecar and bottom-sheet captures.
- Desktop comparison viewport: 1440 × 900 CSS pixels, DPR 1. The 1487 × 1058 binding images were proportionally scaled to 1440px wide and center-cropped to the same 1440 × 900 comparison viewport.

The combined, side-by-side comparison inputs are:

- `/tmp/portfolio-307-qa/compare-home.png`
- `/tmp/portfolio-307-qa/compare-work.png`
- `/tmp/portfolio-307-qa/compare-project.png`
- `/tmp/portfolio-307-qa/compare-journey.png`
- `/tmp/portfolio-307-qa/compare-resume.png`
- `/tmp/portfolio-307-qa/compare-contact.png`
- `/tmp/portfolio-307-qa/compare-sidecar.png`

## Comparison history

| Pass | Visible difference | Change | Result |
| --- | --- | --- | --- |
| Home 1 | Semantic screens did not align with the rendered housing. | Repositioned both DOM screens against the Three.js geometry. | Corrected. |
| Home 2 | Hardware occupied materially less of the desktop viewport than the binding reference. | Tightened the orthographic frustum and enlarged the semantic device footprint. | Corrected; centered device now occupies the intended visual field. |
| Home 3 | Enlarged DOM screens exceeded their physical display apertures. | Measured and reduced the hero/menu rectangles to the rendered screen bounds. | Corrected. |
| Work 1 | The project list grew the hardware surface instead of scrolling inside it. | Fixed the route display height and retained an inner scroll surface. | Corrected. |
| Guide 1 | The 390px guide sheet was narrower than the viewport and the desktop overlay blurred the underlying content. | Bound the mobile dialog to `100vw` at the bottom edge and made the desktop sidecar a fixed, unblurred column. | Corrected. |
| Touch 1 | Mobile filter links were 34px high. | Raised filter targets to a measured 44px minimum. | Corrected. |

## Responsive matrix

| Viewport | Route/state | Result |
| --- | --- | --- |
| 1440 × 900 | Home, Work, project detail, Journey, Resume, Contact, guide sidecar | Pass: centered overhead hardware, thin route frame, no horizontal overflow. |
| 1024 × 768 | Work | Pass: readable zoomed route surface, 44px controls, no horizontal overflow. |
| 768 × 1024 | Work | Pass: canvas removed at the breakpoint; full-width semantic document surface. |
| 390 × 844 | Home, Work, guide open | Pass: full-width document surfaces and 390px-wide bottom sheet; no horizontal overflow. |

Final captures:

- `/tmp/portfolio-307-qa/home-1440x900-final.png`
- `/tmp/portfolio-307-qa/work-1024x768-final.png`
- `/tmp/portfolio-307-qa/work-768x1024-final.png`
- `/tmp/portfolio-307-qa/home-390x844-final.png`
- `/tmp/portfolio-307-qa/work-390x844-final.png`
- `/tmp/portfolio-307-qa/work-guide-390x844-final.png`

## Interaction and degraded-mode proof

- Home `Work` link navigated to `/library`.
- Route `Ask DM` opened the existing contextual guide. Escape closed it and restored focus to the guide trigger.
- Project, filter, Journey, Resume, Contact, mail, PDF, and external-project controls all resolve to real links or existing guide actions.
- Fresh Home and Work page loads produced zero browser console warnings or errors.
- `prefers-reduced-motion: reduce` matched in the browser; two captures 500ms apart had the same SHA-256 (`f340c961eb214375931d356d08fa382a99a964348f12a38f49dca9d3262c0939`).
- Forced WebGL context creation failure set `data-webgl="unavailable"`, hid the canvas, preserved the `Selected work` heading and 29 links, and retained a no-overflow 1280px document surface. The expected Three.js context-creation diagnostic was the only console entry in that deliberate failure run.
- JavaScript-disabled Home retained its heading and semantic links to Work, Journey, Resume, and Contact. The optional canvas and guide enhancement were not required to browse.
- Renderer lifecycle is covered by `tests/device-visual-system.test.ts`: reduced motion, off-screen/visibility pausing, one renderer, and GPU/resource disposal.

## Performance budget

- Production Device/Three.js client chunk: 535,401 bytes minified, 133,789 bytes gzip.
- Renderer count: one shared `WebGLRenderer`.
- Network assets: no remote models, textures, decoders, fonts, or runtime CDN dependencies.
- Effects: one display-local VHS material and one small dither render target/post-process object in the shared renderer.
- Runtime caps: DPR limited to 1.75; motion disabled for reduced-motion users; rendering skipped off-screen and while the document is hidden; resources disposed on `pagehide`.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: none.

Final result: **passed**
