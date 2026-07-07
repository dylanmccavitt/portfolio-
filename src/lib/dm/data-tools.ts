import { RESUME, getResumeTrackById, type ResumeTrack } from '../../data/resume';
import type { ProjectDetailReadModel, ProjectReadQueryable } from '../db/project-reads';
import { fetchPublicProjectDetails } from '../db/project-reads';
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

export interface FilterProjectsInput {
  area?: string;
  status?: ProjectSummary['status'][0];
  limit?: number;
}

export interface RankProjectsInput {
  ids?: string[];
  intent?: string;
  limit?: number;
}

export interface ReadResumeInput {
  trackIds?: string[];
}

export interface PublicDMDataTools {
  searchProjects(input: SearchProjectsInput): Promise<{ query: string; projects: ProjectSummary[] }>;
  filterProjects(input?: FilterProjectsInput): Promise<{ projects: ProjectSummary[] }>;
  rankProjects(input?: RankProjectsInput): Promise<{ projects: ProjectSummary[] }>;
  readResume(input?: ReadResumeInput): Promise<{ tracks: ResumeTrackSummary[] }>;
  getContact(): ContactBlock;
  assertProjectIds(ids: string[]): Promise<void>;
  assertResumeTrackIds(ids: string[]): void;
  publishedProjectIds(): Promise<Set<string>>;
}

export function createPublicDMDataTools(db: ProjectReadQueryable): PublicDMDataTools {
  let projectsPromise: Promise<ProjectDetailReadModel[]> | null = null;

  async function projects(): Promise<ProjectDetailReadModel[]> {
    projectsPromise ??= fetchPublicProjectDetails(db).catch((error: unknown) => {
      projectsPromise = null;
      throw new DMToolError('public_data_unavailable', 'Failed to read published public project records.', {
        cause: error instanceof Error ? error.name : typeof error,
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
      const tokens = tokenize(query);
      const ranked = (await projects())
        .map((project) => ({ project, score: scoreProject(project, tokens) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || a.project.id.localeCompare(b.project.id))
        .slice(0, clampLimit(input.limit, 4))
        .map(({ project }) => summarizeProject(project));
      return { query, projects: ranked };
    },

    async filterProjects(input = {}) {
      const normalizedArea = input.area?.trim().toLowerCase();
      const filtered = (await projects())
        .filter((project) => !normalizedArea || project.area.toLowerCase() === normalizedArea)
        .filter((project) => !input.status || project.status[0] === input.status)
        .slice(0, clampLimit(input.limit, 6))
        .map(summarizeProject);
      return { projects: filtered };
    },

    async rankProjects(input = {}) {
      const all = await projects();
      if (input.ids?.length) {
        await assertProjectIds(input.ids);
        const byId = new Map(all.map((project) => [project.id, project]));
        return {
          projects: input.ids
            .map((id) => byId.get(id))
            .filter((project): project is ProjectDetailReadModel => Boolean(project))
            .slice(0, clampLimit(input.limit, input.ids.length))
            .map(summarizeProject),
        };
      }

      const tokens = tokenize(input.intent ?? '');
      return {
        projects: all
          .map((project) => ({ project, score: impactScore(project, tokens) }))
          .sort((a, b) => b.score - a.score || a.project.id.localeCompare(b.project.id))
          .slice(0, clampLimit(input.limit, 4))
          .map(({ project }) => summarizeProject(project)),
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
  };
}

function isPublicDataUnavailableError(error: unknown): error is DMToolError {
  return error instanceof DMToolError && error.code === 'public_data_unavailable';
}

export function getContact(): ContactBlock {
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

export function summarizeProject(project: ProjectDetailReadModel): ProjectSummary {
  return {
    id: project.id,
    title: project.title,
    area: project.area,
    status: project.status,
    year: project.year,
    activity: project.activity,
    line: project.line,
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

function tokenize(value: string): string[] {
  const normalized = value.toLowerCase().replace(/[^a-z0-9+.#-]+/g, ' ');
  return normalized.split(' ').filter((token) => token.length > 1 && !SEARCH_STOP_WORDS.has(token));
}

function scoreProject(project: ProjectDetailReadModel, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const haystack = [
    project.id,
    project.title,
    project.area,
    project.activity,
    project.line,
    project.summary,
    ...project.about,
    ...project.notes,
    ...project.stack.flat(),
    ...project.metrics.flat(),
  ]
    .join(' ')
    .toLowerCase();
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function impactScore(project: ProjectDetailReadModel, tokens: string[]): number {
  const statusScore = project.status[0] === 'live' || project.status[0] === 'done' ? 3 : 1;
  const moneyScore = project.money ? 2 : 0;
  return statusScore + moneyScore + scoreProject(project, tokens);
}

function creditValue(track: ResumeTrack, label: string): string {
  return track.credits.find(([creditLabel]) => creditLabel.toLowerCase() === label.toLowerCase())?.[1] ?? '';
}

function clampLimit(limit: number | undefined, fallback: number): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(8, Math.trunc(limit as number)));
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
