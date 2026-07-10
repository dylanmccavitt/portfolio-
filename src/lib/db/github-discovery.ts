import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { JsonRecord, JsonValue, RepoVisibility } from './schema';
import {
  PublicProjectFieldsSchema,
  type PublicProjectFields,
} from '@/lib/projects/schema';

export const PORTFOLIO_CANDIDATE_TOPIC = 'portfolio-candidate';
export const PORTFOLIO_MANIFEST_MAX_BYTES = 64 * 1024;

export type PortfolioManifestSnapshot =
  | { status: 'missing' }
  | { status: 'present'; raw: string };

export interface GithubRepositorySnapshot {
  repositoryId: string;
  owner: string;
  name: string;
  fullName?: string;
  htmlUrl: string;
  description?: string | null;
  homepageUrl?: string | null;
  language?: string | null;
  topics: string[];
  isPrivate: boolean;
  defaultBranch: string;
  sourceRevision: string;
  pushedAt?: string | null;
  stars?: number | null;
  readmeMarkdown?: string | null;
  portfolioManifest: PortfolioManifestSnapshot;
}

export interface GithubDiscoveryScanInput {
  actor: string;
  repo: GithubRepositorySnapshot;
  trigger?: 'manual' | 'slack' | 'test';
  allowlistTopic?: string;
  scannerMode?: 'manual-snapshot' | 'live-github';
}

export type GithubDiscoveryScanResult =
  | {
      status: 'qualified';
      scanRunId: string;
      candidateId: string;
      draftId: string;
      projectId: string | null;
      evidenceIds: string[];
      confidence: number;
      proposalSource: 'manifest' | 'repository_evidence';
      audit: JsonRecord;
    }
  | {
      status: 'rejected';
      scanRunId: string;
      code:
        | 'not_allowlisted'
        | 'invalid_manifest'
        | 'candidate_dismissed'
        | 'active_revision_conflict'
        | 'revision_already_processed';
      reason: string;
      audit: JsonRecord;
    };

export interface GithubDiscoveryQueryable {
  query<Row = unknown>(sql: string, params?: unknown[]): Promise<{ rows: Row[] } | Row[]>;
}

type NormalizedRepo = GithubRepositorySnapshot & { fullName: string };
type CandidateRow = { id: string; lifecycle_state: string };
type SourceRow = { project_id: string | null };
type ProjectRow = PublicProjectFields & { id: string; publication_version: string | number };
type DraftRow = { id: string; lifecycle_state: string; source_revision: string };
type InsertEvidenceInput = {
  id: string;
  candidateId: string;
  sourceType: 'repo' | 'readme' | 'document';
  sourceUrl: string | null;
  sourceRef: string;
  repoVisibility: RepoVisibility;
  extractedText: string | null;
  privacyState: 'safe_public' | 'private_allowed_for_draft';
  claimMap: JsonRecord;
};

const PortfolioManifestV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  project: PublicProjectFieldsSchema,
});

class InvalidManifestError extends Error {
  readonly code = 'invalid_manifest';

  constructor(message: string) {
    super(message);
    this.name = 'InvalidManifestError';
  }
}

class ActiveRevisionConflictError extends Error {
  readonly code = 'active_revision_conflict';

  constructor() {
    super('another source revision became active during this scan; retry against the current GitHub HEAD');
    this.name = 'ActiveRevisionConflictError';
  }
}

