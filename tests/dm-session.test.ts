/**
 * DM session gate (#356 follow-up).
 *
 * `src/components/frost/dm-session.js` is what lets the conversation survive
 * the navigations DM itself performs — and sessionStorage is same-origin
 * writable, so everything it reads back is treated as hostile input. This
 * suite pins that posture:
 *
 *   1. a stored conversation round-trips exactly: settled pairs, display text,
 *      the byte-exact signed `content`, and the `token` over it;
 *   2. malformed, oversized, or off-schema payloads degrade to "no session",
 *      never to a guess, and foreign fields never survive the read;
 *   3. the service's own history ceiling (24 messages) is mirrored on both the
 *      write and the read;
 *   4. carried page actions go back through `sanitizeAction` against the
 *      *current* manifest at take time — the stash is not a second allowlist;
 *   5. the turn queue holds an `open` until the turn settles, so navigation
 *      can never kill the stream that earned it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const {
  DM_MAX_MESSAGES,
  DM_MAX_PAYLOAD_CHARS,
  DM_MAX_PENDING,
  DM_PENDING_KEY,
  DM_SESSION_KEY,
  clearDmSession,
  createTurnQueue,
  historyWasRejected,
  readDmSession,
  stashDmActions,
  takeDmActions,
  writeDmOpen,
  writeDmSession,
} = await import('../src/components/frost/dm-session.js');

/** Stand-in manifest, the same shape the pages pass the island. */
const MANIFEST = {
  anchors: ['about', 'work', 'journey', 'contact'],
  projectIds: ['evalgate', 'bellas-beads'],
  actions: ['go', 'lit', 'open', 'litContact'],
};

/** A Map-backed sessionStorage double, so the suite runs without a DOM. */
function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
  };
}

const seeded = (state: unknown) => fakeStorage({ [DM_SESSION_KEY]: JSON.stringify(state) });

test('a settled conversation round-trips byte-exactly, ids and all else stripped', () => {
  const storage = fakeStorage();
  // A live list as DmCard holds it: ids, a settled pair with signature, a
  // failed pair with its note, and a still-streaming tail.
  const live = [
    { id: 'dm-1', role: 'user', text: 'What has Dylan built?', state: 'done' },
    {
      id: 'dm-2',
      role: 'dm',
      text: 'evalgate, for one.',
      state: 'done',
      token: 'sig-1',
      content: 'evalgate, for one.  ',
      truncated: true,
    },
    { id: 'dm-3', role: 'user', text: 'And?', state: 'done' },
    { id: 'dm-4', role: 'dm', text: '', state: 'failed', note: 'DM could not answer that.', reset: true },
    { id: 'dm-5', role: 'user', text: 'mid-flight question', state: 'done' },
    { id: 'dm-6', role: 'dm', text: 'half an ans', state: 'streaming' },
  ];

  writeDmSession({ open: true, messages: live }, storage);
  const restored = readDmSession(storage);

  assert.equal(restored.open, true);
  // The streaming pair is gone with its question; everything settled survives,
  // the signed content untouched (trailing whitespace included) and nothing
  // else — no ids, no foreign fields.
  assert.deepEqual(restored.messages, [
    { role: 'user', text: 'What has Dylan built?', state: 'done' },
    {
      role: 'dm',
      text: 'evalgate, for one.',
      state: 'done',
      token: 'sig-1',
      content: 'evalgate, for one.  ',
      truncated: true,
    },
    { role: 'user', text: 'And?', state: 'done' },
    { role: 'dm', text: '', state: 'failed', note: 'DM could not answer that.', reset: true },
  ]);
});

test('malformed payloads degrade to no session, never to a guess', () => {
  for (const raw of ['not json', '"a string"', '[]', '42', 'null', '{']) {
    const storage = fakeStorage({ [DM_SESSION_KEY]: raw });
    assert.deepEqual(readDmSession(storage), { open: false, messages: [] }, raw);
  }
  // Absent storage entirely (privacy modes) is the same non-answer.
  assert.deepEqual(readDmSession(null), { open: false, messages: [] });
  // A non-boolean open flag is closed, not truthy.
  assert.equal(readDmSession(seeded({ open: 'yes', messages: [] })).open, false);
});

