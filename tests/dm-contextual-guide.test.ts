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

const VALID_CONTEXTS: DMPageContext[] = [
  { kind: 'home', path: '/' },
  { kind: 'library', path: '/library' },
  { kind: 'project', path: '/projects/evalgate', reference: 'evalgate' },
  { kind: 'journey', path: '/journey' },
  { kind: 'hiring', path: '/hiring' },
  { kind: 'fit-check', path: '/fit-check' },
];

test('all six public route contexts validate to stable server context ids', () => {
  assert.deepEqual(
    VALID_CONTEXTS.map((context) => dmPageContextId(parseDMPageContext(context))),
    [
      'home:/:',
      'library:/library:',
      'project:/projects/evalgate:evalgate',
      'journey:/journey:',
      'hiring:/hiring:',
      'fit-check:/fit-check:',
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
    { kind: 'hiring', path: '/hiring', privateSources: true },
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

test('fit-check context remains route-bound and sanitizes private contact data', async () => {
  const page = { kind: 'fit-check', path: '/fit-check' } as const;
  const parsed = await parseDMChatRequest(requestFor(page, 'Assess this role.', [], {
    fitCheck: {
      kind: 'job-description',
      jobDescription: `${'Email recruiter@example.com and open https://private.example/job. '.repeat(3)}Build reliable TypeScript and PostgreSQL services.`,
    },
  }));
  assert.match(parsed.context?.fitCheck?.jobDescription ?? '', /\[email removed\]/);
  assert.match(parsed.context?.fitCheck?.jobDescription ?? '', /\[link removed\]/);
  assert.doesNotMatch(parsed.context?.fitCheck?.jobDescription ?? '', /recruiter@example\.com|private\.example/);

  await assert.rejects(
    parseRequest({ kind: 'home', path: '/' }, { fitCheck: parsed.context?.fitCheck }),
    /only on the fit-check route/,
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
  for (const href of ['https://evil.example', '//evil.example', '/admin', '/projects/../admin', '/library?private=1', 'javascript:alert(1)']) {
    assert.equal(isAllowedGuideActionDestination(href), false, href);
  }
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
  assert.match(client, /window\.addEventListener\('popstate'/);
  assert.match(client, /history\.length = 0/);
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
    ...(page.kind === 'project' && page.reference ? { projectIds: [page.reference] } : {}),
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
