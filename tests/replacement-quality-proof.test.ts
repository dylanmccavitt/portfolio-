import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {
  REQUIRED_FALLBACK_CHECKS,
  REQUIRED_INTERACTION_CHECKS,
  REQUIRED_VIEWPORTS,
  REQUIRED_VISUAL_DIMENSIONS,
  VISUAL_REFERENCE_BINDINGS,
  verifyReplacementQualityProof,
  type ReplacementQualityProof,
} from '../scripts/replacement-quality-proof';

const repositoryRoot = resolve(new URL('..', import.meta.url).pathname);
const headSha = 'a'.repeat(40);

test('sanitized exact-head browser and visual proof passes every required gate', async (t) => {
  const fixture = await createFixture(t);
  const errors = await verifyReplacementQualityProof(fixture.proof, {
    artifactPath: fixture.artifactPath,
    repositoryRoot,
    expectedHeadSha: headSha,
  });
  assert.deepEqual(errors, []);
});

test('material drift, stale heads, missing checks, and sensitive fields fail closed', async (t) => {
  const fixture = await createFixture(t);
  const unsafe = structuredClone(fixture.proof) as ReplacementQualityProof & {
    prompt?: string;
  };
  unsafe.headSha = 'b'.repeat(40);
  unsafe.interactionChecks = unsafe.interactionChecks.filter((check) => check.id !== 'cancellation');
  unsafe.visualComparisons[0]!.findings.push({ priority: 'P2', summary: 'Layout drift.' });
  unsafe.prompt = 'must never persist';

  const errors = await verifyReplacementQualityProof(unsafe, {
    artifactPath: fixture.artifactPath,
    repositoryRoot,
    expectedHeadSha: headSha,
  });
  assert.ok(errors.some((error) => error.includes('exact current head')));
  assert.ok(errors.some((error) => error.includes('cancellation exactly once')));
  assert.ok(errors.some((error) => error.includes('material P2 drift')));
  assert.ok(errors.some((error) => error.includes('prompt is forbidden')));
});

test('optional action quality remains diagnostic and never becomes a presence veto', async (t) => {
  const fixture = await createFixture(t);
  fixture.proof.diagnostics[0]!.observation = 'absent';
  const errors = await verifyReplacementQualityProof(fixture.proof, {
    artifactPath: fixture.artifactPath,
    repositoryRoot,
    expectedHeadSha: headSha,
  });
  assert.deepEqual(errors, []);
});

async function createFixture(t: test.TestContext): Promise<{
  proof: ReplacementQualityProof;
  artifactPath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'replacement-quality-proof-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(directory, { recursive: true, force: true });
  });
  const captures = new Map<string, { path: string; sha256: string }>();
  for (const [id, dimensions] of Object.entries(REQUIRED_VIEWPORTS)) {
    const path = `${id}.png`;
    const bytes = await sharp({
      create: {
        width: dimensions.width,
        height: dimensions.height,
        channels: 3,
        background: '#101725',
      },
    }).png().toBuffer();
    await writeFile(join(directory, path), bytes);
    captures.set(id, { path, sha256: sha256(bytes) });
  }
  const artifactPath = join(directory, 'proof.json');
  await writeFile(artifactPath, '{}');

  const proof: ReplacementQualityProof = {
    schemaVersion: 1,
    issue: 308,
    repository: 'dylanmccavitt/portfolio-',
    baseSha: 'c'.repeat(40),
    headSha,
    createdAt: '2026-07-23T18:00:00.000Z',
    executionMode: 'local-fixture',
    viewports: Object.entries(REQUIRED_VIEWPORTS).map(([id, dimensions]) => ({
      id: id as keyof typeof REQUIRED_VIEWPORTS,
      ...dimensions,
      route: id === 'desktop' ? '/' : '/library',
      state: 'usable',
      capture: captures.get(id)!,
      result: 'pass',
    })),
    interactionChecks: REQUIRED_INTERACTION_CHECKS.map((id) => ({ id, result: 'pass' })),
    fallbackChecks: REQUIRED_FALLBACK_CHECKS.map((id) => ({ id, result: 'pass' })),
    visualComparisons: Object.entries(VISUAL_REFERENCE_BINDINGS).map(([id, reference]) => ({
      id: id as keyof typeof VISUAL_REFERENCE_BINDINGS,
      reference,
      capture: captures.get('desktop')!,
      reviewedDimensions: [...REQUIRED_VISUAL_DIMENSIONS],
      findings: [],
      result: 'pass',
    })),
    diagnostics: [{
      id: 'optional-action-quality',
      result: 'diagnostic',
      observation: 'not-exercised',
    }],
  };
  return { proof, artifactPath };
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
