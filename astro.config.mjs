// @ts-check
import console from 'node:console';
import process from 'node:process';
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// Keep in sync with shouldUsePublicProjectDb in src/lib/public-projects.ts.
// (astro.config cannot import that TS module: the `@/` path alias is not
// resolved when Astro bundles the config file.)
const PUBLIC_PROJECT_DB_FLAGS = ['PUBLIC_PROJECT_PAGES_FROM_DB', 'PORTFOLIO_PUBLIC_PROJECTS_FROM_DB'];
const DATABASE_ENV_KEYS = ['DATABASE_URL', 'POSTGRES_URL', 'PORTFOLIO_DATABASE_URL', 'PORTFOLIO_POSTGRES_URL'];
const TRUTHY_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);
const PUBLIC_PROJECT_SOURCE_VALUES = new Set(['database', 'catalog_emergency']);

function publicProjectSourceMode() {
  const configuredSource = (process.env.PUBLIC_PROJECT_SOURCE ?? '').trim().toLowerCase();
  if (configuredSource) {
    if (!PUBLIC_PROJECT_SOURCE_VALUES.has(configuredSource)) {
      throw new Error('Invalid PUBLIC_PROJECT_SOURCE. Expected database or catalog_emergency.');
    }
    if (configuredSource === 'catalog_emergency') {
      console.warn(
        '[public-projects] SOURCE MODE catalog_emergency: serving the legacy catalog by explicit operator override.',
      );
    }
    return configuredSource;
  }

  if (PUBLIC_PROJECT_DB_FLAGS.some((key) => TRUTHY_ENV_VALUES.has((process.env[key] ?? '').trim().toLowerCase()))) {
    return 'database';
  }
  const ci = (process.env.CI ?? '').trim().toLowerCase();
  if (process.env.VERCEL === '1' && (ci === '1' || ci === 'true')) return 'database';
  if (DATABASE_ENV_KEYS.some((key) => (process.env[key] ?? '').trim() !== '')) return 'database';
  return 'catalog_development';
}

function publicProjectPagesRenderLive() {
  return PUBLIC_PROJECT_SOURCE_MODE === 'database';
}

const PUBLIC_PROJECT_SOURCE_MODE = publicProjectSourceMode();

const LIVE_PUBLIC_PROJECT_PAGES = [
  'src/pages/projects/[id].astro',
  'src/pages/library/index.astro',
  'src/pages/library/[filter].astro',
  'src/pages/hiring.astro',
];

/**
 * Astro only honors statically analyzable `export const prerender` values, so
 * the public-project pages cannot flip themselves to on-demand rendering with
 * an env-dependent expression. When the DB-backed public project source is
 * active, switch those routes to on-demand rendering here so a publish shows
 * up without a redeploy.
 */
function livePublicProjectPages() {
  return /** @type {import('astro').AstroIntegration} */ ({
    name: 'live-public-project-pages',
    hooks: {
      'astro:route:setup': ({ route }) => {
        if (publicProjectPagesRenderLive() && LIVE_PUBLIC_PROJECT_PAGES.some((page) => route.component.endsWith(page))) {
          route.prerender = false;
        }
      },
    },
  });
}

// https://astro.build/config
export default defineConfig({
  adapter: vercel(),
  integrations: [livePublicProjectPages()],
  // Canonical origin — drives `Astro.site`, the `<link rel="canonical">` in the
  // layouts, and the absolute URLs in `src/pages/sitemap.xml.ts` (#25).
  site: 'https://dylanmccavitt.xyz',
  // Suppress the dev-only toolbar pill — it overlaps the bottom player bar in
  // mobile dev screenshots/audits. Dev-only; `astro build` never ships it.
  devToolbar: { enabled: false },
  // Slack slash commands/interactions arrive as cross-origin
  // application/x-www-form-urlencoded POSTs. The Slack endpoint verifies
  // x-slack-signature before touching services, so allow those webhook posts
  // through Astro's global form-origin guard.
  security: { checkOrigin: false },
});
