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

export const REMOVAL_CLAIM_ID = 'dm-finalization-contract-boundary';
export const REMOVAL_CLAIM_STATEMENT = 'the legacy scripted DM runtime and custom NDJSON protocol are absent; DM defaults to the v1 enum-controlled finalizer while opt-in v2 streams Unicode-safe bounded canonical prose and attaches only an exact matching finalizer plus current-run evidence and artifact metadata at the terminal boundary';

const SUPERSEDED_REMOVAL_CLAIM_IDS = new Set([
  'dm-removed-scripted-runtime',
  'dm-legacy-scripted-runtime-removed',
]);
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

function toolBindingFailures(sourceFile) {
  const importedToolBindings = [];
  const shadowDeclarations = [];
  let bindingWritten = false;

  walk(sourceFile, (node) => {
    if (ts.isImportSpecifier(node)) {
      const importedName = node.propertyName?.text ?? node.name.text;
      if (importedName === 'tool') {
        const declaration = node.parent.parent.parent;
        importedToolBindings.push({
          localName: node.name.text,
          moduleName: ts.isImportDeclaration(declaration) && ts.isStringLiteral(declaration.moduleSpecifier)
            ? declaration.moduleSpecifier.text
            : null,
        });
      }
      return;
    }
    if (declaresValueName(node, 'tool')) shadowDeclarations.push(node);
    if (writesValueName(node, 'tool')) bindingWritten = true;
  });

  const trustedImport = importedToolBindings.length === 1
    && importedToolBindings[0].localName === 'tool'
    && importedToolBindings[0].moduleName === 'ai';
  if (!trustedImport || shadowDeclarations.length > 0 || bindingWritten) {
    return ['src/lib/dm/runtime.ts: governed finalizer tool calls must retain the unaliased, unshadowed, immutable top-level ai tool import'];
  }
  return [];
}

const SDK_PRIMITIVE_CALL_KINDS = new Map([
  ['ToolLoopAgent', 'constructor'],
  ['createUIMessageStream', 'call'],
  ['toUIMessageStream', 'call'],
  ['createUIMessageStreamResponse', 'call'],
]);

function sdkPrimitiveBindingFailures(sourceFile) {
  const failures = [];
  for (const [name, callKind] of SDK_PRIMITIVE_CALL_KINDS) {
    const imports = [];
    const shadows = [];
    const callSites = [];
    const unexpectedReferences = [];
    let bindingWritten = false;

    walk(sourceFile, (node) => {
      if (ts.isImportSpecifier(node)) {
        const importedName = node.propertyName?.text ?? node.name.text;
        if (importedName !== name) return;
        const declaration = node.parent.parent.parent;
        imports.push({
          localName: node.name.text,
          moduleName: ts.isImportDeclaration(declaration) && ts.isStringLiteral(declaration.moduleSpecifier)
            ? declaration.moduleSpecifier.text
            : null,
        });
        return;
      }
      if (declaresValueName(node, name)) shadows.push(node);
      if (writesValueName(node, name)) bindingWritten = true;
      if (!ts.isIdentifier(node) || node.text !== name) return;

      const parent = node.parent;
      if (ts.isImportSpecifier(parent)) return;
      const isCallSite = callKind === 'constructor'
        ? ts.isNewExpression(parent) && parent.expression === node
        : ts.isCallExpression(parent) && parent.expression === node;
      if (isCallSite) callSites.push(parent);
      else unexpectedReferences.push(node);
    });

    const trustedImport = imports.length === 1
      && imports[0].localName === name
      && imports[0].moduleName === 'ai';
    if (
      !trustedImport
      || shadows.length > 0
      || bindingWritten
      || callSites.length !== 1
      || unexpectedReferences.length > 0
    ) {
      failures.push(`src/lib/dm/runtime.ts: ${name} must retain one unaliased, unshadowed, immutable top-level ai import and its sole direct ${callKind} site`);
    }
  }
  return failures;
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

function bindingNameContains(name, expected) {
  if (ts.isIdentifier(name)) return name.text === expected;
  return name.elements.some((element) => (
    ts.isOmittedExpression(element) ? false : bindingNameContains(element.name, expected)
  ));
}

function declaresValueName(node, name) {
  if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
    return bindingNameContains(node.name, name);
  }
  return (
    (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node))
    && node.name?.text === name
  );
}

