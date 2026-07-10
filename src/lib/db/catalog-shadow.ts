import { CATALOG, PLAYLIST_SLUGS, type Project } from '@/data/catalog';
import { projectMeta } from '@/lib/seo';
import type { JsonValue, ProjectRecord } from './schema';

export type DbQueryResult<Row = unknown> = { rows: Row[] } | Row[];

export interface CatalogShadowQueryable {
  query<Row = unknown>(sql: string, params?: unknown[]): Promise<DbQueryResult<Row>>;
}


export type CatalogShadowRecord = Omit<ProjectRecord, 'created_at' | 'updated_at'> & {
  created_at?: string;
  updated_at?: string;
};

type CatalogParityField = keyof NormalizedProject;

type ParitySectionName =
  | 'cards'
  | 'details'
  | 'dm_artifacts'
  | 'seo_og_sitemap'
  | 'media_placeholders'
  | 'external_links'
  | 'fallback';

interface NormalizedProject {
  id: string;
  slug: string;
  title: string;
  sym: string;
  area: string;
  status: JsonValue;
  year: number;
  activity: string;
  hue: string;
  wip: boolean;
  money: boolean;
  line: string;
  seek: JsonValue;
  links: JsonValue;
  metrics: JsonValue;
  about: JsonValue;
  notes: JsonValue;
  stack: JsonValue;
  shots: JsonValue;
  seoTitle: string;
  seoDescription: string;
  ogImage: string;
  sitemapPath: string;
  dmArtifactSource: string;
  mediaSummary: JsonValue;
  externalLinks: JsonValue;
  fallbackSource: string;
}

export interface CatalogParityProjectEntry {
  id: string;
  status: 'pass' | 'fail';
  missingFields: CatalogParityField[];
  extraFields: string[];
  mismatchedFields: CatalogParityField[];
}

export interface CatalogParitySection {
  name: ParitySectionName;
  fields: CatalogParityField[];
  status: 'pass' | 'fail';
  failingProjectIds: string[];
}

export interface CatalogParityReport {
  status: 'pass' | 'fail';
  source: 'src/data/catalog.ts';
  shadowTable: 'projects';
  catalogProjectCount: number;
  shadowRecordCount: number;
  importedIds: string[];
  missingRecordIds: string[];
  extraRecordIds: string[];
  sections: CatalogParitySection[];
  projects: CatalogParityProjectEntry[];
}

const SNAPSHOT_KIND = 'legacy_catalog_snapshot';
const FALLBACK_SOURCE = 'src/data/catalog.ts';
const DM_ARTIFACT_SOURCE = 'portfolio-site-canonical-data';

const SECTION_FIELDS: Record<ParitySectionName, CatalogParityField[]> = {
  cards: ['id', 'slug', 'title', 'area', 'year', 'status', 'activity', 'line', 'hue'],
  details: ['about', 'notes', 'metrics', 'stack', 'seek'],
  dm_artifacts: ['id', 'title', 'sym', 'line', 'area', 'status', 'wip', 'money', 'dmArtifactSource'],
  seo_og_sitemap: ['slug', 'seoTitle', 'seoDescription', 'ogImage', 'sitemapPath'],
  media_placeholders: ['shots', 'mediaSummary'],
  external_links: ['links', 'externalLinks'],
  fallback: ['fallbackSource'],
};

const NORMALIZED_PROJECT_FIELDS = new Set<CatalogParityField>(
  Object.values(SECTION_FIELDS).flat(),
);

type LegacyCatalogSnapshot = Record<string, JsonValue> & {
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
  fallbackSource: typeof FALLBACK_SOURCE;
  dmArtifactSource: typeof DM_ARTIFACT_SOURCE;
};

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function mediaSummary(project: Project): JsonValue {
  return {
    total: project.shots.length,
    images: project.shots.filter((shot) => shot.kind === 'image').length,
    videos: project.shots.filter((shot) => shot.kind === 'video').length,
    placeholders: project.shots.filter((shot) => shot.kind === 'skeleton').length,
    captions: project.shots.map((shot) => shot.caption),
  };
}

