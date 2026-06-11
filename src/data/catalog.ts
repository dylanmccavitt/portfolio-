/**
 * Project catalog — ported verbatim from the player redesign prototype
 * (`15-player-v4.html`, the `P` array). This is the single source of truth
 * for the new player UI, replacing the role of the old `PROJECTS` array.
 *
 * Decision log: lingoloop is removed from the portfolio entirely (2026-06-10),
 * so this catalog ships 13 of the prototype's 14 projects.
 *
 * Field names are kept close to the prototype so porting the renderers stays
 * mechanical. Copy (about, notes, metrics, captions, hues, seek values) is
 * carried over as-is; link values are copied verbatim including the
 * GitHub-profile placeholders — link integrity is its own issue.
 */

/** Base for real screenshot paths, served from `public/screenshots/`. */
const SHOTS = '/screenshots';

/** Shared link targets, mirrored from the prototype's `LINKS` object. */
const LINKS = {
  github: 'https://github.com/DylanMcCavitt',
  email: 'mailto:dylanmccavitt@outlook.com',
  linkedin: 'https://www.linkedin.com/in/dylan-mccavitt',
  resume: 'https://dylanmccavitt.xyz/resume.pdf',
} as const;

/** Status badge variants. */
export type StatusKind = 'dry' | 'live' | 'wip' | 'done';

/** `[kind, label]` status tuple, e.g. `['dry', 'Dry-run']`. */
export type ProjectStatus = [kind: StatusKind, label: string];

/** `[label, url]` link tuple, e.g. `['GitHub ↗', '…']`. */
export type ProjectLink = [label: string, url: string];

/** `[value, label]` metric tuple, e.g. `['189', 'commits to v1.2']`. */
export type ProjectMetric = [value: string, label: string];

/** `[label, value]` stack/credit tuple, e.g. `['Language', 'swift']`. */
export type ProjectStackEntry = [label: string, value: string];

/** Seek bar: where the project came from, where it's going, and a percentage. */
export interface ProjectSeek {
  from: string;
  to: string;
  pct: number;
}

/** A real screenshot: an image path under `/screenshots/...` with a caption. */
export interface ProjectImageShot {
  img: string;
  cap: string;
}

/** Skeleton placeholder kinds for shots without a captured screenshot. */
export type SkeletonKind = 'chart' | 'dash' | 'list' | 'code' | 'phone';

/** A skeleton placeholder shot: a typed `kind` with a caption. */
export interface ProjectSkeletonShot {
  kind: SkeletonKind;
  cap: string;
}

/** A shot is either a real image or a skeleton placeholder. */
export type ProjectShot = ProjectImageShot | ProjectSkeletonShot;

/** Catalog areas — also serve as the area playlists in the sidebar. */
export type ProjectArea =
  | 'Trading systems'
  | 'Agents & MCP'
  | 'iOS'
  | 'Shipped'
  | 'School'
  | 'Infrastructure'
  | 'Research';

export interface Project {
  id: string;
  title: string;
  /** Two-letter symbol shown on the album tile. */
  sym: string;
  area: ProjectArea;
  status: ProjectStatus;
  year: number;
  activity: string;
  /** Accent color (hex). */
  hue: string;
  /** Now building. */
  wip: boolean;
  /** Live with real money. */
  money: boolean;
  /** One-line tagline. */
  line: string;
  seek: ProjectSeek;
  links: ProjectLink[];
  metrics: ProjectMetric[];
  /** Long-form description paragraphs. */
  about: string[];
  /** Liner notes. */
  notes: string[];
  /** Credits / tech stack. */
  stack: ProjectStackEntry[];
  shots: ProjectShot[];
}

/** Type guard: is this shot a real captured image? */
export function isImageShot(shot: ProjectShot): shot is ProjectImageShot {
  return 'img' in shot;
}

