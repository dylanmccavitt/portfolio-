import { randomUUID } from 'node:crypto';
import type { JsonRecord, PrivacyState, ProjectLifecycleState, RagSourceEligibilityState } from '../db/schema';

export interface RagQueryable {
  query<Row = unknown>(sql: string, params?: unknown[]): Promise<{ rows: Row[] } | Row[]>;
}

export interface RagIndexClient {
  uploadFile(input: { filename: string; content: string }): Promise<{ fileId: string }>;
  createVectorStore(input: { name: string }): Promise<{ vectorStoreId: string }>;
  attachFile(input: {
    vectorStoreId: string;
    fileId: string;
    attributes: Record<string, string>;
  }): Promise<void>;
  getFileIndexingStatus(input: {
    vectorStoreId: string;
    fileId: string;
  }): Promise<{ status: 'in_progress' | 'completed' | 'cancelled' | 'failed'; errorMessage?: string | null }>;
  detachFile(input: { vectorStoreId: string; fileId: string }): Promise<void>;
  deleteFile(input: { fileId: string }): Promise<void>;
}

type RagFailure = { ok: false; status: number; code: string; message: string; [key: string]: unknown };
type RagSuccess = { ok: true; status: number; code: string; message: string; [key: string]: unknown };
export type RagResult = RagFailure | RagSuccess;

export const PUBLIC_RAG_VECTOR_STORE_NAME = 'portfolio-public-rag';

type ProjectGateRow = { id: string; lifecycle_state: ProjectLifecycleState };
type EvidenceGateRow = {
  id: string;
  project_id: string | null;
  privacy_state: PrivacyState;
  extracted_text: string | null;
  claim_map: JsonRecord;
};
type RagSourceRow = {
  id: string;
  project_id: string;
  evidence_source_id: string | null;
  eligibility_state: RagSourceEligibilityState;
  openai_file_id: string | null;
  vector_store_id: string | null;
};

export interface IngestOptions {
  vectorStoreId?: string;
  poll?: {
    maxAttempts?: number;
    sleep?: () => Promise<void>;
  };
}

export async function markRagSourceEligible(
  db: RagQueryable,
  input: { projectId: string; evidenceSourceId: string; actor: string },
): Promise<RagResult> {
  const gate = await checkEligibilityGates(db, input.projectId, input.evidenceSourceId);
  if (!gate.ok) return gate;

  const existing = normalizeRows(
    await db.query<RagSourceRow>(
      `SELECT id, project_id, evidence_source_id, eligibility_state, openai_file_id, vector_store_id
       FROM rag_sources
       WHERE project_id = $1 AND evidence_source_id = $2`,
      [input.projectId, input.evidenceSourceId],
    ),
  )[0];

  if (existing && (existing.eligibility_state === 'indexing' || existing.eligibility_state === 'indexed')) {
    return {
      ok: false,
      status: 409,
      code: 'rag_source_already_active',
      message: `RAG source ${existing.id} is already ${existing.eligibility_state}; revoke it before re-marking.`,
      ragSourceId: existing.id,
    };
  }

  // Never null out remote handles while cleanup is outstanding; doing so would
  // orphan the uploaded file on OpenAI with no way to delete it later.
  if (existing && (existing.openai_file_id || existing.vector_store_id)) {
    return {
      ok: false,
      status: 409,
      code: 'rag_source_cleanup_pending',
      message: `RAG source ${existing.id} still has remote artifacts; retry revocation cleanup before re-marking.`,
      ragSourceId: existing.id,
    };
  }

  let ragSourceId: string;
  if (existing) {
    ragSourceId = existing.id;
    await db.query(
      `UPDATE rag_sources
       SET eligibility_state = 'eligible',
           failure_message = NULL,
           revoked_at = NULL,
           openai_file_id = NULL,
           vector_store_id = NULL,
           updated_at = now()
       WHERE id = $1`,
      [ragSourceId],
    );
  } else {
    ragSourceId = `rag_${randomUUID()}`;
    await db.query(
      `INSERT INTO rag_sources (id, project_id, evidence_source_id, eligibility_state)
       VALUES ($1, $2, $3, 'eligible')`,
      [ragSourceId, input.projectId, input.evidenceSourceId],
    );
  }

  await insertReviewEvent(db, {
    projectId: input.projectId,
    actor: input.actor,
    action: 'rag_marked_eligible',
    beforeState: existing?.eligibility_state ?? null,
    afterState: 'eligible',
    notes: 'RAG source marked eligible for public ingestion.',
    metadata: { source: 'rag_ingestion', ragSourceId, evidenceSourceId: input.evidenceSourceId },
  });

  return {
    ok: true,
    status: 200,
    code: 'rag_source_eligible',
    message: 'RAG source marked eligible.',
    ragSourceId,
  };
}