function assignmentTargetContainsValueName(target, name) {
  if (ts.isIdentifier(target)) return target.text === name;
  if (ts.isParenthesizedExpression(target)) {
    return assignmentTargetContainsValueName(target.expression, name);
  }
  if (ts.isBinaryExpression(target) && target.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return assignmentTargetContainsValueName(target.left, name);
  }
  if (ts.isArrayLiteralExpression(target)) {
    return target.elements.some((element) => (
      ts.isOmittedExpression(element)
        ? false
        : assignmentTargetContainsValueName(
          ts.isSpreadElement(element) ? element.expression : element,
          name,
        )
    ));
  }
  if (ts.isObjectLiteralExpression(target)) {
    return target.properties.some((property) => {
      if (ts.isShorthandPropertyAssignment(property)) return property.name.text === name;
      if (ts.isPropertyAssignment(property)) {
        return assignmentTargetContainsValueName(property.initializer, name);
      }
      if (ts.isSpreadAssignment(property)) {
        return assignmentTargetContainsValueName(property.expression, name);
      }
      return false;
    });
  }
  return false;
}

function writesValueName(node, name) {
  if (
    ts.isBinaryExpression(node)
    && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
    && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  ) {
    return assignmentTargetContainsValueName(node.left, name);
  }
  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
    && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
  ) {
    return assignmentTargetContainsValueName(node.operand, name);
  }
  if ((ts.isForInStatement(node) || ts.isForOfStatement(node)) && !ts.isVariableDeclarationList(node.initializer)) {
    return assignmentTargetContainsValueName(node.initializer, name);
  }
  return false;
}

function unwrapExpression(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)
  ) current = current.expression;
  return current;
}

function staticPropertyPath(node) {
  const expression = unwrapExpression(node);
  if (ts.isIdentifier(expression)) return [expression.text];
  if (ts.isPropertyAccessExpression(expression)) {
    const parentPath = staticPropertyPath(expression.expression);
    return parentPath ? [...parentPath, expression.name.text] : null;
  }
  if (ts.isElementAccessExpression(expression)) {
    const parentPath = staticPropertyPath(expression.expression);
    const argument = expression.argumentExpression && unwrapExpression(expression.argumentExpression);
    if (!parentPath || !argument || (!ts.isStringLiteral(argument) && !ts.isNumericLiteral(argument))) return null;
    return [...parentPath, argument.text];
  }
  return null;
}

const GOVERNED_V2_DEPENDENCY_PATHS = new Map([
  ['publicRun.evidenceLedger', ['publicRun', 'evidenceLedger']],
  ['publicToolGate.waitForIdle', ['publicToolGate', 'waitForIdle']],
  ['artifacts.projects', ['artifacts', 'projects']],
]);

