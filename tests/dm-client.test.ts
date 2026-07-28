/**
 * DM transport gate (#356).
 *
 * `src/components/frost/dm-client.js` is the browser's security boundary: the
 * DM service is a separate deployment, and nothing it streams is trusted. This
 * suite pins the three things that boundary rests on —
 *
 *   1. the SSE parser, exercised over adversarial chunk splits;
 *   2. THE ALLOWLIST, which drops any action whose type is unknown or whose
 *      target is absent from the page-action manifest — the build-time prop
 *      that replaced the fetched corpus, and the reason the client can still
 *      police actions without the corpus ever reaching a browser;
 *   3. the deterministic citation linkifier, which is the only way a project
 *      name in an answer becomes clickable (the model never supplies a link);
 *   4. the deadlines, so a service that opens the response and then goes quiet
 *      ends the turn instead of holding the card busy;
 *   5. transcript continuity — the service signs every answer it streams and
 *      refuses any assistant turn that comes back without that signature, so
 *      the token has to survive the round trip byte-for-byte or every follow-up
 *      question fails.
 *
 * The streaming cases run against a throwaway `node:http` SSE stub, so the real
 * fetch + ReadableStream path is what gets tested, not a mock of it.
 */
import assert from 'node:assert/strict';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

const {
  askDm,
  createSseParser,
  linkifyCitations,
  resolveDmEndpoint,
  sanitizeAction,
  DM_ACTION_TYPES,
} = await import('../src/components/frost/dm-client.js');

/** Stand-in manifest: the only anchors and project ids that exist. */
const MANIFEST = {
  anchors: ['about', 'work', 'journey', 'contact'],
  projectIds: ['evalgate', 'bellas-beads'],
  actions: [...DM_ACTION_TYPES],
};

/** The Work-card models the island already renders, used for citation chips. */
const PROJECTS = [
  { id: 'evalgate', slug: 'evalgate', href: '/projects/evalgate', title: 'evalgate' },
  { id: 'bellas-beads', slug: 'bellas-beads', href: '/projects/bellas-beads', title: "Bella's Beads" },
];

/**
 * Serves one canned SSE body at `/chat`, in whatever chunks the caller wants.
 * `seen.body` is the most recent request body; `seen.bodies` is every one of
 * them in order, which is what the multi-turn cases read.
 */
