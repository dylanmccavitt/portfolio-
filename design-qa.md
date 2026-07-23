# Design QA — issue #307 fixer cycle 2

## Visual truth and normalization

- Source: `docs/design/contextual-guide-reset/01-home-muted-threejs.png` (1487 × 1058).
- Implementation: `/tmp/portfolio-311-cycle2-home-1440x900.jpg` (1440 × 900 CSS pixels, DPR 1).
- Normalization: source resized proportionally to 1440px wide, then center-cropped from approximately 1440 × 1025 to 1440 × 900.
- State: Home, contextual guide closed, portfolio ready.
- Full-view side-by-side evidence: `/tmp/portfolio-311-cycle2-compare-1440x900.jpg`.
- Focused-region evidence was not needed: the 2880 × 900 combined input preserves the upper screen, hinge, lower controls, bezels, labels, shadows, and typography at readable size.

The full-view comparison checks the five required fidelity surfaces:

- Fonts and typography: locally shipped IBM Plex Mono, matching uppercase hierarchy, readable optical weight, tracking, and line height.
- Spacing and layout: broader centered clamshell, tight reference crop, balanced upper/lower housings, aligned DOM screens, and side controls.
- Colors and tokens: muted gray-lilac studio surface, graphite/navy molded shell, dusty steel-blue highlights, cool gray text, and accessible focus/foreground contrast.
- Image/asset fidelity: the device is true Three.js geometry, not a screenshot or CSS illustration; the binding reference remains tracked byte-for-byte.
- Copy/content: the same identity, role, ready state, portfolio menu, controls, guide action, and simple-navigation fallback remain present.

## Comparison history

| Pass | Priority | Visible difference | Repair | Post-fix evidence |
| --- | --- | --- | --- | --- |
| Pre-review | P1 | Device was narrow, flat, dark-on-dark, weakly beveled, under-lit, and materially below the selected reference. | Rebuilt layered housings, edge bands, molded microtexture, recessed multi-layer bezels/glass, segmented hinge, detailed D-pad/buttons, status object, contact shadow, and studio key/fill/rim lighting. | `/tmp/portfolio-311-fix-home-1440x900-pass2.png` |
| Fix 2 | P2 | Device was too large in frame; lower semantic screen and hardware labels were misaligned. | Tightened camera scale, aligned lower display to the modeled aperture, shifted hardware hit areas, refined hinge thickness, typography scale, and contrast. | `/tmp/portfolio-311-fix-home-1440x900-final.png` |
| Sidecar 1 | P1 | Desktop guide still overlaid or extended beyond the reflowed route. | Reserved the exact guide column, resized the stage/canvas, and fixed the guide backdrop/panel to the right column. | `/tmp/portfolio-311-fix-sidecar-1440-pass2.png` |
| Tablet 1 | P2 | At 1024px the menu footer collided with the final action. | Re-aligned the lower screen, provided 44px menu controls, tightened rhythm, and removed the redundant compact footer. | `/tmp/portfolio-311-fix-home-1024x768-final.png` |
| Fixer cycle 2 | P2 | The desktop Home actions were only 31px tall; the mobile simple-navigation link remained fixed due selector specificity. | Made all five Home actions 44px at every viewport, retuned only the lower-screen rhythm, and restored the mobile link to its intended in-flow treatment. The Three.js geometry, camera, materials, and lighting were unchanged. | `/tmp/portfolio-311-cycle2-home-1440x900.jpg`; `/tmp/portfolio-311-cycle2-home-390x844-full.jpg` |

## Responsive and interaction evidence

| Viewport | Route/state | Result |
| --- | --- | --- |
| 1440 × 900 | Home | Pass: polished centered device, visible state-bound dither object, five 44px menu actions, high-contrast focus outline, no clipping or overflow. |
| 1440 × 900 | Work + guide | Pass: true split sidecar; route remains visible in the resized stage. |
| 1024 × 768 | Home | Pass: complete device, 44px hardware targets, no menu collision or horizontal overflow. |
| 768 × 1024 | Work | Pass: static document surface, no Three.js renderer/chunk request, 29 links, no overflow. |
| 390 × 844 | Home | Pass: static full-width document, no Three.js renderer/chunk request, no overflow. |
| 390 × 844 | Work + guide | Pass: 390px-wide bottom sheet, reachable close/input/send controls, no overflow. |

Evidence:

- `/tmp/portfolio-311-cycle2-compare-1440x900.jpg`
- `/tmp/portfolio-311-cycle2-home-390x844-full.jpg`
- `/tmp/portfolio-311-fix-sidecar-1440-pass2.png`
- `/tmp/portfolio-311-fix-home-1024x768-final.png`
- `/tmp/portfolio-311-fix-work-768x1024.png`
- `/tmp/portfolio-311-fix-home-390x844.png`
- `/tmp/portfolio-311-fix-work-guide-390x844.png`

Keyboard browser proof: a synthetic native Enter event on the focused Work top-nav Home link remained unprevented with `href="/"`, while collection Enter remained deliberately handled. The controller still ignores editable/dialog targets, Arrow selection retains focus, Escape routes back, and `/` opens the contextual guide.

Reduced-motion browser proof: fresh cycle-2 captures 500ms apart were byte-identical at SHA-256 `cbfa1989508ee50a88f3a595eed23547b1fbb8f63140ac97751facd8e1b7be68`.

No-JavaScript browser proof: Home retained the heading and semantic `/library`, `/journey`, `/resume`, and `/contact` links with the canvas hidden, the simple-navigation link in flow, and no horizontal overflow.

Mobile performance proof: at 768px and 390px, `data-webgl="mobile-static"`, the canvas was `display: none`, and the observed resource inventory contained neither `device-renderer` nor Three.js.

Console check: fresh exact-state Home and Work loads had no application errors. The deliberate WebGL-unavailable path remains covered by the focused tests and unchanged renderer failure handling.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: the studio props remain deliberately restrained; the crude faceted mug was removed rather than carried forward below the device-quality bar. Cycle 2 introduced no visual regression.

## Performance

- Desktop renderer chunk: 538,570 bytes minified / 134,808 bytes gzip.
- Breakpoint/bootstrap chunk: 2,048 bytes minified / 1,058 bytes gzip.
- One desktop-only Three.js renderer and one shared status post-process.
- Mobile/tablet static breakpoints do not fetch or initialize the renderer.
- DPR remains capped at 1.75.
- Rendering pauses when hidden/off-screen; all targets, textures, materials, geometry, observers, and the renderer are disposed on teardown.
- No remote model, texture, decoder, font, or runtime CDN dependency.

final result: passed
