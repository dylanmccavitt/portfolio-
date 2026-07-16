/** Browser-safe helpers for the standard AI SDK UIMessage contract. */

import { RESUME, type ResumeTrack } from '@/data/resume';
import type {
  DMAnswerArtifact,
  DMAnswerSegment,
  DMFinalizationResult,
  DMValidatedAnswer,
} from './contract';
export {
  FIT_CHECK_CONTEXT_LIMIT,
  FIT_CHECK_INPUT_LIMIT,
  FIT_CHECK_MIN_CHARS,
  fitCheckValidationMessage,
  sanitizeJobDescriptionForFitCheck,
} from './fit-check';

export const AGENT_NAME = 'DM';
export const DM_ENDPOINT = '/api/dm/chat';
export const GREETING = "I'm DM, Dylan McCavitt's portfolio guide.";
export const SUBGREETING =
  'Ask me a question, browse grounded project evidence, read the resume, take the hiring tour, paste a job description, or contact Dylan directly.';
export const CONTACT = {
  email: 'dylanmccavitt@outlook.com',
  github: 'https://github.com/DylanMcCavitt',
  resume: '/resume.pdf',
  location: 'New York City',
  status: 'Open to opportunities',
} as const;

export interface SuggestedPrompt {
  label: string;
}

export const SUGGESTED: SuggestedPrompt[] = [
  { label: 'Which projects best show client software?' },
  { label: 'Show practical AI-assisted workflow evidence' },
  { label: 'What has Dylan shipped for real users?' },
  { label: 'Where is he strongest for backend or product work?' },
  { label: 'What should I know from his resume?' },
  { label: 'Is he open to work, and how do I reach him?' },
];

const TRACKS_BY_ID = new Map(RESUME.tracks.map((track) => [track.id, track]));

export function resolveTracks(trackIds: string[]): ResumeTrack[] {
  return trackIds.flatMap((id) => TRACKS_BY_ID.get(id) ?? []);
}

export function validateFinalizationResult(value: unknown): DMFinalizationResult | null {
  if (!isRecord(value) || typeof value.status !== 'string') return null;
  if (value.status === 'rejected') {
    if (!isStringArray(value.errors) || value.remainingAttempts !== 1) return null;
    return { status: 'rejected', errors: value.errors, remainingAttempts: 1 };
  }
  if (value.status !== 'accepted' && value.status !== 'limited') return null;
  const answer = validateAnswer(value.answer);
  if (!answer || typeof value.repairAttempted !== 'boolean') return null;
  return { status: value.status, answer, repairAttempted: value.repairAttempted };
}

export function matchesStreamedV2Finalization(
  prose: string,
  result: Exclude<DMFinalizationResult, { status: 'rejected' }>,
): boolean {
  return prose.length > 0
    && result.status === 'accepted'
    && result.answer.segments.length === 1
    && result.answer.segments[0]?.text === prose;
}

export function completedAssistantHistoryText(prose: string, completed: boolean): string | null {
  return completed && prose ? prose : null;
}

function validateAnswer(value: unknown): DMValidatedAnswer | null {
  if (!isRecord(value) || !Array.isArray(value.segments) || !Array.isArray(value.artifacts)) return null;
  const segments = value.segments.map(validateSegment);
  const artifacts = value.artifacts.map(validateArtifact);
  if (segments.some((item) => !item) || artifacts.some((item) => !item) || !isStringArray(value.limitations)) return null;
  if (value.followUp !== undefined && typeof value.followUp !== 'string') return null;
  return {
    segments: segments as DMAnswerSegment[],
    artifacts: artifacts as DMAnswerArtifact[],
    limitations: value.limitations,
    ...(typeof value.followUp === 'string' ? { followUp: value.followUp } : {}),
  };
}

function validateSegment(value: unknown): DMAnswerSegment | null {
  if (!isRecord(value) || typeof value.text !== 'string' || !isStringArray(value.evidenceIds) || !Array.isArray(value.evidence)) return null;
  const evidence = value.evidence.filter((item) =>
    isRecord(item)
      && typeof item.id === 'string'
      && typeof item.source === 'string'
      && typeof item.recordId === 'string'
      && typeof item.field === 'string'
      && typeof item.label === 'string'
      && typeof item.value === 'string',
  );
  if (evidence.length !== value.evidence.length) return null;
  return { text: value.text, evidenceIds: value.evidenceIds, evidence } as DMAnswerSegment;
}

function validateArtifact(value: unknown): DMAnswerArtifact | null {
  if (!isRecord(value) || typeof value.kind !== 'string' || typeof value.id !== 'string') return null;
  if (value.kind === 'project' && isRecord(value.project)) return value as unknown as DMAnswerArtifact;
  if (value.kind === 'resume' && isRecord(value.track)) return value as unknown as DMAnswerArtifact;
  if (value.kind === 'contact' && value.id === 'contact' && isRecord(value.contact)) return value as unknown as DMAnswerArtifact;
  if (value.kind === 'evidence' && isRecord(value.source)) return value as unknown as DMAnswerArtifact;
  if (value.kind === 'links' && typeof value.projectId === 'string' && Array.isArray(value.items)) return value as unknown as DMAnswerArtifact;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
