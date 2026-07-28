export const PROFILE = {
  name: "Dylan McCavitt",
  role: "Software engineer",
  focus: "Backend systems · product software · practical AI tools",
  location: "New York City",
  status: "Open to opportunities",
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

export const JOURNEY = [
  ["2019", "Syracuse University", "B.S. Economics"],
  ["2020–2023", "Paul, Weiss", "Private-funds legal operations"],
  ["2023–2024", "Kroll", "Cyber Strategy & Risk"],
  ["2024–2026", "Stevens", "M.S. Computer Science"],
  ["2025", "Bella's Beads", "Freelance full-stack developer"],
  ["Now", "Open to opportunities", "Backend, product, and AI tools"],
];