export async function ingestRagSource(
  db: RagQueryable,
  client: RagIndexClient,
  ragSourceId: string,
  actor: string,
  options: IngestOptions = {},
): Promise<RagResult> {
  const source = await fetchRagSource(db, ragSourceId);
  if (!source) return ragSourceNotFound(ragSourceId);

  if (source.eligibility_state !== 'eligible') {
    return {
      ok: false,
      status: 409,
      code: 'rag_source_not_eligible',
      message: `RAG source ${ragSourceId} is ${source.eligibility_state}; only eligible sources can be ingested.`,
      ragSourceId,
      eligibilityState: source.eligibility_state,
    };
  }

  if (!source.evidence_source_id) {
    await setState(db, ragSourceId, 'not_eligible');
    return {
      ok: false,
      status: 422,
      code: 'rag_source_missing_evidence',
      message: `RAG source ${ragSourceId} has no linked evidence source.`,
      ragSourceId,
    };
  }

  // Re-run the eligibility gates at upload time so approvals revoked after
  // rag_marked_eligible can never reach OpenAI.
  const gate = await checkEligibilityGates(db, source.project_id, source.evidence_source_id);
  if (!gate.ok) {
    await setState(db, ragSourceId, 'not_eligible');
    return { ...gate, code: 'rag_eligibility_revalidation_failed', ragSourceId, cause: gate.code };
  }

  await setState(db, ragSourceId, 'indexing');

  const content = gate.extractedText;
  const maxAttempts = options.poll?.maxAttempts ?? 30;
  const sleep = options.poll?.sleep ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 1000)));

  let fileId: string | null = null;
  let vectorStoreId: string | null = null;
  try {
    fileId = (await client.uploadFile({ filename: `${ragSourceId}.md`, content })).fileId;
    vectorStoreId =
      options.vectorStoreId ??
      (await findExistingVectorStoreId(db)) ??
      (await client.createVectorStore({ name: PUBLIC_RAG_VECTOR_STORE_NAME })).vectorStoreId;
    await client.attachFile({
      vectorStoreId,
      fileId,
      attributes: publicRagAttributes(ragSourceId, source.project_id),
    });

    let indexed = false;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const { status, errorMessage } = await client.getFileIndexingStatus({ vectorStoreId, fileId });
      if (status === 'completed') {
        indexed = true;
        break;
      }
      if (status === 'failed' || status === 'cancelled') {
        throw new Error(errorMessage || `Vector store indexing ${status}.`);
      }
      await sleep();
    }
    if (!indexed) throw new Error(`Vector store indexing did not complete after ${maxAttempts} polls.`);
  } catch (error) {
    const failureMessage = error instanceof Error ? error.message : String(error);
    await markIngestionFailed(db, ragSourceId, source.project_id, actor, failureMessage);
    if (fileId) {
      await bestEffortCleanup(client, vectorStoreId, fileId);
    }
    return {
      ok: false,
      status: 502,
      code: 'rag_indexing_failed',
      message: `RAG ingestion failed and public search stays disabled for this source: ${failureMessage}`,
      ragSourceId,
    };
  }

  await db.query(
    `UPDATE rag_sources
     SET eligibility_state = 'indexed',
         openai_file_id = $2,
         vector_store_id = $3,
         failure_message = NULL,
         last_synced_at = now(),
         updated_at = now()
     WHERE id = $1`,
    [ragSourceId, fileId, vectorStoreId],
  );
  await insertReviewEvent(db, {
    projectId: source.project_id,
    actor,
    action: 'note',
    beforeState: 'indexing',
    afterState: 'indexed',
    notes: 'RAG source indexed for public search.',
    metadata: { source: 'rag_ingestion', kind: 'rag_indexed', ragSourceId, vectorStoreId },
  });

  return {
    ok: true,
    status: 200,
    code: 'rag_source_indexed',
    message: 'RAG source indexed.',
    ragSourceId,
    fileId,
    vectorStoreId,
  };
}

