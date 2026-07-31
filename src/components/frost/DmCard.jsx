import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronUp, Minus, X } from "lucide-react";
import { PROFILE } from "./frost-data.js";
import { askDm, linkifyCitations } from "./dm-client.js";
import { chooseDmFrame, visibleDmObstacles } from "./dm-layout.js";
import {
  DM_LIT_CONTACT_MS,
  DM_LIT_MS,
  clearDmSession,
  createTurnQueue,
  hasDmNavigationIntent,
  historyWasRejected,
  readDmSession,
  writeDmSession,
} from "./dm-session.js";

/**
 * DM — the corner card. A small floating conversation surface that never takes
 * the page over: it drives the site behind itself (scroll, glitch-lit Work
 * cards, project open, contact fringe) while it answers.
 *
 * The conversation is real. `dm-client.js` streams it from the configured
 * service over SSE and enforces the action allowlist; this component only
 * renders text and applies the four vetted page actions.
 *
 * The card mounts on the homepage island and on the Paper project pages, and
 * the conversation follows it: `dm-session.js` keeps the settled turns (and
 * their signature tokens) in sessionStorage, so an explicitly requested
 * project navigation does not end the conversation.
 *
 * NO GROUNDING CORPUS REACHES THE BROWSER. The corpus is what DM is allowed to
 * *use* when answering, not a document anyone may browse, so the site publishes
 * none and this card fetches none. What it gets instead are two build-time
 * props, both of them things a visitor can already read off the page:
 *
 *   - `manifest` — the section anchors and project ids, which is all the
 *     allowlist in `dm-client.js` needs to police a page action;
 *   - `projects` — the same Work-card models the grid renders, used for
 *     citation chips and for resolving an `open` action to its href.
 */

/** Seed questions. These are sent verbatim to the service — nothing is canned. */
const SUGGESTED = [
  "Which project best fits a backend role?",
  "What has Dylan built with AI agents?",
  "Show me his strongest client work.",
  "How do I reach him?",
];

const LIT_MS = DM_LIT_MS;
const LIT_CONTACT_MS = DM_LIT_CONTACT_MS;

/**
 * A project href is followed only when it is an unambiguous same-origin path:
 * one leading slash with no authority behind it. Both `//host` and `/\host`
 * resolve to another origin, so both are rejected.
 */
const SAME_ORIGIN_PATH = /^\/(?![/\\])/;

let SEQ = 0;
const nextId = () => `dm-${++SEQ}`;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The collapsed state and visitor-selected size survive DM's own navigation.
 * Placement is recalculated from the page currently visible behind the card.
 */
const UI_KEY = "dm-card-ui";

