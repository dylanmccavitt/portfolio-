import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const TASK_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SAFE_ARTIFACT_PATH = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;
const PROOF_KEYS = [
  'schemaVersion',
  'issue',
  'repository',
  'baseSha',
  'headSha',
  'createdAt',
  'executionMode',
  'viewports',
  'interactionChecks',
  'fallbackChecks',
  'visualReview',
  'visualComparisons',
  'diagnostics',
] as const;
const VIEWPORT_KEYS = ['id', 'width', 'height', 'route', 'state', 'capture', 'result'] as const;
const CAPTURE_KEYS = ['path', 'sha256'] as const;
const NAMED_CHECK_KEYS = ['id', 'result'] as const;
const VISUAL_COMPARISON_KEYS = [
  'id',
  'reference',
  'capture',
  'reviewedDimensions',
  'findings',
  'result',
] as const;
const VISUAL_FINDING_KEYS = ['priority', 'dimension', 'observation'] as const;
const VISUAL_REVIEW_KEYS = [
  'input',
  'reviewerTaskId',
  'reviewedSourceHeadSha',
  'captureSetSha256',
] as const;
const VISUAL_REVIEW_INPUT_KEYS = [
  'schemaVersion',
  'issue',
  'reviewerTaskId',
  'reviewedSourceHeadSha',
  'captureSetSha256',
  'comparisons',
] as const;
const REVIEWED_DIMENSION_KEYS = ['dimension', 'disposition', 'evidence'] as const;
const DIAGNOSTIC_KEYS = ['id', 'result', 'observation'] as const;
const ALLOWED_BROWSER_ROUTES = [
  '/',
  '/library',
  '/projects/bellas-beads',
  '/journey',
  '/resume',
  '/contact',
] as const;
const ALLOWED_VIEWPORT_STATES = [
  'home-ready',
  'library-ready',
  'project-ready',
  'journey-ready',
  'resume-ready',
  'contact-ready',
] as const;
const VISUAL_CAPTURE_DIMENSIONS = { width: 1440, height: 900 } as const;
const REFERENCE_DIMENSIONS = { width: 1487, height: 1058 } as const;

export const REQUIRED_INTERACTION_CHECKS = [
  'navigation',
  'guide-open-close',
  'streaming',
  'cancellation',
  'recovery',
  'keyboard',
  'context-isolation',
  'contact',
  'core-routes',
] as const;

export const REQUIRED_FALLBACK_CHECKS = [
  'webgl-unavailable',
  'reduced-motion',
  'no-js',
] as const;

export const REQUIRED_VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  'small-tablet': { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
} as const;

export const VISUAL_REFERENCE_BINDINGS = {
  'home-muted': {
    path: 'docs/design/contextual-guide-reset/01-home-muted-threejs.png',
    sha256: '92fa8bff310564a6264994382f4621428ac5add9d6a1a7afe171111f0e4103b7',
  },
  'work-expanded': {
    path: 'docs/design/contextual-guide-reset/02-work-layout.png',
    sha256: '9ab440d983436c3ab09d938359e18ff5a515629975b678474a60a2b637855d69',
  },
  'dm-right-sidecar': {
    path: 'docs/design/contextual-guide-reset/07-dm-right-sidecar-muted.png',
    sha256: '17eeeebb3a5167434c0d33f40e103e0a284afa09c2ca7cb46965025df7963263',
  },
} as const;

export const REQUIRED_VISUAL_DIMENSIONS = [
  'typography',
  'layout',
  'palette',
  'geometry',
  'copy',
] as const;

export const VISUAL_DIMENSION_EVIDENCE = {
  typography: 'type-scale-style-and-hierarchy-aligned',
  layout: 'layout-spacing-rhythm-and-proportions-aligned',
  palette: 'palette-contrast-and-surface-tone-aligned',
  geometry: 'frame-screen-and-selected-state-geometry-aligned',
  copy: 'content-order-labels-and-action-hierarchy-aligned',
} as const;

type CheckResult = 'pass';
type ViewportId = keyof typeof REQUIRED_VIEWPORTS;
type VisualId = keyof typeof VISUAL_REFERENCE_BINDINGS;
type VisualDimension = (typeof REQUIRED_VISUAL_DIMENSIONS)[number];

