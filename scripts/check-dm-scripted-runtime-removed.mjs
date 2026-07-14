import { readdir, readFile, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import process from 'node:process';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

export const REMOVED_FILES = [
  'src/lib/dm/grounding.ts',
  'src/lib/dm/data-tools.ts',
  'src/lib/dm/eval-fixtures.ts',
  'tests/dm-grounding.test.ts',
];

export const SOURCE_SCAN_ROOTS = [
  'src/lib/dm',
  'src/pages/api/dm',
  'src/scripts',
  'scripts',
];

export const BUILT_SCAN_ROOTS = [
  'dist',
  '.vercel/output/_functions',
  '.vercel/output/static',
  '.vercel/output/config.json',
];

export const FORBIDDEN_TOKENS = [
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

export const REMOVAL_CLAIM_ID = 'dm-legacy-scripted-runtime-removed';
export const REMOVAL_CLAIM_STATEMENT = 'the legacy scripted DM router, planner, request-routed deterministic answer generators, fake trace, canned answer fixtures, and custom NDJSON protocol are absent; model-selected no-evidence conversational, limitation, and follow-up content is restricted to finite enum-selected server-controlled copy materialized only by the validated finalization boundary';

const SUPERSEDED_REMOVAL_CLAIM_ID = 'dm-removed-scripted-runtime';
const CLAIMS_PATH = 'claims.json';
const CHECKER_PATH = 'scripts/check-dm-scripted-runtime-removed.mjs';
const FINALIZATION_COPY_IDENTIFIER = 'FINALIZATION_ENUM_COPY';
const EXPECTED_FINALIZATION_COPY_ACCESSES = new Map([
  ['conversational:segment.act', 1],
  ['limitation:segment.code', 1],
  ['limitation:code', 1],
  ['followUp:input.followUp', 1],
]);

function normalizePath(path) {
  return path.split(sep).join('/');
}

async function walkFiles(projectRoot, path) {
  const absolutePath = resolve(projectRoot, path);
  const pathStat = await stat(absolutePath);
  if (pathStat.isFile()) return [normalizePath(relative(projectRoot, absolutePath))];

  const files = [];
  const entries = await readdir(absolutePath, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = resolve(absolutePath, entry.name);
    const relativePath = normalizePath(relative(projectRoot, entryPath));
    if (entry.isDirectory()) files.push(...await walkFiles(projectRoot, relativePath));
    else if (entry.isFile() || entry.isSymbolicLink()) files.push(relativePath);
  }
  return files;
}

async function collectRoot(projectRoot, path, failures, missingHint = '') {
  try {
    const files = await walkFiles(projectRoot, path);
    if (files.length === 0) failures.push(`${path}: required scan root contains no files${missingHint}`);
    return files;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      failures.push(`${path}: required scan root is missing${missingHint}`);
      return [];
    }
    throw error;
  }
}

async function removedFileFailures(projectRoot) {
  const failures = [];
  for (const path of REMOVED_FILES) {
    try {
      await stat(resolve(projectRoot, path));
      failures.push(`${path}: removed file still exists`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return failures;
}

async function scanFiles(projectRoot, paths) {
  const failures = [];
  for (const path of paths) {
    const text = await readFile(resolve(projectRoot, path), 'utf8');
    for (const token of FORBIDDEN_TOKENS) {
      if (text.includes(token)) failures.push(`${path}: forbidden scripted-runtime token ${token}`);
    }
  }
  return failures;
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return name.getText();
}

function callIsNamed(node, name) {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name;
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function variableDeclaration(sourceFile, name) {
  let match = null;
  walk(sourceFile, (node) => {
    if (match || !ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) return;
    if (node.name.text === name) match = node;
  });
  return match;
}

function functionDeclaration(sourceFile, name) {
  let match = null;
  walk(sourceFile, (node) => {
    if (match || !ts.isFunctionDeclaration(node) || node.name?.text !== name) return;
    match = node;
  });
  return match;
}

function hasFunctionDeclarationAncestor(node, name) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name?.text === name) return true;
  }
  return false;
}

function enclosingExecuteProperty(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (
      (ts.isPropertyAssignment(current) || ts.isMethodDeclaration(current))
      && propertyNameText(current.name) === 'execute'
    ) return current;
  }
  return null;
}

function executeBelongsToCall(node, callName, containingProperty = null) {
  const execute = enclosingExecuteProperty(node);
  if (!execute || !ts.isObjectLiteralExpression(execute.parent)) return false;
  const call = execute.parent.parent;
  if (!callIsNamed(call, callName)) return false;
  if (containingProperty === null) return true;
  return ts.isPropertyAssignment(call.parent) && propertyNameText(call.parent.name) === containingProperty;
}

function callExpressionsNamed(sourceFile, name) {
  const calls = [];
  walk(sourceFile, (node) => {
    if (callIsNamed(node, name)) calls.push(node);
  });
  return calls;
}

function objectProperty(object, name) {
  return object.properties.find((property) => (
    ts.isPropertyAssignment(property) && propertyNameText(property.name) === name
  )) ?? null;
}

function strictObjectForKind(sourceFile, schemaName, kind) {
  const declaration = variableDeclaration(sourceFile, schemaName);
  if (!declaration?.initializer) return null;
  let match = null;
  walk(declaration.initializer, (node) => {
    if (match || !ts.isCallExpression(node) || node.arguments.length !== 1) return;
    if (!ts.isPropertyAccessExpression(node.expression)) return;
    if (!ts.isIdentifier(node.expression.expression) || node.expression.expression.text !== 'z' || node.expression.name.text !== 'strictObject') return;
    const object = node.arguments[0];
    if (!ts.isObjectLiteralExpression(object)) return;
    const kindProperty = objectProperty(object, 'kind');
    if (!kindProperty || !ts.isCallExpression(kindProperty.initializer)) return;
    const literalCall = kindProperty.initializer;
    if (!ts.isPropertyAccessExpression(literalCall.expression) || literalCall.expression.name.text !== 'literal') return;
    const value = literalCall.arguments[0];
    if (ts.isStringLiteral(value) && value.text === kind) match = object;
  });
  return match;
}

function schemaBoundaryFailures(sourceFile) {
  const failures = [];
  const expectations = [
    ['conversational', 'act', 'ConversationalActSchema'],
    ['limitation', 'code', 'LimitationCodeSchema'],
  ];
  for (const [kind, field, schema] of expectations) {
    const object = strictObjectForKind(sourceFile, 'AnswerSegmentInputSchema', kind);
    const names = object?.properties
      .filter(ts.isPropertyAssignment)
      .map((property) => propertyNameText(property.name))
      .sort();
    const value = object ? objectProperty(object, field) : null;
    if (
      !object
      || names?.join(',') !== [field, 'kind'].sort().join(',')
      || !value
      || !ts.isIdentifier(value.initializer)
      || value.initializer.text !== schema
    ) {
      failures.push(`src/lib/dm/runtime.ts: ${kind} finalization input must remain enum-only (${field}: ${schema})`);
    }
  }

  const finalAnswer = variableDeclaration(sourceFile, 'FinalAnswerInputSchema');
  const initializer = finalAnswer?.initializer;
  const object = initializer && ts.isCallExpression(initializer) && initializer.arguments.length === 1
    && ts.isObjectLiteralExpression(initializer.arguments[0])
    ? initializer.arguments[0]
    : null;
  const limitations = object ? objectProperty(object, 'limitations') : null;
  const followUp = object ? objectProperty(object, 'followUp') : null;
  const compact = (node) => node?.getText(sourceFile).replace(/\s+/g, '') ?? '';
  if (
    compact(limitations?.initializer) !== 'z.array(LimitationCodeSchema).max(4)'
    || compact(followUp?.initializer) !== 'FollowUpCodeSchema.optional()'
  ) {
    failures.push('src/lib/dm/runtime.ts: limitation and follow-up finalization input must remain enum-only');
  }
  return failures;
}

function finalizationCopyFailures(sourceFile) {
  const failures = [];
  const declaration = variableDeclaration(sourceFile, FINALIZATION_COPY_IDENTIFIER);
  if (!declaration) {
    return [`src/lib/dm/runtime.ts: missing ${FINALIZATION_COPY_IDENTIFIER} safety boundary`];
  }

  const counts = new Map();
  walk(sourceFile, (node) => {
    if (!ts.isIdentifier(node) || node.text !== FINALIZATION_COPY_IDENTIFIER || node === declaration.name) return;
    const sectionAccess = node.parent;
    const valueAccess = sectionAccess?.parent;
    if (
      !ts.isPropertyAccessExpression(sectionAccess)
      || sectionAccess.expression !== node
      || !ts.isElementAccessExpression(valueAccess)
      || valueAccess.expression !== sectionAccess
      || !valueAccess.argumentExpression
    ) {
      failures.push(`src/lib/dm/runtime.ts: ${FINALIZATION_COPY_IDENTIFIER} may only be read through approved enum lookups`);
      return;
    }
    const key = `${sectionAccess.name.text}:${valueAccess.argumentExpression.getText(sourceFile)}`;
    if (!EXPECTED_FINALIZATION_COPY_ACCESSES.has(key) || !hasFunctionDeclarationAncestor(node, 'validateFinalAnswer')) {
      failures.push(`src/lib/dm/runtime.ts: unapproved finalization safety-copy access ${key}`);
      return;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });

  for (const [key, expected] of EXPECTED_FINALIZATION_COPY_ACCESSES) {
    if (counts.get(key) !== expected) {
      failures.push(`src/lib/dm/runtime.ts: expected ${expected} validated finalization safety-copy access for ${key}`);
    }
  }
  return failures;
}

function finalizationCallSiteFailures(sourceFile) {
  const failures = [];
  const validateCalls = callExpressionsNamed(sourceFile, 'validateFinalAnswer');
  if (validateCalls.length !== 1) {
    failures.push('src/lib/dm/runtime.ts: validateFinalAnswer must have exactly one call site');
  } else {
    const call = validateCalls[0];
    const argumentsText = call.arguments.map((argument) => argument.getText(sourceFile));
    if (
      argumentsText.join(',') !== 'input,publicRun,artifacts'
      || !executeBelongsToCall(call, 'tool', 'finalizeAnswer')
    ) {
      failures.push('src/lib/dm/runtime.ts: validateFinalAnswer must receive the untouched finalizeAnswer tool input');
    }
    const executeContainer = enclosingExecuteProperty(call);
    const execute = executeContainer && ts.isPropertyAssignment(executeContainer)
      ? executeContainer.initializer
      : executeContainer;
    if (execute) {
      const inputReferences = [];
      let readsRequest = false;
      walk(execute, (node) => {
        if (!ts.isIdentifier(node)) return;
        if (node.text === 'input') inputReferences.push(node);
        if (node.text === 'request') readsRequest = true;
      });
      if (inputReferences.length !== 2 || readsRequest) {
        failures.push('src/lib/dm/runtime.ts: finalizeAnswer execution must not route or rewrite input from the visitor request');
      }
    }
  }

  const limitedCalls = callExpressionsNamed(sourceFile, 'limitedResult');
  const approvedLimitedCalls = limitedCalls.filter((call) => {
    const argument = call.arguments[0]?.getText(sourceFile).replace(/\s+/g, '');
    return (argument === 'true' && executeBelongsToCall(call, 'tool', 'finalizeAnswer'))
      || (argument === 'finalizationAttempts>0' && executeBelongsToCall(call, 'createUIMessageStream'));
  });
  if (limitedCalls.length !== 2 || approvedLimitedCalls.length !== 2) {
    failures.push('src/lib/dm/runtime.ts: limitedResult must remain restricted to finalization failure paths');
  }

  const answerWrites = [];
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    if (node.expression.name.text !== 'write') return;
    const argument = node.arguments[0];
    if (!ts.isObjectLiteralExpression(argument)) return;
    const type = objectProperty(argument, 'type');
    if (type && ts.isStringLiteral(type.initializer) && type.initializer.text === 'data-dm-answer') answerWrites.push(node);
  });
  if (answerWrites.length !== 1 || !executeBelongsToCall(answerWrites[0], 'createUIMessageStream')) {
    failures.push("src/lib/dm/runtime.ts: data-dm-answer must have exactly one validated stream write site");
  }
  return failures;
}

