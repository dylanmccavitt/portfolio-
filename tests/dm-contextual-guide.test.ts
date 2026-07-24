import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseDMChatRequest } from '@/pages/api/dm/chat';
import {
  deriveGuideActions,
  dmPageContextId,
  isAllowedGuideActionDestination,
  parseDMPageContext,
  type DMPageContext,
} from '@/lib/dm/guide';
import {
  beginGuideHistoryTurn,
  completeGuideHistoryTurn,
  resetGuideHistory,
  rollbackGuideHistoryTurn,
} from '@/lib/dm/guide-history';

const VALID_CONTEXTS: DMPageContext[] = [
  { kind: 'home', path: '/' },
  { kind: 'library', path: '/library' },
  { kind: 'project', path: '/projects/evalgate', reference: 'evalgate' },
  { kind: 'journey', path: '/journey' },
];

test('all four public route contexts validate to stable server context ids', () => {
  assert.deepEqual(
    VALID_CONTEXTS.map((context) => dmPageContextId(parseDMPageContext(context))),
    [
      'home:/:',
      'library:/library:',
      'project:/projects/evalgate:evalgate',
      'journey:/journey:',
    ],
  );
});

test('forged, unknown, private, and mismatched route contexts are rejected', async () => {
  for (const page of [
    { kind: 'admin', path: '/admin' },
    { kind: 'library', path: '/library/private-drafts' },
    { kind: 'home', path: '/admin' },
    { kind: 'project', path: '/projects/evalgate', reference: '../admin' },
    { kind: 'project', path: '/projects/evalgate', reference: 'loom' },
    { kind: 'project', path: '/projects\\evalgate', reference: 'evalgate' },
    { kind: 'project', path: '/projects/private/../evalgate', reference: 'evalgate' },
    { kind: 'project', path: '/projects/%2e%2e/evalgate', reference: 'evalgate' },
    { kind: 'journey', path: '/journey', privateSources: true },
    // Retired routes (#317) are no longer allowlisted page contexts.
    { kind: 'hiring', path: '/hiring' },
    { kind: 'fit-check', path: '/fit-check' },
  ]) {
    assert.throws(() => parseDMPageContext(page), /context\.page/);
  }

  await assert.rejects(
    parseRequest(
      { kind: 'project', path: '/projects/evalgate', reference: 'evalgate' },
      { projectIds: ['private-hidden'] },
    ),
    /derived from the active project route/,
  );
});

test('stale cross-route history is rejected before it can reach the model', async () => {
  const page = { kind: 'journey', path: '/journey' } as const;
  const request = requestFor(page, 'What changed?', [
    message('assistant', 'Old project answer.', 'project:/projects/evalgate:evalgate'),
  ]);
  await assert.rejects(parseDMChatRequest(request), /history does not match the active page context/);
});

test('cancelled turns roll back and route resets invalidate stale completions', () => {
  const history = ['prior answer'];
  let generation = 0;
  const cancelled = beginGuideHistoryTurn(history, generation, 'cancel me');
  assert.equal(rollbackGuideHistoryTurn(history, cancelled, generation), true);
  assert.deepEqual(history, ['prior answer']);

  const stale = beginGuideHistoryTurn(history, generation, 'old route');
  generation = resetGuideHistory(history, generation);
  assert.deepEqual(history, []);
  assert.equal(rollbackGuideHistoryTurn(history, stale, generation), false);
  assert.deepEqual(history, []);
  assert.equal(completeGuideHistoryTurn(history, stale, generation, 'stale answer'), false);
  assert.deepEqual(history, []);

  const recovered = beginGuideHistoryTurn(history, generation, 'new route');
  assert.equal(completeGuideHistoryTurn(history, recovered, generation, 'fresh answer'), true);
  assert.deepEqual(history, ['new route', 'fresh answer']);
});

test('project page context keeps its public slug distinct from internal project ids', async () => {
  const parsed = await parseDMChatRequest(requestFor(
    { kind: 'project', path: '/projects/public-project-slug', reference: 'public-project-slug' },
    'What matters most about this project?',
  ));
  assert.equal(parsed.context?.page.reference, 'public-project-slug');
  assert.equal(parsed.context?.projectIds, undefined);
});

