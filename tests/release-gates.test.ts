import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { serializeJsonLd } from '@/lib/seo';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CSP = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; upgrade-insecure-requests";

test('shared JSON-LD serializer preserves data without allowing hostile script termination', () => {
  const hostile = {
    payload: '</ScRiPt><script>not executable</script>',
    separators: `before${String.fromCharCode(0x2028)}middle${String.fromCharCode(0x2029)}after`,
  };
  const serialized = serializeJsonLd(hostile);

  assert.equal(serialized.includes('<'), false);
  assert.equal(serialized.toLowerCase().includes('</script'), false);
  assert.equal(serialized.includes(String.fromCharCode(0x2028)), false);
  assert.equal(serialized.includes(String.fromCharCode(0x2029)), false);
  assert.deepEqual(JSON.parse(serialized), hostile);
});

test('all public layouts use the shared JSON-LD serializer', async () => {
  for (const layout of ['Device.astro', 'Tour.astro', 'DM.astro']) {
    const source = await readFile(resolve(ROOT, 'src', 'layouts', layout), 'utf8');
    assert.match(source, /serializeJsonLd\((?:jsonLd|meta\.jsonLd)\)/, layout);
    assert.equal(source.includes('JSON.stringify(jsonLd)'), false, layout);
  }

  const editorial = await readFile(resolve(ROOT, 'src', 'layouts', 'Editorial.astro'), 'utf8');
  assert.match(editorial, /import Device from '@\/layouts\/Device\.astro'/);
  assert.match(editorial, /<Device[\s\S]*meta=\{meta\}/);
  assert.equal(editorial.includes('JSON.stringify(jsonLd)'), false);
});

test('Vercel applies the exact global CSP without wildcards or unsafe-eval', async () => {
  const config = JSON.parse(await readFile(resolve(ROOT, 'vercel.json'), 'utf8')) as {
    headers?: Array<{ source?: string; headers?: Array<{ key?: string; value?: string }> }>;
  };
  const rule = config.headers?.find((entry) => entry.source === '/(.*)');
  const value = rule?.headers?.find((entry) => entry.key === 'Content-Security-Policy')?.value;

  assert.equal(value, CSP);
  assert.equal(value?.includes('*'), false);
  assert.equal(value?.includes('unsafe-eval'), false);
});

test('maintainer-only ruleset payload protects both release branches with the existing CI context', async () => {
  const payload = JSON.parse(
    await readFile(resolve(ROOT, 'docs', 'agents', 'release-branch-ruleset.json'), 'utf8'),
  ) as {
    target: string;
    enforcement: string;
    bypass_actors: unknown[];
    conditions: { ref_name: { include: string[]; exclude: string[] } };
    rules: Array<{ type: string; parameters?: Record<string, unknown> }>;
  };

  assert.equal(payload.target, 'branch');
  assert.equal(payload.enforcement, 'active');
  assert.deepEqual(payload.bypass_actors, []);
  assert.deepEqual(payload.conditions.ref_name, {
    include: ['refs/heads/main', 'refs/heads/preview/agent-first-redesign'],
    exclude: [],
  });
  assert.ok(payload.rules.some((rule) => rule.type === 'deletion'));
  assert.ok(payload.rules.some((rule) => rule.type === 'non_fast_forward'));

  const pullRequest = payload.rules.find((rule) => rule.type === 'pull_request');
  assert.deepEqual(pullRequest?.parameters, {
    allowed_merge_methods: ['merge', 'squash', 'rebase'],
    dismiss_stale_reviews_on_push: true,
    require_code_owner_review: false,
    require_last_push_approval: false,
    required_approving_review_count: 0,
    required_review_thread_resolution: true,
  });

  const checks = payload.rules.find((rule) => rule.type === 'required_status_checks');
  assert.deepEqual(checks?.parameters, {
    do_not_enforce_on_create: false,
    required_status_checks: [{ context: 'Lint, typecheck, build', integration_id: 15368 }],
    strict_required_status_checks_policy: true,
  });
});
