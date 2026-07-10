import { RESUME, getResumeTrackById, type ResumeTrack } from '@/data/resume';
import type { ProjectDetailReadModel, ProjectReadQueryable } from '@/lib/db/project-reads';
import { loadPublicProjectDetails, PublicProjectDataError } from '@/lib/public-projects';
import type { ContactBlock, ProjectSummary, ResumeTrackSummary } from './contract';

export class DMToolError extends Error {
  readonly code: string;
  readonly safeMessage: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DMToolError';
    this.code = code;
    this.safeMessage =
      code === 'bad_project_id' || code === 'bad_resume_track_id'
        ? 'DM can only discuss published portfolio projects and public resume facts.'
        : 'DM could not read the public portfolio data needed for that answer.';
    this.details = details;
  }
}

export interface SearchProjectsInput {
  query: string;
  limit?: number;
}

export interface SearchProjectsOutput {
  query: string;
  projects: ProjectSummary[];
  fallbackUsed: boolean;
  resultStatus: ProjectToolResultStatus;
  message: string;
}

export interface FilterProjectsInput {
  area?: string;
  status?: ProjectSummary['status'][0];
  limit?: number;
}

export interface FilterProjectsOutput {
  projects: ProjectSummary[];
  resultStatus: ProjectToolResultStatus;
  message: string;
}

export interface RankProjectsInput {
  ids?: string[];
  intent?: string;
  limit?: number;
}

export interface RankProjectsOutput {
  projects: ProjectSummary[];
  resultStatus: ProjectToolResultStatus;
  message: string;
}

export type ProjectToolResultStatus = 'complete' | 'partial' | 'fallback' | 'empty';

export interface ReadResumeInput {
  trackIds?: string[];
}

export interface PublicDMDataTools {
  searchProjects(input: SearchProjectsInput): Promise<SearchProjectsOutput>;
  filterProjects(input?: FilterProjectsInput): Promise<FilterProjectsOutput>;
  rankProjects(input?: RankProjectsInput): Promise<RankProjectsOutput>;
  readResume(input?: ReadResumeInput): Promise<{ tracks: ResumeTrackSummary[] }>;
  getContact(): ContactBlock;
  assertProjectIds(ids: string[]): Promise<void>;
  assertResumeTrackIds(ids: string[]): void;
  publishedProjectIds(): Promise<Set<string>>;
  allPublishedProjects(): Promise<ProjectSummary[]>;
}

export type PublishedProjectLoader = () => Promise<ProjectDetailReadModel[]>;

