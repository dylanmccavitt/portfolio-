import { z } from 'zod';
import { RESUME, type ResumeTrack } from '@/data/resume';
import type { ProjectDetailReadModel, ProjectReadQueryable } from '@/lib/db/project-reads';
import { buildPublicFileSearchTool } from '@/lib/rag/ingestion';
import {
  createPublicRagSearchConfig,
  publicRagSearch,
  type PublicRagCitation,
  type PublicRagSearchConfig,
  type PublicRagSearchOutput,
} from '@/lib/rag/retrieval';
import {
  loadPublicProjectDetails,
  type PublicProjectEnv,
} from '@/lib/public-projects';

const TOOL_LIMIT_MAX = 8;
const DEFAULT_TOOL_TIMEOUT_MS = 8_000;

export type PublicToolStatus = 'complete' | 'partial' | 'empty' | 'unavailable';
export type PublicEvidenceSource = 'project' | 'resume' | 'contact' | 'public_source' | 'profile';

export interface PublicToolEvidence {
  id: string;
  source: PublicEvidenceSource;
  recordId: string;
  field: string;
  label: string;
  value: string;
}

export interface PublicToolResult {
  status: PublicToolStatus;
  evidence: PublicToolEvidence[];
  evidenceIds: string[];
  artifactIds: string[];
  limitations: string[];
}

export interface PublicProjectToolRecord {
  id: string;
  slug: string;
  title: string;
  area: string;
  status: string[];
  year: number;
  activity: string;
  tagline: string;
  summary: string;
  about: string[];
  notes: string[];
  stack: Array<{ label: string; value: string }>;
  metrics: Array<{ label: string; value: string }>;
  links: Array<{ label: string; href: string }>;
  href: string;
  artifactId: string;
  evidenceIds: string[];
}

export interface PublicProjectDiscoveryRecord {
  id: string;
  slug: string;
  title: string;
  area: string;
  status: string[];
  year: number;
  activity: string;
  tagline: string;
  summary: string;
  href: string;
  evidenceIds: string[];
}

export interface PublicResumeTrackRecord {
  id: string;
  title: string;
  role: string;
  when: string;
  about: string[];
  notes: string[];
  credits: Array<{ label: string; value: string }>;
  projectIds: string[];
  artifactId: string;
  evidenceIds: string[];
}

export interface PublicResumeRecord {
  title: string;
  tagline: string;
  summary: string;
  evidenceIds: string[];
}

export interface PublicContactRecord {
  email: string;
  github: string;
  resume: string;
  location: string;
  status: string;
  artifactId: 'contact';
  evidenceIds: string[];
}

export interface PublicSourceRecord {
  id: string;
  projectId: string;
  label: string;
  text: string;
  score?: number;
  evidenceIds: string[];
}

/**
 * This is a tool-facing adapter shape, not the #194 storage schema. A later
 * profile source must explicitly mark both publication and public visibility
 * before an entry can cross this boundary.
 */
export interface PublicProfileSourceEntry {
  id: string;
  category: string;
  title: string;
  summary: string;
  href?: string;
  publicationStatus: 'published' | 'draft';
  visibility: 'public' | 'private';
}

export interface PublicProfileRecord {
  id: string;
  category: string;
  title: string;
  summary: string;
  href?: string;
  evidenceIds: string[];
}

const ProjectFiltersSchema = z.strictObject({
  area: z.string().trim().min(1).max(100).optional(),
  status: z.string().trim().min(1).max(100).optional(),
  year: z.number().int().min(1900).max(2200).optional(),
});

export const SearchProjectsInputSchema = z.strictObject({
  query: z.string().trim().min(1).max(500),
  filters: ProjectFiltersSchema.optional(),
  limit: z.number().int().min(1).max(TOOL_LIMIT_MAX).optional(),
});

export const GetProjectInputSchema = z.strictObject({
  id: z.string().trim().min(1).max(200).optional(),
  slug: z.string().trim().min(1).max(200).optional(),
}).refine((input) => Number(Boolean(input.id)) + Number(Boolean(input.slug)) === 1, {
  message: 'Provide exactly one of id or slug.',
});

export const ReadResumeInputSchema = z.strictObject({
  query: z.string().trim().min(1).max(500).optional(),
  trackIds: z.array(z.string().trim().min(1).max(200)).max(TOOL_LIMIT_MAX).optional(),
});

export const GetContactInputSchema = z.strictObject({});

export const SearchPublicSourcesInputSchema = z.strictObject({
  query: z.string().trim().min(1).max(1_000),
  projectIds: z.array(z.string().trim().min(1).max(200)).max(TOOL_LIMIT_MAX).optional(),
  limit: z.number().int().min(1).max(TOOL_LIMIT_MAX).optional(),
});

