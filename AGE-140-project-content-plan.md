# AGE-140 Project Content Refresh Plan

Issue: `AGE-140`

## Goal

Replace the inaccurate placeholder-style Sera project content with production-backed copy and real project imagery, while preserving the tighter, more readable Sera presentation.

## Source Of Truth

- Current preview data source: [src/data/projects.ts](/Users/dylanmccavitt/projects/portfolio-/.claude/worktrees/age-140-project-content-refresh-plan/src/data/projects.ts)
- Production-backed copy source:
  - [src/content/projects/homeserver.md](/Users/dylanmccavitt/projects/portfolio-/.claude/worktrees/age-140-project-content-refresh-plan/src/content/projects/homeserver.md)
  - [src/content/projects/bellas-beads.md](/Users/dylanmccavitt/projects/portfolio-/.claude/worktrees/age-140-project-content-refresh-plan/src/content/projects/bellas-beads.md)
  - [src/content/projects/nhf.md](/Users/dylanmccavitt/projects/portfolio-/.claude/worktrees/age-140-project-content-refresh-plan/src/content/projects/nhf.md)
  - [src/content/projects/work-orders.md](/Users/dylanmccavitt/projects/portfolio-/.claude/worktrees/age-140-project-content-refresh-plan/src/content/projects/work-orders.md)
  - [src/content/projects/epl-ml-model.md](/Users/dylanmccavitt/projects/portfolio-/.claude/worktrees/age-140-project-content-refresh-plan/src/content/projects/epl-ml-model.md)
- Production-backed screenshots:
  - `public/screenshots/homelab/*`
  - `public/screenshots/bella/*`
  - `public/screenshots/nohard/*`
  - `public/screenshots/work-order/*`
  - `public/screenshots/epl-ml-model/*`

## Decision Rules

- Keep the concise Sera structure for `blurb`, `summary`, and highlights.
- Restore factual details from production where current Sera copy is generic, incorrect, or underspecified.
- Do not invent new claims beyond what exists in production-backed copy.
- Replace placeholder `[ cover · slug ]` surfaces with real project imagery.
- Keep one shared source for project text and media so `/projects` and `/projects/[slug]` stay in sync.

## Project-By-Project Diff

### Homeserver

**Current Sera**

- Strong concise framing.
- Accurate high-level stack and ongoing status.
- Missing several concrete operational details already documented in production.
- No real image wired into either card or detail view.

**Production-backed facts to restore**

- Handles password management, monitoring, dashboards, storage, and automation.
- Runs on one physical server using VMs and containers.
- Network is segmented into management, applications, monitoring, and automation zones.
- Still expanding toward NAS, Grafana, Jellyfin, and Tailscale subnet routing.

**Recommended merged direction**

- Keep the current short Sera blurb and summary style.
- Tighten the summary so it mentions segmented infra and service categories, not only rebuildability.
- Preserve the strongest current highlights, but swap in at least one highlight about zone separation and one about the live service mix.

**Recommended imagery**

- Card cover: `/screenshots/homelab/homepage.webp`
- Detail hero: `/screenshots/homelab/homepage.webp`
- Detail gallery: `/screenshots/homelab/proxmox.webp`, `/screenshots/homelab/opnsense.webp`, `/screenshots/homelab/kuma.webp`

### Bella's Beads

**Current Sera**

- Good condensed business framing.
- Too vague on customer-facing functionality and backend integrations.
- Stack is directionally right, but production describes a React + TypeScript frontend with Node/Express backend, Supabase, Stripe, Shippo, and Resend.
- No real image wired in.

**Production-backed facts to restore**

- Guest and authenticated checkout flows.
- Order history, shipment tracking, and saved addresses.
- Admin dashboard for product and inventory management.
- Supabase for data/auth, Stripe for payments, Shippo for shipping, Resend for email.
- Security work: CSRF protection, rate limiting, HMAC token hashing.

**Recommended merged direction**

- Keep the current concise operator/business language.
- Rewrite the blurb so it mentions ecommerce more explicitly than "catalog, orders, and inventory."
- Expand the summary to include the full order lifecycle and operational tooling.
- Replace generic highlights with factual product and integration outcomes from production.

**Recommended imagery**

- Card cover: `/screenshots/bella/landing.webp`
- Detail hero: `/screenshots/bella/landing.webp`
- Detail gallery: `/screenshots/bella/product-page.webp`, `/screenshots/bella/cart.webp`, `/screenshots/bella/stripe.webp`, `/screenshots/bella/shipping.webp`, `/screenshots/bella/admin-dash.webp`

### No Hard Feelings

**Current Sera**

- This is the weakest factual match.
- Current blurb and summary frame it as a vague "small music project" or release hub.
- Current stack omits React and Tailwind.
- No real image wired in.

**Production-backed facts to restore**

