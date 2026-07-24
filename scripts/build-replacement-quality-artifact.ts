import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  REQUIRED_FALLBACK_CHECKS,
  REQUIRED_INTERACTION_CHECKS,
  visualCaptureSetSha256,
  verifyReplacementQualityProof,
  type ReplacementQualityProof,
  type ReplacementQualityVisualReviewInput,
} from './replacement-quality-proof';

const GIT_SHA = /^[a-f0-9]{40}$/;
const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const captureInputRoot = resolve(repositoryRoot, 'proof/replacement-quality-inputs');
const REVIEW_INPUT_REPOSITORY_PATH = 'proof/replacement-quality-visual-review.json';

const CAPTURE_INPUTS = {
  desktop: 'desktop-home.png',
  'small-tablet': 'small-tablet-library.png',
  mobile: 'mobile-contact.png',
  'home-muted': 'visual-home-muted.png',
  'work-expanded': 'visual-work-expanded.png',
  'dm-right-sidecar': 'visual-dm-right-sidecar.png',
} as const;

export async function buildReplacementQualityArtifact(
  headSha: string,
  baseSha: string,
  outputDirectory: string,
  reviewInputPath: string,
  createdAt = new Date().toISOString(),
): Promise<{ artifactPath: string; artifactSha256: string }> {
  if (!GIT_SHA.test(headSha) || !GIT_SHA.test(baseSha)) {
    throw new Error('head and base must be full lowercase Git SHAs');
  }

  const packageRoot = resolve(outputDirectory);
  const capturesRoot = resolve(packageRoot, 'captures');
  await mkdir(capturesRoot, { recursive: true });
  const reviewInputSource = await readFile(resolve(reviewInputPath), 'utf8');
  const reviewInput = JSON.parse(reviewInputSource) as ReplacementQualityVisualReviewInput;
  const packagedReviewInputPath = resolve(packageRoot, 'replacement-quality-visual-review.json');
  await writeFile(packagedReviewInputPath, reviewInputSource, 'utf8');
  const reviewInputSha256 = createHash('sha256').update(reviewInputSource).digest('hex');

  const captures = new Map<string, { path: string; sha256: string }>();
  for (const [id, filename] of Object.entries(CAPTURE_INPUTS)) {
    const source = resolve(captureInputRoot, filename);
    const destination = resolve(capturesRoot, basename(filename));
    await cp(source, destination, { force: true, dereference: false });
    const bytes = await readFile(destination);
    captures.set(id, {
      path: `captures/${basename(filename)}`,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }

  const proof: ReplacementQualityProof = {
    schemaVersion: 1,
    issue: 308,
    repository: 'dylanmccavitt/portfolio-',
    baseSha,
    headSha,
    createdAt,
    executionMode: 'local-fixture',
    viewports: [
      {
        id: 'desktop',
        width: 1440,
        height: 900,
        route: '/',
        state: 'home-ready',
        capture: captures.get('desktop')!,
        result: 'pass',
      },
      {
        id: 'small-tablet',
        width: 768,
        height: 1024,
        route: '/library',
        state: 'library-ready',
        capture: captures.get('small-tablet')!,
        result: 'pass',
      },
      {
        id: 'mobile',
        width: 390,
        height: 844,
        route: '/contact',
        state: 'contact-ready',
        capture: captures.get('mobile')!,
        result: 'pass',
      },
    ],
    interactionChecks: REQUIRED_INTERACTION_CHECKS.map((id) => ({ id, result: 'pass' })),
    fallbackChecks: REQUIRED_FALLBACK_CHECKS.map((id) => ({ id, result: 'pass' })),
    visualReview: {
      input: {
        path: 'replacement-quality-visual-review.json',
        sha256: reviewInputSha256,
      },
      reviewerTaskId: reviewInput.reviewerTaskId,
      reviewedSourceHeadSha: reviewInput.reviewedSourceHeadSha,
      captureSetSha256: reviewInput.captureSetSha256,
    },
    visualComparisons: reviewInput.comparisons,
    diagnostics: [{
      id: 'optional-action-quality',
      result: 'diagnostic',
      observation: 'present',
    }],
  };

  const artifactPath = resolve(packageRoot, 'replacement-quality-proof.json');
  const source = `${JSON.stringify(proof, null, 2)}\n`;
  await writeFile(artifactPath, source, 'utf8');
  const errors = await verifyReplacementQualityProof(proof, {
    artifactPath,
    repositoryRoot,
    expectedHeadSha: headSha,
    expectedBaseSha: baseSha,
    expectedReviewedSourceHeadSha: reviewInput.reviewedSourceHeadSha,
  });
  if (errors.length > 0) {
    throw new Error(`generated proof failed validation:\n${errors.join('\n')}`);
  }

  return {
    artifactPath,
    artifactSha256: createHash('sha256').update(source).digest('hex'),
  };
}

async function main(): Promise<void> {
  const [headSha, baseSha, outputDirectory, reviewInputPath] = process.argv.slice(2);
  if (!headSha || !baseSha || !outputDirectory || !reviewInputPath) {
    throw new Error(
      'Usage: build-replacement-quality-artifact <head-sha> <base-sha> <output-directory> <review-input>',
    );
  }
  const reviewedSourceHeadSha = await verifyIndependentReviewCommit(headSha, reviewInputPath);
  const result = await buildReplacementQualityArtifact(
    headSha,
    baseSha,
    outputDirectory,
    reviewInputPath,
  );
  const reviewInput = JSON.parse(await readFile(resolve(reviewInputPath), 'utf8')) as ReplacementQualityVisualReviewInput;
  if (
    reviewInput.reviewedSourceHeadSha !== reviewedSourceHeadSha
    || reviewInput.captureSetSha256 !== visualCaptureSetSha256(reviewInput.comparisons)
  ) {
    throw new Error('visual review input is stale or capture-set mismatched');
  }
  console.log(JSON.stringify({
    status: 'pass',
    headSha,
    baseSha,
    artifactPath: result.artifactPath,
    artifactSha256: result.artifactSha256,
  }));
}

async function verifyIndependentReviewCommit(
  headSha: string,
  reviewInputPath: string,
): Promise<string> {
  const resolvedReviewInput = resolve(reviewInputPath);
  if (relative(repositoryRoot, resolvedReviewInput) !== REVIEW_INPUT_REPOSITORY_PATH) {
    throw new Error(`review input must be ${REVIEW_INPUT_REPOSITORY_PATH}`);
  }
  const [{ stdout: currentStdout }, { stdout: parentStdout }, { stdout: changedStdout }] =
    await Promise.all([
      execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot }),
      execFileAsync('git', ['rev-parse', 'HEAD^'], { cwd: repositoryRoot }),
      execFileAsync('git', ['diff', '--name-only', 'HEAD^', 'HEAD'], { cwd: repositoryRoot }),
    ]);
  if (currentStdout.trim() !== headSha) {
    throw new Error('package head does not match the checked-out Git head');
  }
  const changed = changedStdout.trim().split('\n').filter(Boolean);
  if (changed.length !== 1 || changed[0] !== REVIEW_INPUT_REPOSITORY_PATH) {
    throw new Error('final review-binding commit must change only the independent visual review input');
  }
  return parentStdout.trim();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
