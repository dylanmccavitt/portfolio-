import { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { DefaultChatTransport } from "ai";
import {
  AGENT_NAME,
  DM_ENDPOINT,
  SUGGESTED,
  completedAssistantHistoryText,
  validateFinalizationResult,
} from "@/lib/dm/client";
import {
  dmPageContextId,
  isAllowedGuideActionDestination,
  parseDMPageContext,
} from "@/lib/dm/guide";
import {
  beginGuideHistoryTurn,
  completeGuideHistoryTurn,
  rollbackGuideHistoryTurn,
} from "@/lib/dm/guide-history";
import { PROFILE } from "./frost-data.js";

const PAGE = parseDMPageContext({ kind: "home", path: "/" });
const PAGE_ID = dmPageContextId(PAGE);

const TOOL_SUMMARIES = {
  searchProjects: "Search published projects",
  getProject: "Read a published project",
  readResume: "Read public resume facts",
  getContact: "Read public contact details",
  searchProfile: "Search published profile facts",
};

const FALLBACK_ERROR = `${AGENT_NAME} is unavailable right now. Please try again in a moment.`;

function uiTextMessage(role, text) {
  return {
    id: crypto.randomUUID(),
    role,
    metadata: { pageContextId: PAGE_ID },
    parts: [{ type: "text", text }],
  };
}

function toolLabel(name) {
  return `${name} · ${TOOL_SUMMARIES[name] ?? "Use a public portfolio tool"}`;
}

/** Prose the endpoint validator accepts back as assistant history for this turn. */
function turnHistoryText(turn) {
  if (turn.answer) {
    const text = [...turn.answer.segments.map((segment) => segment.text), ...turn.answer.limitations]
      .filter(Boolean)
      .join("\n\n");
    return completedAssistantHistoryText(text, true);
  }
  return null;
}

function EmailFallback() {
  return (
    <p className="frost-dm-fallback">
      You can still reach Dylan directly at{" "}
      <a href={`mailto:${PROFILE.email}`}>{PROFILE.email}</a>.
    </p>
  );
}

function AnswerBody({ turn }) {
  const answer = turn.answer;
  if (!answer) {
    return turn.streamedText ? <p>{turn.streamedText}</p> : null;
  }
  const actions = answer.actions.filter((action) => isAllowedGuideActionDestination(action.href));
  const linkItems = answer.artifacts.filter((artifact) => artifact.kind === "links").flatMap((artifact) => artifact.items);
  const projects = answer.artifacts.filter((artifact) => artifact.kind === "project");
  const tracks = answer.artifacts.filter((artifact) => artifact.kind === "resume");
  const contact = answer.artifacts.find((artifact) => artifact.kind === "contact");
  const sources = answer.artifacts.filter((artifact) => artifact.kind === "evidence");
  return (
    <>
      {answer.segments.map((segment, index) => (
        <p key={`s-${index}`}>{segment.text}</p>
      ))}
      {answer.limitations.map((limitation, index) => (
        <p key={`l-${index}`} className="frost-dm-limit">{limitation}</p>
      ))}
      {projects.map((artifact) => (
        <a key={artifact.id} className="frost-dm-card" href={artifact.project.href}>
          <strong>{artifact.project.title}</strong>
          <span>{artifact.project.tagline}</span>
          <small>{artifact.project.area} · {artifact.project.year}</small>
        </a>
      ))}
      {tracks.map((artifact) => (
        <div key={artifact.id} className="frost-dm-card">
          <strong>{artifact.track.title}</strong>
          <span>{artifact.track.role}</span>
          <small>{artifact.track.when}</small>
        </div>
      ))}
      {contact && (
        <div className="frost-dm-card">
          <a href={`mailto:${contact.contact.email}`}>{contact.contact.email}</a>
          <a href={contact.contact.github} target="_blank" rel="noopener">
            {contact.contact.github.replace(/^https?:\/\//, "")}
          </a>
          <small>{contact.contact.location} · {contact.contact.status}</small>
        </div>
      )}
      {sources.map((artifact) => (
        <div key={artifact.id} className="frost-dm-card">
          <small>Public source</small>
          <strong>{artifact.source.label}</strong>
          <span>
            {artifact.source.text.length > 180
              ? `${artifact.source.text.slice(0, 177)}…`
              : artifact.source.text}
          </span>
        </div>
      ))}
      {(actions.length > 0 || linkItems.length > 0) && (
        <nav className="frost-dm-chips" aria-label="Suggested next steps">
          {actions.map((action) => (
            <a key={action.id} href={action.href}>{action.label}</a>
          ))}
          {linkItems.map((item) => (
            <a key={item.href} href={item.href} target="_blank" rel="noopener">{item.label}</a>
          ))}
        </nav>
      )}
    </>
  );
}

export default function DmChat() {
  const [turns, setTurns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const transportRef = useRef(null);
  const historyRef = useRef([]);
  const controllerRef = useRef(null);
  const threadRef = useRef(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const patchTurn = (id, patch) => {
    setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn)));
  };

  const ask = async (question) => {
    const message = question.trim();
    if (!message || busy) return;
    setBusy(true);

    transportRef.current ??= new DefaultChatTransport({ api: DM_ENDPOINT });
    const history = historyRef.current;
    const historyTurn = beginGuideHistoryTurn(history, 0, uiTextMessage("user", message));

    const id = crypto.randomUUID();
    const live = { id, question: message, tools: [], streamedText: "", answer: null, error: null, done: false };
    setTurns((current) => [...current, { ...live }]);

    const controller = new AbortController();
    controllerRef.current = controller;
    const announced = new Set();
    const toolCalls = new Map();

    const acceptFinalization = (value) => {
      if (live.answer) return;
      const result = validateFinalizationResult(value);
      if (result && result.status !== "rejected") {
        live.answer = result.answer;
        patchTurn(id, { answer: result.answer });
      }
    };

    try {
      const stream = await transportRef.current.sendMessages({
        trigger: "submit-message",
        chatId: "dm-public",
        messageId: undefined,
        messages: history.slice(-13),
        abortSignal: controller.signal,
        body: { context: { page: PAGE } },
      });
      for await (const chunk of stream) {
        if (chunk.type === "tool-input-start" || chunk.type === "tool-input-available") {
          toolCalls.set(chunk.toolCallId, chunk.toolName);
          if (chunk.toolName !== "finalizeAnswer" && !announced.has(chunk.toolCallId)) {
            announced.add(chunk.toolCallId);
            live.tools = [...live.tools, { id: chunk.toolCallId, name: chunk.toolName }];
            patchTurn(id, { tools: live.tools });
          }
        } else if (chunk.type === "text-delta") {
          live.streamedText += chunk.delta;
          patchTurn(id, { streamedText: live.streamedText });
        } else if (chunk.type === "data-dm-answer") {
          acceptFinalization(chunk.data);
        } else if (chunk.type === "tool-output-available") {
          if (toolCalls.get(chunk.toolCallId) === "finalizeAnswer") acceptFinalization(chunk.output);
        } else if (chunk.type === "error") {
          live.error = chunk.errorText || FALLBACK_ERROR;
          patchTurn(id, { error: live.error });
        }
      }
      if (!live.answer && !live.error) {
        live.error = `${AGENT_NAME} didn't return a verified answer. Please try rephrasing the question.`;
      }
    } catch (error) {
      if (error?.name === "AbortError") {
        rollbackGuideHistoryTurn(history, historyTurn, 0);
        patchTurn(id, { done: true, error: `${AGENT_NAME} stopped this answer.` });
        return;
      }
      live.error = FALLBACK_ERROR;
    } finally {
      const assistantText = turnHistoryText(live);
      completeGuideHistoryTurn(history, historyTurn, 0, assistantText ? uiTextMessage("assistant", assistantText) : null);
      patchTurn(id, { done: true, error: live.error });
      controllerRef.current = null;
      setBusy(false);
    }
  };

  const submit = (event) => {
    event.preventDefault();
    const text = input;
    setInput("");
    void ask(text);
  };

  return (
    <div className="frost-dm-chat">
      <div className="frost-dm-thread" ref={threadRef} aria-live="polite">
        {turns.length === 0 && (
          <div className="frost-dm-suggested">
            {SUGGESTED.slice(0, 4).map((prompt) => (
              <button key={prompt.label} type="button" onClick={() => void ask(prompt.label)}>
                {prompt.label}
              </button>
            ))}
          </div>
        )}
        {turns.map((turn) => (
          <article key={turn.id} className="frost-dm-turn">
            <p className="frost-dm-user">
              <span>You asked</span>
              {turn.question}
            </p>
            {turn.tools.length > 0 && (
              <ul className="frost-dm-tools">
                {turn.tools.map((tool) => (
                  <li key={tool.id}>{toolLabel(tool.name)}</li>
                ))}
              </ul>
            )}
            {!turn.done && !turn.answer && !turn.streamedText && (
              <p className="frost-dm-working">{AGENT_NAME} is working…</p>
            )}
            <div className="frost-dm-answer">
              <AnswerBody turn={turn} />
              {turn.done && turn.error && !turn.answer && (
                <div className="frost-dm-error">
                  <p>{turn.error}</p>
                  <EmailFallback />
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
      <form className="frost-dm-form" onSubmit={submit}>
        <input
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={`Ask ${AGENT_NAME} about the work, the journey, or how to reach Dylan`}
          aria-label={`Ask ${AGENT_NAME} a question`}
          maxLength={4000}
        />
        {busy ? (
          <button type="button" onClick={() => controllerRef.current?.abort()}>
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()}>
            Ask <ArrowUpRight size={14} />
          </button>
        )}
      </form>
    </div>
  );
}