export async function scanGithubRepositoryCandidate(
  db: GithubDiscoveryQueryable,
  input: GithubDiscoveryScanInput,
): Promise<GithubDiscoveryScanResult> {
  const allowlistTopic = input.allowlistTopic ?? PORTFOLIO_CANDIDATE_TOPIC;
  const repo = normalizeRepoSnapshot(input.repo);
  const trigger = input.trigger ?? 'manual';
  const scannerMode = input.scannerMode ?? 'manual-snapshot';
  const scanRunId = `scan_${randomUUID()}`;
  const startedAt = new Date().toISOString();
  const repoScope = {
    provider: 'github',
    repositoryId: repo.repositoryId,
    repo: repo.fullName,
    sourceRevision: repo.sourceRevision,
    url: repo.isPrivate ? null : repo.htmlUrl,
    allowlistTopic,
  } satisfies JsonRecord;

  await db.query(
    `INSERT INTO scan_runs (id, trigger, actor, repo_scope, lifecycle_state, started_at)
     VALUES ($1, $2, $3, $4::jsonb, 'running', $5)`,
    [scanRunId, trigger, input.actor, JSON.stringify(repoScope), startedAt],
  );

  try {
    const audit = buildAudit(repo, allowlistTopic, scannerMode);
    let manifestProject: PublicProjectFields | null;
    try {
      manifestProject = parsePortfolioManifest(repo.portfolioManifest);
    } catch (error) {
      if (!(error instanceof InvalidManifestError)) throw error;
      await rejectInvalidManifest(db, scanRunId, audit);
      return { status: 'rejected', scanRunId, code: 'invalid_manifest', reason: error.message, audit };
    }

    if (!audit.allowlisted) {
      const reason = `missing required GitHub topic: ${allowlistTopic}`;
      await completeScanRun(db, scanRunId, {
        scanned: 1,
        candidates: 0,
        drafts: 0,
        evidence: 0,
        rejected: 1,
        reason,
        audit,
      });
      return { status: 'rejected', scanRunId, code: 'not_allowlisted', reason, audit };
    }

    const contentFingerprint = fingerprintRepositoryContent(repo);
    const repoVisibility: RepoVisibility = repo.isPrivate ? 'private' : 'public';
    const privacyState = repo.isPrivate ? 'private_allowed_for_draft' : 'safe_public';
    const confidence = scoreCandidate(repo, allowlistTopic, Boolean(manifestProject));
    const signals = buildSignals(repo, allowlistTopic, Boolean(manifestProject));
    const evidencePacket = {
      audit,
      provider: 'github',
      repositoryId: repo.repositoryId,
      canonicalFullName: repo.fullName,
      sourceRevision: repo.sourceRevision,
      contentFingerprint,
      manifestStatus: repo.portfolioManifest.status,
      evidencePolicy: repo.isPrivate
        ? 'private evidence may support draft review only and is not a public source'
        : 'public repository evidence is available for human review',
    } satisfies JsonRecord;

    const candidate = normalizeRows(
      await db.query<CandidateRow>(
        `INSERT INTO project_candidates (
           id, scan_run_id, source_kind, source_ref, repo_visibility, signals,
           confidence, evidence_packet, lifecycle_state, provider, repository_id,
           source_revision, content_fingerprint
         ) VALUES (
           $1, $2, 'github_repo', $3, $4, $5::jsonb, $6, $7::jsonb, 'qualified',
           'github', $8, $9, $10
         )
         ON CONFLICT (provider, repository_id, source_revision)
           WHERE provider IS NOT NULL AND repository_id IS NOT NULL AND source_revision IS NOT NULL
         DO UPDATE SET
           scan_run_id = EXCLUDED.scan_run_id,
           source_ref = EXCLUDED.source_ref,
           repo_visibility = EXCLUDED.repo_visibility,
           signals = EXCLUDED.signals,
           confidence = EXCLUDED.confidence,
           evidence_packet = EXCLUDED.evidence_packet,
           content_fingerprint = EXCLUDED.content_fingerprint,
           updated_at = now()
         RETURNING id, lifecycle_state`,
        [
          `candidate_${randomUUID()}`,
          scanRunId,
          repo.htmlUrl,
          repoVisibility,
          JSON.stringify(signals),
          confidence,
          JSON.stringify(evidencePacket),
          repo.repositoryId,
          repo.sourceRevision,
          contentFingerprint,
        ],
      ),
    )[0];
    if (!candidate) throw new Error('GitHub candidate persistence did not return a row.');

    if (candidate.lifecycle_state === 'dismissed') {
      const reason = 'candidate for this repository revision was previously dismissed';
      await completeScanRun(db, scanRunId, {
        scanned: 1,
        candidates: 1,
        drafts: 0,
        evidence: 0,
        rejected: 1,
        reason,
        audit,
      });
      return { status: 'rejected', scanRunId, code: 'candidate_dismissed', reason, audit };
    }

    const source = normalizeRows(
      await db.query<SourceRow>(
        `INSERT INTO project_sources (id, provider, repository_id, canonical_full_name)
         VALUES ($1, 'github', $2, $3)
         ON CONFLICT (provider, repository_id) DO UPDATE SET
           canonical_full_name = EXCLUDED.canonical_full_name,
           updated_at = now()
         RETURNING project_id`,
        [sourceId(repo.repositoryId), repo.repositoryId, repo.fullName],
      ),
    )[0];
    if (!source) throw new Error('GitHub source identity persistence did not return a row.');

    const project = source.project_id ? await fetchPublishedProject(db, source.project_id) : null;
    const proposedFields = manifestProject ?? buildEvidenceProposal(repo, project);
    const evidenceInputs = buildEvidenceInputs(
      repo,
      candidate.id,
      repoVisibility,
      privacyState,
      audit,
      contentFingerprint,
    );
    const publicEvidenceIds = evidenceInputs
      .filter((evidence) => evidence.privacyState === 'safe_public')
      .map((evidence) => evidence.id);
    const privateEvidenceIds = evidenceInputs
      .filter((evidence) => evidence.privacyState === 'private_allowed_for_draft')
      .map((evidence) => evidence.id);
    const provenance = {
      workflow: 'github_refresh',
      provider: 'github',
      repositoryId: repo.repositoryId,
      canonicalFullName: repo.fullName,
      sourceRevision: repo.sourceRevision,
      contentFingerprint,
      proposalSource: manifestProject ? 'manifest' : 'repository_evidence',
      publicEvidenceIds,
      privateEvidenceIds,
      publicPublish: false,
    } satisfies JsonRecord;

    let draft: DraftRow;
    try {
      draft = await persistRevisionDraft(db, {
        candidateId: candidate.id,
        projectId: project?.id ?? null,
        repositoryId: repo.repositoryId,
        sourceRevision: repo.sourceRevision,
        contentFingerprint,
        proposedFields: proposedFields as unknown as JsonRecord,
        provenance,
        baseProjectVersion: Number(project?.publication_version ?? 0),
      });
    } catch (error) {
      if (!(error instanceof ActiveRevisionConflictError)) throw error;
      await completeScanRun(db, scanRunId, {
        scanned: 1,
        candidates: 1,
        drafts: 0,
        evidence: 0,
        rejected: 1,
        reason: error.message,
        code: error.code,
        audit,
      });
      return { status: 'rejected', scanRunId, code: error.code, reason: error.message, audit };
    }

    if (draft.lifecycle_state === 'published' || draft.lifecycle_state === 'superseded') {
      const reason = `source revision was already processed as ${draft.lifecycle_state}`;
      await completeScanRun(db, scanRunId, {
        scanned: 1,
        candidates: 1,
        drafts: 0,
        evidence: 0,
        rejected: 1,
        reason,
        code: 'revision_already_processed',
        audit,
      });
      return { status: 'rejected', scanRunId, code: 'revision_already_processed', reason, audit };
    }

    // Evidence is persisted only after this exact revision owns the returned
    // draft. A concurrent different-HEAD scan can therefore never attach its
    // evidence or provenance to the winning revision's draft.
    for (const evidence of evidenceInputs) await upsertEvidenceSource(db, evidence);

    await db.query(
      `UPDATE project_candidates
       SET lifecycle_state = 'draft_requested', updated_at = now()
       WHERE id = $1 AND lifecycle_state <> 'dismissed'`,
      [candidate.id],
    );
    await db.query(
      `UPDATE evidence_sources
       SET draft_id = CASE WHEN id = ANY($3::text[]) THEN $2 ELSE NULL END
       WHERE candidate_id = $1
         AND (draft_id = $2 OR id = ANY($3::text[]))`,
      [candidate.id, draft.id, evidenceInputs.map((evidence) => evidence.id)],
    );
    await db.query(
      `INSERT INTO review_events (id, draft_id, candidate_id, actor, action, before_state, after_state, notes, metadata)
       VALUES ($1, $2, $3, $4, 'draft_requested', 'qualified', $5, $6, $7::jsonb)`,
      [
        `review_${randomUUID()}`,
        draft.id,
        candidate.id,
        input.actor,
        draft.lifecycle_state,
        'GitHub scan staged or revalidated one review-gated revision draft.',
        JSON.stringify({
          source: 'github_discovery',
          scanRunId,
          provider: 'github',
          repositoryId: repo.repositoryId,
          sourceRevision: repo.sourceRevision,
          proposalSource: manifestProject ? 'manifest' : 'repository_evidence',
        }),
      ],
    );

    await completeScanRun(db, scanRunId, {
      scanned: 1,
      candidates: 1,
      drafts: 1,
      evidence: evidenceInputs.length,
      rejected: 0,
      privateEvidence: privateEvidenceIds.length,
      audit,
    });

    return {
      status: 'qualified',
      scanRunId,
      candidateId: candidate.id,
      draftId: draft.id,
      projectId: project?.id ?? null,
      evidenceIds: evidenceInputs.map((evidence) => evidence.id),
      confidence,
      proposalSource: manifestProject ? 'manifest' : 'repository_evidence',
      audit,
    };
  } catch (error) {
    try {
      await failScanRun(db, scanRunId, error);
    } catch {
      // Preserve the original diagnostic when bookkeeping is also unavailable.
    }
    throw error;
  }
}

