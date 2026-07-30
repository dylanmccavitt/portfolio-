/**
 * DM transport — the browser half of the rebuilt portfolio agent.
 *
 * The site is static; DM lives in a separate service. This module is the only
 * thing that talks to it: it POSTs the conversation to `{endpoint}/chat`, reads
 * the `text/event-stream` response with a plain `fetch` + ReadableStream reader
 * (no SSE dependency), and hands the caller text deltas and page actions.
 *
 * THE CLIENT IS THE SECURITY BOUNDARY. The service validates its own output,
 * but nothing it sends is trusted here:
 *   - an action is dropped unless its `type` is one of the four verbs below AND
 *     (except for `litContact`, which takes no target) its `target` appears in
 *     the page-action manifest's `anchors` / `projectIds`;
 *   - answer text is only ever rendered as text — citation chips are matched
 *     deterministically against the Work cards' own project names here, so the
 *     model can never emit markup or a link target of its own;
 *   - nothing is eval'd, and no HTML is ever constructed from a response.
 *
 * The manifest is a build-time prop, not a fetch. The browser is given the
 * section anchors and the project ids — both already visible in the homepage
 * HTML — and nothing else. The grounding corpus is never published and never
 * reaches this code.
 *
 * Deployment note: `vercel.json`'s CSP pins `connect-src 'self'`. The DM service
 * origin has to be added there before a browser can reach it in production.
 */

/** The complete action vocabulary. Kept here as a client-side constant rather
    than read from the response, so a compromised service cannot widen it. */
export const DM_ACTION_TYPES = ['go', 'lit', 'open', 'litContact'];

const ACTION_TYPES = new Set(DM_ACTION_TYPES);

/** Every end reason the service emits. Anything else is treated as `end_turn`,
    which is the only reason that means "a complete answer". */
const DONE_REASONS = new Set(['end_turn', 'refusal', 'max_tokens', 'max_turns', 'error']);

/** Reasons that mean the answer stops mid-thought. The service also sends an
    explicit `truncated` flag; both are honoured, so a cut-off answer is never
    presented as a whole one because one of the two was missing. */
const TRUNCATING_REASONS = new Set(['max_tokens', 'max_turns']);

/** Actions that address a Work card by project id. */
const PROJECT_ACTIONS = new Set(['lit', 'open']);

/** Hard ceiling on a single answer, so a runaway stream cannot grow the DOM
    without bound. Roughly ten times the longest sensible reply. */
const MAX_ANSWER_CHARS = 8000;

/** Hard ceiling on the signed transcript itself. The display cap above clips
    what reaches the DOM, but the signature is over the whole answer, so every
    delta is also kept verbatim — and a hostile service kept alive under the
    deadline could grow that copy without bound, then ride it into React state
    and the next request body. Well past this the turn is not an answer at all,
    so it fails instead: far above the service's own output budget, far below
    anything that hurts. */
const MAX_STREAM_CHARS = 64_000;

/** Full successful-response wire ceiling. Text is bounded separately above,
    but action-only, comment-only, and malformed streams still consume bytes. */
export const DM_MAX_RESPONSE_BYTES = 256_000;

/** Maximum parser state retained between dispatches. This covers an
    unterminated line and the event/data fields accumulated before a blank
    line, so neither shape can park an unbounded string in memory. */
export const DM_MAX_SSE_PENDING_CHARS = 64_000;

/** Error bodies need only contain one short diagnostic. They are read through
    a stream up to this ceiling rather than buffered wholesale by Response. */
export const DM_MAX_ERROR_BODY_BYTES = 16_000;

/** One answer may drive only a small, reviewable sequence of page effects.
    The fifth action fails the turn before it can create another DOM timer. */
export const DM_MAX_ACTIONS_PER_TURN = 4;

/** Longest error message we will surface, before truncation. */
const MAX_ERROR_CHARS = 200;

/** Deadlines. The stall timer is the one that catches a broken service: any
    chunk — a keepalive comment included — is proof of life, so a stream that
    goes quiet for this long is dead and must not hold the card busy forever.

    The overall ceiling is a runaway guard, not a latency budget. A thinking
    model can legitimately spend minutes on one answer, and killing a stream
    that is still arriving would be a bug wearing an error message, so the
    ceiling sits far above any honest turn. Both are overridable per call so the
    tests can exercise them without waiting on the real values. */
