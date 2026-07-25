import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import sharp from 'sharp';

const GIT_SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const TOP_KEYS = [
  'schemaVersion',
  'repository',
  'baseSha',
  'headSha',
  'createdAt',
  'result',
  'captures',
  'fallbacks',
  'findings',
] as const;
const CAPTURE_KEYS = [
  'id',
  'route',
  'viewport',
  'image',
  'metrics',
  'semantics',
  'setup',
  'regression',
  'renderMode',
  'visibilitySpoofed',
  'result',
] as const;
const VIEWPORT_KEYS = ['width', 'height'] as const;
const IMAGE_KEYS = ['path', 'sha256', 'width', 'height'] as const;
const METRIC_KEYS = [
  'innerWidth',
  'innerHeight',
  'scrollWidth',
  'horizontalOverflow',
  'documentHidden',
  'visibilityEventDispatched',
  'canvasChangedPixels',
  'canvasChangedRatio',
] as const;
const SEMANTIC_KEYS = ['main', 'navigation', 'heading', 'guide'] as const;
const SETUP_KEYS = ['navigation', 'readiness', 'interaction'] as const;
const REGRESSION_KEYS = [
  'baseline',
  'normalizedDistance',
  'maxDistance',
  'luminanceVariance',
  'minLuminanceVariance',
  'colorVariance',
  'minColorVariance',
  'edgeDensity',
  'minEdgeDensity',
  'spatialSimilarity',
  'minSpatialSimilarity',
  'highFrequencyRetention',
  'minHighFrequencyRetention',
  'result',
] as const;
const FALLBACK_KEYS = ['id', 'setup', 'result'] as const;
const FINDING_KEYS = ['code', 'captureId', 'fallbackId'] as const;

export const CAPTURE_SPECS = {
  'desktop-home': {
    route: '/',
    width: 1440,
    height: 900,
    renderMode: 'webgl',
    guide: 'hidden',
  },
  'desktop-guide': {
    route: '/',
    width: 1440,
    height: 900,
    renderMode: 'webgl',
    guide: 'visible',
  },
  'desktop-library': {
    route: '/library',
    width: 1440,
    height: 900,
    renderMode: 'webgl',
    guide: 'hidden',
  },
  'tablet-library': {
    route: '/library',
    width: 768,
    height: 1024,
    renderMode: 'static-responsive',
    guide: 'hidden',
  },
  'mobile-contact': {
    route: '/contact',
    width: 390,
    height: 844,
    renderMode: 'static-responsive',
    guide: 'absent',
  },
} as const;

export const REGRESSION_SPECS = {
  'desktop-home': {
    sourcePath: 'proof/replacement-quality-inputs/visual-home-muted.png',
    artifactPath: 'baselines/visual-home-muted.png',
    sha256: '015262350bafcdcc4715a3091aafcef90fd9f9030a38c688baa42d6990a92be1',
    maxDistance: 0.08,
    minLuminanceVariance: 0.01,
    minColorVariance: 0.01,
    minEdgeDensity: 0.05,
    currentEdgeAnchor: { x: 0.532258, y: 0.530527 },
    minSpatialSimilarity: 0.98,
    minHighFrequencyRetention: 0.4,
  },
  'desktop-library': {
    sourcePath: 'proof/replacement-quality-inputs/visual-work-expanded.png',
    artifactPath: 'baselines/visual-work-expanded.png',
    sha256: '8fd82a5d661f64e60604fcb3d4685b3fe3fa13fd27645595ba219ff034dcf9c1',
    maxDistance: 0.2,
    minLuminanceVariance: 0.012,
    minColorVariance: 0.015,
    minEdgeDensity: 0.05,
    currentEdgeAnchor: { x: 0.444688, y: 0.445839 },
    minSpatialSimilarity: 0.98,
    minHighFrequencyRetention: 0.5,
  },
  'desktop-guide': {
    sourcePath: 'proof/replacement-quality-inputs/visual-dm-right-sidecar.png',
    artifactPath: 'baselines/visual-dm-right-sidecar.png',
    sha256: '12d1b50517e98b8f643fb8768ea83b738b7bbdc3d7e28326a55e6be5b95d7465',
    maxDistance: 0.24,
    minLuminanceVariance: 0.012,
    minColorVariance: 0.012,
    minEdgeDensity: 0.06,
    currentEdgeAnchor: { x: 0.596184, y: 0.515948 },
    minSpatialSimilarity: 0.98,
    minHighFrequencyRetention: 0.25,
  },
} as const;

