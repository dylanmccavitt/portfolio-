/**
 * Split-canvas landing — client contract for the DM chat UI.
 *
 * This module is the UI's view of the public DM runtime contract. It defines
 * the **answer-block** shapes the surface renders, the **stream-event** envelope
 * the client consumes, a tolerant NDJSON parser, authoritative streamed
 * project artifacts, and static `resume.ts` id resolution.
 *
 * Boundary: the server owns the agent, tools, model/provider, and the
 * `/api/dm/chat` endpoint that emits this stream. This file owns nothing
 * server-side; it only describes what the landing reads.
 *
 * Wire format: the endpoint accepts
 *   POST /api/dm/chat  { message: string, conversation?: ChatMessage[] }
 * and replies with **NDJSON** — one JSON {@link StreamEvent} per line. A
 * `data: ` SSE prefix is tolerated but not required. The stream ends when the
 * response body closes.
 */

import type { Project } from '@/data/catalog';
import { RESUME, type ResumeTrack } from '@/data/resume';
import { isProjectArea } from '@/lib/projects/schema';
export {
  FIT_CHECK_CONTEXT_LIMIT,
  FIT_CHECK_INPUT_LIMIT,
  FIT_CHECK_MIN_CHARS,
  fitCheckValidationMessage,
  sanitizeJobDescriptionForFitCheck,
} from './fit-check';

/** The portfolio agent's name. */
export const AGENT_NAME = 'DM';

/** Streaming chat endpoint. Relative so it follows the origin. */
export const DM_ENDPOINT = '/api/dm/chat';

/** Empty-state greeting shown before the first question. */
export const GREETING = "I'm DM, Dylan McCavitt's portfolio guide.";

/** Sub-greeting / capability line under the greeting. */
export const SUBGREETING =
  'Ask me a question, browse grounded project evidence, read the resume, take the hiring tour, paste a job description, or contact Dylan directly.';

/** A starter prompt chip. */
export interface SuggestedPrompt {
  label: string;
}

/**
 * Empty-state starter prompts. These submit their `label` as a real question to
 * the endpoint — they are seed *questions*, not canned answers, so shipping them
 * does not reintroduce canned routing/data as the answer source.
 */
export const SUGGESTED: SuggestedPrompt[] = [
  { label: 'Which projects best show client software?' },
  { label: 'Show practical AI-assisted workflow evidence' },
  { label: 'What has Dylan shipped for real users?' },
  { label: 'Where is he strongest for backend or product work?' },
  { label: 'What should I know from his resume?' },
  { label: 'Is he open to work, and how do I reach him?' },
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
 * UI fallback contact card merged with streamed contact blocks.
 */
export const CONTACT: Contact = {
  email: 'dylanmccavitt@outlook.com',
  github: 'https://github.com/DylanMcCavitt',
  resume: '/resume.pdf',
  location: 'New York City',
  status: 'Open to opportunities',
} as const;

// ---------------------------------------------------------------------------
// Answer blocks — the rendering contract shared with the stream renderer.
// ---------------------------------------------------------------------------

export interface TextBlock {
  kind: 'text';
  text: string;
}
export interface ProjectArtifact {
  id: string;
  title: string;
  area: Project['area'];
  status: Project['status'];
  year: number;
  activity: string;
  line: string;
  href: string;
  hue?: string;
  metrics?: Project['metrics'];
  stack?: Project['stack'];
  notes?: string[];
}

export interface ProjectsBlock {
  kind: 'projects';
  ids: string[];
  items: ProjectArtifact[];
}
export interface ResumeBlock {
  kind: 'resume';
  trackIds: string[];
}
export interface RagSourceEvidence {
  ragSourceId: string;
  projectId: string;
  fileId: string;
  filename?: string;
  score?: number;
  text: string;
}

export interface EvidenceBlock {
  kind: 'evidence';
  projectIds?: string[];
  projects?: ProjectArtifact[];
  resumeTrackIds?: string[];
  ragSources?: RagSourceEvidence[];
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

/** A rendered chunk of a DM answer. */
export type AnswerBlock =
  | TextBlock
  | ProjectsBlock
  | ResumeBlock
  | EvidenceBlock
  | ContactBlock
  | LinksBlock;

/** The answer-block kinds the surface knows how to render. */
const BLOCK_KINDS = new Set(['text', 'projects', 'resume', 'evidence', 'contact', 'links']);
const MAX_EVIDENCE_PROJECTS = 4;
const MAX_EVIDENCE_TRACKS = 3;
const MAX_RAG_SOURCES = 3;

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
 * breaking the conversation surface. Project blocks must carry their complete
 * streamed artifacts; the client never rehydrates project ids from catalog.ts.
 */
export function validateBlock(value: unknown): AnswerBlock | null {
  if (!isObject(value) || typeof value.kind !== 'string') return null;
  if (!BLOCK_KINDS.has(value.kind)) return null;
  switch (value.kind) {
    case 'text':
      return typeof value.text === 'string' ? { kind: 'text', text: value.text } : null;
    case 'projects': {
      const ids = parseRequiredStringArray(value.ids);
      const items = parseOptionalProjectArtifacts(value.items);
      if (!ids?.length || !items?.length) return null;
      const idsFromItems = new Set(items.map((item) => item.id));
      if (ids.some((id) => !idsFromItems.has(id)) || items.some((item) => !ids.includes(item.id))) return null;
      return { kind: 'projects', ids, items };
    }
    case 'resume':
      return Array.isArray(value.trackIds) &&
        value.trackIds.every((id) => typeof id === 'string')
        ? { kind: 'resume', trackIds: value.trackIds as string[] }
        : null;
    case 'evidence': {
      const projectIds = parseOptionalStringArray(value.projectIds);
      const projects = parseOptionalProjectArtifacts(value.projects);
      const resumeTrackIds = parseOptionalStringArray(value.resumeTrackIds);
      const ragSources = parseOptionalRagSources(value.ragSources);
      if (projectIds === null || projects === null || resumeTrackIds === null || ragSources === null) return null;
      if (!projectIds?.length && !projects?.length && !resumeTrackIds?.length && !ragSources?.length) return null;
      return {
        kind: 'evidence',
        ...(projectIds?.length ? { projectIds: projectIds.slice(0, MAX_EVIDENCE_PROJECTS) } : {}),
        ...(projects?.length ? { projects: projects.slice(0, MAX_EVIDENCE_PROJECTS) } : {}),
        ...(resumeTrackIds?.length
          ? { resumeTrackIds: resumeTrackIds.slice(0, MAX_EVIDENCE_TRACKS) }
          : {}),
        ...(ragSources?.length ? { ragSources: ragSources.slice(0, MAX_RAG_SOURCES) } : {}),
      };
    }
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
        message: typeof raw.message === 'string' ? raw.message : 'DM hit an unexpected error.',
      };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Id resolution — streamed project artifacts are authoritative. Résumé ids
// still resolve against the static public résumé source.
// ---------------------------------------------------------------------------

const TRACKS_BY_ID = new Map(RESUME.tracks.map((t) => [t.id, t]));

function parseRequiredStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((id) => typeof id === 'string') ? (value as string[]) : null;
}

function parseOptionalStringArray(value: unknown): string[] | null | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) && value.every((id) => typeof id === 'string')
    ? (value as string[])
    : null;
}

