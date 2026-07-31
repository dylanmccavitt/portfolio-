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

// This is intentionally a compact set of durable recruiter context. Project
// facts belong in the catalog; topical experiments, hobbies, and notes about
// this site's implementation do not belong in the profile.
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
    id: 'recruiter-faq',
    category: 'recruiter',
    title: 'Recruiter basics',
    summary: 'Dylan is based in the NYC/NJ area, is a U.S. citizen, and does not require sponsorship.',
    publicationStatus: 'published',
    visibility: 'public',
  },
  {
    id: 'tools-and-stack',
    category: 'skills',
    title: 'Tools and stack',
    summary:
      'Dylan’s day-to-day stack is TypeScript and Python, with React on the front, Node on the back, Postgres underneath, and Go in the mix. He deliberately doesn’t lock into one stack: he bounces across tools and ecosystems project by project, picks what fits, and treats coming up to speed fast as the durable skill.',
    publicationStatus: 'published',
    visibility: 'public',
  },
  {
    id: 'what-dylan-is-looking-for',
    category: 'recruiter',
    title: 'What Dylan is looking for',
    summary:
      'Dylan is focusing on agentic tooling, backed by full-stack experience; some combination of the two is the target. Backend or full-stack roles, remote or hybrid, in the NYC/NJ area; he is available immediately and would relocate only for an exceptional offer.',
    publicationStatus: 'published',
    visibility: 'public',
  },
  {
    id: 'agentic-workflow',
    category: 'working-style',
    title: 'How Dylan works with AI agents',
    summary:
      'Dylan keeps agent workflows lean: short instructions point the model in the right direction, while deterministic command-line tools handle repeatable mechanics. Decisions and resumable state stay outside project repositories so stale plans do not compete with current work. He scopes delegation into small bounded tasks, asks for compact evidence-backed receipts, and uses browser testing or CI to drive fixes until the result is actually green.',
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
] satisfies readonly PublicProfileSourceEntry[];

/**
 * The raw, unfiltered source array — draft and private entries included.
 * It exists solely so `tests/dm-corpus.test.ts` can prove that unapproved text
 * never reaches public output. NEVER build public output from it: every path
 * that publishes profile text goes through `parsePublicProfileEntries()`.
 */
export const PROFILE_SOURCE_UNFILTERED_FOR_LEAK_TEST: readonly PublicProfileSourceEntry[] =
  PROFILE_SOURCE;

/**
 * The entry whose approved summary stands in as the site-level summary. It is
 * resolved through the same published+public filter as every other entry, so
 * revoking either flag removes the text from public output entirely.
 */
const SITE_SUMMARY_ENTRY_ID = 'short-bio';

/**
 * The identity block, verbatim from what the homepage already publishes
 * (`PROFILE` in `src/components/frost/frost-data.js`). It lives here because
 * `src/data/` is the approved source boundary consumers outside the island read
 * from — the island is a component and can't be imported by build-time
 * libraries. `tests/dm-corpus.test.ts` fails if the two ever disagree.
 */
export const PUBLIC_PROFILE_IDENTITY = {
  name: 'Dylan McCavitt',
  role: 'Software engineer',
  focus: 'Backend systems · product software · practical AI tools',
  location: 'NYC/NJ area',
  status: 'Focusing on agentic tooling',
  email: 'dylanmccavitt@outlook.com',
} as const;

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

/**
 * The approved entries. `source` defaults to the real module and exists so a
 * test can drive this filter with entries the approved source does not carry
 * (an unapproved one, say) — it widens nothing: whatever is passed goes through
 * `parsePublicProfileEntries()` exactly as the default does.
 */
export async function loadPublicProfileEntries(
  source: unknown = PROFILE_SOURCE,
): Promise<PublicProfileSourceEntry[]> {
  return parsePublicProfileEntries(source);
}

/**
 * The site-level summary, or `undefined` when no approved entry supplies one.
 * It reads the filtered set rather than the source array, so there is no path
 * by which an unapproved summary can be published; a consumer that gets
 * `undefined` must omit the field rather than substitute anything. `source`
 * carries the same meaning as in {@link loadPublicProfileEntries}.
 */
export async function loadPublicProfileSiteSummary(
  source: unknown = PROFILE_SOURCE,
): Promise<string | undefined> {
  const entries = await loadPublicProfileEntries(source);
  return entries.find((entry) => entry.id === SITE_SUMMARY_ENTRY_ID)?.summary;
}
