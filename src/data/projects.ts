export type ProjectStatus = 'ongoing' | 'shipped' | 'archived';

export interface ProjectLink {
  label: string;
  url: string;
}

export interface Project {
  slug: string;
  name: string;
  kind: string;
  year: string;
  blurb: string;
  role: string;
  status: ProjectStatus;
  stack: string[];
  links: ProjectLink[];
  summary: string;
  highlights: string[];
}

// Lifted verbatim from design_handoff_portfolio_v2/Portfolio.html (PROJECTS array).
export const PROJECTS: Project[] = [
  {
    slug: 'homeserver',
    name: 'homeserver/',
    kind: 'infrastructure',
    year: '2025',
    blurb:
      'Self-hosted home server running NixOS with services for media, backups, and internal tools.',
    role: 'Sole operator',
    status: 'ongoing',
    stack: ['NixOS', 'Docker', 'Tailscale', 'Caddy', 'Restic', 'Grafana'],
    links: [
      {
        label: 'nixos-dotfiles',
        url: 'https://github.com/DylanMcCavitt/nixos-dotfiles',
      },
      { label: 'homelab', url: 'https://github.com/DylanMcCavitt/homelab' },
    ],
    summary:
      'A declarative, reproducible home lab. Everything runs from a single NixOS flake — host definitions, service configs, secrets, and backup schedules — so a rebuild from bare metal takes one command.',
    highlights: [
      'Rack-mounted Ryzen node + two mini-PCs, all peered over Tailscale with split-DNS.',
      'Caddy reverse-proxy with automatic TLS for every internal service.',
      'Restic snapshots to S3-compatible object storage with deduplication.',
      'Grafana + Loki dashboards wired to every container for log-aware alerting.',
    ],
  },
  {
    slug: 'bellas-beads',
    name: 'bellas-beads/',
    kind: 'web app',
    year: '2025',
    blurb:
      'A freelance full-stack build for a small jewelry business — catalog, orders, and inventory in one surface.',
    role: 'Freelance full-stack',
    status: 'shipped',
    stack: ['Next.js', 'TypeScript', 'Postgres', 'Stripe', 'Tailwind'],
    links: [],
    summary:
      'Consolidated three spreadsheets and a DM inbox into a single admin console. Designed the information architecture, built the full stack, and handed off with a clean ops playbook.',
    highlights: [
      'Inventory model keyed on materials rather than SKUs — fits how the owner actually thinks.',
      'Stripe Checkout + webhook-driven order state machine.',
      'Mobile-first admin views; owner runs the business from a phone.',
      'Shipped in 6 weeks, end-to-end.',
    ],
  },
  {
    slug: 'nhf',
    name: 'nhf/',
    kind: 'band site',
    year: '2024',
    blurb:
      'Static site and release tooling for a small music project. Minimalist, type-driven.',
    role: 'Designer + developer',
    status: 'shipped',
    stack: ['Astro', 'MDX', 'Cloudflare Pages'],
    links: [],
    summary:
      'Built a single-page release hub that doubles as a press kit. Type does most of the work; imagery is sparing and loud.',
    highlights: [
      'Content authored in MDX so releases ship via PR.',
      'Edge-rendered on Cloudflare Pages; sub-100ms TTFB worldwide.',
      'Two-color system — ink on paper — with one accent per release cycle.',
    ],
  },
  {
    slug: 'work-orders',
    name: 'work-orders/',
    kind: 'web app',
    year: '2023',
    blurb:
      'Internal work-order tracker for a small operations team — creation, assignment, status.',
    role: 'Lead developer (team of 4)',
    status: 'archived',
    stack: ['Node.js', 'Express', 'MongoDB', 'Handlebars'],
    links: [
      {
        label: 'GitHub',
        url: 'https://github.com/apolydore/Work-Order-Management-System',
      },
    ],
    summary:
      'A class-project web app designed to make creating, assigning, and tracking work orders less painful than the email + spreadsheet workflow it replaced.',
    highlights: [
      'Role-based auth: dispatchers, technicians, admins — each with a tailored dashboard.',
      'Status machine with an audit trail on every transition.',
      'Server-rendered for speed and graceful degradation on slow networks.',
    ],
  },
  {
    slug: 'epl-ml-model',
    name: 'epl-ml-model/',
    kind: 'ML model',
    year: '2024',
    blurb:
      'Premier League match prediction. Feature engineering on match-level data; gradient-boosted ensemble.',
    role: 'Solo research',
    status: 'ongoing',
    stack: ['Python', 'pandas', 'XGBoost', 'scikit-learn', 'Jupyter'],
    links: [],
    summary:
      'A weekend project that grew teeth. Predicts 1X2 outcomes using rolling form windows, xG differentials, and squad-availability features, calibrated against bookmaker lines.',
    highlights: [
      'Custom rolling-window feature store; no lookahead leakage.',
      'Stacked XGBoost + logistic calibration; beats the implied bookmaker distribution on log-loss in backtests.',
      'Walk-forward validation across five seasons of EPL data.',
      'Notebook-first workflow with pinned DVC-tracked datasets.',
    ],
  },
];

export function getProject(slug: string): Project | undefined {
  return PROJECTS.find((p) => p.slug === slug);
}

export function getProjectNeighbors(slug: string): {
  prev: Project | null;
  next: Project | null;
} {
  const idx = PROJECTS.findIndex((p) => p.slug === slug);
  if (idx < 0) return { prev: null, next: null };
  return {
    prev: idx > 0 ? PROJECTS[idx - 1] : null,
    next: idx < PROJECTS.length - 1 ? PROJECTS[idx + 1] : null,
  };
}
