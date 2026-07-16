import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  PUBLIC_TOOL_MODULES,
  checkPublicDMToolBoundary,
} from '../scripts/check-public-dm-tool-boundary.mjs';

async function writeFixture(root, path, source) {
  const absolutePath = join(root, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, source);
}

async function createFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'public-dm-tool-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all(PUBLIC_TOOL_MODULES.map((path) => writeFixture(root, path, 'export const safe = true;\n')));
  return root;
}

test('AST import boundary accepts the scoped public DM modules', async (t) => {
  const root = await createFixture(t);
  const result = await checkPublicDMToolBoundary({ projectRoot: root });
  assert.deepEqual(result.failures, []);
});

test('AST import boundary rejects canonical private, admin, and catalog variants', async (t) => {
  const cases = [
    {
      name: 'dynamic private alias',
      path: 'src/lib/dm/runtime.ts',
      source: "export const load = () => import('@/lib/private/runtime');\n",
      expected: /forbidden import.*resolved src\/lib\/private\/runtime/,
    },
    {
      name: 'dynamic relative admin',
      path: 'src/lib/dm/public-agent-tools.ts',
      source: "export const load = () => import('../admin/source.ts');\n",
      expected: /forbidden import.*resolved src\/lib\/admin\/source/,
    },
    {
      name: 'relative catalog',
      path: 'src/lib/dm/site-brief.ts',
      source: "export { catalog } from '../../data/catalog';\n",
      expected: /must not import the catalog.*\.\.\/\.\.\/data\/catalog/,
    },
    {
      name: 'relative catalog.ts variant',
      path: 'src/lib/dm/site-brief.ts',
      source: "import '../../../src/data/catalog.ts';\n",
      expected: /must not import the catalog.*catalog\.ts/,
    },
    {
      name: '@ alias catalog.ts variant',
      path: 'src/lib/dm/runtime.ts',
      source: "import type { Project } from '@/data/catalog.ts';\n",
      expected: /must not import the catalog.*@\/data\/catalog\.ts/,
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async (subtest) => {
      const root = await createFixture(subtest);
      await writeFixture(root, fixture.path, fixture.source);
      const result = await checkPublicDMToolBoundary({ projectRoot: root });
      assert.ok(result.failures.some((failure) => fixture.expected.test(failure)), result.failures.join('\n'));
    });
  }
});

test('AST import boundary fails closed for a non-literal dynamic import', async (t) => {
  const root = await createFixture(t);
  await writeFixture(root, 'src/lib/dm/runtime.ts', 'export const load = (path) => import(path);\n');
  const result = await checkPublicDMToolBoundary({ projectRoot: root });
  assert.ok(result.failures.includes('src/lib/dm/runtime.ts: dynamic import must use a static string specifier'));
});
