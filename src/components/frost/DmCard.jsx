import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronUp, Minus, X } from "lucide-react";
import { PROFILE } from "./frost-data.js";
import { askDm, linkifyCitations } from "./dm-client.js";
import {
  DM_LIT_CONTACT_MS,
  DM_LIT_MS,
  clearDmSession,
  createTurnQueue,
  historyWasRejected,
  readDmSession,
  stashDmActions,
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
 * their signature tokens) in sessionStorage, so the navigation an `open`
 * action performs does not end the conversation — and actions this page
 * cannot perform are carried to the homepage rather than dropped.
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
  "Give me the tour.",
  "What has Dylan built with AI agents?",
  "Show me his client work.",
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
 * Card chrome state — collapsed / dragged-to / resized-to — kept in its own
 * sessionStorage key, deliberately outside `dm-session.js`: that module's
 * strict schema guards conversation integrity, and where the card sits on
 * screen is not part of the conversation.
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
    // Storage full or blocked: the card still works, it just forgets its spot.
  }
}

/** Dragging and resizing are desktop affordances; below the card's own
    full-width mobile breakpoint it keeps the fixed corner. */
function floatable() {
  return typeof window !== "undefined" && window.innerWidth >= 901;
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

  // Chrome state: collapse to the header bar, drag by the header, resize from
  // the corner. All of it survives DM's own navigations like the conversation.
  const [collapsed, setCollapsed] = useState(() => readUi().collapsed === true);
  const [frame, setFrame] = useState(() => {
    const ui = readUi();
    return { pos: ui.pos ?? null, size: ui.size ?? null };
  });

  const clampPos = useCallback((pos, size) => {
    const width = size?.w ?? cardRef.current?.offsetWidth ?? 344;
    const maxX = Math.max(8, window.innerWidth - width - 8);
    const maxY = Math.max(8, window.innerHeight - 56);
    return {
      x: Math.min(Math.max(8, pos.x), maxX),
      y: Math.min(Math.max(8, pos.y), maxY),
    };
  }, []);

  /** Switches the card from its corner anchor to explicit coordinates, so a
      drag or a corner resize grows from a fixed top-left instead of walking
      off the bottom-right of the screen. */
  const freeze = useCallback(() => {
    const node = cardRef.current;
    if (!node) return;
    // Read the rect outside the updater: updaters must stay pure, and React
    // may run them more than once.
    const rect = node.getBoundingClientRect();
    setFrame((current) =>
      current.pos ? current : { ...current, pos: { x: rect.left, y: rect.top } }
    );
  }, []);

  const onHeadPointerDown = useCallback(
    (event) => {
      if (!floatable() || event.target.closest("button")) return;
      const rect = cardRef.current?.getBoundingClientRect();
      if (!rect) return;
      freeze();
      const grip = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
      const move = (e) =>
        setFrame((current) => ({
          ...current,
          pos: clampPos({ x: e.clientX - grip.dx, y: e.clientY - grip.dy }, current.size),
        }));
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      event.preventDefault();
    },
    [clampPos, freeze]
  );

  // The native CSS resize handle lives in the bottom-right corner; a press
  // there freezes the anchor first so the growth direction makes sense, and
  // marks a resize in progress — the ResizeObserver below records the card's
  // size ONLY during that window, so layout-driven growth (a long conversation
  // reflowing) can never masquerade as a size the visitor chose.
  const sizingRef = useRef(false);
  const onCardPointerDown = useCallback(
    (event) => {
      if (!floatable() || collapsed) return;
      const rect = cardRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (rect.right - event.clientX > 18 || rect.bottom - event.clientY > 18) return;
      sizingRef.current = true;
      freeze();
      window.addEventListener(
        "pointerup",
        () => {
          sizingRef.current = false;
        },
        { once: true }
      );
    },
    [collapsed, freeze]
  );

  // Persist what the visitor chose; remember the resized footprint.
  useEffect(() => {
    writeUi({ collapsed, pos: frame.pos, size: frame.size });
  }, [collapsed, frame]);

  useEffect(() => {
    const node = cardRef.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      // A size is recorded only while the visitor is dragging the corner.
      if (!sizingRef.current || collapsed || !floatable()) return;
      setFrame((current) => {
        const size = { w: node.offsetWidth, h: node.offsetHeight };
        if (current.size && current.size.w === size.w && current.size.h === size.h) return current;
        return { ...current, size };
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [collapsed]);

  // A window resize must not leave the card stranded outside the viewport.
  useEffect(() => {
    const onResize = () =>
      setFrame((current) =>
        current.pos ? { ...current, pos: clampPos(current.pos, current.size) } : current
      );
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampPos]);

  const frameStyle = {};
  if (floatable() && frame.pos) {
    frameStyle.left = `${frame.pos.x}px`;
    frameStyle.top = `${frame.pos.y}px`;
    frameStyle.right = "auto";
    frameStyle.bottom = "auto";
  }
  if (floatable() && frame.size && !collapsed) {
    frameStyle.width = `${frame.size.w}px`;
    frameStyle.height = `${frame.size.h}px`;
  }

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
      // Cited on a page without the Work grid, the chip carries the visitor
      // home instead of doing nothing; both ids re-clear the allowlist there.
      const went = drive.go("work");
      const lit = drive.lit(projectId);
      if (!went && !lit) {
        stashDmActions([
          { type: "go", target: "work" },
          { type: "lit", target: projectId },
        ]);
        window.location.assign("/");
      }
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
      const queue = createTurnQueue();
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
        else if (nav?.kind === "home") {
          stashDmActions(nav.actions);
          window.location.assign("/");
        }
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
      className={`frost-dmc${collapsed ? " is-collapsed" : ""}${frame.size ? " is-sized" : ""}`}
      style={frameStyle}
      onPointerDown={onCardPointerDown}
      aria-label="DM, the portfolio agent"
    >
      <header className="frost-dmc-head" onPointerDown={onHeadPointerDown}>
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
            DM answers from this site&rsquo;s own published facts and drives the site while it
            talks. Cited project names are clickable.
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
      </>
      )}
    </aside>
  );
}
