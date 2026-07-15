import { openai } from '@ai-sdk/openai';
import {
  ToolLoopAgent,
  createUIMessageStream,
  createUIMessageStreamResponse,
  gateway,
  isStepCount,
  toUIMessageStream,
  tool,
  type LanguageModel,
  type ModelMessage,
  type StreamTextOnErrorCallback,
  type UIMessageChunk,
} from 'ai';
import { z } from 'zod';
import type { ProjectDetailReadModel, ProjectReadQueryable } from '@/lib/db/project-reads';
import type { PublicProjectEnv } from '@/lib/public-projects';
import type { PublicRagSearchConfig, PublicRagSearchOutput } from '@/lib/rag/retrieval';
import { createDMMetricsRecorder, shouldRecordDMMetrics, type DMSourceMode } from './metrics';
import {
  createPublicAgentTools,
  type PublicAgentToolRun,
  type PublicContactRecord,
  type PublicProjectToolRecord,
  type PublicResumeTrackRecord,
  type PublicSourceRecord,
} from './public-agent-tools';
import type {
  DMAnswerArtifact,
  DMChatContext,
  DMChatRequest,
  DMFinalizationResult,
  DMValidatedAnswer,
} from './contract';

export interface DMRuntimeConfig {
  provider: 'gateway' | 'openai';
  model: string;
}

export type DMRuntimeEnv = PublicProjectEnv & {
  DM_MODEL?: string;
  OPENAI_API_KEY?: string;
  AI_GATEWAY_API_KEY?: string;
  DM_REQUEST_DEADLINE_MS?: string;
  DM_MAX_OUTPUT_TOKENS?: string;
  DM_MAX_STEPS?: string;
};

export interface DMBudgetConfig {
  deadlineMs: number;
  maxOutputTokens: number;
  maxSteps: number;
}

export interface DMRuntimeDeps {
  db: ProjectReadQueryable;
  model?: LanguageModel;
  env?: DMRuntimeEnv;
  projectLoader?: () => Promise<ProjectDetailReadModel[]>;
  ragSearch?: (
    query: string,
    config: PublicRagSearchConfig,
    options: { apiKey: string; signal?: AbortSignal },
  ) => Promise<PublicRagSearchOutput>;
  signal?: AbortSignal;
  traceId?: string;
  budgets?: DMBudgetConfig;
  metricsLogger?: (line: string) => void;
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
  const model = env.DM_MODEL?.trim();
  const missing: string[] = [];

  if (!model) missing.push('DM_MODEL');
  if (!usesGateway && !env.OPENAI_API_KEY?.trim()) missing.push('OPENAI_API_KEY');
  if (missing.length > 0) throw new DMRuntimeConfigError(missing);

  return { provider, model: model as string };
}

export function readDMBudgetConfig(env: DMRuntimeEnv = process.env): DMBudgetConfig {
  return {
    deadlineMs: readBoundedInteger(env.DM_REQUEST_DEADLINE_MS, 45_000, 5_000, 120_000),
    maxOutputTokens: readBoundedInteger(env.DM_MAX_OUTPUT_TOKENS, 1_200, 128, 4_096),
    maxSteps: readBoundedInteger(env.DM_MAX_STEPS, 6, 2, 8),
  };
}

