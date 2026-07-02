/**
 * Eve landing — production chat client island (#86).
 *
 * The one deliberate client-JS island on the landing (the rest of the site
 * stays static). It replaces the canned reveal driver
 * (`_agentProto.client.ts`) with a real integration against the Eve streaming
 * endpoint (#84): it submits the visitor's question, consumes the NDJSON stream
 * incrementally, and renders the user turn, streamed answer text, the tool
 * trace (live "working…" log + `USED N tools`), and project / résumé /
 * evidence / contact / link artifacts — building each turn's DOM from streamed payloads rather than
 * pre-rendered canned turns.
 *
 * Failure is graceful by construction: a missing/erroring endpoint, a malformed
 * line, or an unknown answer-block kind is skipped or surfaced as a friendly
 * notice without breaking the conversation surface. Network text is only ever
 * written via `textContent`, so streamed content can never inject markup.
 *
 * The contract (answer-block + stream-event types, the tolerant NDJSON parser,
 * and id resolvers over canonical catalog/résumé data) lives in `lib/eve.ts`.
 */

import {
  AGENT_NAME,
  DM_ENDPOINT,
  fitCheckValidationMessage,
  parseStreamLine,
  resolveContact,
  resolveEvidence,
  resolveProjects,
  resolveTracks,
  sanitizeJobDescriptionForFitCheck,
  type AnswerBlock,
  type ChatMessage,
  type ProjectArtifact,
  type StreamEvent,
} from '../lib/eve';
import type { Project } from '../data/catalog';
import type { ResumeTrack } from '../data/resume';

type RenderProject = Project | ProjectArtifact;

// ---------------------------------------------------------------------------
// Tiny DOM helpers — explicit and XSS-safe (text via textContent only).
// ---------------------------------------------------------------------------

/**
 * Element props: `class` / `text` / `hue` / `hidden` are handled specially; any
 * other key (`href`, `target`, `rel`, `data-*`, `aria-*`, …) is set verbatim as
 * an attribute. Loose by design — this is an internal builder.
 */
type ElProps = Record<string, string | boolean | undefined>;
type ChatContext = {
  projectIds?: string[];
  resumeTrackIds?: string[];
  fitCheck?: {
    kind: 'job-description';
    jobDescription: string;
    originalLength: number;
    truncated: boolean;
  };
};
type AskOptions = {
  displayMessage?: string;
  transientContext?: ChatContext;
};

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  children: (Node | string | null)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'hue') node.style.setProperty('--hue', String(value));
    else if (key === 'hidden') {
      if (value) node.setAttribute('hidden', '');
    } else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child);
  }
  return node;
}

// ---------------------------------------------------------------------------
// Per-turn controller — owns one Q&A turn's DOM + streaming state.
// ---------------------------------------------------------------------------

class Turn {
  readonly root: HTMLElement;
  private readonly logEl: HTMLUListElement;
  private readonly typingEl: HTMLElement;
  private readonly answerEl: HTMLElement;
  private readonly proseEl: HTMLElement;
  private readonly splitEl: HTMLElement;
  private readonly usedEl: HTMLDetailsElement;
  private readonly usedSummaryCount: HTMLElement;
  private readonly usedListEl: HTMLUListElement;

  private canvasEl: HTMLElement | null = null;
  private openTextEl: HTMLParagraphElement | null = null;
  private answerShown = false;
  private toolCount = 0;
  /** Collected answer text, for multi-turn history. */
  text = '';

  constructor(question: string) {
    this.logEl = make('ul', { class: 'eve-log' });
    this.typingEl = make('div', { class: 'eve-typing', 'data-eve-typing': '' }, [
      make('div', { class: 'eve-typing-head' }, [
        make('span', { class: 'eve-spin', 'aria-hidden': 'true' }),
        `${AGENT_NAME} is working…`,
      ]),
      this.logEl,
    ]);

    this.usedSummaryCount = make('span', { text: '' });
    this.usedListEl = make('ul', { class: 'eve-used-list' });
    this.usedEl = make('details', { class: 'eve-used', hidden: true }, [
      make('summary', {}, [
        make('span', { class: 'eve-check', 'aria-hidden': 'true', text: '✓' }),
        ' ',
        this.usedSummaryCount,
      ]),
      this.usedListEl,
    ]);

    this.proseEl = make('div', { class: 'eve-prose' });
    this.splitEl = make('div', { class: 'eve-split eve-split--solo' }, [this.proseEl]);
    this.answerEl = make(
      'div',
      { class: 'eve-answer', hidden: true, 'aria-live': 'polite' },
      [
        make('div', { class: 'eve-answer-head' }, [
          make('span', { class: 'eve-tag', text: AGENT_NAME }),
          this.usedEl,
        ]),
        this.splitEl,
      ],
    );

    this.root = make('article', { class: 'eve-turn' }, [
      make('div', { class: 'eve-user-row' }, [
        make('span', { class: 'eve-user-tag', text: 'You' }),
        make('p', { class: 'eve-user', text: question }),
      ]),
      this.typingEl,
      this.answerEl,
    ]);
  }

