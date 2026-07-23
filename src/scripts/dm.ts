/**
 * DM contextual-guide client island. The AI SDK DefaultChatTransport owns the standard
 * UIMessage SSE protocol; this file only renders typed chunks with textContent.
 */

import { DefaultChatTransport, type UIMessageChunk } from 'ai';
import {
  AGENT_NAME,
  completedAssistantHistoryText,
  DM_ENDPOINT,
  fitCheckValidationMessage,
  sanitizeJobDescriptionForFitCheck,
  validateFinalizationResult,
} from '@/lib/dm/client';
import type {
  DMAnswerArtifact,
  DMAnswerSegment,
  DMChatContext,
  DMUIData,
  DMUIMessage,
  DMValidatedAnswer,
} from '@/lib/dm/contract';
import {
  dmPageContextId,
  isAllowedGuideActionDestination,
  parseDMPageContext,
  type DMGuideAction,
} from '@/lib/dm/guide';
import {
  beginGuideHistoryTurn,
  completeGuideHistoryTurn,
  resetGuideHistory,
  rollbackGuideHistoryTurn,
} from '@/lib/dm/guide-history';
import type {
  PublicContactRecord,
  PublicProjectToolRecord,
  PublicResumeTrackRecord,
  PublicSourceRecord,
  PublicToolEvidence,
} from '@/lib/dm/public-agent-tools';

type ElProps = Record<string, string | boolean | undefined>;
type AskOptions = { displayMessage?: string; transientContext?: Partial<DMChatContext> };