export function createDMModel(config: DMRuntimeConfig): LanguageModel {
  return config.provider === 'gateway'
    ? gateway(config.model)
    : openai(config.model.replace(/^openai\//, ''));
}

const CONVERSATIONAL_ACTS = [
  'greeting',
  'capabilities',
  'acknowledgement',
  'clarify_reference',
  'explain_process',
] as const;
const LIMITATION_CODES = [
  'private_sources',
  'personal_unknown',
  'public_data_unavailable',
  'public_source_unavailable',
  'unsupported_request',
  'ambiguous_reference',
] as const;
const FOLLOW_UP_CODES = [
  'project_overview',
  'specify_project',
  'try_resume',
  'contact_dylan',
  'refine_question',
] as const;

const ConversationalActSchema = z.enum(CONVERSATIONAL_ACTS);
const LimitationCodeSchema = z.enum(LIMITATION_CODES);
const FollowUpCodeSchema = z.enum(FOLLOW_UP_CODES);

type ConversationalAct = z.infer<typeof ConversationalActSchema>;
type LimitationCode = z.infer<typeof LimitationCodeSchema>;
type FollowUpCode = z.infer<typeof FollowUpCodeSchema>;

// Security boundary: only factual segments retain model-authored prose. The
// model can select these finite enum values only through finalizeAnswer; the
// server materializes the copy after the structured answer validates.
const FINALIZATION_ENUM_COPY = {
  conversational: {
    greeting: "Hi — I'm DM, Dylan's public portfolio guide.",
    capabilities: "I can help with Dylan's published projects, public resume, and contact details.",
    acknowledgement: 'Got it.',
    clarify_reference: 'Could you clarify which published project or resume entry you mean?',
    explain_process: 'I answer using published portfolio records, the public resume, contact details, and approved public sources.',
  },
  limitation: {
    private_sources: 'I can only use published public portfolio sources.',
    personal_unknown: 'I could not find a published public answer to that personal question.',
    public_data_unavailable: 'The published project source is unavailable for this answer.',
    public_source_unavailable: 'Approved public-source search is unavailable for this answer.',
    unsupported_request: "I can only help with Dylan's published portfolio, public resume, contact details, and approved public sources.",
    ambiguous_reference: 'I need a more specific published project or resume entry before I can answer safely.',
  },
  followUp: {
    project_overview: 'Would you like a project overview?',
    specify_project: 'Would you like to name a specific published project?',
    try_resume: 'Would you like to try the public resume instead?',
    contact_dylan: 'Would you like Dylan\'s public contact details?',
    refine_question: 'Would you like to narrow the question?',
  },
} satisfies {
  conversational: Record<ConversationalAct, string>;
  limitation: Record<LimitationCode, string>;
  followUp: Record<FollowUpCode, string>;
};

const AnswerSegmentInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('factual'),
    text: z.string().trim().min(1).max(1_200),
    evidenceIds: z.array(z.string().trim().min(1).max(240)).min(1).max(16),
  }),
  z.strictObject({
    kind: z.literal('conversational'),
    act: ConversationalActSchema,
  }),
  z.strictObject({
    kind: z.literal('limitation'),
    code: LimitationCodeSchema,
  }),
]);

const ArtifactReferenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('project'), id: z.string().trim().min(1).max(200) }),
  z.strictObject({ kind: z.literal('resume'), id: z.string().trim().min(1).max(200) }),
  z.strictObject({ kind: z.literal('contact'), id: z.literal('contact') }),
  z.strictObject({ kind: z.literal('evidence'), id: z.string().trim().min(1).max(200) }),
  z.strictObject({ kind: z.literal('links'), id: z.string().trim().min(1).max(200) }),
]);

const FinalAnswerInputSchema = z.strictObject({
  segments: z.array(AnswerSegmentInputSchema).min(1).max(5),
  artifacts: z.array(ArtifactReferenceSchema).max(5),
  limitations: z.array(LimitationCodeSchema).max(4),
  followUp: FollowUpCodeSchema.optional(),
});

type FinalAnswerInput = z.infer<typeof FinalAnswerInputSchema>;
type ArtifactReference = z.infer<typeof ArtifactReferenceSchema>;

interface RunArtifacts {
  projects: Map<string, PublicProjectToolRecord>;
  resumeTracks: Map<string, PublicResumeTrackRecord>;
  contact: PublicContactRecord | null;
  sources: Map<string, PublicSourceRecord>;
  limitations: Set<string>;
}

interface PublicToolGate {
  run<T>(operation: () => Promise<T>): Promise<T>;
  waitForIdle(): Promise<void>;
}