export const DM_DEADLINE_MS = 600_000;
export const DM_STALL_MS = 20_000;

/** Thrown for anything the user should see a short honest line about.
    `status` is the HTTP status when the service answered with one instead of a
    stream — the card uses 400 to tell "your restored history failed the
    signature check" apart from a service that is merely down. */
export class DmError extends Error {
  constructor(message, { refusal = false, status = null } = {}) {
    super(message);
    this.name = 'DmError';
    this.refusal = refusal;
    this.status = status;
  }
}

/** Loopback names, the only hosts allowed to be reached over plain http. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Normalises the configured endpoint. Returns null for anything that is not an
 * absolute https URL, so a mistyped env var degrades to "no service" rather
 * than to a surprising request. Plain http is refused — a visitor's question is
 * conversation content and never goes on the wire in the clear — except to a
 * loopback host, so local development against a dev service still works.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function resolveDmEndpoint(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol === 'https:') return trimmed;
    if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return trimmed;
    return null;
  } catch {
    return null;
  }
}

/**
 * Incremental SSE parser. Lines are consumed as they complete (handling both
 * `\n` and `\r\n`); a blank line dispatches the accumulated event. Comment
 * lines (`: keepalive`) are ignored.
 * @returns {{ push: (chunk: string) => Array<{ event: string, data: string }>,
 *             flush: () => Array<{ event: string, data: string }> }}
 */
export function createSseParser() {
  let buffer = '';
  let eventName = '';
  let dataLines = [];
  let dataChars = 0;

  const overflow = () => {
    throw new DmError('DM ran into a problem answering that.');
  };

  const pendingChars = () => buffer.length + eventName.length + dataChars;

  const checkPending = () => {
    if (pendingChars() > DM_MAX_SSE_PENDING_CHARS) overflow();
  };

  const take = () => {
    if (dataLines.length === 0 && !eventName) return null;
    const event = { event: eventName || 'message', data: dataLines.join('\n') };
    eventName = '';
    dataLines = [];
    dataChars = 0;
    return event;
  };

  const line = (raw, out) => {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (text === '') {
      const event = take();
      if (event) out.push(event);
      return;
    }
    if (text.startsWith(':')) return;
    const colon = text.indexOf(':');
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? '' : text.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') {
      eventName = value;
      checkPending();
    } else if (field === 'data') {
      dataLines.push(value);
      dataChars += value.length + (dataLines.length > 1 ? 1 : 0);
      checkPending();
    }
  };

  const push = (chunk) => {
    const out = [];
    let offset = 0;
    let index = chunk.indexOf('\n');
    while (index !== -1) {
      const tail = chunk.slice(offset, index);
      if (buffer.length + tail.length + eventName.length + dataChars > DM_MAX_SSE_PENDING_CHARS) {
        overflow();
      }
      const completedLine = buffer + tail;
      buffer = '';
      line(completedLine, out);
      offset = index + 1;
      index = chunk.indexOf('\n', offset);
    }
    const tail = chunk.slice(offset);
    if (tail) {
      if (buffer.length + tail.length + eventName.length + dataChars > DM_MAX_SSE_PENDING_CHARS) {
        overflow();
      }
      buffer += tail;
    }
    return out;
  };

  return {
    push,
    /** Dispatch a trailing event that arrived without its blank-line terminator. */
    flush() {
      const out = [];
      if (buffer) {
        line(buffer, out);
        buffer = '';
      }
      const event = take();
      if (event) out.push(event);
      return out;
    },
  };
}

/**
 * THE ALLOWLIST. Returns a normalised action, or null if it must be dropped.
 *
 * Rule: `type` must be one of `go` | `lit` | `open` | `litContact`. `litContact`
 * carries no target. Every other type must carry a non-empty string `target`
 * that is present in `manifest.anchors` (for `go`) or `manifest.projectIds`
 * (for `lit` and `open`). Extra fields are discarded.
 *
 * No manifest means no allowlist, so nothing targeted survives — the failure
 * mode is a card that scrolls nowhere, never one that follows the service.
 *
 * @param {unknown} raw
 * @param {{ anchors?: unknown, projectIds?: unknown } | null} manifest
 */
