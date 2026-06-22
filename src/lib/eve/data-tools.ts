import {
  AREA_PLAYLISTS,
  CATALOG,
  getProjectById,
  type Project,
  type ProjectArea,
  type StatusKind,
} from '../../data/catalog';
import { getResumeTrackById, RESUME, type ResumeTrack } from '../../data/resume';
import type {
  ContactBlock,
  EveChatContext,
  EveGroundingFixtureId,
  EveGroundingFixtureSet,
  EveGroundingFocus,
  EveGroundingPacket,
  ProjectSummary,
  ResumeTrackSummary,
} from './contract';

export class EveToolError extends Error {
  readonly code: string;
  readonly safeMessage: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'EveToolError';
    this.code = code;
    this.safeMessage =
      code === 'bad_project_id' || code === 'bad_resume_track_id'
        ? 'I could not find one of the site records needed for that answer.'
        : 'I could not read the portfolio data needed for that answer.';
    this.details = details;
  }
}

export interface SearchCatalogInput {
  query: string;
  limit?: number;
}

export interface FilterCatalogInput {
  area?: ProjectArea;
  statusKind?: StatusKind;
  wip?: boolean;
  money?: boolean;
  ids?: string[];
  limit?: number;
}

export interface RankProjectsInput {
  intent?: string;
  ids?: string[];
  limit?: number;
}

export interface ReadResumeInput {
  trackIds?: string[];
}

interface GroundingFixtureSpec {
  id: EveGroundingFixtureId;
  label: string;
  message: string;
  context?: EveChatContext;
  route?: string;
}