export const FALLBACK_IDS = [
  'reduced-motion',
  'webgl-unavailable',
  'javascript-disabled',
] as const;

export const FINDING_CODES = [
  'viewport-mismatch',
  'horizontal-overflow',
  'semantic-surface-missing',
  'render-mode-mismatch',
  'visibility-spoof-failed',
  'canvas-contribution-missing',
  'guide-state-mismatch',
  'capture-setup-failed',
  'coarse-regression-mismatch',
  'fallback-failed',
] as const;

export const MIN_CANVAS_CHANGED_RATIO = 0.01;
export const MAX_REDUCED_MOTION_DISTANCE = 0.001;
const PIXEL_DELTA_THRESHOLD = 8;

type CaptureId = keyof typeof CAPTURE_SPECS;
type FallbackId = (typeof FALLBACK_IDS)[number];
type FindingCode = (typeof FINDING_CODES)[number];
type Result = 'pass' | 'fail';
type SetupResult = 'pass' | 'fail';

export interface VisualFidelityCapture {
  id: CaptureId;
  route: string;
  viewport: { width: number; height: number };
  image: { path: string; sha256: string; width: number; height: number };
  metrics: {
    innerWidth: number;
    innerHeight: number;
    scrollWidth: number;
    horizontalOverflow: number;
    documentHidden: boolean;
    visibilityEventDispatched: boolean;
    canvasChangedPixels: number | null;
    canvasChangedRatio: number | null;
  };
  semantics: {
    main: boolean;
    navigation: boolean;
    heading: boolean;
    guide: 'visible' | 'hidden' | 'absent';
  };
  setup: {
    navigation: SetupResult;
    readiness: SetupResult;
    interaction: SetupResult | 'not-required';
  };
  regression: {
    baseline: { path: string; sha256: string; width: number; height: number };
    normalizedDistance: number;
    maxDistance: number;
    luminanceVariance: number;
    minLuminanceVariance: number;
    colorVariance: number;
    minColorVariance: number;
    edgeDensity: number;
    minEdgeDensity: number;
    spatialSimilarity: number;
    minSpatialSimilarity: number;
    highFrequencyRetention: number;
    minHighFrequencyRetention: number;
    result: Result;
  } | null;
  renderMode: 'webgl' | 'static-responsive' | 'static-unavailable' | 'static-no-js';
  visibilitySpoofed: boolean;
  result: Result;
}

export interface VisualFidelityFinding {
  code: FindingCode;
  captureId: CaptureId | null;
  fallbackId: FallbackId | null;
}

export interface VisualFidelityEvidence {
  schemaVersion: 1;
  repository: string;
  baseSha: string;
  headSha: string;
  createdAt: string;
  result: Result;
  captures: VisualFidelityCapture[];
  fallbacks: Array<{ id: FallbackId; setup: SetupResult; result: Result }>;
  findings: VisualFidelityFinding[];
}

export interface EvidenceValidationOptions {
  artifactPath: string;
  expectedRepository: string;
  expectedBaseSha: string;
  expectedHeadSha: string;
}

