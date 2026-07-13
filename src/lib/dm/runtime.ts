import { gateway } from 'ai';
import { openai } from '@ai-sdk/openai';
import { isStepCount, streamText, type LanguageModel } from 'ai';
import type { ProjectReadQueryable } from '@/lib/db/project-reads';
import { loadPublicProjectDetails, type PublicProjectEnv } from '@/lib/public-projects';
import {
  createPublicRagSearchConfig,
  publicRagSearch,
  type PublicRagSearchConfig,
  type PublicRagSearchOutput,
} from '@/lib/rag/retrieval';
import { createPublicDMDataTools, DMToolError, type PublishedProjectLoader, type PublicDMDataTools } from './data-tools';
import { createDMMetricsRecorder, shouldRecordDMMetrics } from './metrics';
import { AGENT_NAME, type AnswerBlock, type DMChatRequest, type DMStreamEvent, type ProjectFactPacket, type PublicRagCitation, type ToolTraceItem, type ToolTraceMetadata } from './contract';
import {
  deterministicProjectFallback,
  enforceProjectDraft,
  invalidProjectDraftFallback,
  isProjectDeepDiveRequest,
  projectAnswerDisclosure,
  projectDraftBlocks,
  projectPacketPrompt,
  requestExcludesProjectArtifacts,
  requestRequiresOneProjectArtifact,
  renderProjectDraft,
  retrieveProjectFactPacket,
  validateProjectDraft,
  withPacketCitations,
} from './grounding';

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
  projectLoader?: PublishedProjectLoader;
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
  const model = env.DM_MODEL?.trim() ?? 'openai/gpt-4.1';
  const missing: string[] = [];

  if (usesGateway && !env.AI_GATEWAY_API_KEY?.trim()) missing.push('AI_GATEWAY_API_KEY');
  if (!usesGateway && !env.OPENAI_API_KEY?.trim()) missing.push('OPENAI_API_KEY');
  if (missing.length > 0) throw new DMRuntimeConfigError(missing);

  return { provider, model };
}

