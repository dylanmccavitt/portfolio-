import {
  CATALOG,
  type Project,
  type ProjectLink,
  type ProjectMetric,
  type ProjectSeek,
  type ProjectShot,
  type ProjectStackEntry,
  type ProjectStatus,
} from '@/data/catalog';
import { projectMeta } from '@/lib/seo';
import {
  adaptLegacyProjectDetailEntries,
  adaptLegacyProjectLinks,
  adaptLegacyProjectMedia,
  adaptLegacyProjectMetrics,
  adaptLegacyProjectSeek,
  adaptLegacyProjectStatus,
} from '@/lib/projects/legacy-adapter';
import {
  ProjectLinkSchema,
  ProjectMediaSchema,
  ProjectMetricSchema,
  parsePublicProjectFields,
  type ProjectArea,
} from '@/lib/projects/schema';

/**
 * Pure catalog → read-model conversion. This carries forward the shapes the
 * site rendered when a database sat between the catalog and the pages
 * (#352 tore that down): the catalog entry becomes an intermediate record —
 * the extra catalog-only fields ride in a snapshot entry inside `details` —
 * and the record becomes the card/detail read models the pages consume.
 */

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface CatalogRecord {
  id: string;
  slug: string;
  title: string;
  tagline: string;
  area: ProjectArea;
  year: number;
  activity: string;
  summary: string;
  details: JsonValue[];
  metrics: JsonValue[];
  links: JsonValue[];
  media: JsonValue[];
  source: string;
}

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
  source: string;
  seo: ProjectSeoReadModel;
}

export interface ProjectReadModels {
  card: ProjectCardReadModel;
  detail: ProjectDetailReadModel;
}

const SNAPSHOT_KIND = 'legacy_catalog_snapshot';
const FALLBACK_SOURCE = 'src/data/catalog.ts';

type CatalogSnapshot = Record<string, JsonValue> & {
  kind: typeof SNAPSHOT_KIND;
  sym: string;
  status: JsonValue;
  hue: string;
  wip: boolean;
  money: boolean;
  seek: JsonValue;
  about: JsonValue;
  notes: JsonValue;
  stack: JsonValue;
};

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function snapshotFor(project: Project): CatalogSnapshot {
  return {
    kind: SNAPSHOT_KIND,
    sym: project.sym,
    status: toJsonValue(project.status),
    hue: project.hue,
    wip: project.wip,
    money: project.money,
    seek: toJsonValue(project.seek),
    about: toJsonValue(project.about),
    notes: toJsonValue(project.notes),
    stack: toJsonValue(project.stack),
  };
}

export function catalogProjectToRecord(project: Project): CatalogRecord {
  return {
    id: project.id,
    slug: project.id,
    title: project.title,
    tagline: project.line,
    area: project.area,
    year: project.year,
    activity: project.activity,
    summary: projectMeta(project).description,
    details: [snapshotFor(project)],
    metrics: toJsonValue(project.metrics) as JsonValue[],
    links: toJsonValue(project.links) as JsonValue[],
    media: toJsonValue(project.shots) as JsonValue[],
    source: FALLBACK_SOURCE,
  };
}

function assertUniqueCatalogIds(projects: Project[]): void {
  const seen = new Set<string>();
  for (const project of projects) {
    if (seen.has(project.id)) {
      throw new Error(`Catalog contains duplicate project id: ${project.id}`);
    }
    seen.add(project.id);
  }
}

export function buildCatalogRecords(projects: Project[] = CATALOG): CatalogRecord[] {
  assertUniqueCatalogIds(projects);
  return projects.map(catalogProjectToRecord);
}

export function projectRecordToReadModels(record: CatalogRecord): ProjectReadModels {
  const snapshot = catalogSnapshot(record);
  const status = adaptLegacyProjectStatus(snapshot.status, record.id);
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
  const adaptedDetails = [
    ...strings(snapshot.about, 'about', record.id),
    ...adaptLegacyProjectDetailEntries(snapshot.stack, record.id),
  ];
  const notes = strings(snapshot.notes, 'notes', record.id);
  const seek = adaptLegacyProjectSeek(snapshot.seek, record.id);
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
    hue: snapshot.hue,
    line: publicFields.tagline,
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
      wip: snapshot.wip,
      money: snapshot.money,
      source: record.source,
      seo: {
        title: `${publicFields.title} · Dylan McCavitt`,
        description: publicFields.summary,
        ogImage: `/og/projects/${publicFields.slug}.png`,
        sitemapPath: `/projects/${publicFields.slug}/`,
      },
    },
  };
}

function catalogSnapshot(record: CatalogRecord): CatalogSnapshot {
  const snapshot = record.details.find(
    (detail): detail is CatalogSnapshot =>
      detail !== null &&
      typeof detail === 'object' &&
      !Array.isArray(detail) &&
      detail.kind === SNAPSHOT_KIND,
  );
  if (!snapshot) {
    throw new Error(`Project record ${record.id} is missing its catalog snapshot.`);
  }
  return snapshot;
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