const transport = new DefaultChatTransport<DMUIMessage>({ api: DM_ENDPOINT });

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
  for (const child of children) if (child != null) node.append(child);
  return node;
}

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
  private streamedProseEl: HTMLParagraphElement | null = null;
  private answerShown = false;
  private toolCount = 0;
  private answerRendered = false;
  private completed = false;
  private errorShown = false;
  text = '';

  constructor(question: string) {
    this.logEl = make('ul', { class: 'dm-log' });
    this.typingEl = make('div', { class: 'dm-typing', 'data-dm-typing': '' }, [
      make('div', { class: 'dm-typing-head' }, [
        make('span', { class: 'dm-spin', 'aria-hidden': 'true' }),
        `${AGENT_NAME} is working…`,
      ]),
      this.logEl,
    ]);
    this.usedSummaryCount = make('span');
    this.usedListEl = make('ul', { class: 'dm-used-list' });
    this.usedEl = make('details', { class: 'dm-used', hidden: true }, [
      make('summary', {}, [make('span', { class: 'dm-check', 'aria-hidden': 'true', text: '✓' }), ' ', this.usedSummaryCount]),
      this.usedListEl,
    ]);
    this.proseEl = make('div', { class: 'dm-prose' });
    this.splitEl = make('div', { class: 'dm-split dm-split--solo' }, [this.proseEl]);
    this.answerEl = make('div', { class: 'dm-answer', hidden: true, 'aria-live': 'polite' }, [
      make('div', { class: 'dm-answer-head' }, [make('span', { class: 'dm-tag', text: AGENT_NAME }), this.usedEl]),
      this.splitEl,
    ]);
    this.root = make('article', { class: 'dm-turn' }, [
      make('div', { class: 'dm-user-row' }, [
        make('span', { class: 'dm-user-tag', text: 'You' }),
        make('p', { class: 'dm-user', text: question }),
      ]),
      this.typingEl,
      this.answerEl,
    ]);
  }

  addTool(name: string): void {
    if (name === 'finalizeAnswer') return;
    this.toolCount += 1;
    const label = `${name} · ${toolSummary(name)}`;
    this.logEl.append(make('li', { class: 'dm-log-line' }, [
      make('span', { class: 'dm-spin', 'aria-hidden': 'true' }),
      make('code', { text: label }),
    ]));
    this.usedListEl.append(make('li', {}, [make('code', { text: label })]));
    this.usedSummaryCount.textContent = `used ${this.toolCount} tool${this.toolCount === 1 ? '' : 's'}`;
    this.usedEl.hidden = false;
  }

  renderAnswer(answer: DMValidatedAnswer): void {
    if (this.answerRendered) return;
    this.answerRendered = true;
    this.revealAnswer();
    for (const segment of answer.segments) {
      this.proseEl.append(make('p', { class: 'dm-p', text: segment.text }));
      this.text += `${this.text ? '\n\n' : ''}${segment.text}`;
    }
    for (const limitation of answer.limitations) {
      this.proseEl.append(make('p', { class: 'dm-p', text: limitation }));
      this.text += `${this.text ? '\n\n' : ''}${limitation}`;
    }
    this.renderActions(answer.actions);
    for (const artifact of answer.artifacts) this.renderArtifact(artifact);
    const evidence = uniqueEvidence(answer.segments);
    if (evidence.length > 0) this.renderEvidence(evidence);
    this.completed = true;
  }

  appendStreamedProse(delta: string): void {
    if (!delta) return;
    this.revealAnswer();
    this.streamedProseEl ??= make('p', { class: 'dm-p' });
    if (!this.streamedProseEl.isConnected) this.proseEl.append(this.streamedProseEl);
    this.text += delta;
    this.streamedProseEl.textContent = this.text;
  }

  private renderArtifact(artifact: DMAnswerArtifact): void {
    if (artifact.kind === 'project') this.renderProject(artifact.project);
    else if (artifact.kind === 'resume') this.renderResume(artifact.track);
    else if (artifact.kind === 'contact') this.renderContact(artifact.contact);
    else if (artifact.kind === 'evidence') this.renderPublicSource(artifact.source);
    else this.renderLinks(artifact.items);
  }

  private renderActions(actions: DMGuideAction[]): void {
    const allowed = actions.filter((action) => isAllowedGuideActionDestination(action.href));
    if (!allowed.length) return;
    this.proseEl.append(make('nav', { class: 'dm-next', 'aria-label': 'Suggested next steps' }, [
      make('p', { class: 'dm-next-label', text: 'Next steps' }),
      make('div', { class: 'dm-next-chips' }, allowed.map((action) =>
        make('a', { class: 'dm-chip', href: action.href, text: action.label }),
      )),
    ]));
  }

  private renderProject(project: PublicProjectToolRecord): void {
    const [statusKind = 'done', statusLabel = 'Published'] = project.status;
    const wrap = make('div', { class: 'dm-projs' }, [
      make('a', { class: 'dm-proj', href: project.href, hue: '#8b7cf6' }, [
        make('span', { class: 'dm-proj__rule', 'aria-hidden': 'true' }),
        make('span', { class: 'dm-proj__body' }, [
          make('span', { class: 'dm-proj__main' }, [
            make('span', { class: 'dm-proj__id', text: project.id }),
            make('span', { class: 'dm-proj__title', text: project.title }),
          ]),
          make('span', { class: 'dm-proj__meta' }, [
            make('span', { class: `badge ${statusKind}`, text: statusLabel }),
            make('span', { class: 'dm-proj__cat', text: `${project.area} · ${project.year}` }),
            make('span', { class: 'dm-proj__act', text: project.activity }),
          ]),
          make('span', { class: 'dm-proj__line', text: project.tagline }),
        ]),
        make('span', { class: 'dm-proj__go', 'aria-hidden': 'true', text: '→' }),
      ]),
    ]);
    this.canvas().append(wrap);
  }

  private renderResume(track: PublicResumeTrackRecord): void {
    this.canvas().append(make('div', { class: 'dm-resume' }, [
      make('a', { class: 'dm-track', href: `/journey/${track.id}`, hue: '#8b7cf6' }, [
        make('span', { class: 'dm-track-top' }, [make('span', { class: 'dm-track-title', text: track.title })]),
        make('span', { class: 'dm-track-role', text: track.role }),
        make('span', { class: 'dm-track-when', text: track.when }),
      ]),
    ]));
  }

  private renderContact(contact: PublicContactRecord): void {
    this.canvas().append(make('div', { class: 'dm-contact' }, [
      this.contactRow('email', contact.email, `mailto:${contact.email}`),
      this.contactRow('github', contact.github.replace(/^https?:\/\//, ''), contact.github, true),
      this.contactRow('résumé', 'Download PDF →', contact.resume),
      this.contactRow('based', contact.location),
      make('div', { class: 'dm-contact-row' }, [
        make('span', { class: 'dm-contact-key', text: 'status' }),
        make('span', { class: 'dm-contact-val dm-contact-status' }, [make('span', { class: 'dm-dot', 'aria-hidden': 'true' }), contact.status]),
      ]),
    ]));
  }

  private renderPublicSource(source: PublicSourceRecord): void {
    const text = source.text.length > 180 ? `${source.text.slice(0, 177)}…` : source.text;
    this.canvas().append(make('article', { class: 'dm-evidence-item' }, [
      make('span', { class: 'dm-evidence-rule', 'aria-hidden': 'true' }),
      make('span', { class: 'dm-evidence-top' }, [
        make('span', { class: 'dm-evidence-type', text: 'public source' }),
        make('span', { class: 'badge done', text: 'Cited' }),
      ]),
      make('h3', { class: 'dm-evidence-title', text: source.label }),
      make('p', { class: 'dm-evidence-line', text }),
    ]));
  }

  private renderLinks(items: Array<{ label: string; href: string }>): void {
    if (!items.length) return;
    this.proseEl.append(make('div', { class: 'dm-next' }, [
      make('p', { class: 'dm-next-label', text: 'Relevant public links:' }),
      make('div', { class: 'dm-next-chips' }, items.map((item) =>
        make('a', { class: 'dm-chip', href: item.href, text: item.label, target: '_blank', rel: 'noopener' }),
      )),
    ]));
  }

  private renderEvidence(evidence: PublicToolEvidence[]): void {
    const wrap = make('section', { class: 'dm-evidence', 'aria-label': 'Evidence summary' }, [
      make('div', { class: 'dm-evidence-head' }, [
        make('span', { class: 'dm-evidence-kicker', text: 'evidence summary' }),
        make('span', { class: 'dm-evidence-count', text: `${evidence.length} fact${evidence.length === 1 ? '' : 's'}` }),
      ]),
    ]);
    for (const item of evidence.slice(0, 8)) {
      wrap.append(make('article', { class: 'dm-evidence-item' }, [
        make('span', { class: 'dm-evidence-rule', 'aria-hidden': 'true' }),
        make('span', { class: 'dm-evidence-top' }, [make('span', { class: 'dm-evidence-type', text: item.source.replace('_', ' ') })]),
        make('h3', { class: 'dm-evidence-title', text: item.label }),
        make('p', { class: 'dm-evidence-line', text: item.value }),
      ]));
    }
    this.canvas().append(wrap);
  }

  private contactRow(key: string, value: string, href?: string, external = false): HTMLElement {
    const children = [make('span', { class: 'dm-contact-key', text: key }), make('span', { class: 'dm-contact-val', text: value })];
    return href
      ? make('a', { class: 'dm-contact-row', href, ...(external ? { target: '_blank', rel: 'noopener' } : {}) }, children)
      : make('div', { class: 'dm-contact-row' }, children);
  }

  private canvas(): HTMLElement {
    this.revealAnswer();
    if (!this.canvasEl) {
      this.canvasEl = make('div', { class: 'dm-canvas' }, [make('p', { class: 'dm-canvas-label', 'aria-hidden': 'true', text: 'artifacts' })]);
      this.splitEl.classList.remove('dm-split--solo');
      this.splitEl.append(this.canvasEl);
    }
    return this.canvasEl;
  }

  private revealAnswer(): void {
    if (this.answerShown) return;
    this.answerShown = true;
    this.typingEl.hidden = true;
    this.answerEl.hidden = false;
  }

  showError(message: string): void {
    if (this.errorShown) return;
    this.errorShown = true;
    this.revealAnswer();
    this.proseEl.append(make('div', { class: 'dm-error' }, [
      make('p', { text: message }),
      make('p', {}, ['You can still reach Dylan directly at ', make('a', { href: 'mailto:dylanmccavitt@outlook.com', text: 'dylanmccavitt@outlook.com' }), '.']),
    ]));
  }

  finishIfNeeded(): void {
    if (this.completed) return;
    this.showError(`${AGENT_NAME} didn't return a verified answer. Please try rephrasing the question.`);
  }

  stop(): void {
    if (this.completed) return;
    this.typingEl.hidden = true;
    this.answerEl.hidden = false;
    this.proseEl.append(make('p', { class: 'dm-p', text: `${AGENT_NAME} stopped this answer.` }));
  }

  historyText(): string | null {
    return completedAssistantHistoryText(this.text, this.completed);
  }

}

async function streamInto(
  turn: Turn,
  messages: DMUIMessage[],
  context: DMChatContext | undefined,
  signal: AbortSignal,
): Promise<void> {
  const stream = await transport.sendMessages({
    trigger: 'submit-message',
    chatId: 'dm-public',
    messageId: undefined,
    messages,
    abortSignal: signal,
    ...(context ? { body: { context } } : {}),
  });
  const toolCalls = new Map<string, string>();
  const announced = new Set<string>();
  for await (const chunk of stream) {
    handleChunk(turn, chunk as UIMessageChunk<unknown, DMUIData>, toolCalls, announced);
  }
}

function handleChunk(
  turn: Turn,
  chunk: UIMessageChunk<unknown, DMUIData>,
  toolCalls: Map<string, string>,
  announced: Set<string>,
): void {
  if (chunk.type === 'tool-input-start' || chunk.type === 'tool-input-available') {
    toolCalls.set(chunk.toolCallId, chunk.toolName);
    if (!announced.has(chunk.toolCallId)) {
      announced.add(chunk.toolCallId);
      turn.addTool(chunk.toolName);
    }
    return;
  }
  if (chunk.type === 'error') {
    turn.showError(chunk.errorText);
    return;
  }
  if (chunk.type === 'text-delta') {
    turn.appendStreamedProse(chunk.delta);
    return;
  }
  if (chunk.type === 'data-dm-answer') {
    const result = validateFinalizationResult(chunk.data);
    if (result && result.status !== 'rejected') {
      turn.renderAnswer(result.answer);
    }
    return;
  }
  if (chunk.type === 'tool-output-available') {
    const name = toolCalls.get(chunk.toolCallId);
    if (name !== 'finalizeAnswer') return;
    const result = validateFinalizationResult(chunk.output);
    if (result && result.status !== 'rejected') {
      // The dedicated data part follows and is authoritative; rendering here
      // keeps the client resilient if an intermediary strips custom data parts.
      turn.renderAnswer(result.answer);
    }
  }
}

function initRoot(root: HTMLElement): void {
  const thread = root.querySelector<HTMLElement>('[data-dm-thread]');
  const form = root.querySelector<HTMLFormElement>('[data-dm-form]');
  const input = root.querySelector<HTMLInputElement>('[data-dm-input]');
  const sendBtn = root.querySelector<HTMLButtonElement>('[data-dm-submit]');
  if (!thread || !form || !input) return;

  const page = parseDMPageContext({
    kind: root.dataset.dmPageKind,
    path: root.dataset.dmPagePath,
    ...(root.dataset.dmPageReference ? { reference: root.dataset.dmPageReference } : {}),
  });
  const pageId = dmPageContextId(page);
  const context: DMChatContext = {
    page,
    ...(page.kind === 'journey' && page.reference ? { resumeTrackIds: [page.reference] } : {}),
  };
  const fitForm = root.querySelector<HTMLFormElement>('[data-dm-fit-form]');
  const fitInput = root.querySelector<HTMLTextAreaElement>('[data-dm-fit-input]');
  const fitSubmit = root.querySelector<HTMLButtonElement>('[data-dm-fit-submit]');
  const fitCount = root.querySelector<HTMLElement>('[data-dm-fit-count]');
  const fitError = root.querySelector<HTMLElement>('[data-dm-fit-error]');
  const history: DMUIMessage[] = [];
  let busy = false;
  let controller: AbortController | null = null;
  let generation = 0;

  const trigger = root.querySelector<HTMLElement>('[data-dm-open]');
  const dialog = root.querySelector<HTMLElement>('[data-dm-dialog]');
  const panel = root.querySelector<HTMLElement>('[data-dm-panel]');
  const shouldAvoidAutoKeyboard = (): boolean => window.matchMedia('(max-width: 820px)').matches;
  const setBusy = (next: boolean): void => {
    busy = next;
    root.classList.toggle('dm-busy', next);
    if (sendBtn) sendBtn.disabled = next;
    if (fitSubmit) fitSubmit.disabled = next;
  };

  const ask = async (question: string, options: AskOptions = {}): Promise<void> => {
    const message = question.trim();
    if (!message || busy) return;
    const displayMessage = options.displayMessage?.trim() || message;
    const requestContext = mergeContext(context, options.transientContext);
    setBusy(true);
    root.classList.add('dm-started');
    const historyTurn = beginGuideHistoryTurn(
      history,
      generation,
      uiTextMessage('user', message, pageId),
    );

    const turn = new Turn(displayMessage);
    thread.append(turn.root);
    thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
    controller = new AbortController();
    try {
      await streamInto(turn, history.slice(-13), requestContext, controller.signal);
      turn.finishIfNeeded();
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        rollbackGuideHistoryTurn(history, historyTurn, generation);
        turn.stop();
        return;
      }
      console.error('[dm] UIMessage stream failed', { name: error instanceof Error ? error.name : typeof error });
      turn.showError(`${AGENT_NAME} is unavailable right now. Please try again in a moment.`);
    } finally {
      const assistantText = turn.historyText();
      if (completeGuideHistoryTurn(
        history,
        historyTurn,
        generation,
        assistantText ? uiTextMessage('assistant', assistantText, pageId) : null,
      )) {
        setBusy(false);
        controller = null;
      }
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
    const focusable = (): HTMLElement[] => Array.from(panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.hasAttribute('disabled') && !element.closest('[hidden]') && element.getClientRects().length > 0);
    trigger.addEventListener('click', open);
    root.querySelectorAll<HTMLElement>('[data-dm-close]').forEach((button) => button.addEventListener('click', close));
    dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items.at(-1);
      if (document.activeElement === panel) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    });
  }

  root.querySelectorAll<HTMLElement>('[data-dm-send]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      void ask(button.dataset.label ?? button.textContent ?? '');
    });
  });
  root.querySelectorAll<HTMLElement>('[data-dm-cancel]').forEach((button) => {
    button.addEventListener('click', () => controller?.abort());
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value;
    input.value = '';
    if (dialog && panel && shouldAvoidAutoKeyboard() && text.trim()) {
      input.blur();
      requestAnimationFrame(() => panel.focus({ preventScroll: true }));
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
    fitForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const validation = fitCheckValidationMessage(fitInput.value);
      if (validation) {
        if (fitError) {
          fitError.textContent = validation;
          fitError.hidden = false;
        }
        fitInput.focus();
        return;
      }
      const sanitized = sanitizeJobDescriptionForFitCheck(fitInput.value);
      fitInput.value = '';
      updateFitCount();
      void ask(
        "Fit-check this job description against Dylan's portfolio and resume. Present a fit summary, strongest evidence projects, resume/background evidence, gaps or unknowns, and next contact steps. Do not assign a match score or imply a hiring guarantee.",
        { displayMessage: 'Fit-check pasted job description', transientContext: { fitCheck: { kind: 'job-description', ...sanitized } } },
      );
    });
  }

  root.querySelector<HTMLElement>('[data-dm-reset]')?.addEventListener('click', () => {
    generation = resetGuideHistory(history, generation);
    controller?.abort();
    controller = null;
    setBusy(false);
    thread.replaceChildren();
    root.classList.remove('dm-started');
    input.focus();
  });

  window.addEventListener('popstate', () => {
    if (window.location.pathname === page.path) return;
    generation = resetGuideHistory(history, generation);
    controller?.abort();
  });
}

