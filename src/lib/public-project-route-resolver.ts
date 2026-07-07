import type { ProjectDetailReadModel } from './db/project-reads';
import type { PublicProjectSource } from './public-projects';

export interface RequiredProjectReferenceOptions {
  route: string;
  source: PublicProjectSource;
  label?: string;
}

export interface PublicProjectStaticPath {
  params: { id: string };
  props: { project: ProjectDetailReadModel; projects: ProjectDetailReadModel[] };
}

export function publicProjectStaticPaths(
  projects: ProjectDetailReadModel[],
): PublicProjectStaticPath[] {
  return projects.map((project) => ({
    params: { id: project.slug },
    props: { project, projects },
  }));
}

export function resolvePublicProjectByReference(
  projects: ProjectDetailReadModel[],
  reference: string,
): ProjectDetailReadModel | null {
  return (
    projects.find((project) => project.id === reference) ??
    projects.find((project) => project.slug === reference) ??
    null
  );
}

export function resolveRequiredPublicProjectByReference(
  projects: ProjectDetailReadModel[],
  reference: string,
  options: RequiredProjectReferenceOptions,
): ProjectDetailReadModel {
  const project = resolvePublicProjectByReference(projects, reference);
  if (project) return project;

  throw new Error(
    `${options.route}: ${options.label ?? 'project reference'} "${reference}" not found in ${options.source} public project source`,
  );
}