export const SearchProfileInputSchema = z.strictObject({
  query: z.string().trim().min(1).max(500),
  categories: z.array(z.string().trim().min(1).max(100)).max(TOOL_LIMIT_MAX).optional(),
  limit: z.number().int().min(1).max(TOOL_LIMIT_MAX).optional(),
});

export type SearchProjectsInput = z.infer<typeof SearchProjectsInputSchema>;
export type GetProjectInput = z.infer<typeof GetProjectInputSchema>;
export type ReadResumeInput = z.infer<typeof ReadResumeInputSchema>;
export type GetContactInput = z.infer<typeof GetContactInputSchema>;
export type SearchPublicSourcesInput = z.infer<typeof SearchPublicSourcesInputSchema>;
export type SearchProfileInput = z.infer<typeof SearchProfileInputSchema>;

export interface SearchProjectsResult extends PublicToolResult {
  query: string;
  projects: PublicProjectDiscoveryRecord[];
}

export interface GetProjectResult extends PublicToolResult {
  project: PublicProjectToolRecord | null;
}

export interface ReadResumeResult extends PublicToolResult {
  resume: PublicResumeRecord | null;
  tracks: PublicResumeTrackRecord[];
}

export interface GetContactResult extends PublicToolResult {
  contact: PublicContactRecord | null;
}

export interface SearchPublicSourcesResult extends PublicToolResult {
  query: string;
  sources: PublicSourceRecord[];
}

export interface SearchProfileResult extends PublicToolResult {
  query: string;
  profiles: PublicProfileRecord[];
}

