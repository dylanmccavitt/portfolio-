# Palette Nav + Theme Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sticky top-bar nav with a centered palette-strip nav and add a 7-theme switcher system.

**Architecture:** Themes are CSS custom property sets on `[data-theme]` selectors. A tiny inline script in `<head>` reads `localStorage` to prevent flash. The palette nav is a flex strip of equal-width swatches colored by theme variables. A `[/theme]` dropdown toggles between themes.

**Tech Stack:** Astro 5, vanilla CSS custom properties, vanilla JS (no framework)

---

## File Map

| File                              | Action  | Responsibility                                                    |
| --------------------------------- | ------- | ----------------------------------------------------------------- |
| `src/styles/themes.css`           | Create  | All 7 theme definitions as `[data-theme]` selectors               |
| `src/styles/global.css`           | Modify  | `:root` becomes Nord fallback, import themes.css                  |
| `src/styles/components.css`       | Modify  | Remove old header styles, add palette nav + theme dropdown styles |
| `src/components/Header.astro`     | Rewrite | `[Dylan McCavitt]` wordmark only, no nav links                    |
| `src/components/PaletteNav.astro` | Create  | Centered palette strip + `[/theme]` button + dropdown markup      |
| `src/layouts/Base.astro`          | Modify  | Add flash-prevention inline script, import PaletteNav             |
| `src/scripts/theme-switcher.ts`   | Create  | Dropdown toggle, theme selection, localStorage persistence        |
| `src/pages/index.astro`           | Modify  | Replace hero with new layout: header, palette nav, tagline        |
| `src/pages/resume.astro`          | Create  | Placeholder resume page                                           |

---

### Task 1: Create theme definitions

**Files:**

- Create: `src/styles/themes.css`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Create `src/styles/themes.css` with all 7 theme definitions**

