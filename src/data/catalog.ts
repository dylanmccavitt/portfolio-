/**
 * Legacy project catalog — migration/parity data plus the offline-development
 * and explicit operator-emergency project source.
 *
 * Decision log (Dylan, 2026-07-27, #350): the published set is cut to 8.
 * Removed as stale or not publishable: exit-manager, hood, tradingview-mcp,
 * dog-log, chore-ladder, homeserver, condor-study, harness-arena. Added:
 * agent-skills (in progress, v1.0 on npm). Every entry's `about` is exactly
 * three paragraphs — [problem, approach, outcome] — which the project page
 * renders under those headings.
 *
 * Deployed database mode never overlays or falls back to this file. Public DB
 * rows are authoritative there and fail closed when unavailable.
 *
 * Link integrity: every link points at a live destination. evalgate and
 * slurmlet repos are public as of July 2026 and are now linked.
 */

import {
  CatalogProjectSchema,
  type CatalogProject,
  type ProjectArea,
  type ProjectDetailEntry,
  type ProjectImageMedia,
  type ProjectLink,
  type ProjectMedia,
  type ProjectMetric,
  type ProjectSeek,
  type ProjectSkeletonKind,
  type ProjectSkeletonMedia,
  type ProjectStatus,
  type ProjectVideoMedia,
} from '@/lib/projects/schema';

/** Base for real screenshot paths, served from `public/screenshots/`. */
const SHOTS = '/screenshots';

export type StatusKind = ProjectStatus[0];
export type ProjectStackEntry = ProjectDetailEntry;
export type ProjectImageShot = ProjectImageMedia;
export type ProjectVideoShot = ProjectVideoMedia;
export type SkeletonKind = ProjectSkeletonKind;
export type ProjectSkeletonShot = ProjectSkeletonMedia;
export type ProjectShot = ProjectMedia;
export type Project = CatalogProject;
export type {
  ProjectArea,
  ProjectLink,
  ProjectMetric,
  ProjectSeek,
  ProjectStatus,
};

/** Type guard: is this shot a real captured image? */
export function isImageShot(shot: ProjectShot): shot is ProjectImageShot {
  return shot.kind === 'image';
}

/** Type guard: is this shot a captured demo video? */
export function isVideoShot(shot: ProjectShot): shot is ProjectVideoShot {
  return shot.kind === 'video';
}

