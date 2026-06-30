// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  adapter: vercel(),
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