export function createPublicDMDataTools(
  db: ProjectReadQueryable,
  options: { loadProjects?: PublishedProjectLoader } = {},
): PublicDMDataTools {
  let projectsPromise: Promise<ProjectDetailReadModel[]> | null = null;

  async function projects(): Promise<ProjectDetailReadModel[]> {
    const loadProjects = options.loadProjects ?? (() => loadPublicProjectDetails({ db }).then(({ projects }) => projects));
    projectsPromise ??= loadProjects().catch((error: unknown) => {
      projectsPromise = null;
      throw new DMToolError('public_data_unavailable', 'Failed to read active public project records.', {
        cause: error instanceof Error ? error.name : typeof error,
        ...(error instanceof PublicProjectDataError ? { sourceCode: error.code } : {}),
      });
    });
    return projectsPromise;
  }

  async function projectIds(): Promise<Set<string>> {
    return new Set((await projects()).map((project) => project.id));
  }

  async function projectIdsOrEmpty(): Promise<Set<string>> {
    try {
      return await projectIds();
    } catch (error) {
      if (isPublicDataUnavailableError(error)) return new Set();
      throw error;
    }
  }

  async function assertProjectIds(ids: string[]): Promise<void> {
    const allowed = await projectIds();
    const missing = ids.filter((id) => !allowed.has(id));
    if (missing.length > 0) {
      throw new DMToolError('bad_project_id', 'Requested project ids are not published public project records.', {
        count: missing.length,
      });
    }
  }

  function assertResumeTrackIds(ids: string[]): void {
    const missing = ids.filter((id) => !getResumeTrackById(id));
    if (missing.length > 0) {
      throw new DMToolError('bad_resume_track_id', `Unknown resume track ids: ${missing.join(', ')}`, {
        count: missing.length,
      });
    }
  }

  return {
    async searchProjects(input) {
      const query = input.query.trim();
      const tokenSets = expandQuery(query);
      const all = await projects();
      const scored = all
        .map((project) => ({ project, score: scoreProject(project, tokenSets) }))
        .sort((a, b) => b.score - a.score || a.project.id.localeCompare(b.project.id));
      const matched = scored.filter((item) => item.score > 0);
      const ranked = matched
        .slice(0, clampLimit(input.limit, 4))
        .map(({ project }) => summarizeProject(project));
      const resultStatus = projectResultStatus(ranked.length, matched.length);
      return {
        query,
        projects: ranked,
        fallbackUsed: false,
        resultStatus,
        message: projectResultMessage('searchProjects', resultStatus, query),
      };
    },

    async filterProjects(input = {}) {
      const normalizedArea = input.area?.trim().toLowerCase();
      const matches = (await projects())
        .filter((project) => !normalizedArea || project.area.toLowerCase() === normalizedArea)
        .filter((project) => !input.status || project.status[0] === input.status);
      const filtered = matches
        .slice(0, clampLimit(input.limit, 6))
        .map(summarizeProject);
      const resultStatus = projectResultStatus(filtered.length, matches.length);
      return {
        projects: filtered,
        resultStatus,
        message: projectResultMessage('filterProjects', resultStatus),
      };
    },

    async rankProjects(input = {}) {
      const all = await projects();
      if (input.ids?.length) {
        await assertProjectIds(input.ids);
        const byId = new Map(all.map((project) => [project.id, project]));
        const rankedProjects = input.ids
          .map((id) => byId.get(id))
          .filter((project): project is ProjectDetailReadModel => Boolean(project))
          .slice(0, clampLimit(input.limit, input.ids.length))
          .map(summarizeProject);
        const resultStatus = projectResultStatus(rankedProjects.length, input.ids.length);
        return {
          projects: rankedProjects,
          resultStatus,
          message: projectResultMessage('rankProjects', resultStatus),
        };
      }

      const tokenSets = expandQuery(input.intent ?? '');
      const rankedProjects = all
        .map((project) => ({ project, score: impactScore(project, tokenSets) }))
        .sort((a, b) => b.score - a.score || a.project.id.localeCompare(b.project.id))
        .slice(0, clampLimit(input.limit, 4))
        .map(({ project }) => summarizeProject(project));
      const resultStatus = projectResultStatus(rankedProjects.length, all.length);
      return {
        projects: rankedProjects,
        resultStatus,
        message: projectResultMessage('rankProjects', resultStatus),
      };
    },

    async readResume(input = {}) {
      if (input.trackIds?.length) assertResumeTrackIds(input.trackIds);
      const ids = await projectIdsOrEmpty();
      const tracks = (input.trackIds?.length
        ? input.trackIds.map((id) => getResumeTrackById(id)).filter((track): track is ResumeTrack => Boolean(track))
        : RESUME.tracks
      ).map((track) => summarizeResumeTrack(track, ids));
      return { tracks };
    },

    getContact,
    assertProjectIds,
    assertResumeTrackIds,
    publishedProjectIds: projectIds,
    async allPublishedProjects() {
      return (await projects()).map(summarizeProject);
    },
  };
}

function isPublicDataUnavailableError(error: unknown): error is DMToolError {
  return error instanceof DMToolError && error.code === 'public_data_unavailable';
}

function getContact(): ContactBlock {
  const current = RESUME.tracks.find((track) => track.current) ?? RESUME.tracks[RESUME.tracks.length - 1];
  const email = creditValue(current, 'Email');
  const location = creditValue(current, 'Location');
  const status = creditValue(current, 'Status');
  if (!email || !location || !status) {
    throw new DMToolError('missing_contact', 'resume.ts current track is missing contact credits', {
      trackId: current.id,
    });
  }

  return {
    kind: 'contact',
    email,
    github: 'https://github.com/DylanMcCavitt',
    resume: '/resume.pdf',
    location,
    status,
  };
}

function summarizeProject(project: ProjectDetailReadModel): ProjectSummary {
  return {
    id: project.id,
    slug: project.slug,
    title: project.title,
    area: project.area,
    status: project.status,
    year: project.year,
    activity: project.activity,
    line: project.line,
    summary: project.summary,
    href: project.dmArtifact.href,
    wip: project.wip,
    money: project.money,
    links: project.links,
    metrics: project.metrics,
    about: project.about,
    notes: project.notes,
    stack: project.stack,
  };
}

function summarizeResumeTrack(track: ResumeTrack, publishedProjectIds: Set<string>): ResumeTrackSummary {
  return {
    id: track.id,
    title: track.title,
    role: track.role,
    when: track.when,
    about: track.about,
    notes: track.notes,
    credits: track.credits,
    era: track.era.filter((id) => publishedProjectIds.has(id)),
  };
}

