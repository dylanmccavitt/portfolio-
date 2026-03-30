# Portfolio Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a recruiter-friendly portfolio site with Cool Nordic design, project case study pages, and an interactive homelab topology map.

**Architecture:** Astro 5 static site with vanilla CSS custom properties for the design system, Markdown content collections for project pages, and a standalone vanilla JS + SVG topology map page. Zero client JS except on the topology page.

**Tech Stack:** Astro 5, TypeScript, vanilla CSS, vanilla JS, Markdown

---

## File Structure

```
portfolio/
├── public/
│   └── fonts/
│       ├── TypographyPro-Regular.woff2
│       └── TypographyPro-SemiBold.woff2
├── src/
│   ├── components/
│   │   ├── Header.astro
│   │   ├── Footer.astro
│   │   ├── ProjectCard.astro
│   │   └── topology/
│   │       ├── TopologyMap.astro       # SVG markup + script tag
│   │       └── DetailDrawer.astro      # Entity detail panel
│   ├── content/
│   │   └── projects/
│   │       ├── homelab.md
│   │       ├── bella.md
│   │       ├── nohard.md
│   │       └── work-orders.md
│   ├── data/
│   │   └── topology/
│   │       ├── entities.ts             # Ported from homelab/site
│   │       └── layout.ts              # Ported from homelab/site
│   ├── layouts/
│   │   ├── Base.astro                  # HTML shell, head, global CSS
│   │   └── Project.astro              # Project page layout
│   ├── pages/
│   │   ├── index.astro                # Homepage
│   │   ├── projects/
│   │   │   └── [slug].astro           # Dynamic project routes
│   │   └── homelab/
│   │       └── topology.astro         # Topology map page
│   ├── scripts/
│   │   └── topology.ts                # Pan/zoom/click/drawer logic
│   ├── styles/
│   │   ├── global.css                 # Reset, tokens, @font-face, base
│   │   ├── components.css             # Header, footer, cards
│   │   ├── project.css                # Project page styles
│   │   └── topology.css               # Topology map + drawer styles
│   └── content.config.ts             # Collection definitions
├── astro.config.mjs
├── tsconfig.json
└── package.json
```

---

## Task 1: Scaffold Astro Project

**Files:**

- Create: `astro.config.mjs`, `tsconfig.json`, `package.json`, `src/pages/index.astro`

- [ ] **Step 1: Create Astro project**

```bash
cd ~/projects/portfolio
npm create astro@latest -- --template minimal --no-install .
```

If the directory isn't empty (due to existing `.claude/`, `docs/`, `.git`), the CLI may prompt. Accept overwriting. The minimal template creates `src/pages/index.astro`, `astro.config.mjs`, `tsconfig.json`, `package.json`, and `.gitignore`.

- [ ] **Step 2: Install dependencies**

```bash
npm install
```

- [ ] **Step 3: Verify dev server starts**

```bash
npx astro dev
```

Expected: Server starts on `localhost:4321`, default page renders.

- [ ] **Step 4: Update .gitignore**

Add `.superpowers/` to `.gitignore` (brainstorm session files). Ensure `node_modules/`, `dist/`, and `.astro/` are already listed from the template.

```gitignore
# build output
dist/

# generated types
.astro/

# dependencies
node_modules/

# superpowers brainstorm sessions
.superpowers/
```

- [ ] **Step 5: Commit**

```bash
git add astro.config.mjs tsconfig.json package.json package-lock.json .gitignore src/pages/index.astro src/env.d.ts
git commit -m "Scaffold Astro 5 project with minimal template"
```

---

## Task 2: Design System — Tokens, Font, Reset

**Files:**

- Create: `src/styles/global.css`
- Create: `public/fonts/TypographyPro-Regular.woff2`
- Create: `public/fonts/TypographyPro-SemiBold.woff2`
- Create: `src/layouts/Base.astro`
- Modify: `src/pages/index.astro`

- [ ] **Step 1: Download Typography Pro font files**

Find and download Typography Pro in woff2 format (weights 400 and 600). Place them in:

```
public/fonts/TypographyPro-Regular.woff2
public/fonts/TypographyPro-SemiBold.woff2
```

If Typography Pro is unavailable as a free download, use a visually similar alternative (e.g., Inter, DM Sans) as a temporary stand-in and note the substitution. The CSS structure stays the same.

- [ ] **Step 2: Create global stylesheet**

```css
/* src/styles/global.css */

/* --- Font --- */
@font-face {
  font-family: "Typography Pro";
  src: url("/fonts/TypographyPro-Regular.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: "Typography Pro";
  src: url("/fonts/TypographyPro-SemiBold.woff2") format("woff2");
  font-weight: 600;
  font-style: normal;
  font-display: swap;
}

/* --- Design tokens --- */
:root {
  /* Palette */
  --bg: #fafbfc;
  --surface: #e2e7ed;
  --text: #1a1f2e;
  --text-muted: #6b7280;
  --accent: #4a6fa5;
  --border: #d0d5dd;

  /* Typography */
  --font-body: "Typography Pro", system-ui, -apple-system, sans-serif;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.25rem;
  --text-xl: 1.5rem;
  --text-2xl: 2rem;
  --text-3xl: 2.5rem;
  --line-height: 1.6;

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;
}

/* --- Reset --- */
*,
*::before,
*::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html {
  font-size: 100%;
  -webkit-text-size-adjust: 100%;
}

body {
  font-family: var(--font-body);
  font-size: var(--text-base);
  font-weight: 400;
  line-height: var(--line-height);
  color: var(--text);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

img {
  max-width: 100%;
  height: auto;
  display: block;
}

a {
  color: var(--accent);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

h1,
h2,
h3,
h4 {
  font-weight: 600;
  line-height: 1.2;
  color: var(--text);
}

h1 {
  font-size: var(--text-3xl);
}
h2 {
  font-size: var(--text-2xl);
}
h3 {
  font-size: var(--text-xl);
}

hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: var(--space-6) 0;
}
```

- [ ] **Step 3: Create Base layout**

```astro
---
// src/layouts/Base.astro
interface Props {
  title: string;
  description?: string;
}

const { title, description = 'Dylan McCavitt — Software Engineer' } = Astro.props;
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content={description} />
    <title>{title}</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  </head>
  <body>
    <slot />
  </body>
</html>

<style is:global>
  @import '../styles/global.css';
</style>
```

- [ ] **Step 4: Update index.astro to use Base layout**

```astro
---
// src/pages/index.astro
import Base from '../layouts/Base.astro';
---

<Base title="Dylan McCavitt">
  <main>
    <h1>Dylan McCavitt</h1>
    <p>Software engineer building reliable systems.</p>
  </main>
</Base>
```

- [ ] **Step 5: Verify in browser**

```bash
npx astro dev
```

Expected: Page renders with Typography Pro (or fallback), correct colors, proper reset. No default browser margins. Text is `#1a1f2e` on `#fafbfc`.

- [ ] **Step 6: Commit**

```bash
git add src/styles/global.css src/layouts/Base.astro src/pages/index.astro public/fonts/
git commit -m "Add design system: Cool Nordic tokens, Typography Pro, CSS reset"
```

---

## Task 3: Header and Footer Components

**Files:**

- Create: `src/components/Header.astro`
- Create: `src/components/Footer.astro`
- Create: `src/styles/components.css`
- Modify: `src/layouts/Base.astro`

- [ ] **Step 1: Create Header component**

```astro
---
// src/components/Header.astro
interface Props {
  currentPath?: string;
}

const { currentPath = '/' } = Astro.props;
---

<header class="header">
  <nav class="header__nav">
    <a href="/" class="header__wordmark">Dylan McCavitt</a>

    <button
      class="header__toggle"
      aria-label="Toggle menu"
      aria-expanded="false"
    >
      <span class="header__toggle-bar"></span>
      <span class="header__toggle-bar"></span>
      <span class="header__toggle-bar"></span>
    </button>

    <ul class="header__links" id="nav-links">
      <li><a href="/#projects">Projects</a></li>
      <li><a href="/#about">About</a></li>
      <li><a href="/#contact">Contact</a></li>
    </ul>
  </nav>
</header>

<script>
  const toggle = document.querySelector('.header__toggle');
  const links = document.getElementById('nav-links');

  if (toggle && links) {
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      links.classList.toggle('header__links--open');
    });
  }
</script>
```

