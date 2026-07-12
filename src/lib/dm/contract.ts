import type { Project } from '@/data/catalog';
import type { ResumeTrack } from '@/data/resume';

export const AGENT_NAME = 'DM';

export type AnswerBlock =
  | { kind: 'text'; text: string }
  | { kind: 'projects'; ids: string[]; items: ProjectSummary[] }
  | { kind: 'resume'; trackIds: string[] }
  | { kind: 'evidence'; projectIds?: string[]; projects?: ProjectSummary[]; resumeTrackIds?: string[]; ragSources?: PublicRagCitation[] }
  | { kind: 'contact'; email?: string; github?: string; resume?: string; location?: string; status?: string }
  | { kind: 'links'; items: [label: string, href: string][] };

export interface PublicRagCitation {
  ragSourceId: string;
  projectId: string;
  fileId: string;
  filename?: string;
  score?: number;
  text: string;
}

export type ProjectFactPacketStatus = 'complete' | 'partial' | 'fallback' | 'empty';

export interface ProjectFactMetric {
  id: string;
  projectId: string;
  value: string;
  label: string;
}

export interface ProjectFactLink {
  id: string;
  projectId: string;
  label: string;
  href: string;
}

export type ProjectEvidenceAtomKind =
  | 'identity'
  | 'summary'
  | 'tagline'
  | 'status'
  | 'year'
  | 'activity'
  | 'area'
  | 'about'
  | 'notes'
  | 'stack'
  | 'metric'
  | 'link'
  | 'citation';

/** One addressable, public fact that a generated answer claim may cite. */
export interface ProjectEvidenceAtom {
  id: string;
  projectId: string;
  kind: ProjectEvidenceAtomKind;
  label: string;
  value: string;
  sensitive: boolean;
}

export interface ProjectFact {
  id: string;
  slug: string;
  title: string;
  href: string;
  area: string;
  status: Project['status'];
  year: number;
  activity: string;
  tagline: string;
  summary: string;
  about: string[];
  notes: string[];
  stack: Array<{ id: string; projectId: string; label: string; value: string }>;
  metrics: ProjectFactMetric[];
  links: ProjectFactLink[];
}

/** The complete public evidence boundary for project prose in one DM turn. */
export interface ProjectFactPacket {
  operation: 'none' | 'searchProjects' | 'filterProjects' | 'rankProjects';
  status: ProjectFactPacketStatus;
  responseMode?: 'representative-overview' | 'single-project' | 'deep-dive';
  query: string;
  fallbackUsed: boolean;
  projects: ProjectFact[];
  citations: PublicRagCitation[];
  evidence: ProjectEvidenceAtom[];
}

export interface DMConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface DMChatContext {
  projectIds?: string[];
  resumeTrackIds?: string[];
  fitCheck?: {
    kind: 'job-description';
    jobDescription: string;
    originalLength?: number;
    truncated?: boolean;
  };
}

export interface DMChatRequest {
  message: string;
  conversation?: DMConversationMessage[];
  context?: DMChatContext;
}

export interface ToolTraceItem {
  tool: string;
  label: string;
  remote: boolean;
}

export interface ToolTraceMetadata {
  mode: 'vercel-ai-sdk';
  agent: typeof AGENT_NAME;
  items: ToolTraceItem[];
}

export interface ProjectSummary {
  id: string;
  slug?: string;
  title: string;
  area: Project['area'];
  status: Project['status'];
  year: number;
  activity: string;
  line: string;
  summary?: string;
  href: string;
  wip: boolean;
  money: boolean;
  links: Project['links'];
  metrics: Project['metrics'];
  about: string[];
  notes: string[];
  stack: Project['stack'];
}

export interface ResumeTrackSummary {
  id: string;
  title: string;
  role: string;
  when: string;
  about: string[];
  notes: string[];
  credits: ResumeTrack['credits'];
  era: string[];
}

export interface ContactBlock {
  kind: 'contact';
  email: string;
  github: string;
  resume: string;
  location: string;
  status: string;
}

export type DMStreamEvent =
  | { type: 'ready'; agent: typeof AGENT_NAME; provider: string; traceId?: string; trace: ToolTraceMetadata }
  | { type: 'tool'; name: string; summary?: string }
  | { type: 'text-delta'; delta: string }
  | { type: 'block'; index?: number; block: AnswerBlock }
  | { type: 'done'; answer: AnswerBlock[]; trace: ToolTraceMetadata; facts?: ProjectFactPacket }
  | { type: 'error'; message: string };
