/**
 * The project catalog — the site's single content source, build and runtime,
 * local and deployed (#352 tore down the database that used to sit behind
 * deployed reads).
 *
 * Decision log (Dylan, 2026-07-27, #350): the published set is cut to 8.
 * Removed as stale or not publishable: exit-manager, hood, tradingview-mcp,
 * dog-log, chore-ladder, homeserver, condor-study, harness-arena. Added:
 * agent-skills (in progress, v1.1 on npm). Every entry's `about` is exactly
 * three paragraphs — [problem, approach, outcome] — which the project page
 * renders under those headings.
 *
 * Decision log (Dylan, 2026-07-28, #358): evalgate and slurmlet dropped —
 * the set is 6. Metrics rule from the same call: values must carry weight on
 * their own; effort counters ("commits") don't qualify.
 *
 * Link integrity: every link points at a live destination.
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
    status: ['live', 'v1.1 on npm'],
    year: 2026,
    activity: 'in progress',
    hue: '#8b7cf6',
    wip: true,
    money: false,
    line: 'workflow kit for coding agents, backed by CLI tools',
    seek: { from: 'v1.1 on npm', to: 'daily driver', pct: 75 },
    links: [
      { label: 'View repo ↗', href: 'https://github.com/dylanmccavitt/agent-skills' },
      { label: 'npm ↗', href: 'https://www.npmjs.com/package/@dylanmccavitt/agent-skills' },
    ],
    metrics: [
      { value: '3 short skills', label: 'keep the default context surface intentionally small' },
      { value: '1 compact receipt', label: 'replaces replaying an entire delegated session' },
      { value: '0 handoff files', label: 'session state stays outside the project codebase' },
      { value: '3 harnesses', label: 'share one install and the same workflow' },
    ],
    about: [
      'Months of installing one-off skills and skill packs that seemed useful left my harness configurations carrying more context than the work needed. As coding models improved, that extra instruction began to hurt my outputs instead of helping them. I decided to delete most of the old setup and build a lean system of my own: deterministic layers that point the model in the right direction while preserving the native strengths of the model and whichever coding harness I am using.',
      'The skills are intentionally minimal. I built a CLI around them so repeatable mechanics live in deterministic tools instead of prose. For example, Relay scopes a handoff and returns one compact receipt, while the CLI handles the state and delivery rules behind it. I also keep temporary plans, stale decisions, and unnecessary documentation out of project repositories. As projects and abstractions grew, those leftovers were causing models to follow decisions I had already moved away from.',
      'The current result is a v1.1.0 npm package that installs the same workflow across three coding harnesses. I actively track and test how it performs, then adjust the skills and tools as I find better ways to keep context lean, reduce rereading, and improve my own workflow.',
    ],
    notes: [
      'Curated lean on purpose: short skills, no context bloat.',
      'The experiment: a real CLI for the agent instead of more prose.',
      'An active workbench: pieces are added and cut as they prove out.',
    ],
    stack: [
      { label: 'Runtime', value: 'node · javascript' },
      { label: 'Shape', value: '3 skills · 2 clis' },
      { label: 'Install', value: 'one npm command, three harnesses' },
      { label: 'Status', value: 'v1.1 · in progress' },
    ],
    shots: [
      { kind: 'image', src: `${SHOTS}/agent-skills/decision-shelf.webp`, caption: 'the decision shelf: records that outlive sessions' },
      { kind: 'image', src: `${SHOTS}/agent-skills/delivery.webp`, caption: 'delivery: checks and an evidence-bound receipt' },
      { kind: 'image', src: `${SHOTS}/agent-skills/skills-overview.png`, caption: 'compass · relay · cairn' },
      { kind: 'image', src: `${SHOTS}/agent-skills/cli-commands.png`, caption: 'decision-shelf help: commands grouped by purpose' },
      { kind: 'image', src: `${SHOTS}/agent-skills/storage-locations.png`, caption: 'decision-shelf path: durable state outside the repo' },
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
    line: 'client ecommerce site with payments, shipping, and admin',
    seek: { from: 'wireframe', to: 'handoff', pct: 100 },
    links: [{ label: 'Live site ↗', href: 'https://bellasbeads.shop' }],
    metrics: [
      { value: '~80%', label: 'smaller css payload: ~300 kb → 61 kb' },
      { value: '23%', label: 'smaller initial javascript bundle: 590 kb → 456 kb' },
      { value: '33%', label: 'fewer sequential database trips on cart updates: 6 → 4' },
      { value: '15 min', label: 'checkout inventory held to prevent overselling' },
    ],
    about: [
      'A jewelry maker needed a real store, with browsing, payment, shipping, tracking, and day-to-day admin, without platform fees or a site she couldn’t run herself.',
      'Built as a complete platform from wireframe to handoff: a React + TypeScript storefront on a Node/Express backend with Postgres via Supabase, plus Stripe for payments and Resend for email. Each service reports back on its own schedule, so their events are reconciled into one order lifecycle with CSRF protection, rate limiting, and hashed tokens throughout.',
      'In production at bellasbeads.shop with guest and account checkout, order history, shipment tracking, and an admin dashboard the owner operates on her own, taken from wireframe to handoff solo.',
    ],
    notes: [
      'CSRF protection, rate limiting, and HMAC token hashing throughout.',
      'Event-driven order state across payments, data, and email.',
      'In production at bellasbeads.shop.',
    ],
    stack: [
      { label: 'Frontend', value: 'react · typescript' },
      { label: 'Backend', value: 'node · express' },
      { label: 'Data', value: 'postgres / supabase' },
      { label: 'Payments', value: 'stripe' },
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
    status: ['live', 'Live'],
    year: 2026,
    activity: 'live 06·23',
    hue: '#8b7cf6',
    wip: true,
    money: false,
    line: 'RSI(2) trading automation with a risk gate and decision journal',
    seek: { from: 'review loop', to: 'live jun 23', pct: 80 },
    links: [{ label: 'View repo ↗', href: 'https://github.com/DylanMcCavitt/agentic-trader' }],
    metrics: [
      { value: '100%', label: 'of proposed trades journaled before money can move' },
      { value: '0', label: 'orders skip the deterministic risk gate' },
      { value: 'hands-free', label: 'weekday session wakes itself at 15:45 ET' },
      { value: '06·23', label: 'live on a dedicated account' },
    ],
    about: [
      'Trading automation usually means a black box: you find out what it did after the money moved. The interesting engineering problem is the opposite: make an automated workflow fully reviewable before it is allowed to act.',
      'A headless Claude Code session wakes at 15:45 ET on weekdays, checks one simple RSI(2) mean-reversion signal, and routes proposed orders through Robinhood’s Agentic Trading MCP. Every run writes down the proposed entry, the simulated fill, and the deterministic gate decision that allowed or blocked it.',
      'Each session leaves an inspectable journal instead of a surprise. The loop ran dry for review first and went live on a dedicated account on June 23. A side project in reviewable automation, not a professional trading identity.',
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
    line: 'band site with Google Calendar as CMS',
    seek: { from: 'build', to: 'live', pct: 100 },
    links: [{ label: 'Live site ↗', href: 'https://nohardfeelings.app' }],
    metrics: [
      { value: '0', label: 'databases, CMS logins, or upkeep' },
      { value: 'self-updating', label: 'show dates flow from the calendar the band already uses' },
      { value: '3D', label: 'flippable album-cover hero, tuned across devices' },
      { value: 'live', label: 'nohardfeelings.app' },
    ],
    about: [
      'A working cover band needed a site that always shows the next show, and nobody in the band was ever going to log into a CMS to update it.',
      'Google Calendar is the CMS: the band edits the calendar it already uses, and the site reads show dates straight from it. Astro + React + Tailwind, with a 3D-flippable album-cover hero for the band feel, tuned across devices.',
      'Live at nohardfeelings.app with zero databases and zero maintenance: show dates update themselves when the band updates its calendar.',
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
    line: 'work order app: request, contractor, invoice',
    seek: { from: 'request', to: 'invoice', pct: 100 },
    links: [{ label: 'View repo ↗', href: 'https://github.com/apolydore/Work-Order-Management-System' }],
    metrics: [
      { value: 'end-to-end', label: 'request → work order → contractor → invoice, shipped on time' },
      { value: '4', label: 'person team with divided code ownership' },
      { value: 'every boundary', label: 'hand-written input validation' },
      { value: 'NYC', label: 'seeded with real open-data construction contracts' },
    ],
    about: [
      'The course brief: model a real construction-maintenance workflow as a four-person team: outside users file requests, admins turn them into work orders, contractors do the work, and invoices get issued at the end.',
      'Express 5 on raw-driver MongoDB with Handlebars templates and session auth via bcrypt, seeded with NYC open-data records for awarded construction contracts. Input validation is hand-written at every boundary, per the course requirement.',
      'The full request → work order → contractor → invoice lifecycle shipped, including a four-state invoice flow with charge-code validation, line totals, and tax, delivered on time by a team of four.',
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
    line: 'eight ML models compared on one Premier League split',
    seek: { from: 'raw data', to: 'xgboost', pct: 100 },
    links: [{ label: 'Notebook ↗', href: 'https://colab.research.google.com/drive/1H1BQdfM5U6SsSEviFrj3zUG60k2ZLCgX' }],
    metrics: [
      { value: '~99%', label: 'top accuracy on the split (xgboost)' },
      { value: '8', label: 'model families raced on one fair split' },
      { value: '39', label: 'engineered features' },
      { value: '20 yrs', label: 'of match data' },
    ],
    about: [
      'Given twenty years of Premier League matches, how much of a result can you actually predict, and what moves the needle more: the model you pick, or the data work behind it?',
      'The team engineered 39 features for goals, streaks, differentials, and form, then trained eight model families on the same train/test split so the comparison stayed fair.',
      'XGBoost reached the top reported accuracy on that split, with SVM and logistic regression close behind, and the real lesson was that cleaning, imputation, and feature work moved results more than swapping model families. Coursework context, not a claim of predictive edge.',
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