export async function revokeRagSource(
  db: RagQueryable,
  client: RagIndexClient,
  ragSourceId: string,
  actor: string,
): Promise<RagResult> {
  const source = await fetchRagSource(db, ragSourceId);
  if (!source) return ragSourceNotFound(ragSourceId);

  const alreadyRevoked = source.eligibility_state === 'revoked';
  if (alreadyRevoked && !source.openai_file_id && !source.vector_store_id) {
    return {
      ok: true,
      status: 200,
      code: 'rag_source_already_revoked',
      message: 'RAG source is already revoked.',
      ragSourceId,
    };
  }

  if (!alreadyRevoked) {
    // Revoke in the database before any remote cleanup so public retrieval
    // (which only trusts indexed DB rows) is blocked even if cleanup fails.
    await db.query(
      `UPDATE rag_sources
       SET eligibility_state = 'revoked',
           revoked_at = now(),
           updated_at = now()
       WHERE id = $1`,
      [ragSourceId],
    );
    await insertReviewEvent(db, {
      projectId: source.project_id,
      actor,
      action: 'rag_revoked',
      beforeState: source.eligibility_state,
      afterState: 'revoked',
      notes: 'RAG source revoked from public search.',
      metadata: { source: 'rag_ingestion', ragSourceId },
    });
  }

  let cleanupError: string | null = null;
  try {
    if (source.vector_store_id && source.openai_file_id) {
      await client.detachFile({ vectorStoreId: source.vector_store_id, fileId: source.openai_file_id });
    }
    if (source.openai_file_id) {
      await client.deleteFile({ fileId: source.openai_file_id });
    }
    await db.query(
      `UPDATE rag_sources
       SET openai_file_id = NULL, vector_store_id = NULL, failure_message = NULL, updated_at = now()
       WHERE id = $1`,
      [ragSourceId],
    );
  } catch (error) {
    cleanupError = error instanceof Error ? error.message : String(error);
    await db.query(`UPDATE rag_sources SET failure_message = $2, updated_at = now() WHERE id = $1`, [
      ragSourceId,
      `Revocation cleanup failed: ${cleanupError}`,
    ]);
  }

  return {
    ok: true,
    status: 200,
    code: 'rag_source_revoked',
    message: cleanupError
      ? 'RAG source revoked; remote cleanup failed and should be retried.'
      : 'RAG source revoked and remote artifacts removed.',
    ragSourceId,
    cleanup: cleanupError ? 'failed' : 'completed',
    ...(cleanupError ? { cleanupError } : {}),
  };
}

export interface SearchableRagSource {
  id: string;
  project_id: string;
  vector_store_id: string;
  openai_file_id: string;
}

export async function listSearchableRagSources(db: RagQueryable): Promise<SearchableRagSource[]> {
  return normalizeRows(
    await db.query<SearchableRagSource>(
      `SELECT id, project_id, vector_store_id, openai_file_id
       FROM rag_sources
       WHERE eligibility_state = 'indexed'
         AND vector_store_id IS NOT NULL
         AND openai_file_id IS NOT NULL
       ORDER BY id`,
    ),
  );
}

export interface PublicFileSearchTool {
  type: 'file_search';
  vector_store_ids: string[];
  filters: {
    type: 'and';
    filters: Array<
      | { type: 'eq'; key: string; value: string }
      | { type: 'in'; key: string; value: string[] }
    >;
  };
}

/**
 * Builds the only supported public file_search tool config. The visibility and
 * rag_source_id filters are constructed unconditionally so callers cannot
 * issue an unfiltered public search; with no indexed sources RAG is disabled.
 */
export function buildPublicFileSearchTool(sources: SearchableRagSource[]): PublicFileSearchTool | null {
  if (sources.length === 0) return null;
  const vectorStoreIds = [...new Set(sources.map((source) => source.vector_store_id))];
  return {
    type: 'file_search',
    vector_store_ids: vectorStoreIds,
    filters: {
      type: 'and',
      filters: [
        { type: 'eq', key: 'visibility', value: 'public' },
        { type: 'in', key: 'rag_source_id', value: sources.map((source) => source.id) },
      ],
    },
  };
}

export function publicRagAttributes(ragSourceId: string, projectId: string): Record<string, string> {
  return { rag_source_id: ragSourceId, project_id: projectId, visibility: 'public' };
}

type GateSuccess = { ok: true; extractedText: string };