- [ ] **Step 2: Create Footer component**

```astro
---
// src/components/Footer.astro
---

<footer class="footer">
  <div class="footer__links">
    <a href="https://github.com/DylanMcCavitt" target="_blank" rel="noopener noreferrer">GitHub</a>
    <a href="https://linkedin.com/in/dylanmccavitt" target="_blank" rel="noopener noreferrer">LinkedIn</a>
    <a href="mailto:dylan@example.com">Email</a>
  </div>
</footer>
```

Note: Update the email and LinkedIn URL with real values during content writing.

- [ ] **Step 3: Create components stylesheet**

```css
/* src/styles/components.css */

/* --- Header --- */
.header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}

.header__nav {
  max-width: 1080px;
  margin: 0 auto;
  padding: var(--space-4) var(--space-5);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header__wordmark {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text);
  text-decoration: none;
  letter-spacing: -0.02em;
}

.header__wordmark:hover {
  text-decoration: none;
  color: var(--accent);
}

.header__links {
  display: flex;
  gap: var(--space-6);
  list-style: none;
}

.header__links a {
  font-size: var(--text-sm);
  color: var(--text-muted);
  text-decoration: none;
  letter-spacing: 0.02em;
}

.header__links a:hover {
  color: var(--text);
  text-decoration: none;
}

/* Hamburger toggle — hidden on desktop */
.header__toggle {
  display: none;
  flex-direction: column;
  gap: 5px;
  background: none;
  border: none;
  cursor: pointer;
  padding: var(--space-2);
}

.header__toggle-bar {
  display: block;
  width: 20px;
  height: 2px;
  background: var(--text);
  transition:
    transform 0.2s,
    opacity 0.2s;
}

/* Mobile */
@media (max-width: 640px) {
  .header__toggle {
    display: flex;
  }

  .header__links {
    display: none;
    flex-direction: column;
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    padding: var(--space-4) var(--space-5);
    gap: var(--space-4);
  }

  .header__links--open {
    display: flex;
  }
}

/* --- Footer --- */
.footer {
  border-top: 1px solid var(--border);
  padding: var(--space-7) var(--space-5);
  margin-top: var(--space-8);
}

.footer__links {
  max-width: 1080px;
  margin: 0 auto;
  display: flex;
  gap: var(--space-6);
  justify-content: center;
}

.footer__links a {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.footer__links a:hover {
  color: var(--text);
}

/* --- Project Card --- */
.project-card {
  display: block;
  border: 1px solid var(--border);
  padding: var(--space-6);
  text-decoration: none;
  color: var(--text);
  transition: border-color 0.15s;
}

.project-card:hover {
  border-color: var(--accent);
  text-decoration: none;
}

.project-card__title {
  font-size: var(--text-lg);
  font-weight: 600;
}
```

- [ ] **Step 4: Import components CSS in global.css**

Add to the end of `src/styles/global.css`:

```css
@import "./components.css";
```

- [ ] **Step 5: Add Header and Footer to Base layout**

Update `src/layouts/Base.astro`:

```astro
---
// src/layouts/Base.astro
import Header from '../components/Header.astro';
import Footer from '../components/Footer.astro';

interface Props {
  title: string;
  description?: string;
}

const { title, description = 'Dylan McCavitt — Software Engineer' } = Astro.props;
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content={description} />
    <title>{title}</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  </head>
  <body>
    <Header currentPath={Astro.url.pathname} />
    <slot />
    <Footer />
  </body>
</html>

<style is:global>
  @import '../styles/global.css';
</style>
```

- [ ] **Step 6: Verify in browser**

```bash
npx astro dev
```

Expected: Sticky header with wordmark and nav links. Footer with GitHub/LinkedIn/Email. Hamburger menu appears at <=640px and toggles nav visibility.

- [ ] **Step 7: Commit**

```bash
git add src/components/Header.astro src/components/Footer.astro src/styles/components.css src/styles/global.css src/layouts/Base.astro
git commit -m "Add Header and Footer components with mobile hamburger menu"
```

---

## Task 4: Homepage

**Files:**

- Create: `src/components/ProjectCard.astro`
- Modify: `src/pages/index.astro`

- [ ] **Step 1: Create ProjectCard component**

```astro
---
// src/components/ProjectCard.astro
interface Props {
  title: string;
  href: string;
}

const { title, href } = Astro.props;
---

<a href={href} class="project-card">
  <span class="project-card__title">{title}</span>
</a>
```

- [ ] **Step 2: Build homepage**

```astro
---
// src/pages/index.astro
import Base from '../layouts/Base.astro';
import ProjectCard from '../components/ProjectCard.astro';
---

<Base title="Dylan McCavitt">
  <main>
    <section class="hero">
      <h1 class="hero__name">Dylan McCavitt</h1>
      <p class="hero__tagline">Software engineer building reliable systems.</p>
      <hr class="hero__rule" />
      <a href="#projects" class="hero__cta">View Projects</a>
    </section>

    <section class="projects" id="projects">
      <h2 class="section-heading">Projects</h2>
      <div class="projects__grid">
        <ProjectCard title="Homelab" href="/projects/homelab/" />
        <ProjectCard title="Bella" href="/projects/bella/" />
        <ProjectCard title="Nohard" href="/projects/nohard/" />
        <ProjectCard title="Work Orders" href="/projects/work-orders/" />
      </div>
    </section>

    <section class="about" id="about">
      <p class="about__text">
        I'm a software engineer based in Portland who builds web applications,
        manages infrastructure, and cares about making software that's reliable
        and easy to understand. I'm currently looking for my next role — somewhere
        I can work on real problems with a team that values clarity and quality.
      </p>
    </section>

    <section class="contact" id="contact">
      <div class="contact__links">
        <a href="https://github.com/DylanMcCavitt" target="_blank" rel="noopener noreferrer">GitHub</a>
        <a href="https://linkedin.com/in/dylanmccavitt" target="_blank" rel="noopener noreferrer">LinkedIn</a>
        <a href="mailto:dylan@example.com">Email</a>
      </div>
    </section>
  </main>
</Base>

<style>
  .hero {
    text-align: center;
    padding: var(--space-8) var(--space-5);
    min-height: 80vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }

  .hero__name {
    letter-spacing: -0.02em;
  }

  .hero__tagline {
    color: var(--text-muted);
    font-size: var(--text-lg);
    margin-top: var(--space-3);
  }

  .hero__rule {
    width: 40px;
    margin: var(--space-6) auto;
  }

  .hero__cta {
    font-size: var(--text-sm);
    color: var(--accent);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .section-heading {
    margin-bottom: var(--space-6);
  }

  .projects {
    max-width: 1080px;
    margin: 0 auto;
    padding: var(--space-8) var(--space-5);
  }

  .projects__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-5);
  }

  @media (max-width: 640px) {
    .projects__grid {
      grid-template-columns: 1fr;
    }
  }

  .about {
    max-width: 680px;
    margin: 0 auto;
    padding: var(--space-8) var(--space-5);
  }

  .about__text {
    font-size: var(--text-lg);
    color: var(--text-muted);
    line-height: 1.7;
  }

  .contact {
    padding: var(--space-7) var(--space-5);
    text-align: center;
  }

  .contact__links {
    display: flex;
    gap: var(--space-6);
    justify-content: center;
  }

  .contact__links a {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .contact__links a:hover {
    color: var(--text);
  }
</style>
```

- [ ] **Step 3: Verify in browser**

```bash
npx astro dev
```

Expected: Full homepage — centered hero filling viewport, 2-col project grid below, bio paragraph, contact links. Project cards are sharp rectangles with 1px border, title only, hover turns border blue. Single column on mobile.

- [ ] **Step 4: Commit**

```bash
git add src/components/ProjectCard.astro src/pages/index.astro
git commit -m "Build homepage with hero, project grid, bio, and contact sections"
```

---

## Task 5: Content Collections and Project Pages

**Files:**

- Create: `src/content.config.ts`
- Create: `src/content/projects/homelab.md`
- Create: `src/content/projects/bella.md`
- Create: `src/content/projects/nohard.md`
- Create: `src/content/projects/work-orders.md`
- Create: `src/layouts/Project.astro`
- Create: `src/styles/project.css`
- Create: `src/pages/projects/[slug].astro`

