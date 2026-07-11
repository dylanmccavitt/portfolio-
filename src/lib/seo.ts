/**
 * Per-page SEO/meta derivation (#29).
 *
 * Pages pass data (a project, a resume entry, or nothing); this module derives the
 * tags — title, description, OG image path, `og:type`, and JSON-LD — so layout
 * components can share one metadata contract. Descriptions are trimmed here to
 * ≤160 chars.
 *
 * OG image paths point at the static `/og/**.png` endpoints rendered at build
 * (see `src/pages/og/`). Shared routes use one fallback image.
 */
import type { ProjectLink } from '@/data/catalog';
import type { ResumeTrack } from '@/data/resume';
import { RESUME } from '@/data/resume';

/** Site owner — reused in titles and JSON-LD. */
const OWNER = 'Dylan McCavitt';

/** Canonical origin (mirrors `site` in astro.config.mjs). */
const ORIGIN = 'https://dylanmccavitt.xyz';

/** Fallback OG image for home, library, resume, and hiring routes. */
export const OG_FALLBACK = '/og/default.png';

/**
 * Serialize JSON-LD for an inline script element without allowing data to
 * terminate that element. This remains valid JSON after escaping.
 */
export function serializeJsonLd(value: unknown): string {
  const serialized = JSON.stringify(value) ?? 'null';
  return serialized
    .replace(/<\/script/gi, (match) => `<\\/${match.slice(2)}`)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** The resolved meta a page hands to the layout head. */
export interface PageMeta {
  title: string;
  description: string;
  /** Root-relative OG image path (resolved to absolute in the layout). */
  ogImage: string;
  ogType: 'website' | 'article' | 'profile';
  /** Optional JSON-LD object, serialized into a `<script type=ld+json>`. */
  jsonLd?: Record<string, unknown>;
}

type ProjectMetaInput = {
  id: string;
  slug?: string;
  title: string;
  line: string;
  about: string[];
  links: ProjectLink[];
  year: number;
};

/** Trim to ≤160 chars on a word boundary, with an ellipsis when cut. */
function clampDescription(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(' ');
  return `${slice.slice(0, lastSpace > 40 ? lastSpace : slice.length).trimEnd()}…`;
}

/** `<thing> — Dylan McCavitt` title pattern. */
function titleFor(name: string): string {
  return `${name} · ${OWNER}`;
}

/** Home / library / filtered index meta — shared fallback OG image. */
export function libraryMeta(name: string, description: string): PageMeta {
  return {
    title: titleFor(name),
    description: clampDescription(description),
    ogImage: OG_FALLBACK,
    ogType: 'website',
  };
}

/** Project detail meta — per-project OG image + SoftwareSourceCode JSON-LD. */
export function projectMeta(p: ProjectMetaInput): PageMeta {
  const slug = p.slug ?? p.id;
  const description = clampDescription(p.about[0] ?? p.line);
  const url = `${ORIGIN}/projects/${slug}/`;
  const repo = p.links.find((link) => /repo|github/i.test(link.label))?.href;
  const live = p.links.find((link) => /live|site/i.test(link.label))?.href;
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name: p.title,
    description,
    url,
    image: `${ORIGIN}/og/projects/${slug}.png`,
    author: { '@type': 'Person', name: OWNER, url: ORIGIN },
    dateModified: String(p.year),
  };
  if (repo) jsonLd.codeRepository = repo;
  if (live) jsonLd.url = live;
  return {
    title: titleFor(p.title),
    description,
    ogImage: `/og/projects/${slug}.png`,
    ogType: 'article',
    jsonLd,
  };
}

/** Resume index meta — uses the fallback OG image, profile type. */
export function journeyMeta(): PageMeta {
  return {
    title: titleFor(RESUME.title),
    description: clampDescription(RESUME.about),
    ogImage: OG_FALLBACK,
    ogType: 'profile',
  };
}

/** Resume entry meta — per-entry OG image + CreativeWork JSON-LD. */
export function journeyTrackMeta(t: ResumeTrack): PageMeta {
  const description = clampDescription(t.about[0] ?? t.role);
  return {
    title: `${t.title} · Resume · ${OWNER}`,
    description,
    ogImage: `/og/journey/${t.id}.png`,
    ogType: 'article',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'CreativeWork',
      name: `${t.title} · ${t.role}`,
      description,
      url: `${ORIGIN}/journey/${t.id}/`,
      image: `${ORIGIN}/og/journey/${t.id}.png`,
      author: { '@type': 'Person', name: OWNER, url: ORIGIN },
    },
  };
}

/** Person JSON-LD for the homepage. */
export function personJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: OWNER,
    url: ORIGIN,
    jobTitle: 'Software Engineer',
    description:
      'Software engineer in NYC building practical tools, client software, and AI-assisted workflows.',
    image: `${ORIGIN}${OG_FALLBACK}`,
    sameAs: [
      'https://github.com/DylanMcCavitt',
      'https://www.linkedin.com/in/dylan-mccavitt',
    ],
  };
}