async function checkEligibilityGates(
  db: RagQueryable,
  projectId: string,
  evidenceSourceId: string,
): Promise<RagFailure | GateSuccess> {
  const project = normalizeRows(
    await db.query<ProjectGateRow>(`SELECT id, lifecycle_state FROM projects WHERE id = $1`, [projectId]),
  )[0];
  if (!project) {
    return { ok: false, status: 404, code: 'project_not_found', message: `Project ${projectId} was not found.`, projectId };
  }
  if (project.lifecycle_state !== 'published') {
    return {
      ok: false,
      status: 422,
      code: 'project_not_published',
      message: `Project ${projectId} is ${project.lifecycle_state}; only published projects can back public RAG.`,
      projectId,
      lifecycleState: project.lifecycle_state,
    };
  }

  const evidence = normalizeRows(
    await db.query<EvidenceGateRow>(
      `SELECT id, project_id, privacy_state, extracted_text, claim_map
       FROM evidence_sources
       WHERE id = $1`,
      [evidenceSourceId],
    ),
  )[0];
  if (!evidence) {
    return {
      ok: false,
      status: 404,
      code: 'evidence_not_found',
      message: `Evidence source ${evidenceSourceId} was not found.`,
      evidenceSourceId,
    };
  }
  if (evidence.project_id !== projectId) {
    return {
      ok: false,
      status: 422,
      code: 'evidence_not_linked_to_project',
      message: 'Evidence attached only to hidden drafts or candidates cannot back public RAG.',
      evidenceSourceId,
    };
  }
  if (evidence.privacy_state !== 'safe_public') {
    return {
      ok: false,
      status: 422,
      code: 'evidence_not_public',
      message: `Evidence with privacy state ${evidence.privacy_state} cannot upload or become searchable.`,
      evidenceSourceId,
      privacyState: evidence.privacy_state,
    };
  }
  if (evidence.claim_map?.generated === true) {
    return {
      ok: false,
      status: 422,
      code: 'evidence_generated',
      message: 'Generated evidence text cannot back public RAG.',
      evidenceSourceId,
    };
  }
  const extractedText = evidence.extracted_text?.trim() ?? '';
  if (!extractedText) {
    return {
      ok: false,
      status: 422,
      code: 'evidence_empty',
      message: 'Evidence has no extracted text to index.',
      evidenceSourceId,
    };
  }

  return { ok: true, extractedText };
}

async function markIngestionFailed(
  db: RagQueryable,
  ragSourceId: string,
  projectId: string,
  actor: string,
  failureMessage: string,
): Promise<void> {
  await db.query(
    `UPDATE rag_sources
     SET eligibility_state = 'failed',
         failure_message = $2,
         openai_file_id = NULL,
         vector_store_id = NULL,
         updated_at = now()
     WHERE id = $1`,
    [ragSourceId, failureMessage],
  );
  await insertReviewEvent(db, {
    projectId,
    actor,
    action: 'note',
    beforeState: 'indexing',
    afterState: 'failed',
    notes: 'RAG ingestion failed; public search stays disabled for this source.',
    metadata: { source: 'rag_ingestion', kind: 'rag_indexing_failed', ragSourceId, failureMessage },
  });
}

async function bestEffortCleanup(client: RagIndexClient, vectorStoreId: string | null, fileId: string): Promise<void> {
  try {
    if (vectorStoreId) await client.detachFile({ vectorStoreId, fileId });
    await client.deleteFile({ fileId });
  } catch {
    // Cleanup failures are recorded via failure_message on the row; the file
    // is never searchable because it only enters filters once state=indexed.
  }
}

async function findExistingVectorStoreId(db: RagQueryable): Promise<string | null> {
  const rows = normalizeRows(
    await db.query<{ vector_store_id: string }>(
      `SELECT vector_store_id
       FROM rag_sources
       WHERE eligibility_state = 'indexed' AND vector_store_id IS NOT NULL
       ORDER BY updated_at DESC
       LIMIT 1`,
    ),
  );
  return rows[0]?.vector_store_id ?? null;
}

async function fetchRagSource(db: RagQueryable, ragSourceId: string): Promise<RagSourceRow | null> {
  const rows = normalizeRows(
    await db.query<RagSourceRow>(
      `SELECT id, project_id, evidence_source_id, eligibility_state, openai_file_id, vector_store_id
       FROM rag_sources
       WHERE id = $1`,
      [ragSourceId],
    ),
  );
  return rows[0] ?? null;
}

async function setState(db: RagQueryable, ragSourceId: string, state: RagSourceEligibilityState): Promise<void> {
  await db.query(`UPDATE rag_sources SET eligibility_state = $2, updated_at = now() WHERE id = $1`, [
    ragSourceId,
    state,
  ]);
}

async function insertReviewEvent(
  db: RagQueryable,
  input: {
    projectId: string;
    actor: string;
    action: 'rag_marked_eligible' | 'rag_revoked' | 'note';
    beforeState: string | null;
    afterState: string;
    notes: string;
    metadata: JsonRecord;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO review_events (id, project_id, actor, action, before_state, after_state, notes, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      `review_${randomUUID()}`,
      input.projectId,
      input.actor,
      input.action,
      input.beforeState,
      input.afterState,
      input.notes,
      JSON.stringify(input.metadata),
    ],
  );
}

function ragSourceNotFound(ragSourceId: string): RagFailure {
  return {
    ok: false,
    status: 404,
    code: 'rag_source_not_found',
    message: `RAG source ${ragSourceId} was not found.`,
    ragSourceId,
  };
}

function normalizeRows<Row>(result: { rows: Row[] } | Row[]): Row[] {
  return Array.isArray(result) ? result : result.rows;
}