function normalizeRepoSnapshot(repo: GithubRepositorySnapshot): NormalizedRepo {
  const repositoryId = repo.repositoryId.trim();
  const owner = repo.owner.trim();
  const name = repo.name.trim();
  const defaultBranch = repo.defaultBranch.trim();
  const sourceRevision = repo.sourceRevision.trim().toLowerCase();
  if (!/^\d+$/.test(repositoryId)) throw new Error('GitHub repository snapshot requires immutable numeric repositoryId.');
  if (!owner || !name) throw new Error('GitHub repository snapshot requires owner and name.');
  if (!repo.htmlUrl.trim()) throw new Error('GitHub repository snapshot requires htmlUrl.');
  if (!defaultBranch) throw new Error('GitHub repository snapshot requires defaultBranch.');
  if (!/^[0-9a-f]{40}$/.test(sourceRevision)) {
    throw new Error('GitHub repository snapshot requires the default-branch HEAD commit SHA as sourceRevision.');
  }
  if (!repo.portfolioManifest || !['missing', 'present'].includes(repo.portfolioManifest.status)) {
    throw new Error('GitHub repository snapshot requires a root portfolio.json fetch result.');
  }

  return {
    ...repo,
    repositoryId,
    owner,
    name,
    defaultBranch,
    sourceRevision,
    fullName: repo.fullName?.trim() || `${owner}/${name}`,
    htmlUrl: repo.htmlUrl.trim(),
    topics: repo.topics.map((topic) => topic.trim().toLowerCase()).filter(Boolean),
  };
}

