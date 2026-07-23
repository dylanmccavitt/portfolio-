# Contextual Guide Reset — Binding Design Plan

Selected July 22, 2026. These images are the production visual references for the replacement portfolio program.

## Binding decisions

- The homepage is a centered, directly overhead dual-screen handheld rendered as real-time Three.js geometry. It must not be implemented as a flattened screenshot.
- The device uses matte molded-plastic materials, beveled housings, a working hinge seam, recessed glass screens, restrained scanlines, soft contact shadows, and subtle pointer/parallax response.
- The production palette is the muted palette in `01-home-muted-threejs.png` and `07-dm-right-sidecar-muted.png`: graphite blue hardware, charcoal navy screens, dusty steel-blue focus, cool gray-white type, and a low-saturation gray-lilac environment.
- The brighter blue in layout references `02` through `06` is superseded by the muted production palette. Their information hierarchy, spacing, button placement, and route structure remain binding.
- Home keeps the complete device in view. Route navigation zooms into the active display so the screen fills most of the viewport and the hardware becomes a thin frame.
- DM opens as the right-side contextual sidecar shown in `07-dm-right-sidecar-muted.png`. It uses direct prose, public source labels, server-derived actions, and one composer. It does not use chat bubbles, avatars, model names, or invented destinations.
- Controls are purposeful: filled primary action, bordered secondary action, plain text navigation/back action. The homepage directional pad, OPEN, and BACK controls map to the same keyboard-accessible routes.
- No project screenshots appear on the homepage or library surface.

## Responsive behavior

- Desktop and large tablet: Three.js device remains centered and overhead. Home shows the full device. Expanded routes preserve a thin 3D bezel around the DOM content surface.
- Small tablet: reduce desk margin and decorative props before reducing readable UI scale.
- Mobile: content remains fully usable without Three.js. The active screen becomes the primary full-width document; hardware reduces to a restrained frame treatment. DM becomes a full-width bottom sheet, not a narrow sidecar. All navigation, route content, forms, and guide actions remain keyboard and touch accessible.
- Reduced motion or unsupported WebGL: use a static CSS surface with identical routes and actions. Three.js is enhancement, never a content dependency.

## Reference files and SHA-256

- `01-home-muted-threejs.png` — `92fa8bff310564a6264994382f4621428ac5add9d6a1a7afe171111f0e4103b7`
- `02-work-layout.png` — `9ab440d983436c3ab09d938359e18ff5a515629975b678474a60a2b637855d69`
- `03-project-detail-layout.png` — `a8bb44e484c7f6961db7318f8d3fa31b37b3723f55c6e8259a03d49ef4f3557e`
- `04-journey-layout.png` — `4760cd747760d6ceb45c3ca56e6a9924594d99f6acda7a25310f1bf08c221d43`
- `05-resume-layout.png` — `62b52d2277f74e671b173b441e0227d8a58a9b2fb8c83d530b6ffa9228c88a01`
- `06-contact-layout.png` — `b336ad3a6848271873fc79768d1831cd68b7a0d8ed1b0c998d8db7423613e14e`
- `07-dm-right-sidecar-muted.png` — `17eeeebb3a5167434c0d33f40e103e0a284afa09c2ca7cb46965025df7963263`

## Implementation gates

- Match the desktop references through same-viewport visual comparison.
- Verify mobile at 390 px and small tablet at 768 px.
- Preserve zero-JavaScript route usefulness and a non-WebGL fallback.
- Verify navigation, DM open/close, streaming, cancellation, recovery, keyboard focus, and route-context reset.
- No deployment or production promotion without fresh authorization.