export function deriveFindings(
  captures: VisualFidelityCapture[],
  fallbacks: VisualFidelityEvidence['fallbacks'],
): VisualFidelityFinding[] {
  const findings: VisualFidelityFinding[] = [];
  for (const capture of captures) {
    const spec = CAPTURE_SPECS[capture.id];
    if (!spec) continue;
    if (
      capture.viewport.width !== spec.width
      || capture.viewport.height !== spec.height
      || capture.metrics.innerWidth !== spec.width
      || capture.metrics.innerHeight !== spec.height
      || capture.image.width !== spec.width
      || capture.image.height !== spec.height
    ) {
      findings.push({ code: 'viewport-mismatch', captureId: capture.id, fallbackId: null });
    }
    if (capture.metrics.horizontalOverflow !== 0) {
      findings.push({ code: 'horizontal-overflow', captureId: capture.id, fallbackId: null });
    }
    if (!capture.semantics.main || !capture.semantics.navigation || !capture.semantics.heading) {
      findings.push({ code: 'semantic-surface-missing', captureId: capture.id, fallbackId: null });
    }
    if (capture.renderMode !== spec.renderMode) {
      findings.push({ code: 'render-mode-mismatch', captureId: capture.id, fallbackId: null });
    }
    if (capture.semantics.guide !== spec.guide) {
      findings.push({ code: 'guide-state-mismatch', captureId: capture.id, fallbackId: null });
    }
    if (
      capture.setup.navigation === 'fail'
      || capture.setup.readiness === 'fail'
      || capture.setup.interaction === 'fail'
    ) {
      findings.push({ code: 'capture-setup-failed', captureId: capture.id, fallbackId: null });
    }
    const regressionSpec = REGRESSION_SPECS[capture.id as keyof typeof REGRESSION_SPECS];
    if (
      regressionSpec
      && (
        !capture.regression
        || capture.regression.normalizedDistance > regressionSpec.maxDistance
        || capture.regression.luminanceVariance < regressionSpec.minLuminanceVariance
        || capture.regression.colorVariance < regressionSpec.minColorVariance
        || capture.regression.edgeDensity < regressionSpec.minEdgeDensity
        || capture.regression.spatialSimilarity < regressionSpec.minSpatialSimilarity
        || capture.regression.highFrequencyRetention < regressionSpec.minHighFrequencyRetention
      )
    ) {
      findings.push({ code: 'coarse-regression-mismatch', captureId: capture.id, fallbackId: null });
    }
    if (
      capture.id.startsWith('desktop-')
      && (!capture.visibilitySpoofed
        || capture.metrics.documentHidden
        || !capture.metrics.visibilityEventDispatched)
    ) {
      findings.push({ code: 'visibility-spoof-failed', captureId: capture.id, fallbackId: null });
    }
    if (
      capture.id === 'desktop-home'
      && (
        capture.metrics.canvasChangedPixels === null
        || capture.metrics.canvasChangedRatio === null
        || capture.metrics.canvasChangedPixels
          < Math.ceil(spec.width * spec.height * MIN_CANVAS_CHANGED_RATIO)
        || capture.metrics.canvasChangedRatio < MIN_CANVAS_CHANGED_RATIO
      )
    ) {
      findings.push({ code: 'canvas-contribution-missing', captureId: capture.id, fallbackId: null });
    }
  }
  for (const fallback of fallbacks) {
    if (fallback.setup === 'fail' || fallback.result === 'fail') {
      findings.push({ code: 'fallback-failed', captureId: null, fallbackId: fallback.id });
    }
  }
  return findings;
}

export function finalizeEvidence(
  value: Omit<VisualFidelityEvidence, 'result' | 'findings'>,
): VisualFidelityEvidence {
  const findings = deriveFindings(value.captures, value.fallbacks);
  const failedCaptureIds = new Set(findings.flatMap((finding) => finding.captureId ?? []));
  const captures = value.captures.map((capture) => ({
    ...capture,
    regression: capture.regression
      ? {
          ...capture.regression,
          result: regressionMetricsPass(capture.regression)
            ? 'pass' as const
            : 'fail' as const,
        }
      : null,
    result: failedCaptureIds.has(capture.id) ? 'fail' as const : 'pass' as const,
  }));
  return {
    ...value,
    captures,
    result: findings.length === 0 ? 'pass' : 'fail',
    findings,
  };
}

function regressionMetricsPass(
  regression: NonNullable<VisualFidelityCapture['regression']>,
): boolean {
  return regression.normalizedDistance <= regression.maxDistance
    && regression.luminanceVariance >= regression.minLuminanceVariance
    && regression.colorVariance >= regression.minColorVariance
    && regression.edgeDensity >= regression.minEdgeDensity
    && regression.spatialSimilarity >= regression.minSpatialSimilarity
    && regression.highFrequencyRetention >= regression.minHighFrequencyRetention;
}