function governedV2DependencyMutationFailures(sourceFile) {
  const mutated = new Set();
  const aliases = new Map();
  const resolveAliasPath = (path) => {
    if (!path) return null;
    const expanded = new Set();
    let resolved = path;
    while (aliases.has(resolved[0]) && !expanded.has(resolved[0])) {
      expanded.add(resolved[0]);
      resolved = [...aliases.get(resolved[0]), ...resolved.slice(1)];
    }
    return resolved;
  };
  const recordAlias = (name, path) => {
    const resolved = resolveAliasPath(path);
    if (!resolved || (resolved.length === 1 && resolved[0] === name)) return false;
    if (aliases.get(name)?.join('.') === resolved.join('.')) return false;
    aliases.set(name, resolved);
    return true;
  };
  const recordBindingAliases = (name, path) => {
    if (!path) return false;
    const target = unwrapExpression(name);
    if (ts.isIdentifier(target)) return recordAlias(target.text, path);

    if (
      ts.isBinaryExpression(target)
      && target.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      return recordBindingAliases(target.left, path);
    }

    let changed = false;
    if (ts.isObjectBindingPattern(target)) {
      for (const element of target.elements) {
        if (element.dotDotDotToken) {
          // Object rest is a shallow copy, so governed descendant values retain
          // their identity through the new binding.
          changed = recordBindingAliases(element.name, path) || changed;
          continue;
        }
        const property = element.propertyName
          ? propertyNameText(element.propertyName)
          : ts.isIdentifier(element.name)
            ? element.name.text
            : null;
        if (property !== null) {
          changed = recordBindingAliases(element.name, [...path, property]) || changed;
        }
      }
      return changed;
    }

    if (ts.isObjectLiteralExpression(target)) {
      for (const property of target.properties) {
        if (ts.isSpreadAssignment(property)) {
          changed = recordBindingAliases(property.expression, path) || changed;
          continue;
        }
        if (ts.isShorthandPropertyAssignment(property)) {
          changed = recordBindingAliases(property.name, [...path, property.name.text]) || changed;
          continue;
        }
        if (ts.isPropertyAssignment(property)) {
          changed = recordBindingAliases(
            property.initializer,
            [...path, propertyNameText(property.name)],
          ) || changed;
        }
      }
      return changed;
    }

    if (ts.isArrayBindingPattern(target) || ts.isArrayLiteralExpression(target)) {
      for (const [index, element] of target.elements.entries()) {
        if (ts.isOmittedExpression(element)) continue;
        const elementTarget = ts.isBindingElement(element)
          ? element.name
          : ts.isSpreadElement(element)
            ? element.expression
            : element;
        changed = recordBindingAliases(elementTarget, [...path, String(index)]) || changed;
      }
    }
    return changed;
  };
  const recordAssignmentAliases = (name, initializer) => {
    const expression = unwrapExpression(initializer);
    const target = unwrapExpression(name);
    if (
      (ts.isArrayBindingPattern(target) || ts.isArrayLiteralExpression(target))
      && ts.isArrayLiteralExpression(expression)
    ) {
      let changed = false;
      for (const [index, element] of target.elements.entries()) {
        if (ts.isOmittedExpression(element)) continue;
        const source = expression.elements[index];
        const sourcePath = source && !ts.isOmittedExpression(source)
          ? resolveAliasPath(staticPropertyPath(ts.isSpreadElement(source) ? source.expression : source))
          : null;
        const elementTarget = ts.isBindingElement(element)
          ? element.name
          : ts.isSpreadElement(element)
            ? element.expression
            : element;
        changed = recordBindingAliases(elementTarget, sourcePath) || changed;
      }
      return changed;
    }
    return recordBindingAliases(target, resolveAliasPath(staticPropertyPath(expression)));
  };
  const aliasAssignments = new Set();
  let aliasesChanged = true;
  while (aliasesChanged) {
    aliasesChanged = false;
    walk(sourceFile, (node) => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        aliasesChanged = recordAssignmentAliases(node.name, node.initializer) || aliasesChanged;
        return;
      }
      if (
        !ts.isBinaryExpression(node)
        || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken
      ) return;
      const changed = recordAssignmentAliases(node.left, node.right);
      if (changed) aliasAssignments.add(node);
      aliasesChanged = changed || aliasesChanged;
    });
  }
  const governedPath = (node) => resolveAliasPath(staticPropertyPath(node));
  const recordPath = (path, affectsDescendants = false) => {
    if (!path) return;
    for (const [label, governedPath] of GOVERNED_V2_DEPENDENCY_PATHS) {
      const mutatesGovernedPath = governedPath.every((part, index) => path[index] === part);
      const mutatesGovernedDescendant = affectsDescendants
        && path.every((part, index) => governedPath[index] === part);
      if (mutatesGovernedPath || mutatesGovernedDescendant) mutated.add(label);
    }
  };

  walk(sourceFile, (node) => {
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      if (aliasAssignments.has(node)) return;
      recordPath(governedPath(node.left));
      return;
    }
    if (ts.isDeleteExpression(node)) {
      recordPath(governedPath(node.expression));
      return;
    }
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    const owner = node.expression.expression;
    const method = node.expression.name.text;
    const ownerName = ts.isIdentifier(owner) ? owner.text : null;
    if ((ownerName === 'Object' || ownerName === 'Reflect') && method === 'defineProperty') {
      const objectPath = node.arguments[0] ? governedPath(node.arguments[0]) : null;
      const property = node.arguments[1] && unwrapExpression(node.arguments[1]);
      if (objectPath && property && (ts.isStringLiteral(property) || ts.isNumericLiteral(property))) {
        recordPath([...objectPath, property.text]);
      } else {
        recordPath(objectPath, true);
      }
      return;
    }
    if (ownerName === 'Reflect' && method === 'set') {
      const objectPath = node.arguments[0] ? governedPath(node.arguments[0]) : null;
      const property = node.arguments[1] && unwrapExpression(node.arguments[1]);
      if (objectPath && property && (ts.isStringLiteral(property) || ts.isNumericLiteral(property))) {
        recordPath([...objectPath, property.text]);
      } else {
        recordPath(objectPath, true);
      }
      return;
    }
    if (ownerName === 'Object' && method === 'defineProperties') {
      const objectPath = node.arguments[0] ? governedPath(node.arguments[0]) : null;
      const descriptors = node.arguments[1] && unwrapExpression(node.arguments[1]);
      if (!objectPath || !descriptors || !ts.isObjectLiteralExpression(descriptors)) {
        recordPath(objectPath, true);
        return;
      }
      for (const property of descriptors.properties) {
        if (ts.isPropertyAssignment(property) || ts.isMethodDeclaration(property)) {
          recordPath([...objectPath, propertyNameText(property.name)]);
        } else {
          recordPath(objectPath, true);
        }
      }
      return;
    }
    if (
      (ownerName === 'Object' || ownerName === 'Reflect')
      && method === 'setPrototypeOf'
    ) {
      recordPath(node.arguments[0] ? governedPath(node.arguments[0]) : null, true);
      return;
    }
    if (ownerName !== 'Object' || method !== 'assign') return;
    const objectPath = node.arguments[0] ? governedPath(node.arguments[0]) : null;
    if (!objectPath) return;
    for (const source of node.arguments.slice(1)) {
      const unwrapped = unwrapExpression(source);
      if (!ts.isObjectLiteralExpression(unwrapped)) continue;
      for (const property of unwrapped.properties) {
        if (ts.isPropertyAssignment(property) || ts.isMethodDeclaration(property)) {
          recordPath([...objectPath, propertyNameText(property.name)]);
        }
      }
    }
  });

  return [...mutated].map((label) => (
    `src/lib/dm/runtime.ts: governed v2 dependency ${label} must not be replaced or redefined`
  ));
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