export const CATALOG: Project[] = CatalogProjectSchema.array().parse([
  {
    id: 'agent-skills',
    title: 'agent-skills',
    sym: 'as',
    area: 'AI & Developer Tools',
    status: ['live', 'v1.0 on npm'],
    year: 2026,
    activity: 'in progress',
    hue: '#8b7cf6',
    wip: true,
    money: false,
    line: 'a skills package that keeps coding agents on course: direction, delivery, and continuity',
    seek: { from: 'v1.0 on npm', to: 'daily driver', pct: 75 },
    links: [
      { label: 'View repo ↗', href: 'https://github.com/dylanmccavitt/agent-skills' },
      { label: 'npm ↗', href: 'https://www.npmjs.com/package/@dylanmccavitt/agent-skills' },
    ],
    metrics: [
      { value: 'v1.0.0', label: 'published on npm' },
      { value: '3 + 2', label: 'skills + command-line tools' },
      { value: '70/70', label: 'tests passing' },
      { value: '3', label: 'agent harnesses from one install' },
    ],
    about: [
      'Coding agents forget. A session ends and the plan, the decision, and the half-finished work scatter into stray notes files — or vanish — so every new session starts by re-deriving what the last one already settled.',
      'agent-skills packages three habits an agent can load — settle a direction with disposable prototypes (compass), hand off bounded work and get one compact receipt back (relay), and leave a durable marker where it belongs instead of littering the repository (cairn) — plus two command-line tools that carry the mechanics: a decision shelf that keeps decision records outside every repo, and a delivery tool that discovers and runs a repository’s own checks and drafts evidence-bound receipts.',
      'One npm install works across three different agent harnesses. This portfolio’s own redesign was steered with it: the homepage direction lives on the decision shelf as a record that outlived a dozen working sessions. v1.0.0 is live, with 70 tests keeping the installer honest.',
    ],
    notes: [
      'Skills stay lean; the mechanics live in the tools, not the prose.',
      'Install is reversible, cross-harness, and audited by a doctor command.',
      'Used to steer this portfolio’s own redesign.',
    ],
    stack: [
      { label: 'Runtime', value: 'node · javascript' },
      { label: 'Shape', value: '3 skills · 2 clis' },
      { label: 'Install', value: 'one npm command, three harnesses' },
      { label: 'Status', value: 'v1.0 · in progress' },
    ],
    shots: [
      { kind: 'image', src: `${SHOTS}/agent-skills/decision-shelf.webp`, caption: 'the decision shelf: records that outlive sessions' },
      { kind: 'image', src: `${SHOTS}/agent-skills/delivery.webp`, caption: 'delivery: checks and an evidence-bound receipt' },
      { kind: 'image', src: `${SHOTS}/agent-skills/system.webp`, caption: 'how the skills and tools fit together' },
    ],
  },
  {
    id: 'evalgate',
    title: 'evalgate',
    sym: 'eg',
    area: 'AI & Developer Tools',
    status: ['wip', 'Building'],
    year: 2026,
    activity: 'in progress',
    hue: '#8b7cf6',
    wip: true,
    money: false,
    line: 'regression tests for assistant behavior using real recorded sessions',
    seek: { from: 'scaffold', to: 'v0.1 launch', pct: 25 },
    links: [{ label: 'View repo ↗', href: 'https://github.com/dylanmccavitt/evalgate' }],
    metrics: [
      { value: 'record once', label: 'replay as a repeatable test' },
      { value: 'every change', label: 'checked before it goes live' },
      { value: 'actions', label: 'checked, not just words' },
    ],
    about: [
      'Teams can watch an AI assistant behave well in a demo, but nothing breaks the build when a later code change quietly makes it behave differently — or unsafely.',
      'evalgate records a real assistant session once, then replays it later as a repeatable test. It checks what the assistant did — the actions it took — not just what it said, and fails any change that alters that behavior.',
      'Building in the open toward a v0.1 release: recorded sessions replay deterministically and gate behavior changes in CI the same way unit tests gate code.',
    ],
    notes: [
      'Records a real session, then replays it the same way every time.',
      'Checks what the assistant did, not just what it said.',
      'Built in the open toward a first release.',
    ],
    stack: [
      { label: 'Language', value: 'python' },
      { label: 'Shape', value: 'assistant regression tests' },
      { label: 'Runs in', value: 'ci, like unit tests' },
      { label: 'Status', value: 'building → v0.1' },
    ],
    shots: [
      { kind: 'skeleton', skeletonKind: 'code', caption: 'recorded session, step by step' },
      { kind: 'skeleton', skeletonKind: 'dash', caption: 'replay run vs the saved baseline' },
      { kind: 'skeleton', skeletonKind: 'list', caption: 'checks that passed or failed' },
    ],
  },
  {
    id: 'bellas-beads',
    title: "bella's beads",
    sym: 'bb',
    area: 'Shipped & Client Work',
    status: ['done', 'Shipped'],
    year: 2025,
    activity: '2025',
    hue: '#d678b6',
    wip: false,
    money: false,
    line: 'client ecommerce site: browse, pay, ship, track, and hand off',
    seek: { from: 'wireframe', to: 'handoff', pct: 100 },
    links: [{ label: 'Live site ↗', href: 'https://bellasbeads.shop' }],
    metrics: [
      { value: '400+', label: 'commits to handoff' },
      { value: '4', label: 'integrations: stripe · shippo · supabase · resend' },
      { value: '2', label: 'checkout flows: guest + account' },
    ],
    about: [
      'A jewelry maker needed a real store — browsing, payment, shipping, tracking, and day-to-day admin — without platform fees or a site she couldn’t run herself.',
      'Built as a complete platform from wireframe to handoff: a React + TypeScript storefront on a Node/Express backend with Postgres via Supabase, plus Stripe for payments, Shippo for shipping labels, and Resend for email. Each service reports back on its own schedule, so their webhooks are reconciled into one order lifecycle with CSRF protection, rate limiting, and hashed tokens throughout.',
      'In production at bellasbeads.shop with guest and account checkout, order history, shipment tracking, and an admin dashboard the owner operates on her own — 400+ commits from wireframe to handoff.',
    ],
    notes: [
      'CSRF protection, rate limiting, and HMAC token hashing throughout.',
      'Webhook-driven order state across four third-party services.',
      'In production at bellasbeads.shop.',
    ],
    stack: [
      { label: 'Frontend', value: 'react · typescript' },
      { label: 'Backend', value: 'node · express' },
      { label: 'Data', value: 'postgres / supabase' },
      { label: 'Payments', value: 'stripe · shippo' },
    ],
    shots: [
      { kind: 'image', src: `${SHOTS}/bella/landing.webp`, caption: 'storefront landing' },
      { kind: 'image', src: `${SHOTS}/bella/product-page.webp`, caption: 'product page' },
      { kind: 'image', src: `${SHOTS}/bella/stripe.webp`, caption: 'stripe checkout' },
      { kind: 'image', src: `${SHOTS}/bella/admin-dash.webp`, caption: 'admin dashboard' },
    ],
  },
  {
    id: 'agentic-trader',
    title: 'agentic-trader',
    sym: 'at',
    area: 'Side Projects & Experiments',
    status: ['dry', 'Dry-run'],
    year: 2026,
    activity: 'live 06·23',
    hue: '#8b7cf6',
    wip: true,
    money: false,
    line: 'side-project trading automation: Claude Code reviews a simple RSI(2) setup and journals each proposed move',
    seek: { from: 'review loop', to: 'live jun 23', pct: 80 },
    links: [{ label: 'View repo ↗', href: 'https://github.com/DylanMcCavitt/agentic-trader' }],
    metrics: [
      { value: '15:45 ET', label: 'scheduled Claude Code session' },
      { value: '3', label: 'records per run: entry · fill · gate decision' },
      { value: '06·23', label: 'go-live date on a dedicated account' },
    ],
    about: [
      'Trading automation usually means a black box: you find out what it did after the money moved. The interesting engineering problem is the opposite — make an automated workflow fully reviewable before it is allowed to act.',
      'A headless Claude Code session wakes at 15:45 ET on weekdays, checks one simple RSI(2) mean-reversion signal, and routes proposed orders through Robinhood’s Agentic Trading MCP. Every run writes down the proposed entry, the simulated fill, and the deterministic gate decision that allowed or blocked it.',
      'Each session leaves an inspectable journal instead of a surprise. The loop ran dry for review first and went live on a dedicated account on June 23 — a side project in reviewable automation, not a professional trading identity.',
    ],
    notes: [
      'Runs from launchd on weekday afternoons; no manual click required to produce a reviewable proposal.',
      'Journals proposed entries, simulated fills, and gate decisions for review.',
      'Dry-run first; live on a dedicated account.',
    ],
    stack: [
      { label: 'Runtime', value: 'claude code · launchd' },
      { label: 'Broker', value: 'robinhood agentic mcp' },
      { label: 'Signal', value: 'rsi(2) mean-reversion' },
      { label: 'Status', value: 'review loop → live 06·23' },
    ],
    shots: [
      { kind: 'image', src: `${SHOTS}/agentic-trader/journal.webp`, caption: 'decision journal: proposed entries vs simulated fills' },
      { kind: 'image', src: `${SHOTS}/agentic-trader/risk-gate.webp`, caption: 'gate decision log for one session' },
      { kind: 'image', src: `${SHOTS}/agentic-trader/backtest.webp`, caption: 'signal backtest, walk-forward windows' },
    ],
  },
  {
    id: 'slurmlet',
    title: 'slurmlet',
    sym: 'sl',
    area: 'AI & Developer Tools',
    status: ['wip', 'WIP'],
    year: 2026,
    activity: 'building',
    hue: '#5da8e8',
    wip: true,
    money: false,
    line: 'systems-learning scheduler for all-or-nothing GPU jobs, built in Go and Python',
    seek: { from: 'go port', to: 'python port', pct: 45 },
    links: [{ label: 'View repo ↗', href: 'https://github.com/dylanmccavitt/slurmlet' }],
    metrics: [
      { value: '2', label: 'parallel builds: go and python' },
      { value: 'all-or-nothing', label: 'a job only starts when every GPU it needs is free' },
      { value: '$0', label: 'hardware cost — the fleet is simulated' },
    ],
    about: [
      'A big training job should start only when every GPU it asked for is free. Start it on a partial set and expensive hardware sits idle, holding reservations while the job waits for the rest.',
      'slurmlet holds a job back until its full set of GPUs is available, then reserves them all together. It is built twice against one shared design — Go first, Python second — on a simulated GPU fleet, so the two implementations can be compared directly without renting hardware.',
      'The Go port schedules, drains, and reschedules the simulated fleet end to end; the Python port is next. A learn-by-building capstone in systems scheduling, not a production claim.',
    ],
    notes: [
      'All-or-nothing start: a job only runs once every GPU it needs is reserved, so none sit idle waiting.',
      'Built twice, in Go and Python, against one shared design, to compare the two approaches directly.',
      'Runs on a simulated GPU fleet, so the whole workflow can be tested without real GPU costs.',
    ],
    stack: [
      { label: 'Languages', value: 'go · python' },
      { label: 'Platform', value: 'kubernetes' },
      { label: 'Test fleet', value: 'simulated gpus' },
      { label: 'Status', value: 'go port active, python next' },
    ],
    shots: [
      { kind: 'skeleton', skeletonKind: 'dash', caption: 'jobs waiting on a full set of GPUs' },
      { kind: 'skeleton', skeletonKind: 'code', caption: 'all-or-nothing scheduling logic' },
      { kind: 'skeleton', skeletonKind: 'list', caption: 'fleet lifecycle: schedule, drain, reschedule' },
    ],
  },
  {
    id: 'nhf',
    title: 'no hard feelings',
    sym: 'nh',
    area: 'Shipped & Client Work',
    status: ['live', 'Live'],
    year: 2025,
    activity: 'live',
    hue: '#ef8354',
    wip: false,
    money: false,
    line: 'low-maintenance band site with Google Calendar as CMS',
    seek: { from: 'build', to: 'live', pct: 100 },
    links: [{ label: 'Live site ↗', href: 'https://nohardfeelings.app' }],
    metrics: [
      { value: '0', label: 'databases to maintain' },
      { value: 'auto', label: 'show dates via google calendar' },
      { value: 'live', label: 'nohardfeelings.app' },
    ],
    about: [
      'A working cover band needed a site that always shows the next show — and nobody in the band was ever going to log into a CMS to update it.',
      'Google Calendar is the CMS: the band edits the calendar it already uses, and the site reads show dates straight from it. Astro + React + Tailwind, with a 3D-flippable album-cover hero for the band feel, tuned across devices.',
      'Live at nohardfeelings.app with zero databases and zero maintenance — show dates update themselves when the band updates its calendar.',
    ],
    notes: [
      'Google Calendar acts as the band’s CMS; the site needs zero maintenance.',
      'CSS 3D transforms + Motion.js, tuned across devices.',
    ],
    stack: [
      { label: 'Framework', value: 'astro · react' },
      { label: 'Style', value: 'tailwind · motion.js' },
      { label: 'Shows', value: 'google calendar feed' },
      { label: 'Status', value: 'live' },
    ],
    shots: [
      { kind: 'image', src: `${SHOTS}/nohard/landing.webp`, caption: 'album-cover hero, front' },
      { kind: 'image', src: `${SHOTS}/nohard/backcard.webp`, caption: 'flipped to band bios' },
      { kind: 'image', src: `${SHOTS}/nohard/gcal-integration.webp`, caption: 'shows from google calendar' },
    ],
  },
  {
    id: 'work-orders',
    title: 'work orders',
    sym: 'wo',
    area: 'Coursework',
    status: ['done', 'Shipped'],
    year: 2025,
    activity: 'team of 4',
    hue: '#5da8e8',
    wip: false,
    money: false,
    line: 'team coursework app for request → work order → contractor → invoice',
    seek: { from: 'request', to: 'invoice', pct: 100 },
    links: [{ label: 'View repo ↗', href: 'https://github.com/apolydore/Work-Order-Management-System' }],
    metrics: [
      { value: '4', label: 'person team, divided code ownership' },
      { value: '4', label: 'invoice states: draft · issued · paid · cancelled' },
      { value: 'NYC', label: 'open-data contract seed' },
    ],
    about: [
      'The course brief: model a real construction-maintenance workflow as a four-person team — outside users file requests, admins turn them into work orders, contractors do the work, and invoices get issued at the end.',
      'Express 5 on raw-driver MongoDB with Handlebars templates and session auth via bcrypt, seeded with NYC open-data records for awarded construction contracts. Input validation is hand-written at every boundary, per the course requirement.',
      'The full request → work order → contractor → invoice lifecycle shipped, including a four-state invoice flow with charge-code validation, line totals, and tax — delivered on time by a team of four.',
    ],
    notes: [
      'Invoice lifecycle: charge-code validation, line totals, tax, and four states.',
      'Hand-written input validation at every boundary, per course requirement.',
      'Four-person code ownership with task delegation.',
    ],
    stack: [
      { label: 'Backend', value: 'express 5 · mongodb' },
      { label: 'Templates', value: 'handlebars' },
      { label: 'Auth', value: 'sessions · bcrypt' },
      { label: 'Data', value: 'nyc open data' },
    ],
    shots: [
      { kind: 'image', src: `${SHOTS}/work-order/work-order-landing.webp`, caption: 'landing' },
      { kind: 'image', src: `${SHOTS}/work-order/woadmin.webp`, caption: 'admin dashboard' },
      { kind: 'image', src: `${SHOTS}/work-order/invoice.webp`, caption: 'invoice lifecycle' },
    ],
  },
  {
    id: 'epl-ml',
    title: 'EPL match predictor',
    sym: 'ep',
    area: 'Coursework',
    status: ['done', 'Shipped'],
    year: 2025,
    activity: '8 models',
    hue: '#50c878',
    wip: false,
    money: false,
    line: 'ML coursework comparing eight models on one Premier League split',
    seek: { from: 'raw data', to: 'xgboost', pct: 100 },
    links: [{ label: 'Notebook ↗', href: 'https://colab.research.google.com/drive/1H1BQdfM5U6SsSEviFrj3zUG60k2ZLCgX' }],
    metrics: [
      { value: '8', label: 'models, one split' },
      { value: '39', label: 'engineered features' },
      { value: '~99%', label: 'top accuracy on the split (xgboost)' },
      { value: '20 yrs', label: 'of match data' },
    ],
    about: [
      'Given twenty years of Premier League matches, how much of a result can you actually predict — and what moves the needle more: the model you pick, or the data work behind it?',
      'The team engineered 39 features for goals, streaks, differentials, and form, then trained eight model families on the same train/test split so the comparison stayed fair.',
      'XGBoost reached the top reported accuracy on that split, with SVM and logistic regression close behind — and the real lesson was that cleaning, imputation, and feature work moved results more than swapping model families. Coursework context, not a claim of predictive edge.',
    ],
    notes: [
      'Same train/test split across all eight models for a fair comparison.',
      'Cleaning, imputation, and feature work drove most of the gains.',
      'Coursework context, not a claim of predictive edge.',
    ],
    stack: [
      { label: 'Language', value: 'python' },
      { label: 'Models', value: '8-way comparison' },
      { label: 'Result', value: 'xgboost top on split' },
      { label: 'Data', value: 'kaggle · 20 yrs epl' },
    ],
    shots: [
      { kind: 'image', src: `${SHOTS}/epl-ml-model/accuracy-comparison.webp`, caption: 'model accuracy comparison' },
      { kind: 'image', src: `${SHOTS}/epl-ml-model/correlation-heatmap.webp`, caption: 'feature correlation heatmap' },
      { kind: 'image', src: `${SHOTS}/epl-ml-model/xgboost.webp`, caption: 'xgboost results' },
    ],
  },
]);

