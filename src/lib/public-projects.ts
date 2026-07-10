import { CATALOG, type PlaylistId } from '@/data/catalog';
import { buildCatalogShadowRecords } from './db/catalog-shadow';
import { createDbClient, getDatabaseUrl, type DbClient } from './db/client';
import {
  fetchPublicProjectDetails,
  fetchPublicProjectDetailBySlug,
  hasPublishedPublicProjects,
  projectRecordToReadModels,
  type ProjectDetailReadModel,
  type ProjectReadQueryable,
} from './db/project-reads';
import {
  hasPublicProjectDatabaseUrl,
  PublicProjectDataError,
  resolvePublicProjectSourceModeFromEnv,
  type PublicProjectEnv,
  type PublicProjectSourceMode,
} from './public-project-source-mode';

export { PublicProjectDataError } from './public-project-source-mode';
export type {
  PublicProjectDataErrorCode,
  PublicProjectEnv,
  PublicProjectSourceMode,
} from './public-project-source-mode';

export type PublicProjectSource = 'catalog' | 'db';

export interface PublicProjectLoadResult {
  source: PublicProjectSource;
  mode: PublicProjectSourceMode;
  projects: ProjectDetailReadModel[];
  reason?: string;
}

export interface PublicProjectDetailLoadResult {
  source: PublicProjectSource;
  mode: PublicProjectSourceMode;
  project: ProjectDetailReadModel | null;
  reason?: string;
}

export interface PublicProjectLoadOptions {
  env?: PublicProjectEnv;
  db?: ProjectReadQueryable;
}

export function shouldUsePublicProjectDb(env: PublicProjectEnv = process.env): boolean {
  return resolvePublicProjectSourceMode({ env }) === 'database';
}

export function resolvePublicProjectSourceMode(options: PublicProjectLoadOptions = {}): PublicProjectSourceMode {
  const env = options.env ?? process.env;
  return resolvePublicProjectSourceModeFromEnv(env, { hasInjectedDb: Boolean(options.db) });
}

function catalogProjectDetails(): ProjectDetailReadModel[] {
  return buildCatalogShadowRecords(CATALOG).map((record) => projectRecordToReadModels(record).detail);
}

function projectReadDb(client: DbClient): ProjectReadQueryable {
  return {
    query<Row = unknown>(sql: string, params?: unknown[]) {
      return client.query(sql, params) as Promise<Row[]>;
    },
  };
}

let publicProjectLoadCache: {
  mode: Exclude<PublicProjectSourceMode, 'database'>;
  promise: Promise<PublicProjectLoadResult>;
} | null = null;
let emergencySourceWarningEmitted = false;

async function resolvePublicProjectDetails(options: PublicProjectLoadOptions): Promise<PublicProjectLoadResult> {
  const env = options.env ?? process.env;
  const mode = resolvePublicProjectSourceMode(options);

  if (mode !== 'database') {
    if (mode === 'catalog_emergency' && !emergencySourceWarningEmitted) {
      console.warn(
        '[public-projects] SOURCE MODE catalog_emergency: serving the legacy catalog by explicit operator override.',
      );
      emergencySourceWarningEmitted = true;
    }
    return {
      source: 'catalog',
      mode,
      projects: catalogProjectDetails(),
      reason:
        mode === 'catalog_emergency'
          ? 'Explicit operator emergency source selected.'
          : 'Offline development catalog source selected.',
    };
  }

  if (!options.db && !hasPublicProjectDatabaseUrl(env)) {
    throw new PublicProjectDataError(
      'missing_config',
      'Database public-project source is active, but no database connection string is configured.',
    );
  }

  let projects: ProjectDetailReadModel[];
  try {
    const db = options.db ?? projectReadDb(createDbClient(getDatabaseUrl(env)));
    projects = await fetchPublicProjectDetails(db);
  } catch {
    throw new PublicProjectDataError('read_failed', 'Failed to read published project records.');
  }

  if (!projects.length) {
    throw new PublicProjectDataError(
      'empty_published_set',
      'Database public-project source returned an unexpected empty published set.',
    );
  }

  return { source: 'db', mode, projects };
}

export async function loadPublicProjectDetails(options: PublicProjectLoadOptions = {}): Promise<PublicProjectLoadResult> {
  const mode = resolvePublicProjectSourceMode(options);
  if (mode === 'database') {
    return resolvePublicProjectDetails(options);
  }

  if (publicProjectLoadCache?.mode !== mode) {
    publicProjectLoadCache = { mode, promise: resolvePublicProjectDetails(options) };
  }
  return publicProjectLoadCache.promise;
}

/**
 * Resolve one public project for a route/OG request. Database mode deliberately
 * uses a published-slug query rather than loading the complete public set.
 */
export async function loadPublicProjectDetailBySlug(
  slug: string,
  options: PublicProjectLoadOptions = {},
): Promise<PublicProjectDetailLoadResult> {
  const env = options.env ?? process.env;
  const mode = resolvePublicProjectSourceMode(options);

  if (mode !== 'database') {
    return {
      source: 'catalog',
      mode,
      project: catalogProjectDetails().find((project) => project.slug === slug) ?? null,
      reason:
        mode === 'catalog_emergency'
          ? 'Explicit operator emergency source selected.'
          : 'Offline development catalog source selected.',
    };
  }

  if (!options.db && !hasPublicProjectDatabaseUrl(env)) {
    throw new PublicProjectDataError(
      'missing_config',
      'Database public-project source is active, but no database connection string is configured.',
    );
  }

  try {
    const db = options.db ?? projectReadDb(createDbClient(getDatabaseUrl(env)));
    const project = await fetchPublicProjectDetailBySlug(db, slug);
    if (!project && !(await hasPublishedPublicProjects(db))) {
      throw new PublicProjectDataError(
        'empty_published_set',
        'Database public-project source returned an unexpected empty published set.',
      );
    }
    return { source: 'db', mode, project };
  } catch (error) {
    if (error instanceof PublicProjectDataError) throw error;
    throw new PublicProjectDataError('read_failed', 'Failed to read the published project record.');
  }
}

/** Clears the per-process public project load cache. For tests only. */
export function resetPublicProjectDetailsLoadForTests(): void {
  publicProjectLoadCache = null;
  emergencySourceWarningEmitted = false;
}

export function filterPublicProjectDetails(
  projects: ProjectDetailReadModel[],
  filter: PlaylistId,
): ProjectDetailReadModel[] {
  if (filter === 'all') return projects;
  if (filter === 'wip') return projects.filter((project) => project.wip);
  return projects.filter((project) => project.area === filter);
}