test('foreign fields are stripped and off-schema messages void the tail', () => {
  const storage = seeded({
    open: true,
    messages: [
      { role: 'user', text: 'q', state: 'done', html: '<img onerror=x>', __proto__: { admin: true } },
      { role: 'dm', text: 'a', state: 'done', onclick: 'alert(1)', token: 'sig', content: 'a' },
      // The first entry that breaks the pair pattern ends trust in the rest.
      { role: 'dm', text: 'answer with no question', state: 'done' },
      { role: 'user', text: 'never reached', state: 'done' },
    ],
  });

  const { messages } = readDmSession(storage);
  assert.deepEqual(messages, [
    { role: 'user', text: 'q', state: 'done' },
    { role: 'dm', text: 'a', state: 'done', token: 'sig', content: 'a' },
  ]);
  for (const message of messages) {
    assert.equal(Object.hasOwn(message, 'html'), false);
    assert.equal(Object.hasOwn(message, 'onclick'), false);
  }

  // A streaming state in storage is a forgery of an unfinished turn: the pair
  // is not restorable, and neither is anything after it.
  const tampered = readDmSession(
    seeded({
      open: true,
      messages: [
        { role: 'user', text: 'q', state: 'done' },
        { role: 'dm', text: 'a', state: 'streaming' },
        { role: 'user', text: 'q2', state: 'done' },
        { role: 'dm', text: 'a2', state: 'done' },
      ],
    }),
  );
  assert.deepEqual(tampered.messages, []);
});

test('a token without its content (or vice versa) is not an echoable turn', () => {
  const { messages } = readDmSession(
    seeded({
      open: true,
      messages: [
        { role: 'user', text: 'q', state: 'done' },
        { role: 'dm', text: 'a', state: 'done', token: 'sig-orphan' },
        { role: 'user', text: 'q2', state: 'done' },
        { role: 'dm', text: 'a2', state: 'done', content: 'a2' },
      ],
    }),
  );
  // The turns display, but neither carries the signature pair, so neither can
  // be replayed to the service.
  assert.deepEqual(messages, [
    { role: 'user', text: 'q', state: 'done' },
    { role: 'dm', text: 'a', state: 'done' },
    { role: 'user', text: 'q2', state: 'done' },
    { role: 'dm', text: 'a2', state: 'done' },
  ]);
});

test('the service history ceiling is mirrored: newest 24 messages win', () => {
  const pairs = Array.from({ length: 20 }, (_, index) => [
    { role: 'user', text: `q${index}`, state: 'done' },
    { role: 'dm', text: `a${index}`, state: 'done' },
  ]).flat();

  // On read of an overlong stored payload…
  const read = readDmSession(seeded({ open: true, messages: pairs }));
  assert.equal(read.messages.length, DM_MAX_MESSAGES);
  assert.equal(read.messages[0].text, 'q8');
  assert.equal(read.messages.at(-1)?.text, 'a19');

  // …and on write of an overlong live one.
  const storage = fakeStorage();
  writeDmSession({ open: true, messages: pairs }, storage);
  const written = JSON.parse(storage.map.get(DM_SESSION_KEY) ?? '') as { messages: unknown[] };
  assert.equal(written.messages.length, DM_MAX_MESSAGES);
});

test('an oversized payload is discarded on read and shed pairwise on write', () => {
  // Read side: a raw blob past the ceiling is not even parsed.
  const storage = fakeStorage({ [DM_SESSION_KEY]: `{"open":true,"messages":[${'"x",'.repeat(1)}]}`.padEnd(DM_MAX_PAYLOAD_CHARS + 1, ' ') });
  assert.deepEqual(readDmSession(storage), { open: false, messages: [] });

  // Write side: pairs are shed oldest-first until the payload fits — a
  // message is never truncated (a clipped signed echo would not verify).
  const big = 'x'.repeat(7900);
  const pairs = Array.from({ length: 12 }, (_, index) => [
    { role: 'user', text: `q${index}`, state: 'done' },
    { role: 'dm', text: big, state: 'done', token: `sig${index}`, content: 'y'.repeat(60_000) },
  ]).flat();
  const out = fakeStorage();
  writeDmSession({ open: true, messages: pairs }, out);
  const raw = out.map.get(DM_SESSION_KEY) ?? '';
  assert.ok(raw.length <= DM_MAX_PAYLOAD_CHARS);
  const written = JSON.parse(raw) as { messages: Array<{ text: string; content?: string }> };
  assert.ok(written.messages.length > 0);
  // The newest pair survived whole.
  assert.equal(written.messages.at(-2)?.text, 'q11');
  assert.equal(written.messages.at(-1)?.content?.length, 60_000);
});

test('writeDmOpen flips the flag without touching the stored turns', () => {
  const storage = fakeStorage();
  writeDmSession(
    {
      open: true,
      messages: [
        { role: 'user', text: 'q', state: 'done' },
        { role: 'dm', text: 'a', state: 'done' },
      ],
    },
    storage,
  );
  writeDmOpen(false, storage);
  const closed = readDmSession(storage);
  assert.equal(closed.open, false);
  assert.equal(closed.messages.length, 2);

  writeDmOpen(true, storage);
  assert.equal(readDmSession(storage).open, true);
});

