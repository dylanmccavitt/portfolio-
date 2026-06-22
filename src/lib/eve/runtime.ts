import { getVercelOidcToken } from '@vercel/oidc';
import {
  assertProjectIds,
  assertResumeTrackIds,
  deriveGroundingContext,
  filterCatalog,
  getContact,
  rankProjects,
  readResume,
  searchCatalog,
  type EveToolError,
} from './data-tools';
import type {
  AnswerBlock,
  EveAnswer,
  EveChatContext,
  EveChatRequest,
  EveGroundingPacket,
  EveStreamEvent,
  ToolTraceItem,
} from './contract';

export interface EveRuntimeConfig {
  /** Origin for Dylan's real Eve app (`~/portfolio-agent`), e.g. https://agent.example.com. */
  agentHost: string;
  /** Optional static bearer for non-OIDC agent auth. Prefer Vercel OIDC on Vercel. */
  bearerToken?: string;
  /** Optional Vercel deployment-protection bypass for protected previews. */
  bypassSecret?: string;
  /** Loopback hosts use `localDev()` auth and do not need a bearer. */
  isLoopback: boolean;
}

interface RemoteDeps {
  fetch: typeof fetch;
  getOidcToken: () => Promise<string>;
}

interface RemoteSession {
  sessionId: string;
  continuationToken?: string;
}

interface RemoteEveEvent {
  type?: unknown;
  data?: unknown;
}

type ArtifactBlock = Exclude<AnswerBlock, { kind: 'text' }>;

export class EveRuntimeConfigError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(`Missing Eve runtime environment: ${missing.join(', ')}`);
    this.name = 'EveRuntimeConfigError';
    this.missing = missing;
  }
}

export class EveAgentError extends Error {
  readonly code: string;
  readonly safeMessage: string;

  constructor(code: string, message: string, safeMessage = 'DM is unavailable right now.') {
    super(message);
    this.name = 'EveAgentError';
    this.code = code;
    this.safeMessage = safeMessage;
  }
}

export function readEveRuntimeConfig(
  env: Partial<Record<string, string | undefined>> = process.env,
): EveRuntimeConfig {
  const agentHost = env.EVE_AGENT_HOST?.trim();
  const missing: string[] = [];

  if (!agentHost) missing.push('EVE_AGENT_HOST');

  if (missing.length > 0) {
    throw new EveRuntimeConfigError(missing);
  }

  const normalizedHost = normalizeAgentHost(agentHost as string);

  return {
    agentHost: normalizedHost,
    bearerToken: env.EVE_AGENT_BEARER_TOKEN?.trim() || undefined,
    bypassSecret: env.EVE_AGENT_BYPASS_SECRET?.trim() || undefined,
    isLoopback: isLoopbackHost(normalizedHost),
  };
}

export function resolveModelId(provider: string, model: string): string {
  return model.includes('/') ? model : `${provider}/${model}`;
}

/**
 * Heuristic artifact answer over canonical site data. The real prose comes from
 * `~/portfolio-agent`; these blocks keep the landing's project/resume/contact
 * canvas grounded in the same `catalog.ts` / `resume.ts` facts as static pages.
 */
