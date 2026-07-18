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

const GOVERNANCE_CLAIM_ID = 'dm-v2-validator-governance';
const GOVERNANCE_CLAIM_STATEMENT = 'DM v2 runtime finalization is limited to documented structural, same-run provenance, source, integrity, and operational controls; behavior quality stays in prompts, approved public content, and evaluations';
const GOVERNANCE_DOCUMENTS = {
  rule: 'docs/agents/dm-validator-governance.md',
  evals: 'docs/agents/dm-evals.md',
  scope: 'docs/agents/scope-ledger.md',
};
const GOVERNANCE_CLAIM_SUBJECT_REFS = [
  GOVERNANCE_DOCUMENTS.rule,
  GOVERNANCE_DOCUMENTS.evals,
  GOVERNANCE_DOCUMENTS.scope,
  'src/lib/dm/runtime.ts',
  'scripts/check-dm-scripted-runtime-removed.mjs',
  'tests/dm-scripted-runtime-removal.test.mjs',
];
const GOVERNANCE_DOCUMENT_ANCHORS = {
  [GOVERNANCE_DOCUMENTS.rule]: [
    '# DM v2 validator governance',
    '## Hard-control allowlist',
    'strict bounded schema types and sizes',
    'current-run provenance by filtering unknown evidence ids',
    'deterministic exclusion of forbidden/private sources and tools',
    'exact streamed-prose/finalizer integrity',
    '## Behavior stays out of runtime rejection',
    'Runtime code must not reject, rewrite, force, or gate v2 prose',
    'The public source boundary remains hard: published database projects, approved public RAG sources, and canonical résumé/contact data only.',
    'Semantic privacy quality is evaluated; private-source exclusion is deterministic.',
    '## Exception evidence',
    '## Implementation and review checklist',
  ],
  [GOVERNANCE_DOCUMENTS.evals]: [
    '[validator-governance rule](./dm-validator-governance.md)',
    'prompt/content/eval judgments rather than runtime rejection rules.',
    'Published DB projects, approved public RAG sources, canonical résumé/contact data, semantic privacy judgment, and deterministic private-source exclusion remain mandatory.',
  ],
  [GOVERNANCE_DOCUMENTS.scope]: [
    '[`docs/agents/dm-validator-governance.md`](./dm-validator-governance.md)',
    'hard controls protect structure, same-run provenance, private-source exclusion, and operations, while answer quality and semantic privacy wording remain evaluated behavior.',
    'The rule does not weaken the published-project, approved-public-RAG, or canonical résumé/contact source boundary above.',
  ],
};

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

function normalizeDocumentationText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

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

function staticStringValue(node, bindings = new Map(), seen = new Set()) {
  const expression = unwrapExpression(node);
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  if (ts.isIdentifier(expression) && bindings.has(expression.text) && !seen.has(expression.text)) {
    return staticStringValue(
      bindings.get(expression.text),
      bindings,
      new Set(seen).add(expression.text),
    );
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticStringValue(expression.left, bindings, seen);
    const right = staticStringValue(expression.right, bindings, seen);
    return left === null || right === null ? null : `${left}${right}`;
  }
  if (ts.isTemplateExpression(expression)) {
    let value = expression.head.text;
    for (const span of expression.templateSpans) {
      const interpolation = staticStringValue(span.expression, bindings, seen);
      if (interpolation === null) return null;
      value += interpolation + span.literal.text;
    }
    return value;
  }
  return null;
}