```css
/* ============================================================
   Theme Definitions
   Each theme provides palette + nav swatch colors.
   Applied via [data-theme] on <html>.
   ============================================================ */

[data-theme="nord"] {
  --bg: #d8dee9;
  --surface: #c8d0dc;
  --text: #2e3440;
  --text-muted: #4c566a;
  --accent: #5e81ac;
  --border: #b8c2d0;
  --nav-1: #8fbcbb;
  --nav-2: #88c0d0;
  --nav-3: #81a1c1;
  --nav-4: #5e81ac;
  --nav-5: #4c566a;
  --nav-text-1: #2e3440;
  --nav-text-2: #2e3440;
  --nav-text-3: #2e3440;
  --nav-text-4: #eceff4;
  --nav-text-5: #eceff4;
  --dropdown-bg: #2e3440;
  --dropdown-text: #d8dee9;
}

[data-theme="dracula"] {
  --bg: #282a36;
  --surface: #44475a;
  --text: #f8f8f2;
  --text-muted: #6272a4;
  --accent: #bd93f9;
  --border: #6272a4;
  --nav-1: #bd93f9;
  --nav-2: #8be9fd;
  --nav-3: #50fa7b;
  --nav-4: #ff79c6;
  --nav-5: #44475a;
  --nav-text-1: #282a36;
  --nav-text-2: #282a36;
  --nav-text-3: #282a36;
  --nav-text-4: #282a36;
  --nav-text-5: #f8f8f2;
  --dropdown-bg: #282a36;
  --dropdown-text: #f8f8f2;
}

[data-theme="rose-pine"] {
  --bg: #191724;
  --surface: #1f1d2e;
  --text: #e0def4;
  --text-muted: #908caa;
  --accent: #c4a7e7;
  --border: #26233a;
  --nav-1: #ebbcba;
  --nav-2: #f6c177;
  --nav-3: #c4a7e7;
  --nav-4: #9ccfd8;
  --nav-5: #26233a;
  --nav-text-1: #191724;
  --nav-text-2: #191724;
  --nav-text-3: #191724;
  --nav-text-4: #191724;
  --nav-text-5: #e0def4;
  --dropdown-bg: #191724;
  --dropdown-text: #e0def4;
}

[data-theme="gruvbox"] {
  --bg: #282828;
  --surface: #3c3836;
  --text: #ebdbb2;
  --text-muted: #a89984;
  --accent: #d79921;
  --border: #504945;
  --nav-1: #cc241d;
  --nav-2: #d79921;
  --nav-3: #689d6a;
  --nav-4: #458588;
  --nav-5: #3c3836;
  --nav-text-1: #ebdbb2;
  --nav-text-2: #282828;
  --nav-text-3: #282828;
  --nav-text-4: #ebdbb2;
  --nav-text-5: #ebdbb2;
  --dropdown-bg: #282828;
  --dropdown-text: #ebdbb2;
}

[data-theme="everforest"] {
  --bg: #2d353b;
  --surface: #343f44;
  --text: #d3c6aa;
  --text-muted: #859289;
  --accent: #a7c080;
  --border: #475258;
  --nav-1: #a7c080;
  --nav-2: #dbbc7f;
  --nav-3: #7fbbb3;
  --nav-4: #d699b6;
  --nav-5: #343f44;
  --nav-text-1: #2d353b;
  --nav-text-2: #2d353b;
  --nav-text-3: #2d353b;
  --nav-text-4: #2d353b;
  --nav-text-5: #d3c6aa;
  --dropdown-bg: #2d353b;
  --dropdown-text: #d3c6aa;
}

[data-theme="night-owl"] {
  --bg: #011627;
  --surface: #0b2942;
  --text: #d6deeb;
  --text-muted: #637777;
  --accent: #82aaff;
  --border: #1d3b53;
  --nav-1: #c792ea;
  --nav-2: #82aaff;
  --nav-3: #c3e88d;
  --nav-4: #f78c6c;
  --nav-5: #0b2942;
  --nav-text-1: #011627;
  --nav-text-2: #011627;
  --nav-text-3: #011627;
  --nav-text-4: #011627;
  --nav-text-5: #d6deeb;
  --dropdown-bg: #011627;
  --dropdown-text: #d6deeb;
}

[data-theme="dark-plus"] {
  --bg: #1e1e1e;
  --surface: #252526;
  --text: #d4d4d4;
  --text-muted: #808080;
  --accent: #569cd6;
  --border: #3e3e3e;
  --nav-1: #569cd6;
  --nav-2: #4ec9b0;
  --nav-3: #9cdcfe;
  --nav-4: #ce9178;
  --nav-5: #252526;
  --nav-text-1: #1e1e1e;
  --nav-text-2: #1e1e1e;
  --nav-text-3: #1e1e1e;
  --nav-text-4: #1e1e1e;
  --nav-text-5: #d4d4d4;
  --dropdown-bg: #1e1e1e;
  --dropdown-text: #d4d4d4;
}
```

- [ ] **Step 2: Update `src/styles/global.css` — make `:root` the Nord fallback, import themes**

Replace the existing `:root` palette block and add the themes import. The `:root` values serve as fallback when no `data-theme` is set.

Change the import section at the top of `global.css` to:

```css
@import "./components.css";
@import "./project.css";
@import "./themes.css";
```

Replace the `:root` palette comment and values:

```css
:root {
  /* Fallback palette (Nord) — overridden by [data-theme] */
  --bg: #d8dee9;
  --surface: #c8d0dc;
  --text: #2e3440;
  --text-muted: #4c566a;
  --accent: #5e81ac;
  --border: #b8c2d0;
  --nav-1: #8fbcbb;
  --nav-2: #88c0d0;
  --nav-3: #81a1c1;
  --nav-4: #5e81ac;
  --nav-5: #4c566a;
  --nav-text-1: #2e3440;
  --nav-text-2: #2e3440;
  --nav-text-3: #2e3440;
  --nav-text-4: #eceff4;
  --nav-text-5: #eceff4;
  --dropdown-bg: #2e3440;
  --dropdown-text: #d8dee9;

  /* Typography */
  --font-body: "Google Sans Code", "SF Mono", "Fira Code", monospace;
  /* ... rest of typography and spacing unchanged ... */
```

