import { readFile } from 'node:fs/promises';
import process from 'node:process';

const PUBLIC_TOOL_MODULES = [
  'src/lib/dm/public-agent-tools.ts',
  'src/lib/dm/data-tools.ts',
];
const FORBIDDEN_IMPORT = /(?:^|\/)(?:admin|slack|private|candidate|visitor|auth|credentials?|secrets?)(?:\/|$)/i;
const FORBIDDEN_QUERY = /\b(?:project_drafts|project_candidates|admin_sessions|slack_events|visitor_history|conversation_history)\b/i;

const failures = [];
for (const path of PUBLIC_TOOL_MODULES) {
  const source = await readFile(path, 'utf8');
  const imports = [...source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g)]
    .map((match) => match[1]);

  for (const specifier of imports) {
    if (FORBIDDEN_IMPORT.test(specifier)) failures.push(`${path}: forbidden import ${specifier}`);
  }
  if (FORBIDDEN_QUERY.test(source)) failures.push(`${path}: forbidden private-source query token`);
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`Public DM tool import boundary verified for ${PUBLIC_TOOL_MODULES.length} modules.\n`);