- [ ] **Step 1: Define content collection**

```typescript
// src/content.config.ts
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const projects = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/projects" }),
  schema: z.object({
    title: z.string(),
    subtitle: z.string(),
    order: z.number(),
    liveUrl: z.string().optional(),
    repoUrl: z.string().optional(),
    topologyUrl: z.string().optional(),
  }),
});

export const collections = { projects };
```

- [ ] **Step 2: Create project Markdown files**

```markdown
---
# src/content/projects/homelab.md
title: "Homelab"
subtitle: "Home server infrastructure with monitoring and automation"
order: 1
topologyUrl: "/homelab/topology/"
---

## What it is

I run a small server setup at home that handles things most people use cloud services for — password management, network monitoring, service dashboards, and automated tasks. Everything runs on a single physical server using virtual machines and containers, managed through a firewall that controls what can talk to what.

The system is split into separate zones: one for network management, one for applications people actually use, one for monitoring, and one for automation. This separation means a problem in one area doesn't cascade into others.

## Why I built it

I wanted hands-on experience with the kind of infrastructure decisions that come up in professional environments — network segmentation, reverse proxies, monitoring, and service isolation — but at a scale where I could understand every piece end to end. Cloud services abstract away the parts I wanted to learn.

## What I learned

Designing for failure is more important than designing for features. The most valuable decisions were about separation: keeping monitoring independent from the services it watches, isolating management access from public-facing apps, and giving each workload its own space to fail without taking everything else down.
```

```markdown
---
# src/content/projects/bella.md
title: "Bella"
subtitle: "Full-stack web application for small businesses"
order: 2
liveUrl: "https://bella-web.vercel.app"
---

## What it is

Bella is a web application built for small businesses to manage their day-to-day operations. It handles the kind of work that usually lives in spreadsheets or sticky notes — tracking tasks, managing client information, and keeping a team on the same page.

The app is built with Next.js and uses Supabase for the database and authentication. Payments are handled through Stripe, and the whole thing is deployed on Vercel.

## Why I built it

I wanted to build something real — not a tutorial project, but an application that solves an actual problem and has to handle the messiness of real-world use: authentication, payments, error tracking, and deployment. Small businesses were a good fit because their needs are concrete and well-understood.

## What I learned

Full-stack development is mostly about the seams between systems. The hardest parts weren't the individual features but the integration points: making Stripe webhooks reliable, keeping Supabase auth in sync with the frontend, and setting up error tracking with Sentry so problems are visible before users report them.
```

```markdown
---
# src/content/projects/nohard.md
title: "Nohard"
subtitle: "Community platform and informational site"
order: 3
liveUrl: "https://nohard.gg"
---

## What it is

Nohard is a community-focused site that serves as a hub for information and resources. It's designed to be fast, easy to navigate, and useful for people who want to find what they need without digging through forums or social media.

## Why I built it

The community needed a central place for information that wasn't scattered across Discord channels and Reddit threads. I saw an opportunity to build something clean and focused that people would actually use.

## What I learned

Building for a community means building for people with very different levels of technical comfort. The most important feedback came from the least technical users — they found problems that power users worked around without noticing. Simplicity isn't a feature you add; it's what's left when you remove everything unnecessary.
```

```markdown
---
# src/content/projects/work-orders.md
title: "Work Orders"
subtitle: "Maintenance request system for a school district"
order: 4
---

## What it is

A work order management system built for a school district to handle maintenance requests. Staff submit requests through a simple form, maintenance teams see prioritized queues, and administrators track completion rates and response times. It replaced a paper-based process that was slow and hard to track.

## Why I built it

This was a school project, but it solved a real problem. The district was using paper forms and email chains to manage hundreds of maintenance requests per month. Requests got lost, priorities were unclear, and there was no way to measure how quickly things were getting done.

## What I learned

The biggest challenge was understanding the workflow before writing any code. I spent more time talking to maintenance staff and office administrators than I did programming. The system that emerged was simpler than what I originally planned — because the real workflow was simpler than what I assumed.
```

- [ ] **Step 3: Create project page stylesheet**

```css
/* src/styles/project.css */

.project-header {
  max-width: 680px;
  margin: 0 auto;
  padding: var(--space-8) var(--space-5) 0;
}

.project-header__title {
  letter-spacing: -0.02em;
}

.project-header__subtitle {
  color: var(--text-muted);
  font-size: var(--text-lg);
  margin-top: var(--space-3);
}

.project-header__links {
  display: flex;
  gap: var(--space-5);
  margin-top: var(--space-5);
}

.project-header__links a {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--accent);
}

.project-header__rule {
  margin-top: var(--space-6);
}

.project-content {
  max-width: 680px;
  margin: 0 auto;
  padding: var(--space-6) var(--space-5) var(--space-8);
}

.project-content h2 {
  font-size: var(--text-xl);
  margin-top: var(--space-7);
  margin-bottom: var(--space-4);
}

.project-content h2:first-child {
  margin-top: 0;
}

.project-content p {
  margin-bottom: var(--space-5);
  line-height: 1.7;
}

.project-content img {
  border: 1px solid var(--border);
  margin: var(--space-6) 0;
}
```

- [ ] **Step 4: Import project CSS in global.css**

Add to the end of `src/styles/global.css`:

```css
@import "./project.css";
```

- [ ] **Step 5: Create Project layout**

```astro
---
// src/layouts/Project.astro
import Base from './Base.astro';

interface Props {
  title: string;
  subtitle: string;
  liveUrl?: string;
  repoUrl?: string;
  topologyUrl?: string;
}

const { title, subtitle, liveUrl, repoUrl, topologyUrl } = Astro.props;
---

<Base title={`${title} — Dylan McCavitt`} description={subtitle}>
  <article>
    <header class="project-header">
      <h1 class="project-header__title">{title}</h1>
      <p class="project-header__subtitle">{subtitle}</p>

      <div class="project-header__links">
        {liveUrl && <a href={liveUrl} target="_blank" rel="noopener noreferrer">View live site &rarr;</a>}
        {repoUrl && <a href={repoUrl} target="_blank" rel="noopener noreferrer">GitHub &rarr;</a>}
        {topologyUrl && <a href={topologyUrl}>View topology map &rarr;</a>}
      </div>

      <hr class="project-header__rule" />
    </header>

    <div class="project-content">
      <slot />
    </div>
  </article>
</Base>
```

- [ ] **Step 6: Create dynamic project route**

```astro
---
// src/pages/projects/[slug].astro
import { getCollection } from 'astro:content';
import Project from '../../layouts/Project.astro';

export async function getStaticPaths() {
  const projects = await getCollection('projects');
  return projects.map((project) => ({
    params: { slug: project.id },
    props: { project },
  }));
}

const { project } = Astro.props;
const { Content } = await project.render();
---

<Project
  title={project.data.title}
  subtitle={project.data.subtitle}
  liveUrl={project.data.liveUrl}
  repoUrl={project.data.repoUrl}
  topologyUrl={project.data.topologyUrl}
>
  <Content />
</Project>
```

- [ ] **Step 7: Verify in browser**

```bash
npx astro dev
```

Expected:

- `/projects/homelab/` renders with title, subtitle, "View topology map" link, and body content
- `/projects/bella/` renders with "View live site" link
- `/projects/nohard/` renders with "View live site" link
- `/projects/work-orders/` renders with no external links
- Homepage project cards link to correct project pages

- [ ] **Step 8: Commit**

```bash
git add src/content.config.ts src/content/projects/ src/layouts/Project.astro src/styles/project.css src/styles/global.css src/pages/projects/
git commit -m "Add content collections, project pages, and case study content"
```

---

## Task 6: Port Topology Data

**Files:**

- Create: `src/data/topology/entities.ts`
- Create: `src/data/topology/layout.ts`

- [ ] **Step 1: Copy entity data**

Copy `~/projects/homelab/site/src/data/topology/entities.ts` to `src/data/topology/entities.ts`. The file ports as-is — no changes needed. It exports types (`EntityKind`, `DetailSection`, `Entity`, `EntityId`) and the `entities` const with all 20+ entity definitions.

```bash
mkdir -p src/data/topology
cp ~/projects/homelab/site/src/data/topology/entities.ts src/data/topology/entities.ts
```

- [ ] **Step 2: Copy layout data**