export function createDMChatResponse(
  request: DMChatRequest,
  config: DMRuntimeConfig,
  deps: DMRuntimeDeps,
): Response {
  const budgets = deps.budgets ?? readDMBudgetConfig(deps.env);
  const abort = composeAbortSignal(deps.signal, budgets.deadlineMs);
  const metrics = createDMMetricsRecorder({
    enabled: shouldRecordDMMetrics(),
    traceId: deps.traceId,
    logger: deps.metricsLogger,
  });
  const publicRun = createPublicAgentTools({
    db: deps.db,
    env: deps.env,
    ...(deps.projectLoader ? { loadProjects: deps.projectLoader } : {}),
    ...(deps.ragSearch ? { ragSearch: deps.ragSearch } : {}),
    ragApiKey: deps.env?.OPENAI_API_KEY?.trim() ?? process.env.OPENAI_API_KEY?.trim(),
  });
  const artifacts = emptyArtifacts();
  const publicToolGate = createPublicToolGate();
  let finalizationAttempts = 0;
  let finalizationResult: Exclude<DMFinalizationResult, { status: 'rejected' }> | null = null;
  let finalized = false;
  let inputTokens = 0;
  let outputTokens = 0;

  const publicTools = createRuntimePublicTools(publicRun, artifacts, metrics, publicToolGate);
  const agentTools = {
    ...publicTools,
    finalizeAnswer: tool({
      description: 'Submit the complete structured visitor answer. Use exactly once after gathering any needed public evidence; retry once only when rejected.',
      inputSchema: FinalAnswerInputSchema,
      execute: async (input: FinalAnswerInput) => {
        await publicToolGate.waitForIdle();
        if (finalizationResult) return finalizationResult;
        finalizationAttempts += 1;
        const validation = validateFinalAnswer(input, publicRun, artifacts);
        if (validation.ok) {
          finalized = true;
          finalizationResult = {
            status: 'accepted',
            answer: validation.answer,
            repairAttempted: finalizationAttempts > 1,
          };
          return finalizationResult;
        }
        if (finalizationAttempts === 1) {
          return {
            status: 'rejected',
            errors: validation.errors,
            remainingAttempts: 1,
          } satisfies DMFinalizationResult;
        }
        finalized = true;
        finalizationResult = limitedResult(true);
        return finalizationResult;
      },
    }),
  };

  const agent = new ToolLoopAgent({
    id: 'dm-public',
    model: deps.model ?? createDMModel(config),
    instructions: DM_SYSTEM_INSTRUCTIONS,
    tools: agentTools,
    stopWhen: [() => finalized, isStepCount(budgets.maxSteps)],
    maxOutputTokens: budgets.maxOutputTokens,
  });

  const stream = createUIMessageStream({
    originalMessages: request.messages,
    onError(error) {
      if (abort.signal.aborted) return abort.timedOut()
        ? 'DM took too long to answer. Please try again.'
        : 'DM stopped this answer.';
      console.error('[dm] tool-loop stream failure', safeLogError(error));
      metrics.error();
      return safeErrorMessage(error);
    },
    async execute({ writer }) {
      try {
        throwIfAborted(abort.signal);
        metrics.modelStarted();
        // AI SDK 7 forwards streamText options here but omits onError from the
        // public AgentStreamParameters type.
        const agentStreamOptions = {
          messages: modelMessages(request),
          abortSignal: abort.signal,
          onError({ error }) {
            console.error('[dm] provider stream failure', safeLogError(error));
          },
          onStepEnd(step) {
            inputTokens += step.usage.inputTokens ?? 0;
            outputTokens += step.usage.outputTokens ?? 0;
          },
        } satisfies Parameters<typeof agent.stream>[0] & { onError: StreamTextOnErrorCallback };
        const result = await agent.stream(agentStreamOptions);
        const uiStream = toUIMessageStream({
          stream: result.stream,
          tools: agentTools,
          sendReasoning: false,
          sendSources: false,
          sendFinish: false,
          onError: (error) => safeErrorMessage(error),
        });
        let streamFailed = false;
        const finalizationToolCalls = new Set<string>();
        const mappedFinalizationToolCalls = new Set<string>();
        for await (const chunk of uiStream) {
          if (!isAllowedAgentStreamChunk(chunk)) continue;
          rememberFinalizationToolCall(chunk, finalizationToolCalls);
          if (isFinalizationInputLifecycleChunk(chunk, finalizationToolCalls)) {
            if (!mappedFinalizationToolCalls.has(chunk.toolCallId)) {
              mappedFinalizationToolCalls.add(chunk.toolCallId);
              writer.write({
                type: 'tool-input-start',
                toolCallId: chunk.toolCallId,
                toolName: 'finalizeAnswer',
              });
            }
            continue;
          }
          writer.write(chunk as UIMessageChunk);
          if (isVisitorVisibleAgentStreamChunk(chunk, finalizationToolCalls)) metrics.visibleOutput();
          if (chunk.type === 'error') {
            streamFailed = true;
            metrics.error();
          }
        }

        if (abort.signal.aborted) {
          metrics.finish(abort.timedOut() ? 'timeout' : 'aborted');
          return;
        }
        if (streamFailed) return;

        finalizationResult ??= limitedResult(finalizationAttempts > 0);
        const evidence = publicRun.evidenceLedger.snapshot();
        metrics.setSource(sourceMode(evidence.map((item) => item.source)), evidence.length, finalizationResult.status === 'limited');
        metrics.setUsage(inputTokens, outputTokens);
        writer.write({ type: 'data-dm-answer', data: finalizationResult });
        metrics.visibleOutput();
        writer.write({ type: 'finish' });
        metrics.finish('completed');
      } catch (error) {
        if (abort.signal.aborted) {
          metrics.finish(abort.timedOut() ? 'timeout' : 'aborted');
          if (abort.timedOut()) writer.write({ type: 'error', errorText: 'DM took too long to answer. Please try again.' });
          return;
        }
        console.error('[dm] tool-loop failure', safeLogError(error));
        metrics.error();
        writer.write({ type: 'error', errorText: safeErrorMessage(error) });
      } finally {
        abort.dispose();
      }
    },
  });

  return createUIMessageStreamResponse({
    stream,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-DM-Trace-Id': deps.traceId ?? 'unknown',
    },
  });
}