function immutableConstBindings(sourceFile) {
  const bindings = new Map();
  const duplicateNames = new Set();
  walk(sourceFile, (node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
      && ts.isVariableDeclarationList(node.parent)
      && (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      if (bindings.has(node.name.text)) duplicateNames.add(node.name.text);
      else bindings.set(node.name.text, node.initializer);
    }
  });
  for (const name of duplicateNames) bindings.delete(name);
  for (const name of [...bindings.keys()]) {
    let written = false;
    walk(sourceFile, (node) => {
      if (writesValueName(node, name)) written = true;
    });
    if (written) bindings.delete(name);
  }
  return bindings;
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

function zodBindingFailures(sourceFile) {
  const imports = [];
  const shadows = [];
  let bindingWritten = false;
  walk(sourceFile, (node) => {
    if (ts.isImportSpecifier(node)) {
      const importedName = node.propertyName?.text ?? node.name.text;
      if (importedName !== 'z') return;
      const declaration = node.parent.parent.parent;
      imports.push({
        localName: node.name.text,
        moduleName: ts.isImportDeclaration(declaration) && ts.isStringLiteral(declaration.moduleSpecifier)
          ? declaration.moduleSpecifier.text
          : null,
      });
      return;
    }
    if (declaresValueName(node, 'z')) shadows.push(node);
    if (writesValueName(node, 'z')) bindingWritten = true;
  });
  if (
    imports.length !== 1
    || imports[0].localName !== 'z'
    || imports[0].moduleName !== 'zod'
    || shadows.length > 0
    || bindingWritten
  ) {
    return ['src/lib/dm/runtime.ts: governed schemas must retain one unaliased, unshadowed, immutable top-level z import from zod'];
  }
  return [];
}

function metricsRecorderBindingFailures(sourceFile) {
  const imports = [];
  const shadows = [];
  const callSites = [];
  const unexpectedReferences = [];
  let bindingWritten = false;
  walk(sourceFile, (node) => {
    if (ts.isImportSpecifier(node)) {
      const importedName = node.propertyName?.text ?? node.name.text;
      if (importedName !== 'createDMMetricsRecorder') return;
      const declaration = node.parent.parent.parent;
      imports.push({
        localName: node.name.text,
        moduleName: ts.isImportDeclaration(declaration) && ts.isStringLiteral(declaration.moduleSpecifier)
          ? declaration.moduleSpecifier.text
          : null,
      });
      return;
    }
    if (declaresValueName(node, 'createDMMetricsRecorder')) shadows.push(node);
    if (writesValueName(node, 'createDMMetricsRecorder')) bindingWritten = true;
    if (!ts.isIdentifier(node) || node.text !== 'createDMMetricsRecorder') return;
    if (ts.isImportSpecifier(node.parent) || ts.isTypeQueryNode(node.parent)) return;
    if (ts.isCallExpression(node.parent) && node.parent.expression === node) callSites.push(node.parent);
    else unexpectedReferences.push(node);
  });
  return imports.length === 1
    && imports[0].localName === 'createDMMetricsRecorder'
    && imports[0].moduleName === './metrics'
    && shadows.length === 0
    && !bindingWritten
    && callSites.length === 1
    && unexpectedReferences.length === 0
    ? []
    : ['src/lib/dm/runtime.ts: createDMMetricsRecorder must retain one unaliased, unshadowed, immutable import from ./metrics and its sole direct call site'];
}

const DYNAMIC_CODE_NAMES = new Set([
  'eval',
  'Function',
  'AsyncFunction',
  'GeneratorFunction',
  'AsyncGeneratorFunction',
]);

function dynamicCodeExecutionFailures(sourceFile) {
  let unsafe = false;
  const constBindings = immutableConstBindings(sourceFile);
  const directlyInvokedBindings = new Set();
  const directlyInvokedPaths = new Set();
  walk(sourceFile, (node) => {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) directlyInvokedBindings.add(node.expression.text);
      const path = staticPropertyPath(node.expression, constBindings);
      if (path) directlyInvokedPaths.add(path.join('.'));
    }
  });
  const computedName = (node) => {
    const expression = unwrapExpression(node);
    return ts.isNumericLiteral(expression)
      ? expression.text
      : staticStringValue(expression, constBindings);
  };
  const callableBindings = new Set();
  const callablePaths = new Set();
  const callableContainers = new Set();
  const callableResultBindings = new Set();
  const callableYieldBindings = new Set();
  const callableAccessorBindings = new Set();
  const callableResultWildcards = new Set();
  const callableYieldWildcards = new Set();
  const callableAccessorWildcards = new Set();
  const callableSafeResultBindings = new Set();
  const scopedCallableResolution = new Set();
  const scopedCallableBindings = new Set();
  let activeCallableDeclarations = new Map();
  const classInstances = new Map();
  const classParents = new Map();
  const classAliases = new Map();
  const classNames = new Set();
  const functionNodes = new Map();
  const initializerNodes = new Map();
  const initializerDeclarations = new Map();
  const parameterDeclarations = new Map();
  const catchDeclarations = new Map();
  const assignmentDeclarations = new Map();
  const anonymousOwnerPath = (node, kind = 'owner') => `@${kind}:${node.pos}`;
  const classBindingName = (node) => {
    if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.name) return node.name.text;
    if (
      ts.isClassExpression(node)
      && ts.isVariableDeclaration(node.parent)
      && ts.isIdentifier(node.parent.name)
    ) return node.parent.name.text;
    return ts.isClassExpression(node) ? anonymousOwnerPath(node, 'class') : null;
  };
  const initializerScopeNode = (declaration) => {
    const isVar = ts.isVariableDeclarationList(declaration.parent)
      && (declaration.parent.flags & ts.NodeFlags.BlockScoped) === 0;
    for (let current = declaration.parent; current; current = current.parent) {
      if (isVar && ts.isFunctionLike(current)) return current;
      if (!isVar && (ts.isBlock(current) || ts.isFunctionLike(current))) return current;
      if (ts.isSourceFile(current)) return current;
    }
    return sourceFile;
  };
  const lexicalScopeNode = (node) => {
    for (let current = node.parent; current; current = current.parent) {
      if (ts.isBlock(current) || ts.isFunctionLike(current) || ts.isSourceFile(current)) {
        return current;
      }
    }
    return sourceFile;
  };
  walk(sourceFile, (node) => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node))
      && node.name
    ) callableBindings.add(node.name.text);
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const className = classBindingName(node);
      if (className) classNames.add(className);
      const heritage = node.heritageClauses
        ?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
        ?.types[0];
      const parent = heritage && staticPropertyPath(heritage.expression, constBindings)?.join('.');
      if (className && parent) classParents.set(className, parent);
    }
    if (ts.isFunctionDeclaration(node) && node.name) functionNodes.set(node.name.text, node);
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      const declarations = parameterDeclarations.get(node.name.text) ?? [];
      declarations.push({ parameter: node, scope: node.parent });
      parameterDeclarations.set(node.name.text, declarations);
    }
    if (
      ts.isCatchClause(node)
      && node.variableDeclaration
      && ts.isIdentifier(node.variableDeclaration.name)
    ) {
      const name = node.variableDeclaration.name.text;
      const declarations = catchDeclarations.get(name) ?? [];
      declarations.push({ declaration: node.variableDeclaration, scope: node });
      catchDeclarations.set(name, declarations);
    }
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(unwrapExpression(node.left))
    ) {
      const name = unwrapExpression(node.left).text;
      const declarations = assignmentDeclarations.get(name) ?? [];
      declarations.push({ value: node.right, scope: lexicalScopeNode(node), position: node.pos });
      assignmentDeclarations.set(name, declarations);
    }
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) return;
    const initializer = unwrapExpression(node.initializer);
    initializerNodes.set(node.name.text, initializer);
    const declarations = initializerDeclarations.get(node.name.text) ?? [];
    declarations.push({ initializer, scope: initializerScopeNode(node) });
    initializerDeclarations.set(node.name.text, declarations);
    if (
      ts.isFunctionExpression(initializer)
      || ts.isArrowFunction(initializer)
      || ts.isClassExpression(initializer)
    ) {
      callableBindings.add(node.name.text);
      if (ts.isFunctionExpression(initializer) || ts.isArrowFunction(initializer)) {
        functionNodes.set(node.name.text, initializer);
      }
    }
    if (ts.isIdentifier(initializer) && classNames.has(initializer.text)) {
      classAliases.set(node.name.text, new Set([initializer.text]));
      classNames.add(node.name.text);
    }
    if (ts.isObjectLiteralExpression(initializer)) {
      for (const property of initializer.properties) {
        if (ts.isMethodDeclaration(property)) {
          const path = `${node.name.text}.${propertyNameText(property.name)}`;
          callablePaths.add(path);
          functionNodes.set(path, property);
        }
        if (
          ts.isPropertyAssignment(property)
          && (
            ts.isFunctionExpression(unwrapExpression(property.initializer))
            || ts.isArrowFunction(unwrapExpression(property.initializer))
            || ts.isClassExpression(unwrapExpression(property.initializer))
          )
        ) {
          const path = `${node.name.text}.${propertyNameText(property.name)}`;
          callablePaths.add(path);
          functionNodes.set(path, unwrapExpression(property.initializer));
        }
      }
    }
  });
  const resolveInitializerNode = (node, seen = new Set()) => {
    const value = unwrapExpression(node);
    if (!ts.isIdentifier(value) || seen.has(value.text) || !initializerNodes.has(value.text)) return value;
    return resolveInitializerNode(initializerNodes.get(value.text), new Set(seen).add(value.text));
  };
  const visibleInitializerDeclaration = (identifier) => (
    (initializerDeclarations.get(identifier.text) ?? [])
      .filter(({ scope }) => {
        for (let current = identifier; current; current = current.parent) {
          if (current === scope) return true;
        }
        return false;
      })
      .sort((left, right) => (
        (left.scope.end - left.scope.pos) - (right.scope.end - right.scope.pos)
      ))[0]
  );
  const visibleParameterDeclaration = (identifier) => (
    (parameterDeclarations.get(identifier.text) ?? [])
      .filter(({ scope }) => {
        for (let current = identifier; current; current = current.parent) {
          if (current === scope) return true;
        }
        return false;
      })
      .sort((left, right) => (
        (left.scope.end - left.scope.pos) - (right.scope.end - right.scope.pos)
      ))[0]
  );
  const visibleCatchDeclaration = (identifier) => (
    (catchDeclarations.get(identifier.text) ?? [])
      .filter(({ scope }) => {
        for (let current = identifier; current; current = current.parent) {
          if (current === scope) return true;
        }
        return false;
      })[0]
  );
  const visibleAssignedValue = (identifier) => (
    (assignmentDeclarations.get(identifier.text) ?? [])
      .filter(({ scope, position }) => {
        if (position >= identifier.pos) return false;
        for (let current = identifier; current; current = current.parent) {
          if (current === scope) return true;
        }
        return false;
      })
      .sort((left, right) => (
        (left.scope.end - left.scope.pos) - (right.scope.end - right.scope.pos)
        || right.position - left.position
      ))[0]
  );
  const resolveSafeInitializerNode = (node, seen = new Set()) => {
    const value = unwrapExpression(node);
    if (!ts.isIdentifier(value) || seen.has(value.text)) return value;
    const initializer = visibleInitializerDeclaration(value)?.initializer;
    return initializer
      ? resolveSafeInitializerNode(initializer, new Set(seen).add(value.text))
      : value;
  };
  const isScopedCallableIdentifier = (identifier) => {
    const declaration = visibleInitializerDeclaration(identifier);
    const initializer = declaration?.initializer;
    if (!initializer) {
      const parameter = visibleParameterDeclaration(identifier)?.parameter;
      if (parameter) {
        return Boolean(parameter.initializer && isTrackedCallableExpression(parameter.initializer));
      }
      if (visibleCatchDeclaration(identifier)) return false;
      return callableBindings.has(identifier.text);
    }
    const declarationKey = `${declaration.scope.pos}:${initializer.pos}:${identifier.text}`;
    if (scopedCallableBindings.has(declarationKey)) return true;
    const value = unwrapExpression(initializer);
    if (
      ts.isFunctionExpression(value)
      || ts.isArrowFunction(value)
      || ts.isClassExpression(value)
    ) return true;
    const path = staticPropertyPath(value, constBindings)?.join('.');
    if (path && path !== identifier.text && (
      callableBindings.has(path) || callablePaths.has(path)
    )) return true;
    const key = `${declaration.scope.pos}:${initializer.pos}`;
    if (scopedCallableResolution.has(key)) return false;
    scopedCallableResolution.add(key);
    try {
      return isTrackedCallableExpression(value);
    } finally {
      scopedCallableResolution.delete(key);
    }
  };
  const classLineage = (name, seen = new Set()) => {
    if (!name || seen.has(name)) return [];
    const next = new Set(seen).add(name);
    const parent = classParents.get(name);
    const aliases = classAliases.get(name) ?? [];
    return [
      name,
      ...(parent ? classLineage(parent, next) : []),
      ...[...aliases].flatMap((alias) => classLineage(alias, next)),
    ];
  };
  const classAliasSources = (node, substitutions = new Map(), seenCalls = new Set()) => {
    const expression = unwrapExpression(node);
    const path = staticPropertyPath(expression, constBindings)?.join('.');
    if (path && substitutions.has(path)) {
      return classAliasSources(substitutions.get(path), substitutions, seenCalls);
    }
    if (path && classNames.has(path)) return new Set([path]);
    if (ts.isClassExpression(expression)) {
      const name = classBindingName(expression);
      return new Set(name ? [name] : []);
    }
    if (ts.isConditionalExpression(expression)) return new Set([
      ...classAliasSources(expression.whenTrue, substitutions, seenCalls),
      ...classAliasSources(expression.whenFalse, substitutions, seenCalls),
    ]);
    if (ts.isBinaryExpression(expression)) {
      if (expression.operatorToken.kind === ts.SyntaxKind.CommaToken) {
        return classAliasSources(expression.right, substitutions, seenCalls);
      }
      if (
        expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        || expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
        || expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) return new Set([
        ...classAliasSources(expression.left, substitutions, seenCalls),
        ...classAliasSources(expression.right, substitutions, seenCalls),
      ]);
    }
    if (ts.isCallExpression(expression)) {
      if (seenCalls.has(expression.pos)) return new Set();
      const nextSeenCalls = new Set(seenCalls).add(expression.pos);
      const calleePath = staticPropertyPath(expression.expression, constBindings)?.join('.');
      const fn = calleePath && functionNodes.get(calleePath);
      if (fn) {
        const returns = [];
        const localAliases = new Map();
        const visit = (current) => {
          if (current !== fn && ts.isFunctionLike(current)) return;
          if (ts.isReturnStatement(current) && current.expression) returns.push(current.expression);
          if (
            ts.isVariableDeclaration(current)
            && ts.isIdentifier(current.name)
            && current.initializer
          ) {
            const aliasPath = staticPropertyPath(current.initializer, constBindings);
            if (aliasPath) localAliases.set(current.name.text, aliasPath);
          }
          if (
            ts.isBinaryExpression(current)
            && current.operatorToken.kind === ts.SyntaxKind.EqualsToken
            && ts.isIdentifier(unwrapExpression(current.left))
          ) {
            const aliasPath = staticPropertyPath(current.right, constBindings);
            if (aliasPath) localAliases.set(unwrapExpression(current.left).text, aliasPath);
          }
          ts.forEachChild(current, visit);
        };
        if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) returns.push(fn.body);
        else if (fn.body) visit(fn.body);
        const callSubstitutions = new Map(substitutions);
        for (const [index, parameter] of fn.parameters.entries()) {
          if (ts.isIdentifier(parameter.name) && expression.arguments[index]) {
            callSubstitutions.set(parameter.name.text, expression.arguments[index]);
          }
        }
        for (const returned of returns) {
          let returnedPath = staticPropertyPath(returned, constBindings);
          const expanded = new Set();
          while (returnedPath && localAliases.has(returnedPath[0]) && !expanded.has(returnedPath[0])) {
            expanded.add(returnedPath[0]);
            returnedPath = [...localAliases.get(returnedPath[0]), ...returnedPath.slice(1)];
          }
          const parameterIndex = returnedPath && fn.parameters.findIndex((parameter) => (
            ts.isIdentifier(parameter.name) && parameter.name.text === returnedPath[0]
          ));
          const argument = parameterIndex >= 0 ? expression.arguments[parameterIndex] : null;
          if (argument && returnedPath && returnedPath.length === 1) {
            return classAliasSources(argument, substitutions, nextSeenCalls);
          }
          if (ts.isCallExpression(unwrapExpression(returned))) {
            const delegated = classAliasSources(returned, callSubstitutions, nextSeenCalls);
            if (delegated.size > 0) return delegated;
          }
          if (ts.isConditionalExpression(unwrapExpression(returned))) {
            const selected = classAliasSources(returned, callSubstitutions, nextSeenCalls);
            if (selected.size > 0) return selected;
          }
        }
      }
    }
    return new Set();
  };
  const recordClassAliasSources = (name, sources) => {
    if (sources.size === 0) return false;
    const existing = classAliases.get(name) ?? new Set();
    const before = existing.size;
    for (const source of sources) existing.add(source);
    classAliases.set(name, existing);
    classNames.add(name);
    return existing.size !== before;
  };
  const recordClassAliasPath = (name, initializer) => (
    recordClassAliasSources(name, classAliasSources(initializer))
  );
  const recordClassAlias = (target, initializer) => {
    const name = unwrapExpression(target);
    if (ts.isIdentifier(name)) {
      let changed = recordClassAliasPath(name.text, initializer);
      const value = unwrapExpression(initializer);
      if (ts.isObjectLiteralExpression(value)) {
        for (const property of value.properties) {
          if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;
          const propertyName = propertyNameText(property.name);
          const propertyValue = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer;
          changed = recordClassAliasPath(`${name.text}.${propertyName}`, propertyValue) || changed;
        }
      }
      return changed;
    }
    if (
      (ts.isObjectBindingPattern(name) || ts.isObjectLiteralExpression(name))
    ) {
      let changed = false;
      for (const property of name.elements ?? name.properties) {
        if (!ts.isBindingElement(property) || property.dotDotDotToken) continue;
        const key = property.propertyName
          ? propertyNameText(property.propertyName)
          : ts.isIdentifier(property.name) ? property.name.text : null;
        if (key === null) continue;
        for (const value of literalMemberValues(initializer, key)) {
          changed = recordClassAlias(property.name, value) || changed;
        }
        if (ts.isIdentifier(property.name)) {
          for (const path of literalMemberPaths(initializer, key)) {
            if (classNames.has(path)) {
              changed = recordClassAliasSources(
                property.name.text,
                new Set([path]),
              ) || changed;
            }
          }
        }
      }
      return changed;
    }
    if (
      (ts.isArrayBindingPattern(name) || ts.isArrayLiteralExpression(name))
      && ts.isArrayLiteralExpression(unwrapExpression(initializer))
    ) {
      let changed = false;
      for (const [index, element] of name.elements.entries()) {
        if (ts.isOmittedExpression(element)) continue;
        const value = unwrapExpression(initializer).elements[index];
        if (!value || ts.isOmittedExpression(value)) continue;
        const elementTarget = ts.isBindingElement(element)
          ? element.name
          : ts.isSpreadElement(element) ? element.expression : element;
        changed = recordClassAlias(
          elementTarget,
          ts.isSpreadElement(value) ? value.expression : value,
        ) || changed;
      }
      return changed;
    }
    const targetPath = staticPropertyPath(name, constBindings)?.join('.');
    return targetPath ? recordClassAliasPath(targetPath, initializer) : false;
  };
  const propagateCallableContainers = (target, source) => {
    let changed = false;
    for (const container of [...callableContainers]) {
      if (container === source || container.startsWith(`${source}.`)) {
        const alias = `${target}${container.slice(source.length)}`;
        if (!callableContainers.has(alias)) {
          callableContainers.add(alias);
          changed = true;
        }
      }
    }
    return changed;
  };
  const isCallableContainer = (path) => [...callableContainers].some((container) => (
    path === container || path.startsWith(`${container}.`)
  ));
  const hasCallableDescendant = (path) => (
    callableBindings.has(path)
    || callablePaths.has(path)
    || [...callablePaths].some((candidate) => candidate.startsWith(`${path}.`))
    || isCallableContainer(path)
    || [...callableContainers].some((candidate) => candidate.startsWith(`${path}.`))
  );
  const containsCallableContainer = (node) => {
    let found = false;
    walk(node, (current) => {
      const path = staticPropertyPath(current, constBindings)?.join('.');
      if (path && isCallableContainer(path)) found = true;
    });
    return found;
  };
  const literalMemberValues = (node, key) => {
    const expression = unwrapExpression(node);
    if (ts.isPropertyAccessExpression(expression)) {
      return literalMemberValues(expression.expression, expression.name.text)
        .flatMap((value) => literalMemberValues(value, key));
    }
    if (ts.isElementAccessExpression(expression) && expression.argumentExpression) {
      const member = computedName(expression.argumentExpression);
      return member === null
        ? []
        : literalMemberValues(expression.expression, member)
          .flatMap((value) => literalMemberValues(value, key));
    }
    if (ts.isConditionalExpression(expression)) {
      return [
        ...literalMemberValues(expression.whenTrue, key),
        ...literalMemberValues(expression.whenFalse, key),
      ];
    }
    if (ts.isBinaryExpression(expression)) {
      if (expression.operatorToken.kind === ts.SyntaxKind.CommaToken) {
        return literalMemberValues(expression.right, key);
      }
      if (
        expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        || expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
        || expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) return [
        ...literalMemberValues(expression.left, key),
        ...literalMemberValues(expression.right, key),
      ];
    }
    if (ts.isObjectLiteralExpression(expression)) {
      const values = [];
      for (const property of expression.properties) {
        if (
          (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property))
          && propertyNameText(property.name) === key
        ) values.push(ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer);
        if (ts.isSpreadAssignment(property)) values.push(...literalMemberValues(property.expression, key));
      }
      return values;
    }
    if (ts.isArrayLiteralExpression(expression) && /^\d+$/.test(key)) {
      const value = expression.elements[Number(key)];
      return value && !ts.isOmittedExpression(value) && !ts.isSpreadElement(value)
        ? [value]
        : [];
    }
    return [];
  };
  const literalMemberPaths = (node, key) => {
    const expression = unwrapExpression(node);
    if (ts.isPropertyAccessExpression(expression)) {
      const member = expression.name.text;
      return [
        ...literalMemberValues(expression.expression, member)
          .flatMap((value) => literalMemberPaths(value, key)),
        ...literalMemberPaths(expression.expression, member).map((path) => `${path}.${key}`),
      ];
    }
    if (ts.isElementAccessExpression(expression) && expression.argumentExpression) {
      const member = computedName(expression.argumentExpression);
      if (member !== null) {
        return [
          ...literalMemberValues(expression.expression, member)
            .flatMap((value) => literalMemberPaths(value, key)),
          ...literalMemberPaths(expression.expression, member).map((path) => `${path}.${key}`),
        ];
      }
    }
    if (ts.isConditionalExpression(expression)) {
      return [
        ...literalMemberPaths(expression.whenTrue, key),
        ...literalMemberPaths(expression.whenFalse, key),
      ];
    }
    if (ts.isBinaryExpression(expression)) {
      if (expression.operatorToken.kind === ts.SyntaxKind.CommaToken) {
        return literalMemberPaths(expression.right, key);
      }
      if (
        expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        || expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
        || expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) return [
        ...literalMemberPaths(expression.left, key),
        ...literalMemberPaths(expression.right, key),
      ];
    }
    if (ts.isObjectLiteralExpression(expression)) {
      return expression.properties.flatMap((property) => (
        ts.isSpreadAssignment(property) ? literalMemberPaths(property.expression, key) : []
      ));
    }
    if (ts.isArrayLiteralExpression(expression)) {
      return expression.elements.flatMap((element) => (
        ts.isSpreadElement(element) ? literalMemberPaths(element.expression, key) : []
      ));
    }
    const path = staticPropertyPath(expression, constBindings);
    return path ? [`${path.join('.')}.${key}`] : [];
  };
  const selectedCallablePaths = (receiverNode, key) => {
    const receiver = unwrapExpression(receiverNode);
    const receiverPath = staticPropertyPath(receiver, constBindings)?.join('.');
    const literalOwner = ts.isObjectLiteralExpression(receiver)
      ? anonymousOwnerPath(receiver, 'object')
      : ts.isClassExpression(receiver)
        ? classBindingName(receiver)
        : null;
    const paths = receiverPath
      ? [`${receiverPath}.${key}`]
      : literalOwner
        ? [`${literalOwner}.${key}`]
        : [];
    const receiverClasses = new Set(receiverPath ? classInstances.get(receiverPath) ?? [] : []);
    for (const className of classInstanceSources(receiver)) receiverClasses.add(className);
    for (const className of receiverClasses) {
      for (const lineageName of classLineage(className)) {
        paths.push(`${lineageName}.prototype.${key}`);
      }
    }
    if (ts.isNewExpression(receiver)) {
      const constructorPath = staticPropertyPath(receiver.expression, constBindings)?.join('.');
      const constructed = constructorPath && classNames.has(constructorPath)
        ? constructorPath
        : ts.isClassExpression(unwrapExpression(receiver.expression))
          ? classBindingName(unwrapExpression(receiver.expression))
          : null;
      for (const lineageName of classLineage(constructed)) {
        paths.push(`${lineageName}.prototype.${key}`);
      }
    }
    if (ts.isIdentifier(receiver) && (classParents.has(receiver.text) || callableBindings.has(receiver.text))) {
      for (const lineageName of classLineage(receiver.text)) paths.push(`${lineageName}.${key}`);
    }
    return [...new Set(paths)];
  };
  const unresolvedSelectedCallablePaths = (receiverNode) => {
    const receiver = unwrapExpression(receiverNode);
    const owner = staticPropertyPath(receiver, constBindings)?.join('.')
      ?? (ts.isObjectLiteralExpression(receiver) ? anonymousOwnerPath(receiver, 'object') : null);
    const paths = owner ? [`${owner}.*`] : [];
    if (owner) {
      for (const bindings of [callableResultBindings, callableYieldBindings, callableAccessorBindings]) {
        for (const path of bindings) {
          if (path.startsWith(`${owner}.`)) paths.push(path);
        }
      }
    }
    for (const className of owner ? classInstances.get(owner) ?? [] : []) {
      for (const lineageName of classLineage(className)) {
        const prototype = `${lineageName}.prototype`;
        paths.push(`${prototype}.*`);
        for (const bindings of [callableResultBindings, callableYieldBindings, callableAccessorBindings]) {
          for (const path of bindings) {
            if (path.startsWith(`${prototype}.`)) paths.push(path);
          }
        }
      }
    }
    return [...new Set(paths)];
  };
  const callableSourcePaths = (node) => {
    const expression = unwrapExpression(node);
    if (ts.isCallExpression(expression)) {
      const callee = unwrapExpression(expression.expression);
      const calleePath = staticPropertyPath(callee, constBindings)?.join('.');
      if (calleePath === 'Reflect.get' && expression.arguments.length >= 2) {
        const key = staticStringValue(expression.arguments[1], constBindings);
        return key !== null
          ? selectedCallablePaths(expression.arguments[0], key)
          : unresolvedSelectedCallablePaths(expression.arguments[0]);
      }
      if (
        (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))
        && (ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : callee.argumentExpression && computedName(callee.argumentExpression)) === 'bind'
      ) return callableSourcePaths(callee.expression);
    }
    if (
      ts.isPropertyAccessExpression(expression)
      && expression.name.text === 'value'
      && ts.isCallExpression(unwrapExpression(expression.expression))
    ) {
      const call = unwrapExpression(expression.expression);
      const calleePath = staticPropertyPath(call.expression, constBindings)?.join('.');
      if (calleePath === 'Object.getOwnPropertyDescriptor' && call.arguments.length >= 2) {
        const key = staticStringValue(call.arguments[1], constBindings);
        return key !== null
          ? selectedCallablePaths(call.arguments[0], key)
          : unresolvedSelectedCallablePaths(call.arguments[0]);
      }
    }
    if (ts.isConditionalExpression(expression)) {
      return [
        ...callableSourcePaths(expression.whenTrue),
        ...callableSourcePaths(expression.whenFalse),
      ];
    }
    if (ts.isBinaryExpression(expression)) {
      if (expression.operatorToken.kind === ts.SyntaxKind.CommaToken) {
        return callableSourcePaths(expression.right);
      }
      if (
        expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        || expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
        || expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) return [...callableSourcePaths(expression.left), ...callableSourcePaths(expression.right)];
    }
    if (ts.isPropertyAccessExpression(expression)) {
      return selectedCallablePaths(expression.expression, expression.name.text);
    }
    if (ts.isElementAccessExpression(expression) && expression.argumentExpression) {
      const key = computedName(expression.argumentExpression);
      return key !== null
        ? selectedCallablePaths(expression.expression, key)
        : unresolvedSelectedCallablePaths(expression.expression);
    }
    const path = staticPropertyPath(expression, constBindings)?.join('.');
    return path ? [path] : [];
  };
  const classInstanceSources = (node) => {
    const expression = unwrapExpression(node);
    if (ts.isNewExpression(expression)) {
      const constructorPath = staticPropertyPath(expression.expression, constBindings)?.join('.');
      if (constructorPath && classNames.has(constructorPath)) return new Set([constructorPath]);
      const constructor = unwrapExpression(expression.expression);
      if (ts.isClassExpression(constructor)) return new Set([classBindingName(constructor)]);
    }
    if (ts.isConditionalExpression(expression)) {
      return new Set([
        ...classInstanceSources(expression.whenTrue),
        ...classInstanceSources(expression.whenFalse),
      ]);
    }
    if (ts.isBinaryExpression(expression)) {
      if (expression.operatorToken.kind === ts.SyntaxKind.CommaToken) {
        return classInstanceSources(expression.right);
      }
      if (
        expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        || expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
        || expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) return new Set([
        ...classInstanceSources(expression.left),
        ...classInstanceSources(expression.right),
      ]);
    }
    const path = staticPropertyPath(expression, constBindings)?.join('.');
    const classes = new Set(path ? classInstances.get(path) ?? [] : []);
    if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
      const key = ts.isPropertyAccessExpression(expression)
        ? expression.name.text
        : expression.argumentExpression && computedName(expression.argumentExpression);
      if (key !== null && key !== undefined) {
        for (const value of literalMemberValues(expression.expression, key)) {
          for (const className of classInstanceSources(value)) classes.add(className);
        }
      }
    }
    return classes;
  };
  const recordClassInstanceTarget = (target, sources) => {
    if (sources.size === 0) return false;
    const current = classInstances.get(target) ?? new Set();
    const next = new Set([...current, ...sources]);
    if (next.size === current.size) return false;
    classInstances.set(target, next);
    return true;
  };
  const propagateClassInstanceBinding = (name, initializer) => {
    const expression = unwrapExpression(initializer);
    const target = typeof name === 'string' ? null : unwrapExpression(name);
    let changed = false;
    if (target && (ts.isObjectBindingPattern(target) || ts.isObjectLiteralExpression(target))) {
      for (const property of target.elements ?? target.properties) {
        if (!ts.isBindingElement(property) || property.dotDotDotToken) continue;
        const key = property.propertyName
          ? propertyNameText(property.propertyName)
          : ts.isIdentifier(property.name)
            ? property.name.text
            : null;
        if (key === null) continue;
        for (const value of literalMemberValues(expression, key)) {
          changed = propagateClassInstanceBinding(property.name, value) || changed;
        }
        if (ts.isIdentifier(property.name)) {
          for (const path of literalMemberPaths(expression, key)) {
            changed = recordClassInstanceTarget(
              property.name.text,
              new Set(classInstances.get(path) ?? []),
            ) || changed;
          }
        }
      }
      return changed;
    }
    if (target && (ts.isArrayBindingPattern(target) || ts.isArrayLiteralExpression(target))) {
      for (const [index, element] of target.elements.entries()) {
        if (ts.isOmittedExpression(element)) continue;
        const elementTarget = ts.isBindingElement(element)
          ? element.name
          : ts.isSpreadElement(element)
            ? element.expression
            : element;
        if (ts.isArrayLiteralExpression(expression)) {
          const value = expression.elements[index];
          if (value && !ts.isOmittedExpression(value)) {
            changed = propagateClassInstanceBinding(
              elementTarget,
              ts.isSpreadElement(value) ? value.expression : value,
            ) || changed;
          }
        } else if (ts.isIdentifier(unwrapExpression(elementTarget))) {
          for (const path of literalMemberPaths(expression, String(index))) {
            changed = recordClassInstanceTarget(
              unwrapExpression(elementTarget).text,
              new Set(classInstances.get(path) ?? []),
            ) || changed;
          }
        }
      }
      return changed;
    }
    const targetPath = typeof name === 'string'
      ? name
      : staticPropertyPath(target, constBindings)?.join('.');
    changed = targetPath
      ? recordClassInstanceTarget(targetPath, classInstanceSources(expression))
      : false;
    if (targetPath && ts.isArrayLiteralExpression(expression)) {
      for (const [index, element] of expression.elements.entries()) {
        if (ts.isOmittedExpression(element)) continue;
        const value = ts.isSpreadElement(element) ? element.expression : element;
        changed = propagateClassInstanceBinding(`${targetPath}.${index}`, value) || changed;
      }
    }
    if (targetPath && ts.isObjectLiteralExpression(expression)) {
      for (const property of expression.properties) {
        if (ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name)) {
          changed = propagateClassInstanceBinding(
            `${targetPath}.${propertyNameText(property.name)}`,
            property.initializer,
          ) || changed;
        }
      }
    }
    return changed;
  };
  const recordCallableTarget = (target) => {
    for (const key of activeCallableDeclarations.get(target) ?? []) {
      scopedCallableBindings.add(key);
    }
    const collection = target.includes('.') ? callablePaths : callableBindings;
    if (collection.has(target)) return false;
    collection.add(target);
    return true;
  };
  const recordCallableOutputAliases = (target, sources) => {
    let changed = false;
    const wildcardMatches = (source, wildcards) => {
      const separator = source.lastIndexOf('.');
      return separator > 0 && wildcards.has(source.slice(0, separator));
    };
    if (sources.some((source) => (
      callableResultBindings.has(source) || wildcardMatches(source, callableResultWildcards)
    ))) {
      if (!callableResultBindings.has(target)) {
        callableResultBindings.add(target);
        changed = true;
      }
    }
    if (sources.some((source) => (
      callableYieldBindings.has(source) || wildcardMatches(source, callableYieldWildcards)
    ))) {
      if (!callableYieldBindings.has(target)) {
        callableYieldBindings.add(target);
        changed = true;
      }
    }
    if (sources.some((source) => (
      callableAccessorBindings.has(source) || wildcardMatches(source, callableAccessorWildcards)
    ))) {
      if (!callableAccessorBindings.has(target)) {
        callableAccessorBindings.add(target);
        changed = true;
      }
    }
    return changed;
  };
  const propagateCallableOutputs = (target, source) => {
    let changed = recordCallableOutputAliases(target, [source]);
    for (const path of [...callablePaths]) {
      if (!path.startsWith(`${source}.`)) continue;
      const alias = `${target}${path.slice(source.length)}`;
      if (!callablePaths.has(alias)) {
        callablePaths.add(alias);
        if (functionNodes.has(path)) functionNodes.set(alias, functionNodes.get(path));
        changed = true;
      }
    }
    for (const [bindings, wildcards] of [
      [callableResultBindings, callableResultWildcards],
      [callableYieldBindings, callableYieldWildcards],
      [callableAccessorBindings, callableAccessorWildcards],
    ]) {
      for (const path of [...bindings]) {
        if (!path.startsWith(`${source}.`)) continue;
        const alias = `${target}${path.slice(source.length)}`;
        if (!bindings.has(alias)) {
          bindings.add(alias);
          changed = true;
        }
      }
      for (const path of [...wildcards]) {
        if (path !== source && !path.startsWith(`${source}.`)) continue;
        const alias = `${target}${path.slice(source.length)}`;
        if (!wildcards.has(alias)) {
          wildcards.add(alias);
          changed = true;
        }
      }
    }
    return changed;
  };
  const callableCalleePaths = (node) => {
    const expression = unwrapExpression(node);
    const paths = callableSourcePaths(expression);
    if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
      const key = ts.isPropertyAccessExpression(expression)
        ? expression.name.text
        : expression.argumentExpression && computedName(expression.argumentExpression);
      const receiver = unwrapExpression(expression.expression);
      if (key !== null && key !== undefined) {
        paths.push(...selectedCallablePaths(receiver, key));
        if (key === 'call' || key === 'apply') {
          paths.push(...callableSourcePaths(receiver));
        }
      }
    }
    return [...new Set(paths)];
  };
  const outputPathTracked = (path, bindings, wildcards) => {
    if (bindings.has(path)) return true;
    if (callableSafeResultBindings.has(path)) return false;
    const separator = path.lastIndexOf('.');
    return separator > 0 && wildcards.has(path.slice(0, separator));
  };
  const directFunctionOutputs = (node) => {
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
      return { returns: [node.body], yields: [] };
    }
    const returns = [];
    const yields = [];
    const visit = (current) => {
      if (current !== node && ts.isFunctionLike(current)) return;
      if (ts.isReturnStatement(current) && current.expression) returns.push(current.expression);
      if (ts.isYieldExpression(current) && current.expression) yields.push(current.expression);
      ts.forEachChild(current, visit);
    };
    if (node.body) visit(node.body);
    return { returns, yields };
  };
  const definitelyNonCallableOutput = (node) => {
    const expression = resolveSafeInitializerNode(node);
    return ts.isNumericLiteral(expression)
      || ts.isStringLiteralLike(expression)
      || expression.kind === ts.SyntaxKind.TrueKeyword
      || expression.kind === ts.SyntaxKind.FalseKeyword
      || expression.kind === ts.SyntaxKind.NullKeyword
      || (ts.isIdentifier(expression) && expression.text === 'undefined')
      || (ts.isObjectLiteralExpression(expression) && expression.properties.every((property) => (
        ts.isPropertyAssignment(property) && definitelyNonCallableOutput(property.initializer)
      )))
      || (ts.isArrayLiteralExpression(expression) && expression.elements.every((element) => (
        ts.isOmittedExpression(element)
        || (!ts.isSpreadElement(element) && definitelyNonCallableOutput(element))
      )));
  };
  const callableFunctionsForCallee = (calleeNode) => {
    const callee = unwrapExpression(calleeNode);
    if (ts.isFunctionExpression(callee) || ts.isArrowFunction(callee)) return [callee];
    return callableSourcePaths(callee)
      .map((path) => functionNodes.get(path))
      .filter(Boolean);
  };
  const parameterBindingPaths = (name, prefix = [], paths = new Map()) => {
    if (ts.isIdentifier(name)) {
      paths.set(name.text, prefix);
      return paths;
    }
    if (ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        const key = element.propertyName
          ? propertyNameText(element.propertyName)
          : ts.isIdentifier(element.name) ? element.name.text : null;
        if (key !== null) parameterBindingPaths(element.name, [...prefix, key], paths);
      }
    }
    if (ts.isArrayBindingPattern(name)) {
      for (const [index, element] of name.elements.entries()) {
        if (!ts.isOmittedExpression(element)) parameterBindingPaths(element.name, [...prefix, String(index)], paths);
      }
    }
    return paths;
  };
  const assignmentTargetIdentifiers = (node, identifiers = []) => {
    const target = unwrapExpression(node);
    if (ts.isIdentifier(target)) {
      identifiers.push(target);
    } else if (ts.isArrayLiteralExpression(target)) {
      for (const element of target.elements) {
        if (ts.isOmittedExpression(element)) continue;
        assignmentTargetIdentifiers(
          ts.isSpreadElement(element) ? element.expression : element,
          identifiers,
        );
      }
    } else if (ts.isObjectLiteralExpression(target)) {
      for (const property of target.properties) {
        if (ts.isShorthandPropertyAssignment(property)) {
          assignmentTargetIdentifiers(property.name, identifiers);
        } else if (ts.isPropertyAssignment(property)) {
          assignmentTargetIdentifiers(property.initializer, identifiers);
        } else if (ts.isSpreadAssignment(property)) {
          assignmentTargetIdentifiers(property.expression, identifiers);
        }
      }
    }
    return identifiers;
  };
  const localFunctionAliases = (fn) => {
    const aliases = new Map();
    const visit = (node) => {
      if (node !== fn && ts.isFunctionLike(node)) return;
      if (
        ts.isVariableDeclaration(node)
        && ts.isIdentifier(node.name)
        && node.initializer
      ) {
        const path = staticPropertyPath(node.initializer, constBindings);
        if (path) aliases.set(node.name.text, path);
      }
      if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isIdentifier(unwrapExpression(node.left))
      ) {
        const path = staticPropertyPath(node.right, constBindings);
        if (path) aliases.set(unwrapExpression(node.left).text, path);
      }
      ts.forEachChild(node, visit);
    };
    if (fn.body) visit(fn.body);
    return aliases;
  };
  const outputSelectedArguments = (outputNode, fn, argumentsList, offset = 0) => {
    const output = unwrapExpression(outputNode);
    if (ts.isConditionalExpression(output)) {
      return [
        ...outputSelectedArguments(output.whenTrue, fn, argumentsList, offset),
        ...outputSelectedArguments(output.whenFalse, fn, argumentsList, offset),
      ];
    }
    if (ts.isBinaryExpression(output)) {
      if (output.operatorToken.kind === ts.SyntaxKind.CommaToken) {
        return outputSelectedArguments(output.right, fn, argumentsList, offset);
      }
      if (
        output.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        || output.operatorToken.kind === ts.SyntaxKind.BarBarToken
        || output.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) return [
        ...outputSelectedArguments(output.left, fn, argumentsList, offset),
        ...outputSelectedArguments(output.right, fn, argumentsList, offset),
      ];
    }
    let path = staticPropertyPath(output, constBindings);
    if (!path) return [];
    const aliases = localFunctionAliases(fn);
    const expanded = new Set();
    while (aliases.has(path[0]) && !expanded.has(path[0])) {
      expanded.add(path[0]);
      path = [...aliases.get(path[0]), ...path.slice(1)];
    }
    let parameterIndex = -1;
    let selection = [];
    let restParameter = false;
    for (const [index, parameter] of fn.parameters.entries()) {
      const bindingPath = parameterBindingPaths(parameter.name).get(path[0]);
      if (bindingPath) {
        parameterIndex = index;
        selection = [...bindingPath, ...path.slice(1)];
        restParameter = Boolean(parameter.dotDotDotToken);
        break;
      }
    }
    if (parameterIndex < 0) return [];
    let argumentIndex = parameterIndex - offset;
    if (restParameter && /^\d+$/.test(selection[0] ?? '')) {
      argumentIndex += Number(selection.shift());
    }
    const argument = argumentsList[argumentIndex];
    if (!argument) return [];
    let values = [argument];
    for (const key of selection) {
      values = values.flatMap((value) => literalMemberValues(value, key));
    }
    return values;
  };
  const invocationArguments = (call) => {
    const expandArguments = (argumentsList, seen = new Set()) => argumentsList.flatMap((argument) => {
      if (!ts.isSpreadElement(argument)) return [argument];
      const spreadExpression = unwrapExpression(argument.expression);
      const spreadName = ts.isIdentifier(spreadExpression) ? spreadExpression.text : null;
      if (spreadName && seen.has(spreadName)) return [argument.expression];
      const spread = resolveInitializerNode(spreadExpression);
      if (!ts.isArrayLiteralExpression(spread)) return [argument.expression];
      const nextSeen = spreadName ? new Set(seen).add(spreadName) : seen;
      return expandArguments(
        spread.elements.filter((element) => !ts.isOmittedExpression(element)),
        nextSeen,
      );
    });
    const callee = unwrapExpression(call.expression);
    if (ts.isIdentifier(callee)) {
      const initializer = visibleInitializerDeclaration(callee)?.initializer
        ?? visibleAssignedValue(callee)?.value;
      const boundCall = initializer && unwrapExpression(initializer);
      if (boundCall && ts.isCallExpression(boundCall)) {
        const boundCallee = unwrapExpression(boundCall.expression);
        if (ts.isPropertyAccessExpression(boundCallee) || ts.isElementAccessExpression(boundCallee)) {
          const method = ts.isPropertyAccessExpression(boundCallee)
            ? boundCallee.name.text
            : boundCallee.argumentExpression && computedName(boundCallee.argumentExpression);
          if (method === 'bind') {
            return {
              callee: boundCallee.expression,
              argumentsList: [...boundCall.arguments.slice(1), ...call.arguments],
            };
          }
        }
      }
    }
    if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
      const method = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : callee.argumentExpression && computedName(callee.argumentExpression);
      if (method === 'call') return { callee: callee.expression, argumentsList: call.arguments.slice(1) };
      if (method === 'apply') {
        const list = call.arguments[1] && resolveInitializerNode(call.arguments[1]);
        if (list && ts.isArrayLiteralExpression(list)) {
          return {
            callee: callee.expression,
            argumentsList: expandArguments(
              list.elements.filter((item) => !ts.isOmittedExpression(item)),
            ),
          };
        }
      }
    }
    return {
      callee: call.expression,
      argumentsList: expandArguments(call.arguments),
    };
  };
  const passthroughArgumentValues = (call) => {
    const invocation = invocationArguments(call);
    const functions = callableFunctionsForCallee(invocation.callee);
    return functions.flatMap((fn) => directFunctionOutputs(fn).returns.flatMap((output) => {
      const direct = outputSelectedArguments(output, fn, invocation.argumentsList);
      if (direct.length > 0) return direct;
      const returned = unwrapExpression(output);
      if (!ts.isCallExpression(returned)) return [];
      return passthroughArgumentValues(returned).flatMap((value) => (
        outputSelectedArguments(value, fn, invocation.argumentsList)
      ));
    }));
  };
  const callReturnsTrackedArgument = (call) => {
    return passthroughArgumentValues(call).some(isTrackedCallableExpression);
  };
  const isTrackedCallableExpression = (node) => {
    const expression = unwrapExpression(node);
    const source = staticPropertyPath(expression, constBindings)?.join('.');
    if (
      ts.isFunctionExpression(expression)
      || ts.isArrowFunction(expression)
      || ts.isClassExpression(expression)
      || (source && (
        (ts.isIdentifier(expression)
          ? isScopedCallableIdentifier(expression)
          : callableBindings.has(source))
        || callablePaths.has(source)
        || callableAccessorBindings.has(source)
      ))
    ) return true;
    if (ts.isConditionalExpression(expression)) {
      return isTrackedCallableExpression(expression.whenTrue)
        || isTrackedCallableExpression(expression.whenFalse);
    }
    if (ts.isBinaryExpression(expression)) {
      if (expression.operatorToken.kind === ts.SyntaxKind.CommaToken) {
        return isTrackedCallableExpression(expression.right);
      }
      if (
        expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        || expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
        || expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) return isTrackedCallableExpression(expression.left)
        || isTrackedCallableExpression(expression.right);
    }
    const selectedMember = (receiver, key) => (
      literalMemberValues(receiver, key).some(isTrackedCallableExpression)
      || literalMemberPaths(receiver, key).some((path) => (
        callableBindings.has(path) || callablePaths.has(path)
      ))
    );
    if (ts.isPropertyAccessExpression(expression)) {
      if (callableCalleePaths(expression).some((path) => (
        outputPathTracked(path, callableAccessorBindings, callableAccessorWildcards)
      ))) return true;
      if (selectedMember(expression.expression, expression.name.text)) return true;
      if (expression.name.text === 'value') {
        const nextCall = unwrapExpression(expression.expression);
        if (
          ts.isCallExpression(nextCall)
          && ts.isPropertyAccessExpression(nextCall.expression)
          && nextCall.expression.name.text === 'next'
        ) {
          const generatorCall = unwrapExpression(nextCall.expression.expression);
          const generators = ts.isCallExpression(generatorCall)
            ? callableCalleePaths(generatorCall.expression)
            : [];
          if (generators.some((generator) => (
            outputPathTracked(generator, callableYieldBindings, callableYieldWildcards)
          ))) return true;
        }
      }
    }
    if (ts.isElementAccessExpression(expression) && expression.argumentExpression) {
      if (callableCalleePaths(expression).some((path) => (
        outputPathTracked(path, callableAccessorBindings, callableAccessorWildcards)
      ))) return true;
      const key = computedName(expression.argumentExpression);
      if (key !== null && selectedMember(expression.expression, key)) return true;
    }
    if (ts.isCallExpression(expression)) {
      if (callableCalleePaths(expression.expression).some((callee) => (
        outputPathTracked(callee, callableResultBindings, callableResultWildcards)
      ))) return true;
      if (callReturnsTrackedArgument(expression)) return true;
      const calleePath = staticPropertyPath(expression.expression, constBindings)?.join('.');
      return expression.arguments.some(isTrackedCallableExpression)
        && (
          calleePath === 'Promise.resolve'
          || calleePath === 'Reflect.apply'
        );
    }
    if (ts.isNewExpression(expression)) {
      const calleePath = staticPropertyPath(expression.expression, constBindings)?.join('.');
      return calleePath === 'Proxy' && Boolean(expression.arguments?.[0]
        && isTrackedCallableExpression(expression.arguments[0]));
    }
    if (ts.isTaggedTemplateExpression(expression) && ts.isTemplateExpression(expression.template)) {
      const substitutions = expression.template.templateSpans.map((span) => span.expression);
      const functions = callableFunctionsForCallee(expression.tag);
      if (functions.length === 0) return substitutions.some(isTrackedCallableExpression);
      return functions.some((fn) => directFunctionOutputs(fn).returns.some((output) => (
        outputSelectedArguments(output, fn, substitutions, 1).some(isTrackedCallableExpression)
      )));
    }
    return false;
  };
  const propagateCallableInitializer = (target, node) => {
    const expression = unwrapExpression(node);
    const source = staticPropertyPath(expression, constBindings)?.join('.');
    let changed = recordCallableOutputAliases(target, callableSourcePaths(expression));
    if (source) changed = propagateCallableOutputs(target, source) || changed;
    if (isTrackedCallableExpression(expression)) {
      return recordCallableTarget(target) || changed;
    }
    if (ts.isCallExpression(expression)) {
      const calleePath = staticPropertyPath(expression.expression, constBindings)?.join('.');
      if (calleePath === 'Object.create' && expression.arguments[0]) {
        const sourcePath = staticPropertyPath(expression.arguments[0], constBindings)?.join('.');
        if (sourcePath) changed = propagateCallableOutputs(target, sourcePath) || changed;
        changed = propagateCallableInitializer(target, resolveInitializerNode(expression.arguments[0])) || changed;
      }
      if (calleePath === 'Object.fromEntries' && expression.arguments[0]) {
        const entries = resolveInitializerNode(expression.arguments[0]);
        if (ts.isArrayLiteralExpression(entries)) {
          for (const entryNode of entries.elements) {
            const entry = unwrapExpression(resolveInitializerNode(
              ts.isSpreadElement(entryNode) ? entryNode.expression : entryNode,
            ));
            if (!ts.isArrayLiteralExpression(entry) || entry.elements.length < 2) continue;
            const key = staticStringValue(entry.elements[0], constBindings);
            const value = entry.elements[1];
            if (key !== null && value && !ts.isOmittedExpression(value)) {
              changed = propagateCallableInitializer(
                `${target}.${key}`,
                ts.isSpreadElement(value) ? value.expression : value,
              ) || changed;
            } else if (value && !ts.isOmittedExpression(value)) {
              const resolvedValue = resolveInitializerNode(
                ts.isSpreadElement(value) ? value.expression : value,
              );
              if (
                ts.isFunctionLike(resolvedValue)
                && directFunctionOutputs(resolvedValue).returns.some(isTrackedCallableExpression)
                && !callableResultWildcards.has(target)
              ) {
                callableResultWildcards.add(target);
                changed = true;
              }
              if (
                isTrackedCallableExpression(resolvedValue)
                && !callableAccessorWildcards.has(target)
              ) {
                callableAccessorWildcards.add(target);
                changed = true;
              }
            }
          }
        }
      }
      for (const value of passthroughArgumentValues(expression)) {
        changed = propagateCallableInitializer(target, value) || changed;
      }
    }
    if (
      ts.isNewExpression(expression)
      && staticPropertyPath(expression.expression, constBindings)?.join('.') === 'Proxy'
      && expression.arguments?.[0]
    ) {
      const targetPath = staticPropertyPath(expression.arguments[0], constBindings)?.join('.');
      if (targetPath) changed = propagateCallableOutputs(target, targetPath) || changed;
      changed = propagateCallableInitializer(target, resolveInitializerNode(expression.arguments[0])) || changed;
      const handler = expression.arguments[1] && resolveInitializerNode(expression.arguments[1]);
      if (ts.isObjectLiteralExpression(handler)) {
        for (const property of handler.properties) {
          if (propertyNameText(property.name) !== 'get') continue;
          const trap = ts.isMethodDeclaration(property)
            ? property
            : ts.isPropertyAssignment(property)
              ? resolveInitializerNode(property.initializer)
              : null;
          if (!trap || !ts.isFunctionLike(trap)) continue;
          const outputs = directFunctionOutputs(trap).returns;
          if (outputs.some((output) => callableSourcePaths(output).some((path) => (
            outputPathTracked(path, callableResultBindings, callableResultWildcards)
          )))) {
            if (!callableResultWildcards.has(target)) {
              callableResultWildcards.add(target);
              changed = true;
            }
          }
        }
      }
    }
    if (ts.isConditionalExpression(expression)) {
      return [expression.whenTrue, expression.whenFalse]
        .some((value) => propagateCallableInitializer(target, value)) || changed;
    }
    if (ts.isBinaryExpression(expression)) {
      if (expression.operatorToken.kind === ts.SyntaxKind.CommaToken) {
        return propagateCallableInitializer(target, expression.right) || changed;
      }
      if (
        expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        || expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
        || expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) return [expression.left, expression.right]
        .some((value) => propagateCallableInitializer(target, value)) || changed;
    }
    if (source && isCallableContainer(source)) {
      if (callableContainers.has(target)) return changed;
      callableContainers.add(target);
      return true;
    }
    const propagateMember = (receiver, key) => {
      let changed = literalMemberValues(receiver, key)
        .some((value) => propagateCallableInitializer(target, value));
      const receiverExpression = unwrapExpression(receiver);
      const selectedIndex = /^\d+$/.test(key) ? Number(key) : null;
      if (ts.isArrayLiteralExpression(receiverExpression) && selectedIndex !== null) {
        for (const [index, element] of receiverExpression.elements.entries()) {
          if (index > selectedIndex || !ts.isSpreadElement(element)) continue;
          const spreadPath = staticPropertyPath(element.expression, constBindings)?.join('.');
          if (spreadPath && hasCallableDescendant(spreadPath)) {
            changed = recordCallableTarget(target) || changed;
          }
        }
      }
      for (const memberPath of literalMemberPaths(receiver, key)) {
        if (callableBindings.has(memberPath) || callablePaths.has(memberPath)) {
          changed = recordCallableTarget(target) || changed;
        }
        if (isCallableContainer(memberPath) && !callableContainers.has(target)) {
          callableContainers.add(target);
          changed = true;
        }
      }
      return changed;
    };
    if (ts.isPropertyAccessExpression(expression)) {
      return propagateMember(expression.expression, expression.name.text);
    }
    if (ts.isElementAccessExpression(expression) && expression.argumentExpression) {
      const argument = unwrapExpression(expression.argumentExpression);
      const key = ts.isNumericLiteral(argument)
        ? argument.text
        : staticStringValue(argument, constBindings);
      if (key !== null) return propagateMember(expression.expression, key);
    }
    if (ts.isArrayLiteralExpression(expression)) {
      for (const [index, element] of expression.elements.entries()) {
        if (ts.isOmittedExpression(element)) continue;
        const value = ts.isSpreadElement(element) ? element.expression : element;
        changed = propagateCallableInitializer(`${target}.${index}`, value) || changed;
      }
    }
    if (ts.isObjectLiteralExpression(expression)) {
      for (const property of expression.properties) {
        if (ts.isShorthandPropertyAssignment(property)) {
          changed = propagateCallableInitializer(`${target}.${property.name.text}`, property.name) || changed;
        } else if (ts.isPropertyAssignment(property)) {
          const propertyName = propertyNameText(property.name);
          changed = propagateCallableInitializer(
            propertyName === '__proto__' ? target : `${target}.${propertyName}`,
            property.initializer,
          ) || changed;
        } else if (ts.isSpreadAssignment(property)) {
          const spread = staticPropertyPath(property.expression, constBindings)?.join('.');
          if (spread) changed = propagateCallableOutputs(target, spread) || changed;
          changed = propagateCallableInitializer(target, property.expression) || changed;
        }
      }
    }
    return changed;
  };
  const propagateCallableBinding = (name, initializer) => {
    const target = unwrapExpression(name);
    const expression = unwrapExpression(initializer);
    if (ts.isIdentifier(target)) {
      return recordCallableOutputAliases(target.text, callableSourcePaths(expression))
        || propagateCallableInitializer(target.text, expression);
    }
    let changed = false;
    if (ts.isArrayBindingPattern(target) || ts.isArrayLiteralExpression(target)) {
      for (const [index, element] of target.elements.entries()) {
        if (ts.isOmittedExpression(element)) continue;
        const elementTarget = ts.isBindingElement(element)
          ? element.name
          : ts.isSpreadElement(element)
            ? element.expression
            : element;
        if (ts.isArrayLiteralExpression(expression)) {
          const value = expression.elements[index];
          if (value && !ts.isOmittedExpression(value)) {
            changed = propagateCallableBinding(
              elementTarget,
              ts.isSpreadElement(value) ? value.expression : value,
            ) || changed;
          }
        } else {
          for (const path of literalMemberPaths(expression, String(index))) {
            if (callableBindings.has(path) || callablePaths.has(path)) {
              const binding = unwrapExpression(elementTarget);
              if (ts.isIdentifier(binding)) changed = recordCallableTarget(binding.text) || changed;
            }
            const binding = unwrapExpression(elementTarget);
            if (ts.isIdentifier(binding)) {
              changed = recordCallableOutputAliases(binding.text, [path]) || changed;
            }
          }
        }
      }
      return changed;
    }
    if (ts.isObjectBindingPattern(target) || ts.isObjectLiteralExpression(target)) {
      for (const property of target.properties ?? target.elements) {
        if (ts.isBindingElement(property)) {
          if (property.dotDotDotToken) {
            const source = staticPropertyPath(expression, constBindings)?.join('.');
            const binding = unwrapExpression(property.name);
            if (source && ts.isIdentifier(binding)) {
              changed = propagateCallableOutputs(binding.text, source) || changed;
            }
            continue;
          }
          const key = property.propertyName
            ? propertyNameText(property.propertyName)
            : ts.isIdentifier(property.name)
              ? property.name.text
              : null;
          if (key === null) continue;
          for (const value of literalMemberValues(expression, key)) {
            changed = propagateCallableBinding(property.name, value) || changed;
          }
          for (const path of literalMemberPaths(expression, key)) {
            const binding = unwrapExpression(property.name);
            if (
              ts.isIdentifier(binding)
              && (callableBindings.has(path) || callablePaths.has(path))
            ) changed = recordCallableTarget(binding.text) || changed;
            if (ts.isIdentifier(binding)) {
              changed = recordCallableOutputAliases(binding.text, [path]) || changed;
            }
          }
        } else if (ts.isShorthandPropertyAssignment(property)) {
          for (const value of literalMemberValues(expression, property.name.text)) {
            changed = propagateCallableBinding(property.name, value) || changed;
          }
        } else if (ts.isPropertyAssignment(property)) {
          const key = propertyNameText(property.name);
          for (const value of literalMemberValues(expression, key)) {
            changed = propagateCallableBinding(property.initializer, value) || changed;
          }
        }
      }
    }
    return changed;
  };
  const objectLiteralBindingPath = (object) => {
    if (
      ts.isVariableDeclaration(object.parent)
      && object.parent.initializer === object
      && ts.isIdentifier(object.parent.name)
    ) return object.parent.name.text;
    if (
      ts.isPropertyAssignment(object.parent)
      && object.parent.initializer === object
      && ts.isObjectLiteralExpression(object.parent.parent)
    ) {
      const parent = objectLiteralBindingPath(object.parent.parent);
      return parent ? `${parent}.${propertyNameText(object.parent.name)}` : null;
    }
    if (ts.isCallExpression(object.parent)) {
      const call = object.parent;
      const callee = unwrapExpression(call.expression);
      if (
        (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))
        && (ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : callee.argumentExpression && computedName(callee.argumentExpression)) === 'assign'
        && staticPropertyPath(callee.expression, constBindings)?.join('.') === 'Object'
        && call.arguments.indexOf(object) > 0
      ) return staticPropertyPath(call.arguments[0], constBindings)?.join('.') ?? null;
    }
    return ts.isObjectLiteralExpression(object) ? anonymousOwnerPath(object, 'object') : null;
  };
  const callablePropertyName = (name) => {
    if (!ts.isComputedPropertyName(name)) return propertyNameText(name);
    return staticStringValue(name.expression, constBindings);
  };
  const definePropertyInstalledPath = (node) => {
    if (
      !(ts.isFunctionExpression(node) || ts.isArrowFunction(node))
      || !ts.isPropertyAssignment(node.parent)
      || !ts.isObjectLiteralExpression(node.parent.parent)
      || !ts.isCallExpression(node.parent.parent.parent)
    ) return null;
    const descriptor = node.parent.parent;
    const call = descriptor.parent;
    if (call.arguments[2] !== descriptor) return null;
    const callee = unwrapExpression(call.expression);
    if (!(ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))) return null;
    const method = ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : callee.argumentExpression && computedName(callee.argumentExpression);
    if (method !== 'defineProperty') return null;
    const owner = staticPropertyPath(callee.expression, constBindings)?.join('.');
    const target = call.arguments[0] && staticPropertyPath(call.arguments[0], constBindings)?.join('.');
    const key = call.arguments[1] && staticStringValue(call.arguments[1], constBindings);
    return (owner === 'Object' || owner === 'Reflect') && target && key ? `${target}.${key}` : null;
  };
  const functionBindingName = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
    if (
      (ts.isFunctionExpression(node) || ts.isArrowFunction(node))
      && ts.isVariableDeclaration(node.parent)
      && ts.isIdentifier(node.parent.name)
    ) return node.parent.name.text;
    if (
      (ts.isFunctionExpression(node) || ts.isArrowFunction(node))
      && ts.isPropertyAssignment(node.parent)
      && ts.isObjectLiteralExpression(node.parent.parent)
    ) {
      const installed = definePropertyInstalledPath(node);
      if (installed) return installed;
      const object = objectLiteralBindingPath(node.parent.parent);
      const name = callablePropertyName(node.parent.name);
      return object && name ? `${object}.${name}` : null;
    }
    if (
      (ts.isFunctionExpression(node) || ts.isArrowFunction(node))
      && ts.isBinaryExpression(node.parent)
      && node.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && node.parent.right === node
    ) {
      return staticPropertyPath(node.parent.left, constBindings)?.join('.') ?? null;
    }
    if (
      (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node))
      && ts.isObjectLiteralExpression(node.parent)
    ) {
      const object = objectLiteralBindingPath(node.parent);
      const name = callablePropertyName(node.name);
      return object && name ? `${object}.${name}` : null;
    }
    if (
      (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node))
      && (ts.isClassDeclaration(node.parent) || ts.isClassExpression(node.parent))
    ) {
      const className = classBindingName(node.parent);
      if (!className) return null;
      const prefix = node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)
        ? className
        : `${className}.prototype`;
      const name = callablePropertyName(node.name);
      return name ? `${prefix}.${name}` : null;
    }
    return null;
  };
  const unknownCallableMemberOwner = (node) => {
    if (
      (ts.isFunctionExpression(node) || ts.isArrowFunction(node))
      && ts.isPropertyAssignment(node.parent)
      && ts.isComputedPropertyName(node.parent.name)
      && ts.isObjectLiteralExpression(node.parent.parent)
    ) return objectLiteralBindingPath(node.parent.parent);
    if (
      (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node))
      && ts.isComputedPropertyName(node.name)
      && ts.isObjectLiteralExpression(node.parent)
    ) return objectLiteralBindingPath(node.parent);
    if (
      (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node))
      && ts.isComputedPropertyName(node.name)
      && (ts.isClassDeclaration(node.parent) || ts.isClassExpression(node.parent))
    ) {
      const className = classBindingName(node.parent);
      if (!className) return null;
      return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)
        ? className
        : `${className}.prototype`;
    }
    return null;
  };
  const isDefinePropertyGetter = (node) => (
    (ts.isFunctionExpression(node) || ts.isArrowFunction(node))
    && ts.isPropertyAssignment(node.parent)
    && callablePropertyName(node.parent.name) === 'get'
    && definePropertyInstalledPath(node) !== null
  );
  const propagateCallableInstaller = (node) => {
    if (!ts.isCallExpression(node)) return false;
    const calleePath = staticPropertyPath(node.expression, constBindings)?.join('.');
    let changed = false;
    const resolveInitializer = resolveInitializerNode;
    const valueCarriesCallableResult = (valueNode) => {
      const value = resolveInitializer(valueNode);
      if (ts.isFunctionLike(value)) {
        return directFunctionOutputs(value).returns.some(isTrackedCallableExpression);
      }
      return callableSourcePaths(value).some((path) => (
        outputPathTracked(path, callableResultBindings, callableResultWildcards)
      ));
    };
    const recordDescriptor = (target, key, descriptorNode) => {
      const descriptor = resolveInitializer(descriptorNode);
      let descriptorChanged = false;
      const valueNodes = literalMemberValues(descriptor, 'value');
      const getNodes = literalMemberValues(descriptor, 'get');
      const valuePaths = literalMemberPaths(descriptor, 'value');
      const getPaths = literalMemberPaths(descriptor, 'get');
      if (key !== null) {
        const installed = `${target}.${key}`;
        for (const value of valueNodes) {
          descriptorChanged = propagateCallableInitializer(installed, value) || descriptorChanged;
        }
        for (const path of valuePaths) {
          descriptorChanged = propagateCallableOutputs(installed, path) || descriptorChanged;
        }
        if (
          valueNodes.some(valueCarriesCallableResult)
          || valuePaths.some((path) => outputPathTracked(
            path,
            callableResultBindings,
            callableResultWildcards,
          ))
        ) {
          if (!callableResultBindings.has(installed)) {
            callableResultBindings.add(installed);
            descriptorChanged = true;
          }
        }
        if (
          getNodes.some((getter) => {
            const resolved = resolveInitializer(getter);
            return ts.isFunctionLike(resolved)
              && directFunctionOutputs(resolved).returns.some(isTrackedCallableExpression);
          })
          || getPaths.some((path) => outputPathTracked(
            path,
            callableResultBindings,
            callableResultWildcards,
          ))
        ) {
          if (!callableAccessorBindings.has(installed)) {
            callableAccessorBindings.add(installed);
            descriptorChanged = true;
          }
        }
      } else {
        if (
          valueNodes.some(valueCarriesCallableResult)
          || valuePaths.some((path) => outputPathTracked(
            path,
            callableResultBindings,
            callableResultWildcards,
          ))
        ) {
          if (!callableResultWildcards.has(target)) {
            callableResultWildcards.add(target);
            descriptorChanged = true;
          }
        }
        if (
          getNodes.some((getter) => {
            const resolved = resolveInitializer(getter);
            return ts.isFunctionLike(resolved)
              && directFunctionOutputs(resolved).returns.some(isTrackedCallableExpression);
          })
          || getPaths.some((path) => outputPathTracked(
            path,
            callableResultBindings,
            callableResultWildcards,
          ))
        ) {
          if (!callableAccessorWildcards.has(target)) {
            callableAccessorWildcards.add(target);
            descriptorChanged = true;
          }
        }
      }
      return descriptorChanged;
    };
    if (calleePath === 'Object.assign' && node.arguments.length >= 2) {
      const target = staticPropertyPath(node.arguments[0], constBindings)?.join('.');
      if (!target) return false;
      for (const sourceNode of node.arguments.slice(1)) {
        const source = staticPropertyPath(sourceNode, constBindings)?.join('.');
        if (source) changed = propagateCallableOutputs(target, source) || changed;
        changed = propagateCallableInitializer(target, resolveInitializer(sourceNode)) || changed;
      }
      return changed;
    }
    if (
      (calleePath === 'Object.setPrototypeOf' || calleePath === 'Reflect.setPrototypeOf')
      && node.arguments.length >= 2
    ) {
      const target = staticPropertyPath(node.arguments[0], constBindings)?.join('.');
      if (!target) return false;
      const source = staticPropertyPath(node.arguments[1], constBindings)?.join('.');
      if (source) changed = propagateCallableOutputs(target, source) || changed;
      return propagateCallableInitializer(target, resolveInitializer(node.arguments[1])) || changed;
    }
    if (
      (calleePath === 'Object.defineProperty' || calleePath === 'Reflect.defineProperty')
      && node.arguments.length >= 3
    ) {
      const target = staticPropertyPath(node.arguments[0], constBindings)?.join('.');
      const key = staticStringValue(node.arguments[1], constBindings);
      if (!target) return false;
      return recordDescriptor(target, key, node.arguments[2]);
    }
    if (calleePath === 'Object.defineProperties' && node.arguments.length >= 2) {
      const target = staticPropertyPath(node.arguments[0], constBindings)?.join('.');
      const descriptors = staticPropertyPath(node.arguments[1], constBindings)?.join('.');
      if (!target) return false;
      const descriptorMap = resolveInitializer(node.arguments[1]);
      if (ts.isObjectLiteralExpression(descriptorMap)) {
        for (const property of descriptorMap.properties) {
          if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;
          const key = ts.isComputedPropertyName(property.name)
            ? staticStringValue(property.name.expression, constBindings)
            : propertyNameText(property.name);
          const descriptor = ts.isShorthandPropertyAssignment(property)
            ? property.name
            : property.initializer;
          changed = recordDescriptor(target, key, descriptor) || changed;
        }
      }
      if (descriptors) {
        for (const path of [...callableResultBindings]) {
          if (!path.startsWith(`${descriptors}.`) || !path.endsWith('.value')) continue;
          const key = path.slice(descriptors.length + 1, -'.value'.length);
          changed = propagateCallableOutputs(`${target}.${key}`, path) || changed;
        }
      }
    }
    return changed;
  };
  let callableChanged = true;
  while (callableChanged) {
    callableChanged = false;
    walk(sourceFile, (node) => {
      callableChanged = propagateCallableInstaller(node) || callableChanged;
      if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ) {
        const assignedTarget = unwrapExpression(node.left);
        const assignedValue = unwrapExpression(node.right);
        callableChanged = recordClassAlias(assignedTarget, assignedValue) || callableChanged;
        callableChanged = propagateClassInstanceBinding(assignedTarget, assignedValue)
          || callableChanged;
        activeCallableDeclarations = new Map();
        for (const identifier of assignmentTargetIdentifiers(node.left)) {
          const declaration = visibleInitializerDeclaration(identifier);
          if (!declaration) continue;
          activeCallableDeclarations.set(identifier.text, new Set([
            `${declaration.scope.pos}:${declaration.initializer.pos}:${identifier.text}`,
          ]));
        }
        callableChanged = propagateCallableBinding(node.left, node.right) || callableChanged;
        activeCallableDeclarations = new Map();
        const target = staticPropertyPath(node.left, constBindings)?.join('.');
        const source = staticPropertyPath(node.right, constBindings)?.join('.');
        if (
          target
          && source
          && (callableBindings.has(source) || callablePaths.has(source) || isCallableContainer(source))
          && !callablePaths.has(target)
        ) {
          callablePaths.add(target);
          callableChanged = true;
        }
        if (target && source) {
          if (target.endsWith('.__proto__')) {
            const owner = target.slice(0, -'.__proto__'.length);
            callableChanged = propagateCallableOutputs(owner, source) || callableChanged;
            callableChanged = propagateCallableInitializer(
              owner,
              resolveInitializerNode(node.right),
            ) || callableChanged;
          }
          callableChanged = propagateCallableContainers(target, source) || callableChanged;
          callableChanged = propagateCallableOutputs(target, source) || callableChanged;
        }
        if (
          !target
          && source
          && ts.isElementAccessExpression(unwrapExpression(node.left))
          && (callableBindings.has(source) || callablePaths.has(source))
        ) {
          const container = staticPropertyPath(unwrapExpression(node.left).expression, constBindings)?.join('.');
          if (container && !callableContainers.has(container)) {
            callableContainers.add(container);
            callableChanged = true;
          }
        }
        return;
      }
      if (ts.isParameter(node) && node.initializer) {
        callableChanged = propagateCallableBinding(node.name, node.initializer) || callableChanged;
        return;
      }
      if (ts.isFunctionLike(node)) {
        const name = functionBindingName(node);
        const outputs = directFunctionOutputs(node);
        const unknownOwner = !name ? unknownCallableMemberOwner(node) : null;
        if (unknownOwner && outputs.returns.some(isTrackedCallableExpression)) {
          const wildcards = ts.isGetAccessorDeclaration(node)
            ? callableAccessorWildcards
            : callableResultWildcards;
          if (!wildcards.has(unknownOwner)) {
            wildcards.add(unknownOwner);
            callableChanged = true;
          }
        }
        if (unknownOwner && outputs.yields.some(isTrackedCallableExpression)) {
          if (!callableYieldWildcards.has(unknownOwner)) {
            callableYieldWildcards.add(unknownOwner);
            callableChanged = true;
          }
        }
        if (name) {
          const definitelySafe = (
            outputs.returns.length > 0
            && outputs.returns.every(definitelyNonCallableOutput)
          );
          if (definitelySafe && !callableSafeResultBindings.has(name)) {
            callableSafeResultBindings.add(name);
            callableChanged = true;
          }
          if (
            !definitelySafe
            &&
            outputs.returns.some(isTrackedCallableExpression)
          ) {
            const outputsSet = ts.isGetAccessorDeclaration(node) || isDefinePropertyGetter(node)
              ? callableAccessorBindings
              : callableResultBindings;
            if (!outputsSet.has(name)) {
              outputsSet.add(name);
              callableChanged = true;
            }
          }
          if (
            outputs.yields.some(isTrackedCallableExpression)
            && !callableYieldBindings.has(name)
          ) {
            callableYieldBindings.add(name);
            callableChanged = true;
          }
        }
      }
      if (!ts.isVariableDeclaration(node) || !node.initializer) return;
      const initializer = unwrapExpression(node.initializer);
      activeCallableDeclarations = ts.isIdentifier(node.name)
        ? new Map([[node.name.text, new Set([
          `${initializerScopeNode(node).pos}:${initializer.pos}:${node.name.text}`,
        ])]])
        : new Map();
      callableChanged = recordClassAlias(node.name, initializer) || callableChanged;
      callableChanged = propagateClassInstanceBinding(node.name, initializer) || callableChanged;
      callableChanged = propagateCallableBinding(node.name, node.initializer) || callableChanged;
      if (!ts.isIdentifier(node.name)) {
        activeCallableDeclarations = new Map();
        return;
      }
      const path = staticPropertyPath(node.initializer, constBindings)?.join('.');
      if (path) {
        callableChanged = propagateCallableContainers(node.name.text, path) || callableChanged;
      }
      callableChanged = propagateCallableInitializer(node.name.text, node.initializer) || callableChanged;
      if (
        path
        && (callableBindings.has(path) || callablePaths.has(path))
        && !callableBindings.has(node.name.text)
      ) {
        callableBindings.add(node.name.text);
        callableChanged = true;
      }
      activeCallableDeclarations = new Map();
    });
  }
  const couldProduceCallable = (node) => {
    const expression = unwrapExpression(node);
    const path = staticPropertyPath(expression, constBindings);
    return ts.isFunctionExpression(expression)
      || ts.isArrowFunction(expression)
      || ts.isClassExpression(expression)
      || ts.isCallExpression(expression)
      || (ts.isIdentifier(expression) && isScopedCallableIdentifier(expression))
      || callablePaths.has(path?.join('.'))
      || (path && path.some((_, index) => callableContainers.has(path.slice(0, index + 1).join('.'))));
  };
  walk(sourceFile, (node) => {
    if (
      (ts.isCallExpression(node) || ts.isNewExpression(node))
      && node.arguments?.some((argument) => containsCallableContainer(argument))
    ) unsafe = true;
    if (ts.isReturnStatement(node) && node.expression && containsCallableContainer(node.expression)) unsafe = true;
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body) && containsCallableContainer(node.body)) unsafe = true;
    if (ts.isYieldExpression(node) && node.expression && containsCallableContainer(node.expression)) unsafe = true;
    if (ts.isParameter(node) && node.initializer && containsCallableContainer(node.initializer)) unsafe = true;
    if (ts.isPropertyDeclaration(node) && node.initializer && containsCallableContainer(node.initializer)) unsafe = true;
    if (ts.isParameter(node) && node.initializer && isTrackedCallableExpression(node.initializer)) unsafe = true;
    if (ts.isPropertyDeclaration(node) && node.initializer && isTrackedCallableExpression(node.initializer)) unsafe = true;
    if (ts.isIdentifier(node) && DYNAMIC_CODE_NAMES.has(node.text)) unsafe = true;
    if (
      ts.isPropertyAccessExpression(node)
      && (DYNAMIC_CODE_NAMES.has(node.name.text) || node.name.text === 'constructor')
    ) unsafe = true;
    if (
      ts.isElementAccessExpression(node)
      && node.argumentExpression
      && (
        DYNAMIC_CODE_NAMES.has(computedName(node.argumentExpression))
        || computedName(node.argumentExpression) === 'constructor'
      )
    ) unsafe = true;
    if (
      ts.isElementAccessExpression(node)
      && node.argumentExpression
      && computedName(node.argumentExpression) === null
      && (
        couldProduceCallable(node.expression)
        || ts.isElementAccessExpression(unwrapExpression(node.expression))
        || (ts.isCallExpression(node.parent) && node.parent.expression === node)
      )
    ) unsafe = true;
    if (
      ts.isElementAccessExpression(node)
      && node.argumentExpression
      && computedName(node.argumentExpression) === null
      && ts.isVariableDeclaration(node.parent)
      && node.parent.initializer === node
      && ts.isIdentifier(node.parent.name)
      && directlyInvokedBindings.has(node.parent.name.text)
    ) unsafe = true;
    if (
      ts.isElementAccessExpression(node)
      && node.argumentExpression
      && computedName(node.argumentExpression) === null
      && ts.isBinaryExpression(node.parent)
      && node.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && node.parent.right === node
      && directlyInvokedPaths.has(staticPropertyPath(node.parent.left, constBindings)?.join('.'))
    ) unsafe = true;
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === 'Reflect'
      && node.expression.name.text === 'construct'
    ) unsafe = true;
  });
  return unsafe
    ? ['src/lib/dm/runtime.ts: governed runtime source must not use dynamic code evaluation or function construction']
    : [];
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

