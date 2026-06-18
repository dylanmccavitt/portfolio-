import type { Project } from '../../data/catalog';
import type { ResumeTrack } from '../../data/resume';

export const AGENT_NAME = 'Eve';

export type AnswerBlock =
  | { kind: 'text'; text: string }
  | { kind: 'projects'; ids: string[] }
  | { kind: 'resume'; trackIds: string[] }
  | { kind: 'contact' }
  | { kind: 'links'; items: [label: string, href: string][] };

export interface EveConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface EveChatContext {
  projectIds?: string[];
  resumeTrackIds?: string[];
}

export interface EveChatRequest {
  message: string;
  conversation?: EveConversationMessage[];
  context?: EveChatContext;
}

export interface ToolTraceItem {
  tool: 'search_catalog' | 'rank_projects' | 'filter_catalog' | 'read_resume' | 'get_contact';
  input: Record<string, unknown>;
  label: string;
  resultCount: number;
}

export interface ToolTraceMetadata {
  count: number;
  items: ToolTraceItem[];
}

export interface ProjectSummary {
  id: string;
  title: string;
  area: Project['area'];
  status: Project['status'];
  year: number;
  line: string;
  wip: boolean;
  money: boolean;
  links: Project['links'];
  metrics: Project['metrics'];
}

export interface ResumeTrackSummary {
  id: string;
  title: string;
  role: string;
  when: string;
  current: boolean;
  about: ResumeTrack['about'];
  notes: ResumeTrack['notes'];
  credits: ResumeTrack['credits'];
  era: ResumeTrack['era'];
}

export interface ContactBlock {
  email: string;
  location: string;
  status: string;
  resumeHref: string;
  links: [label: string, href: string][];
}

export interface EveAnswer {
  blocks: AnswerBlock[];
  trace: ToolTraceMetadata;
}

export type EveStreamEvent =
  | {
      type: 'ready';
      agent: typeof AGENT_NAME;
      trace: ToolTraceMetadata;
      provider: string;
    }
  | {
      type: 'block';
      index: number;
      block: AnswerBlock;
    }
  | {
      type: 'done';
      answer: AnswerBlock[];
      trace: ToolTraceMetadata;
    }
  | {
      type: 'error';
      error: {
        code: string;
        message: string;
      };
    };
