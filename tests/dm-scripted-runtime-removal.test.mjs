import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  FORBIDDEN_TOKENS,
  REMOVAL_CLAIM_ID,
  REMOVAL_CLAIM_STATEMENT,
  checkScriptedRuntimeRemoval,
  finalizationBoundaryFailures,
} from '../scripts/check-dm-scripted-runtime-removed.mjs';

const PROJECT_DRAFT_TOKEN = 'ProjectDraft';
const CHAT_STREAM_TOKEN = 'createDMChatStream';
const READ_NDJSON_TOKEN = 'readNdjson';
const NDJSON_MEDIA_TYPE = 'application/x-ndjson';
const GOVERNANCE_CLAIM_ID = 'dm-v2-validator-governance';
const GOVERNANCE_CLAIM_STATEMENT = 'DM v2 runtime finalization is limited to documented structural, same-run provenance, source, integrity, and operational controls; behavior quality stays in prompts, approved public content, and evaluations';

const GOVERNANCE_DOCUMENT_FIXTURES = {
  'docs/agents/dm-validator-governance.md': `# DM v2 validator governance

## Hard-control allowlist

- strict bounded schema types and sizes;
- current-run provenance by filtering unknown evidence ids;
- deterministic exclusion of forbidden/private sources and tools;
- exact streamed-prose/finalizer integrity;

## Behavior stays out of runtime rejection

Runtime code must not reject, rewrite, force, or gate v2 prose.

The public source boundary remains hard: published database projects, approved
public RAG sources, and canonical résumé/contact data only. Semantic privacy
quality is evaluated; private-source exclusion is deterministic.

## Exception evidence

## Implementation and review checklist
`,
  'docs/agents/dm-evals.md': `[validator-governance rule](./dm-validator-governance.md):
prompt/content/eval judgments rather than runtime rejection
rules. Published DB projects, approved public RAG sources, canonical
résumé/contact data, semantic privacy judgment, and deterministic private-source
exclusion remain mandatory.
`,
  'docs/agents/scope-ledger.md': '[`docs/agents/dm-validator-governance.md`](./dm-validator-governance.md): hard\ncontrols protect structure, same-run provenance, private-source exclusion, and\noperations, while answer quality and semantic privacy wording remain evaluated\nbehavior. The rule does not weaken the published-project, approved-public-RAG,\nor canonical résumé/contact source boundary above.\n',
};

const CLEAN_RUNTIME_FIXTURE = `
import { ToolLoopAgent, createUIMessageStream, createUIMessageStreamResponse, toUIMessageStream, tool } from 'ai';
import { z } from 'zod';
import { createDMMetricsRecorder } from './metrics';
function readDMRuntimeConfig(env) {
  const configuredContract = env.DM_CONTRACT?.trim();
  const contract: DMContractVersion = configuredContract === 'v2' ? 'v2' : 'v1';
  if (configuredContract && configuredContract !== 'v1' && configuredContract !== 'v2') throw new Error('DM_CONTRACT');
  const provider = 'openai';
  const model = 'test';
  return { provider, model: model as string, contract };
}
const ConversationalActSchema = {};
const LimitationCodeSchema = {};
const FollowUpCodeSchema = {};
const ArtifactReferenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('project'), id: z.string().trim().min(1).max(200) }),
  z.strictObject({ kind: z.literal('resume'), id: z.string().trim().min(1).max(200) }),
  z.strictObject({ kind: z.literal('contact'), id: z.literal('contact') }),
  z.strictObject({ kind: z.literal('evidence'), id: z.string().trim().min(1).max(200) }),
  z.strictObject({ kind: z.literal('links'), id: z.string().trim().min(1).max(200) }),
]);
const MAX_FINALIZATION_ARTIFACTS = 8;
const FINALIZATION_ENUM_COPY = {
  conversational: {},
  limitation: {},
  followUp: {},
};
const AnswerSegmentInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('factual'), text: z.string(), evidenceIds: z.array(z.string()) }),
  z.strictObject({ kind: z.literal('conversational'), act: ConversationalActSchema }),
  z.strictObject({ kind: z.literal('limitation'), code: LimitationCodeSchema }),
]);
const FinalAnswerInputSchema = z.strictObject({
  segments: z.array(AnswerSegmentInputSchema),
  artifacts: z.array(ArtifactReferenceSchema).max(MAX_FINALIZATION_ARTIFACTS),
  limitations: z.array(LimitationCodeSchema).max(4),
  followUp: FollowUpCodeSchema.optional(),
});
const V2FinalAnswerInputSchema = z.strictObject({
  markdown: z.string().min(1).max(6_000).refine((value) => value.trim().length > 0),
  evidenceIds: z.array(z.string().trim().min(1).max(240)).max(32),
  artifacts: z.array(ArtifactReferenceSchema).max(MAX_FINALIZATION_ARTIFACTS),
  followUp: z.string().trim().min(1).max(600).optional(),
});
const FORBIDDEN_SOURCE_INSTRUCTION = 'Never claim access to Slack, admin drafts, candidate evidence, private notes, visitor history, credentials, hidden projects, or unpublished records. Those sources and tools do not exist here.';
const DM_BASE_SYSTEM_INSTRUCTIONS = [FORBIDDEN_SOURCE_INSTRUCTION];
const DM_V2_SYSTEM_INSTRUCTIONS = [
  FORBIDDEN_SOURCE_INSTRUCTION,
  'Emit markdown through the standard response text stream and ensure finalizeAnswer exactly equals that streamed text.',
  'The finalizer is an integrity echo, not a second answer.',
];
const MAX_V2_PROSE_CODE_UNITS = 6_000;
type V2TextChunk = Extract<UIMessageChunk, {
  type: 'text-start' | 'text-delta' | 'text-end';
}>;
interface BoundedV2Prose {
  readonly text: string;
  readonly failed: boolean;
  forward(chunk: V2TextChunk, write: (chunk: UIMessageChunk) => void): boolean;
  close(write: (chunk: UIMessageChunk) => void): void;
}
function isV2TextChunk(chunk: UIMessageChunk): chunk is V2TextChunk {
  return chunk.type === 'text-start' || chunk.type === 'text-delta' || chunk.type === 'text-end';
}
function createBoundedV2Prose(): BoundedV2Prose {
  const sourceOpen = new Set<string>();
  const forwardedOpen = new Set<string>();
  const pendingHighSurrogate = new Map<string, string>();
  let text = '';
  let failed = false;

  const fail = (): void => {
    failed = true;
  };

  const forward = (chunk: V2TextChunk, write: (chunk: UIMessageChunk) => void): boolean => {
    if (chunk.type === 'text-start') {
      if (sourceOpen.has(chunk.id)) fail();
      else sourceOpen.add(chunk.id);
      return false;
    }

    if (!sourceOpen.has(chunk.id)) {
      fail();
      return false;
    }

    if (chunk.type === 'text-end') {
      if (pendingHighSurrogate.has(chunk.id)) fail();
      pendingHighSurrogate.delete(chunk.id);
      sourceOpen.delete(chunk.id);
      if (forwardedOpen.delete(chunk.id)) {
        write({ type: 'text-end', id: chunk.id });
      }
      return false;
    }

    if (failed || chunk.delta.length === 0) return false;
    const combined = \`\${pendingHighSurrogate.get(chunk.id) ?? ''}\${chunk.delta}\`;
    pendingHighSurrogate.delete(chunk.id);
    const bounded = takeBoundedCompleteCodePoints(combined, MAX_V2_PROSE_CODE_UNITS - text.length);
    if (bounded.pendingHighSurrogate) pendingHighSurrogate.set(chunk.id, bounded.pendingHighSurrogate);
    if (bounded.invalid || bounded.overflow) fail();
    if (!bounded.text) return false;
    if (!forwardedOpen.has(chunk.id)) {
      forwardedOpen.add(chunk.id);
      write({ type: 'text-start', id: chunk.id });
    }
    text += bounded.text;
    write({ type: 'text-delta', id: chunk.id, delta: bounded.text });
    return true;
  };

  return {
    get text() {
      return text;
    },
    get failed() {
      return failed;
    },
    forward,
    close(write) {
      if (sourceOpen.size > 0 || pendingHighSurrogate.size > 0) fail();
      for (const id of forwardedOpen) write({ type: 'text-end', id });
      sourceOpen.clear();
      forwardedOpen.clear();
      pendingHighSurrogate.clear();
    },
  };
}
function takeBoundedCompleteCodePoints(
  input: string,
  remainingCodeUnits: number,
): { text: string; pendingHighSurrogate: string; overflow: boolean; invalid: boolean } {
  let accepted = '';
  let pendingHighSurrogate = '';
  let overflow = false;
  let invalid = false;
  for (let index = 0; index < input.length;) {
    const first = input.charCodeAt(index);
    let point = input[index] as string;
    let width = 1;
    if (first >= 0xD800 && first <= 0xDBFF) {
      if (index + 1 >= input.length) {
        pendingHighSurrogate = point;
        break;
      }
      const second = input.charCodeAt(index + 1);
      if (second < 0xDC00 || second > 0xDFFF) {
        invalid = true;
        break;
      }
      point += input[index + 1];
      width = 2;
    } else if (first >= 0xDC00 && first <= 0xDFFF) {
      invalid = true;
      break;
    }
    if (accepted.length + width > remainingCodeUnits) {
      overflow = true;
      break;
    }
    accepted += point;
    index += width;
  }
  return { text: accepted, pendingHighSurrogate, overflow, invalid };
}
function createDMChatResponse(request, config = {}) {
  const contract = config.contract ?? 'v1';
  const metrics = createDMMetricsRecorder({});
  const v2Prose = createBoundedV2Prose();
  const publicRun = {};
  const artifacts = {};
  const siteBrief = {};
  let finalizationResult = null;
  let finalizationAttempts = 0;
  let finalized = false;
  const agentTools = contract === 'v2'
    ? {
        finalizeAnswer: tool({
          description: 'Submit the complete visitor-facing markdown.',
          inputSchema: V2FinalAnswerInputSchema,
          execute: async (input) => {
            await publicToolGate.waitForIdle();
            if (finalizationResult) return finalizationResult;
            finalizationAttempts += 1;
            finalized = true;
            finalizationResult = {
              status: 'accepted',
              answer: resolveV2FinalAnswer(input, publicRun, artifacts),
              repairAttempted: false,
            };
            return finalizationResult;
          },
        }),
      }
    : {
        finalizeAnswer: tool({
          description: 'Submit the complete structured visitor answer.',
          inputSchema: FinalAnswerInputSchema,
          execute: (input) => {
            if (finalizationResult) return finalizationResult;
            const validation = validateFinalAnswer(input, publicRun, artifacts);
            if (validation.ok) {
              finalizationResult = {
                status: 'accepted',
                answer: validation.answer,
                repairAttempted: finalizationAttempts > 1,
              };
              return finalizationResult;
            }
            finalizationResult = limitedResult(true);
            return finalizationResult;
          },
        }),
      };
  const stream = createUIMessageStream({
    onError(error) {
      if (abort.signal.aborted) metrics.setErrorCategory(abort.timedOut() ? 'timeout' : 'aborted');
      metrics.error('unknown');
      return safeErrorMessage(error);
    },
    async execute({ writer }) {
      metrics.modelStarted();
      for (const chunk of []) {
        if (contract === 'v2' && isV2TextChunk(chunk)) {
          v2Prose.forward(chunk, (forwardedChunk) => writer.write(forwardedChunk));
        }
        writer.write({
          type: 'tool-input-start',
          toolCallId: chunk.toolCallId,
          toolName: 'finalizeAnswer',
        });
        writer.write(chunk as UIMessageChunk);
        metrics.visibleOutput();
      }
      const category = 'unknown';
      metrics.setErrorCategory(category);
      metrics.visibleOutput();
      if (abort.signal.aborted) {
        v2Prose.close((chunk) => writer.write(chunk));
        writer.write({ type: 'error', errorText: 'DM took too long to answer. Please try again.' });
        writer.write({ type: 'finish' });
        metrics.setErrorCategory(abort.timedOut() ? 'timeout' : 'aborted');
        metrics.finish(abort.timedOut() ? 'timeout' : 'aborted');
      }
      if (streamFailed) {
        v2Prose.close((chunk) => writer.write(chunk));
        writer.write({ type: 'finish' });
        metrics.error('unknown');
      }
      if (abort.signal.aborted) {
        v2Prose.close((chunk) => writer.write(chunk));
        metrics.setErrorCategory(abort.timedOut() ? 'timeout' : 'aborted');
        metrics.finish(abort.timedOut() ? 'timeout' : 'aborted');
        writer.write({ type: 'error', errorText: 'DM took too long to answer. Please try again.' });
        writer.write({ type: 'finish' });
      }
      {
        const error = new Error('fixture');
        metrics.error('unknown');
        v2Prose.close((chunk) => writer.write(chunk));
        writer.write({ type: 'error', errorText: safeErrorMessage(error) });
        writer.write({ type: 'finish' });
      }
      finalizationResult ??= limitedResult(finalizationAttempts > 0);
      if (contract === 'v2') {
        v2Prose.close((chunk) => writer.write(chunk));
        const terminalMarkdown = finalizationResult.status === 'accepted'
          && finalizationResult.answer.segments.length === 1
          ? finalizationResult.answer.segments[0]?.text
          : null;
        if (v2Prose.failed || terminalMarkdown !== v2Prose.text) {
          const evidence = publicRun.evidenceLedger.snapshot();
          metrics.setSource(sourceMode(evidence.map((item) => item.source)), evidence.length, true);
          metrics.setUsage(inputTokens, outputTokens);
          metrics.setErrorCategory('finalization_validation');
          writer.write({
            type: 'error',
            errorText: 'DM could not safely finish this answer. Please try again.',
          });
          writer.write({ type: 'finish' });
          metrics.error('finalization_validation');
          return;
        }
      }
      if (
        finalizationResult.status === 'limited'
        && (finalizationAttempts > 0 || v2FinalizationValidationFailed)
      ) {
        metrics.setErrorCategory('finalization_validation');
      }
      const evidence = publicRun.evidenceLedger.snapshot();
      metrics.setSource(sourceMode(evidence.map((item) => item.source)), evidence.length, finalizationResult.status === 'limited');
      metrics.setUsage(inputTokens, outputTokens);
      writer.write({ type: 'data-dm-answer', data: finalizationResult });
      if (contract === 'v1') metrics.visibleOutput();
      writer.write({ type: 'finish' });
      metrics.finish('completed');
    },
  });
  new ToolLoopAgent({
    instructions: buildDMSystemInstructions(siteBrief, contract),
    tools: agentTools,
    experimental_repairToolCall: async ({ toolCall }) => {
      if (toolCall.toolName !== 'finalizeAnswer' || finalizationResult) return null;
      if (contract === 'v2') {
        finalized = true;
        return null;
      }
      finalizationAttempts += 1;
      return null;
    },
  });
  toUIMessageStream({
    stream: {},
    tools: agentTools,
  });
  createPublicAgentTools();
  return createUIMessageStreamResponse({ stream });
}
function resolveV2FinalAnswer(input, run, artifacts) {
  const evidenceIds = [...new Set(input.evidenceIds)].filter((id) => run.evidenceLedger.has(id));
  const artifactReferences = deduplicateArtifactReferences(input.artifacts)
    .filter((reference) => artifactAvailable(reference, artifacts));
  return {
    segments: [{ text: input.markdown, evidenceIds, evidence: run.evidenceLedger.resolve(evidenceIds) }],
    artifacts: artifactReferences.flatMap((reference) => resolveArtifact(reference, artifacts)),
    limitations: [],
    ...(input.followUp ? { followUp: input.followUp } : {}),
  };
}
function deduplicateArtifactReferences(references: ArtifactReference[]): ArtifactReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = \`\${reference.kind}:\${reference.id}\`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  return project ? [{ kind: 'links', id: \`links:\${project.id}\`, projectId: project.id, items: project.links }] : [];
}
function validateFinalAnswer(input, run, artifacts) {
  const segments = input.segments.map((segment) => {
    if (segment.kind === 'conversational') return FINALIZATION_ENUM_COPY.conversational[segment.act];
    if (segment.kind === 'limitation') return FINALIZATION_ENUM_COPY.limitation[segment.code];
    return run.resolve(segment.evidenceIds);
  });
  const limitations = input.limitations.map((code) => FINALIZATION_ENUM_COPY.limitation[code]);
  const followUp = input.followUp ? FINALIZATION_ENUM_COPY.followUp[input.followUp] : undefined;
  return { segments, limitations, followUp, artifacts };
}
function limitedResult(repairAttempted) {
  return { status: 'limited', repairAttempted };
}
function buildDMSystemInstructions(siteBrief, contract) {
  return [contract, siteBrief].join('');
}
`;