function externalLinks(project: Project): JsonValue {
  return project.links.map((link) => ({
    label: link.label,
    url: link.href,
    valid: URL.canParse(link.href),
  }));
}

function normalizeProject(project: Project): NormalizedProject {
  const meta = projectMeta(project);

  return {
    id: project.id,
    slug: project.id,
    title: project.title,
    sym: project.sym,
    area: project.area,
    status: toJsonValue(project.status),
    year: project.year,
    activity: project.activity,
    hue: project.hue,
    wip: project.wip,
    money: project.money,
    line: project.line,
    seek: toJsonValue(project.seek),
    links: toJsonValue(project.links),
    metrics: toJsonValue(project.metrics),
    about: toJsonValue(project.about),
    notes: toJsonValue(project.notes),
    stack: toJsonValue(project.stack),
    shots: toJsonValue(project.shots),
    seoTitle: meta.title,
    seoDescription: meta.description,
    ogImage: meta.ogImage,
    sitemapPath: `/projects/${project.id}/`,
    dmArtifactSource: DM_ARTIFACT_SOURCE,
    mediaSummary: mediaSummary(project),
    externalLinks: externalLinks(project),
    fallbackSource: FALLBACK_SOURCE,
  };
}

function snapshotFor(project: Project): LegacyCatalogSnapshot {
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
    fallbackSource: FALLBACK_SOURCE,
    dmArtifactSource: DM_ARTIFACT_SOURCE,
  };
}

function catalogProjectToShadowRecord(project: Project): CatalogShadowRecord {
  return {
    id: project.id,
    slug: project.id,
    title: project.title,
    tagline: project.line,
    area: project.area,
    year: project.year,
    lifecycle_state: 'shadow',
    activity: project.activity,
    summary: projectMeta(project).description,
    details: [snapshotFor(project)],
    metrics: toJsonValue(project.metrics) as JsonValue[],
    links: toJsonValue(project.links) as JsonValue[],
    media: toJsonValue(project.shots) as JsonValue[],
    source: 'legacy_catalog',
    publication_version: '0',
    published_at: null,
    archived_at: null,
  };
}

export function buildCatalogShadowRecords(projects: Project[] = CATALOG): CatalogShadowRecord[] {
  assertUniqueCatalogIds(projects);
  return projects.map(catalogProjectToShadowRecord);
}

export async function importCatalogShadowRecords(
  db: CatalogShadowQueryable,
  projects: Project[] = CATALOG,
): Promise<{ imported: number; ids: string[] }> {
  const records = buildCatalogShadowRecords(projects);

  await assertNoNonLegacyConflicts(db, records);

  for (const record of records) {
    await db.query(
      `INSERT INTO projects (
         id, slug, title, tagline, area, year, lifecycle_state, activity, summary,
         details, metrics, links, media, source, published_at, archived_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9,
         $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14, $15, $16
       )
       ON CONFLICT (id) DO UPDATE SET
         slug = EXCLUDED.slug,
         title = EXCLUDED.title,
         tagline = EXCLUDED.tagline,
         area = EXCLUDED.area,
         year = EXCLUDED.year,
         lifecycle_state = EXCLUDED.lifecycle_state,
         activity = EXCLUDED.activity,
         summary = EXCLUDED.summary,
         details = EXCLUDED.details,
         metrics = EXCLUDED.metrics,
         links = EXCLUDED.links,
         media = EXCLUDED.media,
         source = EXCLUDED.source,
         published_at = EXCLUDED.published_at,
         archived_at = EXCLUDED.archived_at,
         updated_at = now()`,
      [
        record.id,
        record.slug,
        record.title,
        record.tagline,
        record.area,
        record.year,
        record.lifecycle_state,
        record.activity,
        record.summary,
        JSON.stringify(record.details),
        JSON.stringify(record.metrics),
        JSON.stringify(record.links),
        JSON.stringify(record.media),
        record.source,
        record.published_at,
        record.archived_at,
      ],
    );
  }

  return { imported: records.length, ids: records.map((record) => record.id) };
}

