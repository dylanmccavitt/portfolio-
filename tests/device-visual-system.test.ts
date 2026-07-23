import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { collectionOwnsArrowKey } from '../src/scripts/device-keyboard.ts';

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
    assert.match(home, new RegExp(`href="${route}"`));
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
  const bootstrap = await read('src/scripts/device.ts');
  for (const key of ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Escape', 'Enter']) {
    assert.match(bootstrap, new RegExp(key));
  }
  assert.match(bootstrap, /isEditableTarget/);
  assert.match(bootstrap, /data-dm-dialog/);
  assert.match(bootstrap, /window\.location\.assign/);
  assert.match(bootstrap, /event\.key === 'Enter' && activeIndex >= 0/);
  assert.match(bootstrap, /items\[activeIndex\]\?\.click\(\)/);
});

test('collection arrows leave unrelated native controls in charge', () => {
  assert.equal(collectionOwnsArrowKey(-1, true), false);
});

test('collection arrows remain available inside the collection or without native focus', () => {
  assert.equal(collectionOwnsArrowKey(0, true), true);
  assert.equal(collectionOwnsArrowKey(-1, false), true);
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

test('binding design references retain their approved hashes', async () => {
  const expected: Record<string, string> = {
    '01-home-muted-threejs.png': '92fa8bff310564a6264994382f4621428ac5add9d6a1a7afe171111f0e4103b7',
    '02-work-layout.png': '9ab440d983436c3ab09d938359e18ff5a515629975b678474a60a2b637855d69',
    '03-project-detail-layout.png': 'a8bb44e484c7f6961db7318f8d3fa31b37b3723f55c6e8259a03d49ef4f3557e',
    '04-journey-layout.png': '4760cd747760d6ceb45c3ca56e6a9924594d99f6acda7a25310f1bf08c221d43',
    '05-resume-layout.png': '62b52d2277f74e671b173b441e0227d8a58a9b2fb8c83d530b6ffa9228c88a01',
    '06-contact-layout.png': 'b336ad3a6848271873fc79768d1831cd68b7a0d8ed1b0c998d8db7423613e14e',
    '07-dm-right-sidecar-muted.png': '17eeeebb3a5167434c0d33f40e103e0a284afa09c2ca7cb46965025df7963263',
  };

  for (const [file, hash] of Object.entries(expected)) {
    const bytes = await readFile(new URL(`docs/design/contextual-guide-reset/${file}`, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, file);
  }
});

test('Canvas UI attribution and local-only source constraints are durable', async () => {
  const [license, pkg, dm, tour] = await Promise.all([
    read('docs/licenses/canvas-ui.md'),
    read('package.json'),
    read('src/layouts/DM.astro'),
    read('src/layouts/Tour.astro'),
  ]);
  assert.match(license, /Copyright \(c\) 2026 David Haz/);
  assert.match(license, /MIT \+ Commons Clause/);
  assert.match(license, /src\/scripts\/device-renderer\.ts/);
  assert.doesNotMatch(license, /src\/scripts\/device\.ts/);
  assert.match(pkg, /"three"/);
  assert.doesNotMatch(pkg, /"react"/);
  assert.doesNotMatch(dm, /fonts\.googleapis|fonts\.gstatic/);
  assert.doesNotMatch(tour, /fonts\.googleapis|fonts\.gstatic/);
});
