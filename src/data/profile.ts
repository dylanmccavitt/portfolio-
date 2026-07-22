import {
  PublicProfileSourceEntrySchema,
  type PublicProfileSourceEntry,
} from '@/lib/dm/public-agent-tools';

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