Copy `~/projects/homelab/site/src/data/topology/layout.ts` to `src/data/topology/layout.ts`. This file also ports as-is — it imports `EntityId` from entities and exports types (`ViewMode`, `FrameTone`, `NodeTone`, `ChipTone`, `MapFrame`, `MapChip`, `MapNode`, `MapEdge`) plus the `overviewLayout` const with all coordinates.

```bash
cp ~/projects/homelab/site/src/data/topology/layout.ts src/data/topology/layout.ts
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx astro check
```

Expected: No type errors from the topology data files. They use `as const satisfies` patterns that TypeScript 5+ handles fine.

- [ ] **Step 4: Commit**

```bash
git add src/data/topology/
git commit -m "Port topology entity and layout data from homelab site"
```

---

## Task 7: Topology Map — SVG Rendering

**Files:**

- Create: `src/components/topology/TopologyMap.astro`
- Create: `src/pages/homelab/topology.astro`
- Create: `src/styles/topology.css`

- [ ] **Step 1: Create topology stylesheet**

```css
/* src/styles/topology.css */

.topology-page {
  margin: 0;
  padding: 0;
  overflow: hidden;
  background: #06121d;
  height: 100vh;
  width: 100vw;
  position: relative;
}

.topology-back {
  position: absolute;
  top: var(--space-4);
  left: var(--space-4);
  z-index: 200;
  color: #a9bfd1;
  font-size: var(--text-sm);
  font-family: var(--font-body);
  text-decoration: none;
}

.topology-back:hover {
  color: #f6fbff;
  text-decoration: none;
}

.topology-screen {
  width: 100%;
  height: 100%;
  position: relative;
}

.topology-screen--dragging {
  cursor: grabbing;
}

.topology-svg {
  width: 100%;
  height: 100%;
  display: block;
}

.topology-svg .is-clickable {
  cursor: pointer;
}

/* --- HUD Overlays --- */
.topology-overlay {
  position: absolute;
  z-index: 100;
  pointer-events: none;
}

.topology-overlay > * {
  pointer-events: auto;
}

.topology-overlay--top-left {
  top: var(--space-7);
  left: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.topology-overlay--top-right {
  top: var(--space-7);
  right: var(--space-5);
}

.topology-overlay--drawer {
  top: 0;
  right: 0;
  bottom: 0;
  width: 380px;
  max-width: 100vw;
}

@media (max-width: 640px) {
  .topology-overlay--drawer {
    top: auto;
    bottom: 0;
    left: 0;
    right: 0;
    width: 100%;
    max-height: 50vh;
  }
}

/* --- HUD Panels --- */
.topology-hud {
  background: rgba(6, 18, 29, 0.85);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(169, 191, 209, 0.15);
  padding: var(--space-4) var(--space-5);
  color: #f6fbff;
  font-family: var(--font-body);
}

.topology-hud h1 {
  font-size: var(--text-xl);
  color: #f6fbff;
  margin: var(--space-2) 0;
}

.topology-hud p {
  font-size: var(--text-sm);
  color: #a9bfd1;
  line-height: 1.5;
}

.topology-hud__eyebrow {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #7d95ac;
}

/* --- Toolbar --- */
.topology-toolbar {
  display: flex;
  gap: var(--space-2);
}

.topology-toolbar--compact {
  flex-wrap: wrap;
}

.topology-button {
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: #a9bfd1;
  background: rgba(6, 18, 29, 0.6);
  border: 1px solid rgba(169, 191, 209, 0.2);
  padding: var(--space-2) var(--space-4);
  cursor: pointer;
  transition:
    border-color 0.15s,
    color 0.15s;
}

.topology-button:hover {
  border-color: rgba(169, 191, 209, 0.4);
  color: #f6fbff;
}

.topology-button--active {
  border-color: #4a6fa5;
  color: #f6fbff;
  background: rgba(74, 111, 165, 0.2);
}

.topology-caption {
  font-size: 0.75rem;
  color: #7d95ac;
  margin-top: var(--space-2);
}

/* --- Legend --- */
.topology-legend {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-3);
  font-size: var(--text-sm);
  color: #a9bfd1;
}

.topology-legend span {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.legend-swatch {
  display: inline-block;
  width: 16px;
  height: 3px;
}

.legend-swatch--physical {
  background: #7d95ac;
}
.legend-swatch--runtime {
  background: #f2c779;
}
.legend-swatch--policy {
  background: #79d89c;
}

/* --- Detail Drawer --- */
.drawer-panel {
  height: 100%;
  background: rgba(6, 18, 29, 0.92);
  backdrop-filter: blur(12px);
  border-left: 1px solid rgba(169, 191, 209, 0.12);
  padding: var(--space-6) var(--space-5);
  overflow-y: auto;
  color: #f6fbff;
  font-family: var(--font-body);
}

@media (max-width: 640px) {
  .drawer-panel {
    border-left: none;
    border-top: 1px solid rgba(169, 191, 209, 0.12);
  }
}

.drawer-panel--empty {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.drawer-panel--hidden {
  display: none;
}

.drawer-heading-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.drawer-eyebrow {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #7d95ac;
  margin-bottom: var(--space-2);
}

.drawer-panel h2 {
  font-size: var(--text-xl);
  color: #f6fbff;
  margin-bottom: var(--space-3);
}

.drawer-summary {
  font-size: var(--text-sm);
  color: #a9bfd1;
  line-height: 1.6;
  margin-bottom: var(--space-5);
}

.drawer-close {
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: #7d95ac;
  background: none;
  border: 1px solid rgba(169, 191, 209, 0.2);
  padding: var(--space-1) var(--space-3);
  cursor: pointer;
}

.drawer-close:hover {
  color: #f6fbff;
  border-color: rgba(169, 191, 209, 0.4);
}

.drawer-badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-5);
}

.drawer-badge {
  font-size: 0.75rem;
  color: #a9bfd1;
  background: rgba(169, 191, 209, 0.1);
  border: 1px solid rgba(169, 191, 209, 0.15);
  padding: var(--space-1) var(--space-3);
}

.drawer-section {
  margin-top: var(--space-5);
}

.drawer-section h3 {
  font-size: var(--text-sm);
  color: #7d95ac;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: var(--space-3);
}

.drawer-section ul {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.drawer-section li {
  font-size: var(--text-sm);
  color: #a9bfd1;
  line-height: 1.5;
}

.drawer-related {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.drawer-related-button {
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: #a9bfd1;
  background: rgba(74, 111, 165, 0.12);
  border: 1px solid rgba(74, 111, 165, 0.25);
  padding: var(--space-1) var(--space-3);
  cursor: pointer;
}

.drawer-related-button:hover {
  border-color: var(--accent);
  color: #f6fbff;
}
```

- [ ] **Step 2: Create TopologyMap Astro component**

This component renders the static SVG server-side from the layout data. The `<script>` tag at the bottom will be implemented in Task 8.