async function withStub(
  chunks: string[],
  run: (endpoint: string, seen: { body: unknown; bodies: unknown[] }) => Promise<void>,
  { status = 200 }: { status?: number } = {},
) {
  const seen: { body: unknown; bodies: unknown[] } = { body: null, bodies: [] };
  const server: Server = createServer((request, response) => {
    const parts: Buffer[] = [];
    request.on('data', (part: Buffer) => parts.push(part));
    request.on('end', () => {
      try {
        seen.body = JSON.parse(Buffer.concat(parts).toString('utf8'));
      } catch {
        seen.body = null;
      }
      seen.bodies.push(seen.body);
      if (request.url !== '/chat' || request.method !== 'POST') {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(status, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      });
      for (const chunk of chunks) response.write(chunk);
      response.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`, seen);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/**
 * Serves an SSE response that opens and then never completes — the failure the
 * deadlines exist for. With `keepAliveMs` it keeps dribbling comments, which
 * resets the stall timer forever and leaves only the overall deadline.
 */
async function withStalledStub(
  head: string[],
  run: (endpoint: string) => Promise<void>,
  { keepAliveMs = 0 }: { keepAliveMs?: number } = {},
) {
  const live = new Set<ServerResponse>();
  const beats = new Set<NodeJS.Timeout>();
  const server: Server = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const chunk of head) response.write(chunk);
      live.add(response);
      if (keepAliveMs > 0) {
        const beat = setInterval(() => response.write(': keepalive\n\n'), keepAliveMs);
        beats.add(beat);
        response.on('close', () => clearInterval(beat));
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    beats.forEach((beat) => clearInterval(beat));
    live.forEach((response) => response.destroy());
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

test('the SSE parser survives comments, CRLF, and events split across chunks', () => {
  const parser = createSseParser();

  assert.deepEqual(parser.push(': keepalive\n\n'), []);
  // One event delivered three bytes at a time.
  assert.deepEqual(parser.push('event: te'), []);
  assert.deepEqual(parser.push('xt\ndata: {"text":"hel'), []);
  assert.deepEqual(parser.push('lo"}\n'), []);
  assert.deepEqual(parser.push('\n'), [{ event: 'text', data: '{"text":"hello"}' }]);

  // CRLF line endings and a multi-line data payload.
  assert.deepEqual(parser.push('event: text\r\ndata: a\r\ndata: b\r\n\r\n'), [
    { event: 'text', data: 'a\nb' },
  ]);

  // A final event with no terminating blank line is still dispatched.
  assert.deepEqual(parser.push('event: done\ndata: {"reason":"end_turn"}\n'), []);
  assert.deepEqual(parser.flush(), [{ event: 'done', data: '{"reason":"end_turn"}' }]);
  assert.deepEqual(parser.flush(), []);
});

test('THE ALLOWLIST: only known types with manifest-known targets survive', () => {
  // Accepted.
  assert.deepEqual(sanitizeAction({ type: 'go', target: 'work' }, MANIFEST), {
    type: 'go',
    target: 'work',
  });
  assert.deepEqual(sanitizeAction({ type: 'lit', target: 'evalgate' }, MANIFEST), {
    type: 'lit',
    target: 'evalgate',
  });
  assert.deepEqual(sanitizeAction({ type: 'open', target: 'bellas-beads' }, MANIFEST), {
    type: 'open',
    target: 'bellas-beads',
  });
  assert.deepEqual(sanitizeAction({ type: 'litContact' }, MANIFEST), {
    type: 'litContact',
    target: undefined,
  });

  // Dropped: unknown verbs, however plausible.
  for (const type of ['navigate', 'eval', 'GO', 'litcontact', '', 'toString', '__proto__']) {
    assert.equal(sanitizeAction({ type, target: 'work' }, MANIFEST), null, `type ${type}`);
  }

  // Dropped: known verb, target the manifest does not publish.
  assert.equal(sanitizeAction({ type: 'go', target: 'admin' }, MANIFEST), null);
  assert.equal(sanitizeAction({ type: 'go', target: 'evalgate' }, MANIFEST), null, 'anchor ≠ project');
  assert.equal(sanitizeAction({ type: 'lit', target: 'work' }, MANIFEST), null, 'project ≠ anchor');
  assert.equal(sanitizeAction({ type: 'open', target: 'secret-project' }, MANIFEST), null);
  assert.equal(sanitizeAction({ type: 'open', target: 'https://evil.example/x' }, MANIFEST), null);

  // Dropped: malformed shapes and a missing/blank target.
  assert.equal(sanitizeAction({ type: 'go' }, MANIFEST), null);
  assert.equal(sanitizeAction({ type: 'go', target: '' }, MANIFEST), null);
  assert.equal(sanitizeAction({ type: 'go', target: ['work'] }, MANIFEST), null);
  assert.equal(sanitizeAction(null, MANIFEST), null);
  assert.equal(sanitizeAction('go work', MANIFEST), null);

  // Dropped: no manifest means no allowlist, so nothing targeted is allowed.
  assert.equal(sanitizeAction({ type: 'go', target: 'work' }, null), null);

  // Extra fields the service might attach never survive.
  assert.deepEqual(sanitizeAction({ type: 'go', target: 'work', href: 'javascript:1' }, MANIFEST), {
    type: 'go',
    target: 'work',
  });
});

test('citations are matched against the page\'s own projects, never supplied by the model', () => {
  const segments = linkifyCitations(
    "Bella's Beads shipped; evalgate gates the build. bellas-beadsx is not a name.",
    PROJECTS,
  );

  assert.deepEqual(
    segments.filter((segment) => segment.projectId),
    [
      { text: "Bella's Beads", projectId: 'bellas-beads' },
      { text: 'evalgate', projectId: 'evalgate' },
    ],
  );
  // Round-tripping the segments reproduces the answer exactly — no text lost,
  // none invented.
  assert.equal(
    segments.map((segment) => segment.text).join(''),
    "Bella's Beads shipped; evalgate gates the build. bellas-beadsx is not a name.",
  );
  // Markup in an answer stays inert text; it never becomes a chip.
  const injected = linkifyCitations('<img src=x onerror=alert(1)> evalgate', PROJECTS);
  assert.equal(injected[0].projectId, undefined);
  assert.equal(injected[0].text, '<img src=x onerror=alert(1)> ');
});

test('a stream yields text deltas, applies vetted actions, and drops forged ones', async () => {
  const chunks = [
    ': ready\n\n',
    sse('text', { text: 'Two projects here are agent systems. ' }),
    sse('action', { type: 'go', target: 'work' }),
    // Forged: unknown verb, unknown anchor, unknown project, off-site open.
    sse('action', { type: 'exec', target: 'work' }),
    sse('action', { type: 'go', target: 'admin' }),
    sse('action', { type: 'lit', target: 'not-a-project' }),
    sse('action', { type: 'open', target: '//evil.example' }),
    sse('text', { text: 'evalgate is one of them.' }),
    sse('action', { type: 'lit', target: 'evalgate' }),
    sse('done', { reason: 'end_turn' }),
  ];

  await withStub(chunks, async (endpoint, seen) => {
    const text: string[] = [];
    const actions: unknown[] = [];
    const result = await askDm({
      endpoint,
      manifest: MANIFEST,
      messages: [{ role: 'user', content: 'What has Dylan built with AI agents?' }],
      onText: (delta: string) => text.push(delta),
      onAction: (action: unknown) => actions.push(action),
    });

    assert.equal(result.reason, 'end_turn');
    assert.equal(text.join(''), 'Two projects here are agent systems. evalgate is one of them.');
    assert.deepEqual(actions, [
      { type: 'go', target: 'work' },
      { type: 'lit', target: 'evalgate' },
    ]);
    assert.deepEqual(seen.body, {
      messages: [{ role: 'user', content: 'What has Dylan built with AI agents?' }],
    });
  });
});

test('a refusal ends the turn honestly instead of inventing an answer', async () => {
  await withStub(
    [sse('text', { text: "That isn't something this site publishes." }), sse('done', { reason: 'refusal' })],
    async (endpoint) => {
      const result = await askDm({
        endpoint,
        manifest: MANIFEST,
        messages: [{ role: 'user', content: "What's his salary?" }],
      });
      assert.equal(result.reason, 'refusal');
    },
  );
});

test('a signed answer round-trips: the token comes back on the assistant turn', async () => {
  // Two deltas with whitespace at the seam, so "byte-identical" is actually
  // being tested rather than assumed.
  const chunks = [
    sse('text', { text: 'Two projects here are agent systems.\n\n' }),
    sse('text', { text: '  evalgate is one.  ' }),
    sse('done', { reason: 'end_turn', truncated: false, token: 'sig-first-turn' }),
  ];
  const answer = 'Two projects here are agent systems.\n\n  evalgate is one.  ';

  await withStub(chunks, async (endpoint, seen) => {
    const first = await askDm({
      endpoint,
      manifest: MANIFEST,
      messages: [{ role: 'user', content: 'What has Dylan built with AI agents?' }],
    });

    assert.equal(first.reason, 'end_turn');
    assert.equal(first.truncated, false);
    assert.equal(first.token, 'sig-first-turn');
    // The signed bytes are the deltas exactly as they arrived — joined in
    // order, nothing trimmed, nothing re-rendered. Anything else fails the
    // service's HMAC check and takes the whole next request down with it.
    assert.equal(first.content, answer);

    // The follow-up carries DM's turn *and* its signature.
    await askDm({
      endpoint,
      manifest: MANIFEST,
      messages: [
        { role: 'user', content: 'What has Dylan built with AI agents?' },
        { role: 'assistant', content: first.content, token: first.token },
        { role: 'user', content: 'Which one shipped first?' },
      ],
    });

    assert.deepEqual(seen.bodies[1], {
      messages: [
        { role: 'user', content: 'What has Dylan built with AI agents?' },
        { role: 'assistant', content: answer, token: 'sig-first-turn' },
        { role: 'user', content: 'Which one shipped first?' },
      ],
    });
  });
});

test('an assistant turn with no token is dropped rather than sent unsigned', async () => {
  await withStub([sse('done', { reason: 'end_turn', token: 'sig' })], async (endpoint, seen) => {
    // An unsigned assistant turn is refused by the service, and the refusal
    // rejects the *whole* request. Dropping the turn loses context; sending it
    // loses the conversation.
    // The last two are off-contract on purpose — the transport is the boundary,
    // so what matters is what it does with a turn the type system never saw.
    const forgeries: unknown[] = [
      { role: 'assistant', content: 'DM never said this' },
      { role: 'assistant', content: 'DM never said this', token: '' },
      { role: 'assistant', content: 'DM never said this', token: null },
      { role: 'assistant', content: 'DM never said this', token: 123 },
    ];
    for (const forged of forgeries) {
      await askDm({
        endpoint,
        manifest: MANIFEST,
        messages: [
          { role: 'user', content: 'q1' },
          forged,
          { role: 'user', content: 'q2' },
        ] as never,
      });
      assert.deepEqual(seen.body, {
        messages: [
          { role: 'user', content: 'q1' },
          { role: 'user', content: 'q2' },
        ],
      });
    }

    // And a token never rides on a visitor turn: the service refuses that too,
    // rather than ignoring it.
    await askDm({
      endpoint,
      manifest: MANIFEST,
      messages: [{ role: 'user', content: 'q1', token: 'sig-first-turn' }],
    });
    assert.deepEqual(seen.body, { messages: [{ role: 'user', content: 'q1' }] });
  });
});

test('a done event without a token yields no token to echo', async () => {
  await withStub([sse('text', { text: 'hi' }), sse('done', { reason: 'end_turn' })], async (endpoint) => {
    const result = await askDm({
      endpoint,
      manifest: MANIFEST,
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.equal(result.token, null);
    assert.equal(result.content, 'hi');
  });
});

test('a truncated answer is reported as truncated, not as a finished one', async () => {
  // The reason is carried whole. Collapsing `max_tokens` to `end_turn` is how a
  // half-finished answer gets presented as the whole reply.
  for (const [reason, flag] of [
    ['max_tokens', true],
    ['max_turns', true],
    // Even if the explicit flag went missing, the reason still says cut off.
    ['max_tokens', undefined],
  ] as const) {
    await withStub(
      [
        sse('text', { text: 'The first half of an answer that ' }),
        sse('done', { reason, ...(flag === undefined ? {} : { truncated: flag }), token: 'sig' }),
      ],
      async (endpoint) => {
        const result = await askDm({
          endpoint,
          manifest: MANIFEST,
          messages: [{ role: 'user', content: 'Tell me everything.' }],
        });
        assert.equal(result.reason, reason);
        assert.equal(result.truncated, true);
        // A cut-off turn is still DM's own signed words, so it stays replayable.
        assert.equal(result.token, 'sig');
      },
    );
  }

  // A complete answer is not captioned as cut off.
  await withStub(
    [sse('text', { text: 'All of it.' }), sse('done', { reason: 'end_turn', truncated: false })],
    async (endpoint) => {
      const result = await askDm({
        endpoint,
        manifest: MANIFEST,
        messages: [{ role: 'user', content: 'hi' }],
      });
      assert.equal(result.truncated, false);
    },
  );
});

test('an error event surfaces a sanitized single-line message', async () => {
  await withStub([sse('error', { message: 'upstream\n\ttimed   out' })], async (endpoint) => {
    await assert.rejects(
      askDm({ endpoint, manifest: MANIFEST, messages: [{ role: 'user', content: 'hi' }] }),
      (error: Error) => {
        assert.equal(error.name, 'DmError');
        assert.equal(error.message, 'upstream timed out');
        return true;
      },
    );
  });
});

test("a 400 surfaces the service's own message and carries the status", async () => {
  // The signed-history check answers 400 with a JSON body saying why. That
  // line reaches the visitor (sanitized), and the status reaches the card so a
  // rejected restored transcript can offer a fresh start instead of a dead end.
  await withStub(
    [JSON.stringify({ message: 'That conversation could not\nbe   verified.' })],
    async (endpoint) => {
      await assert.rejects(
        askDm({
          endpoint,
          manifest: MANIFEST,
          messages: [
            { role: 'user', content: 'q1' },
            { role: 'assistant', content: 'a1', token: 'sig-stale' },
            { role: 'user', content: 'q2' },
          ],
        }),
        (error: Error & { status?: number }) => {
          assert.equal(error.name, 'DmError');
          assert.equal(error.message, 'That conversation could not be verified.');
          assert.equal(error.status, 400);
          return true;
        },
      );
    },
    { status: 400 },
  );

  // A non-JSON error body still fails with the honest status line.
  await withStub(
    ['<html>Bad Gateway</html>'],
    async (endpoint) => {
      await assert.rejects(
        askDm({ endpoint, manifest: MANIFEST, messages: [{ role: 'user', content: 'hi' }] }),
        (error: Error & { status?: number }) => {
          assert.match(error.message, /error \(400\)/);
          assert.equal(error.status, 400);
          return true;
        },
      );
    },
    { status: 400 },
  );
});

test('a non-2xx response fails closed rather than rendering nothing', async () => {
  await withStub(
    [sse('text', { text: 'ignored' })],
    async (endpoint) => {
      await assert.rejects(
        askDm({ endpoint, manifest: MANIFEST, messages: [{ role: 'user', content: 'hi' }] }),
        /error \(503\)/,
      );
    },
    { status: 503 },
  );
});

test('aborting mid-flight cancels the request', async () => {
  await withStub([sse('text', { text: 'partial' })], async (endpoint) => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      askDm({
        endpoint,
        manifest: MANIFEST,
        signal: controller.signal,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );
  });
});

test('a service that opens the stream and then stalls does not hold the card', async () => {
  await withStalledStub([': ready\n\n', sse('text', { text: 'thinking' })], async (endpoint) => {
    const text: string[] = [];
    await assert.rejects(
      askDm({
        endpoint,
        manifest: MANIFEST,
        messages: [{ role: 'user', content: 'hi' }],
        stallMs: 80,
        deadlineMs: 10_000,
        onText: (delta: string) => text.push(delta),
      }),
      (error: Error) => {
        assert.equal(error.name, 'DmError');
        assert.match(error.message, /stopped responding/);
        return true;
      },
    );
    // The partial answer still reached the caller; only the turn ended.
    assert.equal(text.join(''), 'thinking');
  });
});

test('a stream kept alive forever still ends on the overall deadline', async () => {
  await withStalledStub(
    [sse('text', { text: 'thinking' })],
    async (endpoint) => {
      await assert.rejects(
        askDm({
          endpoint,
          manifest: MANIFEST,
          messages: [{ role: 'user', content: 'hi' }],
          // Comments keep resetting the stall timer, so only the ceiling stops it.
          stallMs: 5_000,
          deadlineMs: 150,
        }),
        (error: Error) => {
          assert.equal(error.name, 'DmError');
          // The ceiling and the stall timer are different failures and must not
          // read alike: this service is answering, just for too long. Telling
          // the visitor it stopped responding would be false.
          assert.match(error.message, /ran past the time limit/);
          assert.doesNotMatch(error.message, /stopped responding/);
          return true;
        },
      );
    },
    { keepAliveMs: 20 },
  );
});

test('the endpoint is only accepted as an absolute https URL, loopback aside', () => {
  assert.equal(resolveDmEndpoint('https://dm.example.com/'), 'https://dm.example.com');
  // Local development against a dev service is the only cleartext exemption.
  assert.equal(resolveDmEndpoint('  http://localhost:8787  '), 'http://localhost:8787');
  assert.equal(resolveDmEndpoint('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
  // A visitor's question never goes over the wire in the clear.
  assert.equal(resolveDmEndpoint('http://dm.example.com'), null);
  assert.equal(resolveDmEndpoint('http://localhost.evil.example'), null);
  assert.equal(resolveDmEndpoint('javascript:alert(1)'), null);
  assert.equal(resolveDmEndpoint('/api/dm'), null);
  assert.equal(resolveDmEndpoint(''), null);
  assert.equal(resolveDmEndpoint(undefined), null);
});
