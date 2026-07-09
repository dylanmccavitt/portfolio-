import { gateway } from 'ai';
import { openai } from '@ai-sdk/openai';
import { isStepCount, streamText, tool, type LanguageModel, type ToolSet } from 'ai';
import { z } from 'zod';
import type { ProjectReadQueryable } from '@/lib/db/project-reads';
import {
  createPublicRagSearchConfig,
  publicRagSearch,
  type PublicRagSearchConfig,
  type PublicRagSearchOutput,
} from '@/lib/rag/retrieval';
import { createPublicDMDataTools, DMToolError, type PublicDMDataTools } from './data-tools';
import { createDMMetricsRecorder, shouldRecordDMMetrics } from './metrics';
import { AGENT_NAME, type AnswerBlock, type DMChatRequest, type DMStreamEvent, type ProjectSummary, type ToolTraceItem, type ToolTraceMetadata } from './contract';

export interface DMRuntimeConfig {
  provider: 'gateway' | 'openai';
  model: string;
}

export interface DMRuntimeEnv {
  DM_MODEL?: string;
  OPENAI_API_KEY?: string;
  AI_GATEWAY_API_KEY?: string;
  DATABASE_URL?: string;
  POSTGRES_URL?: string;
}

export interface DMRuntimeDeps {
  db: ProjectReadQueryable;
  model?: LanguageModel;
  env?: DMRuntimeEnv;
  ragSearch?: (
    query: string,
    config: PublicRagSearchConfig,
    options: { apiKey: string },
  ) => Promise<PublicRagSearchOutput>;
}

export class DMRuntimeConfigError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(`Missing DM runtime environment: ${missing.join(', ')}`);
    this.name = 'DMRuntimeConfigError';
    this.missing = missing;
  }
}

export class DMAgentError extends Error {
  readonly code: string;
  readonly safeMessage: string;

  constructor(code: string, message: string, safeMessage = 'DM is unavailable right now.') {
    super(message);
    this.name = 'DMAgentError';
    this.code = code;
    this.safeMessage = safeMessage;
  }
}

export function readDMRuntimeConfig(env: DMRuntimeEnv = process.env): DMRuntimeConfig {
  const usesGateway = Boolean(env.AI_GATEWAY_API_KEY?.trim());
  const provider: DMRuntimeConfig['provider'] = usesGateway ? 'gateway' : 'openai';
  const model = env.DM_MODEL?.trim() ?? 'openai/gpt-4.1';
  const missing: string[] = [];

  if (usesGateway && !env.AI_GATEWAY_API_KEY?.trim()) missing.push('AI_GATEWAY_API_KEY');
  if (!usesGateway && !env.OPENAI_API_KEY?.trim()) missing.push('OPENAI_API_KEY');
  if (missing.length > 0) throw new DMRuntimeConfigError(missing);

  return { provider, model };
}

