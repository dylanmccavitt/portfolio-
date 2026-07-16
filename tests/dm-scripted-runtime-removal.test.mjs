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
} from '../scripts/check-dm-scripted-runtime-removed.mjs';

const PROJECT_DRAFT_TOKEN = 'ProjectDraft';
const CHAT_STREAM_TOKEN = 'createDMChatStream';
const READ_NDJSON_TOKEN = 'readNdjson';
const NDJSON_MEDIA_TYPE = 'application/x-ndjson';

const CLEAN_RUNTIME_FIXTURE = `
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
const ArtifactReferenceSchema = {};
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
  artifacts: z.array(z.unknown()),
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
function createDMChatResponse(request, config = {}) {
  const contract = config.contract ?? 'v1';
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
          inputSchema: V2FinalAnswerInputSchema,
          execute: (input) => {
            finalizationResult = resolveV2FinalAnswer(input, publicRun, artifacts);
            return finalizationResult;
          },
        }),
      }
    : {
        finalizeAnswer: tool({
          inputSchema: FinalAnswerInputSchema,
          execute: (input) => {
            const validation = validateFinalAnswer(input, publicRun, artifacts);
            finalizationResult = limitedResult(true);
            return validation;
          },
        }),
      };
  const stream = createUIMessageStream({
    async execute({ writer }) {
      for (const chunk of []) {
        if (contract === 'v2' && isV2TextChunk(chunk)) v2Prose.forward(chunk, writer.write);
      }
      finalizationResult ??= limitedResult(finalizationAttempts > 0);
      const terminalMarkdown = finalizationResult?.answer?.segments?.[0]?.text ?? null;
      if (terminalMarkdown !== v2Prose.text) finalized = true;
      if (contract === 'v1') metrics.visibleOutput();
      writer.write({ type: 'data-dm-answer', data: finalizationResult });
    },
  });
  new ToolLoopAgent({
    instructions: buildDMSystemInstructions(siteBrief, contract),
    experimental_repairToolCall: async () => {
      if (contract === 'v2') {
        finalized = true;
        return null;
      }
      finalizationAttempts += 1;
      return null;
    },
  });
  createPublicAgentTools();
  return { agentTools, request, stream, finalized };
}
function resolveV2FinalAnswer(input, run, artifacts) {
  const evidenceIds = [...new Set(input.evidenceIds)].filter((id) => run.evidenceLedger.has(id));
  const artifactReferences = deduplicateArtifactReferences(input.artifacts)
    .filter((reference) => artifactAvailable(reference, artifacts));
  return {
    segments: [{ text: input.markdown, evidenceIds, evidence: run.evidenceLedger.resolve(evidenceIds) }],
    artifacts: artifactReferences.flatMap((reference) => resolveArtifact(reference, artifacts)),
    limitations: [],
  };
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
      claims: [{ id: REMOVAL_CLAIM_ID, statement: REMOVAL_CLAIM_STATEMENT }],
    })}\n`),
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