export function finalizationBoundaryFailures(runtime) {
  const sourceFile = ts.createSourceFile('src/lib/dm/runtime.ts', runtime, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const failures = [];
  if (sourceFile.parseDiagnostics?.length) {
    failures.push('src/lib/dm/runtime.ts: TypeScript parse failed during finalization-boundary proof');
    return failures;
  }
  failures.push(...schemaBoundaryFailures(sourceFile));
  failures.push(...finalizationCopyFailures(sourceFile));
  failures.push(...finalizationCallSiteFailures(sourceFile));
  const validate = functionDeclaration(sourceFile, 'validateFinalAnswer');
  if (!validate) failures.push('src/lib/dm/runtime.ts: validateFinalAnswer boundary is missing');
  return failures;
}

async function removalClaimFailures(projectRoot) {
  const claims = JSON.parse(await readFile(resolve(projectRoot, CLAIMS_PATH), 'utf8'));
  const active = claims.claims ?? [];
  const claim = active.find((item) => item.id === REMOVAL_CLAIM_ID);
  const failures = [];
  if (!claim) failures.push(`${CLAIMS_PATH}: missing ${REMOVAL_CLAIM_ID} claim`);
  else if (claim.statement !== REMOVAL_CLAIM_STATEMENT) {
    failures.push(`${CLAIMS_PATH}: ${REMOVAL_CLAIM_ID} must describe the finalization safety-copy exception exactly`);
  }
  if (active.some((item) => item.id === SUPERSEDED_REMOVAL_CLAIM_ID)) {
    failures.push(`${CLAIMS_PATH}: superseded ${SUPERSEDED_REMOVAL_CLAIM_ID} claim must not remain active`);
  }
  return failures;
}

export async function checkScriptedRuntimeRemoval({ projectRoot = process.cwd() } = {}) {
  const root = resolve(projectRoot);
  const failures = await removedFileFailures(root);
  failures.push(...await removalClaimFailures(root));

  const sourceFiles = [];
  for (const sourceRoot of SOURCE_SCAN_ROOTS) {
    sourceFiles.push(...await collectRoot(root, sourceRoot, failures));
  }
  const scannedSourceFiles = [...new Set(sourceFiles)]
    .filter((path) => path !== CHECKER_PATH)
    .sort();

  const builtFiles = [];
  for (const builtRoot of BUILT_SCAN_ROOTS) {
    builtFiles.push(...await collectRoot(root, builtRoot, failures, '; run npm run build first'));
  }
  const scannedBuiltFiles = [...new Set(builtFiles)]
    .sort();

  failures.push(...await scanFiles(root, [...scannedSourceFiles, ...scannedBuiltFiles]));

  const runtime = await readFile(resolve(root, 'src/lib/dm/runtime.ts'), 'utf8');
  const client = await readFile(resolve(root, 'src/scripts/dm.ts'), 'utf8');
  if (!runtime.includes('new ToolLoopAgent')) failures.push('src/lib/dm/runtime.ts: ToolLoopAgent is not instantiated');
  if (!runtime.includes('createPublicAgentTools')) failures.push('src/lib/dm/runtime.ts: typed public tools are not bound into the loop');
  if (!runtime.includes("type: 'data-dm-answer'")) failures.push('src/lib/dm/runtime.ts: typed answer data part is missing');
  failures.push(...finalizationBoundaryFailures(runtime));
  if (!client.includes('new DefaultChatTransport')) failures.push('src/scripts/dm.ts: standard UIMessage transport is missing');

  return {
    failures,
    sourceFiles: scannedSourceFiles,
    builtFiles: scannedBuiltFiles,
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const modulePath = fileURLToPath(import.meta.url);
if (invokedPath === modulePath) {
  const result = await checkScriptedRuntimeRemoval();
  if (result.failures.length > 0) {
    process.stderr.write(`${result.failures.join('\n')}\n`);
    process.exit(1);
  }

  process.stdout.write(
    `DM scripted runtime removal verified across ${result.sourceFiles.length} source files and ${result.builtFiles.length} built files.\n`,
  );
}