function enclosingBlock(node) {
  let current = node;
  while (current && !ts.isBlock(current)) current = current.parent;
  return current ?? null;
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
    || ts.isAwaitExpression(current)
  ) current = current.expression;
  return current;
}

function staticPropertyPath(node, stringBindings = new Map()) {
  const expression = unwrapExpression(node);
  if (ts.isIdentifier(expression)) return [expression.text];
  if (ts.isPropertyAccessExpression(expression)) {
    const parentPath = staticPropertyPath(expression.expression, stringBindings);
    return parentPath ? [...parentPath, expression.name.text] : null;
  }
  if (ts.isElementAccessExpression(expression)) {
    const argument = expression.argumentExpression && unwrapExpression(expression.argumentExpression);
    const property = argument && (ts.isNumericLiteral(argument)
      ? argument.text
      : staticStringValue(argument, stringBindings));
    if (property === null || property === undefined) return null;
    const container = unwrapExpression(expression.expression);
    if (ts.isArrayLiteralExpression(container) && /^\d+$/.test(property)) {
      const element = container.elements[Number(property)];
      if (!element || ts.isOmittedExpression(element)) return null;
      return staticPropertyPath(ts.isSpreadElement(element) ? element.expression : element, stringBindings);
    }
    const parentPath = staticPropertyPath(container, stringBindings);
    if (!parentPath) return null;
    return [...parentPath, property];
  }
  return null;
}