for (const token of [PROJECT_DRAFT_TOKEN, CHAT_STREAM_TOKEN, READ_NDJSON_TOKEN, NDJSON_MEDIA_TYPE]) {
  assert.ok(FORBIDDEN_TOKENS.includes(token));
}

async function writeFixtureFile(root, path, contents) {
  const absolutePath = join(root, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}

async function createCleanFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dm-scripted-runtime-removal-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  await Promise.all([
    writeFixtureFile(
      root,
      'src/lib/dm/runtime.ts',
      CLEAN_RUNTIME_FIXTURE,
    ),
    writeFixtureFile(root, 'claims.json', `${JSON.stringify({
      claims: [{ id: REMOVAL_CLAIM_ID, statement: REMOVAL_CLAIM_STATEMENT }, {
        id: GOVERNANCE_CLAIM_ID,
        statement: GOVERNANCE_CLAIM_STATEMENT,
        subjectRefs: [
          'docs/agents/dm-validator-governance.md',
          'docs/agents/dm-evals.md',
          'docs/agents/scope-ledger.md',
          'src/lib/dm/runtime.ts',
          'scripts/check-dm-scripted-runtime-removed.mjs',
          'tests/dm-scripted-runtime-removal.test.mjs',
        ],
      }],
    })}\n`),
    ...Object.entries(GOVERNANCE_DOCUMENT_FIXTURES).map(([path, contents]) => (
      writeFixtureFile(root, path, contents)
    )),
    writeFixtureFile(root, 'src/pages/api/dm/chat.ts', 'export const POST = true;\n'),
    writeFixtureFile(root, 'src/scripts/dm.ts', 'new DefaultChatTransport();\n'),
    writeFixtureFile(root, 'scripts/dm-eval.ts', 'export const liveEval = true;\n'),
    writeFixtureFile(
      root,
      'scripts/check-dm-scripted-runtime-removed.mjs',
      `export const definitions = ${JSON.stringify(FORBIDDEN_TOKENS)};\n`,
    ),
    writeFixtureFile(root, 'dist/client/_astro/dm.js', 'export const client = true;\n'),
    writeFixtureFile(root, '.vercel/output/_functions/chunks/chat.mjs', 'export const server = true;\n'),
    writeFixtureFile(root, '.vercel/output/static/_astro/dm.js', 'export const client = true;\n'),
    writeFixtureFile(root, '.vercel/output/config.json', '{}\n'),
  ]);

  return root;
}

async function mutateRuntime(root, transform) {
  const path = join(root, 'src/lib/dm/runtime.ts');
  const runtime = await readFile(path, 'utf8');
  await writeFile(path, transform(runtime));
}

async function liveRuntimeSource() {
  return readFile(join(import.meta.dirname, '../src/lib/dm/runtime.ts'), 'utf8');
}

function assertStreamSinkMutationRejected(runtime) {
  assert.ok(finalizationBoundaryFailures(runtime).includes(
    'src/lib/dm/runtime.ts: UI stream writer and metrics sinks must remain closed over approved completion paths',
  ));
}

function replaceLast(text, needle, replacement) {
  const index = text.lastIndexOf(needle);
  assert.notEqual(index, -1, `missing replacement target: ${needle}`);
  return `${text.slice(0, index)}${replacement}${text.slice(index + needle.length)}`;
}

test('the live runtime satisfies the finalization boundary proof', async () => {
  assert.deepEqual(finalizationBoundaryFailures(await liveRuntimeSource()), []);
});

test('detects forbidden tokens moved anywhere under each runtime-facing source root', async (t) => {
  const cases = [
    ['src/lib/dm/nested/legacy.ts', PROJECT_DRAFT_TOKEN],
    ['src/pages/api/dm/legacy.ts', NDJSON_MEDIA_TYPE],
    ['src/scripts/dm-legacy.ts', READ_NDJSON_TOKEN],
    ['scripts/nested/dm-legacy.mjs', CHAT_STREAM_TOKEN],
  ];

  for (const [path, token] of cases) {
    await t.test(path, async (subtest) => {
      const root = await createCleanFixture(subtest);
      await writeFixtureFile(root, path, `export const legacy = ${JSON.stringify(token)};\n`);

      const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
      assert.ok(result.failures.includes(`${path}: forbidden scripted-runtime token ${token}`));
    });
  }
});

test('requires and scans generated Astro and Vercel output', async (t) => {
  await t.test('missing build output fails closed', async (subtest) => {
    const root = await createCleanFixture(subtest);
    await rm(join(root, 'dist'), { recursive: true });

    const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
    assert.ok(result.failures.some((failure) => failure.startsWith('dist: required scan root is missing')));
  });

  for (const path of [
    'dist/client/_astro/moved-dm.js',
    '.vercel/output/_functions/chunks/moved-dm.mjs',
  ]) {
    await t.test(path, async (subtest) => {
      const root = await createCleanFixture(subtest);
      const token = NDJSON_MEDIA_TYPE;
      await writeFixtureFile(root, path, `export const legacy = ${JSON.stringify(token)};\n`);

      const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
      assert.ok(result.failures.includes(`${path}: forbidden scripted-runtime token ${token}`));
    });
  }
});

test('excludes only the checker definitions while scanning adjacent scripts', async (t) => {
  const root = await createCleanFixture(t);
  const cleanResult = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.deepEqual(cleanResult.failures, []);

  const copiedChecker = 'scripts/check-dm-scripted-runtime-removed-copy.mjs';
  const token = PROJECT_DRAFT_TOKEN;
  await writeFixtureFile(root, copiedChecker, `export const definition = ${JSON.stringify(token)};\n`);

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(`${copiedChecker}: forbidden scripted-runtime token ${token}`));
});

test('requires the truthful replacement claim and rejects the superseded identity', async (t) => {
  const root = await createCleanFixture(t);
  await writeFixtureFile(root, 'claims.json', `${JSON.stringify({
    claims: [{
      id: 'dm-removed-scripted-runtime',
      statement: 'the scripted DM router, planner, deterministic answer paths, fake trace, canned answer fixtures, and custom NDJSON protocol are absent',
    }, {
      id: 'dm-legacy-scripted-runtime-removed',
      statement: 'superseded v1-only finalization claim',
    }],
  })}\n`);

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(`claims.json: missing ${REMOVAL_CLAIM_ID} claim`));
  assert.ok(result.failures.includes('claims.json: superseded dm-removed-scripted-runtime claim must not remain active'));
  assert.ok(result.failures.includes('claims.json: superseded dm-legacy-scripted-runtime-removed claim must not remain active'));
});

test('rejects missing canonical v2 governance prose and cross-document links', async (t) => {
  await t.test('rule contract anchor', async (subtest) => {
    const root = await createCleanFixture(subtest);
    await writeFixtureFile(
      root,
      'docs/agents/dm-validator-governance.md',
      GOVERNANCE_DOCUMENT_FIXTURES['docs/agents/dm-validator-governance.md'].replace(
        'Runtime code must not reject, rewrite, force, or gate v2 prose.',
        'Runtime code may edit v2 prose for quality.',
      ),
    );

    const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
    assert.ok(result.failures.includes(
      'docs/agents/dm-validator-governance.md: missing canonical DM v2 governance anchor "Runtime code must not reject, rewrite, force, or gate v2 prose"',
    ));
  });

  await t.test('evaluation link', async (subtest) => {
    const root = await createCleanFixture(subtest);
    await writeFixtureFile(
      root,
      'docs/agents/dm-evals.md',
      GOVERNANCE_DOCUMENT_FIXTURES['docs/agents/dm-evals.md'].replace(
        '[validator-governance rule](./dm-validator-governance.md)',
        'validator governance is documented elsewhere',
      ),
    );

    const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
    assert.ok(result.failures.includes(
      'docs/agents/dm-evals.md: missing canonical DM v2 governance anchor "[validator-governance rule](./dm-validator-governance.md)"',
    ));
  });

  await t.test('scope link', async (subtest) => {
    const root = await createCleanFixture(subtest);
    await writeFixtureFile(
      root,
      'docs/agents/scope-ledger.md',
      GOVERNANCE_DOCUMENT_FIXTURES['docs/agents/scope-ledger.md'].replace(
        '[`docs/agents/dm-validator-governance.md`](./dm-validator-governance.md)',
        'DM v2 governance',
      ),
    );

    const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
    assert.ok(result.failures.includes(
      'docs/agents/scope-ledger.md: missing canonical DM v2 governance anchor "[`docs/agents/dm-validator-governance.md`](./dm-validator-governance.md)"',
    ));
  });
});

test('requires the v1-default fail-closed contract selector', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    "config.contract ?? 'v1'",
    "config.contract ?? 'v2'",
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: the selected contract must control both finalization and system instructions',
  ));
});

test('rejects an unbounded v2 prose schema', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'markdown: z.string().min(1).max(6_000).refine((value) => value.trim().length > 0)',
    'markdown: z.string().min(1).max(60_000).refine((value) => value.trim().length > 0)',
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: v2 finalization field markdown must remain z.string().min(1).max(6_000).refine((value) => value.trim().length > 0)',
  ));
});

test('rejects forwarding raw v2 deltas instead of bounded canonical prose', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    "write({ type: 'text-delta', id: chunk.id, delta: bounded.text });",
    "write({ type: 'text-delta', id: chunk.id, delta: chunk.delta });",
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: v2 prose emission must remain Unicode-safe, bounded, and canonical',
  ));
});

test('rejects forged v2 emitted prose that diverges from the accumulator', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    "write({ type: 'text-delta', id: chunk.id, delta: bounded.text });",
    "write({ type: 'text-delta', id: chunk.id, delta: `FORGED:${bounded.text}` });",
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: v2 prose emission must remain Unicode-safe, bounded, and canonical',
  ));
});

test('rejects widening the v2 prose wire bound beyond the schema bound', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'const MAX_V2_PROSE_CODE_UNITS = 6_000;',
    'const MAX_V2_PROSE_CODE_UNITS = 60_000;',
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: v2 prose emission must remain Unicode-safe, bounded, and canonical',
  ));
});

test('rejects accepting invalid Unicode in the bounded v2 prose stream', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'if (bounded.invalid || bounded.overflow) fail();',
    'if (bounded.overflow) fail();',
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: v2 prose emission must remain Unicode-safe, bounded, and canonical',
  ));
});

test('rejects replacement of the UI stream writer sink that forges bounded text', async () => {
  const runtime = await liveRuntimeSource();
  const mutated = runtime.replace(
    '    async execute({ writer }) {\n      try {',
    `    async execute({ writer }) {
      const sink = writer;
      const sdkWrite = sink.write.bind(sink);
      Object.defineProperty(sink, 'write', {
        value: (chunk: UIMessageChunk) => {
          if (chunk.type === 'text-delta') chunk.delta = \`FORGED:\${chunk.delta}\`;
          sdkWrite(chunk);
        },
      });
      try {`,
  );

  assertStreamSinkMutationRejected(mutated);
});

