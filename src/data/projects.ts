export interface ProjectLink {
  label: string;
  url: string;
}

export interface ProjectImage {
  src: string;
  alt: string;
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
  cover: ProjectImage;
  gallery: ProjectImage[];
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
        label: 'map',
        url: '/homelab/topology/',
      },
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
      'A self-hosted lab for passwords, dashboards, storage, monitoring, and automation. It runs on a single physical server with VMs and containers split across clean network zones so services can grow without collapsing into one flat box.',
    highlights: [
      'Network is segmented into management, application, monitoring, and automation zones behind the firewall.',
      'Core services already cover password management, service dashboards, storage, monitoring, and recurring jobs.',
      'Caddy handles internal routing while Restic snapshots back up state to object storage.',
      'Still expanding toward dedicated NAS storage, Jellyfin, Grafana visibility, and subnet-routed remote access.',
    ],
    cover: {
      src: '/screenshots/homelab/homepage.webp',
      alt: 'Homeserver dashboard landing page.',
    },
    gallery: [
      {
        src: '/screenshots/homelab/proxmox.webp',
        alt: 'Proxmox dashboard for the homeserver setup.',
      },
      {
        src: '/screenshots/homelab/opnsense.webp',
        alt: 'OPNsense firewall interface for the homeserver network.',
      },
      {
        src: '/screenshots/homelab/kuma.webp',
        alt: 'Uptime Kuma monitoring view for homeserver services.',
      },
    ],
  },
  {
    slug: 'bellas-beads',
    name: 'bellas-beads/',
    kind: 'web app',
    year: '2025',
    blurb:
      'Full-stack ecommerce build for a small jewelry business, covering storefront, checkout, orders, and admin.',
    role: 'Freelance full-stack',
    status: 'shipped',
    stack: [
      'React',
      'TypeScript',
      'Node.js',
      'Express',
      'Supabase',
      'Stripe',
      'Shippo',
    ],
    links: [
      {
        label: 'live site',
        url: 'https://bellasbeads.shop',
      },
    ],
    summary:
      'A freelance commerce platform for a jewelry maker with guest and authenticated checkout, saved addresses, shipment tracking, and an admin surface for products and inventory. It replaced spreadsheet-heavy operations with one clear order flow.',
    highlights: [
      'Customers can browse, check out as guests or members, and review orders later from their account.',
      'Supabase handles data and auth while Stripe, Shippo, and Resend cover payments, shipping, and transactional email.',
      'Admin tooling includes product management and inventory workflows rather than a static catalog handoff.',
      'Security work included CSRF protection, rate limiting, and HMAC token hashing for sensitive flows.',
    ],
    cover: {
      src: '/screenshots/bella/landing.webp',
      alt: "Bella's Beads storefront landing page.",
    },
    gallery: [
      {
        src: '/screenshots/bella/product-page.webp',
        alt: "Bella's Beads product page.",
      },
      {
        src: '/screenshots/bella/cart.webp',
        alt: "Bella's Beads shopping cart view.",
      },
      {
        src: '/screenshots/bella/stripe.webp',
        alt: "Bella's Beads Stripe checkout flow.",
      },
      {
        src: '/screenshots/bella/shipping.webp',
        alt: "Bella's Beads shipping workflow.",
      },
      {
        src: '/screenshots/bella/admin-dash.webp',
        alt: "Bella's Beads admin dashboard.",
      },
    ],
  },
  {
    slug: 'nhf',
    name: 'nhf/',
    kind: 'band site',
    year: '2024',
    blurb:
      'Website for a NJ/NY cover band with show dates, live media, booking, and an interactive album-card nav.',
    role: 'Designer + developer',
    status: 'shipped',
    stack: ['Astro', 'React', 'Tailwind', 'Motion.js', 'Google Calendar'],
    links: [
      {
        label: 'live site',
        url: 'https://nohardfeelings.app',
      },
    ],
    summary:
      'Built a central web presence for No Hard Feelings so upcoming gigs, band info, videos, and booking details live in one place instead of scattered across socials. The front door is a flippable album cover that turns navigation into the main interaction.',
    highlights: [
      'Astro, React, and Tailwind power a lightweight band site with custom interaction instead of a generic template.',
      'The hero is a 3D album-card pattern with Motion.js driving flips and member popout animations.',
      'Upcoming gigs sync from Google Calendar so new shows appear on the site without a code change.',
    ],
    cover: {
      src: '/screenshots/nohard/landing.webp',
      alt: 'No Hard Feelings band site landing page.',
    },
    gallery: [
      {
        src: '/screenshots/nohard/backcard.webp',
        alt: 'Flipped album-card navigation on the No Hard Feelings site.',
      },
      {
        src: '/screenshots/nohard/popout.webp',
        alt: 'Band member popup interaction on the No Hard Feelings site.',
      },
      {
        src: '/screenshots/nohard/gcal-integration.webp',
        alt: 'Google Calendar driven shows section on the No Hard Feelings site.',
      },
    ],
  },
  {
    slug: 'work-orders',
    name: 'work-orders/',
    kind: 'web app',
    year: '2023',
    blurb:
      'Work order management system for a class project, from public job intake through assignment and invoicing.',
    role: 'Team project (4 developers)',
    status: 'archived',
    stack: ['Node.js', 'Express 5', 'MongoDB', 'Handlebars', 'bcrypt'],
    links: [
      {
        label: 'GitHub',
        url: 'https://github.com/apolydore/Work-Order-Management-System',
      },
    ],
    summary:
      'A web programming class project for managing construction and maintenance requests across intake, approval, assignment, progress tracking, and invoicing. Public users submit requests, admins turn them into work orders, and contractors manage assigned jobs.',
    highlights: [
      'Workflow starts with unauthenticated public job requests instead of an internal-only task list.',
      'Admins can approve or reject requests, assign contractors, track status, comment, and issue invoices.',
      'Built with Express 5, the raw MongoDB driver, and Handlebars using session auth with bcrypt.',
      'Seeded against NYC open-data contract records and intended as a local class deliverable, not a hosted product.',
    ],
    cover: {
      src: '/screenshots/work-order/work-order-landing.webp',
      alt: 'Work Orders application landing page.',
    },
    gallery: [
      {
        src: '/screenshots/work-order/jobreqform.webp',
        alt: 'Public job request form in the Work Orders app.',
      },
      {
        src: '/screenshots/work-order/woadmin.webp',
        alt: 'Admin dashboard in the Work Orders app.',
      },
      {
        src: '/screenshots/work-order/invoice.webp',
        alt: 'Invoice view in the Work Orders app.',
      },
    ],
  },
  {
    slug: 'epl-ml-model',
    name: 'epl-ml-model/',
    kind: 'ML model',
    year: '2024',
    blurb:
      'Group ML project comparing models for Premier League match prediction across a long historical dataset.',
    role: 'Group project',
    status: 'shipped',
    stack: ['Python', 'pandas', 'XGBoost', 'scikit-learn', 'Jupyter'],
    links: [
      {
        label: 'notebook',
        url: 'https://colab.research.google.com/drive/1H1BQdfM5U6SsSEviFrj3zUG60k2ZLCgX',
      },
    ],
    summary:
      'A group study on predicting English Premier League match outcomes from more than 20 years of historical data. We cleaned the dataset, engineered features, and compared eight models under the same evaluation setup to see what actually held up.',
    highlights: [
      'Compared Random Forest, MLP, Decision Tree, KNN, Naive Bayes, Logistic Regression, XGBoost, and SVM.',
      'Feature set included 39 match-level inputs after handling missing values, outliers, and engineered form signals.',
      'XGBoost produced the strongest documented result in the final comparison.',
      'The project reinforced that data cleaning and feature design mattered more than endlessly swapping model classes.',
    ],
    cover: {
      src: '/screenshots/epl-ml-model/accuracy-comparison.webp',
      alt: 'Accuracy comparison chart for EPL ML model experiments.',
    },
    gallery: [
      {
        src: '/screenshots/epl-ml-model/correlation-heatmap.webp',
        alt: 'Correlation heatmap from the EPL ML model project.',
      },
      {
        src: '/screenshots/epl-ml-model/decision-tree.webp',
        alt: 'Decision tree visualization from the EPL ML model project.',
      },
      {
        src: '/screenshots/epl-ml-model/xgboost.webp',
        alt: 'XGBoost results from the EPL ML model project.',
      },
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