- [ ] **Step 3: Verify build**

Run: `npx astro build`
Expected: Build succeeds. Site looks the same (Nord fallback matches current-ish colors).

- [ ] **Step 4: Commit**

```bash
git add src/styles/themes.css src/styles/global.css
git commit -m "Add theme definitions and Nord fallback tokens"
```

---

### Task 2: Flash-prevention script and theme application

**Files:**

- Modify: `src/layouts/Base.astro`

- [ ] **Step 1: Add inline flash-prevention script to `<head>` in `Base.astro`**

Add this immediately after the `<link rel="icon">` line in the `<head>`:

```html
<script is:inline>
  (function () {
    var theme = localStorage.getItem("portfolio-theme") || "nord";
    document.documentElement.setAttribute("data-theme", theme);
  })();
</script>
```

This runs synchronously before first paint, so no flash of wrong theme.

- [ ] **Step 2: Verify build**

Run: `npx astro build`
Expected: Build succeeds. Page loads with `data-theme="nord"` on `<html>`.

- [ ] **Step 3: Commit**

```bash
git add src/layouts/Base.astro
git commit -m "Add flash-prevention theme script to layout head"
```

---

### Task 3: Rewrite Header component

**Files:**

- Rewrite: `src/components/Header.astro`
- Modify: `src/styles/components.css`

- [ ] **Step 1: Rewrite `src/components/Header.astro`**

Replace the entire file:

```astro
---
---

<header class="header">
  <a href="/" class="header__name">[Dylan McCavitt]</a>
</header>
```

- [ ] **Step 2: Replace header styles in `src/styles/components.css`**

Replace everything from the `/* Header */` comment through the `@media (max-width: 640px)` closing brace (lines 1-91) with:

```css
/* ============================================================
   Header
   ============================================================ */

.header {
  padding: var(--space-5) var(--space-6);
}

.header__name {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text);
  text-decoration: none;
  letter-spacing: -0.02em;
}

.header__name:hover {
  color: var(--accent);
  text-decoration: none;
}
```

- [ ] **Step 3: Verify build**

Run: `npx astro build`
Expected: Build succeeds. Header shows `[Dylan McCavitt]` top-left, no nav links.

- [ ] **Step 4: Commit**

```bash
git add src/components/Header.astro src/styles/components.css
git commit -m "Rewrite header to bracket wordmark style"
```

---

### Task 4: Create PaletteNav component

**Files:**

- Create: `src/components/PaletteNav.astro`
- Modify: `src/styles/components.css`

- [ ] **Step 1: Create `src/components/PaletteNav.astro`**