function possiblePropertyPaths(node) {
  const expression = unwrapExpression(node);
  if (ts.isTaggedTemplateExpression(expression)) return possiblePropertyPaths(expression.template);
  if (ts.isTemplateExpression(expression)) {
    return expression.templateSpans.flatMap((span) => possiblePropertyPaths(span.expression));
  }
  if (ts.isConditionalExpression(expression)) {
    return [
      ...possiblePropertyPaths(expression.whenTrue),
      ...possiblePropertyPaths(expression.whenFalse),
    ];
  }
  if (
    ts.isBinaryExpression(expression)
    && (
      expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      || expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
      || expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    )
  ) {
    return [
      ...possiblePropertyPaths(expression.left),
      ...possiblePropertyPaths(expression.right),
    ];
  }
  if (
    ts.isBinaryExpression(expression)
    && expression.operatorToken.kind === ts.SyntaxKind.CommaToken
  ) return possiblePropertyPaths(expression.right);
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.flatMap((element) => (
      ts.isOmittedExpression(element)
        ? []
        : possiblePropertyPaths(ts.isSpreadElement(element) ? element.expression : element)
    ));
  }
  const path = staticPropertyPath(expression);
  return path ? [path] : [];
}

function assignmentTargetExpressions(node) {
  const target = unwrapExpression(node);
  if (
    ts.isIdentifier(target)
    || ts.isPropertyAccessExpression(target)
    || ts.isElementAccessExpression(target)
  ) return [target];
  if (ts.isBinaryExpression(target) && target.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return assignmentTargetExpressions(target.left);
  }
  if (ts.isArrayLiteralExpression(target) || ts.isArrayBindingPattern(target)) {
    return target.elements.flatMap((element) => {
      if (ts.isOmittedExpression(element)) return [];
      if (ts.isBindingElement(element)) return assignmentTargetExpressions(element.name);
      return assignmentTargetExpressions(ts.isSpreadElement(element) ? element.expression : element);
    });
  }
  if (ts.isObjectLiteralExpression(target)) {
    return target.properties.flatMap((property) => {
      if (ts.isShorthandPropertyAssignment(property)) return assignmentTargetExpressions(property.name);
      if (ts.isPropertyAssignment(property)) return assignmentTargetExpressions(property.initializer);
      if (ts.isSpreadAssignment(property)) return assignmentTargetExpressions(property.expression);
      return [];
    });
  }
  if (ts.isObjectBindingPattern(target)) {
    return target.elements.flatMap((element) => assignmentTargetExpressions(element.name));
  }
  return [];
}

