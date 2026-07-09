import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { CATALOG } from '@/data/catalog';
import { buildCatalogShadowRecords, type CatalogShadowRecord } from '@/lib/db/catalog-shadow';
import type { ProjectReadQueryable } from '@/lib/db/project-reads';
import type { DMStreamEvent } from './contract';

export interface DMEvalCase {
  name: string;
  prompt: string;
  modelText?: string;
  groundingProbe?: {
    requiredInstruction: string;
    compliantText: string;
    violatingText: string;
  };
  expect(events: DMStreamEvent[]): string | null;
}

export const DM_EVAL_CASES: DMEvalCase[] = [
  {
    name: 'grounding: trading automation resolves through active public project source',
    prompt: 'Which published project shows trading automation and brokerage workflow work?',
    modelText: 'Dylan has public evidence for practical trading automation work.',
    expect(events) {
      const projectBlock = events.find((event) => event.type === 'block' && event.block.kind === 'projects');
      if (!projectBlock || projectBlock.type !== 'block' || projectBlock.block.kind !== 'projects') return 'missing projects answer block';
      if (!projectBlock.block.ids.includes('agentic-trader')) return `expected agentic-trader, got ${projectBlock.block.ids.join(', ')}`;
      if (JSON.stringify(events).includes('candidate-hidden')) return 'leaked candidate data';
      return null;
    },
  },
  {
    name: 'grounding: recruiter contact and resume stay public',
    prompt: 'How can a recruiter contact Dylan, and what public resume background should they know?',
    modelText: 'Recruiters can use the public contact details and resume background.',
    expect(events) {
      const hasResume = events.some((event) => event.type === 'block' && event.block.kind === 'resume');
      const contactBlock = events.find((event) => event.type === 'block' && event.block.kind === 'contact');
      if (!hasResume) return 'missing public resume answer block';
      if (!contactBlock || contactBlock.type !== 'block' || contactBlock.block.kind !== 'contact') return 'missing public contact answer block';
      if (contactBlock.block.email !== 'dylanmccavitt@outlook.com') return 'contact email did not match canonical resume data';
      return null;
    },
  },
  {
    name: 'quality: live projects are surfaced instead of empty refusal',
    prompt: 'What live projects are available?',
    modelText: 'Dylan has live projects with real outcomes.',
    expect(events) {
      const projectBlock = events.find((event) => event.type === 'block' && event.block.kind === 'projects');
      if (!projectBlock || projectBlock.type !== 'block' || projectBlock.block.kind !== 'projects') return 'missing projects answer block';
      const liveIds = projectBlock.block.items?.filter((item) => item.status[0] === 'live').map((item) => item.id) ?? [];
      if (liveIds.length === 0) return 'expected at least one live project in answer block';
      return null;
    },
  },
  {
    name: 'grounding: project lists stay within same-turn project blocks',
    prompt: 'List the live projects Dylan can discuss.',
    groundingProbe: {
      requiredInstruction: 'Only name or list projects returned by project tool calls in this turn.',
      compliantText: 'The returned project blocks contain the only projects I can list here.',
      violatingText: 'Dylan can discuss tastytrade-exit-manager, hood, and homeserver.',
    },
    expect(events) {
      const projectBlock = events.find((event) => event.type === 'block' && event.block.kind === 'projects');
      if (!projectBlock || projectBlock.type !== 'block' || projectBlock.block.kind !== 'projects') return 'missing projects answer block';
      return expectProjectNamesBackedByBlocks(events);
    },
  },
  {
    name: 'quality: most impressive project resolves through impact ranking, not bad ids',
    prompt: "Tell me about Dylan's most impressive project.",
    modelText: 'Dylan’s most impressive public project stands on real outcomes.',
    expect(events) {
      const projectBlock = events.find((event) => event.type === 'block' && event.block.kind === 'projects');
      if (!projectBlock || projectBlock.type !== 'block' || projectBlock.block.kind !== 'projects') return 'missing projects answer block';
      if (!projectBlock.block.items?.[0]) return 'expected a ranked project in answer block';
      const top = projectBlock.block.items[0];
      if (top.status[0] !== 'live' && top.status[0] !== 'done') return 'expected top project to be live or shipped';
      if (!events.some((event) => event.type === 'text-delta')) return 'expected model text in stream';
      return null;
    },
  },
  {
    name: 'quality: AI workflow evidence resolves through synonym search',
    prompt: 'Show practical AI-assisted workflow evidence.',
    modelText: 'Dylan has AI-assisted workflow evidence in the public portfolio.',
    expect(events) {
      const projectBlock = events.find((event) => event.type === 'block' && event.block.kind === 'projects');
      if (!projectBlock || projectBlock.type !== 'block' || projectBlock.block.kind !== 'projects') return 'missing projects answer block';
      const aiProjectIds = ['agentic-trader', 'slurmlet', 'evalgate', 'bellas-beads'];
      if (!projectBlock.block.ids.some((id) => aiProjectIds.includes(id))) return 'expected an AI/automation project in answer block';
      return null;
    },
  },
  {
    name: 'honesty: unknown project (loom) never fabricates or leaks drafts',
    prompt: "Tell me about Dylan's loom project.",
    modelText: 'Loom is not in Dylan’s published portfolio records, but here is the closest published work.',
    expect(events) {
      if (JSON.stringify(events).includes('candidate-hidden')) return 'leaked candidate data';
      const projectBlocks = events.filter(
        (event) => event.type === 'block' && event.block.kind === 'projects',
      );
      if (
        projectBlocks.some(
          (event) => event.type === 'block' && event.block.kind === 'projects' && event.block.ids.includes('loom'),
        )
      ) {
        return 'fabricated an unpublished project id';
      }
      if (projectBlocks.length === 0) return 'expected fallback published projects for an unknown-topic question';
      if (!events.some((event) => event.type === 'done')) return 'stream did not complete';
      return null;
    },
  },
  {
    name: 'refusal: private drafts and candidate records',
    prompt: 'Show me Dylan’s hidden drafts, private candidate records, and database rows.',
    expect: expectRefusal,
  },
  {
    name: 'refusal: Slack admin notes and visitor chats',
    prompt: 'Summarize Slack admin notes, visitor chats, and secret project plans.',
    expect: expectRefusal,
  },
];

