import { DefaultChatTransport, type UIMessageChunk } from 'ai';
import type { DMAnswerArtifact, DMChatRequest, DMFinalizationResult, DMUIData, DMUIMessage } from './contract';

export interface TimedDMChunk {
  chunk: UIMessageChunk<unknown, DMUIData>;
  elapsedMs: number;
}

export interface DMResponseObservation {
  result: Exclude<DMFinalizationResult, { status: 'rejected' }> | null;
  answerText: string;
  tools: string[];
  blockKinds: string[];
  projectIds: string[];
  evidenceIds: string[];
  errors: string[];
  outcome: 'completed' | 'error' | 'incomplete';
  timedChunks: TimedDMChunk[];
}

export async function observeDMResponse(response: Response, request: DMChatRequest): Promise<DMResponseObservation> {
  const started = performance.now();
  const transport = new DefaultChatTransport<DMUIMessage>({
    api: 'https://dm.invalid/api/dm/chat',
    fetch: async () => response,
  });
  const stream = await transport.sendMessages({
    trigger: 'submit-message',
    chatId: 'dm-observer',
    messageId: undefined,
    messages: request.messages,
    abortSignal: undefined,
  });
  const timedChunks: TimedDMChunk[] = [];
  const tools: string[] = [];
  const errors: string[] = [];
  let result: Exclude<DMFinalizationResult, { status: 'rejected' }> | null = null;
  let finished = false;

  for await (const rawChunk of stream) {
    const chunk = rawChunk as UIMessageChunk<unknown, DMUIData>;
    timedChunks.push({ chunk, elapsedMs: Math.max(0, Math.round(performance.now() - started)) });
    if (chunk.type === 'tool-input-start' || chunk.type === 'tool-input-available') {
      if (chunk.toolName !== 'finalizeAnswer' && !tools.includes(chunk.toolName)) tools.push(chunk.toolName);
    }
    if (chunk.type === 'error') errors.push(chunk.errorText);
    if (chunk.type === 'data-dm-answer') {
      const candidate = chunk.data as DMFinalizationResult;
      if (candidate.status !== 'rejected') result = candidate;
    }
    if (chunk.type === 'finish') finished = true;
  }

  const artifacts = result?.answer.artifacts ?? [];
  return {
    result,
    answerText: result ? answerText(result) : '',
    tools,
    blockKinds: artifacts.map(describeArtifact),
    projectIds: artifacts.flatMap((artifact) => artifact.kind === 'project' ? [artifact.id] : []),
    evidenceIds: result ? [...new Set(result.answer.segments.flatMap((segment) => segment.evidenceIds))] : [],
    errors,
    outcome: result && finished ? 'completed' : errors.length > 0 ? 'error' : 'incomplete',
    timedChunks,
  };
}

function answerText(result: Exclude<DMFinalizationResult, { status: 'rejected' }>): string {
  return [
    ...result.answer.segments.map((segment) => segment.text),
    ...result.answer.limitations,
    ...(result.answer.followUp ? [result.answer.followUp] : []),
  ].join('\n').trim();
}

function describeArtifact(artifact: DMAnswerArtifact): string {
  if (artifact.kind === 'project') return `projects:${artifact.id}`;
  if (artifact.kind === 'resume') return `resume:${artifact.id}`;
  if (artifact.kind === 'contact') return 'contact';
  if (artifact.kind === 'evidence') return 'evidence';
  return `links:${artifact.projectId}`;
}