```astro
---
// src/components/topology/TopologyMap.astro
import { overviewLayout } from '../../data/topology/layout';
import { entities } from '../../data/topology/entities';
import type { NodeTone, ChipTone, FrameTone } from '../../data/topology/layout';

const nodePalette: Record<NodeTone, { fill: string; stroke: string; eyebrow: string }> = {
  edge: { fill: '#162434', stroke: '#7ed0ff', eyebrow: '#9bdfff' },
  network: { fill: '#18283c', stroke: '#7fb2ff', eyebrow: '#9db9ff' },
  platform: { fill: '#1b3124', stroke: '#9de07e', eyebrow: '#bfeb92' },
  runtime: { fill: '#2d2135', stroke: '#f2c779', eyebrow: '#f8ddb3' },
  device: { fill: '#352517', stroke: '#f7ae73', eyebrow: '#ffd8bc' },
  client: { fill: '#2d2338', stroke: '#e79cff', eyebrow: '#f1c0ff' },
};

const chipPalette: Record<ChipTone, { fill: string; stroke: string }> = {
  service: { fill: '#143125', stroke: '#8ee49a' },
  controller: { fill: '#162c44', stroke: '#8ec7ff' },
  monitoring: { fill: '#17343c', stroke: '#85e0d8' },
  agent: { fill: '#382614', stroke: '#f1c575' },
  utility: { fill: '#282c49', stroke: '#b6b4ff' },
};

const framePalette: Record<FrameTone, { fill: string; stroke: string; label: string }> = {
  hardware: { fill: 'rgba(24, 40, 58, 0.24)', stroke: '#456886', label: '#b7cfe2' },
  compute: { fill: 'rgba(7, 18, 29, 0.08)', stroke: '#314b63', label: '#9fb7c9' },
  management: { fill: 'rgba(17, 52, 78, 0.12)', stroke: '#75c7ff', label: '#b9e7ff' },
  service: { fill: 'rgba(18, 54, 31, 0.12)', stroke: '#84db91', label: '#c7f4cf' },
  signal: { fill: 'rgba(18, 56, 65, 0.12)', stroke: '#7fd8d0', label: '#beefe8' },
  automation: { fill: 'rgba(72, 47, 18, 0.12)', stroke: '#f1c575', label: '#ffe1a8' },
};

const hardwareRowFill = '#162434';
const hardwareRowPalette: Record<string, { stroke: string; eyebrow: string }> = {
  opnsense: { stroke: '#7ed0ff', eyebrow: '#9bdfff' },
  proxmox: { stroke: '#9de07e', eyebrow: '#bfeb92' },
  'unifi-ap': { stroke: '#7adfd1', eyebrow: '#a8eee5' },
  'bazzite-pc': { stroke: '#d7a4ff', eyebrow: '#eccdff' },
  jetkvm: { stroke: '#ffb27d', eyebrow: '#ffd3b4' },
  nas: { stroke: '#f2d177', eyebrow: '#ffe8af' },
};

function edgeStroke(kind: string): string {
  if (kind === 'physical') return '#7d95ac';
  if (kind === 'runtime') return '#f2c779';
  return '#79d89c';
}
---

<section class="topology-screen" id="topology-screen">
  <svg
    viewBox={overviewLayout.viewBox}
    role="img"
    aria-label="Interactive homelab overview map"
    class="topology-svg"
    id="topology-svg"
  >
    <defs>
      <filter id="card-shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="24" stdDeviation="18" floodColor="#03111c" floodOpacity="0.35" />
      </filter>
    </defs>

    <rect x="0" y="0" width="6588.16666666667" height="4878.970184856642" fill="#06121d" />

    <g id="topology-camera">
      <rect
        x="0" y="0"
        width="6588.16666666667" height="4878.970184856642"
        fill="transparent"
        id="topology-bg"
      />

      {/* Frames */}
      {overviewLayout.frames.map((frame) => {
        const palette = framePalette[frame.tone];
        return (
          <g data-frame-id={frame.id} data-entity-id={frame.entityId ?? ''}>
            <rect
              x={frame.x} y={frame.y} width={frame.w} height={frame.h}
              rx="34"
              fill={palette.fill}
              stroke={palette.stroke}
              stroke-width="6"
              stroke-dasharray={frame.tone === 'compute' ? '24 22' : undefined}
            />
            <g
              class={frame.entityId ? 'is-clickable' : undefined}
              data-entity-click={frame.entityId ?? undefined}
            >
              <rect
                x={frame.x + 24} y={frame.y + 22}
                width={Math.min(frame.w - 48, frame.label.length * 18 + 120)}
                height="54" rx="27"
                fill="#07111b"
                stroke={palette.stroke}
                stroke-width="4"
              />
              <text
                x={frame.x + 50} y={frame.y + 58}
                fill={palette.label}
                font-size="27" font-weight="700" letter-spacing="0.04em"
              >
                {frame.label}
              </text>
            </g>
          </g>
        );
      })}

      {/* Edges */}
      {overviewLayout.edges.map((edge) => (
        <g data-edge-id={edge.id} data-edge-from={edge.from} data-edge-to={edge.to} data-edge-kind={edge.kind}>
          <polyline
            points={edge.points.map((p) => p.join(',')).join(' ')}
            fill="none"
            stroke={edgeStroke(edge.kind)}
            stroke-width={edge.kind === 'policy' ? '8' : '10'}
            stroke-linejoin="round"
            stroke-linecap="round"
            stroke-dasharray={edge.dashed ? '28 24' : undefined}
          />
          {edge.label && (
            <text
              x={edge.points[Math.floor(edge.points.length / 2)][0] + 18}
              y={edge.points[Math.floor(edge.points.length / 2)][1] - 14}
              fill="#b8c9d8"
              font-size="24" font-weight="600" letter-spacing="0.05em"
            >
              {edge.label}
            </text>
          )}
        </g>
      ))}

      {/* Nodes */}
      {overviewLayout.nodes.map((node) => {
        const palette = nodePalette[node.tone];
        const hw = hardwareRowPalette[node.id];
        const stroke = hw?.stroke ?? palette.stroke;
        const eyebrowColor = hw?.eyebrow ?? palette.eyebrow;
        const fill = hw ? hardwareRowFill : palette.fill;

        return (
          <g
            filter="url(#card-shadow)"
            class="is-clickable"
            data-entity-click={node.id}
            data-node-id={node.id}
          >
            <rect
              x={node.x} y={node.y} width={node.w} height={node.h}
              rx="30"
              fill={fill} stroke={stroke} stroke-width="6"
            />
            {node.eyebrow && (
              <text
                x={node.x + 28} y={node.y + 42}
                fill={eyebrowColor}
                font-size="24" font-weight="700" letter-spacing="0.1em"
              >
                {node.eyebrow.toUpperCase()}
              </text>
            )}
            <text
              x={node.x + 28} y={node.y + 86}
              fill="#f6fbff"
              font-size="42" font-weight="700" letter-spacing="-0.02em"
            >
              {node.label ?? entities[node.id].title}
            </text>
            {node.caption && (
              <text x={node.x + 28} y={node.y + 126} fill="#a9bfd1" font-size="24">
                {node.caption}
              </text>
            )}

            {/* Chips */}
            {node.chips?.map((chip) => {
              const chipColors = chipPalette[chip.tone];
              const chipX = node.x + chip.x;
              const chipY = node.y + chip.y;
              const chipLines = chip.lines ?? [entities[chip.id].title];
              const lineOffset = chipLines.length > 1 ? 18 : 0;

              return (
                <g class="is-clickable" data-entity-click={chip.id} data-chip-id={chip.id}>
                  <rect
                    x={chipX} y={chipY} width={chip.w} height={chip.h}
                    rx="24"
                    fill={chipColors.fill} stroke={chipColors.stroke} stroke-width="4"
                  />
                  <text
                    x={chipX + chip.w / 2}
                    y={chipY + chip.h / 2 - lineOffset}
                    fill="#f8fbff"
                    font-size="28" font-weight="700"
                    text-anchor="middle" dominant-baseline="middle"
                  >
                    {chipLines.map((line, i) => (
                      <tspan x={chipX + chip.w / 2} dy={i === 0 ? 0 : 34}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  </svg>

  {/* HUD: Intro + View Modes */}
  <div class="topology-overlay topology-overlay--top-left">
    <div class="topology-hud topology-hud--intro">
      <p class="topology-hud__eyebrow">Interactive topology</p>
      <h1>Homelab atlas</h1>
      <p>Drag to pan, wheel to zoom, click any node or lane to focus it.</p>
    </div>

    <div class="topology-hud topology-hud--toolbar">
      <div class="topology-toolbar" role="tablist" aria-label="Map views">
        <button type="button" role="tab" aria-selected="true" class="topology-button topology-button--active" data-view-mode="overview">Overview</button>
        <button type="button" role="tab" aria-selected="false" class="topology-button" data-view-mode="runtime">Runtime</button>
        <button type="button" role="tab" aria-selected="false" class="topology-button" data-view-mode="trust">Trust</button>
      </div>
      <p class="topology-caption" id="view-mode-hint">Balanced physical, runtime, and policy context</p>
    </div>
  </div>

  {/* HUD: Controls + Legend */}
  <div class="topology-overlay topology-overlay--top-right">
    <div class="topology-hud topology-hud--controls">
      <div class="topology-toolbar topology-toolbar--compact">
        <button type="button" class="topology-button" id="zoom-in">Zoom in</button>
        <button type="button" class="topology-button" id="zoom-out">Zoom out</button>
        <button type="button" class="topology-button" id="reset-view">Reset view</button>
      </div>
      <div class="topology-legend" aria-label="Map legend">
        <span><i class="legend-swatch legend-swatch--physical"></i>Physical links</span>
        <span><i class="legend-swatch legend-swatch--runtime"></i>Runtime placement</span>
        <span><i class="legend-swatch legend-swatch--policy"></i>Firewall / trust flows</span>
      </div>
    </div>
  </div>

  {/* Drawer */}
  <div class="topology-overlay topology-overlay--drawer">
    <aside class="drawer-panel drawer-panel--empty" id="detail-drawer">
      <p class="drawer-eyebrow">Interactive overview</p>
      <h2>The map is the page.</h2>
      <p>Drag to pan, use the mouse wheel to zoom, and click a host, service, or VLAN lane to focus that part of the lab.</p>
      <div class="drawer-badges" aria-label="Map controls">
        <span class="drawer-badge">Drag to pan</span>
        <span class="drawer-badge">Wheel to zoom</span>
        <span class="drawer-badge">Click to focus</span>
      </div>
    </aside>
  </div>
</section>
```