interface Capture {
  path: string;
  sha256: string;
}

interface BrowserViewportProof {
  id: ViewportId;
  width: number;
  height: number;
  route: string;
  state: string;
  capture: Capture;
  result: CheckResult;
}

interface NamedCheck {
  id: string;
  result: CheckResult;
}

interface VisualFinding {
  priority: 'P3';
  dimension: VisualDimension;
  observation: 'minor-drift';
}

interface ReviewedVisualDimension {
  dimension: VisualDimension;
  disposition: 'pass';
  evidence: (typeof VISUAL_DIMENSION_EVIDENCE)[VisualDimension];
}

export interface VisualComparison {
  id: VisualId;
  reference: Capture;
  capture: Capture;
  reviewedDimensions: ReviewedVisualDimension[];
  findings: VisualFinding[];
  result: CheckResult;
}

export interface ReplacementQualityVisualReviewInput {
  schemaVersion: 1;
  issue: 308;
  reviewerTaskId: string;
  reviewedSourceHeadSha: string;
  captureSetSha256: string;
  comparisons: VisualComparison[];
}

export interface ReplacementQualityProof {
  schemaVersion: 1;
  issue: 308;
  repository: 'dylanmccavitt/portfolio-';
  baseSha: string;
  headSha: string;
  createdAt: string;
  executionMode: 'local-fixture';
  viewports: BrowserViewportProof[];
  interactionChecks: NamedCheck[];
  fallbackChecks: NamedCheck[];
  visualReview: {
    input: Capture;
    reviewerTaskId: string;
    reviewedSourceHeadSha: string;
    captureSetSha256: string;
  };
  visualComparisons: VisualComparison[];
  diagnostics: Array<{
    id: 'optional-action-quality';
    result: 'diagnostic';
    observation: 'present' | 'absent' | 'not-exercised';
  }>;
}

export interface VerifyProofOptions {
  artifactPath: string;
  repositoryRoot: string;
  expectedHeadSha: string;
  expectedBaseSha: string;
  expectedReviewedSourceHeadSha: string;
}