function containedPropertyPaths(node) {
  const paths = [];
  const visit = (current) => {
    if (current !== node && ts.isFunctionLike(current)) return;
    if (current !== node) {
      const isNestedPropertyBase = (
        (ts.isPropertyAccessExpression(current.parent) || ts.isElementAccessExpression(current.parent))
        && current.parent.expression === current
      );
      const isApprovedArtifactArrayArgument = (
        ts.isIdentifier(current)
        && current.text === 'ArtifactReferenceSchema'
        && ts.isCallExpression(current.parent)
        && current.parent.arguments.includes(current)
        && ts.isPropertyAccessExpression(current.parent.expression)
        && ts.isIdentifier(current.parent.expression.expression)
        && current.parent.expression.expression.text === 'z'
        && current.parent.expression.name.text === 'array'
      );
      const path = !isNestedPropertyBase && !isApprovedArtifactArrayArgument
        ? staticPropertyPath(current)
        : null;
      if (path) paths.push(path);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return paths;
}

const GOVERNED_INTRINSIC_PROTOTYPES = new Set([
  'Array',
  'Map',
  'Object',
  'Set',
  'String',
  'UnknownIntrinsic',
  'WeakMap',
  'WeakSet',
]);

function trustedPrimitiveMutationFailures(sourceFile) {
  const aliases = new Map();
  const intrinsicContainers = new Map();
  const intrinsicContainerAliases = new Map();
  const constBindings = immutableConstBindings(sourceFile);
  const aliasAssignments = new Set();
  const intrinsicValues = new Map();
  const ambiguousIntrinsicValues = new Set();
  const canonicalGlobalPath = (path) => {
    if (!path) return null;
    let selfLinkLength = 0;
    while (['globalThis', 'global'].includes(path[selfLinkLength])) selfLinkLength += 1;
    return selfLinkLength > 0 ? ['globalThis', ...path.slice(selfLinkLength)] : [...path];
  };
  const intrinsicPrototypeForValue = (node) => {
    const target = unwrapExpression(node);
    if (ts.isIdentifier(target) && intrinsicValues.has(target.text)) return intrinsicValues.get(target.text);
    if (ts.isArrayLiteralExpression(target)) return ['Array', 'prototype'];
    if (ts.isObjectLiteralExpression(target)) return ['Object', 'prototype'];
    if (ts.isStringLiteral(target) || ts.isNoSubstitutionTemplateLiteral(target)) return ['String', 'prototype'];
    if (
      ts.isNewExpression(target)
      && ts.isIdentifier(target.expression)
      && GOVERNED_INTRINSIC_PROTOTYPES.has(target.expression.text)
    ) return [target.expression.text, 'prototype'];
    return null;
  };
  let intrinsicValuesChanged = true;
  while (intrinsicValuesChanged) {
    intrinsicValuesChanged = false;
    walk(sourceFile, (node) => {
      let name = null;
      let initializer = null;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        name = node.name.text;
        initializer = node.initializer;
      } else if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isIdentifier(unwrapExpression(node.left))
      ) {
        name = unwrapExpression(node.left).text;
        initializer = node.right;
      }
      if (!name || !initializer) return;
      if (ambiguousIntrinsicValues.has(name)) return;
      const prototype = intrinsicPrototypeForValue(initializer);
      const existing = intrinsicValues.get(name);
      if (prototype && existing && existing.join('.') !== prototype.join('.')) {
        intrinsicValues.delete(name);
        ambiguousIntrinsicValues.add(name);
        intrinsicValuesChanged = true;
      } else if (prototype && !existing) {
        intrinsicValues.set(name, prototype);
        intrinsicValuesChanged = true;
      }
    });
  }
  const resolveDirectPath = (node) => {
    const expression = unwrapExpression(node);
    const resolvedCalleePath = (callee) => {
      let path = canonicalGlobalPath(staticPropertyPath(callee, constBindings));
      if (!path) return null;
      const seen = new Set();
      while (!seen.has(path.join('.'))) {
        seen.add(path.join('.'));
        let expanded = false;
        for (let length = path.length; length > 0; length -= 1) {
          const replacement = aliases.get(path.slice(0, length).join('.'));
          if (replacement) {
            path = [...replacement, ...path.slice(length)];
            expanded = true;
            break;
          }
          const containerKey = path.slice(0, length).join('.');
          if (intrinsicContainerAliases.has(containerKey) && path.length > length) {
            const container = intrinsicContainerAliases.get(containerKey);
            if (!container) {
              return path.length > length + 1
                ? ['UnknownIntrinsic', ...path.slice(length + 2)]
                : path;
            }
            path = [...container, ...path.slice(length + 1)];
            expanded = true;
            break;
          }
          const carrier = intrinsicContainers.get(containerKey);
          if (carrier && path.length > length) {
            return [...carrier, ...path.slice(length + 1)];
          }
        }
        if (!expanded) return canonicalGlobalPath(path);
      }
      return canonicalGlobalPath(path);
    };
    const canonicalIntrinsic = (path) => {
      const name = path?.length === 1
        ? path[0]
        : path?.length === 2 && path[0] === 'globalThis'
          ? path[1]
          : null;
      return name
        && GOVERNED_INTRINSIC_PROTOTYPES.has(name)
        ? name
        : null;
    };
    const staticMemberName = (member) => {
      if (ts.isPropertyAccessExpression(member)) return member.name.text;
      if (ts.isElementAccessExpression(member) && member.argumentExpression) {
        return staticStringValue(member.argumentExpression, constBindings);
      }
      return null;
    };
    const reflectionPrototype = (call, expectedCallee) => {
      if (!ts.isCallExpression(call) || resolvedCalleePath(call.expression)?.join('.') !== expectedCallee) return null;
      const target = call.arguments[0] && unwrapExpression(call.arguments[0]);
      const targetPath = target && resolvedCalleePath(target);
      const intrinsic = canonicalIntrinsic(targetPath);
      const property = call.arguments[1] && staticStringValue(call.arguments[1], constBindings);
      if (
        expectedCallee === 'Reflect.get'
        && targetPath?.length === 2
        && GOVERNED_INTRINSIC_PROTOTYPES.has(targetPath[0])
        && targetPath[1] === 'prototype'
        && property === 'value'
      ) return targetPath;
      if (
        expectedCallee === 'Reflect.get'
        && targetPath?.length === 2
        && GOVERNED_INTRINSIC_PROTOTYPES.has(targetPath[0])
        && targetPath[1] === 'prototype'
        && property === null
      ) return targetPath;
      if (intrinsic && property === null) return ['UnknownIntrinsic', 'prototype'];
      return intrinsic
        && GOVERNED_INTRINSIC_PROTOTYPES.has(intrinsic)
        && property === 'prototype'
        ? [intrinsic, 'prototype']
        : null;
    };
    if (
      ts.isCallExpression(expression)
      && resolvedCalleePath(expression.expression)?.join('.') === 'Object.getOwnPropertyDescriptors'
    ) {
      const targetPath = expression.arguments[0] && resolvedCalleePath(expression.arguments[0]);
      const intrinsic = canonicalIntrinsic(targetPath);
      if (intrinsic) return [intrinsic, '$descriptors'];
      if (targetPath?.every((segment) => segment === 'globalThis')) {
        return ['UnknownIntrinsic', '$descriptors'];
      }
    }
    const pluralDescriptorEntry = (member) => {
      if (
        (!ts.isPropertyAccessExpression(member) && !ts.isElementAccessExpression(member))
        || staticMemberName(member) !== 'prototype'
      ) return null;
      const call = unwrapExpression(member.expression);
      if (
        !ts.isCallExpression(call)
        || resolvedCalleePath(call.expression)?.join('.') !== 'Object.getOwnPropertyDescriptors'
      ) return null;
      const intrinsic = canonicalIntrinsic(call.arguments[0] && resolvedCalleePath(call.arguments[0]));
      return intrinsic ? [intrinsic, 'prototype'] : null;
    };
    const pluralEntry = pluralDescriptorEntry(expression);
    if (pluralEntry) return pluralEntry;
    if (
      ts.isCallExpression(expression)
      && resolvedCalleePath(expression.expression)?.join('.') === 'Reflect.get'
      && resolvedCalleePath(expression.arguments[0])?.join('.') === 'globalThis'
      && staticStringValue(expression.arguments[1], constBindings) === null
    ) return ['UnknownIntrinsic'];
    if (
      ts.isElementAccessExpression(expression)
      && expression.argumentExpression
      && resolvedCalleePath(expression.expression)?.every((segment) => segment === 'globalThis')
      && staticStringValue(expression.argumentExpression, constBindings) === null
    ) return ['UnknownIntrinsic'];
    const reflectedPrototype = reflectionPrototype(expression, 'Reflect.get');
    if (reflectedPrototype) return reflectedPrototype;
    const directDescriptorPrototype = reflectionPrototype(expression, 'Object.getOwnPropertyDescriptor')
      ?? reflectionPrototype(expression, 'Reflect.getOwnPropertyDescriptor');
    if (directDescriptorPrototype) return directDescriptorPrototype;
    if (
      (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression))
      && staticMemberName(expression) === 'value'
    ) {
      const descriptorCall = unwrapExpression(expression.expression);
      if (
        ts.isCallExpression(descriptorCall)
        && ['Object.getOwnPropertyDescriptor', 'Reflect.getOwnPropertyDescriptor'].includes(
          resolvedCalleePath(descriptorCall.expression)?.join('.'),
        )
        && resolvedCalleePath(descriptorCall.arguments[0])?.join('.') === 'globalThis'
        && staticStringValue(descriptorCall.arguments[1], constBindings) === null
      ) return ['UnknownIntrinsic'];
      const descriptorPrototype = reflectionPrototype(descriptorCall, 'Object.getOwnPropertyDescriptor')
        ?? reflectionPrototype(descriptorCall, 'Reflect.getOwnPropertyDescriptor');
      if (descriptorPrototype) return descriptorPrototype;
      const pluralPrototype = pluralDescriptorEntry(descriptorCall);
      if (pluralPrototype) return pluralPrototype;
    }
    if (
      ts.isCallExpression(expression)
      && ['Object.getPrototypeOf', 'Reflect.getPrototypeOf'].includes(
        resolvedCalleePath(expression.expression)?.join('.'),
      )
      && expression.arguments.length === 1
    ) return intrinsicPrototypeForValue(expression.arguments[0]) ?? ['UnknownIntrinsic', 'prototype'];
    if (
      (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression))
      && propertyNameText(expression.name ?? expression.argumentExpression) === '__proto__'
    ) return intrinsicPrototypeForValue(expression.expression);
    if (ts.isPropertyAccessExpression(expression)) {
      const descriptorParent = resolvedCalleePath(expression.expression);
      if (descriptorParent?.length === 2 && descriptorParent[1] === '$descriptors' && expression.name.text === 'prototype') {
        return [descriptorParent[0], 'prototype'];
      }
      const parent = resolveDirectPath(expression.expression);
      if (
        parent?.length === 2
        && GOVERNED_INTRINSIC_PROTOTYPES.has(parent[0])
        && parent[1] === 'prototype'
        && expression.name.text === 'value'
      ) return parent;
      if (parent) return [...parent, expression.name.text];
    }
    if (ts.isElementAccessExpression(expression) && expression.argumentExpression) {
      const argument = unwrapExpression(expression.argumentExpression);
      const property = ts.isNumericLiteral(argument)
        ? argument.text
        : staticStringValue(argument, constBindings);
      const descriptorParent = property === null ? null : resolvedCalleePath(expression.expression);
      if (descriptorParent?.length === 2 && descriptorParent[1] === '$descriptors' && property === 'prototype') {
        return [descriptorParent[0], 'prototype'];
      }
      const dynamicDescriptorParent = property === null ? resolvedCalleePath(expression.expression) : null;
      if (dynamicDescriptorParent?.length === 2 && dynamicDescriptorParent[1] === '$descriptors') {
        return ['UnknownIntrinsic', 'prototype'];
      }
      const parent = property === null ? null : resolveDirectPath(expression.expression);
      if (parent && property !== null) return [...parent, property];
    }
    return canonicalGlobalPath(staticPropertyPath(expression, constBindings));
  };
  const expandAlias = (path) => {
    if (!path) return null;
    for (let length = path.length; length > 0; length -= 1) {
      const replacement = aliases.get(path.slice(0, length).join('.'));
      if (replacement) return [...replacement, ...path.slice(length)];
    }
    return path;
  };
  const storeAlias = (name, path) => {
    if (aliases.get(name)?.join('.') === path.join('.')) return false;
    aliases.set(name, path);
    return true;
  };
  const recordAlias = (name, initializer) => {
    const target = unwrapExpression(name);
    const expression = unwrapExpression(initializer);
    const targetPath = staticPropertyPath(target, constBindings);
    if (!targetPath && ts.isElementAccessExpression(target)) {
      const container = staticPropertyPath(target.expression, constBindings)?.join('.');
      const source = expandAlias(resolveDirectPath(expression));
      const carrier = source
        && GOVERNED_INTRINSIC_PROTOTYPES.has(source[0])
        && (source.length === 1 || (source.length === 2 && source[1] === '$descriptors'))
        ? source
        : null;
      if (container && carrier) {
        const existing = intrinsicContainers.get(container);
        const next = existing && existing.join('.') !== carrier.join('.')
          ? existing.at(-1) === '$descriptors' && carrier.at(-1) === '$descriptors'
            ? ['UnknownIntrinsic', '$descriptors']
            : ['UnknownIntrinsic']
          : carrier;
        if (existing?.join('.') === next.join('.')) return false;
        intrinsicContainers.set(container, next);
        return true;
      }
      const sourceContainer = source?.join('.');
      if (
        container
        && sourceContainer
        && (intrinsicContainers.has(sourceContainer) || intrinsicContainerAliases.has(sourceContainer))
      ) {
        if (!intrinsicContainerAliases.has(container)) {
          intrinsicContainerAliases.set(container, source);
          return true;
        }
        const existing = intrinsicContainerAliases.get(container);
        if (existing === null || existing.join('.') === source.join('.')) return false;
        intrinsicContainerAliases.set(container, null);
        return true;
      }
    }
    if (targetPath && targetPath.length > 1) {
      const path = expandAlias(resolveDirectPath(expression));
      return path ? storeAlias(targetPath.join('.'), path) : false;
    }
    if (ts.isIdentifier(target) && ts.isArrayLiteralExpression(expression)) {
      let recorded = false;
      for (const [index, element] of expression.elements.entries()) {
        if (ts.isOmittedExpression(element)) continue;
        const value = ts.isSpreadElement(element) ? element.expression : element;
        const path = expandAlias(resolveDirectPath(value));
        if (path) recorded = storeAlias(`${target.text}.${index}`, path) || recorded;
      }
      return recorded;
    }
    if (ts.isIdentifier(target) && ts.isObjectLiteralExpression(expression)) {
      let recorded = false;
      const recordObject = (object, prefix) => {
        for (const property of object.properties) {
          if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;
          const key = `${prefix}.${propertyNameText(property.name)}`;
          const value = ts.isShorthandPropertyAssignment(property) ? property.name : unwrapExpression(property.initializer);
          if (ts.isObjectLiteralExpression(value)) recordObject(value, key);
          const path = expandAlias(resolveDirectPath(value));
          if (path) recorded = storeAlias(key, path) || recorded;
        }
      };
      recordObject(expression, target.text);
      return recorded;
    }
    if (ts.isObjectBindingPattern(target)) {
      const source = expandAlias(resolveDirectPath(expression));
      if (!source) return false;
      let recorded = false;
      for (const element of target.elements) {
        if (element.dotDotDotToken || !ts.isIdentifier(element.name)) continue;
        const property = element.propertyName ? propertyNameText(element.propertyName) : element.name.text;
        recorded = storeAlias(element.name.text, [...source, property]) || recorded;
      }
      return recorded;
    }
    if (!ts.isIdentifier(target)) return false;
    const path = expandAlias(resolveDirectPath(expression));
    if (!path || (path.length === 1 && path[0] === target.text)) return false;
    return storeAlias(target.text, path);
  };
  let changed = true;
  while (changed) {
    changed = false;
    walk(sourceFile, (node) => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        changed = recordAlias(node.name, node.initializer) || changed;
        return;
      }
      if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && recordAlias(node.left, node.right)
      ) {
        aliasAssignments.add(node);
        changed = true;
      }
    });
  }
  const resolvePath = (node) => expandAlias(resolveDirectPath(node));
  const governed = (path) => Boolean(path) && (
    (path[0] === 'z' && path.length > 1)
    || (GOVERNED_INTRINSIC_PROTOTYPES.has(path[0]) && path[1] === 'prototype')
  );
  const rawGovernedTarget = (node) => governed(
    canonicalGlobalPath(staticPropertyPath(node, constBindings)),
  );
  const unresolvedComputedTargetIsGoverned = (node) => {
    let found = false;
    const visit = (current) => {
      const expression = unwrapExpression(current);
      if (
        ts.isElementAccessExpression(expression)
        && expression.argumentExpression
        && staticStringValue(expression.argumentExpression, constBindings) === null
      ) {
        const owner = resolvePath(expression.expression);
        if (
          governed(owner)
          || owner?.join('.') === 'z'
          || (owner?.length === 1 && GOVERNED_INTRINSIC_PROTOTYPES.has(owner[0]))
        ) found = true;
      }
      ts.forEachChild(expression, visit);
    };
    visit(node);
    return found;
  };
  const possiblePrimitivePaths = (node) => {
    const expression = unwrapExpression(node);
    if (ts.isTaggedTemplateExpression(expression)) return possiblePrimitivePaths(expression.template);
    if (ts.isTemplateExpression(expression)) {
      return expression.templateSpans.flatMap((span) => possiblePrimitivePaths(span.expression));
    }
    if (ts.isConditionalExpression(expression)) {
      return [...possiblePrimitivePaths(expression.whenTrue), ...possiblePrimitivePaths(expression.whenFalse)];
    }
    if (ts.isBinaryExpression(expression)) {
      if (expression.operatorToken.kind === ts.SyntaxKind.CommaToken) {
        return possiblePrimitivePaths(expression.right);
      }
      if (
        expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        || expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
        || expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) return [...possiblePrimitivePaths(expression.left), ...possiblePrimitivePaths(expression.right)];
    }
    if (ts.isArrayLiteralExpression(expression)) {
      return expression.elements.flatMap((element) => (
        ts.isOmittedExpression(element)
          ? []
          : possiblePrimitivePaths(ts.isSpreadElement(element) ? element.expression : element)
      ));
    }
    if (ts.isObjectLiteralExpression(expression)) {
      return expression.properties.flatMap((property) => {
        if (ts.isShorthandPropertyAssignment(property)) return possiblePrimitivePaths(property.name);
        if (ts.isPropertyAssignment(property)) return possiblePrimitivePaths(property.initializer);
        if (ts.isSpreadAssignment(property)) return possiblePrimitivePaths(property.expression);
        return [];
      });
    }
    const path = resolvePath(expression);
    return path ? [path] : [];
  };
  const governedStoredValue = (node) => possiblePrimitivePaths(node).some((path) => (
    governed(path)
    || path.join('.') === 'z'
    || path.join('.') === 'globalThis'
    || (path.length === 1 && GOVERNED_INTRINSIC_PROTOTYPES.has(path[0]))
    || (path.length === 2 && path[1] === '$descriptors')
    || intrinsicContainers.has(path.join('.'))
    || intrinsicContainerAliases.has(path.join('.'))
  ));
  let mutated = false;
  walk(sourceFile, (node) => {
    if (
      ts.isElementAccessExpression(node)
      && node.argumentExpression
      && staticStringValue(node.argumentExpression, constBindings) === null
      && unresolvedComputedTargetIsGoverned(node)
    ) mutated = true;
    if (ts.isReturnStatement(node) && node.expression && governedStoredValue(node.expression)) mutated = true;
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body) && governedStoredValue(node.body)) mutated = true;
    if (ts.isYieldExpression(node) && node.expression && governedStoredValue(node.expression)) mutated = true;
    if (ts.isParameter(node) && node.initializer && governedStoredValue(node.initializer)) mutated = true;
    if (ts.isPropertyDeclaration(node) && node.initializer && governedStoredValue(node.initializer)) mutated = true;
    if (ts.isTaggedTemplateExpression(node) && ts.isTemplateExpression(node.template)) {
      if (node.template.templateSpans.some((span) => governedStoredValue(span.expression))) mutated = true;
    }
    if (ts.isVariableDeclaration(node) && node.initializer && governedStoredValue(node.initializer)) mutated = true;
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && governedStoredValue(node.right)
    ) mutated = true;
    if (
      ts.isArrayLiteralExpression(node)
      && node.elements.some((element) => (
        !ts.isOmittedExpression(element)
        && governedStoredValue(ts.isSpreadElement(element) ? element.expression : element)
      ))
    ) mutated = true;
    if (
      ts.isPropertyAssignment(node)
      && governedStoredValue(node.initializer)
    ) mutated = true;
    if (
      (ts.isCallExpression(node) || ts.isNewExpression(node))
      && node.arguments?.some((argument) => governedStoredValue(argument))
    ) mutated = true;
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      && (
        unresolvedComputedTargetIsGoverned(node.left)
        ||
        rawGovernedTarget(node.left)
        || assignmentTargetExpressions(node.left).some(rawGovernedTarget)
        || (
          !aliasAssignments.has(node)
          && (
            governed(resolvePath(node.left))
            || assignmentTargetExpressions(node.left).some((target) => governed(resolvePath(target)))
          )
        )
      )
    ) mutated = true;
    if (
      ts.isDeleteExpression(node)
      && (
        unresolvedComputedTargetIsGoverned(node.expression)
        || governed(resolvePath(node.expression))
      )
    ) mutated = true;
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
      && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)
      && (
        unresolvedComputedTargetIsGoverned(node.operand)
        || governed(resolvePath(node.operand))
      )
    ) mutated = true;
    if (
      (ts.isForInStatement(node) || ts.isForOfStatement(node))
      && !ts.isVariableDeclarationList(node.initializer)
      && assignmentTargetExpressions(node.initializer).some((target) => (
        unresolvedComputedTargetIsGoverned(target) || governed(resolvePath(target))
      ))
    ) mutated = true;
    if (!ts.isCallExpression(node)) return;
    const calleePath = resolvePath(node.expression);
    const method = calleePath?.at(-1);
    const ownerName = calleePath?.length === 2 ? calleePath[0] : null;
    if (governed(calleePath?.slice(0, -1))) mutated = true;
    if (
      ((ownerName === 'Object' && ['defineProperty', 'defineProperties', 'setPrototypeOf', 'assign'].includes(method))
        || (ownerName === 'Reflect' && ['defineProperty', 'set', 'setPrototypeOf'].includes(method)))
      && (() => {
        const target = node.arguments[0] ? resolvePath(node.arguments[0]) : null;
        return governed(target) || target?.[0] === 'z';
      })()
    ) mutated = true;
  });
  return mutated
    ? ['src/lib/dm/runtime.ts: governed Zod methods and intrinsic prototypes must not be mutated']
    : [];
}