export function readDMBudgetConfig(env: DMRuntimeEnv = process.env): DMBudgetConfig {
  return {
    deadlineMs: readBoundedInteger(env.DM_REQUEST_DEADLINE_MS, 45_000, 5_000, 120_000),
    maxOutputTokens: readBoundedInteger(env.DM_MAX_OUTPUT_TOKENS, 1_200, 128, 4_096),
    maxSteps: readBoundedInteger(env.DM_MAX_STEPS, 6, 1, 8),
  };
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
  const projectLoader = deps.projectLoader ?? (() =>
    loadPublicProjectDetails({ db: deps.db, env: deps.env }).then(({ projects }) => projects));
  const tools = createPublicDMDataTools(deps.db, { loadProjects: projectLoader });
  const model = deps.model ?? createDMModel(config);
  const budgets = deps.budgets ?? readDMBudgetConfig(deps.env);
  const abort = composeAbortSignal(deps.signal, budgets.deadlineMs);
  const metrics = createDMMetricsRecorder({
    enabled: shouldRecordDMMetrics(),
    traceId: deps.traceId,
    logger: deps.metricsLogger,
  });

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const traceItems: ToolTraceItem[] = [];
      const answer: AnswerBlock[] = [];
      let blockIndex = 0;

      const emit = (event: DMStreamEvent, force = false): void => {
        if (abort.signal.aborted && !force) return;
        metrics.record(event);
        enqueueJson(controller, encoder, event);
      };

      try {
        throwIfAborted(abort.signal);
        const { request: normalizedRequest, leadingBlocks, endTurnAfterNotice } = await validateContext(request, tools);
        throwIfAborted(abort.signal);
        const refusal = privateDataRefusal(normalizedRequest.message);
        if (refusal) {
          emit({ type: 'block', index: blockIndex, block: refusal });
          answer.push(refusal);
          emit({ type: 'done', answer, trace: trace(traceItems) });
          return;
        }

        let factPacket = await retrieveProjectFactPacket(normalizedRequest, tools);
        throwIfAborted(abort.signal);
        factPacket = await addRequestedRagCitations(factPacket, normalizedRequest, deps, abort.signal);
        throwIfAborted(abort.signal);
        metrics.setSource(sourceModeFromPacket(factPacket, normalizedRequest), factPacket.projects.length + factPacket.citations.length, factPacket.fallbackUsed);

        const system = await buildSystemPrompt(tools, factPacket).catch((error: unknown) => {
          console.warn('[dm] system prompt digest failed, using minimal prompt', safeLogError(error));
          return minimalSystemPrompt(factPacket);
        });

        emit({
          type: 'ready',
          agent: AGENT_NAME,
          provider: config.provider,
          traceId: deps.traceId ?? 'unknown',
          trace: trace(traceItems),
        });

        for (const block of leadingBlocks) {
          answer.push(block);
          emit({ type: 'block', index: blockIndex, block });
          blockIndex += 1;
        }

        if (endTurnAfterNotice) {
          emit({ type: 'done', answer, trace: trace(traceItems), facts: factPacket });
          return;
        }

        if (factPacket.operation === 'none') {
          const responseText = await deterministicPublicInfoAnswer(normalizedRequest, tools);
          emit({ type: 'text-delta', delta: responseText });
          answer.unshift({ kind: 'text', text: responseText });
          const supplementalBlocks = await deterministicBlocks(normalizedRequest, tools, answer);
          for (const block of supplementalBlocks) {
            answer.push(block);
            emit({ type: 'block', index: blockIndex, block });
            blockIndex += 1;
          }
          emit({ type: 'done', answer, trace: trace(traceItems), facts: factPacket });
          return;
        }

        if (factPacket.projects.length === 0) {
          const fallback = deterministicProjectFallback(factPacket);
          emit({ type: 'text-delta', delta: fallback });
          answer.unshift({ kind: 'text', text: fallback });
          const supplementalBlocks = await deterministicBlocks(normalizedRequest, tools, answer);
          for (const block of supplementalBlocks) {
            answer.push(block);
            emit({ type: 'block', index: blockIndex, block });
            blockIndex += 1;
          }
          emit({ type: 'done', answer, trace: trace(traceItems), facts: factPacket });
          return;
        }

        const publishedProjectIdentities = requestRequiresOneProjectArtifact(normalizedRequest.message)
          ? await tools.allPublishedProjects()
          : factPacket.projects;

        let validated = validateProjectDraft('', factPacket, normalizedRequest.message, publishedProjectIdentities);
        let rejectionReason = '';
        for (let attempt = 0; attempt < 2; attempt += 1) {
          let finalText = '';
          const retryInstruction = attempt === 0 ? '' : [
            'Your previous grounded answer draft was rejected by the server.',
            `Reason: ${rejectionReason}`,
            'Return one corrected JSON draft over the exact same PROJECT_FACT_PACKET. Do not repeat the invalid prose.',
          ].join('\n');
          const result = streamText({
            model,
            system: retryInstruction ? `${system}\n\n${retryInstruction}` : system,
            messages: modelMessages(normalizedRequest),
            stopWhen: isStepCount(budgets.maxSteps),
            maxOutputTokens: budgets.maxOutputTokens,
            abortSignal: abort.signal,
          });

          for await (const part of result.stream) {
            throwIfAborted(abort.signal);
            if (part.type === 'text-delta') {
              const delta = textDelta(part);
              if (delta) finalText += delta;
            } else if (part.type === 'tool-call') {
              const item = traceItem(part.toolName, toolSummary(part.toolName));
              traceItems.push(item);
              emit({ type: 'tool', name: item.tool, summary: item.label });
            } else if (part.type === 'tool-result') {
              const blocks = blocksFromToolResult(part.output);
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

          let usage: Awaited<typeof result.usage> | null = null;
          try {
            usage = await result.usage;
          } catch {
            // Provider usage is optional instrumentation, never a stream failure.
          }
          metrics.setUsage(usage?.inputTokens ?? null, usage?.outputTokens ?? null);
          validated = validateProjectDraft(finalText.trim(), factPacket, normalizedRequest.message, publishedProjectIdentities);
          if (validated.ok) break;
          rejectionReason = validated.reason;
        }
        metrics.setSource(
          sourceModeFromPacket(factPacket, normalizedRequest),
          factPacket.projects.length + factPacket.citations.length,
          factPacket.fallbackUsed || !validated.ok,
        );
        const enforcedDraft = validated.ok
          ? enforceProjectDraft(normalizedRequest, validated.draft, factPacket, publishedProjectIdentities)
          : null;
        const disclosure = enforcedDraft ? projectAnswerDisclosure(normalizedRequest, factPacket) : '';
        const emittedText = enforcedDraft
          ? [disclosure, renderProjectDraft(enforcedDraft, factPacket)].filter(Boolean).join('\n\n')
          : invalidProjectDraftFallback();
        if (emittedText) {
          emit({ type: 'text-delta', delta: emittedText });
          answer.unshift({ kind: 'text', text: emittedText });
        }

        if (enforcedDraft) {
          for (const block of projectDraftBlocks(normalizedRequest, enforcedDraft, factPacket)) {
            answer.push(block);
            emit({ type: 'block', index: blockIndex, block });
            blockIndex += 1;
          }
        }

        const supplementalBlocks = await deterministicBlocks(normalizedRequest, tools, answer);
        for (const block of supplementalBlocks) {
          answer.push(block);
          emit({ type: 'block', index: blockIndex, block });
          blockIndex += 1;
        }

        emit({ type: 'done', answer, trace: trace(traceItems), facts: factPacket });
      } catch (error) {
        if (abort.signal.aborted) {
          if (abort.timedOut()) {
            metrics.finish('timeout');
            enqueueJson(controller, encoder, { type: 'error', message: 'DM took too long to answer. Please try again.' });
          } else {
            metrics.finish('aborted');
          }
          return;
        }
        const message = safeErrorMessage(error);
        console.error('[dm] chat stream failure', safeLogError(error));
        emit({ type: 'error', message });
      } finally {
        abort.dispose();
        try {
          controller.close();
        } catch {
          // A consumer can close the stream before an aborted start() reaches cleanup.
        }
      }
    },
    cancel() {
      abort.cancel();
    },
  });
}