function readUi() {
  try {
    const raw = window.sessionStorage.getItem(UI_KEY);
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function writeUi(ui) {
  try {
    window.sessionStorage.setItem(UI_KEY, JSON.stringify(ui));
  } catch {
    // Storage full or blocked: the card still works, it just forgets its chrome.
  }
}

function floatable() {
  return typeof window !== "undefined" && window.innerWidth >= 901;
}

function storedSize(value) {
  const size = value?.size;
  return size &&
    Number.isFinite(size.w) &&
    Number.isFinite(size.h) &&
    size.w >= 300 &&
    size.h >= 260
    ? { w: size.w, h: size.h }
    : null;
}

function desiredCardHeight(node, collapsed) {
  const style = window.getComputedStyle(node);
  const border =
    Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
  const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  const children = Array.from(node.children).filter(
    (child) => window.getComputedStyle(child).display !== "none",
  );
  const visible = collapsed ? children.slice(0, 1) : children;
  const gaps = Math.max(0, visible.length - 1) * (Number.parseFloat(style.rowGap) || 0);
  return Math.ceil(
    border +
      padding +
      gaps +
      visible.reduce((height, child) => height + Math.max(child.scrollHeight, child.offsetHeight), 0),
  );
}

/**
 * The four page actions, applied to the real site. `lit` and `litContact`
 * toggle the same classes the prototype drove (`.is-dm-lit`,
 * `.is-dm-lit-inline`), which mirror the card's own hover/:focus-within reveal;
 * every pending highlight is cleared when the card closes.
 */
function useDrive(projects) {
  const pending = useRef(new Set());

  useEffect(() => {
    const live = pending.current;
    return () => {
      live.forEach((entry) => entry.undo());
      live.clear();
    };
  }, []);

  return useMemo(() => {
    const flash = (node, className, ms) => {
      if (!node) return;
      node.classList.add(className);
      const entry = { undo: () => {} };
      const timer = window.setTimeout(() => {
        node.classList.remove(className);
        pending.current.delete(entry);
      }, ms);
      entry.undo = () => {
        window.clearTimeout(timer);
        node.classList.remove(className);
      };
      pending.current.add(entry);
    };

    // Resolved by dataset rather than a built selector, so no id from the wire
    // ever reaches querySelector.
    const cellFor = (projectId) =>
      Array.from(document.querySelectorAll(".frost-glitch-cell")).find(
        (cell) => cell.dataset.projectId === projectId
      ) ?? null;

    // The targeted verbs report whether this page could perform them: the card
    // also mounts on project pages, where the homepage's sections and Work
    // cards do not exist, and an unperformable action is carried home rather
    // than silently dropped.
    return {
      go(anchor) {
        const node = document.getElementById(anchor);
        if (!node) return false;
        node.scrollIntoView({
          behavior: prefersReducedMotion() ? "auto" : "smooth",
          block: "start",
        });
        return true;
      },
      lit(projectId) {
        const cell = cellFor(projectId);
        if (!cell) return false;
        flash(cell, "is-dm-lit", LIT_MS);
        return true;
      },
      open(projectId) {
        const href = projects.find((project) => project.id === projectId)?.href;
        // Same-origin paths only; these are the site's own build-time models,
        // and the id that selected one already cleared the allowlist.
        if (typeof href === "string" && SAME_ORIGIN_PATH.test(href)) {
          window.location.assign(href);
        }
      },
      litContact() {
        const node = document.querySelector(".frost-contact a");
        if (!node) return false;
        flash(node, "is-dm-lit-inline", LIT_CONTACT_MS);
        return true;
      },
    };
  }, [projects]);
}

/**
 * The conversation as the service will accept it back.
 *
 * The service is stateless, so the whole history is re-sent every turn — but it
 * will not take an anonymous caller's word for what DM previously said. Each
 * answer it streams is signed, and an assistant turn without that signature is
 * refused, taking the whole request with it. So a turn is replayable only if we
 * still hold its token.
 *
 * Unusable answers — failed, cancelled, still streaming, unsigned — are dropped
 * together with the question that produced them. The history is a run of
 * question/answer pairs; dropping half a pair would leave two visitor turns back
 * to back, which is not a shape the model should be handed.
 *
 * What goes back is `content`, the answer exactly as it streamed, not `text`,
 * the copy the card renders — the signature covers the former, and the latter
 * may have been clipped on the way to the DOM.
 */
function signedHistory(messages) {
  const history = [];
  for (let index = 0; index < messages.length; index += 1) {
    const question = messages[index];
    if (question.role !== "user") continue;
    const answer = messages[index + 1];
    if (!answer || answer.role === "user") continue;
    index += 1;
    if (!answer.token || !answer.content) continue;
    history.push({ role: "user", content: question.text });
    history.push({ role: "assistant", content: answer.content, token: answer.token });
  }
  return history;
}

/** Renders one answer: plain text while streaming, citation chips once done. */
function MessageBody({ text, done, projects, onCite }) {
  const segments = useMemo(
    () => (done ? linkifyCitations(text, projects) : [{ text }]),
    [done, text, projects]
  );

  return segments.map((segment, index) =>
    segment.projectId ? (
      <button
        key={index}
        type="button"
        className="frost-dmc-cite"
        onClick={() => onCite(segment.projectId)}
      >
        {segment.text}
      </button>
    ) : (
      <span key={index}>{segment.text}</span>
    )
  );
}

export default function DmCard({ endpoint, manifest = null, projects = [], onClose }) {
  const drive = useDrive(projects);
  // The stored conversation survives the page changes DM itself causes. What
  // comes back has already been shape-checked and capped; only ids are minted
  // fresh here.
  const [messages, setMessages] = useState(() =>
    readDmSession().messages.map((message) => ({ ...message, id: nextId() }))
  );
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef(null);
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const cardRef = useRef(null);

  const [collapsed, setCollapsed] = useState(() => readUi().collapsed === true);
  const [userSize, setUserSize] = useState(() => storedSize(readUi()));
  const [frame, setFrame] = useState(null);
  const [resizeFrame, setResizeFrame] = useState(null);
  const placementRef = useRef(null);

  useEffect(() => writeUi({ collapsed, size: userSize }), [collapsed, userSize]);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return undefined;
    let animationFrame = 0;

    const place = () => {
      animationFrame = 0;
      if (!floatable() || collapsed) {
        placementRef.current = null;
        setFrame(null);
        return;
      }
      const width = userSize?.w ?? Math.min(400, Math.max(320, window.innerWidth * 0.3));
      const next = chooseDmFrame({
        viewport: { width: window.innerWidth, height: window.innerHeight },
        desired: {
          width,
          height: userSize?.h ?? desiredCardHeight(card, collapsed),
        },
        obstacles: visibleDmObstacles(document.querySelector("main"), card),
        previousPlacement: placementRef.current,
      });
      placementRef.current = next.placement;
      setFrame((current) =>
        current &&
        current.x === next.x &&
        current.y === next.y &&
        current.w === next.w &&
        current.h === next.h
          ? current
          : next
      );
    };
    const schedule = () => {
      if (!animationFrame) animationFrame = window.requestAnimationFrame(place);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(card, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [collapsed, userSize]);

  const visibleFrame = resizeFrame ?? frame;
  const frameStyle =
    visibleFrame && floatable()
      ? {
          left: `${visibleFrame.x}px`,
          top: `${visibleFrame.y}px`,
          right: "auto",
          bottom: "auto",
          width: `${visibleFrame.w}px`,
          ...(collapsed ? {} : { height: `${visibleFrame.h}px` }),
        }
      : {};

  const onGripPointerDown = useCallback((event) => {
    if (!floatable() || collapsed) return;
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const placement = frame?.placement ?? "bottom-right";
    const rightAnchored = placement.endsWith("right");
    const bottomAnchored = placement.startsWith("bottom");
    const start = { x: event.clientX, y: event.clientY };
    let latest = { w: rect.width, h: rect.height };
    const move = (nextEvent) => {
      const dx = nextEvent.clientX - start.x;
      const dy = nextEvent.clientY - start.y;
      latest = {
        w: Math.round(Math.min(Math.max(300, rect.width + (rightAnchored ? -dx : dx)), 560)),
        h: Math.round(Math.min(Math.max(260, rect.height + (bottomAnchored ? -dy : dy)), 620)),
      };
      setResizeFrame({
        x: rightAnchored ? rect.right - latest.w : rect.left,
        y: bottomAnchored ? rect.bottom - latest.h : rect.top,
        w: latest.w,
        h: latest.h,
        placement,
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setUserSize(latest);
      setResizeFrame(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    event.preventDefault();
  }, [collapsed, frame]);

  const onGripKeyDown = useCallback((event) => {
    const step = event.shiftKey ? 48 : 16;
    const delta = {
      ArrowRight: [step, 0],
      ArrowLeft: [-step, 0],
      ArrowDown: [0, step],
      ArrowUp: [0, -step],
    }[event.key];
    if (!delta) return;
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    setUserSize({
      w: Math.min(Math.max(300, rect.width + delta[0]), 560),
      h: Math.min(Math.max(260, rect.height + delta[1]), 620),
    });
    event.preventDefault();
  }, []);

  const mailto = `mailto:${PROFILE.email}`;

  // Escape closes; the in-flight answer is cancelled by the unmount cleanup.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);

  // Focus belongs to a fresh open; a card restored mid-conversation by a page
  // load must not grab the keyboard from the page the visitor came to read.
  useEffect(() => {
    if (messages.length === 0) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  const cite = useCallback(
    (projectId) => {
      // A citation chip names one known project and behaves like its direct
      // link. It never detours through the homepage Work grid.
      drive.open(projectId);
    },
    [drive]
  );

  // The escape hatch for a transcript the service will no longer verify: wipe
  // the stored conversation and let the visitor start over in place.
  const reset = useCallback(() => {
    clearDmSession();
    writeDmSession({ open: true, messages: [] });
    setMessages([]);
  }, []);

  const ask = useCallback(
    async (question) => {
      const text = question.trim();
      if (!text || busy) return;

      const answerId = nextId();
      const history = signedHistory(messages);
      const asked = { id: nextId(), role: "user", text, state: "done" };

      setMessages((prior) => [
        ...prior,
        asked,
        { id: answerId, role: "dm", text: "", state: "streaming" },
      ]);
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const patch = (changes) =>
        setMessages((prior) =>
          prior.map((message) => (message.id === answerId ? { ...message, ...changes } : message))
        );

      // Navigation is a settle-time act: an `open` mid-stream would kill the
      // stream — the tail of the answer lost, the `done` token never issued,
      // the turn unreplayable. The queue holds it (and any action this page
      // cannot perform) until the turn is on disk.
      const queue = createTurnQueue({ allowNavigation: hasDmNavigationIntent(text) });
      const applyNow = (action) =>
        action.type === "go"
          ? drive.go(action.target)
          : action.type === "lit"
            ? drive.lit(action.target)
            : drive.litContact();
      // The display text, accumulated locally as well: settle persists the
      // turn synchronously, before any navigation, without waiting on state.
      let shown = "";

      try {
        const { reason, truncated, token, content } = await askDm({
          endpoint,
          manifest,
          signal: controller.signal,
          messages: [...history, { role: "user", content: text }],
          onText: (delta) => {
            shown += delta;
            setMessages((prior) =>
              prior.map((message) =>
                message.id === answerId ? { ...message, text: message.text + delta } : message
              )
            );
          },
          onAction: (action) => queue.offer(action, applyNow),
        });
        // `token` and `content` are what make the *next* question a follow-up
        // rather than a fresh conversation; `truncated` is what stops a
        // half-finished answer being shown as a whole one.
        const settled = {
          state: reason === "refusal" ? "refused" : "done",
          truncated,
          token,
          content,
        };
        patch(settled);
        // The whole turn is stored before any navigation can destroy it.
        writeDmSession({
          open: true,
          messages: [...messages, asked, { ...settled, id: answerId, role: "dm", text: shown }],
        });
        const nav = queue.settle();
        if (nav?.kind === "open") drive.open(nav.target);
      } catch (error) {
        if (controller.signal.aborted) return;
        // No canned pseudo-answer: say what happened and hand over the email —
        // or, when the service rejected the restored transcript itself, a
        // plain way to start over. An errored stream never navigates.
        const failed = {
          state: "failed",
          note: error?.message || "DM could not answer that.",
          reset: historyWasRejected(error, history),
        };
        patch(failed);
        writeDmSession({
          open: true,
          messages: [...messages, asked, { ...failed, id: answerId, role: "dm", text: shown }],
        });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setBusy(false);
      }
    },
    [busy, drive, endpoint, manifest, messages]
  );

  const submit = (event) => {
    event.preventDefault();
    const value = draft;
    setDraft("");
    ask(value);
  };

  return (
    <aside
      ref={cardRef}
      className={`frost-dmc${collapsed ? " is-collapsed" : ""}${resizeFrame ? " is-resizing" : ""}`}
      style={frameStyle}
      data-placement={frame?.placement}
      aria-label="DM, the portfolio agent"
    >
      <header className="frost-dmc-head">
        <strong>DM</strong>
        <span className="frost-kicker">Portfolio agent</span>
        <button
          className="frost-dmc-close"
          onClick={() => setCollapsed((current) => !current)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand DM" : "Collapse DM"}
        >
          {collapsed ? <ChevronUp size={16} /> : <Minus size={16} />}
        </button>
        <button className="frost-dmc-close" onClick={onClose} aria-label="Close DM">
          <X size={16} />
        </button>
      </header>

      {!collapsed && (
      <div className="frost-dmc-thread" role="log" aria-live="polite">
        {messages.length === 0 && (
          <p className="frost-dmc-empty">
            Ask about the projects, tradeoffs, and proof behind the work. Known project names are
            clickable.
          </p>
        )}

        {messages.map((message) =>
          message.role === "user" ? (
            <p key={message.id} className="frost-dmc-user">
              {message.text}
            </p>
          ) : (
            <p key={message.id} className="frost-dmc-answer">
              <MessageBody
                text={message.text}
                done={message.state === "done" || message.state === "refused"}
                projects={projects}
                onCite={cite}
              />
              {message.state === "streaming" && (
                <span className="frost-dmc-caret" aria-hidden="true" />
              )}
              {message.truncated && message.state !== "failed" && (
                <span className="frost-dmc-note">
                  That answer stops mid-thought: it hit DM&rsquo;s length limit. Ask for a
                  narrower slice of it and it will fit.
                </span>
              )}
              {message.state === "failed" &&
                (message.reset ? (
                  <span className="frost-dmc-note">
                    {message.note}{" "}
                    <button type="button" className="frost-dmc-reset" onClick={reset}>
                      Start a fresh conversation
                    </button>
                    .
                  </span>
                ) : (
                  <span className="frost-dmc-note">
                    {message.note} <a href={mailto}>Email Dylan directly</a>.
                  </span>
                ))}
              {message.state === "refused" && (
                <span className="frost-dmc-note">
                  That one is outside what this site publishes.{" "}
                  <a href={mailto}>Email Dylan directly</a>.
                </span>
              )}
            </p>
          )
        )}
        <div ref={endRef} />
      </div>
      )}

      {!collapsed && (
      <>
      <div className="frost-dmc-suggested">
        {SUGGESTED.map((question) => (
          <button
            key={question}
            type="button"
            disabled={busy}
            onClick={() => ask(question)}
          >
            {question}
          </button>
        ))}
      </div>

      <form className="frost-dmc-form" onSubmit={submit}>
        <input
          ref={inputRef}
          value={draft}
          placeholder="Ask DM about the work…"
          aria-label="Ask DM about the work"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={busy || !draft.trim()}>
          Ask
        </button>
      </form>

      {/* Said plainly, once: the answers are generated off-site, so the
          question goes off-site too. */}
      <p className="frost-dmc-egress">Questions are sent to DM&rsquo;s service to be answered.</p>

      <button
        type="button"
        className="frost-dmc-grip"
        aria-label="Resize DM (arrow keys resize; hold shift for larger steps)"
        onPointerDown={onGripPointerDown}
        onKeyDown={onGripKeyDown}
      >
        <span aria-hidden="true" />
      </button>
      </>
      )}
    </aside>
  );
}