export function createEveAnswer(message: string, context: EveChatContext = {}): EveAnswer {
  if (context.projectIds) assertProjectIds(context.projectIds);
  if (context.resumeTrackIds) assertResumeTrackIds(context.resumeTrackIds);

  const query = message.trim();
  const normalized = query.toLowerCase();
  const trace: ToolTraceItem[] = [];
  const addTrace = (item: Omit<ToolTraceItem, 'label'> & { label?: string }) => {
    trace.push({
      ...item,
      label: item.label ?? `${item.tool} returned ${item.resultCount}`,
    });
  };

  let blocks: AnswerBlock[];

  if (!query) {
    blocks = fallbackAnswer("Ask me about Dylan's projects, shipped work, background, current side projects, or contact details.");
  } else if (matchesAny(normalized, ['contact', 'reach', 'email', 'hire', 'open to work', 'available'])) {
    const resume = readResume({ trackIds: ['now'] });
    const contact = getContact();
    addTrace({
      tool: 'read_resume',
      input: { trackIds: ['now'] },
      resultCount: resume.tracks.length,
      label: 'read_resume found current availability',
    });
    addTrace({
      tool: 'get_contact',
      input: {},
      resultCount: contact.links.length,
      label: 'get_contact returned contact routes',
    });
    blocks = [
      {
        kind: 'text',
        text: `Yes. Dylan is ${contact.status}, based in ${contact.location}, and his resume notes that he is a US citizen with no sponsorship needed.`,
      },
      { kind: 'contact' },
      { kind: 'links', items: contact.links },
    ];
  } else if (matchesAny(normalized, ['background', 'resume', 'experience', 'education', 'career'])) {
    const resume = readResume(context.resumeTrackIds ? { trackIds: context.resumeTrackIds } : {});
    addTrace({
      tool: 'read_resume',
      input: context.resumeTrackIds ? { trackIds: context.resumeTrackIds } : {},
      resultCount: resume.tracks.length,
      label: 'read_resume returned career timeline',
    });
    blocks = [
      {
        kind: 'text',
        text: `${resume.line}. The short version is economics, legal operations, cyber risk, then engineering.`,
      },
      { kind: 'resume', trackIds: resume.tracks.map((track) => track.id) },
    ];
  } else if (matchesAny(normalized, ['ios', 'iphone', 'swift', 'mobile', 'app store', 'testflight'])) {
    const result = filterCatalog({ area: 'iOS' });
    addTrace({
      tool: 'filter_catalog',
      input: { area: 'iOS' },
      resultCount: result.projects.length,
      label: 'filter_catalog found iOS projects',
    });
    blocks = [
      { kind: 'text', text: 'Yes. The portfolio includes two iOS side projects built to practice consumer product polish:' },
      { kind: 'projects', ids: result.projects.map((project) => project.id) },
    ];
  } else if (matchesAny(normalized, ['trading', 'options', 'broker', 'risk', 'market'])) {
    const result = searchCatalog({ query: 'trading risk broker options', limit: 5 });
    addTrace({
      tool: 'search_catalog',
      input: { query: 'trading risk broker options', limit: 5 },
      resultCount: result.projects.length,
      label: 'search_catalog found finance automation projects',
    });
    blocks = [
      {
        kind: 'text',
        text: "Dylan has trading and personal-finance side projects, but they are framed as practical automation and research discipline rather than his whole professional identity. Start with exits-only automation, local portfolio tooling, and the scheduled RSI(2) review workflow.",
      },
      { kind: 'projects', ids: result.projects.map((project) => project.id) },
    ];
  } else if (matchesAny(normalized, ['agent', 'mcp', 'automation', 'ai', 'eval'])) {
    const result = filterCatalog({ area: 'Agents & MCP' });
    addTrace({
      tool: 'filter_catalog',
      input: { area: 'Agents & MCP' },
      resultCount: result.projects.length,
      label: 'filter_catalog found agent and MCP work',
    });
    blocks = [
      {
        kind: 'text',
        text: 'For agent and MCP work, start with assistant regression tests, TradingView Desktop workflow tooling, the scheduled RSI(2) review project, and the shelved eval-game experiment.',
      },
      { kind: 'projects', ids: result.projects.map((project) => project.id) },
    ];
  } else if (matchesAny(normalized, ['now', 'current', 'building', 'active', 'wip'])) {
    const result = filterCatalog({ wip: true });
    addTrace({
      tool: 'filter_catalog',
      input: { wip: true },
      resultCount: result.projects.length,
      label: 'filter_catalog found current builds',
    });
    blocks = [
      {
        kind: 'text',
        text: 'Right now, Dylan is building practical side projects around assistant evaluation, charting workflow automation, finance tooling, and infrastructure scheduling.',
      },
      { kind: 'projects', ids: result.projects.map((project) => project.id) },
    ];
  } else if (matchesAny(normalized, ['best', 'impressive', 'strongest', 'impact'])) {
    const result = rankProjects({ intent: query, limit: 3 });
    addTrace({
      tool: 'rank_projects',
      input: { intent: query, limit: 3 },
      resultCount: result.projects.length,
      label: 'rank_projects selected strongest evidence',
    });
    blocks = [
      {
        kind: 'text',
        text: 'The strongest evidence is work with real-world constraints: shipped client ecommerce, assistant behavior regression tests, and practical automation with clear boundaries.',
      },
      { kind: 'projects', ids: result.projects.map((project) => project.id) },
    ];
  } else if (matchesAny(normalized, ['ship', 'shipped', 'client', 'freelance', 'ecommerce', 'full stack'])) {
    const result = filterCatalog({ area: 'Shipped' });
    addTrace({
      tool: 'filter_catalog',
      input: { area: 'Shipped' },
      resultCount: result.projects.length,
      label: 'filter_catalog found shipped work',
    });
    blocks = [
      {
        kind: 'text',
        text: "For shipped product work, look at the ecommerce build for Bella's Beads and the No Hard Feelings band site.",
      },
      { kind: 'projects', ids: result.projects.map((project) => project.id) },
    ];
  } else {
    const result = searchCatalog({ query, limit: 4 });
    addTrace({
      tool: 'search_catalog',
      input: { query, limit: 4 },
      resultCount: result.projects.length,
      label: 'search_catalog tried the visitor question',
    });
    blocks =
      result.projects.length > 0
        ? [
            { kind: 'text', text: 'I found a few portfolio entries that look relevant:' },
            { kind: 'projects', ids: result.projects.map((project) => project.id) },
          ]
        : fallbackAnswer(
            'I do not have a precise match in the site data for that. I can still help with projects, shipped client work, current side projects, résumé, or contact details.',
          );
  }

  blocks = applyContextBlockPriorities(blocks, context);

  assertAnswerBlocksValid(blocks);
  return { blocks, trace: { count: trace.length, items: trace } };
}