```astro
---
const themes = [
  {
    id: 'nord',
    name: 'Nord',
    swatches: ['#8fbcbb', '#88c0d0', '#81a1c1', '#5e81ac'],
  },
  {
    id: 'dracula',
    name: 'Dracula',
    swatches: ['#bd93f9', '#8be9fd', '#50fa7b', '#ff79c6'],
  },
  {
    id: 'rose-pine',
    name: 'Rosé Pine',
    swatches: ['#ebbcba', '#f6c177', '#c4a7e7', '#9ccfd8'],
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox',
    swatches: ['#cc241d', '#d79921', '#689d6a', '#458588'],
  },
  {
    id: 'everforest',
    name: 'Everforest',
    swatches: ['#a7c080', '#dbbc7f', '#7fbbb3', '#d699b6'],
  },
  {
    id: 'night-owl',
    name: 'Night Owl',
    swatches: ['#c792ea', '#82aaff', '#c3e88d', '#f78c6c'],
  },
  {
    id: 'dark-plus',
    name: 'Dark+',
    swatches: ['#569cd6', '#4ec9b0', '#9cdcfe', '#ce9178'],
  },
];

const navLinks = [
  { label: 'Projects', href: '/#projects' },
  { label: 'About', href: '/#about' },
  { label: 'Contact', href: '/#contact' },
  { label: 'Resume', href: '/resume/' },
  { label: 'GitHub', href: 'https://github.com/DylanMcCavitt', external: true },
];
---

<nav class="palette-nav">
  <div class="palette-nav__wrapper">
    <button
      class="palette-nav__theme-toggle"
      id="theme-toggle"
      aria-expanded="false"
      aria-haspopup="true"
    >
      [/theme]
    </button>
    <div class="palette-nav__dropdown" id="theme-dropdown" hidden>
      {themes.map((theme) => (
        <button
          class="palette-nav__dropdown-item"
          data-theme-id={theme.id}
        >
          <span class="palette-nav__dropdown-swatches">
            {theme.swatches.map((color) => (
              <span class="palette-nav__dropdown-swatch" style={`background:${color}`}></span>
            ))}
          </span>
          <span class="palette-nav__dropdown-name">{theme.name}</span>
          <span class="palette-nav__dropdown-check" aria-hidden="true"></span>
        </button>
      ))}
    </div>
    <div class="palette-nav__strip">
      {navLinks.map((link, i) => (
        <a
          href={link.href}
          class="palette-nav__swatch"
          style={`background:var(--nav-${i + 1}); color:var(--nav-text-${i + 1})`}
          {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {link.label}
        </a>
      ))}
    </div>
  </div>
</nav>
```

- [ ] **Step 2: Add palette nav and theme dropdown styles to `src/styles/components.css`**

Append after the header styles:

```css
/* ============================================================
   Palette Nav
   ============================================================ */

.palette-nav {
  display: flex;
  justify-content: center;
  padding: var(--space-7) var(--space-5) var(--space-5);
}

.palette-nav__wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.palette-nav__theme-toggle {
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--text-muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: var(--space-1) var(--space-2);
  margin-bottom: var(--space-2);
  border-radius: 4px;
  transition:
    background 0.15s,
    color 0.15s;
}

.palette-nav__theme-toggle:hover,
.palette-nav__theme-toggle[aria-expanded="true"] {
  background: var(--dropdown-bg);
  color: var(--dropdown-text);
}

/* Dropdown */

.palette-nav__dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 200;
  background: var(--dropdown-bg);
  border-radius: 0 6px 6px 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  min-width: 200px;
  overflow: hidden;
}

.palette-nav__dropdown[hidden] {
  display: none;
}

.palette-nav__dropdown-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-3) var(--space-4);
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--dropdown-text);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
}

.palette-nav__dropdown-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.palette-nav__dropdown-item[data-active="true"] {
  background: rgba(255, 255, 255, 0.06);
}

.palette-nav__dropdown-swatches {
  display: flex;
  gap: 3px;
}

.palette-nav__dropdown-swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  display: block;
}

.palette-nav__dropdown-name {
  flex: 1;
}

.palette-nav__dropdown-check {
  width: 16px;
  text-align: center;
}

.palette-nav__dropdown-item[data-active="true"]
  .palette-nav__dropdown-check::after {
  content: "\2713";
}

/* Strip */

.palette-nav__strip {
  display: flex;
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
}

.palette-nav__swatch {
  flex: 1 1 0;
  min-width: 120px;
  padding: var(--space-4) var(--space-5);
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  text-align: center;
  text-decoration: none;
  transition: opacity 0.15s;
}

.palette-nav__swatch:hover {
  opacity: 0.85;
  text-decoration: none;
}

/* Mobile */

@media (max-width: 720px) {
  .palette-nav__strip {
    flex-direction: column;
    border-radius: 6px;
  }

  .palette-nav__swatch {
    min-width: unset;
    width: 100%;
    padding: var(--space-3) var(--space-5);
  }
}
```

- [ ] **Step 3: Verify build**