async function assertNoNonLegacyConflicts(
  db: CatalogShadowQueryable,
  records: CatalogShadowRecord[],
): Promise<void> {
  const conflicts: string[] = [];

  for (const record of records) {
    const result = await db.query<{ id: string; source: string }>(
      `SELECT id, source
       FROM projects
       WHERE id = $1
         AND source <> 'legacy_catalog'`,
      [record.id],
    );
    const rows = Array.isArray(result) ? result : result.rows;
    conflicts.push(...rows.map((row) => `${row.id} (${row.source})`));
  }

  if (conflicts.length > 0) {
    throw new Error(
      `Refusing to overwrite non-legacy catalog project records: ${conflicts.join(', ')}`,
    );
  }
}

export async function fetchCatalogShadowRecords(
  db: CatalogShadowQueryable,
): Promise<CatalogShadowRecord[]> {
  const result = await db.query<CatalogShadowRecord>(
    `SELECT id, slug, title, tagline, area, year, lifecycle_state, activity, summary,
            details, metrics, links, media, source, published_at, archived_at
     FROM projects
     WHERE source = 'legacy_catalog' AND lifecycle_state = 'shadow'
     ORDER BY id`,
  );

  return Array.isArray(result) ? result : result.rows;
}

export function generateCatalogParityReport(
  records: CatalogShadowRecord[],
  projects: Project[] = CATALOG,
): CatalogParityReport {
  const expected = new Map(projects.map((project) => [project.id, normalizeProject(project)]));
  const actual = new Map(records.map((record) => [record.id, normalizeRecord(record)]));
  const expectedIds = [...expected.keys()].sort();
  const actualIds = [...actual.keys()].sort();
  const missingRecordIds = expectedIds.filter((id) => !actual.has(id));
  const extraRecordIds = actualIds.filter((id) => !expected.has(id));

  const projectEntries = expectedIds.map((id): CatalogParityProjectEntry => {
    const expectedProject = expected.get(id)!;
    const actualProject = actual.get(id);
    const missingFields = actualProject
      ? [...NORMALIZED_PROJECT_FIELDS].filter((field) => actualProject[field] === undefined)
      : [...NORMALIZED_PROJECT_FIELDS];
    const extraFields = actualProject
      ? Object.keys(actualProject).filter((field) => !NORMALIZED_PROJECT_FIELDS.has(field as CatalogParityField))
      : [];
    const mismatchedFields = actualProject
      ? [...NORMALIZED_PROJECT_FIELDS].filter(
          (field) => actualProject[field] !== undefined && !jsonEqual(actualProject[field], expectedProject[field]),
        )
      : [];

    return {
      id,
      status: missingFields.length || extraFields.length || mismatchedFields.length ? 'fail' : 'pass',
      missingFields,
      extraFields,
      mismatchedFields,
    };
  });

  const sections = (Object.entries(SECTION_FIELDS) as [ParitySectionName, CatalogParityField[]][]).map(
    ([name, fields]): CatalogParitySection => {
      const failingProjectIds = projectEntries
        .filter((entry) =>
          [...entry.missingFields, ...entry.mismatchedFields].some((field) => fields.includes(field)),
        )
        .map((entry) => entry.id);

      return {
        name,
        fields,
        status: failingProjectIds.length ? 'fail' : 'pass',
        failingProjectIds,
      };
    },
  );

  const status =
    missingRecordIds.length ||
    extraRecordIds.length ||
    projectEntries.some((entry) => entry.status === 'fail') ||
    sections.some((section) => section.status === 'fail')
      ? 'fail'
      : 'pass';

  return {
    status,
    source: FALLBACK_SOURCE,
    shadowTable: 'projects',
    catalogProjectCount: projects.length,
    shadowRecordCount: records.length,
    importedIds: actualIds,
    missingRecordIds,
    extraRecordIds,
    sections,
    projects: projectEntries,
  };
}

