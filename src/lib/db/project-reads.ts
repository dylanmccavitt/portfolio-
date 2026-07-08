import type { Project, ProjectLink, ProjectMetric, ProjectSeek, ProjectShot, ProjectStackEntry, ProjectStatus } from '@/data/catalog';
import type { ProjectSummary } from '@/lib/dm/contract';
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
  const status = projectStatus(readDetails.status, record.id);
  const links = projectLinks(record.links, record.id, readDetails.legacy);
  const metrics = projectMetrics(record.metrics, record.id, readDetails.legacy);
  const about = strings(readDetails.about, 'about', record.id);
  const notes = strings(readDetails.notes, 'notes', record.id);
  const stack = stringTuples<ProjectStackEntry>(readDetails.stack, 'stack', record.id);
  const seek = projectSeek(readDetails.seek, record.id);
  const shots = projectShotsForRecord(record.media, record, readDetails.legacy);
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
    hue: readDetails.hue,
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
    wip: readDetails.wip,
    money: readDetails.money,
    links,
    metrics,
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
      summary: record.summary,
      seek,
      links,
      metrics,
      about,
      notes,
      stack,
      shots,
      wip: readDetails.wip,
      money: readDetails.money,
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

function projectReadDetails(record: ProjectReadRecord | CatalogShadowRecord): ProjectReadDetails {
  const snapshot = legacySnapshot(record);
  if (snapshot) return { ...snapshot, legacy: true };

  return {
    status: ['done', 'Published'],
    hue: '#8b7cf6',
    wip: false,
    money: false,
    seek: { from: 'Draft', to: 'Published', pct: 100 },
    about: aboutFromPublicDetails(record),
    notes: [],
    stack: stackFromPublicDetails(record.details),
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

function aboutFromPublicDetails(record: ProjectReadRecord | CatalogShadowRecord): string[] {
  const publicDetails = record.details.filter((detail): detail is string => typeof detail === 'string' && detail.trim().length > 0);
  return publicDetails.length ? publicDetails : [record.summary];
}

function stackFromPublicDetails(value: JsonValue): ProjectStackEntry[] {
  if (!Array.isArray(value)) return [];

  const stack: ProjectStackEntry[] = [];
  for (const item of value) {
    if (Array.isArray(item) && item.length === 2 && typeof item[0] === 'string' && typeof item[1] === 'string') {
      stack.push(item as ProjectStackEntry);
      continue;
    }
    const record = jsonRecord(item);
    const label = record?.label;
    const detailValue = record?.value;
    if (typeof label === 'string' && (typeof detailValue === 'string' || typeof detailValue === 'number')) {
      stack.push([label, String(detailValue)]);
    }
  }
  return stack;
}

function projectLinks(value: JsonValue, id: string, legacy: boolean): ProjectLink[] {
  if (legacy) return stringTuples<ProjectLink>(value, 'links', id);
  if (!Array.isArray(value)) return [];

  const links: ProjectLink[] = [];
  for (const item of value) {
    if (Array.isArray(item) && item.length === 2 && typeof item[0] === 'string' && typeof item[1] === 'string') {
      links.push(item as ProjectLink);
      continue;
    }
    const record = jsonRecord(item);
    const label = record?.label;
    const href = record?.href ?? record?.url;
    if (typeof label === 'string' && typeof href === 'string') links.push([label, href]);
  }
  return links;
}

function projectMetrics(value: JsonValue, id: string, legacy: boolean): ProjectMetric[] {
  if (legacy) return stringTuples<ProjectMetric>(value, 'metrics', id);
  if (!Array.isArray(value)) return [];

  const metrics: ProjectMetric[] = [];
  for (const item of value) {
    if (Array.isArray(item) && item.length === 2 && typeof item[0] === 'string' && typeof item[1] === 'string') {
      metrics.push(item as ProjectMetric);
      continue;
    }
    const record = jsonRecord(item);
    const label = record?.label;
    const metricValue = record?.value;
    if (typeof label === 'string' && (typeof metricValue === 'string' || typeof metricValue === 'number')) {
      metrics.push([String(metricValue), label]);
    }
  }
  return metrics;
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

function projectShotsForRecord(
  value: JsonValue,
  record: ProjectReadRecord | CatalogShadowRecord,
  legacy: boolean,
): ProjectShot[] {
  if (legacy) return projectShots(value, record.id);
  if (!Array.isArray(value)) return [];

  const shots: ProjectShot[] = [];
  for (const item of value) {
    if (isProjectShotJson(item)) {
      shots.push(item as unknown as ProjectShot);
      continue;
    }

    const media = jsonRecord(item);
    if (!media) continue;
    const caption =
      (typeof media.cap === 'string' && media.cap) ||
      (typeof media.caption === 'string' && media.caption) ||
      (typeof media.alt === 'string' && media.alt) ||
      (typeof media.label === 'string' && media.label) ||
      `${record.title} screenshot`;
    const source = media.src ?? media.img ?? media.url;
    if (typeof source === 'string') {
      shots.push({
        img: source,
        cap: caption,
        ...(typeof media.phone === 'boolean' ? { phone: media.phone } : {}),
      });
      continue;
    }
    if (typeof media.kind === 'string' && Object.hasOwn(PROJECT_SHOT_KINDS, media.kind)) {
      shots.push({ kind: media.kind, cap: caption } as ProjectShot);
    }
  }
  return shots;
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

function jsonRecord(value: JsonValue): Record<string, JsonValue> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
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