- [ ] **Step 3: Create topology page**

```astro
---
// src/pages/homelab/topology.astro
import TopologyMap from '../../components/topology/TopologyMap.astro';
import '../../styles/global.css';
import '../../styles/topology.css';
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Interactive topology map of Dylan's homelab infrastructure" />
    <title>Homelab Topology — Dylan McCavitt</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  </head>
  <body class="topology-page">
    <a href="/projects/homelab/" class="topology-back">&larr; Back to Homelab</a>
    <TopologyMap />
  </body>
</html>
```

- [ ] **Step 4: Verify static SVG renders**

```bash
npx astro dev
```

Navigate to `http://localhost:4321/homelab/topology/`. Expected: the full topology SVG renders with all nodes, edges, and frames visible. No interactivity yet — just the static map with HUD overlays and the empty drawer.

- [ ] **Step 5: Commit**

```bash
git add src/components/topology/TopologyMap.astro src/pages/homelab/topology.astro src/styles/topology.css
git commit -m "Add topology map page with server-rendered SVG and HUD overlays"
```

---

## Task 8: Topology Map — Interactivity

**Files:**

- Create: `src/scripts/topology.ts`
- Modify: `src/components/topology/TopologyMap.astro` (add script import)

- [ ] **Step 1: Create topology interaction script**

This is the core vanilla JS port of the React topology map. It handles camera (pan/zoom), entity focus/highlight, view modes, and the detail drawer.

