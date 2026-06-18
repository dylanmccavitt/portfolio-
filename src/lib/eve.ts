/**
 * Eve landing — client contract for the Split-canvas chat UI (#86).
 *
 * This module is the UI's view of the runtime contract owned by the Eve agent
 * endpoint (#84). It defines the **answer-block** shapes the surface renders,
 * the **stream-event** envelope the client consumes, a tolerant NDJSON parser,
 * and id resolvers against the canonical `catalog.ts` / `resume.ts` data.
 *
 * Boundary: the server (#84) owns the agent, tools, model/provider, and the
 * `/api/eve/chat` endpoint that emits this stream. This file owns nothing
 * server-side; it only describes what the landing reads. When #84 ships its
 * canonical endpoint types, these should be consolidated against them — they
 * are kept deliberately small and faithful to the prototype answer-block
 * contract (`src/pages/prototype/_agentData.ts`) so that consolidation is a
 * rename, not a redesign.
 *
 * Wire format (documented so #84 can conform): the endpoint accepts
 *   POST /api/eve/chat  { message: string, history?: ChatMessage[] }
 * and replies with **NDJSON** — one JSON {@link StreamEvent} per line. A
 * `data: ` SSE prefix is tolerated but not required. The stream ends when the
 * response body closes.
 */

import { CATALOG, type Project } from '../data/catalog';
import { RESUME, type ResumeTrack } from '../data/resume';

/** The portfolio agent's name. */
export const AGENT_NAME = 'Eve';

/** Streaming chat endpoint owned by #84. Relative so it follows the origin. */
export const EVE_ENDPOINT = '/api/eve/chat';

/** Empty-state greeting shown before the first question. */
export const GREETING =
  "I'm Eve — Dylan's portfolio agent. Ask me anything about his work, his background, or whether he's the right fit for your team.";

/** Sub-greeting / capability line under the greeting. */
export const SUBGREETING =
  'I can pull up projects, walk his résumé, or get you his contact details.';

/**
 * Eve's file-based tools, shown in the sidebar `agent/tools/` directory. Display
 * only — the authoritative tool set lives in the agent runtime (#84); this list
 * sells the "an agent is a directory" identity and mirrors that tool surface.
 */
export const EVE_TOOLS = [
  'search_catalog',
  'rank_projects',
  'read_resume',
  'filter_catalog',
  'get_contact',
] as const;

/** A starter prompt chip. `hint` is the tool it will likely lean on (flavor). */
export interface SuggestedPrompt {
  label: string;
  hint?: string;
}

/**
 * Empty-state starter prompts. These submit their `label` as a real question to
 * the endpoint — they are seed *questions*, not canned answers, so shipping them
 * does not reintroduce the prototype's canned routing/data as the answer source.
 */
export const SUGGESTED: SuggestedPrompt[] = [
  { label: "What's Dylan building right now?", hint: 'search_catalog' },
  { label: 'Show me his most impressive project', hint: 'rank_projects' },
  { label: "What's his background?", hint: 'read_resume' },
  { label: 'Does he have trading experience?', hint: 'filter_catalog' },
  { label: 'Can he ship iOS apps?', hint: 'filter_catalog' },
  { label: 'Is he open to work? How do I reach him?', hint: 'get_contact' },
];

/** Resolved contact fields rendered by the contact artifact. */
export interface Contact {
  email: string;
  github: string;
  resume: string;
  location: string;
  status: string;
}

/**
 * UI fallback contact card. The production `get_contact` tool (#84) is the
 * authoritative source and its payload overrides these per-field (see
 * {@link ContactBlock}); this fallback lets the contact artifact render before
 * the endpoint is wired. These are the same facts already carried in the résumé
 * `now` track and site metadata — not new content.
 */
export const CONTACT: Contact = {
  email: 'dylanmccavitt@outlook.com',
  github: 'https://github.com/DylanMcCavitt',
  resume: '/resume.pdf',
  location: 'New York City',
  status: 'Open to opportunities',
} as const;

// ---------------------------------------------------------------------------
// Answer blocks — the rendering contract (preserved from the prototype).
// ---------------------------------------------------------------------------

export interface TextBlock {
  kind: 'text';
  text: string;
}
export interface ProjectsBlock {
  kind: 'projects';
  ids: string[];
}
export interface ResumeBlock {
  kind: 'resume';
  trackIds: string[];
}
/** Contact fields are optional; the UI merges them over {@link CONTACT}. */
export interface ContactBlock {
  kind: 'contact';
  email?: string;
  github?: string;
  resume?: string;
  location?: string;
  status?: string;
}
export interface LinksBlock {
  kind: 'links';
  items: [label: string, href: string][];
}

/** A rendered chunk of an Eve answer. */
export type AnswerBlock =
  | TextBlock
  | ProjectsBlock
  | ResumeBlock
  | ContactBlock
  | LinksBlock;

/** The answer-block kinds the surface knows how to render. */
const BLOCK_KINDS = new Set(['text', 'projects', 'resume', 'contact', 'links']);

// ---------------------------------------------------------------------------
// Stream events — the NDJSON envelope the client consumes.
// ---------------------------------------------------------------------------