export async function validateVisualFidelityEvidence(
  value: unknown,
  options: EvidenceValidationOptions,
): Promise<string[]> {
  const errors: string[] = [];
  if (!isRecord(value)) return ['artifact must be an object'];
  exactKeys(value, '$', TOP_KEYS, errors);
  scanSensitive(value, '$', errors);
  const evidence = value as Partial<VisualFidelityEvidence>;

  if (evidence.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!REPOSITORY.test(evidence.repository ?? '')) errors.push('repository must be owner/name');
  if (evidence.repository !== options.expectedRepository) errors.push('repository does not match expected repository');
  if (!GIT_SHA.test(evidence.baseSha ?? '')) errors.push('baseSha must be a full lowercase Git SHA');
  if (evidence.baseSha !== options.expectedBaseSha) errors.push('baseSha does not match the exact expected base');
  if (!GIT_SHA.test(evidence.headSha ?? '')) errors.push('headSha must be a full lowercase Git SHA');
  if (evidence.headSha !== options.expectedHeadSha) errors.push('headSha does not match the exact current head');
  if (!isCanonicalIso(evidence.createdAt)) errors.push('createdAt must be a canonical ISO timestamp');
  if (evidence.result !== 'pass' && evidence.result !== 'fail') errors.push('result must be pass or fail');

  await verifyCaptures(evidence.captures, options.artifactPath, errors);
  verifyFallbacks(evidence.fallbacks, errors);
  verifyFindings(evidence.findings, errors);

  if (Array.isArray(evidence.captures) && Array.isArray(evidence.fallbacks) && Array.isArray(evidence.findings)) {
    const expected = deriveFindings(evidence.captures, evidence.fallbacks);
    if (JSON.stringify(evidence.findings) !== JSON.stringify(expected)) {
      errors.push('findings must exactly match the machine-derived failures');
    }
    const failed = new Set(expected.flatMap((finding) => finding.captureId ?? []));
    for (const capture of evidence.captures) {
      const expectedResult = failed.has(capture.id) ? 'fail' : 'pass';
      if (capture.result !== expectedResult) errors.push(`${capture.id}.result must be ${expectedResult}`);
    }
    const expectedResult = expected.length === 0 ? 'pass' : 'fail';
    if (evidence.result !== expectedResult) errors.push(`result must be ${expectedResult}`);
  }
  return errors;
}

export async function measureCanvasContribution(
  visibleImage: Buffer,
  hiddenImage: Buffer,
): Promise<{ changedPixels: number; changedRatio: number }> {
  const [visible, hidden] = await Promise.all([
    sharp(visibleImage).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(hiddenImage).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (
    visible.info.width !== hidden.info.width
    || visible.info.height !== hidden.info.height
    || visible.info.channels !== hidden.info.channels
  ) {
    throw new Error('canvas comparison images must have identical decoded dimensions');
  }
  let changedPixels = 0;
  for (let offset = 0; offset < visible.data.length; offset += visible.info.channels) {
    let changed = false;
    for (let channel = 0; channel < visible.info.channels; channel += 1) {
      if (Math.abs(visible.data[offset + channel]! - hidden.data[offset + channel]!) >= PIXEL_DELTA_THRESHOLD) {
        changed = true;
        break;
      }
    }
    if (changed) changedPixels += 1;
  }
  const pixelCount = visible.info.width * visible.info.height;
  return {
    changedPixels,
    changedRatio: Math.round((changedPixels / pixelCount) * 1_000_000) / 1_000_000,
  };
}

export async function measureCoarseNormalizedDistance(
  actualImage: Buffer,
  baselineImage: Buffer,
): Promise<number> {
  const [actual, baseline] = await Promise.all([
    normalizedRgb(actualImage),
    normalizedRgb(baselineImage),
  ]);
  if (actual.length !== baseline.length) {
    throw new Error('coarse comparison images must decode to the same normalized dimensions');
  }
  let distance = 0;
  for (let index = 0; index < actual.length; index += 1) {
    distance += Math.abs(actual[index]! - baseline[index]!);
  }
  return Math.round((distance / (actual.length * 255)) * 1_000_000) / 1_000_000;
}

export async function measureCoarseStructuralFeatures(
  image: Buffer,
): Promise<{
  luminanceVariance: number;
  colorVariance: number;
  edgeDensity: number;
}> {
  const pixels = await normalizedRgb(image);
  const width = 64;
  const height = 40;
  const pixelCount = width * height;
  const luminance = new Float64Array(pixelCount);
  const channelSums = [0, 0, 0];
  const channelSquares = [0, 0, 0];
  let luminanceSum = 0;
  let luminanceSquares = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const red = pixels[pixel * 3]! / 255;
    const green = pixels[pixel * 3 + 1]! / 255;
    const blue = pixels[pixel * 3 + 2]! / 255;
    const light = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    luminance[pixel] = light;
    luminanceSum += light;
    luminanceSquares += light * light;
    for (const [channel, value] of [red, green, blue].entries()) {
      channelSums[channel]! += value;
      channelSquares[channel]! += value * value;
    }
  }
  const luminanceMean = luminanceSum / pixelCount;
  const luminanceVariance = luminanceSquares / pixelCount - luminanceMean * luminanceMean;
  const colorVariance = channelSums.reduce((total, sum, channel) => {
    const mean = sum / pixelCount;
    return total + channelSquares[channel]! / pixelCount - mean * mean;
  }, 0) / 3;
  let edgeCount = 0;
  let edgePairs = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (x + 1 < width) {
        edgePairs += 1;
        if (Math.abs(luminance[index]! - luminance[index + 1]!) >= 0.05) edgeCount += 1;
      }
      if (y + 1 < height) {
        edgePairs += 1;
        if (Math.abs(luminance[index]! - luminance[index + width]!) >= 0.05) edgeCount += 1;
      }
    }
  }
  return {
    luminanceVariance: roundMetric(luminanceVariance),
    colorVariance: roundMetric(colorVariance),
    edgeDensity: roundMetric(edgeCount / edgePairs),
  };
}