```typescript
// src/scripts/topology.ts
import {
  entities,
  type EntityId,
  type Entity,
} from "../data/topology/entities";
import { overviewLayout, type ViewMode } from "../data/topology/layout";

// --- Types ---

type Camera = { tx: number; ty: number; scale: number };
type Bounds = { x: number; y: number; w: number; h: number };
type DragState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startTx: number;
  startTy: number;
  moved: boolean;
};

// --- Constants ---

const VIEWBOX_W = 6588.16666666667;
const VIEWBOX_H = 4878.970184856642;
const SCENE_PADDING = 260;
const MIN_SCALE = 1;
const MAX_SCALE = 2.35;

const VIEW_MODE_HINTS: Record<ViewMode, string> = {
  overview: "Balanced physical, runtime, and policy context",
  runtime: "Emphasize Proxmox placement and hosted workloads",
  trust: "Emphasize VLAN lanes and firewall policy flows",
};

const trustFrameIds = new Set<string>([
  "management-lane",
  "service-lane",
  "signal-lane",
  "automation-lane",
]);

// --- DOM refs ---

const svg = document.getElementById("topology-svg") as SVGSVGElement | null;
const cameraGroup = document.getElementById(
  "topology-camera",
) as SVGGElement | null;
const bg = document.getElementById("topology-bg") as SVGRectElement | null;
const drawer = document.getElementById("detail-drawer") as HTMLElement | null;
const hintEl = document.getElementById("view-mode-hint") as HTMLElement | null;

if (!svg || !cameraGroup || !bg || !drawer || !hintEl) {
  throw new Error("Topology DOM elements not found");
}

// --- State ---

let camera: Camera = { tx: 0, ty: 0, scale: 1 };
let activeId: EntityId | null = null;
let hoveredId: EntityId | null = null;
let viewMode: ViewMode = "overview";
let dragState: DragState | null = null;
let lastDragEndedAt = 0;
let animationFrame: number | null = null;

// --- Scene bounds ---

function computeSceneBounds(): Bounds {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const include = (x: number, y: number, w: number, h: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };
  overviewLayout.frames.forEach((f) => include(f.x, f.y, f.w, f.h));
  overviewLayout.nodes.forEach((n) => {
    include(n.x, n.y, n.w, n.h);
    n.chips?.forEach((c) => include(n.x + c.x, n.y + c.y, c.w, c.h));
  });
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

const sceneBounds = computeSceneBounds();

// --- Camera math ---

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function constrainCamera(c: Camera): Camera {
  const scale = clamp(c.scale, MIN_SCALE, MAX_SCALE);
  const minTx =
    VIEWBOX_W - SCENE_PADDING - (sceneBounds.x + sceneBounds.w) * scale;
  const maxTx = SCENE_PADDING - sceneBounds.x * scale;
  const minTy =
    VIEWBOX_H - SCENE_PADDING - (sceneBounds.y + sceneBounds.h) * scale;
  const maxTy = SCENE_PADDING - sceneBounds.y * scale;
  return {
    scale,
    tx: clamp(c.tx, Math.min(minTx, maxTx), Math.max(minTx, maxTx)),
    ty: clamp(c.ty, Math.min(minTy, maxTy), Math.max(minTy, maxTy)),
  };
}

function centerCameraForBounds(bounds: Bounds, scale: number): Camera {
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  return constrainCamera({
    scale,
    tx: VIEWBOX_W / 2 - cx * scale,
    ty: VIEWBOX_H / 2 - cy * scale,
  });
}

function zoomCamera(
  cam: Camera,
  anchorX: number,
  anchorY: number,
  nextScale: number,
): Camera {
  const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
  if (scale === cam.scale) return cam;
  const wx = (anchorX - cam.tx) / cam.scale;
  const wy = (anchorY - cam.ty) / cam.scale;
  return constrainCamera({
    scale,
    tx: anchorX - wx * scale,
    ty: anchorY - wy * scale,
  });
}

// Init camera centered on scene
camera = centerCameraForBounds(sceneBounds, 1);
const DEFAULT_CAMERA: Camera = { ...camera };

// --- Entity bounds lookup ---

function getEntityBounds(entityId: string): Bounds | null {
  for (const frame of overviewLayout.frames) {
    if (frame.entityId === entityId)
      return { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
  }
  for (const node of overviewLayout.nodes) {
    if (node.id === entityId)
      return { x: node.x, y: node.y, w: node.w, h: node.h };
    for (const chip of node.chips ?? []) {
      if (chip.id === entityId)
        return { x: node.x + chip.x, y: node.y + chip.y, w: chip.w, h: chip.h };
    }
  }
  return null;
}

// --- Highlight set ---

function buildHighlightSet(focusId: string | null): Set<string> {
  if (!focusId) return new Set();
  const entity = entities[focusId as EntityId];
  if (!entity) return new Set();
  const hl = new Set<string>([focusId, ...entity.related]);

  overviewLayout.nodes.forEach((node) => {
    if (node.id === focusId || node.chips?.some((c) => c.id === focusId)) {
      hl.add(node.id);
      node.chips?.forEach((c) => hl.add(c.id));
    }
  });
  overviewLayout.frames.forEach((frame) => {
    if (
      frame.entityId === focusId ||
      frame.members?.includes(focusId as EntityId)
    ) {
      hl.add(frame.id);
      if (frame.entityId) hl.add(frame.entityId);
      frame.members?.forEach((m) => hl.add(m));
    }
  });
  return hl;
}

// --- Rendering ---

function applyCamera(): void {
  cameraGroup!.setAttribute(
    "transform",
    `translate(${camera.tx} ${camera.ty}) scale(${camera.scale})`,
  );
}

function applyHighlights(): void {
  const focusId = hoveredId ?? activeId;
  const highlighted = buildHighlightSet(focusId);
  const hasHighlight = highlighted.size > 0;

  // Frames
  document.querySelectorAll<SVGGElement>("[data-frame-id]").forEach((g) => {
    const frameId = g.dataset.frameId!;
    const entityId = g.dataset.entityId || null;
    const isHl =
      highlighted.has(frameId) ||
      (entityId !== null && highlighted.has(entityId));
    const rect = g.querySelector("rect")!;
    const labelRect = g.querySelector("g rect");

    if (isHl) {
      rect.setAttribute("stroke", "#f6fbff");
      rect.setAttribute("stroke-width", "10");
      if (labelRect) {
        labelRect.setAttribute("stroke", "#f6fbff");
      }
    } else {
      // Reset to original — read from layout data
      const frame = overviewLayout.frames.find((f) => f.id === frameId);
      if (frame) {
        const palette: Record<string, { stroke: string }> = {
          hardware: { stroke: "#456886" },
          compute: { stroke: "#314b63" },
          management: { stroke: "#75c7ff" },
          service: { stroke: "#84db91" },
          signal: { stroke: "#7fd8d0" },
          automation: { stroke: "#f1c575" },
        };
        const p = palette[frame.tone];
        rect.setAttribute("stroke", p.stroke);
        rect.setAttribute("stroke-width", "6");
        if (labelRect) {
          labelRect.setAttribute("stroke", p.stroke);
        }
      }
    }
  });

  // Nodes
  document.querySelectorAll<SVGGElement>("[data-node-id]").forEach((g) => {
    const nodeId = g.dataset.nodeId!;
    const isActive = nodeId === activeId;
    const isFocused = hasHighlight && (highlighted.has(nodeId) || false);
    const rect = g.querySelector(":scope > rect")!;

    if (isActive) {
      rect.setAttribute("stroke", "#f6fbff");
      rect.setAttribute("stroke-width", "12");
    } else if (isFocused) {
      rect.setAttribute("stroke", "#d9ebfb");
      rect.setAttribute("stroke-width", "9");
    } else {
      // Reset
      const node = overviewLayout.nodes.find((n) => n.id === nodeId);
      if (node) {
        const hw: Record<string, string> = {
          opnsense: "#7ed0ff",
          proxmox: "#9de07e",
          "unifi-ap": "#7adfd1",
          "bazzite-pc": "#d7a4ff",
          jetkvm: "#ffb27d",
          nas: "#f2d177",
        };
        const nodePalette: Record<string, string> = {
          edge: "#7ed0ff",
          network: "#7fb2ff",
          platform: "#9de07e",
          runtime: "#f2c779",
          device: "#f7ae73",
          client: "#e79cff",
        };
        rect.setAttribute(
          "stroke",
          hw[nodeId] ?? nodePalette[node.tone] ?? "#7ed0ff",
        );
        rect.setAttribute("stroke-width", "6");
      }
    }
  });

  // Chips
  document.querySelectorAll<SVGGElement>("[data-chip-id]").forEach((g) => {
    const chipId = g.dataset.chipId!;
    const isActive = chipId === activeId;
    const isFocused = hasHighlight && highlighted.has(chipId);
    const rect = g.querySelector("rect")!;

    if (isActive) {
      rect.setAttribute("stroke", "#f6fbff");
      rect.setAttribute("stroke-width", "8");
    } else if (isFocused) {
      rect.setAttribute("stroke", "#d9ebfb");
      rect.setAttribute("stroke-width", "6");
    } else {
      // Reset — find chip tone
      for (const node of overviewLayout.nodes) {
        const chip = node.chips?.find((c) => c.id === chipId);
        if (chip) {
          const chipPalette: Record<string, string> = {
            service: "#8ee49a",
            controller: "#8ec7ff",
            monitoring: "#85e0d8",
            agent: "#f1c575",
            utility: "#b6b4ff",
          };
          rect.setAttribute("stroke", chipPalette[chip.tone] ?? "#8ee49a");
          rect.setAttribute("stroke-width", "4");
          break;
        }
      }
    }
  });

  // Edges
  document.querySelectorAll<SVGGElement>("[data-edge-id]").forEach((g) => {
    const from = g.dataset.edgeFrom!;
    const to = g.dataset.edgeTo!;
    const kind = g.dataset.edgeKind as "physical" | "runtime" | "policy";
    const isHl = hasHighlight && (highlighted.has(from) || highlighted.has(to));
    const polyline = g.querySelector("polyline")!;
    const label = g.querySelector("text");

    if (isHl) {
      g.setAttribute("opacity", "1");
      polyline.setAttribute("stroke", "#f6fbff");
      polyline.setAttribute("stroke-width", "12");
      if (label) label.setAttribute("fill", "#f6fbff");
    } else {
      const opacity = edgeOpacity(kind, viewMode);
      g.setAttribute("opacity", String(opacity));
      const strokeColors = {
        physical: "#7d95ac",
        runtime: "#f2c779",
        policy: "#79d89c",
      };
      polyline.setAttribute("stroke", strokeColors[kind]);
      polyline.setAttribute("stroke-width", kind === "policy" ? "8" : "10");
      if (label) label.setAttribute("fill", "#b8c9d8");
    }
  });
}

function edgeOpacity(
  kind: "physical" | "runtime" | "policy",
  vm: ViewMode,
): number {
  if (vm === "overview")
    return kind === "physical" ? 0.9 : kind === "runtime" ? 0.88 : 0.75;
  if (vm === "runtime")
    return kind === "runtime" ? 0.96 : kind === "physical" ? 0.24 : 0.12;
  return kind === "policy" ? 0.96 : kind === "physical" ? 0.18 : 0.26;
}

function applyViewMode(): void {
  document.querySelectorAll<SVGGElement>("[data-frame-id]").forEach((g) => {
    const entityId = g.dataset.entityId || null;
    const isTrust = entityId !== null && trustFrameIds.has(entityId);
    const opacity =
      viewMode === "trust" && isTrust
        ? 1
        : viewMode === "runtime" && isTrust
          ? 0.4
          : 0.78;
    g.setAttribute("opacity", String(opacity));
  });
}

function render(): void {
  applyCamera();
  applyHighlights();
  applyViewMode();
}

// --- Detail drawer ---

function renderDrawer(): void {
  if (!activeId) {
    drawer!.className = "drawer-panel drawer-panel--empty";
    drawer!.innerHTML = `
      <p class="drawer-eyebrow">Interactive overview</p>
      <h2>The map is the page.</h2>
      <p>Drag to pan, use the mouse wheel to zoom, and click a host, service, or VLAN lane to focus that part of the lab.</p>
      <div class="drawer-badges" aria-label="Map controls">
        <span class="drawer-badge">Drag to pan</span>
        <span class="drawer-badge">Wheel to zoom</span>
        <span class="drawer-badge">Click to focus</span>
      </div>`;
    return;
  }

  const entity = entities[activeId];
  const relatedHtml = entity.related
    .filter((rid) => rid in entities)
    .map(
      (rid) =>
        `<button type="button" class="drawer-related-button" data-entity-click="${rid}">${entities[rid as EntityId].title}</button>`,
    )
    .join("");

  const sectionsHtml = entity.sections
    .map(
      (s) => `
      <section class="drawer-section">
        <h3>${s.title}</h3>
        <ul>${s.items.map((item) => `<li>${item}</li>`).join("")}</ul>
      </section>`,
    )
    .join("");

  drawer!.className = "drawer-panel";
  drawer!.innerHTML = `
    <div class="drawer-heading-row">
      <p class="drawer-eyebrow">${entity.kind}</p>
      <button type="button" class="drawer-close" id="drawer-close" aria-label="Close details">Dismiss</button>
    </div>
    <h2>${entity.title}</h2>
    <p class="drawer-summary">${entity.summary}</p>
    <div class="drawer-badges" aria-label="Entity tags">
      ${entity.badges.map((b) => `<span class="drawer-badge">${b}</span>`).join("")}
    </div>
    ${relatedHtml ? `<section class="drawer-section"><h3>Connected here</h3><div class="drawer-related">${relatedHtml}</div></section>` : ""}
    ${sectionsHtml}`;

  // Bind close button
  document.getElementById("drawer-close")?.addEventListener("click", resetView);
}

// --- Actions ---

function focusEntity(entityId: EntityId): void {
  activeId = entityId;
  hoveredId = null;
  const bounds = getEntityBounds(entityId);
  if (bounds) {
    const widthScale = (VIEWBOX_W * 0.32) / bounds.w;
    const heightScale = (VIEWBOX_H * 0.38) / bounds.h;
    const scale = clamp(
      Math.min(widthScale, heightScale),
      MIN_SCALE,
      MAX_SCALE,
    );
    camera = centerCameraForBounds(bounds, scale);
  }
  render();
  renderDrawer();
}

function resetView(): void {
  activeId = null;
  hoveredId = null;
  camera = { ...DEFAULT_CAMERA };
  render();
  renderDrawer();
}

// --- Event handlers ---

// Pan
svg!.addEventListener("pointerdown", (e: PointerEvent) => {
  if (e.button !== 0) return;
  svg!.setPointerCapture(e.pointerId);
  dragState = {
    pointerId: e.pointerId,
    startClientX: e.clientX,
    startClientY: e.clientY,
    startTx: camera.tx,
    startTy: camera.ty,
    moved: false,
  };
  document
    .getElementById("topology-screen")!
    .classList.add("topology-screen--dragging");
});

svg!.addEventListener("pointermove", (e: PointerEvent) => {
  if (!dragState || dragState.pointerId !== e.pointerId) return;
  const rect = svg!.getBoundingClientRect();
  const unitsPerPixelX = VIEWBOX_W / rect.width;
  const unitsPerPixelY = VIEWBOX_H / rect.height;
  const dx = (e.clientX - dragState.startClientX) * unitsPerPixelX;
  const dy = (e.clientY - dragState.startClientY) * unitsPerPixelY;

  if (Math.abs(dx) > unitsPerPixelX * 6 || Math.abs(dy) > unitsPerPixelY * 6) {
    dragState.moved = true;
  }

  camera = constrainCamera({
    scale: camera.scale,
    tx: dragState.startTx + dx,
    ty: dragState.startTy + dy,
  });
  applyCamera();
});

function endDrag(pointerId: number): void {
  if (!dragState || dragState.pointerId !== pointerId) return;
  if (dragState.moved) lastDragEndedAt = performance.now();
  dragState = null;
  document
    .getElementById("topology-screen")!
    .classList.remove("topology-screen--dragging");
}

svg!.addEventListener("pointerup", (e: PointerEvent) => endDrag(e.pointerId));
svg!.addEventListener("pointercancel", (e: PointerEvent) =>
  endDrag(e.pointerId),
);

// Zoom
svg!.addEventListener(
  "wheel",
  (e: WheelEvent) => {
    e.preventDefault();
    const rect = svg!.getBoundingClientRect();
    const anchorX = ((e.clientX - rect.left) / rect.width) * VIEWBOX_W;
    const anchorY = ((e.clientY - rect.top) / rect.height) * VIEWBOX_H;
    const multiplier = Math.exp(-e.deltaY * 0.0012);
    camera = zoomCamera(camera, anchorX, anchorY, camera.scale * multiplier);
    applyCamera();
  },
  { passive: false },
);

// Click handling (delegated)
function isRecentDrag(): boolean {
  return performance.now() - lastDragEndedAt < 140;
}

document.addEventListener("click", (e: MouseEvent) => {
  if (isRecentDrag()) return;

  const target = e.target as Element;

  // Entity click (node, chip, frame label, related button)
  const clickable = target.closest("[data-entity-click]");
  if (clickable) {
    e.stopPropagation();
    const entityId = (clickable as HTMLElement).dataset.entityClick as EntityId;
    if (entityId && entityId in entities) {
      focusEntity(entityId);
    }
    return;
  }

  // Background click
  if (target === bg || target.closest("#topology-svg")) {
    resetView();
  }
});

// Hover
svg!.addEventListener("mouseover", (e: MouseEvent) => {
  const target = (e.target as Element).closest("[data-entity-click]");
  if (target) {
    const entityId = (target as HTMLElement).dataset.entityClick as EntityId;
    if (entityId && entityId in entities) {
      hoveredId = entityId;
      applyHighlights();
    }
  }
});

svg!.addEventListener("mouseout", (e: MouseEvent) => {
  const target = (e.target as Element).closest("[data-entity-click]");
  if (target) {
    hoveredId = null;
    applyHighlights();
  }
});

// Zoom buttons
document.getElementById("zoom-in")?.addEventListener("click", () => {
  camera = zoomCamera(
    camera,
    VIEWBOX_W / 2,
    VIEWBOX_H / 2,
    camera.scale * 1.15,
  );
  applyCamera();
});

document.getElementById("zoom-out")?.addEventListener("click", () => {
  camera = zoomCamera(
    camera,
    VIEWBOX_W / 2,
    VIEWBOX_H / 2,
    camera.scale / 1.15,
  );
  applyCamera();
});

document.getElementById("reset-view")?.addEventListener("click", resetView);

// View mode switcher
document
  .querySelectorAll<HTMLButtonElement>("[data-view-mode]")
  .forEach((btn) => {
    btn.addEventListener("click", () => {
      viewMode = btn.dataset.viewMode as ViewMode;
      // Update active states
      document
        .querySelectorAll<HTMLButtonElement>("[data-view-mode]")
        .forEach((b) => {
          const isActive = b.dataset.viewMode === viewMode;
          b.classList.toggle("topology-button--active", isActive);
          b.setAttribute("aria-selected", String(isActive));
        });
      hintEl!.textContent = VIEW_MODE_HINTS[viewMode];
      render();
    });
  });

// --- Init ---
render();
```

