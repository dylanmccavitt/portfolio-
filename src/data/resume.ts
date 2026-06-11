/**
 * Resume album ("The Journey") for the player UI.
 *
 * Ported from the `RESUME` object in the prototype
 * (`~/Projects/portfolio-redesign-prototypes/15-player-v4.html`), which is the
 * source of truth for copy, hues, track lengths, and credits. Seven
 * chronological career tracks, 2019 → now, with `era` cross-links into the
 * project catalog from issue #18.
 */

import { projectById, type Credit, type Project } from './catalog';

/**
 * Catalog project ids that resume tracks may cross-link to.
 * Kept as a literal union so a typo in an `era` entry fails `astro check`;
 * the module-load assertion below guards against catalog drift at runtime.
 */
export const ERA_PROJECT_IDS = [
  'work-orders',
  'epl-ml',
  'bellas-beads',
  'nhf',
  'agentic-trader',
  'exit-manager',
  'hood',
] as const;

export type EraProjectId = (typeof ERA_PROJECT_IDS)[number];

export type ResumeTrackId =
  | 'syracuse'
  | 'paulweiss'
  | 'kroll'
  | 'stevens'
  | 'boe'
  | 'bella-era'
  | 'now';

export interface ResumeTrack {
  id: ResumeTrackId;
  sym: string;
  title: string;
  role: string;
  when: string;
  len: string;
  hue: string;
  current?: boolean;
  about: string[];
  notes: string[];
  credits: Credit[];
  /** Catalog projects shipped during this era. */
  era: EraProjectId[];
}

export interface ResumeAlbum {
  title: string;
  line: string;
  about: string;
  tracks: ResumeTrack[];
}

export const RESUME: ResumeAlbum = {
  title: 'The Journey',
  line: 'economics → legal ops → cyber risk → engineering',
  about: 'Career history in chronological order — from an economics degree to building trading systems, agents, and iOS apps in NYC.',
  tracks: [
    {
      id: 'syracuse', sym: 'su', title: 'Syracuse University', role: 'B.S. Economics',
      when: '2019', len: '4:00', hue: '#ef8354',
      about: [
        'B.S. in Economics from Syracuse University, class of 2019.',
        'Markets, incentives, and working from data — before writing production code.',
      ],
      notes: ['Economics intuition still anchors the trading-systems work.'],
      credits: [['Degree', 'b.s. economics'], ['Class', '2019']],
      era: [],
    },
    {
      id: 'paulweiss', sym: 'pw', title: 'Paul, Weiss', role: 'Practice Assistant, Private Funds',
      when: '2020 — 2023', len: '3:00', hue: '#5da8e8',
      about: [
        'Practice assistant in the Private Funds group at Paul, Weiss, supporting legal work where the tolerance for detail errors is zero.',
        'Three years of process discipline and document rigor against deadlines that don’t move.',
      ],
      notes: ['Daily exposure to how funds are actually structured and run.'],
      credits: [['Group', 'private funds'], ['Years', '2020 — 2023']],
      era: [],
    },
    {
      id: 'kroll', sym: 'kr', title: 'Kroll, Inc.', role: 'Associate, Cyber Strategy & Risk',
      when: '2023 — 2024', len: '1:30', hue: '#50c878',
      about: [
        'Associate on Kroll’s Cyber Strategy & Risk team — security assessments and risk work for client organizations.',
        'The security habits carried forward: risk gates on trading systems, paper-first scaffolds, secrets hygiene, read-only defaults.',
      ],
      notes: ['The pivot into technical work.'],
      credits: [['Team', 'cyber strategy & risk'], ['Years', '2023 — 2024']],
      era: [],
    },
    {
      id: 'stevens', sym: 'st', title: 'Stevens Institute of Technology', role: 'M.S. Computer Science',
      when: '2024 — 2026', len: '2:00', hue: '#8b7cf6',
      about: [
        'M.S. in Computer Science at Stevens — the formal foundation under the self-taught stack. Systems, web programming, and mobile systems, with two group projects from coursework in this catalog.',
        'Completed 2026, shipping side projects throughout.',
      ],
      notes: ['Two catalog entries came out of coursework here.'],
      credits: [['Degree', 'm.s. computer science'], ['Class', '2026']],
      era: ['work-orders', 'epl-ml'],
    },
    {
      id: 'boe', sym: 'be', title: 'Manhattan Board of Elections', role: 'IT Support',
      when: '2025', len: '0:45', hue: '#e6b450',
      about: [
        'IT support for the Manhattan Board of Elections — keeping election-season infrastructure running, where downtime isn’t an option.',
      ],
      notes: ['Production support under real deadline pressure.'],
      credits: [['Role', 'it support'], ['Year', '2025']],
      era: [],
    },
    {
      id: 'bella-era', sym: 'bb', title: "Bella's Beads", role: 'Freelance Full-Stack Developer',
      when: '2025', len: '1:15', hue: '#d678b6',
      about: [
        'First freelance full-stack contract: a complete ecommerce platform for a handmade-jewelry business, from wireframe to handoff — Stripe, Shippo, Supabase, and Resend in one order lifecycle.',
      ],
      notes: ['Scoped, built, shipped, and handed off solo.', 'Real payments, real shipping, real client.'],
      credits: [['Role', 'freelance full-stack'], ['Year', '2025']],
      era: ['bellas-beads', 'nhf'],
    },
    {
      id: 'now', sym: 'dm', title: 'Open to opportunities', role: 'Software engineer · agents, trading infra, iOS',
      when: '2026 —', len: '—', hue: '#50c878', current: true,
      about: [
        'Currently building agentic systems and trading infrastructure in NYC: one system live against real money, an autonomous trader scheduled to go live June 23, and two iOS apps heading to the App Store.',
        'Interviewing for full-time roles.',
      ],
      notes: ['US citizen; no sponsorship needed.'],
      credits: [['Status', 'open to opportunities'], ['Location', 'new york city'], ['Email', 'dylanmccavitt@outlook.com']],
      era: ['agentic-trader', 'exit-manager', 'hood'],
    },
  ],
};

/* Era integrity: every cross-linked id must resolve to a catalog project.
   Runs once at module load so a stale id fails the build, not a visitor. */
for (const id of ERA_PROJECT_IDS) {
  if (!projectById(id)) {
    throw new Error(`resume era cross-link "${id}" has no matching project in the catalog`);
  }
}

export function resumeTrackById(id: string): ResumeTrack | undefined {
  return RESUME.tracks.find((t) => t.id === id);
}

/** Projects shipped during a track's era, resolved against the catalog. */
export function eraProjects(track: ResumeTrack): Project[] {
  return track.era
    .map((id) => projectById(id))
    .filter((p): p is Project => p !== undefined);
}

/**
 * Player-bar seek position on the 2019 → now rail, mirroring the prototype:
 * the playhead sits at the end of the current track, so track index 0 of 7
 * → 14% and the final track → 100%.
 */
export function timelinePct(trackIndex: number): number {
  return Math.round(((trackIndex + 1) / RESUME.tracks.length) * 100);
}
