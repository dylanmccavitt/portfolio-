/**
 * Project catalog — the single source of truth for portfolio project content.
 *
 * Decision log: lingoloop is removed from the portfolio entirely (2026-06-10),
 * so this catalog ships 13 projects.
 *
 * Copy (about, notes, metrics, captions, hues, and progress metadata) is kept
 * here so static pages and DM tools read the same facts.
 *
 * Link integrity (#30, 2026-06-10): every link points at a live destination.
 * Seven projects originally linked the bare GitHub profile as a placeholder.
 * Per Dylan's decision log, none can link a real repo today, so their links
 * arrays are empty and the projects stand on their detail page + screenshots:
 *   - hood, tradingview-mcp: approved to go public but gated on a manual
 *     gitleaks sweep + a human-only visibility flip; both are still private
 *     (404 anonymously), so no link until Dylan flips them.
 *   - agentic-trader: published public 2026-06-12 (#15), now linked.
 *   - dog log, chore ladder, harness-arena: stay private.
 *   - condor study: not a repo — the detail page is the write-up.
 * lingoloop was removed from the portfolio entirely (above).
 */

/** Base for real screenshot paths, served from `public/screenshots/`. */
const SHOTS = '/screenshots';

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
  /** True for 9:16 phone captures (iOS), so the rail uses the narrow frame. */
  phone?: boolean;
}

/** A captured demo video with an optional poster frame. */
export interface ProjectVideoShot {
  video: string;
  cap: string;
  poster?: string;
  /** True for 9:16 phone captures (iOS), so the rail uses the narrow frame. */
  phone?: boolean;
}

/** Skeleton placeholder kinds for shots without a captured screenshot. */
export type SkeletonKind = 'chart' | 'dash' | 'list' | 'code' | 'phone';

/** A skeleton placeholder shot: a typed `kind` with a caption. */
export interface ProjectSkeletonShot {
  kind: SkeletonKind;
  cap: string;
}

/** A shot is either a real image, demo video, or skeleton placeholder. */
export type ProjectShot = ProjectImageShot | ProjectVideoShot | ProjectSkeletonShot;

/** Catalog areas — also serve as project library filters. */
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
  /** Short project mark retained for data consumers. */
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