export function assertAnswerBlocksValid(blocks: AnswerBlock[]): void {
  for (const block of blocks) {
    if (block.kind === 'projects') assertProjectIds(block.ids);
    if (block.kind === 'resume') assertResumeTrackIds(block.trackIds);
    if (block.kind === 'links') {
      for (const [label, href] of block.items) {
        if (!label.trim() || !href.trim()) {
          throw new Error('Eve answer contains an invalid link block item');
        }
      }
    }
  }
}

/**
 * Stream Dylan's real `~/portfolio-agent` through the site's answer-block UI.
 * The remote agent owns prose. This site adds deterministic artifacts from its
 * canonical data modules so the right pane can still render project/resume/contact cards.
 */
export function createEveAgentStream(
  request: EveChatRequest,
  config: EveRuntimeConfig,
  deps: Partial<RemoteDeps> = {},
): ReadableStream<Uint8Array> {
  const runtimeDeps: RemoteDeps = {
    fetch: deps.fetch ?? fetch,
    getOidcToken: deps.getOidcToken ?? getVercelOidcToken,
  };
  const encoder = new TextEncoder();
  const artifactAnswer = createEveAnswer(request.message, request.context);
  const groundingContext = deriveGroundingContext(request.message, request.context);
  const artifactBlocks = artifactAnswer.blocks.filter(isArtifactBlock);

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let finalText = '';
      let sawDelta = false;
      const remoteBlocks: AnswerBlock[] = [];
      let blockIndex = 0;

      try {
        const session = await startRemoteSession(config, request.message, groundingContext, runtimeDeps);
        enqueueJson(controller, encoder, {
          type: 'ready',
          agent: 'DM',
          trace: artifactAnswer.trace,
          provider: 'portfolio-agent',
        });

        for (const item of artifactAnswer.trace.items) {
          enqueueJson(controller, encoder, {
            type: 'tool',
            name: item.tool,
            summary: item.label,
          });
        }

        await streamRemoteSession(config, session.sessionId, runtimeDeps, (event) => {
          const transformed = transformRemoteEvent(event);

          for (const streamEvent of transformed) {
            if (streamEvent.type === 'text-delta') {
              sawDelta = true;
              finalText += streamEvent.delta;
            }
            if (streamEvent.type === 'block') {
              if (streamEvent.block.kind === 'text') {
                finalText = streamEvent.block.text;
                if (sawDelta) continue;
              } else {
                remoteBlocks.push(streamEvent.block);
              }
              streamEvent.index = blockIndex;
              blockIndex += 1;
            }

            enqueueJson(controller, encoder, streamEvent);
          }
        });

        const supplementalBlocks = dedupeArtifactBlocks(artifactBlocks, remoteBlocks);
        for (const block of supplementalBlocks) {
          enqueueJson(controller, encoder, { type: 'block', index: blockIndex, block });
          blockIndex += 1;
        }

        const answer: AnswerBlock[] = [
          ...(finalText.trim() ? [{ kind: 'text' as const, text: finalText.trim() }] : []),
          ...remoteBlocks,
          ...supplementalBlocks,
        ];
        enqueueJson(controller, encoder, {
          type: 'done',
          answer,
          trace: artifactAnswer.trace,
        });
      } catch (error) {
        const message = error instanceof EveAgentError ? error.safeMessage : 'Eve is unavailable right now.';
        console.error('[eve] portfolio-agent stream failure', error);
        enqueueJson(controller, encoder, { type: 'error', message });
      } finally {
        controller.close();
      }

    },
  });
}