export async function verifyReplacementQualityProof(
  value: unknown,
  options: VerifyProofOptions,
): Promise<string[]> {
  const errors: string[] = [];
  if (!isRecord(value)) return ['artifact must be a JSON object'];
  verifyExactKeys(value, '$', PROOF_KEYS, errors);
  scanForSensitiveData(value, '$', errors);

  const proof = value as Partial<ReplacementQualityProof>;
  if (proof.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (proof.issue !== 308) errors.push('issue must be 308');
  if (proof.repository !== 'dylanmccavitt/portfolio-') {
    errors.push('repository must be dylanmccavitt/portfolio-');
  }
  if (!GIT_SHA.test(proof.baseSha ?? '')) errors.push('baseSha must be a full Git SHA');
  if (proof.baseSha !== options.expectedBaseSha) {
    errors.push(`baseSha must match the exact reviewed base ${options.expectedBaseSha}`);
  }
  if (!GIT_SHA.test(proof.headSha ?? '')) errors.push('headSha must be a full Git SHA');
  if (proof.headSha !== options.expectedHeadSha) {
    errors.push(`headSha must match the exact current head ${options.expectedHeadSha}`);
  }
  if (!isCanonicalIsoTimestamp(proof.createdAt)) {
    errors.push('createdAt must be a canonical ISO timestamp');
  }
  if (proof.executionMode !== 'local-fixture') {
    errors.push('executionMode must be local-fixture');
  }

  await verifyViewports(proof.viewports, options, errors);
  verifyNamedChecks('interactionChecks', proof.interactionChecks, REQUIRED_INTERACTION_CHECKS, errors);
  verifyNamedChecks('fallbackChecks', proof.fallbackChecks, REQUIRED_FALLBACK_CHECKS, errors);
  await verifyVisualReview(proof.visualReview, proof.visualComparisons, options, errors);
  await verifyVisualComparisons(proof.visualComparisons, options, errors);
  verifyDiagnostics(proof.diagnostics, errors);
  return errors;
}

async function verifyViewports(
  viewports: ReplacementQualityProof['viewports'] | undefined,
  options: VerifyProofOptions,
  errors: string[],
): Promise<void> {
  if (!Array.isArray(viewports)) {
    errors.push('viewports must be an array');
    return;
  }
  if (viewports.length !== Object.keys(REQUIRED_VIEWPORTS).length) {
    errors.push('viewports must contain only the three required viewport records');
  }
  for (const [index, viewport] of viewports.entries()) {
    if (!isRecord(viewport)) {
      errors.push(`viewports[${index}] must be an object`);
      continue;
    }
    verifyExactKeys(viewport, `$.viewports[${index}]`, VIEWPORT_KEYS, errors);
  }
  for (const [id, dimensions] of Object.entries(REQUIRED_VIEWPORTS) as Array<[ViewportId, { width: number; height: number }]>) {
    const matches = viewports.filter((candidate) => candidate?.id === id);
    if (matches.length !== 1) {
      errors.push(`viewports must contain ${id} exactly once`);
      continue;
    }
    const viewport = matches[0]!;
    if (viewport.width !== dimensions.width || viewport.height !== dimensions.height) {
      errors.push(`${id} must be ${dimensions.width}x${dimensions.height}`);
    }
    if (!ALLOWED_BROWSER_ROUTES.includes(viewport.route as (typeof ALLOWED_BROWSER_ROUTES)[number])) {
      errors.push(`${id}.route must be an approved core route`);
    }
    if (!ALLOWED_VIEWPORT_STATES.includes(viewport.state as (typeof ALLOWED_VIEWPORT_STATES)[number])) {
      errors.push(`${id}.state must be an approved public state`);
    }
    if (viewport.result !== 'pass') errors.push(`${id}.result must be pass`);
    await verifyCapture(viewport.capture, options.artifactPath, `${id}.capture`, dimensions, errors);
  }
}

function verifyNamedChecks(
  field: string,
  checks: NamedCheck[] | undefined,
  required: readonly string[],
  errors: string[],
): void {
  if (!Array.isArray(checks)) {
    errors.push(`${field} must be an array`);
    return;
  }
  for (const [index, check] of checks.entries()) {
    if (!isRecord(check)) {
      errors.push(`${field}[${index}] must be an object`);
      continue;
    }
    verifyExactKeys(check, `$.${field}[${index}]`, NAMED_CHECK_KEYS, errors);
  }
  for (const id of required) {
    const matches = checks.filter((check) => check?.id === id);
    if (matches.length !== 1) errors.push(`${field} must contain ${id} exactly once`);
    else if (matches[0]?.result !== 'pass') errors.push(`${field}.${id} must pass`);
  }
  if (checks.some((check) => !required.includes(check?.id))) {
    errors.push(`${field} contains an unsupported check id`);
  }
}

async function verifyVisualReview(
  review: ReplacementQualityProof['visualReview'] | undefined,
  comparisons: ReplacementQualityProof['visualComparisons'] | undefined,
  options: VerifyProofOptions,
  errors: string[],
): Promise<void> {
  if (!isRecord(review)) {
    errors.push('visualReview must be an object');
    return;
  }
  verifyExactKeys(review, '$.visualReview', VISUAL_REVIEW_KEYS, errors);
  verifyCaptureShape(review.input, '$.visualReview.input', errors);
  if (review.input?.path !== 'replacement-quality-visual-review.json') {
    errors.push('visualReview.input must use replacement-quality-visual-review.json');
    return;
  }
  const reviewPath = await resolveArtifactFile(options.artifactPath, review.input.path);
  if (!reviewPath || !SHA256.test(review.input.sha256)) {
    errors.push('visualReview.input must use a safe relative path and SHA-256');
    return;
  }

  let input: ReplacementQualityVisualReviewInput;
  try {
    const source = await readFile(reviewPath, 'utf8');
    const actualSha = createHash('sha256').update(source).digest('hex');
    if (actualSha !== review.input.sha256) {
      errors.push('visualReview.input SHA-256 does not match the packaged review input');
    }
    const parsed = JSON.parse(source) as unknown;
    if (!isRecord(parsed)) {
      errors.push('visual review input must be a JSON object');
      return;
    }
    verifyExactKeys(parsed, '$.visualReviewInput', VISUAL_REVIEW_INPUT_KEYS, errors);
    scanForSensitiveData(parsed, '$.visualReviewInput', errors);
    input = parsed as unknown as ReplacementQualityVisualReviewInput;
  } catch {
    errors.push('visualReview.input must be readable JSON');
    return;
  }

  if (input.schemaVersion !== 1 || input.issue !== 308) {
    errors.push('visual review input identity is invalid');
  }
  if (!TASK_ID.test(input.reviewerTaskId) || input.reviewerTaskId !== review.reviewerTaskId) {
    errors.push('visual review input reviewer task identity is invalid or mismatched');
  }
  if (
    input.reviewedSourceHeadSha !== options.expectedReviewedSourceHeadSha
    || review.reviewedSourceHeadSha !== options.expectedReviewedSourceHeadSha
  ) {
    errors.push(`visual review input must match reviewed source head ${options.expectedReviewedSourceHeadSha}`);
  }
  if (!SHA256.test(input.captureSetSha256) || input.captureSetSha256 !== review.captureSetSha256) {
    errors.push('visual review capture-set binding is invalid or mismatched');
  }
  if (!Array.isArray(comparisons) || JSON.stringify(input.comparisons) !== JSON.stringify(comparisons)) {
    errors.push('visual comparisons must exactly match the independent review input');
    return;
  }
  const actualCaptureSetSha = visualCaptureSetSha256(comparisons);
  if (
    input.captureSetSha256 !== actualCaptureSetSha
    || review.captureSetSha256 !== actualCaptureSetSha
  ) {
    errors.push('visual review capture set is stale or mismatched');
  }
}

export function visualCaptureSetSha256(comparisons: VisualComparison[]): string {
  const bindings = comparisons
    .map((comparison) =>
      `${comparison.id}:${comparison.reference.sha256}:${comparison.capture.sha256}`)
    .sort();
  return createHash('sha256').update(`${bindings.join('\n')}\n`).digest('hex');
}

async function verifyVisualComparisons(
  comparisons: ReplacementQualityProof['visualComparisons'] | undefined,
  options: VerifyProofOptions,
  errors: string[],
): Promise<void> {
  if (!Array.isArray(comparisons)) {
    errors.push('visualComparisons must be an array');
    return;
  }
  if (comparisons.length !== Object.keys(VISUAL_REFERENCE_BINDINGS).length) {
    errors.push('visualComparisons must contain only the three required comparisons');
  }
  for (const [index, comparison] of comparisons.entries()) {
    if (!isRecord(comparison)) {
      errors.push(`visualComparisons[${index}] must be an object`);
      continue;
    }
    verifyExactKeys(
      comparison,
      `$.visualComparisons[${index}]`,
      VISUAL_COMPARISON_KEYS,
      errors,
    );
  }
  for (const [id, binding] of Object.entries(VISUAL_REFERENCE_BINDINGS) as Array<[VisualId, Capture]>) {
    const matches = comparisons.filter((candidate) => candidate?.id === id);
    if (matches.length !== 1) {
      errors.push(`visualComparisons must contain ${id} exactly once`);
      continue;
    }
    const comparison = matches[0]!;
    verifyCaptureShape(comparison.reference, `$.visualComparisons.${id}.reference`, errors);
    if (comparison.reference?.path !== binding.path || comparison.reference?.sha256 !== binding.sha256) {
      errors.push(`${id}.reference must match the binding reference`);
    } else {
      await verifyFileHash(resolve(options.repositoryRoot, binding.path), binding.sha256, `${id}.reference`, errors);
      await verifyImageFile(
        resolve(options.repositoryRoot, binding.path),
        `${id}.reference`,
        REFERENCE_DIMENSIONS,
        errors,
      );
    }
    await verifyCapture(
      comparison.capture,
      options.artifactPath,
      `${id}.capture`,
      VISUAL_CAPTURE_DIMENSIONS,
      errors,
    );
    if (comparison.result !== 'pass') errors.push(`${id}.result must be pass`);
    if (!Array.isArray(comparison.reviewedDimensions)) {
      errors.push(`${id}.reviewedDimensions must be an array`);
      continue;
    }
    for (const [index, reviewed] of comparison.reviewedDimensions.entries()) {
      if (!isRecord(reviewed)) {
        errors.push(`${id}.reviewedDimensions[${index}] must be an object`);
        continue;
      }
      verifyExactKeys(
        reviewed,
        `$.visualComparisons.${id}.reviewedDimensions[${index}]`,
        REVIEWED_DIMENSION_KEYS,
        errors,
      );
    }
    for (const dimension of REQUIRED_VISUAL_DIMENSIONS) {
      const matches = comparison.reviewedDimensions.filter((reviewed) =>
        reviewed?.dimension === dimension);
      if (matches.length !== 1) {
        errors.push(`${id} must review ${dimension} exactly once`);
        continue;
      }
      const reviewed = matches[0]!;
      if (reviewed.disposition !== 'pass') {
        errors.push(`${id}.${dimension} disposition must pass`);
      }
      if (reviewed.evidence !== VISUAL_DIMENSION_EVIDENCE[dimension]) {
        errors.push(`${id}.${dimension} evidence is invalid`);
      }
    }
    if (comparison.reviewedDimensions.some((reviewed) =>
      !REQUIRED_VISUAL_DIMENSIONS.includes(reviewed?.dimension as VisualDimension))) {
      errors.push(`${id}.reviewedDimensions contains an unsupported dimension`);
    }
    if (!Array.isArray(comparison.findings)) {
      errors.push(`${id}.findings must be an array`);
    } else {
      for (const [index, finding] of comparison.findings.entries()) {
        if (!isRecord(finding)) {
          errors.push(`${id}.findings[${index}] must be an object`);
          continue;
        }
        verifyExactKeys(
          finding,
          `$.visualComparisons.${id}.findings[${index}]`,
          VISUAL_FINDING_KEYS,
          errors,
        );
        if (finding.priority !== 'P3') {
          errors.push(`${id} has unresolved material ${String(finding.priority ?? 'unknown')} drift`);
        }
        if (!REQUIRED_VISUAL_DIMENSIONS.includes(finding.dimension as VisualDimension)) {
          errors.push(`${id} finding dimension is invalid`);
        }
        if (finding.observation !== 'minor-drift') {
          errors.push(`${id} finding observation is invalid`);
        }
      }
    }
  }
}

function verifyDiagnostics(
  diagnostics: ReplacementQualityProof['diagnostics'] | undefined,
  errors: string[],
): void {
  if (!Array.isArray(diagnostics) || diagnostics.length !== 1) {
    errors.push('diagnostics must contain only optional-action-quality');
    return;
  }
  const diagnostic = diagnostics[0];
  if (isRecord(diagnostic)) {
    verifyExactKeys(diagnostic, '$.diagnostics[0]', DIAGNOSTIC_KEYS, errors);
  } else {
    errors.push('diagnostics[0] must be an object');
    return;
  }
  if (diagnostic?.id !== 'optional-action-quality' || diagnostic.result !== 'diagnostic') {
    errors.push('optional action quality must remain diagnostic');
  }
  if (!['present', 'absent', 'not-exercised'].includes(diagnostic?.observation ?? '')) {
    errors.push('optional action observation is invalid');
  }
}

async function verifyCapture(
  capture: Capture | undefined,
  artifactPath: string,
  field: string,
  dimensions: { width: number; height: number },
  errors: string[],
): Promise<void> {
  if (!capture || typeof capture.path !== 'string' || typeof capture.sha256 !== 'string') {
    errors.push(`${field} is invalid`);
    return;
  }
  verifyCaptureShape(capture, `$.${field}`, errors);
  const path = await resolveArtifactFile(artifactPath, capture.path);
  if (!path || !SHA256.test(capture.sha256)) {
    errors.push(`${field} must use a safe relative path and SHA-256`);
    return;
  }
  await verifyFileHash(path, capture.sha256, field, errors);
  await verifyImageFile(path, field, dimensions, errors);
}

async function verifyFileHash(
  path: string,
  expected: string,
  field: string,
  errors: string[],
): Promise<void> {
  try {
    const bytes = await readFile(path);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== expected) errors.push(`${field} SHA-256 does not match ${path}`);
  } catch {
    errors.push(`${field} file is unavailable: ${path}`);
  }
}