export function searchCatalog(input: SearchCatalogInput): { query: string; projects: ProjectSummary[] } {
  const query = input.query.trim();
  if (!query) return { query, projects: [] };

  const tokens = tokenize(query);
  const scored = CATALOG.map((project) => ({
    project,
    score: scoreProject(project, tokens),
  }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || Number(b.project.money) - Number(a.project.money) || a.project.id.localeCompare(b.project.id));

  return {
    query,
    projects: scored.slice(0, clampLimit(input.limit, 6)).map(({ project }) => summarizeProject(project)),
  };
}

export function filterCatalog(input: FilterCatalogInput = {}): { projects: ProjectSummary[] } {
  const candidates = input.ids ? projectsByIds(input.ids) : CATALOG;
  const projects = candidates
    .filter((project) => (input.area ? project.area === input.area : true))
    .filter((project) => (input.statusKind ? project.status[0] === input.statusKind : true))
    .filter((project) => (typeof input.wip === 'boolean' ? project.wip === input.wip : true))
    .filter((project) => (typeof input.money === 'boolean' ? project.money === input.money : true))
    .slice(0, clampLimit(input.limit, 8));

  return { projects: projects.map(summarizeProject) };
}

export function rankProjects(input: RankProjectsInput = {}): { projects: ProjectSummary[] } {
  const intent = input.intent?.trim() || 'most relevant recruiter evidence';
  const tokens = tokenize(intent);
  const candidates = input.ids ? projectsByIds(input.ids) : CATALOG;
  const projects = candidates
    .map((project) => ({
      project,
      score: scoreProject(project, tokens) + impactScore(project, intent),
    }))
    .sort((a, b) => b.score - a.score || a.project.id.localeCompare(b.project.id))
    .slice(0, clampLimit(input.limit, 4))
    .map(({ project }) => summarizeProject(project));

  return { projects };
}

export function readResume(input: ReadResumeInput = {}): {
  title: string;
  line: string;
  about: string;
  tracks: ResumeTrackSummary[];
} {
  const tracks = input.trackIds ? resumeTracksByIds(input.trackIds) : RESUME.tracks;
  return {
    title: RESUME.title,
    line: RESUME.line,
    about: RESUME.about,
    tracks: tracks.map(summarizeResumeTrack),
  };
}

export function getContact(): ContactBlock {
  const current = RESUME.tracks.find((track) => track.current) ?? RESUME.tracks[RESUME.tracks.length - 1];
  const email = creditValue(current, 'Email');
  const location = creditValue(current, 'Location');
  const status = creditValue(current, 'Status');

  if (!email || !location || !status) {
    throw new EveToolError('missing_contact', 'resume.ts current track is missing contact credits', {
      trackId: current.id,
    });
  }

  return {
    email,
    location,
    status,
    resumeHref: '/resume.pdf',
    links: [
      ['Email Dylan', `mailto:${email}`],
      ['Resume PDF', '/resume.pdf'],
      ['Hiring tour', '/hiring'],
    ],
  };
}

export function deriveGroundingContext(message: string, context: EveChatContext = {}): EveGroundingPacket {
  if (context.projectIds) assertProjectIds(context.projectIds);
  if (context.resumeTrackIds) assertResumeTrackIds(context.resumeTrackIds);

  const query = message.trim();
  const normalized = query.toLowerCase();
  const focus = groundingFocus(normalized);
  const projects = groundingProjects(query, normalized, focus, context.projectIds);
  const resume =
    context.resumeTrackIds || focus === 'resume'
      ? readResume(context.resumeTrackIds ? { trackIds: context.resumeTrackIds } : {})
      : readResume({ trackIds: ['now'] });
  const contact = focus === 'contact' ? getContact() : undefined;

  const remoteRequired =
    focus === 'general' &&
    projects.length === 0 &&
    !context.projectIds?.length &&
    !context.resumeTrackIds?.length;

  return {
    version: 1,
    source: 'portfolio-site-canonical-data',
    focus,
    projects,
    resume,
    remoteCall: {
      required: remoteRequired,
      reason: remoteCallReason(focus, remoteRequired),
    },
    ...(contact ? { contact } : {}),
  };
}

export function createGroundingFixtureSet(): EveGroundingFixtureSet {
  return {
    version: 1,
    source: 'portfolio-site-canonical-data',
    generatedFrom: ['src/data/catalog.ts', 'src/data/resume.ts'],
    fixtures: GROUNDING_FIXTURE_SPECS.map((fixture) => {
      const context = fixture.context ?? {};
      const packet = deriveGroundingContext(fixture.message, context);
      return {
        ...fixture,
        context,
        packet:
          fixture.route && context.projectIds
            ? { ...packet, focus: 'projects', projects: filterCatalog({ ids: context.projectIds, limit: 4 }).projects }
            : packet,
      };
    }),
  };
}

export function assertProjectIds(ids: string[]): void {
  const missing = ids.filter((id) => !getProjectById(id));
  if (missing.length > 0) {
    throw new EveToolError('bad_project_id', `Unknown project id: ${missing.join(', ')}`, { ids, missing });
  }
}

export function assertResumeTrackIds(ids: string[]): void {
  const missing = ids.filter((id) => !getResumeTrackById(id));
  if (missing.length > 0) {
    throw new EveToolError('bad_resume_track_id', `Unknown resume track id: ${missing.join(', ')}`, {
      ids,
      missing,
    });
  }
}

export function isProjectArea(value: string): value is ProjectArea {
  return (AREA_PLAYLISTS as string[]).includes(value);
}

export function normalizeProjectArea(area: string | undefined): ProjectArea | undefined {
  if (!area) return undefined;
  if (isProjectArea(area)) return area;

  const match = AREA_PLAYLISTS.find((candidate) => candidate.toLowerCase() === area.toLowerCase());
  if (match) return match;

  throw new EveToolError('bad_project_area', `Unknown project area: ${area}`, { area });
}

function projectsByIds(ids: string[]): Project[] {
  assertProjectIds(ids);
  return ids.map((id) => getProjectById(id)).filter((project): project is Project => Boolean(project));
}

function resumeTracksByIds(ids: string[]): ResumeTrack[] {
  assertResumeTrackIds(ids);
  return ids
    .map((id) => getResumeTrackById(id))
    .filter((track): track is ResumeTrack => Boolean(track));
}

function summarizeProject(project: Project): ProjectSummary {
  return {
    id: project.id,
    title: project.title,
    area: project.area,
    status: project.status,
    year: project.year,
    activity: project.activity,
    line: project.line,
    wip: project.wip,
    money: project.money,
    links: project.links,
    metrics: project.metrics,
    about: project.about,
    notes: project.notes,
    stack: project.stack,
  };
}

function summarizeResumeTrack(track: ResumeTrack): ResumeTrackSummary {
  return {
    id: track.id,
    title: track.title,
    role: track.role,
    when: track.when,
    current: Boolean(track.current),
    about: track.about,
    notes: track.notes,
    credits: track.credits,
    era: track.era,
  };
}

function groundingFocus(normalized: string): EveGroundingFocus {
  if (matchesAny(normalized, ['contact', 'reach', 'email', 'hire', 'open to work', 'available'])) return 'contact';
  if (matchesAny(normalized, ['background', 'resume', 'experience', 'education', 'career'])) return 'resume';
  if (matchesAny(normalized, ['now', 'current', 'building', 'active', 'wip'])) return 'current';
  if (
    matchesAny(normalized, [
      'project',
      'portfolio',
      'ios',
      'iphone',
      'swift',
      'mobile',
      'app store',
      'testflight',
      'trading',
      'options',
      'broker',
      'risk',
      'market',
      'agent',
      'mcp',
      'automation',
      'ai',
      'eval',
      'ship',
      'shipped',
      'client',
      'freelance',
      'ecommerce',
      'full stack',
      'best',
      'impressive',
      'strongest',
      'impact',
    ])
  ) {
    return 'projects';
  }
  return 'general';
}

function remoteCallReason(focus: EveGroundingFocus, required: boolean): string {
  if (!required) {
    switch (focus) {
      case 'contact':
        return 'The contact answer can be served from canonical resume/contact data without waiting for the remote agent.';
      case 'resume':
        return 'The resume answer can be served from the canonical timeline without waiting for the remote agent.';
      case 'projects':
        return 'The project search answer can be served from canonical catalog matches without waiting for the remote agent.';
      case 'current':
        return 'The current-work answer can be served from canonical WIP project and resume data without waiting for the remote agent.';
      case 'general':
        return 'The visitor question matched canonical catalog context, so the site can answer immediately.';
    }
  }

  return 'The visitor question did not match a deterministic portfolio path, so the remote agent is used for conversational synthesis.';
}

function groundingProjects(
  query: string,
  normalized: string,
  focus: EveGroundingFocus,
  projectIds: string[] | undefined,
): ProjectSummary[] {
  const projects: ProjectSummary[] = [];
  appendProjects(projects, projectIds ? filterCatalog({ ids: projectIds, limit: 4 }).projects : []);

  if (projects.length >= 4 || focus === 'contact' || focus === 'resume') {
    return projects.slice(0, 4);
  }

  if (matchesAny(normalized, ['ios', 'iphone', 'swift', 'mobile', 'app store', 'testflight'])) {
    appendProjects(projects, filterCatalog({ area: 'iOS', limit: 4 }).projects);
  } else if (matchesAny(normalized, ['trading', 'options', 'broker', 'risk', 'market'])) {
    appendProjects(projects, searchCatalog({ query: 'trading risk broker options', limit: 4 }).projects);
  } else if (matchesAny(normalized, ['agent', 'mcp', 'automation', 'ai', 'eval'])) {
    appendProjects(projects, filterCatalog({ area: 'Agents & MCP', limit: 4 }).projects);
  } else if (matchesAny(normalized, ['now', 'current', 'building', 'active', 'wip'])) {
    appendProjects(projects, filterCatalog({ wip: true, limit: 4 }).projects);
  } else if (matchesAny(normalized, ['ship', 'shipped', 'client', 'freelance', 'ecommerce', 'full stack'])) {
    appendProjects(projects, filterCatalog({ area: 'Shipped', limit: 4 }).projects);
  } else if (matchesAny(normalized, ['best', 'impressive', 'strongest', 'impact'])) {
    appendProjects(projects, rankProjects({ intent: query, limit: 4 }).projects);
  } else if (query) {
    appendProjects(projects, searchCatalog({ query, limit: 4 }).projects);
  }

  if (projects.length === 0 && focus !== 'general') {
    appendProjects(projects, rankProjects({ intent: query, limit: 3 }).projects);
  }

  return projects.slice(0, 4);
}

function appendProjects(target: ProjectSummary[], next: ProjectSummary[]): void {
  for (const project of next) {
    if (!target.some((item) => item.id === project.id)) target.push(project);
  }
}

function matchesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !SEARCH_STOP_WORDS.has(token));
}