const GOVERNED_V2_DEPENDENCY_PATHS = new Map([
  ['publicRun.evidenceLedger', ['publicRun', 'evidenceLedger']],
  ['publicRun.searchProjects', ['publicRun', 'searchProjects']],
  ['publicRun.getProject', ['publicRun', 'getProject']],
  ['publicRun.readResume', ['publicRun', 'readResume']],
  ['publicRun.getContact', ['publicRun', 'getContact']],
  ['publicRun.searchPublicSources', ['publicRun', 'searchPublicSources']],
  ['publicToolGate.waitForIdle', ['publicToolGate', 'waitForIdle']],
  ['artifacts.projects', ['artifacts', 'projects']],
  ['artifacts.resumeTracks', ['artifacts', 'resumeTracks']],
  ['artifacts.contact', ['artifacts', 'contact']],
  ['artifacts.sources', ['artifacts', 'sources']],
]);

function governedV2DependencyMutationFailures(sourceFile) {
  const mutated = new Set();
  const aliases = new Map([['run', [['publicRun']]]]);
  const scopedAliases = new Map();
  const lexicalScopeChain = (node) => {
    const scopes = [];
    let current = node;
    while (current && current !== sourceFile) {
      if (ts.isBlock(current)) scopes.push(`block:${current.pos}`);
      if (ts.isFunctionLike(current)) scopes.push(`function:${current.pos}`);
      current = current.parent;
    }
    scopes.push('source');
    return [...new Set(scopes)];
  };
  const lexicalScopeKey = (node) => lexicalScopeChain(node)[0];
  const bindingScopes = new Map();
  const authenticatedRunScopes = new Set();
  const functionScopeKey = (node) => (
    lexicalScopeChain(node).find((scope) => scope.startsWith('function:')) ?? 'source'
  );
  const bindingIdentifiers = (name) => {
    const target = unwrapExpression(name);
    if (ts.isIdentifier(target)) return [target];
    if (ts.isObjectBindingPattern(target) || ts.isArrayBindingPattern(target)) {
      return target.elements.flatMap((element) => (
        ts.isOmittedExpression(element) ? [] : bindingIdentifiers(element.name)
      ));
    }
    return [];
  };
  walk(sourceFile, (node) => {
    if (!ts.isVariableDeclaration(node) && !ts.isParameter(node)) return;
    const isFunctionScopedVar = ts.isVariableDeclaration(node)
      && ts.isVariableDeclarationList(node.parent)
      && (node.parent.flags & ts.NodeFlags.BlockScoped) === 0;
    const scope = ts.isParameter(node) || isFunctionScopedVar
      ? functionScopeKey(node)
      : lexicalScopeKey(node.parent);
    for (const identifier of bindingIdentifiers(node.name)) {
      const scopes = bindingScopes.get(identifier.text) ?? new Set();
      scopes.add(scope);
      bindingScopes.set(identifier.text, scopes);
      if (
        identifier.text === 'run'
        && ts.isParameter(node)
        && ts.isFunctionDeclaration(node.parent)
        && node.parent.name?.text === 'createRuntimePublicTools'
      ) authenticatedRunScopes.add(scope);
    }
  });
  const normalizeScopeChain = (scope) => (
    Array.isArray(scope) ? scope : scope ? [scope, 'source'] : ['source']
  );
  const visibleBindingScope = (name, scope) => {
    const declared = bindingScopes.get(name);
    return normalizeScopeChain(scope).find((candidate) => declared?.has(candidate)) ?? null;
  };
  const resolveAliasPaths = (paths, scope = null) => {
    const scopeChain = normalizeScopeChain(scope);
    const pending = paths.map((path) => ({ path, expanded: new Set() }));
    const resolved = [];
    while (pending.length > 0) {
      const candidate = pending.pop();
      let aliasKey = null;
      let aliasLength = 0;
      for (let length = candidate.path.length; length > 0; length -= 1) {
        const key = candidate.path.slice(0, length).join('.');
        const bindingScope = visibleBindingScope(candidate.path[0], scopeChain);
        const scoped = bindingScope && scopedAliases.get(key)?.get(bindingScope);
        const globalAllowed = aliases.has(key) && (
          !bindingScope
          || (candidate.path[0] === 'run' && authenticatedRunScopes.has(bindingScope))
        );
        if (scoped || globalAllowed) {
          aliasKey = key;
          aliasLength = length;
          break;
        }
      }
      const bindingScope = visibleBindingScope(candidate.path[0], scopeChain);
      const replacements = aliasKey
        ? scopedAliases.get(aliasKey)?.get(bindingScope)
          ?? (bindingScope && !(
            candidate.path[0] === 'run' && authenticatedRunScopes.has(bindingScope)
          )
            ? null
            : aliases.get(aliasKey))
        : null;
      if (!replacements || candidate.expanded.has(aliasKey)) {
        resolved.push(candidate.path);
        continue;
      }
      const expanded = new Set(candidate.expanded).add(aliasKey);
      for (const replacement of replacements) {
        pending.push({ path: [...replacement, ...candidate.path.slice(aliasLength)], expanded });
      }
    }
    return resolved;
  };
  const recordAlias = (name, paths, targetNode = null) => {
    const targetScope = targetNode
      ? visibleBindingScope(name.split('.')[0], lexicalScopeChain(targetNode)) ?? lexicalScopeKey(targetNode)
      : 'source';
    const byScope = scopedAliases.get(name) ?? new Map();
    const existing = byScope.get(targetScope) ?? [];
    const existingKeys = new Set(existing.map((path) => path.join('.')));
    const additions = resolveAliasPaths(paths, targetNode ? lexicalScopeChain(targetNode) : ['source']).filter((path) => (
      path.join('.') !== name && !existingKeys.has(path.join('.'))
    ));
    if (additions.length === 0) return false;
    byScope.set(targetScope, [...existing, ...additions]);
    scopedAliases.set(name, byScope);
    return true;
  };
  const recordBindingAliases = (name, paths) => {
    if (paths.length === 0) return false;
    const target = unwrapExpression(name);
    if (ts.isIdentifier(target)) return recordAlias(target.text, paths, target);

    if (
      ts.isBinaryExpression(target)
      && target.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      return recordBindingAliases(target.left, paths);
    }

    let changed = false;
    if (ts.isObjectBindingPattern(target)) {
      for (const element of target.elements) {
        if (element.dotDotDotToken) {
          // Object rest is a shallow copy, so governed descendant values retain
          // their identity through the new binding.
          changed = recordBindingAliases(element.name, paths) || changed;
          continue;
        }
        const property = element.propertyName
          ? propertyNameText(element.propertyName)
          : ts.isIdentifier(element.name)
            ? element.name.text
            : null;
        if (property !== null) {
          changed = recordBindingAliases(
            element.name,
            paths.map((path) => [...path, property]),
          ) || changed;
        }
      }
      return changed;
    }

    if (ts.isObjectLiteralExpression(target)) {
      for (const property of target.properties) {
        if (ts.isSpreadAssignment(property)) {
          changed = recordBindingAliases(property.expression, paths) || changed;
          continue;
        }
        if (ts.isShorthandPropertyAssignment(property)) {
          changed = recordBindingAliases(
            property.name,
            paths.map((path) => [...path, property.name.text]),
          ) || changed;
          continue;
        }
        if (ts.isPropertyAssignment(property)) {
          changed = recordBindingAliases(
            property.initializer,
            paths.map((path) => [...path, propertyNameText(property.name)]),
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
        changed = recordBindingAliases(
          elementTarget,
          paths.map((path) => [...path, String(index)]),
        ) || changed;
      }
    }
    return changed;
  };
  const recordAssignmentAliases = (name, initializer) => {
    const expression = unwrapExpression(initializer);
    const target = unwrapExpression(name);
    const targetPath = staticPropertyPath(target);
    if (targetPath && targetPath.length > 1) {
      return recordAlias(
        targetPath.join('.'),
        resolveAliasPaths(possiblePropertyPaths(expression), lexicalScopeChain(expression)),
        target,
      );
    }
    if (ts.isIdentifier(target) && ts.isObjectLiteralExpression(expression)) {
      let changed = false;
      for (const property of expression.properties) {
        if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;
        const propertyName = propertyNameText(property.name);
        const value = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer;
        changed = recordAlias(
          `${target.text}.${propertyName}`,
          resolveAliasPaths(possiblePropertyPaths(value), lexicalScopeChain(value)),
          target,
        ) || changed;
      }
      return changed;
    }
    if (
      (ts.isArrayBindingPattern(target) || ts.isArrayLiteralExpression(target))
      && ts.isArrayLiteralExpression(expression)
    ) {
      let changed = false;
      for (const [index, element] of target.elements.entries()) {
        if (ts.isOmittedExpression(element)) continue;
        const source = expression.elements[index];
        const sourcePaths = source && !ts.isOmittedExpression(source)
          ? resolveAliasPaths(
            possiblePropertyPaths(ts.isSpreadElement(source) ? source.expression : source),
            lexicalScopeChain(source),
          )
          : [];
        const elementTarget = ts.isBindingElement(element)
          ? element.name
          : ts.isSpreadElement(element)
            ? element.expression
            : element;
        changed = recordBindingAliases(elementTarget, sourcePaths) || changed;
      }
      return changed;
    }
    return recordBindingAliases(
      target,
      resolveAliasPaths(possiblePropertyPaths(expression), lexicalScopeChain(expression)),
    );
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
  const governedPaths = (node) => resolveAliasPaths(
    possiblePropertyPaths(node),
    lexicalScopeChain(node),
  );
  const unresolvedComputedOwnerPaths = (node) => {
    const paths = [];
    const visit = (current) => {
      const expression = unwrapExpression(current);
      if (
        ts.isElementAccessExpression(expression)
        && expression.argumentExpression
        && staticStringValue(expression.argumentExpression) === null
      ) paths.push(...governedPaths(expression.expression));
      ts.forEachChild(expression, visit);
    };
    visit(node);
    return paths;
  };
  const governedEscapePaths = (node) => {
    const paths = [...governedPaths(node)];
    const containers = [];
    walk(node, (current) => {
      const path = staticPropertyPath(current)?.join('.');
      if (path) containers.push({ path, scope: lexicalScopeChain(current) });
    });
    for (const container of containers) {
      for (const [alias, replacementsByScope] of scopedAliases) {
        if (!alias.startsWith(`${container.path}.`)) continue;
        const bindingScope = visibleBindingScope(alias.split('.')[0], container.scope);
        const replacements = replacementsByScope.get(bindingScope);
        if (replacements) paths.push(...resolveAliasPaths(replacements, container.scope));
      }
    }
    return [...new Map(paths.map((path) => [path.join('.'), path])).values()];
  };
  const recordGovernedEscape = (node) => {
    for (const path of governedEscapePaths(node)) {
      for (const [label, governedPath] of GOVERNED_V2_DEPENDENCY_PATHS) {
        if (
          path.length <= governedPath.length
          && path.every((part, index) => governedPath[index] === part)
        ) mutated.add(`${label} must not escape through an unapproved helper parameter`);
      }
    }
  };
  walk(sourceFile, (node) => {
    if (
      ts.isReturnStatement(node)
      && node.expression
      && !hasFunctionDeclarationAncestor(node, 'artifactAvailable')
      && !hasFunctionDeclarationAncestor(node, 'resolveArtifact')
    ) recordGovernedEscape(node.expression);
    if (
      ts.isArrowFunction(node)
      && !ts.isBlock(node.body)
    ) recordGovernedEscape(node.body);
    if (ts.isYieldExpression(node) && node.expression) recordGovernedEscape(node.expression);
    if (ts.isThrowStatement(node) && node.expression) recordGovernedEscape(node.expression);
    if (ts.isPropertyDeclaration(node) && node.initializer) recordGovernedEscape(node.initializer);
    if (ts.isNewExpression(node)) {
      for (const argument of node.arguments ?? []) recordGovernedEscape(argument);
    }
    if (ts.isTaggedTemplateExpression(node) && ts.isTemplateExpression(node.template)) {
      for (const span of node.template.templateSpans) recordGovernedEscape(span.expression);
    }
  });
  walk(sourceFile, (node) => {
    if (
      !ts.isObjectLiteralExpression(node)
      && !ts.isArrayLiteralExpression(node)
      && !ts.isNewExpression(node)
    ) return;
    if (
      hasFunctionDeclarationAncestor(node, 'artifactAvailable')
      || hasFunctionDeclarationAncestor(node, 'resolveArtifact')
    ) return;
    for (const path of resolveAliasPaths(containedPropertyPaths(node), lexicalScopeChain(node))) {
      for (const [label, governedPath] of GOVERNED_V2_DEPENDENCY_PATHS) {
        if (
          path.length === governedPath.length
          && governedPath.every((part, index) => path[index] === part)
        ) mutated.add(`${label} must not escape through an unapproved helper parameter`);
      }
    }
  });
  const recordPath = (path, affectsDescendants = false) => {
    if (!path) return;
    for (const [label, governedPath] of GOVERNED_V2_DEPENDENCY_PATHS) {
      const mutatesGovernedPath = governedPath.every((part, index) => path[index] === part);
      const mutatesGovernedDescendant = affectsDescendants
        && path.every((part, index) => governedPath[index] === part);
      if (mutatesGovernedPath || mutatesGovernedDescendant) mutated.add(label);
    }
  };
  const nearestAncestor = (node, predicate) => {
    for (let current = node.parent; current && current !== sourceFile; current = current.parent) {
      if (predicate(current)) return current;
    }
    return null;
  };
  const exactForOf = (node, expected) => {
    const loop = nearestAncestor(node, ts.isForOfStatement);
    return loop ? compactNode(loop, sourceFile) === expected : false;
  };
  const exactIf = (node, expected) => {
    const branch = nearestAncestor(node, ts.isIfStatement);
    return branch ? compactNode(branch, sourceFile) === expected : false;
  };
  const exactExecute = (node, expected) => (
    compactNode(enclosingExecuteProperty(node), sourceFile) === compactSyntax(expected)
  );
  const trustedArtifactWriteSpecs = [
    {
      text: 'artifacts.projects.set(project.id, project)',
      valid: (node) => executeBelongsToCall(node, 'tool', 'searchProjects')
        && exactForOf(node, 'for(constprojectofresult.projects)artifacts.projects.set(project.id,project);')
        && exactExecute(node, `execute: (input, { abortSignal }) => {
          const outcomeOrdinal = reserveToolOutcome(artifacts);
          return gate.run(async () => {
            metrics.tool();
            const result = await run.searchProjects(input, { abortSignal });
            artifacts.projectLookupCompleted = true;
            for (const project of result.projects) artifacts.projects.set(project.id, project);
            rememberToolOutcome(artifacts, 'searchProjects', outcomeOrdinal, result.status, result.limitations);
            return result;
          });
        }`),
    },
    {
      text: 'artifacts.projects.set(result.project.id, result.project)',
      valid: (node) => executeBelongsToCall(node, 'tool', 'getProject')
        && exactIf(node, 'if(result.project){artifacts.projects.set(result.project.id,result.project);artifacts.directProjectReads.add(result.project.id);}')
        && exactExecute(node, `execute: (input, { abortSignal }) => {
          const outcomeOrdinal = reserveToolOutcome(artifacts);
          return gate.run(async () => {
            metrics.tool();
            const result = await run.getProject(input, { abortSignal });
            artifacts.projectLookupCompleted = true;
            if (result.project) {
              artifacts.projects.set(result.project.id, result.project);
              artifacts.directProjectReads.add(result.project.id);
            }
            rememberToolOutcome(artifacts, 'getProject', outcomeOrdinal, result.status, result.limitations);
            return result;
          });
        }`),
    },
    {
      text: 'artifacts.resumeTracks.set(track.id, track)',
      valid: (node) => executeBelongsToCall(node, 'tool', 'readResume')
        && exactForOf(node, 'for(consttrackofresult.tracks)artifacts.resumeTracks.set(track.id,track);')
        && exactExecute(node, `execute: (input, { abortSignal }) => gate.run(async () => {
          metrics.tool();
          const result = await run.readResume(input, { abortSignal });
          for (const track of result.tracks) artifacts.resumeTracks.set(track.id, track);
          rememberLimitations(artifacts, result.limitations);
          return result;
        })`),
    },
    {
      text: 'artifacts.sources.set(source.id, source)',
      valid: (node) => executeBelongsToCall(node, 'tool', 'searchPublicSources')
        && exactForOf(node, 'for(constsourceofresult.sources)artifacts.sources.set(source.id,source);')
        && exactExecute(node, `execute: (input, { abortSignal }) => {
          const outcomeOrdinal = reserveToolOutcome(artifacts);
          return gate.run(async () => {
            metrics.tool();
            const result = await run.searchPublicSources(input, { abortSignal });
            for (const source of result.sources) artifacts.sources.set(source.id, source);
            rememberToolOutcome(artifacts, 'searchPublicSources', outcomeOrdinal, result.status, result.limitations);
            return result;
          });
        }`),
    },
    {
      text: 'artifacts.contact = result.contact',
      valid: (node) => executeBelongsToCall(node, 'tool', 'getContact')
        && exactExecute(node, `execute: (input, { abortSignal }) => gate.run(async () => {
          metrics.tool();
          const result = await run.getContact(input, { abortSignal });
          artifacts.contact = result.contact;
          rememberLimitations(artifacts, result.limitations);
          return result;
        })`),
    },
  ];
  const trustedArtifactWriteNodes = new Map(
    trustedArtifactWriteSpecs.map((spec) => [spec.text, []]),
  );
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node) && !ts.isBinaryExpression(node)) return;
    const matches = trustedArtifactWriteNodes.get(node.getText(sourceFile));
    if (matches) matches.push(node);
  });
  const trustedArtifactWritesValid = trustedArtifactWriteSpecs.every((spec) => {
    const nodes = trustedArtifactWriteNodes.get(spec.text);
    return nodes.length === 1 && spec.valid(nodes[0]);
  });
  const authorizedArtifactWrites = new Set(
    trustedArtifactWritesValid ? [...trustedArtifactWriteNodes.values()].flat() : [],
  );
  const isAuthorizedArtifactContactWrite = (node, path) => (
    path.join('.') === 'artifacts.contact' && authorizedArtifactWrites.has(node)
  );
  const isAuthorizedArtifactCollectionWrite = (node, path, method) => (
    method === 'set'
    && [
      'artifacts.projects',
      'artifacts.resumeTracks',
      'artifacts.sources',
    ].includes(path.join('.'))
    && authorizedArtifactWrites.has(node)
  );

  walk(sourceFile, (node) => {
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      recordGovernedEscape(node.right);
      for (const path of unresolvedComputedOwnerPaths(node.left)) recordPath(path, true);
      const directPaths = [
        ...new Map(
          [...possiblePropertyPaths(node.left), ...governedPaths(node.left)]
            .map((path) => [path.join('.'), path]),
        ).values(),
      ];
      const concretePropertyTarget = (staticPropertyPath(node.left)?.length ?? 0) > 1;
      if (directPaths.length === 0) {
        for (const target of assignmentTargetExpressions(node.left)) {
          for (const path of governedPaths(target)) recordPath(path);
        }
      }
      if (concretePropertyTarget) {
        for (const path of directPaths) {
          if (!isAuthorizedArtifactContactWrite(node, path)) recordPath(path);
        }
      }
      if (aliasAssignments.has(node)) return;
      if (!concretePropertyTarget) {
        for (const path of directPaths) {
          if (!isAuthorizedArtifactContactWrite(node, path)) recordPath(path);
        }
      }
      return;
    }
    if (ts.isDeleteExpression(node)) {
      for (const path of unresolvedComputedOwnerPaths(node.expression)) recordPath(path, true);
      for (const path of governedPaths(node.expression)) recordPath(path);
      return;
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
      && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)
    ) {
      for (const path of unresolvedComputedOwnerPaths(node.operand)) recordPath(path, true);
      for (const path of governedPaths(node.operand)) recordPath(path);
      return;
    }
    if (
      (ts.isForInStatement(node) || ts.isForOfStatement(node))
      && !ts.isVariableDeclarationList(node.initializer)
    ) {
      for (const target of assignmentTargetExpressions(node.initializer)) {
        for (const path of unresolvedComputedOwnerPaths(target)) recordPath(path, true);
        for (const path of governedPaths(target)) recordPath(path);
      }
      return;
    }
    if (!ts.isCallExpression(node)) return;
    const callee = unwrapExpression(node.expression);
    if (!ts.isPropertyAccessExpression(callee) && !ts.isElementAccessExpression(callee)) return;
    const owner = callee.expression;
    const method = ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : callee.argumentExpression && staticStringValue(callee.argumentExpression);
    const ownerName = ts.isIdentifier(owner) ? owner.text : null;
    if (method === null) {
      for (const path of governedPaths(owner)) recordPath(path);
      return;
    }
    if (['set', 'delete', 'clear'].includes(method)) {
      for (const path of governedPaths(owner)) {
        if (!isAuthorizedArtifactCollectionWrite(node, path, method)) recordPath(path);
      }
    }
    if ((ownerName === 'Object' || ownerName === 'Reflect') && method === 'defineProperty') {
      const objectPaths = node.arguments[0] ? governedPaths(node.arguments[0]) : [];
      const property = node.arguments[1] && unwrapExpression(node.arguments[1]);
      if (objectPaths.length > 0 && property && (ts.isStringLiteral(property) || ts.isNumericLiteral(property))) {
        for (const objectPath of objectPaths) recordPath([...objectPath, property.text]);
      } else {
        for (const objectPath of objectPaths) recordPath(objectPath, true);
      }
      return;
    }
    if (ownerName === 'Reflect' && method === 'set') {
      const objectPaths = node.arguments[0] ? governedPaths(node.arguments[0]) : [];
      const property = node.arguments[1] && unwrapExpression(node.arguments[1]);
      if (objectPaths.length > 0 && property && (ts.isStringLiteral(property) || ts.isNumericLiteral(property))) {
        for (const objectPath of objectPaths) recordPath([...objectPath, property.text]);
      } else {
        for (const objectPath of objectPaths) recordPath(objectPath, true);
      }
      return;
    }
    if (ownerName === 'Object' && method === 'defineProperties') {
      const objectPaths = node.arguments[0] ? governedPaths(node.arguments[0]) : [];
      const descriptors = node.arguments[1] && unwrapExpression(node.arguments[1]);
      if (objectPaths.length === 0 || !descriptors || !ts.isObjectLiteralExpression(descriptors)) {
        for (const objectPath of objectPaths) recordPath(objectPath, true);
        return;
      }
      for (const property of descriptors.properties) {
        if (ts.isPropertyAssignment(property) || ts.isMethodDeclaration(property)) {
          for (const objectPath of objectPaths) recordPath([...objectPath, propertyNameText(property.name)]);
        } else {
          for (const objectPath of objectPaths) recordPath(objectPath, true);
        }
      }
      return;
    }
    if (
      (ownerName === 'Object' || ownerName === 'Reflect')
      && method === 'setPrototypeOf'
    ) {
      for (const path of node.arguments[0] ? governedPaths(node.arguments[0]) : []) recordPath(path, true);
      return;
    }
    if (ownerName !== 'Object' || method !== 'assign') return;
    const objectPaths = node.arguments[0] ? governedPaths(node.arguments[0]) : [];
    if (objectPaths.length === 0) return;
    let uncertainSource = false;
    for (const source of node.arguments.slice(1)) {
      const unwrapped = unwrapExpression(source);
      if (!ts.isObjectLiteralExpression(unwrapped)) {
        uncertainSource = true;
        continue;
      }
      for (const property of unwrapped.properties) {
        if (
          (ts.isPropertyAssignment(property) || ts.isMethodDeclaration(property))
          && !ts.isComputedPropertyName(property.name)
        ) {
          for (const objectPath of objectPaths) recordPath([...objectPath, propertyNameText(property.name)]);
        } else {
          uncertainSource = true;
        }
      }
    }
    if (uncertainSource) {
      for (const objectPath of objectPaths) recordPath(objectPath, true);
    }
  });

  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return;
    if (
      compactNode(node, sourceFile)
      === 'createRuntimePublicTools(publicRun,artifacts,metrics,publicToolGate)'
    ) return;
    const trustedRootConsumerArguments = new Map([
      ['resolveV2FinalAnswer', new Set([1, 2])],
      ['validateFinalAnswer', new Set([1, 2])],
      ['rememberBriefProjectReferences', new Set([0])],
      ['reserveToolOutcome', new Set([0])],
      ['rememberToolOutcome', new Set([0])],
      ['rememberLimitations', new Set([0])],
      ['artifactAvailable', new Set([1])],
      ['resolveArtifact', new Set([1])],
      ['limitationOutcomeErrors', new Set([1, 2])],
      ['stableProjectReadErrors', new Set([1, 2])],
      ['requestedArtifactErrors', new Set([1])],
      ['effectiveLimitations', new Set([0])],
      ['requiredOutcomeLimitations', new Set([0])],
      ['allowedFollowUps', new Set([1, 2])],
      ['emptyOutcomeHasRetainedArtifacts', new Set([0])],
      ['briefProjectIdsRequiredByLatestTurn', new Set([1])],
      ['briefProjectIdsMentioned', new Set([1])],
      ['evidenceQuoteErrors', new Set([1])],
      ['compositionCoverageErrors', new Set([1])],
      ['groundedProjectFollowUps', new Set([1])],
    ]);
    const calleeName = ts.isIdentifier(node.expression) ? node.expression.text : null;
    const permittedArguments = calleeName && trustedRootConsumerArguments.get(calleeName);
    let authenticatedConsumer = false;
    if (calleeName && permittedArguments) {
      const declarations = [];
      let bindingWritten = false;
      walk(sourceFile, (candidate) => {
        if (declaresValueName(candidate, calleeName)) declarations.push(candidate);
        if (writesValueName(candidate, calleeName)) bindingWritten = true;
      });
      authenticatedConsumer = declarations.length === 1
        && ts.isFunctionDeclaration(declarations[0])
        && declarations[0].parent === sourceFile
        && !bindingWritten;
    }
    for (const [argumentIndex, argument] of node.arguments.entries()) {
      for (const path of governedEscapePaths(argument)) {
        for (const [label, governedPath] of GOVERNED_V2_DEPENDENCY_PATHS) {
          if (
            path.length <= governedPath.length
            && path.every((part, index) => governedPath[index] === part)
          ) {
            if (
              authenticatedConsumer
              && permittedArguments.has(argumentIndex)
              && path.length < governedPath.length
            ) continue;
            mutated.add(`${label} must not escape through an unapproved helper parameter`);
          }
        }
      }
    }
  });

  return [...mutated].map((label) => (
    label.includes(' must not escape through an unapproved helper parameter')
      ? `src/lib/dm/runtime.ts: governed v2 dependency ${label}`
      : `src/lib/dm/runtime.ts: governed v2 dependency ${label} must not be replaced or redefined`
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

const TRUSTED_ARTIFACT_REFERENCE_SCHEMA = compactSyntax(`
  const ArtifactReferenceSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('project'), id: z.string().trim().min(1).max(200) }),
    z.strictObject({ kind: z.literal('resume'), id: z.string().trim().min(1).max(200) }),
    z.strictObject({ kind: z.literal('contact'), id: z.literal('contact') }),
    z.strictObject({ kind: z.literal('evidence'), id: z.string().trim().min(1).max(200) }),
    z.strictObject({ kind: z.literal('links'), id: z.string().trim().min(1).max(200) }),
  ]);
`);

function governedSchemaDeclarationFailures(sourceFile) {
  const failures = [];
  const artifactDeclarations = [];
  const limitDeclarations = [];
  let artifactWritten = false;
  let limitWritten = false;
  let limitReferences = 0;
  walk(sourceFile, (node) => {
    if (declaresValueName(node, 'ArtifactReferenceSchema')) artifactDeclarations.push(node);
    if (declaresValueName(node, 'MAX_FINALIZATION_ARTIFACTS')) limitDeclarations.push(node);
    if (writesValueName(node, 'ArtifactReferenceSchema')) artifactWritten = true;
    if (writesValueName(node, 'MAX_FINALIZATION_ARTIFACTS')) limitWritten = true;
    if (
      ts.isIdentifier(node)
      && node.text === 'MAX_FINALIZATION_ARTIFACTS'
      && !(
        ts.isVariableDeclaration(node.parent)
        && node.parent.name === node
      )
    ) limitReferences += 1;
  });
  const artifactDeclaration = artifactDeclarations.find((node) => (
    ts.isVariableDeclaration(node)
    && ts.isVariableDeclarationList(node.parent)
    && ts.isVariableStatement(node.parent.parent)
    && node.parent.parent.parent === sourceFile
    && (node.parent.flags & ts.NodeFlags.Const) !== 0
  ));
  if (
    artifactDeclarations.length !== 1
    || !artifactDeclaration
    || compactNode(artifactDeclaration.parent.parent, sourceFile) !== TRUSTED_ARTIFACT_REFERENCE_SCHEMA
    || artifactWritten
  ) {
    failures.push('src/lib/dm/runtime.ts: ArtifactReferenceSchema must retain its exact immutable trusted declaration and transitive artifact arms');
  }
  const limitDeclaration = limitDeclarations.find((node) => (
    ts.isVariableDeclaration(node)
    && ts.isVariableDeclarationList(node.parent)
    && ts.isVariableStatement(node.parent.parent)
    && node.parent.parent.parent === sourceFile
    && (node.parent.flags & ts.NodeFlags.Const) !== 0
    && ts.isNumericLiteral(node.initializer)
    && node.initializer.text === '8'
  ));
  if (limitDeclarations.length !== 1 || !limitDeclaration || limitWritten || limitReferences !== 2) {
    failures.push('src/lib/dm/runtime.ts: MAX_FINALIZATION_ARTIFACTS must remain one immutable top-level constant set to 8 and bound to both finalizer schemas');
  }
  return failures;
}

function governedSchemaMutationFailures(sourceFile) {
  const governed = new Set(['V2FinalAnswerInputSchema', 'ArtifactReferenceSchema']);
  const aliases = new Map();
  const resolveAliasPaths = (paths) => {
    const pending = paths.map((path) => ({ path, expanded: new Set() }));
    const resolved = [];
    while (pending.length > 0) {
      const candidate = pending.pop();
      let aliasKey = null;
      let aliasLength = 0;
      for (let length = candidate.path.length; length > 0; length -= 1) {
        const key = candidate.path.slice(0, length).join('.');
        if (aliases.has(key)) {
          aliasKey = key;
          aliasLength = length;
          break;
        }
      }
      const replacements = aliasKey ? aliases.get(aliasKey) : null;
      if (!replacements || candidate.expanded.has(aliasKey)) {
        resolved.push(candidate.path);
        continue;
      }
      const expanded = new Set(candidate.expanded).add(aliasKey);
      for (const replacement of replacements) {
        pending.push({ path: [...replacement, ...candidate.path.slice(aliasLength)], expanded });
      }
    }
    return resolved;
  };
  const recordAlias = (name, paths) => {
    const existing = aliases.get(name) ?? [];
    const existingKeys = new Set(existing.map((path) => path.join('.')));
    const additions = resolveAliasPaths(paths).filter((path) => (
      path.join('.') !== name && !existingKeys.has(path.join('.'))
    ));
    if (additions.length === 0) return false;
    aliases.set(name, [...existing, ...additions]);
    return true;
  };
  const recordBindingAliases = (name, paths) => {
    if (paths.length === 0) return false;
    const target = unwrapExpression(name);
    if (ts.isIdentifier(target)) return recordAlias(target.text, paths);
    if (ts.isBinaryExpression(target) && target.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      return recordBindingAliases(target.left, paths);
    }

    let changed = false;
    if (ts.isObjectBindingPattern(target)) {
      for (const element of target.elements) {
        if (element.dotDotDotToken) {
          changed = recordBindingAliases(element.name, paths) || changed;
          continue;
        }
        const property = element.propertyName
          ? propertyNameText(element.propertyName)
          : ts.isIdentifier(element.name)
            ? element.name.text
            : null;
        if (property !== null) {
          changed = recordBindingAliases(element.name, paths.map((path) => [...path, property])) || changed;
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
        changed = recordBindingAliases(elementTarget, paths.map((path) => [...path, String(index)])) || changed;
      }
    }
    return changed;
  };
  const recordAssignmentAliases = (name, initializer) => {
    const expression = unwrapExpression(initializer);
    const target = unwrapExpression(name);
    const targetPath = staticPropertyPath(target);
    if (targetPath && targetPath.length > 1) {
      return recordAlias(
        targetPath.join('.'),
        resolveAliasPaths(possiblePropertyPaths(expression)),
      );
    }
    if (ts.isIdentifier(target) && ts.isObjectLiteralExpression(expression)) {
      let changed = false;
      for (const property of expression.properties) {
        if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;
        const propertyName = propertyNameText(property.name);
        const value = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer;
        changed = recordAlias(
          `${target.text}.${propertyName}`,
          resolveAliasPaths(possiblePropertyPaths(value)),
        ) || changed;
      }
      return changed;
    }
    if (
      (ts.isArrayBindingPattern(target) || ts.isArrayLiteralExpression(target))
      && ts.isArrayLiteralExpression(expression)
    ) {
      let changed = false;
      for (const [index, element] of target.elements.entries()) {
        if (ts.isOmittedExpression(element)) continue;
        const source = expression.elements[index];
        const sourcePaths = source && !ts.isOmittedExpression(source)
          ? resolveAliasPaths(possiblePropertyPaths(ts.isSpreadElement(source) ? source.expression : source))
          : [];
        const elementTarget = ts.isBindingElement(element)
          ? element.name
          : ts.isSpreadElement(element)
            ? element.expression
            : element;
        changed = recordBindingAliases(elementTarget, sourcePaths) || changed;
      }
      return changed;
    }
    return recordBindingAliases(target, resolveAliasPaths(possiblePropertyPaths(expression)));
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
      if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return;
      const changed = recordAssignmentAliases(node.left, node.right);
      if (changed) aliasAssignments.add(node);
      aliasesChanged = changed || aliasesChanged;
    });
  }
  const governedPaths = (node) => resolveAliasPaths(possiblePropertyPaths(node));
  const mutatesGovernedSchema = (path) => path && governed.has(path[0]);
  const unresolvedComputedTargetIsGoverned = (node) => {
    let found = false;
    const visit = (current) => {
      const expression = unwrapExpression(current);
      if (
        ts.isElementAccessExpression(expression)
        && expression.argumentExpression
        && staticStringValue(expression.argumentExpression) === null
        && governedPaths(expression.expression).some(mutatesGovernedSchema)
      ) found = true;
      ts.forEachChild(expression, visit);
    };
    visit(node);
    return found;
  };
  let mutated = false;
  walk(sourceFile, (node) => {
    if (ts.isReturnStatement(node) && node.expression && governedPaths(node.expression).some(mutatesGovernedSchema)) {
      mutated = true;
    }
    if (
      ts.isArrowFunction(node)
      && !ts.isBlock(node.body)
      && governedPaths(node.body).some(mutatesGovernedSchema)
    ) mutated = true;
    if (ts.isYieldExpression(node) && node.expression && governedPaths(node.expression).some(mutatesGovernedSchema)) {
      mutated = true;
    }
    if (ts.isThrowStatement(node) && node.expression && governedPaths(node.expression).some(mutatesGovernedSchema)) {
      mutated = true;
    }
    if (ts.isPropertyDeclaration(node) && node.initializer && governedPaths(node.initializer).some(mutatesGovernedSchema)) {
      mutated = true;
    }
    if (ts.isTaggedTemplateExpression(node) && ts.isTemplateExpression(node.template)) {
      if (node.template.templateSpans.some((span) => (
        governedPaths(span.expression).some(mutatesGovernedSchema)
      ))) mutated = true;
    }
  });
  walk(sourceFile, (node) => {
    if (
      !ts.isObjectLiteralExpression(node)
      && !ts.isArrayLiteralExpression(node)
      && !ts.isNewExpression(node)
    ) return;
    let approvedToolOptions = false;
    let governedDeclarationContainer = false;
    for (let current = node.parent; current && current !== sourceFile; current = current.parent) {
      if (
        ts.isVariableDeclaration(current)
        && ts.isIdentifier(current.name)
        && (governed.has(current.name.text) || current.name.text === 'agentTools')
      ) governedDeclarationContainer = true;
      if (ts.isCallExpression(current) && callIsNamed(current, 'tool') && current.arguments[0]) {
        approvedToolOptions = current.arguments[0].pos <= node.pos && current.arguments[0].end >= node.end;
        break;
      }
      if (ts.isStatement(current)) break;
    }
    if (
      !approvedToolOptions
      && !governedDeclarationContainer
      && resolveAliasPaths(containedPropertyPaths(node)).some(mutatesGovernedSchema)
    ) mutated = true;
  });
  walk(sourceFile, (node) => {
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      if (governedPaths(node.right).some(mutatesGovernedSchema)) mutated = true;
      if (unresolvedComputedTargetIsGoverned(node.left)) mutated = true;
      if (
        possiblePropertyPaths(node.left).some(mutatesGovernedSchema)
        || assignmentTargetExpressions(node.left).some((target) => (
          possiblePropertyPaths(target).some(mutatesGovernedSchema)
        ))
      ) mutated = true;
      if (
        governedPaths(node.left).length === 0
        && assignmentTargetExpressions(node.left).some((target) => (
          governedPaths(target).some(mutatesGovernedSchema)
        ))
      ) mutated = true;
      if (aliasAssignments.has(node)) return;
      if (governedPaths(node.left).some(mutatesGovernedSchema)) mutated = true;
      return;
    }
    if (ts.isDeleteExpression(node)) {
      if (
        unresolvedComputedTargetIsGoverned(node.expression)
        || governedPaths(node.expression).some(mutatesGovernedSchema)
      ) mutated = true;
      return;
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
      && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)
      && (
        unresolvedComputedTargetIsGoverned(node.operand)
        || governedPaths(node.operand).some(mutatesGovernedSchema)
      )
    ) mutated = true;
    if (
      (ts.isForInStatement(node) || ts.isForOfStatement(node))
      && !ts.isVariableDeclarationList(node.initializer)
      && assignmentTargetExpressions(node.initializer).some((target) => (
        unresolvedComputedTargetIsGoverned(target)
        || governedPaths(target).some(mutatesGovernedSchema)
      ))
    ) mutated = true;
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    const owner = node.expression.expression;
    if (!ts.isIdentifier(owner) || !['Object', 'Reflect'].includes(owner.text)) return;
    const method = node.expression.name.text;
    if (!['assign', 'defineProperty', 'defineProperties', 'setPrototypeOf', 'set'].includes(method)) return;
    const paths = node.arguments[0] ? governedPaths(node.arguments[0]) : [];
    if (paths.some(mutatesGovernedSchema)) mutated = true;
  });
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return;
    const approvedArtifactSchemaUse = (
      ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === 'z'
      && node.expression.name.text === 'array'
    );
    for (const argument of node.arguments) {
      const paths = governedPaths(argument);
      if (paths.some((path) => governed.has(path[0]) && !(approvedArtifactSchemaUse && path[0] === 'ArtifactReferenceSchema'))) {
        mutated = true;
      }
    }
  });
  return mutated
    ? ['src/lib/dm/runtime.ts: governed finalizer schema objects and their transitive artifact schemas must not be mutated']
    : [];
}

