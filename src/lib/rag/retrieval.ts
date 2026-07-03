import {
  buildPublicFileSearchTool,
  listSearchableRagSources,
  type PublicFileSearchTool,
  type RagQueryable,
  type SearchableRagSource,
} from './ingestion';

export const PUBLIC_RAG_MAX_RESULTS = 4;
export const PUBLIC_RAG_SCORE_THRESHOLD = 0.2;
export const PUBLIC_RAG_MIN_TEXT_CHARS = 32;

export interface PublicRagSearchOptions {
  maxNumResults?: number;
  scoreThreshold?: number;
  minTextChars?: number;
}

export interface PublicRagFileSearchToolConfig {
  vectorStoreIds: string[];
  filters: PublicFileSearchTool['filters'];
  maxNumResults: number;
  ranking: {
    ranker: 'auto';
    scoreThreshold: number;
  };
}

export interface PublicRagSearchConfig {
  sources: SearchableRagSource[];
  tool: PublicRagFileSearchToolConfig;
  minTextChars: number;
  scoreThreshold: number;
}

export interface PublicRagCitation {
  ragSourceId: string;
  projectId: string;
  fileId: string;
  filename?: string;
  score?: number;
  text: string;
}

export async function createPublicRagSearchConfig(
  db: RagQueryable,
  options: PublicRagSearchOptions = {},
): Promise<PublicRagSearchConfig | null> {
  const sources = await listSearchableRagSources(db);
  const tool = buildPublicFileSearchTool(sources);
  if (!tool) return null;

  const scoreThreshold = options.scoreThreshold ?? PUBLIC_RAG_SCORE_THRESHOLD;
  return {
    sources,
    minTextChars: options.minTextChars ?? PUBLIC_RAG_MIN_TEXT_CHARS,
    scoreThreshold,
    tool: {
      vectorStoreIds: tool.vector_store_ids,
      filters: tool.filters,
      maxNumResults: options.maxNumResults ?? PUBLIC_RAG_MAX_RESULTS,
      ranking: { ranker: 'auto', scoreThreshold },
    },
  };
}

export function publicRagCitationsFromFileSearchResult(
  output: unknown,
  config: PublicRagSearchConfig,
): PublicRagCitation[] {
  const results = fileSearchResults(output);
  if (results.length === 0) return [];

  const byRagSourceId = new Map(config.sources.map((source) => [source.id, source]));
  const byFileId = new Map(config.sources.map((source) => [source.openai_file_id, source]));
  const citations: PublicRagCitation[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    const citation = citationFromResult(result, byRagSourceId, byFileId, config);
    if (!citation) continue;

    const key = `${citation.ragSourceId}:${citation.fileId}:${citation.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push(citation);
  }

  return citations;
}

export function publicRagProjectIds(citations: PublicRagCitation[]): string[] {
  return [...new Set(citations.map((citation) => citation.projectId))];
}

function citationFromResult(
  value: unknown,
  byRagSourceId: Map<string, SearchableRagSource>,
  byFileId: Map<string, SearchableRagSource>,
  config: PublicRagSearchConfig,
): PublicRagCitation | null {
  if (!isRecord(value)) return null;

  const attributes = isRecord(value.attributes) ? value.attributes : {};
  if (typeof attributes.visibility === 'string' && attributes.visibility !== 'public') return null;

  const fileId = stringValue(value.fileId) ?? stringValue(value.file_id);
  const ragSourceId = stringValue(attributes.rag_source_id) ?? stringValue(attributes.ragSourceId);
  const projectId = stringValue(attributes.project_id) ?? stringValue(attributes.projectId);

  const sourceByFileId = fileId ? byFileId.get(fileId) : undefined;
  const sourceByRagId = ragSourceId ? byRagSourceId.get(ragSourceId) : undefined;
  const source = sourceByFileId ?? sourceByRagId;
  if (!source) return null;
  if (sourceByFileId && sourceByRagId && sourceByFileId.id !== sourceByRagId.id) return null;
  if (ragSourceId && ragSourceId !== source.id) return null;
  if (projectId && projectId !== source.project_id) return null;

  const text = stringValue(value.text)?.trim() ?? '';
  if (text.length < config.minTextChars) return null;

  const score = numberValue(value.score);
  if (score === undefined || score < config.scoreThreshold) return null;

  return {
    ragSourceId: source.id,
    projectId: source.project_id,
    fileId: source.openai_file_id,
    ...(typeof value.filename === 'string' ? { filename: value.filename } : {}),
    score,
    text,
  };
}

function fileSearchResults(output: unknown): unknown[] {
  if (!isRecord(output) || !Array.isArray(output.results)) return [];
  return output.results;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
