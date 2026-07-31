/**
 * DM session channel — the conversation's life outside one page.
 *
 * The card renders on the homepage island and on the Paper project pages, and
 * an `open` action navigates between them. The conversation itself lives in
 * component state, so this module is what carries it across that navigation:
 * sessionStorage — per-tab, gone when the tab closes — holding the settled
 * turns, whether the card is open, and any page actions a turn earned on a page
 * that could not perform them.
 *
 * SESSIONSTORAGE IS UNTRUSTED INPUT. It is same-origin-writable, so everything
 * read back gets the same posture as a service response: parsed defensively,
 * shape-checked field by field, rebuilt onto fresh objects (foreign fields
 * never survive), capped in count and size, and — for pending actions — passed
 * through the very same `sanitizeAction` allowlist at execution time, not just
 * at receipt. Anything malformed degrades to "no session", never to a guess.
 *
 * What a stored assistant turn keeps is exactly what a live one holds: the
 * display text, the byte-exact `content` the service signed, and the `token`
 * over it. A restored conversation therefore replays like a live one — the
 * service re-verifies the signature on the next question.
 */

import { sanitizeAction } from './dm-client.js';

export const DM_SESSION_KEY = 'frost-dm-session';
export const DM_PENDING_KEY = 'frost-dm-pending';

/** Mirror of the service's own history ceiling: it refuses longer requests, so
    restoring more than it will accept would strand the visitor on question one. */
export const DM_MAX_MESSAGES = 24;

/** A single answer earns at most this many carried page actions. */
export const DM_MAX_PENDING = 4;

/** Raw-payload ceilings. A stored blob past these is discarded whole, and the
    writer sheds oldest pairs rather than ever writing past the session cap. */
export const DM_MAX_PAYLOAD_CHARS = 400_000;
const MAX_PENDING_PAYLOAD_CHARS = 4_000;

/** Highlight durations for the driven page states, shared by the card's live
    drive and the homepage's carried-action pass. */
export const DM_LIT_MS = 3600;
export const DM_LIT_CONTACT_MS = 3200;

/** Per-field ceilings. Display text matches the transport's DOM clip; the
    signed `content` may legitimately run past the clip but not without bound —
    and it can never be truncated (a clipped echo fails verification), so an
    oversized one drops its whole pair instead. */
const MAX_TEXT_CHARS = 8000;
const MAX_CONTENT_CHARS = 64_000;
const MAX_TOKEN_CHARS = 4096;
const MAX_NOTE_CHARS = 300;

/** Only settled turns persist. A streaming answer has no token yet and its
    text is unfinished; navigating away mid-stream drops that pair. */
const SETTLED_STATES = new Set(['done', 'refused', 'failed']);

/**
 * @typedef {{ role: 'user' | 'dm', text: string, state: string, token?: string,
 *   content?: string, truncated?: boolean, note?: string, reset?: boolean }} DmStoredMessage
 */

function defaultStorage() {
  // Storage access itself can throw (privacy modes); no storage means no
  // session, never an exception reaching the card.
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * One message, rebuilt from untrusted input onto a fresh object. Returns null
 * for anything off-schema — the caller decides whether that voids a pair or
 * the whole payload.
 * @param {unknown} raw
 * @returns {DmStoredMessage | null}
 */
function cleanMessage(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { role, text, state, token, content, truncated, note, reset } =
    /** @type {Record<string, unknown>} */ (raw);
  if (typeof text !== 'string' || text.length > MAX_TEXT_CHARS) return null;
  if (role === 'user') return { role, text, state: 'done' };
  if (role !== 'dm') return null;
  if (typeof state !== 'string' || !SETTLED_STATES.has(state)) return null;

  const message = { role, text, state };
  // Token and content only travel together and only within bounds: one without
  // the other cannot be echoed, and an oversized echo cannot be clipped.
  if (
    typeof token === 'string' &&
    token !== '' &&
    token.length <= MAX_TOKEN_CHARS &&
    typeof content === 'string' &&
    content !== '' &&
    content.length <= MAX_CONTENT_CHARS
  ) {
    message.token = token;
    message.content = content;
  }
  if (truncated === true) message.truncated = true;
  if (typeof note === 'string' && note !== '') message.note = note.slice(0, MAX_NOTE_CHARS);
  if (reset === true) message.reset = true;
  return message;
}

/**
 * The stored conversation is strictly a run of question/answer pairs. The
 * first entry that breaks the pattern ends trust in everything after it, and
 * the newest pairs win when the count cap bites.
 * @param {unknown} raw
 */
function cleanStoredMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const pairs = [];
  for (let index = 0; index + 1 < raw.length; index += 2) {
    const question = cleanMessage(raw[index]);
    const answer = cleanMessage(raw[index + 1]);
    if (!question || question.role !== 'user' || !answer || answer.role !== 'dm') break;
    pairs.push([question, answer]);
  }
  return pairs.slice(-(DM_MAX_MESSAGES / 2)).flat();
}

