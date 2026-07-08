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

type PublicProjectFlag = (typeof PUBLIC_PROJECT_DB_FLAGS)[number];
export type PublicProjectEnv = DatabaseEnv & Partial<Record<PublicProjectFlag, string>> & { VERCEL_ENV?: string };

export type PublicProjectSource = 'catalog' | 'db';

export interface PublicProjectLoadResult {
  source: PublicProjectSource;
  projects: ProjectDetailReadModel[];
  reason?: string;
}

export interface PublicProjectLoadOptions {
  env?: PublicProjectEnv;
  db?: ProjectReadQueryable;
}

export function shouldUsePublicProjectDb(env: PublicProjectEnv = process.env): boolean {
  if (PUBLIC_PROJECT_DB_FLAGS.some((key) => Object.hasOwn(TRUTHY_ENV_VALUES, env[key]?.trim().toLowerCase() ?? ''))) {
    return true;
  }

  // Preview deploys share the Neon preview branch; read published rows when DB is configured.
  if (env.VERCEL_ENV === 'preview' && hasDatabaseUrl(env)) return true;

  return false;
}

/** Public project pages should SSR from the DB instead of prerendering at build time. */
export function shouldRenderPublicProjectsLive(env: PublicProjectEnv = process.env): boolean {
  return shouldUsePublicProjectDb(env);
}

function hasDatabaseUrl(env: DatabaseEnv): boolean {
  return DATABASE_ENV_KEYS.some((key) => Boolean(env[key]?.trim()));
}

function isPublicProjectDbSourceEnabled(options: PublicProjectLoadOptions = {}): boolean {
  const env = options.env ?? process.env;
  return shouldUsePublicProjectDb(env) || options.db !== undefined;
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

let publicProjectLoadPromise: Promise<PublicProjectLoadResult> | null = null;

async function resolvePublicProjectDetails(options: PublicProjectLoadOptions): Promise<PublicProjectLoadResult> {
  const env = options.env ?? process.env;
  const gateEnabled = isPublicProjectDbSourceEnabled(options);
  const catalogFallback = (reason?: string): PublicProjectLoadResult => {
    if (gateEnabled && reason) {
      console.warn(`[public-projects] Using catalog fallback: ${reason}`);
    }
    return {
      source: 'catalog',
      projects: catalogProjectDetails(),
      ...(reason ? { reason } : {}),
    };
  };

  if (!gateEnabled) return catalogFallback('Public project DB gate is disabled.');

  try {
    const db = options.db ?? projectReadDb(createDbClient(getDatabaseUrl(env)));
    const projects = await fetchPublicProjectDetails(db);
    if (!projects.length) return catalogFallback('No published DB project rows were found.');
    return { source: 'db', projects };
  } catch (error) {
    return catalogFallback(error instanceof Error ? error.message : String(error));
  }
}

export async function loadPublicProjectDetails(options: PublicProjectLoadOptions = {}): Promise<PublicProjectLoadResult> {
  if (isPublicProjectDbSourceEnabled(options)) {
    return resolvePublicProjectDetails(options);
  }

  publicProjectLoadPromise ??= resolvePublicProjectDetails(options);
  return publicProjectLoadPromise;
}

/** Clears the per-process public project load cache. For tests only. */
export function resetPublicProjectDetailsLoadForTests(): void {
  publicProjectLoadPromise = null;
}

export function filterPublicProjectDetails(
  projects: ProjectDetailReadModel[],
  filter: PlaylistId,
): ProjectDetailReadModel[] {
  if (filter === 'all') return projects;
  if (filter === 'wip') return projects.filter((project) => project.wip);
  return projects.filter((project) => project.area === filter);
}
