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

// Dylan approved these nine public entries exactly as written on 2026-07-21.
// Copy, facts, categories, visibility, and membership require renewed owner approval.
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
    id: 'homelab',
    category: 'interest',
    title: 'Home infrastructure',
    summary: 'Dylan runs a three-node home lab and uses it to practice reproducible, self-hosted infrastructure and reliability.',
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
  location: 'New York City',
  status: 'Open to opportunities',
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