/**
 * The persistable slice of a live message list: settled pairs only, each
 * rebuilt through the same schema the reader enforces, so what goes in is
 * exactly what can come back out. Unsettled or unpaired turns fall away.
 * @param {unknown} messages
 */
function settledPairs(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const pairs = [];
  for (let index = 0; index < list.length; index += 1) {
    const question = list[index];
    if (!question || question.role !== 'user') continue;
    const candidate = list[index + 1];
    if (!candidate || candidate.role === 'user') continue;
    index += 1;
    const q = cleanMessage(question);
    const a = cleanMessage(candidate);
    if (!q || q.role !== 'user' || !a) continue;
    pairs.push([q, a]);
  }
  return pairs;
}

/**
 * @param {{ getItem: Function, setItem: Function, removeItem: Function } | null} [storage]
 * @returns {{ open: boolean, messages: DmStoredMessage[] }}
 */
export function readDmSession(storage = defaultStorage()) {
  const empty = { open: false, messages: [] };
  if (!storage) return empty;
  let raw;
  try {
    raw = storage.getItem(DM_SESSION_KEY);
  } catch {
    return empty;
  }
  if (typeof raw !== 'string' || raw === '' || raw.length > DM_MAX_PAYLOAD_CHARS) return empty;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;
  const { open, messages } = /** @type {Record<string, unknown>} */ (parsed);
  return { open: open === true, messages: cleanStoredMessages(messages) };
}

/**
 * @param {{ open?: boolean, messages?: unknown }} [state]
 * @param {{ getItem: Function, setItem: Function, removeItem: Function } | null} [storage]
 */
export function writeDmSession({ open = false, messages = [] } = {}, storage = defaultStorage()) {
  if (!storage) return;
  const pairs = settledPairs(messages).slice(-(DM_MAX_MESSAGES / 2));
  try {
    let raw = JSON.stringify({ open: open === true, messages: pairs.flat() });
    // Oldest pairs are shed first; the size cap never truncates a message.
    while (raw.length > DM_MAX_PAYLOAD_CHARS && pairs.length > 0) {
      pairs.shift();
      raw = JSON.stringify({ open: open === true, messages: pairs.flat() });
    }
    storage.setItem(DM_SESSION_KEY, raw);
  } catch {
    // Quota or serialization failure: the conversation stays in memory only.
  }
}

/**
 * Flips the open flag without touching the stored turns.
 * @param {boolean} open
 * @param {{ getItem: Function, setItem: Function, removeItem: Function } | null} [storage]
 */
export function writeDmOpen(open, storage = defaultStorage()) {
  if (!storage) return;
  writeDmSession({ open, messages: readDmSession(storage).messages }, storage);
}

/**
 * @param {{ getItem: Function, setItem: Function, removeItem: Function } | null} [storage]
 */
export function clearDmSession(storage = defaultStorage()) {
  if (!storage) return;
  try {
    storage.removeItem(DM_SESSION_KEY);
    storage.removeItem(DM_PENDING_KEY);
  } catch {
    // Nothing to clear is the same outcome.
  }
}

/**
 * Stashes the actions a settled turn could not perform on the current page,
 * for the homepage island to pick up after navigation. Only already-sanitized
 * actions belong here, but the stash keeps just the two known fields anyway —
 * and `takeDmActions` re-runs the allowlist regardless.
 * @param {unknown} actions
 * @param {{ getItem: Function, setItem: Function, removeItem: Function } | null} [storage]
 */
