/**
 * Resume — the career timeline. Ported verbatim from the player redesign
 * prototype (`15-player-v4.html`, the `RESUME` object). This is the single
 * source of truth for the resume views (a separate issue).
 *
 * Field names mirror the prototype so porting the renderers stays mechanical.
 * Copy (about, notes, credits, hues, lengths) is carried over as-is.
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
  'agentic-trader',
  'exit-manager',
  'hood',
  'tradingview-mcp',
  'dog-log',
  'chore-ladder',
  'homeserver',
  'bellas-beads',
  'nhf',
  'work-orders',
  'epl-ml',
  'condor-study',
  'harness-arena',
] as const;

/** A catalog project id, constrained to the ids the catalog ships. */
export type ProjectId = (typeof PROJECT_IDS)[number];

/** `[label, value]` credit tuple, e.g. `['Degree', 'b.s. economics']`. */
export type ResumeCredit = [label: string, value: string];

/** A single chronological career track on the resume timeline. */
export interface ResumeTrack {
  id: string;
  /** Two-letter symbol shown on the album tile. */
  sym: string;
  title: string;
  role: string;
  /** Time span, e.g. `'2020 — 2023'`. */
  when: string;
  /** Track "length", e.g. `'3:00'` (or `'—'` for the current track). */
  len: string;
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

/** The resume: metadata plus the chronological career tracks. */
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
    'Career history in chronological order, from an economics degree to building trading systems, agents, and iOS apps in NYC.',
  tracks: [
    {
      id: 'syracuse',
      sym: 'su',
      title: 'Syracuse University',
      role: 'B.S. Economics',
      when: '2019',
      len: '4:00',
      hue: '#ef8354',
      about: [
        'B.S. in Economics from Syracuse University, class of 2019.',
        'Markets, incentives, and working from data, before writing production code.',
      ],
      notes: ['Economics intuition still anchors the trading-systems work.'],
      credits: [
        ['Degree', 'b.s. economics'],
        ['Class', '2019'],
      ],
      era: [],
    },
    {
      id: 'paulweiss',
      sym: 'pw',
      title: 'Paul, Weiss',
      role: 'Practice Assistant, Private Funds',
      when: '2020 to 2023',
      len: '3:00',
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
      sym: 'kr',
      title: 'Kroll, Inc.',
      role: 'Associate, Cyber Strategy & Risk',
      when: '2023 to 2024',
      len: '1:30',
      hue: '#50c878',
      about: [
        'Associate on Kroll’s Cyber Strategy & Risk team, running security assessments and risk work for client organizations.',
        'The security habits carried forward: risk gates on trading systems, paper-first scaffolds, secrets hygiene, read-only defaults.',
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
      sym: 'st',
      title: 'Stevens Institute of Technology',
      role: 'M.S. Computer Science',
      when: '2024 to 2026',
      len: '2:00',
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
      sym: 'be',
      title: 'Manhattan Board of Elections',
      role: 'IT Support',
      when: '2025',
      len: '0:45',
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
      sym: 'bb',
      title: "Bella's Beads",
      role: 'Freelance Full-Stack Developer',
      when: '2025',
      len: '1:15',
      hue: '#d678b6',
      about: [
        'First freelance full-stack contract: a complete ecommerce platform for a handmade-jewelry business, from wireframe to handoff, with Stripe, Shippo, Supabase, and Resend in one order lifecycle.',
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
      sym: 'dm',
      title: 'Open to opportunities',
      role: 'Software engineer · agents, trading infra, iOS',
      when: '2026 to now',
      len: 'now',
      hue: '#50c878',
      current: true,
      about: [
        'Currently building agentic systems and trading infrastructure in NYC: one system live against real money, an autonomous trader scheduled to go live June 23, and two iOS apps heading to the App Store.',
        'Interviewing for full-time roles.',
      ],
      notes: ['US citizen; no sponsorship needed.'],
      credits: [
        ['Status', 'open to opportunities'],
        ['Location', 'new york city'],
        ['Email', 'dylanmccavitt@outlook.com'],
      ],
      era: ['agentic-trader', 'exit-manager', 'hood'],
    },
  ],
};

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

/**
 * Seek position for the player bar's 2019 → now timeline. Maps a track index
 * (0-based) to a percentage, evenly spaced so track 1 → ~14% and the last
 * track → 100%.
 */
export function trackSeekPct(index: number, total: number = RESUME.tracks.length): number {
  if (total <= 0) return 0;
  const clamped = Math.min(Math.max(index, 0), total - 1);
  return Math.round(((clamped + 1) / total) * 100);
}

/** Look up a resume track by id. */
export function getResumeTrackById(id: string): ResumeTrack | null {
  return RESUME.tracks.find((t) => t.id === id) ?? null;
}