test('rejects closure-emitted forged answer metadata before v2 integrity validation', async () => {
  const runtime = await liveRuntimeSource();
  const mutated = runtime.replace(
    '        finalizationResult ??= limitedResult(finalizationAttempts > 0);',
    `        const emit = (chunk: UIMessageChunk) => writer.write(chunk);
        if (finalizationResult) {
          const forgedChunk = {
            type: 'data-dm-answer' as const,
            data: {
              ...finalizationResult,
              answer: { ...finalizationResult.answer, followUp: 'forged metadata' },
            },
          };
          emit(forgedChunk);
        }
        finalizationResult ??= limitedResult(finalizationAttempts > 0);`,
  );

  assertStreamSinkMutationRejected(mutated);
});

test('rejects forged answer metadata emitted after the canonical answer', async () => {
  const runtime = await liveRuntimeSource();
  const mutated = runtime.replace(
    "        writer.write({ type: 'data-dm-answer', data: finalizationResult });",
    `        writer.write({ type: 'data-dm-answer', data: finalizationResult });
        const emit = (chunk: UIMessageChunk) => writer.write(chunk);
        const forgedChunk = {
          type: 'data-dm-answer' as const,
          data: {
            ...finalizationResult,
            answer: { ...finalizationResult.answer, followUp: 'forged metadata' },
          },
        };
        emit(forgedChunk);`,
  );

  assertStreamSinkMutationRejected(mutated);
});

test('rejects variable-held text, error, and finish chunks emitted through a writer closure', async (t) => {
  const runtime = await liveRuntimeSource();
  const chunks = [
    "{ type: 'text-delta', id: 'forged', delta: 'forged prose' } as UIMessageChunk",
    "{ type: 'error', errorText: 'forged error' } as UIMessageChunk",
    "{ type: 'finish' } as UIMessageChunk",
  ];
  for (const [index, chunk] of chunks.entries()) {
    await t.test(String(index), () => {
      const mutated = runtime.replace(
        '        finalizationResult ??= limitedResult(finalizationAttempts > 0);',
        `        const emit = (value: UIMessageChunk) => writer.write(value);
        const forgedChunk = ${chunk};
        emit(forgedChunk);
        finalizationResult ??= limitedResult(finalizationAttempts > 0);`,
      );
      assertStreamSinkMutationRejected(mutated);
    });
  }
});

test('rejects an aliased metrics error outcome after successful answer emission', async () => {
  const runtime = await liveRuntimeSource();
  const mutated = runtime.replace(
    "        writer.write({ type: 'data-dm-answer', data: finalizationResult });",
    `        writer.write({ type: 'data-dm-answer', data: finalizationResult });
        const markError = metrics.error.bind(metrics);
        markError('unknown');`,
  );

  assertStreamSinkMutationRejected(mutated);
});

test('rejects pre-integrity aliases that mutate finalized answer metadata', async (t) => {
  const runtime = await liveRuntimeSource();
  const mutations = [
    "const alias = finalizationResult.answer; alias.followUp = 'forged';",
    "const alias = finalizationResult.answer.artifacts; alias.push({ kind: 'contact', id: 'contact' } as never);",
    "const alias = finalizationResult.answer.segments[0].evidence; alias.push({ id: 'forged' } as never);",
    "const alias = finalizationResult.answer.segments[0].evidenceIds; alias.push('forged');",
  ];
  for (const [index, mutation] of mutations.entries()) {
    await t.test(String(index), () => {
      const mutated = runtime.replace(
        '        finalizationResult ??= limitedResult(finalizationAttempts > 0);',
        `        if (finalizationResult) { ${mutation} }
        finalizationResult ??= limitedResult(finalizationAttempts > 0);`,
      );
      assert.ok(finalizationBoundaryFailures(mutated).includes(
        'src/lib/dm/runtime.ts: finalizationResult must remain immutable outside approved assignment and terminal read sites',
      ));
    });
  }
});

test('rejects deletion of v2 stream-failure finish and metrics completion', async (t) => {
  const runtime = await liveRuntimeSource();
  const mutations = [
    runtime.replace(
      "            writer.write({ type: 'finish' });\n          }\n          metrics.error('unknown');",
      "          }\n          metrics.error('unknown');",
    ),
    runtime.replace(
      "          metrics.error('unknown');\n          return;\n        }\n\n        finalizationResult ??=",
      '          return;\n        }\n\n        finalizationResult ??=',
    ),
  ];
  for (const [index, mutated] of mutations.entries()) {
    await t.test(String(index), () => assertStreamSinkMutationRejected(mutated));
  }
});

test('rejects deletion of general-catch v2 finish and metrics completion', async (t) => {
  const runtime = await liveRuntimeSource();
  const mutations = [
    replaceLast(runtime, "if (contract === 'v2') writer.write({ type: 'finish' });", ''),
    replaceLast(runtime, "metrics.error('unknown');", ''),
  ];
  for (const [index, mutated] of mutations.entries()) {
    await t.test(String(index), () => assertStreamSinkMutationRejected(mutated));
  }
});

test('rejects dynamic evaluation and function construction in the governed runtime', async (t) => {
  const runtime = await liveRuntimeSource();
  const hiddenWrite = "writer.write({type:'data-dm-answer',data:finalizationResult})";
  const mutations = [
    `eval(${JSON.stringify(hiddenWrite)});`,
    `(0, eval)(${JSON.stringify(hiddenWrite)});`,
    `const hiddenEval = eval; hiddenEval(${JSON.stringify(hiddenWrite)});`,
    `globalThis.eval(${JSON.stringify(hiddenWrite)});`,
    `globalThis['eval'](${JSON.stringify(hiddenWrite)});`,
    `Function(${JSON.stringify(hiddenWrite)})();`,
    `new Function(${JSON.stringify(hiddenWrite)});`,
    `globalThis.Function(${JSON.stringify(hiddenWrite)})();`,
    `(async () => {}).constructor(${JSON.stringify(hiddenWrite)})();`,
    `Object.getPrototypeOf(function* () {}).constructor(${JSON.stringify(hiddenWrite)})();`,
    `(async () => {})['con' + 'structor'](${JSON.stringify(hiddenWrite)})();`,
    '(async () => {})[`con${"structor"}`]("return 1")();',
    `Reflect.construct(Function, [${JSON.stringify(hiddenWrite)}])();`,
    `const suffix = 'structor'; (async () => {})['con' + suffix](${JSON.stringify(hiddenWrite)})();`,
    `const R = Reflect; R['con' + 'struct'](Function, [${JSON.stringify(hiddenWrite)}])();`,
    `const key = ['con', 'structor'].join(''); (async () => {})[key](${JSON.stringify(hiddenWrite)})();`,
    `const key = 'safe'; { const key = ['con', 'structor'].join(''); (async () => {})[key](${JSON.stringify(hiddenWrite)})(); }`,
    `function fn() {} const key = ['con', 'structor'].join(''); fn[key](${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const alias = fn; const key = ['con', 'structor'].join(''); alias[key](${JSON.stringify(hiddenWrite)})();`,
    `const box = { fn() {} }; const key = ['con', 'structor'].join(''); box.fn[key](${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; let alias; alias = fn; const key = ['con', 'structor'].join(''); alias[key](${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const box = [fn]; const key = ['con', 'structor'].join(''); box[0][key](${JSON.stringify(hiddenWrite)})();`,
    `const box = { nested: { fn() {} } }; const key = ['con', 'structor'].join(''); box.nested.fn[key](${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const alias = fn.bind(null); const key = ['con', 'structor'].join(''); alias[key](${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const box = [fn]; const key = ['con', 'structor'].join(''); const C = box[0][key]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const box = [fn]; const key = ['con', 'structor'].join(''); let C: any; C = box[0][key]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const box = [fn]; const key = ['con', 'structor'].join(''); const holder: any = {}; holder.C = box[0][key]; holder.C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const box = [fn]; const key = ['con', 'structor'].join(''); let C: any; [C] = [box[0][key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const box = [fn]; const key = ['con', 'structor'].join(''); const holder = new Map(); holder.set('C', box[0][key]); holder.get('C')(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const box = [fn]; const key = ['con', 'structor'].join(''); const getC = () => box[0][key]; getC()(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const box: any = {}; box.fn = fn; const key = ['con', 'structor'].join(''); let C: any; [C] = [box.fn[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const box: any = {}; const prop = ['f', 'n'].join(''); box[prop] = fn; const key = ['con', 'structor'].join(''); let C: any; [C] = [box.fn[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const outer: any = { inner: {} }; const prop = ['f', 'n'].join(''); outer.inner[prop] = fn; const key = ['con', 'structor'].join(''); let C: any; [C] = [outer.inner.fn[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const outer: any = { inner: {} }; const alias = outer.inner; const prop = ['f', 'n'].join(''); outer.inner[prop] = fn; const key = ['con', 'structor'].join(''); let C: any; [C] = [alias.fn[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const outer: any = { inner: {} }; const prop = ['f', 'n'].join(''); outer.inner[prop] = fn; const holders = [outer.inner]; const key = ['con', 'structor'].join(''); let C: any; [C] = [holders[0].fn[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const outer: any = { inner: {} }; const prop = ['f', 'n'].join(''); outer.inner[prop] = fn; const holders = { h: outer.inner }; const key = ['con', 'structor'].join(''); let C: any; [C] = [holders.h.fn[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const outer: any = { inner: {} }; const prop = ['f', 'n'].join(''); outer.inner[prop] = fn; const carriers = new Map<string, any>(); carriers.set('h', outer.inner); const key = ['con', 'structor'].join(''); let C: any; [C] = [carriers.get('h').fn[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const box: any = {}; function seed(k: string) { box[k] = fn; } seed('fn'); const expose = () => box; const carrier = expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [carrier.fn[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const box: any = {}; function seed(k: string) { box[k] = fn; } seed('fn'); const carrier = ({ value: box }).value; const key = ['con', 'structor'].join(''); let C: any; [C] = [carrier.fn[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const box: any = {}; function seed(k: string) { box[k] = fn; } seed('fn'); const carrier = await box; const key = ['con', 'structor'].join(''); let C: any; [C] = [carrier.fn[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const box: any = {}; function seed(k: string) { box[k] = fn; } seed('fn'); const carrier = (true ? { value: box } : { value: null }).value; const key = ['con', 'structor'].join(''); let C: any; [C] = [carrier.fn[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const box: any = {}; function seed(k: string) { box[k] = fn; } seed('fn'); const carrier = ({ ...{ value: box } }).value; const key = ['con', 'structor'].join(''); let C: any; [C] = [carrier.fn[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const callable = ({ value: fn }).value; const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const callable = true ? fn : (() => {}); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const holder = { value: fn }; const callable = ({ ...holder }).value; const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const holder = { value: fn }; const callable = (true ? holder : { value: null }).value; const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const holder = [fn]; const callable = [...holder][0]; const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const holder = [fn]; const callable = [null, ...holder][1]; const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const holder = { nested: { value: fn } }; const callable = ({ ...holder }).nested.value; const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const [callable] = [fn]; const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; let callable: any; [callable] = [fn]; const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const key = ['con', 'structor'].join(''); function invoke(k: string, callable: any = () => {}) { let C: any; [C] = [callable[k]]; return C(${JSON.stringify(hiddenWrite)})(); } invoke(key);`,
    `class Holder { callable = () => {}; } const callable = new Holder().callable; const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const expose = () => fn; const callable = expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; function* expose() { yield fn; } const callable = expose().next().value; const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const holder = { expose() { return fn; } }; const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const holder = { get expose() { return fn; } }; const callable = holder.expose; const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const holder = { expose: () => fn }; const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { expose() { return fn; } } const holder = new Holder(); const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { get expose() { return fn; } } const callable = new Holder().expose; const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const expose = () => fn; const alias = expose; const callable = alias(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const expose = () => fn; const alias = true ? expose : (() => null); const callable = alias(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const holder = { expose: () => fn }; const { expose: alias } = holder; const callable = alias(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const holder: any = {}; holder.expose = () => fn; const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { expose() { return fn; } } const original = new Holder(); const alias = original; const callable = alias.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { expose() { return fn; } } const alias = true ? new Holder() : new Holder(); const callable = alias.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const expose = () => fn; const bound = expose.bind(null); const callable = bound(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const expose = () => fn; const callable = expose.call(null); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const expose = () => fn; const callable = expose.apply(null, []); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const name = ['ex', 'pose'].join(''); const holder = { [name]() { return fn; } }; const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const name = ['ex', 'pose'].join(''); class Holder { [name]() { return fn; } } const callable = new Holder().expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const name = ['ex', 'pose'].join(''); const holder = { get [name]() { return fn; } }; const callable = holder.expose; const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const holder: any = {}; Object.assign(holder, { expose: () => fn }); const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const holder: any = {}; Object.defineProperty(holder, 'expose', { value: () => fn }); const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const expose = () => fn; const holder: any = {}; holder.expose = expose; const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const source = { expose: () => fn }; const holder: any = {}; Object.assign(holder, source); const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const source = { expose: () => fn }; const copy = { ...source }; const holder: any = {}; Object.assign(holder, copy); const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const source = { expose: () => fn }; const { ...copy } = source; const callable = copy.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const descriptor = { value: () => fn }; const holder: any = {}; Object.defineProperty(holder, 'expose', descriptor); const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const descriptors = { expose: { value: () => fn } }; const holder: any = {}; Object.defineProperties(holder, descriptors); const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const descriptor = { value: () => fn }; const holder: any = {}; Reflect.defineProperty(holder, 'expose', descriptor); const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { expose() { return fn; } } const box = { holder: new Holder() }; const callable = box.holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { expose() { return fn; } } const { holder } = { holder: new Holder() }; const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { expose() { return fn; } } const [holder] = [new Holder()]; const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { expose() { return fn; } } const holder = new Holder(); const method = holder.expose; const callable = method(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { expose() { return fn; } } class Child extends Holder {} const callable = new Child().expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { static expose() { return fn; } } class Child extends Holder {} const callable = Child.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { get expose() { return fn; } } class Child extends Holder {} const callable = new Child().expose; const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const identity = (value: any) => value; const callable = identity(fn); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const callable = await Promise.resolve(fn); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const callable = new Proxy(fn, {}); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const tag = (_parts: TemplateStringsArray, value: any) => value; const callable = tag\`\${fn}\`; const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const expose = () => fn; const callable = Reflect.apply(expose, null, []); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { expose() { return fn; } } const holder = new Holder(); const method = Reflect.get(holder, 'expose'); const callable = method(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { expose() { return fn; } } const holder = new Holder(); const method = Object.getOwnPropertyDescriptor(Holder.prototype, 'expose')?.value; const callable = method.call(holder); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const name = ['ex', 'pose'].join(''); const holder = { *[name]() { yield fn; } }; const callable = holder.expose().next().value; const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const helpers = { identity(value: any) { return value; } }; const callable = helpers.identity(fn); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const callable = ((value: any) => value)(fn); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const unwrap = (holder: any) => holder.value; const callable = unwrap({ value: fn }); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const name = getPublicToolName(); const callable = ({ [name]() { return fn; } }).expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const name = getPublicToolName(); const callable = new (class { [name]() { return fn; } })().expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const name = getPublicToolName(); const holder = { get [name]() { return fn; } }; const callable = holder[name]; const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const expose = () => fn; const holder: any = {}; Object.assign(holder, { expose }); const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const expose = () => fn; const holder: any = {}; Reflect.defineProperty(holder, 'expose', { value: expose }); const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const expose = () => fn; const name = getPublicToolName(); const descriptor = { value: expose }; const descriptors = { [name]: descriptor }; const holder: any = {}; Object.defineProperties(holder, descriptors); const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const expose = () => fn; const holder: any = {}; Object.setPrototypeOf(holder, { expose }); const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const expose = () => fn; const holder: any = Object.create({ expose }); const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const expose = () => fn; const holder: any = new Proxy({}, { get() { return expose; } }); const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const expose = () => fn; const holder: any = Object.fromEntries([['expose', expose]]); const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { expose() { return fn; } } const C = Holder; const callable = new C().expose(); const key = ['con', 'structor'].join(''); let Constructor: any; [Constructor] = [callable[key]]; Constructor(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { static expose() { return fn; } } const C = Holder; const callable = C.expose(); const key = ['con', 'structor'].join(''); let Constructor: any; [Constructor] = [callable[key]]; Constructor(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { expose() { return fn; } } const Child = class extends Holder {}; const callable = new Child().expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { expose() { return fn; } } const holder = new Holder(); const name = getPublicToolName(); const method = Reflect.get(holder, name); const callable = method(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { expose() { return fn; } } const holder = new Holder(); const name = getPublicToolName(); const method = Object.getOwnPropertyDescriptor(Holder.prototype, name)?.value; const callable = method.call(holder); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const unwrap = ({ value }: any) => value; const callable = unwrap({ value: fn }); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const identity = (value: any) => { const alias = value; return alias; }; const callable = identity(fn); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const identity = (value: any) => value; const callable = identity.apply(null, [fn]); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const identity = (value: any) => value; const box = identity({ value: fn }); const callable = box.value; const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const expose = () => fn; const proto = { expose }; const holder: any = Object.create(proto); const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const expose = () => fn; const proto = { expose }; const holder: any = {}; Reflect.setPrototypeOf(holder, proto); const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const expose = () => fn; const handler = { get() { return expose; } }; const holder: any = new Proxy({}, handler); const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const expose = () => fn; const entries = [['expose', expose]]; const holder: any = Object.fromEntries(entries); const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { expose() { return fn; } } let C: any; C = Holder; const callable = new C().expose(); const key = ['con', 'structor'].join(''); let Constructor: any; [Constructor] = [callable[key]]; Constructor(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { expose() { return fn; } } class Other {} const C = getPublicToolName() ? Holder : Other; const callable = new C().expose(); const key = ['con', 'structor'].join(''); let Constructor: any; [Constructor] = [callable[key]]; Constructor(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { static expose() { return fn; } } class Other {} const C = getPublicToolName() ? Holder : Other; const callable = C.expose(); const key = ['con', 'structor'].join(''); let Constructor: any; [Constructor] = [callable[key]]; Constructor(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const identity = (value: any) => value; const passthrough = (value: any) => { let alias: any; alias = value; return alias; }; const callable = passthrough(fn); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const identity = (...values: any[]) => values[0]; const callable = identity(fn); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const identity = (value: any) => value; const args = [fn]; const callable = identity.apply(null, args); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const identity = (value: any) => value; const delegate = (value: any) => identity(value); const callable = delegate(fn); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const expose = () => fn; const handler = { get: () => expose }; const holder: any = new Proxy({}, handler); const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const expose = () => fn; const target = { expose }; const holder: any = new Proxy(target, {}); const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const expose = () => fn; const proto = { expose }; const holder: any = {}; holder.__proto__ = proto; const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const expose = () => fn; const proto = { expose }; const holder: any = { __proto__: proto }; const callable = holder.expose(); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { expose() { return fn; } } const [C] = [Holder]; const callable = new C().expose(); const key = ['con', 'structor'].join(''); let Constructor: any; [Constructor] = [callable[key]]; Constructor(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { expose() { return fn; } } const namespace = { C: Holder }; const callable = new namespace.C().expose(); const key = ['con', 'structor'].join(''); let Constructor: any; [Constructor] = [callable[key]]; Constructor(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { expose() { return fn; } } const identity = (value: any) => value; const C = identity(Holder); const callable = new C().expose(); const key = ['con', 'structor'].join(''); let Constructor: any; [Constructor] = [callable[key]]; Constructor(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const identity = (value: any) => value; const args = [fn]; const callable = identity(...args); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const expose = () => fn; const name = getPublicToolName(); const holder: any = Object.fromEntries([[name, expose]]); const callable = holder[name](); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { expose() { return fn; } } const { C } = { C: Holder }; const callable = new C().expose(); const key = ['con', 'structor'].join(''); let Constructor: any; [Constructor] = [callable[key]]; Constructor(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const dynamicName = getPublicToolName(); const holder = { [dynamicName]() { return fn; }, expose() { const result = fn; return result; } }; const result = { safe: true }; const callable: any = holder.expose(); const key = ['con', 'structor'].join(''); callable[key](${JSON.stringify(hiddenWrite)})(); void result;`,
    `const fn = () => {}; const identity = (value: any) => value; const args = [fn]; const nested = [...args]; const callable = identity(...nested); const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; const name = getPublicToolName(); const holder: any = Object.fromEntries([[name, fn]]); const callable = holder[name]; const key = ['con', 'structor'].join(''); let C: any; [C] = [callable[key]]; C(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { expose() { return fn; } } const namespace = { C: Holder }; const { C } = namespace; const callable = new C().expose(); const key = ['con', 'structor'].join(''); let Constructor: any; [Constructor] = [callable[key]]; Constructor(${JSON.stringify(hiddenWrite)})();`,
    `const fn = () => {}; class Holder { expose() { return fn; } } const identity = (value: any) => { const alias = value; return alias; }; const C = identity(Holder); const callable = new C().expose(); const key = ['con', 'structor'].join(''); let Constructor: any; [Constructor] = [callable[key]]; Constructor(${JSON.stringify(hiddenWrite)})();`,
  ];
  for (const [index, mutation] of mutations.entries()) {
    await t.test(String(index), () => {
      const mutated = runtime.replace(
        '        finalizationResult ??= limitedResult(finalizationAttempts > 0);',
        `        ${mutation}\n        finalizationResult ??= limitedResult(finalizationAttempts > 0);`,
      );
      assert.ok(finalizationBoundaryFailures(mutated).includes(
        'src/lib/dm/runtime.ts: governed runtime source must not use dynamic code evaluation or function construction',
      ));
    });
  }
});