const SEARCH_STOP_WORDS = new Set([
  'about',
  'and',
  'are',
  'can',
  'describe',
  'dylan',
  'for',
  'has',
  'have',
  'her',
  'him',
  'himself',
  'his',
  'how',
  'is',
  'me',
  'of',
  'or',
  'show',
  'should',
  'tell',
  'the',
  'to',
  'what',
  'with',
]);

const GROUNDING_FIXTURE_SPECS: GroundingFixtureSpec[] = [
  {
    id: 'general',
    label: 'General portfolio question',
    message: 'How should Dylan describe himself?',
  },
  {
    id: 'recruiter-contact',
    label: 'Recruiter and contact context',
    message: 'Is Dylan open to work, and how do I contact him?',
  },
  {
    id: 'agent-mcp-work',
    label: 'Agent and MCP work',
    message: 'What should I look at for agent and MCP work?',
  },
  {
    id: 'trading-finance-automation',
    label: 'Trading and finance automation',
    message: 'Which projects show trading and finance automation?',
  },
  {
    id: 'ios-product-work',
    label: 'iOS and product work',
    message: 'Can he ship iOS or mobile product work?',
  },
  {
    id: 'shipped-client-work',
    label: 'Shipped client work',
    message: 'Show me shipped client ecommerce work.',
  },
  {
    id: 'project-page-agentic-trader',
    label: 'Explicit project-page context',
    message: 'Tell me about agentic-trader.',
    context: { projectIds: ['agentic-trader'], resumeTrackIds: ['now'] },
    route: '/projects/agentic-trader',
  },
];