function parsePortfolioManifest(snapshot: PortfolioManifestSnapshot): PublicProjectFields | null {
  if (snapshot.status === 'missing') return null;
  if (new TextEncoder().encode(snapshot.raw).byteLength > PORTFOLIO_MANIFEST_MAX_BYTES) {
    throw new InvalidManifestError('portfolio.json exceeds the 64 KiB limit.');
  }
  let value: unknown;
  try {
    value = JSON.parse(snapshot.raw);
  } catch {
    throw new InvalidManifestError('portfolio.json contains invalid JSON.');
  }
  const parsed = PortfolioManifestV1Schema.safeParse(value);
  if (!parsed.success) {
    throw new InvalidManifestError('portfolio.json must use schemaVersion 1 and the canonical project schema.');
  }
  return parsed.data.project;
}

function buildAudit(
  repo: NormalizedRepo,
  allowlistTopic: string,
  scannerMode: 'manual-snapshot' | 'live-github',
): JsonRecord {
  const allowlisted = repo.topics.includes(allowlistTopic);
  return {
    allowlisted,
    allowlistTopic,
    matchedTopics: allowlisted ? [allowlistTopic] : [],
    rejectedReason: allowlisted ? null : `missing required GitHub topic: ${allowlistTopic}`,
    scannerMode,
    mutatesRepository: false,
    repoVisibility: repo.isPrivate ? 'private' : 'public',
    repositoryId: repo.repositoryId,
    defaultBranch: repo.defaultBranch,
    sourceRevision: repo.sourceRevision,
    manifestStatus: repo.portfolioManifest.status,
  };
}

