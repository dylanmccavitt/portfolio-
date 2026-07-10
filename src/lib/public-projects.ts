import { CATALOG, type PlaylistId } from '@/data/catalog';
import { buildCatalogShadowRecords } from './db/catalog-shadow';
import { createDbClient, getDatabaseUrl, type DatabaseEnv, type DbClient } from './db/client';
import {
  fetchPublicProjectDetails,
  projectRecordToReadModels,
  type ProjectDetailReadModel,
  type ProjectReadQueryable,
} from './db/project-reads';

const PUBLIC_PROJECT_DB_FLAGS = ['PUBLIC_PROJECT_PAGES_FROM_DB', 'PORTFOLIO_PUBLIC_PROJECTS_FROM_DB'] as const;
const DATABASE_ENV_KEYS = ['DATABASE_URL', 'POSTGRES_URL', 'PORTFOLIO_DATABASE_URL', 'PORTFOLIO_POSTGRES_URL'] as const;
const TRUTHY_ENV_VALUES: Record<string, true> = { '1': true, true: true, yes: true, on: true };
const PUBLIC_PROJECT_SOURCE_VALUES = ['database', 'catalog_emergency'] as const;

type PublicProjectFlag = (typeof PUBLIC_PROJECT_DB_FLAGS)[number];
export type PublicProjectEnv = DatabaseEnv &
  Partial<Record<PublicProjectFlag, string>> & {
    PUBLIC_PROJECT_SOURCE?: string;
    CI?: string;
    VERCEL?: string;
    VERCEL_ENV?: string;
    VERCEL_REGION?: string;
  };

export type PublicProjectSource = 'catalog' | 'db';
export type PublicProjectSourceMode = 'database' | 'catalog_development' | 'catalog_emergency';
export type PublicProjectDataErrorCode = 'empty_published_set' | 'invalid_source_mode' | 'missing_config' | 'read_failed';

export class PublicProjectDataError extends Error {
  readonly code: PublicProjectDataErrorCode;

  constructor(code: PublicProjectDataErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PublicProjectDataError';
    this.code = code;
  }
}

export interface PublicProjectLoadResult {
  source: PublicProjectSource;
  mode: PublicProjectSourceMode;
  projects: ProjectDetailReadModel[];
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
  const configuredSource = env.PUBLIC_PROJECT_SOURCE?.trim().toLowerCase();

  if (configuredSource) {
    if (!PUBLIC_PROJECT_SOURCE_VALUES.includes(configuredSource as (typeof PUBLIC_PROJECT_SOURCE_VALUES)[number])) {
      throw new PublicProjectDataError(
        'invalid_source_mode',
        `Invalid PUBLIC_PROJECT_SOURCE. Expected ${PUBLIC_PROJECT_SOURCE_VALUES.join(' or ')}.`,
      );
    }
    return configuredSource as (typeof PUBLIC_PROJECT_SOURCE_VALUES)[number];
  }

  if (options.db) return 'database';

  // Deprecated compatibility flags are database-only. They never enable a
  // catalog escape hatch when the database read fails.
  if (PUBLIC_PROJECT_DB_FLAGS.some((key) => Object.hasOwn(TRUTHY_ENV_VALUES, env[key]?.trim().toLowerCase() ?? ''))) {
    return 'database';
  }

  // Every real Vercel build/function is database-only, including one whose DB
  // configuration is missing. Vercel env pulls also contain VERCEL=1, so pair
  // it with CI (build) or VERCEL_REGION (runtime) to preserve offline builds.
  if (isVercelExecution(env)) return 'database';

  // A configured local database is an intentional database source. Offline
  // local builds use the catalog as a development fixture, not as a fallback.
  if (hasDatabaseUrl(env)) return 'database';

  return 'catalog_development';
}

function hasDatabaseUrl(env: DatabaseEnv): boolean {
  return DATABASE_ENV_KEYS.some((key) => Boolean(env[key]?.trim()));
}

function isVercelExecution(env: PublicProjectEnv): boolean {
  if (env.VERCEL?.trim() !== '1') return false;
  const ci = env.CI?.trim().toLowerCase();
  return ci === '1' || ci === 'true' || Boolean(env.VERCEL_REGION?.trim());
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

  if (!options.db && !hasDatabaseUrl(env)) {
    throw new PublicProjectDataError(
      'missing_config',
      'Database public-project source is active, but no database connection string is configured.',
    );
  }

  let projects: ProjectDetailReadModel[];
  try {
    const db = options.db ?? projectReadDb(createDbClient(getDatabaseUrl(env)));
    projects = await fetchPublicProjectDetails(db);
  } catch (error) {
    throw new PublicProjectDataError('read_failed', 'Failed to read published project records.', { cause: error });
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
