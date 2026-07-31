/**
 * DM grounding corpus — the machine-readable snapshot of everything the public
 * DM agent is allowed to know.
 *
 * IT IS NOT PUBLISHED. The site serves no corpus document and the browser never
 * receives one — `docs/agents/product-direction.md` owns that boundary and the
 * reasoning behind it; this file only implements it. The only way the corpus
 * leaves this repository is `npm run dm:corpus` (`scripts/dm-corpus.ts`), which
 * writes a snapshot the owner commits into the DM service's own deployment. The
 * browser gets {@link buildDmPageManifest} instead — anchors and project ids,
 * both already visible in the homepage HTML.
 *
 * Three approved modules feed it and nothing else: `src/data/catalog.ts` (via
 * the read-model path; the catalog carries no draft state, so every entry in it
 * is owner-approved and ships unconditionally), `src/data/profile.ts` (whose
 * entries first clear the published+public filter, then a narrower durable
 * recruiter-context allowlist), and `src/data/resume.ts` (whose
 * timeline reaches here only through the public track allowlist, so the corpus
 * publishes exactly the history the site does and never more). Presentation-only
 * and internal fields — hues, `seek`, `wip`/`money`, `source`, SEO metadata —
 * are deliberately dropped: the agent grounds on facts, not on how the site
 * paints them.
 *
 * `version` is the consumer contract. Any change to the emitted shape must
 * bump it, and `tests/dm-corpus.test.ts` fails closed on unexpected keys so a
 * field added upstream can't leak into the corpus unnoticed.
 */

import {
  PUBLIC_PROFILE_IDENTITY,
  loadPublicProfileEntries,
  loadPublicProfileSiteSummary,
} from '@/data/profile';
import { RESUME, publicResumeTracks, type ProjectId } from '@/data/resume';
import type {
  ProjectLink,
  ProjectMetric,
  ProjectStackEntry,
  ProjectStatus,
} from '@/data/catalog';
import type { ProjectArea } from '@/lib/projects/schema';
import { loadPublicProjectDetails } from '@/lib/public-projects';
import {
  DM_PAGE_ACTIONS,
  DM_PAGE_ANCHORS,
  pageManifest,
  type DmPageManifest,
} from '@/lib/dm/page-manifest';

export const DM_CORPUS_VERSION = 1;

/** Canonical origin, mirroring `site` in `astro.config.mjs`. */
export const DM_CORPUS_ORIGIN = 'https://dylanmccavitt.xyz';

/** The single-page site's section anchors, in document order. */
export const DM_CORPUS_ANCHORS = DM_PAGE_ANCHORS;

/** The only action verbs a DM answer may target. */
export const DM_CORPUS_ACTIONS = DM_PAGE_ACTIONS;

/** Provenance for a consumer, named by what it is rather than by where it is
    kept: the corpus is built from this site's own published content, not from
    anything a reader can't already see. */
const DM_CORPUS_SOURCE = 'dylanmccavitt.xyz — published project catalog, public profile, and resume';

/**
 * DM is project-first. These are the durable profile facts that help a visitor
 * interpret the work or contact Dylan; topical experiments, hobbies, site
 * implementation notes, and duplicate project summaries stay out.
 */
export const DM_PROFILE_ENTRY_IDS = [
  'short-bio',
  'career-change',
  'working-style',
  'recruiter-faq',
  'tools-and-stack',
  'what-dylan-is-looking-for',
  'agentic-workflow',
  'before-engineering',
  'graduate-school',
  'where-to-find-dylan',
] as const;

export interface DmCorpusSite {
  origin: string;
  owner: string;
}

export interface DmCorpusProfileEntry {
  id: string;
  category: string;
  title: string;
  summary: string;
  href?: string;
}

export interface DmCorpusProfile {
  name: string;
  role: string;
  focus: string;
  location: string;
  status: string;
  email: string;
  /** Absent when no approved profile entry supplies one. */
  summary?: string;
  entries: DmCorpusProfileEntry[];
}

export interface DmCorpusResumeTrack {
  id: string;
  title: string;
  role: string;
  when: string;
  current?: boolean;
  about: string[];
  notes: string[];
  credits: Array<[label: string, value: string]>;
  era: ProjectId[];
}

export interface DmCorpusResume {
  title: string;
  tracks: DmCorpusResumeTrack[];
}

/** A shot the agent can cite: only media that resolves to a real asset. */
export interface DmCorpusShot {
  src: string;
  caption: string;
}

