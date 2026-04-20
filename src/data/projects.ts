export interface ProjectLink {
  label: string;
  url: string;
}

export interface ProjectData {
  slug: string;
  name: string;
  kind: string;
  year: string;
  blurb: string;
  role: string;
  status: string;
  stack: string[];
  links: ProjectLink[];
  summary: string;
  highlights: string[];
}

export const PROJECTS: ProjectData[] = [
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
      {
        label: 'homelab',
        url: 'https://github.com/DylanMcCavitt/homelab',
      },
    ],
    summary:
      'A declarative, reproducible home lab. Everything runs from a single NixOS flake so a rebuild from bare metal takes one command.',
    highlights: [
      'Rack-mounted Ryzen node plus two mini PCs peered over Tailscale with split DNS.',
      'Caddy reverse proxy with automatic TLS for every internal service.',
      'Restic snapshots to S3-compatible object storage with deduplication.',
      'Grafana plus Loki dashboards wired to every container for log-aware alerting.',
    ],
  },
  {
    slug: 'bellas-beads',
    name: 'bellas-beads/',
    kind: 'web app',
    year: '2025',
    blurb:
      'A freelance full-stack build for a small jewelry business - catalog, orders, and inventory in one surface.',
    role: 'Freelance full-stack',
    status: 'shipped',
    stack: ['Next.js', 'TypeScript', 'Postgres', 'Stripe', 'Tailwind'],
    links: [],
    summary:
      'Consolidated three spreadsheets and a DM inbox into a single admin console. Designed the information architecture, built the full stack, and handed off with a clean ops playbook.',
    highlights: [
      'Inventory model keyed on materials rather than SKUs, matching the owner workflow.',
      'Stripe Checkout plus a webhook-driven order state machine.',
      'Mobile-first admin views because the owner runs the business from a phone.',
      'Shipped in six weeks, end to end.',
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
      'Built a single-page release hub that doubles as a press kit. Type does most of the work; imagery stays sparing and loud.',
    highlights: [
      'Content authored in MDX so releases ship by pull request.',
      'Edge-rendered on Cloudflare Pages with sub-100ms TTFB worldwide.',
      'Two-color system with one accent per release cycle.',
    ],
  },
  {
    slug: 'work-orders',
    name: 'work-orders/',
    kind: 'web app',
    year: '2023',
    blurb:
      'Internal work-order tracker for a small operations team - creation, assignment, and status.',
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
      'A class-project web app designed to make creating, assigning, and tracking work orders less painful than the email-plus-spreadsheet workflow it replaced.',
    highlights: [
      'Role-based auth for dispatchers, technicians, and admins with tailored dashboards.',
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
      'A weekend project that grew teeth. Predicts 1X2 outcomes using rolling form windows, xG differentials, and squad-availability features calibrated against bookmaker lines.',
    highlights: [
      'Custom rolling-window feature store with no lookahead leakage.',
      'Stacked XGBoost plus logistic calibration beating implied bookmaker distributions on backtests.',
      'Walk-forward validation across five seasons of EPL data.',
      'Notebook-first workflow with pinned DVC-tracked datasets.',
    ],
  },
];

export function getProjectBySlug(slug: string) {
  return PROJECTS.find((project) => project.slug === slug) ?? null;
}

export function getProjectNeighbors(slug: string) {
  const index = PROJECTS.findIndex((project) => project.slug === slug);
  if (index === -1) {
    return { prev: null, next: null };
  }

  return {
    prev: index > 0 ? PROJECTS[index - 1] : null,
    next: index < PROJECTS.length - 1 ? PROJECTS[index + 1] : null,
  };
}