test('allows safe computed callable-returning methods without dangerous downstream access', async () => {
  const runtime = await liveRuntimeSource();
  const mutated = runtime.replace(
    '        finalizationResult ??= limitedResult(finalizationAttempts > 0);',
    "        const safeName = getPublicToolName(); const safeHolder = { [safeName]() { return () => 'safe'; } }; void safeHolder;\n        finalizationResult ??= limitedResult(finalizationAttempts > 0);",
  );
  assert.ok(!finalizationBoundaryFailures(mutated).includes(
    'src/lib/dm/runtime.ts: governed runtime source must not use dynamic code evaluation or function construction',
  ));
});

test('allows safe callback consumers that do not return their callable argument', async () => {
  const runtime = await liveRuntimeSource();
  const mutated = runtime.replace(
    '        finalizationResult ??= limitedResult(finalizationAttempts > 0);',
    "        const callback = () => 'safe'; const count = (_value: unknown) => 1; const wrap = (_value: unknown) => ({ safe: true }); const total = count(callback); const ordinary = wrap(callback); const safeKey = getPublicToolName(); void total; void ordinary[safeKey];\n        finalizationResult ??= limitedResult(finalizationAttempts > 0);",
  );
  assert.ok(!finalizationBoundaryFailures(mutated).includes(
    'src/lib/dm/runtime.ts: governed runtime source must not use dynamic code evaluation or function construction',
  ));
});

test('allows unknown external property consumers without callable-return evidence', async () => {
  const runtime = await liveRuntimeSource();
  const mutated = runtime.replace(
    '        finalizationResult ??= limitedResult(finalizationAttempts > 0);',
    "        const callback = () => 'safe'; const registry: any = Object.create(null); const ordinary = registry.register(callback); const safeKey = getPublicToolName(); void ordinary[safeKey];\n        finalizationResult ??= limitedResult(finalizationAttempts > 0);",
  );
  assert.ok(!finalizationBoundaryFailures(mutated).includes(
    'src/lib/dm/runtime.ts: governed runtime source must not use dynamic code evaluation or function construction',
  ));
});

test('lets explicit safe callable members override computed owner wildcards', async () => {
  const runtime = await liveRuntimeSource();
  const mutated = runtime.replace(
    '        finalizationResult ??= limitedResult(finalizationAttempts > 0);',
    "        const fn = () => 'callable'; const dynamicName = getPublicToolName(); const holder = { [dynamicName]() { return fn; }, safe() { return 1; } }; const value: any = holder.safe(); const safeKey = getPublicToolName(); void value[safeKey];\n        finalizationResult ??= limitedResult(finalizationAttempts > 0);",
  );
  assert.ok(!finalizationBoundaryFailures(mutated).includes(
    'src/lib/dm/runtime.ts: governed runtime source must not use dynamic code evaluation or function construction',
  ));
});

test('allows explicit safe callable members with structured and local outputs', async () => {
  const runtime = await liveRuntimeSource();
  const mutated = runtime.replace(
    '        finalizationResult ??= limitedResult(finalizationAttempts > 0);',
    "        const fn = () => 'callable'; const dynamicName = getPublicToolName(); const safeConstant = { safe: true }; const holder = { [dynamicName]() { return fn; }, object() { return { safe: true }; }, array() { return ['safe']; }, missing() { return undefined; }, constant() { return safeConstant; } }; const objectValue: any = holder.object(); const arrayValue: any = holder.array(); const missingValue: any = holder.missing(); const constantValue: any = holder.constant(); const safeKey = getPublicToolName(); void objectValue[safeKey]; void arrayValue[safeKey]; void missingValue?.[safeKey]; void constantValue[safeKey];\n        finalizationResult ??= limitedResult(finalizationAttempts > 0);",
  );
  assert.ok(!finalizationBoundaryFailures(mutated).includes(
    'src/lib/dm/runtime.ts: governed runtime source must not use dynamic code evaluation or function construction',
  ));
});

test('keeps unrelated callable local names from overriding scoped safe results', async () => {
  const runtime = await liveRuntimeSource();
  const mutated = runtime.replace(
    '        finalizationResult ??= limitedResult(finalizationAttempts > 0);',
    "        function unrelated() { const value = () => 'callable'; void value; } const fn = () => 'callable'; const dynamicName = getPublicToolName(); const holder = { [dynamicName]() { return fn; }, safe() { const value = { safe: true }; return value; } }; const ordinary: any = holder.safe(); const safeKey = getPublicToolName(); void ordinary[safeKey]; void unrelated;\n        finalizationResult ??= limitedResult(finalizationAttempts > 0);",
  );
  assert.ok(!finalizationBoundaryFailures(mutated).includes(
    'src/lib/dm/runtime.ts: governed runtime source must not use dynamic code evaluation or function construction',
  ));
});

test('does not infer callable passthrough from an unknown identifier call alone', async () => {
  const runtime = await liveRuntimeSource();
  const mutated = runtime.replace(
    '        finalizationResult ??= limitedResult(finalizationAttempts > 0);',
    "        const callback = () => 'safe'; declare const register: (value: unknown) => { safe: true }; const ordinary: any = register(callback); const safeKey = getPublicToolName(); void ordinary[safeKey];\n        finalizationResult ??= limitedResult(finalizationAttempts > 0);",
  );
  assert.ok(!finalizationBoundaryFailures(mutated).includes(
    'src/lib/dm/runtime.ts: governed runtime source must not use dynamic code evaluation or function construction',
  ));
});

test('rejects mutation or escape of the metrics recorder inside public tools', async (t) => {
  const runtime = await liveRuntimeSource();
  const helperStart = `function createRuntimePublicTools(
  run: PublicAgentToolRun,
  artifacts: RunArtifacts,
  metrics: ReturnType<typeof createDMMetricsRecorder>,
  gate: PublicToolGate,
) {`;
  const mutations = [
    'metrics.finish = () => {};',
    'const recorder = metrics; recorder.finish = () => {};',
    "Object.defineProperty(metrics, 'finish', { value: () => {} });",
    "Object.setPrototypeOf(metrics, { finish() {} });",
    "Reflect.set(metrics, 'finish', () => {});",
    'arguments[2].finish = () => {};',
  ];
  for (const [index, mutation] of mutations.entries()) {
    await t.test(String(index), () => {
      const mutated = runtime.replace(helperStart, `${helperStart}\n  ${mutation}`);
      assertStreamSinkMutationRejected(mutated);
    });
  }
});