function buildSignals(repo: NormalizedRepo, allowlistTopic: string, manifestPresent: boolean): JsonRecord {
  return {
    provider: 'github',
    repositoryId: repo.repositoryId,
    repo: repo.fullName,
    defaultBranch: repo.defaultBranch,
    sourceRevision: repo.sourceRevision,
    topics: repo.topics,
    allowlistTopic,
    descriptionPresent: Boolean(repo.description?.trim()),
    readmePresent: Boolean(repo.readmeMarkdown?.trim()),
    manifestPresent,
    language: repo.language ?? null,
    stars: repo.stars ?? null,
    pushedAt: repo.pushedAt ?? null,
    homepageUrl: repo.homepageUrl ?? null,
  };
}

function scoreCandidate(repo: NormalizedRepo, allowlistTopic: string, manifestPresent: boolean): number {
  let score = repo.topics.includes(allowlistTopic) ? 0.72 : 0;
  if (manifestPresent) score += 0.1;
  if (repo.description?.trim()) score += 0.06;
  if (repo.readmeMarkdown?.trim()) score += 0.06;
  if (repo.homepageUrl?.trim()) score += 0.03;
  if ((repo.stars ?? 0) > 0) score += 0.02;
  if (repo.pushedAt) score += 0.01;
  return Math.min(1, Number(score.toFixed(4)));
}

function buildEvidenceProposal(repo: NormalizedRepo, current: ProjectRow | null): JsonRecord {
  const title = current?.title ?? titleFromRepoName(repo.name);
  const description = repo.description?.trim() || summaryFromReadme(repo.readmeMarkdown ?? '');
  const year = yearFromMetadata(repo.pushedAt) ?? current?.year ?? new Date().getFullYear();
  const links = repo.isPrivate
    ? (current?.links ?? [])
    : mergeRepositoryLink(current?.links ?? [], repo.htmlUrl);
  const base: JsonRecord = current
    ? projectFieldsRecord(current)
    : {
        slug: slugFromRepoName(repo.name),
        title,
        tagline: description ? taglineFromDescription(description) : `${title} project.`,
        year,
        summary: description || `${title} project from GitHub.`,
        activity: '',
        details: [],
        metrics: [],
        links,
        media: [],
      };

  if (description) {
    base.summary = description;
    base.tagline = taglineFromDescription(description);
  }
  base.year = year;
  base.links = links;
  return base;
}

function buildEvidenceInputs(
  repo: NormalizedRepo,
  candidateId: string,
  repoVisibility: RepoVisibility,
  privacyState: 'safe_public' | 'private_allowed_for_draft',
  audit: JsonRecord,
  contentFingerprint: string,
): InsertEvidenceInput[] {
  const sourceUrl = repo.isPrivate ? null : repo.htmlUrl;
  const commonClaimMap = {
    audit,
    sourceRevision: repo.sourceRevision,
    contentFingerprint,
    publicSourceEligible: !repo.isPrivate,
  } satisfies JsonRecord;
  const evidence: InsertEvidenceInput[] = [
    {
      id: evidenceId(candidateId, contentFingerprint, 'repo'),
      candidateId,
      sourceType: 'repo',
      sourceUrl,
      sourceRef: `${repo.fullName}@${repo.sourceRevision}`,
      repoVisibility,
      extractedText: repo.description?.trim() || null,
      privacyState,
      claimMap: { ...commonClaimMap, fields: ['description', 'homepageUrl'] },
    },
  ];

  const readme = repo.readmeMarkdown?.trim();
  if (readme) {
    evidence.push({
      id: evidenceId(candidateId, contentFingerprint, 'readme'),
      candidateId,
      sourceType: 'readme',
      sourceUrl: repo.isPrivate ? null : `${repo.htmlUrl}/blob/${repo.sourceRevision}/README.md`,
      sourceRef: `${repo.fullName}:README@${repo.sourceRevision}`,
      repoVisibility,
      extractedText: readme,
      privacyState,
      claimMap: { ...commonClaimMap, fields: ['readmeMarkdown'] },
    });
  }

  if (repo.portfolioManifest.status === 'present') {
    evidence.push({
      id: evidenceId(candidateId, contentFingerprint, 'manifest'),
      candidateId,
      sourceType: 'document',
      sourceUrl: repo.isPrivate ? null : `${repo.htmlUrl}/blob/${repo.sourceRevision}/portfolio.json`,
      sourceRef: `${repo.fullName}:portfolio.json@${repo.sourceRevision}`,
      repoVisibility,
      extractedText: repo.portfolioManifest.raw,
      privacyState,
      claimMap: { ...commonClaimMap, fields: ['canonicalProjectPayload'], schemaVersion: 1 },
    });
  }
  return evidence;
}