export function sanitizeAction(raw, manifest) {
  if (!raw || typeof raw !== 'object') return null;
  const { type, target } = /** @type {{ type?: unknown, target?: unknown }} */ (raw);
  if (typeof type !== 'string' || !ACTION_TYPES.has(type)) return null;
  if (type === 'litContact') return { type, target: undefined };
  if (typeof target !== 'string' || target === '') return null;

  const page = manifest && typeof manifest === 'object' ? manifest : null;
  const allowed = PROJECT_ACTIONS.has(type) ? page?.projectIds : page?.anchors;
  if (!Array.isArray(allowed) || !allowed.includes(target)) return null;
  return { type, target };
}

/** Collapses whitespace and clips a service-supplied message to a safe length. */
function sanitizeMessage(raw, fallback) {
  if (typeof raw !== 'string') return fallback;
  // Control characters are stripped before the message can reach the DOM.
  // eslint-disable-next-line no-control-regex
  const clean = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return fallback;
  return clean.length > MAX_ERROR_CHARS ? `${clean.slice(0, MAX_ERROR_CHARS)}…` : clean;
}

function parseData(raw) {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/** Reads at most the small diagnostic allowance from a non-2xx response.
    Returns null for malformed or oversized bodies; the caller then uses the
    status-only message. */
async function readErrorDetail(response) {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let raw = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        raw += decoder.decode();
        break;
      }
      received += value.byteLength;
      if (received > DM_MAX_ERROR_BODY_BYTES) return null;
      raw += decoder.decode(value, { stream: true });
    }
  } catch {
    return null;
  } finally {
    reader.cancel().catch(() => {});
  }
  const body = parseData(raw);
  return typeof body?.message === 'string' ? sanitizeMessage(body.message, null) : null;
}

/**
 * Streams one answer. Resolves with the turn's end reason, the signature over
 * what it streamed, and the exact text that was signed; rejects with a
 * `DmError` (or the fetch's own AbortError) on failure.
 *
 * TRANSCRIPT CONTINUITY. The service is stateless, so the whole conversation is
 * POSTed every turn — but an `assistant` turn in that body is a claim about what
 * DM previously said, and the service will not take an anonymous caller's word
 * for it. Every answer it streams is HMAC-signed, and an assistant turn without
 * a matching signature is refused outright. So the caller must keep the `token`
 * this returns next to the answer, and hand both back on the following request.
 *
 * `content` is the signed text: the deltas exactly as they arrived, joined in
 * order and never re-rendered, re-trimmed, or clipped. It is what the caller
 * must echo — the display copy may differ (it is clipped at `MAX_ANSWER_CHARS`)
 * and echoing that instead would fail verification.
 *
 * @param {{
 *   endpoint: string,
 *   messages: Array<{ role: 'user' | 'assistant', content: string, token?: string | null }>,
 *   manifest: { anchors?: unknown, projectIds?: unknown } | null,
 *   signal?: AbortSignal,
 *   deadlineMs?: number,
 *   stallMs?: number,
 *   onText?: (delta: string) => void,
 *   onAction?: (action: { type: string, target?: string }) => void,
 * }} options
 * @returns {Promise<{
 *   reason: 'end_turn' | 'refusal' | 'max_tokens' | 'max_turns' | 'error',
 *   truncated: boolean,
 *   token: string | null,
 *   content: string,
 * }>}
 */
export async function askDm({
  endpoint,
  messages,
  manifest,
  signal,
  deadlineMs = DM_DEADLINE_MS,
  stallMs = DM_STALL_MS,
  onText,
  onAction,
}) {
  const base = resolveDmEndpoint(endpoint);
  if (!base) throw new DmError('DM is not configured.');

  // One controller for the whole turn: the caller's abort, the overall
  // deadline, and the stall timeout all cancel the same request.
  const control = new AbortController();
  // Which timer fired, so the line the visitor reads describes what actually
  // happened: a silent service is not the same failure as an answer that ran
  // past the ceiling while it was still arriving.
  let expiry = null;
  const expire = (cause) => () => {
    if (expiry === null) expiry = cause;
    control.abort();
  };
  const relay = () => control.abort();
  if (signal) {
    if (signal.aborted) control.abort();
    else signal.addEventListener('abort', relay, { once: true });
  }
  const deadline = deadlineMs > 0 ? setTimeout(expire('deadline'), deadlineMs) : null;
  let stall = null;
  const restartStall = () => {
    if (stall !== null) clearTimeout(stall);
    stall = stallMs > 0 ? setTimeout(expire('stall'), stallMs) : null;
  };
  const clearTimers = () => {
    if (deadline !== null) clearTimeout(deadline);
    if (stall !== null) clearTimeout(stall);
    signal?.removeEventListener('abort', relay);
  };

  try {
    return await streamDm({
      base,
      messages,
      manifest,
      control,
      restartStall,
      expiry: () => expiry,
      onText,
      onAction,
    });
  } finally {
    clearTimers();
  }
}