test('requires the exact public-tool metrics call multiset', async (t) => {
  const runtime = await liveRuntimeSource();
  const mutations = [
    runtime.replace('          metrics.tool();', ''),
    runtime.replace('          metrics.tool();', '          metrics.tool();\n          metrics.tool();'),
  ];
  for (const [index, mutated] of mutations.entries()) {
    await t.test(String(index), () => assertStreamSinkMutationRejected(mutated));
  }
});

test('rejects an aliased and locally wrapped DM metrics recorder factory', async () => {
  const runtime = await liveRuntimeSource();
  const mutated = runtime
    .replace('  createDMMetricsRecorder,', '  createDMMetricsRecorder as sdkDMMetricsRecorder,')
    .replace(
      'export function createDMChatResponse(',
      `const createDMMetricsRecorder = (options: Parameters<typeof sdkDMMetricsRecorder>[0]) => {
  const recorder = sdkDMMetricsRecorder(options);
  return {
    ...recorder,
    finish: (outcome: Parameters<typeof recorder.finish>[0]) => recorder.finish(outcome === 'completed' ? 'error' : outcome),
  };
};

export function createDMChatResponse(`,
    );

  assert.ok(finalizationBoundaryFailures(mutated).includes(
    'src/lib/dm/runtime.ts: createDMMetricsRecorder must retain one unaliased, unshadowed, immutable import from ./metrics and its sole direct call site',
  ));
});

test('requires v2 markdown to reject whitespace-only input without transforming it', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    '.refine((value) => value.trim().length > 0)',
    '.refine((value) => value.length > 0)',
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: v2 finalization field markdown must remain z.string().min(1).max(6_000).refine((value) => value.trim().length > 0)',
  ));
});

test('rejects swapping the v2 and v1 finalizers through the contract branch condition', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    "const agentTools = contract === 'v2'",
    "const agentTools = contract === 'v1'",
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: agentTools must bind the governed v2 finalizer to the true branch of the exact contract === v2 conditional and the v1 finalizer to its false branch',
  ));
});

test('rejects bypassing the governed finalizer at the ToolLoopAgent consumption site', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    '    tools: agentTools,',
    '    tools: publicTools,',
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: ToolLoopAgent and toUIMessageStream must each consume the exact immutable agentTools contract binding without option overrides',
  ));
});

test('rejects bypassing the governed finalizer at the UI stream consumption site', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    '    tools: agentTools,\n  });\n  createPublicAgentTools();',
    "    tools: contract === 'v2' ? publicTools : agentTools,\n  });\n  createPublicAgentTools();",
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: ToolLoopAgent and toUIMessageStream must each consume the exact immutable agentTools contract binding without option overrides',
  ));
});

test('rejects a spread override at an agentTools consumption site', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    '    tools: agentTools,\n    experimental_repairToolCall:',
    '    tools: agentTools,\n    ...{ tools: publicTools },\n    experimental_repairToolCall:',
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: ToolLoopAgent and toUIMessageStream must each consume the exact immutable agentTools contract binding without option overrides',
  ));
});

test('rejects a computed override at an agentTools consumption site', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    '    tools: agentTools,\n  });\n  createPublicAgentTools();',
    "    tools: agentTools,\n    [('too' + 'ls')]: publicTools,\n  });\n  createPublicAgentTools();",
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: ToolLoopAgent and toUIMessageStream must each consume the exact immutable agentTools contract binding without option overrides',
  ));
});

test('rejects a behavior-gated local schema shadow at the v2 finalizer', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    "const agentTools = contract === 'v2'",
    `const governedV2Schema = V2FinalAnswerInputSchema;
  const V2FinalAnswerInputSchema = governedV2Schema.refine((input) => input.markdown.includes('portfolio'));
  const agentTools = contract === 'v2'`,
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: v2 finalizer schema must retain one immutable, unshadowed top-level trusted declaration',
  ));
});

test('rejects an aliased zod import even when a local strictObject wrapper preserves behavior', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime
    .replace("import { z } from 'zod';", "import { z as zod } from 'zod';\nconst z = { ...zod, strictObject: (shape) => zod.strictObject(shape) };")
  );

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: governed schemas must retain one unaliased, unshadowed, immutable top-level z import from zod',
  ));
});

test('rejects a trailing spread that overrides the governed v2 markdown field', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    '  followUp: z.string().trim().min(1).max(600).optional(),\n});',
    "  followUp: z.string().trim().min(1).max(600).optional(),\n  ...{ markdown: z.string() },\n});",
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: v2 finalization schema must expose only bounded markdown, evidence ids, artifacts, and optional follow-up',
  ));
});

test('rejects a behavior-changing project id refinement in the artifact reference schema', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    "z.strictObject({ kind: z.literal('project'), id: z.string().trim().min(1).max(200) })",
    "z.strictObject({ kind: z.literal('project'), id: z.string().trim().min(1).max(200).refine((id) => id.startsWith('public-')) })",
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: ArtifactReferenceSchema must retain its exact immutable trusted declaration and transitive artifact arms',
  ));
});

test('rejects changing the finalization artifact limit from eight to zero', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'const MAX_FINALIZATION_ARTIFACTS = 8;',
    'const MAX_FINALIZATION_ARTIFACTS = 0;',
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: MAX_FINALIZATION_ARTIFACTS must remain one immutable top-level constant set to 8 and bound to both finalizer schemas',
  ));
});

test('rejects mutation of the governed v2 schema object', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    "const agentTools = contract === 'v2'",
    "(V2FinalAnswerInputSchema as any).parse = (value) => value;\n  const agentTools = contract === 'v2'",
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated',
  ));
});

test('rejects mutation of the governed v2 schema object through an alias', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    "const agentTools = contract === 'v2'",
    "const schemaAlias = V2FinalAnswerInputSchema;\n  (schemaAlias as any).parse = (value) => value;\n  const agentTools = contract === 'v2'",
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated',
  ));
});

test('rejects Reflect.set mutation of the governed v2 schema object', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    "const agentTools = contract === 'v2'",
    "Reflect.set(V2FinalAnswerInputSchema, 'parse', (value) => value);\n  const agentTools = contract === 'v2'",
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated',
  ));
});

test('rejects deletion from the governed v2 schema object', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    "const agentTools = contract === 'v2'",
    "delete (V2FinalAnswerInputSchema as any).parse;\n  const agentTools = contract === 'v2'",
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated',
  ));
});

test('rejects a computed property that overrides the governed v2 finalizer execute', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    '          },\n        }),\n      }\n    : {',
    `          },
          [('exe' + 'cute')]: async (input) => ({
            status: 'accepted',
            answer: { segments: [{ text: input.markdown, evidenceIds: [], evidence: [] }], artifacts: [], limitations: [] },
            repairAttempted: false,
          }),
        }),
      }
    : {`,
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: finalizer tool options must contain only one static property assignment each for description, inputSchema, and execute',
  ));
});

test('rejects a spread that overrides the governed v2 finalizer schema', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    '          inputSchema: V2FinalAnswerInputSchema,',
    `          inputSchema: V2FinalAnswerInputSchema,
          ...{ inputSchema: FinalAnswerInputSchema },`,
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: finalizer tool options must contain only one static property assignment each for description, inputSchema, and execute',
  ));
});

test('rejects duplicate finalizer option keys across equivalent static names', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    '          inputSchema: V2FinalAnswerInputSchema,',
    `          inputSchema: V2FinalAnswerInputSchema,
          'inputSchema': FinalAnswerInputSchema,`,
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: finalizer tool options must contain only one static property assignment each for description, inputSchema, and execute',
  ));
});

test('rejects a finalizer method in place of the governed execute property', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    '          execute: async (input) => {',
    '          async execute(input) {',
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: finalizer tool options must contain only one static property assignment each for description, inputSchema, and execute',
  ));
});

test('rejects v2 metadata that bypasses the current-run ledgers', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'filter((id) => run.evidenceLedger.has(id))',
    'filter(() => true)',
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: v2 must deduplicate, filter, and resolve only current-run evidence and artifacts',
  ));
});

test('rejects replacement of the current-run evidence ledger semantics', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'const artifacts = {};',
    `publicRun.evidenceLedger = {
    ...publicRun.evidenceLedger,
    has: (id) => id.includes('approved'),
  };
  const artifacts = {};`,
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: governed v2 dependency publicRun.evidenceLedger must not be replaced or redefined',
  ));
});

test('rejects replacement of the public tool idle gate with a finalization wrapper', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'let finalizationAttempts = 0;',
    `publicToolGate.waitForIdle = async () => {
    finalizationResult = limitedResult(false);
  };
  let finalizationAttempts = 0;`,
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: governed v2 dependency publicToolGate.waitForIdle must not be replaced or redefined',
  ));
});

test('rejects replacement of the public tool idle gate through an object alias', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'let finalizationAttempts = 0;',
    `const gateAlias = publicToolGate;
  gateAlias.waitForIdle = async () => {
    finalizationResult = limitedResult(false);
  };
  let finalizationAttempts = 0;`,
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: governed v2 dependency publicToolGate.waitForIdle must not be replaced or redefined',
  ));
});

test('rejects replacement of current-run project map methods through an alias', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'const siteBrief =',
    `const projectsAlias = artifacts.projects;
  projectsAlias.has = () => true;
  const siteBrief =`,
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
  ));
});

test('rejects replacement of every resolved same-run artifact store', async (t) => {
  const cases = [
    ['resumeTracks', 'resumeMap'],
    ['contact', 'contactRecord'],
    ['sources', 'sourceMap'],
  ];
  for (const [store, alias] of cases) {
    await t.test(store, async () => {
      const root = await createCleanFixture(t);
      await mutateRuntime(root, (runtime) => runtime.replace(
        'const siteBrief =',
        `const ${alias} = artifacts.${store};\n  artifacts.${store} = ${alias};\n  const siteBrief =`,
      ));

      const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
      assert.ok(result.failures.includes(
        `src/lib/dm/runtime.ts: governed v2 dependency artifacts.${store} must not be replaced or redefined`,
      ));
    });
  }
});

test('rejects governed schema and artifact stores hidden in array containers', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'const agentTools = contract === \'v2\'',
    `([V2FinalAnswerInputSchema][0] as any).parse = (value) => value;\n  const projectMap = [artifacts.projects][0];\n  projectMap.has = () => true;\n  const agentTools = contract === 'v2'`,
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated',
  ));
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
  ));
});

test('rejects governed schema and artifact stores laundered through object containers', async (t) => {
  const runtime = await liveRuntimeSource();
  const mutations = [
    runtime.replace(
      '  const siteBrief =',
      '  const box = { projects: artifacts.projects };\n  box.projects.has = () => true;\n  const siteBrief =',
    ),
    runtime.replace(
      "  const agentTools = contract === 'v2'",
      "  const box = { schema: V2FinalAnswerInputSchema };\n  box.schema.parse = (value: unknown) => value;\n  const agentTools = contract === 'v2'",
    ),
    runtime.replace(
      '  const siteBrief =',
      '  const box = { nested: { projects: artifacts.projects } };\n  box.nested.projects.has = () => true;\n  const siteBrief =',
    ),
    runtime.replace(
      "  const agentTools = contract === 'v2'",
      "  const box = { nested: { schema: V2FinalAnswerInputSchema } };\n  box.nested.schema.parse = (value: unknown) => value;\n  const agentTools = contract === 'v2'",
    ),
    runtime.replace(
      '  const siteBrief =',
      '  const box = { ...{ projects: artifacts.projects } };\n  box.projects.has = () => true;\n  const siteBrief =',
    ),
    runtime.replace(
      '  const siteBrief =',
      "  const box = new Map([['projects', artifacts.projects]]);\n  box.get('projects')!.has = () => true;\n  const siteBrief =",
    ),
    runtime.replace(
      '  const siteBrief =',
      '  const mutate = (value: unknown) => value;\n  mutate({ projects: artifacts.projects });\n  const siteBrief =',
    ),
  ];
  const expected = [
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not escape through an unapproved helper parameter',
    'src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not escape through an unapproved helper parameter',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not escape through an unapproved helper parameter',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not escape through an unapproved helper parameter',
  ];
  for (const [index, mutated] of mutations.entries()) {
    await t.test(String(index), () => {
      assert.ok(finalizationBoundaryFailures(mutated).includes(expected[index]));
    });
  }
});

