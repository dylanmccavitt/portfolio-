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
import { tool } from 'ai';
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
    tools: agentTools,
    experimental_repairToolCall: async () => {
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
