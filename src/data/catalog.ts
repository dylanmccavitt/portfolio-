/**
 * Legacy project catalog — migration/parity data plus the offline-development
 * and explicit operator-emergency project source.
 *
 * Decision log: lingoloop is removed from the portfolio entirely (2026-06-10),
 * so this catalog ships 13 projects.
 *
 * Deployed database mode never overlays or falls back to this file. Public DB
 * rows are authoritative there and fail closed when unavailable.
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
      { value: 'RSI(2)', label: 'simple signal under review' },
      { value: '06·23', label: 'go-live date' },
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
    id: 'exit-manager',
    title: 'tastytrade-exit-manager',
    sym: 'em',
    area: 'Side Projects & Experiments',
    status: ['live', 'Live'],
    year: 2026,
    activity: 'today',
    hue: '#50c878',
    wip: false,
    money: true,
    line: 'practical exit automation for options positions Dylan already opened',
    seek: { from: 'monitoring', to: 'live', pct: 100 },
    links: [{ label: 'View repo ↗', href: 'https://github.com/DylanMcCavitt/tastytrade-exit-manager' }],
    metrics: [
      { value: '3', label: 'exit mechanisms: scale-out · trail · oco' },
      { value: 'live', label: 'real money, every session' },
      { value: '0', label: 'positions it can open' },
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
      { label: 'Language', value: 'python' },
      { label: 'Broker', value: 'tastytrade api' },
      { label: 'Orders', value: 'oco · trail · scale-out' },
      { label: 'Repo', value: 'public' },
    ],
    shots: [
      { kind: 'image', src: `${SHOTS}/exit-manager/position-monitor.webp`, caption: 'position monitor with ratchet levels' },
      { kind: 'image', src: `${SHOTS}/exit-manager/exit-ladder.webp`, caption: 'exit ladder config for an iron condor' },
      { kind: 'image', src: `${SHOTS}/exit-manager/audit-trail.webp`, caption: 'order audit trail, one expiry' },
    ],
  },
  {
    id: 'hood',
    title: 'hood',
    sym: 'hd',
    area: 'Side Projects & Experiments',
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
      { value: 'weekly', label: 'withdrawal cadence' },
      { value: '0', label: 'principal touched, gains only' },
      { value: 'local', label: 'account data stays on-machine' },
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
      { label: 'Language', value: 'typescript' },
      { label: 'Shape', value: 'local finance dashboard' },
      { label: 'Engine', value: 'high-water-mark rules' },
      { label: 'Status', value: 'active daily' },
    ],
    shots: [
      { kind: 'skeleton', skeletonKind: 'dash', caption: 'portfolio vs high-water mark' },
      { kind: 'skeleton', skeletonKind: 'chart', caption: 'weekly withdrawal history' },
      { kind: 'skeleton', skeletonKind: 'list', caption: 'withdrawal ledger with rule trace' },
    ],
  },
  {
    id: 'tradingview-mcp',
    title: 'tradingview-mcp',
    sym: 'tv',
    area: 'AI & Developer Tools',
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
      { value: '5', label: 'stock universes configured' },
      { value: 'full', label: 'pine compile round-trip' },
      { value: 'v1', label: 'charting scope' },
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
      { label: 'Language', value: 'typescript' },
      { label: 'Protocol', value: 'mcp · cdp' },
      { label: 'Target', value: 'tradingview desktop' },
      { label: 'Status', value: 'v1 in progress' },
    ],
    shots: [
      { kind: 'image', src: `${SHOTS}/tradingview-mcp/chartbook.webp`, caption: 'agent-driven chartbook capture' },
      { kind: 'image', src: `${SHOTS}/tradingview-mcp/pine-compile.webp`, caption: 'pine compile round-trip' },
      { kind: 'image', src: `${SHOTS}/tradingview-mcp/universe-sweep.webp`, caption: 'universe sweep, 4-up layout' },
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
    links: [],
    metrics: [
      { value: 'record once', label: 'replay as a repeatable test' },
      { value: 'every change', label: 'checked before it goes live' },
      { value: 'v0.1', label: 'first release, building in the open' },
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
      { label: 'Language', value: 'python' },
      { label: 'Shape', value: 'assistant regression tests' },
      { label: 'Example', value: 'behavior checks' },
      { label: 'Status', value: 'building → v0.1' },
    ],
    shots: [
      { kind: 'skeleton', skeletonKind: 'code', caption: 'recorded session, step by step' },
      { kind: 'skeleton', skeletonKind: 'dash', caption: 'replay run vs the saved baseline' },
      { kind: 'skeleton', skeletonKind: 'list', caption: 'checks that passed or failed' },
    ],
  },
  {
    id: 'dog-log',
    title: 'dog log',
    sym: 'dg',
    area: 'Apps',
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
      { value: '189', label: 'commits to v1.2' },
      { value: '2', label: 'storage modes: local + synced' },
      { value: 'v1.2', label: 'in app store review' },
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
      { label: 'Language', value: 'swift' },
      { label: 'Storage', value: 'swiftdata · supabase' },
      { label: 'Surface', value: 'app + widget' },
      { label: 'Status', value: 'app store review' },
    ],
    shots: [
      { kind: 'image', src: `${SHOTS}/dog-log/profiles-quick-log.webp`, caption: 'dog profiles + quick log', phone: true },
      { kind: 'image', src: `${SHOTS}/dog-log/widget.webp`, caption: 'home-screen widget', phone: true },
      { kind: 'skeleton', skeletonKind: 'phone', caption: 'shared household invite flow' },
    ],
  },
  {
    id: 'chore-ladder',
    title: 'chore ladder',
    sym: 'cl',
    area: 'Apps',
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
      { value: '184', label: 'commits' },
      { value: '25+', label: 'unit test suites' },
      { value: 'pro', label: 'subscription tier built' },
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
      { label: 'Language', value: 'swift' },
      { label: 'Backend', value: 'firebase' },
      { label: 'Monetization', value: 'storekit subscription' },
      { label: 'Status', value: 'testflight prep' },
    ],
    shots: [
      { kind: 'image', src: `${SHOTS}/chore-ladder/category-board.webp`, caption: 'category board view', phone: true },
      { kind: 'image', src: `${SHOTS}/chore-ladder/household-stats.webp`, caption: 'household stats', phone: true },
      { kind: 'image', src: `${SHOTS}/chore-ladder/entitlement-tests.webp`, caption: 'entitlement test suite' },
    ],
  },
  {
    id: 'homeserver',
    title: 'homeserver',
    sym: 'hs',
    area: 'Side Projects & Experiments',
    status: ['live', 'Online'],
    year: 2025,
    activity: '99.9%',
    hue: '#5da8e8',
    wip: false,
    money: false,
    line: 'reproducible NixOS homelab for reliability practice',
    seek: { from: 'uptime', to: '99.9%', pct: 100 },
    links: [
      { label: 'nixos-dotfiles ↗', href: 'https://github.com/DylanMcCavitt/nixos-dotfiles' },
      { label: 'homelab ↗', href: 'https://github.com/DylanMcCavitt/homelab' },
    ],
    metrics: [
      { value: '3', label: 'nodes on the tailscale mesh' },
      { value: '99.9%', label: 'uptime' },
      { value: '1', label: 'flake to rebuild everything' },
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
      { label: 'OS', value: 'nixos' },
      { label: 'Network', value: 'tailscale · caddy' },
      { label: 'Backup', value: 'restic → s3' },
      { label: 'Observability', value: 'grafana · loki' },
    ],
    shots: [
      { kind: 'image', src: `${SHOTS}/homelab/homepage.webp`, caption: 'service homepage' },
      { kind: 'image', src: `${SHOTS}/homelab/proxmox.webp`, caption: 'proxmox cluster' },
      { kind: 'image', src: `${SHOTS}/homelab/kuma.webp`, caption: 'uptime kuma monitors' },
      { kind: 'image', src: `${SHOTS}/homelab/opnsense.webp`, caption: 'opnsense at the edge' },
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
    links: [],
    metrics: [
      { value: '2', label: 'parallel builds: go and python' },
      { value: 'all-or-nothing', label: 'a job only starts when every GPU it needs is free' },
      { value: 'simulated', label: 'fleet runs on fake GPUs, so no costly hardware' },
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
      'A shipped client ecommerce platform for a handmade-jewelry business. It covers the full lifecycle: product browsing, guest and account checkout, order history, shipment tracking, saved addresses, and admin operations for products and inventory.',
      'React + TypeScript frontend, Node/Express backend, Postgres via Supabase, Stripe payments, Shippo shipping labels, Resend transactional email. Each integration has its own webhook and failure modes, reconciled into one order lifecycle before production handoff.',
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
      'A low-maintenance site for No Hard Feelings, a classic-rock cover band in NJ/NY. Show dates, band bios, live videos, and booking are in one place.',
      'Astro + React + Tailwind. The 3D-flippable album hero gives the site a polished band feel; Google Calendar acts as the CMS, so show dates update when the band edits the calendar.',
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
      { value: '4', label: 'person team' },
      { value: '4', label: 'invoice states: draft · issued · paid · cancelled' },
      { value: 'NYC', label: 'open-data contract seed' },
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
      { value: '~99%', label: 'top accuracy (xgboost)' },
      { value: '20 yrs', label: 'of match data' },
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
  {
    id: 'condor-study',
    title: '0DTE condor study',
    sym: '0d',
    area: 'Side Projects & Experiments',
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
      { value: '4 yrs', label: 'of walk-forward backtests' },
      { value: '0', label: 'edge after costs' },
      { value: '1', label: 'post-mortem published' },
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
      { label: 'Platform', value: 'quantconnect · lean' },
      { label: 'Underlying', value: 'spy 0dte' },
      { label: 'Verdict', value: 'no edge after costs' },
      { label: 'Status', value: 'retired' },
    ],
    shots: [
      { kind: 'skeleton', skeletonKind: 'chart', caption: 'equity curve vs costs' },
      { kind: 'skeleton', skeletonKind: 'code', caption: 'condor leg selection logic' },
    ],
  },
  {
    id: 'harness-arena',
    title: 'harness-arena',
    sym: 'ha',
    area: 'Side Projects & Experiments',
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
      { value: '48', label: 'commits' },
      { value: 'A/B', label: 'preset comparison design' },
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
      { label: 'Language', value: 'typescript' },
      { label: 'Shape', value: 'agent-eval game lab' },
      { label: 'Status', value: 'shelved' },
    ],
    shots: [
      { kind: 'skeleton', skeletonKind: 'dash', caption: 'arena run with preset A/B' },
      { kind: 'skeleton', skeletonKind: 'chart', caption: 'win-rate by harness preset' },
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
