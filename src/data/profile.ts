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
    summary: 'Dylan is based in the NYC/NJ area, is a U.S. citizen, and does not require sponsorship.',
    publicationStatus: 'published',
    visibility: 'public',
  },
  {
    id: 'practical-side-projects',
    category: 'outside-work',
    title: 'Practical side projects',
    summary: 'Outside paid work, Dylan builds practical side projects around agent tooling, trading automation, and small consumer apps.',
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
      'Dylan is focusing on agentic tooling, backed by full-stack experience — some combination of the two is the target. Backend or full-stack roles, remote or hybrid, in the NYC/NJ area; he is available immediately and would relocate only for an exceptional offer.',
    publicationStatus: 'published',
    visibility: 'public',
  },
  {
    id: 'agentic-workflow',
    category: 'working-style',
    title: 'How Dylan works with AI agents',
    summary:
      'Dylan works as the orchestrator — the conductor of the orchestra — directing CLI agents rather than typing every line himself: Claude Code and Codex day to day, with pi in the mix for tinkering. His agent-skills repo is effectively his workflow written down. The habit that has proven most effective is upfront planning and prototyping: research the context a task actually needs and work the approach out on disposable prototypes before an agent runs off to write code — implementing first and reworking mistakes after makes the code and the project harder to change. From a settled plan he either one-shots the implementation or runs it in checkpoints, hands small bounded tasks to several agents in parallel, leans on subagents and MCP tooling, and every hand-off carries the same standing rule: test heavily — browser automation or CI — with agents fixing failures in a loop until green.',
    publicationStatus: 'published',
    visibility: 'public',
  },
  {
    id: 'before-engineering',
    category: 'career',
    title: 'What the pre-engineering years left behind',
    summary:
      'Paul, Weiss and Kroll were Dylan’s work before he decided to switch career paths, and they left real experience operating in a corporate business environment and working directly with clients. At Paul, Weiss he served on the committee that stress-tested procedures for the firm’s migration to a new document management system; at Kroll he was client-facing, delivering risk assessments and related services to Fortune 500 companies.',
    publicationStatus: 'published',
    visibility: 'public',
  },
  {
    id: 'graduate-school',
    category: 'education',
    title: 'Graduate school, in detail',
    summary:
      'Dylan finished his M.S. in Computer Science at Stevens in spring 2026 with a 3.61 GPA, focused on algorithms and data structures.',
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
  {
    id: 'hobbies',
    category: 'interest',
    title: 'Off the clock',
    summary: 'Outside of building things: video games, chess, and trading on the side. He watches the NFL, NBA, and MLB — the Browns, Cavs, and Yankees are the teams.',
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
