import type { UIMessage } from 'ai';
import type {
  PublicContactRecord,
  PublicProjectToolRecord,
  PublicResumeTrackRecord,
  PublicSourceRecord,
  PublicToolEvidence,
} from './public-agent-tools';

export const AGENT_NAME = 'DM';

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

export type DMUIData = Record<string, unknown> & {
  'dm-answer': DMFinalizationResult;
};

export type DMUIMessage = UIMessage<unknown, DMUIData>;

export interface DMConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface DMChatRequest {
  messages: DMUIMessage[];
  context?: DMChatContext;
}

export interface DMAnswerSegment {
  text: string;
  evidenceIds: string[];
  evidence: PublicToolEvidence[];
}

export type DMAnswerArtifact =
  | { kind: 'project'; id: string; project: PublicProjectToolRecord }
  | { kind: 'resume'; id: string; track: PublicResumeTrackRecord }
  | { kind: 'contact'; id: 'contact'; contact: PublicContactRecord }
  | { kind: 'evidence'; id: string; source: PublicSourceRecord }
  | { kind: 'links'; id: string; projectId: string; items: Array<{ label: string; href: string }> };

export interface DMValidatedAnswer {
  segments: DMAnswerSegment[];
  artifacts: DMAnswerArtifact[];
  limitations: string[];
  followUp?: string;
}

export type DMFinalizationResult =
  | {
      status: 'accepted';
      answer: DMValidatedAnswer;
      repairAttempted: boolean;
    }
  | {
      status: 'limited';
      answer: DMValidatedAnswer;
      repairAttempted: boolean;
    }
  | {
      status: 'rejected';
      errors: string[];
      remainingAttempts: 1;
    };