export async function measureSpatialAnchorSimilarity(
  actualImage: Buffer,
  baselineImage: Buffer,
  currentAnchor: { x: number; y: number },
): Promise<number> {
  const [actual, baseline] = await Promise.all([
    normalizedRgb(actualImage),
    normalizedRgb(baselineImage),
  ]);
  const actualAnchor = edgeEnergyCentroid(actual);
  const baselineAnchor = edgeEnergyCentroid(baseline);
  if (!actualAnchor || !baselineAnchor) return 0;
  const similarity = (anchor: { x: number; y: number }) =>
    1 - Math.hypot(actualAnchor.x - anchor.x, actualAnchor.y - anchor.y) / Math.SQRT2;
  return roundMetric(Math.max(similarity(baselineAnchor), similarity(currentAnchor)));
}

export async function measureHighFrequencyRetention(
  actualImage: Buffer,
  baselineImage: Buffer,
): Promise<number> {
  const [actualEnergy, baselineEnergy] = await Promise.all([
    laplacianVariance(actualImage),
    laplacianVariance(baselineImage),
  ]);
  if (baselineEnergy <= Number.EPSILON) return 0;
  return roundMetric(Math.min(1, actualEnergy / baselineEnergy));
}

async function laplacianVariance(image: Buffer): Promise<number> {
  const { data, info } = await sharp(image)
    .greyscale()
    .resize(256, 160, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  let squares = 0;
  let samples = 0;
  for (let y = 1; y < info.height - 1; y += 1) {
    for (let x = 1; x < info.width - 1; x += 1) {
      const index = y * info.width + x;
      const response = 4 * data[index]!
        - data[index - 1]!
        - data[index + 1]!
        - data[index - info.width]!
        - data[index + info.width]!;
      sum += response;
      squares += response * response;
      samples += 1;
    }
  }
  const mean = sum / samples;
  return squares / samples - mean * mean;
}

function edgeEnergyCentroid(
  pixels: Buffer,
): { x: number; y: number } | null {
  const width = 64;
  const height = 40;
  const luminance = new Float64Array(width * height);
  for (let pixel = 0; pixel < luminance.length; pixel += 1) {
    const red = pixels[pixel * 3]! / 255;
    const green = pixels[pixel * 3 + 1]! / 255;
    const blue = pixels[pixel * 3 + 2]! / 255;
    luminance[pixel] = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  }
  let energy = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const value = luminance[index]!;
      const edge = (x + 1 < width ? Math.abs(luminance[index + 1]! - value) : 0)
        + (y + 1 < height ? Math.abs(luminance[index + width]! - value) : 0);
      energy += edge;
      weightedX += edge * x / (width - 1);
      weightedY += edge * y / (height - 1);
    }
  }
  if (energy <= Number.EPSILON) return null;
  return { x: weightedX / energy, y: weightedY / energy };
}

