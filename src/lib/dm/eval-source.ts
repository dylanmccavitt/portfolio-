import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  projectLinkFromFields,
  projectMetricFromFields,
  projectStackEntryFromFields,
  type ProjectDetailReadModel,
  type ProjectReadQueryable,
} from '@/lib/db/project-reads';
import type { PublicRagSearchConfig, PublicRagSearchOutput } from '@/lib/rag/retrieval';

const CorpusEvidenceSchema = z.strictObject({
  privacyState: z.enum(['safe_public', 'private_allowed_for_draft']),
  text: z.string().min(1),
});
const CorpusProjectSchema = z.strictObject({
  id: z.string().min(1),
  slug: z.string().min(1),
  lifecycleState: z.enum(['published', 'draft_only', 'archived']),
  title: z.string().min(1),
  area: z.string().min(1),
  status: z.tuple([z.enum(['dry', 'live', 'wip', 'done']), z.string()]),
  year: z.number().int(),
  activity: z.string(),
  line: z.string(),
  summary: z.string(),
  wip: z.boolean(),
  money: z.boolean(),
  links: z.array(z.strictObject({ label: z.string(), href: z.string() })),
  metrics: z.array(z.strictObject({ value: z.string(), label: z.string() })),
  about: z.array(z.string()),
  notes: z.array(z.string()),
  stack: z.array(z.strictObject({ label: z.string(), value: z.string() })),
  evidence: z.array(CorpusEvidenceSchema).default([]),
});
const CorpusPublicSourceSchema = z.strictObject({
  id: z.string().min(1),
  projectId: z.string().min(1),
  filename: z.string().min(1),
  privacyState: z.literal('safe_public'),
  approvalState: z.literal('approved'),
  text: z.string().min(32),
});
const CorpusSchema = z.strictObject({
  version: z.literal(1),
  projects: z.array(CorpusProjectSchema),
  publicSources: z.array(CorpusPublicSourceSchema),
});

export type EvalPublicSourceSearch = (
  query: string,
  config: PublicRagSearchConfig,
  options: { apiKey: string; signal?: AbortSignal },
) => Promise<PublicRagSearchOutput>;

export interface EvalProjectSource {
  db: ProjectReadQueryable;
  projectLoader: () => Promise<ProjectDetailReadModel[]>;
  publicSourceSearch: EvalPublicSourceSearch;
  publishedIds: string[];
  controlIds: string[];
  privateEvidenceMarkers: string[];
}

export async function createEvalProjectSource(): Promise<EvalProjectSource> {
  const raw = await readFile(new URL('../../../tests/fixtures/dm-published-corpus.json', import.meta.url), 'utf8');
  const corpus = CorpusSchema.parse(JSON.parse(raw));
  const published = corpus.projects.filter((project) => project.lifecycleState === 'published');
  const controls = corpus.projects.filter((project) => project.lifecycleState !== 'published');
  const models = published.map(corpusProjectModel);
  return {
    db: memoryProjectDb(corpus.publicSources),
    projectLoader: async () => models,
    publicSourceSearch: memoryPublicSourceSearch(corpus.publicSources),
    publishedIds: published.map((project) => project.id).sort(),
    controlIds: controls.map((project) => project.id).sort(),
    privateEvidenceMarkers: corpus.projects.flatMap((project) =>
      project.evidence.flatMap((evidence) => evidence.privacyState === 'private_allowed_for_draft' ? [evidence.text] : []),
    ),
  };
}

export function createUnavailableEvalPublicSourceSearch(): EvalPublicSourceSearch {
  return async (_query, _config, options) => {
    throwIfAborted(options.signal);
    throw new Error('simulated eval public source unavailable');
  };
}

function memoryProjectDb(publicSources: z.infer<typeof CorpusPublicSourceSchema>[]): ProjectReadQueryable {
  const searchableRows = publicSources.map((source) => ({
    id: source.id,
    project_id: source.projectId,
    vector_store_id: `vs-eval-${source.id}`,
    openai_file_id: `file-eval-${source.id}`,
  }));
  return {
    async query<Row = unknown>(sql: string) {
      const rows = sql.includes('FROM rag_sources r') ? searchableRows : [];
      return { rows: rows as Row[] };
    },
  };
}

function memoryPublicSourceSearch(
  publicSources: z.infer<typeof CorpusPublicSourceSchema>[],
): EvalPublicSourceSearch {
  return async (query, config, options) => {
    throwIfAborted(options.signal);
    const allowedById = new Map(config.sources.map((source) => [source.id, source]));
    const citations = publicSources
      .flatMap((source) => {
        const indexed = allowedById.get(source.id);
        if (!indexed || indexed.project_id !== source.projectId) return [];
        const score = publicSourceScore(source, query);
        if (score < config.scoreThreshold) return [];
        return [{
          ragSourceId: source.id,
          projectId: source.projectId,
          fileId: indexed.openai_file_id,
          filename: source.filename,
          score,
          text: source.text,
        }];
      })
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
      .slice(0, config.tool.maxNumResults);
    throwIfAborted(options.signal);
    return { citations };
  };
}

function publicSourceScore(source: z.infer<typeof CorpusPublicSourceSchema>, query: string): number {
  const terms = [...new Set(query.toLowerCase().match(/[a-z0-9]+/g) ?? [])]
    .filter((term) => term.length >= 3);
  if (terms.length === 0) return 0;
  const haystack = `${source.projectId} ${source.filename} ${source.text}`.toLowerCase();
  return terms.filter((term) => haystack.includes(term)).length / terms.length;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Eval public-source search aborted.', 'AbortError');
}

function corpusProjectModel(project: z.infer<typeof CorpusProjectSchema>): ProjectDetailReadModel {
  const href = `/projects/${project.slug}`;
  const links = project.links.map(projectLinkFromFields);
  const metrics = project.metrics.map(projectMetricFromFields);
  const stack = project.stack.map(projectStackEntryFromFields);
  return {
    id: project.id,
    slug: project.slug,
    href,
    title: project.title,
    area: project.area as ProjectDetailReadModel['area'],
    status: project.status,
    year: project.year,
    activity: project.activity,
    hue: '#8b7cf6',
    line: project.line,
    summary: project.summary,
    seek: { from: 'Reviewed', to: 'Published', pct: 100 },
    links,
    metrics,
    about: project.about,
    notes: project.notes,
    stack,
    shots: [],
    wip: project.wip,
    money: project.money,
    source: 'test_seed',
    seo: { title: `${project.title} · Dylan McCavitt`, description: project.summary, ogImage: `/og/projects/${project.slug}.png`, sitemapPath: `${href}/` },
    dmArtifact: {
      kind: 'project', id: project.id, title: project.title,
      area: project.area as ProjectDetailReadModel['area'], status: project.status, year: project.year,
      activity: project.activity, line: project.line, href, wip: project.wip, money: project.money,
      links, metrics, about: project.about, notes: project.notes, stack, source: 'portfolio-db',
    },
  };
}
