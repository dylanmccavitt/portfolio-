import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  projectLinkFromFields,
  projectMetricFromFields,
  projectStackEntryFromFields,
  type ProjectDetailReadModel,
  type ProjectReadQueryable,
} from '@/lib/db/project-reads';

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
const CorpusSchema = z.strictObject({ version: z.literal(1), projects: z.array(CorpusProjectSchema) });

export interface EvalProjectSource {
  db: ProjectReadQueryable;
  projectLoader: () => Promise<ProjectDetailReadModel[]>;
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
    db: memoryProjectDb(),
    projectLoader: async () => models,
    publishedIds: published.map((project) => project.id).sort(),
    controlIds: controls.map((project) => project.id).sort(),
    privateEvidenceMarkers: corpus.projects.flatMap((project) =>
      project.evidence.flatMap((evidence) => evidence.privacyState === 'private_allowed_for_draft' ? [evidence.text] : []),
    ),
  };
}

function memoryProjectDb(): ProjectReadQueryable {
  return {
    async query<Row = unknown>() {
      return { rows: [] as Row[] };
    },
  };
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
      kind: 'project', id: project.id, slug: project.slug, title: project.title,
      area: project.area as ProjectDetailReadModel['area'], status: project.status, year: project.year,
      activity: project.activity, line: project.line, href, wip: project.wip, money: project.money,
      links, metrics, about: project.about, notes: project.notes, stack, source: 'portfolio-db',
    },
  };
}