  /** Route one stream event to the right rendering path. */
  handle(event: StreamEvent): void {
    switch (event.type) {
      case 'tool':
        this.addTool(event.name, event.summary);
        break;
      case 'text-delta':
        this.appendDelta(event.delta);
        break;
      case 'block':
        this.renderBlock(event.block);
        break;
      case 'error':
        this.showError(event.message);
        break;
    }
  }

  private revealAnswer(): void {
    if (this.answerShown) return;
    this.answerShown = true;
    this.typingEl.hidden = true;
    this.answerEl.hidden = false;
  }

  private addTool(name: string, summary?: string): void {
    this.toolCount += 1;
    const label = summary ? `${name} · ${summary}` : `${name}()`;
    // live "working…" log (visible only until the answer reveals)
    this.logEl.append(
      make('li', { class: 'eve-log-line' }, [
        make('span', { class: 'eve-spin', 'aria-hidden': 'true' }),
        make('code', { text: label }),
      ]),
    );
    // persistent USED N tools disclosure
    this.usedListEl.append(make('li', {}, [make('code', { text: label })]));
    this.usedSummaryCount.textContent = `used ${this.toolCount} tool${
      this.toolCount === 1 ? '' : 's'
    }`;
    this.usedEl.hidden = false;
  }

  private appendDelta(delta: string): void {
    this.revealAnswer();
    if (!this.openTextEl) {
      this.openTextEl = make('p', { class: 'eve-p' });
      this.proseEl.append(this.openTextEl);
    }
    this.openTextEl.textContent = (this.openTextEl.textContent ?? '') + delta;
    this.text += delta;
  }

