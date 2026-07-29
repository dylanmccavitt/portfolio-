export const PROFILE = {
  name: "Dylan McCavitt",
  role: "Software engineer",
  focus: "Backend systems · product software · practical AI tools",
  location: "NYC/NJ area",
  status: "Focusing on agentic tooling",
  email: "dylanmccavitt@outlook.com",
  summary:
    "Dylan is a New York City–based software engineer whose path runs from economics through legal operations and cyber risk to an M.S. in computer science.",
};

/**
 * Homepage display order for the Work card grid (#350). Card content comes
 * from the published detail models at build time (see `src/pages/index.astro`);
 * this list only pins the order. Ids the list doesn't know render last.
 */
export const WORK_ORDER = [
  "agent-skills",
  "bellas-beads",
  "agentic-trader",
  "nhf",
  "work-orders",
  "epl-ml",
];

/**
 * Homepage Journey display copy, keyed by resume track id.
 *
 * THIS DOES NOT DECIDE WHICH ROWS APPEAR. The row set comes from
 * `publicResumeTracks()` in `src/data/resume.ts` — the same public-track
 * allowlist the resume page, the OG images, and the DM corpus read — and is
 * assembled at build time by `src/lib/journey.ts`. A track the allowlist
 * withholds cannot be published here, whatever this map says; a label here for
 * an id that is not allowlisted is simply never used.
 *
 * Every field is optional. What is absent falls back to the track's own `when`,
 * `title`, and `role`, so a newly allowlisted track renders correctly with no
 * entry at all. These overrides exist only to shorten long resume prose for a
 * one-line row.
 */
export const JOURNEY_LABELS = {
  paulweiss: { when: "2020–2023", role: "Private-funds legal operations" },
  kroll: { when: "2023–2024", place: "Kroll", role: "Cyber Strategy & Risk" },
  stevens: { when: "2024–2026", place: "Stevens" },
  "bella-era": { role: "Freelance full-stack developer" },
  now: { when: "Now", role: "Full-stack experience · backend & AI" },
};
