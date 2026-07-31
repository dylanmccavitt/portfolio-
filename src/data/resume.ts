/**
 * Resume — the career timeline and single source of truth for resume views.
 *
 * Copy (about, notes, credits, hues, and chronology metadata) is kept here so
 * every consumer reads the same facts.
 *
 * Era cross-links resolve against the project catalog (`catalog.ts`): each
 * `era` entry is a project id, constrained at compile time to the ids the
 * catalog actually ships (lingoloop was dropped from the catalog).
 */

import { CATALOG } from './catalog';

/**
 * Catalog project ids, mirrored as a `const` tuple so `era` cross-links get a
 * real literal union (`CATALOG` is typed `Project[]`, so its ids widen to
 * `string` and can't be used as a union without editing `catalog.ts`).
 *
 * The mirror is kept honest by {@link assertCatalogIdsInSync}, which runs at
 * module load (i.e. during `astro build`) and throws if this tuple drifts from
 * the actual catalog in either direction — so a renamed, added, or removed
 * project surfaces as a build failure, not a silent dead `era` link.
 */
const PROJECT_IDS = [
  'agent-skills',
  'bellas-beads',
  'agentic-trader',
  'nhf',
  'work-orders',
  'epl-ml',
] as const;

/** A catalog project id, constrained to the ids the catalog ships. */
export type ProjectId = (typeof PROJECT_IDS)[number];

/** `[label, value]` credit tuple, e.g. `['Degree', 'b.s. economics']`. */
export type ResumeCredit = [label: string, value: string];

/** A single chronological career entry on the resume timeline. */
export interface ResumeTrack {
  id: string;
  title: string;
  role: string;
  /** Time span, e.g. `'2020 — 2023'`. */
  when: string;
  /** Accent color (hex). */
  hue: string;
  /** Marks the current / present track. */
  current?: boolean;
  /** Long-form description paragraphs. */
  about: string[];
  /** Liner notes. */
  notes: string[];
  /** Credits. */
  credits: ResumeCredit[];
  /** Cross-links to catalog projects from this era. */
  era: ProjectId[];
}

/** The resume: metadata plus chronological career entries. */
export interface ResumeAlbum {
  title: string;
  /** One-line tagline. */
  line: string;
  /** Album blurb. */
  about: string;
  tracks: ResumeTrack[];
}

export const RESUME: ResumeAlbum = {
  title: 'Resume',
  line: 'economics → legal ops → cyber risk → engineering',
  about:
    'Career history in chronological order, from an economics degree through legal operations, cyber risk, graduate CS, client software, and practical side projects.',
  tracks: [
    {
      id: 'syracuse',
      title: 'Syracuse University',
      role: 'B.S. Economics',
      when: '2019',
      hue: '#ef8354',
      about: [
        'B.S. in Economics from Syracuse University, class of 2019.',
        'Markets, incentives, and working from data, before writing production code.',
      ],
      notes: ['Economics intuition still helps Dylan reason from data and incentives.'],
      credits: [
        ['Degree', 'b.s. economics'],
        ['Class', '2019'],
      ],
      era: [],
    },
    {
      id: 'paulweiss',
      title: 'Paul, Weiss',
      role: 'Practice Assistant, Private Funds',
      when: '2020 to 2023',
      hue: '#5da8e8',
      about: [
        'Practice assistant in the Private Funds group at Paul, Weiss, supporting legal work where the tolerance for detail errors is zero.',
        'Three years of process discipline and document rigor against deadlines that don’t move.',
      ],
      notes: ['Daily exposure to how funds are actually structured and run.'],
      credits: [
        ['Group', 'private funds'],
        ['Years', '2020 to 2023'],
      ],
      era: [],
    },
    {
      id: 'kroll',
      title: 'Kroll, Inc.',
      role: 'Associate, Cyber Strategy & Risk',
      when: '2023 to 2024',
      hue: '#50c878',
      about: [
        'Associate on Kroll’s Cyber Strategy & Risk team, running security assessments and risk work for client organizations.',
        'The security habits carried forward: explicit risk gates, paper-first scaffolds, secrets hygiene, and read-only defaults.',
      ],
      notes: ['The pivot into technical work.'],
      credits: [
        ['Team', 'cyber strategy & risk'],
        ['Years', '2023 to 2024'],
      ],
      era: [],
    },
    {
      id: 'stevens',
      title: 'Stevens Institute of Technology',
      role: 'M.S. Computer Science',
      when: '2024 to 2026',
      hue: '#8b7cf6',
      about: [
        'M.S. in Computer Science at Stevens, the formal foundation under the self-taught stack. Systems, web programming, and mobile systems, with two group projects from coursework in this catalog.',
        'Completed 2026, shipping side projects throughout.',
      ],
      notes: ['Two catalog entries came out of coursework here.'],
      credits: [
        ['Degree', 'm.s. computer science'],
        ['Class', '2026'],
      ],
      era: ['work-orders', 'epl-ml'],
    },
    {
      id: 'boe',
      title: 'Manhattan Board of Elections',
      role: 'IT Support',
      when: '2025',
      hue: '#e6b450',
      about: [
        'IT support for the Manhattan Board of Elections, keeping election-season infrastructure running, where downtime isn’t an option.',
      ],
      notes: ['Production support under real deadline pressure.'],
      credits: [
        ['Role', 'it support'],
        ['Year', '2025'],
      ],
      era: [],
    },
    {
      id: 'bella-era',
      title: "Bella's Beads",
      role: 'Freelance Full-Stack Developer',
      when: '2025',
      hue: '#d678b6',
      about: [
        'First freelance full-stack contract: a complete ecommerce platform for a handmade-jewelry business, from wireframe to handoff, with Stripe, Supabase, and Resend in one order lifecycle.',
      ],
      notes: ['Scoped, built, shipped, and handed off solo.', 'Real payments, real shipping, real client.'],
      credits: [
        ['Role', 'freelance full-stack'],
        ['Year', '2025'],
      ],
      era: ['bellas-beads', 'nhf'],
    },
    {
      id: 'now',
      title: 'Focusing on agentic tooling',
      role: 'Software engineer · backend, product, AI tools',
      when: '2026 to now',
      hue: '#50c878',
      current: true,
      about: [
        'Focusing on agentic tooling, backed by full-stack experience, while building practical side projects across agent workflows, automation, and client software.',
        'Looking for teams that value product judgment, reliability habits, and clear communication.',
      ],
      notes: ['US citizen; no sponsorship needed.'],
      credits: [
        ['Status', 'focusing on agentic tooling'],
        ['Location', 'nyc/nj area'],
        ['Email', 'dylanmccavitt@outlook.com'],
      ],
      era: ['agent-skills', 'bellas-beads', 'agentic-trader'],
    },
  ],
};

