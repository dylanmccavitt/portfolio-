import { RESUME } from '@/data/resume';

export const DM_PAGE_CONTEXT_KINDS = [
  'home',
  'library',
  'project',
  'journey',
] as const;

export type DMPageContextKind = (typeof DM_PAGE_CONTEXT_KINDS)[number];

export interface DMPageContext {
  kind: DMPageContextKind;
  path: string;
  reference?: string;
}

export interface DMGuideAction {
  id: string;
  label: string;
  href: string;
  source:
    | { kind: 'route'; context: DMPageContextKind }
    | { kind: 'evidence'; evidenceId: string };
}

type GuideActionArtifact = {
  kind: string;
  id: string;
  project?: { title: string; href: string; evidenceIds: string[] };
  track?: { id: string; title: string; evidenceIds: string[] };
};

const LIBRARY_PATHS = new Set([
  '/library',
  '/library/wip',
  '/library/shipped-client-work',
  '/library/apps',
  '/library/ai-developer-tools',
  '/library/side-projects-experiments',
  '/library/coursework',
]);
const RESUME_TRACK_IDS = new Set(RESUME.tracks.map((track) => track.id));
const SAFE_REFERENCE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class DMPageContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DMPageContextError';
  }
}

export function parseDMPageContext(value: unknown): DMPageContext {
  if (!isRecord(value)) throw new DMPageContextError('context.page must be an object.');
  const keys = Object.keys(value);
  if (keys.some((key) => !['kind', 'path', 'reference'].includes(key))) {
    throw new DMPageContextError('context.page contains unsupported fields.');
  }
  if (!DM_PAGE_CONTEXT_KINDS.includes(value.kind as DMPageContextKind)) {
    throw new DMPageContextError('context.page.kind is not a supported public route context.');
  }
  if (typeof value.path !== 'string') throw new DMPageContextError('context.page.path must be a string.');
  if (value.reference !== undefined && typeof value.reference !== 'string') {
    throw new DMPageContextError('context.page.reference must be a string when provided.');
  }

  const context: DMPageContext = {
    kind: value.kind as DMPageContextKind,
    path: normalizePublicPath(value.path),
    ...(typeof value.reference === 'string' ? { reference: value.reference } : {}),
  };
  assertContextRoute(context);
  return context;
}

export function dmPageContextId(context: DMPageContext): string {
  return `${context.kind}:${context.path}:${context.reference ?? ''}`;
}

export function deriveGuideActions(
  context: DMPageContext | undefined,
  artifacts: GuideActionArtifact[],
): DMGuideAction[] {
  const page = context ?? { kind: 'home' as const, path: '/' };
  const actions: DMGuideAction[] = [];

  for (const artifact of artifacts) {
    const evidenceId = artifact.project?.evidenceIds[0] ?? artifact.track?.evidenceIds[0];
    if (artifact.kind === 'project' && artifact.project && evidenceId && isAllowedGuideActionDestination(artifact.project.href)) {
      actions.push({
        id: `project:${artifact.id}`,
        label: `View ${artifact.project.title}`,
        href: artifact.project.href,
        source: { kind: 'evidence', evidenceId },
      });
    } else if (artifact.kind === 'resume' && artifact.track && evidenceId) {
      const href = `/journey/${artifact.track.id}`;
      if (isAllowedGuideActionDestination(href)) {
        actions.push({
          id: `resume:${artifact.id}`,
          label: `View ${artifact.track.title}`,
          href,
          source: { kind: 'evidence', evidenceId },
        });
      }
    }
  }

  const routeActions = routeActionCandidates(page.kind);
  for (const [id, label, href] of routeActions) {
    if (actions.some((action) => action.href === href)) continue;
    actions.push({ id, label, href, source: { kind: 'route', context: page.kind } });
    if (actions.length >= 3) break;
  }
  return actions.slice(0, 3);
}

export function isAllowedGuideActionDestination(href: string): boolean {
  if (!href.startsWith('/') || href.startsWith('//') || href.includes('\\')) return false;
  let path: string;
  try {
    const url = new URL(href, 'https://portfolio.invalid');
    if (url.origin !== 'https://portfolio.invalid' || url.search || url.hash) return false;
    path = normalizePublicPath(url.pathname);
  } catch {
    return false;
  }
  return path === '/'
    || LIBRARY_PATHS.has(path)
    || path === '/journey'
    || /^\/journey\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path)
    || /^\/projects\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path);
}

function assertContextRoute(context: DMPageContext): void {
  const reference = context.reference;
  switch (context.kind) {
    case 'home':
      if (context.path !== '/' || reference !== undefined) invalidRoute();
      return;
    case 'library':
      if (!LIBRARY_PATHS.has(context.path) || reference !== undefined) invalidRoute();
      return;
    case 'project':
      if (!reference || !SAFE_REFERENCE.test(reference) || context.path !== `/projects/${reference}`) invalidRoute();
      return;
    case 'journey':
      if (context.path === '/journey') {
        if (reference !== undefined) invalidRoute();
        return;
      }
      if (!reference || !RESUME_TRACK_IDS.has(reference) || context.path !== `/journey/${reference}`) invalidRoute();
  }
}

function routeActionCandidates(kind: DMPageContextKind): Array<[string, string, string]> {
  const candidates: Record<DMPageContextKind, Array<[string, string, string]>> = {
    home: [['library', 'Browse projects', '/library'], ['journey', 'View the journey', '/journey']],
    library: [['home', 'Back to home', '/'], ['journey', 'View the journey', '/journey']],
    project: [['library', 'Browse more projects', '/library'], ['journey', 'View the journey', '/journey']],
    journey: [['library', 'Browse projects', '/library'], ['home', 'Back to home', '/']],
  };
  return candidates[kind];
}

function normalizePublicPath(path: string): string {
  assertCanonicalInputPath(path);
  let url: URL;
  try {
    url = new URL(path, 'https://portfolio.invalid');
  } catch {
    throw new DMPageContextError('context.page.path is not a valid path.');
  }
  if (url.origin !== 'https://portfolio.invalid' || url.search || url.hash || !path.startsWith('/') || path.startsWith('//')) {
    throw new DMPageContextError('context.page.path must be a same-origin public pathname.');
  }
  return url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : '/';
}

function assertCanonicalInputPath(path: string): void {
  if (path.includes('\\')) {
    throw new DMPageContextError('context.page.path must be a canonical public pathname.');
  }
  const pathname = path.split(/[?#]/, 1)[0] ?? '';
  for (const rawSegment of pathname.split('/')) {
    let segment: string;
    try {
      segment = decodeURIComponent(rawSegment);
    } catch {
      throw new DMPageContextError('context.page.path must be a canonical public pathname.');
    }
    if (segment === '.' || segment === '..' || segment.includes('\\')) {
      throw new DMPageContextError('context.page.path must be a canonical public pathname.');
    }
  }
}

function invalidRoute(): never {
  throw new DMPageContextError('context.page does not match an allowlisted public route.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
