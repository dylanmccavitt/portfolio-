import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const PUBLIC_TOOL_MODULES = [
  'src/lib/dm/public-agent-tools.ts',
  'src/lib/dm/runtime.ts',
  'src/lib/dm/site-brief.ts',
];

const FORBIDDEN_IMPORT_SEGMENT = /(?:^|\/)(?:admin|slack|private|candidate|visitor|auth|credentials?|secrets?)(?:\/|$)/i;
const FORBIDDEN_QUERY = /\b(?:project_drafts|project_candidates|admin_sessions|slack_events|visitor_history|conversation_history)\b/i;
const CATALOG_MODULE = 'src/data/catalog';

export async function checkPublicDMToolBoundary({
  projectRoot = process.cwd(),
  modulePaths = PUBLIC_TOOL_MODULES,
} = {}) {
  const failures = [];
  for (const modulePath of modulePaths) {
    const absolutePath = resolve(projectRoot, modulePath);
    let source;
    try {
      source = await readFile(absolutePath, 'utf8');
    } catch {
      failures.push(`${modulePath}: required public DM module is unreadable`);
      continue;
    }

    const sourceFile = ts.createSourceFile(
      modulePath,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    for (const diagnostic of sourceFile.parseDiagnostics ?? []) {
      failures.push(`${modulePath}: TypeScript parse failure ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
    }

    for (const imported of collectModuleSpecifiers(sourceFile)) {
      if (imported.specifier === null) {
        failures.push(`${modulePath}: dynamic import must use a static string specifier`);
        continue;
      }
      const canonical = canonicalModuleSpecifier(projectRoot, modulePath, imported.specifier);
      if (FORBIDDEN_IMPORT_SEGMENT.test(canonical)) {
        failures.push(`${modulePath}: forbidden import ${imported.specifier} (resolved ${canonical})`);
      }
      if (canonical === CATALOG_MODULE) {
        failures.push(`${modulePath}: public DM modules must not import the catalog (${imported.specifier})`);
      }
    }
    if (FORBIDDEN_QUERY.test(source)) failures.push(`${modulePath}: forbidden private-source query token`);
  }
  return { failures };
}

function collectModuleSpecifiers(sourceFile) {
  const imports = [];
  const rememberLiteral = (node, kind) => {
    imports.push({
      kind,
      specifier: ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
        ? node.text
        : null,
    });
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) rememberLiteral(node.moduleSpecifier, 'static');
    } else if (
      ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression
    ) {
      rememberLiteral(node.moduleReference.expression, 'static');
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      rememberLiteral(node.arguments[0], 'dynamic');
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      rememberLiteral(node.argument.literal, 'type');
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return imports;
}

function canonicalModuleSpecifier(projectRoot, modulePath, rawSpecifier) {
  const specifier = rawSpecifier.split(/[?#]/, 1)[0].replaceAll('\\', '/');
  let canonical;
  if (specifier.startsWith('@/')) {
    canonical = `src/${specifier.slice(2)}`;
  } else if (specifier.startsWith('.')) {
    canonical = relative(projectRoot, resolve(projectRoot, dirname(modulePath), specifier)).replaceAll('\\', '/');
  } else {
    canonical = specifier;
  }
  return canonical
    .replace(/(?:\.d)?\.[cm]?[jt]sx?$/i, '')
    .replace(/\/index$/i, '');
}

const isDirectInvocation = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectInvocation) {
  const result = await checkPublicDMToolBoundary();
  if (result.failures.length > 0) {
    process.stderr.write(`${result.failures.join('\n')}\n`);
    process.exit(1);
  }
  process.stdout.write(`Public DM tool import boundary verified for ${PUBLIC_TOOL_MODULES.length} modules.\n`);
}
