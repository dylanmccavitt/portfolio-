import { z } from 'zod';
import { RESUME } from '@/data/resume';
import { PUBLIC_PROFILE_SITE_SUMMARY } from '@/data/profile';
import type { ProjectDetailReadModel } from '@/lib/db/project-reads';
import {
  loadPublicProjectDetails,
  type PublicProjectLoadOptions,
} from '@/lib/public-projects';
import { ProjectStatusSchema } from '@/lib/projects/schema';

export const DM_SITE_BRIEF_MAX_CHARS = 8_000;
export const DM_SITE_BRIEF_MAX_UTF8_BYTES = 8_000;
export const DM_SITE_BRIEF_SUMMARY_MAX_CHARS = 180;

const APPROXIMATE_PLANNING_BYTES_PER_TOKEN = 4;

const StableIdSchema = z.string().trim().min(1).max(200).regex(/^[a-z0-9][a-z0-9_-]*$/i);
const SlugSchema = z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/);
const OneLineSchema = z.string().transform(oneLine).pipe(z.string().min(1));
const ProjectSourceSchema = z.object({
  id: StableIdSchema,
  slug: SlugSchema,
  title: OneLineSchema.pipe(z.string().max(160)),
  summary: OneLineSchema,
  area: OneLineSchema.pipe(z.string().max(100)),
  year: z.number().int().min(2000).max(2100),
  status: ProjectStatusSchema,
});

export interface DMSiteBriefProject {
  id: string;
  title: string;
  summary: string;
  area: string;
  year: number;
  status: string;
  route: string;
}

export interface DMSiteBriefResumeTrack {
  id: string;
  title: string;
  role: string;
  when: string;
  route: string;
}

export interface DMSiteBriefContent {
  version: 1;
  careerOverview: string;
  profileSummary: string;
  routes: {
    home: '/';
    projects: '/library';
    resume: '/journey';
    hiring: '/hiring';
    fitCheck: '/fit-check';
  };
  projects: DMSiteBriefProject[];
  resumeTracks: DMSiteBriefResumeTrack[];
  contact: {
    route: string;
    evidenceTool: 'getContact';
  };
}

export interface DMSiteBrief {
  content: DMSiteBriefContent;
  promptText: string;
  charCount: number;
  utf8ByteCount: number;
  /** A bytes/4 planning estimate only; it is not a tokenizer result or upper bound. */
  approximatePlanningTokens: number;
}

export type DMSiteBriefErrorCode =
  | 'unexpected_empty'
  | 'validation_failed'
  | 'size_limit_exceeded';

export class DMSiteBriefError extends Error {
  readonly code: DMSiteBriefErrorCode;

  constructor(code: DMSiteBriefErrorCode, message: string) {
    super(message);
    this.name = 'DMSiteBriefError';
    this.code = code;
  }
}

export async function loadDMSiteBrief(
  options: PublicProjectLoadOptions = {},
): Promise<DMSiteBrief> {
  const loaded = await loadPublicProjectDetails(options);
  return buildDMSiteBrief(loaded.projects);
}