function expandQuery(value: string): string[][] {
  const normalized = value.toLowerCase().replace(/[^a-z0-9+.#-]+/g, ' ');
  const tokens = normalized.split(' ').filter((token) => token.length > 1 && !SEARCH_STOP_WORDS.has(token));
  return tokens.map((token) => {
    const synonyms = TERM_SYNONYMS[token];
    return synonyms ? [...new Set([token, ...synonyms])] : [token];
  });
}

function projectHaystack(project: ProjectDetailReadModel): string {
  return [
    project.id,
    project.title,
    project.area,
    project.status[0],
    project.status[1] ?? '',
    String(project.year),
    project.activity,
    project.line,
    project.summary,
    ...project.about,
    ...project.notes,
    ...flattenLabeledValues(project.stack),
    ...flattenLabeledValues(project.metrics),
  ]
    .join(' ')
    .toLowerCase();
}

function flattenLabeledValues(values: unknown[]): string[] {
  return values.flatMap((value) => {
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
    if (value && typeof value === 'object') {
      return Object.values(value).filter((item): item is string => typeof item === 'string');
    }
    return [];
  });
}

function scoreProject(project: ProjectDetailReadModel, tokenSets: string[][]): number {
  if (tokenSets.length === 0) return 0;
  const haystack = projectHaystack(project);
  return tokenSets.reduce((score, terms) => score + (terms.some((term) => haystack.includes(term)) ? 1 : 0), 0);
}

function impactScore(project: ProjectDetailReadModel, tokenSets: string[][]): number {
  const statusScore = project.status[0] === 'live' || project.status[0] === 'done' ? 3 : 1;
  const moneyScore = project.money ? 2 : 0;
  return statusScore + moneyScore + scoreProject(project, tokenSets);
}

function creditValue(track: ResumeTrack, label: string): string {
  return track.credits.find(([creditLabel]) => creditLabel.toLowerCase() === label.toLowerCase())?.[1] ?? '';
}

function clampLimit(limit: number | undefined, fallback: number): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(8, Math.trunc(limit as number)));
}

function projectResultStatus(
  returnedCount: number,
  availableCount: number,
  fallbackUsed = false,
): ProjectToolResultStatus {
  if (returnedCount === 0) return 'empty';
  if (fallbackUsed) return 'fallback';
  if (returnedCount < availableCount) return 'partial';
  return 'complete';
}

function projectResultMessage(
  toolName: 'searchProjects' | 'filterProjects' | 'rankProjects',
  status: ProjectToolResultStatus,
  query?: string,
): string {
  switch (status) {
    case 'complete':
      return 'Only name or discuss projects in this returned projects array.';
    case 'partial':
      return `This is a partial result. Only name or discuss projects in this returned projects array; re-call ${toolName} to retrieve different projects.`;
    case 'fallback':
      return `No exact published project matched${query ? ` "${query}"` : ''}. These are fallback results. Only name or discuss projects in this returned projects array; do not substitute projects from memory or the orientation digest.`;
    case 'empty':
      return `No published projects matched this ${toolName} request. Do not name or substitute projects from memory or the orientation digest.`;
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

const SEARCH_STOP_WORDS = new Set([
  'about',
  'and',
  'are',
  'best',
  'can',
  'dylan',
  'for',
  'his',
  'how',
  'me',
  'project',
  'projects',
  'show',
  'the',
  'what',
  'which',
  'with',
]);

const TERM_SYNONYMS: Record<string, string[]> = {
  ai: ['ai', 'agent', 'agents', 'llm', 'mcp', 'ml'],
  agent: ['agent', 'agents', 'mcp', 'ai', 'llm'],
  agents: ['agents', 'agent', 'mcp', 'ai'],
  llm: ['llm', 'ai', 'agent', 'agents'],
  mcp: ['mcp', 'agent', 'agents', 'ai'],
  ml: ['ml', 'ai', 'model'],
  app: ['app', 'ios', 'mobile'],
  apps: ['apps', 'app', 'ios', 'mobile'],
  ios: ['ios', 'app', 'mobile'],
  mobile: ['mobile', 'app', 'ios'],
  infrastructure: ['infrastructure', 'infra', 'server', 'backend'],
  infra: ['infra', 'infrastructure', 'server', 'backend'],
  backend: ['backend', 'server', 'api', 'infrastructure'],
  frontend: ['frontend', 'web', 'ui'],
  web: ['web', 'frontend', 'ui'],
  ui: ['ui', 'frontend', 'web'],
  trading: ['trading', 'trade', 'options', 'stock', 'robinhood', 'tastytrade'],
  trade: ['trade', 'trading', 'options'],
  automation: ['automation', 'automated', 'workflow', 'script'],
  automated: ['automated', 'automation', 'workflow'],
  workflow: ['workflow', 'automation', 'automated'],
  cloud: ['cloud', 'aws', 'gcp', 'azure'],
  deploy: ['deploy', 'deployment', 'ci', 'cd'],
  database: ['database', 'db', 'postgres', 'sql'],
  db: ['db', 'database', 'postgres', 'sql'],
  test: ['test', 'testing', 'eval', 'benchmark'],
  testing: ['testing', 'test', 'eval', 'benchmark'],
  eval: ['eval', 'evaluate', 'testing', 'benchmark'],
  security: ['security', 'cyber', 'risk', 'kroll'],
  python: ['python', 'script', 'backend'],
  typescript: ['typescript', 'ts', 'js', 'javascript'],
  javascript: ['javascript', 'js', 'typescript', 'ts'],
};