Run: `npx astro build`
Expected: Build succeeds. No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/PaletteNav.astro src/styles/components.css
git commit -m "Add palette nav component with theme dropdown markup"
```

---

### Task 5: Theme switcher script

**Files:**

- Create: `src/scripts/theme-switcher.ts`

- [ ] **Step 1: Create `src/scripts/theme-switcher.ts`**

```typescript
const STORAGE_KEY = "portfolio-theme";
const VALID_THEMES = [
  "nord",
  "dracula",
  "rose-pine",
  "gruvbox",
  "everforest",
  "night-owl",
  "dark-plus",
];

function getTheme(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored && VALID_THEMES.includes(stored) ? stored : "nord";
}

function setTheme(themeId: string): void {
  document.documentElement.setAttribute("data-theme", themeId);
  localStorage.setItem(STORAGE_KEY, themeId);
  updateActiveStates(themeId);
}

function updateActiveStates(themeId: string): void {
  const items = document.querySelectorAll<HTMLElement>(
    ".palette-nav__dropdown-item",
  );
  items.forEach((item) => {
    item.setAttribute("data-active", String(item.dataset.themeId === themeId));
  });
}

function initThemeSwitcher(): void {
  const toggle = document.getElementById("theme-toggle");
  const dropdown = document.getElementById("theme-dropdown");
  if (!toggle || !dropdown) return;

  const currentTheme = getTheme();
  updateActiveStates(currentTheme);

  // Toggle dropdown
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!isOpen));
    dropdown.hidden = isOpen;
  });

  // Theme selection
  dropdown.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>(
      ".palette-nav__dropdown-item",
    );
    if (!item?.dataset.themeId) return;
    setTheme(item.dataset.themeId);
    toggle.setAttribute("aria-expanded", "false");
    dropdown.hidden = true;
  });

  // Close on outside click
  document.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest(".palette-nav__wrapper")) {
      toggle.setAttribute("aria-expanded", "false");
      dropdown.hidden = true;
    }
  });

  // Close on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !dropdown.hidden) {
      toggle.setAttribute("aria-expanded", "false");
      dropdown.hidden = true;
      toggle.focus();
    }
  });
}

initThemeSwitcher();
```

- [ ] **Step 2: Verify build**

Run: `npx astro build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/theme-switcher.ts
git commit -m "Add theme switcher script with localStorage persistence"
```

---

### Task 6: Wire everything into layout and homepage

**Files:**

- Modify: `src/layouts/Base.astro`
- Modify: `src/pages/index.astro`

- [ ] **Step 1: Update `src/layouts/Base.astro` to import PaletteNav**

Replace the full file:

```astro
---
import Header from '../components/Header.astro';
import PaletteNav from '../components/PaletteNav.astro';
import Footer from '../components/Footer.astro';

interface Props {
  title: string;
  description?: string;
  showPaletteNav?: boolean;
}
const {
  title,
  description = 'Dylan McCavitt — Software Engineer',
  showPaletteNav = false,
} = Astro.props;
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content={description} />
    <title>{title}</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <script is:inline>
      (function() {
        var theme = localStorage.getItem('portfolio-theme') || 'nord';
        document.documentElement.setAttribute('data-theme', theme);
      })();
    </script>
  </head>
  <body>
    <Header />
    {showPaletteNav && <PaletteNav />}
    <slot />
    <Footer />
    <script src="../scripts/theme-switcher.ts"></script>
  </body>
</html>

<style is:global>
  @import '../styles/global.css';
</style>
```

Note: `showPaletteNav` defaults to false. Only the homepage passes `true`. Project pages and topology keep the simple header. The theme switcher script loads on every page so theme persists, but the palette nav only renders on the homepage.

- [ ] **Step 2: Update `src/pages/index.astro` — new hero layout**

Replace the full file:

```astro
---
import { getCollection } from 'astro:content';
import Base from '../layouts/Base.astro';
import ProjectCard from '../components/ProjectCard.astro';

const projects = await getCollection('projects');
const sorted = projects.sort((a, b) => a.data.order - b.data.order);
---