  private renderBlock(block: AnswerBlock): void {
    this.revealAnswer();
    switch (block.kind) {
      case 'text': {
        this.openTextEl = null; // a complete paragraph closes any open stream
        this.proseEl.append(make('p', { class: 'eve-p', text: block.text }));
        this.text += (this.text ? '\n\n' : '') + block.text;
        break;
      }
      case 'projects': {
        const projects = mergeProjectArtifacts(block.items, resolveProjects(block.ids));
        if (!projects.length) break;
        const wrap = make('div', { class: 'eve-projs' });
        for (const p of projects) {
          const [kind, statusLabel] = p.status;
          wrap.append(
            make('a', { class: 'eve-proj', href: projectHref(p), hue: projectHue(p) }, [
              make('span', { class: 'eve-proj__rule', 'aria-hidden': 'true' }),
              make('span', { class: 'eve-proj__body' }, [
                make('span', { class: 'eve-proj__main' }, [
                  make('span', { class: 'eve-proj__id', text: p.id }),
                  make('span', { class: 'eve-proj__title', text: p.title }),
                ]),
                make('span', { class: 'eve-proj__meta' }, [
                  make('span', { class: `badge ${kind}`, text: statusLabel }),
                  make('span', { class: 'eve-proj__cat', text: `${p.area} · ${p.year}` }),
                  make('span', { class: 'eve-proj__act', text: p.activity }),
                ]),
                make('span', { class: 'eve-proj__line', text: p.line }),
              ]),
              make('span', { class: 'eve-proj__go', 'aria-hidden': 'true', text: '→' }),
            ]),
          );
        }
        this.canvas().append(wrap);
        break;
      }
      case 'resume': {
        const tracks = resolveTracks(block.trackIds);
        if (!tracks.length) break;
        const wrap = make('div', { class: 'eve-resume' });
        for (const t of tracks) {
          wrap.append(
            make('div', { class: 'eve-track', hue: t.hue }, [
              make('span', { class: 'eve-track-top' }, [
                make('span', { class: 'eve-track-title', text: t.title }),
                t.current ? make('span', { class: 'badge live', text: 'Now' }) : null,
              ]),
              make('span', { class: 'eve-track-role', text: t.role }),
              make('span', { class: 'eve-track-when', text: t.when }),
            ]),
          );
        }
        this.canvas().append(wrap);
        break;
      }
      case 'evidence': {
        const resolved = resolveEvidence(block);
        const projects = mergeProjectArtifacts(block.projects, resolved.projects);
        const tracks = resolved.tracks;
        if (!projects.length && !tracks.length) break;

        const count = projects.length + tracks.length;
        const wrap = make('section', { class: 'eve-evidence', 'aria-label': 'Evidence summary' }, [
          make('div', { class: 'eve-evidence-head' }, [
            make('span', { class: 'eve-evidence-kicker', text: 'evidence summary' }),
            make('span', {
              class: 'eve-evidence-count',
              text: `${count} source${count === 1 ? '' : 's'}`,
            }),
          ]),
        ]);

        for (const project of projects) {
          wrap.append(this.projectEvidence(project));
        }
        for (const track of tracks) {
          wrap.append(this.resumeEvidence(track));
        }

        this.canvas().append(wrap);
        break;
      }
      case 'contact': {
        const c = resolveContact(block);
        this.canvas().append(
          make('div', { class: 'eve-contact' }, [
            this.contactRow('email', c.email, `mailto:${c.email}`),
            this.contactRow('github', c.github.replace(/^https?:\/\//, ''), c.github, true),
            this.contactRow('résumé', 'Download PDF →', c.resume),
            this.contactRow('based', c.location),
            make('div', { class: 'eve-contact-row' }, [
              make('span', { class: 'eve-contact-key', text: 'status' }),
              make('span', { class: 'eve-contact-val eve-contact-status' }, [
                make('span', { class: 'eve-dot', 'aria-hidden': 'true' }),
                c.status,
              ]),
            ]),
          ]),
        );
        break;
      }
      case 'links': {
        if (!block.items.length) break;
        this.proseEl.append(
          make('div', { class: 'eve-next' }, [
            make('p', { class: 'eve-next-label', text: 'Suggested next steps:' }),
            make(
              'div',
              { class: 'eve-next-chips' },
              block.items.map(([label, href]) =>
                make('a', { class: 'eve-chip', href, text: label }),
              ),
            ),
          ]),
        );
        break;
      }
    }
  }

  private projectEvidence(project: RenderProject): HTMLElement {
    const [kind, statusLabel] = project.status;
    const facts = [...projectMetrics(project).slice(0, 2), ...projectStack(project).slice(0, 2)];

    return make('a', { class: 'eve-evidence-item', href: projectHref(project), hue: projectHue(project) }, [
      make('span', { class: 'eve-evidence-rule', 'aria-hidden': 'true' }),
      make('span', { class: 'eve-evidence-top' }, [
        make('span', { class: 'eve-evidence-type', text: 'project' }),
        make('span', { class: `badge ${kind}`, text: statusLabel }),
      ]),
      make('h3', { class: 'eve-evidence-title', text: project.title }),
      make('p', { class: 'eve-evidence-line', text: project.line }),
      this.evidenceFacts(facts),
      projectNotes(project)[0] ? make('p', { class: 'eve-evidence-note', text: projectNotes(project)[0] }) : null,
      make('span', { class: 'eve-evidence-route', text: 'Open project →' }),
    ]);
  }

  private resumeEvidence(track: ResumeTrack): HTMLElement {
    return make('a', { class: 'eve-evidence-item', href: `/journey/${track.id}`, hue: track.hue }, [
      make('span', { class: 'eve-evidence-rule', 'aria-hidden': 'true' }),
      make('span', { class: 'eve-evidence-top' }, [
        make('span', { class: 'eve-evidence-type', text: 'resume' }),
        track.current ? make('span', { class: 'badge live', text: 'Now' }) : null,
      ]),
      make('h3', { class: 'eve-evidence-title', text: track.title }),
      make('p', { class: 'eve-evidence-line', text: `${track.role} · ${track.when}` }),
      this.evidenceFacts(track.credits.slice(0, 3)),
      track.notes[0] ? make('p', { class: 'eve-evidence-note', text: track.notes[0] }) : null,
      make('span', { class: 'eve-evidence-route', text: 'Open resume entry →' }),
    ]);
  }

  private evidenceFacts(facts: [string, string][]): HTMLElement {
    return make(
      'ul',
      { class: 'eve-evidence-facts' },
      facts.map(([value, label]) =>
        make('li', {}, [
          make('span', { class: 'eve-evidence-fact-value', text: value }),
          make('span', { class: 'eve-evidence-fact-label', text: label }),
        ]),
      ),
    );
  }

  private contactRow(key: string, value: string, href?: string, external = false): HTMLElement {
    const valueEl = make('span', { class: 'eve-contact-val', text: value });
    const keyEl = make('span', { class: 'eve-contact-key', text: key });
    if (!href) return make('div', { class: 'eve-contact-row' }, [keyEl, valueEl]);
    return make(
      'a',
      {
        class: 'eve-contact-row',
        href,
        ...(external ? { target: '_blank', rel: 'noopener' } : {}),
      },
      [keyEl, valueEl],
    );
  }

  /** Lazily create the right-hand artifact canvas on first artifact. */
  private canvas(): HTMLElement {
    this.revealAnswer();
    if (!this.canvasEl) {
      this.canvasEl = make('div', { class: 'eve-canvas' }, [
        make('p', { class: 'eve-canvas-label', 'aria-hidden': 'true', text: 'artifacts' }),
      ]);
      this.splitEl.classList.remove('eve-split--solo');
      this.splitEl.append(this.canvasEl);
    }
    return this.canvasEl;
  }

  showError(message: string): void {
    this.revealAnswer();
    this.proseEl.append(
      make('div', { class: 'eve-error' }, [
        make('p', { text: message }),
        make('p', {}, [
          'You can still reach Dylan directly at ',
          make('a', { href: 'mailto:dylanmccavitt@outlook.com', text: 'dylanmccavitt@outlook.com' }),
          '.',
        ]),
      ]),
    );
  }

  /** Stream finished with no answer content at all. */
  finishEmptyIfNeeded(): void {
    if (this.answerShown) return;
    this.revealAnswer();
    this.proseEl.append(
      make('p', {
        class: 'eve-p',
        text: `${AGENT_NAME} didn't return an answer for that. Try rephrasing, or pick a suggested prompt.`,
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Streaming — POST the question, read NDJSON, dispatch events to the turn.
// ---------------------------------------------------------------------------

async function streamInto(
  turn: Turn,
  message: string,
  conversation: ChatMessage[],
  context: ChatContext | undefined,
  signal: AbortSignal,
): Promise<void> {
  const payload = context ? { message, conversation, context } : { message, conversation };
  const res = await fetch(DM_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Eve endpoint responded ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const flushLine = (line: string): void => {
    const event = parseStreamLine(line);
    if (event) turn.handle(event);
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      flushLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  if (buffer.trim()) flushLine(buffer);
}

// ---------------------------------------------------------------------------
// Island wiring.
// ---------------------------------------------------------------------------

function initRoot(root: HTMLElement): void {
  const thread = root.querySelector<HTMLElement>('[data-eve-thread]');
  const form = root.querySelector<HTMLFormElement>('[data-eve-form]');
  const input = root.querySelector<HTMLInputElement>('[data-eve-input]');
  const sendBtn = root.querySelector<HTMLButtonElement>('[data-eve-submit]');
  if (!thread || !form || !input) return;

  const projectId = root.dataset.eveProjectId?.trim();
  const context = projectId ? { projectIds: [projectId] } : undefined;
  const fitForm = root.querySelector<HTMLFormElement>('[data-eve-fit-form]');
  const fitInput = root.querySelector<HTMLTextAreaElement>('[data-eve-fit-input]');
  const fitSubmit = root.querySelector<HTMLButtonElement>('[data-eve-fit-submit]');
  const fitCount = root.querySelector<HTMLElement>('[data-eve-fit-count]');
  const fitError = root.querySelector<HTMLElement>('[data-eve-fit-error]');

  const history: ChatMessage[] = [];
  let busy = false;
  let controller: AbortController | null = null;

  const trigger = root.querySelector<HTMLElement>('[data-eve-open]');
  const dialog = root.querySelector<HTMLElement>('[data-eve-dialog]');
  const panel = root.querySelector<HTMLElement>('[data-eve-panel]');
  const shouldAvoidAutoKeyboard = (): boolean => window.matchMedia('(max-width: 820px)').matches;
  const setBusy = (next: boolean): void => {
    busy = next;
    if (sendBtn) sendBtn.disabled = next;
    if (fitSubmit) fitSubmit.disabled = next;
  };

  const ask = async (question: string, options: AskOptions = {}): Promise<void> => {
    const message = question.trim();
    if (!message || busy) return;
    const displayMessage = options.displayMessage?.trim() || message;
    const requestContext = mergeContext(context, options.transientContext);
    setBusy(true);
    root.classList.add('eve-started');

    const historySnapshot = history.slice();
    history.push({ role: 'user', content: displayMessage });

    const turn = new Turn(displayMessage);
    thread.append(turn.root);
    thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });

    controller = new AbortController();
    try {
      await streamInto(turn, message, historySnapshot, requestContext, controller.signal);
      turn.finishEmptyIfNeeded();
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      console.error('[eve] stream failed', err);
      turn.showError(`${AGENT_NAME} is unavailable right now. Please try again in a moment.`);
    } finally {
      history.push({ role: 'assistant', content: turn.text });
      setBusy(false);
      controller = null;
    }
  };

  if (trigger && dialog && panel) {
    const close = (): void => {
      if (dialog.hidden) return;
      dialog.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      trigger.focus({ preventScroll: true });
    };

    const open = (): void => {
      if (!dialog.hidden) return;
      dialog.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      if (shouldAvoidAutoKeyboard()) panel.focus({ preventScroll: true });
      else input.focus({ preventScroll: true });
    };

    const focusable = (): HTMLElement[] =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('disabled') && !el.closest('[hidden]'));

    trigger.addEventListener('click', open);
    root.querySelectorAll<HTMLElement>('[data-eve-close]').forEach((btn) => {
      btn.addEventListener('click', close);
    });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) close();
    });
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== 'Tab') return;

      const items = focusable();
      if (!items.length) {
        e.preventDefault();
        panel.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  // suggested prompts submit their label as a real question
  root.querySelectorAll<HTMLElement>('[data-eve-send]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const label = btn.dataset.label ?? btn.textContent ?? '';
      void ask(label);
    });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value;
    input.value = '';
    if (dialog && panel && shouldAvoidAutoKeyboard() && text.trim()) {
      input.blur();
      requestAnimationFrame(() => {
        panel.focus({ preventScroll: true });
      });
    }
    void ask(text);
  });

  if (fitForm && fitInput) {
    const updateFitCount = (): void => {
      if (fitCount) fitCount.textContent = `${fitInput.value.length.toLocaleString()} / ${fitInput.maxLength.toLocaleString()}`;
      if (fitError) fitError.hidden = true;
    };

    fitInput.addEventListener('input', updateFitCount);
    updateFitCount();

    fitForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = fitInput.value;
      const validation = fitCheckValidationMessage(raw);
      if (validation) {
        if (fitError) {
          fitError.textContent = validation;
          fitError.hidden = false;
        }
        fitInput.focus();
        return;
      }

      const sanitized = sanitizeJobDescriptionForFitCheck(raw);
      fitInput.value = '';
      updateFitCount();
      void ask(
        "Fit-check this job description against Dylan's portfolio and resume. Present a fit summary, strongest evidence projects, resume/background evidence, gaps or unknowns, and next contact steps. Do not assign a match score or imply a hiring guarantee.",
        {
          displayMessage: 'Fit-check pasted job description',
          transientContext: {
            fitCheck: {
              kind: 'job-description',
              ...sanitized,
            },
          },
        },
      );
    });
  }

  root.querySelector<HTMLElement>('[data-eve-reset]')?.addEventListener('click', () => {
    controller?.abort();
    controller = null;
    setBusy(false);
    history.length = 0;
    thread.replaceChildren();
    root.classList.remove('eve-started');
    input.focus();
  });
}

