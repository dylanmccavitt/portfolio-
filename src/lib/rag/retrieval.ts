import { OpenAI } from 'openai';
import type { VectorStoreSearchParams } from 'openai/resources/vector-stores/vector-stores';
import {
  buildPublicFileSearchTool,
  listSearchableRagSources,
  type PublicFileSearchTool,
  type RagQueryable,
  type SearchableRagSource,
} from './ingestion';

const PUBLIC_RAG_MAX_RESULTS = 4;
const PUBLIC_RAG_SCORE_THRESHOLD = 0.2;
const PUBLIC_RAG_MIN_TEXT_CHARS = 32;

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

  const byFileId = new Map(config.sources.map((source) => [source.openai_file_id, source]));
  const citations: PublicRagCitation[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    const citation = citationFromResult(result, byFileId, config);
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

export interface PublicRagSearchOutput {
  citations: PublicRagCitation[];
}

export async function publicRagSearch(
  query: string,
  config: PublicRagSearchConfig,
  options: { apiKey: string; signal?: AbortSignal },
): Promise<PublicRagSearchOutput> {
  const openai = new OpenAI({ apiKey: options.apiKey });
  const all: Array<PublicRagCitation & { score: number }> = [];

  for (const vectorStoreId of config.tool.vectorStoreIds) {
    const page = await openai.vectorStores.search(vectorStoreId, {
      query,
      max_num_results: config.tool.maxNumResults,
      filters: config.tool.filters as VectorStoreSearchParams['filters'],
      ranking_options: { ranker: 'auto', score_threshold: config.scoreThreshold },
    }, { signal: options.signal });

    for (const result of page.data) {
      const text = result.content.map((content) => content.text).join('\n');
      const citation = citationFromSearchResult(result, text, config);
      if (citation) all.push(citation);
    }
  }

  const seen = new Set<string>();
  const citations = all
    .filter((citation) => {
      const key = `${citation.ragSourceId}:${citation.fileId}:${citation.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, config.tool.maxNumResults);

  return { citations };
}

function citationFromSearchResult(
  value: unknown,
  text: string,
  config: PublicRagSearchConfig,
): (PublicRagCitation & { score: number }) | null {
  if (!isRecord(value)) return null;

  const attributes = isRecord(value.attributes) ? value.attributes : {};
  if (typeof attributes.visibility === 'string' && attributes.visibility !== 'public') return null;

  const fileId = stringValue(value.file_id);
  const ragSourceId = stringValue(attributes.rag_source_id) ?? stringValue(attributes.ragSourceId);
  const projectId = stringValue(attributes.project_id) ?? stringValue(attributes.projectId);

  if (!fileId) return null;

  const source = config.sources.find((candidate) => candidate.openai_file_id === fileId);
  if (!source) return null;
  if (ragSourceId && ragSourceId !== source.id) return null;
  if (projectId && projectId !== source.project_id) return null;

  const trimmed = text.trim();
  if (trimmed.length < config.minTextChars) return null;

  const score = numberValue(value.score);
  if (score === undefined || score < config.scoreThreshold) return null;

  return {
    ragSourceId: source.id,
    projectId: source.project_id,
    fileId: source.openai_file_id,
    ...(typeof value.filename === 'string' ? { filename: value.filename } : {}),
    score,
    text: trimmed,
  };
}

function citationFromResult(
  value: unknown,
  byFileId: Map<string, SearchableRagSource>,
  config: PublicRagSearchConfig,
): PublicRagCitation | null {
  if (!isRecord(value)) return null;

  const attributes = isRecord(value.attributes) ? value.attributes : {};
  if (typeof attributes.visibility === 'string' && attributes.visibility !== 'public') return null;

  const fileId = stringValue(value.fileId) ?? stringValue(value.file_id);
  const ragSourceId = stringValue(attributes.rag_source_id) ?? stringValue(attributes.ragSourceId);
  const projectId = stringValue(attributes.project_id) ?? stringValue(attributes.projectId);

  if (!fileId) return null;

  const source = byFileId.get(fileId);
  if (!source) return null;
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