function isAllowedAgentStreamChunk(chunk: UIMessageChunk): boolean {
  switch (chunk.type) {
    case 'start':
    case 'start-step':
    case 'finish-step':
    case 'tool-input-start':
    case 'tool-input-delta':
    case 'tool-input-available':
    case 'tool-input-error':
    case 'tool-output-available':
    case 'tool-output-error':
    case 'tool-output-denied':
    case 'tool-approval-request':
    case 'tool-approval-response':
    case 'error':
    case 'abort':
      return true;
    default:
      return false;
  }
}

function rememberFinalizationToolCall(chunk: UIMessageChunk, finalizationToolCalls: Set<string>): void {
  if (
    (chunk.type === 'tool-input-start' || chunk.type === 'tool-input-available' || chunk.type === 'tool-input-error')
    && chunk.toolName === 'finalizeAnswer'
  ) {
    finalizationToolCalls.add(chunk.toolCallId);
  }
}

function isFinalizationInputLifecycleChunk(
  chunk: UIMessageChunk,
  finalizationToolCalls: ReadonlySet<string>,
): chunk is Extract<UIMessageChunk, {
  type: 'tool-input-start' | 'tool-input-delta' | 'tool-input-available' | 'tool-input-error';
}> {
  switch (chunk.type) {
    case 'tool-input-start':
    case 'tool-input-delta':
    case 'tool-input-available':
    case 'tool-input-error':
      return finalizationToolCalls.has(chunk.toolCallId);
    default:
      return false;
  }
}

function isVisitorVisibleAgentStreamChunk(
  chunk: UIMessageChunk,
  finalizationToolCalls: ReadonlySet<string>,
): boolean {
  if (chunk.type === 'tool-input-start' || chunk.type === 'tool-input-available') {
    return chunk.toolName !== 'finalizeAnswer';
  }
  if (chunk.type === 'tool-output-available' && finalizationToolCalls.has(chunk.toolCallId)) {
    return isVisibleFinalizationResult(chunk.output);
  }
  return chunk.type === 'error';
}

function isVisibleFinalizationResult(value: unknown): boolean {
  return typeof value === 'object'
    && value !== null
    && 'status' in value
    && (value.status === 'accepted' || value.status === 'limited');
}

