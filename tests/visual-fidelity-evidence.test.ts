import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {
  CAPTURE_SPECS,
  FALLBACK_IDS,
  REGRESSION_SPECS,
  finalizeEvidence,
  measureCanvasContribution,
  measureCoarseNormalizedDistance,
  measureCoarseStructuralFeatures,
  measureHighFrequencyRetention,
  measureSpatialAnchorSimilarity,
  validateVisualFidelityEvidence,
  type VisualFidelityCapture,
  type VisualFidelityEvidence,
} from '../scripts/visual-fidelity-evidence';

const repository = 'example/portfolio';
const baseSha = 'a'.repeat(40);
const headSha = 'b'.repeat(40);

test('closed evidence validates pass and machine-derived fail artifacts', async (t) => {
  const fixture = await createFixture(t);
  assert.deepEqual(await validate(fixture.evidence, fixture.artifactPath), []);
  assert.equal(fixture.evidence.result, 'pass');

  const captures = structuredClone(fixture.evidence.captures);
  const tablet = captures.find((capture) => capture.id === 'tablet-library')!;
  tablet.metrics.scrollWidth += 24;
  tablet.metrics.horizontalOverflow = 24;
  const failed = finalizeEvidence({
    ...fixture.evidence,
    captures,
    fallbacks: fixture.evidence.fallbacks,
  });
  assert.equal(failed.result, 'fail');
  assert.deepEqual(failed.findings, [{
    code: 'horizontal-overflow',
    captureId: 'tablet-library',
    fallbackId: null,
  }]);
  assert.deepEqual(await validate(failed, fixture.artifactPath), []);
});

test('stale exact-head and exact-base bindings are rejected', async (t) => {
  const fixture = await createFixture(t);
  const stale = structuredClone(fixture.evidence);
  stale.headSha = 'c'.repeat(40);
  stale.baseSha = 'd'.repeat(40);
  const errors = await validate(stale, fixture.artifactPath);
  assert.ok(errors.includes('headSha does not match the exact current head'));
  assert.ok(errors.includes('baseSha does not match the exact expected base'));
});

test('a blank canvas contribution produces a closed material failure', async (t) => {
  const fixture = await createFixture(t);
  const bytes = await readFile(join(fixture.directory, 'captures', 'desktop-home.png'));
  const contribution = await measureCanvasContribution(bytes, bytes);
  assert.deepEqual(contribution, { changedPixels: 0, changedRatio: 0 });
  const captures = structuredClone(fixture.evidence.captures);
  const desktop = captures.find((capture) => capture.id === 'desktop-home')!;
  desktop.metrics.canvasChangedPixels = contribution.changedPixels;
  desktop.metrics.canvasChangedRatio = contribution.changedRatio;
  const failed = finalizeEvidence({
    ...fixture.evidence,
    captures,
    fallbacks: fixture.evidence.fallbacks,
  });
  assert.equal(failed.result, 'fail');
  assert.ok(failed.findings.some((finding) => finding.code === 'canvas-contribution-missing'));
  assert.deepEqual(await validate(failed, fixture.artifactPath), []);
});

test('a hidden guide in the dedicated guide capture fails', async (t) => {
  const fixture = await createFixture(t);
  const captures = structuredClone(fixture.evidence.captures);
  const guide = captures.find((capture) => capture.id === 'desktop-guide')!;
  guide.semantics.guide = 'hidden';
  const failed = finalizeEvidence({
    ...fixture.evidence,
    captures,
    fallbacks: fixture.evidence.fallbacks,
  });
  assert.ok(failed.findings.some((finding) => finding.code === 'guide-state-mismatch'));
  assert.deepEqual(await validate(failed, fixture.artifactPath), []);
});

test('a nonempty wrong-palette desktop rendering fails the coarse regression gate', async (t) => {
  const fixture = await createFixture(t);
  const wrong = await sharp({
    create: {
      width: 1440,
      height: 900,
      channels: 3,
      background: '#ff00ff',
    },
  }).png().toBuffer();
  const capturePath = join(fixture.directory, 'captures', 'desktop-home.png');
  await writeFile(capturePath, wrong);
  const captures = structuredClone(fixture.evidence.captures);
  const home = captures.find((capture) => capture.id === 'desktop-home')!;
  home.image.sha256 = createHash('sha256').update(wrong).digest('hex');
  home.regression!.normalizedDistance = await measureCoarseNormalizedDistance(
    wrong,
    await readFile(join(fixture.directory, home.regression!.baseline.path)),
  );
  Object.assign(home.regression!, await measureCoarseStructuralFeatures(wrong));
  home.regression!.spatialSimilarity = await measureSpatialAnchorSimilarity(
    wrong,
    await readFile(join(fixture.directory, home.regression!.baseline.path)),
    REGRESSION_SPECS['desktop-home'].currentEdgeAnchor,
  );
  home.regression!.highFrequencyRetention = await measureHighFrequencyRetention(
    wrong,
    await readFile(join(fixture.directory, home.regression!.baseline.path)),
  );
  const failed = finalizeEvidence({
    ...fixture.evidence,
    captures,
    fallbacks: fixture.evidence.fallbacks,
  });
  assert.ok(home.regression!.normalizedDistance > home.regression!.maxDistance);
  assert.ok(failed.findings.some((finding) => finding.code === 'coarse-regression-mismatch'));
  assert.deepEqual(await validate(failed, fixture.artifactPath), []);
});