- [ ] **Step 2: Add script import to TopologyMap component**

Add the following at the end of `src/components/topology/TopologyMap.astro`, after the closing `</section>` tag:

```astro
<script>
  import '../../scripts/topology.ts';
</script>
```

- [ ] **Step 3: Verify full interactivity**

```bash
npx astro dev
```

Navigate to `/homelab/topology/`. Test:

- Drag to pan — map moves, cursor changes to grabbing
- Scroll to zoom — zooms toward cursor
- Click a node (e.g. OPNsense) — camera animates to it, drawer shows entity details, related entities highlighted
- Click background — resets view and drawer
- Click related entity in drawer — navigates to that entity
- Click "Dismiss" in drawer — resets
- Zoom in/out/reset buttons work
- View mode buttons switch between Overview/Runtime/Trust with correct edge opacity changes
- Hover highlights nodes and edges

- [ ] **Step 4: Commit**

```bash
git add src/scripts/topology.ts src/components/topology/TopologyMap.astro
git commit -m "Add topology map interactivity: pan, zoom, focus, drawer, view modes"
```

---

## Task 9: Polish and Build Verification

**Files:**

- Modify: `src/pages/index.astro` (update content collections usage)
- Create: `public/favicon.svg`

- [ ] **Step 1: Create favicon**

```svg
<!-- public/favicon.svg -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" fill="#1a1f2e"/>
  <text x="8" y="23" font-family="system-ui, sans-serif" font-size="20" font-weight="600" fill="#fafbfc">D</text>
</svg>
```

- [ ] **Step 2: Update homepage to use content collections for project cards**

Replace the hardcoded project cards in `src/pages/index.astro` with a dynamic query:

In the frontmatter:

```astro
---
import Base from '../layouts/Base.astro';
import ProjectCard from '../components/ProjectCard.astro';
import { getCollection } from 'astro:content';

const projects = await getCollection('projects');
const sorted = projects.sort((a, b) => a.data.order - b.data.order);
---
```

Replace the `projects__grid` div contents:

```astro
<div class="projects__grid">
  {sorted.map((project) => (
    <ProjectCard title={project.data.title} href={`/projects/${project.id}/`} />
  ))}
</div>
```

- [ ] **Step 3: Run production build**

```bash
npx astro build
```

Expected: Build succeeds with zero errors. Output in `dist/`. Static HTML for all pages, JS bundle only for topology page.

- [ ] **Step 4: Preview production build**

```bash
npx astro preview
```

Expected: All pages render correctly. Homepage project cards link to correct pages. Topology map is fully interactive. No console errors.

- [ ] **Step 5: Verify zero JS on non-topology pages**

Check the built HTML for the homepage:

```bash
grep -c '<script' dist/index.html
```

Expected: 0 (or only the hamburger menu script). The topology page at `dist/homelab/topology/index.html` should have the bundled topology script.

- [ ] **Step 6: Commit**

```bash
git add public/favicon.svg src/pages/index.astro
git commit -m "Add favicon, wire homepage to content collections, verify production build"
```