function normalizedRgb(image: Buffer): Promise<Buffer> {
  return sharp(image)
    .removeAlpha()
    .resize(64, 40, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer();
}

function roundMetric(value: number): number {
  const rounded = Math.round(Math.max(0, value) * 1_000_000) / 1_000_000;
  return rounded === 0 ? 0 : rounded;
}

async function verifyCaptures(
  captures: VisualFidelityCapture[] | undefined,
  artifactPath: string,
  errors: string[],
): Promise<void> {
  if (!Array.isArray(captures)) {
    errors.push('captures must be an array');
    return;
  }
  for (const id of Object.keys(CAPTURE_SPECS) as CaptureId[]) {
    if (captures.filter((capture) => capture?.id === id).length !== 1) {
      errors.push(`captures must contain ${id} exactly once`);
    }
  }
  if (captures.length !== Object.keys(CAPTURE_SPECS).length) {
    errors.push('captures must contain only the required capture records');
  }
  for (const [index, capture] of captures.entries()) {
    if (!isRecord(capture)) {
      errors.push(`captures[${index}] must be an object`);
      continue;
    }
    exactKeys(capture, `$.captures[${index}]`, CAPTURE_KEYS, errors);
    exactKeys(capture.viewport, `$.captures[${index}].viewport`, VIEWPORT_KEYS, errors);
    exactKeys(capture.image, `$.captures[${index}].image`, IMAGE_KEYS, errors);
    exactKeys(capture.metrics, `$.captures[${index}].metrics`, METRIC_KEYS, errors);
    exactKeys(capture.semantics, `$.captures[${index}].semantics`, SEMANTIC_KEYS, errors);
    exactKeys(capture.setup, `$.captures[${index}].setup`, SETUP_KEYS, errors);
    if (
      !isRecord(capture.viewport)
      || !isRecord(capture.image)
      || !isRecord(capture.metrics)
      || !isRecord(capture.semantics)
      || !isRecord(capture.setup)
    ) {
      continue;
    }
    const spec = CAPTURE_SPECS[capture.id];
    if (!spec) {
      errors.push(`captures[${index}].id is unsupported`);
      continue;
    }
    if (capture.route !== spec.route) errors.push(`${capture.id}.route must be ${spec.route}`);
    if (!['pass', 'fail'].includes(capture.result)) errors.push(`${capture.id}.result must be pass or fail`);
    if (capture.setup.navigation !== 'pass' && capture.setup.navigation !== 'fail') {
      errors.push(`${capture.id}.setup.navigation must be pass or fail`);
    }
    if (capture.setup.readiness !== 'pass' && capture.setup.readiness !== 'fail') {
      errors.push(`${capture.id}.setup.readiness must be pass or fail`);
    }
    if (!['pass', 'fail', 'not-required'].includes(capture.setup.interaction)) {
      errors.push(`${capture.id}.setup.interaction is unsupported`);
    }
    if (!Number.isInteger(capture.metrics?.horizontalOverflow) || capture.metrics.horizontalOverflow < 0) {
      errors.push(`${capture.id}.horizontalOverflow must be a non-negative integer`);
    }
    const expectedOverflow = Math.max(0, capture.metrics.scrollWidth - capture.metrics.innerWidth);
    if (capture.metrics.horizontalOverflow !== expectedOverflow) {
      errors.push(`${capture.id}.horizontalOverflow must be machine-derived from document width`);
    }
    if (capture.id === 'desktop-home') {
      const changedPixels = capture.metrics.canvasChangedPixels;
      const changedRatio = capture.metrics.canvasChangedRatio;
      if (typeof changedPixels !== 'number' || !Number.isInteger(changedPixels) || changedPixels < 0) {
        errors.push('desktop-home.canvasChangedPixels must be a non-negative integer');
      }
      if (
        typeof changedRatio !== 'number'
        || changedRatio < 0
        || changedRatio > 1
      ) {
        errors.push('desktop-home.canvasChangedRatio must be between 0 and 1');
      } else if (typeof changedPixels === 'number') {
        const expectedRatio = Math.round(
          (changedPixels / (spec.width * spec.height)) * 1_000_000,
        ) / 1_000_000;
        if (changedRatio !== expectedRatio) {
          errors.push('desktop-home.canvasChangedRatio must be machine-derived from changed pixels');
        }
      }
    } else if (
      capture.metrics.canvasChangedPixels !== null
      || capture.metrics.canvasChangedRatio !== null
    ) {
      errors.push(`${capture.id} canvas contribution metrics must be null`);
    }
    await verifyImage(capture.image, artifactPath, capture.id, errors);
    await verifyRegression(capture, artifactPath, errors);
  }
}

async function verifyRegression(
  capture: VisualFidelityCapture,
  artifactPath: string,
  errors: string[],
): Promise<void> {
  const spec = REGRESSION_SPECS[capture.id as keyof typeof REGRESSION_SPECS];
  if (!spec) {
    if (capture.regression !== null) errors.push(`${capture.id}.regression must be null`);
    return;
  }
  if (!isRecord(capture.regression)) {
    errors.push(`${capture.id}.regression must be an object`);
    return;
  }
  exactKeys(capture.regression, `$.captures.${capture.id}.regression`, REGRESSION_KEYS, errors);
  exactKeys(capture.regression.baseline, `$.captures.${capture.id}.regression.baseline`, IMAGE_KEYS, errors);
  if (capture.regression.baseline.path !== spec.artifactPath) {
    errors.push(`${capture.id}.regression baseline path does not match the bound baseline`);
  }
  if (capture.regression.baseline.sha256 !== spec.sha256) {
    errors.push(`${capture.id}.regression baseline hash does not match the bound baseline`);
  }
  if (capture.regression.maxDistance !== spec.maxDistance) {
    errors.push(`${capture.id}.regression maxDistance does not match the bound threshold`);
  }
  for (const field of [
    'minLuminanceVariance',
    'minColorVariance',
    'minEdgeDensity',
    'minSpatialSimilarity',
    'minHighFrequencyRetention',
  ] as const) {
    if (capture.regression[field] !== spec[field]) {
      errors.push(`${capture.id}.regression ${field} does not match the bound threshold`);
    }
  }
  if (
    typeof capture.regression.normalizedDistance !== 'number'
    || capture.regression.normalizedDistance < 0
    || capture.regression.normalizedDistance > 1
  ) {
    errors.push(`${capture.id}.regression normalizedDistance must be between 0 and 1`);
  }
  for (const field of [
    'luminanceVariance',
    'colorVariance',
    'edgeDensity',
    'spatialSimilarity',
    'highFrequencyRetention',
  ] as const) {
    const metric = capture.regression[field];
    if (typeof metric !== 'number' || metric < 0 || metric > 1) {
      errors.push(`${capture.id}.regression ${field} must be between 0 and 1`);
    }
  }
  const expectedResult = regressionMetricsPass(capture.regression) ? 'pass' : 'fail';
  if (capture.regression.result !== expectedResult) {
    errors.push(`${capture.id}.regression.result must be ${expectedResult}`);
  }
  await verifyImage(capture.regression.baseline, artifactPath, `${capture.id}.regression.baseline`, errors);
  const actualPath = await safeArtifactFile(artifactPath, capture.image.path);
  const baselinePath = await safeArtifactFile(artifactPath, capture.regression.baseline.path);
  if (!actualPath || !baselinePath) return;
  try {
    const actualBytes = await readFile(actualPath);
    const baselineBytes = await readFile(baselinePath);
    const [measured, features, spatialSimilarity, highFrequencyRetention] = await Promise.all([
      measureCoarseNormalizedDistance(actualBytes, baselineBytes),
      measureCoarseStructuralFeatures(actualBytes),
      measureSpatialAnchorSimilarity(actualBytes, baselineBytes, spec.currentEdgeAnchor),
      measureHighFrequencyRetention(actualBytes, baselineBytes),
    ]);
    if (measured !== capture.regression.normalizedDistance) {
      errors.push(`${capture.id}.regression normalizedDistance does not match decoded images`);
    }
    for (const field of ['luminanceVariance', 'colorVariance', 'edgeDensity'] as const) {
      if (features[field] !== capture.regression[field]) {
        errors.push(`${capture.id}.regression ${field} does not match decoded image`);
      }
    }
    if (spatialSimilarity !== capture.regression.spatialSimilarity) {
      errors.push(`${capture.id}.regression spatialSimilarity does not match decoded image`);
    }
    if (highFrequencyRetention !== capture.regression.highFrequencyRetention) {
      errors.push(`${capture.id}.regression highFrequencyRetention does not match decoded images`);
    }
  } catch {
    errors.push(`${capture.id}.regression images could not be compared`);
  }
}

function verifyFallbacks(
  fallbacks: VisualFidelityEvidence['fallbacks'] | undefined,
  errors: string[],
): void {
  if (!Array.isArray(fallbacks)) {
    errors.push('fallbacks must be an array');
    return;
  }
  for (const id of FALLBACK_IDS) {
    if (fallbacks.filter((fallback) => fallback?.id === id).length !== 1) {
      errors.push(`fallbacks must contain ${id} exactly once`);
    }
  }
  if (fallbacks.length !== FALLBACK_IDS.length) errors.push('fallbacks contains unsupported records');
  for (const [index, fallback] of fallbacks.entries()) {
    exactKeys(fallback, `$.fallbacks[${index}]`, FALLBACK_KEYS, errors);
    if (!FALLBACK_IDS.includes(fallback.id)) errors.push(`fallbacks[${index}].id is unsupported`);
    if (fallback.setup !== 'pass' && fallback.setup !== 'fail') {
      errors.push(`fallbacks[${index}].setup must be pass or fail`);
    }
    if (fallback.result !== 'pass' && fallback.result !== 'fail') {
      errors.push(`fallbacks[${index}].result must be pass or fail`);
    }
  }
}

function verifyFindings(
  findings: VisualFidelityFinding[] | undefined,
  errors: string[],
): void {
  if (!Array.isArray(findings)) {
    errors.push('findings must be an array');
    return;
  }
  for (const [index, finding] of findings.entries()) {
    exactKeys(finding, `$.findings[${index}]`, FINDING_KEYS, errors);
    if (!FINDING_CODES.includes(finding.code)) errors.push(`findings[${index}].code is unsupported`);
    if (finding.captureId !== null && !(finding.captureId in CAPTURE_SPECS)) {
      errors.push(`findings[${index}].captureId is unsupported`);
    }
    if (finding.fallbackId !== null && !FALLBACK_IDS.includes(finding.fallbackId)) {
      errors.push(`findings[${index}].fallbackId is unsupported`);
    }
    if ((finding.captureId === null) === (finding.fallbackId === null)) {
      errors.push(`findings[${index}] must bind exactly one capture or fallback`);
    }
  }
}

async function verifyImage(
  image: VisualFidelityCapture['image'],
  artifactPath: string,
  label: string,
  errors: string[],
): Promise<void> {
  if (!isRecord(image) || !SAFE_PATH.test(image.path ?? '') || isAbsolute(image.path ?? '')) {
    errors.push(`${label}.image must use a safe relative path`);
    return;
  }
  const path = await safeArtifactFile(artifactPath, image.path);
  if (!path || !SHA256.test(image.sha256 ?? '')) {
    errors.push(`${label}.image must use a regular in-artifact PNG and SHA-256`);
    return;
  }
  try {
    const bytes = await readFile(path);
    if (createHash('sha256').update(bytes).digest('hex') !== image.sha256) {
      errors.push(`${label}.image SHA-256 does not match`);
    }
    const metadata = await sharp(bytes).metadata();
    if (metadata.format !== 'png') errors.push(`${label}.image must be a PNG`);
    if (metadata.width !== image.width || metadata.height !== image.height) {
      errors.push(`${label}.image dimensions do not match decoded PNG`);
    }
  } catch {
    errors.push(`${label}.image must be a readable PNG`);
  }
}

async function safeArtifactFile(artifactPath: string, relativePath: string): Promise<string | null> {
  const root = await realpath(dirname(resolve(artifactPath))).catch(() => null);
  if (!root) return null;
  const candidate = resolve(root, relativePath);
  const rel = relative(root, candidate);
  if (!rel || rel.startsWith('..') || rel.includes(`${sep}..${sep}`) || isAbsolute(rel)) return null;
  let cursor = root;
  for (const segment of rel.split(sep)) {
    cursor = resolve(cursor, segment);
    const stat = await lstat(cursor).catch(() => null);
    if (!stat || stat.isSymbolicLink()) return null;
  }
  const stat = await lstat(candidate).catch(() => null);
  if (!stat?.isFile()) return null;
  return candidate;
}

function exactKeys(value: unknown, path: string, allowed: readonly string[], errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${path}.${key} is not allowed`);
  }
  for (const key of allowed) {
    if (!(key in value)) errors.push(`${path}.${key} is required`);
  }
}

function scanSensitive(value: unknown, path: string, errors: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanSensitive(item, `${path}[${index}]`, errors));
    return;
  }
  if (!isRecord(value)) {
    if (
      typeof value === 'string'
      && (/https?:\/\//i.test(value) || /\b(?:sk-|ghp_|Bearer\s)/i.test(value))
    ) {
      errors.push(`${path} contains prohibited URL or credential-like data`);
    }
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (/(?:prompt|payload|cookie|authorization|credential|secret|token|provider|model)/i.test(key)) {
      errors.push(`${path}.${key} is a prohibited data field`);
    }
    scanSensitive(item, `${path}.${key}`, errors);
  }
}

function isCanonicalIso(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