test('solid median library and black guide substitutions fail structural features', async (t) => {
  for (const [id, background] of [
    ['desktop-library', '#0b151e'],
    ['desktop-guide', '#000000'],
  ] as const) {
    const fixture = await createFixture(t);
    const failed = await injectSolidRendering(fixture, id, background);
    const capture = failed.captures.find((candidate) => candidate.id === id)!;
    assert.ok(
      capture.regression!.normalizedDistance <= capture.regression!.maxDistance,
      `${id} should demonstrate why MAE alone is insufficient`,
    );
    assert.equal(capture.regression!.luminanceVariance, 0);
    assert.equal(capture.regression!.colorVariance, 0);
    assert.equal(capture.regression!.edgeDensity, 0);
    assert.ok(failed.findings.some((finding) =>
      finding.code === 'coarse-regression-mismatch' && finding.captureId === id));
    assert.deepEqual(await validate(failed, fixture.artifactPath), []);
  }
});

test('mirror, vertical flip, and 180 rotation fail every bound spatial gate', async (t) => {
  for (const id of Object.keys(REGRESSION_SPECS) as Array<keyof typeof REGRESSION_SPECS>) {
    const fixture = await createFixture(t);
    const original = await readFile(join(fixture.directory, 'captures', `${id}.png`));
    const variants = {
      mirror: await sharp(original).flop().png().toBuffer(),
      'vertical-flip': await sharp(original).flip().png().toBuffer(),
      'rotate-180': await sharp(original).rotate(180).png().toBuffer(),
    };
    for (const [variant, bytes] of Object.entries(variants)) {
      const failed = await injectImageRendering(fixture, id, bytes);
      const capture = failed.captures.find((candidate) => candidate.id === id)!;
      assert.ok(
        capture.regression!.spatialSimilarity < capture.regression!.minSpatialSimilarity,
        `${id} ${variant} must fall below its spatial similarity floor`,
      );
      assert.ok(failed.findings.some((finding) =>
        finding.code === 'coarse-regression-mismatch' && finding.captureId === id));
      assert.deepEqual(await validate(failed, fixture.artifactPath), []);
    }
  }
});

test('20px Gaussian blur fails every bound high-frequency retention gate', async (t) => {
  for (const id of Object.keys(REGRESSION_SPECS) as Array<keyof typeof REGRESSION_SPECS>) {
    const fixture = await createFixture(t);
    const original = await readFile(join(fixture.directory, 'captures', `${id}.png`));
    const blurred = await sharp(original).blur(20).png().toBuffer();
    const failed = await injectImageRendering(fixture, id, blurred);
    const capture = failed.captures.find((candidate) => candidate.id === id)!;
    assert.ok(
      capture.regression!.highFrequencyRetention
        < capture.regression!.minHighFrequencyRetention,
      `${id} 20px blur must fall below its high-frequency retention floor`,
    );
    assert.ok(failed.findings.some((finding) =>
      finding.code === 'coarse-regression-mismatch' && finding.captureId === id));
    assert.deepEqual(await validate(failed, fixture.artifactPath), []);
  }
});

test('guide readiness and fallback setup misses serialize as closed fail evidence', async (t) => {
  const fixture = await createFixture(t);
  const captures = structuredClone(fixture.evidence.captures);
  const guide = captures.find((capture) => capture.id === 'desktop-guide')!;
  guide.setup.readiness = 'fail';
  guide.setup.interaction = 'fail';
  guide.semantics.guide = 'hidden';
  const fallbacks = structuredClone(fixture.evidence.fallbacks);
  fallbacks[0] = { ...fallbacks[0]!, setup: 'fail', result: 'fail' };
  const failed = finalizeEvidence({ ...fixture.evidence, captures, fallbacks });
  assert.equal(failed.result, 'fail');
  assert.ok(failed.findings.some((finding) => finding.code === 'capture-setup-failed'));
  assert.ok(failed.findings.some((finding) => finding.code === 'guide-state-mismatch'));
  assert.ok(failed.findings.some((finding) => finding.code === 'fallback-failed'));
  assert.deepEqual(await validate(failed, fixture.artifactPath), []);
});

