import { access, readFile } from 'node:fs/promises';
import process from 'node:process';

const REMOVED_FILES = [
  'src/lib/dm/grounding.ts',
  'src/lib/dm/data-tools.ts',
  'src/lib/dm/eval-fixtures.ts',
  'tests/dm-grounding.test.ts',
];
const CUTOVER_FILES = [
  'src/lib/dm/runtime.ts',
  'src/lib/dm/contract.ts',
  'src/lib/dm/client.ts',
  'src/scripts/dm.ts',
  'src/pages/api/dm/chat.ts',
  'scripts/dm-eval.ts',
  'scripts/dm-benchmark.ts',
];
const FORBIDDEN = [
  'ProjectDraft',
  'ProjectFactPacket',
  'requestNeedsProjectFacts',
  'projectPacketPrompt',
  'validateProjectDraft',
  'enforceProjectDraft',
  'renderProjectDraft',
  'deterministicProjectFallback',
  'invalidProjectDraftFallback',
  'deterministicBlocks',
  'deterministicPublicInfoAnswer',
  'createPublicDMDataTools',
  'ToolTraceItem',
  'DMStreamEvent',
  'createDMChatStream',
  'parseStreamLine',
  'readNdjson',
  'application/x-ndjson',
  'PROJECT_FACT_PACKET=',
];

const failures = [];
for (const path of REMOVED_FILES) {
  try {
    await access(path);
    failures.push(`${path}: removed file still exists`);
  } catch {
    // Absence is the contract.
  }
}

const source = (await Promise.all(CUTOVER_FILES.map(async (path) => [path, await readFile(path, 'utf8')])));
for (const [path, text] of source) {
  for (const symbol of FORBIDDEN) {
    if (text.includes(symbol)) failures.push(`${path}: forbidden scripted-runtime token ${symbol}`);
  }
}

const runtime = await readFile('src/lib/dm/runtime.ts', 'utf8');
const client = await readFile('src/scripts/dm.ts', 'utf8');
if (!runtime.includes('new ToolLoopAgent')) failures.push('src/lib/dm/runtime.ts: ToolLoopAgent is not instantiated');
if (!runtime.includes('createPublicAgentTools')) failures.push('src/lib/dm/runtime.ts: typed public tools are not bound into the loop');
if (!runtime.includes("type: 'data-dm-answer'")) failures.push('src/lib/dm/runtime.ts: typed answer data part is missing');
if (!client.includes('new DefaultChatTransport')) failures.push('src/scripts/dm.ts: standard UIMessage transport is missing');

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`DM scripted runtime removal verified across ${CUTOVER_FILES.length} cutover files.\n`);