const FINALIZER_OPTION_NAMES = ['description', 'inputSchema', 'execute'];

function closedFinalizerOptions(object) {
  if (!ts.isObjectLiteralExpression(object) || object.properties.length !== FINALIZER_OPTION_NAMES.length) return null;
  const properties = new Map();
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) return null;
    if (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name)) return null;
    const name = propertyNameText(property.name);
    if (!FINALIZER_OPTION_NAMES.includes(name) || properties.has(name)) return null;
    properties.set(name, property);
  }
  return FINALIZER_OPTION_NAMES.every((name) => properties.has(name)) ? properties : null;
}

function compactNode(node, sourceFile) {
  return node?.getText(sourceFile).replace(/\s+/g, '').replace(/,([}\]])/g, '$1') ?? '';
}

function compactSyntax(source) {
  return source.replace(/\s+/g, '').replace(/,([}\]])/g, '$1');
}

const V2_ARTIFACT_HELPER_DECLARATIONS = new Map([
  ['deduplicateArtifactReferences', compactSyntax(`
    function deduplicateArtifactReferences(references: ArtifactReference[]): ArtifactReference[] {
      const seen = new Set<string>();
      return references.filter((reference) => {
        const key = \`${'${reference.kind}:${reference.id}'}\`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
  `)],
  ['artifactAvailable', compactSyntax(`
    function artifactAvailable(reference: ArtifactReference, artifacts: RunArtifacts): boolean {
      if (reference.kind === 'project' || reference.kind === 'links') return artifacts.projects.has(reference.id);
      if (reference.kind === 'resume') return artifacts.resumeTracks.has(reference.id);
      if (reference.kind === 'contact') return artifacts.contact !== null;
      return artifacts.sources.has(reference.id);
    }
  `)],
  ['resolveArtifact', compactSyntax(`
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
      return project ? [{ kind: 'links', id: \`links:${'${project.id}'}\`, projectId: project.id, items: project.links }] : [];
    }
  `)],
]);

function v2ArtifactHelperFailures(sourceFile) {
  const failures = [];
  for (const [name, expectedDeclaration] of V2_ARTIFACT_HELPER_DECLARATIONS) {
    const declarations = [];
    walk(sourceFile, (node) => {
      if (declaresValueName(node, name)) declarations.push(node);
    });
    const trustedDeclaration = declarations.find((node) => (
      ts.isFunctionDeclaration(node) && node.parent === sourceFile
    ));
    let bindingWritten = false;
    walk(sourceFile, (node) => {
      if (writesValueName(node, name)) bindingWritten = true;
    });
    if (
      declarations.length !== 1
      || !trustedDeclaration
      || compactNode(trustedDeclaration, sourceFile) !== expectedDeclaration
      || bindingWritten
    ) {
      failures.push(`src/lib/dm/runtime.ts: v2 artifact helper ${name} must retain its trusted declaration, body, and binding`);
    }
  }
  return failures;
}

