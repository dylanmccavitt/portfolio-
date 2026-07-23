import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const SAFE_ARTIFACT_PATH = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;

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
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  summary: string;
}

interface VisualComparison {
  id: VisualId;
  reference: Capture;
  capture: Capture;
  reviewedDimensions: VisualDimension[];
  findings: VisualFinding[];
  result: CheckResult;
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
}

export async function verifyReplacementQualityProof(
  value: unknown,
  options: VerifyProofOptions,
): Promise<string[]> {
  const errors: string[] = [];
  if (!isRecord(value)) return ['artifact must be a JSON object'];
  scanForSensitiveData(value, '$', errors);

  const proof = value as Partial<ReplacementQualityProof>;
  if (proof.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (proof.issue !== 308) errors.push('issue must be 308');
  if (proof.repository !== 'dylanmccavitt/portfolio-') {
    errors.push('repository must be dylanmccavitt/portfolio-');
  }
  if (!GIT_SHA.test(proof.baseSha ?? '')) errors.push('baseSha must be a full Git SHA');
  if (!GIT_SHA.test(proof.headSha ?? '')) errors.push('headSha must be a full Git SHA');
  if (proof.headSha !== options.expectedHeadSha) {
    errors.push(`headSha must match the exact current head ${options.expectedHeadSha}`);
  }
  if (!proof.createdAt || Number.isNaN(Date.parse(proof.createdAt))) {
    errors.push('createdAt must be an ISO timestamp');
  }
  if (proof.executionMode !== 'local-fixture') {
    errors.push('executionMode must be local-fixture');
  }

  await verifyViewports(proof.viewports, options, errors);
  verifyNamedChecks('interactionChecks', proof.interactionChecks, REQUIRED_INTERACTION_CHECKS, errors);
  verifyNamedChecks('fallbackChecks', proof.fallbackChecks, REQUIRED_FALLBACK_CHECKS, errors);
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
  for (const [id, dimensions] of Object.entries(REQUIRED_VIEWPORTS) as Array<[ViewportId, { width: number; height: number }]>) {
    const viewport = viewports.find((candidate) => candidate?.id === id);
    if (!viewport) {
      errors.push(`viewports is missing ${id}`);
      continue;
    }
    if (viewport.width !== dimensions.width || viewport.height !== dimensions.height) {
      errors.push(`${id} must be ${dimensions.width}x${dimensions.height}`);
    }
    if (!viewport.route?.startsWith('/') || viewport.route.includes('?') || viewport.route.includes('#')) {
      errors.push(`${id}.route must be a public pathname`);
    }
    if (!viewport.state?.trim()) errors.push(`${id}.state is required`);
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
  for (const id of required) {
    const matches = checks.filter((check) => check?.id === id);
    if (matches.length !== 1) errors.push(`${field} must contain ${id} exactly once`);
    else if (matches[0]?.result !== 'pass') errors.push(`${field}.${id} must pass`);
  }
  if (checks.some((check) => !required.includes(check?.id))) {
    errors.push(`${field} contains an unsupported check id`);
  }
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
  for (const [id, binding] of Object.entries(VISUAL_REFERENCE_BINDINGS) as Array<[VisualId, Capture]>) {
    const comparison = comparisons.find((candidate) => candidate?.id === id);
    if (!comparison) {
      errors.push(`visualComparisons is missing ${id}`);
      continue;
    }
    if (comparison.reference?.path !== binding.path || comparison.reference?.sha256 !== binding.sha256) {
      errors.push(`${id}.reference must match the binding reference`);
    } else {
      await verifyFileHash(resolve(options.repositoryRoot, binding.path), binding.sha256, `${id}.reference`, errors);
    }
    await verifyCapture(comparison.capture, options.artifactPath, `${id}.capture`, undefined, errors);
    if (comparison.result !== 'pass') errors.push(`${id}.result must be pass`);
    const dimensions = new Set(comparison.reviewedDimensions);
    for (const dimension of REQUIRED_VISUAL_DIMENSIONS) {
      if (!dimensions.has(dimension)) errors.push(`${id} did not review ${dimension}`);
    }
    if (dimensions.size !== REQUIRED_VISUAL_DIMENSIONS.length) {
      errors.push(`${id}.reviewedDimensions contains unsupported or duplicate values`);
    }
    if (!Array.isArray(comparison.findings)) {
      errors.push(`${id}.findings must be an array`);
    } else {
      for (const finding of comparison.findings) {
        if (finding.priority !== 'P3') {
          errors.push(`${id} has unresolved material ${finding.priority ?? 'unknown'} drift`);
        }
        if (!finding.summary?.trim()) errors.push(`${id} finding summaries must not be empty`);
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
  dimensions: { width: number; height: number } | undefined,
  errors: string[],
): Promise<void> {
  if (!capture || typeof capture.path !== 'string' || typeof capture.sha256 !== 'string') {
    errors.push(`${field} is invalid`);
    return;
  }
  const path = resolveArtifactFile(artifactPath, capture.path);
  if (!path || !SHA256.test(capture.sha256)) {
    errors.push(`${field} must use a safe relative path and SHA-256`);
    return;
  }
  await verifyFileHash(path, capture.sha256, field, errors);
  if (!dimensions) return;
  try {
    const metadata = await sharp(path).metadata();
    if (metadata.width !== dimensions.width || metadata.height !== dimensions.height) {
      errors.push(`${field} must be ${dimensions.width}x${dimensions.height}`);
    }
  } catch {
    errors.push(`${field} must be a readable image`);
  }
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

function resolveArtifactFile(artifactPath: string, path: string): string | null {
  if (isAbsolute(path) || !SAFE_ARTIFACT_PATH.test(path) || path.split('/').includes('..')) return null;
  return resolve(dirname(artifactPath), path);
}

function scanForSensitiveData(value: unknown, path: string, errors: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForSensitiveData(item, `${path}[${index}]`, errors));
    return;
  }
  if (!isRecord(value)) {
    if (typeof value === 'string') {
      if (/https?:\/\//i.test(value)) errors.push(`${path} contains a URL`);
      if (/(?:bearer\s+|sk-[a-z0-9_-]{8,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i.test(value)) {
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

async function main(): Promise<void> {
  const artifactArgument = process.argv[2];
  if (!artifactArgument) throw new Error('Usage: replacement-quality-proof <artifact.json>');
  const artifactPath = resolve(artifactArgument);
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const [{ stdout }, source] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot }),
    readFile(artifactPath, 'utf8'),
  ]);
  const expectedHeadSha = stdout.trim();
  const errors = await verifyReplacementQualityProof(JSON.parse(source), {
    artifactPath,
    repositoryRoot,
    expectedHeadSha,
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
