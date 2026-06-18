import { getVercelOidcToken } from '@vercel/oidc';
import {
  assertProjectIds,
  assertResumeTrackIds,
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

  constructor(code: string, message: string, safeMessage = 'Eve is unavailable right now.') {
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
    blocks = fallbackAnswer("Ask me about Dylan's projects, background, trading systems, iOS work, or contact details.");
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
      { kind: 'text', text: 'Yes. The portfolio has two native iOS projects with real product scope:' },
      { kind: 'projects', ids: result.projects.map((project) => project.id) },
    ];
  } else if (matchesAny(normalized, ['trading', 'options', 'broker', 'risk', 'market'])) {
    const result = searchCatalog({ query: 'trading risk broker options', limit: 5 });
    addTrace({
      tool: 'search_catalog',
      input: { query: 'trading risk broker options', limit: 5 },
      resultCount: result.projects.length,
      label: 'search_catalog found trading systems',
    });
    blocks = [
      {
        kind: 'text',
        text: "Trading infrastructure is one of Dylan's strongest areas. The best starting points are live exit automation, portfolio/risk tooling, and the autonomous trading harness.",
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
        text: 'For agent and MCP work, start with the autonomous trader, TradingView MCP, evalgate, and harness-arena.',
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
        text: 'Right now, Dylan is building around agents, trading infrastructure, evaluation, and infrastructure scheduling.',
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
        text: 'The strongest evidence is work with real-world constraints: live options exits, an autonomous trading harness, and shipped client software.',
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
            'I do not have a precise match in the site data for that. I can still help with projects, resume, trading systems, iOS work, agent infrastructure, or contact details.',
          );
  }

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
  const artifactBlocks = artifactAnswer.blocks.filter((block) => block.kind !== 'text');

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let finalText = '';
      let sawDelta = false;

      try {
        const session = await startRemoteSession(config, request.message, runtimeDeps);
        enqueueJson(controller, encoder, {
          type: 'ready',
          agent: 'Eve',
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
          if (!transformed) return;

          if (transformed.type === 'text-delta') {
            sawDelta = true;
            finalText += transformed.delta;
          }
          if (transformed.type === 'block' && transformed.block.kind === 'text') {
            finalText = transformed.block.text;
          }

          enqueueJson(controller, encoder, transformed);
        });

        for (const [index, block] of artifactBlocks.entries()) {
          enqueueJson(controller, encoder, { type: 'block', index, block });
        }

        const answer: AnswerBlock[] = [
          ...(finalText.trim() ? [{ kind: 'text' as const, text: finalText.trim() }] : []),
          ...artifactBlocks,
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

      void sawDelta;
    },
  });
}

/** Legacy deterministic stream kept for tests and local contract assertions. */
export function createEveAnswerStream(answer: EveAnswer, config: EveRuntimeConfig): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      enqueueJson(controller, encoder, {
        type: 'ready',
        agent: 'Eve',
        trace: answer.trace,
        provider: config.agentHost,
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
  deps: RemoteDeps,
): Promise<RemoteSession> {
  const res = await deps.fetch(`${config.agentHost}/eve/v1/session`, {
    method: 'POST',
    headers: await remoteHeaders(config, deps, true),
    body: JSON.stringify({ message }),
  });

  if (!res.ok) {
    const body = await safeResponseText(res);
    throw new EveAgentError(
      'agent_session_failed',
      `portfolio-agent session failed: ${res.status} ${body}`,
      'Eve could not start a chat session right now.',
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
      if (event) onEvent(event);
    }
  }

  if (buffer.trim()) {
    const event = parseRemoteEvent(buffer.trim());
    if (event) onEvent(event);
  }
}

function transformRemoteEvent(event: RemoteEveEvent): EveStreamEvent | null {
  if (event.type === 'message.appended' && isRecord(event.data)) {
    return typeof event.data.messageDelta === 'string'
      ? { type: 'text-delta', delta: event.data.messageDelta }
      : null;
  }

  if (event.type === 'message.completed' && isRecord(event.data)) {
    return typeof event.data.message === 'string'
      ? { type: 'block', index: 0, block: { kind: 'text', text: event.data.message } }
      : null;
  }

  if (event.type === 'actions.requested' && isRecord(event.data)) {
    return { type: 'tool', name: 'portfolio-agent', summary: 'requested an action' };
  }

  if (event.type === 'action.result' && isRecord(event.data)) {
    return { type: 'tool', name: 'portfolio-agent', summary: 'received an action result' };
  }

  if (event.type === 'session.failed' || event.type === 'turn.failed') {
    return {
      type: 'error',
      message: 'Eve hit an error while answering. Try again, or ask a narrower portfolio question.',
    };
  }

  return null;
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
