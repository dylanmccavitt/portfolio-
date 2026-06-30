import { createHash, randomUUID } from 'node:crypto';
import type { JsonRecord, RepoVisibility } from './schema';

export const PORTFOLIO_CANDIDATE_TOPIC = 'portfolio-candidate';

export interface GithubRepositorySnapshot {
  owner: string;
  name: string;
  fullName?: string;
  htmlUrl: string;
  description?: string | null;
  homepageUrl?: string | null;
  language?: string | null;
  topics: string[];
  isPrivate: boolean;
  defaultBranch?: string | null;
  pushedAt?: string | null;
  stars?: number | null;
  readmeMarkdown?: string | null;
}

export interface GithubDiscoveryScanInput {
  actor: string;
  repo: GithubRepositorySnapshot;
  trigger?: 'manual' | 'test';
  allowlistTopic?: string;
}

export type GithubDiscoveryScanResult =
  | {
      status: 'qualified';
      scanRunId: string;
      candidateId: string;
      evidenceIds: string[];
      confidence: number;
      audit: JsonRecord;
    }
  | {
      status: 'rejected';
      scanRunId: string;
      reason: string;
      audit: JsonRecord;
    };

export interface GithubDiscoveryQueryable {
  query<Row = unknown>(sql: string, params?: unknown[]): Promise<{ rows: Row[] } | Row[]>;
}

type InsertEvidenceInput = {
  id: string;
  candidateId: string;
  sourceType: 'repo' | 'readme';
  sourceUrl: string | null;
  sourceRef: string;
  repoVisibility: RepoVisibility;
  extractedText: string | null;
  privacyState: 'safe_public' | 'private_allowed_for_draft';
  claimMap: JsonRecord;
};

export async function scanGithubRepositoryCandidate(
  db: GithubDiscoveryQueryable,
  input: GithubDiscoveryScanInput,
): Promise<GithubDiscoveryScanResult> {
  const allowlistTopic = input.allowlistTopic ?? PORTFOLIO_CANDIDATE_TOPIC;
  const repo = normalizeRepoSnapshot(input.repo);
  const trigger = input.trigger ?? 'manual';
  const scanRunId = `scan_${randomUUID()}`;
  const startedAt = new Date().toISOString();
  const repoScope = {
    provider: 'github',
    repo: repo.fullName,
    url: repo.isPrivate ? null : repo.htmlUrl,
    allowlistTopic,
  } satisfies JsonRecord;

  await db.query(
    `INSERT INTO scan_runs (id, trigger, actor, repo_scope, lifecycle_state, started_at)
     VALUES ($1, $2, $3, $4::jsonb, 'running', $5)`,
    [scanRunId, trigger, input.actor, JSON.stringify(repoScope), startedAt],
  );

  try {
    const audit = buildAudit(repo, allowlistTopic);

    if (!audit.allowlisted) {
      const reason = `missing required GitHub topic: ${allowlistTopic}`;
      await completeScanRun(db, scanRunId, {
        scanned: 1,
        candidates: 0,
        evidence: 0,
        rejected: 1,
        reason,
        audit,
      });

      return { status: 'rejected', scanRunId, reason, audit };
    }

    const candidateId = `candidate_${randomUUID()}`;
    const repoVisibility: RepoVisibility = repo.isPrivate ? 'private' : 'public';
    const privacyState = repo.isPrivate ? 'private_allowed_for_draft' : 'safe_public';
    const confidence = scoreCandidate(repo, allowlistTopic);
    const signals = buildSignals(repo, allowlistTopic);
    const evidencePacket = {
      audit,
      repo: repo.fullName,
      evidencePolicy: repo.isPrivate
        ? 'private evidence may support draft review only and is not a public source'
        : 'public repository evidence is available for human review',
    } satisfies JsonRecord;

    await db.query(
      `INSERT INTO project_candidates (
         id, scan_run_id, source_kind, source_ref, repo_visibility, signals,
         confidence, evidence_packet, lifecycle_state
       ) VALUES ($1, $2, 'github_repo', $3, $4, $5::jsonb, $6, $7::jsonb, 'qualified')`,
      [
        candidateId,
        scanRunId,
        repo.htmlUrl,
        repoVisibility,
        JSON.stringify(signals),
        confidence,
        JSON.stringify(evidencePacket),
      ],
    );

    const evidenceInputs = buildEvidenceInputs(repo, candidateId, repoVisibility, privacyState, audit);
    for (const evidence of evidenceInputs) {
      await insertEvidenceSource(db, evidence);
    }

    await db.query(
      `INSERT INTO review_events (id, candidate_id, actor, action, before_state, after_state, notes, metadata)
       VALUES ($1, $2, $3, 'candidate_qualified', 'detected', 'qualified', $4, $5::jsonb)`,
      [
        `review_${randomUUID()}`,
        candidateId,
        input.actor,
        `Qualified by allowlist topic ${allowlistTopic}.`,
        JSON.stringify({ audit, confidence, scanRunId }),
      ],
    );

    await completeScanRun(db, scanRunId, {
      scanned: 1,
      candidates: 1,
      evidence: evidenceInputs.length,
      rejected: 0,
      privateEvidence: repo.isPrivate ? evidenceInputs.length : 0,
      audit,
    });

    return {
      status: 'qualified',
      scanRunId,
      candidateId,
      evidenceIds: evidenceInputs.map((evidence) => evidence.id),
      confidence,
      audit,
    };
  } catch (error) {
    await failScanRun(db, scanRunId, error);
    throw error;
  }
}