function createRuntimePublicTools(
  run: PublicAgentToolRun,
  artifacts: RunArtifacts,
  metrics: ReturnType<typeof createDMMetricsRecorder>,
  gate: PublicToolGate,
) {
  return {
    searchProjects: tool({
      description: run.searchProjects.description,
      inputSchema: run.searchProjects.inputSchema,
      execute: (input, { abortSignal }) => gate.run(async () => {
        metrics.tool();
        const result = await run.searchProjects(input, { abortSignal });
        for (const project of result.projects) artifacts.projects.set(project.id, project);
        rememberLimitations(artifacts, result.limitations);
        return result;
      }),
    }),
    getProject: tool({
      description: run.getProject.description,
      inputSchema: run.getProject.inputSchema,
      execute: (input, { abortSignal }) => gate.run(async () => {
        metrics.tool();
        const result = await run.getProject(input, { abortSignal });
        if (result.project) artifacts.projects.set(result.project.id, result.project);
        rememberLimitations(artifacts, result.limitations);
        return result;
      }),
    }),
    readResume: tool({
      description: run.readResume.description,
      inputSchema: run.readResume.inputSchema,
      execute: (input, { abortSignal }) => gate.run(async () => {
        metrics.tool();
        const result = await run.readResume(input, { abortSignal });
        for (const track of result.tracks) artifacts.resumeTracks.set(track.id, track);
        rememberLimitations(artifacts, result.limitations);
        return result;
      }),
    }),
    getContact: tool({
      description: run.getContact.description,
      inputSchema: run.getContact.inputSchema,
      execute: (input, { abortSignal }) => gate.run(async () => {
        metrics.tool();
        const result = await run.getContact(input, { abortSignal });
        artifacts.contact = result.contact;
        rememberLimitations(artifacts, result.limitations);
        return result;
      }),
    }),
    searchPublicSources: tool({
      description: run.searchPublicSources.description,
      inputSchema: run.searchPublicSources.inputSchema,
      execute: (input, { abortSignal }) => gate.run(async () => {
        metrics.tool();
        const result = await run.searchPublicSources(input, { abortSignal });
        for (const source of result.sources) artifacts.sources.set(source.id, source);
        rememberLimitations(artifacts, result.limitations);
        return result;
      }),
    }),
    searchProfile: tool({
      description: run.searchProfile.description,
      inputSchema: run.searchProfile.inputSchema,
      execute: (input, { abortSignal }) => gate.run(async () => {
        metrics.tool();
        const result = await run.searchProfile(input, { abortSignal });
        rememberLimitations(artifacts, result.limitations);
        return result;
      }),
    }),
  };
}

function createPublicToolGate(): PublicToolGate {
  const pending = new Set<Promise<unknown>>();
  return {
    run<T>(operation: () => Promise<T>): Promise<T> {
      const promise = operation();
      pending.add(promise);
      void promise.then(
        () => pending.delete(promise),
        () => pending.delete(promise),
      );
      return promise;
    },
    async waitForIdle(): Promise<void> {
      // Yield once so every tool call from the current model step can register.
      await Promise.resolve();
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
  };
}

function validateFinalAnswer(
  input: FinalAnswerInput,
  run: PublicAgentToolRun,
  artifacts: RunArtifacts,
): { ok: true; answer: DMValidatedAnswer } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  for (const [index, segment] of input.segments.entries()) {
    if (segment.kind !== 'factual') continue;
    const unknown = segment.evidenceIds.filter((id) => !run.evidenceLedger.has(id));
    if (unknown.length > 0) errors.push(`segment ${index + 1} cites evidence not returned in this run`);
  }
  for (const reference of input.artifacts) {
    if (!artifactAvailable(reference, artifacts)) errors.push(`${reference.kind} artifact was not returned in this run`);
  }
  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)].slice(0, 5) };

  const segments = input.segments.map((segment) => {
    if (segment.kind === 'factual') {
      return {
        text: segment.text,
        evidenceIds: [...new Set(segment.evidenceIds)],
        evidence: run.evidenceLedger.resolve(segment.evidenceIds),
      };
    }
    return {
      text: segment.kind === 'conversational'
        ? FINALIZATION_ENUM_COPY.conversational[segment.act]
        : FINALIZATION_ENUM_COPY.limitation[segment.code],
      evidenceIds: [],
      evidence: [],
    };
  });
  const segmentTexts = new Set(segments.map((segment) => segment.text));
  const limitations = [...new Set([
    ...input.limitations.map((code) => FINALIZATION_ENUM_COPY.limitation[code]),
    ...[...artifacts.limitations].map(humanLimitation).filter((item): item is string => Boolean(item)),
  ])].filter((limitation) => !segmentTexts.has(limitation));
  return {
    ok: true,
    answer: {
      segments,
      artifacts: input.artifacts.flatMap((reference) => resolveArtifact(reference, artifacts)),
      limitations,
      ...(input.followUp ? { followUp: FINALIZATION_ENUM_COPY.followUp[input.followUp] } : {}),
    },
  };
}

function artifactAvailable(reference: ArtifactReference, artifacts: RunArtifacts): boolean {
  if (reference.kind === 'project' || reference.kind === 'links') return artifacts.projects.has(reference.id);
  if (reference.kind === 'resume') return artifacts.resumeTracks.has(reference.id);
  if (reference.kind === 'contact') return artifacts.contact !== null;
  return artifacts.sources.has(reference.id);
}