function finalizeExecuteForSchema(root, sourceFile, schemaName) {
  let match = null;
  walk(root, (node) => {
    if (match || !ts.isCallExpression(node) || !callIsNamed(node, 'tool')) return;
    const options = node.arguments[0];
    const closedOptions = closedFinalizerOptions(options);
    if (!closedOptions) return;
    const inputSchema = closedOptions.get('inputSchema');
    if (compactNode(inputSchema?.initializer, sourceFile) !== schemaName) return;
    const execute = closedOptions.get('execute');
    if (!execute || !ts.isArrowFunction(execute.initializer)) return;
    match = execute.initializer;
  });
  return match;
}

function contractBranchBindingFailures(sourceFile) {
  const declaration = variableDeclaration(sourceFile, 'agentTools');
  const initializer = declaration?.initializer && unwrapExpression(declaration.initializer);
  if (
    !initializer
    || !ts.isConditionalExpression(initializer)
    || compactNode(initializer.condition, sourceFile) !== "contract==='v2'"
    || !finalizeExecuteForSchema(initializer.whenTrue, sourceFile, 'V2FinalAnswerInputSchema')
    || finalizeExecuteForSchema(initializer.whenTrue, sourceFile, 'FinalAnswerInputSchema')
    || !finalizeExecuteForSchema(initializer.whenFalse, sourceFile, 'FinalAnswerInputSchema')
    || finalizeExecuteForSchema(initializer.whenFalse, sourceFile, 'V2FinalAnswerInputSchema')
  ) {
    return ['src/lib/dm/runtime.ts: agentTools must bind the governed v2 finalizer to the true branch of the exact contract === v2 conditional and the v1 finalizer to its false branch'];
  }
  return [];
}

const AGENT_TOOLS_CONSUMPTION_FAILURE = 'src/lib/dm/runtime.ts: ToolLoopAgent and toUIMessageStream must each consume the exact immutable agentTools contract binding without option overrides';