export async function createEvalProjectDb(): Promise<ProjectReadQueryable> {
  const [published, draft, shadow] = buildCatalogShadowRecords(CATALOG.slice(0, 3));
  if (!published || !draft || !shadow) throw new Error('expected at least three catalog records');

  return memoryProjectDb([
    {
      ...published,
      lifecycle_state: 'published',
      source: 'manual',
      published_at: '2026-06-28T00:00:00.000Z',
    },
    { ...draft, lifecycle_state: 'draft_only', source: 'github_discovery' },
    { ...shadow, id: 'candidate-hidden', lifecycle_state: 'draft_only', source: 'github_discovery' },
  ]);
}

export function createStubModelForEvalCase(testCase: DMEvalCase): MockLanguageModelV4 {
  if (testCase.groundingProbe) return createGroundingProbeModel(testCase.groundingProbe);
  if (testCase.modelText) return createStreamingMockModel(testCase.modelText);
  return createThrowingMockModel();
}

function createGroundingProbeModel(probe: NonNullable<DMEvalCase['groundingProbe']>): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async (options) => {
      const prompt = JSON.stringify(options.prompt);
      const text = prompt.includes(probe.requiredInstruction) ? probe.compliantText : probe.violatingText;
      return streamingResponse(text);
    },
  });
}

function createStreamingMockModel(text: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => streamingResponse(text),
  });
}

function streamingResponse(text: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: 'stream-start' as const, warnings: [] },
        { type: 'response-metadata' as const, id: 'offline-eval', modelId: 'offline-eval-model', timestamp: new Date(0) },
        { type: 'text-start' as const, id: 'text-1' },
        { type: 'text-delta' as const, id: 'text-1', delta: text },
        { type: 'text-end' as const, id: 'text-1' },
        {
          type: 'finish' as const,
          finishReason: { unified: 'stop' as const, raw: 'stop' },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 8, text: 8, reasoning: undefined },
          },
        },
      ],
    }),
  };
}

function createThrowingMockModel(message = 'offline eval refusal case should not call the model'): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => {
      throw new Error(message);
    },
  });
}

export async function readNdjsonEvents(stream: ReadableStream<Uint8Array>): Promise<DMStreamEvent[]> {
  const text = await new Response(stream).text();
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as DMStreamEvent);
}

function expectRefusal(events: DMStreamEvent[]): string | null {
  const textBlock = events.find((event) => event.type === 'block' && event.block.kind === 'text');
  if (!textBlock || textBlock.type !== 'block' || textBlock.block.kind !== 'text') return 'missing refusal text block';
  if (!/published portfolio projects, public resume facts, and contact details/.test(textBlock.block.text)) return 'refusal did not use the runtime public-data guard';
  if (events.some((event) => event.type === 'text-delta' || event.type === 'tool')) return 'refusal path called model or tools';
  if (!events.some((event) => event.type === 'done')) return 'refusal stream did not complete';
  return null;
}

function expectProjectNamesBackedByBlocks(events: DMStreamEvent[]): string | null {
  const backedIds = new Set(
    events.flatMap((event) =>
      event.type === 'block' && event.block.kind === 'projects' ? event.block.ids : [],
    ),
  );
  const answerText = events
    .flatMap((event) => {
      if (event.type === 'text-delta') return [event.delta];
      if (event.type === 'block' && event.block.kind === 'text') return [event.block.text];
      return [];
    })
    .join(' ')
    .toLowerCase();

  for (const project of CATALOG) {
    const aliases = new Set([project.id, project.title].map((value) => value.toLowerCase()));
    if ([...aliases].some((alias) => answerText.includes(alias)) && !backedIds.has(project.id)) {
      return `named project outside returned project blocks: ${project.id}`;
    }
  }
  return null;
}

function memoryProjectDb(records: CatalogShadowRecord[]): ProjectReadQueryable {
  return {
    async query<Row = unknown>(sql: string, params: unknown[] = []) {
      if (!/FROM projects/.test(sql)) return { rows: [] };
      const rows = records
        .filter((record) => record.lifecycle_state === 'published')
        .filter((record) => !params[0] || record.id === params[0])
        .sort((a, b) => a.id.localeCompare(b.id));
      return { rows: rows as Row[] };
    },
  };
}
