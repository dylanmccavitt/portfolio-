import { openai } from '@ai-sdk/openai';
import { isStepCount, streamText, tool, type LanguageModel, type ToolSet } from 'ai';
import { z } from 'zod';
import type { ProjectReadQueryable } from '../db/project-reads';
import { createPublicDMDataTools, DMToolError, type PublicDMDataTools } from './data-tools';
import type { AnswerBlock, DMChatRequest, DMStreamEvent, ProjectSummary, ToolTraceItem, ToolTraceMetadata } from './contract';

export interface DMRuntimeConfig {
  provider: 'openai';
  model: string;
}

export interface DMRuntimeEnv {
  DM_PROVIDER?: string;
  DM_MODEL?: string;
  OPENAI_API_KEY?: string;
  DATABASE_URL?: string;
  POSTGRES_URL?: string;
}

export interface DMRuntimeDeps {
  db: ProjectReadQueryable;
  model?: LanguageModel;
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
  const provider = env.DM_PROVIDER?.trim() || 'openai';
  const model = env.DM_MODEL?.trim() || 'gpt-4o-mini';
  const missing: string[] = [];

  if (provider !== 'openai') {
    throw new DMRuntimeConfigError(['DM_PROVIDER']);
  }
  if (!env.OPENAI_API_KEY?.trim()) missing.push('OPENAI_API_KEY');
  if (missing.length > 0) throw new DMRuntimeConfigError(missing);

  return { provider, model };
}

