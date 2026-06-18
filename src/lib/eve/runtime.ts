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
  EveStreamEvent,
  ToolTraceItem,
} from './contract';

export interface EveRuntimeConfig {
  provider: string;
  modelId: string;
  hasGatewayAuth: boolean;
}

export class EveRuntimeConfigError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(`Missing Eve runtime environment: ${missing.join(', ')}`);
    this.name = 'EveRuntimeConfigError';
    this.missing = missing;
  }
}

export function readEveRuntimeConfig(
  env: Partial<Record<string, string | undefined>> = process.env,
): EveRuntimeConfig {
  const provider = env.EVE_PROVIDER?.trim();
  const model = env.EVE_MODEL?.trim();
  const missing: string[] = [];

  if (!provider) missing.push('EVE_PROVIDER');
  if (!model) missing.push('EVE_MODEL');

  if (missing.length > 0) {
    throw new EveRuntimeConfigError(missing);
  }

  return {
    provider: provider as string,
    modelId: resolveModelId(provider as string, model as string),
    hasGatewayAuth: Boolean(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN),
  };
}

export function resolveModelId(provider: string, model: string): string {
  return model.includes('/') ? model : `${provider}/${model}`;
}

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

export function createEveAnswerStream(answer: EveAnswer, config: EveRuntimeConfig): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      enqueueJson(controller, encoder, {
        type: 'ready',
        agent: 'Eve',
        trace: answer.trace,
        provider: config.provider,
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