function uiTextMessage(role: 'user' | 'assistant', text: string, pageContextId: string): DMUIMessage {
  return { id: crypto.randomUUID(), role, metadata: { pageContextId }, parts: [{ type: 'text', text }] };
}

function toolSummary(name: string): string {
  const summaries: Record<string, string> = {
    searchProjects: 'Search published projects',
    getProject: 'Read a published project',
    readResume: 'Read public resume facts',
    getContact: 'Read public contact details',
    searchPublicSources: 'Search approved public sources',
    searchProfile: 'Search published profile facts',
  };
  return summaries[name] ?? 'Use a public portfolio tool';
}

function uniqueEvidence(segments: DMAnswerSegment[]): PublicToolEvidence[] {
  const evidence = new Map<string, PublicToolEvidence>();
  for (const segment of segments) for (const item of segment.evidence) evidence.set(item.id, item);
  return [...evidence.values()];
}

function mergeContext(base: DMChatContext, transient: Partial<DMChatContext> | undefined): DMChatContext {
  return {
    ...base,
    ...(transient ?? {}),
    projectIds: transient?.projectIds ?? base?.projectIds,
    resumeTrackIds: transient?.resumeTrackIds ?? base?.resumeTrackIds,
  };
}

document.querySelectorAll<HTMLElement>('[data-dm-root]').forEach(initRoot);
