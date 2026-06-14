/**
 * Per-page SEO/meta derivation (#29).
 *
 * Pages pass *data* (a project, a track, or nothing); this module derives the
 * tags — title, description, OG image path, `og:type`, and JSON-LD — so the
 * head implementation stays in one component (`layouts/Player.astro`) and pages
 * never hand-write meta. Descriptions are trimmed here to ≤160 chars.
 *
 * OG image paths point at the static `/og/**.png` endpoints rendered at build
 * (see `src/pages/og/`). The library/playlist routes share one fallback image.
 */
import type { Project } from '../data/catalog';
import type { ResumeTrack } from '../data/resume';
import { RESUME } from '../data/resume';

/** Site owner — reused in titles and JSON-LD. */
const OWNER = 'Dylan McCavitt';

/** Canonical origin (mirrors `site` in astro.config.mjs). */
const ORIGIN = 'https://dylanmccavitt.xyz';

/** Fallback OG image for the home + library/playlist routes. */
export const OG_FALLBACK = '/og/default.png';

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

/** Home / library / playlist meta — shared fallback OG image. */
export function libraryMeta(name: string, description: string): PageMeta {
  return {
    title: titleFor(name),
    description: clampDescription(description),
    ogImage: OG_FALLBACK,
    ogType: 'website',
  };
}

/** Project detail meta — per-project OG image + SoftwareSourceCode JSON-LD. */
export function projectMeta(p: Project): PageMeta {
  const description = clampDescription(p.about[0] ?? p.line);
  const url = `${ORIGIN}/projects/${p.id}/`;
  const repo = p.links.find(([label]) => /repo|github/i.test(label))?.[1];
  const live = p.links.find(([label]) => /live|site/i.test(label))?.[1];
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name: p.title,
    description,
    url,
    image: `${ORIGIN}/og/projects/${p.id}.png`,
    author: { '@type': 'Person', name: OWNER, url: ORIGIN },
    dateModified: String(p.year),
  };
  if (repo) jsonLd.codeRepository = repo;
  if (live) jsonLd.url = live;
  return {
    title: titleFor(p.title),
    description,
    ogImage: `/og/projects/${p.id}.png`,
    ogType: 'article',
    jsonLd,
  };
}

/** Journey album meta — uses the fallback OG image, profile type. */
export function journeyMeta(): PageMeta {
  return {
    title: titleFor(RESUME.title),
    description: clampDescription(RESUME.about),
    ogImage: OG_FALLBACK,
    ogType: 'profile',
  };
}

/** Journey track meta — per-track OG image + CreativeWork JSON-LD. */
export function journeyTrackMeta(t: ResumeTrack): PageMeta {
  const description = clampDescription(t.about[0] ?? t.role);
  return {
    title: `${t.title} · ${RESUME.title} · ${OWNER}`,
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
      'Software engineer building agentic systems, trading infrastructure, and iOS apps in NYC.',
    image: `${ORIGIN}${OG_FALLBACK}`,
    sameAs: [
      'https://github.com/DylanMcCavitt',
      'https://www.linkedin.com/in/dylan-mccavitt',
    ],
  };
}