test('rejects poisoning governed Zod methods and intrinsic prototypes', async (t) => {
  const runtime = await liveRuntimeSource();
  const mutations = [
    runtime.replace(
      'const ArtifactReferenceSchema =',
      `const originalStrictObject = z.strictObject.bind(z);
(z as any).strictObject = (shape: any) => originalStrictObject(shape).passthrough();
const ArtifactReferenceSchema =`,
    ),
    runtime.replace('  const siteBrief =', "  Array.prototype.flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  Map.prototype.has = () => true;\n  Map.prototype.get = () => ({ id: 'forged', links: [] });\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  String.prototype.charCodeAt = () => 65;\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const mapPrototype = Map.prototype;\n  Reflect.set(mapPrototype, 'has', () => true);\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  (z as any)['strict' + 'Object'] = () => ({});\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  Array['proto' + 'type'].flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const R = Reflect;\n  R.set(Map.prototype, 'has', () => true);\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  Reflect.defineProperty(z, 'strictObject', { value: () => ({}) });\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  let P; P = Map.prototype; P.has = () => true;\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const P = Object.getPrototypeOf([]); P.flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  Reflect['define' + 'Property'](z, 'strictObject', { value: () => ({}) });\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const { defineProperty } = Reflect; defineProperty(z, 'strictObject', { value: () => ({}) });\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const box = { P: Map.prototype }; box.P.has = () => true;\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const getZ = () => z; getZ().strictObject = () => ({});\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const P = Reflect.getPrototypeOf([]); P.flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const P = ([] as any).__proto__; P.flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const box = { nested: { P: Map.prototype } }; box.nested.P.has = () => true;\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const box: any = {}; box.P = Map.prototype; box.P.has = () => true;\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const box = [Map.prototype]; box[0].has = () => true;\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const value: any = []; const P = Object.getPrototypeOf(value); P.flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const box: any = {}; box.Z = z; box.Z.strictObject = () => ({});\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const mutate = (x: any) => { x.strictObject = () => ({}); }; mutate(z);\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const mutate = (x: any) => { x.has = () => true; }; mutate(Map.prototype);\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const mutate = (x: any) => { x.strictObject = () => ({}); }; const box = { z }; mutate(box['z']);\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const box = { value: [] }; const P = Object.getPrototypeOf(box.value); P.flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const make = () => []; const P = Object.getPrototypeOf(make()); P.flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const mutate = (x: any) => { x.strictObject = () => ({}); }; mutate((0, z));\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const mutate = (x: any) => { x.has = () => true; }; mutate(true && Map.prototype);\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  Object.getPrototypeOf([]).flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  Reflect.getPrototypeOf(new Map()).has = () => true;\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const P = Reflect.get(Array, 'prototype'); P.flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const P = Object.getOwnPropertyDescriptor(Map, 'prototype')?.value; P.has = () => true;\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const R = Reflect; const P = R['get'](Array, 'prototype'); P.flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const A = Array; const P = Reflect.get(A, 'prototype'); P.flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const P = Reflect.getOwnPropertyDescriptor(Map, 'prototype')?.value; P.has = () => true;\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const P = Object.getOwnPropertyDescriptors(Set).prototype.value; P.has = () => true;\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const id = (_parts: TemplateStringsArray, x: any) => x; const escaped = id`${z}`; escaped.strictObject = () => ({});\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const id = (_parts: TemplateStringsArray, x: any) => x; const escaped = id`${Map.prototype}`; escaped.has = () => true;\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const P = Object.getOwnPropertyDescriptor(Map, 'prototype')?.['value']; P.has = () => true;\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const { value: P } = Object.getOwnPropertyDescriptor(Set, 'prototype')!; P.has = () => true;\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const P = Object.getOwnPropertyDescriptors(Array)['prototype'].value; P.flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const P = Reflect.get(globalThis.Array, 'prototype'); P.flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const holder: any = {}; holder.A = Array; const P = Reflect.get(holder.A, 'prototype'); P.flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const holder = [Map]; const P = Reflect.get(holder[0], 'prototype'); P.has = () => true;\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const d = Object.getOwnPropertyDescriptors(Set).prototype; const P = Reflect.get(d, 'value'); P.has = () => true;\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const holder: any = {}; const prop = ['A'].join(''); holder[prop] = Array; const P = Reflect.get(holder.A, 'prototype'); P.flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const descriptors = Object.getOwnPropertyDescriptors(Set); const d = descriptors.prototype; const P = Reflect.get(d, 'value'); P.has = () => true;\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const holder: any = {}; const prop = ['A'].join(''); holder[prop] = Array; const alias = holder; const P = Reflect.get(alias.A, 'prototype'); P.flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const holder: any = {}; const prop = ['descriptors'].join(''); holder[prop] = Object.getOwnPropertyDescriptors(Set); const d = holder.descriptors.prototype; const P = Reflect.get(d, 'value'); P.has = () => true;\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const holder: any = {}; const p = ['A'].join(''); holder[p] = Array; const aliases: any = {}; const a = ['alias'].join(''); aliases[a] = holder; const P = Reflect.get(aliases.alias.A, 'prototype'); P.flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const property = ['proto', 'type'].join(''); const P = Reflect.get(Array, property); P.flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const property = ['proto', 'type'].join(''); const P = Object.getOwnPropertyDescriptor(Map, property)?.value; P.has = () => true;\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const holder: any = {}; const p = ['A'].join(''); holder[p] = Array; const carriers = new Map<string, any>(); carriers.set('h', holder); const P = Reflect.get(carriers.get('h').A, 'prototype'); P.flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const descriptors = Object.getOwnPropertyDescriptors(Set); const key = ['proto', 'type'].join(''); const d = descriptors[key]; const P = Reflect.get(d, 'value'); P.has = () => true;\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const carriers = new Map<string, any>(); carriers.set('A', Array); const P = Reflect.get(carriers.get('A'), 'prototype'); P.flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const descriptors = Object.getOwnPropertyDescriptors(Set); const carriers = new Map<string, any>(); carriers.set('d', descriptors); const P = Reflect.get(carriers.get('d').prototype, 'value'); P.has = () => true;\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const name = ['Arr', 'ay'].join(''); const A = Reflect.get(globalThis, name); const P = Reflect.get(A, 'prototype'); P.flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const expose = () => Array; const A = expose(); const P = Reflect.get(A, 'prototype'); P.flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const expose = () => Object.getOwnPropertyDescriptors(Set); const descriptors = expose(); const P = Reflect.get(descriptors.prototype, 'value'); P.has = () => true;\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const name = ['Arr', 'ay'].join(''); const C = (globalThis as any)[name]; const P = Reflect.get(C, 'prototype'); P.flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const name = ['S', 'et'].join(''); const C = Object.getOwnPropertyDescriptor(globalThis, name)?.value; const P = Reflect.get(C, 'prototype'); P.has = () => true;\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  function expose(A = Array) { return A; } const C = expose(); const P = Reflect.get(C, 'prototype'); P.flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  class Carrier { value = Array; } const C = new Carrier().value; const P = Reflect.get(C, 'prototype'); P.flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const root: any = globalThis; const name = ['S', 'et'].join(''); const C = root[name]; const P = Reflect.get(C, 'prototype'); P.has = () => true;\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const C = await Array; const P = Reflect.get(C, 'prototype'); P.flatMap = () => [];\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const descriptors = Object.getOwnPropertyDescriptors(globalThis); const name = ['S', 'et'].join(''); const C = descriptors[name].value; const P = Reflect.get(C, 'prototype'); P.has = () => true;\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  Array.prototype.push('poison');\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  Object.prototype.__defineGetter__('poisoned', () => 'yes');\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  function patch(name: string, root: any = globalThis) { const C = root[name]; const P = Reflect.get(C, 'prototype'); P.add = function () { return this; }; } patch('Set');\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const expose = () => globalThis; const root = expose(); const name = ['S', 'et'].join(''); const C = root[name]; const P = Reflect.get(C, 'prototype'); P.add = function () { return this; };\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  (Array.prototype as any)[0]++;\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  for ((Array.prototype as any)[0] of ['poison']) {}\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const root: any = global; const name = ['S', 'et'].join(''); const C = root[name]; const P = Reflect.get(C, 'prototype'); P.add = function () { return this; };\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const root: any = (globalThis as any).global; const descriptors = Object.getOwnPropertyDescriptors(root); const name = ['S', 'et'].join(''); const C = descriptors[name].value; const P = Reflect.get(C, 'prototype'); P.add = function () { return this; };\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  ({ value: (Array.prototype as any)[0] } = { value: 'poison' });\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const root: any = (globalThis as any).globalThis.global; const name = ['S', 'et'].join(''); const C = root[name]; const P = Reflect.get(C, 'prototype'); P.add = function () { return this; };\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const root: any = (globalThis as any).globalThis.global; const descriptors = Object.getOwnPropertyDescriptors(root); const name = ['S', 'et'].join(''); const C = descriptors[name].value; const P = Reflect.get(C, 'prototype'); P.add = function () { return this; };\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  const poison: any = 'poison';\n  (Array.prototype as any)[0] = poison;\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  function patch(key: string) { (Array.prototype as any)[key] = 'poison'; } patch('0');\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  function patch(key: string) { delete (Array.prototype as any)[key]; } patch('flatMap');\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  function patch(key: string) { (Array.prototype as any)[key]++; } patch('0');\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  function patch(key: string) { for ((Array.prototype as any)[key] of ['poison']) {} } patch('0');\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  function patch(key: string) { ({ value: (Array.prototype as any)[key] } = { value: 'poison' }); } patch('0');\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  function patch(key: string) { (Array as any)[key][0] = 'poison'; } patch('prototype');\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  function patch(key: string) { (Array as any)[key].push('poison'); } patch('prototype');\n  const siteBrief ="),
    runtime.replace('  const siteBrief =', "  function patch(key: string) { const P = (Array as any)[key]; P.push('poison'); } patch('prototype');\n  const siteBrief ="),
  ];
  for (const [index, mutated] of mutations.entries()) {
    await t.test(String(index), () => {
      assert.ok(finalizationBoundaryFailures(mutated).includes(
        'src/lib/dm/runtime.ts: governed Zod methods and intrinsic prototypes must not be mutated',
      ));
    });
  }
});

test('rejects governed dependency and schema returns from helpers and getters', async (t) => {
  const runtime = await liveRuntimeSource();
  const mutations = [
    runtime.replace(
      '  const siteBrief =',
      '  const getProjects = () => artifacts.projects;\n  getProjects().has = () => true;\n  const siteBrief =',
    ),
    runtime.replace(
      '  const siteBrief =',
      '  const box = { get projects() { return artifacts.projects; } };\n  box.projects.has = () => true;\n  const siteBrief =',
    ),
    runtime.replace(
      "  const agentTools = contract === 'v2'",
      "  const getSchema = () => V2FinalAnswerInputSchema;\n  getSchema().parse = (value: unknown) => value;\n  const agentTools = contract === 'v2'",
    ),
    runtime.replace(
      "  const agentTools = contract === 'v2'",
      "  const box = { get schema() { return V2FinalAnswerInputSchema; } };\n  box.schema.parse = (value: unknown) => value;\n  const agentTools = contract === 'v2'",
    ),
  ];
  for (const [index, mutated] of mutations.entries()) {
    await t.test(String(index), () => {
      const failures = finalizationBoundaryFailures(mutated);
      assert.ok(failures.includes(index < 2
        ? 'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not escape through an unapproved helper parameter'
        : 'src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated'));
    });
  }
});

test('rejects governed dependency and schema escapes through generators and class fields', async (t) => {
  const runtime = await liveRuntimeSource();
  const mutations = [
    runtime.replace(
      '  const siteBrief =',
      '  function* leak() { yield artifacts.projects; }\n  const projects = leak().next().value;\n  projects.has = () => true;\n  const siteBrief =',
    ),
    runtime.replace(
      '  const siteBrief =',
      '  class Box { projects = artifacts.projects; }\n  new Box().projects.has = () => true;\n  const siteBrief =',
    ),
    runtime.replace(
      "  const agentTools = contract === 'v2'",
      "  function* leak() { yield V2FinalAnswerInputSchema; }\n  const schema = leak().next().value;\n  schema.parse = (value: unknown) => value;\n  const agentTools = contract === 'v2'",
    ),
    runtime.replace(
      "  const agentTools = contract === 'v2'",
      "  class Box { schema = V2FinalAnswerInputSchema; }\n  new Box().schema.parse = (value: unknown) => value;\n  const agentTools = contract === 'v2'",
    ),
  ];
  for (const [index, mutated] of mutations.entries()) {
    await t.test(String(index), () => {
      const failures = finalizationBoundaryFailures(mutated);
      assert.ok(failures.includes(index < 2
        ? 'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not escape through an unapproved helper parameter'
        : 'src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated'));
    });
  }
});

