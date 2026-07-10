import type { ProjectLink, ProjectMetric, ProjectSeek, ProjectShot, ProjectStackEntry, ProjectStatus } from '@/data/catalog';
import type { ProjectSummary } from '@/lib/dm/contract';
import {
  adaptLegacyProjectDetails,
  adaptLegacyProjectDetailEntries,
  adaptLegacyProjectLinks,
  adaptLegacyProjectMedia,
  adaptLegacyProjectMetrics,
  adaptLegacyProjectSeek,
  adaptLegacyProjectStatus,
} from '@/lib/projects/legacy-adapter';
import {
  ProjectDetailSchema,
  ProjectLinkSchema,
  ProjectMediaSchema,
  ProjectMetricSchema,
  parsePublicProjectFields,
  type ProjectArea,
} from '@/lib/projects/schema';
import { fetchCatalogShadowRecords, type CatalogShadowQueryable, type CatalogShadowRecord } from './catalog-shadow';
import type { JsonValue, ProjectRecord, ProjectSource } from './schema';

export type ProjectReadQueryable = CatalogShadowQueryable;

export interface ProjectCardReadModel {
  id: string;
  slug: string;
  href: string;
  title: string;
  area: ProjectArea;
  status: ProjectStatus;
  year: number;
  activity: string;
  hue: string;
  line: string;
}

export interface ProjectSeoReadModel {
  title: string;
  description: string;
  ogImage: string;
  sitemapPath: string;
}

export interface DmProjectArtifactReadModel extends ProjectSummary {
  kind: 'project';
  href: string;
  source: string;
}

export interface ProjectDetailReadModel extends ProjectCardReadModel {
  summary: string;
  seek: ProjectSeek;
  links: ProjectLink[];
  metrics: ProjectMetric[];
  about: string[];
  notes: string[];
  stack: ProjectStackEntry[];
  shots: ProjectShot[];
  wip: boolean;
  money: boolean;
  source: ProjectSource;
  seo: ProjectSeoReadModel;
  dmArtifact: DmProjectArtifactReadModel;
}

export interface ProjectReadModels {
  card: ProjectCardReadModel;
  detail: ProjectDetailReadModel;
  dmArtifact: DmProjectArtifactReadModel;
}

export interface ProjectLinkFields {
  label: string;
  href: string;
}

export interface ProjectMetricFields {
  value: string;
  label: string;
}

export interface ProjectStackEntryFields {
  label: string;
  value: string;
}

export type ShadowProjectReadResult =
  | { status: 'ok'; projects: ProjectReadModels[] }
  | { status: 'unavailable'; projects: []; reason: string };

type ProjectReadRecord = Omit<ProjectRecord, 'created_at' | 'updated_at'>;

type LegacyCatalogSnapshot = Record<string, JsonValue> & {
  kind: 'legacy_catalog_snapshot';
  status: JsonValue;
  hue: string;
  wip: boolean;
  money: boolean;
  seek: JsonValue;
  about: JsonValue;
  notes: JsonValue;
  stack: JsonValue;
  dmArtifactSource?: string;
};

type ProjectReadDetails = {
  legacy: boolean;
  status: JsonValue;
  hue: string;
  wip: boolean;
  money: boolean;
  seek: JsonValue;
  about: JsonValue;
  notes: JsonValue;
  stack: JsonValue;
  dmArtifactSource?: string;
};

const PROJECT_COLUMNS = `id, slug, title, tagline, area, year, lifecycle_state, activity, summary,
       details, metrics, links, media, source, published_at, archived_at`;

export function projectLinkFromFields(link: ProjectLinkFields): ProjectLink {
  return { label: link.label, href: link.href };
}

export function projectMetricFromFields(metric: ProjectMetricFields): ProjectMetric {
  return { value: metric.value, label: metric.label };
}

export function projectStackEntryFromFields(entry: ProjectStackEntryFields): ProjectStackEntry {
  return { label: entry.label, value: entry.value };
}

export async function fetchInternalShadowProjectReadModels(
  db: ProjectReadQueryable,
): Promise<ProjectReadModels[]> {
  const records = await fetchCatalogShadowRecords(db);
  return records.map(projectRecordToReadModels);
}