function normalizeRepoSnapshot(repo: GithubRepositorySnapshot): GithubRepositorySnapshot & { fullName: string } {
  const owner = repo.owner.trim();
  const name = repo.name.trim();
  if (!owner || !name) throw new Error('GitHub repository snapshot requires owner and name.');
  if (!repo.htmlUrl.trim()) throw new Error('GitHub repository snapshot requires htmlUrl.');

  return {
    ...repo,
    owner,
    name,
    fullName: repo.fullName?.trim() || `${owner}/${name}`,
    htmlUrl: repo.htmlUrl.trim(),
    topics: repo.topics.map((topic) => topic.trim().toLowerCase()).filter(Boolean),
  };
}

function buildAudit(repo: GithubRepositorySnapshot & { fullName: string }, allowlistTopic: string): JsonRecord {
  const allowlisted = repo.topics.includes(allowlistTopic);
  return {
    allowlisted,
    allowlistTopic,
    matchedTopics: allowlisted ? [allowlistTopic] : [],
    rejectedReason: allowlisted ? null : `missing required GitHub topic: ${allowlistTopic}`,
    scannerMode: 'manual-snapshot',
    mutatesRepository: false,
    repoVisibility: repo.isPrivate ? 'private' : 'public',
  };
}

function buildSignals(repo: GithubRepositorySnapshot & { fullName: string }, allowlistTopic: string): JsonRecord {
  return {
    repo: repo.fullName,
    topics: repo.topics,
    allowlistTopic,
    descriptionPresent: Boolean(repo.description?.trim()),
    readmePresent: Boolean(repo.readmeMarkdown?.trim()),
    language: repo.language ?? null,
    stars: repo.stars ?? null,
    pushedAt: repo.pushedAt ?? null,
    homepageUrl: repo.homepageUrl ?? null,
  };
}

function scoreCandidate(repo: GithubRepositorySnapshot & { fullName: string }, allowlistTopic: string): number {
  let score = repo.topics.includes(allowlistTopic) ? 0.72 : 0;
  if (repo.description?.trim()) score += 0.08;
  if (repo.readmeMarkdown?.trim()) score += 0.1;
  if (repo.homepageUrl?.trim()) score += 0.04;
  if ((repo.stars ?? 0) > 0) score += 0.03;
  if (repo.pushedAt) score += 0.03;
  return Math.min(1, Number(score.toFixed(4)));
}

function buildEvidenceInputs(
  repo: GithubRepositorySnapshot & { fullName: string },
  candidateId: string,
  repoVisibility: RepoVisibility,
  privacyState: 'safe_public' | 'private_allowed_for_draft',
  audit: JsonRecord,
): InsertEvidenceInput[] {
  const sourceUrl = repo.isPrivate ? null : repo.htmlUrl;
  const evidence: InsertEvidenceInput[] = [
    {
      id: `evidence_${randomUUID()}`,
      candidateId,
      sourceType: 'repo',
      sourceUrl,
      sourceRef: repo.fullName,
      repoVisibility,
      extractedText: repo.description?.trim() || null,
      privacyState,
      claimMap: {
        audit,
        fields: ['description', 'topics', 'language', 'homepageUrl'],
        publicSourceEligible: !repo.isPrivate,
      },
    },
  ];

  const readme = repo.readmeMarkdown?.trim();
  if (readme) {
    evidence.push({
      id: `evidence_${randomUUID()}`,
      candidateId,
      sourceType: 'readme',
      sourceUrl: repo.isPrivate ? null : `${repo.htmlUrl}#readme`,
      sourceRef: `${repo.fullName}:README`,
      repoVisibility,
      extractedText: readme,
      privacyState,
      claimMap: {
        audit,
        fields: ['readmeMarkdown'],
        publicSourceEligible: !repo.isPrivate,
      },
    });
  }

  return evidence;
}

async function insertEvidenceSource(db: GithubDiscoveryQueryable, evidence: InsertEvidenceInput): Promise<void> {
  await db.query(
    `INSERT INTO evidence_sources (
       id, candidate_id, source_type, source_url, source_ref, repo_visibility,
       extracted_text, extracted_text_sha256, privacy_state, claim_map
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
    [
      evidence.id,
      evidence.candidateId,
      evidence.sourceType,
      evidence.sourceUrl,
      evidence.sourceRef,
      evidence.repoVisibility,
      evidence.extractedText,
      evidence.extractedText ? sha256(evidence.extractedText) : null,
      evidence.privacyState,
      JSON.stringify(evidence.claimMap),
    ],
  );
}

async function completeScanRun(db: GithubDiscoveryQueryable, scanRunId: string, resultCounts: JsonRecord): Promise<void> {
  await db.query(
    `UPDATE scan_runs
     SET lifecycle_state = 'completed', result_counts = $2::jsonb, finished_at = $3
     WHERE id = $1`,
    [scanRunId, JSON.stringify(resultCounts), new Date().toISOString()],
  );
}

async function failScanRun(db: GithubDiscoveryQueryable, scanRunId: string, error: unknown): Promise<void> {
  await db.query(
    `UPDATE scan_runs
     SET lifecycle_state = 'failed', error_message = $2, finished_at = $3
     WHERE id = $1`,
    [scanRunId, error instanceof Error ? error.message : String(error), new Date().toISOString()],
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