function parseOptionalProjectArtifacts(value: unknown): ProjectArtifact[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const projects = value.map(parseProjectArtifact);
  return projects.every((project): project is ProjectArtifact => Boolean(project)) ? projects : null;
}

function parseOptionalRagSources(value: unknown): RagSourceEvidence[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const sources = value.map(parseRagSourceEvidence);
  return sources.every((source): source is RagSourceEvidence => Boolean(source)) ? sources : null;
}

function parseRagSourceEvidence(value: unknown): RagSourceEvidence | null {
  if (
    !isObject(value) ||
    typeof value.ragSourceId !== 'string' ||
    typeof value.projectId !== 'string' ||
    typeof value.fileId !== 'string' ||
    typeof value.text !== 'string' ||
    !value.text.trim()
  ) {
    return null;
  }

  return {
    ragSourceId: value.ragSourceId,
    projectId: value.projectId,
    fileId: value.fileId,
    ...(typeof value.filename === 'string' ? { filename: value.filename } : {}),
    ...(typeof value.score === 'number' && Number.isFinite(value.score) ? { score: value.score } : {}),
    text: value.text.trim(),
  };
}

function parseProjectArtifact(value: unknown): ProjectArtifact | null {
  if (!isObject(value)) return null;
  const status = value.status;
  if (
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    !isProjectArea(value.area) ||
    !Array.isArray(status) ||
    status.length !== 2 ||
    typeof status[0] !== 'string' ||
    typeof status[1] !== 'string' ||
    typeof value.year !== 'number' ||
    typeof value.activity !== 'string' ||
    typeof value.line !== 'string' ||
    typeof value.href !== 'string'
  ) {
    return null;
  }

  return {
    id: value.id,
    title: value.title,
    area: value.area,
    status: status as Project['status'],
    year: value.year,
    activity: value.activity,
    line: value.line,
    href: value.href,
    ...(typeof value.hue === 'string' ? { hue: value.hue } : {}),
    ...(isProjectMetricArray(value.metrics) ? { metrics: value.metrics } : {}),
    ...(isProjectDetailEntryArray(value.stack) ? { stack: value.stack } : {}),
    ...(Array.isArray(value.notes) && value.notes.every((note) => typeof note === 'string') ? { notes: value.notes as string[] } : {}),
  };
}

function isProjectMetricArray(value: unknown): value is Project['metrics'] {
  return (
    Array.isArray(value) &&
    value.every((item) => isObject(item) && typeof item.value === 'string' && typeof item.label === 'string')
  );
}

function isProjectDetailEntryArray(value: unknown): value is Project['stack'] {
  return (
    Array.isArray(value) &&
    value.every((item) => isObject(item) && typeof item.label === 'string' && typeof item.value === 'string')
  );
}

/** Resolve résumé track ids to records, dropping (and warning on) unknowns. */
export function resolveTracks(trackIds: string[]): ResumeTrack[] {
  const out: ResumeTrack[] = [];
  for (const id of trackIds) {
    const track = TRACKS_BY_ID.get(id);
    if (track) out.push(track);
    else console.warn(`[dm] unknown résumé track id from stream: "${id}"`);
  }
  return out;
}

/** Resolve evidence from streamed project artifacts plus the static résumé source. */
export function resolveEvidence(block: EvidenceBlock): {
  projects: ProjectArtifact[];
  tracks: ResumeTrack[];
} {
  return {
    projects: block.projects ?? [],
    tracks: resolveTracks(block.resumeTrackIds ?? []),
  };
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
