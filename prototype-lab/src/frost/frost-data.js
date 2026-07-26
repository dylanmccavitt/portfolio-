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
 * Owner-approved homepage copy for the featured projects. These entries lead
 * the Work section's order and override the published copy for their ids;
 * the rest of the published set renders with its published copy.
 */
export const PROJECTS = [
  {
    id: "bellas-beads",
    title: "Bella's Beads",
    eyebrow: "Shipped client work · 2025",
    line: "Client ecommerce site: browse, pay, ship, track, and hand off.",
    summary:
      "A complete ecommerce platform for a handmade-jewelry business, built from wireframe to production handoff.",
    proof: ["400+ commits to handoff", "4 integrations", "Guest + account checkout"],
  },
  {
    id: "evalgate",
    title: "evalgate",
    eyebrow: "AI & developer tools · Building",
    line: "Regression tests for assistant behavior using real recorded sessions.",
    summary:
      "Records a real assistant session, replays it later, and fails when a change makes the assistant behave differently or unsafely.",
    proof: ["Record once", "Replay every change", "Checks actions, not just prose"],
  },
  {
    id: "agentic-trader",
    title: "agentic-trader",
    eyebrow: "Side project · Dry-run",
    line: "A scheduled, inspectable trading-automation review loop.",
    summary:
      "A weekday workflow checks a simple RSI(2) signal and journals each proposed entry, simulated fill, and deterministic gate decision.",
    proof: ["15:45 ET", "RSI(2)", "Reviewable decision journal"],
  },
  {
    id: "slurmlet",
    title: "slurmlet",
    eyebrow: "Systems learning · Building",
    line: "All-or-nothing scheduling for simulated GPU jobs.",
    summary:
      "A job waits until every GPU it needs is free, then reserves the complete set together. Built in Go and Python against a simulated fleet.",
    proof: ["Go + Python", "All-or-nothing start", "Simulated GPU fleet"],
  },
];

export const JOURNEY = [
  ["2019", "Syracuse University", "B.S. Economics"],
  ["2020–2023", "Paul, Weiss", "Private-funds legal operations"],
  ["2023–2024", "Kroll", "Cyber Strategy & Risk"],
  ["2024–2026", "Stevens", "M.S. Computer Science"],
  ["2025", "Bella's Beads", "Freelance full-stack developer"],
  ["Now", "Open to opportunities", "Backend, product, and AI tools"],
];

export const FAMILY_ROUTES = [
  {
    family: "HTML-in-Canvas",
    description: "Authored semantic websites, progressively enhanced by Canvas UI.",
    routes: [
      ["/html/refractive-editorial", "Refractive Editorial"],
      ["/html/particle-storyline", "Particle Storyline"],
      ["/html/layered-material", "Layered Material"],
    ],
  },
  {
    family: "Infinite canvas",
    description: "Headless, read-only tldraw portfolios with custom semantic HTML shapes.",
    routes: [
      ["/canvas/project-constellation", "Project Constellation"],
      ["/canvas/editorial-archipelago", "Editorial Archipelago"],
      ["/canvas/career-ribbon", "Career Ribbon"],
    ],
  },
];