export interface PublicToolCallOptions {
  /** Vercel AI SDK-compatible cancellation option. */
  abortSignal?: AbortSignal;
  /** Direct-call alias used by service and unit-test consumers. */
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface TypedPublicAgentTool<Input, Output> {
  (input: Input, options?: PublicToolCallOptions): Promise<Output>;
  description: string;
  inputSchema: z.ZodType<Input>;
  execute(input: Input, options?: PublicToolCallOptions): Promise<Output>;
}

export interface PublicAgentToolSet {
  searchProjects: TypedPublicAgentTool<SearchProjectsInput, SearchProjectsResult>;
  getProject: TypedPublicAgentTool<GetProjectInput, GetProjectResult>;
  readResume: TypedPublicAgentTool<ReadResumeInput, ReadResumeResult>;
  getContact: TypedPublicAgentTool<GetContactInput, GetContactResult>;
  searchPublicSources: TypedPublicAgentTool<SearchPublicSourcesInput, SearchPublicSourcesResult>;
  searchProfile: TypedPublicAgentTool<SearchProfileInput, SearchProfileResult>;
}

export interface PublicEvidenceLedger {
  has(evidenceId: string): boolean;
  resolve(evidenceIds: readonly string[]): PublicToolEvidence[];
  snapshot(): PublicToolEvidence[];
}

export interface PublicAgentToolRun extends PublicAgentToolSet {
  /** Alias for passing the six tools to a later runtime without changing direct callers. */
  tools: PublicAgentToolSet;
  evidenceLedger: PublicEvidenceLedger;
}

export interface PublicAgentToolDependencies {
  db: ProjectReadQueryable;
  env?: PublicProjectEnv;
  loadProjects?: () => Promise<ProjectDetailReadModel[]>;
  /** Narrow provider-free eval seam; cannot replace or mutate published project data. */
  searchProjectsFailure?: () => never | Promise<never>;
  createRagConfig?: () => Promise<PublicRagSearchConfig | null>;
  ragSearch?: (
    query: string,
    config: PublicRagSearchConfig,
    options: { apiKey: string; signal?: AbortSignal },
  ) => Promise<PublicRagSearchOutput>;
  ragApiKey?: string;
  loadProfileEntries?: () => Promise<PublicProfileSourceEntry[]>;
  timeoutMs?: number;
}

/**
 * Creates one run-local public toolset. The evidence ledger has no write API:
 * evidence enters it only after a tool returns that same evidence to the
 * caller. Conversation messages and model output therefore cannot mint facts.
 */
export function createPublicAgentTools(deps: PublicAgentToolDependencies): PublicAgentToolRun {
  const ledger = createEvidenceLedger();
  const defaultTimeoutMs = deps.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  let projectsPromise: Promise<ProjectDetailReadModel[]> | null = null;

  const loadProjects = (): Promise<ProjectDetailReadModel[]> => {
    projectsPromise ??= (deps.loadProjects
      ? deps.loadProjects()
      : loadPublicProjectDetails({ db: deps.db, env: deps.env }).then((result) => result.projects)
    ).catch((error: unknown) => {
      projectsPromise = null;
      throw error;
    });
    return projectsPromise;
  };

  const searchProjects = createTool(
    'Search compact published-project discovery records only when ranking by topic or resolving a title-only project name whose stable public id or slug is unknown. The result supports identity and concise discovery prose only: call getProject for every detailed project answer, project artifact, or links artifact. Never use this broad search to rediscover a stable id or slug already present in the latest turn, page context, or an earlier returned project record; use getProject for that direct read. Use the area, status, or year filter for a question about that exact published-project aspect.',
    SearchProjectsInputSchema,
    async (input, signal) => {
      const projects = await loadProjects();
      if (deps.searchProjectsFailure) await deps.searchProjectsFailure();
      throwIfAborted(signal);
      const filtered = projects.filter((project) => projectMatchesFilters(project, input.filters));
      const scored = filtered
        .map((project) => ({ project, score: searchScore(projectHaystack(project), input.query) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || a.project.slug.localeCompare(b.project.slug));
      const selected = scored.slice(0, input.limit ?? 4).map(({ project }) => projectDiscoveryRecord(project));
      const evidence = selected.flatMap((record) => projectDiscoveryEvidence(record));
      return resultWithEvidence({
        status: selected.length === 0 ? 'empty' : selected.length < scored.length ? 'partial' : 'complete',
        query: input.query,
        projects: selected,
        evidence,
        artifactIds: [],
        limitations: selected.length === 0
          ? [hasProjectFilters(input.filters) && filtered.length === 0
            ? 'no_matching_published_project_filters'
            : 'no_matching_published_projects']
          : selected.length < scored.length ? ['result_limit'] : [],
      });
    },
    (input) => ({ query: input.query, projects: [] }),
    ledger,
    defaultTimeoutMs,
  );

  const getProject = createTool(
    'Directly read one already-identified published portfolio project when its stable public id or slug is known. A successful same-run getProject is required for every detailed project answer, project artifact, or links artifact; a search result is never a substitute. Use this for resolved subject corrections and follow-up references, including ids supplied by page context. If only a public title is known and its stable id or slug is unresolved, call searchProjects first, once, then call getProject with the resolved id. When the visitor explicitly asks for approved public-source evidence about that project, also call searchPublicSources with the returned project id; project metadata is not a substitute for the requested source evidence.',
    GetProjectInputSchema,
    async (input, signal) => {
      const projects = await loadProjects();
      throwIfAborted(signal);
      const found = projects.find((project) => input.id ? project.id === input.id : project.slug === input.slug);
      if (!found) {
        return resultWithEvidence({
          status: 'empty',
          project: null,
          evidence: [],
          artifactIds: [],
          limitations: ['no_matching_published_projects'],
        });
      }
      const project = projectRecord(found);
      return resultWithEvidence({
        status: 'complete',
        project,
        evidence: projectEvidence(project),
        artifactIds: [project.artifactId],
        limitations: [],
      });
    },
    () => ({ project: null }),
    ledger,
    defaultTimeoutMs,
  );

  const readResume = createTool(
    'Read canonical public resume entries for education, roles, and career background, optionally filtered by a query or stable track ids. For a mixed resume-and-contact question, also call getContact and preserve the requested exact resume evidence in the final answer.',
    ReadResumeInputSchema,
    async (input, signal) => {
      const requested = input.trackIds?.length ? new Set(input.trackIds) : null;
      const knownRequested = requested
        ? RESUME.tracks.filter((track) => requested.has(track.id))
        : RESUME.tracks;
      const matched = input.query
        ? knownRequested.filter((track) => searchScore(resumeHaystack(track), input.query ?? '') > 0)
        : knownRequested;

      if (matched.length === 0) {
        return resultWithEvidence({
          status: 'empty', resume: null, tracks: [], evidence: [], artifactIds: [], limitations: [],
        });
      }

      let publishedProjectIds = new Set<string>();
      let projectLinksAvailable = true;
      try {
        publishedProjectIds = new Set((await loadProjects()).map((project) => project.id));
      } catch {
        projectLinksAvailable = false;
      }
      throwIfAborted(signal);

      const resume = resumeRecord();
      const tracks = matched.map((track) => resumeTrackRecord(track, publishedProjectIds));
      const evidence = [
        ...resumeEvidence(resume),
        ...tracks.flatMap((track) => resumeTrackEvidence(track)),
      ];
      const missingRequested = requested
        ? [...requested].filter((id) => !RESUME.tracks.some((track) => track.id === id)).length
        : 0;
      const limitations = [
        ...(missingRequested > 0 ? ['unknown_track_ids_omitted'] : []),
        ...(!projectLinksAvailable ? ['published_project_links_unavailable'] : []),
      ];
      return resultWithEvidence({
        status: limitations.length > 0 ? 'partial' : 'complete',
        resume,
        tracks,
        evidence,
        artifactIds: tracks.map((track) => track.artifactId),
        limitations,
      });
    },
    () => ({ resume: null, tracks: [] }),
    ledger,
    defaultTimeoutMs,
  );

  const getContact = createTool<GetContactInput, GetContactResult>(
    'Read canonical public contact, location, and availability details. For a mixed contact-and-resume question, also call readResume; this tool does not replace the requested resume evidence.',
    GetContactInputSchema,
    async (_input, signal) => {
      throwIfAborted(signal);
      const contact = contactRecord();
      return resultWithEvidence({
        status: 'complete',
        contact,
        evidence: contactEvidence(contact),
        artifactIds: [contact.artifactId],
        limitations: [],
      });
    },
    () => ({ contact: null }),
    ledger,
    defaultTimeoutMs,
  );

  const searchPublicSources = createTool(
    'Search only indexed, approved public sources linked to published projects. For a project evidence deep dive, also call getProject and pass its published id here; preserve distinctive returned citation evidence exactly instead of substituting project metadata or an unsupported paraphrase.',
    SearchPublicSourcesInputSchema,
    async (input, signal) => {
      const published = await loadProjects();
      throwIfAborted(signal);
      const publishedIds = new Set(published.map((project) => project.id));
      const requestedIds = input.projectIds?.length
        ? input.projectIds.filter((id) => publishedIds.has(id))
        : undefined;
      if (input.projectIds?.length && requestedIds?.length === 0) {
        return resultWithEvidence({
          status: 'empty', query: input.query, sources: [], evidence: [], artifactIds: [],
          limitations: ['no_matching_approved_public_sources'],
        });
      }

      const baseConfig = deps.createRagConfig
        ? await deps.createRagConfig()
        : await createPublicRagSearchConfig(deps.db, { maxNumResults: input.limit ?? 4 });
      throwIfAborted(signal);
      if (!baseConfig) {
        return resultWithEvidence({
          status: 'empty', query: input.query, sources: [], evidence: [], artifactIds: [],
          limitations: ['no_matching_approved_public_sources'],
        });
      }
      const allowedIds = requestedIds ? new Set(requestedIds) : publishedIds;
      const sources = baseConfig.sources.filter((source) => allowedIds.has(source.project_id));
      const tool = buildPublicFileSearchTool(sources);
      if (!tool) {
        return resultWithEvidence({
          status: 'empty', query: input.query, sources: [], evidence: [], artifactIds: [],
          limitations: ['no_matching_approved_public_sources'],
        });
      }
      const limit = input.limit ?? 4;
      const config: PublicRagSearchConfig = {
        ...baseConfig,
        sources,
        tool: {
          vectorStoreIds: tool.vector_store_ids,
          filters: tool.filters,
          maxNumResults: limit,
          ranking: baseConfig.tool.ranking,
        },
      };
      const search = deps.ragSearch ?? publicRagSearch;
      if (search === publicRagSearch && !deps.ragApiKey?.trim()) {
        throw new PublicToolUnavailableError('public_source_config_unavailable');
      }
      const output = await search(input.query, config, { apiKey: deps.ragApiKey ?? '', signal });
      throwIfAborted(signal);
      const sourceById = new Map(sources.map((source) => [source.id, source]));
      const citations = bestAllowedCitations(output.citations, sourceById, allowedIds, config).slice(0, limit);
      const records = citations.map(publicSourceRecord);
      const evidence = records.flatMap((record) => publicSourceEvidence(record));
      return resultWithEvidence({
        status: records.length === 0 ? 'empty' : output.citations.length > records.length || records.length === limit ? 'partial' : 'complete',
        query: input.query,
        sources: records,
        evidence,
        artifactIds: records.map((record) => record.id),
        limitations: records.length === 0
          ? ['no_matching_approved_public_sources']
          : output.citations.length > records.length || records.length === limit ? ['result_limit_or_boundary_filter'] : [],
      });
    },
    (input) => ({ query: input.query, sources: [] }),
    ledger,
    defaultTimeoutMs,
    'public_source_unavailable',
  );

  const searchProfile = createTool(
    'Search published public profile entries. Returns empty until a reviewed profile source is supplied.',
    SearchProfileInputSchema,
    async (input, signal) => {
      if (!deps.loadProfileEntries) {
        return resultWithEvidence({
          status: 'empty',
          query: input.query,
          profiles: [],
          evidence: [],
          artifactIds: [],
          limitations: ['profile_source_not_available'],
        });
      }
      const entries = (await deps.loadProfileEntries())
        .filter((entry) => entry.publicationStatus === 'published' && entry.visibility === 'public')
        .filter((entry) => !input.categories?.length || input.categories.some(
          (category) => category.toLowerCase() === entry.category.toLowerCase(),
        ))
        .map((entry) => ({ entry, score: searchScore(profileHaystack(entry), input.query) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
      throwIfAborted(signal);
      const selected = entries.slice(0, input.limit ?? 4).map(({ entry }) => profileRecord(entry));
      const evidence = selected.flatMap((record) => profileEvidence(record));
      return resultWithEvidence({
        status: selected.length === 0 ? 'empty' : selected.length < entries.length ? 'partial' : 'complete',
        query: input.query,
        profiles: selected,
        evidence,
        artifactIds: [],
        limitations: selected.length < entries.length ? ['result_limit'] : [],
      });
    },
    (input) => ({ query: input.query, profiles: [] }),
    ledger,
    defaultTimeoutMs,
    'profile_source_not_available',
  );

  const tools: PublicAgentToolSet = {
    searchProjects,
    getProject,
    readResume,
    getContact,
    searchPublicSources,
    searchProfile,
  };
  return { ...tools, tools, evidenceLedger: ledger.publicLedger };
}

function createTool<Input, Output extends PublicToolResult>(
  description: string,
  inputSchema: z.ZodType<Input>,
  operation: (input: Input, signal: AbortSignal) => Promise<Output>,
  empty: (input: Input) => Omit<NoInfer<Output>, keyof PublicToolResult>,
  ledger: ReturnType<typeof createEvidenceLedger>,
  defaultTimeoutMs: number,
  unavailableFallback = 'public_data_unavailable',
): TypedPublicAgentTool<Input, Output> {
  const execute = async (rawInput: Input, options: PublicToolCallOptions = {}): Promise<Output> => {
    const input = inputSchema.parse(rawInput);
    const control = callControl(options.signal ?? options.abortSignal, options.timeoutMs ?? defaultTimeoutMs);
    try {
      if (control.signal.aborted) throw new PublicToolAbortError();
      const result = await raceWithSignal(operation(input, control.signal), control.signal);
      ledger.record(result.evidence);
      return result;
    } catch (error) {
      const limitation = unavailableLimitation(error, control.signal, control.timedOut(), unavailableFallback);
      return resultWithEvidence({
        status: 'unavailable',
        ...empty(input),
        evidence: [],
        artifactIds: [],
        limitations: [limitation],
      }) as Output;
    } finally {
      control.dispose();
    }
  };
  const callable = ((input: Input, options?: PublicToolCallOptions) => execute(input, options)) as TypedPublicAgentTool<Input, Output>;
  callable.description = description;
  callable.inputSchema = inputSchema;
  callable.execute = execute;
  return callable;
}

function resultWithEvidence<Shape extends { status: PublicToolStatus; evidence: PublicToolEvidence[]; artifactIds: string[]; limitations: string[] }>(
  result: Shape,
): Shape & Pick<PublicToolResult, 'evidenceIds'> {
  return { ...result, evidenceIds: result.evidence.map((entry) => entry.id) };
}

function createEvidenceLedger() {
  const entries = new Map<string, PublicToolEvidence>();
  const publicLedger: PublicEvidenceLedger = Object.freeze({
    has(evidenceId: string): boolean {
      return entries.has(evidenceId);
    },
    resolve(evidenceIds: readonly string[]): PublicToolEvidence[] {
      return evidenceIds.flatMap((id) => entries.get(id) ?? []).map((entry) => ({ ...entry }));
    },
    snapshot(): PublicToolEvidence[] {
      return [...entries.values()].map((entry) => ({ ...entry }));
    },
  });
  return {
    record(evidence: PublicToolEvidence[]): void {
      for (const entry of evidence) entries.set(entry.id, Object.freeze({ ...entry }));
    },
    publicLedger,
  };
}

function projectRecord(project: ProjectDetailReadModel): PublicProjectToolRecord {
  const artifactId = project.id;
  const record: PublicProjectToolRecord = {
    id: project.id,
    slug: project.slug,
    title: project.title,
    area: project.area,
    status: project.status.filter((value): value is string => Boolean(value)),
    year: project.year,
    activity: project.activity,
    tagline: project.line,
    summary: project.summary,
    about: [...project.about],
    notes: [...project.notes],
    stack: project.stack.map((entry) => ({ label: entry.label, value: entry.value })),
    metrics: project.metrics.map((entry) => ({ label: entry.label, value: entry.value })),
    links: project.links.map((entry) => ({ label: entry.label, href: entry.href })),
    href: project.dmArtifact.href,
    artifactId,
    evidenceIds: [],
  };
  record.evidenceIds = projectEvidence(record).map((entry) => entry.id);
  return record;
}

function projectDiscoveryRecord(project: ProjectDetailReadModel): PublicProjectDiscoveryRecord {
  const record: PublicProjectDiscoveryRecord = {
    id: project.id,
    slug: project.slug,
    title: project.title,
    area: project.area,
    status: project.status.filter((value): value is string => Boolean(value)),
    year: project.year,
    activity: project.activity,
    tagline: project.line,
    summary: project.summary,
    href: project.dmArtifact.href,
    evidenceIds: [],
  };
  record.evidenceIds = projectDiscoveryEvidence(record).map((entry) => entry.id);
  return record;
}

function projectDiscoveryEvidence(project: PublicProjectDiscoveryRecord): PublicToolEvidence[] {
  return [
    evidenceAtom(`${project.id}:identity`, 'project', project.id, 'identity', 'Project', project.title),
    evidenceAtom(`${project.id}:slug`, 'project', project.id, 'slug', 'Project slug', project.slug),
    evidenceAtom(`${project.id}:href`, 'project', project.id, 'href', 'Project page', project.href),
    evidenceAtom(`${project.id}:area`, 'project', project.id, 'area', 'Area', project.area),
    evidenceAtom(`${project.id}:status`, 'project', project.id, 'status', 'Status', project.status.join(' / ')),
    evidenceAtom(`${project.id}:year`, 'project', project.id, 'year', 'Year', String(project.year)),
    evidenceAtom(`${project.id}:activity`, 'project', project.id, 'activity', 'Activity', project.activity),
    evidenceAtom(`${project.id}:tagline`, 'project', project.id, 'tagline', 'Tagline', project.tagline),
    evidenceAtom(`${project.id}:summary`, 'project', project.id, 'summary', 'Summary', project.summary),
  ].filter((entry) => entry.value.trim().length > 0);
}

function projectEvidence(project: PublicProjectToolRecord): PublicToolEvidence[] {
  const evidence = [
    evidenceAtom(`${project.id}:identity`, 'project', project.id, 'identity', 'Project', project.title),
    evidenceAtom(`${project.id}:slug`, 'project', project.id, 'slug', 'Project slug', project.slug),
    evidenceAtom(`${project.id}:href`, 'project', project.id, 'href', 'Project page', project.href),
    evidenceAtom(`${project.id}:area`, 'project', project.id, 'area', 'Area', project.area),
    evidenceAtom(`${project.id}:status`, 'project', project.id, 'status', 'Status', project.status.join(' / ')),
    evidenceAtom(`${project.id}:year`, 'project', project.id, 'year', 'Year', String(project.year)),
    evidenceAtom(`${project.id}:activity`, 'project', project.id, 'activity', 'Activity', project.activity),
    evidenceAtom(`${project.id}:tagline`, 'project', project.id, 'tagline', 'Tagline', project.tagline),
    evidenceAtom(`${project.id}:summary`, 'project', project.id, 'summary', 'Summary', project.summary),
    ...project.about.map((value, index) => evidenceAtom(`${project.id}:about:${index}`, 'project', project.id, `about.${index}`, `About ${index + 1}`, value)),
    ...project.notes.map((value, index) => evidenceAtom(`${project.id}:notes:${index}`, 'project', project.id, `notes.${index}`, `Note ${index + 1}`, value)),
    ...project.stack.map((entry, index) => evidenceAtom(`${project.id}:stack:${index}`, 'project', project.id, `stack.${index}`, entry.label, entry.value)),
    ...project.metrics.map((entry, index) => evidenceAtom(`${project.id}:metric:${index}`, 'project', project.id, `metrics.${index}`, entry.label, entry.value)),
    ...project.links.map((entry, index) => evidenceAtom(`${project.id}:link:${index}`, 'project', project.id, `links.${index}`, entry.label, entry.href)),
  ];
  return evidence.filter((entry) => entry.value.trim().length > 0);
}

function resumeRecord(): PublicResumeRecord {
  const record: PublicResumeRecord = {
    title: RESUME.title,
    tagline: RESUME.line,
    summary: RESUME.about,
    evidenceIds: [],
  };
  record.evidenceIds = resumeEvidence(record).map((entry) => entry.id);
  return record;
}

function resumeEvidence(resume: PublicResumeRecord): PublicToolEvidence[] {
  return [
    evidenceAtom('resume:identity', 'resume', 'resume', 'identity', 'Resume', resume.title),
    evidenceAtom('resume:tagline', 'resume', 'resume', 'tagline', 'Career path', resume.tagline),
    evidenceAtom('resume:summary', 'resume', 'resume', 'summary', 'Resume summary', resume.summary),
  ];
}

function resumeTrackRecord(track: ResumeTrack, publishedProjectIds: Set<string>): PublicResumeTrackRecord {
  const record: PublicResumeTrackRecord = {
    id: track.id,
    title: track.title,
    role: track.role,
    when: track.when,
    about: [...track.about],
    notes: [...track.notes],
    credits: track.credits.map(([label, value]) => ({ label, value })),
    projectIds: track.era.filter((id) => publishedProjectIds.has(id)),
    artifactId: track.id,
    evidenceIds: [],
  };
  record.evidenceIds = resumeTrackEvidence(record).map((entry) => entry.id);
  return record;
}

function resumeTrackEvidence(track: PublicResumeTrackRecord): PublicToolEvidence[] {
  const prefix = `resume:${track.id}`;
  return [
    evidenceAtom(`${prefix}:identity`, 'resume', track.id, 'identity', 'Resume entry', track.title),
    evidenceAtom(`${prefix}:role`, 'resume', track.id, 'role', 'Role', track.role),
    evidenceAtom(`${prefix}:when`, 'resume', track.id, 'when', 'When', track.when),
    ...track.about.map((value, index) => evidenceAtom(`${prefix}:about:${index}`, 'resume', track.id, `about.${index}`, `About ${index + 1}`, value)),
    ...track.notes.map((value, index) => evidenceAtom(`${prefix}:notes:${index}`, 'resume', track.id, `notes.${index}`, `Note ${index + 1}`, value)),
    ...track.credits.map((credit, index) => evidenceAtom(`${prefix}:credit:${index}`, 'resume', track.id, `credits.${index}`, credit.label, credit.value)),
    ...track.projectIds.map((id, index) => evidenceAtom(`${prefix}:project:${index}`, 'resume', track.id, `projectIds.${index}`, 'Published project', id)),
  ].filter((entry) => entry.value.trim().length > 0);
}

function contactRecord(): PublicContactRecord {
  const current = RESUME.tracks.find((track) => track.current) ?? RESUME.tracks.at(-1);
  const email = current && creditValue(current, 'Email');
  const location = current && creditValue(current, 'Location');
  const status = current && creditValue(current, 'Status');
  if (!email || !location || !status) throw new PublicToolUnavailableError('contact_source_unavailable');
  const record: PublicContactRecord = {
    email,
    github: 'https://github.com/DylanMcCavitt',
    resume: '/resume.pdf',
    location,
    status,
    artifactId: 'contact',
    evidenceIds: [],
  };
  record.evidenceIds = contactEvidence(record).map((entry) => entry.id);
  return record;
}

function contactEvidence(contact: PublicContactRecord): PublicToolEvidence[] {
  return [
    evidenceAtom('contact:email', 'contact', 'contact', 'email', 'Email', contact.email),
    evidenceAtom('contact:github', 'contact', 'contact', 'github', 'GitHub', contact.github),
    evidenceAtom('contact:resume', 'contact', 'contact', 'resume', 'Resume', contact.resume),
    evidenceAtom('contact:location', 'contact', 'contact', 'location', 'Location', contact.location),
    evidenceAtom('contact:status', 'contact', 'contact', 'status', 'Status', contact.status),
  ];
}

function publicSourceRecord(citation: PublicRagCitation): PublicSourceRecord {
  const record: PublicSourceRecord = {
    id: citation.ragSourceId,
    projectId: citation.projectId,
    label: citation.filename ?? 'Approved public source',
    text: citation.text,
    ...(citation.score === undefined ? {} : { score: citation.score }),
    evidenceIds: [],
  };
  record.evidenceIds = publicSourceEvidence(record).map((entry) => entry.id);
  return record;
}

function publicSourceEvidence(source: PublicSourceRecord): PublicToolEvidence[] {
  return [evidenceAtom(`citation:${source.id}`, 'public_source', source.id, 'text', source.label, source.text)];
}

function profileRecord(entry: PublicProfileSourceEntry): PublicProfileRecord {
  const href = safePublicHref(entry.href);
  const record: PublicProfileRecord = {
    id: entry.id,
    category: entry.category,
    title: entry.title,
    summary: entry.summary,
    ...(href ? { href } : {}),
    evidenceIds: [],
  };
  record.evidenceIds = profileEvidence(record).map((evidence) => evidence.id);
  return record;
}

function profileEvidence(profile: PublicProfileRecord): PublicToolEvidence[] {
  return [
    evidenceAtom(`profile:${profile.id}:identity`, 'profile', profile.id, 'identity', 'Profile entry', profile.title),
    evidenceAtom(`profile:${profile.id}:category`, 'profile', profile.id, 'category', 'Category', profile.category),
    evidenceAtom(`profile:${profile.id}:summary`, 'profile', profile.id, 'summary', 'Summary', profile.summary),
    ...(profile.href ? [evidenceAtom(`profile:${profile.id}:href`, 'profile', profile.id, 'href', 'Public link', profile.href)] : []),
  ];
}

function evidenceAtom(
  id: string,
  source: PublicEvidenceSource,
  recordId: string,
  field: string,
  label: string,
  value: string,
): PublicToolEvidence {
  return { id, source, recordId, field, label, value };
}

function bestAllowedCitations(
  citations: PublicRagCitation[],
  sourceById: Map<string, PublicRagSearchConfig['sources'][number]>,
  allowedProjectIds: Set<string>,
  config: PublicRagSearchConfig,
): PublicRagCitation[] {
  const best = new Map<string, PublicRagCitation>();
  for (const citation of citations) {
    const source = sourceById.get(citation.ragSourceId);
    if (!source || source.project_id !== citation.projectId || source.openai_file_id !== citation.fileId) continue;
    if (!allowedProjectIds.has(citation.projectId) || citation.text.trim().length < config.minTextChars) continue;
    if (citation.score === undefined || citation.score < config.scoreThreshold) continue;
    const previous = best.get(citation.ragSourceId);
    if (!previous || (citation.score ?? 0) > (previous.score ?? 0)) best.set(citation.ragSourceId, citation);
  }
  return [...best.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.ragSourceId.localeCompare(b.ragSourceId));
}

function projectMatchesFilters(project: ProjectDetailReadModel, filters: SearchProjectsInput['filters']): boolean {
  if (!filters) return true;
  if (filters.area && project.area.toLowerCase() !== filters.area.toLowerCase()) return false;
  if (filters.status && !project.status.some((status) => status?.toLowerCase() === filters.status?.toLowerCase())) return false;
  return filters.year === undefined || project.year === filters.year;
}

function hasProjectFilters(filters: SearchProjectsInput['filters']): boolean {
  return Boolean(filters?.area || filters?.status || filters?.year !== undefined);
}

function projectHaystack(project: ProjectDetailReadModel): string {
  return [
    project.id, project.slug, project.title, project.area, ...project.status, String(project.year), project.activity,
    project.line, project.summary, ...project.about, ...project.notes,
    ...project.stack.flatMap((entry) => [entry.label, entry.value]),
    ...project.metrics.flatMap((entry) => [entry.label, entry.value]),
  ].join(' ');
}

function resumeHaystack(track: ResumeTrack): string {
  return [
    track.id, track.title, track.role, track.when, ...track.about, ...track.notes,
    ...track.credits.flatMap(([label, value]) => [label, value]),
  ].join(' ');
}

function profileHaystack(entry: PublicProfileSourceEntry): string {
  return [entry.id, entry.category, entry.title, entry.summary].join(' ');
}

function searchScore(haystack: string, query: string): number {
  const normalized = haystack.toLowerCase();
  const tokens = query.toLowerCase().match(/[a-z0-9+.#-]{2,}/g) ?? [];
  return [...new Set(tokens)].reduce((score, token) => score + Number(normalized.includes(token)), 0);
}

function safePublicHref(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function creditValue(track: ResumeTrack, label: string): string {
  return track.credits.find(([candidate]) => candidate.toLowerCase() === label.toLowerCase())?.[1] ?? '';
}

class PublicToolUnavailableError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PublicToolUnavailableError';
  }
}

class PublicToolAbortError extends Error {
  constructor() {
    super('public_tool_aborted');
    this.name = 'PublicToolAbortError';
  }
}

function callControl(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(parent?.reason);
  if (parent?.aborted) abortFromParent();
  else parent?.addEventListener('abort', abortFromParent, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new PublicToolAbortError());
  }, Math.max(1, timeoutMs));
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener('abort', abortFromParent);
    },
  };
}

async function raceWithSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new PublicToolAbortError();
  return await Promise.race([
    operation,
    new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new PublicToolAbortError()), { once: true });
    }),
  ]);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new PublicToolAbortError();
}

function unavailableLimitation(
  error: unknown,
  signal: AbortSignal,
  timedOut: boolean,
  fallback: string,
): string {
  if (signal.aborted) {
    return timedOut ? 'timeout' : 'cancelled';
  }
  if (error instanceof PublicToolUnavailableError) return error.code;
  return fallback;
}
