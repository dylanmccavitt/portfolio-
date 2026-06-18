/**
 * PROTOTYPE — throwaway, do not ship.
 *
 * Shared canned-conversation dataset for the chat-first agent landing
 * prototypes (`/prototype/agent?variant=A|B|C`). The real thing will be a
 * Vercel **Eve** agent (an `agent/` directory: `instructions.md` + TS tools
 * like `search_catalog` / `read_resume` / `get_contact`, streamed through the
 * AI SDK). Here every answer is pre-written so the UI variants can be judged on
 * *layout + flow* without a backend.
 *
 * Each variant imports this module (the "data fetching" all variants share),
 * then renders the turns in its own structurally-distinct way. The interaction
 * driver (`_agentProto.client.ts`) reveals turns by id on chip-click / submit.
 */

import { CATALOG, type Project } from '../../data/catalog';
import { RESUME, type ResumeTrack } from '../../data/resume';

/** The portfolio agent's name (matches the Eve "an agent is a directory" pitch). */
export const AGENT_NAME = 'Eve';

/** Empty-state greeting shown before the first question. */
export const GREETING =
  "I'm Eve — Dylan's portfolio agent. Ask me anything about his work, his background, or whether he's the right fit for your team.";

/** Sub-greeting / capability line for variants that want a second line. */
export const SUBGREETING =
  'I can pull up projects, walk his résumé, or get you his contact details.';

export interface SuggestedPrompt {
  /** Matches a {@link Turn} id. */
  id: string;
  label: string;
  /** Short mono tag some variants show (e.g. a tool hint). */
  hint?: string;
}

/** Starter chips shown in the empty state. Order = display order. */
export const SUGGESTED: SuggestedPrompt[] = [
  { id: 'now', label: "What's Dylan building right now?", hint: 'search_catalog' },
  { id: 'impressive', label: 'Show me his most impressive project', hint: 'rank_projects' },
  { id: 'background', label: "What's his background?", hint: 'read_resume' },
  { id: 'trading', label: 'Does he have trading experience?', hint: 'filter_catalog' },
  { id: 'ios', label: 'Can he ship iOS apps?', hint: 'filter_catalog' },
  { id: 'hire', label: 'Is he open to work? How do I reach him?', hint: 'get_contact' },
];

/** A rendered chunk of an agent answer. Variants own the visual treatment. */
export type AnswerBlock =
  | { kind: 'text'; text: string }
  | { kind: 'projects'; ids: string[] }
  | { kind: 'resume'; trackIds: string[] }
  | { kind: 'contact' }
  | { kind: 'links'; items: [label: string, href: string][] };

/** One Q&A turn. `trace` fakes the Eve tool-call log shown while "thinking". */
export interface Turn {
  /** Stable id; matches a {@link SuggestedPrompt} id and the DOM hook. */
  id: string;
  /** The visitor's question, echoed as a user bubble. */
  q: string;
  /** Fake tool-call trace lines (Eve uses file-based TS tools). */
  trace: string[];
  answer: AnswerBlock[];
}