async function resolveArtifactFile(artifactPath: string, path: string): Promise<string | null> {
  const parts = path.split('/');
  if (
    isAbsolute(path)
    || !SAFE_ARTIFACT_PATH.test(path)
    || parts.some((part) => part === '' || part === '.' || part === '..')
  ) {
    return null;
  }
  try {
    const artifactDirectory = await realpath(dirname(artifactPath));
    let candidate = artifactDirectory;
    for (const part of parts) {
      candidate = resolve(candidate, part);
      const stats = await lstat(candidate);
      if (stats.isSymbolicLink()) return null;
    }
    const resolvedTarget = await realpath(candidate);
    const fromRoot = relative(artifactDirectory, resolvedTarget);
    if (!fromRoot || fromRoot.startsWith(`..${sep}`) || fromRoot === '..' || isAbsolute(fromRoot)) {
      return null;
    }
    return resolvedTarget;
  } catch {
    return null;
  }
}

function scanForSensitiveData(value: unknown, path: string, errors: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForSensitiveData(item, `${path}[${index}]`, errors));
    return;
  }
  if (!isRecord(value)) {
    if (typeof value === 'string') {
      if (/https?:\/\//i.test(value)) errors.push(`${path} contains a URL`);
      if (
        /(?:bearer\s+|sk-[a-z0-9_-]{8,}|gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|xox[baprs]-[a-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i.test(value)
      ) {
        errors.push(`${path} contains credential-like text`);
      }
    }
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.replace(/[^a-z]/gi, '').toLowerCase();
    if (/(provider|model|prompt|payload|credential|authorization|cookie|secret|token|privateurl)/.test(normalized)) {
      errors.push(`${path}.${key} is forbidden in proof artifacts`);
    }
    scanForSensitiveData(item, `${path}.${key}`, errors);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function verifyExactKeys(
  value: Record<string, unknown>,
  path: string,
  allowed: readonly string[],
  errors: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${path}.${key} is not allowed`);
  }
}

function verifyCaptureShape(capture: unknown, path: string, errors: string[]): void {
  if (isRecord(capture)) verifyExactKeys(capture, path, CAPTURE_KEYS, errors);
}

async function verifyImageFile(
  path: string,
  field: string,
  dimensions: { width: number; height: number },
  errors: string[],
): Promise<void> {
  try {
    const metadata = await sharp(path).metadata();
    if (metadata.format !== 'png') errors.push(`${field} must be a PNG image`);
    if (metadata.width !== dimensions.width || metadata.height !== dimensions.height) {
      errors.push(`${field} must be ${dimensions.width}x${dimensions.height}`);
    }
  } catch {
    errors.push(`${field} must be a readable PNG image`);
  }
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

async function main(): Promise<void> {
  const artifactArgument = process.argv[2];
  const expectedBaseSha = process.argv[3];
  if (!artifactArgument || !expectedBaseSha || !GIT_SHA.test(expectedBaseSha)) {
    throw new Error('Usage: replacement-quality-proof <artifact.json> <expected-base-sha>');
  }
  const artifactPath = resolve(artifactArgument);
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const [{ stdout }, { stdout: parentStdout }, source] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot }),
    execFileAsync('git', ['rev-parse', 'HEAD^'], { cwd: repositoryRoot }),
    readFile(artifactPath, 'utf8'),
  ]);
  const expectedHeadSha = stdout.trim();
  const expectedReviewedSourceHeadSha = parentStdout.trim();
  const errors = await verifyReplacementQualityProof(JSON.parse(source), {
    artifactPath,
    repositoryRoot,
    expectedHeadSha,
    expectedBaseSha,
    expectedReviewedSourceHeadSha,
  });
  if (errors.length > 0) {
    for (const error of errors) console.error(`replacement-quality-proof: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({
    status: 'pass',
    headSha: expectedHeadSha,
    artifactSha256: createHash('sha256').update(source).digest('hex'),
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