/** A tool-call trace line; drives the live "working…" log + USED N tools. */
export interface ToolEvent {
  type: 'tool';
  name: string;
  /** Optional one-line, secret-free summary of the call. */
  summary?: string;
}
/** A streamed token delta appended to the current/open text block. */
export interface TextDeltaEvent {
  type: 'text-delta';
  delta: string;
}
/** A finalized answer block (text, projects, resume, contact, links). */
export interface BlockEvent {
  type: 'block';
  block: AnswerBlock;
}
/** A server-side error surfaced gracefully to the visitor. */
export interface ErrorEvent {
  type: 'error';
  message: string;
}

export type StreamEvent = ToolEvent | TextDeltaEvent | BlockEvent | ErrorEvent;

/** One message of conversation context sent back for multi-turn continuity. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ---------------------------------------------------------------------------
// Parsing + validation — pure, DOM-free, unit-testable.
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Validate an untrusted block payload. Returns a typed {@link AnswerBlock} or
 * `null` for unknown/malformed shapes so the renderer can skip it without
 * breaking the conversation surface.
 */
export function validateBlock(value: unknown): AnswerBlock | null {
  if (!isObject(value) || typeof value.kind !== 'string') return null;
  if (!BLOCK_KINDS.has(value.kind)) return null;
  switch (value.kind) {
    case 'text':
      return typeof value.text === 'string' ? { kind: 'text', text: value.text } : null;
    case 'projects':
      return Array.isArray(value.ids) && value.ids.every((id) => typeof id === 'string')
        ? { kind: 'projects', ids: value.ids as string[] }
        : null;
    case 'resume':
      return Array.isArray(value.trackIds) &&
        value.trackIds.every((id) => typeof id === 'string')
        ? { kind: 'resume', trackIds: value.trackIds as string[] }
        : null;
    case 'contact': {
      const out: ContactBlock = { kind: 'contact' };
      for (const key of ['email', 'github', 'resume', 'location', 'status'] as const) {
        if (typeof value[key] === 'string') out[key] = value[key] as string;
      }
      return out;
    }
    case 'links': {
      if (!Array.isArray(value.items)) return null;
      const items = value.items.filter(
        (item): item is [string, string] =>
          Array.isArray(item) &&
          item.length === 2 &&
          typeof item[0] === 'string' &&
          typeof item[1] === 'string',
      );
      return { kind: 'links', items };
    }
    default:
      return null;
  }
}

/**
 * Parse a single NDJSON line into a {@link StreamEvent}, or `null` if the line
 * is blank, not JSON, or not a recognized event. Tolerant of an SSE `data: `
 * prefix. Never throws — a bad line is skipped, the stream continues.
 */
export function parseStreamLine(line: string): StreamEvent | null {
  let text = line.trim();
  if (!text) return null;
  if (text.startsWith('data:')) text = text.slice(5).trim();
  if (!text || text === '[DONE]') return null;

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw) || typeof raw.type !== 'string') return null;

  switch (raw.type) {
    case 'tool':
      return typeof raw.name === 'string'
        ? {
            type: 'tool',
            name: raw.name,
            ...(typeof raw.summary === 'string' ? { summary: raw.summary } : {}),
          }
        : null;
    case 'text-delta':
      return typeof raw.delta === 'string' ? { type: 'text-delta', delta: raw.delta } : null;
    case 'block': {
      const block = validateBlock(raw.block);
      return block ? { type: 'block', block } : null;
    }
    case 'error':
      return {
        type: 'error',
        message: typeof raw.message === 'string' ? raw.message : 'Eve hit an unexpected error.',
      };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Id resolution — map streamed ids onto canonical catalog/resume records.
// Unknown ids are dropped (fail-safe), never thrown, so a stale id can't break
// the surface.
// ---------------------------------------------------------------------------

const PROJECTS_BY_ID = new Map(CATALOG.map((p) => [p.id, p]));
const TRACKS_BY_ID = new Map(RESUME.tracks.map((t) => [t.id, t]));

/** Resolve project ids to catalog records, dropping (and warning on) unknowns. */
export function resolveProjects(ids: string[]): Project[] {
  const out: Project[] = [];
  for (const id of ids) {
    const project = PROJECTS_BY_ID.get(id);
    if (project) out.push(project);
    else console.warn(`[eve] unknown project id from stream: "${id}"`);
  }
  return out;
}

/** Resolve résumé track ids to records, dropping (and warning on) unknowns. */
export function resolveTracks(trackIds: string[]): ResumeTrack[] {
  const out: ResumeTrack[] = [];
  for (const id of trackIds) {
    const track = TRACKS_BY_ID.get(id);
    if (track) out.push(track);
    else console.warn(`[eve] unknown résumé track id from stream: "${id}"`);
  }
  return out;
}

/** Merge a streamed contact payload over the canonical fallback. */
export function resolveContact(block: ContactBlock): Contact {
  return {
    email: block.email ?? CONTACT.email,
    github: block.github ?? CONTACT.github,
    resume: block.resume ?? CONTACT.resume,
    location: block.location ?? CONTACT.location,
    status: block.status ?? CONTACT.status,
  };
}