function scoreProject(project: Project, tokens: string[]): number {
  const haystack = [
    project.id,
    project.title,
    project.area,
    project.status[0],
    project.status[1],
    project.activity,
    project.line,
    ...project.about,
    ...project.notes,
    ...project.metrics.flat(),
    ...project.stack.flat(),
  ]
    .join(' ')
    .toLowerCase();

  return tokens.reduce((score, token) => {
    if (project.id.toLowerCase() === token || project.title.toLowerCase().includes(token)) return score + 8;
    if (project.area.toLowerCase().includes(token)) return score + 5;
    return haystack.includes(token) ? score + 2 : score;
  }, 0);
}

function impactScore(project: Project, intent: string): number {
  const normalized = intent.toLowerCase();
  let score = 0;

  if (project.money) score += 8;
  if (project.status[0] === 'live' || project.status[0] === 'done') score += 5;
  if (project.links.length > 0) score += 2;
  if (project.metrics.length > 0) score += 1;
  if (normalized.includes('trading') && project.area === 'Trading systems') score += 6;
  if (normalized.includes('agent') && project.area === 'Agents & MCP') score += 6;
  if (normalized.includes('ios') && project.area === 'iOS') score += 6;
  if (normalized.includes('ship') && project.area === 'Shipped') score += 4;
  if (normalized.includes('impressive') || normalized.includes('best') || normalized.includes('strong')) {
    if (project.id === 'bellas-beads') score += 12;
    if (project.id === 'evalgate') score += 8;
    if (project.id === 'homeserver') score += 6;
    if (project.id === 'exit-manager') score += 4;
  }

  return score;
}

function creditValue(track: ResumeTrack, label: string): string {
  return track.credits.find(([creditLabel]) => creditLabel.toLowerCase() === label.toLowerCase())?.[1] ?? '';
}

function clampLimit(limit: number | undefined, fallback: number): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.trunc(limit ?? fallback), 1), 12);
}