- It is a website for the band No Hard Feelings, not a generic music project.
- Purpose includes show dates, band info, live videos, and booking.
- Built with Astro, React, and Tailwind.
- 3D flippable album-cover navigation with Motion.js.
- Google Calendar integration for self-serve gig updates.

**Recommended merged direction**

- Replace the current blurb outright; it is too generic and materially undersells the project.
- Keep the concise Sera tone, but make the summary explicitly about a band site with interactive navigation and self-updating events.
- Use highlights for the album-card UI, Motion.js interaction work, and Google Calendar integration.

**Recommended imagery**

- Card cover: `/screenshots/nohard/landing.webp`
- Detail hero: `/screenshots/nohard/landing.webp`
- Detail gallery: `/screenshots/nohard/backcard.webp`, `/screenshots/nohard/popout.webp`, `/screenshots/nohard/gcal-integration.webp`

### Work Orders

**Current Sera**

- Current framing is materially inaccurate.
- It is not an "internal work-order tracker for a small operations team."
- Production describes a class project with public request intake, admin triage, contractor assignment, and invoicing.
- No real image wired in.

**Production-backed facts to restore**

- Group project for a web programming course during the Master's program.
- Public users can submit job requests without logging in.
- Admins approve/reject requests, assign contractors, track progress, and issue invoices.
- Express 5, raw MongoDB driver, Handlebars, session auth with bcrypt.
- Seed data came from NYC open data.
- Not live or hosted.

**Recommended merged direction**

- Replace the current blurb and summary; they misstate the project.
- Keep the Sera compactness, but reflect the real workflow from public intake through invoicing.
- Update role and status copy so it reads as an archived class-team build rather than an internal ops product.
- Highlights should emphasize workflow coverage, team implementation, and invoice/state handling.

**Recommended imagery**

- Card cover: `/screenshots/work-order/work-order-landing.webp`
- Detail hero: `/screenshots/work-order/work-order-landing.webp`
- Detail gallery: `/screenshots/work-order/jobreqform.webp`, `/screenshots/work-order/woadmin.webp`, `/screenshots/work-order/invoice.webp`

### EPL ML Model

**Current Sera**

- Current framing is also materially inaccurate.
- It is described as solo research and an ongoing weekend project.
- Production describes a group project using a historical Kaggle dataset with multiple compared models.
- No real image wired in.

**Production-backed facts to restore**

- Group project, not solo research.
- Predicts EPL outcomes from 20+ years of match data.
- Compares eight models across 39 features.
- Includes missing-data handling, outlier control, and feature engineering.
- XGBoost delivered the top result in the documented comparison.

**Recommended merged direction**

- Replace the role and status framing.
- Keep the compact Sera style, but make the summary about comparative modeling and dataset work, not bookmaker calibration or DVC-backed solo experimentation unless that is still true and worth preserving.
- Highlights should align to the actual production-backed study design.

**Recommended imagery**

- Card cover: `/screenshots/epl-ml-model/accuracy-comparison.webp`
- Detail hero: `/screenshots/epl-ml-model/accuracy-comparison.webp`
- Detail gallery: `/screenshots/epl-ml-model/correlation-heatmap.webp`, `/screenshots/epl-ml-model/decision-tree.webp`, `/screenshots/epl-ml-model/xgboost.webp`

## Factual Corrections Required

- `nhf`: current preview copy underspecifies the project and omits core interaction/design details.
- `work-orders`: current preview copy changes the project type and workflow.
- `epl-ml-model`: current preview copy changes authorship and project framing.
- `bellas-beads`: current preview copy is directionally right but misses meaningful platform capabilities and integrations.
- `homeserver`: current preview copy is usable but should absorb more of the production-backed operational detail.

## Implementation Plan

1. Extend the shared project data model to support real image assets for card and detail usage.
2. Replace each project's placeholder copy in `src/data/projects.ts` with production-backed merged copy that preserves the Sera concise tone.
3. Update the projects index card component to render real cover imagery.
4. Update the project detail page to render a real hero image and, if layout supports it cleanly, a small gallery strip from the production assets.
5. Run `npm run verify` and browser-check `/projects` plus each `/projects/[slug]` route.

## Proposed Acceptance Criteria

- Every project card on `/projects` uses a real project image.
- Every project detail page uses production-backed copy with corrected factual framing.
- `nhf`, `work-orders`, and `epl-ml-model` no longer contain the current inaccurate placeholder framing.
- No broken image paths on local preview or deployment preview.
- Sera layout and typography remain intact; this is a content/media refresh, not a visual redesign.

## Recommendation

Proceed with implementation once the per-project copy direction above looks right. The main judgment call is not technical; it is how aggressively to preserve the current Sera brevity versus how much production detail to retain. My recommendation is:

- preserve Sera brevity in `blurb` and `summary`
- use highlights to carry specific facts from production
- keep one hero image per project plus a small detail gallery