function resolveArtifact(reference: ArtifactReference, artifacts: RunArtifacts): DMAnswerArtifact[] {
  if (reference.kind === 'project') {
    const project = artifacts.projects.get(reference.id);
    return project ? [{ kind: 'project', id: project.id, project }] : [];
  }
  if (reference.kind === 'resume') {
    const track = artifacts.resumeTracks.get(reference.id);
    return track ? [{ kind: 'resume', id: track.id, track }] : [];
  }
  if (reference.kind === 'contact') {
    return artifacts.contact ? [{ kind: 'contact', id: 'contact', contact: artifacts.contact }] : [];
  }
  if (reference.kind === 'evidence') {
    const source = artifacts.sources.get(reference.id);
    return source ? [{ kind: 'evidence', id: source.id, source }] : [];
  }
  const project = artifacts.projects.get(reference.id);
  return project ? [{ kind: 'links', id: `links:${project.id}`, projectId: project.id, items: project.links }] : [];
}

function emptyArtifacts(): RunArtifacts {
  return {
    projects: new Map(),
    resumeTracks: new Map(),
    contact: null,
    sources: new Map(),
    limitations: new Set(),
  };
}

function rememberLimitations(artifacts: RunArtifacts, limitations: string[]): void {
  for (const limitation of limitations) artifacts.limitations.add(limitation);
}

function humanLimitation(code: string): string | null {
  switch (code) {
    case 'public_data_unavailable':
    case 'published_project_links_unavailable':
      return 'Some published portfolio data was unavailable for this answer.';
    case 'public_source_config_unavailable':
      return 'Approved public-source search was unavailable for this answer.';
    case 'profile_source_not_available':
      return 'DM does not yet have a published public profile source for that personal detail.';
    case 'timeout':
      return 'A public source took too long to respond.';
    case 'cancelled':
      return 'A public-source read was cancelled.';
    case 'unknown_track_ids_omitted':
      return 'Unknown resume entries were omitted.';
    case 'result_limit':
    case 'result_limit_or_boundary_filter':
      return 'The answer uses a bounded subset of the available public results.';
    default:
      return null;
  }
}

function limitedResult(repairAttempted: boolean): Extract<DMFinalizationResult, { status: 'limited' }> {
  return {
    status: 'limited',
    repairAttempted,
    answer: {
      segments: [{
        text: 'I could not verify a complete answer from the public evidence returned in this run.',
        evidenceIds: [],
        evidence: [],
      }],
      artifacts: [],
      limitations: ['No unverified factual answer was shown.'],
      followUp: 'Would you like to ask about a specific published project, resume entry, or contact detail?',
    },
  };
}

const LATEST_TURN_CONTROL = [
  'Latest-turn control: the latest user message below is the only active request.',
  'Earlier messages are reference context only: use them to resolve the project subject, never as factual evidence.',
  'A subject correction in this latest user message replaces the prior subject.',
  'When the project subject has a known stable public id or slug, call getProject for each needed project.',
  'If only a public project title is known and its stable id or slug is unresolved, call searchProjects once to resolve it; use getProject for later coreference after resolution.',
  'For an aspect-only follow-up on the same project, answer only that aspect and omit a repeated project card unless this latest user message explicitly asks for one.',
  'For a repository-link follow-up, emit links artifacts rather than repeated project cards.',
].join(' ');

function modelMessages(request: DMChatRequest): ModelMessage[] {
  const messages = request.messages.slice(-13).map((message) => ({
    role: message.role === 'assistant' ? 'assistant' as const : 'user' as const,
    content: message.parts
      .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join('\n'),
  }));
  const lastUser = messages.findLastIndex((message) => message.role === 'user');
  if (lastUser >= 0) {
    messages[lastUser] = {
      ...messages[lastUser],
      content: `${LATEST_TURN_CONTROL}\n\nLatest user message:\n${messages[lastUser].content}${contextNote(request.context)}`,
    };
  }
  return messages;
}

function contextNote(context: DMChatContext | undefined): string {
  if (!context) return '';
  const lines = [
    context.projectIds?.length ? `Visible project ids: ${context.projectIds.join(', ')}` : '',
    context.resumeTrackIds?.length ? `Visible resume track ids: ${context.resumeTrackIds.join(', ')}` : '',
    context.fitCheck?.jobDescription ? `Job description supplied for fit check:\n${context.fitCheck.jobDescription}` : '',
  ].filter(Boolean);
  return lines.length ? `\n\nPage context (not factual evidence; use public tools before making claims):\n${lines.join('\n')}` : '';
}