export const CATALOG: Project[] = [
  {
    id: 'agentic-trader',
    title: 'agentic-trader',
    sym: 'at',
    area: 'Agents & MCP',
    status: ['dry', 'Dry-run'],
    year: 2026,
    activity: 'live 06·23',
    hue: '#8b7cf6',
    wip: true,
    money: false,
    line: 'autonomous swing trader via Robinhood’s Agentic Trading MCP',
    seek: { from: 'dry-run', to: 'live jun 23', pct: 80 },
    links: [['GitHub ↗', LINKS.github]],
    metrics: [
      ['15:45 ET', 'scheduled run, weekdays'],
      ['100%', 'decisions journaled in dry-run'],
      ['06·23', 'go-live date'],
    ],
    about: [
      'An autonomous RSI(2) mean-reversion swing trader. A scheduled headless Claude Code session wakes at 15:45 ET on weekdays, reads signals, and places trades through Robinhood’s official Agentic Trading MCP.',
      'In dry-run it journals every decision — intended entries, simulated fills, and the risk rule that allowed or blocked each one. Going live is a config change.',
    ],
    notes: [
      'Runs unattended on launchd; no human in the loop at decision time.',
      'Every trade gated by risk rules validated during the dry-run period.',
      'Goes live June 23 on a dedicated account.',
    ],
    stack: [
      ['Runtime', 'claude code · launchd'],
      ['Broker', 'robinhood agentic mcp'],
      ['Signal', 'rsi(2) mean-reversion'],
      ['Status', 'dry-run → live 06·23'],
    ],
    shots: [
      { kind: 'code', cap: 'dry-run journal — intended vs simulated fills' },
      { kind: 'dash', cap: 'risk-gate decision log for one session' },
      { kind: 'chart', cap: 'signal backtest, walk-forward windows' },
    ],
  },
  {
    id: 'exit-manager',
    title: 'tastytrade-exit-manager',
    sym: 'em',
    area: 'Trading systems',
    status: ['live', 'Live'],
    year: 2026,
    activity: 'today',
    hue: '#50c878',
    wip: false,
    money: true,
    line: 'exit automation for live options positions',
    seek: { from: 'monitoring', to: 'live', pct: 100 },
    links: [['View repo ↗', 'https://github.com/DylanMcCavitt/tastytrade-exit-manager']],
    metrics: [
      ['3', 'exit mechanisms: scale-out · trail · oco'],
      ['live', 'real money, every session'],
      ['0', 'positions it can open'],
    ],
    about: [
      'Manages exits on existing tastytrade options positions — scale-outs, ratcheting trailing stops, and OCO brackets. It never opens positions and never adds size; you enter the trade, it places and ratchets the exit orders.',
      'Spreads can’t use native stop orders, so the manager watches the mid and fires the closing order itself.',
    ],
    notes: [
      'Software-managed stops for spreads, which brokers don’t support natively.',
      'Trails ratchet as profit targets hit; risk is never widened.',
      'Running against real money since spring 2026.',
    ],
    stack: [
      ['Language', 'python'],
      ['Broker', 'tastytrade api'],
      ['Orders', 'oco · trail · scale-out'],
      ['Repo', 'public'],
    ],
    shots: [
      { kind: 'dash', cap: 'position monitor with ratchet levels' },
      { kind: 'code', cap: 'exit ladder config for an iron condor' },
      { kind: 'list', cap: 'order audit trail, one expiry' },
    ],
  },
  {
    id: 'hood',
    title: 'hood',
    sym: 'hd',
    area: 'Trading systems',
    status: ['live', 'Active'],
    year: 2026,
    activity: 'today',
    hue: '#5da8e8',
    wip: false,
    money: false,
    line: 'portfolio tracker + high-water-mark withdrawal engine',
    seek: { from: 'tracking', to: 'active daily', pct: 100 },
    links: [['GitHub ↗', LINKS.github]],
    metrics: [
      ['weekly', 'withdrawal cadence'],
      ['0', 'principal touched — gains only'],
      ['local', 'account data stays on-machine'],
    ],
    about: [
      'A local, single-user dashboard tracking realized gains across Robinhood accounts, with a high-water-mark withdrawal engine: a weekly withdrawal from profit that never takes the portfolio below its best-ever level.',
      'Withdrawals only come from gains above the high-water mark, so the engine cannot draw down principal.',
    ],
    notes: [
      'Local-first; account data never leaves the machine.',
      'Withdrawal suggestions are deterministic and auditable.',
      'Realized P/L reconciled across multiple accounts.',
    ],
    stack: [
      ['Language', 'typescript'],
      ['Shape', 'local-first dashboard'],
      ['Engine', 'high-water-mark rules'],
      ['Status', 'active daily'],
    ],
    shots: [
      { kind: 'dash', cap: 'portfolio vs high-water mark' },
      { kind: 'chart', cap: 'weekly withdrawal history' },
      { kind: 'list', cap: 'withdrawal ledger with rule trace' },
    ],
  },
  {
    id: 'tradingview-mcp',
    title: 'tradingview-mcp',
    sym: 'tv',
    area: 'Agents & MCP',
    status: ['wip', 'WIP'],
    year: 2026,
    activity: '2d ago',
    hue: '#e6b450',
    wip: true,
    money: false,
    line: 'MCP server driving TradingView Desktop',
    seek: { from: 'scaffold', to: 'v1 charting', pct: 65 },
    links: [['GitHub ↗', LINKS.github]],
    metrics: [
      ['5', 'stock universes configured'],
      ['full', 'pine compile round-trip'],
      ['v1', 'charting scope'],
    ],
    about: [
      'An MCP server that drives TradingView Desktop from an agent conversation: chart whole stock universes, capture chartbooks, and round-trip Pine Script — set source, compile, read console errors back.',
      'V1 is scoped to charting. No scanning, no execution.',
    ],
    notes: [
      'Pine editor round-trip: write, compile, read errors programmatically.',
      'Universe groups for software, semis, AI infrastructure, and cybersecurity.',
      'Chartbook capture for daily review.',
    ],
    stack: [
      ['Language', 'typescript'],
      ['Protocol', 'mcp · cdp'],
      ['Target', 'tradingview desktop'],
      ['Status', 'v1 in progress'],
    ],
    shots: [
      { kind: 'dash', cap: 'agent-driven chartbook capture' },
      { kind: 'code', cap: 'pine compile round-trip' },
      { kind: 'chart', cap: 'universe sweep, 4-up layout' },
    ],
  },
  {
    id: 'dog-log',
    title: 'dog log',
    sym: 'dg',
    area: 'iOS',
    status: ['live', 'App Store'],
    year: 2026,
    activity: 'v1.2',
    hue: '#ef8354',
    wip: false,
    money: false,
    line: 'multi-dog routine tracking · widgets · shared households',
    seek: { from: 'v1.2', to: 'review', pct: 95 },
    links: [['GitHub ↗', LINKS.github]],
    metrics: [
      ['189', 'commits to v1.2'],
      ['2', 'storage modes: local + synced'],
      ['v1.2', 'in app store review'],
    ],
    about: [
      'An iPhone app and widget for tracking each dog’s potty routine across a household. Local-first with SwiftData so it works without an account; v1.2 adds optional Supabase-backed shared households so family members log to the same dog.',
    ],
    notes: [
      'SwiftData local-first; sync is opt-in, not required.',
      'WidgetKit home-screen widget for one-tap logging.',
      'Supabase shared households for family and caretaker sync.',
    ],
    stack: [
      ['Language', 'swift'],
      ['Storage', 'swiftdata · supabase'],
      ['Surface', 'app + widget'],
      ['Status', 'app store review'],
    ],
    shots: [
      { kind: 'phone', cap: 'dog profiles + quick log' },
      { kind: 'phone', cap: 'home-screen widget' },
      { kind: 'phone', cap: 'shared household invite flow' },
    ],
  },
  {
    id: 'chore-ladder',
    title: 'chore ladder',
    sym: 'cl',
    area: 'iOS',
    status: ['wip', 'TestFlight'],
    year: 2026,
    activity: 'may',
    hue: '#50c878',
    wip: false,
    money: false,
    line: 'household chore boards with invites and a pro tier',
    seek: { from: 'build', to: 'testflight', pct: 90 },
    links: [['GitHub ↗', LINKS.github]],
    metrics: [
      ['184', 'commits'],
      ['25+', 'unit test suites'],
      ['pro', 'subscription tier built'],
    ],
    about: [
      'A Firebase-backed iOS app for managing household chores: category boards, shared households, friend invites, completion tracking, and stats — with a Pro subscription tier and notification settings.',
      'Built test-first: view models, services, and entitlement logic each carry their own suite, and Firebase runs against the emulator in tests.',
    ],
    notes: [
      'Households and friend invites for multi-user boards.',
      'StoreKit subscription with entitlement gating.',
      'Heading to TestFlight.',
    ],
    stack: [
      ['Language', 'swift'],
      ['Backend', 'firebase'],
      ['Monetization', 'storekit subscription'],
      ['Status', 'testflight prep'],
    ],
    shots: [
      { kind: 'phone', cap: 'category board view' },
      { kind: 'phone', cap: 'household stats' },
      { kind: 'code', cap: 'entitlement test suite' },
    ],
  },
  {
    id: 'homeserver',
    title: 'homeserver',
    sym: 'hs',
    area: 'Infrastructure',
    status: ['live', 'Online'],
    year: 2025,
    activity: '99.9%',
    hue: '#5da8e8',
    wip: false,
    money: false,
    line: 'declarative NixOS homelab, rebuilt from one flake',
    seek: { from: 'uptime', to: '99.9%', pct: 100 },
    links: [
      ['nixos-dotfiles ↗', 'https://github.com/DylanMcCavitt/nixos-dotfiles'],
      ['homelab ↗', 'https://github.com/DylanMcCavitt/homelab'],
    ],
    metrics: [
      ['3', 'nodes on the tailscale mesh'],
      ['99.9%', 'uptime'],
      ['1', 'flake to rebuild everything'],
    ],
    about: [
      'A declarative, reproducible homelab: everything runs from a single NixOS flake, so a rebuild from bare metal is one command. A rack-mounted Ryzen node plus two mini PCs, peered over Tailscale with split DNS.',
      'Caddy reverse proxy with automatic TLS, Restic snapshots to object storage, and Grafana + Loki wired to every container.',
    ],
    notes: [
      'One flake, full rebuild, no snowflake state.',
      'Tailscale mesh with split DNS across three nodes.',
      'Log-aware alerting on every service.',
    ],
    stack: [
      ['OS', 'nixos'],
      ['Network', 'tailscale · caddy'],
      ['Backup', 'restic → s3'],
      ['Observability', 'grafana · loki'],
    ],
    shots: [
      { img: `${SHOTS}/homelab/homepage.webp`, cap: 'service homepage' },
      { img: `${SHOTS}/homelab/proxmox.webp`, cap: 'proxmox cluster' },
      { img: `${SHOTS}/homelab/kuma.webp`, cap: 'uptime kuma monitors' },
      { img: `${SHOTS}/homelab/opnsense.webp`, cap: 'opnsense at the edge' },
    ],
  },
  {
    id: 'bellas-beads',
    title: "bella's beads",
    sym: 'bb',
    area: 'Shipped',
    status: ['done', 'Shipped'],
    year: 2025,
    activity: '2025',
    hue: '#d678b6',
    wip: false,
    money: false,
    line: 'freelance ecommerce — browse, pay, ship, track',
    seek: { from: 'wireframe', to: 'handoff', pct: 100 },
    links: [['Live site ↗', 'https://bellasbeads.shop']],
    metrics: [
      ['400+', 'commits to handoff'],
      ['4', 'integrations: stripe · shippo · supabase · resend'],
      ['2', 'checkout flows: guest + account'],
    ],
    about: [
      'A full ecommerce platform for a handmade-jewelry business. Guest and authenticated checkout, order history, shipment tracking, saved addresses, and an admin dashboard for products and inventory.',
      'React + TypeScript frontend, Node/Express backend, Postgres via Supabase, Stripe payments, Shippo shipping labels, Resend transactional email — each with its own webhook patterns and failure modes, reconciled into one order lifecycle.',
    ],
    notes: [
      'CSRF protection, rate limiting, and HMAC token hashing throughout.',
      'Webhook-driven order state across four third-party services.',
      'In production at bellasbeads.shop.',
    ],
    stack: [
      ['Frontend', 'react · typescript'],
      ['Backend', 'node · express'],
      ['Data', 'postgres / supabase'],
      ['Payments', 'stripe · shippo'],
    ],
    shots: [
      { img: `${SHOTS}/bella/landing.webp`, cap: 'storefront landing' },
      { img: `${SHOTS}/bella/product-page.webp`, cap: 'product page' },
      { img: `${SHOTS}/bella/stripe.webp`, cap: 'stripe checkout' },
      { img: `${SHOTS}/bella/admin-dash.webp`, cap: 'admin dashboard' },
    ],
  },
  {
    id: 'nhf',
    title: 'no hard feelings',
    sym: 'nh',
    area: 'Shipped',
    status: ['live', 'Live'],
    year: 2025,
    activity: 'live',
    hue: '#ef8354',
    wip: false,
    money: false,
    line: 'band site with a 3D-flippable album hero',
    seek: { from: 'build', to: 'live', pct: 100 },
    links: [['Live site ↗', 'https://nohardfeelings.app']],
    metrics: [
      ['0', 'databases to maintain'],
      ['auto', 'show dates via google calendar'],
      ['live', 'nohardfeelings.app'],
    ],
    about: [
      'A website for No Hard Feelings, a classic-rock cover band in NJ/NY. Show dates, band bios, live videos, and booking in one place.',
      'Astro + React + Tailwind. The hero is a 3D-flippable album cover: the front is navigation styled as a tracklist, the back has band bios. Show dates pull from the band’s Google Calendar — they add a gig, the site updates, no database and no code changes.',
    ],
    notes: [
      'Google Calendar acts as the band’s CMS; the site needs zero maintenance.',
      'CSS 3D transforms + Motion.js, tuned across devices.',
    ],
    stack: [
      ['Framework', 'astro · react'],
      ['Style', 'tailwind · motion.js'],
      ['Shows', 'google calendar feed'],
      ['Status', 'live'],
    ],
    shots: [
      { img: `${SHOTS}/nohard/landing.webp`, cap: 'album-cover hero, front' },
      { img: `${SHOTS}/nohard/backcard.webp`, cap: 'flipped — band bios' },
      { img: `${SHOTS}/nohard/gcal-integration.webp`, cap: 'shows from google calendar' },
    ],
  },
  {
    id: 'work-orders',
    title: 'work orders',
    sym: 'wo',
    area: 'School',
    status: ['done', 'Shipped'],
    year: 2025,
    activity: 'team of 4',
    hue: '#5da8e8',
    wip: false,
    money: false,
    line: 'NYC work-order management — request → assign → invoice',
    seek: { from: 'request', to: 'invoice', pct: 100 },
    links: [['View repo ↗', 'https://github.com/apolydore/Work-Order-Management-System']],
    metrics: [
      ['4', 'person team'],
      ['4', 'invoice states: draft · issued · paid · cancelled'],
      ['NYC', 'open-data contract seed'],
    ],
    about: [
      'A web app for managing construction and maintenance work orders across NYC, built as a four-person group project for Web Programming during the Master’s. External users submit job requests; admins convert them to work orders, assign contractors, track progress, and issue invoices.',
      'Express 5 with raw-driver MongoDB, Handlebars templating, session auth with bcrypt, and company seed data from a NYC open-data set of awarded construction contracts.',
    ],
    notes: [
      'Invoice lifecycle: charge-code validation, line totals, tax, and four states.',
      'Hand-written input validation at every boundary, per course requirement.',
      'Four-person code ownership with task delegation.',
    ],
    stack: [
      ['Backend', 'express 5 · mongodb'],
      ['Templates', 'handlebars'],
      ['Auth', 'sessions · bcrypt'],
      ['Data', 'nyc open data'],
    ],
    shots: [
      { img: `${SHOTS}/work-order/work-order-landing.webp`, cap: 'landing' },
      { img: `${SHOTS}/work-order/woadmin.webp`, cap: 'admin dashboard' },
      { img: `${SHOTS}/work-order/invoice.webp`, cap: 'invoice lifecycle' },
    ],
  },
  {
    id: 'epl-ml',
    title: 'EPL match predictor',
    sym: 'ep',
    area: 'School',
    status: ['done', 'Shipped'],
    year: 2025,
    activity: '8 models',
    hue: '#50c878',
    wip: false,
    money: false,
    line: 'eight models against twenty years of Premier League data',
    seek: { from: 'raw data', to: 'xgboost', pct: 100 },
    links: [['Notebook ↗', 'https://colab.research.google.com/drive/1H1BQdfM5U6SsSEviFrj3zUG60k2ZLCgX']],
    metrics: [
      ['8', 'models, one split'],
      ['39', 'engineered features'],
      ['~99%', 'top accuracy (xgboost)'],
      ['20 yrs', 'of match data'],
    ],
    about: [
      'A group project predicting English Premier League outcomes from 20+ years of match data — 39 features covering goals, streaks, differentials, and form. Eight models trained on the same split: Random Forest, MLP, Decision Tree, KNN, Naive Bayes, Logistic Regression, XGBoost, SVM.',
      'XGBoost finished at ~99% accuracy with SVM and Logistic Regression close behind. Feature engineering moved accuracy more than model choice.',
    ],
    notes: [
      'Same train/test split across all eight models for a fair comparison.',
      'Cleaning, imputation, and feature work drove most of the gains.',
      'Groundwork for the later sports-ML and quant projects.',
    ],
    stack: [
      ['Language', 'python'],
      ['Models', '8-way comparison'],
      ['Winner', 'xgboost ~99%'],
      ['Data', 'kaggle · 20 yrs epl'],
    ],
    shots: [
      { img: `${SHOTS}/epl-ml-model/accuracy-comparison.webp`, cap: 'model accuracy comparison' },
      { img: `${SHOTS}/epl-ml-model/correlation-heatmap.webp`, cap: 'feature correlation heatmap' },
      { img: `${SHOTS}/epl-ml-model/xgboost.webp`, cap: 'xgboost results' },
    ],
  },
  {
    id: 'condor-study',
    title: '0DTE condor study',
    sym: '0d',
    area: 'Research',
    status: ['done', 'Retired'],
    year: 2025,
    activity: '2025',
    hue: '#969aa6',
    wip: false,
    money: false,
    line: 'no edge after costs — retired with a post-mortem',
    seek: { from: '2021', to: 'retired', pct: 100 },
    links: [['GitHub ↗', LINKS.github]],
    metrics: [
      ['4 yrs', 'of walk-forward backtests'],
      ['0', 'edge after costs'],
      ['1', 'post-mortem published'],
    ],
    about: [
      'QuantConnect backtests of 0DTE SPY iron condors across 2021–2024. Walk-forward testing with an honest cost model found no edge after costs.',
      'Retired on that evidence. The post-mortem documents the cost model and what would change the verdict.',
    ],
    notes: [
      'Four years of walk-forward windows.',
      'Costs modeled per leg, not hand-waved.',
      'Negative result kept on the record.',
    ],
    stack: [
      ['Platform', 'quantconnect · lean'],
      ['Underlying', 'spy 0dte'],
      ['Verdict', 'no edge after costs'],
      ['Status', 'retired'],
    ],
    shots: [
      { kind: 'chart', cap: 'equity curve vs costs' },
      { kind: 'code', cap: 'condor leg selection logic' },
    ],
  },
  {
    id: 'harness-arena',
    title: 'harness-arena',
    sym: 'ha',
    area: 'Research',
    status: ['done', 'Shelved'],
    year: 2026,
    activity: 'apr',
    hue: '#e6b450',
    wip: false,
    money: false,
    line: 'agent-harness evals through games',
    seek: { from: 'arena loop', to: 'shelved', pct: 55 },
    links: [['GitHub ↗', LINKS.github]],
    metrics: [
      ['48', 'commits'],
      ['A/B', 'preset comparison design'],
    ],
    about: [
      'A browser-first evaluation lab for tuning agent-harness presets through games — repeatable measurements of how harness settings change agent behavior.',
      'Shelved while the trading systems take priority; the arena loop and preset comparison design are in place.',
    ],
    notes: [
      'Games as eval environments: legible and repeatable.',
      'Preset differences measured, not eyeballed.',
    ],
    stack: [
      ['Language', 'typescript'],
      ['Shape', 'browser-first lab'],
      ['Status', 'shelved'],
    ],
    shots: [
      { kind: 'dash', cap: 'arena run with preset A/B' },
      { kind: 'chart', cap: 'win-rate by harness preset' },
    ],
  },
];

/**
 * Playlist identifiers used by the sidebar: the three cross-cutting playlists
 * (`all`, `wip`, `money`) plus one per area.
 */
export type PlaylistId = 'all' | 'wip' | 'money' | ProjectArea;

/** Ordered list of area playlists, mirroring the prototype sidebar order. */
export const AREA_PLAYLISTS: ProjectArea[] = [
  'Trading systems',
  'Agents & MCP',
  'iOS',
  'Shipped',
  'School',
  'Infrastructure',
  'Research',
];

/**
 * Filter the catalog by playlist. Mirrors the prototype's filter predicate:
 * `all` → everything, `wip`/`money` → the matching flag, area → `area === id`.
 */
export function filterCatalog(id: PlaylistId): Project[] {
  return CATALOG.filter((p) =>
    id === 'all' ? true : id === 'wip' ? p.wip : id === 'money' ? p.money : p.area === id,
  );
}

/** Count of projects in a playlist. */
export function playlistCount(id: PlaylistId): number {
  return filterCatalog(id).length;
}

/** Look up a project by id. */
export function getProjectById(id: string): Project | null {
  return CATALOG.find((p) => p.id === id) ?? null;
}