export function createDMModel(config: DMRuntimeConfig): LanguageModel {
  if (config.provider === 'gateway') {
    return gateway(config.model);
  }
  return openai(config.model.replace(/^openai\//, ''));
}

export function createDMChatStream(
  request: DMChatRequest,
  config: DMRuntimeConfig,
  deps: DMRuntimeDeps,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const tools = createPublicDMDataTools(deps.db);
  const model = deps.model ?? createDMModel(config);
  const metrics = createDMMetricsRecorder({ enabled: shouldRecordDMMetrics() });

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const traceItems: ToolTraceItem[] = [];
      const answer: AnswerBlock[] = [];
      let blockIndex = 0;
      let finalText = '';

      const emit = (event: DMStreamEvent): void => {
        metrics.record(event);
        enqueueJson(controller, encoder, event);
      };

      try {
        const { request: normalizedRequest, leadingBlocks, endTurnAfterNotice } = await validateContext(request, tools);
        await assertPublicDataAvailable(tools, normalizedRequest);
        const refusal = privateDataRefusal(normalizedRequest.message);
        if (refusal) {
          emit({ type: 'block', index: blockIndex, block: refusal });
          answer.push(refusal);
          emit({ type: 'done', answer, trace: trace(traceItems) });
          return;
        }

        const system = await buildSystemPrompt(tools).catch((error: unknown) => {
          console.warn('[dm] system prompt digest failed, using minimal prompt', safeLogError(error));
          return minimalSystemPrompt();
        });

        emit({
          type: 'ready',
          agent: AGENT_NAME,
          provider: config.provider,
          trace: trace(traceItems),
        });

        for (const block of leadingBlocks) {
          answer.push(block);
          emit({ type: 'block', index: blockIndex, block });
          blockIndex += 1;
        }

        if (endTurnAfterNotice) {
          emit({ type: 'done', answer, trace: trace(traceItems) });
          return;
        }

        const ragConfig = await createPublicRagSearchConfig(deps.db).catch((error: unknown) => {
          console.error('[dm] rag setup failure', safeLogError(error));
          return null;
        });

        const result = streamText({
          model,
          system,
          messages: modelMessages(normalizedRequest),
          tools: aiTools(tools, ragConfig, deps),
          stopWhen: isStepCount(8),
        });

        for await (const part of result.stream) {
          if (part.type === 'text-delta') {
            const delta = textDelta(part);
            if (delta) {
              finalText += delta;
              emit({ type: 'text-delta', delta });
            }
          } else if (part.type === 'tool-call') {
            const item = traceItem(part.toolName, toolSummary(part.toolName));
            traceItems.push(item);
            emit({ type: 'tool', name: item.tool, summary: item.label });
          } else if (part.type === 'tool-result') {
            const blocks = blocksFromToolResult(part.output, part.toolName);
            for (const block of blocks) {
              answer.push(block);
              emit({ type: 'block', index: blockIndex, block });
              blockIndex += 1;
            }
          } else if (part.type === 'tool-error') {
            throw new DMAgentError('tool_failed', `DM tool failed: ${part.toolName}`, safeToolError(part.error));
          } else if (part.type === 'error') {
            throw new DMAgentError('model_stream_failed', 'DM model stream failed.');
          }
        }

        if (finalText.trim()) {
          answer.unshift({ kind: 'text', text: finalText.trim() });
        }

        const supplementalBlocks = await deterministicBlocks(normalizedRequest, tools, answer);
        for (const block of supplementalBlocks) {
          answer.push(block);
          emit({ type: 'block', index: blockIndex, block });
          blockIndex += 1;
        }

        emit({ type: 'done', answer, trace: trace(traceItems) });
      } catch (error) {
        const message = safeErrorMessage(error);
        console.error('[dm] chat stream failure', safeLogError(error));
        emit({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });
}

function isDMToolError(error: unknown): error is DMToolError {
  return error instanceof Error && error.name === 'DMToolError';
}

function wrapTool<T>(execute: (input: T) => Promise<unknown>) {
  return async (input: T) => {
    try {
      return await execute(input);
    } catch (error) {
      if (isDMToolError(error) && error.code !== 'public_data_unavailable') {
        return {
          ok: false,
          error: error.code,
          message: error.message,
          safeMessage: error.safeMessage,
        };
      }
      throw error;
    }
  };
}

function aiTools(tools: PublicDMDataTools, ragConfig: PublicRagSearchConfig | null, deps: DMRuntimeDeps): ToolSet {
  const dmTools: ToolSet = {
    searchProjects: tool({
      description:
        'Search published public portfolio projects by recruiter-facing query. Returns published records only, plus explicit complete/partial/fallback/empty status. Only projects in this result may be named or discussed.',
      inputSchema: z.object({
        query: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(8).optional(),
      }),
      execute: wrapTool((input) => tools.searchProjects(input)),
    }),
    filterProjects: tool({
      description:
        'Filter published public portfolio projects by area or status. Returns explicit complete/partial/empty status. Only projects in this result may be named or discussed.',
      inputSchema: z.object({
        area: z.string().min(1).max(80).optional(),
        status: z.enum(['dry', 'live', 'wip', 'done']).optional(),
        limit: z.number().int().min(1).max(8).optional(),
      }),
      execute: wrapTool((input) => tools.filterProjects(input)),
    }),
    rankProjects: tool({
      description:
        'Rank published public portfolio projects by explicit public ids or hiring intent. Returns explicit complete/partial/empty status. Only projects in this result may be named or discussed.',
      inputSchema: z.object({
        ids: z.array(z.string().min(1).max(80)).max(8).optional(),
        intent: z.string().max(240).optional(),
        limit: z.number().int().min(1).max(8).optional(),
      }),
      execute: wrapTool((input) => tools.rankProjects(input)),
    }),
    readResume: tool({
      description: 'Read static public resume tracks from src/data/resume.ts with unpublished project links removed.',
      inputSchema: z.object({
        trackIds: z.array(z.string().min(1).max(80)).max(8).optional(),
      }),
      execute: wrapTool((input) => tools.readResume(input)),
    }),
    getContact: tool({
      description: 'Read public contact data from the static resume source.',
      inputSchema: z.object({}),
      execute: wrapTool(() => Promise.resolve(tools.getContact())),
    }),
  };
  if (!ragConfig) return dmTools;

  const apiKey = deps.env?.OPENAI_API_KEY?.trim() ?? process.env.OPENAI_API_KEY?.trim();
  const searchRag = deps.ragSearch ?? publicRagSearch;
  return {
    ...dmTools,
    searchSources: tool({
      description: 'Search approved public RAG sources for cited evidence about a project or topic.',
      inputSchema: z.object({
        query: z.string().min(1).max(300),
        limit: z.number().int().min(1).max(8).optional(),
      }),
      execute: wrapTool(async (input) => {
        if (!deps.ragSearch && !apiKey) {
          throw new DMToolError('rag_unavailable', 'OpenAI API key is not available for RAG search.', {});
        }
        const { citations } = await searchRag(
          input.query,
          { ...ragConfig, tool: { ...ragConfig.tool, maxNumResults: input.limit ?? ragConfig.tool.maxNumResults } },
          { apiKey: apiKey ?? 'test-key' },
        );
        return { citations };
      }),
    }),
  };
}

async function validateContext(
  request: DMChatRequest,
  tools: PublicDMDataTools,
): Promise<{ request: DMChatRequest; leadingBlocks: AnswerBlock[]; endTurnAfterNotice: boolean }> {
  const context = request.context;
  if (!context) return { request, leadingBlocks: [], endTurnAfterNotice: false };

  const leadingBlocks: AnswerBlock[] = [];
  const nextContext: DMChatRequest['context'] = { ...context };
  let allRequestedProjectsUnpublished = false;

  if (context.projectIds?.length) {
    try {
      const published = await tools.publishedProjectIds();
      const knownProjectIds = context.projectIds.filter((id) => published.has(id));
      if (knownProjectIds.length !== context.projectIds.length) {
        leadingBlocks.push({
          kind: 'text',
          text: "That project isn't in my published records yet. I can still cover Dylan's published work, resume, or contact details.",
        });
      }
      allRequestedProjectsUnpublished = knownProjectIds.length === 0;
      if (knownProjectIds.length > 0) nextContext.projectIds = knownProjectIds;
      else delete nextContext.projectIds;
    } catch (error) {
      if (error instanceof DMAgentError) throw error;
      throw new DMAgentError(
        'public_data_unavailable',
        error instanceof Error ? error.message : 'Public project data is unavailable.',
        'DM could not read the public portfolio data needed for that answer.',
      );
    }
  }

  if (context.resumeTrackIds?.length) tools.assertResumeTrackIds(context.resumeTrackIds);

  const hasContext = Boolean(nextContext.projectIds?.length || nextContext.resumeTrackIds?.length || nextContext.fitCheck);
  const endTurnAfterNotice = allRequestedProjectsUnpublished && leadingBlocks.length > 0;

  return {
    request: hasContext ? { ...request, context: nextContext } : { ...request, context: undefined },
    leadingBlocks,
    endTurnAfterNotice,
  };
}

async function assertPublicDataAvailable(tools: PublicDMDataTools, request: DMChatRequest): Promise<void> {
  const normalized = request.message.toLowerCase();
  const needsProjectData =
    Boolean(request.context?.projectIds?.length) ||
    /\b(projects?|work|built|ship|backend|ai|client|automation|tool|tooling|app|integration|live|done|portfolio)\b/.test(normalized);
  if (!needsProjectData) return;

  try {
    await tools.publishedProjectIds();
  } catch (error) {
    throw new DMAgentError(
      'public_data_unavailable',
      error instanceof Error ? error.message : 'Public project data is unavailable.',
      'DM could not read the public portfolio data needed for that answer.',
    );
  }
}

async function deterministicBlocks(
  request: DMChatRequest,
  tools: PublicDMDataTools,
  existing: AnswerBlock[],
): Promise<AnswerBlock[]> {
  const blocks: AnswerBlock[] = [];
  const normalized = request.message.toLowerCase();
  const hasProjects = existing.some((block) => block.kind === 'projects');
  const hasResume = existing.some((block) => block.kind === 'resume');
  const hasContact = existing.some((block) => block.kind === 'contact');

  const shouldResolveProjects =
    Boolean(request.context?.projectIds?.length) ||
    /\b(projects?|work|built|ship|backend|ai|client|automation|tool|tooling|app|integration|live|done|portfolio|most impressive|best|strongest|top)\b/.test(normalized);
  if (!hasProjects && shouldResolveProjects) {
    const projectItems = request.context?.projectIds?.length
      ? (await tools.rankProjects({ ids: request.context.projectIds })).projects
      : /\b(most impressive|best|strongest|top|favorite)\b/.test(normalized)
        ? (await tools.rankProjects({ intent: request.message, limit: 3 })).projects
        : (await tools.searchProjects({ query: request.message, limit: 3 })).projects;
    const ids = projectItems.map((project) => project.id);
    if (ids.length > 0) {
      blocks.push({ kind: 'projects', ids, items: projectItems });
      blocks.push({ kind: 'evidence', projectIds: ids, projects: projectItems });
    }
  }

  if (!hasResume && (request.context?.resumeTrackIds?.length || matchesAny(normalized, ['resume', 'experience', 'background', 'education', 'career']))) {
    const trackIds = request.context?.resumeTrackIds ?? ['now', 'kroll', 'stevens', 'bella-era'];
    blocks.push({ kind: 'resume', trackIds });
    blocks.push({ kind: 'evidence', resumeTrackIds: trackIds });
  }

  if (!hasContact && matchesAny(normalized, ['contact', 'email', 'reach', 'hire', 'available', 'opportunities'])) {
    blocks.push(toAnswerContact(tools.getContact()));
  }

  if (request.context?.fitCheck && !hasResume) {
    blocks.push({ kind: 'resume', trackIds: ['now', 'stevens', 'bella-era', 'kroll'] });
  }

  return blocks;
}

async function buildSystemPrompt(tools: PublicDMDataTools): Promise<string> {
  const [projectResult, resumeResult] = await Promise.all([
    tools.rankProjects({ limit: 100 }).catch(() => ({ projects: [] as ProjectSummary[] })),
    tools.readResume({}).catch(() => ({ tracks: [] as { id: string; title: string; role: string; when: string }[] })),
  ]);
  const projects = projectResult.projects;
  const tracks = resumeResult.tracks.map((track) => ({ id: track.id, title: track.title, role: track.role, when: track.when }));

  const projectLines = projects.map(
    (project) => `- ${project.id}: ${project.title} (${project.area}, ${project.status[1] ?? project.status[0]}, ${project.year}) — ${project.line}`,
  );
  const trackLines = tracks.map((track) => `- ${track.id}: ${track.title} (${track.role}, ${track.when})`);

  return [
    "You are DM, Dylan McCavitt's public portfolio agent for recruiters and hiring managers.",
    'You answer only from tool results over published portfolio project records, approved public RAG source citations, and static public resume/contact data.',
    'Never claim access to drafts, candidate records, private repos, Slack/admin notes, visitor chats, database metadata, or hidden plans.',
    'If asked for private or unsupported facts, refuse briefly and redirect to public projects, resume, or contact details.',
    '',
    'Project routing digest (orientation only; never answer evidence):',
    'Use this digest only to choose a project tool. Re-fetch every project before naming, listing, comparing, or describing it.',
    ...projectLines,
    '',
    'Resume tracks you can reference:',
    ...trackLines,
    '',
    'Tool selection rules:',
    "- Questions about status/area (e.g., 'live projects', 'iOS apps') -> use filterProjects.",
    "- 'Best', 'most impressive', 'strongest' -> use rankProjects with an intent query, do not guess project ids.",
    '- Topic or keyword questions -> use searchProjects.',
    '- Resume/background/career/education -> use readResume.',
    '- Contact/hiring/reach -> use getContact.',
    '- For cited evidence from approved public sources -> use searchSources.',
    'Only name or list projects returned by project tool calls in this turn.',
    'For every project claim, use only the projects array returned by searchProjects, filterProjects, or rankProjects in this turn. Never name or substitute a project from this digest, conversation history, or memory.',
    'If a project result is partial or fallback, disclose that status and discuss only its returned projects. Re-call filterProjects or rankProjects when the user needs a different or broader list.',
    'If a project result is empty, say no matching published projects were returned. Do not fill the gap with a project from the digest or memory.',
    'When a project tool returns data, answer concretely from that result: name the project, what it does, its status, and a real outcome or metric.',
    'Keep answers concise, confident, and recruiter-friendly. If a specific request is not public, say so and offer the closest public evidence.',
    'Treat each project tool result message as binding. If searchProjects returns fallbackUsed=true, tell the user you found no exact match and are showing only the returned fallback projects.',
  ].join('\n');
}

function minimalSystemPrompt(): string {
  return [
    "You are DM, Dylan McCavitt's public portfolio agent for recruiters and hiring managers.",
    'Answer only from tool results over published portfolio project records, approved public RAG sources, and static public resume/contact data.',
    'Never claim access to private drafts, candidate records, hidden repos, or admin notes.',
    'Only name or list projects returned by project tool calls in this turn.',
    'The project routing digest is unavailable, so call a project tool before every project name, list, comparison, description, or claim. Use only its returned projects array; never substitute from conversation history or memory.',
    'For partial or fallback results, disclose the status and discuss only returned projects. For empty results, say no match was returned.',
    'When a project tool returns data, answer concretely with project name, status, and a real outcome or metric from that result.',
    "- status/area questions -> filterProjects; 'best/most impressive' -> rankProjects with intent; topics -> searchProjects; resume -> readResume; contact -> getContact; evidence -> searchSources.",
  ].join(' ');
}

function modelMessages(request: DMChatRequest): Array<{ role: 'user' | 'assistant'; content: string }> {
  const conversation = request.conversation?.slice(-12) ?? [];
  const fitCheck = request.context?.fitCheck?.jobDescription
    ? `\n\nJob description excerpt for fit check:\n${request.context.fitCheck.jobDescription}`
    : '';
  return [...conversation, { role: 'user', content: `${request.message}${fitCheck}` }];
}

function privateDataRefusal(message: string): AnswerBlock | null {
  const normalized = message.toLowerCase();
  if (!PRIVATE_DATA_REQUEST_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return null;
  }
  return {
    kind: 'text',
    text: 'I can only discuss Dylan’s published portfolio projects, public resume facts, and contact details. Ask about shipped work, current strengths, or how to reach him.',
  };
}

const PRIVATE_DATA_REQUEST_PATTERNS = [
  /\bcandidate\s+(?:records?|notes?)\b/,
  /\bproject\s+candidate\b/,
  /\badmin\s+(?:notes?|records?)\b/,
  /\bvisitor\s+(?:chats?|messages?)\b/,
  /\bdatabase\s+(?:rows?|records?|metadata)\b/,
  /\bdraft\s+projects?\b/,
  /\bproject\s+drafts?\b/,
  /\b(?:hidden|private|internal|unpublished)\s+drafts?\b/,
  /\b(?:hidden|internal|unpublished)\s+projects?\b/,
  /\bprivate\s+(?:notes?|records?|drafts?)\b/,
  /\bshow\s+me\s+(?:your|dylan(?:'|’)?s)\s+drafts?\b/,
  /\bslack\s+(?:messages?|notes?|channels?|admin\s+notes?)\b/,
  /\bsecret\s+(?:projects?|plans?|roadmaps?|notes?|records?|drafts?)\b/,
];

function blocksFromToolResult(output: unknown, toolName?: string): AnswerBlock[] {
  if (!isRecord(output)) return [];
  if (output.ok === false) return [];
  const blocks: AnswerBlock[] = [];
  const projectItems = Array.isArray(output.projects) ? output.projects.filter(isProjectSummary) : [];
  const projects = projectItems.map((project) => project.id);
  if (projects.length > 0) {
    blocks.push({ kind: 'projects', ids: projects, items: projectItems });
    blocks.push({ kind: 'evidence', projectIds: projects, projects: projectItems });
  }
  if (Array.isArray(output.tracks)) {
    const trackIds = output.tracks.filter(isTrackLike).map((track) => track.id);
    if (trackIds.length > 0) blocks.push({ kind: 'resume', trackIds }, { kind: 'evidence', resumeTrackIds: trackIds });
  }
  if (output.kind === 'contact') blocks.push(toAnswerContact(output));
  if (toolName === 'searchSources' && Array.isArray(output.citations)) {
    const citations = output.citations.filter(isRagCitation);
    if (citations.length > 0) {
      const projectIds = [...new Set(citations.map((citation) => citation.projectId))];
      blocks.push({ kind: 'evidence', projectIds, ragSources: citations });
    }
  }
  return blocks;
}

function isRagCitation(value: unknown): value is { ragSourceId: string; projectId: string; fileId: string; text: string } {
  return (
    isRecord(value) &&
    typeof value.ragSourceId === 'string' &&
    typeof value.projectId === 'string' &&
    typeof value.fileId === 'string' &&
    typeof value.text === 'string'
  );
}

function toAnswerContact(value: unknown): AnswerBlock {
  const record = isRecord(value) ? value : {};
  return {
    kind: 'contact',
    ...(typeof record.email === 'string' ? { email: record.email } : {}),
    ...(typeof record.github === 'string' ? { github: record.github } : {}),
    ...(typeof record.resume === 'string' ? { resume: record.resume } : {}),
    ...(typeof record.location === 'string' ? { location: record.location } : {}),
    ...(typeof record.status === 'string' ? { status: record.status } : {}),
  };
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof DMAgentError) return error.safeMessage;
  if (error instanceof DMRuntimeConfigError) return 'DM is not configured for chat yet.';
  if (isDMToolError(error)) return error.safeMessage;
  return 'DM could not answer that safely. Try a portfolio, resume, or contact question.';
}

function safeLogError(error: unknown): Record<string, unknown> {
  if (error instanceof DMAgentError) return { name: error.name, code: error.code };
  if (error instanceof DMRuntimeConfigError) return { name: error.name, missing: error.missing };
  if (isDMToolError(error)) return { name: error.name, code: error.code, details: error.details };
  if (error instanceof Error) return { name: error.name };
  return { name: typeof error };
}

function safeToolError(error: unknown): string {
  if (isDMToolError(error)) return error.safeMessage;
  return 'DM could not read the public portfolio data needed for that answer.';
}

function enqueueJson(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: DMStreamEvent,
): void {
  controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
}

function trace(items: ToolTraceItem[]): ToolTraceMetadata {
  return { mode: 'vercel-ai-sdk', agent: AGENT_NAME, items: [...items] };
}

function traceItem(toolName: string, label: string): ToolTraceItem {
  return { tool: toolName, label, remote: true };
}

function toolSummary(toolName: string): string {
  switch (toolName) {
    case 'searchProjects':
      return 'Searched published project records.';
    case 'filterProjects':
      return 'Filtered published project records.';
    case 'rankProjects':
      return 'Ranked published project records.';
    case 'readResume':
      return 'Read static resume data.';
    case 'getContact':
      return 'Read public contact data.';
    case 'searchSources':
      return 'Searched approved public RAG sources.';
    default:
      return 'Used a public DM data tool.';
  }
}

function textDelta(part: { text?: unknown; delta?: unknown }): string {
  if (typeof part.text === 'string') return part.text;
  if (typeof part.delta === 'string') return part.delta;
  return '';
}

function isProjectSummary(value: unknown): value is ProjectSummary {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.href === 'string' &&
    Array.isArray(value.status)
  );
}

function isTrackLike(value: unknown): value is { id: string } {
  return isRecord(value) && typeof value.id === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function matchesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}