async function persistRevisionDraft(
  db: GithubDiscoveryQueryable,
  input: {
    candidateId: string;
    projectId: string | null;
    repositoryId: string;
    sourceRevision: string;
    contentFingerprint: string;
    proposedFields: JsonRecord;
    provenance: JsonRecord;
    baseProjectVersion: number;
  },
): Promise<DraftRow> {
  try {
    const row = normalizeRows(
      await db.query<DraftRow>(
        `WITH existing_revision AS (
           SELECT id
           FROM project_drafts
           WHERE provider = 'github'
             AND repository_id = $4
             AND source_revision = $5
         ),
         superseded AS (
           UPDATE project_drafts
           SET lifecycle_state = 'superseded', updated_at = now()
           WHERE provider = 'github'
             AND repository_id = $4
             AND source_revision <> $5
             AND lifecycle_state IN ('hidden', 'needs_review', 'changes_requested', 'approved_for_publish')
             AND NOT EXISTS (SELECT 1 FROM existing_revision)
           RETURNING id
         )
         INSERT INTO project_drafts (
           id, candidate_id, proposed_project_id, proposed_fields, private_notes,
           provenance_map, lifecycle_state, provider, repository_id, source_revision,
           content_fingerprint, reviewed_field_diff, base_project_version
         )
         SELECT $1, $2, $3, $6::jsonb, $7, $8::jsonb, 'hidden', 'github', $4, $5, $9, '[]'::jsonb, $10
         FROM (SELECT count(*) FROM superseded) AS supersession_gate
         ON CONFLICT (provider, repository_id, source_revision)
           WHERE provider IS NOT NULL AND repository_id IS NOT NULL AND source_revision IS NOT NULL
         DO UPDATE SET
           candidate_id = CASE
             WHEN project_drafts.lifecycle_state IN ('hidden', 'needs_review', 'changes_requested', 'approved_for_publish')
               THEN EXCLUDED.candidate_id
             ELSE project_drafts.candidate_id
           END,
           proposed_project_id = CASE
             WHEN (project_drafts.content_fingerprint IS DISTINCT FROM EXCLUDED.content_fingerprint
               OR project_drafts.base_project_version IS DISTINCT FROM EXCLUDED.base_project_version
               OR project_drafts.proposed_project_id IS DISTINCT FROM EXCLUDED.proposed_project_id)
               AND project_drafts.lifecycle_state IN ('hidden', 'needs_review', 'changes_requested', 'approved_for_publish')
               THEN EXCLUDED.proposed_project_id
             ELSE CASE
               WHEN project_drafts.lifecycle_state IN ('hidden', 'needs_review', 'changes_requested', 'approved_for_publish')
                 THEN COALESCE(project_drafts.proposed_project_id, EXCLUDED.proposed_project_id)
               ELSE project_drafts.proposed_project_id
             END
           END,
           proposed_fields = CASE
             WHEN (project_drafts.content_fingerprint IS DISTINCT FROM EXCLUDED.content_fingerprint
               OR project_drafts.base_project_version IS DISTINCT FROM EXCLUDED.base_project_version
               OR project_drafts.proposed_project_id IS DISTINCT FROM EXCLUDED.proposed_project_id)
               AND project_drafts.lifecycle_state IN ('hidden', 'needs_review', 'changes_requested', 'approved_for_publish')
               THEN EXCLUDED.proposed_fields
             ELSE project_drafts.proposed_fields
           END,
           provenance_map = CASE
             WHEN (project_drafts.content_fingerprint IS DISTINCT FROM EXCLUDED.content_fingerprint
               OR project_drafts.base_project_version IS DISTINCT FROM EXCLUDED.base_project_version
               OR project_drafts.proposed_project_id IS DISTINCT FROM EXCLUDED.proposed_project_id)
               AND project_drafts.lifecycle_state IN ('hidden', 'needs_review', 'changes_requested', 'approved_for_publish')
               THEN EXCLUDED.provenance_map
             ELSE project_drafts.provenance_map
           END,
           reviewed_field_diff = CASE
             WHEN (project_drafts.content_fingerprint IS DISTINCT FROM EXCLUDED.content_fingerprint
               OR project_drafts.base_project_version IS DISTINCT FROM EXCLUDED.base_project_version
               OR project_drafts.proposed_project_id IS DISTINCT FROM EXCLUDED.proposed_project_id)
               AND project_drafts.lifecycle_state IN ('hidden', 'needs_review', 'changes_requested', 'approved_for_publish')
               THEN '[]'::jsonb
             ELSE project_drafts.reviewed_field_diff
           END,
           base_project_version = CASE
             WHEN (project_drafts.content_fingerprint IS DISTINCT FROM EXCLUDED.content_fingerprint
               OR project_drafts.base_project_version IS DISTINCT FROM EXCLUDED.base_project_version
               OR project_drafts.proposed_project_id IS DISTINCT FROM EXCLUDED.proposed_project_id)
               AND project_drafts.lifecycle_state IN ('hidden', 'needs_review', 'changes_requested', 'approved_for_publish')
               THEN EXCLUDED.base_project_version
             ELSE project_drafts.base_project_version
           END,
           lifecycle_state = CASE
             WHEN (project_drafts.content_fingerprint IS DISTINCT FROM EXCLUDED.content_fingerprint
               OR project_drafts.base_project_version IS DISTINCT FROM EXCLUDED.base_project_version
               OR project_drafts.proposed_project_id IS DISTINCT FROM EXCLUDED.proposed_project_id)
               AND project_drafts.lifecycle_state IN ('hidden', 'needs_review', 'changes_requested', 'approved_for_publish')
               THEN 'needs_review'
             ELSE project_drafts.lifecycle_state
           END,
           content_fingerprint = CASE
             WHEN project_drafts.lifecycle_state IN ('hidden', 'needs_review', 'changes_requested', 'approved_for_publish')
               THEN EXCLUDED.content_fingerprint
             ELSE project_drafts.content_fingerprint
           END,
           updated_at = CASE
             WHEN project_drafts.lifecycle_state IN ('hidden', 'needs_review', 'changes_requested', 'approved_for_publish')
               THEN now()
             ELSE project_drafts.updated_at
           END
         RETURNING id, lifecycle_state, source_revision`,
        [
          `draft_${randomUUID()}`,
          input.candidateId,
          input.projectId,
          input.repositoryId,
          input.sourceRevision,
          JSON.stringify(input.proposedFields),
          'Created from a GitHub source revision. Hidden until explicit admin review and publish.',
          JSON.stringify(input.provenance),
          input.contentFingerprint,
          input.baseProjectVersion,
        ],
      ),
    )[0];
    if (!row) throw new Error('GitHub draft persistence did not return a row.');
    return row;
  } catch (error) {
    if (!isPgErrorCode(error, '23505')) throw error;
    const active = normalizeRows(
      await db.query<DraftRow>(
        `SELECT id, lifecycle_state, source_revision
         FROM project_drafts
         WHERE provider = 'github'
           AND repository_id = $1
           AND lifecycle_state IN ('hidden', 'needs_review', 'changes_requested', 'approved_for_publish')
         ORDER BY updated_at DESC
         LIMIT 1`,
        [input.repositoryId],
      ),
    )[0];
    if (active?.source_revision === input.sourceRevision) return active;
    if (active) throw new ActiveRevisionConflictError();
    throw error;
  }
}