function schemaBoundaryFailures(sourceFile) {
  const failures = [
    ...zodBindingFailures(sourceFile),
    ...v2SchemaBindingFailures(sourceFile),
    ...governedSchemaDeclarationFailures(sourceFile),
    ...governedSchemaMutationFailures(sourceFile),
  ];
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
  const actualV2Names = v2Object?.properties.map((property) => (
    ts.isPropertyAssignment(property)
    && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
      ? propertyNameText(property.name)
      : null
  )) ?? [];
  if (
    actualV2Names.some((name) => name === null)
    || new Set(actualV2Names).size !== expectedV2Fields.size
    || actualV2Names.length !== expectedV2Fields.size
    || [...actualV2Names].sort().join(',') !== [...expectedV2Fields.keys()].sort().join(',')
  ) {
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

const EXPECTED_V2_PROSE_HELPER_BODIES = new Map([
  ['isV2TextChunk', "{returnchunk.type==='text-start'||chunk.type==='text-delta'||chunk.type==='text-end';}"],
  ['createBoundedV2Prose', "{constsourceOpen=newSet<string>();constforwardedOpen=newSet<string>();constpendingHighSurrogate=newMap<string,string>();lettext='';letfailed=false;constfail=():void=>{failed=true;};constforward=(chunk:V2TextChunk,write:(chunk:UIMessageChunk)=>void):boolean=>{if(chunk.type==='text-start'){if(sourceOpen.has(chunk.id))fail();elsesourceOpen.add(chunk.id);returnfalse;}if(!sourceOpen.has(chunk.id)){fail();returnfalse;}if(chunk.type==='text-end'){if(pendingHighSurrogate.has(chunk.id))fail();pendingHighSurrogate.delete(chunk.id);sourceOpen.delete(chunk.id);if(forwardedOpen.delete(chunk.id)){write({type:'text-end',id:chunk.id});}returnfalse;}if(failed||chunk.delta.length===0)returnfalse;constcombined=`${pendingHighSurrogate.get(chunk.id)??''}${chunk.delta}`;pendingHighSurrogate.delete(chunk.id);constbounded=takeBoundedCompleteCodePoints(combined,MAX_V2_PROSE_CODE_UNITS-text.length);if(bounded.pendingHighSurrogate)pendingHighSurrogate.set(chunk.id,bounded.pendingHighSurrogate);if(bounded.invalid||bounded.overflow)fail();if(!bounded.text)returnfalse;if(!forwardedOpen.has(chunk.id)){forwardedOpen.add(chunk.id);write({type:'text-start',id:chunk.id});}text+=bounded.text;write({type:'text-delta',id:chunk.id,delta:bounded.text});returntrue;};return{gettext(){returntext;},getfailed(){returnfailed;},forward,close(write){if(sourceOpen.size>0||pendingHighSurrogate.size>0)fail();for(constidofforwardedOpen)write({type:'text-end',id});sourceOpen.clear();forwardedOpen.clear();pendingHighSurrogate.clear();}};}"],
  ['takeBoundedCompleteCodePoints', "{letaccepted='';letpendingHighSurrogate='';letoverflow=false;letinvalid=false;for(letindex=0;index<input.length;){constfirst=input.charCodeAt(index);letpoint=input[index]asstring;letwidth=1;if(first>=0xD800&&first<=0xDBFF){if(index+1>=input.length){pendingHighSurrogate=point;break;}constsecond=input.charCodeAt(index+1);if(second<0xDC00||second>0xDFFF){invalid=true;break;}point+=input[index+1];width=2;}elseif(first>=0xDC00&&first<=0xDFFF){invalid=true;break;}if(accepted.length+width>remainingCodeUnits){overflow=true;break;}accepted+=point;index+=width;}return{text:accepted,pendingHighSurrogate,overflow,invalid};}"],
]);

const APPROVED_WRITER_CALL_COUNTS = new Map([
  ['write(forwardedChunk)', 1],
  ["write({type:'tool-input-start',toolCallId:chunk.toolCallId,toolName:'finalizeAnswer'})", 1],
  ['write(chunkasUIMessageChunk)', 1],
  ['write(chunk)', 5],
  ["write({type:'error',errorText:'DMtooktoolongtoanswer.Pleasetryagain.'})", 2],
  ["write({type:'finish'})", 6],
  ["write({type:'error',errorText:'DMcouldnotsafelyfinishthisanswer.Pleasetryagain.'})", 1],
  ["write({type:'data-dm-answer',data:finalizationResult})", 1],
  ["write({type:'error',errorText:safeErrorMessage(error)})", 1],
]);

const APPROVED_METRICS_CALL_COUNTS = new Map([
  ["setErrorCategory(abort.timedOut()?'timeout':'aborted')", 3],
  ["error('unknown')", 3],
  ['modelStarted()', 1],
  ['setErrorCategory(category)', 1],
  ['visibleOutput()', 3],
  ["finish(abort.timedOut()?'timeout':'aborted')", 2],
  ['setSource(sourceMode(evidence.map((item)=>item.source)),evidence.length,true)', 1],
  ['setUsage(inputTokens,outputTokens)', 2],
  ["setErrorCategory('finalization_validation')", 2],
  ["error('finalization_validation')", 1],
  ["setSource(sourceMode(evidence.map((item)=>item.source)),evidence.length,finalizationResult.status==='limited')", 1],
  ["finish('completed')", 1],
]);

const APPROVED_PUBLIC_TOOL_METRICS_CALL_COUNTS = new Map([
  ['tool()', 6],
]);

const APPROVED_FINALIZATION_RESULT_STATEMENT_COUNTS = new Map([
  ['if(finalizationResult)returnfinalizationResult;', 2],
  ['returnfinalizationResult;', 5],
  ["finalizationResult={status:'accepted',answer:resolveV2FinalAnswer(input,publicRun,artifacts),repairAttempted:false};", 1],
  ["finalizationResult={status:'accepted',answer:validation.answer,repairAttempted:finalizationAttempts>1};", 1],
  ['finalizationResult=limitedResult(true);', 1],
  ["if(toolCall.toolName!=='finalizeAnswer'||finalizationResult)returnnull;", 1],
  ['finalizationResult??=limitedResult(finalizationAttempts>0);', 1],
  ["terminalMarkdown=finalizationResult.status==='accepted'&&finalizationResult.answer.segments.length===1?finalizationResult.answer.segments[0]?.text:null", 3],
  ["if(finalizationResult.status==='limited'&&(finalizationAttempts>0||v2FinalizationValidationFailed)){metrics.setErrorCategory('finalization_validation');}", 1],
  ["metrics.setSource(sourceMode(evidence.map((item)=>item.source)),evidence.length,finalizationResult.status==='limited');", 1],
  ["writer.write({type:'data-dm-answer',data:finalizationResult});", 1],
]);

function enclosingStatementOrDeclaration(node) {
  let current = node;
  while (current && !ts.isStatement(current) && !ts.isVariableDeclaration(current)) current = current.parent;
  return current ?? null;
}

function finalizationResultMutationFailures(sourceFile) {
  const failure = 'src/lib/dm/runtime.ts: finalizationResult must remain immutable outside approved assignment and terminal read sites';
  const chatResponse = functionDeclaration(sourceFile, 'createDMChatResponse');
  const declarations = [];
  const references = new Map();
  walk(chatResponse ?? sourceFile, (node) => {
    if (ts.isVariableDeclaration(node) && bindingNameContains(node.name, 'finalizationResult')) {
      declarations.push(node);
    }
    if (!ts.isIdentifier(node) || node.text !== 'finalizationResult') return;
    if (ts.isVariableDeclaration(node.parent) && node.parent.name === node) return;
    const statement = enclosingStatementOrDeclaration(node);
    const key = compactNode(statement, sourceFile);
    references.set(key, (references.get(key) ?? 0) + 1);
  });
  const declaration = declarations[0];
  const validDeclaration = declarations.length === 1
    && ts.isIdentifier(declaration.name)
    && declaration.name.text === 'finalizationResult'
    && declaration.initializer?.kind === ts.SyntaxKind.NullKeyword
    && ts.isVariableDeclarationList(declaration.parent)
    && (declaration.parent.flags & ts.NodeFlags.Let) !== 0;
  if (!validDeclaration) return [failure];
  if (references.size !== APPROVED_FINALIZATION_RESULT_STATEMENT_COUNTS.size) return [failure];
  for (const [key, approvedCount] of APPROVED_FINALIZATION_RESULT_STATEMENT_COUNTS) {
    if (references.get(key) !== approvedCount) return [failure];
  }
  return [];
}

function directOwnedCall(node, owner) {
  if (!ts.isIdentifier(node) || node.text !== owner) return null;
  const access = node.parent;
  if (!ts.isPropertyAccessExpression(access) || access.expression !== node) return null;
  const call = access.parent;
  return ts.isCallExpression(call) && call.expression === access ? call : null;
}

function closedSinkReferences(container, owner, approvedCalls, declaration) {
  const counts = new Map();
  let unexpectedReference = false;
  walk(container, (node) => {
    if (!ts.isIdentifier(node) || node.text !== owner) return;
    if (node === declaration) return;
    const call = directOwnedCall(node, owner);
    if (!call) {
      const parentCall = node.parent;
      if (
        owner === 'metrics'
        && ts.isCallExpression(parentCall)
        && parentCall.arguments[2] === node
        && compactNode(parentCall, container.getSourceFile())
          === 'createRuntimePublicTools(publicRun,artifacts,metrics,publicToolGate)'
      ) return;
      unexpectedReference = true;
      return;
    }
    const key = `${call.expression.name.text}(${call.arguments.map((argument) => compactNode(argument, container.getSourceFile())).join(',')})`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  if (unexpectedReference || counts.size !== approvedCalls.size) return false;
  for (const [key, count] of approvedCalls) {
    if (counts.get(key) !== count) return false;
  }
  return true;
}

function publicToolMetricsBoundaryIsClosed(sourceFile) {
  const declarations = [];
  const callSites = [];
  const unexpectedReferences = [];
  let bindingWritten = false;
  walk(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'createRuntimePublicTools') {
      declarations.push(node);
    }
    if (writesValueName(node, 'createRuntimePublicTools')) bindingWritten = true;
    if (!ts.isIdentifier(node) || node.text !== 'createRuntimePublicTools') return;
    if (ts.isFunctionDeclaration(node.parent) && node.parent.name === node) return;
    if (ts.isCallExpression(node.parent) && node.parent.expression === node) callSites.push(node.parent);
    else unexpectedReferences.push(node);
  });

  if (declarations.length === 0 && callSites.length === 0) return true;
  const declaration = declarations[0];
  const metricsParameter = declaration?.parameters[2]?.name;
  let argumentsReference = false;
  if (declaration?.body) {
    walk(declaration.body, (node) => {
      if (ts.isIdentifier(node) && node.text === 'arguments') argumentsReference = true;
    });
  }
  return declarations.length === 1
    && callSites.length === 1
    && unexpectedReferences.length === 0
    && !bindingWritten
    && compactNode(callSites[0], sourceFile)
      === 'createRuntimePublicTools(publicRun,artifacts,metrics,publicToolGate)'
    && declaration.parameters.length === 4
    && Boolean(metricsParameter)
    && ts.isIdentifier(metricsParameter)
    && metricsParameter.text === 'metrics'
    && !argumentsReference
    && Boolean(declaration.body)
    && closedSinkReferences(
      declaration.body,
      'metrics',
      APPROVED_PUBLIC_TOOL_METRICS_CALL_COUNTS,
      metricsParameter,
    );
}

function streamFailureCompletionIsClosed(chatResponse, sourceFile) {
  const execute = (() => {
    let match = null;
    walk(chatResponse, (node) => {
      if (!match && ts.isMethodDeclaration(node) && propertyNameText(node.name) === 'execute') match = node;
    });
    return match;
  })();
  const hasLiveExitTopology = Boolean(
    execute?.body?.statements.some((statement) => ts.isTryStatement(statement))
    && compactNode(chatResponse, sourceFile).includes('streamFailed'),
  );
  if (!hasLiveExitTopology) return true;

  const branches = [];
  walk(chatResponse, (node) => {
    if (ts.isIfStatement(node) && ts.isIdentifier(unwrapExpression(node.expression)) && unwrapExpression(node.expression).text === 'streamFailed') {
      branches.push(node);
    }
  });
  return branches.length === 1
    && compactNode(branches[0], sourceFile)
      === "if(streamFailed){if(contract==='v2'){v2Prose.close((chunk)=>writer.write(chunk));writer.write({type:'finish'});}metrics.error('unknown');return;}";
}

function streamCompletionSinkFailures(sourceFile) {
  const failure = 'src/lib/dm/runtime.ts: UI stream writer and metrics sinks must remain closed over approved completion paths';
  const chatResponse = functionDeclaration(sourceFile, 'createDMChatResponse');
  const streamExecutes = [];
  walk(chatResponse ?? sourceFile, (node) => {
    if (!ts.isMethodDeclaration(node) || propertyNameText(node.name) !== 'execute') return;
    const options = node.parent;
    const call = options?.parent;
    if (
      ts.isObjectLiteralExpression(options)
      && ts.isCallExpression(call)
      && call.expression.getText(sourceFile) === 'createUIMessageStream'
      && call.arguments[0] === options
    ) streamExecutes.push(node);
  });
  const execute = streamExecutes[0];
  const writerBinding = execute?.parameters[0]?.name;
  const writerIdentifier = writerBinding
    && ts.isObjectBindingPattern(writerBinding)
    && writerBinding.elements.length === 1
    && !writerBinding.elements[0].propertyName
    && ts.isIdentifier(writerBinding.elements[0].name)
    && writerBinding.elements[0].name.text === 'writer'
    ? writerBinding.elements[0].name
    : null;
  const metricDeclarations = [];
  walk(chatResponse ?? sourceFile, (node) => {
    if (ts.isVariableDeclaration(node) && bindingNameContains(node.name, 'metrics')) metricDeclarations.push(node);
  });
  const metrics = metricDeclarations[0];
  const metricsStatement = metrics?.parent?.parent;
  const validMetricsDeclaration = metricDeclarations.length === 1
    && ts.isIdentifier(metrics.name)
    && metrics.name.text === 'metrics'
    && ts.isCallExpression(unwrapExpression(metrics.initializer))
    && unwrapExpression(metrics.initializer).expression.getText(sourceFile) === 'createDMMetricsRecorder'
    && ts.isVariableStatement(metricsStatement)
    && (metrics.parent.flags & ts.NodeFlags.Const) !== 0;
  if (
    streamExecutes.length !== 1
    || !execute.body
    || !writerIdentifier
    || !validMetricsDeclaration
    || !closedSinkReferences(execute, 'writer', APPROVED_WRITER_CALL_COUNTS, writerIdentifier)
    || !closedSinkReferences(chatResponse, 'metrics', APPROVED_METRICS_CALL_COUNTS, metrics.name)
    || !publicToolMetricsBoundaryIsClosed(sourceFile)
    || !streamFailureCompletionIsClosed(chatResponse, sourceFile)
  ) return [failure];
  return [];
}

function isNamedPropertyAccess(node, objectName, propertyName) {
  const expression = unwrapExpression(node);
  return ts.isPropertyAccessExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === objectName
    && expression.name.text === propertyName;
}

function isTextDeltaWrite(node) {
  if (!ts.isCallExpression(node) || node.arguments.length !== 1 || !ts.isObjectLiteralExpression(node.arguments[0])) return false;
  const type = objectProperty(node.arguments[0], 'type')?.initializer;
  return Boolean(type) && ts.isStringLiteral(type) && type.text === 'text-delta';
}

function isCanonicalBoundedTextDeltaWrite(node) {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'write') return false;
  if (node.arguments.length !== 1 || !ts.isObjectLiteralExpression(node.arguments[0])) return false;
  const properties = node.arguments[0].properties;
  if (properties.length !== 3 || properties.some((property) => !ts.isPropertyAssignment(property))) return false;
  const fields = new Map(properties.map((property) => [propertyNameText(property.name), property.initializer]));
  const type = fields.get('type');
  const id = fields.get('id');
  const delta = fields.get('delta');
  return fields.size === 3
    && Boolean(type)
    && Boolean(id)
    && Boolean(delta)
    && ts.isStringLiteral(type)
    && type.text === 'text-delta'
    && isNamedPropertyAccess(id, 'chunk', 'id')
    && isNamedPropertyAccess(delta, 'bounded', 'text');
}

function v2ProseEmissionFailures(sourceFile) {
  const failure = 'src/lib/dm/runtime.ts: v2 prose emission must remain Unicode-safe, bounded, and canonical';
  const limitDeclarations = [];
  const helperDeclarations = new Map(
    [...EXPECTED_V2_PROSE_HELPER_BODIES.keys()].map((name) => [name, []]),
  );
  let governedBindingWritten = false;

  walk(sourceFile, (node) => {
    if (
      ts.isVariableDeclaration(node)
      && bindingNameContains(node.name, 'MAX_V2_PROSE_CODE_UNITS')
    ) limitDeclarations.push(node);
    if (ts.isFunctionDeclaration(node) && node.name && helperDeclarations.has(node.name.text)) {
      helperDeclarations.get(node.name.text).push(node);
    }
    for (const name of ['MAX_V2_PROSE_CODE_UNITS', ...EXPECTED_V2_PROSE_HELPER_BODIES.keys()]) {
      if (writesValueName(node, name)) governedBindingWritten = true;
    }
  });

  const limit = limitDeclarations[0];
  const limitStatement = limit?.parent?.parent;
  const validLimit = limitDeclarations.length === 1
    && ts.isIdentifier(limit.name)
    && limit.name.text === 'MAX_V2_PROSE_CODE_UNITS'
    && limit.initializer?.getText(sourceFile) === '6_000'
    && ts.isVariableStatement(limitStatement)
    && limitStatement.parent === sourceFile
    && (limit.parent.flags & ts.NodeFlags.Const) !== 0;

  let validHelpers = true;
  for (const [name, expectedBody] of EXPECTED_V2_PROSE_HELPER_BODIES) {
    const declarations = helperDeclarations.get(name);
    const declaration = declarations[0];
    if (
      declarations.length !== 1
      || declaration.parent !== sourceFile
      || compactNode(declaration.body, sourceFile) !== expectedBody
    ) validHelpers = false;
  }
  if (!validLimit || !validHelpers || governedBindingWritten) return [failure];

  const proseHelper = helperDeclarations.get('createBoundedV2Prose')?.[0];
  const boundedDeclarations = [];
  const textDeclarations = [];
  const textWrites = [];
  const boundedWrites = [];
  const writerWrites = [];
  const textDeltaWrites = [];
  walk(proseHelper, (node) => {
    if (ts.isVariableDeclaration(node) && bindingNameContains(node.name, 'bounded')) boundedDeclarations.push(node);
    if (ts.isVariableDeclaration(node) && bindingNameContains(node.name, 'text')) textDeclarations.push(node);
    if (writesValueName(node, 'text')) textWrites.push(node);
    if (writesValueName(node, 'bounded')) boundedWrites.push(node);
    if (writesValueName(node, 'write')) writerWrites.push(node);
    if (isTextDeltaWrite(node)) textDeltaWrites.push(node);
  });
  const bounded = boundedDeclarations[0];
  const boundedCall = bounded?.initializer && unwrapExpression(bounded.initializer);
  const boundedCallIsTrusted = ts.isCallExpression(boundedCall)
    && ts.isIdentifier(boundedCall.expression)
    && boundedCall.expression.text === 'takeBoundedCompleteCodePoints'
    && boundedCall.arguments.length === 2
    && ts.isIdentifier(unwrapExpression(boundedCall.arguments[0]))
    && unwrapExpression(boundedCall.arguments[0]).text === 'combined'
    && compactNode(boundedCall.arguments[1], sourceFile) === 'MAX_V2_PROSE_CODE_UNITS-text.length';
  const accumulation = textWrites[0];
  const canonicalAccumulation = ts.isBinaryExpression(accumulation)
    && accumulation.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken
    && ts.isIdentifier(accumulation.left)
    && accumulation.left.text === 'text'
    && isNamedPropertyAccess(accumulation.right, 'bounded', 'text');
  const canonicalBinding = boundedDeclarations.length === 1
    && bounded
    && ts.isIdentifier(bounded.name)
    && bounded.name.text === 'bounded'
    && ts.isVariableDeclarationList(bounded.parent)
    && (bounded.parent.flags & ts.NodeFlags.Const) !== 0
    && boundedCallIsTrusted
    && textDeclarations.length === 1
    && ts.isIdentifier(textDeclarations[0].name)
    && textDeclarations[0].name.text === 'text'
    && compactNode(textDeclarations[0].initializer, sourceFile) === "''"
    && textWrites.length === 1
    && canonicalAccumulation
    && boundedWrites.length === 0
    && writerWrites.length === 0
    && textDeltaWrites.length === 1
    && isCanonicalBoundedTextDeltaWrite(textDeltaWrites[0]);
  const allTextDeltaWrites = [];
  walk(sourceFile, (node) => {
    if (isTextDeltaWrite(node)) allTextDeltaWrites.push(node);
  });

  return canonicalBinding
    && allTextDeltaWrites.length === 1
    && allTextDeltaWrites[0] === textDeltaWrites[0]
    ? []
    : [failure];
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
  } else {
    const terminalBlock = enclosingBlock(answerWrites[0]);
    const answerWriteIndex = terminalBlock?.statements.findIndex(
      (statement) => statement.pos <= answerWrites[0].pos && statement.end >= answerWrites[0].end,
    ) ?? -1;
    const completionIndex = terminalBlock?.statements.findIndex(
      (statement) => compactNode(statement, sourceFile) === "metrics.finish('completed');",
    ) ?? -1;
    const fallbackIndex = terminalBlock?.statements.findIndex(
      (statement) => compactNode(statement, sourceFile) === 'finalizationResult??=limitedResult(finalizationAttempts>0);',
    ) ?? -1;
    const expectedTerminalStatements = [
      'finalizationResult??=limitedResult(finalizationAttempts>0);',
      "if(contract==='v2'){v2Prose.close((chunk)=>writer.write(chunk));constterminalMarkdown=finalizationResult.status==='accepted'&&finalizationResult.answer.segments.length===1?finalizationResult.answer.segments[0]?.text:null;if(v2Prose.failed||terminalMarkdown!==v2Prose.text){constevidence=publicRun.evidenceLedger.snapshot();metrics.setSource(sourceMode(evidence.map((item)=>item.source)),evidence.length,true);metrics.setUsage(inputTokens,outputTokens);metrics.setErrorCategory('finalization_validation');writer.write({type:'error',errorText:'DMcouldnotsafelyfinishthisanswer.Pleasetryagain.'});writer.write({type:'finish'});metrics.error('finalization_validation');return;}}",
      "if(finalizationResult.status==='limited'&&(finalizationAttempts>0||v2FinalizationValidationFailed)){metrics.setErrorCategory('finalization_validation');}",
      'constevidence=publicRun.evidenceLedger.snapshot();',
      "metrics.setSource(sourceMode(evidence.map((item)=>item.source)),evidence.length,finalizationResult.status==='limited');",
      'metrics.setUsage(inputTokens,outputTokens);',
      "writer.write({type:'data-dm-answer',data:finalizationResult});",
      "if(contract==='v1')metrics.visibleOutput();",
      "writer.write({type:'finish'});",
      "metrics.finish('completed');",
    ];
    const actualTerminalStatements = terminalBlock
      && fallbackIndex >= 0
      && answerWriteIndex >= fallbackIndex
      && completionIndex > answerWriteIndex
      && completionIndex === terminalBlock.statements.length - 1
      ? terminalBlock.statements
        .slice(fallbackIndex, completionIndex + 1)
        .map((statement) => compactNode(statement, sourceFile))
      : [];
    if (actualTerminalStatements.join('\n') !== expectedTerminalStatements.join('\n')) {
      failures.push('src/lib/dm/runtime.ts: terminal v2 finalization must remain closed from structural fallback through the sole approved answer write');
    }
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
  failures.push(...metricsRecorderBindingFailures(sourceFile));
  failures.push(...dynamicCodeExecutionFailures(sourceFile));
  failures.push(...trustedPrimitiveMutationFailures(sourceFile));
  failures.push(...schemaBoundaryFailures(sourceFile));
  failures.push(...v2ProseEmissionFailures(sourceFile));
  failures.push(...streamCompletionSinkFailures(sourceFile));
  failures.push(...finalizationResultMutationFailures(sourceFile));
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

async function governanceDocumentationFailures(projectRoot) {
  const failures = [];
  const claims = JSON.parse(await readFile(resolve(projectRoot, CLAIMS_PATH), 'utf8'));
  const claim = (claims.claims ?? []).find((item) => item.id === GOVERNANCE_CLAIM_ID);
  if (!claim) {
    failures.push(`${CLAIMS_PATH}: missing ${GOVERNANCE_CLAIM_ID} claim`);
  } else {
    if (claim.statement !== GOVERNANCE_CLAIM_STATEMENT) {
      failures.push(`${CLAIMS_PATH}: ${GOVERNANCE_CLAIM_ID} must describe the documented v2 validator boundary exactly`);
    }
    const subjectRefs = new Set(claim.subjectRefs ?? []);
    for (const subjectRef of GOVERNANCE_CLAIM_SUBJECT_REFS) {
      if (!subjectRefs.has(subjectRef)) {
        failures.push(`${CLAIMS_PATH}: ${GOVERNANCE_CLAIM_ID} must cover ${subjectRef}`);
      }
    }
  }

  for (const [path, anchors] of Object.entries(GOVERNANCE_DOCUMENT_ANCHORS)) {
    let text;
    try {
      text = await readFile(resolve(projectRoot, path), 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        failures.push(`${path}: required DM v2 governance document is missing`);
        continue;
      }
      throw error;
    }
    const normalizedText = normalizeDocumentationText(text);
    for (const anchor of anchors) {
      if (!normalizedText.includes(anchor)) {
        failures.push(`${path}: missing canonical DM v2 governance anchor ${JSON.stringify(anchor)}`);
      }
    }
  }
  return failures;
}

export async function checkScriptedRuntimeRemoval({ projectRoot = process.cwd() } = {}) {
  const root = resolve(projectRoot);
  const failures = await removedFileFailures(root);
  failures.push(...await removalClaimFailures(root));
  failures.push(...await governanceDocumentationFailures(root));

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
