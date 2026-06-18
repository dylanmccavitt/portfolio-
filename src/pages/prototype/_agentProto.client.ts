/**
 * PROTOTYPE — throwaway, do not ship.
 *
 * Tiny interaction driver shared by every chat-agent landing variant. It does
 * NOT own layout — variants render their own DOM and opt in with `data-proto-*`
 * hooks. This keeps the *interaction* identical across variants so they can be
 * judged purely on structure/flow (the prototype question), while each variant
 * is free to look completely different.
 *
 * Contract (per active variant, scoped to `[data-proto-root]`):
 *   [data-proto-root]                  variant wrapper; gets `.proto-started`
 *   [data-proto-empty]                 empty-state block (greeting + input + chips)
 *   [data-proto-thread]                conversation container
 *   [data-proto-turn="<id>"]           one pre-rendered turn, `hidden` initially
 *     [data-proto-user]    (optional)  el whose text is replaced with the typed query
 *     [data-proto-typing]  (optional)  "thinking" row, shown ~700ms then hidden
 *     [data-proto-answer]              answer body, revealed after the thinking beat
 *   [data-proto-send][data-turn="<id>"]  trigger (suggested chip / persona seed)
 *   [data-proto-form] > [data-proto-input]  free-text entry
 *   [data-proto-reset]                 clears the conversation back to empty state
 *
 * The real surface will stream tokens from a Vercel Eve agent; here we just
 * reveal the canned turn after a short delay so the beat reads as "thinking".
 */

import { CONVERSATION } from './_agentData';

const THINK_MS = 700;

/** Membership test over the canned turn ids (dynamic lookup → Set). */
const KNOWN_TURN_IDS = new Set(CONVERSATION.map((t) => t.id));
const TURN_QUESTIONS = new Map(CONVERSATION.map((t) => [t.id, t.q]));

/** Pick a turn id from free text by keyword; fall back to the router turn. */
function routeQuery(text: string): string {
  const q = text.toLowerCase();
  const hits: Array<[string, RegExp]> = [
    ['hire', /\b(hire|hiring|open to|reach|contact|email|available|resume|résumé|cv)\b/],
    ['trading', /\b(trading|trade|trader|options?|market|stock|finance|quant|robinhood|tastytrade)\b/],
    ['ios', /\b(ios|iphone|app store|swift|mobile|app)\b/],
    ['background', /\b(background|history|career|experience|resume|résumé|school|study|education)\b/],
    ['now', /\b(now|currently|building|working on|latest|recent)\b/],
    ['impressive', /\b(impressive|best|favorite|favourite|proud|cool|interesting)\b/],
  ];
  for (const [id, re] of hits) if (re.test(q)) return id;
  return 'fallback';
}

function initRoot(root: HTMLElement): void {
  const thread = root.querySelector<HTMLElement>('[data-proto-thread]');
  const shown = new Set<string>();

  const reveal = (id: string, typed?: string): void => {
    const turnId = KNOWN_TURN_IDS.has(id) ? id : 'fallback';
    const turn = root.querySelector<HTMLElement>(`[data-proto-turn="${turnId}"]`);
    if (!turn) return;

    root.classList.add('proto-started');

    // Re-triggering an already-revealed turn just scrolls back to it.
    if (shown.has(turnId)) {
      turn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    shown.add(turnId);

    const userEl = turn.querySelector<HTMLElement>('[data-proto-user]');
    if (userEl) userEl.textContent = typed ?? TURN_QUESTIONS.get(turnId) ?? userEl.textContent;

    turn.hidden = false;
    turn.classList.add('proto-in');

    const typing = turn.querySelector<HTMLElement>('[data-proto-typing]');
    const answer = turn.querySelector<HTMLElement>('[data-proto-answer]');
    const land = (): void => {
      (turn.querySelector('[data-proto-user]') ?? turn).scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    };

    if (typing && answer) {
      answer.hidden = true;
      typing.hidden = false;
      land();
      window.setTimeout(() => {
        typing.hidden = true;
        answer.hidden = false;
        answer.classList.add('proto-in');
        land();
      }, THINK_MS);
    } else {
      land();
    }
  };

  root.querySelectorAll<HTMLElement>('[data-proto-send]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const id = btn.dataset.turn;
      if (id) reveal(id);
    });
  });

  const form = root.querySelector<HTMLFormElement>('[data-proto-form]');
  const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-proto-input]');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input?.value.trim() ?? '';
    if (!text) return;
    reveal(routeQuery(text), text);
    if (input) input.value = '';
  });

  // Enter-to-send for <textarea> inputs (Shift+Enter keeps a newline).
  input?.addEventListener('keydown', ((e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && input.tagName === 'TEXTAREA') {
      e.preventDefault();
      form?.requestSubmit();
    }
  }) as EventListener);

  root.querySelector<HTMLElement>('[data-proto-reset]')?.addEventListener('click', () => {
    shown.clear();
    root.classList.remove('proto-started');
    thread?.querySelectorAll<HTMLElement>('[data-proto-turn]').forEach((t) => {
      t.hidden = true;
      t.classList.remove('proto-in');
      const answer = t.querySelector<HTMLElement>('[data-proto-answer]');
      answer?.classList.remove('proto-in');
    });
    input?.focus();
  });
}

document.querySelectorAll<HTMLElement>('[data-proto-root]').forEach(initRoot);