test('the retired fit-check transient context is no longer an accepted request field', async () => {
  await assert.rejects(
    parseRequest({ kind: 'home', path: '/' }, {
      fitCheck: { kind: 'job-description', jobDescription: 'Build reliable TypeScript and PostgreSQL services.' },
    }),
    /context contains unsupported fields/,
  );
});

test('actions are server-authored, allowlisted, and traceable to route or same-run evidence', () => {
  const actions = deriveGuideActions(
    { kind: 'library', path: '/library' },
    [{
      kind: 'project',
      id: 'project:evalgate',
      project: {
        title: 'EvalGate',
        href: '/projects/evalgate',
        evidenceIds: ['project:evalgate:title'],
      },
    }],
  );
  assert.deepEqual(actions[0], {
    id: 'project:project:evalgate',
    label: 'View EvalGate',
    href: '/projects/evalgate',
    source: { kind: 'evidence', evidenceId: 'project:evalgate:title' },
  });
  assert.ok(actions.every((action) => isAllowedGuideActionDestination(action.href)));
  assert.ok(actions.every((action) => action.source.kind === 'route' || action.source.kind === 'evidence'));
  for (const href of ['https://evil.example', '//evil.example', '/admin', '/projects/../admin', '/library?private=1', 'javascript:alert(1)', '/hiring', '/fit-check']) {
    assert.equal(isAllowedGuideActionDestination(href), false, href);
  }
});

test('action derivation drops invented destinations without requiring a follow-up action', () => {
  const actions = deriveGuideActions(
    { kind: 'project', path: '/projects/evalgate', reference: 'evalgate' },
    [{
      kind: 'project',
      id: 'project:forged',
      project: {
        title: 'Forged',
        href: 'https://private.example/project',
        evidenceIds: ['project:forged:title'],
      },
    }],
  );
  assert.ok(actions.every((action) => action.source.kind === 'route'));
  assert.ok(actions.every((action) => isAllowedGuideActionDestination(action.href)));
});

test('the optional guide has desktop sidecar, mobile bottom-sheet, keyboard, cancellation, and route-reset hooks', async () => {
  const [component, client, css] = await Promise.all([
    readFile(new URL('../src/components/ContextualGuide.astro', import.meta.url), 'utf8'),
    readFile(new URL('../src/scripts/dm.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles/dm.css', import.meta.url), 'utf8'),
  ]);
  assert.match(component, /data-dm-open/);
  assert.match(component, /data-dm-close/);
  assert.match(component, /data-dm-cancel/);
  assert.match(component, /aria-modal="true"/);
  assert.match(client, /event\.key === 'Escape'/);
  assert.match(client, /event\.key !== 'Tab'/);
  assert.match(client, /controller\?\.abort\(\)/);
  assert.match(client, /turn\.stop\(\)/);
  assert.match(client, /document\.activeElement === panel/);
  assert.match(client, /window\.addEventListener\('popstate'/);
  assert.match(client, /resetGuideHistory\(history, generation\)/);
  assert.match(css, /\.context-guide-panel[\s\S]*height: 100dvh/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*\.context-guide-panel[\s\S]*width: 100%/);
  assert.doesNotMatch(component, /avatar|provider|model label/i);
});

function requestFor(
  page: DMPageContext,
  text: string,
  prior: Array<Record<string, unknown>> = [],
  extraContext: Record<string, unknown> = {},
): Request {
  const pageContextId = dmPageContextId(page);
  const context = {
    page,
    ...(page.kind === 'journey' && page.reference ? { resumeTrackIds: [page.reference] } : {}),
    ...extraContext,
  };
  return new Request('https://portfolio.test/api/dm/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [...prior, message('user', text, pageContextId)], context }),
  });
}

function message(role: 'user' | 'assistant', text: string, pageContextId: string): Record<string, unknown> {
  return { id: `${role}-${text}`, role, metadata: { pageContextId }, parts: [{ type: 'text', text }] };
}

function parseRequest(page: DMPageContext, extraContext: Record<string, unknown>): Promise<unknown> {
  return parseDMChatRequest(requestFor(page, 'Test request', [], extraContext));
}
