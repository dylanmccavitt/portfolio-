import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { collectionOwnsArrowKey, nextCollectionIndex } from '../src/scripts/device-keyboard.ts';
import {
  frameDelta,
  frameSmoothingAlpha,
  MAX_FRAME_DELTA,
  POINTER_SETTLE_PER_FRAME,
  POINTER_TILT_X,
  POINTER_TILT_Z,
  REFERENCE_FRAME_RATE,
} from '../src/scripts/device-frame.ts';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFile(new URL(path, root), 'utf8');

test('home uses semantic routes over one progressive Three.js renderer', async () => {
  const [home, bootstrap, device, layout] = await Promise.all([
    read('src/pages/index.astro'),
    read('src/scripts/device.ts'),
    read('src/scripts/device-renderer.ts'),
    read('src/layouts/Device.astro'),
  ]);

  for (const route of ['/library', '/journey', '/resume', '/contact']) {
    assert.match(home, new RegExp(`['"]${route}['"]`));
  }
  assert.match(device, /new THREE\.WebGLRenderer/);
  assert.equal((device.match(/new THREE\.WebGLRenderer/g) ?? []).length, 1);
  assert.match(device, /RoundedBoxGeometry/);
  assert.match(device, /OrthographicCamera/);
  assert.match(device, /IcosahedronGeometry/);
  assert.match(device, /THRESHOLDS/);
  assert.match(device, /createVhsGlassMaterial/);
  assert.doesNotMatch(device, /GLTFLoader|DRACOLoader|https?:\/\//);
  assert.match(layout, /data-device-canvas/);
  assert.match(bootstrap, /min-width: 769px/);
  assert.match(bootstrap, /import\('\.\/device-renderer'\)/);
  assert.doesNotMatch(bootstrap, /from 'three'|WebGLRenderer|WebGLRenderTarget/);
});

test('pointer parallax amplitudes stay sub-pixel', () => {
  // Imported directly rather than text-matched: the overlay projection is only
  // valid while the chassis tilt is small enough to stay under a pixel.
  assert.equal(POINTER_TILT_Z, 0.009);
  assert.equal(POINTER_TILT_X, 0.006);
  assert.ok(POINTER_TILT_Z < 0.02 && POINTER_TILT_X < 0.02);
});

test('frame smoothing converges identically at 60Hz and 120Hz', () => {
  // The one genuinely behavioural assertion available here: drive the pure
  // smoothing helper with synthetic frame sequences and compare the settle in
  // wall-clock terms, not in frames.
  const settleTowardsOne = (hz: number, seconds: number): number => {
    const dt = 1 / hz;
    let value = 0;
    for (let frame = 0; frame < Math.round(hz * seconds); frame += 1) {
      value += (1 - value) * frameSmoothingAlpha(POINTER_SETTLE_PER_FRAME, dt);
    }
    return value;
  };

  for (const seconds of [0.25, 0.5, 1, 2]) {
    const at60 = settleTowardsOne(60, seconds);
    const at120 = settleTowardsOne(120, seconds);
    assert.ok(
      Math.abs(at60 - at120) < 1e-3,
      `60Hz (${at60}) and 120Hz (${at120}) must agree after ${seconds}s`,
    );
  }

  // A frame-rate dependent alpha would diverge; prove the comparison can fail.
  const naive = (hz: number, seconds: number): number => {
    let value = 0;
    for (let frame = 0; frame < Math.round(hz * seconds); frame += 1) {
      value += (1 - value) * POINTER_SETTLE_PER_FRAME;
    }
    return value;
  };
  assert.ok(Math.abs(naive(60, 1) - naive(120, 1)) > 1e-3);

  // At the reference rate the generalised alpha reproduces the tuned constant.
  assert.ok(
    Math.abs(
      frameSmoothingAlpha(POINTER_SETTLE_PER_FRAME, 1 / REFERENCE_FRAME_RATE)
        - POINTER_SETTLE_PER_FRAME,
    ) < 1e-12,
  );
  assert.equal(frameSmoothingAlpha(POINTER_SETTLE_PER_FRAME, 0), 0);
});

test('frame deltas are clamped so a resumed loop never applies one huge step', () => {
  assert.equal(frameDelta(1_000, 0), MAX_FRAME_DELTA);
  assert.equal(frameDelta(1_016, 1_000), 0.016);
  assert.equal(frameDelta(1_000, 1_000), 0);
  assert.ok(frameDelta(Number.MAX_SAFE_INTEGER, 0) <= MAX_FRAME_DELTA);
});

test('subtle pointer parallax stays wired, bounded, and reduced-motion aware', async () => {
  const device = await read('src/scripts/device-renderer.ts');
  assert.match(device, /addEventListener\('pointermove', onPointer, \{ passive: true \}\)/);
  assert.match(device, /removeEventListener\('pointermove', onPointer\)/);
  assert.match(device, /pointerCurrent\.lerp\(pointerTarget, frameSmoothingAlpha\(POINTER_SETTLE_PER_FRAME, dt\)\)/);
  assert.match(device, /world\.rotation\.z = -pointerCurrent\.x \* POINTER_TILT_Z/);
  assert.match(device, /world\.rotation\.x = pointerCurrent\.y \* POINTER_TILT_X/);
  assert.match(device, /if \(reducedMotion\.matches\) return;/);
  assert.match(device, /\} else \{\s*world\.rotation\.set\(0, 0, 0\);/);
});

test('renderer pauses and releases GPU resources', async () => {
  const device = await read('src/scripts/device-renderer.ts');
  assert.match(device, /prefers-reduced-motion/);
  assert.match(device, /IntersectionObserver/);
  assert.match(device, /visibilitychange/);
  assert.match(device, /setAnimationLoop\(null\)/);
  assert.match(device, /WebGLRenderTarget/);
  assert.match(device, /rawTarget\.dispose\(\)/);
  assert.match(device, /ditherTarget\.dispose\(\)/);
  assert.match(device, /renderer\.dispose\(\)/);
  assert.match(device, /pagehide/);
});

test('keyboard instructions are backed by real route controls', async () => {
  const [bootstrap, home] = await Promise.all([
    read('src/scripts/device.ts'),
    read('src/pages/index.astro'),
  ]);
  for (const key of ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Escape', 'Enter']) {
    assert.match(bootstrap, new RegExp(key));
  }
  assert.match(bootstrap, /isEditableTarget/);
  assert.match(bootstrap, /data-dm-dialog/);
  assert.match(bootstrap, /window\.location\.assign/);
  assert.match(bootstrap, /moveActiveSelection\(delta\)/);
  assert.match(bootstrap, /activateCurrentSelection/);
  assert.match(bootstrap, /\[data-device-direction\]/);
  assert.match(bootstrap, /\[data-device-open\]/);
  assert.doesNotMatch(home, /class="hardware-link hardware-link--(?:up|right|down|left)" href=/);
  assert.match(home, /data-device-direction="up"/);
  assert.match(home, /data-device-open/);
});

test('collection arrows leave unrelated native controls in charge', () => {
  assert.equal(collectionOwnsArrowKey(-1, true), false);
});

test('collection arrows remain available inside the collection or without native focus', () => {
  assert.equal(collectionOwnsArrowKey(0, true), true);
  assert.equal(collectionOwnsArrowKey(-1, false), true);
});

test('directional selection wraps through the active collection', () => {
  assert.equal(nextCollectionIndex(5, 0, 1), 1);
  assert.equal(nextCollectionIndex(5, 4, 1), 0);
  assert.equal(nextCollectionIndex(5, 0, -1), 4);
  assert.equal(nextCollectionIndex(0, 0, 1), -1);
});

test('dither status is visible and bound to guide state', async () => {
  const [device, layout] = await Promise.all([
    read('src/scripts/device-renderer.ts'),
    read('src/layouts/Device.astro'),
  ]);
  assert.match(device, /MutationObserver/);
  assert.match(device, /guide-open/);
  assert.match(device, /statusPlane\.renderOrder/);
  assert.match(device, /depthTest: false/);
  assert.match(layout, /data-device-status/);
  assert.match(device, /guideAvailable/);
  assert.match(device, /Device status: portfolio ready\.'/);
  assert.match(device, /screen edges never drift outside their physical openings/);
  assert.match(layout, /guideKind[\s\S]*contextual guide available/);
  assert.match(layout, /Device status: portfolio ready\.'/);
});

test('static and mobile fallbacks preserve usable document surfaces', async () => {
  const [css, home, work, project, journey, resume, contact] = await Promise.all([
    read('src/styles/device.css'),
    read('src/pages/index.astro'),
    read('src/components/LibraryView.astro'),
    read('src/pages/projects/[id].astro'),
    read('src/pages/journey.astro'),
    read('src/pages/resume.astro'),
    read('src/pages/contact.astro'),
  ]);
  assert.match(css, /html\[data-webgl='unavailable'\]/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*\.device-canvas[\s\S]*display: none/);
  assert.match(css, /min-height: 44px/);
  assert.doesNotMatch(css, /\.home-menu a \{[\s\S]*?min-height: 31px/);
  assert.match(css, /\.home-menu a \{[\s\S]*?min-height: 44px/);
  assert.match(css, /\.home-menu-guide \{[\s\S]*?min-height: 44px/);
  assert.match(css, /html:not\(\[data-webgl='available'\]\) \.hardware-link \{[\s\S]*?opacity: 0/);
  assert.match(css, /\.device-body \.home-simple-nav:focus-visible \{[\s\S]*?outline-color: #101725/);
  assert.match(
    css,
    /@media \(max-width: 768px\)[\s\S]*?\.device-body \.home-simple-nav \{[\s\S]*?position: static[\s\S]*?color: #9db0d2[\s\S]*?inset: auto/,
  );
  for (const source of [home, work, project, journey, resume, contact]) {
    assert.match(source, /<nav|<form/);
  }
  assert.match(contact, /action=\{`mailto:/);
});

test('binding Work and answered-guide states retain reference hierarchy and public content order', async () => {
  const [work, deviceCss, device, home, guide, dmCss, client] = await Promise.all([
    read('src/components/LibraryView.astro'),
    read('src/styles/device.css'),
    read('src/scripts/device-renderer.ts'),
    read('src/pages/index.astro'),
    read('src/components/ContextualGuide.astro'),
    read('src/styles/dm.css'),
    read('src/scripts/dm.ts'),
  ]);
  const order = ['bellas-beads', 'agentic-trader', 'tradingview-mcp', 'evalgate'];
  let cursor = -1;
  for (const id of order) {
    const next = work.indexOf(`'${id}'`);
    assert.ok(next > cursor, `${id} must retain selected-work reference order`);
    cursor = next;
  }
  assert.match(deviceCss, /--device-screen-inset-x: clamp\(46px, 5\.6vw, 82px\)/);
  assert.match(deviceCss, /--device-screen-inset-y: clamp\(38px, 4\.8vw, 70px\)/);
  assert.match(
    deviceCss,
    /height: calc\(100dvh - var\(--device-screen-inset-y\) - var\(--device-screen-inset-y\)\)/,
  );
  assert.match(deviceCss, /clip-path: inset\(0 round 6px\)/);
  assert.match(deviceCss, /\.device-route-screen\[data-device-route-overlay-bound\][\s\S]*?clip-path: inset\(1px round 5px\)[\s\S]*?border: 0/);
  assert.match(deviceCss, /inset 0 0 38px rgba\(4, 11, 22, 0\.72\)/);
  assert.match(
    deviceCss,
    /\.home-screen--hero \{[\s\S]*?left: 7\.2%[\s\S]*?width: 85\.6%[\s\S]*?height: 32\.55%/,
  );
  assert.match(
    deviceCss,
    /\.home-screen--menu \{[\s\S]*?left: 22\.3%[\s\S]*?width: 55\.4%[\s\S]*?height: 36\.1%/,
  );
  assert.match(deviceCss, /\.hardware-link--up \{[\s\S]*?left: 11\.6%/);
  assert.match(deviceCss, /\.hardware-link--right \{[\s\S]*?left: 19%/);
  assert.match(deviceCss, /\.hardware-link--down \{[\s\S]*?left: 11\.6%/);
  assert.match(deviceCss, /\.hardware-link--left \{[\s\S]*?left: 4\.2%/);
  assert.match(deviceCss, /\.home-device\[data-device-overlay-bound\][\s\S]*?--home-device-width/);
  assert.match(deviceCss, /\.home-title \{[\s\S]*?font-size: clamp\([^;]+cqw[\s\S]*?white-space: nowrap/);
  assert.match(device, /function projectSurface/);
  assert.match(device, /camera\.updateMatrixWorld\(\)/);
  assert.match(device, /syncHomeOverlay\(width, height\)/);
  assert.match(device, /fitHeight = stageHeight \* 0\.96/);
  assert.match(device, /--device-overlay-left/);
  assert.match(device, /syncRouteOverlay\(width, height\)/);
  assert.match(device, /const fitWidth = stageWidth \* 0\.92/);
  assert.match(device, /const fitHeight = stageHeight \* 0\.92/);
  assert.match(device, /--device-route-left/);
  assert.match(device, /const dpadLayout = \{[\s\S]*?x: -3\.15,[\s\S]*?span: 1\.16/);
  assert.match(
    device,
    /controlBox\(dpadLayout\.thickness, dpadLayout\.span, 0\.22\)[\s\S]*?dpad\.position\.set\(dpadLayout\.x/,
  );
  assert.match(device, /const actionControlLayout = \{[\s\S]*?x: 3\.15,[\s\S]*?openZ: 1\.48,[\s\S]*?backZ: 2\.72/);
  assert.match(
    device,
    /open\.position\.set\(actionControlLayout\.x[\s\S]*?back\.position\.set\(actionControlLayout\.x/,
  );
  assert.doesNotMatch(device, /dpad\.position\.set\(-2\.78/);
  assert.doesNotMatch(device, /(?:open|back)\.position\.set\(2\.78/);
  assert.doesNotMatch(device, /new THREE\.ConeGeometry\(0\.11/);
  assert.match(home, /aria-label="Move menu selection up"><\/button>/);
  assert.doesNotMatch(home, /data-device-direction="[^"]+"[^>]*href=/);
  assert.match(deviceCss, /body:has\(\.context-guide-backdrop:not\(\[hidden\]\)\) \.work-console/);
  assert.match(guide, /DM \/ Work context/);
  assert.match(guide, /Public sources only · resets on route change/);
  assert.match(dmCss, /\.context-guide \.dm-user-tag[\s\S]*letter-spacing/);
  assert.match(dmCss, /\.context-guide \.dm-chip[\s\S]*place-items: center/);
  assert.match(client, /text: 'You asked'/);
  assert.match(client, /class: 'dm-view-all'/);
});

test('binding design references retain their approved hashes', async () => {
  // The README is the single source for the pinned digests — the test parses
  // it rather than keeping a second copy that can silently drift.
  // `08-route-horizon-rail.png` is deliberately untracked and unlisted, so it
  // is not pinned here; adding it to the README is what would pin it.
  const readme = await read('docs/design/contextual-guide-reset/README.md');
  const expected = [...readme.matchAll(/^- `([\w.-]+\.png)` — `([0-9a-f]{64})`$/gm)]
    .map(([, file, hash]) => [file, hash] as const);

  assert.ok(expected.length >= 7, 'README must still list the approved reference digests');
  assert.equal(
    expected.some(([file]) => file.startsWith('08-')),
    false,
    'the untracked route-horizon reference must not be pinned',
  );

  for (const [file, hash] of expected) {
    const bytes = await readFile(new URL(`docs/design/contextual-guide-reset/${file}`, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, file);
  }
});

test('Canvas UI attribution and local-only source constraints are durable', async () => {
  const [license, pkg] = await Promise.all([
    read('docs/licenses/canvas-ui.md'),
    read('package.json'),
  ]);
  assert.match(license, /Copyright \(c\) 2026 David Haz/);
  assert.match(license, /MIT \+ Commons Clause/);
  assert.match(license, /src\/scripts\/device-renderer\.ts/);
  assert.doesNotMatch(license, /src\/scripts\/device\.ts/);
  assert.match(pkg, /"three"/);
  assert.doesNotMatch(pkg, /"react"/);
});