/** Legacy deterministic stream kept for tests and local contract assertions. */
export function createEveAnswerStream(answer: EveAnswer, _config: EveRuntimeConfig): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      enqueueJson(controller, encoder, {
        type: 'ready',
        agent: 'DM',
        trace: answer.trace,
        provider: 'portfolio-site',
      });

      for (const [index, block] of answer.blocks.entries()) {
        enqueueJson(controller, encoder, { type: 'block', index, block });
        await Promise.resolve();
      }

      enqueueJson(controller, encoder, {
        type: 'done',
        answer: answer.blocks,
        trace: answer.trace,
      });
      controller.close();
    },
  });
}

export function isEveToolError(error: unknown): error is EveToolError {
  return error instanceof Error && error.name === 'EveToolError';
}

function enqueueJson(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: EveStreamEvent,
): void {
  controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
}


async function startRemoteSession(
  config: EveRuntimeConfig,
  message: string,
  groundingContext: EveGroundingPacket,
  deps: RemoteDeps,
): Promise<RemoteSession> {
  // Eve 0.11 accepts `clientContext`; keep the visitor message exact and pass
  // canonical grounding as structured context before runtime dispatch.
  const res = await deps.fetch(`${config.agentHost}/eve/v1/session`, {
    method: 'POST',
    headers: await remoteHeaders(config, deps, true),
    body: JSON.stringify({ message, clientContext: groundingContext }),
  });

  if (!res.ok) {
    const body = await safeResponseText(res);
    throw new EveAgentError(
      'agent_session_failed',
      `portfolio-agent session failed: ${res.status} ${body}`,
      'DM could not start a chat session right now.',
    );
  }

  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const sessionId =
    res.headers.get('x-eve-session-id') ||
    (typeof body?.sessionId === 'string' ? body.sessionId : undefined) ||
    (typeof body?.id === 'string' ? body.id : undefined);

  if (!sessionId) {
    throw new EveAgentError(
      'agent_session_missing_id',
      'portfolio-agent did not return a session id',
      'Eve started, but did not return a stream id.',
    );
  }

  return {
    sessionId,
    continuationToken: typeof body?.continuationToken === 'string' ? body.continuationToken : undefined,
  };
}

async function streamRemoteSession(
  config: EveRuntimeConfig,
  sessionId: string,
  deps: RemoteDeps,
  onEvent: (event: RemoteEveEvent) => void,
): Promise<void> {
  const res = await deps.fetch(`${config.agentHost}/eve/v1/session/${encodeURIComponent(sessionId)}/stream`, {
    headers: await remoteHeaders(config, deps, false),
  });

  if (!res.ok || !res.body) {
    const body = await safeResponseText(res);
    throw new EveAgentError(
      'agent_stream_failed',
      `portfolio-agent stream failed: ${res.status} ${body}`,
      'Eve started, but the answer stream failed.',
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const event = parseRemoteEvent(line);
      if (!event) continue;
      onEvent(event);
      if (isRemoteTurnBoundary(event)) {
        await reader.cancel().catch(() => {});
        return;
      }
    }
  }

  if (buffer.trim()) {
    const event = parseRemoteEvent(buffer.trim());
    if (event) onEvent(event);
  }
}

function isRemoteTurnBoundary(event: RemoteEveEvent): boolean {
  return (
    event.type === 'message.completed' ||
    event.type === 'result.completed' ||
    event.type === 'session.waiting' ||
    event.type === 'session.completed' ||
    event.type === 'session.failed' ||
    event.type === 'turn.failed'
  );
}