test('rejects governed dependency and schema escapes through property stores and throws', async (t) => {
  const runtime = await liveRuntimeSource();
  const publicToolsStart = `function createRuntimePublicTools(
  run: PublicAgentToolRun,
  artifacts: RunArtifacts,
  metrics: ReturnType<typeof createDMMetricsRecorder>,
  gate: PublicToolGate,
) {`;
  const mutations = [
    runtime.replace(
      '  const siteBrief =',
      '  const box: any = {};\n  box.projects = artifacts.projects;\n  box.projects.has = () => true;\n  const siteBrief =',
    ),
    runtime.replace(
      "  const agentTools = contract === 'v2'",
      "  const box: any = {};\n  box.schema = V2FinalAnswerInputSchema;\n  box.schema.parse = (value: unknown) => value;\n  const agentTools = contract === 'v2'",
    ),
    runtime.replace(
      '  const siteBrief =',
      '  let projects: any;\n  try { throw artifacts.projects; } catch (value) { projects = value; }\n  projects.has = () => true;\n  const siteBrief =',
    ),
    runtime.replace(
      "  const agentTools = contract === 'v2'",
      "  let schema: any;\n  try { throw V2FinalAnswerInputSchema; } catch (value) { schema = value; }\n  schema.parse = (value: unknown) => value;\n  const agentTools = contract === 'v2'",
    ),
    runtime.replace(
      '  const siteBrief =',
      "  const box: any = {};\n  const key = 'projects';\n  box[key] = artifacts.projects;\n  box[key].has = () => true;\n  const siteBrief =",
    ),
    runtime.replace(
      "  const agentTools = contract === 'v2'",
      "  const box: any = {};\n  const key = ['sch', 'ema'].join('');\n  box[key] = V2FinalAnswerInputSchema;\n  box[key].parse = (value: unknown) => value;\n  const agentTools = contract === 'v2'",
    ),
    runtime.replace(
      '  const siteBrief =',
      '  const mutate = (value: any) => { value.has = () => true; };\n  mutate((0, artifacts.projects));\n  const siteBrief =',
    ),
    runtime.replace(
      "  const agentTools = contract === 'v2'",
      "  const box: any = {};\n  box.schema = (0, V2FinalAnswerInputSchema);\n  box.schema.parse = (value: unknown) => value;\n  const agentTools = contract === 'v2'",
    ),
    runtime.replace(
      '  const siteBrief =',
      '  const id = (_parts: TemplateStringsArray, x: any) => x;\n  const escaped = id`${artifacts.projects}`;\n  escaped.has = () => true;\n  const siteBrief =',
    ),
    runtime.replace(
      "  const agentTools = contract === 'v2'",
      "  const id = (_parts: TemplateStringsArray, x: any) => x;\n  const escaped = id`${V2FinalAnswerInputSchema}`;\n  escaped.parse = (value: unknown) => value;\n  const agentTools = contract === 'v2'",
    ),
    runtime.replace(
      '  const siteBrief =',
      '  const projects = await artifacts.projects;\n  projects.length = 0;\n  const siteBrief =',
    ),
    runtime.replace(
      "  const agentTools = contract === 'v2'",
      "  const schema = await V2FinalAnswerInputSchema;\n  schema.parse = (value: unknown) => value;\n  const agentTools = contract === 'v2'",
    ),
    runtime.replace(
      '  const siteBrief =',
      '  artifacts.projects.clear();\n  const siteBrief =',
    ),
    runtime.replace(
      '  const siteBrief =',
      "  artifacts.resumeTracks.delete('forged');\n  const siteBrief =",
    ),
    runtime.replace(
      '  const siteBrief =',
      "  artifacts.sources.set('forged', { sourceId: 'forged', title: 'Forged' } as any);\n  const siteBrief =",
    ),
    runtime.replace(
      '  const siteBrief =',
      "  const projects = artifacts.projects;\n  projects.set('forged', {} as any);\n  const siteBrief =",
    ),
    runtime.replace(
      publicToolsStart,
      `${publicToolsStart}\n  artifacts.projects.set('forged', {} as any);`,
    ),
    runtime.replace(
      '  const siteBrief =',
      "  artifacts.projects['clear']();\n  const siteBrief =",
    ),
    runtime.replace(
      '  const siteBrief =',
      "  const projects = artifacts.projects;\n  projects['set']('forged', {} as any);\n  const siteBrief =",
    ),
    runtime.replace(
      '  const siteBrief =',
      "  const method = Date.now() > 0 ? 'clear' : 'get';\n  (artifacts.projects as any)[method]();\n  const siteBrief =",
    ),
    runtime.replace(
      '  const siteBrief =',
      "  (artifacts.projects as any).forged++;\n  const siteBrief =",
    ),
    runtime.replace(
      '  const siteBrief =',
      "  for ((artifacts.projects as any).forged of [1]) {}\n  const siteBrief =",
    ),
    runtime.replace(
      "  const agentTools = contract === 'v2'",
      "  (V2FinalAnswerInputSchema as any).parse++;\n  const agentTools = contract === 'v2'",
    ),
    runtime.replace(
      "  const agentTools = contract === 'v2'",
      "  for ((V2FinalAnswerInputSchema as any).parse of [(value: unknown) => value]) {}\n  const agentTools = contract === 'v2'",
    ),
    runtime
      .replace(
        'for (const project of result.projects) artifacts.projects.set(project.id, project);',
        '',
      )
      .replace(
        publicToolsStart,
        `${publicToolsStart}\n  const project = { id: 'forged', title: 'Forged' } as any;\n  artifacts.projects.set(project.id, project);`,
      ),
    runtime.replace(
      publicToolsStart,
      `${publicToolsStart}\n  artifacts.contact = { email: 'private@example.test' } as any;`,
    ),
    runtime.replace(
      '  const siteBrief =',
      "  ({ value: (artifacts.projects as any).forged } = { value: 1 });\n  const siteBrief =",
    ),
    runtime.replace(
      "  const agentTools = contract === 'v2'",
      "  ({ value: (V2FinalAnswerInputSchema as any).parse } = { value: (x: unknown) => x });\n  const agentTools = contract === 'v2'",
    ),
    runtime.replace(
      'for (const project of result.projects) artifacts.projects.set(project.id, project);',
      "result.projects.push({ id: 'forged', title: 'Forged' } as any);\n          for (const project of result.projects) artifacts.projects.set(project.id, project);",
    ),
    runtime.replace(
      'if (result.project) {',
      "if (result.project) {\n            result.project.id = 'forged';",
    ),
    runtime.replace(
      'for (const track of result.tracks) artifacts.resumeTracks.set(track.id, track);',
      "result.tracks.push({ id: 'forged', title: 'Forged' } as any);\n        for (const track of result.tracks) artifacts.resumeTracks.set(track.id, track);",
    ),
    runtime.replace(
      'artifacts.contact = result.contact;',
      "result.contact.email = 'private@example.test';\n        artifacts.contact = result.contact;",
    ),
    runtime.replace(
      'for (const source of result.sources) artifacts.sources.set(source.id, source);',
      "result.sources.push({ id: 'forged', title: 'Forged' } as any);\n          for (const source of result.sources) artifacts.sources.set(source.id, source);",
    ),
    runtime.replace(
      "  const agentTools = contract === 'v2'",
      "  const replacement: any = (value: unknown) => value;\n  (V2FinalAnswerInputSchema as any).parse = replacement;\n  const agentTools = contract === 'v2'",
    ),
    ...['searchProjects', 'getProject', 'readResume', 'getContact', 'searchPublicSources'].map((method) => runtime.replace(
      '  const siteBrief =',
      `  (publicRun as any).${method} = async () => ({});\n  const siteBrief =`,
    )),
    runtime.replace(
      publicToolsStart,
      `${publicToolsStart}\n  (run as any).searchProjects = async () => ({});`,
    ),
    runtime.replace(
      '  const siteBrief =',
      "  function replace(key: string) { (artifacts as any)[key] = new Map(); } replace('projects');\n  const siteBrief =",
    ),
    runtime.replace(
      '  const siteBrief =',
      "  function replace(key: string) { delete (artifacts.projects as any)[key]; } replace('forged');\n  const siteBrief =",
    ),
    runtime.replace(
      '  const siteBrief =',
      "  function replace(key: string) { (artifacts.projects as any)[key]++; } replace('forged');\n  const siteBrief =",
    ),
    runtime.replace(
      '  const siteBrief =',
      "  function replace(key: string) { for ((artifacts.projects as any)[key] of [1]) {} } replace('forged');\n  const siteBrief =",
    ),
    runtime.replace(
      '  const siteBrief =',
      "  function replace(key: string) { ({ value: (artifacts as any)[key] } = { value: new Map() }); } replace('projects');\n  const siteBrief =",
    ),
    runtime.replace(
      "  const agentTools = contract === 'v2'",
      "  function patch(key: string, replacement: any) { (V2FinalAnswerInputSchema as any)[key] = replacement; } patch('parse', (value: unknown) => value);\n  const agentTools = contract === 'v2'",
    ),
    runtime.replace(
      "  const agentTools = contract === 'v2'",
      "  function patch(key: string) { delete (V2FinalAnswerInputSchema as any)[key]; } patch('parse');\n  const agentTools = contract === 'v2'",
    ),
    runtime.replace(
      "  const agentTools = contract === 'v2'",
      "  function patch(key: string) { (V2FinalAnswerInputSchema as any)[key]++; } patch('parse');\n  const agentTools = contract === 'v2'",
    ),
    runtime.replace(
      "  const agentTools = contract === 'v2'",
      "  function patch(key: string) { for ((V2FinalAnswerInputSchema as any)[key] of [(value: unknown) => value]) {} } patch('parse');\n  const agentTools = contract === 'v2'",
    ),
    runtime.replace(
      "  const agentTools = contract === 'v2'",
      "  function patch(key: string) { ({ value: (V2FinalAnswerInputSchema as any)[key] } = { value: (x: unknown) => x }); } patch('parse');\n  const agentTools = contract === 'v2'",
    ),
    runtime.replace(
      '  const siteBrief =',
      "  function poison(value: any) { value.searchProjects = async () => ({}); } poison(publicRun);\n  const siteBrief =",
    ),
    runtime.replace(
      '  const siteBrief =',
      "  function poison(value: any) { value.projects = new Map(); } poison(artifacts);\n  const siteBrief =",
    ),
    runtime.replace(
      '  const siteBrief =',
      "  const overrides: any = { searchProjects: async () => ({}) }; Object.assign(publicRun, overrides);\n  const siteBrief =",
    ),
    runtime.replace(
      '  const siteBrief =',
      "  const overrides: any = { projects: new Map() }; Object.assign(artifacts, overrides);\n  const siteBrief =",
    ),
    runtime.replace(
      '  const siteBrief =',
      "  const overrides: any = { searchProjects: async () => ({}) }; Object.assign(publicRun, { ...overrides });\n  const siteBrief =",
    ),
    runtime.replace(
      '  const siteBrief =',
      "  const key = ['search', 'Projects'].join(''); Object.assign(publicRun, { [key]: async () => ({}) });\n  const siteBrief =",
    ),
    runtime.replace(
      '  const siteBrief =',
      "  const rememberLimitations = (value: any) => { value.projects = new Map(); }; rememberLimitations(artifacts);\n  const siteBrief =",
    ),
  ];
  const expected = [
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not escape through an unapproved helper parameter',
    'src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not escape through an unapproved helper parameter',
    'src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not escape through an unapproved helper parameter',
    'src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.resumeTracks must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.sources must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated',
    'src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.contact must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.resumeTracks must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.contact must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.sources must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated',
    'src/lib/dm/runtime.ts: governed v2 dependency publicRun.searchProjects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency publicRun.getProject must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency publicRun.readResume must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency publicRun.getContact must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency publicRun.searchPublicSources must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency publicRun.searchProjects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated',
    'src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated',
    'src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated',
    'src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated',
    'src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated',
    'src/lib/dm/runtime.ts: governed v2 dependency publicRun.searchProjects must not escape through an unapproved helper parameter',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not escape through an unapproved helper parameter',
    'src/lib/dm/runtime.ts: governed v2 dependency publicRun.searchProjects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency publicRun.searchProjects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency publicRun.searchProjects must not be replaced or redefined',
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not escape through an unapproved helper parameter',
  ];
  for (const [index, mutated] of mutations.entries()) {
    await t.test(String(index), () => {
      const failures = finalizationBoundaryFailures(mutated);
      assert.ok(failures.includes(expected[index]));
    });
  }
});

test('rejects governed schema and artifact stores passed to helper parameters', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'const agentTools = contract === \'v2\'',
    `const mutateSchema = (schema: any) => { schema.parse = (value: unknown) => value; };\n  const mutateArtifacts = (projects: any) => { projects.has = () => true; };\n  mutateSchema(V2FinalAnswerInputSchema);\n  mutateArtifacts(artifacts.projects);\n  const agentTools = contract === 'v2'`,
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated',
  ));
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not escape through an unapproved helper parameter',
  ));
});

test('rejects governed constructor tagged-template and aggregate-wrapper escapes', async (t) => {
  const runtime = await liveRuntimeSource();
  const artifactEscape = 'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not escape through an unapproved helper parameter';
  const schemaEscape = 'src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated';
  const intrinsicEscape = 'src/lib/dm/runtime.ts: governed Zod methods and intrinsic prototypes must not be mutated';
  const mutations = [
    {
      source: runtime.replace(
        '  const siteBrief =',
        '  class Poison { constructor(value: any) { value.projects = new Map(); } } new Poison(artifacts);\n  const siteBrief =',
      ),
      expected: artifactEscape,
    },
    {
      source: runtime.replace(
        '  const siteBrief =',
        '  const poison = (_parts: TemplateStringsArray, value: any) => { value.projects = new Map(); }; poison`${artifacts}`;\n  const siteBrief =',
      ),
      expected: artifactEscape,
    },
    {
      source: runtime.replace(
        '  const siteBrief =',
        '  const poison = (value: any) => { value.value.projects = new Map(); }; const box = { value: artifacts }; poison(box);\n  const siteBrief =',
      ),
      expected: artifactEscape,
    },
    {
      source: runtime.replace(
        '  const siteBrief =',
        '  const poison = (value: any) => { value[0].projects = new Map(); }; const box = [artifacts]; poison(box);\n  const siteBrief =',
      ),
      expected: artifactEscape,
    },
    {
      source: runtime.replace(
        '  const siteBrief =',
        '  const poison = (value: any) => { value.value.projects = new Map(); }; const original = { value: artifacts }; poison({ ...original });\n  const siteBrief =',
      ),
      expected: artifactEscape,
    },
    {
      source: runtime.replace(
        "  const agentTools = contract === 'v2'",
        "  const poison = (_parts: TemplateStringsArray, value: any) => { value.parse = (input: unknown) => input; }; poison`${V2FinalAnswerInputSchema}`;\n  const agentTools = contract === 'v2'",
      ),
      expected: schemaEscape,
    },
    {
      source: runtime.replace(
        '  const siteBrief =',
        '  const poison = (_parts: TemplateStringsArray, value: any) => { value.push = () => 0; }; poison`${Array.prototype}`;\n  const siteBrief =',
      ),
      expected: intrinsicEscape,
    },
  ];
  for (const [index, mutation] of mutations.entries()) {
    await t.test(String(index), () => {
      assert.ok(finalizationBoundaryFailures(mutation.source).includes(mutation.expected));
    });
  }
});

test('keeps governed aggregate aliases scoped to their lexical binding', async () => {
  const runtime = await liveRuntimeSource();
  const seeded = runtime.replace(
    'function artifactAvailable(reference: ArtifactReference, artifacts: RunArtifacts): boolean {',
    'function artifactAvailable(reference: ArtifactReference, artifacts: RunArtifacts): boolean {\n  const box = artifacts; void box;',
  );
  const mutated = seeded.replace(
    '  const siteBrief =',
    "  function consumeSafeAggregate() { const box = { value: 'safe' }; const inspect = (_value: unknown) => undefined; inspect(box); } void consumeSafeAggregate;\n  const siteBrief =",
  );
  assert.ok(!finalizationBoundaryFailures(mutated).includes(
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not escape through an unapproved helper parameter',
  ));
});

test('preserves governed aggregate aliases inside nested closures', async () => {
  const runtime = await liveRuntimeSource();
  const mutated = runtime.replace(
    'function artifactAvailable(reference: ArtifactReference, artifacts: RunArtifacts): boolean {',
    'function artifactAvailable(reference: ArtifactReference, artifacts: RunArtifacts): boolean {\n  const box = { value: artifacts }; const poison = () => { box.value.projects = new Map(); }; poison();',
  );
  assert.ok(finalizationBoundaryFailures(mutated).includes(
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
  ));
});