/**
 * Builds the `messages` array that goes on the wire.
 *
 * Two rules, both the service's, and both enforced here so a mistake in the
 * card cannot cost a whole conversation:
 *
 *   - an `assistant` turn carries its `token`, the signature the service issued
 *     with that answer. Without one the service refuses the *entire* request, so
 *     an unsigned assistant turn is dropped rather than sent — losing a turn of
 *     context beats losing the conversation;
 *   - a `user` turn carries no token. A token there is meaningless and the
 *     service refuses it rather than ignoring it.
 *
 * The caller is expected to drop unsigned turns in pairs (question and answer
 * together) so the conversation still alternates; this is the last-resort net,
 * not the plan.
 */
function wireMessages(messages) {
  const out = [];
  for (const message of messages) {
    const role = message?.role === 'assistant' ? 'assistant' : 'user';
    const content = String(message?.content ?? '');
    if (role === 'user') {
      out.push({ role, content });
      continue;
    }
    const token = message?.token;
    if (typeof token !== 'string' || token === '') continue;
    out.push({ role, content, token });
  }
  return out;
}

/** The turn itself, once the deadlines around it are armed. */
async function streamDm({ base, messages, manifest, control, restartStall, expiry, onText, onAction }) {
  // Named for the timer that fired: the stall timer means nothing arrived for
  // twenty seconds, the ceiling means the answer was still coming and we stopped
  // waiting. Claiming the second is the first would be a lie to the visitor.
  const timedOut = () =>
    new DmError(
      expiry() === 'deadline'
        ? 'That answer ran past the time limit for one question.'
        : "DM's service stopped responding.",
    );

  let response;
  try {
    restartStall();
    response = await fetch(`${base}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ messages: wireMessages(messages) }),
      signal: control.signal,
    });
  } catch (error) {
    if (expiry()) throw timedOut();
    if (error && error.name === 'AbortError') throw error;
    throw new DmError("DM's service could not be reached.");
  }

  if (!response.ok) {
    // A refused request usually says why — "could not be verified", most
    // importantly — and that line beats a bare status code. Still untrusted:
    // read only to a hard ceiling, parsed defensively, sanitized, and never
    // rendered as anything but text.
    const detail = await readErrorDetail(response);
    throw new DmError(detail ?? `DM's service answered with an error (${response.status}).`, {
      status: response.status,
    });
  }
  if (!response.body) {
    throw new DmError(`DM's service answered with an error (${response.status}).`, {
      status: response.status,
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  let reason = 'end_turn';
  let truncated = false;
  let token = null;
  let finished = false;
  let failure = null;
  let written = 0;
  let received = 0;
  let receivedBytes = 0;
  let actionCount = 0;
  // Every delta, verbatim and in order — the bytes the service signs. Kept
  // apart from what reaches `onText`, which is clipped for the DOM's sake: the
  // signature is over the whole answer, so a clipped copy would not verify.
  const streamed = [];

  const handle = (record) => {
    if (finished) return;
    switch (record.event) {
      case 'text': {
        const data = parseData(record.data);
        if (!data || typeof data.text !== 'string' || !data.text) return;
        received += data.text.length;
        if (received > MAX_STREAM_CHARS) {
          failure = new DmError('DM ran into a problem answering that.');
          finished = true;
          return;
        }
        streamed.push(data.text);
        const room = MAX_ANSWER_CHARS - written;
        if (room <= 0) return;
        const delta = data.text.length > room ? data.text.slice(0, room) : data.text;
        written += delta.length;
        onText?.(delta);
        return;
      }
      case 'action': {
        const action = sanitizeAction(parseData(record.data), manifest);
        if (!action) return;
        actionCount += 1;
        if (actionCount > DM_MAX_ACTIONS_PER_TURN) {
          failure = new DmError('DM ran into a problem answering that.');
          finished = true;
          return;
        }
        onAction?.(action);
        return;
      }
      case 'done': {
        const data = parseData(record.data);
        // The reason is kept whole rather than collapsed to `end_turn`: only
        // `end_turn` means a complete answer, and flattening the rest is how a
        // half-finished reply gets presented as the whole thing.
        reason = DONE_REASONS.has(data?.reason) ? data.reason : 'end_turn';
        truncated = data?.truncated === true || TRUNCATING_REASONS.has(reason);
        token = typeof data?.token === 'string' && data.token !== '' ? data.token : null;
        // `error` arrives after an `error` event, which has already set
        // `failure`. If it ever arrives alone, the turn still did not finish.
        if (reason === 'error' && !failure) {
          failure = new DmError('DM ran into a problem answering that.');
        }
        finished = true;
        return;
      }
      case 'error': {
        const data = parseData(record.data);
        failure = new DmError(sanitizeMessage(data?.message, 'DM ran into a problem answering that.'));
        finished = true;
        return;
      }
      default:
        // Unknown event names are ignored, not guessed at.
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      // Every chunk — keepalive comments included — is proof of life.
      restartStall();
      if (done) {
        const tail = decoder.decode();
        if (tail) parser.push(tail).forEach(handle);
        if (!finished) parser.flush().forEach(handle);
        break;
      }
      receivedBytes += value.byteLength;
      if (receivedBytes > DM_MAX_RESPONSE_BYTES) {
        failure = new DmError('DM ran into a problem answering that.');
        finished = true;
        break;
      }
      parser.push(decoder.decode(value, { stream: true })).forEach(handle);
      if (finished) break;
    }
  } catch (error) {
    if (expiry()) throw timedOut();
    throw error;
  } finally {
    // Releases the socket when the caller aborts or we stop early.
    reader.cancel().catch(() => {});
  }

  if (failure) throw failure;
  // A stream that closed without a terminal event never finished the turn.
  // `reason` still holds its `end_turn` default here, and returning would
  // present whatever fraction arrived as a whole, signed answer — so a clean
  // EOF before `done` is a transport failure, not a completion.
  if (!finished) throw new DmError("DM's service dropped the connection mid-answer.");
  return { reason, truncated, token, content: streamed.join('') };
}

const WORD = /[a-z0-9]/i;

function isBoundary(text, index) {
  if (index < 0 || index >= text.length) return true;
  return !WORD.test(text[index]);
}

/**
 * Deterministic citation linkifier. Called only once a message has finished
 * streaming: the answer text is scanned for the Work cards' own project titles,
 * ids, and slugs (longest first, whole-token matches only) and split into plain
 * and citation segments. The model never supplies a link — it only writes prose
 * that happens to name a project the site already publishes.
 *
 * @param {string} text
 * @param {Array<{ id: string, title?: string, slug?: string }>} projects
 * @returns {Array<{ text: string, projectId?: string }>}
 */
export function linkifyCitations(text, projects) {
  if (!text) return [];
  const list = Array.isArray(projects) ? projects : [];
  const needles = [];
  for (const project of list) {
    if (!project || typeof project.id !== 'string' || !project.id) continue;
    for (const candidate of [project.title, project.id, project.slug]) {
      if (typeof candidate === 'string' && candidate.length > 2) {
        needles.push({ value: candidate.toLowerCase(), length: candidate.length, id: project.id });
      }
    }
  }
  if (needles.length === 0) return [{ text }];
  needles.sort((a, b) => b.length - a.length);

  const lower = text.toLowerCase();
  const segments = [];
  let plain = '';
  let index = 0;

  while (index < text.length) {
    let hit = null;
    for (const needle of needles) {
      if (
        lower.startsWith(needle.value, index) &&
        isBoundary(text, index - 1) &&
        isBoundary(text, index + needle.length)
      ) {
        hit = needle;
        break;
      }
    }
    if (hit) {
      if (plain) {
        segments.push({ text: plain });
        plain = '';
      }
      segments.push({ text: text.slice(index, index + hit.length), projectId: hit.id });
      index += hit.length;
    } else {
      plain += text[index];
      index += 1;
    }
  }
  if (plain) segments.push({ text: plain });
  return segments;
}