export async function tryFetchInternalShadowProjectReadModels(
  db: ProjectReadQueryable | null | undefined,
): Promise<ShadowProjectReadResult> {
  if (!db) return { status: 'unavailable', projects: [], reason: 'Database client is not configured.' };

  try {
    return { status: 'ok', projects: await fetchInternalShadowProjectReadModels(db) };
  } catch (error) {
    return { status: 'unavailable', projects: [], reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function fetchPublicProjectCards(db: ProjectReadQueryable): Promise<ProjectCardReadModel[]> {
  const records = await fetchPublicProjectRecords(db);
  return records.map(projectRecordToReadModels).map((models) => models.card);
}

export async function fetchPublicProjectDetails(db: ProjectReadQueryable): Promise<ProjectDetailReadModel[]> {
  const records = await fetchPublicProjectRecords(db);
  return records.map(projectRecordToReadModels).map((models) => models.detail);
}

export async function fetchPublicProjectDetail(
  db: ProjectReadQueryable,
  id: string,
): Promise<ProjectDetailReadModel | null> {
  const result = await db.query<ProjectReadRecord>(
    `SELECT ${PROJECT_COLUMNS}
     FROM projects
     WHERE lifecycle_state = 'published' AND (id = $1 OR slug = $1)
     LIMIT 1`,
    [id],
  );
  const rows = Array.isArray(result) ? result : result.rows;
  const record = rows[0];
  return record ? projectRecordToReadModels(record).detail : null;
}

export function projectRecordToReadModels(record: ProjectReadRecord | CatalogShadowRecord): ProjectReadModels {
  const readDetails = projectReadDetails(record);
  const status = readDetails.legacy
    ? adaptLegacyProjectStatus(readDetails.status, record.id)
    : (['done', 'Published'] satisfies ProjectStatus);
  const adaptedLinks = parseCanonicalOrLegacyArray(
    ProjectLinkSchema,
    record.links,
    record.id,
    adaptLegacyProjectLinks,
  );
  const adaptedMetrics = parseCanonicalOrLegacyArray(
    ProjectMetricSchema,
    record.metrics,
    record.id,
    adaptLegacyProjectMetrics,
  );
  const adaptedDetails = readDetails.legacy
    ? [
        ...strings(readDetails.about, 'about', record.id),
        ...adaptLegacyProjectDetailEntries(readDetails.stack, record.id),
      ]
    : parseCanonicalOrLegacyArray(ProjectDetailSchema, record.details, record.id, adaptLegacyProjectDetails);
  const notes = strings(readDetails.notes, 'notes', record.id);
  const seek = readDetails.legacy
    ? adaptLegacyProjectSeek(readDetails.seek, record.id)
    : ({ from: 'Draft', to: 'Published', pct: 100 } satisfies ProjectSeek);
  const adaptedMedia = parseCanonicalOrLegacyArray(
    ProjectMediaSchema,
    record.media,
    record.id,
    adaptLegacyProjectMedia,
  );
  const publicFields = parsePublicProjectFields({
    slug: record.slug,
    title: record.title,
    tagline: record.tagline,
    area: record.area,
    year: record.year,
    summary: record.summary,
    activity: record.activity,
    details: adaptedDetails,
    metrics: adaptedMetrics,
    links: adaptedLinks,
    media: adaptedMedia,
  });
  const about = publicFields.details.filter((detail): detail is string => typeof detail === 'string');
  const stack = publicFields.details.filter(
    (detail): detail is ProjectStackEntry => typeof detail !== 'string',
  );
  const href = `/projects/${publicFields.slug}`;
  const card: ProjectCardReadModel = {
    id: record.id,
    slug: publicFields.slug,
    href,
    title: publicFields.title,
    area: publicFields.area,
    status,
    year: publicFields.year,
    activity: publicFields.activity,
    hue: readDetails.hue,
    line: publicFields.tagline,
  };
  const dmArtifact: DmProjectArtifactReadModel = {
    kind: 'project',
    id: record.id,
    title: publicFields.title,
    area: publicFields.area,
    status,
    year: publicFields.year,
    activity: publicFields.activity,
    line: publicFields.tagline,
    wip: readDetails.wip,
    money: readDetails.money,
    links: publicFields.links,
    metrics: publicFields.metrics,
    about,
    notes,
    stack,
    href,
    source: typeof readDetails.dmArtifactSource === 'string' ? readDetails.dmArtifactSource : 'portfolio-db',
  };

  return {
    card,
    detail: {
      ...card,
      summary: publicFields.summary,
      seek,
      links: publicFields.links,
      metrics: publicFields.metrics,
      about,
      notes,
      stack,
      shots: publicFields.media,
      wip: readDetails.wip,
      money: readDetails.money,
      source: record.source,
      seo: {
        title: `${publicFields.title} · Dylan McCavitt`,
        description: publicFields.summary,
        ogImage: `/og/projects/${publicFields.slug}.png`,
        sitemapPath: `/projects/${publicFields.slug}/`,
      },
      dmArtifact,
    },
    dmArtifact,
  };
}

async function fetchPublicProjectRecords(db: ProjectReadQueryable): Promise<ProjectReadRecord[]> {
  const result = await db.query<ProjectReadRecord>(
    `SELECT ${PROJECT_COLUMNS}
     FROM projects
     WHERE lifecycle_state = 'published'
     ORDER BY id`,
  );
  return Array.isArray(result) ? result : result.rows;
}

function projectReadDetails(record: ProjectReadRecord | CatalogShadowRecord): ProjectReadDetails {
  const snapshot = legacySnapshot(record);
  if (snapshot) return { ...snapshot, legacy: true };

  return {
    status: ['done', 'Published'],
    hue: '#8b7cf6',
    wip: false,
    money: false,
    seek: { from: 'Draft', to: 'Published', pct: 100 },
    about: [],
    notes: [],
    stack: [],
    legacy: false,
  };
}

function legacySnapshot(record: ProjectReadRecord | CatalogShadowRecord): LegacyCatalogSnapshot | null {
  const snapshot = record.details.find(
    (detail): detail is LegacyCatalogSnapshot =>
      detail !== null &&
      typeof detail === 'object' &&
      !Array.isArray(detail) &&
      detail.kind === 'legacy_catalog_snapshot',
  );

  return snapshot ?? null;
}

function parseCanonicalOrLegacyArray<Output>(
  itemSchema: { array(): { safeParse(value: unknown): { success: true; data: Output[] } | { success: false } } },
  value: unknown,
  id: string,
  adaptLegacy: (value: unknown, id: string) => Output[],
): Output[] {
  const parsed = itemSchema.array().safeParse(value);
  return parsed.success ? parsed.data : adaptLegacy(value, id);
}

function strings(value: JsonValue, field: string, id: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`Project record ${id} has invalid ${field} read details.`);
  }
  return value;
}