function normalizeRecord(record: CatalogShadowRecord): Partial<NormalizedProject> {
  const snapshot = legacySnapshot(record.details);

  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    sym: snapshot?.sym,
    area: record.area,
    status: snapshot?.status,
    year: record.year,
    activity: record.activity,
    hue: snapshot?.hue,
    wip: snapshot?.wip,
    money: snapshot?.money,
    line: record.tagline,
    seek: snapshot?.seek,
    links: record.links,
    metrics: record.metrics,
    about: snapshot?.about,
    notes: snapshot?.notes,
    stack: snapshot?.stack,
    shots: record.media,
    seoTitle: `${record.title} · Dylan McCavitt`,
    seoDescription: record.summary,
    ogImage: `/og/projects/${record.slug}.png`,
    sitemapPath: `/projects/${record.slug}/`,
    dmArtifactSource: snapshot?.dmArtifactSource,
    mediaSummary: recordMediaSummary(record),
    externalLinks: recordExternalLinks(record),
    fallbackSource: snapshot?.fallbackSource,
    ...extraSnapshotFields(snapshot),
  };
}

function legacySnapshot(details: JsonValue[]): LegacyCatalogSnapshot | undefined {
  return details.find(
    (detail): detail is LegacyCatalogSnapshot =>
      detail !== null &&
      typeof detail === 'object' &&
      !Array.isArray(detail) &&
      'kind' in detail &&
      detail.kind === SNAPSHOT_KIND,
  );
}

function extraSnapshotFields(snapshot: LegacyCatalogSnapshot | undefined): Record<string, JsonValue> {
  if (!snapshot) return {};

  const allowed = new Set(['kind', ...NORMALIZED_PROJECT_FIELDS]);
  return Object.fromEntries(
    Object.entries(snapshot).filter(([field]) => !allowed.has(field)),
  ) as Record<string, JsonValue>;
}

function recordMediaSummary(record: CatalogShadowRecord): JsonValue {
  return {
    total: record.media.length,
    images: record.media.filter((shot) => recordMediaKind(shot) === 'image').length,
    videos: record.media.filter((shot) => recordMediaKind(shot) === 'video').length,
    placeholders: record.media.filter((shot) => recordMediaKind(shot) === 'skeleton').length,
    captions: record.media.map((shot) => recordMediaCaption(shot)),
  };
}

function recordExternalLinks(record: CatalogShadowRecord): JsonValue {
  return record.links.map((link) => {
    const legacy = Array.isArray(link) ? link : [];
    const object = isRecordWithField(link, 'label') ? link : null;
    const label = object?.label ?? legacy[0];
    const url = object && typeof object.href === 'string' ? object.href : legacy[1];
    return {
      label: typeof label === 'string' ? label : '',
      url: typeof url === 'string' ? url : '',
      valid: typeof url === 'string' && URL.canParse(url),
    };
  });
}

function recordMediaKind(value: JsonValue): 'image' | 'video' | 'skeleton' | null {
  if (!isRecordWithField(value, 'kind')) {
    if (isRecordWithField(value, 'img')) return 'image';
    if (isRecordWithField(value, 'video')) return 'video';
    return null;
  }
  if (value.kind === 'image' || value.kind === 'video' || value.kind === 'skeleton') return value.kind;
  return 'skeleton';
}

function recordMediaCaption(value: JsonValue): JsonValue {
  if (isRecordWithField(value, 'caption')) return value.caption;
  if (isRecordWithField(value, 'cap')) return value.cap;
  return null;
}

function isRecordWithField(value: JsonValue, field: string): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && field in value;
}

function jsonEqual(left: JsonValue | string | number | boolean | undefined, right: JsonValue | string | number | boolean | undefined): boolean {
  return JSON.stringify(stableJson(left)) === JSON.stringify(stableJson(right));
}

function stableJson(value: JsonValue | string | number | boolean | undefined): unknown {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableJson(nested)]),
    );
  }
  return value;
}

function assertUniqueCatalogIds(projects: Project[]): void {
  const ids = new Set<string>();
  const slugs = new Set<string>();

  for (const project of projects) {
    if (ids.has(project.id)) throw new Error(`Duplicate catalog project id: ${project.id}`);
    if (slugs.has(project.id)) throw new Error(`Duplicate catalog project slug: ${project.id}`);
    ids.add(project.id);
    slugs.add(project.id);
  }

  for (const slug of Object.values(PLAYLIST_SLUGS)) {
    if (!slug.trim()) throw new Error('Playlist slug cannot be empty.');
  }
}
