import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations, type Queryable } from '../scripts/db';
import {
  PORTFOLIO_CANDIDATE_TOPIC,
  scanGithubRepositoryCandidate,
  type GithubDiscoveryQueryable,
  type GithubRepositorySnapshot,
} from '@/lib/db/github-discovery';

function createTestDb(): Queryable {
  return new PGlite() as Queryable;
}

async function createMigratedDb(): Promise<Queryable> {
  const db = createTestDb();
  await applyMigrations(db);
  return db;
}

const PUBLIC_REPO: GithubRepositorySnapshot = {
  owner: 'DylanMcCavitt',
  name: 'portfolio-candidate-app',
  htmlUrl: 'https://github.com/DylanMcCavitt/portfolio-candidate-app',
  description: 'A small workflow app worth reviewing for the portfolio.',
  homepageUrl: 'https://example.com/candidate',
  language: 'TypeScript',
  topics: [PORTFOLIO_CANDIDATE_TOPIC, 'astro'],
  isPrivate: false,
  defaultBranch: 'main',
  pushedAt: '2026-06-01T00:00:00.000Z',
  stars: 1,
  readmeMarkdown: '# Candidate app\n\nShips a real workflow.',
};

test('allowlisted GitHub repo creates scan run candidate evidence and audit records', async () => {
  const db = await createMigratedDb();

  const result = await scanGithubRepositoryCandidate(db, {
    actor: 'age-729-test',
    trigger: 'test',
    repo: PUBLIC_REPO,
  });

  assert.equal(result.status, 'qualified');
  assert.ok(result.confidence > 0.7);
  assert.equal(result.audit.allowlisted, true);
  assert.equal(result.audit.mutatesRepository, false);

  const scanRuns = await db.query<{ lifecycle_state: string; result_counts: Record<string, unknown> }>(
    `SELECT lifecycle_state, result_counts FROM scan_runs WHERE id = $1`,
    [result.scanRunId],
  );
  assert.deepEqual(scanRuns.rows, [
    {
      lifecycle_state: 'completed',
      result_counts: {
        scanned: 1,
        candidates: 1,
        evidence: 2,
        rejected: 0,
        privateEvidence: 0,
        audit: result.audit,
      },
    },
  ]);

  const candidates = await db.query<{
    id: string;
    source_kind: string;
    source_ref: string;
    repo_visibility: string;
    lifecycle_state: string;
    confidence: string | number;
    evidence_packet: { audit: Record<string, unknown>; evidencePolicy?: string };
  }>(`SELECT * FROM project_candidates WHERE scan_run_id = $1`, [result.scanRunId]);
  assert.equal(candidates.rows.length, 1);
  assert.equal(candidates.rows[0]?.id, result.candidateId);
  assert.equal(candidates.rows[0]?.source_kind, 'github_repo');
  assert.equal(candidates.rows[0]?.source_ref, PUBLIC_REPO.htmlUrl);
  assert.equal(candidates.rows[0]?.repo_visibility, 'public');
  assert.equal(candidates.rows[0]?.lifecycle_state, 'qualified');
  assert.equal(Number(candidates.rows[0]?.confidence), result.confidence);
  assert.equal(candidates.rows[0]?.evidence_packet.audit.allowlisted, true);

  const evidence = await db.query<{
    source_type: string;
    source_url: string | null;
    source_ref: string;
    repo_visibility: string;
    extracted_text_sha256: string | null;
    privacy_state: string;
    claim_map: Record<string, unknown>;
  }>(`SELECT * FROM evidence_sources WHERE candidate_id = $1 ORDER BY source_type`, [result.candidateId]);
  assert.equal(evidence.rows.length, 2);
  assert.deepEqual(
    evidence.rows.map((row) => row.source_type),
    ['readme', 'repo'],
  );
  for (const row of evidence.rows) {
    assert.equal(row.repo_visibility, 'public');
    assert.equal(row.privacy_state, 'safe_public');
    assert.ok(row.source_url?.startsWith(PUBLIC_REPO.htmlUrl));
    assert.equal(row.extracted_text_sha256?.length, 64);
    assert.equal(row.claim_map.publicSourceEligible, true);
  }

  const reviewEvents = await db.query<{ action: string; after_state: string; metadata: Record<string, unknown> }>(
    `SELECT action, after_state, metadata FROM review_events WHERE candidate_id = $1`,
    [result.candidateId],
  );
  assert.deepEqual(reviewEvents.rows, [
    {
      action: 'candidate_qualified',
      after_state: 'qualified',
      metadata: { audit: result.audit, confidence: result.confidence, scanRunId: result.scanRunId },
    },
  ]);

  const ragSources = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM rag_sources`);
  assert.equal(ragSources.rows[0]?.count, '0');
});

test('scan failure rethrows the original error when scan_runs bookkeeping also fails', async () => {
  const originalError = new Error('relation "scan_runs" does not exist');
  const bookkeepingError = new Error('bookkeeping update failed');
  let queryCount = 0;
  const db: GithubDiscoveryQueryable = {
    async query() {
      queryCount += 1;
      if (queryCount === 1) return { rows: [] };
      if (queryCount === 2) throw originalError;
      throw bookkeepingError;
    },
  };

  await assert.rejects(
    () =>
      scanGithubRepositoryCandidate(db, {
        actor: 'test',
        trigger: 'test',
        repo: {
          owner: 'DylanMcCavitt',
          name: 'portfolio-candidate-app',
          htmlUrl: 'https://github.com/DylanMcCavitt/portfolio-candidate-app',
          topics: [PORTFOLIO_CANDIDATE_TOPIC],
          isPrivate: false,
        },
      }),
    (error) => {
      assert.equal((error as Error).message, 'relation "scan_runs" does not exist');
      return true;
    },
  );
  assert.equal(queryCount, 3);
});

test('non-allowlisted GitHub repos are rejected with audit reason and no candidate records', async () => {
  const db = await createMigratedDb();

  const result = await scanGithubRepositoryCandidate(db, {
    actor: 'age-729-test',
    trigger: 'test',
    repo: {
      ...PUBLIC_REPO,
      name: 'ordinary-repo',
      htmlUrl: 'https://github.com/DylanMcCavitt/ordinary-repo',
      topics: ['astro'],
    },
  });

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, `missing required GitHub topic: ${PORTFOLIO_CANDIDATE_TOPIC}`);
  assert.equal(result.audit.allowlisted, false);
  assert.equal(result.audit.rejectedReason, result.reason);

  const scanRuns = await db.query<{ lifecycle_state: string; result_counts: Record<string, unknown> }>(
    `SELECT lifecycle_state, result_counts FROM scan_runs WHERE id = $1`,
    [result.scanRunId],
  );
  assert.equal(scanRuns.rows[0]?.lifecycle_state, 'completed');
  assert.deepEqual(scanRuns.rows[0]?.result_counts, {
    scanned: 1,
    candidates: 0,
    evidence: 0,
    rejected: 1,
    reason: result.reason,
    audit: result.audit,
  });

  const candidates = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM project_candidates`);
  assert.equal(candidates.rows[0]?.count, '0');

  const evidence = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM evidence_sources`);
  assert.equal(evidence.rows[0]?.count, '0');
});

test('private repo evidence is non-public draft-only evidence', async () => {
  const db = await createMigratedDb();

  const result = await scanGithubRepositoryCandidate(db, {
    actor: 'age-729-test',
    trigger: 'test',
    repo: {
      ...PUBLIC_REPO,
      name: 'private-candidate-app',
      htmlUrl: 'https://github.com/DylanMcCavitt/private-candidate-app',
      isPrivate: true,
    },
  });

  assert.equal(result.status, 'qualified');

  const candidates = await db.query<{ repo_visibility: string; evidence_packet: Record<string, unknown> }>(
    `SELECT repo_visibility, evidence_packet FROM project_candidates WHERE id = $1`,
    [result.candidateId],
  );
  assert.equal(candidates.rows[0]?.repo_visibility, 'private');
  assert.equal(
    candidates.rows[0]?.evidence_packet.evidencePolicy,
    'private evidence may support draft review only and is not a public source',
  );

  const evidence = await db.query<{
    source_url: string | null;
    repo_visibility: string;
    privacy_state: string;
    claim_map: Record<string, unknown>;
  }>(`SELECT source_url, repo_visibility, privacy_state, claim_map FROM evidence_sources WHERE candidate_id = $1`, [
    result.candidateId,
  ]);
  assert.equal(evidence.rows.length, 2);
  for (const row of evidence.rows) {
    assert.equal(row.source_url, null);
    assert.equal(row.repo_visibility, 'private');
    assert.equal(row.privacy_state, 'private_allowed_for_draft');
    assert.equal(row.claim_map.publicSourceEligible, false);
  }

  const ragSources = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM rag_sources`);
  assert.equal(ragSources.rows[0]?.count, '0');
});

test('scanner treats repository snapshots as read-only input', async () => {
  const db = await createMigratedDb();
  const repo: GithubRepositorySnapshot = {
    ...PUBLIC_REPO,
    topics: [...PUBLIC_REPO.topics],
  };
  const before = structuredClone(repo);

  await scanGithubRepositoryCandidate(db, {
    actor: 'age-729-test',
    trigger: 'test',
    repo,
  });

  assert.deepEqual(repo, before);
});