export function stashDmActions(actions, storage = defaultStorage()) {
  if (!storage || !Array.isArray(actions)) return;
  const out = [];
  for (const action of actions) {
    if (!action || typeof action !== 'object') continue;
    const { type, target } = /** @type {{ type?: unknown, target?: unknown }} */ (action);
    if (typeof type !== 'string') continue;
    const entry = { type };
    if (typeof target === 'string') entry.target = target;
    out.push(entry);
    if (out.length === DM_MAX_PENDING) break;
  }
  if (out.length === 0) return;
  try {
    storage.setItem(DM_PENDING_KEY, JSON.stringify(out));
  } catch {
    // A stash that cannot be written is simply not carried.
  }
}

/**
 * Takes (and clears) the carried actions. Every entry goes back through
 * `sanitizeAction` against the *current* page's manifest — re-validated at
 * execution time, so a target that stopped existing between stash and landing
 * is dropped exactly as it would be off the wire.
 * @param {{ anchors?: unknown, projectIds?: unknown } | null} manifest
 * @param {{ getItem: Function, setItem: Function, removeItem: Function } | null} [storage]
 * @returns {Array<{ type: string, target?: string }>}
 */
export function takeDmActions(manifest, storage = defaultStorage()) {
  if (!storage) return [];
  let raw;
  try {
    raw = storage.getItem(DM_PENDING_KEY);
    storage.removeItem(DM_PENDING_KEY);
  } catch {
    return [];
  }
  if (typeof raw !== 'string' || raw === '' || raw.length > MAX_PENDING_PAYLOAD_CHARS) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out = [];
  for (const candidate of parsed.slice(0, DM_MAX_PENDING)) {
    const action = sanitizeAction(candidate, manifest);
    if (action) out.push(action);
  }
  return out;
}

/**
 * The card's per-turn action collector. `open` is never applied mid-stream —
 * navigating would kill the stream, losing the tail of the answer and the
 * `done` token with it — so it is held until the turn settles. Other actions
 * apply immediately when the current page can perform them (`applyNow` returns
 * true). An action the current page cannot perform is dropped: answering a
 * question must never move the visitor to another page as a side effect.
 *
 * `open` is honored only when the visitor's own question expressed navigation
 * intent. The model may suggest an action, but it cannot turn an ordinary
 * comparison question into a page change.
 */
export function createTurnQueue({ allowNavigation = true } = {}) {
  let openTarget = null;
  return {
    /**
     * @param {{ type: string, target?: string }} action  already sanitized
     * @param {(action: { type: string, target?: string }) => boolean} applyNow
     */
    offer(action, applyNow) {
      if (action.type === 'open') {
        if (allowNavigation) openTarget = action.target ?? null;
        return;
      }
      applyNow(action);
    },
    /**
     * What explicit project navigation, if any, the settled turn earned. Only
     * called after `done`; an errored stream never navigates.
     */
    settle() {
      if (openTarget) return { kind: 'open', target: openTarget };
      return null;
    },
  };
}

/**
 * Navigation is an opt-in user intent, not something inferred from asking
 * about a project. Keep the vocabulary narrow and deterministic.
 * @param {unknown} question
 */
export function hasDmNavigationIntent(question) {
  return (
    typeof question === 'string' &&
    (/\b(?:take|bring)\s+me\s+to\b/i.test(question) ||
      /\b(?:go|navigate)\s+to\b/i.test(question) ||
      /\bopen\b/i.test(question))
  );
}

/**
 * Whether a failed turn means the service rejected the restored transcript
 * itself — its signed-history check answers 400 — as opposed to any other
 * failure. Only then does the card offer a fresh start: a first question has
 * no history to reject.
 * @param {unknown} error
 * @param {unknown} history  the wire history the failed request carried
 */
export function historyWasRejected(error, history) {
  const status = error && typeof error === 'object' ? /** @type {{ status?: unknown }} */ (error).status : null;
  return (
    status === 400 &&
    Array.isArray(history) &&
    history.some((turn) => turn && typeof turn === 'object' && turn.role === 'assistant')
  );
}