export function createDMChatStream(
  request: DMChatRequest,
  config: DMRuntimeConfig,
  deps: DMRuntimeDeps,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const tools = createPublicDMDataTools(deps.db);
  const model = deps.model ?? openai(config.model);

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const traceItems: ToolTraceItem[] = [];
      const answer: AnswerBlock[] = [];
      let blockIndex = 0;
      let finalText = '';

      try {
        await validateContext(request, tools);
        await assertPublicDataAvailable(tools);
        const refusal = privateDataRefusal(request.message);
        if (refusal) {
          enqueueJson(controller, encoder, { type: 'block', index: blockIndex, block: refusal });
          answer.push(refusal);
          enqueueJson(controller, encoder, { type: 'done', answer, trace: trace(traceItems) });
          return;
        }

        enqueueJson(controller, encoder, {
          type: 'ready',
          agent: 'DM',
          provider: config.provider,
          trace: trace(traceItems),
        });

        const result = streamText({
          model,
          system: systemPrompt(),
          messages: modelMessages(request),
          tools: aiTools(tools),
          stopWhen: isStepCount(4),
        });

        for await (const part of result.stream) {
          if (part.type === 'text-delta') {
            const delta = textDelta(part);
            if (delta) {
              finalText += delta;
              enqueueJson(controller, encoder, { type: 'text-delta', delta });
            }
          } else if (part.type === 'tool-call') {
            const item = traceItem(part.toolName, toolSummary(part.toolName));
            traceItems.push(item);
            enqueueJson(controller, encoder, { type: 'tool', name: item.tool, summary: item.label });
          } else if (part.type === 'tool-result') {
            const blocks = blocksFromToolResult(part.output);
            for (const block of blocks) {
              answer.push(block);
              enqueueJson(controller, encoder, { type: 'block', index: blockIndex, block });
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

        const supplementalBlocks = await deterministicBlocks(request, tools, answer);
        for (const block of supplementalBlocks) {
          answer.push(block);
          enqueueJson(controller, encoder, { type: 'block', index: blockIndex, block });
          blockIndex += 1;
        }

        enqueueJson(controller, encoder, { type: 'done', answer, trace: trace(traceItems) });
      } catch (error) {
        const message = safeErrorMessage(error);
        console.error('[dm] chat stream failure', safeLogError(error));
        enqueueJson(controller, encoder, { type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });
}

export function isDMToolError(error: unknown): error is DMToolError {
  return error instanceof Error && error.name === 'DMToolError';
}

function aiTools(tools: PublicDMDataTools): ToolSet {
  return {
    searchProjects: tool({
      description: 'Search published public portfolio projects by recruiter-facing query. Returns published records only.',
      inputSchema: z.object({
        query: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(8).optional(),
      }),
      execute: (input) => tools.searchProjects(input),
    }),
    filterProjects: tool({
      description: 'Filter published public portfolio projects by area or status.',
      inputSchema: z.object({
        area: z.string().min(1).max(80).optional(),
        status: z.enum(['dry', 'live', 'wip', 'done']).optional(),
        limit: z.number().int().min(1).max(8).optional(),
      }),
      execute: (input) => tools.filterProjects(input),
    }),
    rankProjects: tool({
      description: 'Rank published public portfolio projects by explicit public ids or hiring intent.',
      inputSchema: z.object({
        ids: z.array(z.string().min(1).max(80)).max(8).optional(),
        intent: z.string().max(240).optional(),
        limit: z.number().int().min(1).max(8).optional(),
      }),
      execute: (input) => tools.rankProjects(input),
    }),
    readResume: tool({
      description: 'Read static public resume tracks from src/data/resume.ts with unpublished project links removed.',
      inputSchema: z.object({
        trackIds: z.array(z.string().min(1).max(80)).max(8).optional(),
      }),
      execute: (input) => tools.readResume(input),
    }),
    getContact: tool({
      description: 'Read public contact data from the static resume source.',
      inputSchema: z.object({}),
      execute: () => tools.getContact(),
    }),
  };
}

async function validateContext(request: DMChatRequest, tools: PublicDMDataTools): Promise<void> {
  if (request.context?.projectIds?.length) await tools.assertProjectIds(request.context.projectIds);
  if (request.context?.resumeTrackIds?.length) tools.assertResumeTrackIds(request.context.resumeTrackIds);
}

async function assertPublicDataAvailable(tools: PublicDMDataTools): Promise<void> {
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

  if (!hasProjects) {
    const projectItems = request.context?.projectIds?.length
      ? (await tools.rankProjects({ ids: request.context.projectIds })).projects
      : (await tools.searchProjects({ query: request.message, limit: 3 })).projects;
    const ids = projectItems.map((project) => project.id);
    if (ids.length > 0 && (request.context?.projectIds?.length || matchesAny(normalized, ['project', 'work', 'built', 'ship', 'backend', 'ai', 'client']))) {
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

function modelMessages(request: DMChatRequest): Array<{ role: 'user' | 'assistant'; content: string }> {
  const conversation = request.conversation?.slice(-12) ?? [];
  const fitCheck = request.context?.fitCheck?.jobDescription
    ? `\n\nJob description excerpt for fit check:\n${request.context.fitCheck.jobDescription}`
    : '';
  return [...conversation, { role: 'user', content: `${request.message}${fitCheck}` }];
}

function systemPrompt(): string {
  return [
    'You are DM, Dylan McCavitt\'s public portfolio agent for recruiters and hiring managers.',
    'Answer only from tool results over published portfolio project records and static public resume/contact data.',
    'Never claim access to drafts, candidate records, private repos, Slack/admin notes, visitor chats, database metadata, or hidden plans.',
    'If asked for private, draft, candidate-record, unsupported, or unknown facts, refuse briefly and redirect to public project, resume, or contact facts.',
    'Keep answers concise, concrete, jargon-light, and outcome-focused.',
  ].join(' ');
}

function privateDataRefusal(message: string): AnswerBlock | null {
  const normalized = message.toLowerCase();
  if (!matchesAny(normalized, ['candidate record', 'candidate note', 'project candidate', 'draft', 'private', 'hidden', 'slack', 'admin note', 'visitor chat', 'database row', 'secret'])) {
    return null;
  }
  return {
    kind: 'text',
    text: 'I can only discuss Dylan’s published portfolio projects, public resume facts, and contact details. Ask about shipped work, current strengths, or how to reach him.',
  };
}

function blocksFromToolResult(output: unknown): AnswerBlock[] {
  if (!isRecord(output)) return [];
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
  return blocks;
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
  return { mode: 'vercel-ai-sdk', agent: 'DM', items: [...items] };
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