export const CONVERSATION: Turn[] = [
  {
    id: 'now',
    q: "What's Dylan building right now?",
    trace: ["search_catalog({ status: 'building' })", 'read · agentic-trader · exit-manager · tradingview-mcp'],
    answer: [
      {
        kind: 'text',
        text: "Right now his focus is autonomous trading and agent infrastructure. Three things are active:",
      },
      { kind: 'projects', ids: ['agentic-trader', 'exit-manager', 'tradingview-mcp'] },
      {
        kind: 'text',
        text: 'exit-manager is already running against real money; agentic-trader is in dry-run and goes live June 23. Want the details on any of these?',
      },
    ],
  },
  {
    id: 'impressive',
    q: 'Show me his most impressive project',
    trace: ["rank_projects({ by: 'real-world impact' })", 'open · exit-manager'],
    answer: [
      {
        kind: 'text',
        text: "If I had to pick one: tastytrade-exit-manager. It manages exits on live options positions — software-managed stops for spreads that brokers don't support natively — and it's been running against real money since spring 2026.",
      },
      { kind: 'projects', ids: ['exit-manager'] },
      {
        kind: 'text',
        text: 'A close runner-up is agentic-trader: an autonomous agent whose safety comes from deterministic risk gates, not from trusting the model.',
      },
      { kind: 'projects', ids: ['agentic-trader'] },
    ],
  },
  {
    id: 'background',
    q: "What's his background?",
    trace: ['read_resume()'],
    answer: [
      {
        kind: 'text',
        text: "His path isn't a straight CS line — it's economics → legal ops → cyber risk → engineering:",
      },
      { kind: 'resume', trackIds: ['syracuse', 'paulweiss', 'kroll', 'stevens', 'now'] },
      {
        kind: 'text',
        text: 'The discipline from Kroll (cyber risk) and Paul, Weiss (private funds) shows up directly in how he builds trading systems: risk gates, paper-first scaffolds, read-only defaults.',
      },
    ],
  },
  {
    id: 'trading',
    q: 'Does he have trading experience?',
    trace: ["filter_catalog({ area: 'Trading systems' })"],
    answer: [
      { kind: 'text', text: 'Yes — trading systems are his core area. A few:' },
      { kind: 'projects', ids: ['exit-manager', 'hood', 'agentic-trader', 'condor-study'] },
      {
        kind: 'text',
        text: 'He even retired a strategy — the 0DTE condor study — with a written post-mortem once it showed no edge after costs. Knowing when to stop is part of the skill.',
      },
    ],
  },
  {
    id: 'ios',
    q: 'Can he ship iOS apps?',
    trace: ["filter_catalog({ area: 'iOS' })"],
    answer: [
      { kind: 'text', text: 'He ships native iOS. Two apps are in flight:' },
      { kind: 'projects', ids: ['dog-log', 'chore-ladder'] },
      {
        kind: 'text',
        text: 'dog log is at v1.2 heading into App Store review (widgets, shared households); chore ladder is on TestFlight with a pro tier.',
      },
    ],
  },
  {
    id: 'hire',
    q: 'Is he open to work? How do I reach him?',
    trace: ["read_resume({ track: 'now' })", 'get_contact()'],
    answer: [
      {
        kind: 'text',
        text: 'Yes — Dylan is open to full-time software roles (agents, trading infrastructure, iOS), based in New York City. US citizen, no sponsorship needed.',
      },
      { kind: 'contact' },
      { kind: 'text', text: 'Want me to point you at a specific project, or pull up his résumé?' },
    ],
  },
  {
    id: 'fallback',
    q: 'Tell me about Dylan',
    trace: ['route_question()'],
    answer: [
      {
        kind: 'text',
        text: "Happy to. Dylan's a software engineer in NYC working on agents, trading infrastructure, and iOS. Here's where I'd start — pick one and I'll go deeper:",
      },
      { kind: 'links', items: [] },
    ],
  },
];

/** Contact details rendered by `kind: 'contact'` blocks. */
export const CONTACT = {
  email: 'dylanmccavitt@outlook.com',
  github: 'https://github.com/DylanMcCavitt',
  resume: '/resume.pdf',
  location: 'New York City',
  status: 'Open to opportunities',
} as const;

/** Look up a catalog project by id (throws on typo so a bad ref fails loud). */
export function projectById(id: string): Project {
  const p = CATALOG.find((x) => x.id === id);
  if (!p) throw new Error(`_agentData: unknown project id "${id}"`);
  return p;
}

/** Look up a résumé track by id (throws on typo). */
export function trackById(id: string): ResumeTrack {
  const t = RESUME.tracks.find((x) => x.id === id);
  if (!t) throw new Error(`_agentData: unknown resume track id "${id}"`);
  return t;
}

/** Resolve a turn by id, falling back to the generic router turn. */
export function turnById(id: string): Turn {
  return CONVERSATION.find((t) => t.id === id) ?? CONVERSATION[CONVERSATION.length - 1];
}
