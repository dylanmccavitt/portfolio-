import { z } from 'zod';

/**
 * Tool-facing adapter shape for approved public profile entries (moved here
 * from the DM tools in the #352 teardown; the DM rework consumes it next).
 * A profile source must explicitly mark both publication and public
 * visibility before an entry can cross this boundary.
 */
export const PublicProfileSourceEntrySchema = z.strictObject({
  id: z.string().trim().min(1).max(200).regex(/^[a-z0-9][a-z0-9_-]*$/i),
  category: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(1_000),
  href: z.string().trim().min(1).max(2_000).optional(),
  publicationStatus: z.enum(['published', 'draft']),
  visibility: z.enum(['public', 'private']),
});

export type PublicProfileSourceEntry = z.infer<typeof PublicProfileSourceEntrySchema>;

// Dylan approved the first eight public entries exactly as written on
// 2026-07-21 (homelab was retired 2026-07-28 — the lab no longer runs). The
// `site` entries and everything from `tools-and-stack` down were added
// 2026-07-28 (#360) from an owner interview in session — his facts, drafted
// copy approved by him on the PR. Copy, facts, categories, visibility, and
// membership require renewed owner approval.
const PROFILE_SOURCE = [
  {
    id: 'short-bio',
    category: 'bio',
    title: 'Short bio',
    summary: 'Dylan is a New York City–based software engineer whose path runs from economics through legal operations and cyber risk to an M.S. in computer science. He builds backend systems, product software, and practical AI tools.',
    publicationStatus: 'published',
    visibility: 'public',
  },
  {
    id: 'career-change',
    category: 'career',
    title: 'Career change',
    summary: 'Dylan studied economics at Syracuse, developed process discipline supporting private-funds legal work at Paul, Weiss, moved into cyber strategy and risk at Kroll, and completed an M.S. in computer science at Stevens while shipping software projects.',
    publicationStatus: 'published',
    visibility: 'public',
  },
  {
    id: 'working-style',
    category: 'working-style',
    title: 'How Dylan works',
    summary: 'Dylan values product judgment, reliability, and clear communication. His legal and security background shows up in explicit risk gates, careful handling of secrets, read-only defaults, and attention to details that can affect real users.',
    publicationStatus: 'published',
    visibility: 'public',
  },
  {
    id: 'skills-focus',
    category: 'skills',
    title: 'Engineering focus',
    summary: 'Dylan is focused on software engineering roles spanning backend systems, product development, and AI tooling. His project work includes web applications, automation, evaluation systems, infrastructure, and client software.',
    publicationStatus: 'published',
    visibility: 'public',
  },
  {
    id: 'recruiter-faq',
    category: 'recruiter',
    title: 'Recruiter basics',
    summary: 'Dylan is interviewing for full-time software engineering roles, is based in New York City, is a U.S. citizen, and does not require sponsorship.',
    publicationStatus: 'published',
    visibility: 'public',
  },
  {
    id: 'practical-side-projects',
    category: 'outside-work',
    title: 'Practical side projects',
    summary: 'Outside paid work, Dylan builds practical side projects around assistant evaluation, local finance automation, infrastructure scheduling, and small consumer apps.',
    publicationStatus: 'published',
    visibility: 'public',
  },
  {
    id: 'markets-and-trading',
    category: 'interest',
    title: 'Markets and trading systems',
    summary: 'Markets are a recurring project interest, including trading automation, options-exit tooling, local portfolio tracking, and repeatable chart review.',
    publicationStatus: 'published',
    visibility: 'public',
  },
  {
    id: 'games-as-test-beds',
    category: 'easter-egg',
    title: 'Games as test beds',
    summary: 'One shelved experiment used browser games as repeatable test beds for comparing assistant behavior instead of judging changes by feel.',
    publicationStatus: 'published',
    visibility: 'public',
  },
  {
    id: 'how-this-site-was-built',
    category: 'site',
    title: 'How this site was built',
    summary:
      'This site is a fully static Astro build with one interactive React island for the homepage — every page prerenders, there is no database, and all content comes from a single typed catalog file in the repo. Dylan designed and built it iteratively with AI coding agents working under his direction: the visual language (the frost surface, the glitch reveal on the Work cards) came out of dozens of throwaway prototypes he walked through in a real browser before locking a direction, and the chosen design was then ported into production with tests and full no-JavaScript fallbacks. Deploying is the entire publish step.',
    publicationStatus: 'published',
    visibility: 'public',
  },
  {
    id: 'how-dm-was-built',
    category: 'site',
    title: 'How DM, this agent, was built',
    summary:
      'DM is a small service Dylan built separately from the site. It is grounded in a snapshot of exactly what the site publishes — the same projects, profile, and timeline any visitor can read — and nothing else, so it cannot reveal anything the site does not. Answers stream into the corner card, and the few page actions DM can take (scrolling to a section, revealing a project card, opening a project page) are validated twice against an allowlist: once on the service and again in the browser, which trusts nothing the service sends. Honesty is the design rule: when something is not published, DM says so and points at Dylan’s email instead of guessing.',
    publicationStatus: 'published',
    visibility: 'public',
  },
  {
    id: 'tools-and-stack',
    category: 'skills',
    title: 'Tools and stack',
    summary:
      'Dylan’s day-to-day stack is TypeScript and Python — React on the front, Node on the back, Postgres underneath — with Go in the mix. He deliberately doesn’t lock into one stack: he bounces across tools and ecosystems project by project, picks what fits, and treats coming up to speed fast as the durable skill.',
    publicationStatus: 'published',
    visibility: 'public',
  },
  {
    id: 'what-dylan-is-looking-for',
    category: 'recruiter',
    title: 'What Dylan is looking for',
    summary:
      'Backend or full-stack roles, remote or hybrid, and he is immediately available. Work involving AI agents is the strong preference — building them, orchestrating them, or building the tooling around them. He is based in New York City and would relocate only for an exceptional offer.',
    publicationStatus: 'published',
    visibility: 'public',
  },
  {
    id: 'agentic-workflow',
    category: 'working-style',
    title: 'How Dylan works with AI agents',
    summary:
      'Dylan works as the orchestrator — the conductor of the orchestra — directing CLI agents like Claude Code and Codex rather than typing every line himself. The pattern: research the context the task actually needs, plan against what was found, then either one-shot the implementation or run it in checkpoints when the plan needs tighter control; small well-bounded tasks get handed to several agents in parallel. He leans on subagents and MCP tooling (context7 among others), and every hand-off carries the same standing rule: test heavily — browser automation or CI — with agents fixing failures in a loop until green.',
    publicationStatus: 'published',
    visibility: 'public',
  },
  {
    id: 'before-engineering',
    category: 'career',
    title: 'What the pre-engineering years left behind',
    summary:
      'The years before engineering left specific skills. At Paul, Weiss, Dylan served on the committee that stress-tested procedures for the firm’s migration to a new document management system. At Kroll he was client-facing, delivering risk assessments and related services to Fortune 500 companies. Interfacing with clients and gathering technical requirements translates directly into his agentic work today: gathering business requirements and communicating with stakeholders.',
    publicationStatus: 'published',
    visibility: 'public',
  },
  {
    id: 'graduate-school',
    category: 'education',
    title: 'Graduate school, in detail',
    summary:
      'Dylan finished his M.S. in Computer Science at Stevens with a 3.9 GPA, and made a habit of taking on extra machine-learning coursework whenever the assigned work ran too easy — the EPL match predictor came out of exactly that.',
    publicationStatus: 'published',
    visibility: 'public',
  },
  {
    id: 'where-to-find-dylan',
    category: 'contact',
    title: 'Where to find Dylan online',
    summary:
      'Dylan’s code is public on GitHub at github.com/dylanmccavitt, and he is on LinkedIn as Dylan McCavitt. Email is the fastest way to reach him: dylanmccavitt@outlook.com.',
    publicationStatus: 'published',
    visibility: 'public',
  },
] satisfies readonly PublicProfileSourceEntry[];

export const PUBLIC_PROFILE_SITE_SUMMARY = PROFILE_SOURCE[0].summary;

export function parsePublicProfileEntries(input: unknown): PublicProfileSourceEntry[] {
  const entries = PublicProfileSourceEntrySchema.array().parse(input);
  const publicEntries = entries.filter(
    (entry) => entry.publicationStatus === 'published' && entry.visibility === 'public',
  );
  if (new Set(publicEntries.map((entry) => entry.id)).size !== publicEntries.length) {
    throw new Error('Published public profile ids must be unique.');
  }
  return publicEntries.map((entry) => ({ ...entry }));
}

export async function loadPublicProfileEntries(): Promise<PublicProfileSourceEntry[]> {
  return parsePublicProfileEntries(PROFILE_SOURCE);
}