/**
 * THE PUBLIC TRACK ALLOWLIST. `RESUME.tracks` is the full career history; this
 * is the narrower subset the owner has chosen to show in public, and it is the
 * only door anything public reads the timeline through — the resume page via
 * its two section accessors, the DM corpus via {@link publicResumeTracks}. No
 * consumer keeps its own list, so the page and the corpus cannot drift apart:
 * an id that is not named here cannot be published by either.
 *
 * It fails closed. Adding a track to `RESUME.tracks` publishes it nowhere until
 * someone names it here on purpose. `boe` is deliberately absent: it is on the
 * timeline and off the site.
 *
 * `now` is on the list because the site already publishes it — the homepage
 * Journey renders its row and the resume page's kicker restates its facts —
 * even though the resume page has no section that lists a standing status.
 */
const PUBLIC_RESUME_EXPERIENCE_TRACK_IDS = ['paulweiss', 'kroll', 'bella-era'] as const;
const PUBLIC_RESUME_EDUCATION_TRACK_IDS = ['syracuse', 'stevens'] as const;
const PUBLIC_RESUME_STANDING_TRACK_IDS = ['now'] as const;

/** Every track id the site publishes, from all three groupings. */
export const PUBLIC_RESUME_TRACK_IDS: readonly string[] = [
  ...PUBLIC_RESUME_EXPERIENCE_TRACK_IDS,
  ...PUBLIC_RESUME_EDUCATION_TRACK_IDS,
  ...PUBLIC_RESUME_STANDING_TRACK_IDS,
];

/** Filter the timeline to an allowlisted id set, in chronological source order. */
function tracksIn(ids: readonly string[]): ResumeTrack[] {
  const allowed = new Set<string>(ids);
  return RESUME.tracks.filter((track) => allowed.has(track.id));
}

/** Every track the site publishes, chronologically. The one public read of the
    timeline: anything not on the allowlist cannot come out of here. */
export function publicResumeTracks(): ResumeTrack[] {
  return tracksIn(PUBLIC_RESUME_TRACK_IDS);
}

/** The tracks the resume page lists under Experience. */
export function publicResumeExperienceTracks(): ResumeTrack[] {
  return tracksIn(PUBLIC_RESUME_EXPERIENCE_TRACK_IDS);
}

/** The tracks the resume page lists under Education. */
export function publicResumeEducationTracks(): ResumeTrack[] {
  return tracksIn(PUBLIC_RESUME_EDUCATION_TRACK_IDS);
}

/**
 * Guard the allowlist against the timeline. A typo here fails closed — the
 * track simply stops being published — which is safe but silent, so a name
 * that resolves to nothing is a build failure instead.
 */
function assertPublicTrackIdsExist(): void {
  const known = new Set(RESUME.tracks.map((track) => track.id));
  const unknown = PUBLIC_RESUME_TRACK_IDS.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`resume.ts: PUBLIC_RESUME_TRACK_IDS names no such track: ${unknown.join(', ')}`);
  }
}

assertPublicTrackIdsExist();

/**
 * Guard the {@link PROJECT_IDS} mirror against the real catalog. Throws at
 * module load if the two disagree, so `era`'s literal-union type can never go
 * stale without failing the build.
 */
function assertCatalogIdsInSync(): void {
  const mirror = new Set<string>(PROJECT_IDS);
  const actual = new Set(CATALOG.map((p) => p.id));
  const missing = [...actual].filter((id) => !mirror.has(id));
  const extra = [...mirror].filter((id) => !actual.has(id));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `resume.ts: PROJECT_IDS out of sync with catalog` +
        (missing.length ? ` (missing: ${missing.join(', ')})` : '') +
        (extra.length ? ` (extra: ${extra.join(', ')})` : ''),
    );
  }
}

assertCatalogIdsInSync();

// There is deliberately no `getResumeTrackById`. It had no callers and read the
// full unfiltered timeline, so the next consumer to reach for it would have got
// a withheld track without noticing. Anything public reads the timeline through
// the allowlisted accessors above; if a by-id lookup is ever needed, add it over
// `publicResumeTracks()` rather than over `RESUME.tracks`.