function sourceMode(sources: string[]): DMSourceMode {
  const modes = new Set<DMSourceMode>();
  for (const source of sources) {
    if (source === 'project') modes.add('published_db');
    else if (source === 'resume') modes.add('resume_static');
    else if (source === 'contact') modes.add('contact_static');
    else if (source === 'public_source') modes.add('rag');
  }
  if (modes.size === 0) return 'none';
  if (modes.size > 1) return 'mixed';
  return modes.values().next().value ?? 'none';
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof DMAgentError) return error.safeMessage;
  if (error instanceof DMRuntimeConfigError) return 'DM is not configured for chat yet.';
  return 'DM could not answer that safely. Try a portfolio, resume, or contact question.';
}

function safeLogError(error: unknown): Record<string, unknown> {
  if (error instanceof DMAgentError) return { name: error.name, code: error.code };
  if (error instanceof DMRuntimeConfigError) return { name: error.name, missing: error.missing };
  if (error instanceof Error) return { name: error.name };
  return { name: typeof error };
}

function readBoundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !value.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new DMRuntimeConfigError(['DM runtime safeguards']);
  }
  return parsed;
}

function composeAbortSignal(requestSignal: AbortSignal | undefined, deadlineMs: number): {
  signal: AbortSignal;
  timedOut: () => boolean;
  dispose: () => void;
} {
  const controller = new AbortController();
  let deadlineReached = false;
  const abortFromRequest = () => controller.abort(requestSignal?.reason);
  if (requestSignal?.aborted) abortFromRequest();
  else requestSignal?.addEventListener('abort', abortFromRequest, { once: true });
  const timeout = setTimeout(() => {
    deadlineReached = true;
    controller.abort(new DOMException('DM request deadline exceeded.', 'TimeoutError'));
  }, deadlineMs);
  return {
    signal: controller.signal,
    timedOut: () => deadlineReached,
    dispose: () => {
      clearTimeout(timeout);
      requestSignal?.removeEventListener('abort', abortFromRequest);
    },
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException('DM request aborted.', 'AbortError');
}

const DM_SYSTEM_INSTRUCTIONS = [
  "You are DM, Dylan McCavitt's public portfolio agent for recruiters and hiring managers.",
  'Answer the latest question first. Normally use two to five concise sentences across no more than five answer segments.',
  'Use the typed public tools when a claim needs facts. Avoid tools for greetings, capability questions, and other purely conversational turns.',
  'Conversation history can resolve the subject, but only the latest turn controls the requested aspect. Corrections replace the prior subject instead of blending subjects.',
  'When the latest turn names, corrects, or refers to a project whose stable public id or slug is known, call getProject. If only its public title is known and the stable id or slug is unresolved, call searchProjects once to resolve it; do not guess a stable reference from the title.',
  'For an aspect-only follow-up on a previously discussed project, cite getProject evidence but omit the repeated project artifact unless the visitor explicitly asks to see its card. A correction to a different project may include that new project artifact.',
  'For a link-only follow-up, use links artifacts and omit project artifacts.',
  'For comparisons and interpretations, gather evidence for every project or resume fact you discuss and distinguish supported inference from fact.',
  'For ambiguous references, ask one clarifying follow-up without guessing. Otherwise include at most one follow-up, only when it materially helps.',
  'Unknown personal details require searchProfile and an honest limitation when its public result is empty.',
  'Never claim access to Slack, admin drafts, candidate evidence, private notes, visitor history, credentials, hidden projects, or unpublished records. Those sources and tools do not exist here.',
  'Every factual segment passed to finalizeAnswer must cite one or more evidenceIds returned by public tools in this same run.',
  'Only factual segments accept free text. For no-evidence output, select a server-controlled conversational act, limitation code, and optional follow-up code; never place arbitrary prose in those fields.',
  'Artifact references must use artifact ids returned by tools in this same run. Do not copy or invent artifact payloads.',
  'Call finalizeAnswer with the complete visitor answer. Do not emit visitor-facing prose outside finalizeAnswer.',
  'If finalizeAnswer rejects the structure, repair it exactly once using the rejection errors. Never retry it more than once.',
].join('\n');