async function fetchPublishedProject(db: GithubDiscoveryQueryable, projectId: string): Promise<ProjectRow | null> {
  return normalizeRows(
    await db.query<ProjectRow>(
      `SELECT id, slug, title, tagline, area, year, summary, activity, details, metrics, links, media, publication_version
       FROM projects
       WHERE id = $1 AND lifecycle_state = 'published'`,
      [projectId],
    ),
  )[0] ?? null;
}

async function upsertEvidenceSource(db: GithubDiscoveryQueryable, evidence: InsertEvidenceInput): Promise<void> {
  await db.query(
    `INSERT INTO evidence_sources (
       id, candidate_id, source_type, source_url, source_ref, repo_visibility,
       extracted_text, extracted_text_sha256, privacy_state, claim_map
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       candidate_id = EXCLUDED.candidate_id,
       source_url = EXCLUDED.source_url,
       source_ref = EXCLUDED.source_ref,
       repo_visibility = EXCLUDED.repo_visibility,
       extracted_text = EXCLUDED.extracted_text,
       extracted_text_sha256 = EXCLUDED.extracted_text_sha256,
       privacy_state = EXCLUDED.privacy_state,
       claim_map = EXCLUDED.claim_map`,
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

async function rejectInvalidManifest(db: GithubDiscoveryQueryable, scanRunId: string, audit: JsonRecord): Promise<void> {
  await db.query(
    `UPDATE scan_runs
     SET lifecycle_state = 'failed', error_message = 'invalid_manifest',
         result_counts = $2::jsonb, finished_at = $3
     WHERE id = $1`,
    [scanRunId, JSON.stringify({ scanned: 1, candidates: 0, drafts: 0, evidence: 0, rejected: 1, code: 'invalid_manifest', audit }), new Date().toISOString()],
  );
}

async function failScanRun(db: GithubDiscoveryQueryable, scanRunId: string, error: unknown): Promise<void> {
  await db.query(
    `UPDATE scan_runs
     SET lifecycle_state = 'failed', error_message = $2, finished_at = $3
     WHERE id = $1`,
    [scanRunId, safeScanErrorCode(error), new Date().toISOString()],
  );
}

function safeScanErrorCode(error: unknown): string {
  if (error instanceof InvalidManifestError) return error.code;
  if (isPlainRecord(error) && typeof error.code === 'string') return error.code.slice(0, 80);
  return 'github_scan_failed';
}

function fingerprintRepositoryContent(repo: NormalizedRepo): string {
  return sha256(JSON.stringify({
    provider: 'github',
    repositoryId: repo.repositoryId,
    canonicalFullName: repo.fullName,
    htmlUrl: repo.htmlUrl,
    isPrivate: repo.isPrivate,
    defaultBranch: repo.defaultBranch,
    sourceRevision: repo.sourceRevision,
    description: repo.description ?? null,
    homepageUrl: repo.homepageUrl ?? null,
    topics: repo.topics,
    language: repo.language ?? null,
    pushedAt: repo.pushedAt ?? null,
    stars: repo.stars ?? null,
    readmeMarkdown: repo.readmeMarkdown ?? null,
    portfolioManifest: repo.portfolioManifest,
  }));
}

function projectFieldsRecord(project: ProjectRow): JsonRecord {
  return {
    slug: project.slug,
    title: project.title,
    tagline: project.tagline,
    area: project.area,
    year: project.year,
    summary: project.summary,
    activity: project.activity,
    details: project.details as JsonValue[],
    metrics: project.metrics as JsonValue[],
    links: project.links as JsonValue[],
    media: project.media as JsonValue[],
  };
}

function mergeRepositoryLink(links: JsonValue[], htmlUrl: string): JsonValue[] {
  const filtered = links.filter((link) => !isRepositoryLink(link));
  return [...filtered, { label: 'GitHub', href: htmlUrl }];
}

function isRepositoryLink(value: JsonValue): boolean {
  return isPlainRecord(value) && value.label === 'GitHub';
}

function slugFromRepoName(repoName: string): string {
  return repoName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'github-project';
}

function titleFromRepoName(repoName: string): string {
  return repoName
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ') || 'Untitled Project';
}

function taglineFromDescription(description: string): string {
  const trimmed = description.trim();
  const sentence = trimmed.match(/^(.+?[.!?])(?:\s|$)/s)?.[1]?.trim();
  return (sentence || trimmed).slice(0, 140).trim();
}

function summaryFromReadme(readme: string): string {
  return readme
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~`>|]/g, '')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .find(Boolean)
    ?.slice(0, 600) ?? '';
}

function yearFromMetadata(pushedAt: string | null | undefined): number | null {
  if (!pushedAt) return null;
  const date = new Date(pushedAt);
  const year = date.getUTCFullYear();
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null;
}

function sourceId(repositoryId: string): string {
  return `source_github_${sha256(repositoryId).slice(0, 24)}`;
}

function evidenceId(candidateId: string, fingerprint: string, kind: string): string {
  return `evidence_${sha256(`${candidateId}:${fingerprint}:${kind}`).slice(0, 32)}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isPgErrorCode(error: unknown, code: string): boolean {
  return isPlainRecord(error) && error.code === code;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRows<Row>(result: { rows: Row[] } | Row[]): Row[] {
  return Array.isArray(result) ? result : result.rows;
}