function agentToolsConsumptionFailures(sourceFile) {
  const declarations = [];
  let bindingWritten = false;
  walk(sourceFile, (node) => {
    if (declaresValueName(node, 'agentTools')) declarations.push(node);
    if (writesValueName(node, 'agentTools')) bindingWritten = true;
  });
  const trustedDeclaration = declarations.find((node) => (
    ts.isVariableDeclaration(node)
    && ts.isVariableDeclarationList(node.parent)
    && (node.parent.flags & ts.NodeFlags.Const) !== 0
    && hasFunctionDeclarationAncestor(node, 'createDMChatResponse')
  ));
  if (declarations.length !== 1 || !trustedDeclaration || bindingWritten) {
    return [AGENT_TOOLS_CONSUMPTION_FAILURE];
  }

  const optionsConsumeAgentTools = (options) => {
    if (!ts.isObjectLiteralExpression(options)) return false;
    if (options.properties.some((property) => (
      ts.isSpreadAssignment(property)
      || ('name' in property && ts.isComputedPropertyName(property.name))
    ))) return false;
    const toolsProperties = options.properties.filter((property) => (
      'name' in property
      && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
      && propertyNameText(property.name) === 'tools'
    ));
    return toolsProperties.length === 1
      && ts.isPropertyAssignment(toolsProperties[0])
      && ts.isIdentifier(toolsProperties[0].name)
      && ts.isIdentifier(toolsProperties[0].initializer)
      && toolsProperties[0].initializer.text === 'agentTools';
  };

  const toolLoopCalls = [];
  const uiStreamCalls = [];
  walk(sourceFile, (node) => {
    if (
      ts.isNewExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'ToolLoopAgent'
    ) toolLoopCalls.push(node);
    if (callIsNamed(node, 'toUIMessageStream')) uiStreamCalls.push(node);
  });
  if (
    toolLoopCalls.length !== 1
    || toolLoopCalls[0].arguments?.length !== 1
    || !optionsConsumeAgentTools(toolLoopCalls[0].arguments[0])
    || uiStreamCalls.length !== 1
    || uiStreamCalls[0].arguments.length !== 1
    || !optionsConsumeAgentTools(uiStreamCalls[0].arguments[0])
  ) return [AGENT_TOOLS_CONSUMPTION_FAILURE];
  return [];
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

function v2SchemaBindingFailures(sourceFile) {
  const declarations = [];
  let bindingWritten = false;
  walk(sourceFile, (node) => {
    if (declaresValueName(node, 'V2FinalAnswerInputSchema')) declarations.push(node);
    if (writesValueName(node, 'V2FinalAnswerInputSchema')) bindingWritten = true;
  });
  const trustedDeclaration = declarations.find((node) => (
    ts.isVariableDeclaration(node)
    && ts.isVariableDeclarationList(node.parent)
    && ts.isVariableStatement(node.parent.parent)
    && node.parent.parent.parent === sourceFile
    && (node.parent.flags & ts.NodeFlags.Const) !== 0
  ));
  if (declarations.length !== 1 || !trustedDeclaration || bindingWritten) {
    return ['src/lib/dm/runtime.ts: v2 finalizer schema must retain one immutable, unshadowed top-level trusted declaration'];
  }
  return [];
}

function schemaBoundaryFailures(sourceFile) {
  const failures = v2SchemaBindingFailures(sourceFile);
  const compact = (node) => node?.getText(sourceFile).replace(/\s+/g, '') ?? '';
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
  if (
    compact(limitations?.initializer) !== 'z.array(LimitationCodeSchema).max(4)'
    || compact(followUp?.initializer) !== 'FollowUpCodeSchema.optional()'
  ) {
    failures.push('src/lib/dm/runtime.ts: limitation and follow-up finalization input must remain enum-only');
  }

  const v2Answer = variableDeclaration(sourceFile, 'V2FinalAnswerInputSchema');
  const v2Initializer = v2Answer?.initializer;
  const v2Object = v2Initializer && ts.isCallExpression(v2Initializer) && v2Initializer.arguments.length === 1
    && ts.isObjectLiteralExpression(v2Initializer.arguments[0])
    ? v2Initializer.arguments[0]
    : null;
  const expectedV2Fields = new Map([
    ['markdown', 'z.string().min(1).max(6_000).refine((value) => value.trim().length > 0)'],
    ['evidenceIds', 'z.array(z.string().trim().min(1).max(240)).max(32)'],
    ['artifacts', 'z.array(ArtifactReferenceSchema).max(MAX_FINALIZATION_ARTIFACTS)'],
    ['followUp', 'z.string().trim().min(1).max(600).optional()'],
  ]);
  const actualV2Names = v2Object?.properties
    .filter(ts.isPropertyAssignment)
    .map((property) => propertyNameText(property.name))
    .sort() ?? [];
  if (actualV2Names.join(',') !== [...expectedV2Fields.keys()].sort().join(',')) {
    failures.push('src/lib/dm/runtime.ts: v2 finalization schema must expose only bounded markdown, evidence ids, artifacts, and optional follow-up');
  } else {
    for (const [field, expected] of expectedV2Fields) {
      const actual = v2Object ? compact(objectProperty(v2Object, field)?.initializer) : '';
      if (actual !== expected.replace(/\s+/g, '')) {
        failures.push(`src/lib/dm/runtime.ts: v2 finalization field ${field} must remain ${expected}`);
      }
    }
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

function v2ContractFailures(sourceFile) {
  const failures = [
    ...governedV2DependencyMutationFailures(sourceFile),
    ...contractBranchBindingFailures(sourceFile),
  ];
  const compact = (node) => node?.getText(sourceFile).replace(/\s+/g, '') ?? '';
  const forbiddenSource = variableDeclaration(sourceFile, 'FORBIDDEN_SOURCE_INSTRUCTION');
  const expectedForbiddenSource = 'Never claim access to Slack, admin drafts, candidate evidence, private notes, visitor history, credentials, hidden projects, or unpublished records. Those sources and tools do not exist here.';
  let forbiddenSourceReferences = 0;
  walk(sourceFile, (node) => {
    if (ts.isIdentifier(node) && node.text === 'FORBIDDEN_SOURCE_INSTRUCTION' && node !== forbiddenSource?.name) {
      forbiddenSourceReferences += 1;
    }
  });
  if (
    !forbiddenSource
    || !ts.isStringLiteral(forbiddenSource.initializer)
    || forbiddenSource.initializer.text !== expectedForbiddenSource
    || forbiddenSourceReferences !== 2
  ) {
    failures.push('src/lib/dm/runtime.ts: v1 and v2 must retain the complete forbidden-source instruction');
  }
  const configReader = functionDeclaration(sourceFile, 'readDMRuntimeConfig');
  const configText = compact(configReader);
  for (const required of [
    "constconfiguredContract=env.DM_CONTRACT?.trim()",
    "constcontract:DMContractVersion=configuredContract==='v2'?'v2':'v1'",
    "configuredContract!=='v1'&&configuredContract!=='v2'",
    'return{provider,model:modelasstring,contract}',
  ]) {
    if (!configText.includes(required)) {
      failures.push('src/lib/dm/runtime.ts: DM_CONTRACT must fail closed and select only v1 or v2 with v1 as the default');
      break;
    }
  }

  const chatResponse = functionDeclaration(sourceFile, 'createDMChatResponse');
  const chatText = compact(chatResponse);
  if (
    !chatText.includes("constcontract=config.contract??'v1'")
    || !chatText.includes('buildDMSystemInstructions(siteBrief,contract)')
  ) {
    failures.push('src/lib/dm/runtime.ts: the selected contract must control both finalization and system instructions');
  }
  for (const required of [
    'constv2Prose=createBoundedV2Prose()',
    "if(contract==='v2'&&isV2TextChunk(chunk))",
    'terminalMarkdown!==v2Prose.text',
    "if(contract==='v1')metrics.visibleOutput()",
  ]) {
    if (!chatText.includes(required)) {
      failures.push('src/lib/dm/runtime.ts: v2 must stream only bounded canonical prose and require an exact terminal integrity echo');
      break;
    }
  }

  const finalizerSchemas = [];
  let finalizerOptionsClosed = true;
  walk(chatResponse ?? sourceFile, (node) => {
    if (!ts.isPropertyAssignment(node) || propertyNameText(node.name) !== 'finalizeAnswer') return;
    const call = node.initializer;
    if (!ts.isCallExpression(call) || !callIsNamed(call, 'tool')) return;
    const options = call.arguments[0];
    const closedOptions = closedFinalizerOptions(options);
    if (!closedOptions) {
      finalizerOptionsClosed = false;
      return;
    }
    const inputSchema = closedOptions.get('inputSchema');
    finalizerSchemas.push(compact(inputSchema?.initializer));
  });
  if (!finalizerOptionsClosed) {
    failures.push('src/lib/dm/runtime.ts: finalizer tool options must contain only one static property assignment each for description, inputSchema, and execute');
  }
  if (
    finalizerSchemas.length !== 2
    || finalizerSchemas.filter((schema) => schema === 'FinalAnswerInputSchema').length !== 1
    || finalizerSchemas.filter((schema) => schema === 'V2FinalAnswerInputSchema').length !== 1
  ) {
    failures.push('src/lib/dm/runtime.ts: v1 and v2 must bind exactly one distinct finalizeAnswer schema each');
  }

  const resolver = functionDeclaration(sourceFile, 'resolveV2FinalAnswer');
  const resolverText = compact(resolver);
  for (const required of [
    'newSet(input.evidenceIds)',
    'filter((id)=>run.evidenceLedger.has(id))',
    'deduplicateArtifactReferences(input.artifacts)',
    'filter((reference)=>artifactAvailable(reference,artifacts))',
    'evidence:run.evidenceLedger.resolve(evidenceIds)',
    'artifacts:artifactReferences.flatMap((reference)=>resolveArtifact(reference,artifacts))',
  ]) {
    if (!resolverText.includes(required)) {
      failures.push('src/lib/dm/runtime.ts: v2 must deduplicate, filter, and resolve only current-run evidence and artifacts');
      break;
    }
  }
  for (const forbidden of [
    'FINALIZATION_ENUM_COPY',
    'limitationOutcomeErrors',
    'evidenceQuoteErrors',
    'compositionCoverageErrors',
    'stableProjectReadErrors',
    'requestedArtifactErrors',
    'artifactCardinalityErrors',
  ]) {
    if (resolverText.includes(forbidden)) {
      failures.push(`src/lib/dm/runtime.ts: v2 must not run v1 finalization policy ${forbidden}`);
    }
  }

  const v2Execute = chatResponse
    ? finalizeExecuteForSchema(chatResponse, sourceFile, 'V2FinalAnswerInputSchema')
    : null;
  const expectedExecuteStatements = [
    'awaitpublicToolGate.waitForIdle();',
    'if(finalizationResult)returnfinalizationResult;',
    'finalizationAttempts+=1;',
    'finalized=true;',
    "finalizationResult={status:'accepted',answer:resolveV2FinalAnswer(input,publicRun,artifacts),repairAttempted:false};",
    'returnfinalizationResult;',
  ];
  const actualExecuteStatements = v2Execute && ts.isBlock(v2Execute.body)
    ? v2Execute.body.statements.map((statement) => compactNode(statement, sourceFile))
    : [];
  const expectedResolverStatements = [
    'constevidenceIds=[...newSet(input.evidenceIds)].filter((id)=>run.evidenceLedger.has(id));',
    'constartifactReferences=deduplicateArtifactReferences(input.artifacts).filter((reference)=>artifactAvailable(reference,artifacts));',
    'return{segments:[{text:input.markdown,evidenceIds,evidence:run.evidenceLedger.resolve(evidenceIds)}],artifacts:artifactReferences.flatMap((reference)=>resolveArtifact(reference,artifacts)),limitations:[],...(input.followUp?{followUp:input.followUp}:{})};',
  ];
  const actualResolverStatements = resolver?.body?.statements
    .map((statement) => compactNode(statement, sourceFile)) ?? [];
  if (
    actualExecuteStatements.join('\n') !== expectedExecuteStatements.join('\n')
    || actualResolverStatements.join('\n') !== expectedResolverStatements.join('\n')
  ) {
    failures.push('src/lib/dm/runtime.ts: v2 finalization execution and resolution must contain only the governed structural allowlist');
  }

  const v2Instructions = compact(variableDeclaration(sourceFile, 'DM_V2_SYSTEM_INSTRUCTIONS')?.initializer);
  for (const required of [
    'standardresponsetextstream',
    'exactlyequalsthatstreamedtext',
    'integrityecho,notasecondanswer',
  ]) {
    if (!v2Instructions.includes(required)) {
      failures.push('src/lib/dm/runtime.ts: v2 instructions must bind standard streamed prose to the exact finalizer integrity echo');
      break;
    }
  }

  const resolveCalls = callExpressionsNamed(sourceFile, 'resolveV2FinalAnswer');
  let locallyShadowedResolver = false;
  let resolverBindingWritten = false;
  walk(chatResponse ?? sourceFile, (node) => {
    if (node !== chatResponse && declaresValueName(node, 'resolveV2FinalAnswer')) {
      locallyShadowedResolver = true;
    }
  });
  walk(sourceFile, (node) => {
    if (writesValueName(node, 'resolveV2FinalAnswer')) resolverBindingWritten = true;
  });
  if (
    locallyShadowedResolver
    || resolverBindingWritten
    || resolveCalls.length !== 1
    || resolveCalls[0].arguments.map((argument) => argument.getText(sourceFile)).join(',') !== 'input,publicRun,artifacts'
    || !executeBelongsToCall(resolveCalls[0], 'tool', 'finalizeAnswer')
  ) {
    failures.push('src/lib/dm/runtime.ts: v2 finalization must receive the untouched tool input and current-run ledgers exactly once');
  }

  const repairProperty = (() => {
    let match = null;
    walk(chatResponse ?? sourceFile, (node) => {
      if (!match && ts.isPropertyAssignment(node) && propertyNameText(node.name) === 'experimental_repairToolCall') match = node;
    });
    return match;
  })();
  const repairText = compact(repairProperty);
  if (
    repairText.indexOf("if(contract==='v2')") < 0
    || repairText.indexOf("if(contract==='v2')") > repairText.indexOf('finalizationAttempts+=1')
  ) {
    failures.push('src/lib/dm/runtime.ts: v2 schema failures must stop without consuming the v1 repair turn');
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
  failures.push(...toolBindingFailures(sourceFile));
  failures.push(...sdkPrimitiveBindingFailures(sourceFile));
  failures.push(...schemaBoundaryFailures(sourceFile));
  failures.push(...finalizationCopyFailures(sourceFile));
  failures.push(...v2ContractFailures(sourceFile));
  failures.push(...v2ArtifactHelperFailures(sourceFile));
  failures.push(...agentToolsConsumptionFailures(sourceFile));
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
  for (const id of SUPERSEDED_REMOVAL_CLAIM_IDS) {
    if (active.some((item) => item.id === id)) {
      failures.push(`${CLAIMS_PATH}: superseded ${id} claim must not remain active`);
    }
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