function isDMToolError(error: unknown): error is DMToolError {
  return error instanceof Error && error.name === 'DMToolError';
}

async function addRequestedRagCitations(
  packet: ProjectFactPacket,
  request: DMChatRequest,
  deps: DMRuntimeDeps,
  signal?: AbortSignal,
): Promise<ProjectFactPacket> {
  if (packet.operation === 'none' || packet.projects.length === 0) return packet;
  if (!isProjectDeepDiveRequest(request.message)) return packet;
  const apiKey = deps.env?.OPENAI_API_KEY?.trim() ?? process.env.OPENAI_API_KEY?.trim();
  if (!deps.ragSearch && !apiKey) return packet;
  throwIfAborted(signal);
  const ragConfig = await createPublicRagSearchConfig(deps.db).catch((error: unknown) => {
    console.warn('[dm] rag setup failure', safeLogError(error));
    return null;
  });
  throwIfAborted(signal);
  if (!ragConfig) return packet;
  const searchRag = deps.ragSearch ?? publicRagSearch;
  try {
    const { citations } = await searchRag(
      request.message,
      ragConfig,
      { apiKey: apiKey ?? 'test-key', signal },
    );
    return withPacketCitations(packet, citations as PublicRagCitation[]);
  } catch (error) {
    console.warn('[dm] pre-synthesis rag search failed', safeLogError(error));
    return packet;
  }
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

async function deterministicBlocks(
  request: DMChatRequest,
  tools: PublicDMDataTools,
  existing: AnswerBlock[],
): Promise<AnswerBlock[]> {
  const blocks: AnswerBlock[] = [];
  const normalized = request.message.toLowerCase();
  const hasResume = existing.some((block) => block.kind === 'resume');
  const hasContact = existing.some((block) => block.kind === 'contact');
  const zeroCardProjectRequest = requestExcludesProjectArtifacts(request.message);
  const asksResume = request.context?.resumeTrackIds?.length || (zeroCardProjectRequest
    ? /\b(?:resume|résumé|cv|experience|education|employment|degree)\b/.test(normalized)
      || /\b(?:summarize|share|show|read|tell me about|what about)\b.{0,30}\b(?:his|dylan(?:'s|’s)) (?:career|background)\b/.test(normalized)
    : matchesAny(normalized, ['resume', 'experience', 'background', 'education', 'career']));
  const asksContact = zeroCardProjectRequest
    ? /\b(?:contact|email|reach|phone|location|availability|open to work)\b/.test(normalized)
      || /\b(?:whether|is)\b.{0,20}\b(?:he|dylan)\b.{0,20}\b(?:available|open to opportunities)\b/.test(normalized)
      || /\b(?:how|where)\b.{0,20}\b(?:contact|reach|hire)\b.{0,12}\b(?:dylan|him)\b/.test(normalized)
    : matchesAny(normalized, ['contact', 'email', 'reach', 'hire', 'available', 'opportunities']);

  if (!hasResume && asksResume) {
    const trackIds = request.context?.resumeTrackIds ?? ['now', 'kroll', 'stevens', 'bella-era'];
    blocks.push({ kind: 'resume', trackIds });
  }

  if (!hasContact && asksContact) {
    blocks.push(toAnswerContact(tools.getContact()));
  }

  if (request.context?.fitCheck && !hasResume) {
    blocks.push({ kind: 'resume', trackIds: ['now', 'stevens', 'bella-era', 'kroll'] });
  }

  return blocks;
}

async function deterministicPublicInfoAnswer(request: DMChatRequest, tools: PublicDMDataTools): Promise<string> {
  const normalized = request.message.toLowerCase();
  const asksResume = Boolean(request.context?.resumeTrackIds?.length) ||
    matchesAny(normalized, ['resume', 'résumé', 'cv', 'experience', 'background', 'education', 'career', 'employment', 'degree']);
  const asksContact = matchesAny(normalized, ['contact', 'email', 'reach', 'phone', 'location', 'hire', 'available', 'availability', 'opportunities', 'open to work']);
  if (!asksResume && !asksContact) return "Ask me about Dylan's published projects, public resume, or contact details.";

  const requestedTrackIds = request.context?.resumeTrackIds;
  const resume = asksResume
    ? await tools.readResume(requestedTrackIds?.length ? { trackIds: requestedTrackIds } : {})
    : { tracks: [] };
  const resumeTracks = requestedTrackIds?.length
    ? resume.tracks
    : ['now', 'stevens', 'kroll']
      .map((id) => resume.tracks.find((track) => track.id === id))
      .filter((track): track is (typeof resume.tracks)[number] => Boolean(track));
  const current = resumeTracks.find((track) => track.id === 'now');
  const education = resumeTracks.find((track) => track.id === 'stevens');
  const cyberRisk = resumeTracks.find((track) => track.id === 'kroll');
  const resumeHighlights = requestedTrackIds?.length
    ? resumeTracks.map((track) => [
      `${track.title}: ${track.role} (${track.when}).`,
      track.about[0] ?? '',
    ].filter(Boolean).join(' ')).join(' ')
    : [
      current?.about[0] ?? (current ? `${current.title}: ${current.role}.` : ''),
      education ? `${education.role} at ${education.title}.` : '',
      cyberRisk ? `${cyberRisk.role} at ${cyberRisk.title}.` : '',
    ].filter(Boolean).join(' ');
  const contact = asksContact ? tools.getContact() : null;
  const contactDetails = contact
    ? `Recruiters can reach Dylan at ${contact.email}.`
    : '';

  if (asksResume && asksContact) {
    return `Dylan's public resume highlights and contact details: ${resumeHighlights} ${contactDetails}`.trim();
  }
  if (asksResume) return `Dylan's public resume highlights: ${resumeHighlights}`.trim();
  return `Dylan's public contact details: ${contactDetails} He is ${contact?.status ?? 'open to opportunities'} in ${contact?.location ?? 'New York City'}.`.trim();
}

async function buildSystemPrompt(tools: PublicDMDataTools, packet: ProjectFactPacket): Promise<string> {
  const resumeResult = await tools.readResume({}).catch(() => ({ tracks: [] as { id: string; title: string; role: string; when: string }[] }));
  const tracks = resumeResult.tracks.map((track) => ({ id: track.id, title: track.title, role: track.role, when: track.when }));
  const trackLines = tracks.map((track) => `- ${track.id}: ${track.title} (${track.role}, ${track.when})`);
  const projectRules = packet.operation === 'none'
    ? [
        'No project fact packet was needed for this turn.',
        'Do not make project claims in this response; project retrieval is intentionally unavailable to the model.',
      ]
    : [
        'Project retrieval already completed before generation. Project retrieval tools are intentionally unavailable for this response.',
        projectPacketPrompt(packet),
        `The retrieval status is ${packet.status}. Disclose partial or fallback status; for empty results, say no matching published project was returned.`,
      ];

  return [
    "You are DM, Dylan McCavitt's public portfolio agent for recruiters and hiring managers.",
    'You answer only from tool results over published portfolio project records, approved public RAG source citations, and static public resume/contact data.',
    'Never claim access to drafts, candidate records, private repos, Slack/admin notes, visitor chats, database metadata, or hidden plans.',
    'If asked for private or unsupported facts, refuse briefly and redirect to public projects, resume, or contact details.',
    '',
    ...projectRules,
    '',
    'Resume tracks you can reference:',
    ...trackLines,
    '',
    'Tool selection rules:',
    '- Resume/background/career/education -> use readResume.',
    '- Contact/hiring/reach -> use getContact.',
    '- Project facts and approved public citations, when requested, are already inside the fact packet.',
    'Keep answers concise, confident, and recruiter-friendly. If a specific request is not public, say so and offer the closest public evidence.',
  ].join('\n');
}

function minimalSystemPrompt(packet: ProjectFactPacket): string {
  const projectRules = packet.operation === 'none'
    ? 'No project fact packet was needed for this turn. Do not make project claims; only resume/contact tools are available.'
    : `Project retrieval already completed before generation and project tools are unavailable. ${projectPacketPrompt(packet)} Retrieval status is ${packet.status}.`;
  return [
    "You are DM, Dylan McCavitt's public portfolio agent for recruiters and hiring managers.",
    'Answer only from tool results over published portfolio project records, approved public RAG sources, and static public resume/contact data.',
    'Never claim access to private drafts, candidate records, hidden repos, or admin notes.',
    projectRules,
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

function blocksFromToolResult(output: unknown): AnswerBlock[] {
  if (!isRecord(output)) return [];
  if (output.ok === false) return [];
  const blocks: AnswerBlock[] = [];
  if (Array.isArray(output.tracks)) {
    const trackIds = output.tracks.filter(isTrackLike).map((track) => track.id);
    if (trackIds.length > 0) blocks.push({ kind: 'resume', trackIds });
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
  if (isDMToolError(error)) return { name: error.name, code: error.code };
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
  cancel: () => void;
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
    cancel: () => controller.abort(new DOMException('DM stream cancelled.', 'AbortError')),
    dispose: () => {
      clearTimeout(timeout);
      requestSignal?.removeEventListener('abort', abortFromRequest);
    },
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('DM request aborted.', 'AbortError');
}

function sourceModeFromPacket(packet: ProjectFactPacket, request: DMChatRequest): import('./metrics').DMSourceMode {
  const message = request.message.toLowerCase();
  const resume = Boolean(request.context?.resumeTrackIds?.length) || /resume|résumé|cv|experience|background|education|career/.test(message);
  const contact = /contact|email|reach|phone|location|hire|available|opportunities/.test(message);
  const sources = new Set<import('./metrics').DMSourceMode>();
  if (packet.projects.length) sources.add('published_db');
  if (packet.citations.length) sources.add('rag');
  if (resume) sources.add('resume_static');
  if (contact) sources.add('contact_static');
  if (sources.size === 0) return 'none';
  if (sources.size > 1) return 'mixed';
  return sources.values().next().value ?? 'none';
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

function isTrackLike(value: unknown): value is { id: string } {
  return isRecord(value) && typeof value.id === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function matchesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}