test('unknown fields, malformed PNGs, and mismatched hashes fail validation', async (t) => {
  const fixture = await createFixture(t);
  const malformed = structuredClone(fixture.evidence) as VisualFidelityEvidence & Record<string, unknown>;
  malformed.providerPayload = 'blocked';
  Object.assign(malformed.captures[0]!, { extra: true });
  const bytes = Buffer.from('not a png');
  await writeFile(join(fixture.directory, 'captures', 'desktop-home.png'), bytes);
  malformed.captures[0]!.image.sha256 = createHash('sha256').update(bytes).digest('hex');
  const errors = await validate(malformed, fixture.artifactPath);
  assert.ok(errors.some((error) => error.includes('$.providerPayload is not allowed')));
  assert.ok(errors.some((error) => error.includes('prohibited data field')));
  assert.ok(errors.some((error) => error.includes('$.captures[0].extra is not allowed')));
  assert.ok(errors.some((error) => error.includes('desktop-home.image must be a readable PNG')));
});

test('production hidden-document pause policy remains source-bound and automation-only', async () => {
  const renderer = await readFile(
    new URL('../src/scripts/device-renderer.ts', import.meta.url),
    'utf8',
  );
  const harness = await readFile(
    new URL('../scripts/capture-visual-fidelity.ts', import.meta.url),
    'utf8',
  );
  assert.match(renderer, /let visible = !document\.hidden/);
  assert.match(renderer, /visible = !document\.hidden/);
  assert.match(renderer, /document\.addEventListener\('visibilitychange', onVisibility\)/);
  assert.match(renderer, /if \(!visible \|\| !inView \|\| disposed\) return/);
  assert.doesNotMatch(renderer, /visibilitySpoof|Object\.defineProperty\(Document\.prototype/);
  assert.match(harness, /Object\.defineProperty\(Document\.prototype, 'hidden'/);
  assert.match(harness, /document\.dispatchEvent\(new Event\('visibilitychange'\)\)/);
  assert.match(harness, /firstFrame = await page\.screenshot/);
  assert.match(harness, /page\.waitForTimeout\(250\)/);
  assert.match(harness, /frameDistance <= MAX_REDUCED_MOTION_DISTANCE/);
});

test('guide capture retries opening until visible within a bounded deadline', async () => {
  const harness = await readFile(
    new URL('../scripts/capture-visual-fidelity.ts', import.meta.url),
    'utf8',
  );
  assert.match(harness, /document\.querySelector<HTMLElement>\('\[data-dm-open\]'\)\?\.click\(\)/);
  assert.match(harness, /\{ polling: 100, timeout: 10_000 \}/);
});

async function createFixture(t: test.TestContext): Promise<{
  directory: string;
  artifactPath: string;
  evidence: VisualFidelityEvidence;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'visual-fidelity-evidence-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const capturesDirectory = join(directory, 'captures');
  const baselinesDirectory = join(directory, 'baselines');
  await Promise.all([
    mkdir(capturesDirectory),
    mkdir(baselinesDirectory),
  ]);
  for (const regression of Object.values(REGRESSION_SPECS)) {
    const bytes = await readFile(new URL(`../${regression.sourcePath}`, import.meta.url));
    await writeFile(join(directory, regression.artifactPath), bytes);
  }
  const captures: VisualFidelityCapture[] = [];
  for (const [id, spec] of Object.entries(CAPTURE_SPECS)) {
    const regression = REGRESSION_SPECS[id as keyof typeof REGRESSION_SPECS];
    const bytes = regression
      ? await readFile(join(directory, regression.artifactPath))
      : await sharp({
          create: {
            width: spec.width,
            height: spec.height,
            channels: 3,
            background: '#071321',
          },
        }).png().toBuffer();
    await writeFile(join(capturesDirectory, `${id}.png`), bytes);
    const pixelCount = spec.width * spec.height;
    const canvasChangedPixels = id === 'desktop-home' ? Math.ceil(pixelCount * 0.1) : null;
    const structuralFeatures = regression
      ? await measureCoarseStructuralFeatures(bytes)
      : null;
    const spatialSimilarity = regression
      ? await measureSpatialAnchorSimilarity(
          bytes,
          await readFile(join(directory, regression.artifactPath)),
          regression.currentEdgeAnchor,
        )
      : null;
    const highFrequencyRetention = regression
      ? await measureHighFrequencyRetention(
          bytes,
          await readFile(join(directory, regression.artifactPath)),
        )
      : null;
    captures.push({
      id: id as keyof typeof CAPTURE_SPECS,
      route: spec.route,
      viewport: { width: spec.width, height: spec.height },
      image: {
        path: `captures/${id}.png`,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        width: spec.width,
        height: spec.height,
      },
      metrics: {
        innerWidth: spec.width,
        innerHeight: spec.height,
        scrollWidth: spec.width,
        horizontalOverflow: 0,
        documentHidden: false,
        visibilityEventDispatched: id.startsWith('desktop-'),
        canvasChangedPixels,
        canvasChangedRatio: canvasChangedPixels === null
          ? null
          : Math.round((canvasChangedPixels / pixelCount) * 1_000_000) / 1_000_000,
      },
      semantics: {
        main: true,
        navigation: true,
        heading: true,
        guide: spec.guide,
      },
      setup: {
        navigation: 'pass',
        readiness: 'pass',
        interaction: id === 'desktop-guide' ? 'pass' : 'not-required',
      },
      regression: regression
        ? {
            baseline: {
              path: regression.artifactPath,
              sha256: regression.sha256,
              width: 1440,
              height: 900,
            },
            normalizedDistance: 0,
            maxDistance: regression.maxDistance,
            ...structuralFeatures!,
            minLuminanceVariance: regression.minLuminanceVariance,
            minColorVariance: regression.minColorVariance,
            minEdgeDensity: regression.minEdgeDensity,
            spatialSimilarity: spatialSimilarity!,
            minSpatialSimilarity: regression.minSpatialSimilarity,
            highFrequencyRetention: highFrequencyRetention!,
            minHighFrequencyRetention: regression.minHighFrequencyRetention,
            result: 'pass',
          }
        : null,
      renderMode: spec.renderMode,
      visibilitySpoofed: id.startsWith('desktop-'),
      result: 'pass',
    });
  }
  const evidence = finalizeEvidence({
    schemaVersion: 1,
    repository,
    baseSha,
    headSha,
    createdAt: '2026-07-25T17:00:00.000Z',
    captures,
    fallbacks: FALLBACK_IDS.map((id) => ({
      id,
      setup: 'pass' as const,
      result: 'pass' as const,
    })),
  });
  const artifactPath = join(directory, 'visual-fidelity-evidence.json');
  await writeFile(artifactPath, `${JSON.stringify(evidence, null, 2)}\n`);
  return { directory, artifactPath, evidence };
}

async function injectSolidRendering(
  fixture: {
    directory: string;
    artifactPath: string;
    evidence: VisualFidelityEvidence;
  },
  id: keyof typeof REGRESSION_SPECS,
  background: string,
): Promise<VisualFidelityEvidence> {
  const wrong = await sharp({
    create: {
      width: 1440,
      height: 900,
      channels: 3,
      background,
    },
  }).png().toBuffer();
  return injectImageRendering(fixture, id, wrong);
}

async function injectImageRendering(
  fixture: {
    directory: string;
    artifactPath: string;
    evidence: VisualFidelityEvidence;
  },
  id: keyof typeof REGRESSION_SPECS,
  wrong: Buffer,
): Promise<VisualFidelityEvidence> {
  await writeFile(join(fixture.directory, 'captures', `${id}.png`), wrong);
  const captures = structuredClone(fixture.evidence.captures);
  const capture = captures.find((candidate) => candidate.id === id)!;
  capture.image.sha256 = createHash('sha256').update(wrong).digest('hex');
  const baselineBytes = await readFile(join(fixture.directory, capture.regression!.baseline.path));
  capture.regression!.normalizedDistance = await measureCoarseNormalizedDistance(
    wrong,
    baselineBytes,
  );
  Object.assign(capture.regression!, await measureCoarseStructuralFeatures(wrong));
  capture.regression!.spatialSimilarity = await measureSpatialAnchorSimilarity(
    wrong,
    baselineBytes,
    REGRESSION_SPECS[id].currentEdgeAnchor,
  );
  capture.regression!.highFrequencyRetention = await measureHighFrequencyRetention(
    wrong,
    baselineBytes,
  );
  return finalizeEvidence({
    ...fixture.evidence,
    captures,
    fallbacks: fixture.evidence.fallbacks,
  });
}

function validate(value: unknown, artifactPath: string): Promise<string[]> {
  return validateVisualFidelityEvidence(value, {
    artifactPath,
    expectedRepository: repository,
    expectedBaseSha: baseSha,
    expectedHeadSha: headSha,
  });
}