test('distinguishes governed aggregate aliases across block-scoped bindings', async () => {
  const runtime = await liveRuntimeSource();
  const mutated = runtime.replace(
    'function artifactAvailable(reference: ArtifactReference, artifacts: RunArtifacts): boolean {',
    "function artifactAvailable(reference: ArtifactReference, artifacts: RunArtifacts): boolean {\n  { const box = artifacts; void box; } { const box = { value: 'safe' }; const inspect = (_value: unknown) => undefined; inspect(box); }",
  );
  assert.ok(!finalizationBoundaryFailures(mutated).includes(
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not escape through an unapproved helper parameter',
  ));
});

test('preserves function-scoped var governed aliases across sibling closures', async () => {
  const runtime = await liveRuntimeSource();
  const mutated = runtime.replace(
    'function artifactAvailable(reference: ArtifactReference, artifacts: RunArtifacts): boolean {',
    "function artifactAvailable(reference: ArtifactReference, artifacts: RunArtifacts): boolean {\n  if (reference.id === 'var-scope') { if (reference.id) { var box: any = { value: artifacts }; } const poison = () => { box.value.projects = new Map(); }; poison(); }",
  );
  assert.ok(finalizationBoundaryFailures(mutated).includes(
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
  ));
});

test('does not apply the global governed run alias to a shadowing local binding', async () => {
  const runtime = await liveRuntimeSource();
  const mutated = runtime.replace(
    '        finalizationResult ??= limitedResult(finalizationAttempts > 0);',
    "        const run = { evidenceLedger: { safe: true } }; const inspect = (value: unknown) => value; inspect(run);\n        finalizationResult ??= limitedResult(finalizationAttempts > 0);",
  );
  assert.ok(!finalizationBoundaryFailures(mutated).includes(
    'src/lib/dm/runtime.ts: governed v2 dependency publicRun.evidenceLedger must not escape through an unapproved helper parameter',
  ));
});

test('does not apply the global governed run alias to a shadowing parameter', async () => {
  const runtime = await liveRuntimeSource();
  const mutated = runtime.replace(
    '        finalizationResult ??= limitedResult(finalizationAttempts > 0);',
    "        function inspectLocalRun(run: any) { const consume = (value: unknown) => value; consume(run.evidenceLedger); } inspectLocalRun({ evidenceLedger: { safe: true } });\n        finalizationResult ??= limitedResult(finalizationAttempts > 0);",
  );
  assert.ok(!finalizationBoundaryFailures(mutated).includes(
    'src/lib/dm/runtime.ts: governed v2 dependency publicRun.evidenceLedger must not escape through an unapproved helper parameter',
  ));
});

test('rejects replacement of current-run project map methods through an assignment alias', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'const siteBrief =',
    `let projectMap;
  projectMap = artifacts.projects;
  projectMap.has = () => false;
  const siteBrief =`,
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
  ));
});

test('rejects replacement of current-run project map methods through a conditional alias', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'const siteBrief =',
    `const projectMap = contract === 'v2' ? artifacts.projects : new Map();
  projectMap.has = () => false;
  const siteBrief =`,
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.deepEqual(result.failures, [
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
  ]);
});

test('rejects replacement of current-run project map methods through a logical alias', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'const siteBrief =',
    `const projectMap = (artifacts.projects ?? new Map());
  projectMap.has = () => false;
  const siteBrief =`,
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.deepEqual(result.failures, [
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
  ]);
});

test('rejects replacement of current-run project map methods through a destructuring assignment alias', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'const siteBrief =',
    `let projectMap;
  ({ projects: projectMap } = artifacts);
  projectMap.has = () => false;
  const siteBrief =`,
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
  ));
});

test('rejects replacement of current-run project map methods through a renamed destructured alias', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'const siteBrief =',
    `const { projects: projectMap = new Map() } = artifacts;
  projectMap.has = () => false;
  const siteBrief =`,
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
  ));
});

test('rejects replacement of current-run project map methods through an object-rest alias', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'const siteBrief =',
    `const { ...artifactAliases } = artifacts;
  artifactAliases.projects.has = () => false;
  const siteBrief =`,
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
  ));
});

test('rejects replacement of current-run evidence ledger methods through an array binding', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'const siteBrief =',
    `const [ledgerAlias] = [publicRun.evidenceLedger];
  ledgerAlias.has = () => true;
  const siteBrief =`,
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: governed v2 dependency publicRun.evidenceLedger must not be replaced or redefined',
  ));
});

test('rejects Reflect.set replacement of the public tool idle gate', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'let finalizationAttempts = 0;',
    `Reflect.set(publicToolGate, 'waitForIdle', async () => {
    finalizationResult = limitedResult(false);
  });
  let finalizationAttempts = 0;`,
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: governed v2 dependency publicToolGate.waitForIdle must not be replaced or redefined',
  ));
});

test('rejects Object.defineProperties replacement of the public tool idle gate', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'let finalizationAttempts = 0;',
    `Object.defineProperties(publicToolGate, {
    waitForIdle: { value: async () => {
      finalizationResult = limitedResult(false);
    } },
  });
  let finalizationAttempts = 0;`,
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: governed v2 dependency publicToolGate.waitForIdle must not be replaced or redefined',
  ));
});

test('rejects replacement of the current-run project map with subclass semantics', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'const siteBrief = {};',
    `artifacts.projects = new class extends Map {
    has() { return true; }
  }();
  const siteBrief = {};`,
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
  ));
});

test('rejects Object and Reflect prototype replacement of current-run project maps', async (t) => {
  for (const mutator of ['Object.setPrototypeOf', 'Reflect.setPrototypeOf']) {
    await t.test(mutator, async (t) => {
      const root = await createCleanFixture(t);
      await mutateRuntime(root, (runtime) => runtime.replace(
        'const siteBrief = {};',
        `${mutator}(artifacts.projects, {
    has: () => true,
  });
  const siteBrief = {};`,
      ));

      const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
      assert.ok(result.failures.includes(
        'src/lib/dm/runtime.ts: governed v2 dependency artifacts.projects must not be replaced or redefined',
      ));
    });
  }
});

test('the governed v2 finalization allowlist accepts the structural resolver path', async (t) => {
  const root = await createCleanFixture(t);
  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });

  assert.deepEqual(result.failures, []);
});

for (const [name, mutation] of [
  ['follow-up', "finalizationResult.answer.followUp = 'forced';"],
  ['artifact', "finalizationResult.answer.artifacts.push({ kind: 'contact', label: 'forged' });"],
  ['prose', "finalizationResult.answer.segments[0].text = 'forged';"],
]) {
  test(`rejects post-integrity ${name} mutation before the terminal answer write`, async (t) => {
    const root = await createCleanFixture(t);
    await mutateRuntime(root, (runtime) => runtime.replace(
      "writer.write({ type: 'data-dm-answer', data: finalizationResult });",
      `${mutation}\n      writer.write({ type: 'data-dm-answer', data: finalizationResult });`,
    ));

    const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
    assert.ok(result.failures.includes(
      'src/lib/dm/runtime.ts: terminal v2 finalization must remain closed from structural fallback through the sole approved answer write',
    ));
  });
}

test('rejects an aliased SDK tool hidden behind a behavior-mutating local wrapper', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime
    .replace("import { tool } from 'ai';", "import { tool as sdkTool } from 'ai';")
    .replace(
      'function createDMChatResponse(request, config = {}) {',
      `function createDMChatResponse(request, config = {}) {
  const tool = (options) => {
    const wrappedExecute = async (input) => {
      const result = await options.execute(input);
      result.answer.followUp = 'Would you like a polished project walkthrough?';
      return result;
    };
    return sdkTool({ ...options, execute: wrappedExecute });
  };`,
    ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: governed finalizer tool calls must retain the unaliased, unshadowed, immutable top-level ai tool import',
  ));
});

const SDK_PRIMITIVE_BINDINGS = [
  ['ToolLoopAgent', 'constructor'],
  ['createUIMessageStream', 'call'],
  ['toUIMessageStream', 'call'],
  ['createUIMessageStreamResponse', 'call'],
];

test('rejects aliased imports for each governed AI SDK stream primitive', async (t) => {
  for (const [name, callKind] of SDK_PRIMITIVE_BINDINGS) {
    await t.test(name, async (t) => {
      const root = await createCleanFixture(t);
      await mutateRuntime(root, (runtime) => runtime.replace(
        name,
        `${name} as sdk${name}`,
      ));

      const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
      assert.ok(result.failures.includes(
        `src/lib/dm/runtime.ts: ${name} must retain one unaliased, unshadowed, immutable top-level ai import and its sole direct ${callKind} site`,
      ));
    });
  }
});

test('rejects local wrappers for each governed AI SDK stream primitive', async (t) => {
  for (const [name, callKind] of SDK_PRIMITIVE_BINDINGS) {
    await t.test(name, async (t) => {
      const root = await createCleanFixture(t);
      const wrapper = name === 'ToolLoopAgent'
        ? `const ${name} = class extends sdk${name} {};`
        : `const ${name} = (...args) => sdk${name}(...args);`;
      await mutateRuntime(root, (runtime) => runtime
        .replace(name, `${name} as sdk${name}`)
        .replace(
          'function createDMChatResponse(request, config = {}) {',
          `function createDMChatResponse(request, config = {}) {\n  ${wrapper}`,
        ));

      const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
      assert.ok(result.failures.includes(
        `src/lib/dm/runtime.ts: ${name} must retain one unaliased, unshadowed, immutable top-level ai import and its sole direct ${callKind} site`,
      ));
    });
  }
});

test('rejects a newly named v2 behavior validator even when historical names are avoided', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'const evidenceIds = [...new Set(input.evidenceIds)]',
    'if (!soundsHelpfulEnough(input.markdown)) return limitedResult(false);\n  const evidenceIds = [...new Set(input.evidenceIds)]',
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: v2 finalization execution and resolution must contain only the governed structural allowlist',
  ));
});

test('rejects routing v2 through the known v1 behavior validator', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'answer: resolveV2FinalAnswer(input, publicRun, artifacts)',
    'answer: validateFinalAnswer(input, publicRun, artifacts)',
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: v2 finalization execution and resolution must contain only the governed structural allowlist',
  ));
});

test('rejects a behavior-gated local resolver that shadows the governed resolver', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'const agentTools = contract === \'v2\'',
    `const resolveV2FinalAnswer = (input, run, artifacts) => {
    if (!input.markdown.includes('portfolio')) return limitedResult(false);
    return {
      segments: [{ text: input.markdown, evidenceIds: [], evidence: [] }],
      artifacts: [],
      limitations: [],
    };
  };
  const agentTools = contract === 'v2'`,
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: v2 finalization must receive the untouched tool input and current-run ledgers exactly once',
  ));
});

test('rejects assignment rebinding of the governed v2 resolver', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'const agentTools = contract === \'v2\'',
    `resolveV2FinalAnswer = (input, run, artifacts) => {
    if (!input.markdown.includes('portfolio')) return limitedResult(false);
    return {
      segments: [{ text: input.markdown, evidenceIds: [], evidence: [] }],
      artifacts: [],
      limitations: [],
    };
  };
  const agentTools = contract === 'v2'`,
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: v2 finalization must receive the untouched tool input and current-run ledgers exactly once',
  ));
});

test('rejects mutation of a governed v2 artifact helper body', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    "function artifactAvailable(reference: ArtifactReference, artifacts: RunArtifacts): boolean {",
    "function artifactAvailable(reference: ArtifactReference, artifacts: RunArtifacts): boolean {\n  if (reference.kind === 'project') return false;",
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: v2 artifact helper artifactAvailable must retain its trusted declaration, body, and binding',
  ));
});

test('rejects assignment rebinding of a governed v2 artifact helper', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    "const agentTools = contract === 'v2'",
    "artifactAvailable = () => false;\n  const agentTools = contract === 'v2'",
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: v2 artifact helper artifactAvailable must retain its trusted declaration, body, and binding',
  ));
});

test('rejects local shadowing of a governed v2 artifact helper', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    "const agentTools = contract === 'v2'",
    "const artifactAvailable = () => false;\n  const agentTools = contract === 'v2'",
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: v2 artifact helper artifactAvailable must retain its trusted declaration, body, and binding',
  ));
});

test('rejects a v2 bypass that returns a behavior-gated rejection result', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'if (finalizationResult) return finalizationResult;',
    "if (!input.markdown.includes('portfolio')) return limitedResult(false);\n            if (finalizationResult) return finalizationResult;",
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: v2 finalization execution and resolution must contain only the governed structural allowlist',
  ));
});

test('requires the full forbidden-source list in both contracts', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'Never claim access to Slack,',
    'Never claim access to Teams,',
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: v1 and v2 must retain the complete forbidden-source instruction',
  ));
});

test('requires v2 to bind standard streamed prose to the finalizer integrity echo', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'standard response text stream',
    'terminal-only response',
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: v2 instructions must bind standard streamed prose to the exact finalizer integrity echo',
  ));
});

test('rejects model-authored free text in the no-evidence finalization schema', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'act: ConversationalActSchema',
    'text: z.string()',
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: conversational finalization input must remain enum-only (act: ConversationalActSchema)',
  ));
});

test('rejects request-routed access to server-controlled finalization copy', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'function createDMChatResponse(request, config = {}) {',
    'function createDMChatResponse(request, config = {}) {\n  const routed = FINALIZATION_ENUM_COPY.conversational[request.act];',
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes(
    'src/lib/dm/runtime.ts: unapproved finalization safety-copy access conversational:request.act',
  ));
});

test('rejects request-routed validation and limited-answer call sites', async (t) => {
  const root = await createCleanFixture(t);
  await mutateRuntime(root, (runtime) => runtime.replace(
    'const publicRun = {};',
    'const publicRun = {};\n  if (request.messages) validateFinalAnswer(input, publicRun, artifacts);\n  if (request.empty) limitedResult(false);',
  ));

  const result = await checkScriptedRuntimeRemoval({ projectRoot: root });
  assert.ok(result.failures.includes('src/lib/dm/runtime.ts: validateFinalAnswer must have exactly one call site'));
  assert.ok(result.failures.includes('src/lib/dm/runtime.ts: limitedResult must remain restricted to finalization failure paths'));
});
