import { readFile } from 'node:fs/promises';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';
import {
  projectLinkFromFields,
  projectMetricFromFields,
  projectStackEntryFromFields,
  type ProjectDetailReadModel,
  type ProjectReadQueryable,
} from '@/lib/db/project-reads';
import type { PublishedProjectLoader } from './data-tools';
import type { DMChatRequest, DMStreamEvent } from './contract';

interface DMEvalAnswerPlan {
  claims: Array<{
    text: string;
    evidenceIds: string[];
  }>;
  artifactProjectIds: string[];
}

/** Deterministic unit/benchmark fixture. Never consumed by the release evaluator. */
export interface DMUnitEvalCase {
  name: string;
  prompt: string;
  request?: DMChatRequest;
  modelText?: string;
  answerPlan?: DMEvalAnswerPlan;
  expect(events: DMStreamEvent[]): string | null;
}

export const DM_UNIT_EVAL_CASES: DMUnitEvalCase[] = [
  {
    name: 'routing: fresh unsupported turn stays out of project retrieval',
    prompt: 'What is the weather today?',
    expect(events) {
      return expectNoProjectArtifacts(events, 'fresh unsupported turn');
    },
  },
  {
    name: 'routing: unrelated turn resets after project-focused history',
    prompt: 'What is your favorite color?',
    request: {
      message: 'What is your favorite color?',
      conversation: [
        { role: 'user', content: 'Tell me about Dylan’s projects.' },
        { role: 'assistant', content: 'Loom is a published project.' },
      ],
    },
    expect(events) {
      return expectNoProjectArtifacts(events, 'project-history reset');
    },
  },
  {
    name: 'routing: explicit project coreference resolves only the referenced public project',
    prompt: 'What about its architecture?',
    request: {
      message: 'What about its architecture?',
      conversation: [
        { role: 'user', content: 'Tell me about Loom.' },
        { role: 'assistant', content: 'Loom is a published project.' },
      ],
    },
    answerPlan: {
      claims: [{ text: 'Loom proves that a reviewed project can become visible without entering the static catalog.', evidenceIds: ['loom:identity', 'loom:summary'] }],
      artifactProjectIds: [],
    },
    expect(events) {
      const projectBlock = projectBlockFor(events);
      if (projectBlock) return 'terse coreference repeated a project artifact';
      if (!answerText(events).includes('Loom')) return 'coreference answer omitted Loom';
      return null;
    },
  },
  {
    name: 'directness: Evalgate follow-up answers latest stack question without repeating a card',
    prompt: 'What language is it built with?',
    request: {
      message: 'What language is it built with?',
      conversation: [
        { role: 'user', content: 'Tell me about Evalgate.' },
        { role: 'assistant', content: 'Evalgate tests grounded agent behavior before release.' },
      ],
    },
    answerPlan: {
      claims: [{ text: 'Evalgate is built with TypeScript.', evidenceIds: ['evalgate:identity', 'evalgate:stack:0'] }],
      artifactProjectIds: [],
    },
    expect(events) {
      const done = doneEvent(events);
      if (done?.facts?.projects.map((project) => project.id).join(',') !== 'evalgate') return 'Evalgate subject was not resolved';
      if (!answerText(events).includes('TypeScript')) return 'selected the right project but answered the wrong aspect';
      if (projectBlockFor(events)) return 'terse factual follow-up repeated a project card';
      return null;
    },
  },
  {
    name: 'artifacts: answer plan selects fewer retrieved project artifacts',
    prompt: 'Tell me about Dylan’s projects, but show only one project card.',
    answerPlan: {
      claims: [{ text: 'Agentic / Trader is a scheduled, inspectable trading workflow.', evidenceIds: ['agentic-trader:identity', 'agentic-trader:summary'] }],
      artifactProjectIds: ['agentic-trader'],
    },
    expect(events) {
      const done = doneEvent(events);
      const projectBlock = projectBlockFor(events);
      if (!done || done.facts?.projects.length !== 3) return 'expected representative retrieval set before answer selection';
      if (!projectBlock || projectBlock.ids.length !== 1) return 'answer plan did not limit artifacts to one selected project';
      if (!done.facts?.projects.some((project) => project.id === projectBlock.ids[0])) return 'selected artifact escaped the same-turn fact packet';
      const answer = answerText(events);
      const selectedProject = done.facts.projects.find((project) => project.id === projectBlock.ids[0]);
      if (!selectedProject || !identityTextIncludes(answer, selectedProject.title)) return 'selected artifact did not match the project named in prose';
      const excludedProject = done.facts.projects.find((project) => project.id !== projectBlock.ids[0] && identityTextIncludes(answer, project.title));
      if (excludedProject) return `one-card prose named excluded project ${excludedProject.id}`;
      return null;
    },
  },
  {
    name: 'artifacts: answer plan can select zero project artifacts',
    prompt: 'Tell me about Dylan’s projects without showing any project cards.',
    answerPlan: {
      claims: [
        { text: 'agentic-trader is a scheduled, inspectable trading workflow.', evidenceIds: ['agentic-trader:identity', 'agentic-trader:summary'] },
        { text: 'tastytrade-exit-manager automates exits without opening positions.', evidenceIds: ['exit-manager:identity', 'exit-manager:summary'] },
        { text: 'slurmlet makes compute jobs easier to inspect.', evidenceIds: ['slurmlet:identity', 'slurmlet:summary'] },
      ],
      artifactProjectIds: [],
    },
    expect(events) {
      const done = doneEvent(events);
      if (!done || (done.facts?.projects.length ?? 0) === 0) return 'expected retrieval evidence for zero-artifact selection';
      if (projectBlockFor(events)) return 'retrieval emitted a project artifact despite zero answer selection';
      const artifacts = events.filter((event) => event.type === 'block');
      if (artifacts.length > 0) return `zero-card project answer emitted unrelated artifacts: ${artifacts.map((event) => event.type === 'block' ? event.block.kind : '').join(', ')}`;
      const answer = events.flatMap((event) => event.type === 'text-delta' ? [event.delta] : []).join('');
      for (const project of done.facts?.projects ?? []) {
        if (!answer.includes(project.title)) return `zero-card prose omitted grounded project ${project.id}`;
      }
      if (/could not select a published project/i.test(answer)) return 'answerable zero-card request fell back to a refusal';
      return null;
    },
  },
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
      const answer = answerText(events);
      if (!/Stevens Institute of Technology/.test(answer)) return 'prose omitted a public resume highlight';
      if (!/dylanmccavitt@outlook\.com/.test(answer)) return 'prose omitted the public contact method';
      if (/included below/i.test(answer)) return 'prose only pointed to the structured blocks';
      return null;
    },
  },
  {
    name: 'grounding: public resume single-aspect prose is direct',
    prompt: "What is Dylan's public resume background?",
    expect(events) {
      const answer = answerText(events);
      if (!/software engineering roles/i.test(answer)) return 'resume prose omitted current public role';
      if (!/Stevens Institute of Technology/.test(answer)) return 'resume prose omitted education';
      if (!events.some((event) => event.type === 'block' && event.block.kind === 'resume')) return 'missing public resume answer block';
      return null;
    },
  },
  {
    name: 'grounding: public contact single-aspect prose is direct',
    prompt: 'How can a recruiter contact Dylan?',
    expect(events) {
      const answer = answerText(events);
      if (!/dylanmccavitt@outlook\.com/.test(answer)) return 'contact prose omitted the public email';
      if (!/open to opportunities/i.test(answer)) return 'contact prose omitted public availability';
      if (!events.some((event) => event.type === 'block' && event.block.kind === 'contact')) return 'missing public contact answer block';
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
    expect(events) {
      const projectBlock = events.find((event) => event.type === 'block' && event.block.kind === 'projects');
      if (!projectBlock || projectBlock.type !== 'block' || projectBlock.block.kind !== 'projects') return 'missing projects answer block';
      return expectProjectNamesBackedByBlocks(events);
    },
  },
  {
    name: 'quality: broad project overview stays concise and representative',
    prompt: 'tell me about dylans projects',
    expect(events) {
      const done = events.find((event): event is Extract<DMStreamEvent, { type: 'done' }> => event.type === 'done');
      if (done?.facts?.operation !== 'rankProjects') return `expected ranked overview, got ${done?.facts?.operation ?? 'none'}`;
      if (done.facts.status !== 'partial') return `expected representative subset status, got ${done.facts.status}`;
      if (done.facts.responseMode !== 'representative-overview') return 'missing representative overview response mode';
      if (done.facts.projects.length !== 3) return `expected three representative projects, got ${done.facts.projects.length}`;
      const text = answerText(events);
      if (text.includes('returned fallback records')) return 'broad overview used fallback disclosure';
      if (!text.includes('agentic-trader')) return 'broad project answer omitted selected public facts';
      if (text.length >= 1_000) return `overview was too long at ${text.length} characters`;
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
    answerPlan: {
      claims: [{
        text: 'agentic-trader is reviewable trading automation with a deterministic gate, with a scheduled review session at 15:45 ET.',
        evidenceIds: ['agentic-trader:identity', 'agentic-trader:tagline', 'agentic-trader:metric:0'],
      }],
      artifactProjectIds: ['agentic-trader'],
    },
    expect(events) {
      const projectBlock = events.find((event) => event.type === 'block' && event.block.kind === 'projects');
      if (!projectBlock || projectBlock.type !== 'block' || projectBlock.block.kind !== 'projects') return 'missing projects answer block';
      const aiProjectIds = ['agentic-trader', 'slurmlet', 'evalgate', 'bellas-beads'];
      if (!projectBlock.block.ids.some((id) => aiProjectIds.includes(id))) return 'expected an AI/automation project in answer block';
      const text = answerText(events);
      if (!/scheduled review session at 15:45 ET/i.test(text)) return 'AI workflow answer omitted its selected distinctive metric';
      return null;
    },
  },
  {
    name: 'grounding: newly published DB-only Loom is available without leaking controls',
    prompt: "Tell me about Dylan's loom project.",
    modelText: 'Loom proves the reviewed publish path from a DB-only public record.',
    answerPlan: {
      claims: [{
        text: 'Loom proves that a reviewed project can become visible without entering the static catalog. Its manifest size ceiling is 64 KiB. View repo: https://github.com/DylanMcCavitt/loom.',
        evidenceIds: ['loom:identity', 'loom:summary', 'loom:metric:0', 'loom:link:0'],
      }],
      artifactProjectIds: ['loom'],
    },
    expect(events) {
      if (JSON.stringify(events).includes('candidate-hidden')) return 'leaked candidate data';
      const projectBlocks = events.filter(
        (event) => event.type === 'block' && event.block.kind === 'projects',
      );
      if (!projectBlocks.some(
        (event) => event.type === 'block' && event.block.kind === 'projects' && event.block.ids.includes('loom'),
      )) return 'expected published DB-only loom project';
      const text = answerText(events);
      if (!/manifest size ceiling is 64 KiB/i.test(text)) return 'Loom answer omitted its selected distinctive metric';
      if (!text.includes('https://github.com/DylanMcCavitt/loom')) return 'Loom answer omitted its selected public repository link';
      if (!events.some((event) => event.type === 'done')) return 'stream did not complete';
      return null;
    },
  },
  {
    name: 'grounding: unmatched topic returns no unrelated project records',
    prompt: 'Which project covers quantum cryptography research?',
    modelText: 'unused by the structured project answer plan',
    expect(events) {
      const done = events.find((event): event is Extract<DMStreamEvent, { type: 'done' }> => event.type === 'done');
      if (done?.facts?.status !== 'empty') return `expected empty fact packet, got ${done?.facts?.status ?? 'none'}`;
      if (done.facts.projects.length !== 0) return 'unmatched topic unexpectedly returned project records';
      const text = answerText(events);
      if (!text.includes('did not find a matching published project')) return 'no-match disclosure was missing';
      return expectProjectNamesBackedByBlocks(events);
    },
  },
  {
    name: 'grounding: empty status query emits deterministic no-match answer',
    prompt: 'Which projects are in progress?',
    expect(events) {
      const done = events.find((event): event is Extract<DMStreamEvent, { type: 'done' }> => event.type === 'done');
      if (done?.facts?.status !== 'empty') return `expected empty fact packet, got ${done?.facts?.status ?? 'none'}`;
      if (done.facts.projects.length !== 0) return 'empty packet unexpectedly contained projects';
      if (!answerText(events).includes('did not find a matching published project')) return 'empty deterministic fallback was missing';
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

const CorpusEvidenceSchema = z.strictObject({
  privacyState: z.enum(['safe_public', 'private_allowed_for_draft']),
  text: z.string().min(1),
});
const CorpusProjectSchema = z.strictObject({
  id: z.string().min(1),
  slug: z.string().min(1),
  lifecycleState: z.enum(['published', 'draft_only', 'archived']),
  title: z.string().min(1),
  area: z.string().min(1),
  status: z.tuple([z.enum(['dry', 'live', 'wip', 'done']), z.string()]),
  year: z.number().int(),
  activity: z.string(),
  line: z.string(),
  summary: z.string(),
  wip: z.boolean(),
  money: z.boolean(),
  links: z.array(z.strictObject({ label: z.string(), href: z.string() })),
  metrics: z.array(z.strictObject({ value: z.string(), label: z.string() })),
  about: z.array(z.string()),
  notes: z.array(z.string()),
  stack: z.array(z.strictObject({ label: z.string(), value: z.string() })),
  evidence: z.array(CorpusEvidenceSchema).default([]),
});
const CorpusSchema = z.strictObject({ version: z.literal(1), projects: z.array(CorpusProjectSchema) });

export interface EvalProjectSource {
  db: ProjectReadQueryable;
  projectLoader: PublishedProjectLoader;
  publishedIds: string[];
  controlIds: string[];
  privateEvidenceMarkers: string[];
}

export async function createEvalProjectSource(): Promise<EvalProjectSource> {
  const raw = await readFile(new URL('../../../tests/fixtures/dm-published-corpus.json', import.meta.url), 'utf8');
  const corpus = CorpusSchema.parse(JSON.parse(raw));
  const published = corpus.projects.filter((project) => project.lifecycleState === 'published');
  const controls = corpus.projects.filter((project) => project.lifecycleState !== 'published');
  const models = published.map(corpusProjectModel);
  return {
    db: memoryProjectDb(),
    projectLoader: async () => models,
    publishedIds: published.map((project) => project.id).sort(),
    controlIds: controls.map((project) => project.id).sort(),
    privateEvidenceMarkers: corpus.projects.flatMap((project) =>
      project.evidence.flatMap((evidence) => evidence.privacyState === 'private_allowed_for_draft' ? [evidence.text] : []),
    ),
  };
}

export function createStubModelForUnitEvalCase(testCase: DMUnitEvalCase): MockLanguageModelV4 {
  return testCase.name.startsWith('refusal:') ? createThrowingMockModel() : createPacketAwareMockModel(testCase);
}

function createPacketAwareMockModel(testCase: DMUnitEvalCase): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async (options) => {
      const prompt = JSON.stringify(options.prompt);
      const packet = packetFromPrompt(prompt);
      if (!packet) return streamingResponse(testCase.modelText ?? 'Public resume and contact details are available.');
      if (testCase.answerPlan) return streamingResponse(JSON.stringify(testCase.answerPlan));
      return streamingResponse(JSON.stringify({
        claims: packet.projects.map((project) => evalClaimForProject(project, testCase.prompt)),
        artifactProjectIds: packet.projects.map((project) => project.id),
      }));
    },
  });
}

interface StubPacketProject {
  id: string;
  title: string;
  summary: string;
  status: string;
  stack: Array<{ id: string; label: string; value: string }>;
}

function evalClaimForProject(project: StubPacketProject, prompt: string): { text: string; evidenceIds: string[] } {
  if (/\b(?:status|live|shipped|done|in progress|wip|available)\b/i.test(prompt)) {
    return { text: `${project.title} has status ${project.status}.`, evidenceIds: [`${project.id}:identity`, `${project.id}:status`] };
  }
  if (/\b(?:stack|language|built with|technology|runtime)\b/i.test(prompt) && project.stack[0]) {
    const stack = project.stack[0];
    return { text: `${project.title} uses ${stack.value}.`, evidenceIds: [`${project.id}:identity`, stack.id] };
  }
  return { text: `${project.title} — ${project.summary}`, evidenceIds: [`${project.id}:identity`, `${project.id}:summary`] };
}

function packetFromPrompt(prompt: string): { projects: StubPacketProject[] } | null {
  const marker = 'PROJECT_FACT_PACKET=';
  const start = prompt.indexOf(marker);
  if (start < 0) return null;
  const slice = prompt.slice(start + marker.length);
  const end = slice.indexOf('\\n');
  const encoded = (end >= 0 ? slice.slice(0, end) : slice).replace(/\\"/g, '"');
  try {
    const parsed = JSON.parse(encoded) as { projects?: Array<{ id?: unknown; title?: unknown; summary?: unknown; status?: unknown; stack?: unknown }> };
    if (!Array.isArray(parsed.projects)) return null;
    return {
      projects: parsed.projects.flatMap((project) => typeof project.id === 'string'
        ? [{
            id: project.id,
            title: typeof project.title === 'string' ? project.title : project.id,
            summary: typeof project.summary === 'string' ? project.summary : 'Published project.',
            status: Array.isArray(project.status) ? project.status.map(String).filter(Boolean).join(' / ') : 'published',
            stack: Array.isArray(project.stack) ? project.stack.flatMap((entry) => {
              if (!entry || typeof entry !== 'object') return [];
              const value = entry as { id?: unknown; label?: unknown; value?: unknown };
              return typeof value.id === 'string' && typeof value.value === 'string'
                ? [{ id: value.id, label: String(value.label ?? 'Stack'), value: value.value }]
                : [];
            }) : [],
          }]
        : []),
    };
  } catch {
    return null;
  }
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
  const text = answerText(events).toLowerCase();

  for (const project of EVAL_PROJECT_IDENTITIES) {
    if (project.aliases.some((alias) => text.includes(alias)) && !backedIds.has(project.id)) {
      return `named project outside returned project blocks: ${project.id}`;
    }
  }
  return null;
}

function expectNoProjectArtifacts(events: DMStreamEvent[], label: string): string | null {
  const done = doneEvent(events);
  if (done?.facts?.operation !== 'none') return `${label} unexpectedly retrieved projects`;
  if (projectBlockFor(events)) return `${label} emitted project artifacts`;
  return null;
}

function projectBlockFor(events: DMStreamEvent[]): Extract<DMStreamEvent, { type: 'block' }>['block'] & { kind: 'projects' } | null {
  const event = events.find((candidate) => candidate.type === 'block' && candidate.block.kind === 'projects');
  return event?.type === 'block' && event.block.kind === 'projects' ? event.block : null;
}

function doneEvent(events: DMStreamEvent[]): Extract<DMStreamEvent, { type: 'done' }> | null {
  return events.find((event): event is Extract<DMStreamEvent, { type: 'done' }> => event.type === 'done') ?? null;
}

function answerText(events: DMStreamEvent[]): string {
  return events
    .flatMap((event) => {
      if (event.type === 'text-delta') return [event.delta];
      if (event.type === 'block' && event.block.kind === 'text') return [event.block.text];
      return [];
    })
    .join(' ');
}

function identityTextIncludes(text: string, identity: string): boolean {
  const normalizedText = ` ${normalizeIdentityText(text)} `;
  const normalizedIdentity = normalizeIdentityText(identity);
  return normalizedIdentity.length > 1 && normalizedText.includes(` ${normalizedIdentity} `);
}

function normalizeIdentityText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const EVAL_PROJECT_IDENTITIES = [
  { id: 'agentic-trader', aliases: ['agentic-trader'] },
  { id: 'exit-manager', aliases: ['exit-manager', 'tastytrade-exit-manager'] },
  { id: 'slurmlet', aliases: ['slurmlet'] },
  { id: 'loom', aliases: ['loom'] },
  { id: 'draft-control', aliases: ['synthetic draft control', 'draft-control'] },
  { id: 'candidate-hidden', aliases: ['synthetic candidate control', 'candidate-hidden'] },
  { id: 'archived-control', aliases: ['synthetic archived control', 'archived-control'] },
];

function memoryProjectDb(): ProjectReadQueryable {
  return {
    async query<Row = unknown>() {
      return { rows: [] as Row[] };
    },
  };
}

function corpusProjectModel(project: z.infer<typeof CorpusProjectSchema>): ProjectDetailReadModel {
  const href = `/projects/${project.slug}`;
  const links = project.links.map(projectLinkFromFields);
  const metrics = project.metrics.map(projectMetricFromFields);
  const stack = project.stack.map(projectStackEntryFromFields);
  return {
    id: project.id,
    slug: project.slug,
    href,
    title: project.title,
    area: project.area as ProjectDetailReadModel['area'],
    status: project.status,
    year: project.year,
    activity: project.activity,
    hue: '#8b7cf6',
    line: project.line,
    summary: project.summary,
    seek: { from: 'Reviewed', to: 'Published', pct: 100 },
    links,
    metrics,
    about: project.about,
    notes: project.notes,
    stack,
    shots: [],
    wip: project.wip,
    money: project.money,
    source: 'test_seed',
    seo: { title: `${project.title} · Dylan McCavitt`, description: project.summary, ogImage: `/og/projects/${project.slug}.png`, sitemapPath: `${href}/` },
    dmArtifact: {
      kind: 'project', id: project.id, slug: project.slug, title: project.title,
      area: project.area as ProjectDetailReadModel['area'], status: project.status, year: project.year,
      activity: project.activity, line: project.line, href, wip: project.wip, money: project.money,
      links, metrics, about: project.about, notes: project.notes, stack, source: 'portfolio-db',
    },
  };
}