function transformRemoteEvent(event: RemoteEveEvent): EveStreamEvent[] {
  const events: EveStreamEvent[] = [];

  if (event.type === 'message.appended' && isRecord(event.data)) {
    if (typeof event.data.messageDelta === 'string') {
      events.push({ type: 'text-delta', delta: event.data.messageDelta });
    }
  }

  if (event.type === 'message.completed' && isRecord(event.data)) {
    if (typeof event.data.message === 'string') {
      events.push({ type: 'block', index: 0, block: { kind: 'text', text: event.data.message } });
    }
  }

  if (event.type === 'actions.requested' && isRecord(event.data)) {
    events.push({ type: 'tool', name: 'portfolio-agent', summary: 'requested an action' });
  }

  if (event.type === 'action.result' && isRecord(event.data)) {
    events.push({ type: 'tool', name: 'portfolio-agent', summary: 'received an action result' });
  }

  if (event.type === 'session.failed' || event.type === 'turn.failed') {
    events.push({
      type: 'error',
      message: 'DM hit an error while answering. Try again, or ask a narrower portfolio question.',
    });
  }

  for (const block of extractRemoteAnswerBlocks(event)) {
    events.push({ type: 'block', block });
  }

  return events;
}

function extractRemoteAnswerBlocks(event: RemoteEveEvent): AnswerBlock[] {
  if (!isRecord(event.data)) return [];

  const candidates: unknown[] = [];
  collectAnswerBlockCandidates(event.data, candidates);

  const result = event.data.result;
  if (isRecord(result)) collectAnswerBlockCandidates(result, candidates);

  return candidates
    .map(validateRemoteAnswerBlock)
    .filter((block): block is AnswerBlock => block !== null);
}

function collectAnswerBlockCandidates(data: Record<string, unknown>, candidates: unknown[]): void {
  if (typeof data.kind === 'string') candidates.push(data);
  for (const key of ['answerBlock', 'block'] as const) {
    if (key in data) candidates.push(data[key]);
  }
  for (const key of ['answerBlocks', 'blocks'] as const) {
    const value = data[key];
    if (Array.isArray(value)) candidates.push(...value);
  }
}

function validateRemoteAnswerBlock(value: unknown): AnswerBlock | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;

  try {
    switch (value.kind) {
      case 'text':
        return typeof value.text === 'string' && value.text.trim()
          ? { kind: 'text', text: value.text }
          : null;
      case 'projects': {
        if (!Array.isArray(value.ids) || !value.ids.every((id) => typeof id === 'string')) return null;
        const ids = uniqueStrings(value.ids);
        if (!ids.length) return null;
        assertProjectIds(ids);
        return { kind: 'projects', ids };
      }
      case 'resume': {
        if (!Array.isArray(value.trackIds) || !value.trackIds.every((id) => typeof id === 'string')) return null;
        const trackIds = uniqueStrings(value.trackIds);
        if (!trackIds.length) return null;
        assertResumeTrackIds(trackIds);
        return { kind: 'resume', trackIds };
      }
      case 'contact':
        return { kind: 'contact' };
      case 'links': {
        if (!Array.isArray(value.items)) return null;
        const items: [string, string][] = [];
        for (const item of value.items) {
          if (
            !Array.isArray(item) ||
            item.length !== 2 ||
            typeof item[0] !== 'string' ||
            typeof item[1] !== 'string' ||
            !item[0].trim() ||
            !isSafeRemoteHref(item[1])
          ) {
            return null;
          }
          items.push([item[0].trim(), item[1].trim()]);
        }
        return items.length ? { kind: 'links', items: dedupeLinks(items) } : null;
      }
      default:
        return null;
    }
  } catch (error) {
    if (isEveToolError(error)) return null;
    throw error;
  }
}

function dedupeArtifactBlocks(siteBlocks: ArtifactBlock[], remoteBlocks: AnswerBlock[]): ArtifactBlock[] {
  const seenProjectIds = new Set<string>();
  const seenResumeTrackIds = new Set<string>();
  const seenLinkHrefs = new Set<string>();
  let sawContact = false;

  for (const block of remoteBlocks) {
    if (block.kind === 'projects') block.ids.forEach((id) => seenProjectIds.add(id));
    if (block.kind === 'resume') block.trackIds.forEach((id) => seenResumeTrackIds.add(id));
    if (block.kind === 'contact') sawContact = true;
    if (block.kind === 'links') block.items.forEach(([, href]) => seenLinkHrefs.add(canonicalHref(href)));
  }

  const next: ArtifactBlock[] = [];
  for (const block of siteBlocks) {
    if (block.kind === 'projects') {
      const ids = block.ids.filter((id) => !seenProjectIds.has(id));
      if (ids.length) next.push({ kind: 'projects', ids });
    } else if (block.kind === 'resume') {
      const trackIds = block.trackIds.filter((id) => !seenResumeTrackIds.has(id));
      if (trackIds.length) next.push({ kind: 'resume', trackIds });
    } else if (block.kind === 'contact') {
      if (!sawContact) next.push(block);
    } else if (block.kind === 'links') {
      const items = block.items.filter(([, href]) => !seenLinkHrefs.has(canonicalHref(href)));
      if (items.length) next.push({ kind: 'links', items });
    }
  }
  return next;
}

