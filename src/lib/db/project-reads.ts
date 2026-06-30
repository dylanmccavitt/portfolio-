import type { Project, ProjectLink, ProjectMetric, ProjectSeek, ProjectShot, ProjectStackEntry, ProjectStatus } from '../../data/catalog';
import type { ProjectSummary } from '../dm/contract';
import { fetchCatalogShadowRecords, type CatalogShadowQueryable, type CatalogShadowRecord } from './catalog-shadow';
import type { JsonValue, ProjectRecord, ProjectSource } from './schema';

export type ProjectReadQueryable = CatalogShadowQueryable;

export interface ProjectCardReadModel {
  id: string;
  slug: string;
  href: string;
  title: string;
  area: Project['area'];
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

const PROJECT_COLUMNS = `id, slug, title, tagline, area, year, lifecycle_state, activity, summary,
       details, metrics, links, media, source, published_at, archived_at`;
const PROJECT_STATUS_KINDS: Record<string, true> = { dry: true, live: true, wip: true, done: true };
const PROJECT_SHOT_KINDS: Record<string, true> = { chart: true, dash: true, list: true, code: true, phone: true };


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
     WHERE lifecycle_state = 'published' AND id = $1
     LIMIT 1`,
    [id],
  );
  const rows = Array.isArray(result) ? result : result.rows;
  const record = rows[0];
  return record ? projectRecordToReadModels(record).detail : null;
}

export function projectRecordToReadModels(record: ProjectReadRecord | CatalogShadowRecord): ProjectReadModels {
  const snapshot = legacySnapshot(record);
  const status = projectStatus(snapshot.status, record.id);
  const links = stringTuples<ProjectLink>(record.links, 'links', record.id);
  const metrics = stringTuples<ProjectMetric>(record.metrics, 'metrics', record.id);
  const about = strings(snapshot.about, 'about', record.id);
  const notes = strings(snapshot.notes, 'notes', record.id);
  const stack = stringTuples<ProjectStackEntry>(snapshot.stack, 'stack', record.id);
  const seek = projectSeek(snapshot.seek, record.id);
  const shots = projectShots(record.media, record.id);
  const area = record.area as Project['area'];
  const href = `/projects/${record.slug}`;
  const card: ProjectCardReadModel = {
    id: record.id,
    slug: record.slug,
    href,
    title: record.title,
    area,
    status,
    year: record.year,
    activity: record.activity,
    hue: snapshot.hue,
    line: record.tagline,
  };
  const dmArtifact: DmProjectArtifactReadModel = {
    kind: 'project',
    id: record.id,
    title: record.title,
    area,
    status,
    year: record.year,
    activity: record.activity,
    line: record.tagline,
    wip: snapshot.wip,
    money: snapshot.money,
    links,
    metrics,
    about,
    notes,
    stack,
    href,
    source: typeof snapshot.dmArtifactSource === 'string' ? snapshot.dmArtifactSource : 'portfolio-db',
  };

  return {
    card,
    detail: {
      ...card,
      summary: record.summary,
      seek,
      links,
      metrics,
      about,
      notes,
      stack,
      shots,
      wip: snapshot.wip,
      money: snapshot.money,
      source: record.source,
      seo: {
        title: `${record.title} · Dylan McCavitt`,
        description: record.summary,
        ogImage: `/og/projects/${record.slug}.png`,
        sitemapPath: `/projects/${record.slug}/`,
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

function legacySnapshot(record: ProjectReadRecord | CatalogShadowRecord): LegacyCatalogSnapshot {
  const snapshot = record.details.find(
    (detail): detail is LegacyCatalogSnapshot =>
      detail !== null &&
      typeof detail === 'object' &&
      !Array.isArray(detail) &&
      detail.kind === 'legacy_catalog_snapshot',
  );

  if (!snapshot) throw new Error(`Project record ${record.id} is missing legacy catalog read details.`);
  return snapshot;
}

function projectStatus(value: JsonValue, id: string): ProjectStatus {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !Object.hasOwn(PROJECT_STATUS_KINDS, String(value[0])) ||
    typeof value[1] !== 'string'
  ) {
    throw new Error(`Project record ${id} has invalid status read details.`);
  }
  return value as ProjectStatus;
}

function projectSeek(value: JsonValue, id: string): ProjectSeek {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof value.from !== 'string' ||
    typeof value.to !== 'string' ||
    typeof value.pct !== 'number'
  ) {
    throw new Error(`Project record ${id} has invalid seek read details.`);
  }
  return value as unknown as ProjectSeek;
}

function projectShots(value: JsonValue, id: string): ProjectShot[] {
  if (!Array.isArray(value) || !value.every((item) => isProjectShotJson(item))) {
    throw new Error(`Project record ${id} has invalid media read details.`);
  }
  return value as unknown as ProjectShot[];
}

function isProjectShotJson(value: JsonValue): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;

  const shot = value as Record<string, JsonValue | undefined>;
  if (typeof shot.cap !== 'string') return false;
  const hasImg = Object.hasOwn(shot, 'img');
  const hasKind = Object.hasOwn(shot, 'kind');
  if (hasImg === hasKind) return false;
  if (hasImg) {
    return typeof shot.img === 'string' && (shot.phone === undefined || typeof shot.phone === 'boolean');
  }
  return typeof shot.kind === 'string' && Object.hasOwn(PROJECT_SHOT_KINDS, shot.kind);
}

function strings(value: JsonValue, field: string, id: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`Project record ${id} has invalid ${field} read details.`);
  }
  return value;
}

function stringTuples<Tuple extends [string, string]>(value: JsonValue, field: string, id: string): Tuple[] {
  if (
    !Array.isArray(value) ||
    !value.every(
      (item) => Array.isArray(item) && item.length === 2 && typeof item[0] === 'string' && typeof item[1] === 'string',
    )
  ) {
    throw new Error(`Project record ${id} has invalid ${field} read details.`);
  }
  return value as Tuple[];
}