export function buildDMSiteBrief(
  projectRows: readonly ProjectDetailReadModel[],
): DMSiteBrief {
  if (projectRows.length === 0) {
    throw new DMSiteBriefError(
      'unexpected_empty',
      'The public project source returned an unexpected empty set for the DM site brief.',
    );
  }

  const projects = projectRows.map((project) => {
    const parsed = ProjectSourceSchema.safeParse(project);
    if (!parsed.success) {
      throw new DMSiteBriefError('validation_failed', 'A published project could not be validated for the DM site brief.');
    }
    return {
      id: parsed.data.id,
      title: parsed.data.title,
      summary: boundedOneLine(parsed.data.summary, DM_SITE_BRIEF_SUMMARY_MAX_CHARS),
      area: parsed.data.area,
      year: parsed.data.year,
      status: parsed.data.status.join(' / '),
      route: `/projects/${parsed.data.slug}`,
    } satisfies DMSiteBriefProject;
  }).sort((left, right) => compareOrdinal(left.id, right.id));

  if (new Set(projects.map((project) => project.id)).size !== projects.length) {
    throw new DMSiteBriefError('validation_failed', 'Published project ids must be unique in the DM site brief.');
  }
  if (new Set(projects.map((project) => project.route)).size !== projects.length) {
    throw new DMSiteBriefError('validation_failed', 'Published project routes must be unique in the DM site brief.');
  }
  assertUniqueProjectAliases(projects);

  const resumeTracks = RESUME.tracks.map((track) => {
    const id = StableIdSchema.safeParse(track.id);
    const title = OneLineSchema.safeParse(track.title);
    const role = OneLineSchema.safeParse(track.role);
    const when = OneLineSchema.safeParse(track.when);
    if (!id.success || !title.success || !role.success || !when.success) {
      throw new DMSiteBriefError('validation_failed', 'A canonical resume track could not be validated for the DM site brief.');
    }
    return {
      id: id.data,
      title: title.data,
      role: role.data,
      when: when.data,
      route: `/journey/${id.data}`,
    } satisfies DMSiteBriefResumeTrack;
  });
  const currentTrack = RESUME.tracks.find((track) => track.current) ?? RESUME.tracks.at(-1);
  if (!currentTrack || !resumeTracks.some((track) => track.id === currentTrack.id)) {
    throw new DMSiteBriefError('validation_failed', 'The canonical resume contact pointer is unavailable.');
  }

  const careerOverview = OneLineSchema.safeParse(RESUME.about);
  if (!careerOverview.success) {
    throw new DMSiteBriefError('validation_failed', 'The canonical career overview is unavailable.');
  }
  const profileSummary = OneLineSchema.safeParse(PUBLIC_PROFILE_SITE_SUMMARY);
  if (!profileSummary.success) {
    throw new DMSiteBriefError('validation_failed', 'The approved public profile summary is unavailable.');
  }

  const content: DMSiteBriefContent = {
    version: 1,
    careerOverview: careerOverview.data,
    profileSummary: profileSummary.data,
    routes: {
      home: '/',
      projects: '/library',
      resume: '/journey',
      hiring: '/hiring',
      fitCheck: '/fit-check',
    },
    projects,
    resumeTracks,
    contact: {
      route: `/journey/${currentTrack.id}`,
      evidenceTool: 'getContact',
    },
  };
  const promptText = JSON.stringify(content);
  const charCount = promptText.length;
  // Character and encoded-byte counts are the exact fail-closed invariants.
  // The bytes/4 value is only a rough planning estimate for the issue's
  // approximately 1–2k-token target. It is not a tokenizer result, a
  // conservative estimate, or a token-count guarantee for any provider.
  const utf8ByteCount = new TextEncoder().encode(promptText).byteLength;
  const approximatePlanningTokens = Math.ceil(utf8ByteCount / APPROXIMATE_PLANNING_BYTES_PER_TOKEN);
  if (
    charCount > DM_SITE_BRIEF_MAX_CHARS
    || utf8ByteCount > DM_SITE_BRIEF_MAX_UTF8_BYTES
  ) {
    throw new DMSiteBriefError(
      'size_limit_exceeded',
      'The complete DM site brief exceeds its exact character or UTF-8 byte payload limit; no published projects were omitted.',
    );
  }

  return { content, promptText, charCount, utf8ByteCount, approximatePlanningTokens };
}

function boundedOneLine(value: string, maxChars: number): string {
  const normalized = oneLine(value);
  const characters = [...normalized];
  if (characters.length <= maxChars) return normalized;
  const candidate = characters.slice(0, maxChars - 1).join('').replace(/\s+\S*$/, '').trimEnd();
  const prefix = candidate || characters.slice(0, maxChars - 1).join('').trimEnd();
  return `${prefix}…`;
}

function oneLine(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function normalizeDMSiteBriefProjectReference(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}

function assertUniqueProjectAliases(projects: readonly DMSiteBriefProject[]): void {
  const projectIdByAlias = new Map<string, string>();
  for (const project of projects) {
    const slug = project.route.startsWith('/projects/') ? project.route.slice('/projects/'.length) : '';
    if (!normalizeDMSiteBriefProjectReference(project.title)) {
      throw new DMSiteBriefError(
        'validation_failed',
        'Published project titles must produce a matchable DM site brief alias.',
      );
    }
    for (const reference of [project.id, slug, project.title]) {
      const alias = normalizeDMSiteBriefProjectReference(reference);
      if (!alias) continue;
      const existingProjectId = projectIdByAlias.get(alias);
      if (existingProjectId && existingProjectId !== project.id) {
        throw new DMSiteBriefError(
          'validation_failed',
          'Published project ids, slugs, and titles must resolve to unique DM site brief aliases.',
        );
      }
      projectIdByAlias.set(alias, project.id);
    }
  }
}

function compareOrdinal(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
