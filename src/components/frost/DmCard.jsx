import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { PROFILE } from "./frost-data.js";
import { askDm, linkifyCitations } from "./dm-client.js";

/**
 * DM — the corner card. A small floating conversation surface that never takes
 * the page over: it drives the site behind itself (scroll, glitch-lit Work
 * cards, project open, contact fringe) while it answers.
 *
 * The conversation is real. `dm-client.js` streams it from the configured
 * service over SSE and enforces the action allowlist; this component only
 * renders text and applies the four vetted page actions.
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
  "What has Dylan built with AI agents?",
  "Show me his client work.",
  "How do I reach him?",
];

const LIT_MS = 3600;
const LIT_CONTACT_MS = 3200;

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

    return {
      go(anchor) {
        document.getElementById(anchor)?.scrollIntoView({
          behavior: prefersReducedMotion() ? "auto" : "smooth",
          block: "start",
        });
      },
      lit(projectId) {
        flash(cellFor(projectId), "is-dm-lit", LIT_MS);
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
        flash(document.querySelector(".frost-contact a"), "is-dm-lit-inline", LIT_CONTACT_MS);
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
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef(null);
  const endRef = useRef(null);
  const inputRef = useRef(null);

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

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const cite = useCallback(
    (projectId) => {
      drive.go("work");
      drive.lit(projectId);
    },
    [drive]
  );

  const ask = useCallback(
    async (question) => {
      const text = question.trim();
      if (!text || busy) return;

      const answerId = nextId();
      const history = signedHistory(messages);

      setMessages((prior) => [
        ...prior,
        { id: nextId(), role: "user", text, state: "done" },
        { id: answerId, role: "dm", text: "", state: "streaming" },
      ]);
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const patch = (changes) =>
        setMessages((prior) =>
          prior.map((message) => (message.id === answerId ? { ...message, ...changes } : message))
        );

      try {
        const { reason, truncated, token, content } = await askDm({
          endpoint,
          manifest,
          signal: controller.signal,
          messages: [...history, { role: "user", content: text }],
          onText: (delta) =>
            setMessages((prior) =>
              prior.map((message) =>
                message.id === answerId ? { ...message, text: message.text + delta } : message
              )
            ),
          onAction: (action) => {
            if (action.type === "go") drive.go(action.target);
            else if (action.type === "lit") drive.lit(action.target);
            else if (action.type === "open") drive.open(action.target);
            else if (action.type === "litContact") drive.litContact();
          },
        });
        // `token` and `content` are what make the *next* question a follow-up
        // rather than a fresh conversation; `truncated` is what stops a
        // half-finished answer being shown as a whole one.
        patch({
          state: reason === "refusal" ? "refused" : "done",
          truncated,
          token,
          content,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        // No canned pseudo-answer: say what happened and hand over the email.
        patch({ state: "failed", note: error?.message || "DM could not answer that." });
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
    <aside className="frost-dmc" aria-label="DM, the portfolio agent">
      <header className="frost-dmc-head">
        <strong>DM</strong>
        <span className="frost-kicker">Portfolio agent</span>
        <button className="frost-dmc-close" onClick={onClose} aria-label="Close DM">
          <X size={16} />
        </button>
      </header>

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
                  That answer stops mid-thought &mdash; it hit DM&rsquo;s length limit. Ask for a
                  narrower slice of it and it will fit.
                </span>
              )}
              {message.state === "failed" && (
                <span className="frost-dmc-note">
                  {message.note} <a href={mailto}>Email Dylan directly</a>.
                </span>
              )}
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
    </aside>
  );
}