export interface DmCorpusProject {
  id: string;
  slug: string;
  href: string;
  title: string;
  line: string;
  summary: string;
  area: ProjectArea;
  status: ProjectStatus;
  year: number;
  activity: string;
  /** Exactly [problem, approach, outcome], per the catalog's own rule. */
  about: string[];
  notes: string[];
  stack: ProjectStackEntry[];
  metrics: ProjectMetric[];
  links: ProjectLink[];
  shots: DmCorpusShot[];
}

/**
 * Legal targets for a DM answer, as carried inside the corpus itself. The same
 * shape the browser gets on its own — see `./page-manifest.ts`, which owns it.
 */
export type DmCorpusPage = DmPageManifest;

export interface DmCorpus {
  version: number;
  source: string;
  site: DmCorpusSite;
  profile: DmCorpusProfile;
  resume: DmCorpusResume;
  projects: DmCorpusProject[];
  page: DmCorpusPage;
}

/**
 * The timeline, read through the public allowlist rather than off `RESUME.tracks`.
 * A track the site withholds is not a track the agent may know about.
 */
function resumeTracks(): DmCorpusResumeTrack[] {
  return publicResumeTracks().map((track) => ({
    id: track.id,
    title: track.title,
    role: track.role,
    when: track.when,
    // `current` is absent rather than false on past tracks, matching the source.
    ...(track.current === undefined ? {} : { current: track.current }),
    about: [...track.about],
    notes: [...track.notes],
    credits: track.credits.map(([label, value]) => [label, value] as [string, string]),
    era: [...track.era],
  }));
}

/**
 * Raw inputs the builder will filter. Every field defaults to the real approved
 * module, and an override buys no exemption — it goes through the same filter
 * the default does. That is the point: `tests/dm-corpus.test.ts` injects an
 * unapproved profile entry here to prove, on every run, that it cannot come out.
 */
export interface DmCorpusInput {
  /** Unfiltered profile entries, before the published+public filter. */
  profileSource?: unknown;
}

export async function buildDmCorpus({ profileSource }: DmCorpusInput = {}): Promise<DmCorpus> {
  const [{ projects: details }, approvedEntries, summary] = await Promise.all([
    loadPublicProjectDetails(),
    loadPublicProfileEntries(profileSource),
    loadPublicProfileSiteSummary(profileSource),
  ]);
  const approvedById = new Map(approvedEntries.map((entry) => [entry.id, entry]));
  const entries = DM_PROFILE_ENTRY_IDS.map((id) => {
    const entry = approvedById.get(id);
    if (entry === undefined) {
      throw new Error(`DM profile allowlist names no approved public entry: ${id}`);
    }
    return entry;
  });

  const projects: DmCorpusProject[] = details.map((project) => ({
    id: project.id,
    slug: project.slug,
    href: project.href,
    title: project.title,
    line: project.line,
    summary: project.summary,
    area: project.area,
    status: [...project.status] as ProjectStatus,
    year: project.year,
    activity: project.activity,
    about: [...project.about],
    notes: [...project.notes],
    stack: project.stack.map((entry) => ({ ...entry })),
    metrics: project.metrics.map((metric) => ({ ...metric })),
    links: project.links.map((link) => ({ ...link })),
    // Skeleton placeholders stand in for shots that were never captured; they
    // point at no asset, so they carry nothing the agent can ground on.
    shots: project.shots
      .filter((shot) => shot.kind !== 'skeleton')
      .map((shot) => ({ src: shot.src, caption: shot.caption })),
  }));

  return {
    version: DM_CORPUS_VERSION,
    source: DM_CORPUS_SOURCE,
    site: { origin: DM_CORPUS_ORIGIN, owner: PUBLIC_PROFILE_IDENTITY.name },
    profile: {
      ...PUBLIC_PROFILE_IDENTITY,
      // Omitted rather than substituted: no approved entry, no summary.
      ...(summary === undefined ? {} : { summary }),
      entries: entries.map((entry) => ({
        id: entry.id,
        category: entry.category,
        title: entry.title,
        summary: entry.summary,
        // The approval flags themselves stay behind the boundary: an entry that
        // reaches here is published and public by construction.
        ...(entry.href === undefined ? {} : { href: entry.href }),
      })),
    },
    resume: { title: RESUME.title, tracks: resumeTracks() },
    projects,
    page: pageManifest(projects.map((project) => project.id)),
  };
}