function mergeProjectArtifacts(items: ProjectArtifact[] | undefined, fallback: Project[]): RenderProject[] {
  if (!items?.length) return fallback;
  const byId = new Map<string, RenderProject>();
  for (const project of fallback) byId.set(project.id, project);
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()];
}

function projectHref(project: RenderProject): string {
  return 'href' in project ? project.href : `/projects/${project.id}`;
}

function projectHue(project: RenderProject): string {
  return 'hue' in project && typeof project.hue === 'string' ? project.hue : '#8b7cf6';
}

function projectMetrics(project: RenderProject): Project['metrics'] {
  return 'metrics' in project && Array.isArray(project.metrics) ? project.metrics : [];
}

function projectStack(project: RenderProject): Project['stack'] {
  return 'stack' in project && Array.isArray(project.stack) ? project.stack : [];
}

function projectNotes(project: RenderProject): string[] {
  return 'notes' in project && Array.isArray(project.notes) ? project.notes : [];
}

document.querySelectorAll<HTMLElement>('[data-eve-root]').forEach(initRoot);

function mergeContext(base: ChatContext | undefined, transient: ChatContext | undefined): ChatContext | undefined {
  if (!base && !transient) return undefined;
  return {
    ...(base ?? {}),
    ...(transient ?? {}),
    projectIds: transient?.projectIds ?? base?.projectIds,
    resumeTrackIds: transient?.resumeTrackIds ?? base?.resumeTrackIds,
  };
}
