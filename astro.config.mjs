// @ts-check
import console from 'node:console';
import process from 'node:process';
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import { resolvePublicProjectSourceModeFromEnv } from './src/lib/public-project-source-mode.ts';

function publicProjectPagesRenderLive() {
  return PUBLIC_PROJECT_SOURCE_MODE === 'database';
}

const PUBLIC_PROJECT_SOURCE_MODE = resolvePublicProjectSourceModeFromEnv(process.env);
if (PUBLIC_PROJECT_SOURCE_MODE === 'catalog_emergency') {
  console.warn(
    '[public-projects] SOURCE MODE catalog_emergency: serving the legacy catalog by explicit operator override.',
  );
}

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