<Base title="Dylan McCavitt" showPaletteNav={true}>
  <main>
    <section class="hero">
      <p class="hero__tagline">Software engineer building reliable systems.</p>
    </section>

    <section class="projects" id="projects">
      <h2 class="section-heading">Projects</h2>
      <div class="projects__grid">
        {sorted.map((project) => (
          <ProjectCard title={project.data.title} href={`/projects/${project.id}/`} />
        ))}
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
    padding: 0 var(--space-5) var(--space-7);
  }
  .hero__tagline {
    color: var(--text-muted);
    font-size: var(--text-lg);
  }
  .section-heading { margin-bottom: var(--space-6); }
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
    .projects__grid { grid-template-columns: 1fr; }
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
  .contact__links a:hover { color: var(--text); }
</style>
```

- [ ] **Step 3: Verify build and dev preview**

Run: `npx astro build`
Expected: Build succeeds with 0 errors.

Run: `npx astro dev` and open in browser.
Expected: `[Dylan McCavitt]` top-left. Palette strip centered below. `[/theme]` above strip. Clicking `[/theme]` opens dropdown. Selecting a theme changes all colors. Refresh preserves theme.

- [ ] **Step 4: Commit**

```bash
git add src/layouts/Base.astro src/pages/index.astro
git commit -m "Wire palette nav and theme switcher into layout and homepage"
```

---

### Task 7: Resume placeholder page

**Files:**

- Create: `src/pages/resume.astro`

- [ ] **Step 1: Create `src/pages/resume.astro`**

```astro
---
import Base from '../layouts/Base.astro';
---

<Base title="Resume — Dylan McCavitt">
  <main class="resume">
    <h1 class="resume__title">Resume</h1>
    <p class="resume__placeholder">Content coming soon.</p>
    <a href="/resume.pdf" class="resume__download">Download PDF &darr;</a>
  </main>
</Base>

<style>
  .resume {
    max-width: 680px;
    margin: 0 auto;
    padding: var(--space-8) var(--space-5);
  }
  .resume__title {
    letter-spacing: -0.02em;
    margin-bottom: var(--space-5);
  }
  .resume__placeholder {
    color: var(--text-muted);
    margin-bottom: var(--space-6);
  }
  .resume__download {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--accent);
  }
</style>
```

- [ ] **Step 2: Verify build**

Run: `npx astro build`
Expected: Build succeeds. `/resume/` page renders.

- [ ] **Step 3: Commit**

```bash
git add src/pages/resume.astro
git commit -m "Add resume placeholder page"
```

---

### Task 8: Clean up old font files

**Files:**

- Delete: `public/fonts/inter-400.woff2`
- Delete: `public/fonts/inter-600.woff2`

- [ ] **Step 1: Remove unused Inter font files**

```bash
rm public/fonts/inter-400.woff2 public/fonts/inter-600.woff2
```

- [ ] **Step 2: Verify build**

Run: `npx astro build`
Expected: Build succeeds. No references to Inter remain.

- [ ] **Step 3: Commit**

```bash
git add -u public/fonts/
git commit -m "Remove unused Inter font files"
```

---

### Task 9: Final verification

- [ ] **Step 1: Full build check**

Run: `npx astro build`
Expected: 0 errors, all pages built.

- [ ] **Step 2: Lint check**

Run: `npx eslint .`
Expected: 0 errors.

- [ ] **Step 3: Dev server smoke test**

Run: `npx astro dev` and verify:

1. Homepage: `[Dylan McCavitt]` header, palette strip centered, `[/theme]` dropdown works
2. Click each theme — colors change, palette strip updates, page background updates
3. Refresh — theme persists from localStorage
4. Navigate to a project page — theme persists, header shows `[Dylan McCavitt]`, no palette strip
5. Navigate to `/resume/` — placeholder renders
6. Mobile viewport — palette strip stacks vertically
7. `[/theme]` dropdown closes on outside click and Escape key

- [ ] **Step 4: Commit any final fixes if needed**