/**
 * Filter identifiers used by the library: the two cross-cutting filters
 * (`all`, `wip`) plus one per area. `money` was retired as a filter
 * (2026-06-12), but the `Project.money` flag stays as data.
 */
export type PlaylistId = 'all' | 'wip' | ProjectArea;

/** Ordered list of area filters. */
export const AREA_PLAYLISTS: ProjectArea[] = [
  'Shipped & Client Work',
  'Apps',
  'AI & Developer Tools',
  'Side Projects & Experiments',
  'Coursework',
];

/**
 * Canonical URL slugs for the filtered library routes (#25). The filter ids
 * double as area labels, so several contain spaces, ampersands, and uppercase
 * characters; those are not stable, shareable URL segments. This map is the
 * single source of truth for `/library/<slug>`;
 * routes and the sitemap read it, so the slug scheme stays aligned.
 *
 * `all` is intentionally absent: it lives at `/`, not `/library/all`.
 */
export const PLAYLIST_SLUGS: Record<Exclude<PlaylistId, 'all'>, string> = {
  wip: 'wip',
  'Shipped & Client Work': 'shipped-client-work',
  Apps: 'apps',
  'AI & Developer Tools': 'ai-developer-tools',
  'Side Projects & Experiments': 'side-projects-experiments',
  Coursework: 'coursework',
};

/** Reverse lookup: URL slug → playlist id. Built once from {@link PLAYLIST_SLUGS}. */
const SLUG_TO_PLAYLIST = new Map<string, PlaylistId>(
  (Object.entries(PLAYLIST_SLUGS) as [PlaylistId, string][]).map(([id, slug]) => [
    slug,
    id,
  ]),
);

/** Resolve a `/library/<slug>` segment back to its playlist id (or null). */
export function playlistFromSlug(slug: string): PlaylistId | null {
  return SLUG_TO_PLAYLIST.get(slug) ?? null;
}