function isArtifactBlock(block: AnswerBlock): block is ArtifactBlock {
  return block.kind !== 'text';
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      next.push(value);
    }
  }
  return next;
}

function dedupeLinks(items: [string, string][]): [string, string][] {
  const seen = new Set<string>();
  const next: [string, string][] = [];
  for (const item of items) {
    const href = canonicalHref(item[1]);
    if (!seen.has(href)) {
      seen.add(href);
      next.push(item);
    }
  }
  return next;
}

function isSafeRemoteHref(value: string): boolean {
  const href = value.trim();
  if (!href) return false;
  if (href.startsWith('/')) return !href.startsWith('//') && !href.includes('\\');

  try {
    const url = new URL(href);
    return url.protocol === 'https:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
}

function canonicalHref(href: string): string {
  return href.trim();
}

async function remoteHeaders(
  config: EveRuntimeConfig,
  deps: RemoteDeps,
  json: boolean,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Accept: json ? 'application/json' : 'application/x-ndjson',
  };
  if (json) headers['Content-Type'] = 'application/json';
  if (config.bypassSecret) headers['x-vercel-protection-bypass'] = config.bypassSecret;

  if (config.bearerToken) {
    headers.Authorization = `Bearer ${config.bearerToken}`;
  } else if (!config.isLoopback) {
    headers.Authorization = `Bearer ${await deps.getOidcToken()}`;
  }

  return headers;
}

function parseRemoteEvent(line: string): RemoteEveEvent | null {
  let text = line.trim();
  if (!text) return null;
  if (text.startsWith('data:')) text = text.slice(5).trim();
  if (!text || text === '[DONE]') return null;

  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? (parsed as RemoteEveEvent) : null;
  } catch {
    return null;
  }
}

async function safeResponseText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 1000);
  } catch {
    return '<unreadable response>';
  }
}

function fallbackAnswer(text: string): AnswerBlock[] {
  return [
    { kind: 'text', text },
    {
      kind: 'links',
      items: [
        ['Project library', '/library'],
        ['Resume', '/journey'],
        ['Hiring tour', '/hiring'],
      ],
    },
  ];
}

function applyContextBlockPriorities(blocks: AnswerBlock[], context: EveChatContext): AnswerBlock[] {
  let next = blocks;

  const projectIds = context.projectIds;
  if (projectIds?.length) {
    let sawProjectBlock = false;
    next = next.map((block) => {
      if (block.kind !== 'projects') return block;
      sawProjectBlock = true;
      return { kind: 'projects', ids: prioritizeIds(block.ids, projectIds) };
    });
    if (!sawProjectBlock) next = [...next, { kind: 'projects', ids: projectIds }];
  }

  const resumeTrackIds = context.resumeTrackIds;
  if (resumeTrackIds?.length) {
    let sawResumeBlock = false;
    next = next.map((block) => {
      if (block.kind !== 'resume') return block;
      sawResumeBlock = true;
      return { kind: 'resume', trackIds: prioritizeIds(block.trackIds, resumeTrackIds) };
    });
    if (!sawResumeBlock) next = [...next, { kind: 'resume', trackIds: resumeTrackIds }];
  }

  return next;
}

function prioritizeIds(ids: string[], priorityIds: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const id of [...priorityIds, ...ids]) {
    if (!seen.has(id)) {
      seen.add(id);
      next.push(id);
    }
  }
  return next;
}

function matchesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function normalizeAgentHost(host: string): string {
  try {
    const url = new URL(host);
    url.pathname = url.pathname.replace(/\/$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new EveRuntimeConfigError(['EVE_AGENT_HOST(valid URL)']);
  }
}

function isLoopbackHost(host: string): boolean {
  const { hostname } = new URL(host);
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
