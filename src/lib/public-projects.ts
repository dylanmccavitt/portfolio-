import { CATALOG, type PlaylistId } from '@/data/catalog';
import {
  buildCatalogRecords,
  projectRecordToReadModels,
  type ProjectDetailReadModel,
} from '@/lib/projects/read-models';

/**
 * The public project source is `src/data/catalog.ts`, everywhere — build and
 * runtime, local and deployed. The database that used to sit behind deployed
 * reads was torn down in #352 ahead of the DM agent replan. The load
 * functions stay async so page frontmatter didn't have to change.
 */

export interface PublicProjectLoadResult {
  source: 'catalog';
  projects: ProjectDetailReadModel[];
}

export interface PublicProjectDetailLoadResult {
  source: 'catalog';
  project: ProjectDetailReadModel | null;
}

let cachedDetails: ProjectDetailReadModel[] | null = null;

function catalogProjectDetails(): ProjectDetailReadModel[] {
  cachedDetails ??= buildCatalogRecords(CATALOG).map((record) => projectRecordToReadModels(record).detail);
  return cachedDetails;
}

export async function loadPublicProjectDetails(): Promise<PublicProjectLoadResult> {
  return { source: 'catalog', projects: catalogProjectDetails() };
}

export async function loadPublicProjectDetailBySlug(slug: string): Promise<PublicProjectDetailLoadResult> {
  return {
    source: 'catalog',
    project: catalogProjectDetails().find((project) => project.slug === slug) ?? null,
  };
}

export function filterPublicProjectDetails(
  projects: ProjectDetailReadModel[],
  filter: PlaylistId,
): ProjectDetailReadModel[] {
  if (filter === 'all') return projects;
  if (filter === 'wip') return projects.filter((project) => project.wip);
  return projects.filter((project) => project.area === filter);
}