/** Type guard: is this shot a captured demo video? */
export function isVideoShot(shot: ProjectShot): shot is ProjectVideoShot {
  return typeof (shot as { video?: unknown }).video === 'string';
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
    line: 'side-project trading automation: Claude Code reviews a simple RSI(2) setup and journals each proposed move',
    seek: { from: 'review loop', to: 'live jun 23', pct: 80 },
    links: [['View repo ↗', 'https://github.com/DylanMcCavitt/agentic-trader']],
    metrics: [
      ['15:45 ET', 'scheduled Claude Code session'],
      ['RSI(2)', 'simple signal under review'],
      ['06·23', 'go-live date'],
    ],
    about: [
      'A side-project trading automation workflow that runs on a schedule instead of as a black box. A headless Claude Code session wakes at 15:45 ET on weekdays, checks a simple RSI(2) mean-reversion signal, and routes proposed orders through Robinhood’s Agentic Trading MCP.',
      'Before anything goes live, each run leaves an inspectable record: the proposed entry, the simulated fill, and the deterministic gate decision that allowed or blocked it. The point is to make the workflow reviewable before real execution, not to present trading as Dylan’s professional identity.',
    ],
    notes: [
      'Runs from launchd on weekday afternoons; no manual click required to produce a reviewable proposal.',
      'Journals proposed entries, simulated fills, and gate decisions for review.',
      'Go-live date tracked as June 23 on a dedicated account.',
    ],
    stack: [
      ['Runtime', 'claude code · launchd'],
      ['Broker', 'robinhood agentic mcp'],
      ['Signal', 'rsi(2) mean-reversion'],
      ['Status', 'review loop → live 06·23'],
    ],
    shots: [
      { img: `${SHOTS}/agentic-trader/journal.webp`, cap: 'decision journal: proposed entries vs simulated fills' },
      { img: `${SHOTS}/agentic-trader/risk-gate.webp`, cap: 'gate decision log for one session' },
      { img: `${SHOTS}/agentic-trader/backtest.webp`, cap: 'signal backtest, walk-forward windows' },
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
    line: 'practical exit automation for options positions Dylan already opened',
    seek: { from: 'monitoring', to: 'live', pct: 100 },
    links: [['View repo ↗', 'https://github.com/DylanMcCavitt/tastytrade-exit-manager']],
    metrics: [
      ['3', 'exit mechanisms: scale-out · trail · oco'],
      ['live', 'real money, every session'],
      ['0', 'positions it can open'],
    ],
    about: [
      'Practical automation for options positions Dylan has already opened. It handles scale-outs, ratcheting trailing stops, and OCO brackets, but it cannot open a new trade or add size.',
      'Because spreads cannot use native stop orders, the manager watches the mid price and fires closing orders itself, with an audit trail for each adjustment.',
    ],
    notes: [
      'Keeps the boundary clear: exits only, never entries.',
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
      { img: `${SHOTS}/exit-manager/position-monitor.webp`, cap: 'position monitor with ratchet levels' },
      { img: `${SHOTS}/exit-manager/exit-ladder.webp`, cap: 'exit ladder config for an iron condor' },
      { img: `${SHOTS}/exit-manager/audit-trail.webp`, cap: 'order audit trail, one expiry' },
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
    line: 'local personal finance dashboard with high-water-mark withdrawal suggestions',
    seek: { from: 'tracking', to: 'active daily', pct: 100 },
    links: [],
    metrics: [
      ['weekly', 'withdrawal cadence'],
      ['0', 'principal touched, gains only'],
      ['local', 'account data stays on-machine'],
    ],
    about: [
      'A local, single-user personal finance dashboard for tracking realized gains across Robinhood accounts. Its high-water-mark rule suggests weekly withdrawals from gains only, without taking the portfolio below its best-ever level.',
      'The suggestions are deterministic and auditable, with account data kept on the machine.',
    ],
    notes: [
      'Local-first; account data never leaves the machine.',
      'Withdrawal suggestions are deterministic and auditable.',
      'Realized P/L reconciled across multiple accounts.',
    ],
    stack: [
      ['Language', 'typescript'],
      ['Shape', 'local finance dashboard'],
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
    line: 'tooling around TradingView Desktop for repeatable chart review',
    seek: { from: 'scaffold', to: 'v1 charting', pct: 65 },
    links: [],
    metrics: [
      ['5', 'stock universes configured'],
      ['full', 'pine compile round-trip'],
      ['v1', 'charting scope'],
    ],
    about: [
      'An MCP server for automating TradingView Desktop workflows Dylan already does by hand: open charts, capture chartbooks, and round-trip Pine Script by setting source, compiling, and reading console errors back.',
      'V1 is scoped to charting and review workflow support. It does not scan markets, give trading advice, or execute trades.',
    ],
    notes: [
      'Pine editor round-trip: write, compile, read errors programmatically.',
      'Universe groups support repeatable chart review.',
      'Chartbook capture for daily review.',
    ],
    stack: [
      ['Language', 'typescript'],
      ['Protocol', 'mcp · cdp'],
      ['Target', 'tradingview desktop'],
      ['Status', 'v1 in progress'],
    ],
    shots: [
      { img: `${SHOTS}/tradingview-mcp/chartbook.webp`, cap: 'agent-driven chartbook capture' },
      { img: `${SHOTS}/tradingview-mcp/pine-compile.webp`, cap: 'pine compile round-trip' },
      { img: `${SHOTS}/tradingview-mcp/universe-sweep.webp`, cap: 'universe sweep, 4-up layout' },
    ],
  },
  {
    id: 'evalgate',
    title: 'evalgate',
    sym: 'eg',
    area: 'Agents & MCP',
    status: ['wip', 'Building'],
    year: 2026,
    activity: 'in progress',
    hue: '#8b7cf6',
    wip: true,
    money: false,
    line: 'regression tests for assistant behavior using real recorded sessions',
    seek: { from: 'scaffold', to: 'v0.1 launch', pct: 25 },
    links: [],
    metrics: [
      ['record once', 'replay as a repeatable test'],
      ['every change', 'checked before it goes live'],
      ['v0.1', 'first release, building in the open'],
    ],
    about: [
      'A practical regression-test tool for AI assistant behavior. It records a real session, replays it later, and fails when a change makes the assistant do something different or unsafe.',
      'The product problem is concrete: teams can watch assistants in demos but still need build-breaking checks for behavior changes. The headline example is a trading-assistant scenario because the rules are easy to audit, not because evalgate is a trading product.',
    ],
    notes: [
      'Records a real session, then replays it the same way every time.',
      'Checks what the assistant did, not just what it said.',
      'Built in the open on an eleven-day sprint to a first release.',
    ],
    stack: [
      ['Language', 'python'],
      ['Shape', 'assistant regression tests'],
      ['Example', 'behavior checks'],
      ['Status', 'building → v0.1'],
    ],
    shots: [
      { kind: 'code', cap: 'recorded session, step by step' },
      { kind: 'dash', cap: 'replay run vs the saved baseline' },
      { kind: 'list', cap: 'checks that passed or failed' },
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
    line: 'small iPhone app for household dog routines, widgets, and optional sync',
    seek: { from: 'v1.2', to: 'review', pct: 95 },
    links: [],
    metrics: [
      ['189', 'commits to v1.2'],
      ['2', 'storage modes: local + synced'],
      ['v1.2', 'in app store review'],
    ],
    about: [
      'A small consumer iPhone app Dylan shipped to practice product polish end to end: logging each dog’s potty routine, quick actions from a home-screen widget, and optional shared households.',
      'It is local-first with SwiftData so it works without an account; v1.2 adds Supabase-backed sync only for households that want shared logging.',
    ],
    notes: [
      'SwiftData local-first; sync is opt-in, not required.',
      'WidgetKit home-screen widget for one-tap logging.',
      'App Store review and shared-household polish in v1.2.',
    ],
    stack: [
      ['Language', 'swift'],
      ['Storage', 'swiftdata · supabase'],
      ['Surface', 'app + widget'],
      ['Status', 'app store review'],
    ],
    shots: [
      { img: `${SHOTS}/dog-log/profiles-quick-log.webp`, cap: 'dog profiles + quick log', phone: true },
      { img: `${SHOTS}/dog-log/widget.webp`, cap: 'home-screen widget', phone: true },
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
    line: 'side-product practice: household chore boards, invites, stats, and Pro gating',
    seek: { from: 'build', to: 'testflight', pct: 90 },
    links: [],
    metrics: [
      ['184', 'commits'],
      ['25+', 'unit test suites'],
      ['pro', 'subscription tier built'],
    ],
    about: [
      'A side product for practicing the business mechanics around an iOS app: household chore boards, friend invites, completion stats, notifications, and a Pro tier.',
      'Built test-first: view models, services, StoreKit entitlement logic, and Firebase emulator paths each carry their own test coverage.',
    ],
    notes: [
      'Product-building reps: households, invites, stats, and a Pro tier.',
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
      { img: `${SHOTS}/chore-ladder/category-board.webp`, cap: 'category board view', phone: true },
      { img: `${SHOTS}/chore-ladder/household-stats.webp`, cap: 'household stats', phone: true },
      { img: `${SHOTS}/chore-ladder/entitlement-tests.webp`, cap: 'entitlement test suite' },
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
    line: 'reproducible NixOS homelab for reliability practice',
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
      'Infrastructure practice in a real homelab: everything runs from a single NixOS flake, so a rebuild from bare metal is one command. A rack-mounted Ryzen node plus two mini PCs are connected over Tailscale with split DNS.',
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
    id: 'slurmlet',
    title: 'slurmlet',
    sym: 'sl',
    area: 'Infrastructure',
    status: ['wip', 'WIP'],
    year: 2026,
    activity: 'building',
    hue: '#5da8e8',
    wip: true,
    money: false,
    line: 'systems-learning scheduler for all-or-nothing GPU jobs, built in Go and Python',
    seek: { from: 'go port', to: 'python port', pct: 45 },
    links: [],
    metrics: [
      ['2', 'parallel builds: go and python'],
      ['all-or-nothing', 'a job only starts when every GPU it needs is free'],
      ['simulated', 'fleet runs on fake GPUs, so no costly hardware'],
    ],
    about: [
      'A systems-learning project around one scheduling problem: a big training job should start only when every GPU it asked for is free. slurmlet holds the job back until the full set is available, then reserves them together.',
      'It is built twice, Go first and Python next, against a simulated GPU fleet so Dylan can compare implementations without renting hardware or claiming production readiness.',
    ],
    notes: [
      'All-or-nothing start: a job only runs once every GPU it needs is reserved, so none sit idle waiting.',
      'Built twice, in Go and Python, against one shared design, to compare the two approaches directly.',
      'Runs on a simulated GPU fleet, so the whole workflow can be tested without real GPU costs.',
    ],
    stack: [
      ['Languages', 'go · python'],
      ['Platform', 'kubernetes'],
      ['Test fleet', 'simulated gpus'],
      ['Status', 'go port active, python next'],
    ],
    shots: [
      { kind: 'dash', cap: 'jobs waiting on a full set of GPUs' },
      { kind: 'code', cap: 'all-or-nothing scheduling logic' },
      { kind: 'list', cap: 'fleet lifecycle: schedule, drain, reschedule' },
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
    line: 'client ecommerce site: browse, pay, ship, track, and hand off',
    seek: { from: 'wireframe', to: 'handoff', pct: 100 },
    links: [['Live site ↗', 'https://bellasbeads.shop']],
    metrics: [
      ['400+', 'commits to handoff'],
      ['4', 'integrations: stripe · shippo · supabase · resend'],
      ['2', 'checkout flows: guest + account'],
    ],
    about: [
      'A shipped client ecommerce platform for a handmade-jewelry business. It covers the full lifecycle: product browsing, guest and account checkout, order history, shipment tracking, saved addresses, and admin operations for products and inventory.',
      'React + TypeScript frontend, Node/Express backend, Postgres via Supabase, Stripe payments, Shippo shipping labels, Resend transactional email. Each integration has its own webhook and failure modes, reconciled into one order lifecycle before production handoff.',
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
    line: 'low-maintenance band site with Google Calendar as CMS',
    seek: { from: 'build', to: 'live', pct: 100 },
    links: [['Live site ↗', 'https://nohardfeelings.app']],
    metrics: [
      ['0', 'databases to maintain'],
      ['auto', 'show dates via google calendar'],
      ['live', 'nohardfeelings.app'],
    ],
    about: [
      'A low-maintenance site for No Hard Feelings, a classic-rock cover band in NJ/NY. Show dates, band bios, live videos, and booking are in one place.',
      'Astro + React + Tailwind. The 3D-flippable album hero gives the site a polished band feel; Google Calendar acts as the CMS, so show dates update when the band edits the calendar.',
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
      { img: `${SHOTS}/nohard/backcard.webp`, cap: 'flipped to band bios' },
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
    line: 'team coursework app for request → work order → contractor → invoice',
    seek: { from: 'request', to: 'invoice', pct: 100 },
    links: [['View repo ↗', 'https://github.com/apolydore/Work-Order-Management-System']],
    metrics: [
      ['4', 'person team'],
      ['4', 'invoice states: draft · issued · paid · cancelled'],
      ['NYC', 'open-data contract seed'],
    ],
    about: [
      'A four-person Web Programming project that models a full construction-maintenance workflow: external users submit requests, admins convert them to work orders, assign contractors, track progress, and issue invoices.',
      'Express 5 with raw-driver MongoDB, Handlebars templating, session auth with bcrypt, and NYC open-data seed records for awarded construction contracts.',
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
    line: 'ML coursework comparing eight models on one Premier League split',
    seek: { from: 'raw data', to: 'xgboost', pct: 100 },
    links: [['Notebook ↗', 'https://colab.research.google.com/drive/1H1BQdfM5U6SsSEviFrj3zUG60k2ZLCgX']],
    metrics: [
      ['8', 'models, one split'],
      ['39', 'engineered features'],
      ['~99%', 'top accuracy (xgboost)'],
      ['20 yrs', 'of match data'],
    ],
    about: [
      'An ML-learning group project using 20+ years of English Premier League data. The team engineered 39 features for goals, streaks, differentials, and form, then trained eight models on the same train/test split.',
      'XGBoost reached the top reported accuracy on that split, with SVM and Logistic Regression close behind. The useful lesson was that cleaning and feature work moved results more than swapping model families.',
    ],
    notes: [
      'Same train/test split across all eight models for a fair comparison.',
      'Cleaning, imputation, and feature work drove most of the gains.',
      'Coursework context, not a claim of predictive edge.',
    ],
    stack: [
      ['Language', 'python'],
      ['Models', '8-way comparison'],
      ['Result', 'xgboost top on split'],
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
    line: 'disciplined negative-result options research, retired after costs',
    seek: { from: '2021', to: 'retired', pct: 100 },
    links: [],
    metrics: [
      ['4 yrs', 'of walk-forward backtests'],
      ['0', 'edge after costs'],
      ['1', 'post-mortem published'],
    ],
    about: [
      'A disciplined trading-research post-mortem, not a standing trading system. QuantConnect tests covered 0DTE SPY iron condors across 2021–2024, with walk-forward windows and an explicit cost model.',
      'Retired after the evidence showed no edge after costs. The write-up keeps the cost model and decision criteria on record.',
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
    line: 'shelved experiment in repeatable agent-eval game environments',
    seek: { from: 'arena loop', to: 'shelved', pct: 55 },
    links: [],
    metrics: [
      ['48', 'commits'],
      ['A/B', 'preset comparison design'],
    ],
    about: [
      'A shelved experiment in using games as repeatable test beds for agent-harness presets. The browser arena made differences between settings visible enough to compare, instead of relying on vibes.',
      'Paused when higher-priority portfolio and tooling work took over; the arena loop and preset comparison design remain as the useful artifact.',
    ],
    notes: [
      'Games as eval environments: legible and repeatable.',
      'Preset differences measured, not eyeballed.',
    ],
    stack: [
      ['Language', 'typescript'],
      ['Shape', 'agent-eval game lab'],
      ['Status', 'shelved'],
    ],
    shots: [
      { kind: 'dash', cap: 'arena run with preset A/B' },
      { kind: 'chart', cap: 'win-rate by harness preset' },
    ],
  },
];

/**
 * Filter identifiers used by the library: the two cross-cutting filters
 * (`all`, `wip`) plus one per area. `money` was retired as a filter
 * (2026-06-12), but the `Project.money` flag stays as data.
 */
export type PlaylistId = 'all' | 'wip' | ProjectArea;

/** Ordered list of area filters. */
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
 * Canonical URL slugs for the filtered library routes (#25). The filter ids
 * double as area labels, so several contain spaces, ampersands, and uppercase
 * (`Trading systems`, `Agents & MCP`, `iOS`); those are not stable, shareable
 * URL segments. This map is the single source of truth for `/library/<slug>`;
 * routes and the sitemap read it, so the slug scheme stays aligned.
 *
 * `all` is intentionally absent: it lives at `/`, not `/library/all`.
 */
export const PLAYLIST_SLUGS: Record<Exclude<PlaylistId, 'all'>, string> = {
  wip: 'wip',
  'Trading systems': 'trading-systems',
  'Agents & MCP': 'agents-mcp',
  iOS: 'ios',
  Shipped: 'shipped',
  School: 'school',
  Infrastructure: 'infrastructure',
  Research: 'research',
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