test('clearDmSession removes the conversation and any carried actions', () => {
  const storage = fakeStorage();
  writeDmSession({ open: true, messages: [] }, storage);
  stashDmActions([{ type: 'go', target: 'work' }], storage);
  clearDmSession(storage);
  assert.equal(storage.map.size, 0);
});

test('carried actions round-trip through the allowlist and the stash is one-shot', () => {
  const storage = fakeStorage();
  stashDmActions(
    [
      { type: 'go', target: 'work' },
      { type: 'litContact' },
      { type: 'lit', target: 'evalgate', href: 'javascript:1' },
    ],
    storage,
  );

  assert.deepEqual(takeDmActions(MANIFEST, storage), [
    { type: 'go', target: 'work' },
    { type: 'litContact', target: undefined },
    { type: 'lit', target: 'evalgate' },
  ]);
  // Taken means gone: a reload does not replay the scroll and the flashes.
  assert.deepEqual(takeDmActions(MANIFEST, storage), []);
});

test('a stashed action is re-validated at execution time, not just at receipt', () => {
  // Shape-valid entries whose substance the manifest refuses: they were
  // stashed fine, and they still die at take time.
  const storage = fakeStorage();
  stashDmActions(
    [
      { type: 'lit', target: 'ghost-project' },
      { type: 'go', target: 'admin' },
      { type: 'navigate', target: 'work' },
      { type: 'go', target: 'work' },
    ],
    storage,
  );
  assert.deepEqual(takeDmActions(MANIFEST, storage), [{ type: 'go', target: 'work' }]);

  // No manifest means no allowlist, so nothing targeted survives.
  stashDmActions([{ type: 'go', target: 'work' }], storage);
  assert.deepEqual(takeDmActions(null, storage), []);

  // A hand-forged stash is as untrusted as the wire.
  for (const raw of ['not json', '{"type":"go","target":"work"}', JSON.stringify('go work')]) {
    const forged = fakeStorage({ [DM_PENDING_KEY]: raw });
    assert.deepEqual(takeDmActions(MANIFEST, forged), [], raw);
  }
  const huge = fakeStorage({
    [DM_PENDING_KEY]: JSON.stringify(Array.from({ length: 500 }, () => ({ type: 'go', target: 'work' }))),
  });
  assert.deepEqual(takeDmActions(MANIFEST, huge), []);
});

test('the stash caps how many actions one turn may carry', () => {
  const storage = fakeStorage();
  stashDmActions(
    Array.from({ length: 10 }, () => ({ type: 'go', target: 'work' })),
    storage,
  );
  assert.equal(takeDmActions(MANIFEST, storage).length, DM_MAX_PENDING);
});

test('the turn queue defers open until settle and applies what it can now', () => {
  const applied: string[] = [];
  const queue = createTurnQueue();
  const applyNow = (action: { type: string; target?: string }) => {
    applied.push(action.type);
    return true;
  };

  // An `open` mid-stream is never applied — navigating would kill the stream.
  queue.offer({ type: 'open', target: 'evalgate' }, applyNow);
  queue.offer({ type: 'go', target: 'work' }, applyNow);
  assert.deepEqual(applied, ['go']);
  // Only at settle does the turn earn its navigation.
  assert.deepEqual(queue.settle(), { kind: 'open', target: 'evalgate' });
});

test('actions this page cannot perform are queued for the homepage', () => {
  const queue = createTurnQueue();
  const cannot = () => false;
  queue.offer({ type: 'go', target: 'work' }, cannot);
  queue.offer({ type: 'litContact', target: undefined }, cannot);
  assert.deepEqual(queue.settle(), {
    kind: 'home',
    actions: [
      { type: 'go', target: 'work' },
      { type: 'litContact', target: undefined },
    ],
  });

  // An `open` supersedes them: the visitor is leaving for a project page.
  const superseded = createTurnQueue();
  superseded.offer({ type: 'go', target: 'work' }, cannot);
  superseded.offer({ type: 'open', target: 'bellas-beads' }, cannot);
  assert.deepEqual(superseded.settle(), { kind: 'open', target: 'bellas-beads' });

  // A turn with nothing pending earns no navigation.
  assert.equal(createTurnQueue().settle(), null);
});

test('historyWasRejected fires only for a 400 against a signed transcript', () => {
  const signed = [
    { role: 'user', content: 'q' },
    { role: 'assistant', content: 'a', token: 'sig' },
  ];
  const status = (code: number) => Object.assign(new Error('x'), { status: code });

  assert.equal(historyWasRejected(status(400), signed), true);
  // A first question has no history the service could have rejected.
  assert.equal(historyWasRejected(status(400), [{ role: 'user', content: 'q' }]), false);
  // Any other failure is not a verification problem.
  assert.equal(historyWasRejected(status(503), signed), false);
  assert.equal(historyWasRejected(new Error('x'), signed), false);
  assert.equal(historyWasRejected(null, signed), false);
});
